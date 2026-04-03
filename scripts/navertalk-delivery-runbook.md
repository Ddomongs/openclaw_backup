# navertalk delivery worker runbook

## 목적
`runtime-data/local-cs-delivery-queue/` 에 쌓인 승인 건을 한 건씩 꺼내 실제 톡톡에 반영하고, 부분 캡처와 완료 보고까지 끝내는 절차를 정리한다.

## 순서
1. `node ./scripts/navertalk-delivery-queue-next.mjs`
   - 가장 오래된 `queued` 건을 `processing` 으로 바꾸고 작업 대상을 반환한다.
2. 브라우저에서 네이버 톡톡 파트너센터를 열고 해당 고객 상담을 찾는다.
3. approval 의 `draft` 를 톡톡 입력창에 넣고 전송한다.
4. 방금 보낸 메시지 말풍선 영역을 부분 캡처한다.
5. `node ./scripts/navertalk-delivery-queue-complete.mjs <approvalId> <screenshotPath> [reportMessageId]`
   - queue / approval 상태를 `done` 으로 반영한다.
6. `node ./scripts/navertalk-delivery-report-payload.mjs <approvalId> <screenshotPath> [sentAt]`
   - Discord 완료 보고용 payload 를 생성한다.
7. Discord 완료 보고를 보내고 다음 큐 건으로 이동한다.

## 실패 시
- 톡톡 대상 상담을 찾지 못했거나 전송이 실패하면:
  - `node ./scripts/navertalk-delivery-queue-fail.mjs <approvalId> <reason...>`
- 실패 건은 사람이 다시 확인하거나 보류 처리한다.

## 주의
- 브라우저 반영은 반드시 한 건씩 직렬 처리한다.
- 완료 보고에는 실제 보낸 메시지 영역의 부분 캡처를 첨부한다.
- 배송문의는 승인된 초안이 이미 퀵 위젯 하단 자동 생성 결과 기준인지 먼저 확인한다.
