@echo off
cd /d "%~dp0"
echo [RESTART] Reading PID from god-agent.pid...

if not exist god-agent.pid (
    echo No PID file found. Cannot restart.
    exit /b 1
)

set /p PID=<god-agent.pid
echo [RESTART] Killing process %PID%...
taskkill /F /PID %PID% 2>nul

timeout /t 3 /nobreak >nul
echo [RESTART] Relaunching full system...
start "" launch.bat
