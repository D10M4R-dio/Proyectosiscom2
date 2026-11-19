@echo off
title Servidor de Monitoreo IoT - Sistemas de Comunicacion II (2026-II)
cd /d "%~dp0"

echo ======================================================================
echo   INICIANDO SERVIDOR WEB DE TELEMETRIA - SISTEMAS DE COMUNICACION II
echo ======================================================================
echo.
echo   Dashboard Local : http://127.0.0.1:5000
echo   Endpoint API    : http://127.0.0.1:5000/api/readings
echo.
echo ======================================================================

start "" "http://127.0.0.1:5000"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" app.py
) else (
    python app.py
)
pause
