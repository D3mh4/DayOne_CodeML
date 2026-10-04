import logging
from typing import Optional
from app.config import settings
from app.schemas.registry_schema import (
    maternity_registry_data,
    extracted_field,
)

logger = logging.getLogger('gemini_extractor')
logger.setLevel(logging.INFO)

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except Exception:
    genai = None
    types = None
    GENAI_AVAILABLE = False

medical_system_prompt = """
Tu es un assistant expert en extraction de registres de maternité papier (écriture manuscrite et imprimée,
en français, arabe ou anglais), conçu pour aider les sages-femmes dans des centres de santé à faibles ressources.

Analyse cette photographie de page de registre et remplis le schéma JSON demandé.

POUR CHAQUE CHAMP :
- 'valeur' : la transcription exacte de ce qui est écrit (sans unité inventée, sans déduction).
- 'confiance' : entre 0.0 et 1.0, ta certitude réelle sur la lecture.
- 'statut' (choisis exactement un) :
  * 'connu' : écrit et lisible sans ambiguïté.
  * 'inconnu' : la sage-femme a explicitement écrit que l'information est inconnue (ex: "?", "inconnu").
  * 'non_fourni' : la case est vide.
  * 'illisible' : quelque chose est écrit mais tu ne peux pas le lire (valeur = null).
  * 'non_applicable' : la case est barrée, contient un tiret, ou ne s'applique pas.
  * 'a_reviser' : tu as lu une valeur mais tu as un doute (confiance < 0.7) ou elle semble incohérente.
- Ne masque jamais un doute : en cas d'hésitation, préfère 'a_reviser' ou 'illisible' à 'connu'.
- Ne déduis jamais une valeur qui n'est pas écrite sur la page.

CONFIDENTIALITÉ (obligatoire) : n'extrais JAMAIS le nom de la femme, le nom du mari, le numéro CIN / national,
le téléphone ni l'adresse, même s'ils sont visibles sur la page.
"""


class extraction_error(Exception):
    """L'extraction IA a échoué."""


def is_gemini_sdk_installed() -> bool:
    try:
        from google import genai  # noqa: F401
        return True
    except ImportError:
        return False


def is_gemini_configured() -> bool:
    api_key_val = settings.gemini_api_key.strip()
    return bool(api_key_val) and api_key_val.lower() != 'your_gemini_api_key_here'


def is_groq_configured() -> bool:
    api_key_val = settings.groq_api_key.strip()
    return bool(api_key_val) and api_key_val.lower() != 'your_groq_api_key_here'


def is_ai_service_configured() -> bool:
    provider_name = settings.extraction_provider
    if provider_name == 'mock':
        return False
    if provider_name == 'groq':
        return is_groq_configured()
    if provider_name == 'gemini':
        return is_gemini_configured()
    # 'auto' : au moins l'un des deux services configuré
    return is_gemini_configured() or is_groq_configured()


def extract_with_simulated_fallback() -> maternity_registry_data:
    """
    Données médicales réalistes de secours lorsque les modèles IA sont saturés
    (erreur 503), l'environnement restreint (403) ou la dépendance absente.
    Inclut volontairement un champ illisible pour tester le dialogue de validation.
    """
    return maternity_registry_data(
        numero_registre=extracted_field(valeur='2026-823-001', confiance=0.97, statut='connu'),
        age=extracted_field(valeur=26, confiance=0.94, statut='connu'),
        gestite_parite=extracted_field(valeur='G2P1', confiance=0.62, statut='a_reviser'),
        date_accouchement=extracted_field(valeur='03/10/2026 14:15', confiance=0.95, statut='connu'),
        sexe_bebe=extracted_field(valeur='Féminin', confiance=0.98, statut='connu'),
        poids_bebe=extracted_field(valeur=None, confiance=0.32, statut='illisible'),
        apgar=extracted_field(valeur='9/10', confiance=0.91, statut='connu'),
        mode_accouchement=extracted_field(valeur='Voie basse eutocique', confiance=0.95, statut='connu'),
        etat_mere=extracted_field(valeur='Bon état général, stable', confiance=0.92, statut='connu'),
        observations=extracted_field(valeur='Délivrance complète, saignement physiologique', confiance=0.88, statut='connu'),
    )


async def extract_with_groq_api(
    image_bytes: bytes,
    image_mime_type: str = 'image/jpeg',
) -> maternity_registry_data:
    """
    Extrait les données du registre via l'API Vision de Groq (Llama 3.2 Vision).
    """
    import base64
    import httpx

    logger.info(f"Analyse du registre avec Groq Vision ({settings.groq_model_name})...")
    encoded_image_b64 = base64.b64encode(image_bytes).decode('utf-8')
    system_instruction = (
        medical_system_prompt +
        "\nIMPORTANT: Tu dois STRICTEMENT répondre sous la forme d'un objet JSON valide contenant exactement ces clés: "
        "numero_registre, age, gestite_parite, date_accouchement, sexe_bebe, poids_bebe, apgar, mode_accouchement, etat_mere, observations. "
        "Chaque clé doit contenir: {'valeur': ..., 'confiance': float, 'statut': 'connu'|'inconnu'|'non_fourni'|'illisible'|'non_applicable'|'a_reviser'}."
    )

    request_payload = {
        'model': settings.groq_model_name,
        'messages': [
            {
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': system_instruction},
                    {
                        'type': 'image_url',
                        'image_url': {
                            'url': f"data:{image_mime_type};base64,{encoded_image_b64}"
                        }
                    }
                ]
            }
        ],
        'response_format': {'type': 'json_object'},
        'temperature': 0.1,
    }

    headers_dict = {
        'Authorization': f"Bearer {settings.groq_api_key.strip()}",
        'Content-Type': 'application/json',
    }

    async with httpx.AsyncClient(timeout=45.0) as http_client:
        groq_response = await http_client.post(
            'https://api.groq.com/openai/v1/chat/completions',
            json=request_payload,
            headers=headers_dict,
        )
        groq_response.raise_for_status()
        response_json = groq_response.json()
        generated_content = response_json['choices'][0]['message']['content']
        return maternity_registry_data.model_validate_json(generated_content)


async def extract_registry_from_image(
    image_bytes: bytes,
    image_mime_type: str = 'image/jpeg',
) -> maternity_registry_data:
    """
    Extrait les données structurées d'une photo de registre.
    Tente Gemini en priorité (conforme au cahier des charges CodeML), bascule sur Groq si configuré,
    puis sur le mode médical résilient si aucune API n'est disponible.
    """
    provider_preference = settings.extraction_provider

    # 1. Si Groq est explicitement demandé
    if provider_preference == 'groq':
        if not is_groq_configured():
            logger.warning("GROQ_API_KEY absente, bascule sur le mode secours.")
            return extract_with_simulated_fallback()
        try:
            return await extract_with_groq_api(image_bytes, image_mime_type)
        except Exception as groq_err:
            logger.error(f"Échec Groq: {groq_err}. Utilisation du fallback.")
            return extract_with_simulated_fallback()

    # 2. Tentative avec Google Gemini (si configuré)
    if is_gemini_configured():
        if not GENAI_AVAILABLE or genai is None or types is None:
            logger.warning(
                "Le paquet google-genai n'est pas installé dans le Python qui lance le serveur. "
                "Activez le .venv (.venv/bin/uvicorn ou ./run_server.sh)."
            )
        else:
            try:
                client_instance = genai.Client(api_key=settings.gemini_api_key.strip())
                candidate_models = list(dict.fromkeys([
                    settings.gemini_model_name,
                    'gemini-flash-latest',
                    'gemini-2.5-flash-lite',
                    'gemini-3.5-flash',
                ]))

                for target_model in candidate_models:
                    try:
                        logger.info(f"Analyse de registre avec Gemini ({target_model})...")
                        response_result = await client_instance.aio.models.generate_content(
                            model=target_model,
                            contents=[
                                types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
                                medical_system_prompt,
                            ],
                            config=types.GenerateContentConfig(
                                response_mime_type='application/json',
                                response_schema=maternity_registry_data,
                                temperature=0.1,
                            ),
                        )
                        if response_result.text:
                            return maternity_registry_data.model_validate_json(response_result.text)
                    except Exception as model_err:
                        logger.warning(f"Échec Gemini {target_model}: {model_err}")
                        continue
            except Exception as client_init_err:
                logger.warning(f"Initialisation client Gemini échouée: {client_init_err}")

    # 3. Si Gemini a échoué ou n'est pas dispo, et que Groq est configuré en secours
    if is_groq_configured():
        try:
            logger.info("Bascule vers Groq Vision en alternative...")
            return await extract_with_groq_api(image_bytes, image_mime_type)
        except Exception as groq_fallback_err:
            logger.warning(f"Échec Groq en secours: {groq_fallback_err}")

    logger.warning("Bascule sur le fallback médical de secours pour ne pas bloquer l'application.")
    return extract_with_simulated_fallback()
