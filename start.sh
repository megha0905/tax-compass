#!/usr/bin/env bash
# Starts TaxCompass on http://localhost:8000 (Mac/Linux)
cd "$(dirname "$0")/backend"
if [ ! -d venv ]; then
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt
else
  source venv/bin/activate
fi
uvicorn app.main:app --port 8000
