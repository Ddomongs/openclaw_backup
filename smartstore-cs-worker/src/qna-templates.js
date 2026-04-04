export const QNA_TEMPLATES = {
  tax_fee_clear: {
    code: 'tax_fee_clear',
    tone: 'short',
    text: '네, 추가 지불하실 금액 없으십니다. :)'
  },
  shipping_fee_variable: {
    code: 'shipping_fee_variable',
    tone: 'long',
    text: [
      '안녕하세요, 또몽이네 스토어입니다.',
      '',
      '문의 주신 배송비는 해외 현지 물류비, 국제배송비, 환율 등의 반영 시점에 따라 변동될 수 있어 일자별로 다르게 보일 수 있습니다.',
      '결제 화면에서 확인되는 금액이 최종 적용 금액이며, 주문 시점 기준으로 확정됩니다.'
    ].join('\n')
  },
  shipping_eta_uncertain: {
    code: 'shipping_eta_uncertain',
    tone: 'short',
    text: '통관 및 물류 진행 상황에 따라 차이 발생할 수 있습니다.'
  },
  shipping_eta_general: {
    code: 'shipping_eta_general',
    tone: 'long',
    text: [
      '스마트스토어에서 문의주신 상품 관련하여 안내 말씀 드립니다.',
      '',
      '해당 상품은 해외에서 발송되는 구매대행 상품으로 국내 택배와는 배송 과정이 다소 다를 수 있습니다.',
      '통상적으로 해외 출고 후 국내 수령까지 영업일 기준 7~15일 정도 소요되며, 통관 상황에 따라 다소 차이가 있을 수 있습니다.',
      '배송 진행 상황은 확인되는 대로 안내드리겠습니다.'
    ].join('\n')
  },
  stock_check_needed: {
    code: 'stock_check_needed',
    tone: 'long',
    text: [
      '안녕하세요, 또몽이네 스토어입니다.',
      '',
      '문의주신 상품의 재고 및 가능 여부는 시점에 따라 변동될 수 있습니다.',
      '정확한 가능 여부는 확인 후 다시 안내드리겠습니다.',
      '조금만 기다려 주시면 감사하겠습니다.'
    ].join('\n')
  },
  option_guidance_general: {
    code: 'option_guidance_general',
    tone: 'long',
    text: [
      '안녕하세요, 또몽이네 스토어입니다.',
      '',
      '문의주신 옵션 가능 여부는 현재 판매 페이지 기준 옵션 및 재고 상황에 따라 달라질 수 있습니다.',
      '페이지에 노출된 옵션 기준으로 확인 부탁드리며, 별도 확인이 필요한 경우 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  components_reference: {
    code: 'components_reference',
    tone: 'long',
    text: [
      '문의하신 상품 구성 관련 안내드립니다.',
      '',
      '구성품은 판매 페이지에 기재된 구성 기준으로 출고됩니다.',
      '옵션별 구성 차이가 있을 수 있어 상세 구성은 상품 페이지 옵션 및 상세설명을 함께 확인 부탁드립니다.',
      '추가 확인이 필요한 경우 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  compatibility_no: {
    code: 'compatibility_no',
    tone: 'short',
    text: '아쉽게도 해당 상품은 안내된 적용 대상 기준으로만 사용 가능하십니다.'
  },
  compatibility_check: {
    code: 'compatibility_check',
    tone: 'long',
    text: [
      '문의하신 상품 관련 안내드립니다.',
      '',
      '호환 여부는 적용 차량/모델/연식 또는 옵션 조건에 따라 달라질 수 있습니다.',
      '상품 페이지 안내 기준을 우선 참고 부탁드리며, 추가 확인이 필요한 경우 확인 후 안내드리겠습니다.'
    ].join('\n')
  },
  authenticity_general: {
    code: 'authenticity_general',
    tone: 'long',
    text: [
      '문의하신 상품 관련 안내드립니다.',
      '',
      '등록된 상품은 현재 판매 페이지 기준으로 안내되는 상품입니다.',
      '세부 사양 및 구성 정보는 상품 페이지 표기 내용을 함께 참고 부탁드립니다.',
      '추가로 확인이 필요한 부분은 확인 후 안내드리겠습니다.'
    ].join('\n')
  },
  size_reference: {
    code: 'size_reference',
    tone: 'long',
    text: [
      '문의하신 사이즈 관련 안내드립니다.',
      '',
      '사이즈는 상품 상세페이지에 기재된 실측 기준으로 확인해주시는 것이 가장 정확합니다.',
      '해외 상품은 동일 표기라도 제조사 기준에 따라 착용감 차이가 있을 수 있어 국내 사이즈와 완전히 동일하다고 단정 안내드리기 어려운 점 양해 부탁드립니다.',
      '상세페이지의 실측 정보를 가지고 평소 착용하시는 의류와 비교 후 선택 부탁드립니다.'
    ].join('\n')
  },
  size_recommendation_general: {
    code: 'size_recommendation_general',
    tone: 'short',
    text: '사이즈는 가슴둘레 등 실측 기준으로 확인해주시는 것을 추천드립니다.'
  },
  usage_check_needed: {
    code: 'usage_check_needed',
    tone: 'long',
    text: [
      '문의주신 내용 확인했습니다.',
      '',
      '사용 방법은 상품 상세페이지 안내 또는 구성품 형태에 따라 차이가 있을 수 있습니다.',
      '현재 문의주신 부분은 확인 후 다시 안내드리겠습니다.'
    ].join('\n')
  },
  quantity_possible: {
    code: 'quantity_possible',
    tone: 'short',
    text: '네, 주문 가능하십니다. 상세 조건 확인이 더 필요하시면 톡톡문의로 남겨주시면 확인 후 안내드리겠습니다.'
  },
  followup_talk: {
    code: 'followup_talk',
    tone: 'short',
    text: '상세 문의는 톡톡문의로 남겨주시면 확인 후 안내드리겠습니다.'
  }
};

export function getTemplate(code) {
  return QNA_TEMPLATES[code] || null;
}
