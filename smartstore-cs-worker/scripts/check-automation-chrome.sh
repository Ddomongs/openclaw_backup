#!/bin/bash
set -euo pipefail

CDP_PORT="${CSBOT_CDP_PORT:-9223}"

if ! lsof -nP -iTCP:"$CDP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "NOT_RUNNING"
  exit 1
fi

echo "RUNNING"
curl -sS "http://127.0.0.1:${CDP_PORT}/json/version" || true
