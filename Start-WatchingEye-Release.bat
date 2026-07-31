@echo off
REM Start WatchingEye from built release artifacts (Windows).
REM Run Build-WatchingEye.bat first, or pass -Build to build now.
title WatchingEye
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-release.ps1" %*
if errorlevel 1 (
  echo.
  echo Startup failed. The message above says why.
  pause
)
