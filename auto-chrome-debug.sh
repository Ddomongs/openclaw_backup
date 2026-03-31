#!/bin/bash
set -u

# Chrome remote debugging helper for macOS
# - Attempts to auto-click the Chrome "allow remote debugging" prompt
# - Optionally notifies Telegram when the debugging endpoint changes state

# ===== Configuration =====
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
DEBUG_URL="${DEBUG_URL:-http://localhost:9222/json/version}"
CHECK_INTERVAL="${CHECK_INTERVAL:-3}"
BROWSER_PROCESS_NAME="${BROWSER_PROCESS_NAME:-Google Chrome}"
PROMPT_WINDOW_NAME="${PROMPT_WINDOW_NAME:-원격 디버깅을 허용하시겠습니까?}"
ALLOW_BUTTON_NAME="${ALLOW_BUTTON_NAME:-허용}"
PEEKABOO_BIN="${PEEKABOO_BIN:-peekaboo}"
NOTIFIED=false
LAST_STATE="unknown"

BUTTON_CANDIDATES=("허용" "확인" "열기" "승인")

send_telegram() {
  local message="$1"

  if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    return 0
  fi

  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" \
    --data-urlencode text="$message" \
    > /dev/null 2>&1 || true
}

click_allow_prompt() {
  if command -v "$PEEKABOO_BIN" >/dev/null 2>&1; then
    local button
    for button in "${BUTTON_CANDIDATES[@]}"; do
      if "$PEEKABOO_BIN" dialog click --button "$button" >/dev/null 2>&1; then
        return 0
      fi
    done
  fi

  osascript <<EOF >/dev/null 2>&1
try
  tell application "System Events"
    if exists process "$BROWSER_PROCESS_NAME" then
      tell process "$BROWSER_PROCESS_NAME"
        repeat with w in windows
          try
            if name of w contains "$PROMPT_WINDOW_NAME" then
              click button "$ALLOW_BUTTON_NAME" of w
              return
            end if
          end try

          try
            if exists sheet 1 of w then
              try
                click button "$ALLOW_BUTTON_NAME" of sheet 1 of w
                return
              end try
            end if
          end try
        end repeat
      end tell
    end if
  end tell
end try
EOF
}

check_debug_connection() {
  if curl -fsS "$DEBUG_URL" >/dev/null 2>&1; then
    echo up
  else
    echo down
  fi
}

while true; do
  click_allow_prompt

  CURRENT_STATE="$(check_debug_connection)"

  if [ "$CURRENT_STATE" != "$LAST_STATE" ]; then
    if [ "$CURRENT_STATE" = "up" ]; then
      send_telegram "✅ 크롬 원격 디버깅 다시 연결됨"
      NOTIFIED=false
    else
      if [ "$NOTIFIED" = false ]; then
        send_telegram "⚠️ 크롬 원격 디버깅 연결 끊김 또는 attach 필요"
        NOTIFIED=true
      fi
    fi
    LAST_STATE="$CURRENT_STATE"
  fi

  sleep "$CHECK_INTERVAL"
done
