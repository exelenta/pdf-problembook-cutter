@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules call npm install
start "" http://localhost:4173
call npm run dev -- --host 127.0.0.1 --port 4173
pause
