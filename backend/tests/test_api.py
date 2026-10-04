import io
import sys
from pathlib import Path

# Assurer la résolution du module app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from PIL import Image
from starlette.testclient import TestClient
from app import main as main_module
from app.config import settings
from app.main import app
from app.services.gemini_extractor import extraction_error

valid_statuses = ['connu', 'inconnu', 'non_fourni', 'illisible', 'non_applicable', 'a_reviser']


def build_dummy_upload():
    dummy_image = Image.new('RGB', (120, 120), color='white')
    buffer = io.BytesIO()
    dummy_image.save(buffer, format='JPEG')
    return {'image_file': ('registre_maternite.jpg', buffer.getvalue(), 'image/jpeg')}


def test_health_check_endpoint():
    client = TestClient(app)
    response = client.get('/health')
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'healthy'
    assert data['service'] == 'dayone_codeml_backend'


def test_extract_registry_mock_mode(monkeypatch):
    monkeypatch.setattr(settings, 'extraction_provider', 'mock')
    client = TestClient(app)

    response = client.post(
        '/extract_registry',
        files=build_dummy_upload(),
        data={'record_id': 'rec_test_456', 'patient_id': 'PAT-TEST-99'},
    )
    assert response.status_code == 200
    json_data = response.json()
    assert json_data['success'] is True
    assert json_data['is_simulated'] is True
    assert json_data['record_id'] == 'rec_test_456'
    assert json_data['patient_id'] == 'PAT-TEST-99'

    extracted = json_data['extracted_data']
    # Aucun identifiant direct ne doit sortir du backend
    assert 'nom_patiente' not in extracted
    for field_val in extracted.values():
        assert field_val['statut'] in valid_statuses
        assert 0.0 <= field_val['confiance'] <= 1.0


def test_extract_registry_failure_is_not_hidden(monkeypatch):
    """Un échec Gemini doit renvoyer une erreur, jamais des données inventées."""
    monkeypatch.setattr(settings, 'extraction_provider', 'gemini')
    monkeypatch.setattr(main_module, 'is_gemini_configured', lambda: True)

    async def failing_extractor(**_kwargs):
        raise extraction_error('quota dépassé')

    monkeypatch.setattr(main_module, 'extract_registry_from_image', failing_extractor)
    client = TestClient(app)

    response = client.post('/extract_registry', files=build_dummy_upload(), data={'record_id': 'rec_x'})
    assert response.status_code == 502
    assert 'quota' in response.json()['detail']


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-v']))
