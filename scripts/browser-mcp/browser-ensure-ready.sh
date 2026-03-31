#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PRECHECK_SCRIPT="${PRECHECK_SCRIPT:-$SCRIPT_DIR/chrome-mcp-preflight.sh}"
ATTACH_SCRIPT="${ATTACH_SCRIPT:-$SCRIPT_DIR/chrome-mcp-attach-approved.sh}"
APPROVER_SCRIPT="${APPROVER_SCRIPT:-$SCRIPT_DIR/chrome-dev-approve-once.sh}"
APPROVER_MONITOR_SCRIPT="${APPROVER_MONITOR_SCRIPT:-$SCRIPT_DIR/chrome-dev-approve-monitor.sh}"
APPROVAL_WATCH_SECONDS="${APPROVAL_WATCH_SECONDS:-20}"
APPROVAL_MONITOR_LOG="${APPROVAL_MONITOR_LOG:-/tmp/browser-ensure-ready-approve-monitor.log}"
APPROVAL_ONCE_LOG="${APPROVAL_ONCE_LOG:-/tmp/browser-ensure-ready-approve-once.log}"
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

start_approval_helpers() {
  if [ "$DRY_RUN" = "true" ]; then
    return 0
  fi

  WATCH_SECONDS="$APPROVAL_WATCH_SECONDS" \
  APPROVER_DURATION_SECONDS="$APPROVAL_WATCH_SECONDS" \
  APPROVER_SCRIPT="$APPROVER_SCRIPT" \
  "$APPROVER_MONITOR_SCRIPT" >"$APPROVAL_MONITOR_LOG" 2>&1 &
  MONITOR_PID=$!

  DURATION_SECONDS="$APPROVAL_WATCH_SECONDS" \
  "$APPROVER_SCRIPT" >"$APPROVAL_ONCE_LOG" 2>&1 &
  APPROVER_PID=$!
}

start_approval_helpers

read_state() {
  local output="$1"
  printf '%s\n' "$output" | awk -F= '/^STATE=/{print $2; exit}'
}

read_reason() {
  local output="$1"
  printf '%s\n' "$output" | awk -F= '/^REASON=/{print $2; exit}'
}

precheck_code=0
precheck_output="$($PRECHECK_SCRIPT 2>&1)" || precheck_code=$?
state="$(read_state "$precheck_output")"
reason="$(read_reason "$precheck_output")"

case "$state" in
  ready)
    printf '%s\n' "$precheck_output"
    echo "ENSURE_RESULT=ready"
    exit 0
    ;;
  chrome_running_mcp_detached)
    printf '%s\n' "$precheck_output"
    attach_code=0
    if [ "$DRY_RUN" = "true" ]; then
      attach_output="$($ATTACH_SCRIPT --dry-run 2>&1)" || attach_code=$?
    else
      attach_output="$($ATTACH_SCRIPT 2>&1)" || attach_code=$?
    fi
    printf '%s\n' "$attach_output"
    if [ "$attach_code" -ne 0 ]; then
      echo "ENSURE_RESULT=attach_failed"
      exit "$attach_code"
    fi

    verify_code=0
    verify_output="$($PRECHECK_SCRIPT 2>&1)" || verify_code=$?
    printf '%s\n' "$verify_output"
    verify_state="$(read_state "$verify_output")"
    if [ "$verify_state" = "ready" ]; then
      echo "ENSURE_RESULT=ready"
      exit 0
    fi

    echo "ENSURE_RESULT=verify_failed"
    exit "${verify_code:-1}"
    ;;
  chrome_off|chrome_running_profile_unknown|gateway_unavailable)
    printf '%s\n' "$precheck_output"
    echo "ENSURE_RESULT=precheck_blocked"
    exit "$precheck_code"
    ;;
  *)
    printf '%s\n' "$precheck_output"
    if [ -n "$reason" ]; then
      echo "DETAIL=$reason"
    fi
    echo "ENSURE_RESULT=unknown_state"
    exit 1
    ;;
esac
