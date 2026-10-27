@echo off
setlocal
cd /d "%~dp0"
if not exist "node.exe" (
  echo Node runtime missing. Reinstall Device Control Center.
  pause
  exit /b 1
)
if not exist "dist\index.js" (
  echo App files missing. Reinstall Device Control Center.
  pause
  exit /b 1
)
if not exist "platform-tools\adb.exe" (
  echo Android platform tools missing. Reinstall Device Control Center.
  pause
  exit /b 1
)
set "PATH=%~dp0platform-tools;%PATH%"
echo Starting Device Control Center...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-Device-Control.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. See the error above.
  pause
)
