@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv (
  echo [1/3] Creating Python environment...
  py -3 -m venv .venv 2>nul || python -m venv .venv
)
if not exist .venv\Scripts\python.exe (
  echo Python is not installed. Install it from https://www.python.org/downloads/ and check "Add python.exe to PATH".
  pause
  exit /b 1
)
echo [2/3] Installing packages...
.venv\Scripts\python.exe -m pip install -q -r requirements.txt
echo [3/3] Starting server...
start "" http://127.0.0.1:5000
.venv\Scripts\python.exe app.py
pause
