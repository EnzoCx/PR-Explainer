@echo off
rem Installs PR Explainer for the current user. Safe to run again (repairs or updates).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
