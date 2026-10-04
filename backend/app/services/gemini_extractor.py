import logging
from dataclasses import dataclass
from typing import Optional

from app.config import settings
from app.services.page_extraction import (
    classification_prompt,
    empty_flat_fields,
    extraction_prompt,
    flatten_extraction,
    page_classification,
    response_model_for,
)
from app.services.plausibility import apply_plausibility_rules

logger = logging.getLogger('gemini_extractor')
logger.setLevel(logging.INFO)


class extraction_error(Exception):
    """L'extraction IA a échoué : l'appelant doit garder le record en file d'attente, pas inventer des données."""


@dataclass
class page_extraction_result:
    page_type: str
    page_confidence: float
    fields: dict[str, dict]  # {clé aplatie: {valeur, confiance, statut, label, raison?}}


def is_gemini_sdk_installed() -> bool:
    try:
        from google import genai  # noqa: F401
        return True
    except ImportError:
        return False


def is_gemini_configured() -> bool:
    api_key_val = settings.gemini_api_key.strip()
    return bool(api_key_val) and api_key_val.lower() != 'your_gemini_api_key_here'


def extract_with_simulated_fallback() -> page_extraction_result:
    """
    Données factices pour développer sans clé API (EXTRACTION_PROVIDER=mock ou clé absente).
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
    return page_extraction_result('p4_accouchement', 1.0, apply_plausibility_rules('p4_accouchement', fields))


def _gemini_client():
    try:
        from google import genai
        from google.genai import types
    except ImportError as missing_sdk_error:
        # Cas typique : uvicorn lancé avec le Python global au lieu du .venv du projet
        raise extraction_error(
            "Le paquet google-genai n'est pas installé dans le Python qui lance le serveur. "
            "Activez le .venv du backend puis : pip install -r requirements.txt"
        ) from missing_sdk_error
    return genai.Client(api_key=settings.gemini_api_key.strip()), types


async def _generate_json(client, types, image_bytes: bytes, image_mime_type: str, prompt: str, response_model):
    try:
        response_result = await client.aio.models.generate_content(
            model=settings.gemini_model_name,
            contents=[types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type), prompt],
            config=types.GenerateContentConfig(
                response_mime_type='application/json',
                response_schema=response_model,
                temperature=0.0,
            ),
        )
    except Exception as model_call_error:
        raise extraction_error(f"Appel Gemini échoué : {model_call_error}") from model_call_error

    if not response_result.text:
        raise extraction_error("Réponse Gemini vide")
    try:
        return response_model.model_validate_json(response_result.text)
    except Exception as validation_error:
        raise extraction_error(f"Réponse Gemini hors schéma : {validation_error}") from validation_error


async def extract_registry_from_image(
    image_bytes: bytes,
    image_mime_type: str = 'image/jpeg',
    page_type_hint: Optional[str] = None,
) -> page_extraction_result:
    """
    1. Reconnaît le type de page (sauf si page_type_hint est fourni), 2. extrait les champs de ce type de page,
    3. applique les règles de vraisemblance. Lève extraction_error en cas d'échec (jamais de données inventées).
    """
    client, types = _gemini_client()

    if page_type_hint:
        page_type, page_confidence = page_type_hint, 1.0
    else:
        classification = await _generate_json(
            client, types, image_bytes, image_mime_type, classification_prompt(), page_classification
        )
        page_type, page_confidence = classification.page_type, classification.confiance
        logger.info(f"Page reconnue : {page_type} (confiance {page_confidence:.2f})")
        if page_type == 'inconnue':
            raise extraction_error("La photo ne ressemble à aucune page du registre. Reprenez la photo.")

    extraction = await _generate_json(
        client, types, image_bytes, image_mime_type, extraction_prompt(page_type), response_model_for(page_type)
    )
    fields = apply_plausibility_rules(page_type, flatten_extraction(page_type, extraction))
    return page_extraction_result(page_type, page_confidence, fields)
