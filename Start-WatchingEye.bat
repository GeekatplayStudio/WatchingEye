@echo off
REM One-click launcher for WatchingEye (Windows).
REM Double-click this file. It installs whatever is missing, starts every
REM service, and opens the dashboard.
title WatchingEye
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. The message above says why.
  pause
)
