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
    gemini_model_name: str = os.getenv('GEMINI_MODEL', 'gemini-flash-latest')
    groq_api_key: str = os.getenv('GROQ_API_KEY', '')
    groq_model_name: str = os.getenv('GROQ_MODEL', 'llama-3.2-11b-vision-preview')
    # 'auto', 'gemini', 'groq', ou 'mock'
    extraction_provider: str = os.getenv('EXTRACTION_PROVIDER', 'auto').strip().lower()
    server_host: str = os.getenv('HOST', '0.0.0.0')
    server_port: int = int(os.getenv('PORT', '8000'))

settings = app_settings()
