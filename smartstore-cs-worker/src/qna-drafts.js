import { cleanText } from './utils.js';

function hasAny(text, keywords) {
  return keywords.some(keyword => text.includes(keyword));
}

export function buildQnaDraft(inquiry) {
  const title = cleanText(inquiry.title || '');
  const body = cleanText(inquiry.body || inquiry.rawText || '');
  const text = `${title}\n${body}`;

  if (!text) {
    return { matched: false, reason: 'empty_text' };
  }

  if (hasAny(text, ['환불', '보상', '신고', '법적', '책임', '불량', '파손', '교환'])) {
    return { matched: false, reason: 'manual_required_risky' };
  }

  if (hasAny(text, ['재고', '구매 가능', '옵션 가능', '옵션 구매', '가능할까요'])) {
    return {
      matched: true,
      category: 'stock_option',
      text: [
        '문의하신 상품 관련 안내드립니다.',
        '',
        '옵션 가능 여부 및 재고 상황은 시점에 따라 변동될 수 있습니다.',
        '정확한 가능 여부는 확인 후 안내드리겠습니다.',
        '페이지에 노출된 옵션 외 별도 가능 여부가 필요한 경우 추가 확인이 필요합니다.'
      ].join('\n')
    };
  }

  if (hasAny(text, ['구성품', '포함', '두개 맞', '세트', '들어가', '구성'])) {
    return {
      matched: true,
      category: 'components',
      text: [
        '문의하신 상품 구성 관련 안내드립니다.',
        '',
        '구성품은 판매 페이지에 기재된 구성 기준으로 출고됩니다.',
        '옵션별 구성 차이가 있을 수 있어 상세 구성은 상품 페이지 옵션/상세설명을 함께 확인 부탁드립니다.',
        '추가 확인이 필요한 경우 확인 후 다시 안내드리겠습니다.'
      ].join('\n')
    };
  }

  if (hasAny(text, ['호환', '가능한가요', '사용 가능', '맞나요'])) {
    return {
      matched: true,
      category: 'compatibility',
      text: [
        '문의하신 상품 관련 안내드립니다.',
        '',
        '호환 여부는 적용 차량/모델/연식 또는 옵션 조건에 따라 달라질 수 있습니다.',
        '상품 페이지 안내 기준을 우선 참고 부탁드리며, 추가 확인이 필요한 경우 확인 후 안내드리겠습니다.'
      ].join('\n')
    };
  }

  if (hasAny(text, ['사용법', '어떻게', '열나요', '조립', '설치'])) {
    return {
      matched: true,
      category: 'usage',
      text: [
        '문의주신 내용 확인했습니다.',
        '',
        '사용 방법은 상품 상세페이지 안내 또는 구성품 형태에 따라 차이가 있을 수 있습니다.',
        '현재 문의주신 부분은 확인 후 다시 안내드리겠습니다.'
      ].join('\n')
    };
  }

  if (hasAny(text, ['정품'])) {
    return {
      matched: true,
      category: 'authenticity',
      text: [
        '문의하신 상품 관련 안내드립니다.',
        '',
        '등록된 상품은 현재 판매 페이지 기준으로 안내되는 상품입니다.',
        '세부 사양 및 구성 정보는 상품 페이지 표기 내용을 함께 참고 부탁드립니다.',
        '추가로 확인이 필요한 부분은 확인 후 안내드리겠습니다.'
      ].join('\n')
    };
  }

  if (hasAny(text, ['배송', '출고', '도착', '언제'])) {
    return {
      matched: true,
      category: 'general_shipping',
      text: [
        '문의하신 배송 관련 내용 안내드립니다.',
        '',
        '출고 및 배송 일정은 주문 시점과 물류 상황에 따라 변동될 수 있습니다.',
        '정확한 진행 상황은 확인 후 다시 안내드리겠습니다.'
      ].join('\n')
    };
  }

  return { matched: false, reason: 'no_rule_matched' };
}
