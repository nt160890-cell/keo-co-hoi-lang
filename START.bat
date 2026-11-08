@echo off
chcp 65001 >nul
title Keo Co Hoi Lang
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Dang cai thu vien lan dau, cho mot chut...
  call npm install
  if errorlevel 1 (
    echo Cai thu vien loi. Kiem tra mang roi chay lai.
    pause
    exit /b 1
  )
)

if not exist .env if exist .env.example copy .env.example .env >nul

rem Open the game a moment after the server starts.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost.game:3946/"
echo Dang chay Keo Co Hoi Lang. Dong cua so nay de tat game.
call npm start
pause
