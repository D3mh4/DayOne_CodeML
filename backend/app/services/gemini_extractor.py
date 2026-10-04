import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from pydantic import BaseModel

from app.config import settings
from app.services.page_extraction import (
    classification_prompt,
    empty_flat_fields,
    extraction_prompt,
    flatten_extraction,
    normalize_checkbox_fields,
    normalize_dash_fields,
    page_classification,
    response_model_for,
)
from app.services.plausibility import apply_consistency_rules, apply_plausibility_rules

logger = logging.getLogger('gemini_extractor')
logger.setLevel(logging.INFO)

# Si le modèle configuré est saturé (503) ou indisponible, on essaie les suivants (3.5-flash-lite a 500 RPD)
fallback_gemini_models = ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.5-flash']
placeholder_keys = {'', 'your_gemini_api_key_here', 'your_groq_api_key_here', 'aizasy...', 'gsk_...'}


class extraction_error(Exception):
    """L'extraction IA a échoué : l'appelant doit garder le record en file d'attente, pas inventer des données."""


@dataclass
class page_extraction_result:
    page_type: str
    page_confidence: float
    fields: dict[str, dict]  # {clé aplatie: {valeur, confiance, statut, label, raison?}}
    # Modèles qui ont réellement répondu (si le modèle configuré est saturé, un autre de la liste a pu répondre)
    model_names: list[str] = field(default_factory=list)


def _is_real_key(api_key: str) -> bool:
    return bool(api_key and api_key.strip().lower() not in placeholder_keys)


is_real_key = _is_real_key


def is_gemini_sdk_installed() -> bool:
    try:
        from google import genai  # noqa: F401
        return True
    except ImportError:
        return False


def is_gemini_configured() -> bool:
    return _is_real_key(settings.gemini_api_key)


def is_groq_configured() -> bool:
    return _is_real_key(settings.groq_api_key)


def is_ai_service_configured() -> bool:
    provider_name = settings.extraction_provider
    if provider_name == 'mock':
        return False
    if provider_name == 'groq':
        return is_groq_configured()
    if provider_name == 'gemini':
        return is_gemini_configured()
    # 'auto' : au moins un des deux services configuré
    return is_gemini_configured() or is_groq_configured()


def extract_with_simulated_fallback() -> page_extraction_result:
    """
    Données factices pour développer sans clé API (EXTRACTION_PROVIDER=mock ou aucune clé).
    Toujours marquées is_simulated dans la réponse : jamais utilisées pour masquer une panne de l'IA.
    Page « accouchement » avec volontairement un champ illisible et un champ invraisemblable (poids en kg).
    """
    fields = empty_flat_fields('p4_accouchement')
    simulated_values = {
        'lieu': ('En milieu surveillé ; Maternité', 0.93, 'connu'),
        'date_accouchement': ('03/02/2026', 0.95, 'connu'),
        'mode_accouchement': ('Voie basse non instrumentale', 0.9, 'connu'),
        'presence_complications': ('non', 0.9, 'connu'),
        'etat_nouveau_ne': ('Vivant', 0.97, 'connu'),
        'sexe': ('F', 0.98, 'connu'),
        'poids_naissance': ('3.5', 0.9, 'connu'),
        'perimetre_cranien': (None, 0.3, 'illisible'),
        'anomalie': ('Aucune', 0.88, 'connu'),
        'age_gestationnel': ('40 SA', 0.62, 'a_reviser'),
    }
    for key, (value, confidence, status) in simulated_values.items():
        fields[key].update({'valeur': value, 'confiance': confidence, 'statut': status})
    return page_extraction_result('p4_accouchement', 1.0, apply_plausibility_rules('p4_accouchement', fields), ['simulation'])


# -- fournisseurs ---------------------------------------------------------------------------------

async def _gemini_json(
    image_bytes: bytes,
    image_mime_type: str,
    prompt: str,
    response_model: type[BaseModel],
    custom_api_key: Optional[str] = None,
) -> tuple[BaseModel, str]:
    try:
        from google import genai
        from google.genai import types
    except ImportError as missing_sdk_error:
        # Cas typique : uvicorn lancé avec le Python global au lieu du .venv du projet
        raise extraction_error(
            "Le paquet google-genai n'est pas installé dans le Python qui lance le serveur. "
            "Activez le .venv du backend (ou ./run_server.sh) puis : pip install -r requirements.txt"
        ) from missing_sdk_error

    active_key = custom_api_key.strip() if custom_api_key and _is_real_key(custom_api_key) else settings.gemini_api_key.strip()
    client = genai.Client(api_key=active_key)
    failures = []
    for model_name in dict.fromkeys([settings.gemini_model_name, *fallback_gemini_models]):
        try:
            response_result = await client.aio.models.generate_content(
                model=model_name,
                contents=[types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type), prompt],
                config=types.GenerateContentConfig(
                    response_mime_type='application/json',
                    response_schema=response_model,
                    temperature=0.0,
                ),
            )
            if not response_result.text:
                raise ValueError('réponse vide')
            parsed = response_model.model_validate_json(response_result.text)
            if model_name != settings.gemini_model_name:
                logger.info(f"Réponse obtenue avec le modèle de secours {model_name}")
            return parsed, model_name
        except Exception as model_error:
            logger.warning(f"Échec Gemini {model_name} : {model_error}")
            failures.append(f'{model_name}: {model_error}')
    raise extraction_error('Gemini indisponible — ' + ' | '.join(failures))


async def _groq_json(
    image_bytes: bytes,
    image_mime_type: str,
    prompt: str,
    response_model: type[BaseModel],
    custom_api_key: Optional[str] = None,
) -> tuple[BaseModel, str]:
    """Groq ne garantit pas le schéma : on le donne dans la consigne puis on valide avec Pydantic."""
    import httpx

    active_key = custom_api_key.strip() if custom_api_key and _is_real_key(custom_api_key) else settings.groq_api_key.strip()
    schema_text = json.dumps(response_model.model_json_schema(), ensure_ascii=False)
    request_payload = {
        'model': settings.groq_model_name,
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': f'{prompt}\n\nRéponds uniquement par un objet JSON conforme à ce schéma :\n{schema_text}'},
                {'type': 'image_url', 'image_url': {'url': f"data:{image_mime_type};base64,{base64.b64encode(image_bytes).decode()}"}},
            ],
        }],
        'response_format': {'type': 'json_object'},
        'temperature': 0.0,
    }
    try:
        async with httpx.AsyncClient(timeout=60.0) as http_client:
            groq_response = await http_client.post(
                'https://api.groq.com/openai/v1/chat/completions',
                json=request_payload,
                headers={'Authorization': f'Bearer {active_key}'},
            )
            groq_response.raise_for_status()
            generated_content = groq_response.json()['choices'][0]['message']['content']
        return response_model.model_validate_json(generated_content), f'groq/{settings.groq_model_name}'
    except Exception as groq_error:
        raise extraction_error(f'Groq indisponible — {groq_error}') from groq_error


async def _generate_json(
    image_bytes: bytes,
    image_mime_type: str,
    prompt: str,
    response_model: type[BaseModel],
    custom_api_key: Optional[str] = None,
    custom_provider: Optional[str] = None,
) -> tuple[BaseModel, str]:
    """Essaie les fournisseurs configurés dans l'ordre (auto = Gemini puis Groq), ou utilise la clé client personnalisée."""
    if custom_api_key and _is_real_key(custom_api_key):
        norm_provider = (custom_provider or '').strip().lower()
        if norm_provider == 'groq' or custom_api_key.strip().startswith('gsk_'):
            return await _groq_json(image_bytes, image_mime_type, prompt, response_model, custom_api_key=custom_api_key)
        else:
            return await _gemini_json(image_bytes, image_mime_type, prompt, response_model, custom_api_key=custom_api_key)

    provider_name = settings.extraction_provider
    providers = []
    if provider_name in ('auto', 'gemini') and is_gemini_configured():
        providers.append(_gemini_json)
    if provider_name in ('auto', 'groq') and is_groq_configured():
        providers.append(_groq_json)
    if not providers:
        raise extraction_error(f"Aucun fournisseur IA configuré pour EXTRACTION_PROVIDER={provider_name}")

    failures = []
    for provider in providers:
        try:
            return await provider(image_bytes, image_mime_type, prompt, response_model)
        except extraction_error as provider_error:
            failures.append(str(provider_error))
    raise extraction_error(' || '.join(failures))


async def extract_registry_from_image(
    image_bytes: bytes,
    image_mime_type: str = 'image/jpeg',
    page_type_hint: Optional[str] = None,
    custom_api_key: Optional[str] = None,
    custom_provider: Optional[str] = None,
) -> page_extraction_result:
    """
    1. Reconnaît le type de page (sauf si page_type_hint est fourni), 2. extrait les champs de ce type de page,
    3. applique les règles de vraisemblance. Lève extraction_error en cas d'échec (jamais de données inventées).
    """
    model_names: list[str] = []
    if page_type_hint:
        page_type, page_confidence = page_type_hint, 1.0
    else:
        classification, classification_model = await _generate_json(
            image_bytes, image_mime_type, classification_prompt(), page_classification,
            custom_api_key=custom_api_key, custom_provider=custom_provider
        )
        model_names.append(classification_model)
        page_type, page_confidence = classification.page_type, classification.confiance
        logger.info(f"Page reconnue : {page_type} (confiance {page_confidence:.2f})")
        if page_type == 'inconnue':
            raise extraction_error("La photo ne ressemble à aucune page du registre. Reprenez la photo.")

    extraction, extraction_model = await _generate_json(
        image_bytes, image_mime_type, extraction_prompt(page_type), response_model_for(page_type),
        custom_api_key=custom_api_key, custom_provider=custom_provider
    )
    model_names.append(extraction_model)

    fields = post_process_fields(page_type, flatten_extraction(page_type, extraction))
    return page_extraction_result(page_type, page_confidence, fields, list(dict.fromkeys(model_names)))


def post_process_fields(page_type: str, fields: dict[str, dict]) -> dict[str, dict]:
    """Format des cases à cocher, puis doutes (valeurs invraisemblables, incohérences entre champs). Idempotent."""
    fields = normalize_dash_fields(fields)
    fields = normalize_checkbox_fields(page_type, fields)
    fields = apply_plausibility_rules(page_type, fields)
    return apply_consistency_rules(page_type, fields)
