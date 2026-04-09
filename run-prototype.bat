@echo off
setlocal enabledelayedexpansion

REM Optional arg: port (example: run-prototype.bat 5174)
set PORT=%~1
if "%PORT%"=="" set PORT=5173
set HOST=127.0.0.1

REM Run from repo root
cd /d "%~dp0"

REM Find a free port if the requested one is busy.
REM We probe using netstat (best-effort).
for /l %%p in (%PORT%,1,5193) do (
  set /a TRYPORT=%%p
  netstat -ano | findstr /C:":!TRYPORT!" >nul 2>nul
  if !errorlevel!==1 (
    set PORT=!TRYPORT!
    goto :start
  ) else (
    echo Port !TRYPORT! is busy, trying next...
  )
)

:start
echo Starting dev server on http://%HOST%:%PORT%/

REM Start Vite in background (no new window).
start "" /b npm run dev -- --port %PORT% --host %HOST% --strictPort

REM Wait until it responds (best-effort). If curl is missing, skip wait.
where curl >nul 2>nul
if %errorlevel%==0 (
  for /l %%i in (1,1,60) do (
    curl -s "http://%HOST%:%PORT%/" >nul 2>nul
    if !errorlevel!==0 (
      goto :open
    )
    timeout /t 1 /nobreak >nul
  )
) else (
  echo "curl" not found - skipping readiness wait.
)

:open
start "" "http://%HOST%:%PORT%/"
echo Done.

