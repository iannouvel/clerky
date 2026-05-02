@echo off
REM Software Testing & Feedback Agent
REM Runs agentic tests, automatically creates improvements from failures,
REM and optionally tests them

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ======================================
echo   Testing ^& Feedback Agent
echo ======================================
echo.

REM Run testing agent (creates improvements from test failures)
REM Use --auto-test flag to automatically run improvements agent after
node testing-agent.js %*

if errorlevel 1 (
    echo.
    echo ❌ Testing agent failed.
    pause
    exit /b 1
) else (
    echo.
    echo ✅ Testing agent completed!
    pause
)
