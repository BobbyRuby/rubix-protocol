@echo off
setlocal EnableDelayedExpansion

REM Auto-install for OneShotProAi - testing the full flow
set "SOURCE_DIR=%~dp0"
set "SOURCE_DIR=%SOURCE_DIR:~0,-1%"
set "TARGET_DIR=C:\Users\rruby\PhpstormProjects\OneShotProAi\rubix"
set "OPENAI_KEY=REDACTED_OPENAI_KEY"
set "ANTHROPIC_KEY=REDACTED_ANTHROPIC_KEY"

echo.
echo ═══════════════════════════════════════════════
echo          RUBIX AUTO INSTALL TEST
echo ═══════════════════════════════════════════════
echo.
echo Source: %SOURCE_DIR%
echo Target: %TARGET_DIR%
echo.

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo [1/7] Copying source files...
robocopy "%SOURCE_DIR%\src" "%TARGET_DIR%\src" /E /NFL /NDL /NJH /NJS
robocopy "%SOURCE_DIR%\docs" "%TARGET_DIR%\docs" /E /NFL /NDL /NJH /NJS 2>nul

copy "%SOURCE_DIR%\package.json" "%TARGET_DIR%\" >nul
copy "%SOURCE_DIR%\tsconfig.json" "%TARGET_DIR%\" >nul
copy "%SOURCE_DIR%\.env.example" "%TARGET_DIR%\" >nul 2>nul
copy "%SOURCE_DIR%\launch.bat" "%TARGET_DIR%\" >nul 2>nul
copy "%SOURCE_DIR%\launch-telegram.bat" "%TARGET_DIR%\" >nul 2>nul
copy "%SOURCE_DIR%\launch-daemon.bat" "%TARGET_DIR%\" >nul 2>nul
copy "%SOURCE_DIR%\launch-webhooks.bat" "%TARGET_DIR%\" >nul 2>nul
copy "%SOURCE_DIR%\assimilate.bat" "%TARGET_DIR%\" >nul 2>nul
copy "%SOURCE_DIR%\*.md" "%TARGET_DIR%\" >nul 2>nul

echo [2/7] Creating data directory...
mkdir "%TARGET_DIR%\data" 2>nul

echo [3/7] Installing dependencies...
cd /d "%TARGET_DIR%"
call npm install

if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed!
    exit /b 1
)

echo [4/7] Building TypeScript...
call npm run build

if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed!
    exit /b 1
)

REM Copy schema.sql to dist
echo        Copying SQL schemas...
if not exist "%TARGET_DIR%\dist\storage" mkdir "%TARGET_DIR%\dist\storage"
copy "%TARGET_DIR%\src\storage\*.sql" "%TARGET_DIR%\dist\storage\" >nul 2>nul

echo [5/7] Creating .env file...
(
echo # RUBIX Environment Configuration
echo.
echo OPENAI_API_KEY=%OPENAI_KEY%
echo ANTHROPIC_API_KEY=%ANTHROPIC_KEY%
echo GOD_AGENT_DATA_DIR=./data
echo.
echo # Telegram - ADD YOUR BOT TOKEN HERE
echo # TELEGRAM_BOT_TOKEN=
echo # TELEGRAM_CHAT_ID=
) > "%TARGET_DIR%\.env"

echo [6/7] Running assimilation...
call node dist\cli\index.js assimilate --skip-setup -y

echo.
echo ═══════════════════════════════════════════════
echo          INSTALLATION COMPLETE
echo ═══════════════════════════════════════════════
echo.
echo Location: %TARGET_DIR%
echo.
