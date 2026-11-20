@echo off
cd /d "%~dp0"

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [gachi-gage] cloudflared is not installed. Installing it with winget...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo [gachi-gage] Install finished. Close this window and run tunnel.bat again.
  pause
  exit /b
)

echo [gachi-gage] Keep start.bat running, then wait for the line with https://....trycloudflare.com below.
echo [gachi-gage] Paste that address into the web page: last menu tab (account connection) - public address box.
echo [gachi-gage] Close this window after the demo to stop public access.
echo.
cloudflared tunnel --url http://localhost:3000
pause
