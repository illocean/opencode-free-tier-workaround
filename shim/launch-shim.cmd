@echo off
rem launch-shim.cmd — start the shim and wait for it to be healthy.
cd /d "%~dp0"
start "" /min node opencode-free-shim.cjs
timeout /t 3 /nobreak >nul
curl -s -o nul -w "shim health: %%{http_code}\n" http://127.0.0.1:8791/health
