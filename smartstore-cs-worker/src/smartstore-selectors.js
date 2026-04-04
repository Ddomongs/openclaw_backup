export const SS = {
  // TODO: 대표님 실제 상품 Q&A 페이지 기준으로 보정 필요
  unansweredListCandidates: [
    '[data-testid="inquiry-row"]',
    '[data-testid="comment-row"]',
    '[role="row"]',
    'tbody tr',
    'li'
  ],

  inquiryTitleCandidates: [
    '[data-testid="inquiry-title"]',
    '.title',
    'h3',
    'h4'
  ],

  inquiryBodyCandidates: [
    '[data-testid="inquiry-body"]',
    '.question',
    '.contents',
    '.detail'
  ],

  orderInfoCandidates: [
    '[data-testid="order-info"]',
    '.order-info',
    '.product_order_info',
    '.info'
  ],

  answerTextareaCandidates: [
    'textarea',
    '[contenteditable="true"]',
    'textarea[placeholder*="답변"]'
  ],

  submitButtonCandidates: [
    'button:has-text("답변등록")',
    'button:has-text("등록")',
    'button:has-text("답변")'
  ],

  successToastCandidates: [
    'text=답변이 등록되었습니다',
    'text=등록되었습니다',
    'text=처리되었습니다'
  ],
};
