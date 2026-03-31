#!/bin/bash
set -euo pipefail

# On-demand helper:
# Temporarily watches for Chrome's remote debugging approval dialog
# and clicks "허용" for a short window, then exits.

DURATION_SECONDS="${DURATION_SECONDS:-20}"
SLEEP_INTERVAL="${SLEEP_INTERVAL:-1}"
BROWSER_PROCESS_NAME="${BROWSER_PROCESS_NAME:-Google Chrome}"
PROMPT_WINDOW_NAME="${PROMPT_WINDOW_NAME:-원격 디버깅을 허용하시겠습니까?}"
ALLOW_BUTTON_NAME="${ALLOW_BUTTON_NAME:-허용}"
PEEKABOO_BIN="${PEEKABOO_BIN:-peekaboo}"

BUTTON_CANDIDATES=("허용" "확인" "열기" "승인")

end_time=$(( $(date +%s) + DURATION_SECONDS ))

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

while [ "$(date +%s)" -lt "$end_time" ]; do
  click_allow_prompt || true
  sleep "$SLEEP_INTERVAL"
done
