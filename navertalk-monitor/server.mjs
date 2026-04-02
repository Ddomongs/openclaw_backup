import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  host: process.env.NAVERTALK_HOST || '127.0.0.1',
  port: Number(process.env.NAVERTALK_PORT || 3187),
  webhookPath: process.env.NAVERTALK_WEBHOOK_PATH || '/webhook/navertalk',
  dataDir: process.env.NAVERTALK_DATA_DIR || path.join(__dirname, '..', 'runtime-data', 'navertalk-monitor'),
  webhookToken: process.env.NAVERTALK_WEBHOOK_TOKEN || '',
  viewerToken: process.env.NAVERTALK_VIEWER_TOKEN || '',
  maxBodyBytes: Number(process.env.NAVERTALK_MAX_BODY_BYTES || 1024 * 1024),
};

const paths = {
  root: config.dataDir,
  cards: path.join(config.dataDir, 'cards'),
  events: path.join(config.dataDir, 'events'),
  state: path.join(config.dataDir, 'state.json'),
};

await ensureDirs();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'navertalk-monitor', now: new Date().toISOString() });
    }

    if (req.method === 'POST' && url.pathname === config.webhookPath) {
      if (!isAuthorizedWebhook(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_webhook' });
      }

      const payload = await readJsonBody(req, config.maxBodyBytes);
      const receivedAt = new Date().toISOString();
      const normalized = normalizeEvent(payload, receivedAt);

      await appendRawEvent({
        receivedAt,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: pickHeaders(req.headers, ['user-agent', 'content-type', 'x-forwarded-for']),
        normalized,
        payload,
      });

      await upsertCard(normalized, payload);

      return sendJson(res, 200, {
        ok: true,
        stored: true,
        userId: normalized.userId,
        event: normalized.event,
        receivedAt,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/cards') {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const cards = await listCards();
      const filtered = q
        ? cards.filter((card) => {
            const haystack = [
              card.userId,
              card.partnerId,
              card.lastMessageText,
              card.lastMessageSummary,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return haystack.includes(q);
          })
        : cards;

      return sendJson(res, 200, { ok: true, count: filtered.length, cards: filtered });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/cards/')) {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const encodedUserId = url.pathname.slice('/api/cards/'.length);
      const userId = decodeURIComponent(encodedUserId);
      const card = await readCard(userId);
      if (!card) {
        return sendJson(res, 404, { ok: false, error: 'card_not_found', userId });
      }
      return sendJson(res, 200, { ok: true, card });
    }

    if (req.method === 'GET' && url.pathname === '/cards') {
      if (!isAuthorizedViewer(req, url)) {
        return sendHtml(res, 401, renderUnauthorizedPage());
      }
      return sendHtml(res, 200, renderViewerHtml(url));
    }

    sendJson(res, 404, {
      ok: false,
      error: 'not_found',
      webhookPath: config.webhookPath,
    });
  } catch (error) {
    console.error('[navertalk-monitor] request error', error);
    sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'internal_error',
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[navertalk-monitor] listening on http://${config.host}:${config.port}`);
  console.log(`[navertalk-monitor] webhook path: ${config.webhookPath}`);
  console.log(`[navertalk-monitor] data dir: ${config.dataDir}`);
});

async function ensureDirs() {
  await fs.mkdir(paths.root, { recursive: true });
  await fs.mkdir(paths.cards, { recursive: true });
  await fs.mkdir(paths.events, { recursive: true });
}

function isAuthorizedWebhook(req, url) {
  if (!config.webhookToken) return true;
  const token = url.searchParams.get('token') || req.headers['x-webhook-token'];
  return token === config.webhookToken;
}

function isAuthorizedViewer(req, url) {
  if (!config.viewerToken) return true;
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const token = url.searchParams.get('token') || bearer;
  return token === config.viewerToken;
}

async function readJsonBody(req, maxBodyBytes) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error('payload_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    const error = new Error('empty_body');
    error.statusCode = 400;
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeEvent(payload, receivedAt) {
  const event = String(payload?.event || 'unknown');
  const echoedEvent = payload?.echoedEvent ? String(payload.echoedEvent) : null;
  const userId = payload?.user ? String(payload.user) : 'unknown-user';
  const partnerId = payload?.partner ? String(payload.partner) : null;
  const text = extractText(payload);
  const summary = buildSummary(payload);
  const direction = classifyDirection(payload);
  const messageId = sha1(JSON.stringify({ receivedAt, userId, event, echoedEvent, text, payload }));

  return {
    messageId,
    receivedAt,
    userId,
    partnerId,
    event,
    echoedEvent,
    direction,
    text,
    summary,
    inflow: payload?.options?.inflow || null,
    options: payload?.options || {},
  };
}

function classifyDirection(payload) {
  if (payload?.event === 'echo') return 'outgoing';
  if (payload?.event === 'send') return 'incoming';
  return 'system';
}

function extractText(payload) {
  if (payload?.textContent?.text) return String(payload.textContent.text);
  if (payload?.imageContent?.imageUrl) return '[image]';
  if (payload?.compositeContent) return '[composite]';
  if (payload?.event === 'open') return '[open]';
  if (payload?.event === 'leave') return '[leave]';
  if (payload?.event === 'friend') return `[friend:${payload?.options?.set || 'unknown'}]`;
  if (payload?.event === 'action') return `[action:${payload?.options?.action || 'unknown'}]`;
  return '';
}

function buildSummary(payload) {
  const event = payload?.event || 'unknown';
  if (event === 'send' && payload?.textContent?.text) {
    return truncate(payload.textContent.text, 120);
  }
  if (event === 'echo' && payload?.textContent?.text) {
    return `echo: ${truncate(payload.textContent.text, 100)}`;
  }
  if (event === 'open') {
    const inflow = payload?.options?.inflow || 'unknown';
    return `채팅창 진입 (${inflow})`;
  }
  if (event === 'friend') {
    return payload?.options?.set === 'on' ? '친구 추가' : '친구 철회';
  }
  if (event === 'leave') return '채팅방 나가기';
  if (event === 'action') return `액션: ${payload?.options?.action || 'unknown'}`;
  return truncate(JSON.stringify(payload), 120);
}

async function appendRawEvent(record) {
  const day = record.receivedAt.slice(0, 10);
  const filePath = path.join(paths.events, `${day}.ndjson`);
  await fs.appendFile(filePath, JSON.stringify(record) + '\n', 'utf8');
}

async function upsertCard(normalized, payload) {
  const existing = (await readCard(normalized.userId)) || createEmptyCard(normalized.userId, normalized.partnerId);

  const message = {
    id: normalized.messageId,
    receivedAt: normalized.receivedAt,
    event: normalized.event,
    echoedEvent: normalized.echoedEvent,
    direction: normalized.direction,
    text: normalized.text,
    summary: normalized.summary,
    inflow: normalized.inflow,
  };

  const alreadyExists = existing.messages.some((item) => item.id === message.id);
  if (!alreadyExists) {
    existing.messages.push(message);
  }

  existing.partnerId = normalized.partnerId || existing.partnerId;
  existing.firstSeenAt = existing.firstSeenAt || normalized.receivedAt;
  existing.lastSeenAt = normalized.receivedAt;
  existing.lastEvent = normalized.event;
  existing.lastMessageText = normalized.text;
  existing.lastMessageSummary = normalized.summary;
  existing.lastDirection = normalized.direction;
  existing.lastInflow = normalized.inflow;
  existing.messageCount = existing.messages.length;
  existing.incomingCount = existing.messages.filter((item) => item.direction === 'incoming').length;
  existing.outgoingCount = existing.messages.filter((item) => item.direction === 'outgoing').length;
  existing.systemCount = existing.messages.filter((item) => item.direction === 'system').length;
  existing.updatedAt = new Date().toISOString();

  if (normalized.direction === 'incoming') {
    existing.unreadIncomingCount = (existing.unreadIncomingCount || 0) + (alreadyExists ? 0 : 1);
  }

  existing.meta = {
    ...existing.meta,
    lastOptions: normalized.options,
    lastRawEventType: payload?.event || null,
  };

  await writeCard(existing);
  await writeState(existing);
}

function createEmptyCard(userId, partnerId = null) {
  return {
    userId,
    partnerId,
    firstSeenAt: null,
    lastSeenAt: null,
    updatedAt: null,
    lastEvent: null,
    lastMessageText: '',
    lastMessageSummary: '',
    lastDirection: null,
    lastInflow: null,
    unreadIncomingCount: 0,
    messageCount: 0,
    incomingCount: 0,
    outgoingCount: 0,
    systemCount: 0,
    messages: [],
    meta: {},
  };
}

async function listCards() {
  const entries = await fs.readdir(paths.cards);
  const cards = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(paths.cards, entry);
    const raw = await fs.readFile(filePath, 'utf8');
    const card = JSON.parse(raw);
    cards.push(toCardSummary(card));
  }

  return cards.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

function toCardSummary(card) {
  return {
    userId: card.userId,
    partnerId: card.partnerId,
    firstSeenAt: card.firstSeenAt,
    lastSeenAt: card.lastSeenAt,
    updatedAt: card.updatedAt,
    lastEvent: card.lastEvent,
    lastMessageText: truncate(card.lastMessageText || '', 160),
    lastMessageSummary: card.lastMessageSummary || '',
    lastDirection: card.lastDirection,
    lastInflow: card.lastInflow,
    unreadIncomingCount: card.unreadIncomingCount || 0,
    messageCount: card.messageCount || 0,
    incomingCount: card.incomingCount || 0,
    outgoingCount: card.outgoingCount || 0,
    systemCount: card.systemCount || 0,
  };
}

async function readCard(userId) {
  try {
    const raw = await fs.readFile(cardPath(userId), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeCard(card) {
  await fs.writeFile(cardPath(card.userId), JSON.stringify(card, null, 2), 'utf8');
}

function cardPath(userId) {
  return path.join(paths.cards, `${toFileId(userId)}.json`);
}

function toFileId(userId) {
  return Buffer.from(String(userId)).toString('base64url');
}

async function writeState(card) {
  const nextState = {
    lastUpdatedAt: new Date().toISOString(),
    lastUserId: card.userId,
    lastSeenAt: card.lastSeenAt,
    cardCount: (await fs.readdir(paths.cards)).filter((name) => name.endsWith('.json')).length,
  };
  await fs.writeFile(paths.state, JSON.stringify(nextState, null, 2), 'utf8');
}

function pickHeaders(headers, names) {
  const result = {};
  for (const name of names) {
    if (headers[name]) result[name] = headers[name];
  }
  return result;
}

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderUnauthorizedPage() {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Unauthorized</title>
    <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;background:#111827;color:#f9fafb}</style>
  </head>
  <body>
    <h1>401 Unauthorized</h1>
    <p>viewer token 을 확인해주세요.</p>
  </body>
</html>`;
}

function renderViewerHtml(url) {
  const viewerToken = url.searchParams.get('token') || '';
  const tokenScript = viewerToken ? `const TOKEN = ${JSON.stringify(viewerToken)};` : 'const TOKEN = "";';

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>네이버 톡톡 카드 뷰어</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1020;
        --panel: #121a31;
        --panel-2: #16203b;
        --text: #eef2ff;
        --muted: #9aa5ce;
        --accent: #7c9cff;
        --incoming: #1f3b2f;
        --outgoing: #2b2549;
        --system: #3a3120;
        --border: #243154;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .app {
        display: grid;
        grid-template-columns: 380px 1fr;
        min-height: 100vh;
      }
      .sidebar, .content {
        padding: 20px;
      }
      .sidebar {
        border-right: 1px solid var(--border);
        background: rgba(255,255,255,0.02);
      }
      h1, h2, h3, p { margin: 0; }
      .subtitle { color: var(--muted); margin-top: 8px; font-size: 14px; }
      .search { margin: 16px 0; }
      input[type="search"] {
        width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border);
        background: var(--panel); color: var(--text); outline: none;
      }
      .cards { display: flex; flex-direction: column; gap: 10px; }
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 14px;
        cursor: pointer;
      }
      .card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
      .card-top, .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
      .user-id { font-weight: 700; font-size: 14px; word-break: break-all; }
      .badge {
        min-width: 24px; height: 24px; border-radius: 999px; display: inline-flex;
        align-items: center; justify-content: center; background: #e11d48; color: white; font-size: 12px; padding: 0 8px;
      }
      .meta, .time { color: var(--muted); font-size: 12px; }
      .summary { margin-top: 8px; color: #d6dcff; font-size: 13px; line-height: 1.4; }
      .content { display: flex; flex-direction: column; gap: 16px; }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 18px;
      }
      .stats { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
      .pill { padding: 8px 10px; border-radius: 999px; background: var(--panel-2); color: var(--muted); font-size: 12px; }
      .messages { display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 260px); overflow: auto; }
      .message {
        padding: 12px 14px; border-radius: 14px; border: 1px solid var(--border);
        background: var(--panel-2);
      }
      .message.incoming { background: var(--incoming); }
      .message.outgoing { background: var(--outgoing); }
      .message.system { background: var(--system); }
      .message-meta { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
      .message-text { white-space: pre-wrap; line-height: 1.45; }
      .empty { color: var(--muted); padding: 40px 0; text-align: center; }
      @media (max-width: 960px) {
        .app { grid-template-columns: 1fr; }
        .sidebar { border-right: 0; border-bottom: 1px solid var(--border); }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <aside class="sidebar">
        <h1>톡톡 상담 카드</h1>
        <p class="subtitle">웹훅으로 받은 대화를 고객별 카드로 저장합니다.</p>
        <div class="search">
          <input id="search" type="search" placeholder="userId 또는 메시지 검색" />
        </div>
        <div id="cards" class="cards"></div>
      </aside>
      <main class="content">
        <section id="detail" class="panel">
          <div class="empty">왼쪽 카드에서 상담을 선택해주세요.</div>
        </section>
      </main>
    </div>
    <script>
      ${tokenScript}
      let selectedUserId = '';
      let currentCards = [];

      async function api(path) {
        const url = TOKEN ? path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN) : path;
        const response = await fetch(url);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      }

      function escapeHtml(text) {
        return String(text || '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function renderCards(cards) {
        const container = document.getElementById('cards');
        currentCards = cards;
        if (!cards.length) {
          container.innerHTML = '<div class="empty">저장된 상담 카드가 아직 없습니다.</div>';
          return;
        }

        container.innerHTML = cards.map((card) => {
          const activeClass = card.userId === selectedUserId ? 'active' : '';
          const badgeHtml = card.unreadIncomingCount ? '<span class="badge">' + card.unreadIncomingCount + '</span>' : '';
          return ''
            + '<div class="card ' + activeClass + '" data-user-id="' + escapeHtml(card.userId) + '">'
            +   '<div class="card-top">'
            +     '<div class="user-id">' + escapeHtml(card.userId) + '</div>'
            +      badgeHtml
            +   '</div>'
            +   '<div class="row" style="margin-top:8px;">'
            +     '<div class="meta">' + escapeHtml(card.lastEvent || '-') + ' · ' + escapeHtml(card.lastDirection || '-') + '</div>'
            +     '<div class="time">' + escapeHtml(formatDate(card.lastSeenAt)) + '</div>'
            +   '</div>'
            +   '<div class="summary">' + escapeHtml(card.lastMessageSummary || card.lastMessageText || '(내용 없음)') + '</div>'
            + '</div>';
        }).join('');

        container.querySelectorAll('.card').forEach((element) => {
          element.addEventListener('click', () => {
            selectedUserId = element.dataset.userId;
            renderCards(currentCards);
            loadCard(selectedUserId);
          });
        });
      }

      function formatDate(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('ko-KR');
      }

      async function loadCards() {
        const q = document.getElementById('search').value.trim();
        const data = await api('/api/cards' + (q ? '?q=' + encodeURIComponent(q) : ''));
        renderCards(data.cards || []);
        if (!selectedUserId && data.cards?.length) {
          selectedUserId = data.cards[0].userId;
          renderCards(data.cards);
          await loadCard(selectedUserId);
        } else if (selectedUserId && data.cards?.some((card) => card.userId === selectedUserId)) {
          await loadCard(selectedUserId);
        }
      }

      async function loadCard(userId) {
        const detail = document.getElementById('detail');
        const data = await api('/api/cards/' + encodeURIComponent(userId));
        const card = data.card;
        const messagesHtml = (card.messages || []).slice().reverse().map((message) => {
          return ''
            + '<div class="message ' + escapeHtml(message.direction || 'system') + '">'
            +   '<div class="message-meta">' + escapeHtml(message.event || '-') + ' · ' + escapeHtml(message.direction || '-') + ' · ' + escapeHtml(formatDate(message.receivedAt)) + '</div>'
            +   '<div class="message-text">' + escapeHtml(message.text || message.summary || '(내용 없음)') + '</div>'
            + '</div>';
        }).join('');

        detail.innerHTML = ''
          + '<div>'
          +   '<h2>' + escapeHtml(card.userId) + '</h2>'
          +   '<p class="subtitle" style="margin-top:8px;">최근 상담 시각: ' + escapeHtml(formatDate(card.lastSeenAt)) + '</p>'
          +   '<div class="stats">'
          +     '<span class="pill">전체 ' + (card.messageCount || 0) + '</span>'
          +     '<span class="pill">고객 ' + (card.incomingCount || 0) + '</span>'
          +     '<span class="pill">상담사/챗봇 ' + (card.outgoingCount || 0) + '</span>'
          +     '<span class="pill">시스템 ' + (card.systemCount || 0) + '</span>'
          +     '<span class="pill">미확인 ' + (card.unreadIncomingCount || 0) + '</span>'
          +   '</div>'
          + '</div>'
          + '<div class="messages">' + messagesHtml + '</div>';
      }

      document.getElementById('search').addEventListener('input', () => {
        clearTimeout(window.__searchTimer);
        window.__searchTimer = setTimeout(() => loadCards().catch(showError), 200);
      });

      function showError(error) {
        const detail = document.getElementById('detail');
        detail.innerHTML = '<div class="empty">오류가 발생했습니다: ' + escapeHtml(error.message || error) + '</div>';
      }

      loadCards().catch(showError);
    </script>
  </body>
</html>`;
}
