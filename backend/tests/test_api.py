import asyncio
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
from app.services import gemini_extractor
from app.services.gemini_extractor import extraction_error

valid_statuses = ['connu', 'inconnu', 'non_fourni', 'illisible', 'non_applicable', 'a_reviser']


def build_dummy_upload():
    dummy_image = Image.new('RGB', (120, 120), color='white')
    buffer = io.BytesIO()
    dummy_image.save(buffer, format='JPEG')
    return {'image_file': ('registre_maternite.jpg', buffer.getvalue(), 'image/jpeg')}


def use_real_ai(monkeypatch):
    """Simule un serveur avec une clé configurée (sans appel réseau réel)."""
    monkeypatch.setattr(settings, 'extraction_provider', 'gemini')
    monkeypatch.setattr(main_module, 'is_ai_service_configured', lambda: True)


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

    assert json_data['page_type'] == 'p4_accouchement'
    extracted = json_data['extracted_data']
    for field_val in extracted.values():
        assert field_val['statut'] in valid_statuses
        assert 0.0 <= field_val['confiance'] <= 1.0
        assert field_val['label']
    # Règle de vraisemblance : « 3.5 » pour un poids de naissance ressemble à des kg
    assert extracted['poids_naissance']['statut'] == 'a_reviser'
    assert '3500' in extracted['poids_naissance']['raison']


def test_extract_registry_failure_is_not_hidden(monkeypatch):
    """Un échec de l'IA doit renvoyer une erreur, jamais des données inventées."""
    use_real_ai(monkeypatch)

    async def failing_extractor(**_kwargs):
        raise extraction_error('quota dépassé')

    monkeypatch.setattr(main_module, 'extract_registry_from_image', failing_extractor)
    client = TestClient(app)

    response = client.post('/extract_registry', files=build_dummy_upload(), data={'record_id': 'rec_x'})
    assert response.status_code == 502
    assert 'quota' in response.json()['detail']


def test_unexpected_error_is_not_replaced_by_fake_data(monkeypatch):
    use_real_ai(monkeypatch)

    async def crashing_extractor(**_kwargs):
        raise RuntimeError('bug inattendu')

    monkeypatch.setattr(main_module, 'extract_registry_from_image', crashing_extractor)
    client = TestClient(app)

    response = client.post('/extract_registry', files=build_dummy_upload(), data={'record_id': 'rec_z'})
    assert response.status_code == 502
    assert 'bug inattendu' in response.json()['detail']


def test_missing_gemini_sdk_returns_clear_502(monkeypatch):
    """google-genai absent (mauvais Python) : 502 avec un message qui dit quoi faire, pas une 500 brute."""
    import builtins

    use_real_ai(monkeypatch)
    monkeypatch.setattr(settings, 'gemini_api_key', 'cle-de-test')
    real_import = builtins.__import__

    def import_without_genai(name, globals_dict=None, locals_dict=None, fromlist=(), level=0):
        if name == 'google' and fromlist and 'genai' in fromlist:
            raise ImportError("cannot import name 'genai' from 'google'")
        return real_import(name, globals_dict, locals_dict, fromlist, level)

    monkeypatch.setattr(builtins, '__import__', import_without_genai)
    client = TestClient(app)

    response = client.post('/extract_registry', files=build_dummy_upload(), data={'record_id': 'rec_y'})
    assert response.status_code == 502
    assert 'pip install -r requirements.txt' in response.json()['detail']


def test_placeholder_keys_are_not_real_keys(monkeypatch):
    monkeypatch.setattr(settings, 'extraction_provider', 'auto')
    monkeypatch.setattr(settings, 'gemini_api_key', 'AIzaSy...')
    monkeypatch.setattr(settings, 'groq_api_key', '')
    assert not gemini_extractor.is_ai_service_configured()


def test_auto_mode_falls_back_to_groq_then_reports_errors(monkeypatch):
    monkeypatch.setattr(settings, 'extraction_provider', 'auto')
    monkeypatch.setattr(settings, 'gemini_api_key', 'cle-gemini')
    monkeypatch.setattr(settings, 'groq_api_key', 'cle-groq')

    async def gemini_down(*_args):
        raise extraction_error('Gemini indisponible — 503')

    async def groq_ok(_image, _mime, _prompt, response_model):
        return response_model(page_type='p1_couverture', confiance=0.9)

    monkeypatch.setattr(gemini_extractor, '_gemini_json', gemini_down)
    monkeypatch.setattr(gemini_extractor, '_groq_json', groq_ok)
    result = asyncio.run(gemini_extractor._generate_json(b'x', 'image/png', 'prompt', gemini_extractor.page_classification))
    assert result.page_type == 'p1_couverture'

    async def groq_down(*_args):
        raise extraction_error('Groq indisponible — 401')

    monkeypatch.setattr(gemini_extractor, '_groq_json', groq_down)
    with pytest.raises(extraction_error) as raised:
        asyncio.run(gemini_extractor._generate_json(b'x', 'image/png', 'prompt', gemini_extractor.page_classification))
    assert '503' in str(raised.value) and '401' in str(raised.value)


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-v']))
