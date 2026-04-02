# navertalk-talk-automation

네이버 톡톡 파트너센터용 크롬 확장 MVP입니다.

## 포함 기능
- 상담 리스트에서 안읽은 후보 자동 수집
- webhook.tipoasis.com 의 navertalk-monitor 카드와 후보 점수 매칭
- 최고 후보 팝업 바로 열기
- 채팅방 키 매핑 저장
- 팝업에서 주문/구매이력 추출
- 간단한 CS 초안 자동 생성
- 팝업에서 로컬 Discord 승인 카드 미리보기 생성

## 설치
1. Chrome 확장 프로그램 페이지 열기
2. 개발자 모드 ON
3. 압축해제된 확장 프로그램 로드
4. `navertalk-talk-automation` 폴더 선택

## 사용 순서
1. 파트너센터 상담 리스트 페이지 열기
2. 우측 하단 `또몽이 톡톡 자동화` 패널 확인
3. Monitor Base URL / Viewer Token 입력 후 저장
4. `후보 스캔` → `웹훅 매칭` 실행
5. 점수 높은 후보 `팝업 열기` / `매핑 저장`
6. 팝업에서 주문정보 / CS 초안 확인
7. 필요 시 `승인 카드 미리보기` 버튼으로 로컬 Discord 승인 카드 초안 생성 및 복사

## 팝업 승인 카드 미리보기 조건
- 리스트 화면에서 먼저 `매핑 저장`이 되어 있어야 팝업에서 webhook 카드 userId를 찾을 수 있습니다.
- 팝업에서는 현재 연결된 `userId`를 표시합니다.
- `승인 카드 미리보기` 버튼은 로컬에서 Discord 승인 카드 문자열을 생성하고 클립보드에 복사합니다.
- 승인 생성/전송은 웹서버가 아니라 로컬 자동화/Discord 경로에서 처리하는 방향을 기본으로 합니다.

## 기본값
- Monitor Base URL: `https://webhook.tipoasis.com`
- Viewer Token: 대표님이 cPanel 환경변수에 넣은 `NAVERTALK_VIEWER_TOKEN`
