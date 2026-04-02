# navertalk-monitor

네이버 톡톡 챗봇 API 웹훅으로 들어오는 상담 이벤트를 로컬에 저장하고, 고객별 카드 형태로 조회하는 최소 운영용 수집기입니다.

## v1 범위
- 네이버 톡톡 Webhook 수신
- raw 이벤트 NDJSON 저장
- 고객(user) 기준 카드형 대화 이력 저장
- 로컬 카드 뷰어(`/cards`)
- JSON API (`/api/cards`, `/api/cards/:userId`)
- Discord 승인 대기 메시지 포맷 생성 API (`/api/approvals`)

## 왜 이렇게 만들었나
- 톡톡은 조회형 API보다 웹훅 기반 실시간 수신 구조에 가깝습니다.
- 기존 채팅방 UI에 의존하지 않고, 받은 이벤트를 별도 로컬 저장소에 카드형으로 쌓아두면 나중에 검색/조회가 쉬워집니다.
- 고객 데이터가 들어갈 수 있으므로 GitHub보다는 로컬 저장소를 기본으로 둡니다.

## 실행 방법
```bash
node navertalk-monitor/server.mjs
```

기본 실행 주소:
- 서버: `http://127.0.0.1:3187`
- 헬스체크: `http://127.0.0.1:3187/health`
- 카드 뷰어: `http://127.0.0.1:3187/cards`
- 웹훅: `http://127.0.0.1:3187/webhook/navertalk`

## 주요 환경변수
- `NAVERTALK_HOST` 기본값: `127.0.0.1`
- `NAVERTALK_PORT` 기본값: `3187`
- `NAVERTALK_WEBHOOK_PATH` 기본값: `/webhook/navertalk`
- `NAVERTALK_DATA_DIR` 기본값: `runtime-data/navertalk-monitor`
- `NAVERTALK_WEBHOOK_TOKEN` 선택: 웹훅 토큰
- `NAVERTALK_VIEWER_TOKEN` 선택: 카드 뷰어/API 토큰
- `NAVERTALK_MAX_BODY_BYTES` 기본값: `1048576`

## 공개 서버에 붙일 때
네이버 톡톡 Webhook 등록용으로 외부 공개 서버에서 돌릴 때는 보통 이렇게 권장합니다.

- `NAVERTALK_HOST=0.0.0.0`
- `NAVERTALK_WEBHOOK_TOKEN` 설정
- 필요 시 `NAVERTALK_VIEWER_TOKEN` 설정
- HTTPS 프록시(Nginx/Caddy/Cloudflare Tunnel 등) 뒤에서 운영

예시:
```bash
NAVERTALK_HOST=0.0.0.0 \
NAVERTALK_PORT=3187 \
NAVERTALK_WEBHOOK_TOKEN=change-me \
NAVERTALK_VIEWER_TOKEN=change-me-too \
node navertalk-monitor/server.mjs
```

이 경우 네이버 톡톡 파트너센터에는 다음처럼 등록할 수 있습니다.
```text
https://your-domain.example/webhook/navertalk?token=change-me
```

## Chemicloud 배포 자료
`webhook.tipoasis.com` 기준 Chemicloud/cPanel 배포 문서는 아래 파일을 참고합니다.

- `navertalk-monitor/DEPLOY_CHEMICLOUD.md`
- `navertalk-monitor/.env.chemicloud.example`

압축 파일 생성:
```bash
./scripts/package-navertalk-monitor.sh
```

## 저장 구조
기본 저장 위치: `runtime-data/navertalk-monitor`

- `cards/*.json`
  - 고객별 카드형 대화 이력
- `events/YYYY-MM-DD.ndjson`
  - 수신 raw 이벤트 로그
- `approvals/*.json`
  - Discord 승인 대기 요청 저장본
- `state.json`
  - 마지막 갱신 상태

## 카드 데이터 예시
- `userId`
- `partnerId`
- `firstSeenAt`, `lastSeenAt`
- `lastEvent`
- `lastMessageText`
- `messageCount`
- `incomingCount`, `outgoingCount`, `systemCount`
- `unreadIncomingCount`
- `messages[]`

## API 예시
### 카드 목록
```bash
curl http://127.0.0.1:3187/api/cards
```

### 특정 고객 카드 조회
```bash
curl "http://127.0.0.1:3187/api/cards/al-2eGuGr5WQOnco1_V-FQ"
```

### Discord 승인 대기 생성
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "NkJGzB8YzJVorSAMaq-TJg",
    "channel": "talktalk",
    "inquiryType": "배송문의",
    "customerName": "장형석",
    "marketName": "스마트스토어",
    "orderNo": "2026033026786761",
    "productOrderNo": "2026033073960541",
    "trackingNo": "303593965841",
    "trackingStatus": "통관대기",
    "customsEta": "04월 06일 (월)",
    "deliveryEta": "04월 07일 (화)",
    "draft": "안녕하세요, 고객님 😊\n..."
  }' \
  http://127.0.0.1:3187/api/approvals
```

응답에는 아래가 포함됩니다.
- `approval`: 저장된 승인 요청 객체
- `discordMessage`: Discord 보고용 완성 메시지 문자열

### Discord 승인 대기 목록
```bash
curl "http://127.0.0.1:3187/api/approvals?status=pending"
```

### 특정 승인 대기 조회
```bash
curl "http://127.0.0.1:3187/api/approvals/apr_xxxxx"
```

### Discord 버튼 메시지 payload 조회
```bash
curl "http://127.0.0.1:3187/api/approvals/apr_xxxxx/discord-payload"
```

응답에는 아래가 포함됩니다.
- `content`: Discord 본문 문자열
- `components`: 버튼 UI 전송용 구조
  - `승인`
  - `보류`
  - `수정요청`

### 승인 상태 변경 (버튼/액션 처리용)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"action":"approve","actor":"kim"}' \
  http://127.0.0.1:3187/api/approvals/apr_xxxxx/action
```

지원 action:
- `approve`
- `hold`
- `revise`

승인 객체 응답에는 아래도 포함됩니다.
- `discordButtons`: Discord 버튼 UI 연결용 메타데이터
  - `approval:apr_xxxxx:approve`
  - `approval:apr_xxxxx:hold`
  - `approval:apr_xxxxx:revise`

### 웹훅 테스트
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "event": "send",
    "user": "test-user-001",
    "textContent": { "text": "안녕하세요" },
    "options": { "inflow": "list" }
  }' \
  http://127.0.0.1:3187/webhook/navertalk
```

토큰을 사용하는 경우:
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"event":"send","user":"test-user-001","textContent":{"text":"안녕하세요"}}' \
  "http://127.0.0.1:3187/webhook/navertalk?token=change-me"
```

## 현재 제한사항
- 네이버 서명 검증 로직은 아직 없음 (README 기준 명시된 범위 우선)
- 미확인/처리완료 상태 변경 UI는 아직 없음
- Discord 자동 전송 자체는 아직 없음 (현재는 Discord용 메시지 문자열 생성/저장 단계)
- 과거 톡톡 전체 히스토리 역수집 기능은 없음

## 다음 추천 단계
1. Discord 버튼 메시지 실제 전송 연결
2. 버튼 클릭 → `/api/approvals/:id/action` 연결
3. 로컬 브라우저 자동화 반영 큐 연결
4. 카드 검색 조건 확장
5. 필요 시 SQLite 전환
