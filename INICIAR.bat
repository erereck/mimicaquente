@echo off
title Mimica Quente
cd /d "%~dp0"
start "" http://localhost:3000
call npm.cmd run dev
pause
