#!/bin/bash
set -euo pipefail

CONTROL_CHANNEL_ID="${1:-1488378914064564256}"

# 기존 CS 관련 cron 비활성화
for job_id in \
  25b7d4ee-48d7-4af4-922b-e4c57d31b3d7 \
  c5e5ca0e-b2ee-4dcc-93bc-f9f94a1d8ad8 \
  0c8cdcee-50d1-4d38-8fac-4ab2ed8c70fc \
  404a7cad-2278-4229-92b6-b02aa035ab14 \
  8f5ab886-949c-4c35-a4f5-1b18a82909cc
 do
  openclaw cron edit "$job_id" --disable >/dev/null
 done

openclaw cron add \
  --name "톡톡 로컬 watcher (주간)" \
  --description "로컬 톡톡 목록 변화 감지 - 주간 5분 간격" \
  --cron "*/5 9-23 * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --channel discord \
  --to "channel:${CONTROL_CHANNEL_ID}" \
  --best-effort-deliver \
  --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/talktalk-local-watcher-day-message.txt)"

openclaw cron add \
  --name "톡톡 로컬 watcher (야간)" \
  --description "로컬 톡톡 목록 변화 감지 - 야간 1시간 간격" \
  --cron "0 0-8 * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --channel discord \
  --to "channel:${CONTROL_CHANNEL_ID}" \
  --best-effort-deliver \
  --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/talktalk-local-watcher-night-message.txt)"

openclaw cron add \
  --name "톡톡 delivery fallback worker" \
  --description "승인 직후 전송 실패를 보완하는 fallback delivery queue worker" \
  --cron "*/30 * * * *" \
  --tz "Asia/Seoul" \
  --session isolated \
  --channel discord \
  --to "channel:${CONTROL_CHANNEL_ID}" \
  --best-effort-deliver \
  --message "$(cat /Users/dh/.openclaw/workspace/scripts/cron-messages/talktalk-delivery-fallback-message.txt)"

openclaw cron list --json
