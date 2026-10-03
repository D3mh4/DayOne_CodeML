import os
from pathlib import Path
from dotenv import load_dotenv

# Chargement du fichier .env ou .env.example
env_path = Path(__file__).resolve().parent.parent / '.env'
env_example_path = Path(__file__).resolve().parent.parent / '.env.example'

if env_path.exists():
    load_dotenv(dotenv_path=env_path)
if env_example_path.exists():
    load_dotenv(dotenv_path=env_example_path)

load_dotenv()

class app_settings:
    gemini_api_key: str = os.getenv('GEMINI_API_KEY', '')
    gemini_model_name: str = os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')
    server_host: str = os.getenv('HOST', '0.0.0.0')
    server_port: int = int(os.getenv('PORT', '8000'))

settings = app_settings()
