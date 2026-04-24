#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

const BASE_URL = 'https://selltkey.com';
const LOGIN_PATH = '/scb/_loginOk.asp';
const DAILY_PAGE_PATH = '/scb/util/taobao.asp';
const MATCH_PATH = '/scb/util/ajax_goods_taobao_match_scb_p2s_test.asp';
const SEOUL_TZ = 'Asia/Seoul';
const DEFAULT_DELAY_MS = 7200;
const DEFAULT_PAGE_SIZE = 2000;
const DEFAULT_START_DATE = '2026-04-11';
const DEFAULT_STATE_PATH = path.join(process.cwd(), 'runtime-data', 'selltkey-nonlogin-match-state.json');
const MAX_NO_PROGRESS_RETRIES = 2;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = buildConfig(args);
  const summary = {
    ok: false,
    startDate: config.startDate,
    endDate: config.endDate,
    delayMs: config.delayMs,
    statePath: config.statePath,
    datesVisited: 0,
    datesCompleted: 0,
    rowsMatched: 0,
    rowsSkipped: 0,
    requestsSent: 0,
    stoppedReason: '',
    errors: [],
  };

  await ensureParentDir(config.statePath);

  try {
    validateConfig(config);

    let state = await readState(config.statePath);
    const startCursor = resolveStartCursor(config, state);
    log(`시작 설정: ${startCursor} ~ ${config.endDate}, delay=${config.delayMs}ms, state=${config.statePath}`);

    const client = new HttpSession(BASE_URL);
    const loginResult = await login(client, config);
    if (!loginResult.ok) {
      summary.stoppedReason = loginResult.reason;
      summary.errors.push(loginResult.message);
      printFinalSummary(summary);
      process.exitCode = 1;
      return;
    }

    let currentDate = startCursor;
    let halted = false;

    while (!halted && currentDate <= config.endDate) {
      summary.datesVisited += 1;
      const dateResult = await processDate(client, config, currentDate, summary);

      if (dateResult.status === 'completed') {
        summary.datesCompleted += 1;
        const nextDate = addDays(currentDate, 1);
        state = {
          currentDate: nextDate,
          updatedAt: new Date().toISOString(),
          lastStatus: 'completed',
          lastProcessedDate: currentDate,
        };
        await writeState(config.statePath, state);
        currentDate = nextDate;
        continue;
      }

      if (dateResult.status === 'quota_reached') {
        summary.stoppedReason = `일일 한도 도달: ${currentDate}`;
        state = {
          currentDate,
          updatedAt: new Date().toISOString(),
          lastStatus: 'quota_reached',
          lastProcessedDate: currentDate,
        };
        await writeState(config.statePath, state);
        halted = true;
        continue;
      }

      if (dateResult.status === 'error') {
        summary.stoppedReason = `오류로 중단: ${currentDate}`;
        summary.errors.push(dateResult.message);
        state = {
          currentDate,
          updatedAt: new Date().toISOString(),
          lastStatus: 'error',
          lastProcessedDate: currentDate,
          message: dateResult.message,
        };
        await writeState(config.statePath, state);
        halted = true;
        continue;
      }

      if (dateResult.status === 'no_progress') {
        const noProgressCount = getNoProgressCount(state, currentDate);
        if (noProgressCount >= MAX_NO_PROGRESS_RETRIES) {
          const nextDate = addDays(currentDate, 1);
          log(`[${currentDate}] 진행 불가 ${noProgressCount}회 누적, ${nextDate}로 이동`);
          state = {
            currentDate: nextDate,
            updatedAt: new Date().toISOString(),
            lastStatus: 'no_progress_skipped',
            lastProcessedDate: currentDate,
            message: dateResult.message,
            noProgressCount,
          };
          await writeState(config.statePath, state);
          currentDate = nextDate;
          continue;
        }

        summary.stoppedReason = `진행 불가로 중단: ${currentDate}`;
        summary.errors.push(`${dateResult.message} (재시도 ${noProgressCount}/${MAX_NO_PROGRESS_RETRIES})`);
        state = {
          currentDate,
          updatedAt: new Date().toISOString(),
          lastStatus: 'no_progress',
          lastProcessedDate: currentDate,
          message: dateResult.message,
          noProgressCount,
        };
        await writeState(config.statePath, state);
        halted = true;
        continue;
      }
    }

    if (!summary.stoppedReason) {
      summary.stoppedReason = currentDate > config.endDate
        ? '지정한 날짜 범위 처리 완료'
        : '중단 사유 없음';
    }
    summary.ok = summary.errors.length === 0;
    printFinalSummary(summary);
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    summary.stoppedReason = '치명적 오류';
    summary.errors.push(error instanceof Error ? error.message : String(error));
    printFinalSummary(summary);
    process.exitCode = 1;
  }
}

async function processDate(client, config, date, summary) {
  log(`[${date}] 처리 시작`);

  while (true) {
    const pageResult = await fetchDailyPage(client, date, config.pageSize);
    if (!pageResult.ok) {
      return { status: 'error', message: pageResult.message };
    }

    const quota = parseQuota(pageResult.html);
    if (!quota.ok) {
      return { status: 'error', message: quota.message };
    }

    log(`[${date}] 사용량 ${quota.used} / ${quota.limit}`);
    if (quota.used >= quota.limit) {
      return { status: 'quota_reached' };
    }

    const pendingRows = parsePendingRows(pageResult.html);
    if (!pendingRows.ok) {
      return { status: 'error', message: pendingRows.message };
    }

    if (pendingRows.rows.length === 0) {
      log(`[${date}] 대기 행 없음, 날짜 완료`);
      return { status: 'completed' };
    }

    log(`[${date}] 대기 ${pendingRows.rows.length}건 발견`);
    let processedInBatch = 0;

    for (const row of pendingRows.rows) {
      const batchPageResult = await fetchDailyPage(client, date, config.pageSize);
      if (!batchPageResult.ok) {
        return { status: 'error', message: batchPageResult.message };
      }

      const liveQuota = parseQuota(batchPageResult.html);
      if (!liveQuota.ok) {
        return { status: 'error', message: liveQuota.message };
      }
      if (liveQuota.used >= liveQuota.limit) {
        return { status: 'quota_reached' };
      }

      const liveRows = parsePendingRows(batchPageResult.html);
      if (!liveRows.ok) {
        return { status: 'error', message: liveRows.message };
      }

      const target = liveRows.rows.find((item) => item.goodsNum === row.goodsNum);
      if (!target) {
        summary.rowsSkipped += 1;
        log(`[${date}] 이미 처리되었거나 목록에서 사라짐: goodsNum=${row.goodsNum}`);
        continue;
      }

      const matchResult = await submitMatch(client, target);
      summary.requestsSent += 1;
      if (matchResult.ok) {
        summary.rowsMatched += 1;
        processedInBatch += 1;
        log(`[${date}] 매칭 성공: goodsNum=${target.goodsNum}${target.title ? `, title=${target.title}` : ''}`);
      } else if (matchResult.quotaReached) {
        log(`[${date}] 응답상 한도 도달: goodsNum=${target.goodsNum}`);
        return { status: 'quota_reached' };
      } else {
        summary.rowsSkipped += 1;
        log(`[${date}] 매칭 실패/스킵: goodsNum=${target.goodsNum}, message=${matchResult.message}`);
      }

      await sleep(config.delayMs);
    }

    if (processedInBatch === 0) {
      const verifyPageResult = await fetchDailyPage(client, date, config.pageSize);
      if (!verifyPageResult.ok) {
        return { status: 'error', message: verifyPageResult.message };
      }

      const verifyRows = parsePendingRows(verifyPageResult.html);
      if (!verifyRows.ok) {
        return { status: 'error', message: verifyRows.message };
      }

      if (verifyRows.rows.length === 0) {
        log(`[${date}] 검증 결과 대기 행 없음, 날짜 완료`);
        return { status: 'completed' };
      }

      return {
        status: 'no_progress',
        message: `대기 ${verifyRows.rows.length}건이 남아 있는데 이번 배치에서 성공이 0건입니다. 남은 항목 중 이미지 검색 실패 등으로 수동 확인이 필요합니다.`,
      };
    }

    log(`[${date}] 배치 ${processedInBatch}건 처리 후 새로고침`);
  }
}

async function login(client, config) {
  log('로그인 요청');
  const response = await client.request(LOGIN_PATH, {
    method: 'POST',
    form: {
      USERID: config.userId,
      USERPWD: config.userPw,
    },
    headers: {
      referer: `${BASE_URL}/scb/`,
      origin: BASE_URL,
    },
  });

  if (!response.ok) {
    return { ok: false, reason: 'login_request_failed', message: response.message };
  }

  if (isLoggedInPage(response.text)) {
    log('로그인 성공');
    return { ok: true };
  }

  const infoPage = await client.request('/scb/info.asp', { method: 'GET' });
  if (infoPage.ok && isLoggedInPage(infoPage.text)) {
    log('로그인 성공');
    return { ok: true };
  }

  return { ok: false, reason: 'login_failed', message: '로그인 성공 여부를 확인하지 못했습니다.' };
}

async function fetchDailyPage(client, date, pageSize) {
  const query = new URLSearchParams({
    sGoodsDate: date,
    taobaoStatus: '',
    PageSize: String(pageSize),
  });
  const response = await client.request(`${DAILY_PAGE_PATH}?${query.toString()}`, { method: 'GET' });
  if (!response.ok) {
    return { ok: false, message: response.message };
  }
  if (isLoggedOutPage(response.text)) {
    return { ok: false, message: '일자 페이지 조회 중 로그인 세션이 끊겼습니다.' };
  }
  if (/\/scb\/"/i.test(response.text) || /top\.location\s*=\s*["']\/scb\//i.test(response.text)) {
    return { ok: false, message: '일자 페이지가 /scb/ 로 리다이렉트되는 응답을 반환했습니다.' };
  }
  return { ok: true, html: response.text };
}

async function submitMatch(client, row) {
  const response = await client.request(MATCH_PATH, {
    method: 'POST',
    form: {
      goodsNum: row.goodsNum,
      goodsCode: row.goodsCode,
      imageUrl: row.imageUrl,
    },
    headers: {
      referer: `${BASE_URL}${DAILY_PAGE_PATH}`,
      origin: BASE_URL,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/javascript, */*; q=0.01',
    },
  });

  if (!response.ok) {
    return { ok: false, message: response.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return { ok: false, message: 'AJAX 응답 JSON 파싱 실패' };
  }

  const message = String(parsed?.message || '');
  if (parsed?.success === true) {
    return { ok: true, message };
  }
  if (/비로그인\s*수집한도.*초과/.test(message)) {
    return { ok: false, quotaReached: true, message };
  }
  return { ok: false, message: message || 'success=false 응답' };
}

function parseQuota(html) {
  const match = html.match(/<button[^>]*id=["']countBtt["'][^>]*>\s*(\d+)\s*\/\s*(\d+)\s*<\/button>/i);
  if (!match) {
    return { ok: false, message: 'countBtt 사용량 파싱 실패' };
  }
  return {
    ok: true,
    used: Number(match[1]),
    limit: Number(match[2]),
  };
}

function parsePendingRows(html) {
  const rows = [];
  const rowRegex = /<div\b([^>]*\bclass=["'][^"']*\brow-item\b[^"']*["'][^>]*)>/gi;
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const attrs = match[1];
    const goodsNum = getAttr(attrs, 'data-num');
    const chromeYn = getAttr(attrs, 'data-chromeyn');
    if (!goodsNum || chromeYn !== 'Y') {
      continue;
    }

    const imageUrl = decodeHtml(getAttr(attrs, 'data-image') || '');
    const rowStart = match.index;
    const nextIndex = html.indexOf('<div class="row row-item"', rowStart + 1);
    const rowHtml = html.slice(rowStart, nextIndex === -1 ? html.length : nextIndex);
    const taobaoSectionMatch = rowHtml.match(new RegExp(`<div[^>]*class=["']row["'][^>]*id=["']taobao_${escapeRegExp(goodsNum)}["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i'));
    const taobaoSection = taobaoSectionMatch?.[1] || '';
    const hasNoData = /데이터\s*없음/.test(stripTags(decodeHtml(taobaoSection)));
    if (!hasNoData) {
      continue;
    }

    const goodsCodeMatch = rowHtml.match(new RegExp(`<input[^>]*id=["']GOODSCODE_${escapeRegExp(goodsNum)}["'][^>]*value=["']([^"']*)["']`, 'i'));
    const title = extractRowTitle(rowHtml);

    rows.push({
      goodsNum,
      goodsCode: decodeHtml(goodsCodeMatch?.[1] || ''),
      imageUrl,
      title,
    });
  }

  return { ok: true, rows };
}

function extractRowTitle(rowHtml) {
  const candidates = [
    /<h5[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i,
    /<div[^>]*class=["'][^"']*item-subject[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*goods-name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<a[^>]*class=["'][^"']*item-subject[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
  ];
  for (const pattern of candidates) {
    const match = rowHtml.match(pattern);
    if (match) {
      const text = stripTags(decodeHtml(match[1])).replace(/\s+/g, ' ').trim();
      if (text) {
        return text;
      }
    }
  }
  return '';
}

function getAttr(attrText, name) {
  const match = attrText.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
}

function stripTags(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ');
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function isLoggedOutPage(text) {
  const normalized = String(text || '');
  return /id=["']loginForm["']/i.test(normalized)
    || /authentication-bg/i.test(normalized)
    || (/id=["']USERID["']/i.test(normalized) && /id=["']USERPWD["']/i.test(normalized))
    || /<form[^>]*action=["'][^"']*_loginOk\.asp/i.test(normalized);
}

function isLoggedInPage(text) {
  const normalized = String(text || '');
  return /<meta[^>]*name=["']usernum["'][^>]*content=["']\s*[^"'>\s][^"'>]*["']/i.test(normalized);
}

function buildConfig(args) {
  return {
    userId: process.env.SELLTKEY_ID || '',
    userPw: process.env.SELLTKEY_PW || '',
    startDate: args.startDate || process.env.SELLTKEY_START_DATE || DEFAULT_START_DATE,
    endDate: args.endDate || process.env.SELLTKEY_END_DATE || todayInSeoul(),
    delayMs: Number(args.delayMs || process.env.SELLTKEY_DELAY_MS || DEFAULT_DELAY_MS),
    pageSize: Number(args.pageSize || process.env.SELLTKEY_PAGE_SIZE || DEFAULT_PAGE_SIZE),
    statePath: path.resolve(args.statePath || process.env.SELLTKEY_STATE_PATH || DEFAULT_STATE_PATH),
  };
}

function validateConfig(config) {
  if (!config.userId || !config.userPw) {
    throw new Error('환경변수 SELLTKEY_ID, SELLTKEY_PW 가 필요합니다.');
  }
  if (!isIsoDate(config.startDate)) {
    throw new Error(`startDate 형식 오류: ${config.startDate}`);
  }
  if (!isIsoDate(config.endDate)) {
    throw new Error(`endDate 형식 오류: ${config.endDate}`);
  }
  if (config.startDate > config.endDate) {
    throw new Error(`startDate(${config.startDate})가 endDate(${config.endDate})보다 늦습니다.`);
  }
  if (!Number.isFinite(config.delayMs) || config.delayMs < 0) {
    throw new Error(`delayMs 값 오류: ${config.delayMs}`);
  }
  if (!Number.isFinite(config.pageSize) || config.pageSize <= 0) {
    throw new Error(`pageSize 값 오류: ${config.pageSize}`);
  }
}

async function readState(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveStartCursor(config, state) {
  const cursor = state?.currentDate;
  if (cursor && isIsoDate(cursor)) {
    if (cursor < config.startDate) {
      return config.startDate;
    }
    if (cursor > config.endDate) {
      return config.endDate;
    }
    return cursor;
  }
  return config.startDate;
}

function getNoProgressCount(state, date) {
  if (state?.lastStatus !== 'no_progress' || state?.lastProcessedDate !== date) {
    return 1;
  }
  const previousCount = Number(state?.noProgressCount || 0);
  return Math.max(previousCount, 1) + 1;
}

async function writeState(filePath, data) {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--start-date') {
      result.startDate = next;
      index += 1;
    } else if (arg === '--end-date') {
      result.endDate = next;
      index += 1;
    } else if (arg === '--delay-ms') {
      result.delayMs = next;
      index += 1;
    } else if (arg === '--page-size') {
      result.pageSize = next;
      index += 1;
    } else if (arg === '--state-file') {
      result.statePath = next;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else {
      throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  return result;
}

function printHelpAndExit() {
  console.log(`Usage:
  node scripts/selltkey-nonlogin-match.mjs [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--delay-ms 7200] [--page-size 2000] [--state-file runtime-data/selltkey-nonlogin-match-state.json]
`);
  process.exit(0);
}

function todayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function log(message) {
  console.log(`[selltkey] ${message}`);
}

function printFinalSummary(data) {
  console.log('');
  console.log(JSON.stringify({
    ok: data.ok,
    startDate: data.startDate,
    endDate: data.endDate,
    delayMs: data.delayMs,
    statePath: data.statePath,
    datesVisited: data.datesVisited,
    datesCompleted: data.datesCompleted,
    rowsMatched: data.rowsMatched,
    rowsSkipped: data.rowsSkipped,
    requestsSent: data.requestsSent,
    stoppedReason: data.stoppedReason,
    errors: data.errors,
  }, null, 2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class HttpSession {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  async request(targetPath, options = {}) {
    const url = targetPath.startsWith('http') ? targetPath : new URL(targetPath, this.baseUrl);
    const headers = new Headers(options.headers || {});
    const method = String(options.method || 'GET').toUpperCase();
    headers.set('user-agent', headers.get('user-agent') || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36');
    headers.set('accept-language', headers.get('accept-language') || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7');
    headers.set('cookie', this.cookieHeader());

    let body;
    if (options.form) {
      body = new URLSearchParams();
      for (const [key, value] of Object.entries(options.form)) {
        body.set(key, value == null ? '' : String(value));
      }
      headers.set('content-type', 'application/x-www-form-urlencoded; charset=UTF-8');
    } else {
      body = options.body;
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        status: 0,
        headers: new Headers(),
        text: '',
      };
    }

    this.storeCookies(response.headers);

    const location = response.headers.get('location');
    const redirectCount = Number(options._redirectCount || 0);
    if (location && response.status >= 300 && response.status < 400) {
      if (redirectCount >= 5) {
        return {
          ok: false,
          message: `리다이렉트 한도 초과: ${location}`,
          status: response.status,
          headers: response.headers,
          text: '',
        };
      }

      const nextMethod = response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')
        ? 'GET'
        : method;
      const nextOptions = {
        ...options,
        method: nextMethod,
        _redirectCount: redirectCount + 1,
      };
      if (nextMethod === 'GET') {
        delete nextOptions.form;
        delete nextOptions.body;
      }
      return this.request(new URL(location, url).toString(), nextOptions);
    }

    const text = await response.text();

    return {
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      headers: response.headers,
      text,
      message: response.status >= 200 && response.status < 400
        ? ''
        : `HTTP ${response.status}`,
    };
  }

  storeCookies(headers) {
    const setCookies = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : splitSetCookieHeader(headers.get('set-cookie'));
    for (const cookieText of setCookies) {
      if (!cookieText) {
        continue;
      }
      const firstPart = cookieText.split(';')[0];
      const separatorIndex = firstPart.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }
      const name = firstPart.slice(0, separatorIndex).trim();
      const value = firstPart.slice(separatorIndex + 1).trim();
      if (!name) {
        continue;
      }
      this.cookies.set(name, value);
    }
  }

  cookieHeader() {
    if (this.cookies.size === 0) {
      return '';
    }
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

function splitSetCookieHeader(headerValue) {
  if (!headerValue) {
    return [];
  }
  return String(headerValue)
    .split(/,(?=[^;]+=[^;]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

await main();
