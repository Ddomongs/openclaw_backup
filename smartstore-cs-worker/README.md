# Smartstore CS Worker

대표님 요구사항 기준 최소 실행 초안입니다.

## 목표
- 같은 macOS 계정에서 실행
- 실제 Chrome 창/탭을 유지한 채 백그라운드에 가깝게 동작
- 퀵스타 확장 설치 없이 퀵스타 사이트를 직접 조회
- 배송문의에서 **12자리 국내 운송장만** 사용
- 퀵스타 로그인 세션을 재사용해 운송장 기준 상태 조회 + 내부 초안 생성
- 상품 Q&A는 기본적으로 **초안보조형(assist)** 모드로 운영

## 현재 포함
- 전용 자동화 Chrome 실행 스크립트
- Chrome CDP 연결
- 스마트스토어 탭 찾기/열기
- 퀵스타 직접 조회 URL 구성
- 퀵스타 로그인 세션 확인
- 운송장 기준 직접 조회 + 상태 파싱
- 내부 배송안내 초안 생성
- 대표님 판단용 Q&A 초안 리포트 생성
- 답변 입력/등록용 골격

## 아직 현장 보정 필요한 것
- 스마트스토어 Q&A 목록 selector
- 문의 상세 selector
- 답변 입력창 selector
- 답변 등록 성공 확인 selector

이 값들은 `src/smartstore-selectors.js` 에서 보정하면 됩니다.

## 설치
```bash
cd /Users/dh/.openclaw/workspace/smartstore-cs-worker
npm install
```

## 전용 자동화 Chrome 실행
```bash
./scripts/start-automation-chrome.sh
```

이 스크립트는 아래 기준으로 Chrome을 띄웁니다.
- CDP 포트: `9223`
- 프로필 경로: `smartstore-cs-worker/runtime-data/chrome-profile`
- 스마트스토어 상품 Q&A 페이지 자동 오픈

상태 확인:
```bash
./scripts/check-automation-chrome.sh
```

## 대표님이 1회 해야 하는 것
전용 자동화 Chrome 창에서 아래만 한 번 해두면 됩니다.
- 스마트스토어 로그인
- 퀵스타 로그인
- 필요하면 상품 Q&A 화면까지 진입

이후에는 같은 프로필을 계속 재사용합니다.

## 실행
```bash
npm run run:once
```

또는 환경값을 명시해서 실행:
```bash
CSBOT_CDP_URL=http://127.0.0.1:9223 npm run run:once
```

## 안전 기본값
`src/config.js` 의 `dryRun` 기본값은 `true` 입니다.
즉, 기본 상태에서는 초안까지만 만들고 실제 답변 등록은 하지 않습니다.
실제 등록 테스트 전에는 selector 보정부터 먼저 하시면 됩니다.

## 기본 운영 모드
- `CSBOT_QNA_MODE=assist`
- 이 모드에서는 상품 Q&A를 자동 등록하지 않고,
  문의별 요약 + 추천 초안을 `runtime-data/qna-assist-latest.md` 로 생성합니다.
- 답변 말미에는 기본으로 아래 문구를 붙입니다.
  - `추가 문의는 톡톡문의로 남기시면 빠른 답변 드리겠습니다.`

## 톡톡 초안보조 실행
```bash
CSBOT_CDP_URL=http://127.0.0.1:9223 node scripts/run-talktalk-assist.js
```

- 출력 리포트:
  - `runtime-data/talktalk-assist-latest.md`
- 기본 대상:
  - 톡톡 대기/읽지 않음 대화 상위건
- 기본 동작:
  - 대화 수집 → 케이스 분류 → 추천 초안 생성 → 대표님 판단 메모 칸 포함 리포트 생성

## 환경 변수 예시
`.env.example` 참고

## 파일 구조
- `src/config.js`: 기본 설정
- `src/utils.js`: 공통 유틸
- `src/smartstore-selectors.js`: 스마트스토어 현장 selector 보정 지점
- `src/quickstar-direct.js`: 퀵스타 직접 조회/파싱/초안 생성
- `src/run-once.js`: 1회 실행 worker
- `scripts/start-automation-chrome.sh`: 전용 자동화 Chrome 실행
- `scripts/check-automation-chrome.sh`: 전용 자동화 Chrome 상태 확인
- `launchd/com.ddomongi.smartstore-cs-worker.plist.example`: launchd 예시
