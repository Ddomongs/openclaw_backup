import { CONFIG } from './config.js';
import { cleanText } from './utils.js';

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
  url.searchParams.set('find', 'gr_tc_invoice');
  url.searchParams.set('value', invoiceNo);
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
  const url = buildQuickstarInvoiceUrl(invoiceNo);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  return page.evaluate((trackingNo) => {
    const statusEl = document.querySelector('span[class^="new_color"]');
    const status = statusEl ? statusEl.textContent.trim() : '';

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
    const noResult = /조회 결과 없음|검색 결과 없음|데이터가 없습니다/.test(pageText);
    const loginRequired = /로그인|회원가입|아이디|비밀번호/.test(pageText);

    return {
      invoiceNo: trackingNo,
      status,
      arrival,
      noResult,
      loginRequired,
      pageText: pageText.slice(0, 1000),
      url: location.href,
    };
  }, invoiceNo);
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

  const lines = [opening, '', `국내 운송장 기준 확인 상태: ${shipment.status}`];
  if (shipment.arrival) {
    lines.push(`예상 반입 정보: ${shipment.arrival}`);
  }

  if (/배송|언제|도착|조회|통관/.test(body)) {
    lines.push('확인되는 범위 내에서 순차적으로 배송 진행 중이며, 추가 상태 변동 시 조회 내용이 업데이트될 수 있습니다.');
  }

  return {
    text: lines.join('\n'),
    confidence: 'medium',
  };
}
