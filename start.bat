@echo off
REM Starts TaxCompass on http://localhost:8000
cd /d "%~dp0backend"
if not exist venv (
  echo First run: setting up Python environment...
  python -m venv venv
  call venv\Scripts\activate
  pip install -r requirements.txt
) else (
  call venv\Scripts\activate
)
start "" http://localhost:8000
uvicorn app.main:app --port 8000
pause
