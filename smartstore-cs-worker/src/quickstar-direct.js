import { CONFIG } from './config.js';
import { cleanText } from './utils.js';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateLabel(date) {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}월 ${dd}일 (${DAYS[date.getDay()]})`;
}

function parseCjDate(value) {
  const match = String(value || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDayNames(text) {
  return String(text || '').replace(/(\d{1,2})\/(\d{1,2})(?:~(\d{1,2})\/(\d{1,2})|~(\d{1,2}))/, (...args) => {
    const startMonth = Number(args[1]);
    const startDay = Number(args[2]);
    const hasSecondMonth = Boolean(args[3]);
    const endMonth = hasSecondMonth ? Number(args[3]) : startMonth;
    const endDay = hasSecondMonth ? Number(args[4]) : Number(args[5]);
    const year = new Date().getFullYear();
    const startDate = new Date(year, startMonth - 1, startDay);
    const endDate = new Date(year, endMonth - 1, endDay);
    const range = hasSecondMonth
      ? `${startMonth}/${startDay}~${endMonth}/${endDay}`
      : `${startMonth}/${startDay}~${endDay}`;
    return `${range} (${DAYS[startDate.getDay()]}, ${DAYS[endDate.getDay()]})`;
  });
}

function normalizeArrivalLabel(text) {
  const value = cleanText(text);
  if (!value) return '';
  return /반입 예정$/.test(value) ? value : `${value} 반입 예정`;
}

export function detectQuickstarCategory(value) {
  const normalized = cleanText(value);
  if (!normalized) return null;

  if (/^\d{12}$/.test(normalized)) return 'gr_tc_invoice';
  if (/^GR/i.test(normalized)) return 'or_gr_code';
  if (/^010-/.test(normalized)) return 'gr_tel';
  if (/^(YT|78|SF|JD|77)/i.test(normalized)) return 'it_local_invoice';
  if (/^\d{16,}$/.test(normalized)) return 'it_local_order';
  if (/^[가-힣]{2,4}$/.test(normalized)) return 'gr_name';
  if (/^[a-zA-Z][a-zA-Z0-9 ]{1,}$/.test(normalized)) return 'it_name';
  return null;
}

export function extractQuickstarQueryCandidates({ text = '', customerName = '', buyerName = '' } = {}) {
  const source = cleanText(text);
  const candidates = [];
  const push = (value, find) => {
    const normalizedValue = cleanText(value);
    if (!normalizedValue || !find) return;
    if (candidates.some((item) => item.value === normalizedValue && item.find === find)) return;
    candidates.push({ value: normalizedValue, find });
  };

  for (const match of source.match(/\b\d{12}\b/g) || []) push(match, 'gr_tc_invoice');
  for (const match of source.match(/\bGR[0-9A-Z-]+\b/gi) || []) push(match, 'or_gr_code');
  for (const match of source.match(/010-\d{4}-\d{4}/g) || []) {
    push(match, 'gr_tel');
    push(match.replace(/-/g, ''), 'gr_tel');
  }
  for (const match of source.match(/\b(?:YT|78|SF|JD|77)[A-Z0-9-]+\b/gi) || []) push(match, 'it_local_invoice');
  for (const match of source.match(/\b\d{16,}\b/g) || []) push(match, 'it_local_order');

  const preferredName = /^[가-힣]{2,4}$/.test(cleanText(buyerName)) ? cleanText(buyerName) : cleanText(customerName);
  if (/^[가-힣]{2,4}$/.test(preferredName)) push(preferredName, 'gr_name');

  return candidates;
}

function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getDateRange() {
  const today = new Date();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  return {
    sdate: formatDate(oneYearAgo),
    edate: formatDate(today),
  };
}

export function buildQuickstarInvoiceUrl(invoiceNo) {
  return buildQuickstarSearchUrl('gr_tc_invoice', invoiceNo);
}

export function buildQuickstarSearchUrl(find, value) {
  const { sdate, edate } = getDateRange();
  const url = new URL('/mypage/service_list.php', CONFIG.quickstarBaseUrl);
  url.searchParams.set('mb_id', CONFIG.quickstarMbId);
  url.searchParams.set('or_de_no', '');
  url.searchParams.set('state', '');
  url.searchParams.set('type', 'ship');
  url.searchParams.set('dtype', 'add');
  url.searchParams.set('sdate', sdate);
  url.searchParams.set('edate', edate);
  url.searchParams.set('gr_unipass_result', '');
  url.searchParams.set('gr_tr_no', '');
  url.searchParams.set('gr_fltno', '');
  url.searchParams.set('gr_fltno2', '');
  url.searchParams.set('find', find);
  url.searchParams.set('value', value);
  url.searchParams.set('pageblock', CONFIG.quickstarPageblock);
  url.hash = 'page1';
  return url.toString();
}

const QUICKSTAR_LOGIN_PAGE_NAME = '__CSBOT_QUICKSTAR_LOGIN__';
const QUICKSTAR_WORKER_PAGE_NAME = '__CSBOT_QUICKSTAR_WORKER__';
const QUICKSTAR_WORKER_BOOT_URL = 'data:text/html,<title>csbot-quickstar-worker</title>';

async function getPageName(page) {
  return page.evaluate(() => window.name || '').catch(() => '');
}

async function setPageName(page, name) {
  await page.evaluate((nextName) => {
    window.name = nextName;
  }, name).catch(() => {});
}

async function findQuickstarNamedPage(context, pageName) {
  for (const page of context.pages()) {
    if (!page.url().includes('quickstar.co.kr')) continue;
    if ((await getPageName(page)) === pageName) return page;
  }
  return null;
}

async function createBackgroundWorkerPage(browser, context) {
  try {
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Target.createTarget', {
      url: QUICKSTAR_WORKER_BOOT_URL,
      background: true,
    });
    await cdp.detach().catch(() => {});

    const started = Date.now();
    while (Date.now() - started < 5000) {
      const page = context.pages().find((item) => item.url() === QUICKSTAR_WORKER_BOOT_URL);
      if (page) return page;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  } catch {
    // fallback below
  }

  return context.newPage();
}

export async function getOrCreateQuickstarPage(context) {
  const named = await findQuickstarNamedPage(context, QUICKSTAR_LOGIN_PAGE_NAME);
  if (named) return named;

  let existing = null;
  for (const page of context.pages()) {
    const url = page.url();
    if (!url.includes('quickstar.co.kr')) continue;
    const pageName = await getPageName(page);
    if (pageName === QUICKSTAR_WORKER_PAGE_NAME) continue;
    if (!url.includes('/mypage/service_list.php')) {
      existing = page;
      break;
    }
    if (!existing) existing = page;
  }

  if (existing) {
    await setPageName(existing, QUICKSTAR_LOGIN_PAGE_NAME);
    return existing;
  }

  const page = await context.newPage();
  await page.goto(CONFIG.quickstarBaseUrl, { waitUntil: 'domcontentloaded' });
  await setPageName(page, QUICKSTAR_LOGIN_PAGE_NAME);
  return page;
}

export async function getOrCreateQuickstarWorkerPage(browser, context) {
  const named = await findQuickstarNamedPage(context, QUICKSTAR_WORKER_PAGE_NAME);
  if (named) return named;

  const existing = context.pages().find((page) => {
    const url = page.url();
    return url.includes('quickstar.co.kr/mypage/service_list.php');
  });

  if (existing) {
    await setPageName(existing, QUICKSTAR_WORKER_PAGE_NAME);
    return existing;
  }

  const page = await createBackgroundWorkerPage(browser, context);
  await setPageName(page, QUICKSTAR_WORKER_PAGE_NAME);
  return page;
}

export async function ensureQuickstarSession(page) {
  if (!page.url().includes('quickstar.co.kr')) {
    await page.goto(CONFIG.quickstarBaseUrl, { waitUntil: 'domcontentloaded' });
  }

  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const href = location.href;
    const hasLoginWord = /로그인|회원가입|아이디|비밀번호/.test(text);
    const hasMypageWord = /마이페이지|결제대기|배송대행|미트래킹/.test(text);
    return {
      url: href,
      hasLoginWord,
      hasMypageWord,
      bodyPreview: text.slice(0, 200),
    };
  });

  return {
    ok: !state.hasLoginWord || state.hasMypageWord,
    ...state,
  };
}

export async function fetchQuickstarByInvoice(page, invoiceNo) {
  return fetchQuickstarByQuery(page, { find: 'gr_tc_invoice', value: invoiceNo });
}

export async function fetchQuickstarByQuery(page, query) {
  const { find, value } = query;
  const url = buildQuickstarSearchUrl(find, value);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  return page.evaluate(({ find, value }) => {
    const statusEls = Array.from(document.querySelectorAll('span[class^="new_color"]')).map(el => el.textContent.trim()).filter(Boolean);
    const status = statusEls[0] || '';
    const resultRows = Array.from(document.querySelectorAll('table tbody tr')).filter(tr => tr.querySelectorAll('td').length >= 3).length;

    let arrival = '';
    const redPs = document.querySelectorAll('p[style*="color:#f00"]');
    for (const p of redPs) {
      const text = p.textContent.trim();
      if (text && text.includes('반입')) {
        arrival = text;
        break;
      }
    }

    const pageText = document.body?.innerText || '';
    const groupNoMatch = pageText.match(/\bGR\d{8,}\b/i);
    const domesticInvoiceMatch = pageText.match(/CJ대한통운\s+(\d{12})/);
    const overseasOrderMatch = pageText.match(/주문번호\s+(\d{16,})/);
    const explicitNoResult = /조회 결과 없음|검색 결과 없음|데이터가 없습니다/.test(pageText);
    const hasLoginWord = /로그인\b|로그인 후|회원가입|비밀번호 찾기|아이디 찾기/.test(pageText);
    const hasMypageWord = /마이페이지|신청내역|입고대기|출고완료|로그아웃|배송대행/.test(pageText);
    const loginRequired = hasLoginWord && !hasMypageWord;
    const hasRealResult = Boolean(status || groupNoMatch || domesticInvoiceMatch || overseasOrderMatch);
    const noResult = explicitNoResult || (!loginRequired && !hasRealResult);

    return {
      query: { find, value },
      invoiceNo: find === 'gr_tc_invoice' ? value : (domesticInvoiceMatch?.[1] || null),
      groupNo: groupNoMatch?.[0] || null,
      overseasOrderNo: overseasOrderMatch?.[1] || null,
      status,
      statusCount: statusEls.length,
      resultRows,
      multipleResults: statusEls.length > 1 || resultRows > 1,
      arrival,
      noResult,
      loginRequired,
      pageText: pageText.slice(0, 1000),
      url: location.href,
    };
  }, { find, value });
}

export async function resolveQuickstarShipment(page, payload) {
  const candidates = extractQuickstarQueryCandidates(payload);
  for (const candidate of candidates) {
    const result = await fetchQuickstarByQuery(page, candidate);
    if (result.loginRequired) return { ok: false, reason: 'login_required', query: candidate, result };
    if (result.noResult) continue;
    if (result.multipleResults && candidate.find !== 'gr_tc_invoice') {
      return { ok: false, reason: 'multiple_results', query: candidate, result };
    }
    if (result.status) return { ok: true, query: candidate, result };
  }
  return { ok: false, reason: 'no_result', candidates };
}

export function buildDeliveryDraft({ inquiry, shipment }) {
  const body = cleanText(inquiry.body || inquiry.rawText || '');
  const opening = '문의하신 배송 관련 내용 확인해 안내드립니다.';

  if (!shipment || shipment.loginRequired) {
    return {
      text: `${opening}\n\n현재 배송 조회 세션 확인이 필요해 정확한 상태 확인 후 다시 안내드리겠습니다. 조금만 기다려 주세요.`,
      confidence: 'low',
    };
  }

  if (shipment.noResult || !shipment.status) {
    return {
      text: `${opening}\n\n현재 등록된 운송장 기준으로 즉시 확인되는 배송 정보가 없어 추가 확인 후 다시 안내드리겠습니다. 조금만 기다려 주세요.`,
      confidence: 'low',
    };
  }

  const queryLabel = shipment?.query?.find === 'gr_tc_invoice' ? '국내 운송장 기준' : '배송 조회 기준';
  const lines = [opening, '', `${queryLabel} 확인 상태: ${shipment.status}`];
  if (shipment.arrival) {
    lines.push(`예상 반입 정보: ${shipment.arrival}`);
  }

  if (/배송|언제|도착|조회|통관/.test(body)) {
    lines.push('확인되는 범위 내에서 순차적으로 배송 진행 중이며, 추가 상태 변동 시 조회 내용이 업데이트될 수 있습니다.');
  }

  const trackingValue = shipment?.query?.find === 'gr_tc_invoice' ? shipment?.query?.value : shipment?.invoiceNo;
  if (trackingValue) {
    lines.push('');
    lines.push(`배송 조회: http://tracking.tipoasis.com/${trackingValue}`);
  }

  return {
    text: lines.join('\n'),
    confidence: 'medium',
  };
}

export function buildRichDeliveryDraft({ shipment, cj = null, invoiceNo = '' }) {
  const trackingNo = cleanText(invoiceNo || shipment?.invoiceNo || shipment?.query?.value || '');

  if (!shipment || shipment.loginRequired || shipment.noResult || !shipment.status || !trackingNo) {
    return {
      text: '안녕하세요, 고객님 😊\n배송 현황 안내를 위해 추가 확인이 필요합니다.\n\n추가 문의는 톡톡문의로 남기시면 빠른 답변 드리겠습니다.',
      confidence: 'low',
    };
  }

  const lines = [
    '안녕하세요, 고객님 😊',
    '배송 현황 안내드립니다.',
    '',
    '━━━━━━━━━━━━━━━━',
    `📦 해외지사: ${shipment.status}`,
  ];

  if (cj?.status) {
    let cjLine = `🚛 국내배송: ${cj.status}`;
    if (cj.empName) {
      cjLine += ` (배달기사: ${cj.empName}`;
      if (cj.empPhone) cjLine += ` ${cj.empPhone}`;
      cjLine += ')';
    }
    lines.push(cjLine);
  }

  if (shipment.arrival) {
    lines.push(`📅 국내 반입: ${normalizeArrivalLabel(addDayNames(shipment.arrival))}`);
  }

  const cjDate = parseCjDate(cj?.lastUpdate);
  if (cjDate && cj?.status && /배송완료|배달완료/.test(cj.status)) {
    lines.push(`🚚 배송 완료: ${formatDateLabel(cjDate)}`);
  } else if (cjDate && cj?.status) {
    lines.push(`🚚 배송 진행: ${formatDateLabel(cjDate)} 기준`);
  }

  lines.push('━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('🔍 배송 조회:');
  lines.push(`http://tracking.tipoasis.com/${trackingNo}`);
  lines.push('');
  lines.push('빠른 배송을 위해 최선을 다하겠습니다 🙏');
  lines.push('감사합니다.');

  return {
    text: lines.join('\n'),
    confidence: cj?.status ? 'high' : 'medium',
  };
}
