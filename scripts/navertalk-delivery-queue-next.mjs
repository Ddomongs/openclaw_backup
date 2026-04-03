#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const queueDir = process.env.NAVERTALK_LOCAL_QUEUE_DIR || path.join(cwd, 'runtime-data', 'local-cs-delivery-queue');
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');

await fs.mkdir(queueDir, { recursive: true });
await fs.mkdir(approvalsDir, { recursive: true });

const items = await listQueueItems();
const queued = items.filter((item) => item.status === 'queued').sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
const next = queued[0];

if (!next) {
  console.log(JSON.stringify({ ok: true, found: false, reason: 'no_queued_items' }, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
next.status = 'processing';
next.startedAt = now;
await fs.writeFile(next.__path, JSON.stringify(stripInternal(next), null, 2), 'utf8');

const approvalPath = path.join(approvalsDir, `${next.approvalId}.json`);
const approval = await readJson(approvalPath);
if (approval) {
  approval.queue = approval.queue || {};
  approval.queue.state = 'processing';
  approval.queue.startedAt = now;
  approval.queue.queuePath = next.__path;
  await fs.writeFile(approvalPath, JSON.stringify(approval, null, 2), 'utf8');
}

console.log(JSON.stringify({
  ok: true,
  found: true,
  approvalId: next.approvalId,
  shortCode: next.shortCode || null,
  customerName: next.customerName || null,
  productName: next.productName || null,
  inquiryType: next.inquiryType || null,
  draft: next.draft || null,
  queuePath: next.__path,
  approvalPath,
  startedAt: now,
}, null, 2));

async function listQueueItems() {
  const entries = await fs.readdir(queueDir).catch(() => []);
  const results = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(queueDir, entry);
    const parsed = await readJson(filePath);
    if (!parsed) continue;
    results.push({ ...parsed, __path: filePath });
  }
  return results;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function stripInternal(item) {
  const { __path, ...rest } = item;
  return rest;
}
