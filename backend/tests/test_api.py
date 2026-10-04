import io
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

# Assurer la résolution du module app
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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


class TestBackendAPI(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_check_endpoint(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['status'], 'healthy')
        self.assertEqual(data['service'], 'dayone_codeml_backend')

    def test_extract_registry_mock_mode(self):
        with patch.object(settings, 'extraction_provider', 'mock'):
            response = self.client.post(
                '/extract_registry',
                files=build_dummy_upload(),
                data={'record_id': 'rec_test_456', 'patient_id': 'PAT-TEST-99'},
            )
            self.assertEqual(response.status_code, 200)
            json_data = response.json()
            self.assertTrue(json_data['success'])
            self.assertTrue(json_data['is_simulated'])
            self.assertEqual(json_data['record_id'], 'rec_test_456')
            self.assertEqual(json_data['patient_id'], 'PAT-TEST-99')

            extracted = json_data['extracted_data']
            # Aucun identifiant direct ne doit sortir du backend
            self.assertNotIn('nom_patiente', extracted)
            for field_val in extracted.values():
                self.assertIn(field_val['statut'], valid_statuses)
                self.assertGreaterEqual(field_val['confiance'], 0.0)
                self.assertLessEqual(field_val['confiance'], 1.0)

    def test_extract_registry_failure_is_handled(self):
        """Un échec Gemini explicite renvoie une erreur 502."""
        with patch.object(settings, 'extraction_provider', 'gemini'), \
             patch.object(main_module, 'is_gemini_configured', lambda: True):

            async def failing_extractor(**_kwargs):
                raise extraction_error('quota dépassé')

            with patch.object(main_module, 'extract_registry_from_image', failing_extractor):
                response = self.client.post(
                    '/extract_registry',
                    files=build_dummy_upload(),
                    data={'record_id': 'rec_x'}
                )
                self.assertEqual(response.status_code, 502)
                self.assertIn('quota', response.json()['detail'])


def test_missing_gemini_sdk_returns_clear_502(monkeypatch):
    """google-genai absent (mauvais Python) : 502 avec un message qui dit quoi faire, pas une 500 brute."""
    import builtins

    monkeypatch.setattr(settings, 'extraction_provider', 'gemini')
    monkeypatch.setattr(main_module, 'is_gemini_configured', lambda: True)
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


if __name__ == '__main__':
    unittest.main()
