export const SS = {
  unansweredListCandidates: [
    'ui-view[name="list"] > ul.seller-list-border.has-thmb > li',
    'ui-view[name="list"] ul.seller-list-border.has-thmb > li'
  ],

  inquiryTitleCandidates: [
    '.title-area strong'
  ],

  inquiryBodyCandidates: [
    'p.text-area'
  ],

  orderInfoCandidates: [
    '.partition-area'
  ],

  listView: 'ui-view[name="list"]',
  searchForm: 'form[name="registerForm"]',
  answerFilterRow: 'form[name="registerForm"] li',
  answerFilterLabelText: '답변',
  answerFilterSelect: '.selectize-input',
  answerFilterOptionUnanswered: '.selectize-dropdown .option[data-value="false"]',
  searchButton: 'form[name="registerForm"] button.btn.btn-primary[type="submit"]',
  rowUnansweredLabel: '.title-area .label.label-danger',
  rowReplyButton: '.btn-area button',
  rowReplySection: '.seller-reply-section',

  answerTextareaCandidates: [
    '.seller-reply-section textarea[placeholder*="답글"]',
    '.seller-reply-section textarea'
  ],

  submitButtonCandidates: [
    '.seller-reply-section button.progress-button',
    'button:has-text("등록")'
  ],

  successToastCandidates: [
    'text=답변이 등록되었습니다',
    'text=등록되었습니다',
    'text=처리되었습니다'
  ],
};
