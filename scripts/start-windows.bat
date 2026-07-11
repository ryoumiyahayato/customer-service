@echo off
cd /d %~dp0\..
if not exist .env (
  if exist .env.example copy .env.example .env
  echo Created .env from .env.example. Please edit AUTH_SECRET for production.
)
npm install
if errorlevel 1 pause && exit /b 1
npm run build
if errorlevel 1 pause && exit /b 1
npm run start
pause
