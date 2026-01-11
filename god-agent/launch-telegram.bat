@echo off
cd /d "%~dp0"
echo ============================================
echo   God-Agent: Telegram + CODEX
echo ============================================
echo.
echo Starting Telegram bot with CODEX...
echo.
echo Commands available in Telegram:
echo   /start  - Confirm bot is running
echo   /help   - Show available commands
echo   /task   - Submit a task to CODEX
echo   /status - Check current task status
echo.
npm run launch:telegram
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start. Check the error above.
    pause
)
