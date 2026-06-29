@echo off
title Salary Slip Tool Launcher
cd /d "%~dp0"

REM ============================================================
REM  Double-click this file to launch the Salary Slip Tool.
REM  It starts the local server (which now hosts BOTH the app
REM  and the email engine) and opens it in your browser.
REM  No typing needed.
REM ============================================================

REM --- Make sure dependencies are installed (first run only) ---
if not exist "node_modules\nodemailer" (
  echo Installing components for the first time, please wait...
  call npm install
)

REM --- Start the server in its own minimized window ---
REM     (keep that window running while you use the tool;
REM      close it when you are done for the day)
REM     The server opens the app in your browser automatically.
start "Salary Slip Tool - keep running while in use" /min cmd /k node server.js

exit
