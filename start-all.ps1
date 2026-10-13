$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$agentDir = Join-Path $PSScriptRoot 'android-agent'
$python = Join-Path $agentDir '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
    Write-Host 'Creating local Python environment...'
    py -3 -m venv (Join-Path $agentDir '.venv')
}
if (-not (Test-Path $python)) { throw 'Python 3 or virtual environment unavailable.' }
& $python -m pip install -r (Join-Path $agentDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
if (-not (Test-Path (Join-Path $agentDir '.env'))) {
    "OPENAI_API_KEY=PASTE_NEW_KEY_HERE" | Set-Content -Encoding ascii (Join-Path $agentDir '.env')
    Write-Host 'Open android-agent\.env and replace the placeholder with your API key before sending tasks.'
}
Write-Host 'Starting dashboard and bundled Android AI agent...'
npm run start
if ($LASTEXITCODE -ne 0) { throw 'Dashboard exited with error.' }
