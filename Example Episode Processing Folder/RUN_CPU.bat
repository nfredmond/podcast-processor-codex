@echo off
title Welcome to Grass Valley - CPU Mode
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -NoExit -Command "& '.\go.ps1'"