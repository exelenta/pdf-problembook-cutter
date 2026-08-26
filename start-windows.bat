@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13 or later is required: https://nodejs.org/
  pause
  exit /b 1
)
call npm install
if errorlevel 1 exit /b 1
call npm run dev
pause
