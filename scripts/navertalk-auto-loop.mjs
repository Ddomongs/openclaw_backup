#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cwd = process.cwd();
const localConfigPath = path.join(cwd, 'runtime-data', 'navertalk-local-config.json');
const localConfig = await readJson(localConfigPath);
const approvalsDir = process.env.NAVERTALK_LOCAL_APPROVAL_DIR || path.join(cwd, 'runtime-data', 'local-cs-approvals');
const outboxDir = process.env.NAVERTALK_LOCAL_OUTBOX_DIR || path.join(cwd, 'runtime-data', 'local-cs-discord-outbox');
const deliveryQueueDir = process.env.NAVERTALK_LOCAL_QUEUE_DIR || path.join(cwd, 'runtime-data', 'local-cs-delivery-queue');
const approvalChannelId = process.env.NAVERTALK_APPROVAL_CHANNEL_ID || localConfig?.approvalChannelId || '1488798405860786176';
const viewerToken = process.env.NAVERTALK_VIEWER_TOKEN || localConfig?.viewerToken || '';

await fs.mkdir(approvalsDir, { recursive: true });
await fs.mkdir(outboxDir, { recursive: true });
await fs.mkdir(deliveryQueueDir, { recursive: true });

const scanResult = await runApprovalScan();
const syncResult = await runOutboxSync();
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

async function runOutboxSync() {
  try {
    const { stdout } = await execFileAsync('node', ['./scripts/navertalk-outbox-sync.mjs'], {
      cwd,
      env: {
        ...process.env,
        NAVERTALK_APPROVAL_CHANNEL_ID: approvalChannelId,
      },
    });
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
