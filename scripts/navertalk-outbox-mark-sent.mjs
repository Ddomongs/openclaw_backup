#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const outboxDir = process.env.NAVERTALK_LOCAL_OUTBOX_DIR || path.join(cwd, 'runtime-data', 'local-cs-discord-outbox');
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');
const approvalId = String(process.argv[2] || '').trim();
const state = String(process.argv[3] || 'sent').trim();
const messageId = String(process.argv[4] || '').trim() || null;
const channelId = String(process.argv[5] || '').trim() || null;

if (!approvalId) {
  console.error('usage: node ./scripts/navertalk-outbox-mark-sent.mjs <approvalId> [sent|failed] [messageId] [channelId]');
  process.exit(1);
}

const outboxPath = path.join(outboxDir, `${approvalId}.json`);
const approvalPath = path.join(approvalsDir, `${approvalId}.json`);
const now = new Date().toISOString();

const outbox = await readJson(outboxPath);
if (!outbox) {
  console.error(JSON.stringify({ ok: false, error: 'outbox_not_found', approvalId }, null, 2));
  process.exit(2);
}

outbox.state = state;
outbox.sentAt = now;
outbox.messageId = messageId;
outbox.channelId = channelId || outbox.channelId || null;
await fs.writeFile(outboxPath, JSON.stringify(outbox, null, 2), 'utf8');

const approval = await readJson(approvalPath);
if (approval) {
  approval.discordOutbox = approval.discordOutbox || {};
  approval.discordOutbox.state = state;
  approval.discordOutbox.sentAt = now;
  approval.discordOutbox.messageId = messageId;
  approval.discordOutbox.channelId = channelId || approval.discordOutbox.channelId || null;
  approval.discordOutbox.outboxPath = outboxPath;
  await fs.writeFile(approvalPath, JSON.stringify(approval, null, 2), 'utf8');
}

console.log(JSON.stringify({
  ok: true,
  approvalId,
  state,
  messageId,
  channelId: channelId || outbox.channelId || null,
  outboxPath,
}, null, 2));

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
