@echo off
setlocal
cd /d "%~dp0"
if not exist "node.exe" (
  echo Node runtime is missing. Please reinstall the Windows companion.
  pause
  exit /b 1
)
if not exist "dist\index.js" (
  echo Application files are missing. Please reinstall.
  pause
  exit /b 1
)
echo Starting local Device Control Center...
echo The device dashboard is local to this PC unless you configure secure remote access separately.
cd dist
"..\node.exe" index.js
if errorlevel 1 pause
