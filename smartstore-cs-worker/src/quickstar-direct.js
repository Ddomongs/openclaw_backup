import { CONFIG } from './config.js';
import { cleanText } from './utils.js';

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
  for (const match of source.match(/010-\d{4}-\d{4}/g) || []) push(match, 'gr_tel');
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

export async function getOrCreateQuickstarPage(context) {
  const existing = context.pages().find(page => page.url().includes('quickstar.co.kr'));
  if (existing) return existing;

  const page = await context.newPage();
  await page.goto(CONFIG.quickstarBaseUrl, { waitUntil: 'domcontentloaded' });
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
    const explicitNoResult = /조회 결과 없음|검색 결과 없음|데이터가 없습니다/.test(pageText);
    const hasLoginWord = /로그인\b|로그인 후|회원가입|비밀번호 찾기|아이디 찾기/.test(pageText);
    const hasMypageWord = /마이페이지|신청내역|입고대기|출고완료|로그아웃|배송대행/.test(pageText);
    const loginRequired = hasLoginWord && !hasMypageWord;
    const noResult = explicitNoResult || (!loginRequired && !status && resultRows === 0);

    return {
      query: { find, value },
      invoiceNo: find === 'gr_tc_invoice' ? value : null,
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
