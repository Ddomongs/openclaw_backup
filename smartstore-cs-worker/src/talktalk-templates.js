export const TALKTALK_TEMPLATES = {
  shipping_eta_basic: {
    code: 'shipping_eta_basic',
    tone: 'short',
    text: '통관 및 물류 진행 상황에 따라 수령 일정은 변동될 수 있습니다. 확인 후 다시 안내드리겠습니다.'
  },
  shipping_eta_long: {
    code: 'shipping_eta_long',
    tone: 'long',
    text: [
      '안녕하세요, 또몽이네 스토어입니다.',
      '',
      '해당 상품은 해외에서 발송되는 구매대행 상품으로 국내 택배와는 배송 과정이 다소 다를 수 있습니다.',
      '통상적으로 해외 출고 후 국내 수령까지 영업일 기준 7~15일 정도 소요되며, 통관 상황에 따라 다소 차이가 있을 수 있습니다.',
      '현재 진행 상황은 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  shipping_delay_apology: {
    code: 'shipping_delay_apology',
    tone: 'long',
    text: [
      '오래 기다려 주시고 계신 점 대단히 죄송합니다.',
      '해당 상품은 현재 배송 진행 상황을 확인 중이며, 물류 및 통관 상황에 따라 일정이 다소 지연될 수 있습니다.',
      '정확한 상태 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  tax_fee_clear: {
    code: 'tax_fee_clear',
    tone: 'short',
    text: '네, 추가 지불하실 금액 없으십니다. :)'
  },
  tax_fee_check: {
    code: 'tax_fee_check',
    tone: 'short',
    text: '관부가세 및 추가금 발생 여부는 주문 상품과 금액 기준에 따라 달라질 수 있어 확인 후 안내드리겠습니다.'
  },
  cancel_refund_route: {
    code: 'cancel_refund_route',
    tone: 'short',
    text: '취소/환불 관련 내용은 주문 상태 확인 후 안내드리겠습니다. 필요한 경우 처리 절차도 함께 안내드리겠습니다.'
  },
  stock_check_needed: {
    code: 'stock_check_needed',
    tone: 'long',
    text: [
      '안녕하세요, 또몽이네 스토어입니다.',
      '',
      '문의주신 상품의 재고 및 가능 여부는 시점에 따라 변동될 수 있습니다.',
      '정확한 가능 여부는 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  option_guidance_check: {
    code: 'option_guidance_check',
    tone: 'long',
    text: [
      '안녕하세요, 또몽이네 스토어입니다.',
      '',
      '문의주신 옵션 관련 내용은 현재 판매 페이지 기준 옵션 및 재고 상황에 따라 달라질 수 있습니다.',
      '정확한 선택 가능 여부는 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  usage_check_needed: {
    code: 'usage_check_needed',
    tone: 'short',
    text: '문의주신 사용 관련 내용은 확인 후 다시 안내드리겠습니다.'
  },
  default_check: {
    code: 'default_check',
    tone: 'short',
    text: '문의주신 내용 확인 후 다시 안내드리겠습니다.'
  }
};

export function getTalktalkTemplate(code) {
  return TALKTALK_TEMPLATES[code] || null;
}
