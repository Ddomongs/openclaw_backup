#!/bin/bash
set -euo pipefail

AUTO_LOOP_CRON_ID="${1:-}"
DELIVERY_CRON_ID="${2:-}"

if [[ -z "${AUTO_LOOP_CRON_ID}" || -z "${DELIVERY_CRON_ID}" ]]; then
  echo "usage: $0 <auto_loop_cron_id> <delivery_cron_id>" >&2
  exit 1
fi

openclaw cron edit "${AUTO_LOOP_CRON_ID}" --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/navertalk-auto-worker-message.txt)"
openclaw cron edit "${DELIVERY_CRON_ID}" --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/navertalk-delivery-worker-message.txt)"
openclaw cron list --json
