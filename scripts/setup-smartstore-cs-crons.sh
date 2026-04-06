#!/bin/bash
set -euo pipefail

CONFIG_PATH="/Users/dh/.openclaw/workspace/runtime-data/cs-channel-config.json"
DEFAULT_CHANNEL_ID="$(python3 - <<'PY'
import json
from pathlib import Path
path = Path('/Users/dh/.openclaw/workspace/runtime-data/cs-channel-config.json')
data = json.loads(path.read_text()) if path.exists() else {}
print(((data.get('discord') or {}).get('csChannelId')) or '1488798405860786176')
PY
)"
CHANNEL_ID="${1:-$DEFAULT_CHANNEL_ID}"
OLD_JOB_ID="eeb3b982-9e91-46ba-82ff-2aef26fc3d85"

cat >/tmp/cs_store_ddomong.txt <<'EOF'
스토어별 CS 통합 점검 시간입니다.

대상 스토어: 또몽이네 스토어

반드시 아래 순서대로 진행하세요.
1. 먼저 `./scripts/browser-mcp/browser-ensure-ready-cs.sh`를 실행해 브라우저 준비를 확인합니다.
2. 스마트스토어 대시보드 또는 문의 화면으로 진입합니다.
3. 로그인되지 않은 상태면 로그인 버튼을 클릭하지 말고, 로그인 필요 상태로만 짧게 보고하고 중단합니다.
4. 멀티스토어 선택이 가능하면 `스토어 이동`을 눌러 `또몽이네 스토어`를 선택합니다.
5. 스토어 대시보드의 미처리 문의 영역에서 아래 3개 항목의 건수를 확인합니다.
   - 톡톡 문의
   - 주문 고객 문의
   - 상품 Q&A
6. 세 항목이 모두 0건이면 현재 Discord 채널에 아래 형식으로만 보고하고 종료합니다.
```text
또몽이네 스토어 CS 점검 완료: 처리할 문의 없음
```
7. 처리할 문의가 1건 이상 있으면 현재 Discord 채널에 아래 형식으로 보고합니다.

[또몽이네 스토어 CS 처리 필요]
- 톡톡 문의: N건
- 주문 고객 문의: N건
- 상품 Q&A: N건
- 메모: 대시보드 기준 미처리 문의가 있어 세부 대응이 필요합니다.

8. 이번 작업에서는 건수 확인과 보고까지만 수행하고, 자동 답변 등록은 하지 않습니다.
EOF

cat >/tmp/cs_store_lumo.txt <<'EOF'
스토어별 CS 통합 점검 시간입니다.

대상 스토어: 루모 글로벌

반드시 아래 순서대로 진행하세요.
1. 먼저 `./scripts/browser-mcp/browser-ensure-ready-cs.sh`를 실행해 브라우저 준비를 확인합니다.
2. 스마트스토어 대시보드 또는 문의 화면으로 진입합니다.
3. 로그인되지 않은 상태면 로그인 버튼을 클릭하지 말고, 로그인 필요 상태로만 짧게 보고하고 중단합니다.
4. 멀티스토어 선택이 가능하면 `스토어 이동`을 눌러 `루모 글로벌`을 선택합니다.
5. 스토어 대시보드의 미처리 문의 영역에서 아래 3개 항목의 건수를 확인합니다.
   - 톡톡 문의
   - 주문 고객 문의
   - 상품 Q&A
6. 세 항목이 모두 0건이면 현재 Discord 채널에 아래 형식으로만 보고하고 종료합니다.
```text
루모 글로벌 CS 점검 완료: 처리할 문의 없음
```
7. 처리할 문의가 1건 이상 있으면 현재 Discord 채널에 아래 형식으로 보고합니다.

[루모 글로벌 CS 처리 필요]
- 톡톡 문의: N건
- 주문 고객 문의: N건
- 상품 Q&A: N건
- 메모: 대시보드 기준 미처리 문의가 있어 세부 대응이 필요합니다.

8. 이번 작업에서는 건수 확인과 보고까지만 수행하고, 자동 답변 등록은 하지 않습니다.
EOF

cat >/tmp/cs_store_jinas.txt <<'EOF'
스토어별 CS 통합 점검 시간입니다.

대상 스토어: 지나스 마켓

반드시 아래 순서대로 진행하세요.
1. 먼저 `./scripts/browser-mcp/browser-ensure-ready-cs.sh`를 실행해 브라우저 준비를 확인합니다.
2. 스마트스토어 대시보드 또는 문의 화면으로 진입합니다.
3. 로그인되지 않은 상태면 로그인 버튼을 클릭하지 말고, 로그인 필요 상태로만 짧게 보고하고 중단합니다.
4. 멀티스토어 선택이 가능하면 `스토어 이동`을 눌러 `지나스 마켓`을 선택합니다.
5. 스토어 대시보드의 미처리 문의 영역에서 아래 3개 항목의 건수를 확인합니다.
   - 톡톡 문의
   - 주문 고객 문의
   - 상품 Q&A
6. 세 항목이 모두 0건이면 현재 Discord 채널에 아래 형식으로만 보고하고 종료합니다.
```text
지나스 마켓 CS 점검 완료: 처리할 문의 없음
```
7. 처리할 문의가 1건 이상 있으면 현재 Discord 채널에 아래 형식으로 보고합니다.

[지나스 마켓 CS 처리 필요]
- 톡톡 문의: N건
- 주문 고객 문의: N건
- 상품 Q&A: N건
- 메모: 대시보드 기준 미처리 문의가 있어 세부 대응이 필요합니다.

8. 이번 작업에서는 건수 확인과 보고까지만 수행하고, 자동 답변 등록은 하지 않습니다.
EOF

openclaw cron edit "$OLD_JOB_ID" --disable
openclaw cron add --name "또몽이네 스토어 CS 점검" --description "또몽이네 스토어 미처리 문의(톡톡/주문문의/상품 Q&A) 1시간 간격 점검" --cron "0 9-22 * * *" --tz "Asia/Seoul" --session isolated --announce --channel discord --to "channel:${CHANNEL_ID}" --best-effort-deliver --message "$(cat /tmp/cs_store_ddomong.txt)"
openclaw cron add --name "루모 글로벌 CS 점검" --description "루모 글로벌 미처리 문의(톡톡/주문문의/상품 Q&A) 3시간 간격 점검" --cron "0 9,12,15,18,21 * * *" --tz "Asia/Seoul" --session isolated --announce --channel discord --to "channel:${CHANNEL_ID}" --best-effort-deliver --message "$(cat /tmp/cs_store_lumo.txt)"
openclaw cron add --name "지나스 마켓 CS 점검" --description "지나스 마켓 미처리 문의(톡톡/주문문의/상품 Q&A) 하루 1회 점검" --cron "0 10 * * *" --tz "Asia/Seoul" --session isolated --announce --channel discord --to "channel:${CHANNEL_ID}" --best-effort-deliver --message "$(cat /tmp/cs_store_jinas.txt)"
openclaw cron list --json
