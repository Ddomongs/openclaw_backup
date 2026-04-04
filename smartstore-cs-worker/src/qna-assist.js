import fs from 'node:fs/promises';
import path from 'node:path';

const FOLLOWUP_LINE = '추가 문의는 톡톡문의로 남기시면 빠른 답변 드리겠습니다.';

export function withFollowup(text) {
  const base = String(text || '').trim();
  if (!base) return FOLLOWUP_LINE;
  if (base.includes(FOLLOWUP_LINE)) return base;
  return `${base}\n\n${FOLLOWUP_LINE}`;
}

export function buildAssistItem({ inquiry, draft, source = 'qna' }) {
  return {
    source,
    title: inquiry.title || '',
    body: inquiry.body || '',
    orderInfo: inquiry.orderInfo || '',
    invoiceNo: inquiry.invoiceNo || null,
    templateCode: draft?.templateCode || null,
    category: draft?.category || null,
    tone: draft?.tone || null,
    suggestedReply: withFollowup(draft?.text || ''),
    operatorGuide: '대표님 판단/핵심 포인트를 짧게 적어주시면, 그 내용을 반영해 고객용 답변 초안을 다시 정리합니다.',
  };
}

export async function writeAssistReport(outputPath, items = []) {
  const lines = [];
  lines.push('# 상품 Q&A 초안보조 리포트');
  lines.push('');
  lines.push(`- 생성 건수: ${items.length}건`);
  lines.push('- 모드: assist');
  lines.push('');

  items.forEach((item, idx) => {
    lines.push(`## ${idx + 1}. ${item.title || '(제목 없음)'}`);
    lines.push(`- 카테고리: ${item.category || '-'}`);
    lines.push(`- 템플릿: ${item.templateCode || '-'}`);
    if (item.orderInfo) lines.push(`- 메타: ${item.orderInfo}`);
    lines.push('');
    lines.push('### 문의');
    lines.push(item.body || '(본문 없음)');
    lines.push('');
    lines.push('### 추천 초안');
    lines.push(item.suggestedReply || '(초안 없음)');
    lines.push('');
    lines.push('### 대표님 판단 메모');
    lines.push('- ');
    lines.push('');
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true }).catch(() => {});
  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
}
