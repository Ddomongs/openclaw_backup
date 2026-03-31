#!/bin/bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
PROFILE="${PROFILE:-user}"
CHROME_PROCESS_NAME="${CHROME_PROCESS_NAME:-Google Chrome}"
APPROVER_SCRIPT="${APPROVER_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-dev-approve-once.sh}"
APPROVAL_WATCH_SECONDS="${APPROVAL_WATCH_SECONDS:-20}"
ATTACH_TIMEOUT_MS="${ATTACH_TIMEOUT_MS:-20000}"
DRY_RUN="false"

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
  echo "DETAIL=Would run approver script and trigger openclaw browser attach for profile '$PROFILE'"
  exit 0
fi

APPROVER_PID=""
cleanup() {
  if [ -n "$APPROVER_PID" ] && kill -0 "$APPROVER_PID" >/dev/null 2>&1; then
    kill "$APPROVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

DURATION_SECONDS="$APPROVAL_WATCH_SECONDS" "$APPROVER_SCRIPT" >/tmp/chrome-dev-approve-once.log 2>&1 &
APPROVER_PID=$!
sleep 1

STATUS_OUTPUT=""
STATUS_CODE=0
STATUS_OUTPUT="$($OPENCLAW_BIN browser --browser-profile "$PROFILE" status --timeout "$ATTACH_TIMEOUT_MS" 2>&1)" || STATUS_CODE=$?

if [ "$STATUS_CODE" -ne 0 ]; then
  TABS_CODE=0
  TABS_OUTPUT="$($OPENCLAW_BIN browser --browser-profile "$PROFILE" tabs --timeout "$ATTACH_TIMEOUT_MS" 2>&1)" || TABS_CODE=$?
  if [ "$TABS_CODE" -eq 0 ]; then
    echo "ATTACH_RESULT=ok"
    echo "DETAIL=Attach succeeded via tabs probe"
    printf 'OUTPUT<<EOF\n%s\nEOF\n' "$TABS_OUTPUT"
    exit 0
  fi

  echo "ATTACH_RESULT=failed"
  echo "DETAIL=Attach failed or timed out"
  printf 'STATUS_OUTPUT<<EOF\n%s\nEOF\n' "$STATUS_OUTPUT"
  printf 'TABS_OUTPUT<<EOF\n%s\nEOF\n' "$TABS_OUTPUT"
  echo "HINT=Check chrome://inspect/#remote-debugging, approve the attach prompt, and keep Chrome running"
  exit 1
fi

echo "ATTACH_RESULT=ok"
echo "DETAIL=Attach succeeded via status probe"
printf 'OUTPUT<<EOF\n%s\nEOF\n' "$STATUS_OUTPUT"
