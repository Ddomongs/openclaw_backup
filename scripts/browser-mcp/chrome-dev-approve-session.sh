#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MONITOR_SCRIPT="${MONITOR_SCRIPT:-$SCRIPT_DIR/chrome-dev-approve-monitor.sh}"
APPROVER_SCRIPT="${APPROVER_SCRIPT:-$SCRIPT_DIR/chrome-dev-approve-once.sh}"
PIDFILE="${PIDFILE:-/tmp/browser-mcp-approve-session.pid}"
LOGFILE="${LOGFILE:-/tmp/browser-mcp-approve-session.log}"
SESSION_DURATION_SECONDS="${SESSION_DURATION_SECONDS:-1800}"
MONITOR_WATCH_SECONDS="${MONITOR_WATCH_SECONDS:-15}"
APPROVER_DURATION_SECONDS="${APPROVER_DURATION_SECONDS:-12}"
LOOP_SLEEP_SECONDS="${LOOP_SLEEP_SECONDS:-1}"

command_name="${1:-start}"

is_running() {
  if [ ! -f "$PIDFILE" ]; then
    return 1
  fi

  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    return 1
  fi

  if kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  rm -f "$PIDFILE"
  return 1
}

run_loop() {
  echo $$ >"$PIDFILE"
  trap 'rm -f "$PIDFILE"' EXIT

  local end_time
  end_time=$(( $(date +%s) + SESSION_DURATION_SECONDS ))

  while [ "$(date +%s)" -lt "$end_time" ]; do
    WATCH_SECONDS="$MONITOR_WATCH_SECONDS" \
    APPROVER_DURATION_SECONDS="$APPROVER_DURATION_SECONDS" \
    APPROVER_SCRIPT="$APPROVER_SCRIPT" \
    "$MONITOR_SCRIPT" >>"$LOGFILE" 2>&1 || true
    sleep "$LOOP_SLEEP_SECONDS"
  done
}

case "$command_name" in
  start)
    if is_running; then
      echo "SESSION_RESULT=already_running"
      echo "PID=$(cat "$PIDFILE")"
      exit 0
    fi

    nohup "$0" run >>"$LOGFILE" 2>&1 &
    sleep 1

    if is_running; then
      echo "SESSION_RESULT=started"
      echo "PID=$(cat "$PIDFILE")"
      echo "LOGFILE=$LOGFILE"
      exit 0
    fi

    echo "SESSION_RESULT=failed"
    exit 1
    ;;
  stop)
    if ! is_running; then
      echo "SESSION_RESULT=not_running"
      exit 0
    fi

    kill "$(cat "$PIDFILE")" >/dev/null 2>&1 || true
    sleep 1
    rm -f "$PIDFILE"
    echo "SESSION_RESULT=stopped"
    ;;
  status)
    if is_running; then
      echo "SESSION_RESULT=running"
      echo "PID=$(cat "$PIDFILE")"
      echo "LOGFILE=$LOGFILE"
    else
      echo "SESSION_RESULT=not_running"
    fi
    ;;
  run)
    run_loop
    ;;
  *)
    echo "Unknown command: $command_name" >&2
    exit 2
    ;;
esac
