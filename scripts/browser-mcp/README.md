# browser-mcp scripts

Chrome MCP attach / 승인 팝업 자동 처리 관련 스크립트 모음

## 파일
- `browser-ensure-ready.sh` : 상태 확인 + 필요 시 attach 복구 + 허용 팝업 자동 처리
- `chrome-mcp-preflight.sh` : 현재 Chrome/MCP 상태 판별
- `chrome-mcp-attach-approved.sh` : attach 재시도 + 승인 처리
- `chrome-dev-approve-monitor.sh` : 허용 팝업 감지
- `chrome-dev-approve-once.sh` : 허용 버튼 클릭 시도
- `qna-resume-after-approval.sh` : attach 준비 후 Q&A cron 재개

## 권장 사용
- 준비 보장: `./scripts/browser-mcp/browser-ensure-ready.sh`
- 상태 판별만: `./scripts/browser-mcp/chrome-mcp-preflight.sh`

## 운영 원칙
- browser 도구를 쓰는 작업은 예외 없이 먼저 `./scripts/browser-mcp/browser-ensure-ready.sh`를 실행한다.
- 이 스크립트는 시작 즉시 허용 팝업 감시/클릭 루틴을 먼저 올린 뒤 상태 확인과 attach 복구를 진행한다.
- `ready` 확인 후에만 실제 browser 작업으로 들어간다.
