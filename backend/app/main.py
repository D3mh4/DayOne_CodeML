import logging
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.schemas.registry_schema import (
    extraction_response,
    maternity_registry_data,
)
from app.services.gemini_extractor import extract_registry_from_image

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('dayone_backend')

# Initialisation de FastAPI
app = FastAPI(
    title="DayOne CodeML - Backend d'Extraction de Registres Médicaux",
    description="API FastAPI pour l'analyse et l'extraction IA multimodale de registres papier de maternité",
    version="1.0.0",
)

# Configuration CORS pour React Native / Expo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get('/health')
async def health_check():
    """
    Vérification de l'état de l'API et de la configuration de Gemini.
    """
    is_gemini_key_present = bool(
        settings.gemini_api_key
        and settings.gemini_api_key.strip() != 'your_gemini_api_key_here'
    )
    return {
        'status': 'healthy',
        'service': 'dayone_codeml_backend',
        'gemini_configured': is_gemini_key_present,
        'model_target': settings.gemini_model_name,
    }

@app.post('/extract_registry', response_model=extraction_response)
async def extract_registry_endpoint(
    image_file: UploadFile = File(..., description="Fichier image du registre papier"),
    record_id: Optional[str] = Form(None, description="Identifiant unique du record mobile"),
    patient_id: Optional[str] = Form(None, description="Identifiant optionnel de la patiente"),
):
    """
    Endpoint principal pour analyser une photo de registre papier de maternité,
    construire le prompt médical, appeler Gemini Vision et restituer les données
    médicales structurées avec Pydantic.
    """
    try:
        # 1. Validation du type MIME
        content_type_header = image_file.content_type or 'image/jpeg'
        if not content_type_header.startswith('image/'):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Le fichier envoyé ({content_type_header}) n'est pas une image valide."
            )

        # 2. Lecture du buffer de l'image
        image_content_bytes = await image_file.read()
        if not image_content_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Le fichier image transmis est vide."
            )

        logger.info(
            f"Traitement d'une image de registre: taille={len(image_content_bytes)} octets, "
            f"type={content_type_header}, record_id={record_id}, patient_id={patient_id}"
        )

        # 3. Extraction avec Gemini Vision et validation Pydantic
        extracted_data, notice_message = await extract_registry_from_image(
            image_bytes=image_content_bytes,
            image_mime_type=content_type_header,
            patient_id_hint=patient_id,
        )

        resolved_patient_id = patient_id or (
            str(extracted_data.numero_registre.valeur)
            if extracted_data.numero_registre.valeur
            else 'PAT-INCONNU'
        )

        return extraction_response(
            success=True,
            record_id=record_id,
            patient_id=resolved_patient_id,
            extracted_data=extracted_data,
            raw_summary=(
                f"Registre analysé pour {extracted_data.nom_patiente.valeur or 'patiente'}. "
                f"Statut poids: {extracted_data.poids_bebe.statut}."
            ),
            error_message=notice_message,
        )

    except HTTPException as http_exc:
        raise http_exc
    except Exception as unexpected_error:
        logger.error(f"Erreur inattendue lors de l'extraction: {unexpected_error}", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                'success': False,
                'record_id': record_id,
                'patient_id': patient_id,
                'extracted_data': maternity_registry_data().model_dump(),
                'raw_summary': None,
                'error_message': f"Erreur serveur interne : {str(unexpected_error)}",
            }
        )

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        'app.main:app',
        host=settings.server_host,
        port=settings.server_port,
        reload=True
    )
