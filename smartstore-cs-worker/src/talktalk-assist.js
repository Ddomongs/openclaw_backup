import fs from 'node:fs/promises';
import path from 'node:path';

const FOLLOWUP_LINE = '추가 문의는 톡톡문의로 남기시면 빠른 답변 드리겠습니다.';

const AUTO_REPLY_CATEGORIES = new Set([
  'shipping_eta_basic',
  'shipping_eta_long',
  'shipping_delay_apology',
]);

export function withTalktalkFollowup(text) {
  const base = String(text || '').trim();
  if (!base) return FOLLOWUP_LINE;
  if (base.includes(FOLLOWUP_LINE)) return base;
  return `${base}\n\n${FOLLOWUP_LINE}`;
}

export function buildTalktalkAssistItem({ conversation, draft }) {
  const autoReply = AUTO_REPLY_CATEGORIES.has(draft?.category);
  return {
    customerName: conversation.customerName || '',
    tag: conversation.tag || '',
    product: conversation.product || '',
    latestCustomerMessage: conversation.latestCustomerMessage || '',
    unreadCount: conversation.unreadCount || 0,
    templateCode: draft?.templateCode || null,
    category: draft?.category || null,
    tone: draft?.tone || null,
    route: autoReply ? 'auto_draft' : 'handoff_required',
    suggestedReply: autoReply ? withTalktalkFollowup(draft?.text || '') : '',
    operatorGuide: autoReply
      ? '배송문의로 분류되어 자동 초안 생성 대상입니다. 대표님이 검토 후 바로 사용하거나 수정하시면 됩니다.'
      : '배송문의 외 항목이라 대표님 판단이 필요합니다. 핵심 사실/판단만 적어주시면 고객용 답변 초안으로 다시 정리합니다.',
  };
}

export async function writeTalktalkAssistReport(outputPath, items = []) {
  const lines = [];
  lines.push('# 톡톡 초안보조 리포트');
  lines.push('');
  lines.push(`- 생성 건수: ${items.length}건`);
  lines.push('- 모드: assist');
  lines.push('');

  items.forEach((item, idx) => {
    lines.push(`## ${idx + 1}. ${item.customerName || '(고객명 없음)'}`);
    if (item.tag) lines.push(`- 태그: ${item.tag}`);
    if (item.product) lines.push(`- 상품: ${item.product}`);
    lines.push(`- 카테고리: ${item.category || '-'}`);
    lines.push(`- 템플릿: ${item.templateCode || '-'}`);
    lines.push(`- 처리방식: ${item.route === 'auto_draft' ? '배송문의 자동초안' : '대표님 토스'}`);
    lines.push(`- 읽지 않음: ${item.unreadCount || 0}`);
    lines.push('');
    lines.push('### 최근 고객 메시지');
    lines.push(item.latestCustomerMessage || '(메시지 없음)');
    lines.push('');
    if (item.route === 'auto_draft') {
      lines.push('### 추천 초안');
      lines.push(item.suggestedReply || '(초안 없음)');
    } else {
      lines.push('### 대표님 확인 필요');
      lines.push('배송문의 외 항목으로 분류되어 자동 초안을 생성하지 않았습니다. 대표님 판단 후 답변 방향을 적어주시면 초안으로 다시 정리합니다.');
    }
    lines.push('');
    lines.push('### 대표님 판단 메모');
    lines.push('- ');
    lines.push('');
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(() => {});
  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
