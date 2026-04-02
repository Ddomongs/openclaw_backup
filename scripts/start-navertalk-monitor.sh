#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
WORKSPACE_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)

cd "$WORKSPACE_DIR"

mkdir -p tmp
if [[ -f tmp/navertalk-monitor.pid ]]; then
  PID=$(cat tmp/navertalk-monitor.pid)
  if kill -0 "$PID" >/dev/null 2>&1; then
    echo "navertalk-monitor already running: $PID"
    exit 0
  else
    rm -f tmp/navertalk-monitor.pid
  fi
fi

nohup node navertalk-monitor/server.mjs > tmp/navertalk-monitor.log 2>&1 &
echo $! > tmp/navertalk-monitor.pid

echo "navertalk-monitor started"
echo "pid=$(cat tmp/navertalk-monitor.pid)"
echo "log=$WORKSPACE_DIR/tmp/navertalk-monitor.log"
