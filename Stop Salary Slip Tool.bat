@echo off
title Stop Salary Slip Tool
echo Stopping the Salary Slip Tool...
taskkill /fi "WINDOWTITLE eq Salary Slip Tool*" /t /f >nul 2>&1
echo Done - the Salary Slip Tool has been stopped.
timeout /t 2 /nobreak >nul
exit
