@echo off
cd /d "%~dp0"
echo ============================================
echo   God-Agent: Scheduler Daemon
echo ============================================
echo.
echo Starting scheduler daemon...
echo.
echo Supports triggers:
echo   - datetime : Run at specific time
echo   - cron     : Recurring schedule
echo   - event    : Event-triggered
echo   - file     : File change watch
echo   - manual   : On-demand only
echo.
npm run launch:daemon
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start. Check the error above.
    pause
)
