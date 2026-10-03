import json
import logging
from typing import Optional, Tuple
from app.config import settings
from app.schemas.registry_schema import (
    maternity_registry_data,
    extracted_field,
)

logger = logging.getLogger('gemini_extractor')
logger.setLevel(logging.INFO)

medical_system_prompt = """
Tu es un assistant expert en extraction et numérisation de registres médicaux manuscrits de maternité, conçu pour aider les sages-femmes dans les centres de santé à faibles ressources.

Analyse avec la plus grande rigueur cette photographie de registre papier de maternité.
Extrais les données pour la patiente consignée sur la ligne visible.

DIRECTIVES ESSENTIELLES POUR CHAQUE CHAMP :
1. Chaque champ de registre doit comporter :
   - 'valeur' : la transcription exacte du texte manuscrit ou du chiffre (ex: 'Amina Diallo', '3.1 kg', 23).
   - 'confiance' : score décimal entre 0.0 et 1.0 reflétant la certitude optique.
   - 'statut' :
     * 'connu' : l'information est présente et lisible sans ambiguïté.
     * 'inconnu' : la case est vierge, barrée ou absente du registre.
     * 'illisible' : une écriture manuscrite est présente mais raturée, tachée, floue ou équivoque.
2. Si une écriture manuscrite est difficile à déchiffrer avec certitude, classe IMPÉRATIVEMENT le champ en statut 'illisible' avec une confiance inférieure à 0.5, afin que la sage-femme puisse confirmer ou corriger l'information.
3. Reste strictement fidèle à ce qui figure sur la page. Ne déduis aucune valeur non écrite.
"""

def extract_with_simulated_fallback(
    custom_patient_id: Optional[str] = None
) -> maternity_registry_data:
    """
    Simulation d'extraction réaliste lorsque la clé API Gemini n'est pas configurée
    ou indisponible. Inclut volontairement un champ illisible pour tester le flux de question/correction.
    """
    random_id = custom_patient_id or f"REG-2026-{100 + hash(custom_patient_id or 'demo') % 900}"
    
    return maternity_registry_data(
        numero_registre=extracted_field(
            valeur=random_id,
            confiance=0.97,
            statut='connu'
        ),
        nom_patiente=extracted_field(
            valeur='Aissata Ouedraogo',
            confiance=0.96,
            statut='connu'
        ),
        age=extracted_field(
            valeur=26,
            confiance=0.94,
            statut='connu'
        ),
        gestite_parite=extracted_field(
            valeur='G2P1',
            confiance=0.91,
            statut='connu'
        ),
        date_accouchement=extracted_field(
            valeur='03/10/2026 14:15',
            confiance=0.95,
            statut='connu'
        ),
        sexe_bebe=extracted_field(
            valeur='Féminin',
            confiance=0.98,
            statut='connu'
        ),
        poids_bebe=extracted_field(
            valeur=None,
            confiance=0.32,
            statut='illisible'  # Champ délibérément illisible pour le prompt ciblé de l'étape 5
        ),
        apgar=extracted_field(
            valeur='9/10',
            confiance=0.93,
            statut='connu'
        ),
        mode_accouchement=extracted_field(
            valeur='Voie basse eutocique',
            confiance=0.95,
            statut='connu'
        ),
        etat_mere=extracted_field(
            valeur='Bon état général, stable',
            confiance=0.92,
            statut='connu'
        ),
        observations=extracted_field(
            valeur='Délivrance complète, saignement physiologique',
            confiance=0.88,
            statut='connu'
        )
    )

async def extract_registry_from_image(
    image_bytes: bytes,
    image_mime_type: str = 'image/jpeg',
    patient_id_hint: Optional[str] = None
) -> Tuple[maternity_registry_data, Optional[str]]:
    """
    Extrait les données structurées d'une photo de registre papier avec Gemini Vision
    et valide la structure avec Pydantic.
    """
    api_key_val = settings.gemini_api_key.strip()

    if not api_key_val or api_key_val.lower() == 'your_gemini_api_key_here':
        logger.warning(
            "GEMINI_API_KEY absente ou par défaut. Utilisation du mode simulation médicale structuré."
        )
        simulated_data = extract_with_simulated_fallback(patient_id_hint)
        return simulated_data, "Mode simulation actif (configurez GEMINI_API_KEY dans backend/.env pour l'API réelle)"

    try:
        from google import genai
        from google.genai import types

        client_instance = genai.Client(
            api_key=api_key_val,
            http_options={'timeout': 15}
        )

        model_candidate_list = [
            settings.gemini_model_name,
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-1.5-flash',
        ]

        last_error = None
        for current_model in model_candidate_list:
            try:
                logger.info(f"Tentative d'analyse de registre avec le modèle {current_model}...")

                response_result = client_instance.models.generate_content(
                    model=current_model,
                    contents=[
                        types.Part.from_bytes(
                            data=image_bytes,
                            mime_type=image_mime_type,
                        ),
                        medical_system_prompt,
                    ],
                    config=types.GenerateContentConfig(
                        response_mime_type='application/json',
                        response_schema=maternity_registry_data.model_json_schema(),
                        temperature=0.1,
                    ),
                )

                response_text = response_result.text
                if response_text:
                    parsed_json_dict = json.loads(response_text)
                    validated_registry_data = maternity_registry_data.model_validate(parsed_json_dict)
                    return validated_registry_data, None

            except Exception as model_call_error:
                last_error = model_call_error
                logger.warning(f"Échec avec {current_model}: {model_call_error}")
                continue

        raise last_error or Exception("Aucun modèle n'a pu répondre")

    except Exception as general_extraction_error:
        logger.error(f"Erreur lors de l'appel Gemini : {general_extraction_error}")
        # En cas d'erreur API, on bascule intelligemment sur la simulation pour ne pas bloquer l'application
        simulated_data = extract_with_simulated_fallback(patient_id_hint)
        return (
            simulated_data,
            f"Erreur API Gemini ({str(general_extraction_error)}). Données de secours fournies."
        )
