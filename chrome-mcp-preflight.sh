#!/bin/bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
PROFILE="${PROFILE:-user}"
CHROME_PROCESS_NAME="${CHROME_PROCESS_NAME:-Google Chrome}"
BROWSER_TIMEOUT_MS="${BROWSER_TIMEOUT_MS:-5000}"

print_kv() {
  local state="$1"
  local reason="$2"
  printf 'STATE=%s\n' "$state"
  printf 'REASON=%s\n' "$reason"
}

if ! pgrep -x "$CHROME_PROCESS_NAME" >/dev/null 2>&1; then
  print_kv "chrome_off" "Google Chrome is not running"
  exit 20
fi

profiles_output="$($OPENCLAW_BIN browser --timeout "$BROWSER_TIMEOUT_MS" profiles 2>&1 || true)"

if printf '%s' "$profiles_output" | grep -qi 'gateway timeout'; then
  print_kv "gateway_unavailable" "OpenClaw browser gateway timed out while checking profiles"
  exit 40
fi

user_line="$(printf '%s\n' "$profiles_output" | grep -E "^${PROFILE}:" | head -n 1 || true)"

if [ -z "$user_line" ]; then
  print_kv "chrome_running_profile_unknown" "Browser profile '$PROFILE' was not found in openclaw browser profiles"
  exit 30
fi

if printf '%s' "$user_line" | grep -q ': running'; then
  print_kv "ready" "Chrome is running and MCP profile '$PROFILE' is attached"
  exit 0
fi

print_kv "chrome_running_mcp_detached" "Chrome is running but MCP profile '$PROFILE' is not attached"
exit 10
