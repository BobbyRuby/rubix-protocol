@echo off
cd /d "%~dp0"
echo ============================================
echo   God-Agent: Webhook Server
echo ============================================
echo.
echo Starting webhook server on port 3456...
echo.
echo Endpoints:
echo   POST /webhooks/sms     - Twilio/Telnyx SMS
echo   POST /webhooks/slack   - Slack interactions
echo   POST /webhooks/discord - Discord interactions
echo   POST /webhooks/phone   - CallMe callbacks
echo   GET  /health           - Health check
echo.
npm run launch:webhooks
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start. Check the error above.
    pause
)
