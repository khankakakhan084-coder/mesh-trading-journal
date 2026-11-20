@echo off
title Mesh Trading Journal
color 0a
echo ==============================================================
echo                 MESH TRADING JOURNAL
echo ==============================================================
echo.
echo  Checking port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%a >nul 2>&1
echo  Starting local server...
echo  Your data is saved in: data\trades.json
echo.
cd /d "%~dp0"
timeout /t 1 /nobreak >nul
start "" http://localhost:3000
node server.js
pause
