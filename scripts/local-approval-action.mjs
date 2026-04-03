#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(process.cwd(), 'runtime-data', 'local-cs-approvals');
const queueDir = process.env.NAVERTALK_LOCAL_QUEUE_DIR || path.join(process.cwd(), 'runtime-data', 'local-cs-delivery-queue');
const openclawBin = process.env.OPENCLAW_BIN || 'openclaw';
const deliveryCronId = process.env.NAVERTALK_DELIVERY_CRON_ID || 'c5e5ca0e-b2ee-4dcc-93bc-f9f94a1d8ad8';
const shortCode = String(process.argv[2] || '').trim();
const action = String(process.argv[3] || '').trim().toLowerCase();
const actor = String(process.argv[4] || '대표님').trim();
const note = String(process.argv.slice(5).join(' ') || '').trim() || null;

if (!shortCode || !action) {
  console.error('usage: node ./scripts/local-approval-action.mjs <shortCode> <approve|hold|revise> [actor] [note...]');
  process.exit(1);
}

const entries = await fs.readdir(approvalsDir).catch(() => []);
let targetPath = null;
let approval = null;

for (const entry of entries) {
  if (!entry.endsWith('.json')) continue;
  const filePath = path.join(approvalsDir, entry);
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const id = String(parsed?.approvalId || '');
    const code = String(parsed?.shortCode || deriveShortCode(id) || '');
    if (code === shortCode || id.includes(shortCode)) {
      targetPath = filePath;
      approval = parsed;
      break;
    }
  } catch {}
}

if (!approval || !targetPath) {
  console.error(JSON.stringify({ ok: false, error: 'approval_not_found', shortCode }, null, 2));
  process.exit(2);
}

const normalized = normalizeAction(action);
if (!normalized) {
  console.error(JSON.stringify({ ok: false, error: 'invalid_action', action }, null, 2));
  process.exit(3);
}

approval.shortCode = approval.shortCode || deriveShortCode(approval.approvalId);
approval.status = normalized.status;
approval.updatedAt = new Date().toISOString();
approval.lastAction = {
  key: normalized.key,
  label: normalized.label,
  at: approval.updatedAt,
  actor,
  note,
};

await fs.mkdir(queueDir, { recursive: true });
const queuePath = path.join(queueDir, `${approval.approvalId}.json`);

if (approval.status === 'approved') {
  approval.queue = {
    state: 'queued',
    queuedAt: approval.updatedAt,
    queuePath,
  };
  await fs.writeFile(queuePath, JSON.stringify({
    approvalId: approval.approvalId,
    shortCode: approval.shortCode,
    queuedAt: approval.updatedAt,
    actor,
    userId: approval.userId || null,
    customerName: approval.customerName || null,
    productName: approval.productName || null,
    inquiryType: approval.inquiryType || null,
    draft: approval.draft || null,
    meta: approval.meta || {},
    status: 'queued',
  }, null, 2), 'utf8');
} else {
  approval.queue = {
    state: 'not_queued',
    queuedAt: null,
    queuePath,
  };
  await fs.rm(queuePath, { force: true }).catch(() => {});
}

disableButtons(approval);
await fs.writeFile(targetPath, JSON.stringify(approval, null, 2), 'utf8');

const deliveryTrigger = approval.status === 'approved'
  ? await triggerDeliveryWorker()
  : { attempted: false, reason: 'status_not_approved' };

console.log(JSON.stringify({
  ok: true,
  approvalId: approval.approvalId,
  shortCode: approval.shortCode,
  status: approval.status,
  actor,
  note,
  file: targetPath,
  customerName: approval.customerName || null,
  productName: approval.productName || null,
  inquiryType: approval.inquiryType || null,
  draft: approval.draft || null,
  queueState: approval.queue?.state || null,
  queuePath,
  nextStep: approval.status === 'approved' ? 'queue_for_talktalk_delivery' : 'stop',
  deliveryTrigger,
}, null, 2));

function deriveShortCode(approvalId) {
  const m = String(approvalId || '').match(/local_apr_([a-z0-9]{6})/i);
  return m?.[1] || null;
}

function normalizeAction(value) {
  const map = {
    approve: { key: 'approve', label: '승인', status: 'approved' },
    approved: { key: 'approve', label: '승인', status: 'approved' },
    hold: { key: 'hold', label: '보류', status: 'held' },
    held: { key: 'hold', label: '보류', status: 'held' },
    revise: { key: 'revise', label: '수정요청', status: 'revision_requested' },
    revision_requested: { key: 'revise', label: '수정요청', status: 'revision_requested' },
  };
  return map[value] || null;
}

function disableButtons(approval) {
  const rowList = approval?.discordPayload?.components;
  if (!Array.isArray(rowList)) return;
  for (const row of rowList) {
    const buttons = row?.components;
    if (!Array.isArray(buttons)) continue;
    for (const button of buttons) {
      button.disabled = true;
    }
  }
}

async function triggerDeliveryWorker() {
  try {
    const { stdout, stderr } = await execFileAsync(openclawBin, ['cron', 'run', deliveryCronId], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 30000,
    });
    return {
      attempted: true,
      ok: true,
      cronId: deliveryCronId,
      stdout: String(stdout || '').trim() || null,
      stderr: String(stderr || '').trim() || null,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      cronId: deliveryCronId,
      error: error?.message || 'cron_run_failed',
      stdout: String(error?.stdout || '').trim() || null,
      stderr: String(error?.stderr || '').trim() || null,
    };
  }
}
