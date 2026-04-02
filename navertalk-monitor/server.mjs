import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  host: process.env.NAVERTALK_HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1'),
  port: Number(process.env.PORT || process.env.NAVERTALK_PORT || 3187),
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
  approvals: path.join(config.dataDir, 'approvals'),
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
      const { cards, warnings } = await listCards();
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

      return sendJson(res, 200, { ok: true, count: filtered.length, cards: filtered, warnings });
    }

    if (req.method === 'GET' && url.pathname === '/api/cards/by-popup') {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const popupPath = String(url.searchParams.get('popupPath') || '').trim();
      const popupUrl = String(url.searchParams.get('popupUrl') || '').trim();
      if (!popupPath && !popupUrl) {
        return sendJson(res, 400, { ok: false, error: 'popup_path_required' });
      }

      const matched = await findCardByPopupMapping({ popupPath, popupUrl });
      if (!matched) {
        return sendJson(res, 404, { ok: false, error: 'card_not_found_for_popup', popupPath, popupUrl });
      }

      return sendJson(res, 200, {
        ok: true,
        card: matched.card,
        cardSummary: toCardSummary(matched.card),
        mapping: matched.mapping,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/approvals') {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const status = (url.searchParams.get('status') || '').trim();
      const items = await listApprovals({ status });
      return sendJson(res, 200, { ok: true, count: items.length, approvals: items });
    }

    if (req.method === 'POST' && url.pathname === '/api/approvals') {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const body = await readJsonBody(req, config.maxBodyBytes);
      const approval = await createApprovalRequest(body);

      return sendJson(res, 200, {
        ok: true,
        approval,
        discordMessage: approval.discordMessage,
      });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/approvals/') && url.pathname.endsWith('/action')) {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const approvalId = decodeURIComponent(url.pathname.slice('/api/approvals/'.length, -'/action'.length));
      const body = await readJsonBody(req, config.maxBodyBytes);
      const approval = await applyApprovalAction(approvalId, body);

      return sendJson(res, 200, {
        ok: true,
        approval,
        discordMessage: approval.discordMessage,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/approvals/') && url.pathname.endsWith('/discord-payload')) {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const approvalId = decodeURIComponent(url.pathname.slice('/api/approvals/'.length, -'/discord-payload'.length));
      const approval = await readApproval(approvalId);
      if (!approval) {
        return sendJson(res, 404, { ok: false, error: 'approval_not_found', approvalId });
      }

      return sendJson(res, 200, {
        ok: true,
        approvalId,
        payload: approval.discordPayload || buildDiscordPayload(approval),
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/approvals/')) {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const approvalId = decodeURIComponent(url.pathname.slice('/api/approvals/'.length));
      const approval = await readApproval(approvalId);
      if (!approval) {
        return sendJson(res, 404, { ok: false, error: 'approval_not_found', approvalId });
      }

      return sendJson(res, 200, {
        ok: true,
        approval,
        discordMessage: approval.discordMessage,
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/match/score') {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const body = await readJsonBody(req, config.maxBodyBytes);
      const userId = body?.userId ? String(body.userId) : (body?.card?.userId ? String(body.card.userId) : null);
      const card = body?.card?.userId ? body.card : (userId ? await readCard(userId) : null);
      if (!card) {
        return sendJson(res, 404, { ok: false, error: 'card_not_found', userId });
      }

      const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
      const rankings = rankChatCandidates(card, candidates);
      const bestCandidate = rankings[0] || null;
      const secondCandidate = rankings[1] || null;
      const ambiguous = Boolean(
        bestCandidate
        && (
          !bestCandidate.matchSignals?.messageMatched
          || !bestCandidate.matchSignals?.timeMatched
          || bestCandidate.score < 80
          || (secondCandidate && Math.abs(bestCandidate.score - secondCandidate.score) < 20)
        )
      );

      return sendJson(res, 200, {
        ok: true,
        userId,
        card: toCardSummary(card),
        bestCandidate,
        ambiguous,
        rankings,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/cards/') && url.pathname.endsWith('/match-hints')) {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const userId = decodeURIComponent(url.pathname.slice('/api/cards/'.length, -'/match-hints'.length));
      const card = await readCard(userId);
      if (!card) {
        return sendJson(res, 404, { ok: false, error: 'card_not_found', userId });
      }

      return sendJson(res, 200, {
        ok: true,
        userId,
        hints: buildMatchHints(card),
      });
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/cards/') && url.pathname.endsWith('/chat-mapping')) {
      if (!isAuthorizedViewer(req, url)) {
        return sendJson(res, 401, { ok: false, error: 'unauthorized_viewer' });
      }

      const userId = decodeURIComponent(url.pathname.slice('/api/cards/'.length, -'/chat-mapping'.length));
      const card = await readCard(userId);
      if (!card) {
        return sendJson(res, 404, { ok: false, error: 'card_not_found', userId });
      }

      const body = await readJsonBody(req, config.maxBodyBytes);
      const mapping = normalizeChatMapping(body);
      card.meta = card.meta || {};
      card.meta.chatMappings = mergeChatMappings(card.meta.chatMappings, mapping);
      card.meta.preferredChatMapping = mapping;
      card.updatedAt = new Date().toISOString();

      await writeCard(card);

      return sendJson(res, 200, {
        ok: true,
        userId,
        preferredChatMapping: card.meta.preferredChatMapping,
        chatMappings: card.meta.chatMappings,
      });
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
  await fs.mkdir(paths.approvals, { recursive: true });
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
  const productContext = extractProductContext(payload, event);
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
    productContext,
    inflow: payload?.options?.inflow || null,
    options: payload?.options || {},
  };
}

function extractProductContext(payload, event) {
  const options = payload?.options || {};
  const compositeContext = extractCompositeProductContext(payload?.compositeContent);
  const referer = firstNonEmpty(
    options?.referer,
    payload?.referer,
    compositeContext?.referer,
  );
  const from = firstNonEmpty(
    options?.from,
    payload?.from,
    compositeContext?.from,
  );
  const productUrl = firstNonEmpty(
    payload?.productUrl,
    payload?.product?.url,
    compositeContext?.productUrl,
    looksLikeProductUrl(referer) ? referer : null,
  );
  const productId = firstNonEmpty(
    payload?.productId,
    payload?.product?.id,
    payload?.productNo,
    compositeContext?.productId,
    parseProductIdFromUrl(productUrl),
    parseProductIdFromUrl(referer),
    looksLikeId(from) ? from : null,
  );
  const productName = firstNonEmpty(
    payload?.productName,
    payload?.product?.name,
    payload?.product?.title,
    payload?.itemName,
    compositeContext?.productName,
  );
  const imageUrl = firstNonEmpty(
    payload?.imageContent?.imageUrl,
    payload?.product?.imageUrl,
    compositeContext?.imageUrl,
  );
  const price = normalizePrice(firstNonEmpty(
    payload?.price,
    payload?.product?.price,
    compositeContext?.price,
  ));

  const context = {
    sourceEvent: event || null,
    inflow: options?.inflow || null,
    referer: referer || null,
    from: from || null,
    productId: productId ? String(productId) : null,
    productName: productName || null,
    productUrl: productUrl || null,
    imageUrl: imageUrl || null,
    price: price || null,
  };

  return hasMeaningfulProductContext(context) ? context : null;
}

function extractCompositeProductContext(compositeContent) {
  if (!compositeContent || typeof compositeContent !== 'object') return null;

  const productName = findFirstMatchingValue(compositeContent, (key, value) => {
    return typeof value === 'string'
      && ['productname', 'goodsname', 'itemname', 'title', 'name'].includes(normalizeKey(key))
      && value.trim().length > 1;
  });

  const productUrl = findFirstMatchingValue(compositeContent, (key, value) => {
    return typeof value === 'string'
      && ['producturl', 'landingurl', 'url', 'href', 'linkurl', 'mobileurl', 'weburl'].includes(normalizeKey(key))
      && looksLikeUrl(value);
  });

  const imageUrl = findFirstMatchingValue(compositeContent, (key, value) => {
    return typeof value === 'string'
      && ['imageurl', 'image', 'imgurl', 'thumbnailurl', 'thumbnail'].includes(normalizeKey(key))
      && looksLikeUrl(value);
  });

  const productId = findFirstMatchingValue(compositeContent, (key, value) => {
    const normalized = normalizeKey(key);
    return ['productid', 'productno', 'goodsno', 'itemid', 'id'].includes(normalized)
      && (typeof value === 'string' || typeof value === 'number');
  });

  const price = findFirstMatchingValue(compositeContent, (key, value) => {
    const normalized = normalizeKey(key);
    return ['price', 'saleprice', 'discountprice', 'pricetext'].includes(normalized)
      && (typeof value === 'string' || typeof value === 'number');
  });

  const from = findFirstMatchingValue(compositeContent, (key, value) => {
    return normalizeKey(key) === 'from' && (typeof value === 'string' || typeof value === 'number');
  });

  const context = {
    productName: productName || null,
    productUrl: productUrl || null,
    imageUrl: imageUrl || null,
    productId: productId ? String(productId) : null,
    price: normalizePrice(price),
    from: from ? String(from) : null,
    referer: null,
  };

  return hasMeaningfulProductContext(context) ? context : null;
}

function findFirstMatchingValue(node, matcher, depth = 0) {
  if (node == null || depth > 7) return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstMatchingValue(item, matcher, depth + 1);
      if (found != null && found !== '') return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;

  for (const [key, value] of Object.entries(node)) {
    if (matcher(key, value)) {
      return value;
    }
    const found = findFirstMatchingValue(value, matcher, depth + 1);
    if (found != null && found !== '') return found;
  }

  return null;
}

function normalizeKey(key) {
  return String(key || '').replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function looksLikeProductUrl(value) {
  return /\/products?\//i.test(String(value || '').trim());
}

function parseProductIdFromUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = text.match(/\/(?:products?|goods)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] || null;
}

function looksLikeId(value) {
  return /^[A-Za-z0-9_-]{3,}$/.test(String(value || '').trim());
}

function normalizePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

function hasMeaningfulProductContext(context) {
  if (!context || typeof context !== 'object') return false;
  return Boolean(
    context.productName
    || context.productId
    || context.productUrl
    || context.referer
    || context.from
    || context.imageUrl
    || context.price
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return null;
}

function mergeProductContext(existing, incoming) {
  if (!hasMeaningfulProductContext(existing) && !hasMeaningfulProductContext(incoming)) return null;
  const merged = {
    sourceEvent: incoming?.sourceEvent || existing?.sourceEvent || null,
    inflow: incoming?.inflow || existing?.inflow || null,
    referer: incoming?.referer || existing?.referer || null,
    from: incoming?.from || existing?.from || null,
    productId: incoming?.productId || existing?.productId || null,
    productName: incoming?.productName || existing?.productName || null,
    productUrl: incoming?.productUrl || existing?.productUrl || null,
    imageUrl: incoming?.imageUrl || existing?.imageUrl || null,
    price: incoming?.price || existing?.price || null,
  };
  return hasMeaningfulProductContext(merged) ? merged : null;
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
    productContext: normalized.productContext,
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
  existing.productContext = mergeProductContext(existing.productContext, normalized.productContext);
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
    productContext: null,
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
  const warnings = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(paths.cards, entry);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = safeJsonParse(raw, filePath);
    if (!parsed.ok) {
      warnings.push({ file: entry, error: parsed.error });
      continue;
    }
    const card = parsed.data;
    cards.push(toCardSummary(card));
  }

  return {
    cards: cards.sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))),
    warnings,
  };
}

async function findCardByPopupMapping({ popupPath, popupUrl }) {
  const normalizedPopupPath = popupPath ? extractPopupPath(popupPath) || popupPath : null;
  const normalizedPopupUrl = popupUrl || (normalizedPopupPath ? `https://partner.talk.naver.com${normalizedPopupPath}` : null);
  const entries = await fs.readdir(paths.cards);

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(paths.cards, entry), 'utf8');
    const parsed = safeJsonParse(raw, entry);
    if (!parsed.ok) continue;
    const card = parsed.data;
    const mappings = [
      card?.meta?.preferredChatMapping,
      ...(Array.isArray(card?.meta?.chatMappings) ? card.meta.chatMappings : []),
    ].filter(Boolean);

    const matchedMapping = mappings.find((mapping) => {
      const mappingPath = mapping.popupPath ? extractPopupPath(mapping.popupPath) || mapping.popupPath : null;
      const mappingUrl = mapping.popupUrl || (mappingPath ? `https://partner.talk.naver.com${mappingPath}` : null);
      return Boolean(
        (normalizedPopupPath && mappingPath && normalizedPopupPath === mappingPath)
        || (normalizedPopupUrl && mappingUrl && normalizedPopupUrl === mappingUrl)
      );
    });

    if (matchedMapping) {
      return { card, mapping: matchedMapping };
    }
  }

  return null;
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
    productContext: card.productContext || null,
    preferredChatMapping: card?.meta?.preferredChatMapping || null,
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
    const parsed = safeJsonParse(raw, cardPath(userId));
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function safeJsonParse(raw, contextLabel = 'json') {
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (error) {
    return {
      ok: false,
      error: `${contextLabel}: ${error.message}`,
    };
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

async function createApprovalRequest(body) {
  const card = body?.userId ? await readCard(String(body.userId)) : null;
  const now = new Date().toISOString();
  const normalized = normalizeApprovalRequest(body, card, now);
  await writeApproval(normalized);
  return normalized;
}

function normalizeApprovalRequest(body, card, now) {
  const approvalId = createApprovalId(body, now);
  const recentMessages = normalizeApprovalRecentMessages(body?.recentMessages, card, body?.recentCount);
  const productContext = card?.productContext || {};

  const approval = {
    approvalId,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    source: normalizeApprovalSource(body?.source),
    channel: normalizeApprovalChannel(body?.channel),
    inquiryType: normalizeApprovalInquiryType(body?.inquiryType),
    userId: body?.userId ? String(body.userId) : (card?.userId || null),
    customerName: firstNonEmpty(body?.customerName, card?.meta?.customerDisplayName, card?.meta?.buyerName) || null,
    marketName: firstNonEmpty(body?.marketName, body?.market, card?.meta?.marketName) || null,
    productName: firstNonEmpty(body?.productName, body?.orderInfo?.productName, productContext?.productName) || null,
    orderNo: firstNonEmpty(body?.orderNo, body?.orderInfo?.orderNo, card?.meta?.orderNo) || null,
    productOrderNo: firstNonEmpty(body?.productOrderNo, body?.orderInfo?.productOrderNo, card?.meta?.productOrderNo) || null,
    trackingNo: firstNonEmpty(body?.trackingNo, body?.trackingInfo?.trackingNo, body?.orderInfo?.trackingNo, card?.meta?.trackingNo) || null,
    trackingStatus: firstNonEmpty(body?.trackingStatus, body?.trackingInfo?.trackingStatus) || null,
    customsEta: firstNonEmpty(body?.customsEta, body?.trackingInfo?.customsEta) || null,
    deliveryEta: firstNonEmpty(body?.deliveryEta, body?.trackingInfo?.deliveryEta) || null,
    recentMessages,
    draft: String(body?.draft || '').trim(),
    cardSummary: card ? toCardSummary(card) : null,
  };

  approval.actions = buildApprovalActions(approval);
  approval.discordMessage = buildDiscordApprovalMessage(approval);
  approval.discordButtons = buildDiscordButtonMeta(approval);
  approval.discordPayload = buildDiscordPayload(approval);
  return approval;
}

function buildApprovalActions(approval) {
  return [
    {
      key: 'approve',
      label: '승인',
      nextStatus: 'approved',
      customId: `approval:${approval.approvalId}:approve`,
      style: 'success',
    },
    {
      key: 'hold',
      label: '보류',
      nextStatus: 'held',
      customId: `approval:${approval.approvalId}:hold`,
      style: 'secondary',
    },
    {
      key: 'revise',
      label: '수정요청',
      nextStatus: 'revision_requested',
      customId: `approval:${approval.approvalId}:revise`,
      style: 'danger',
    },
  ];
}

function buildDiscordButtonMeta(approval) {
  return {
    type: 'discord-buttons-v1',
    approvalId: approval.approvalId,
    buttons: approval.actions.map((action) => ({
      customId: action.customId,
      label: action.label,
      style: action.style,
      nextStatus: action.nextStatus,
    })),
  };
}

function buildDiscordPayload(approval) {
  return {
    content: approval.discordMessage,
    components: [
      {
        type: 'action_row',
        buttons: approval.actions.map((action) => ({
          type: 'button',
          customId: action.customId,
          label: action.label,
          style: action.style,
          disabled: approval.status !== 'pending',
        })),
      },
    ],
  };
}

function normalizeApprovalSource(value) {
  const text = String(value || 'navertalk-monitor').trim();
  return text || 'navertalk-monitor';
}

function normalizeApprovalChannel(value) {
  const text = String(value || 'talktalk').trim().toLowerCase();
  if (['talktalk', '톡톡'].includes(text)) return 'talktalk';
  if (['order-inquiry', 'order', '주문문의'].includes(text)) return 'order-inquiry';
  if (['product-qna', 'qna', '상품문의', '상품q&a'].includes(text)) return 'product-qna';
  return text || 'talktalk';
}

function normalizeApprovalInquiryType(value) {
  const text = String(value || '미분류').trim();
  return text || '미분류';
}

function normalizeApprovalRecentMessages(recentMessages, card, recentCount) {
  if (Array.isArray(recentMessages) && recentMessages.length > 0) {
    return recentMessages
      .map((item) => normalizeApprovalMessage(item))
      .filter(Boolean)
      .slice(-5);
  }

  const limit = Math.min(5, Math.max(3, Number(recentCount || 5) || 5));
  const fromCard = Array.isArray(card?.messages) ? card.messages : [];
  return fromCard
    .filter((item) => item && (item.direction === 'incoming' || item.direction === 'outgoing'))
    .filter((item) => String(item.text || '').trim())
    .slice(-limit)
    .map((item) => normalizeApprovalMessage(item))
    .filter(Boolean);
}

function normalizeApprovalMessage(item) {
  if (!item) return null;
  const direction = item.direction === 'outgoing' ? 'agent' : item.direction === 'incoming' ? 'customer' : 'system';
  return {
    speaker: direction,
    label: direction === 'agent' ? '상담사' : direction === 'customer' ? '고객' : '시스템',
    time: formatApprovalTime(item.receivedAt),
    text: String(item.text || item.summary || '').trim(),
  };
}

function formatApprovalTime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(date).replace(/\. /g, '.').replace(/\.$/, '');
}

function createApprovalId(body, now) {
  const seed = JSON.stringify({
    now,
    source: body?.source || null,
    userId: body?.userId || null,
    inquiryType: body?.inquiryType || null,
    draft: body?.draft || null,
  });
  return `apr_${sha1(seed).slice(0, 12)}`;
}

function buildDiscordApprovalMessage(approval) {
  const channelLabel = approval.channel === 'talktalk'
    ? '톡톡'
    : approval.channel === 'order-inquiry'
      ? '주문문의'
      : approval.channel === 'product-qna'
        ? '상품문의'
        : approval.channel;

  const lines = [
    `[${approval.approvalId}] ${channelLabel} / ${approval.inquiryType} / ${approval.customerName || '고객명 미확인'}`,
  ];

  if (approval.productName) lines.push(`상품: ${approval.productName}`);
  if (approval.orderNo) lines.push(`주문번호: ${approval.orderNo}`);
  if (approval.productOrderNo) lines.push(`상품주문번호: ${approval.productOrderNo}`);
  if (approval.trackingNo) lines.push(`송장번호: ${approval.trackingNo}`);
  if (approval.trackingStatus) lines.push(`현재상태: ${approval.trackingStatus}`);
  if (approval.customsEta) lines.push(`통관예상: ${approval.customsEta}`);
  if (approval.deliveryEta) lines.push(`배송예상: ${approval.deliveryEta}`);

  if (approval.recentMessages.length > 0) {
    lines.push('', '[최근 대화]');
    for (const item of approval.recentMessages) {
      const timeLabel = item.time ? ` ${item.time}` : '';
      lines.push(`- ${item.label}${timeLabel} ${item.text}`.trim());
    }
  }

  if (approval.draft) {
    lines.push('', '[초안]', '```text', approval.draft, '```');
  }

  lines.push('', '버튼 동작:', '- 승인', '- 보류', '- 수정요청');
  lines.push('', '텍스트 승인 예시:', `- ${approval.approvalId} 승인`, `- ${approval.approvalId} 보류`, `- ${approval.approvalId} 수정: 마지막 문장만 더 짧게`);
  return lines.join('\n');
}

async function listApprovals({ status } = {}) {
  const entries = await fs.readdir(paths.approvals);
  const items = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(paths.approvals, entry), 'utf8');
    const parsed = safeJsonParse(raw, entry);
    if (!parsed.ok) continue;
    const item = parsed.data;
    if (status && item.status !== status) continue;
    items.push(toApprovalSummary(item));
  }
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function toApprovalSummary(item) {
  return {
    approvalId: item.approvalId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    status: item.status,
    channel: item.channel,
    inquiryType: item.inquiryType,
    customerName: item.customerName,
    productName: item.productName,
    trackingNo: item.trackingNo,
  };
}

async function readApproval(approvalId) {
  try {
    const raw = await fs.readFile(approvalPath(approvalId), 'utf8');
    const parsed = safeJsonParse(raw, approvalPath(approvalId));
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    return parsed.data;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function applyApprovalAction(approvalId, body) {
  const approval = await readApproval(approvalId);
  if (!approval) {
    const error = new Error('approval_not_found');
    error.statusCode = 404;
    throw error;
  }

  const action = normalizeApprovalAction(body?.action || body?.status || '');
  if (!action) {
    const error = new Error('invalid_action');
    error.statusCode = 400;
    throw error;
  }

  approval.status = action.nextStatus;
  approval.updatedAt = new Date().toISOString();
  approval.lastAction = {
    key: action.key,
    label: action.label,
    at: approval.updatedAt,
    note: String(body?.note || body?.reason || '').trim() || null,
    actor: String(body?.actor || '').trim() || null,
  };
  approval.discordMessage = buildDiscordApprovalMessage(approval);
  approval.discordButtons = buildDiscordButtonMeta(approval);
  approval.discordPayload = buildDiscordPayload(approval);

  await writeApproval(approval);
  return approval;
}

function normalizeApprovalAction(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const map = {
    approve: { key: 'approve', label: '승인', nextStatus: 'approved' },
    approved: { key: 'approve', label: '승인', nextStatus: 'approved' },
    hold: { key: 'hold', label: '보류', nextStatus: 'held' },
    held: { key: 'hold', label: '보류', nextStatus: 'held' },
    revise: { key: 'revise', label: '수정요청', nextStatus: 'revision_requested' },
    revision_requested: { key: 'revise', label: '수정요청', nextStatus: 'revision_requested' },
    revision: { key: 'revise', label: '수정요청', nextStatus: 'revision_requested' },
  };
  return map[text] || null;
}

async function writeApproval(approval) {
  await fs.writeFile(approvalPath(approval.approvalId), JSON.stringify(approval, null, 2), 'utf8');
}

function approvalPath(approvalId) {
  return path.join(paths.approvals, `${approvalId}.json`);
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

function buildMatchHints(card) {
  const preferredChatMapping = card?.meta?.preferredChatMapping || null;
  return {
    userId: card.userId,
    lastSeenAt: card.lastSeenAt,
    lastTimeLabel: formatKoreanTimeLabel(card.lastSeenAt),
    lastMessageText: card.lastMessageText || '',
    lastMessageNormalized: normalizeMatchText(card.lastMessageText || ''),
    productContext: card.productContext || null,
    preferredChatMapping,
    knownChatMappings: Array.isArray(card?.meta?.chatMappings) ? card.meta.chatMappings : [],
  };
}

function normalizeChatMapping(value) {
  return {
    candidateId: value?.candidateId ? String(value.candidateId) : null,
    popupPath: value?.popupPath ? String(value.popupPath) : null,
    popupUrl: value?.popupUrl ? String(value.popupUrl) : null,
    displayName: value?.displayName ? String(value.displayName) : null,
    productName: value?.productName ? String(value.productName) : null,
    lastMatchedAt: new Date().toISOString(),
  };
}

function mergeChatMappings(existingMappings, nextMapping) {
  const list = Array.isArray(existingMappings) ? [...existingMappings] : [];
  const key = nextMapping.popupPath || nextMapping.popupUrl || nextMapping.candidateId;
  if (!key) return list;

  const index = list.findIndex((item) => {
    return key === (item.popupPath || item.popupUrl || item.candidateId);
  });

  if (index >= 0) {
    list[index] = { ...list[index], ...nextMapping };
    return list;
  }

  list.unshift(nextMapping);
  return list.slice(0, 20);
}

function rankChatCandidates(card, candidates) {
  return candidates
    .map((candidate, index) => scoreChatCandidate(card, candidate, index))
    .sort((a, b) => b.score - a.score);
}

function scoreChatCandidate(card, rawCandidate, index = 0) {
  const candidate = normalizeCandidate(rawCandidate, index);
  const reasons = [];
  let score = 0;
  const matchSignals = {
    messageMatched: false,
    messageExact: false,
    timeMatched: false,
    timeExact: false,
  };

  const preferred = card?.meta?.preferredChatMapping || null;
  const knownMappings = Array.isArray(card?.meta?.chatMappings) ? card.meta.chatMappings : [];
  const mappingKey = candidate.popupPath || candidate.popupUrl || candidate.candidateId;

  if (preferred && mappingKey && mappingKey === (preferred.popupPath || preferred.popupUrl || preferred.candidateId)) {
    score += 120;
    reasons.push('기존 확정 매핑 일치');
  } else if (mappingKey && knownMappings.some((item) => mappingKey === (item.popupPath || item.popupUrl || item.candidateId))) {
    score += 80;
    reasons.push('기존 매핑 이력 일치');
  }

  const webhookText = normalizeMatchText(card.lastMessageText || card.lastMessageSummary || '');
  const previewText = normalizeMatchText(candidate.previewText);
  const isShortMessage = webhookText.length > 0 && webhookText.length <= 4;
  if (webhookText && previewText) {
    if (webhookText === previewText) {
      score += 90;
      reasons.push('메시지 본문 동일');
      matchSignals.messageMatched = true;
      matchSignals.messageExact = true;
    } else if (previewText.includes(webhookText) || webhookText.includes(previewText)) {
      score += 60;
      reasons.push('메시지 본문 유사');
      matchSignals.messageMatched = true;
    }
  }

  const webhookTimeLabel = formatKoreanTimeLabel(card.lastSeenAt);
  if (candidate.timeText && webhookTimeLabel && candidate.timeText === webhookTimeLabel) {
    score += 45;
      reasons.push('시간 라벨 동일');
      matchSignals.timeMatched = true;
      matchSignals.timeExact = true;
  }

  const minuteDistance = computeMinuteDistance(card.lastSeenAt, candidate.seenAt, candidate.timeText);
  if (minuteDistance != null) {
    if (minuteDistance <= 2) {
      score += 30;
      reasons.push('시간 차 2분 이내');
      matchSignals.timeMatched = true;
    } else if (minuteDistance <= 5) {
      score += 10;
      reasons.push('시간 차 5분 이내');
    } else if (minuteDistance >= 10) {
      score -= 30;
      reasons.push('시간 차 큼');
    }
  }

  if (isShortMessage) {
    const webhookProductName = normalizeMatchText(card?.productContext?.productName || '');
    const candidateProductName = normalizeMatchText(candidate.productName);
    if (webhookProductName && candidateProductName) {
      if (webhookProductName === candidateProductName) {
        score += 20;
        reasons.push('짧은 메시지 보조: 상품명 동일');
      } else if (candidateProductName.includes(webhookProductName) || webhookProductName.includes(candidateProductName)) {
        score += 10;
        reasons.push('짧은 메시지 보조: 상품명 유사');
      }
    }

    const webhookProductId = String(card?.productContext?.productId || '').trim();
    const candidateProductId = String(candidate.productId || '').trim();
    if (webhookProductId && candidateProductId && webhookProductId === candidateProductId) {
      score += 15;
      reasons.push('짧은 메시지 보조: 상품 ID 일치');
    }
  }

  if (candidate.unreadCount > 0) {
    score += Math.min(8, 2 + candidate.unreadCount);
    reasons.push(`보조값: 안읽은 메시지 ${candidate.unreadCount}건`);
  }

  if (candidate.displayName && card?.meta?.customerDisplayName && normalizeMatchText(candidate.displayName) === normalizeMatchText(card.meta.customerDisplayName)) {
    score += 6;
    reasons.push('보조값: 고객 표시명 일치');
  }

  if (!matchSignals.messageMatched) {
    score -= 40;
    reasons.push('마지막 메시지 기준 불일치');
  }

  if (!matchSignals.timeMatched) {
    score -= 20;
    reasons.push('시간 기준 불일치');
  }

  return {
    rankIndex: index,
    score,
    reasons,
    matchSignals,
    candidate,
  };
}

function normalizeCandidate(value, index = 0) {
  const popupPath = firstNonEmpty(value?.popupPath, extractPopupPath(value?.popupUrl), value?.href) || null;
  const popupUrl = firstNonEmpty(value?.popupUrl, popupPath ? `https://partner.talk.naver.com${popupPath.startsWith('http') ? '' : popupPath}` : null) || null;
  return {
    candidateId: firstNonEmpty(value?.candidateId, popupPath, String(index + 1)),
    popupPath,
    popupUrl,
    displayName: firstNonEmpty(value?.displayName, value?.customerName, value?.name) || '',
    previewText: firstNonEmpty(value?.previewText, value?.textMessage, value?.lastMessageText, value?.message) || '',
    productName: firstNonEmpty(value?.productName, value?.contextProductName, value?.inquiryProductName) || '',
    productId: firstNonEmpty(value?.productId, parseProductIdFromUrl(value?.productUrl), parseProductIdFromUrl(value?.referer)) || null,
    unreadCount: Number(value?.unreadCount || value?.badgeAlarm || 0) || 0,
    timeText: normalizeTimeText(value?.timeText || value?.chatInfoTime || value?.lastMessageTime || ''),
    seenAt: value?.seenAt || null,
  };
}

function extractPopupPath(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.startsWith('/chat/ct/')) return text;
  const match = text.match(/https?:\/\/partner\.talk\.naver\.com(\/chat\/ct\/[^?]+)/i);
  return match?.[1] || null;
}

function normalizeMatchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '')
    .replaceAll(/[.,!?~'"“”‘’():/\-]/g, '');
}

function normalizeTimeText(value) {
  return String(value || '').replaceAll(/\s+/g, ' ').trim();
}

function formatKoreanTimeLabel(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Seoul',
  }).formatToParts(date);

  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value || '';
  const hour = parts.find((part) => part.type === 'hour')?.value || '';
  const minute = parts.find((part) => part.type === 'minute')?.value || '';
  return normalizeTimeText(`${dayPeriod} ${hour}:${minute}`);
}

function computeMinuteDistance(cardSeenAt, candidateSeenAt, candidateTimeText) {
  const cardDate = cardSeenAt ? new Date(cardSeenAt) : null;
  if (!cardDate || Number.isNaN(cardDate.getTime())) return null;

  if (candidateSeenAt) {
    const candidateDate = new Date(candidateSeenAt);
    if (!Number.isNaN(candidateDate.getTime())) {
      return Math.abs(Math.round((candidateDate.getTime() - cardDate.getTime()) / 60000));
    }
  }

  const parsedMinutes = parseKoreanTimeToMinutes(candidateTimeText);
  if (parsedMinutes == null) return null;
  const cardMinutes = getKoreanMinutesOfDay(cardDate);
  return Math.abs(parsedMinutes - cardMinutes);
}

function parseKoreanTimeToMinutes(value) {
  const text = normalizeTimeText(value);
  const match = text.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = Number(match[3]);
  const isPm = match[1] === '오후';
  if (hour === 12) hour = isPm ? 12 : 0;
  else if (isPm) hour += 12;
  return hour * 60 + minute;
}

function getKoreanMinutesOfDay(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
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
      .context-chip {
        display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;
        padding: 6px 9px; border-radius: 999px; background: #1f2d52; color: #c7d2fe; font-size: 12px;
      }
      .context-box {
        margin-top: 14px; padding: 14px; border-radius: 14px; background: var(--panel-2); border: 1px solid var(--border);
      }
      .context-title { font-weight: 700; color: #dbe4ff; margin-bottom: 8px; }
      .context-grid { display: grid; gap: 8px; }
      .context-item { color: var(--muted); font-size: 13px; line-height: 1.45; word-break: break-all; }
      .context-item strong { color: var(--text); }
      .context-link { color: #93c5fd; text-decoration: none; }
      .context-link:hover { text-decoration: underline; }
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

      function renderProductChip(productContext) {
        if (!productContext) return '';
        const label = productContext.productName || productContext.productId || productContext.from;
        if (!label) return '';
        return '<div class="context-chip">상품 컨텍스트 · ' + escapeHtml(label) + '</div>';
      }

      function renderProductContextBox(productContext) {
        if (!productContext) return '';
        const rows = [];
        if (productContext.productName) rows.push('<div class="context-item"><strong>상품명</strong> · ' + escapeHtml(productContext.productName) + '</div>');
        if (productContext.productId) rows.push('<div class="context-item"><strong>상품 ID</strong> · ' + escapeHtml(productContext.productId) + '</div>');
        if (productContext.price) rows.push('<div class="context-item"><strong>가격</strong> · ' + escapeHtml(productContext.price) + '</div>');
        if (productContext.from) rows.push('<div class="context-item"><strong>from 값</strong> · ' + escapeHtml(productContext.from) + '</div>');
        if (productContext.inflow) rows.push('<div class="context-item"><strong>유입 방식</strong> · ' + escapeHtml(productContext.inflow) + '</div>');
        if (productContext.productUrl) rows.push('<div class="context-item"><strong>상품 URL</strong> · <a class="context-link" href="' + escapeHtml(productContext.productUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(productContext.productUrl) + '</a></div>');
        if (productContext.referer && productContext.referer !== productContext.productUrl) rows.push('<div class="context-item"><strong>referer</strong> · <a class="context-link" href="' + escapeHtml(productContext.referer) + '" target="_blank" rel="noreferrer">' + escapeHtml(productContext.referer) + '</a></div>');
        if (!rows.length) return '';
        return '<div class="context-box"><div class="context-title">상품 컨텍스트</div><div class="context-grid">' + rows.join('') + '</div></div>';
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
            +    renderProductChip(card.productContext)
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
        const contextHtml = renderProductContextBox(card.productContext);
        const messagesHtml = (card.messages || []).slice().reverse().map((message) => {
          const messageContext = renderProductContextBox(message.productContext);
          return ''
            + '<div class="message ' + escapeHtml(message.direction || 'system') + '">'
            +   '<div class="message-meta">' + escapeHtml(message.event || '-') + ' · ' + escapeHtml(message.direction || '-') + ' · ' + escapeHtml(formatDate(message.receivedAt)) + '</div>'
            +   '<div class="message-text">' + escapeHtml(message.text || message.summary || '(내용 없음)') + '</div>'
            +    messageContext
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
          +    contextHtml
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
