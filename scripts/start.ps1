<#
.SYNOPSIS
    One-click start for WatchingEye (Windows).
.DESCRIPTION
    Brings the system up from any state: installs missing prerequisites,
    builds the Rust core, starts the vision engine, gateway, and dashboard,
    then opens the browser. Safe to run repeatedly — completed work is
    detected and skipped.
.PARAMETER SkipModels
    Do not download AI models (toolchain and services only).
.PARAMETER SkipInstall
    Assume prerequisites are present; just build and start.
.EXAMPLE
    .\scripts\start.ps1
    .\scripts\start.ps1 -SkipModels
#>
param(
    [switch]$SkipModels,
    [switch]$SkipInstall
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

Write-Host @"
  WatchingEye
  Deterministic edge vision - every decision explained.
"@ -ForegroundColor Cyan

# --- Make locally-installed toolchains visible to this session ---
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
$mingw = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $mingw) { $env:Path = "$mingw;$env:Path" }
$ollamaBin = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
if (Test-Path $ollamaBin) { $env:Path = "$ollamaBin;$env:Path" }

# --- Prerequisites ---
if (-not $SkipInstall) {
    Write-Step "Checking prerequisites"
    $needInstall = $false
    foreach ($tool in @("cargo", "node")) {
        if ($null -eq (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Write-Warn2 "$tool not found"
            $needInstall = $true
        } else {
            Write-Ok "$tool present"
        }
    }
    if ($needInstall) {
        Write-Step "Running installer (this happens once)"
        $args = @()
        if ($SkipModels) { $args += "-SkipModels" }
        & (Join-Path $PSScriptRoot "install.ps1") @args
        if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
    }

    if (-not $SkipModels) {
        $yolo = Join-Path $root "models\vision\yolo11n.onnx"
        if (-not (Test-Path $yolo)) {
            Write-Step "Downloading AI models (first run only)"
            & (Join-Path $PSScriptRoot "install-models.ps1")
        } else {
            Write-Ok "AI models present"
        }
    }
}

# --- Node dependencies ---
Write-Step "Checking Node dependencies"
foreach ($proj in @("apps\gateway", "apps\dashboard", "services\agent-orchestrator")) {
    $dir = Join-Path $root $proj
    if (-not (Test-Path (Join-Path $dir "node_modules"))) {
        Write-Warn2 "installing $proj"
        Push-Location $dir; npm install --no-audit --no-fund; Pop-Location
    } else {
        Write-Ok "$proj ready"
    }
}

# --- Build the Rust core ---
Write-Step "Building the vision engine"
Push-Location $root
cargo build -p vision-engine --release
$engineBuilt = $LASTEXITCODE -eq 0
Pop-Location
if ($engineBuilt) {
    Write-Ok "engine built"
} else {
    Write-Warn2 "engine build failed - the dashboard will still run, without live camera tracking"
}

# --- Start services ---
Write-Step "Starting services"
function Start-Service2($name, $dir, $command) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='WatchingEye: $name'; cd '$dir'; $command"
    Write-Ok "$name starting"
}
if ($engineBuilt) {
    Start-Service2 "vision-engine :8090" $root "`$env:Path='$cargoBin;$mingw;'+`$env:Path; cargo run -p vision-engine --release"
}
Start-Service2 "orchestrator :8085" (Join-Path $root "services\agent-orchestrator") "npm run dev"
Start-Service2 "gateway :8080" (Join-Path $root "apps\gateway") "npm run dev"
Start-Service2 "dashboard :3000" (Join-Path $root "apps\dashboard") "npm run dev"

# The vision model must be resident for classification to be fast.
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Ok "ollama present (classification enabled)"
} else {
    Write-Warn2 "ollama not found - tracking works, classification will be refused"
}

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
    Start-Process "http://localhost:3000"
    Write-Host "`nWatchingEye is running:" -ForegroundColor Green
    Write-Host "  Dashboard      http://localhost:3000"
    Write-Host "  Console        http://localhost:3000/cameras   <- connect your webcam here"
    Write-Host "  Documentation  http://localhost:3000/docs"
    Write-Host "`nTo stop everything: Stop-WatchingEye.bat" -ForegroundColor DarkGray
} else {
    Write-Warn2 "dashboard did not respond within 60s - check the service windows"
    exit 1
}
