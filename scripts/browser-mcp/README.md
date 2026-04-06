# browser-mcp scripts

Chrome MCP attach / 승인 팝업 자동 처리 관련 스크립트 모음

## 파일
- `browser-ensure-ready.sh` : 일반 Chrome(user 프로필) 상태 확인 + 필요 시 attach 복구 + 허용 팝업 자동 처리
- `browser-ensure-ready-cs.sh` : CS/톡톡 자동화 전용 Chrome(9223) 준비 보장
- `chrome-mcp-preflight.sh` : 현재 Chrome/MCP 상태 판별
- `chrome-mcp-attach-approved.sh` : attach 재시도 + 승인 처리
- `chrome-dev-approve-monitor.sh` : 허용 팝업 감지
- `chrome-dev-approve-once.sh` : 허용 버튼 클릭 시도
- `chrome-dev-approve-session.sh` : 브라우저 작업 중 백그라운드 허용 팝업 감시 세션 시작/중지/상태 확인
- `qna-resume-after-approval.sh` : attach 준비 후 Q&A cron 재개

## 권장 사용
- 일반 browser 준비 보장: `./scripts/browser-mcp/browser-ensure-ready.sh`
- CS/톡톡 준비 보장: `./scripts/browser-mcp/browser-ensure-ready-cs.sh`
- 상태 판별만: `./scripts/browser-mcp/chrome-mcp-preflight.sh`

## 라우팅 규칙
- `sell.smartstore.naver.com`, `talk.sell.smartstore.naver.com`, `partner.talk.naver.com`, `스마트스토어`, `톡톡`, `상품 Q&A`, `주문 고객 문의`, `주문문의` 관련 작업은 모두 CS 경로다.
- CS 경로는 예외 없이 `browser-ensure-ready-cs.sh` + 자동화 Chrome(9223)만 사용한다.
- CS 경로에서는 `browser-ensure-ready.sh`, 일반 Chrome(user 프로필), 9222 attach/재시작 복구를 사용하지 않는다.
- 일반 browser 작업에서만 `browser-ensure-ready.sh`를 사용한다.

## 운영 원칙
- 일반 browser 작업은 먼저 `./scripts/browser-mcp/browser-ensure-ready.sh`를 실행한다.
- CS/톡톡/스마트스토어 문의 작업은 먼저 `./scripts/browser-mcp/browser-ensure-ready-cs.sh`를 실행한다.
- `browser-ensure-ready.sh`는 시작 즉시 백그라운드 허용 팝업 감시 세션과 단기 허용 팝업 감시/클릭 루틴을 먼저 올린 뒤 일반 Chrome attach 복구를 진행한다.
- `browser-ensure-ready.sh`의 attach 1차 시도가 실패하면 기본값으로 Chrome을 1회 재시작한 뒤 precheck + attach를 한 번 더 재시도한다.
- 재시작 복구는 `AUTO_RESTART_CHROME_ON_ATTACH_FAILURE=true`, 재시도 횟수는 `MAX_ATTACH_RECOVERY_RESTARTS=1`로 제어한다.
- 두 스크립트 모두 `ready` 확인 후에만 실제 browser 작업으로 들어간다.
- CS 작업 중 9222 일반 Chrome이 열리면 잘못된 경로로 보고, 즉시 9223 전용 흐름으로 되돌린다.

## 백그라운드 감시 세션
- 시작: `./scripts/browser-mcp/chrome-dev-approve-session.sh start`
- 상태: `./scripts/browser-mcp/chrome-dev-approve-session.sh status`
- 중지: `./scripts/browser-mcp/chrome-dev-approve-session.sh stop`
- 기본 세션 시간: 1800초(30분)
