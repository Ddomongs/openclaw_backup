import { cleanText } from './utils.js';
import { getTemplate } from './qna-templates.js';

function hasAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function result(code, extra = {}) {
  const template = getTemplate(code);
  if (!template) return { matched: false, reason: `template_missing:${code}` };
  return {
    matched: true,
    category: code,
    templateCode: code,
    text: template.text,
    tone: template.tone,
    ...extra,
  };
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

  if (hasAny(text, ['관세', '부가세', '추가 지불', '추가금', '관부가세']) && !hasAny(text, ['얼마', '왜'])) {
    return result('tax_fee_clear');
  }

  if (hasAny(text, ['배송비']) && hasAny(text, ['다르', '오르', '변동'])) {
    return result('shipping_fee_variable');
  }

  if (hasAny(text, ['오늘주문', '언제', '도착', '받아볼', '배송출발', '발송은 되었', '급해서'])) {
    if (hasAny(text, ['언제', '도착', '받아볼', '급해서', '통관'])) {
      return result('shipping_eta_uncertain');
    }
    return result('shipping_eta_general');
  }

  if (hasAny(text, ['재고', '입고', '품절', '발송지연'])) {
    return result('stock_check_needed');
  }

  if (hasAny(text, ['옵션', '색상', '선택', '구매 가능', '가능할까요'])) {
    return result('option_guidance_general');
  }

  if (hasAny(text, ['구성품', '포함', '세트', '단품', '두개 맞', '들어가', '구성'])) {
    return result('components_reference');
  }

  if (hasAny(text, ['어떻게', '열나요', '사용법', '조립', '설치'])) {
    return result('usage_check_needed');
  }

  if (hasAny(text, ['테슬라만', '호환', '연동', '사용 가능', '가능한건가요'])) {
    if (hasAny(text, ['테슬라만', '연동'])) {
      return result('compatibility_no');
    }
    return result('compatibility_check');
  }

  if (hasAny(text, ['정품'])) {
    return result('authenticity_general');
  }

  if (hasAny(text, ['사이즈', '105', '44', '실측', '착용감', '추천'])) {
    if (hasAny(text, ['추천'])) {
      return result('size_recommendation_general');
    }
    return result('size_reference');
  }

  if (hasAny(text, ['2개', '여러개', '수량'])) {
    return result('quantity_possible');
  }

  if (hasAny(text, ['톡톡'])) {
    return result('followup_talk');
  }

  return { matched: false, reason: 'no_rule_matched' };
}
