@echo off
cd /d "%~dp0"
echo ============================================
echo   God-Agent: Full Stack
echo ============================================
echo.
echo Starting all services...
echo   - MemoryEngine + CODEX
echo   - Telegram Bot (if configured)
echo   - Scheduler Daemon
echo   - Webhook Server
echo.
npm run launch
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start. Check the error above.
    pause
)
