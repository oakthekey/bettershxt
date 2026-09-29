@echo off
set "APPDIR=%~dp0"
set "APPDIR=%APPDIR:~0,-1%"
cd /d "%APPDIR%"
start "" "%APPDIR%\node_modules\electron\dist\electron.exe" "%APPDIR%"
