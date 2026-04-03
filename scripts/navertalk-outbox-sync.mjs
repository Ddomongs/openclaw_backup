#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const localConfigPath = path.join(cwd, 'runtime-data', 'navertalk-local-config.json');
const localConfig = await readJson(localConfigPath);
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');
const outboxDir = process.env.NAVERTALK_LOCAL_OUTBOX_DIR || path.join(cwd, 'runtime-data', 'local-cs-discord-outbox');
const approvalChannelId = process.env.NAVERTALK_APPROVAL_CHANNEL_ID || localConfig?.approvalChannelId || '1488798405860786176';
const talkBaseUrl = String(process.env.NAVERTALK_TALK_URL || localConfig?.talkUrl || '').trim();

await fs.mkdir(approvalsDir, { recursive: true });
await fs.mkdir(outboxDir, { recursive: true });

const approvalFiles = await listJsonFiles(approvalsDir);
const latestByShortCode = await mapLatestApprovalByShortCode(approvalFiles);
const created = [];
const skipped = [];

for (const filePath of approvalFiles) {
  const approval = await readJson(filePath);
  if (!approval) {
    skipped.push({ file: path.basename(filePath), reason: 'read_failed' });
    continue;
  }
  if (approval.status !== 'pending') {
    skipped.push({ approvalId: approval.approvalId, reason: `status_${approval.status}` });
    continue;
  }

  const latestApprovalId = latestByShortCode.get(approval.shortCode || approval.approvalId);
  if (latestApprovalId && latestApprovalId !== approval.approvalId) {
    skipped.push({ approvalId: approval.approvalId, reason: 'superseded_by_newer_short_code' });
    continue;
  }

  const outboxPath = path.join(outboxDir, `${approval.approvalId}.json`);
  if (await exists(outboxPath)) {
    skipped.push({ approvalId: approval.approvalId, reason: 'outbox_exists' });
    continue;
  }

  const outbox = {
    approvalId: approval.approvalId,
    shortCode: approval.shortCode || null,
    channelId: approvalChannelId,
    createdAt: new Date().toISOString(),
    state: 'pending_send',
    customerName: approval.customerName || null,
    inquiryType: approval.inquiryType || null,
    payload: approval.discordPayload || {
      content: approval.discordMessage || `[${approval.approvalId}]`,
      components: [],
    },
    sendRequest: buildSendRequest(approval, approvalChannelId),
  };

  approval.discordOutbox = {
    state: 'queued',
    queuedAt: outbox.createdAt,
    outboxPath,
    channelId: approvalChannelId,
  };

  await fs.writeFile(outboxPath, JSON.stringify(outbox, null, 2), 'utf8');
  await fs.writeFile(filePath, JSON.stringify(approval, null, 2), 'utf8');
  created.push({ approvalId: approval.approvalId, outbox: path.basename(outboxPath) });
}

console.log(JSON.stringify({
  ok: true,
  outboxDir,
  createdCount: created.length,
  created,
  skipped,
}, null, 2));

async function listJsonFiles(dirPath) {
  const entries = await fs.readdir(dirPath).catch(() => []);
  return entries.filter((name) => name.endsWith('.json')).map((name) => path.join(dirPath, name));
}

async function mapLatestApprovalByShortCode(files) {
  const map = new Map();
  for (const filePath of files) {
    const approval = await readJson(filePath);
    if (!approval || approval.status !== 'pending') continue;
    const key = approval.shortCode || approval.approvalId;
    const prev = map.get(key);
    if (!prev || String(approval.createdAt || '').localeCompare(String(prev.createdAt || '')) > 0) {
      map.set(key, { approvalId: approval.approvalId, createdAt: approval.createdAt || '' });
    }
  }
  return new Map([...map.entries()].map(([key, value]) => [key, value.approvalId]));
}

function buildSendRequest(approval, channelId) {
  const content = buildApprovalCardText(approval);
  return {
    action: 'send',
    channel: 'discord',
    target: `channel:${channelId}`,
    silent: true,
    message: `[${approval.customerName || approval.shortCode}] 승인 요청`,
    components: {
      text: `[${approval.customerName || approval.shortCode}] 승인 요청`,
      reusable: true,
      blocks: [
        { type: 'text', text: content },
        {
          type: 'actions',
          buttons: [
            { label: `승인 · ${approval.shortCode}`, style: 'success', allowedUsers: ['397698540383502337'] },
            { label: `보류 · ${approval.shortCode}`, style: 'secondary', allowedUsers: ['397698540383502337'] },
            { label: `수정요청 · ${approval.shortCode}`, style: 'danger', allowedUsers: ['397698540383502337'] },
          ],
        },
      ],
    },
  };
}

function buildApprovalCardText(approval) {
  const talkLink = buildTalkLink(approval);
  const lines = [
    `[${approval.approvalId}] 톡톡 / ${approval.inquiryType} / ${approval.customerName || approval.userId}`,
    `승인코드: ${approval.shortCode}`,
  ];
  if (approval.productName) lines.push(`상품: ${approval.productName}`);
  if (approval.meta?.orderNo) lines.push(`주문번호: ${approval.meta.orderNo}`);
  if (approval.meta?.productOrderNo) lines.push(`상품주문번호: ${approval.meta.productOrderNo}`);
  if (approval.meta?.courier) lines.push(`택배사: ${approval.meta.courier}`);
  if (approval.trackingNo) lines.push(`송장번호: ${approval.trackingNo}`);
  if (approval.meta?.shippingStatusCheck) lines.push(`현재확인: ${approval.meta.shippingStatusCheck}`);
  if (talkLink) lines.push(`톡톡 바로가기: <${talkLink}>`);
  if (Array.isArray(approval.recentMessages) && approval.recentMessages.length) {
    lines.push('', '[최근 대화]');
    for (const item of approval.recentMessages) {
      lines.push(`- ${item.label} ${item.text}`);
    }
  }
  if (approval.draft) {
    lines.push('', '[초안]', '```text', approval.draft, '```');
  }
  return lines.join('\n');
}

function buildTalkLink(approval) {
  const meta = approval?.meta || {};
  const preferredChatMapping = meta.preferredChatMapping || null;
  return firstNonEmpty(
    approval?.talkLink,
    preferredChatMapping?.popupUrl,
    normalizePopupPath(preferredChatMapping?.popupPath),
    talkBaseUrl,
  );
}

function normalizePopupPath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('http://') || text.startsWith('https://')) return text;
  if (text.startsWith('/')) return `https://partner.talk.naver.com${text}`;
  return `https://partner.talk.naver.com/${text.replace(/^\/+/, '')}`;
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

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
