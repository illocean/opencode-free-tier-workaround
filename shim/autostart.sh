#!/usr/bin/env bash
# launch-shim.sh — start the opencode free-tier shim on 127.0.0.1:8791.
# The shim is a standalone process; it does NOT touch OmniRoute or OpenCode.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node shim/opencode-free-shim.cjs
