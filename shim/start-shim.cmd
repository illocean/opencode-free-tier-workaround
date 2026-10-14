@echo off
rem start-shim.cmd — launch the opencode free-tier shim on 127.0.0.1:8791.
rem This is a standalone helper process. It does NOT touch OmniRoute or OpenCode.
cd /d "%~dp0"
start "" /min node opencode-free-shim.cjs
