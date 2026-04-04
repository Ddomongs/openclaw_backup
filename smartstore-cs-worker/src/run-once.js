import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { SS } from './smartstore-selectors.js';
import { cleanText, extract12DigitInvoice, firstExistingSelector, firstVisibleLocator, sleep } from './utils.js';
import { ensureQuickstarLoaded, lookupTrackingWithExtension } from './quickstar-extension.js';

async function connectContext() {
  const browser = await chromium.connectOverCDP(CONFIG.cdpUrl);
  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error('연결된 Chrome context가 없습니다. Chrome 원격 디버깅 포트를 확인하세요.');
  }
  return contexts[0];
}

async function getOrCreateSmartstorePage(context) {
  const existing = context.pages().find(page => page.url().includes('sell.smartstore.naver.com'));
  if (existing) return existing;

  const page = await context.newPage();
  await page.goto(CONFIG.smartstoreQaUrl, { waitUntil: 'domcontentloaded' });
  return page;
}

async function ensureQaPage(page) {
  if (!page.url().includes('#/comment/')) {
    await page.goto(CONFIG.smartstoreQaUrl, { waitUntil: 'domcontentloaded' });
    await sleep(CONFIG.timeouts.short);
  }
}

async function collectUnansweredIndexes(page) {
  const rowSelector = await firstExistingSelector(page, SS.unansweredListCandidates);
  if (!rowSelector) {
    throw new Error('미답변 문의 목록 selector를 찾지 못했습니다. src/smartstore-selectors.js 보정이 필요합니다.');
  }

  const rows = page.locator(rowSelector);
  const count = await rows.count();
  const indexes = [];

  for (let i = 0; i < Math.min(count, CONFIG.pollLimit); i += 1) {
    const row = rows.nth(i);
    const text = cleanText(await row.textContent().catch(() => ''));
    if (text.includes('미답변') || text.includes('답변대기')) {
      indexes.push(i);
    }
  }

  return { rowSelector, indexes };
}

async function openInquiryByIndex(page, rowSelector, index) {
  const row = page.locator(rowSelector).nth(index);
  await row.click();
  await sleep(CONFIG.timeouts.short);
}

async function extractTextByCandidates(page, candidates) {
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      const text = cleanText(await locator.textContent({ timeout: 1000 }));
      if (text) return text;
    } catch {
      // continue
    }
  }
  return '';
}

async function extractInquiryPayload(page) {
  const title = await extractTextByCandidates(page, SS.inquiryTitleCandidates);
  const body = await extractTextByCandidates(page, SS.inquiryBodyCandidates);
  const orderInfo = await extractTextByCandidates(page, SS.orderInfoCandidates);

  const merged = [title, body, orderInfo].filter(Boolean).join('\n');
  const invoiceNo = extract12DigitInvoice(merged);

  return { title, body, orderInfo, invoiceNo, rawText: merged };
}

async function fillAnswer(page, answerText) {
  const target = await firstVisibleLocator(page, SS.answerTextareaCandidates);
  if (!target) {
    throw new Error('답변 입력창 selector를 찾지 못했습니다. src/smartstore-selectors.js 보정이 필요합니다.');
  }

  const tagName = await target.locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
  if (tagName === 'textarea') {
    await target.locator.fill(answerText);
  } else {
    await target.locator.click();
    await page.keyboard.press('Meta+A').catch(() => {});
    await page.keyboard.type(answerText, { delay: 5 });
  }
}

async function submitAnswer(page) {
  const submitSelector = await firstExistingSelector(page, SS.submitButtonCandidates);
  if (!submitSelector) {
    throw new Error('답변 등록 버튼 selector를 찾지 못했습니다. src/smartstore-selectors.js 보정이 필요합니다.');
  }

  await page.locator(submitSelector).first().click();

  for (const toastSelector of SS.successToastCandidates) {
    try {
      await page.locator(toastSelector).first().waitFor({ timeout: CONFIG.timeouts.long });
      return true;
    } catch {
      // try next
    }
  }

  return false;
}

async function processInquiry(page, rowSelector, index) {
  await openInquiryByIndex(page, rowSelector, index);

  const inquiry = await extractInquiryPayload(page);
  console.log('[INQUIRY]', JSON.stringify(inquiry, null, 2));

  if (!inquiry.invoiceNo) {
    console.log('[SKIP] 12자리 운송장을 찾지 못했습니다.');
    return { skipped: true, reason: 'invoice_missing' };
  }

  await ensureQuickstarLoaded(page);
  const quickstarResult = await lookupTrackingWithExtension(page, inquiry.invoiceNo);
  console.log('[QUICKSTAR]', JSON.stringify(quickstarResult, null, 2));

  if (!quickstarResult.hasResult) {
    console.log('[SKIP] 퀵스타 결과/초안이 없습니다. 로그인 또는 조회 결과를 확인하세요.');
    return { skipped: true, reason: 'quickstar_no_result', inquiry, quickstarResult };
  }

  if (!quickstarResult.draftText) {
    console.log('[SKIP] 퀵스타가 고객 답변 초안을 만들지 못했습니다.');
    return { skipped: true, reason: 'draft_missing', inquiry, quickstarResult };
  }

  if (CONFIG.dryRun) {
    console.log('[DRY_RUN] 실제 답변 등록은 하지 않았습니다.');
    return { skipped: false, dryRun: true, inquiry, quickstarResult };
  }

  await fillAnswer(page, quickstarResult.draftText);
  const submitted = await submitAnswer(page);

  return {
    skipped: false,
    submitted,
    inquiry,
    quickstarResult,
  };
}

async function main() {
  console.log('[START] smartstore-cs-worker run-once');
  console.log('[CONFIG]', JSON.stringify(CONFIG));

  const context = await connectContext();
  const page = await getOrCreateSmartstorePage(context);

  await ensureQaPage(page);
  await ensureQuickstarLoaded(page);

  const { rowSelector, indexes } = await collectUnansweredIndexes(page);
  console.log('[ROWS]', { rowSelector, indexes });

  if (!indexes.length) {
    console.log('[DONE] 처리할 미답변 문의가 없습니다.');
    return;
  }

  for (const index of indexes) {
    try {
      const result = await processInquiry(page, rowSelector, index);
      console.log('[RESULT]', JSON.stringify(result, null, 2));
      await sleep(1500);
    } catch (error) {
      console.error('[ERROR]', index, error);
    }
  }

  console.log('[DONE] run-once finished');
}

main().catch(error => {
  console.error('[FATAL]', error);
  process.exit(1);
});
