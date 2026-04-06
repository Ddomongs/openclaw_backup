#!/bin/bash
set -euo pipefail

WORKSPACE_DIR="/Users/dh/.openclaw/workspace"
cd "$WORKSPACE_DIR"

./smartstore-cs-worker/scripts/start-automation-chrome.sh >/dev/null
./smartstore-cs-worker/scripts/check-automation-chrome.sh >/dev/null
node ./smartstore-cs-worker/scripts/talktalk-watch-run.mjs
