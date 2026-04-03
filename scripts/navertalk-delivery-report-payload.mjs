#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');
const approvalChannelId = process.env.NAVERTALK_APPROVAL_CHANNEL_ID || '1488798405860786176';
const approvalId = String(process.argv[2] || '').trim();
const screenshotPath = String(process.argv[3] || '').trim() || null;
const sentAt = String(process.argv[4] || '').trim() || null;

if (!approvalId) {
  console.error('usage: node ./scripts/navertalk-delivery-report-payload.mjs <approvalId> [screenshotPath] [sentAt]');
  process.exit(1);
}

const approvalPath = path.join(approvalsDir, `${approvalId}.json`);
const approval = await readJson(approvalPath);
if (!approval) {
  console.error(JSON.stringify({ ok: false, error: 'approval_not_found', approvalId }, null, 2));
  process.exit(2);
}

const lines = [
  `[완료] ${approval.customerName || approval.userId} / ${approval.inquiryType || '미분류'}`,
  `approvalId: ${approval.approvalId}`,
];
if (approval.shortCode) lines.push(`승인코드: ${approval.shortCode}`);
if (approval.productName) lines.push(`상품: ${approval.productName}`);
if (sentAt) lines.push(`전송 시각: ${sentAt}`);
if (approval.queue?.completedAt) lines.push(`완료 시각: ${approval.queue.completedAt}`);
lines.push('', '[보낸 문구 요약]');
lines.push(summarizeDraft(approval.draft || ''));

const payload = {
  action: 'send',
  channel: 'discord',
  target: `channel:${approvalChannelId}`,
  silent: true,
  message: lines.join('\n'),
  media: screenshotPath || undefined,
};

console.log(JSON.stringify({
  ok: true,
  approvalId,
  payload,
}, null, 2));

function summarizeDraft(text) {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '-';
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
