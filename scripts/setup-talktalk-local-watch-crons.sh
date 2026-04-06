#!/bin/bash
set -euo pipefail

DEFAULT_CONTROL_CHANNEL_ID="$(python3 - <<'PY'
import json
from pathlib import Path
path = Path('/Users/dh/.openclaw/workspace/runtime-data/cs-channel-config.json')
data = json.loads(path.read_text()) if path.exists() else {}
discord = data.get('discord') or {}
print(discord.get('controlChannelId') or discord.get('csChannelId') or '1488798405860786176')
PY
)"
CONTROL_CHANNEL_ID="${1:-$DEFAULT_CONTROL_CHANNEL_ID}"

# 기존 CS 관련 cron 비활성화
for job_id in \
  25b7d4ee-48d7-4af4-922b-e4c57d31b3d7 \
  0c8cdcee-50d1-4d38-8fac-4ab2ed8c70fc \
  404a7cad-2278-4229-92b6-b02aa035ab14 \
  8f5ab886-949c-4c35-a4f5-1b18a82909cc
 do
  openclaw cron disable "$job_id" >/dev/null 2>&1 || true
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
