@echo off
REM TRANSHEAT TWIN — uygulamayı başlatır ve tarayıcıda açar (http://localhost:8000)
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python ortami bulunamadi. README.md icindeki "Kurulum" adimlarini uygulayin.
  pause
  exit /b 1
)
start "" http://localhost:8000
".venv\Scripts\python.exe" -m uvicorn backend.app.main:app --port 8000
