# Smartstore CS Worker

대표님 요구사항 기준 최소 실행 초안입니다.

## 목표
- 같은 macOS 계정에서 실행
- 실제 Chrome 창/탭을 유지한 채 백그라운드에 가깝게 동작
- 스마트스토어 페이지에 이미 주입된 퀵스타 확장을 그대로 활용
- 배송문의에서 **12자리 국내 운송장만** 사용
- Quickstar 확장 입력창에 운송장 입력 + `Tab` 트리거 + 생성 초안 읽기

## 현재 포함
- Chrome CDP 연결
- 스마트스토어 탭 찾기/열기
- 퀵스타 확장 shadow DOM 접근
- 운송장 조회 트리거
- 확장 초안 읽기
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

## Chrome 실행 전제
전용 Chrome 프로필로 실행되어 있어야 합니다.
예시:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome-CSBot"
```

그리고 아래가 이미 준비되어 있어야 합니다.
- 스마트스토어 로그인
- 퀵스타 확장 설치/활성화
- 가능하면 상품 Q&A 탭 열어두기

## 실행
```bash
npm run run:once
```

## 안전 기본값
`src/config.js` 의 `dryRun` 기본값은 `true` 입니다.
즉, 기본 상태에서는 초안까지만 만들고 실제 답변 등록은 하지 않습니다.
실제 등록 테스트 전에는 selector 보정부터 먼저 하시면 됩니다.

## 파일 구조
- `src/config.js`: 기본 설정
- `src/utils.js`: 공통 유틸
- `src/smartstore-selectors.js`: 스마트스토어 현장 selector 보정 지점
- `src/quickstar-extension.js`: 퀵스타 확장 shadow DOM 제어
- `src/run-once.js`: 1회 실행 worker
- `launchd/com.ddomongi.smartstore-cs-worker.plist.example`: launchd 예시
