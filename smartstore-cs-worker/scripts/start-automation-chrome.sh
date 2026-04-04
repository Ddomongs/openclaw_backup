#!/bin/bash
set -euo pipefail

WORKDIR="/Users/dh/.openclaw/workspace/smartstore-cs-worker"
PROFILE_DIR="$WORKDIR/runtime-data/chrome-profile"
EXT_DIR="/Users/dh/.openclaw/workspace/quickstar-extension/11. 퀵스타 배송 조회 크롬플러그인"
CDP_PORT="${CSBOT_CDP_PORT:-9223}"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOG_FILE="$WORKDIR/runtime-data/chrome.log"

mkdir -p "$PROFILE_DIR"
mkdir -p "$WORKDIR/runtime-data"

if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Chrome automation port $CDP_PORT already listening"
  exit 0
fi

nohup "$CHROME_BIN" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXT_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --new-window "https://sell.smartstore.naver.com/#/comment/" \
  >"$LOG_FILE" 2>&1 &

sleep 3

echo "Started automation Chrome on port $CDP_PORT"
echo "Profile: $PROFILE_DIR"
echo "Log: $LOG_FILE"
