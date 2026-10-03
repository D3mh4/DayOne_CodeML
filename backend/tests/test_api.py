import io
import sys
from pathlib import Path

# Assurer la résolution du module app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image
from starlette.testclient import TestClient
from app.main import app

def test_health_check_endpoint():
    client = TestClient(app)
    response = client.get('/health')
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'healthy'
    assert data['service'] == 'dayone_codeml_backend'

def test_extract_registry_endpoint():
    client = TestClient(app)
    
    # Génération d'une image de test JPEG
    dummy_image = Image.new('RGB', (120, 120), color='white')
    buffer = io.BytesIO()
    dummy_image.save(buffer, format='JPEG')
    buffer.seek(0)

    files = {
        'image_file': ('registre_maternite.jpg', buffer.getvalue(), 'image/jpeg')
    }
    form_data = {
        'record_id': 'rec_test_456',
        'patient_id': 'PAT-TEST-99'
    }

    response = client.post('/extract_registry', files=files, data=form_data)
    assert response.status_code == 200
    json_data = response.json()
    assert json_data['success'] is True
    assert json_data['record_id'] == 'rec_test_456'
    assert json_data['patient_id'] == 'PAT-TEST-99'
    
    extracted = json_data['extracted_data']
    assert 'nom_patiente' in extracted
    assert 'statut' in extracted['nom_patiente']
    assert 'confiance' in extracted['nom_patiente']
    assert extracted['nom_patiente']['statut'] in ['connu', 'inconnu', 'illisible']

if __name__ == '__main__':
    test_health_check_endpoint()
    test_extract_registry_endpoint()
    print("Tous les tests d'intégration backend sont validés avec succès.")
