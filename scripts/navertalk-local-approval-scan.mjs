#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const baseUrl = (process.env.NAVERTALK_MONITOR_BASE_URL || 'https://webhook.tipoasis.com').replace(/\/$/, '');
const localConfigPath = path.join(process.cwd(), 'runtime-data', 'navertalk-local-config.json');
const localConfig = await readJson(localConfigPath);
const talkBaseUrl = String(process.env.NAVERTALK_TALK_URL || localConfig?.talkUrl || '').trim();
const viewerToken = process.env.NAVERTALK_VIEWER_TOKEN || '';
const limit = Number(process.env.NAVERTALK_APPROVAL_SCAN_LIMIT || 20);
const outputDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(process.cwd(), 'runtime-data', 'local-cs-approvals');
const enrichmentsPath = process.env.NAVERTALK_LOCAL_ENRICHMENTS_FILE || path.join(process.cwd(), 'runtime-data', 'local-cs-enrichments.json');

await fs.mkdir(outputDir, { recursive: true });
const enrichments = await readEnrichments();

const cardsResponse = await apiFetch('/api/cards');
const cards = Array.isArray(cardsResponse.cards) ? cardsResponse.cards.slice(0, limit) : [];
const existing = await readExistingApprovals();

const created = [];
const skipped = [];

for (const summary of cards) {
  const card = await fetchFullCard(summary.userId).catch(() => null);
  if (!card) {
    skipped.push({ userId: summary.userId, reason: 'card_fetch_failed' });
    continue;
  }

  const analysis = analyzeCard(card);
  if (!analysis.actionable) {
    skipped.push({ userId: card.userId, reason: analysis.reason });
    continue;
  }

  const dedupeKey = createDedupeKey(card);
  if (existing.has(dedupeKey)) {
    skipped.push({ userId: card.userId, reason: 'duplicate' });
    continue;
  }

  const approval = buildLocalApproval(card, analysis, dedupeKey, enrichments[card.userId] || null);
  await fs.writeFile(path.join(outputDir, `${approval.approvalId}.json`), JSON.stringify(approval, null, 2), 'utf8');
  existing.add(dedupeKey);
  created.push({ approvalId: approval.approvalId, userId: approval.userId, inquiryType: approval.inquiryType });
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  outputDir,
  createdCount: created.length,
  created,
  skipped,
}, null, 2));

async function apiFetch(apiPath) {
  const tokenQuery = viewerToken ? `${apiPath.includes('?') ? '&' : '?'}token=${encodeURIComponent(viewerToken)}` : '';
  const response = await fetch(`${baseUrl}${apiPath}${tokenQuery}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API ${response.status}: ${text}`);
  }
  return JSON.parse(text || '{}');
}

async function fetchFullCard(userId) {
  const response = await apiFetch(`/api/cards/${encodeURIComponent(userId)}`);
  return response.card || null;
}

async function readExistingApprovals() {
  const set = new Set();
  const entries = await fs.readdir(outputDir).catch(() => []);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(outputDir, entry), 'utf8').catch(() => '');
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.meta?.dedupeKey) set.add(parsed.meta.dedupeKey);
    } catch {}
  }
  return set;
}

async function readEnrichments() {
  try {
    const raw = await fs.readFile(enrichmentsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function analyzeCard(card) {
  if (!card) return { actionable: false, reason: 'card_not_found' };
  if (card.lastDirection !== 'incoming') return { actionable: false, reason: 'last_message_not_incoming' };

  const lastIncoming = [...(card.messages || [])].reverse().find((item) => item.direction === 'incoming' && String(item.text || '').trim());
  if (!lastIncoming) return { actionable: false, reason: 'no_incoming_text' };
  if (isTerminalReplyText(lastIncoming.text)) return { actionable: false, reason: 'terminal_reply' };

  return {
    actionable: true,
    reason: 'incoming_actionable_message',
    inquiryType: inferInquiryType(lastIncoming.text),
  };
}

function isTerminalReplyText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/[?？]$/.test(text)) return false;
  return /^(감사|감사합니다|감사합니당|고맙습니다|넵|네|네네|넹|확인|확인했습니다|알겠습니다|오케이|ok|감사해요|감사드려요)[!~. ]*$/i.test(text);
}

function inferInquiryType(value) {
  const text = String(value || '').trim();
  if (/배송|도착|언제|얼마만에|소요|받을/.test(text)) return '배송문의';
  if (/환불|반품|교환|취소/.test(text)) return '취소/교환/반품';
  if (/사이즈|옵션|색상|재고|품절/.test(text)) return '옵션/재고 문의';
  if (/통관|세관|개인통관|유니패스/.test(text)) return '통관문의';
  if (/불량|고장|안되|이상|문제/.test(text)) return '불량/사용문의';
  return '일반문의';
}

function buildLocalApproval(card, analysis, dedupeKey, enrichment = null) {
  const approvalId = `local_apr_${createHash('sha1').update(dedupeKey).digest('hex').slice(0, 10)}`;
  const shortCode = approvalId.replace(/^local_apr_/, '').slice(0, 6);
  const recentMessages = (card.messages || [])
    .filter((item) => item.direction === 'incoming' || item.direction === 'outgoing')
    .filter((item) => String(item.text || '').trim())
    .slice(-5)
    .map((item) => ({
      direction: item.direction,
      label: item.direction === 'outgoing' ? '상담사' : '고객',
      receivedAt: item.receivedAt,
      text: item.text,
    }));

  const draft = buildDraft(card, analysis.inquiryType);
  const customerName = firstNonEmpty(enrichment?.customerName, card?.meta?.customerDisplayName, card.userId);
  const productName = firstNonEmpty(enrichment?.productName, card?.productContext?.productName, null);
  const approval = {
    approvalId,
    shortCode,
    createdAt: new Date().toISOString(),
    status: 'pending',
    source: 'local-webhook-scan',
    channel: 'talktalk',
    inquiryType: analysis.inquiryType,
    userId: card.userId,
    customerName,
    productName,
    trackingNo: card?.meta?.trackingNo || null,
    talkLink: buildTalkLink(card, talkBaseUrl),
    recentMessages,
    draft: replaceDraftProduct(draft, productName),
    discordMessage: '',
    discordPayload: null,
    meta: {
      dedupeKey,
      cardLastSeenAt: card.lastSeenAt,
      cardLastMessageText: card.lastMessageText || '',
      enrichmentApplied: Boolean(enrichment),
      preferredChatMapping: card?.preferredChatMapping || card?.meta?.preferredChatMapping || null,
    },
  };

  approval.discordMessage = buildDiscordMessage(approval);
  approval.discordPayload = buildDiscordPayload(approval);
  return approval;
}

function buildDraft(card, inquiryType) {
  const product = card?.productContext?.productName || '문의 상품';
  if (inquiryType === '배송문의') {
    return `안녕하세요, 또몽이네 스토어입니다 🙂\n\n문의주신 "${product}" 상품은 현재 주문 시 일반적으로 영업일 기준 7~15일 정도 소요됩니다.\n\n다만 현지 재고 상황이나 통관 진행 상황에 따라 일정은 다소 변동될 수 있는 점 참고 부탁드립니다.\n추가로 궁금하신 점 있으시면 편하게 말씀해주세요.`;
  }
  return `안녕하세요, 또몽이네 스토어입니다 🙂\n\n문의주신 "${product}" 관련 내용은 확인 후 안내드리겠습니다.\n추가로 확인되는 내용이 있으면 다시 말씀드리겠습니다.`;
}

function replaceDraftProduct(draft, productName) {
  if (!productName) return draft;
  return String(draft || '').replaceAll('"문의 상품"', `"${productName}"`);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    return text;
  }
  return null;
}

function buildDiscordMessage(approval) {
  const lines = [
    `[${approval.approvalId}] 톡톡 / ${approval.inquiryType} / ${approval.customerName || approval.userId}`,
    `승인코드: ${approval.shortCode}`,
  ];
  if (approval.productName) lines.push(`상품: ${approval.productName}`);
  if (approval.trackingNo) lines.push(`송장번호: ${approval.trackingNo}`);
  if (approval.talkLink) lines.push(`톡톡 바로가기: <${approval.talkLink}>`);
  if (approval.recentMessages.length) {
    lines.push('', '[최근 대화]');
    for (const item of approval.recentMessages) {
      lines.push(`- ${item.label} ${item.text}`);
    }
  }
  lines.push('', '[초안]', '```text', approval.draft, '```');
  return lines.join('\n');
}

function buildDiscordPayload(approval) {
  return {
    content: approval.discordMessage,
    components: [
      {
        type: 1,
        components: [
          { type: 2, custom_id: `approval:${approval.approvalId}:approve`, label: '승인', style: 3, disabled: false },
          { type: 2, custom_id: `approval:${approval.approvalId}:hold`, label: '보류', style: 2, disabled: false },
          { type: 2, custom_id: `approval:${approval.approvalId}:revise`, label: '수정요청', style: 4, disabled: false },
        ],
      },
    ],
  };
}

function createDedupeKey(card) {
  return createHash('sha1').update(JSON.stringify({
    userId: card.userId,
    lastSeenAt: card.lastSeenAt,
    lastMessageText: card.lastMessageText || '',
  })).digest('hex');
}

function buildTalkLink(card, talkUrl) {
  const preferredChatMapping = card?.preferredChatMapping || card?.meta?.preferredChatMapping || null;
  const popupUrl = firstNonEmpty(
    preferredChatMapping?.popupUrl,
    normalizePopupPath(preferredChatMapping?.popupPath),
  );
  return popupUrl || firstNonEmpty(talkUrl) || null;
}

function normalizePopupPath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('http://') || text.startsWith('https://')) return text;
  if (text.startsWith('/')) return `https://partner.talk.naver.com${text}`;
  return `https://partner.talk.naver.com/${text.replace(/^\/+/, '')}`;
}
