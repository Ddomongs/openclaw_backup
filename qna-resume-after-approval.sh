#!/bin/bash
set -euo pipefail

PRECHECK_SCRIPT="${PRECHECK_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-mcp-preflight.sh}"
ATTACH_SCRIPT="${ATTACH_SCRIPT:-/Users/dh/.openclaw/workspace/chrome-mcp-attach-approved.sh}"
OPENCLAW_BIN="${OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
QNA_JOB_ID="${QNA_JOB_ID:-eeb3b982-9e91-46ba-82ff-2aef26fc3d85}"
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

precheck_code=0
precheck_output="$($PRECHECK_SCRIPT)" || precheck_code=$?
state="$(printf '%s\n' "$precheck_output" | awk -F= '/^STATE=/{print $2; exit}')"
reason="$(printf '%s\n' "$precheck_output" | awk -F= '/^REASON=/{print $2; exit}')"

case "$state" in
  ready)
    ;;
  chrome_running_mcp_detached)
    attach_code=0
    if [ "$DRY_RUN" = "true" ]; then
      attach_output="$($ATTACH_SCRIPT --dry-run 2>&1)" || attach_code=$?
    else
      attach_output="$($ATTACH_SCRIPT 2>&1)" || attach_code=$?
    fi
    printf '%s\n' "$attach_output"
    if [ "$attach_code" -ne 0 ]; then
      echo "RESUME_RESULT=attach_failed"
      exit "$attach_code"
    fi
    ;;
  chrome_off|chrome_running_profile_unknown|gateway_unavailable)
    printf '%s\n' "$precheck_output"
    echo "RESUME_RESULT=precheck_blocked"
    exit "$precheck_code"
    ;;
  *)
    printf '%s\n' "$precheck_output"
    echo "RESUME_RESULT=unknown_state"
    exit 1
    ;;
esac

if [ "$DRY_RUN" = "true" ]; then
  echo "RESUME_RESULT=dry_run"
  echo "DETAIL=Would enqueue cron job '$QNA_JOB_ID' now"
  exit 0
fi

run_code=0
run_output="$($OPENCLAW_BIN cron run "$QNA_JOB_ID" 2>&1)" || run_code=$?
printf '%s\n' "$run_output"

if [ "$run_code" -ne 0 ]; then
  echo "RESUME_RESULT=cron_run_failed"
  exit "$run_code"
fi

echo "RESUME_RESULT=ok"
