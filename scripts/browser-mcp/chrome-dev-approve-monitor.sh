#!/bin/bash
set -euo pipefail

WATCH_SECONDS="${WATCH_SECONDS:-30}"
POLL_INTERVAL="${POLL_INTERVAL:-1}"
CHROME_PROCESS_NAME="${CHROME_PROCESS_NAME:-Google Chrome}"
PROMPT_WINDOW_NAME="${PROMPT_WINDOW_NAME:-원격 디버깅을 허용하시겠습니까?}"
PEEKABOO_BIN="${PEEKABOO_BIN:-peekaboo}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APPROVER_SCRIPT="${APPROVER_SCRIPT:-$SCRIPT_DIR/chrome-dev-approve-once.sh}"
APPROVER_DURATION_SECONDS="${APPROVER_DURATION_SECONDS:-12}"
APPROVER_LOG="${APPROVER_LOG:-/tmp/chrome-dev-approve-once.log}"

approver_pid=""
end_time=$(( $(date +%s) + WATCH_SECONDS ))

cleanup() {
  if [ -n "$approver_pid" ] && kill -0 "$approver_pid" >/dev/null 2>&1; then
    kill "$approver_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

popup_detected() {
  local windows_output=""
  local dialog_output=""

  if command -v "$PEEKABOO_BIN" >/dev/null 2>&1; then
    windows_output="$($PEEKABOO_BIN list windows --app "$CHROME_PROCESS_NAME" --json 2>/dev/null || true)"
    if printf '%s' "$windows_output" | grep -Fq '"title" : "'"$PROMPT_WINDOW_NAME"'"'; then
      return 0
    fi

    dialog_output="$($PEEKABOO_BIN dialog list --json 2>/dev/null || true)"
    if printf '%s' "$dialog_output" | grep -Fq '"title" : "'"$PROMPT_WINDOW_NAME"'"'; then
      return 0
    fi
  fi

  osascript <<EOF >/dev/null 2>&1
try
  tell application "System Events"
    if exists process "$CHROME_PROCESS_NAME" then
      tell process "$CHROME_PROCESS_NAME"
        repeat with w in windows
          try
            if name of w contains "$PROMPT_WINDOW_NAME" then return
          end try
          try
            if exists sheet 1 of w then
              if exists group "$PROMPT_WINDOW_NAME" of sheet 1 of w then return
            end if
          end try
        end repeat
      end tell
    end if
  end tell
  error number -128
end try
EOF
}

start_approver_if_needed() {
  if [ -n "$approver_pid" ] && kill -0 "$approver_pid" >/dev/null 2>&1; then
    return 0
  fi

  DURATION_SECONDS="$APPROVER_DURATION_SECONDS" "$APPROVER_SCRIPT" >>"$APPROVER_LOG" 2>&1 &
  approver_pid=$!
}

while [ "$(date +%s)" -lt "$end_time" ]; do
  if popup_detected; then
    start_approver_if_needed
  fi
  sleep "$POLL_INTERVAL"
done
