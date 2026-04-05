#!/bin/bash
set -euo pipefail

WORKDIR="/Users/dh/.openclaw/workspace/smartstore-cs-worker"
LEGACY_PROFILE_DIR="/Users/dh/.openclaw/workspace/tmp/chrome-csbot-profile"
DEFAULT_PROFILE_DIR="$WORKDIR/runtime-data/chrome-profile"
if [ -d "$LEGACY_PROFILE_DIR" ]; then
  PROFILE_DIR="${CSBOT_PROFILE_DIR:-$LEGACY_PROFILE_DIR}"
else
  PROFILE_DIR="${CSBOT_PROFILE_DIR:-$DEFAULT_PROFILE_DIR}"
fi
CDP_PORT="${CSBOT_CDP_PORT:-9223}"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOG_FILE="$WORKDIR/runtime-data/chrome.log"
MARKER_URL='data:text/html,<title>[CSBOT 9223] 자동화 창</title><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;background:#0f172a;color:#e2e8f0;"><h1>[CSBOT 9223] 자동화 Chrome</h1><p>이 창은 스마트스토어 CS 자동화 전용 Chrome 입니다.</p><p>포트: 9223</p><p>프로필: chrome-csbot-profile / runtime-data/chrome-profile</p></body>'

mkdir -p "$PROFILE_DIR"
mkdir -p "$WORKDIR/runtime-data"

if lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Chrome automation port $CDP_PORT already listening"
  exit 0
fi

nohup "$CHROME_BIN" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --new-window "$MARKER_URL" "https://sell.smartstore.naver.com/#/comment/" "https://quickstar.co.kr" \
  >"$LOG_FILE" 2>&1 &

sleep 3

echo "Started automation Chrome on port $CDP_PORT"
echo "Profile: $PROFILE_DIR"
echo "Log: $LOG_FILE"
