#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const queueDir = process.env.NAVERTALK_LOCAL_QUEUE_DIR || path.join(cwd, 'runtime-data', 'local-cs-delivery-queue');
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');
const approvalId = String(process.argv[2] || '').trim();
const screenshotPath = String(process.argv[3] || '').trim() || null;
const reportMessageId = String(process.argv[4] || '').trim() || null;

if (!approvalId) {
  console.error('usage: node ./scripts/navertalk-delivery-queue-complete.mjs <approvalId> [screenshotPath] [reportMessageId]');
  process.exit(1);
}

const queuePath = path.join(queueDir, `${approvalId}.json`);
const approvalPath = path.join(approvalsDir, `${approvalId}.json`);
const queueItem = await readJson(queuePath);
if (!queueItem) {
  console.error(JSON.stringify({ ok: false, error: 'queue_item_not_found', approvalId }, null, 2));
  process.exit(2);
}

const now = new Date().toISOString();
queueItem.status = 'done';
queueItem.completedAt = now;
queueItem.screenshotPath = screenshotPath;
queueItem.reportMessageId = reportMessageId;
await fs.writeFile(queuePath, JSON.stringify(queueItem, null, 2), 'utf8');

const approval = await readJson(approvalPath);
if (approval) {
  approval.queue = approval.queue || {};
  approval.queue.state = 'done';
  approval.queue.completedAt = now;
  approval.queue.screenshotPath = screenshotPath;
  approval.queue.reportMessageId = reportMessageId;
  await fs.writeFile(approvalPath, JSON.stringify(approval, null, 2), 'utf8');
}

console.log(JSON.stringify({
  ok: true,
  approvalId,
  state: 'done',
  completedAt: now,
  screenshotPath,
  reportMessageId,
  queuePath,
}, null, 2));

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
