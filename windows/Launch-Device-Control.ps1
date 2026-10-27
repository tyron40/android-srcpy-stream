$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root 'dist\index.js'
$node = Join-Path $root 'node.exe'
$log = Join-Path $env:LOCALAPPDATA 'DeviceControlCenter\startup.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$env:PATH = (Join-Path $root 'platform-tools') + ';' + $env:PATH
$url = 'http://127.0.0.1:8000/'
try {
    $healthy = $false
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        $healthy = ($response.StatusCode -eq 200)
    } catch {}
    if (-not $healthy) {
        $outLog = Join-Path (Split-Path $log) 'server-output.log'
        $errLog = Join-Path (Split-Path $log) 'server-errors.log'
        $proc = Start-Process -FilePath $node -ArgumentList ('"' + $server + '"') -WorkingDirectory (Join-Path $root 'dist') -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden
        for ($i=0; $i -lt 45; $i++) {
            Start-Sleep -Seconds 1
            if ($proc.HasExited) { throw "Server stopped with exit code $($proc.ExitCode). Read $errLog" }
            try {
                $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
                if ($response.StatusCode -eq 200) { $healthy = $true; break }
            } catch {}
        }
        if (-not $healthy) { throw "Server did not start at $url within 45 seconds. Read $errLog" }
    }
    $browsers = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    )
    $browser = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($browser) {
        Start-Process -FilePath $browser -ArgumentList @("--app=$url", '--new-window')
    } else {
        Start-Process $url
    }
    Write-Host "Device Control Center opened. Close the app window when finished."
    exit 0
} catch {
    $message = "$(Get-Date -Format o) $($_.Exception.Message)"
    Add-Content -Path $log -Value $message
    Write-Error "$message | Logs: $(Split-Path $log)"
    exit 1
}
