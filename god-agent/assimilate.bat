@echo off
setlocal EnableDelayedExpansion

echo.
echo ===============================================
echo          RUBIX ASSIMILATION PROTOCOL
echo ===============================================
echo.

REM Get the directory where this batch file is located (god-agent root)
set "GOD_AGENT_DIR=%~dp0"
REM Remove trailing backslash
set "GOD_AGENT_DIR=%GOD_AGENT_DIR:~0,-1%"

REM Get the current working directory (project to assimilate to)
set "PROJECT_DIR=%CD%"

echo God-Agent Location: %GOD_AGENT_DIR%
echo Project Directory:  %PROJECT_DIR%
echo.

REM Change to god-agent directory to run node
cd /d "%GOD_AGENT_DIR%"

REM Run assimilate with project root
node dist/cli/index.js assimilate --project-root "%PROJECT_DIR%"

set EXITCODE=%ERRORLEVEL%

REM Return to original directory
cd /d "%PROJECT_DIR%"

if %EXITCODE% neq 0 (
    echo.
    echo [ERROR] Assimilation failed!
    pause
    exit /b %EXITCODE%
)
