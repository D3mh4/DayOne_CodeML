import logging
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.schemas.registry_pages import pages_by_type
from app.schemas.registry_schema import extraction_response
from app.services.gemini_extractor import (
    extract_registry_from_image,
    extract_with_simulated_fallback,
    extraction_error,
    is_gemini_configured,
    is_gemini_sdk_installed,
    is_ai_service_configured,
    is_groq_configured,
    is_real_key,
)

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
    return {
        'status': 'healthy',
        'service': 'dayone_codeml_backend',
        'gemini_configured': is_gemini_configured(),
        'groq_configured': is_groq_configured(),
        'ai_service_configured': is_ai_service_configured(),
        'gemini_sdk_installed': is_gemini_sdk_installed(),
        'extraction_provider': settings.extraction_provider,
        'model_target': settings.gemini_model_name,
    }

@app.post('/extract_registry', response_model=extraction_response)
async def extract_registry_endpoint(
    image_file: UploadFile = File(..., description="Fichier image du registre papier"),
    record_id: Optional[str] = Form(None, description="Identifiant unique du record mobile"),
    patient_id: Optional[str] = Form(None, description="Identifiant optionnel de la patiente"),
    page_type: Optional[str] = Form(None, description="Type de page si déjà connu (sinon reconnu par l'IA)"),
    custom_api_key: Optional[str] = Form(None, description="Clé API personnalisée transmise par le mobile"),
    custom_provider: Optional[str] = Form(None, description="Fournisseur personnalisé ('gemini' ou 'groq')"),
):
    """
    Endpoint principal pour analyser une photo de registre papier de maternité,
    construire le prompt médical, appeler Gemini Vision ou Groq et restituer les données
    médicales structurées avec Pydantic.
    """
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
        f"type={content_type_header}, record_id={record_id}, custom_provider={custom_provider}"
    )

    if page_type and page_type not in pages_by_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Type de page inconnu : {page_type}")

    # 3. Mode simulation explicite (mock ou aucune clé) : signalé dans la réponse, jamais déguisé en vraie extraction
    has_custom_key = bool(custom_api_key and is_real_key(custom_api_key))
    is_simulated = (not is_ai_service_configured()) and (not has_custom_key)
    if is_simulated:
        result = extract_with_simulated_fallback()
    else:
        # 4. Extraction réelle (Gemini, puis Groq si configuré, ou clé client). En cas d'échec : erreur, le mobile garde la photo
        #    en file et la renverra. Jamais de données factices à la place d'une vraie lecture.
        try:
            result = await extract_registry_from_image(
                image_bytes=image_content_bytes,
                image_mime_type=content_type_header,
                page_type_hint=page_type,
                custom_api_key=custom_api_key if has_custom_key else None,
                custom_provider=custom_provider,
            )
        except extraction_error as failed_extraction:
            logger.error(f"Extraction échouée pour record_id={record_id}: {failed_extraction}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(failed_extraction))
        except Exception as unexpected_error:
            logger.exception(f"Erreur inattendue lors de l'extraction pour record_id={record_id}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Erreur inattendue pendant l'extraction : {unexpected_error}",
            )

    page_title_str = pages_by_type[result.page_type].title if result.page_type in pages_by_type else None
    if page_title_str and "titre_document" not in result.fields:
        from app.schemas.registry_schema import extracted_field
        result.fields["titre_document"] = extracted_field(
            valeur=page_title_str,
            confiance=float(result.page_confidence if result.page_confidence is not None else 1.0),
            statut="connu",
            label="Nom du document",
            raison=None,
        )

    return extraction_response(
        success=True,
        record_id=record_id,
        patient_id=patient_id,
        page_type=result.page_type,
        page_title=page_title_str,
        page_confidence=result.page_confidence,
        extracted_data=result.fields,
        error_message="Mode simulation actif (aucune clé IA configurée ou EXTRACTION_PROVIDER=mock)" if is_simulated else None,
        is_simulated=is_simulated,
    )

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(
        'app.main:app',
        host=settings.server_host,
        port=settings.server_port,
        reload=True
    )
