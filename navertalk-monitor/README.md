# navertalk-monitor

네이버 톡톡 챗봇 API 웹훅으로 들어오는 상담 이벤트를 로컬에 저장하고, 고객별 카드 형태로 조회하는 최소 운영용 수집기입니다.

## v1 범위
- 네이버 톡톡 Webhook 수신
- raw 이벤트 NDJSON 저장
- 고객(user) 기준 카드형 대화 이력 저장
- 로컬 카드 뷰어(`/cards`)
- JSON API (`/api/cards`, `/api/cards/:userId`)

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

## 저장 구조
기본 저장 위치: `runtime-data/navertalk-monitor`

- `cards/*.json`
  - 고객별 카드형 대화 이력
- `events/YYYY-MM-DD.ndjson`
  - 수신 raw 이벤트 로그
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
- Discord 자동 알림 연동은 아직 없음
- 과거 톡톡 전체 히스토리 역수집 기능은 없음

## 다음 추천 단계
1. Discord 알림 연결
2. 미확인/처리완료 상태 추가
3. 카드 검색 조건 확장
4. Nginx/Caddy 뒤 배포
5. 필요 시 SQLite 전환
