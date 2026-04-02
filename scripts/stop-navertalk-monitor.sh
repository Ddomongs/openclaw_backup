#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
WORKSPACE_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
PID_FILE="$WORKSPACE_DIR/tmp/navertalk-monitor.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "pid file not found: $PID_FILE"
  exit 1
fi

PID=$(cat "$PID_FILE")
if kill -0 "$PID" >/dev/null 2>&1 && kill "$PID" >/dev/null 2>&1; then
  rm -f "$PID_FILE"
  echo "navertalk-monitor stopped: $PID"
else
  rm -f "$PID_FILE"
  echo "process not running, stale pid removed: $PID"
fi
