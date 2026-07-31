<#
.SYNOPSIS
    Start WatchingEye from built release artifacts (Windows).
.DESCRIPTION
    Runs the compiled engine, gateway, orchestrator, and dashboard — no
    watchers, no tsx, no dev server. Requires .\scripts\build.ps1 to have
    run first; missing artifacts are reported instead of silently skipped
    (pass -Build to build them now).
.PARAMETER Build
    Run scripts\build.ps1 first.
.PARAMETER NoBrowser
    Do not open the dashboard when it comes up.
.EXAMPLE
    .\scripts\start-release.ps1 -Build
#>
param(
    [switch]$Build,
    [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

Write-Host @"
  WatchingEye - release mode
"@ -ForegroundColor Cyan

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
$mingw = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $mingw) { $env:Path = "$mingw;$env:Path" }
$ollamaBin = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
if (Test-Path $ollamaBin) { $env:Path = "$ollamaBin;$env:Path" }

if ($Build) {
    & (Join-Path $PSScriptRoot "build.ps1")
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

# --- Verify the artifacts exist ---
Write-Step "Checking build artifacts"
$engineExe = Join-Path $root "target\release\vision-engine.exe"
$artifacts = @(
    @{ Name = "gateway";      Path = Join-Path $root "apps\gateway\dist\index.js" },
    @{ Name = "orchestrator"; Path = Join-Path $root "services\agent-orchestrator\dist\index.js" },
    @{ Name = "dashboard";    Path = Join-Path $root "apps\dashboard\.next-prod" }
)
$missing = @()
foreach ($a in $artifacts) {
    if (Test-Path $a.Path) { Write-Ok "$($a.Name) ready" } else { $missing += $a.Name }
}
if ($missing.Count -gt 0) {
    Write-Warn2 "missing: $($missing -join ', ')"
    Write-Host "`nRun .\scripts\build.ps1 first (or re-run with -Build)." -ForegroundColor Red
    exit 1
}
$engineBuilt = Test-Path $engineExe
if (-not $engineBuilt) { Write-Warn2 "vision-engine not built - dashboard runs without live tracking" }

# --- Start services ---
Write-Step "Starting services"
function Start-Service2($name, $dir, $command) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='WatchingEye: $name'; cd '$dir'; $command"
    Write-Ok "$name starting"
}
if ($engineBuilt) {
    Start-Service2 "vision-engine :8090" $root "& '$engineExe'"
}
Start-Service2 "orchestrator :8085" (Join-Path $root "services\agent-orchestrator") "npm start"
Start-Service2 "gateway :8080" (Join-Path $root "apps\gateway") "npm start"
# Must match the directory build.ps1 wrote to, or `next start` looks in
# `.next` and reports a missing production build.
Start-Service2 "dashboard :3000" (Join-Path $root "apps\dashboard") "`$env:NEXT_DIST_DIR='.next-prod'; npm start"

Write-Step "Checking the vision model daemon"
& (Join-Path $PSScriptRoot "ensure-ollama.ps1")

# --- Wait for the dashboard, then open it ---
Write-Step "Waiting for the dashboard"
$ready = $false
foreach ($attempt in 1..60) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 2
        $ready = $true
        break
    } catch { }
}

if ($ready) {
    Write-Ok "dashboard is up"
    if (-not $NoBrowser) { Start-Process "http://localhost:3000" }
    Write-Host "`nWatchingEye is running (release):" -ForegroundColor Green
    Write-Host "  Dashboard      http://localhost:3000"
    Write-Host "  Console        http://localhost:3000/cameras   <- connect your webcam here"
    Write-Host "  Documentation  http://localhost:3000/docs"
    Write-Host "`nTo stop everything: Stop-WatchingEye.bat" -ForegroundColor DarkGray
} else {
    Write-Warn2 "dashboard did not respond within 60s - check the service windows"
    exit 1
}
