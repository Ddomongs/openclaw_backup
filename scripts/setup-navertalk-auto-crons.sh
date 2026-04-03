#!/bin/bash
set -euo pipefail

CONTROL_CHANNEL_ID="${1:-1488378914064564256}"

openclaw cron add \
  --name "톡톡 approval auto loop" \
  --description "웹훅 카드 스캔 → approval 생성 → 승인 대기 outbox 발송" \
  --cron "*/10 * * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --channel discord \
  --to "channel:${CONTROL_CHANNEL_ID}" \
  --best-effort-deliver \
  --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/navertalk-auto-worker-message.txt)"

openclaw cron add \
  --name "톡톡 delivery queue worker" \
  --description "승인된 톡톡 delivery queue 소비 및 완료 보고" \
  --cron "*/30 * * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --channel discord \
  --to "channel:${CONTROL_CHANNEL_ID}" \
  --best-effort-deliver \
  --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/navertalk-delivery-worker-message.txt)"

openclaw cron list --json
