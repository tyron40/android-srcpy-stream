@echo off
setlocal
cd /d "%~dp0"
if not exist "node.exe" (
  echo Node runtime missing. Reinstall the companion.
  pause
  exit /b 1
)
if not exist "dist\index.js" (
  echo Application entry point missing. Reinstall the companion.
  pause
  exit /b 1
)
set "PATH=%~dp0platform-tools;%PATH%"
if not exist "platform-tools\adb.exe" (
  echo Android platform tools are missing. Reinstall the companion.
  pause
  exit /b 1
)
echo Starting Device Control Center on this Windows computer...
echo Keep this window open while using locally connected devices.
cd /d "%~dp0dist"
"..\node.exe" index.js
if errorlevel 1 (
  echo Application exited with an error.
  pause
)
