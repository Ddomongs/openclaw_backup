# SelltKey 비로그인 매칭 자동화

`https://selltkey.com/scb/util/taobao.asp`의 일별 비로그인 매칭을 브라우저 클릭 없이 HTTP 요청으로 처리하는 스크립트입니다.

## 환경변수

- `SELLTKEY_ID`: SelltKey 로그인 ID
- `SELLTKEY_PW`: SelltKey 로그인 비밀번호
- `SELLTKEY_START_DATE`: 시작일 기본값. 미지정 시 `2026-04-11`
- `SELLTKEY_END_DATE`: 종료일 기본값. 미지정 시 서울 기준 오늘
- `SELLTKEY_DELAY_MS`: 요청 간 대기. 기본 `7200`
- `SELLTKEY_PAGE_SIZE`: 일자 페이지 조회 크기. 기본 `2000`
- `SELLTKEY_STATE_PATH`: 재개 상태 파일 경로. 기본 `runtime-data/selltkey-nonlogin-match-state.json`

## 실행 예시

```bash
export SELLTKEY_ID='아이디'
export SELLTKEY_PW='비밀번호'

node scripts/selltkey-nonlogin-match.mjs
```

특정 범위만 실행:

```bash
node scripts/selltkey-nonlogin-match.mjs --start-date 2026-04-11 --end-date 2026-04-18 --delay-ms 7200
```

래퍼 사용:

```bash
./scripts/run-selltkey-nonlogin-match.sh --start-date 2026-04-11
```

## 재개 방식

- 상태 파일은 기본적으로 `runtime-data/selltkey-nonlogin-match-state.json`에 저장됩니다.
- 어떤 날짜가 끝까지 처리되면 상태 파일의 `currentDate`를 다음 날짜로 넘깁니다.
- 일일 한도가 중간에 차면 현재 날짜를 그대로 유지해서 다음 실행 시 그 날짜부터 다시 시작합니다.
- 같은 날짜에서 `이미지 검색 실패` 등으로 `no_progress`가 2회 연속 발생하면 그 날짜는 건너뛰고 다음 날짜로 이동합니다.
- 시작일을 별도로 줘도 상태 파일에 더 뒤 날짜가 있으면 상태 파일 커서를 우선 사용합니다.

## 매일 자동 실행 권장 방식

- macOS 기준 `launchd`로 매일 `00:05` 1회 실행하는 방식이 가장 단순합니다.
- 스크립트 1회 실행만으로 `오늘 한도(200)`를 채우거나 날짜 범위를 끝까지 진행합니다.
- 실제 설치는 아직 하지 않았고, 필요하면 다음 형태로 등록하면 됩니다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.ddomongi.selltkey.nonlogin-match</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>/Users/dh/.openclaw/workspace/scripts/run-selltkey-nonlogin-match.sh</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
      <key>SELLTKEY_ID</key>
      <string>아이디</string>
      <key>SELLTKEY_PW</key>
      <string>비밀번호</string>
      <key>SELLTKEY_START_DATE</key>
      <string>2026-04-11</string>
    </dict>

    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>0</integer>
      <key>Minute</key>
      <integer>5</integer>
    </dict>

    <key>WorkingDirectory</key>
    <string>/Users/dh/.openclaw/workspace</string>
    <key>StandardOutPath</key>
    <string>/Users/dh/.openclaw/workspace/runtime-data/selltkey-nonlogin-match.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/dh/.openclaw/workspace/runtime-data/selltkey-nonlogin-match.err.log</string>
    <key>RunAtLoad</key>
    <false/>
  </dict>
</plist>
```

## 동작 요약

- `/scb/_loginOk.asp`에 `USERID`, `USERPWD`로 로그인합니다.
- 날짜별 페이지에서 `#countBtt`의 `used / limit`를 읽습니다.
- `data-chromeyn="Y"` 행에서 `goodsNum`, `goodsCode`, `imageUrl`, `title`을 뽑습니다.
- `/scb/util/ajax_goods_taobao_match_scb_p2s_test.asp`로 순차 요청합니다.
- 배치 후에는 날짜 페이지를 다시 읽어 남은 행과 한도를 확인합니다.
- 로그인 실패, `/scb/` 리다이렉트, 한도 초과, 파싱 실패는 콘솔에 이유를 남기고 안전하게 종료합니다.
