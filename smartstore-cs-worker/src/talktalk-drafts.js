import { cleanText } from './utils.js';
import { getTalktalkTemplate } from './talktalk-templates.js';

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function result(code, extra = {}) {
  const template = getTalktalkTemplate(code);
  if (!template) return { matched: false, reason: `template_missing:${code}` };
  return {
    matched: true,
    category: code,
    templateCode: code,
    tone: template.tone,
    text: template.text,
    ...extra,
  };
}

export function buildTalktalkDraft(conversation) {
  const product = cleanText(conversation.product || '');
  const tag = cleanText(conversation.tag || '');
  const latestCustomerMessage = cleanText(
    conversation.latestCustomerMessage
      || conversation.customerMessages?.[conversation.customerMessages.length - 1]
      || conversation.preview
      || ''
  );
  const text = `${tag}\n${product}\n${latestCustomerMessage}`;

  if (!text.trim()) {
    return { matched: false, reason: 'empty_text' };
  }

  if (hasAny(text, ['감사', '고맙', '알겠습니다', '넵', '넹']) && !hasAny(text, ['언제', '배송', '취소', '환불', '재고', '옵션', '관세', '?'])) {
    return { matched: false, reason: 'ack_only' };
  }

  if (hasAny(text, ['취소', '환불', '반품', '교환'])) {
    return result('cancel_refund_route');
  }

  if (hasAny(text, ['관세', '부가세', '관부가세', '추가금', '포함금액'])) {
    if (hasAny(text, ['발생할까요', '포함', '없', '추가 지불'])) {
      return result('tax_fee_clear');
    }
    return result('tax_fee_check');
  }

  if (hasAny(text, ['재고', '입고', '구할수', '구할 수', '있을까요', '품절'])) {
    return result('stock_check_needed');
  }

  if (hasAny(text, ['옵션', '16:9', '4:3', '색상', '선택'])) {
    return result('option_guidance_check');
  }

  if (hasAny(text, ['어떻게', '설치', '조립', '사용법'])) {
    return result('usage_check_needed');
  }

  if (hasAny(text, ['오래 기다', '기다렸', '지연', '아직도', '발송 준비중', '언제 오나요'])) {
    return result('shipping_delay_apology');
  }

  if (hasAny(text, ['언제', '배송', '도착', '출고', '통관', '평균배송일', '받을 수'])) {
    if (hasAny(text, ['급', '정확히', '언제쯤', '며칠', '몇일'])) {
      return result('shipping_eta_basic');
    }
    return result('shipping_eta_long');
  }

  return result('default_check');
}
