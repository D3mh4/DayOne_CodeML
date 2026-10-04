#!/usr/bin/env sh
# Lance le backend avec le Python du .venv du projet (évite l'erreur « cannot import name 'genai' »
# quand uvicorn est lancé avec le Python global). Usage : ./run_server.sh
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
