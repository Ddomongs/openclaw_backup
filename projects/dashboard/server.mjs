import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  port: Number(process.env.PORT || 18888),
  host: process.env.HOST || '127.0.0.1',
  openclawBin: process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw',
  stateDir: process.env.OPENCLAW_STATE_DIR || '/Users/dh/.openclaw',
  workspaceDir: process.env.OPENCLAW_WORKSPACE_DIR || '/Users/dh/.openclaw/workspace',
};

CONFIG.agentsDir = path.join(CONFIG.stateDir, 'agents');
CONFIG.globalMemoryDir = path.join(CONFIG.stateDir, 'memory');
CONFIG.workspaceMemoryDir = path.join(CONFIG.workspaceDir, 'memory');
CONFIG.publicDir = __dirname;
CONFIG.indexFile = path.join(__dirname, 'index.html');
CONFIG.mainSessionsJson = path.join(CONFIG.agentsDir, 'main', 'sessions', 'sessions.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const CORE_PROMPT_FILES = ['SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'AGENTS.md', 'USER.md', 'HEARTBEAT.md'];
const CHANNEL_LABELS = {
  discord: 'Discord',
  webchat: 'WebChat',
  telegram: 'Telegram',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  signal: 'Signal',
  imessage: 'iMessage',
  cron: '크론',
  heartbeat: 'Heartbeat',
  unknown: '기타',
};

const primaryServer = http.createServer(handleRequest);
const tailscaleServers = new Map();
const cache = {
  dashboard: null,
  promise: null,
  ts: 0,
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target, fallback = null) {
  try {
    const raw = await fsp.readFile(target, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(target, data) {
  const dir = path.dirname(target);
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fsp.rename(temp, target);
}

function safeStatSync(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function formatBytes(value = 0) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function relativeTime(timestamp) {
  if (!timestamp) return '—';
  const diffMs = Number(timestamp) - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat('ko', { numeric: 'auto' });
  if (absMs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
  if (absMs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absMs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

function toIso(timestamp) {
  return timestamp ? new Date(Number(timestamp)).toISOString() : null;
}

function sanitizeText(value, maxLength = 220) {
  const compact = String(value || '')
    .replace(/```[\s\S]*?```/g, '[코드블럭 생략]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function sum(numbers) {
  return numbers.reduce((acc, value) => acc + (Number(value) || 0), 0);
}

function parseSessionKey(key = '') {
  const parts = String(key).split(':');
  if (parts.length < 3 || parts[0] !== 'agent') return null;
  return {
    key,
    agentId: parts[1],
    tail: parts.slice(2).join(':'),
  };
}

function inferKind(key = '') {
  if (key.includes(':cron:')) return 'cron';
  if (key.includes(':subagent:')) return 'subagent';
  if (key.includes(':channel:') || key.includes(':group:')) return 'group';
  return 'direct';
}

function detectChannel(session) {
  if (session.kind === 'cron' || session.key.includes(':cron:')) return 'cron';
  return session.lastChannel || session.live?.channel || session.origin?.provider || 'unknown';
}

function channelLabel(channel) {
  return CHANNEL_LABELS[channel] || channel || '기타';
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('요청 본문이 너무 큽니다.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON 본문 파싱 실패'));
      }
    });
    req.on('error', reject);
  });
}

async function runOpenClawJson(args, { timeoutMs = 12000 } = {}) {
  const { stdout, stderr } = await execFileAsync(CONFIG.openclawBin, args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: `${path.dirname(CONFIG.openclawBin)}:${process.env.PATH || ''}`,
    },
  });

  const raw = `${stdout}`.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`JSON parse 실패: ${stderr || raw}`);
  }
}

async function callGateway(method, params = {}, timeoutMs = 12000) {
  return runOpenClawJson([
    'gateway',
    'call',
    method,
    '--json',
    '--params',
    JSON.stringify(params),
  ], { timeoutMs });
}

async function listAgentStores() {
  let entries = [];
  try {
    entries = await fsp.readdir(CONFIG.agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const stores = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const sessionsDir = path.join(CONFIG.agentsDir, agentId, 'sessions');
    const storePath = path.join(sessionsDir, 'sessions.json');
    if (await exists(storePath)) {
      stores.push({ agentId, sessionsDir, storePath });
    }
  }
  stores.sort((a, b) => a.agentId.localeCompare(b.agentId));
  return stores;
}

async function fetchLiveSessions() {
  try {
    const result = await callGateway('sessions.list', { limit: 500 }, 15000);
    return {
      ok: true,
      count: result?.count || 0,
      defaults: result?.defaults || null,
      sessions: Array.isArray(result?.sessions) ? result.sessions : [],
    };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      defaults: null,
      sessions: [],
      error: String(error.message || error),
    };
  }
}

async function fetchCronJobs() {
  try {
    const result = await callGateway('cron.list', { limit: 200 }, 15000);
    return Array.isArray(result?.jobs) ? result.jobs : [];
  } catch {
    return [];
  }
}

async function fetchCronRuns() {
  try {
    const result = await callGateway('cron.runs', { limit: 80 }, 15000);
    return Array.isArray(result?.entries) ? result.entries : [];
  } catch {
    return [];
  }
}

async function fetchConfigSummary() {
  try {
    const result = await callGateway('config.get', {}, 15000);
    const parsed = result?.parsed || result?.resolved || {};
    const defaults = parsed?.agents?.defaults || {};
    const list = Array.isArray(parsed?.agents?.list) ? parsed.agents.list : [];
    return {
      gateway: {
        port: parsed?.gateway?.port || null,
        bind: parsed?.gateway?.bind || null,
        mode: parsed?.gateway?.mode || null,
        tailscaleMode: parsed?.gateway?.tailscale?.mode || 'off',
      },
      tools: {
        profile: parsed?.tools?.profile || null,
      },
      browser: {
        defaultProfile: parsed?.browser?.defaultProfile || null,
      },
      defaults: {
        model: defaults?.model?.primary || null,
        workspace: defaults?.workspace || null,
        timeoutSeconds: defaults?.timeoutSeconds || null,
      },
      agents: list.map((entry) => ({
        id: entry.id,
        name: entry.name || null,
        workspace: entry.workspace || null,
        agentDir: entry.agentDir || null,
        identityName: entry?.identity?.name || null,
        identityEmoji: entry?.identity?.emoji || null,
      })),
      bindings: Array.isArray(parsed?.bindings)
        ? parsed.bindings.map((binding) => ({
            type: binding?.type || null,
            agentId: binding?.agentId || null,
            match: binding?.match || null,
          }))
        : [],
    };
  } catch {
    return {
      gateway: { port: null, bind: null, mode: null, tailscaleMode: 'off' },
      tools: { profile: null },
      browser: { defaultProfile: null },
      defaults: { model: null, workspace: CONFIG.workspaceDir, timeoutSeconds: null },
      agents: [],
      bindings: [],
    };
  }
}

async function readTailJsonObjects(filePath, maxBytes = 64 * 1024, maxLines = 120) {
  const stat = safeStatSync(filePath);
  if (!stat?.isFile()) return [];
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let raw = buffer.toString('utf8');
    if (start > 0) {
      const firstBreak = raw.indexOf('\n');
      raw = firstBreak >= 0 ? raw.slice(firstBreak + 1) : '';
    }
    const lines = raw.split(/\r?\n/).filter(Boolean).slice(-maxLines);
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // ignore partial lines
      }
    }
    return parsed;
  } finally {
    await handle.close();
  }
}

function extractContentText(content) {
  if (typeof content === 'string') return sanitizeText(content, 400);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) parts.push(block.text);
    if (block.type === 'input_text' && block.text) parts.push(block.text);
    if (block.type === 'output_text' && block.text) parts.push(block.text);
  }
  return sanitizeText(parts.join(' '), 400);
}

function normalizeTranscriptEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const baseTimestamp = entry?.message?.timestamp || entry?.timestamp || 0;

  if (entry.type === 'message' && entry.message) {
    const role = entry.message.role || 'unknown';
    const text = extractContentText(entry.message.content);
    const toolName = entry.message.toolName || null;
    const isError = Boolean(entry.message.isError || entry.message?.details?.exitCode);
    const displayRole = role === 'toolResult' ? (isError ? 'error' : 'tool') : role;
    if (!text && !toolName) return null;
    return {
      role: displayRole,
      text: text || `${toolName || 'tool'} 결과`,
      timestamp: baseTimestamp,
      iso: toIso(baseTimestamp),
      toolName,
      isError,
    };
  }

  if (entry.type === 'custom' && entry.customType === 'system') {
    return {
      role: 'system',
      text: sanitizeText(entry?.data?.text || entry?.data?.message || '', 240),
      timestamp: baseTimestamp,
      iso: toIso(baseTimestamp),
      isError: false,
    };
  }

  return null;
}

async function getSessionDigest(filePath) {
  const parsed = await readTailJsonObjects(filePath, 96 * 1024, 160);
  const recent = [];
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeTranscriptEntry(parsed[index]);
    if (!normalized) continue;
    if (normalized.role === 'tool' && !normalized.isError) continue;
    recent.unshift(normalized);
    if (recent.length >= 8) break;
  }

  const previewSource = [...recent].reverse().find((entry) => entry.role === 'assistant' || entry.role === 'user' || entry.role === 'error') || recent.at(-1) || null;
  const lastUser = [...recent].reverse().find((entry) => entry.role === 'user') || null;
  const lastAssistant = [...recent].reverse().find((entry) => entry.role === 'assistant') || null;
  const lastError = [...recent].reverse().find((entry) => entry.role === 'error') || null;

  return {
    preview: previewSource?.text || '',
    previewRole: previewSource?.role || null,
    recentMessages: recent,
    lastUserText: lastUser?.text || '',
    lastAssistantText: lastAssistant?.text || '',
    lastErrorText: lastError?.text || '',
  };
}

async function loadStoredSessions() {
  const stores = await listAgentStores();
  const live = await fetchLiveSessions();
  const liveMap = new Map(live.sessions.map((session) => [session.key, session]));
  const all = [];

  for (const store of stores) {
    const raw = await readJson(store.storePath, {});
    const entries = Object.entries(raw || {});
    for (const [key, value] of entries) {
      const stat = safeStatSync(value?.sessionFile);
      const liveSession = liveMap.get(key);
      all.push({
        key,
        agentId: store.agentId,
        sessionId: value?.sessionId || liveSession?.sessionId || null,
        sessionFile: value?.sessionFile || null,
        sessionFileExists: Boolean(stat),
        sessionFileSize: stat?.size || 0,
        sessionFileSizeLabel: formatBytes(stat?.size || 0),
        updatedAt: value?.updatedAt || liveSession?.updatedAt || 0,
        updatedAtLabel: relativeTime(value?.updatedAt || liveSession?.updatedAt || 0),
        updatedAtIso: toIso(value?.updatedAt || liveSession?.updatedAt || 0),
        model: value?.model || liveSession?.model || null,
        modelProvider: liveSession?.modelProvider || null,
        chatType: value?.chatType || liveSession?.chatType || null,
        lastChannel: value?.lastChannel || liveSession?.channel || value?.origin?.provider || null,
        origin: value?.origin || liveSession?.origin || null,
        deliveryContext: value?.deliveryContext || liveSession?.deliveryContext || null,
        compactionCount: value?.compactionCount ?? null,
        live: liveSession || null,
        liveStatus: liveSession?.status || null,
        displayName: liveSession?.displayName || value?.origin?.label || key,
        kind: liveSession?.kind || inferKind(key),
        totalTokens: liveSession?.totalTokens ?? null,
        estimatedCostUsd: liveSession?.estimatedCostUsd ?? null,
        startedAt: liveSession?.startedAt || null,
        endedAt: liveSession?.endedAt || null,
        sessionsDir: store.sessionsDir,
        storePath: store.storePath,
      });
    }
  }

  all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const digestTargets = all.filter((session, index) => session.live || index < 40);
  const digestMap = new Map();
  await Promise.all(digestTargets.map(async (session) => {
    if (!session.sessionFile || !(await exists(session.sessionFile))) return;
    digestMap.set(session.sessionFile, await getSessionDigest(session.sessionFile));
  }));

  for (const session of all) {
    const digest = digestMap.get(session.sessionFile) || {
      preview: '',
      previewRole: null,
      recentMessages: [],
      lastUserText: '',
      lastAssistantText: '',
      lastErrorText: '',
    };
    Object.assign(session, digest, {
      active: Boolean(session.live),
      channelKey: detectChannel(session),
      channelLabel: channelLabel(detectChannel(session)),
    });
  }

  return { stores, live, sessions: all };
}

async function readWorkspaceCoreFiles(workspaceDir) {
  const files = [];
  for (const fileName of CORE_PROMPT_FILES) {
    const filePath = path.join(workspaceDir, fileName);
    let existsFlag = false;
    let content = '';
    try {
      content = await fsp.readFile(filePath, 'utf8');
      existsFlag = true;
    } catch {
      existsFlag = false;
      content = '';
    }
    files.push({
      name: fileName,
      path: filePath,
      exists: existsFlag,
      content: existsFlag ? content : '',
      excerpt: existsFlag ? sanitizeText(content, 200) : '(파일 없음)',
    });
  }
  return files;
}

function inferAgentName(agentId, entry, workspaceFiles = []) {
  if (entry?.identityName) return entry.identityName;
  if (entry?.name) return entry.name;
  if (agentId === 'main') {
    const identity = workspaceFiles.find((file) => file.name === 'IDENTITY.md' && file.exists)?.content || '';
    const match = identity.match(/##\s*Name\s+([^\n]+)/m);
    if (match?.[1]) return sanitizeText(match[1], 50).replace(/\s*\([^)]*\)/g, '').trim();
    return '또몽이';
  }
  return agentId;
}

function inferAgentEmoji(agentId, entry, workspaceFiles = []) {
  if (entry?.identityEmoji) return entry.identityEmoji;
  const identity = workspaceFiles.find((file) => file.name === 'IDENTITY.md' && file.exists)?.content || '';
  const emojiMatch = identity.match(/[\u{1F300}-\u{1FAFF}]/u);
  if (emojiMatch?.[0]) return emojiMatch[0];
  if (agentId === 'main') return '🐶';
  if (agentId === 'blogbot') return '📝';
  return '🤖';
}

function workspaceFromConfig(agentId, configSummary) {
  const entry = configSummary.agents.find((item) => item.id === agentId);
  return entry?.workspace || configSummary.defaults.workspace || CONFIG.workspaceDir;
}

function modelFromConfig(agentId, configSummary) {
  const entry = configSummary.agents.find((item) => item.id === agentId);
  return entry?.model || configSummary.defaults.model || null;
}

function inferCronJobAgent(job, runs = []) {
  const run = runs.find((entry) => entry.jobId === job.id && typeof entry.sessionKey === 'string');
  const parsed = parseSessionKey(run?.sessionKey || '');
  return parsed?.agentId || 'main';
}

function statusFromCron(job, activeCronSessionMap) {
  if (!job.enabled) return 'disabled';
  if ((job?.state?.consecutiveErrors || 0) > 0 || job?.state?.lastStatus === 'error' || job?.state?.lastRunStatus === 'error') return 'error';
  if (activeCronSessionMap.has(job.id)) return 'running';
  return 'ok';
}

function makeActivityItem({ timestamp, kind, title, body, agentId, channel, status, ref }) {
  return {
    timestamp: Number(timestamp) || 0,
    iso: toIso(timestamp),
    relative: relativeTime(timestamp),
    kind,
    title,
    body: sanitizeText(body, 260),
    agentId,
    channel,
    status,
    ref,
  };
}

function buildActivities(sessions, cronRuns, agentMap) {
  const items = [];

  for (const run of cronRuns.slice(0, 40)) {
    const agentId = parseSessionKey(run.sessionKey || '')?.agentId || 'main';
    const agentName = agentMap.get(agentId)?.name || agentId;
    items.push(makeActivityItem({
      timestamp: run.ts || run.runAtMs,
      kind: 'cron',
      title: `${run.jobName || '크론 작업'} · ${run.status || 'unknown'}`,
      body: run.summary || `${agentName} 에이전트가 크론 작업을 실행했습니다.`,
      agentId,
      channel: 'cron',
      status: run.status || 'ok',
      ref: run.jobId,
    }));
  }

  for (const session of sessions.filter((item) => item.active).slice(0, 30)) {
    const agentName = agentMap.get(session.agentId)?.name || session.agentId;
    if (session.preview) {
      items.push(makeActivityItem({
        timestamp: session.updatedAt,
        kind: 'session',
        title: `${agentName} · ${session.displayName || session.key}`,
        body: session.preview,
        agentId: session.agentId,
        channel: session.channelKey,
        status: session.liveStatus || (session.active ? 'active' : 'stored'),
        ref: session.key,
      }));
    }
    if (session.lastErrorText) {
      items.push(makeActivityItem({
        timestamp: session.updatedAt,
        kind: 'error',
        title: `${agentName} · 세션 오류`,
        body: session.lastErrorText,
        agentId: session.agentId,
        channel: session.channelKey,
        status: 'error',
        ref: session.key,
      }));
    }
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items.slice(0, 120);
}

async function countArchivedFiles() {
  const stores = await listAgentStores();
  let total = 0;
  for (const store of stores) {
    total += await countFilesRecursive(path.join(store.sessionsDir, '_archive'));
  }
  return total;
}

async function countFilesRecursive(root) {
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) total += await countFilesRecursive(full);
      else if (entry.isFile()) total += 1;
    }
    return total;
  } catch {
    return 0;
  }
}

function getTailscaleInfo() {
  const result = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 3000 });
  if (result.error && result.error.code === 'ENOENT') {
    return { installed: false, active: false, ips: [], urls: [] };
  }
  const ips = `${result.stdout || ''}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    installed: !result.error,
    active: ips.length > 0,
    ips,
    urls: ips.map((ip) => `http://${ip}:${CONFIG.port}`),
  };
}

function queueMemoryReindex(agentId) {
  try {
    const child = spawn(CONFIG.openclawBin, ['memory', 'status', '--agent', agentId, '--deep', '--index'], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PATH: `${path.dirname(CONFIG.openclawBin)}:${process.env.PATH || ''}`,
      },
    });
    child.unref();
    return { queued: true };
  } catch (error) {
    return { queued: false, error: String(error.message || error) };
  }
}

async function abortSessionRun(key) {
  try {
    return await callGateway('chat.abort', { sessionKey: key }, 10000);
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

async function gatewayDeleteSession(key) {
  try {
    return await callGateway('sessions.delete', { key, deleteTranscript: true }, 15000);
  } catch (error) {
    return { ok: false, error: String(error.message || error), deleted: false, archived: [] };
  }
}

async function moveToArchive(agentId, sourcePath) {
  if (!sourcePath) return null;
  const basename = path.basename(sourcePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveDir = path.join(CONFIG.agentsDir, agentId, 'sessions', '_archive', stamp.slice(0, 7));
  await fsp.mkdir(archiveDir, { recursive: true });

  let destinationName = basename;
  if (!destinationName.includes('.deleted.')) destinationName = `${basename}.deleted.${stamp}`;
  let destination = path.join(archiveDir, destinationName);
  let counter = 1;
  while (await exists(destination)) {
    destination = path.join(archiveDir, `${destinationName}.${counter}`);
    counter += 1;
  }
  await fsp.rename(sourcePath, destination);
  return destination;
}

async function manualDeleteFromStore(agentId, key) {
  const storePath = path.join(CONFIG.agentsDir, agentId, 'sessions', 'sessions.json');
  const store = await readJson(storePath, {});
  const entry = store?.[key];
  if (!entry) return { deleted: false, entry: null, archived: [] };

  delete store[key];
  await writeJsonAtomic(storePath, store);

  const archived = [];
  if (entry.sessionFile && await exists(entry.sessionFile)) {
    archived.push(await moveToArchive(agentId, entry.sessionFile));
  }

  return { deleted: true, entry, archived };
}

async function deleteSessionWorkflow(key) {
  const parsed = parseSessionKey(key);
  if (!parsed) throw new Error('유효한 session key가 아닙니다.');

  const storePath = path.join(CONFIG.agentsDir, parsed.agentId, 'sessions', 'sessions.json');
  const store = await readJson(storePath, {});
  const beforeEntry = store?.[key] || null;

  const abortResult = await abortSessionRun(key);
  const gatewayResult = await gatewayDeleteSession(key);

  let archived = [];
  if (Array.isArray(gatewayResult?.archived)) {
    for (const archivedPath of gatewayResult.archived) {
      if (await exists(archivedPath)) archived.push(await moveToArchive(parsed.agentId, archivedPath));
    }
  }

  let fallback = null;
  if (!gatewayResult?.deleted) {
    fallback = await manualDeleteFromStore(parsed.agentId, key);
    archived = archived.concat(fallback.archived || []);
  } else if (beforeEntry?.sessionFile && await exists(beforeEntry.sessionFile)) {
    archived.push(await moveToArchive(parsed.agentId, beforeEntry.sessionFile));
  }

  const didChange = Boolean(gatewayResult?.deleted || fallback?.deleted || archived.length);
  const memory = didChange ? queueMemoryReindex(parsed.agentId) : { queued: false, skipped: true };
  cache.dashboard = null;
  cache.ts = 0;

  return {
    ok: true,
    key,
    agentId: parsed.agentId,
    gateway: gatewayResult,
    abort: abortResult,
    fallback,
    archived: archived.filter(Boolean),
    memory,
  };
}

async function buildDashboardData() {
  const [configSummary, stored, cronJobsRaw, cronRuns, archivedCount] = await Promise.all([
    fetchConfigSummary(),
    loadStoredSessions(),
    fetchCronJobs(),
    fetchCronRuns(),
    countArchivedFiles(),
  ]);

  const liveSessions = stored.sessions.filter((session) => session.active);
  const activeCronSessionMap = new Map(
    liveSessions
      .filter((session) => session.key.includes(':cron:'))
      .map((session) => {
        const match = session.key.match(/:cron:([^:]+)/);
        return [match?.[1], session];
      })
      .filter((entry) => entry[0]),
  );

  const cronJobs = cronJobsRaw.map((job) => {
    const agentId = inferCronJobAgent(job, cronRuns);
    const latestRun = cronRuns.find((entry) => entry.jobId === job.id);
    return {
      id: job.id,
      name: job.name,
      description: sanitizeText(job.description || '', 180),
      enabled: Boolean(job.enabled),
      agentId,
      schedule: {
        kind: job?.schedule?.kind || 'cron',
        expr: job?.schedule?.expr || '',
        tz: job?.schedule?.tz || 'Asia/Seoul',
      },
      nextRunAtMs: job?.state?.nextRunAtMs || latestRun?.nextRunAtMs || null,
      nextRunLabel: relativeTime(job?.state?.nextRunAtMs || latestRun?.nextRunAtMs || 0),
      lastRunAtMs: job?.state?.lastRunAtMs || latestRun?.runAtMs || null,
      lastRunLabel: relativeTime(job?.state?.lastRunAtMs || latestRun?.runAtMs || 0),
      lastStatus: job?.state?.lastStatus || job?.state?.lastRunStatus || latestRun?.status || 'unknown',
      consecutiveErrors: job?.state?.consecutiveErrors || 0,
      durationMs: job?.state?.lastDurationMs || latestRun?.durationMs || null,
      deliveryStatus: job?.state?.lastDeliveryStatus || latestRun?.deliveryStatus || null,
      status: statusFromCron(job, activeCronSessionMap),
      latestSummary: sanitizeText(latestRun?.summary || '', 220),
      latestUsageTokens: latestRun?.usage?.total_tokens || null,
    };
  });

  const allAgentIds = new Set([
    ...configSummary.agents.map((agent) => agent.id),
    ...stored.stores.map((store) => store.agentId),
    ...cronJobs.map((job) => job.agentId),
  ]);

  const agentMap = new Map();
  const agents = [];
  for (const agentId of [...allAgentIds].sort()) {
    const configEntry = configSummary.agents.find((item) => item.id === agentId) || null;
    const workspace = workspaceFromConfig(agentId, configSummary);
    const workspaceFiles = await readWorkspaceCoreFiles(workspace);
    const sessions = stored.sessions.filter((session) => session.agentId === agentId);
    const activeSessions = sessions.filter((session) => session.active);
    const runningSessions = activeSessions.filter((session) => session.liveStatus === 'running');
    const jobs = cronJobs.filter((job) => job.agentId === agentId);
    const runs = cronRuns.filter((run) => parseSessionKey(run.sessionKey || '')?.agentId === agentId);

    const name = inferAgentName(agentId, configEntry, workspaceFiles);
    const emoji = inferAgentEmoji(agentId, configEntry, workspaceFiles);
    const latestTouch = Math.max(
      ...sessions.map((session) => session.updatedAt || 0),
      ...runs.map((run) => run.ts || run.runAtMs || 0),
      0,
    );
    const bindings = configSummary.bindings.filter((binding) => binding.agentId === agentId);
    const status = runningSessions.length > 0 ? 'running' : activeSessions.length > 0 ? 'active' : 'idle';

    const agent = {
      id: agentId,
      name,
      emoji,
      workspace,
      model: modelFromConfig(agentId, configSummary),
      timeoutSeconds: configSummary.defaults.timeoutSeconds || null,
      toolsProfile: configSummary.tools.profile || null,
      bindings,
      status,
      lastTouchedAt: latestTouch || null,
      lastTouchedLabel: relativeTime(latestTouch || 0),
      counts: {
        storedSessions: sessions.length,
        activeSessions: activeSessions.length,
        runningSessions: runningSessions.length,
        cronJobs: jobs.length,
        errorCrons: jobs.filter((job) => job.status === 'error').length,
        totalTokens: sum(activeSessions.map((session) => session.totalTokens || 0)),
      },
      promptFiles: workspaceFiles.map((file) => ({
        name: file.name,
        exists: file.exists,
        excerpt: file.excerpt,
        content: file.content,
        path: file.path,
      })),
      recentWork: {
        running: runningSessions.slice(0, 6).map((session) => ({
          type: 'session',
          title: session.displayName || session.key,
          subtitle: session.preview || session.lastUserText || session.lastAssistantText || '(미리보기 없음)',
          updatedAt: session.updatedAt,
          updatedLabel: session.updatedAtLabel,
          channel: session.channelLabel,
          key: session.key,
        })),
        scheduled: jobs.slice(0, 8).map((job) => ({
          type: 'cron',
          title: job.name,
          subtitle: job.description || job.schedule.expr,
          status: job.status,
          nextRunLabel: job.nextRunLabel,
          key: job.id,
        })),
        completed: runs.slice(0, 8).map((run) => ({
          type: 'run',
          title: run.jobName,
          subtitle: sanitizeText(run.summary || `${run.status} · ${relativeTime(run.ts || run.runAtMs)}`, 180),
          status: run.status,
          updatedAt: run.ts || run.runAtMs,
          updatedLabel: relativeTime(run.ts || run.runAtMs),
          key: run.sessionKey,
        })),
      },
    };

    agents.push(agent);
    agentMap.set(agentId, agent);
  }

  const channels = [];
  const grouped = new Map();
  for (const session of liveSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const key = session.channelKey;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }
  for (const [key, sessions] of grouped.entries()) {
    channels.push({
      key,
      label: channelLabel(key),
      count: sessions.length,
      updatedAt: Math.max(...sessions.map((session) => session.updatedAt || 0), 0),
      updatedLabel: relativeTime(Math.max(...sessions.map((session) => session.updatedAt || 0), 0)),
      sessions: sessions.slice(0, 24).map((session) => ({
        key: session.key,
        sessionId: session.sessionId,
        displayName: session.displayName || session.key,
        preview: session.preview || session.lastUserText || session.lastAssistantText || '(미리보기 없음)',
        previewRole: session.previewRole,
        updatedAt: session.updatedAt,
        updatedLabel: session.updatedAtLabel,
        totalTokens: session.totalTokens,
        estimatedCostUsd: session.estimatedCostUsd,
        liveStatus: session.liveStatus || 'active',
        agentId: session.agentId,
        agentName: agentMap.get(session.agentId)?.name || session.agentId,
        agentEmoji: agentMap.get(session.agentId)?.emoji || '🤖',
        channelLabel: session.channelLabel,
        recentMessages: session.recentMessages || [],
      })),
    });
  }
  channels.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const activities = buildActivities(stored.sessions, cronRuns, agentMap);

  const overview = {
    now: new Date().toISOString(),
    localUrl: `http://${CONFIG.host}:${CONFIG.port}`,
    tailscale: getTailscaleInfo(),
    paths: {
      stateDir: CONFIG.stateDir,
      workspaceDir: CONFIG.workspaceDir,
      agentsDir: CONFIG.agentsDir,
      memoryDir: CONFIG.globalMemoryDir,
      workspaceMemoryDir: CONFIG.workspaceMemoryDir,
      mainSessionsJson: CONFIG.mainSessionsJson,
    },
    counts: {
      agents: agents.length,
      activeSessions: liveSessions.length,
      runningSessions: liveSessions.filter((session) => session.liveStatus === 'running').length,
      storedSessions: stored.sessions.length,
      cronJobs: cronJobs.length,
      cronErrors: cronJobs.filter((job) => job.status === 'error').length,
      cronDisabled: cronJobs.filter((job) => !job.enabled).length,
      archivedFiles: archivedCount,
      activeTokens: sum(liveSessions.map((session) => session.totalTokens || 0)),
    },
    liveOk: stored.live.ok,
    liveError: stored.live.error || null,
    gateway: configSummary.gateway,
    browser: configSummary.browser,
    tools: configSummary.tools,
    channels,
    errorCrons: cronJobs.filter((job) => job.status === 'error').slice(0, 20),
    activities: activities.slice(0, 30),
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    overview,
    sidebar: {
      overviewCount: liveSessions.length,
      sessionsCount: stored.sessions.length,
      cronCount: cronJobs.length,
      activityCount: activities.length,
    },
    sessions: stored.sessions.map((session) => ({
      key: session.key,
      sessionId: session.sessionId,
      agentId: session.agentId,
      agentName: agentMap.get(session.agentId)?.name || session.agentId,
      agentEmoji: agentMap.get(session.agentId)?.emoji || '🤖',
      displayName: session.displayName || session.key,
      preview: session.preview || session.lastUserText || session.lastAssistantText || '(미리보기 없음)',
      previewRole: session.previewRole,
      lastErrorText: session.lastErrorText || '',
      updatedAt: session.updatedAt,
      updatedAtIso: session.updatedAtIso,
      updatedAtLabel: session.updatedAtLabel,
      model: session.model,
      modelProvider: session.modelProvider,
      chatType: session.chatType,
      channelKey: session.channelKey,
      channelLabel: session.channelLabel,
      kind: session.kind,
      active: session.active,
      liveStatus: session.liveStatus,
      totalTokens: session.totalTokens,
      estimatedCostUsd: session.estimatedCostUsd,
      sessionFile: session.sessionFile,
      sessionFileExists: session.sessionFileExists,
      sessionFileSizeLabel: session.sessionFileSizeLabel,
      recentMessages: session.recentMessages || [],
      origin: session.origin,
    })),
    cronJobs,
    activities,
    agents,
  };
}

async function getDashboardData(force = false) {
  if (!force && cache.dashboard && Date.now() - cache.ts < 5000) return cache.dashboard;
  if (cache.promise) return cache.promise;
  cache.promise = buildDashboardData()
    .then((data) => {
      cache.dashboard = data;
      cache.ts = Date.now();
      cache.promise = null;
      return data;
    })
    .catch((error) => {
      cache.promise = null;
      throw error;
    });
  return cache.promise;
}

async function serveStatic(res, pathname) {
  const target = pathname === '/' ? CONFIG.indexFile : path.join(CONFIG.publicDir, pathname.replace(/^\/+/, ''));
  const normalized = path.normalize(target);
  if (!normalized.startsWith(CONFIG.publicDir)) return text(res, 403, 'Forbidden');
  const stat = safeStatSync(normalized);
  if (!stat?.isFile()) return text(res, 404, 'Not found');
  const ext = path.extname(normalized).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300',
  });
  fs.createReadStream(normalized).pipe(res);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `${CONFIG.host}:${CONFIG.port}`}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        now: new Date().toISOString(),
        host: CONFIG.host,
        port: CONFIG.port,
      });
    }

    if (req.method === 'GET' && pathname === '/api/dashboard') {
      const force = url.searchParams.get('force') === '1';
      return json(res, 200, await getDashboardData(force));
    }

    if (req.method === 'POST' && pathname === '/api/sessions/delete') {
      const body = await parseBody(req);
      const key = String(body?.key || '').trim();
      if (!key) return json(res, 400, { ok: false, error: 'key가 필요합니다.' });
      return json(res, 200, await deleteSessionWorkflow(key));
    }

    return serveStatic(res, pathname);
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: String(error.message || error),
    });
  }
}

async function bindPrimary() {
  await new Promise((resolve, reject) => {
    primaryServer.once('error', reject);
    primaryServer.listen(CONFIG.port, CONFIG.host, () => {
      primaryServer.off('error', reject);
      resolve();
    });
  });
  log(`Dashboard ready → http://${CONFIG.host}:${CONFIG.port}`);
}

async function reconcileTailscaleBindings() {
  const info = getTailscaleInfo();
  const wanted = new Set(info.ips);

  for (const [ip, server] of tailscaleServers.entries()) {
    if (wanted.has(ip)) continue;
    await new Promise((resolve) => server.close(resolve));
    tailscaleServers.delete(ip);
    log(`Tailscale listener removed → ${ip}:${CONFIG.port}`);
  }

  for (const ip of wanted) {
    if (tailscaleServers.has(ip)) continue;
    const server = http.createServer(handleRequest);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(CONFIG.port, ip, () => {
          server.off('error', reject);
          resolve();
        });
      });
      tailscaleServers.set(ip, server);
      log(`Tailscale listener ready → http://${ip}:${CONFIG.port}`);
    } catch (error) {
      log(`Tailscale listener bind 실패 (${ip}:${CONFIG.port}) → ${String(error.message || error)}`);
      try { server.close(); } catch {}
    }
  }
}

async function main() {
  await bindPrimary();
  await reconcileTailscaleBindings();
  setInterval(() => {
    reconcileTailscaleBindings().catch((error) => {
      log('Tailscale reconcile error:', String(error.message || error));
    });
  }, 60_000).unref();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
