#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');
const outboxDir = process.env.NAVERTALK_LOCAL_OUTBOX_DIR || path.join(cwd, 'runtime-data', 'local-cs-discord-outbox');
const deliveryQueueDir = process.env.NAVERTALK_LOCAL_QUEUE_DIR || path.join(cwd, 'runtime-data', 'local-cs-delivery-queue');
const approvalChannelId = process.env.NAVERTALK_APPROVAL_CHANNEL_ID || '1488798405860786176';
const viewerToken = process.env.NAVERTALK_VIEWER_TOKEN || '';

await fs.mkdir(approvalsDir, { recursive: true });
await fs.mkdir(outboxDir, { recursive: true });
await fs.mkdir(deliveryQueueDir, { recursive: true });

const scanResult = await runApprovalScan();
const syncResult = await syncApprovalOutbox();
const deliveryQueue = await listJsonFiles(deliveryQueueDir);

console.log(JSON.stringify({
  ok: true,
  scanResult,
  syncResult,
  queuedDeliveryCount: deliveryQueue.length,
  queuedDeliveryFiles: deliveryQueue.map((item) => path.basename(item)),
}, null, 2));

async function runApprovalScan() {
  const env = {
    ...process.env,
    NAVERTALK_VIEWER_TOKEN: viewerToken,
  };
  try {
    const { stdout } = await execFileAsync('node', ['./scripts/navertalk-local-approval-scan.mjs'], { cwd, env });
    return safeJsonParse(stdout) || { ok: true, raw: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      stdout: error.stdout?.toString?.() || '',
      stderr: error.stderr?.toString?.() || '',
    };
  }
}

async function syncApprovalOutbox() {
  const approvalFiles = await listJsonFiles(approvalsDir);
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

    const outboxPath = path.join(outboxDir, `${approval.approvalId}.json`);
    const alreadyExists = await exists(outboxPath);
    if (alreadyExists) {
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
      payload: approval.discordPayload || buildFallbackPayload(approval),
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

  return {
    createdCount: created.length,
    created,
    skipped,
  };
}

function buildFallbackPayload(approval) {
  return {
    content: approval.discordMessage || `[${approval.approvalId}] ${approval.customerName || approval.userId}`,
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

async function listJsonFiles(dirPath) {
  const entries = await fs.readdir(dirPath).catch(() => []);
  return entries.filter((name) => name.endsWith('.json')).map((name) => path.join(dirPath, name));
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

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || '').trim());
  } catch {
    return null;
  }
}
