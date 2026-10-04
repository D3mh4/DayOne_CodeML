import logging
from typing import Optional
from app.config import settings
from app.schemas.registry_schema import (
    maternity_registry_data,
    extracted_field,
)

logger = logging.getLogger('gemini_extractor')
logger.setLevel(logging.INFO)

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
    """L'extraction IA a échoué : l'appelant doit garder le record en file d'attente, pas inventer des données."""


def is_gemini_sdk_installed() -> bool:
    try:
        from google import genai  # noqa: F401
        return True
    except ImportError:
        return False


def is_gemini_configured() -> bool:
    api_key_val = settings.gemini_api_key.strip()
    return bool(api_key_val) and api_key_val.lower() != 'your_gemini_api_key_here'


def extract_with_simulated_fallback() -> maternity_registry_data:
    """
    Données factices pour développer sans clé API (EXTRACTION_PROVIDER=mock ou clé absente).
    Inclut volontairement un champ illisible et un champ à réviser pour tester le flux de vérification.
    """
    return maternity_registry_data(
        numero_registre=extracted_field(valeur='2026-823-001', confiance=0.97, statut='connu'),
        age=extracted_field(valeur=26, confiance=0.94, statut='connu'),
        gestite_parite=extracted_field(valeur='G2P1', confiance=0.62, statut='a_reviser'),
        date_accouchement=extracted_field(valeur='03/10/2026 14:15', confiance=0.95, statut='connu'),
        sexe_bebe=extracted_field(valeur='Féminin', confiance=0.98, statut='connu'),
        poids_bebe=extracted_field(valeur=None, confiance=0.32, statut='illisible'),
        apgar=extracted_field(valeur=None, confiance=0.9, statut='non_fourni'),
        mode_accouchement=extracted_field(valeur='Voie basse', confiance=0.95, statut='connu'),
        etat_mere=extracted_field(valeur='Bon état général', confiance=0.92, statut='connu'),
        observations=extracted_field(valeur=None, confiance=0.9, statut='non_applicable'),
    )


async def extract_registry_from_image(
    image_bytes: bytes,
    image_mime_type: str = 'image/jpeg',
) -> maternity_registry_data:
    """
    Extrait les données structurées d'une photo de registre avec Gemini et les valide avec Pydantic.
    Lève extraction_error en cas d'échec (jamais de données de secours silencieuses).
    """
    try:
        from google import genai
        from google.genai import types
    except ImportError as missing_sdk_error:
        # Cas typique : uvicorn lancé avec le Python global au lieu du .venv du projet
        raise extraction_error(
            "Le paquet google-genai n'est pas installé dans le Python qui lance le serveur. "
            "Activez le .venv du backend puis : pip install -r requirements.txt"
        ) from missing_sdk_error

    client_instance = genai.Client(api_key=settings.gemini_api_key.strip())

    try:
        logger.info(f"Analyse de registre avec le modèle {settings.gemini_model_name}...")
        response_result = await client_instance.aio.models.generate_content(
            model=settings.gemini_model_name,
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
    except Exception as model_call_error:
        raise extraction_error(f"Appel Gemini échoué : {model_call_error}") from model_call_error

    if not response_result.text:
        raise extraction_error("Réponse Gemini vide")

    try:
        return maternity_registry_data.model_validate_json(response_result.text)
    except Exception as validation_error:
        raise extraction_error(f"Réponse Gemini hors schéma : {validation_error}") from validation_error
