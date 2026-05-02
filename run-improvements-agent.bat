@echo off
REM Automated Improvements Testing Agent
REM Finds improvements in "testing" status, runs tests, records results, and commits changes

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ======================================
echo   Improvements Testing Agent
echo ======================================
echo.

node test-all-improvements.js

if errorlevel 1 (
    echo.
    echo ❌ Agent failed. Check the output above.
    pause
    exit /b 1
) else (
    echo.
    echo ✅ Agent completed successfully!
    pause
)
