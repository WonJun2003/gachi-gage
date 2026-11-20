@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [gachi-gage] Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [gachi-gage] Installing packages for the first run...
  call npm install --no-audit --no-fund
)

node server\setup-key.js

start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
pause
