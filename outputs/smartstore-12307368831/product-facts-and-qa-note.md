# 상품 정보 및 QA 메모 — 12307368831

## 원 URL
https://smartstore.naver.com/ddomongs/products/12307368831

## 접근 결과
- `ALLOW_LEGACY_9223=1 ./scripts/browser-mcp/browser-ensure-ready-cs.sh` 결과: ready
- 9223 자동화 브라우저 캡처 시 네이버 로그인 페이지로 리다이렉트됨.
- 현재 스마트스토어 가격/리뷰/평점/판매량은 확인하지 못해 이미지 문구에서 제외함.

## 사용 근거
- 기존 Q&A 분석: `smartstore-cs-worker/analysis/qna_answered_samples_2026-04-04.json`
- 동일명 외부 상품 페이지: SSG 상품번호 1000719240351
- 다운로드 상품 이미지: `source-images/product-01.jpg` ~ `product-05.jpg`

## 반영 문구 기준
- 테슬라 공식/제휴 표현 금지
- `테슬라 호환`, `보조 디스플레이`, `옵션 확인`, `정차 중 설정 권장` 중심
- 가격/리뷰/평점 미표기
- 하단 공통 고지: `Tesla 공식 제품/제휴 아님 · 호환 액세서리 · 주행 중 조작 금지/정차 중 설정 권장`

## QA
- contact sheet 기준 12장 모두 큰 잘림 없음.
- 하단 비공식/안전 고지 12장 모두 반영.
- 05번 큰 제목은 `원형 컬러 UI로 / 필요한 정보를 또렷하게`로 확인됨.
