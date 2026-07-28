<#
.SYNOPSIS
    Set up a development machine for WatchingEye (Windows).
.DESCRIPTION
    Installs Rust via rustup (winget) if missing, installs Node dependencies
    for the gateway and dashboard, and checks for optional tools (Ollama).
    Safe to re-run; every step is idempotent.
.EXAMPLE
    .\scripts\install.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- Rust ---
Write-Step "Checking Rust toolchain"
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -eq $cargo) {
    Write-Host "Rust not found. Installing rustup via winget..."
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
    Write-Host "Rust installed. If 'cargo' is still not found, restart your terminal." -ForegroundColor Yellow
} else {
    Write-Host "Found $(cargo --version)"
}

Write-Step "Adding Rust components (clippy, rustfmt)"
rustup component add clippy rustfmt

# --- Node ---
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host "Node.js not found. Installing LTS via winget..."
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
} else {
    Write-Host "Found Node $(node --version)"
}

Write-Step "Installing gateway dependencies"
Push-Location "$root\apps\gateway"; npm install --no-audit --no-fund; Pop-Location

Write-Step "Installing dashboard dependencies"
Push-Location "$root\apps\dashboard"; npm install --no-audit --no-fund; Pop-Location

# --- Optional: Ollama (needed from Phase 2 on) ---
Write-Step "Checking Ollama (optional, needed for Phase 2 VLM work)"
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($null -eq $ollama) {
    Write-Host "Ollama not installed. Install later with: winget install Ollama.Ollama" -ForegroundColor Yellow
} else {
    Write-Host "Found $(ollama --version)"
}

# --- Build & test ---
Write-Step "Building Rust workspace"
Push-Location $root; cargo build --workspace; Pop-Location

Write-Step "Running Rust tests"
Push-Location $root; cargo test --workspace; Pop-Location

Write-Step "Running gateway tests"
Push-Location "$root\apps\gateway"; npm test; Pop-Location

Write-Host "`nInstall complete. Start everything with: .\scripts\run.ps1" -ForegroundColor Green
