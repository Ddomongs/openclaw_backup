#!/bin/bash
set -euo pipefail

PRECHECK_SCRIPT="${PRECHECK_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-mcp-preflight.sh}"
ATTACH_SCRIPT="${ATTACH_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-mcp-attach-approved.sh}"
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
