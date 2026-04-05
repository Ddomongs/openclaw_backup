import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
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
  nodeBin: process.env.NODE_BIN || '/opt/homebrew/bin/node',
  stateDir: process.env.OPENCLAW_STATE_DIR || '/Users/dh/.openclaw',
  workspaceDir: process.env.OPENCLAW_WORKSPACE_DIR || '/Users/dh/.openclaw/workspace',
};

CONFIG.agentsDir = path.join(CONFIG.stateDir, 'agents');
CONFIG.globalMemoryDir = path.join(CONFIG.stateDir, 'memory');
CONFIG.workspaceMemoryDir = path.join(CONFIG.workspaceDir, 'memory');
CONFIG.publicDir = __dirname;
CONFIG.indexFile = path.join(__dirname, 'index.html');

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

const primaryServer = http.createServer(handleRequest);
const tailscaleServers = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
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

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
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
    if (error && error.code === 'ENOENT') return fallback;
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
        sessionId: value?.sessionId || null,
        sessionFile: value?.sessionFile || null,
        sessionFileExists: Boolean(stat),
        sessionFileSize: stat?.size || 0,
        sessionFileSizeLabel: formatBytes(stat?.size || 0),
        updatedAt: value?.updatedAt || liveSession?.updatedAt || 0,
        updatedAtLabel: relativeTime(value?.updatedAt || liveSession?.updatedAt || 0),
        updatedAtIso: value?.updatedAt ? new Date(value.updatedAt).toISOString() : null,
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
        sessionsDir: store.sessionsDir,
        storePath: store.storePath,
      });
    }
  }

  all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return {
    stores,
    live,
    sessions: all,
  };
}

function inferKind(key = '') {
  if (key.includes(':cron:')) return 'cron';
  if (key.includes(':subagent:')) return 'subagent';
  if (key.includes(':channel:') || key.includes(':group:')) return 'group';
  return 'direct';
}

async function fetchLiveSessions() {
  try {
    const result = await runOpenClawJson([
      'gateway',
      'call',
      'sessions.list',
      '--json',
      '--params',
      '{}',
    ], { timeoutMs: 12000 });

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

async function runOpenClawJson(args, { timeoutMs = 10000 } = {}) {
  const { stdout, stderr } = await execFileAsync(CONFIG.openclawBin, args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
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

function queueMemoryReindex(agentId) {
  try {
    const child = spawn(
      CONFIG.openclawBin,
      ['memory', 'status', '--agent', agentId, '--deep', '--index'],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PATH: `${path.dirname(CONFIG.openclawBin)}:${process.env.PATH || ''}`,
        },
      },
    );
    child.unref();
    return { queued: true };
  } catch (error) {
    return { queued: false, error: String(error.message || error) };
  }
}

async function abortSessionRun(key) {
  try {
    return await runOpenClawJson([
      'gateway',
      'call',
      'chat.abort',
      '--json',
      '--params',
      JSON.stringify({ sessionKey: key }),
    ], { timeoutMs: 10000 });
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

async function gatewayDeleteSession(key) {
  try {
    return await runOpenClawJson([
      'gateway',
      'call',
      'sessions.delete',
      '--json',
      '--params',
      JSON.stringify({ key, deleteTranscript: true }),
    ], { timeoutMs: 15000 });
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
  if (!destinationName.includes('.deleted.')) {
    destinationName = `${basename}.deleted.${stamp}`;
  }
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
  if (!entry) {
    return { deleted: false, entry: null, archived: [] };
  }

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
  if (!parsed) {
    throw new Error('유효한 session key가 아닙니다.');
  }

  const storePath = path.join(CONFIG.agentsDir, parsed.agentId, 'sessions', 'sessions.json');
  const store = await readJson(storePath, {});
  const beforeEntry = store?.[key] || null;

  const abortResult = await abortSessionRun(key);
  const gatewayResult = await gatewayDeleteSession(key);

  let archived = [];
  if (Array.isArray(gatewayResult?.archived)) {
    for (const archivedPath of gatewayResult.archived) {
      if (await exists(archivedPath)) {
        archived.push(await moveToArchive(parsed.agentId, archivedPath));
      } else if (typeof archivedPath === 'string' && archivedPath.trim()) {
        archived.push(archivedPath);
      }
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
  const memory = didChange
    ? queueMemoryReindex(parsed.agentId)
    : { queued: false, skipped: true };

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

function parseBody(req) {
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

function getTailscaleInfo() {
  const result = spawnSync('tailscale', ['ip', '-4'], {
    encoding: 'utf8',
    timeout: 3000,
  });

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
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

async function getOverview() {
  const stored = await loadStoredSessions();
  const tailscale = getTailscaleInfo();
  const liveCount = stored.live.sessions.length;
  const storedCount = stored.sessions.length;
  const runningCount = stored.live.sessions.filter((session) => session.status === 'running').length;
  const archivedCount = await countArchivedFiles();

  return {
    now: new Date().toISOString(),
    host: CONFIG.host,
    port: CONFIG.port,
    localUrl: `http://${CONFIG.host}:${CONFIG.port}`,
    tailscale,
    paths: {
      stateDir: CONFIG.stateDir,
      workspaceDir: CONFIG.workspaceDir,
      agentsDir: CONFIG.agentsDir,
      globalMemoryDir: CONFIG.globalMemoryDir,
      workspaceMemoryDir: CONFIG.workspaceMemoryDir,
      mainSessionsJson: path.join(CONFIG.agentsDir, 'main', 'sessions', 'sessions.json'),
    },
    counts: {
      activeSessions: liveCount,
      runningSessions: runningCount,
      storedSessions: storedCount,
      archivedFiles: archivedCount,
      agents: stored.stores.length,
    },
    liveOk: stored.live.ok,
    liveError: stored.live.error || null,
  };
}

async function countArchivedFiles() {
  let total = 0;
  const stores = await listAgentStores();
  for (const store of stores) {
    const archiveRoot = path.join(store.sessionsDir, '_archive');
    total += await countFilesRecursive(archiveRoot);
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

async function serveStatic(req, res, pathname) {
  const target = pathname === '/' ? CONFIG.indexFile : path.join(CONFIG.publicDir, pathname.replace(/^\/+/, ''));
  const normalized = path.normalize(target);
  if (!normalized.startsWith(CONFIG.publicDir)) {
    return text(res, 403, 'Forbidden');
  }
  const stat = safeStatSync(normalized);
  if (!stat || !stat.isFile()) {
    return text(res, 404, 'Not found');
  }
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
        uptimeSec: Math.round(process.uptime()),
        pid: process.pid,
        now: new Date().toISOString(),
        host: CONFIG.host,
        port: CONFIG.port,
      });
    }

    if (req.method === 'GET' && pathname === '/api/overview') {
      return json(res, 200, await getOverview());
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      const scope = url.searchParams.get('scope') || 'all';
      const agent = url.searchParams.get('agent') || 'all';
      const status = url.searchParams.get('status') || 'all';
      const query = (url.searchParams.get('query') || '').trim().toLowerCase();
      const data = await loadStoredSessions();

      let items = data.sessions.map((session) => ({
        ...session,
        active: Boolean(session.live),
      }));

      if (scope === 'active') items = items.filter((session) => session.active);
      if (agent !== 'all') items = items.filter((session) => session.agentId === agent);
      if (status === 'running') items = items.filter((session) => session.liveStatus === 'running');
      if (status === 'idle') items = items.filter((session) => session.active && session.liveStatus !== 'running');
      if (status === 'stored') items = items.filter((session) => !session.active);
      if (query) {
        items = items.filter((session) => {
          const haystack = [
            session.key,
            session.displayName,
            session.model,
            session.lastChannel,
            session.origin?.label,
            session.origin?.from,
            session.origin?.to,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(query);
        });
      }

      return json(res, 200, {
        ok: true,
        scope,
        agent,
        status,
        query,
        liveOk: data.live.ok,
        liveError: data.live.error || null,
        agents: data.stores.map((store) => store.agentId),
        sessions: items,
      });
    }

    if (req.method === 'POST' && pathname === '/api/sessions/delete') {
      const body = await parseBody(req);
      const key = String(body?.key || '').trim();
      if (!key) {
        return json(res, 400, { ok: false, error: 'key가 필요합니다.' });
      }
      const result = await deleteSessionWorkflow(key);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      const stores = await listAgentStores();
      return json(res, 200, {
        ok: true,
        config: CONFIG,
        stores,
        tailscale: getTailscaleInfo(),
      });
    }

    return serveStatic(req, res, pathname);
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: String(error.message || error),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
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
      try {
        server.close();
      } catch {}
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
