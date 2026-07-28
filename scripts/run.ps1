<#
.SYNOPSIS
    Run WatchingEye components (Windows).
.DESCRIPTION
    With no arguments, starts the vision engine, gateway, and dashboard
    each in its own window. Pass a component name to run just one in the
    current terminal.
.PARAMETER Component
    all (default) | engine | gateway | dashboard | test
.EXAMPLE
    .\scripts\run.ps1              # start everything
    .\scripts\run.ps1 gateway      # gateway only, foreground
    .\scripts\run.ps1 test         # full test suite
#>
param(
    [ValidateSet("all", "engine", "gateway", "dashboard", "test")]
    [string]$Component = "all"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

switch ($Component) {
    "engine" {
        Set-Location $root
        cargo run -p vision-engine
    }
    "gateway" {
        Set-Location "$root\apps\gateway"
        npm run dev
    }
    "dashboard" {
        Set-Location "$root\apps\dashboard"
        npm run dev
    }
    "test" {
        Set-Location $root
        cargo test --workspace
        if (-not $?) { exit 1 }
        cargo clippy --workspace --all-targets -- -D warnings
        if (-not $?) { exit 1 }
        Set-Location "$root\apps\gateway"
        npm test
    }
    "all" {
        Write-Host "Starting vision engine, gateway (:8080), dashboard (:5173) in separate windows..." -ForegroundColor Cyan
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; cargo run -p vision-engine"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\apps\gateway'; npm run dev"
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\apps\dashboard'; npm run dev"
        Write-Host "Dashboard: http://localhost:5173  |  Gateway health: http://localhost:8080/health" -ForegroundColor Green
    }
}
