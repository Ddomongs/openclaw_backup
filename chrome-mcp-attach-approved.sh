#!/bin/bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
PROFILE="${PROFILE:-user}"
CHROME_PROCESS_NAME="${CHROME_PROCESS_NAME:-Google Chrome}"
APPROVER_SCRIPT="${APPROVER_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-dev-approve-once.sh}"
APPROVER_MONITOR_SCRIPT="${APPROVER_MONITOR_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-dev-approve-monitor.sh}"
APPROVAL_WATCH_SECONDS="${APPROVAL_WATCH_SECONDS:-20}"
ATTACH_TIMEOUT_MS="${ATTACH_TIMEOUT_MS:-20000}"
DRY_RUN="false"
PROBE_INTERVAL_SECONDS="${PROBE_INTERVAL_SECONDS:-2}"
APPROVAL_MONITOR_LOG="${APPROVAL_MONITOR_LOG:-/tmp/chrome-dev-approve-monitor.log}"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if ! pgrep -x "$CHROME_PROCESS_NAME" >/dev/null 2>&1; then
  echo "ATTACH_RESULT=chrome_off"
  echo "DETAIL=Google Chrome is not running"
  exit 20
fi

if [ "$DRY_RUN" = "true" ]; then
  echo "ATTACH_RESULT=dry_run"
  echo "DETAIL=Would run approval monitor + approver script and trigger openclaw browser attach for profile '$PROFILE'"
  exit 0
fi

probe_attach() {
  local status_code=0
  local tabs_code=0
  local status_output=""
  local tabs_output=""

  status_output="$($OPENCLAW_BIN browser --timeout "$ATTACH_TIMEOUT_MS" --browser-profile "$PROFILE" status 2>&1)" || status_code=$?
  if [ "$status_code" -eq 0 ] && printf '%s' "$status_output" | grep -Eqi 'running[:= ]+true|transport[:= ].*chrome-mcp'; then
    echo "ATTACH_RESULT=ok"
    echo "DETAIL=Attach succeeded via status probe"
    printf 'OUTPUT<<EOF\n%s\nEOF\n' "$status_output"
    return 0
  fi

  tabs_output="$($OPENCLAW_BIN browser --timeout "$ATTACH_TIMEOUT_MS" --browser-profile "$PROFILE" tabs 2>&1)" || tabs_code=$?
  if [ "$tabs_code" -eq 0 ]; then
    echo "ATTACH_RESULT=ok"
    echo "DETAIL=Attach succeeded via tabs probe"
    printf 'OUTPUT<<EOF\n%s\nEOF\n' "$tabs_output"
    return 0
  fi

  printf 'STATUS_OUTPUT<<EOF\n%s\nEOF\n' "$status_output"
  printf 'TABS_OUTPUT<<EOF\n%s\nEOF\n' "$tabs_output"
  return 1
}

APPROVER_PID=""
MONITOR_PID=""
cleanup() {
  if [ -n "$APPROVER_PID" ] && kill -0 "$APPROVER_PID" >/dev/null 2>&1; then
    kill "$APPROVER_PID" >/dev/null 2>&1 || true
  fi
  if [ -n "$MONITOR_PID" ] && kill -0 "$MONITOR_PID" >/dev/null 2>&1; then
    kill "$MONITOR_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

WATCH_SECONDS="$APPROVAL_WATCH_SECONDS" APPROVER_DURATION_SECONDS="$APPROVAL_WATCH_SECONDS" APPROVER_SCRIPT="$APPROVER_SCRIPT" "$APPROVER_MONITOR_SCRIPT" >"$APPROVAL_MONITOR_LOG" 2>&1 &
MONITOR_PID=$!

DURATION_SECONDS="$APPROVAL_WATCH_SECONDS" "$APPROVER_SCRIPT" >/tmp/chrome-dev-approve-once.log 2>&1 &
APPROVER_PID=$!
sleep 1

end_time=$(( $(date +%s) + APPROVAL_WATCH_SECONDS ))
while [ "$(date +%s)" -lt "$end_time" ]; do
  if probe_attach; then
    exit 0
  fi
  sleep "$PROBE_INTERVAL_SECONDS"
done

echo "ATTACH_RESULT=failed"
echo "DETAIL=Attach failed or timed out after approval watch window"
echo "HINT=Check chrome://inspect/#remote-debugging, keep Chrome running, and ensure the consent prompt was accepted"
exit 1
