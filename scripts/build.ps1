<#
.SYNOPSIS
    Build every WatchingEye component for release (Windows).
.DESCRIPTION
    Installs Node dependencies where missing, then produces release
    artifacts: the Rust vision engine (cargo --release), the gateway and
    orchestrator (tsc -> dist/), and the dashboard (next build). Fails on
    the first broken component so CI and humans see the same result.
.PARAMETER SkipRust
    Build only the Node/TypeScript components.
.PARAMETER SkipNode
    Build only the Rust workspace.
.EXAMPLE
    .\scripts\build.ps1
    .\scripts\build.ps1 -SkipRust
#>
param(
    [switch]$SkipRust,
    [switch]$SkipNode
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    $msg" -ForegroundColor Red }

Write-Host @"
  WatchingEye - release build
"@ -ForegroundColor Cyan

# --- Make locally-installed toolchains visible to this session ---
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
$mingw = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin"
if (Test-Path $mingw) { $env:Path = "$mingw;$env:Path" }

$failed = @()

if (-not $SkipRust) {
    Write-Step "Building the Rust workspace (release)"
    Push-Location $root
    cargo build --workspace --release
    if ($LASTEXITCODE -ne 0) { $failed += "rust workspace" } else { Write-Ok "vision-engine + crates built" }
    Pop-Location
}

if (-not $SkipNode) {
    Write-Step "Installing Node dependencies"
    foreach ($proj in @("apps\gateway", "apps\dashboard", "services\agent-orchestrator")) {
        $dir = Join-Path $root $proj
        if (-not (Test-Path (Join-Path $dir "node_modules"))) {
            Write-Warn2 "installing $proj"
            Push-Location $dir
            npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { $failed += "$proj (npm install)" }
            Pop-Location
        } else {
            Write-Ok "$proj ready"
        }
    }

    foreach ($proj in @("services\agent-orchestrator", "apps\gateway", "apps\dashboard")) {
        Write-Step "Building $proj"
        Push-Location (Join-Path $root $proj)
        npm run build
        if ($LASTEXITCODE -ne 0) { $failed += $proj } else { Write-Ok "$proj built" }
        Pop-Location
    }
}

if ($failed.Count -gt 0) {
    Write-Host "`nBuild failed:" -ForegroundColor Red
    foreach ($f in $failed) { Write-Fail "- $f" }
    exit 1
}

Write-Host "`nBuild complete." -ForegroundColor Green
Write-Host "  engine        target\release\vision-engine.exe"
Write-Host "  gateway       apps\gateway\dist"
Write-Host "  orchestrator  services\agent-orchestrator\dist"
Write-Host "  dashboard     apps\dashboard\.next"
Write-Host "`nRun it with: .\scripts\start-release.ps1" -ForegroundColor DarkGray
