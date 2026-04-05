import { chromium } from 'playwright';
import { CONFIG } from './config.js';
import { SS } from './smartstore-selectors.js';
import { cleanText, extract12DigitInvoice, firstExistingSelector, firstVisibleLocator, sleep } from './utils.js';
import { buildDeliveryDraft, ensureQuickstarSession, fetchQuickstarByInvoice, getOrCreateQuickstarPage, getOrCreateQuickstarWorkerPage } from './quickstar-direct.js';
import { buildAssistItem, writeAssistReport } from './qna-assist.js';
import { buildQnaDraft } from './qna-drafts.js';

async function detachCdpBrowser(browser) {
  await browser?._connection?.close?.();
}

async function connectContext() {
  const browser = await chromium.connectOverCDP(CONFIG.cdpUrl);
  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error('연결된 Chrome context가 없습니다. Chrome 원격 디버깅 포트를 확인하세요.');
  }
  return { browser, context: contexts[0] };
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

async function applyUnansweredFilter(page) {
  const rows = page.locator(SS.answerFilterRow);
  const count = await rows.count();

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const text = cleanText(await row.textContent().catch(() => ''));
    if (!text.startsWith(SS.answerFilterLabelText)) continue;

    await row.locator(SS.answerFilterSelect).click();
    await sleep(300);
    await page.locator(SS.answerFilterOptionUnanswered).click();
    await sleep(300);
    await page.locator(SS.searchButton).click();
    await sleep(CONFIG.timeouts.medium);
    return true;
  }

  throw new Error('답변 상태 필터 row를 찾지 못했습니다.');
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
    const hasUnanswered = await row.locator(SS.rowUnansweredLabel).count().catch(() => 0);
    const text = cleanText(await row.textContent().catch(() => ''));
    if (hasUnanswered > 0 || text.startsWith('미답변')) {
      indexes.push(i);
    }
  }

  return { rowSelector, indexes };
}

async function extractTextByCandidates(scope, candidates) {
  for (const selector of candidates) {
    const locator = scope.locator(selector).first();
    try {
      const text = cleanText(await locator.textContent({ timeout: 1000 }));
      if (text) return text;
    } catch {
      // continue
    }
  }
  return '';
}

async function extractInquiryPayload(row) {
  const title = await extractTextByCandidates(row, SS.inquiryTitleCandidates);
  const body = await extractTextByCandidates(row, SS.inquiryBodyCandidates);
  const orderInfo = await extractTextByCandidates(row, SS.orderInfoCandidates);

  const merged = [title, body, orderInfo].filter(Boolean).join('\n');
  const invoiceNo = extract12DigitInvoice(merged);

  return { title, body, orderInfo, invoiceNo, rawText: merged };
}

async function openReplyEditor(row) {
  const button = row.locator(SS.rowReplyButton).first();
  await button.click();
  await row.locator(SS.rowReplySection).waitFor({ state: 'visible', timeout: CONFIG.timeouts.long });
  await sleep(300);
}

async function fillAnswer(page, row, answerText) {
  const target = await firstVisibleLocator(row, SS.answerTextareaCandidates);
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

async function submitAnswer(page, row) {
  const submitSelector = await firstExistingSelector(row, SS.submitButtonCandidates);
  if (!submitSelector) {
    throw new Error('답변 등록 버튼 selector를 찾지 못했습니다. src/smartstore-selectors.js 보정이 필요합니다.');
  }

  await row.locator(submitSelector).first().click();

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
  const row = page.locator(rowSelector).nth(index);

  const inquiry = await extractInquiryPayload(row);
  console.log('[INQUIRY]', JSON.stringify(inquiry, null, 2));

  if (!inquiry.invoiceNo) {
    const qnaDraft = buildQnaDraft(inquiry);
    console.log('[QNA_DRAFT]', JSON.stringify(qnaDraft, null, 2));

    if (!qnaDraft.matched || !qnaDraft.text) {
      console.log('[SKIP] 일반문의 규칙에 매칭되지 않았습니다.');
      return { skipped: true, reason: 'qna_rule_not_matched', inquiry, qnaDraft };
    }

    if (CONFIG.qnaMode === 'assist') {
      return {
        skipped: false,
        assist: true,
        inquiry,
        draft: qnaDraft,
        assistItem: buildAssistItem({ inquiry, draft: qnaDraft, source: 'qna' }),
      };
    }

    if (CONFIG.dryRun) {
      console.log('[DRY_RUN] 일반문의 초안만 생성했습니다.');
      return { skipped: false, dryRun: true, inquiry, draft: qnaDraft };
    }

    await openReplyEditor(row);
    await fillAnswer(page, row, qnaDraft.text);
    const submitted = await submitAnswer(page, row);

    return { skipped: false, submitted, inquiry, draft: qnaDraft };
  }

  const context = page.context();
  const quickstarPage = await getOrCreateQuickstarPage(context);
  const quickstarSession = await ensureQuickstarSession(quickstarPage);
  console.log('[QUICKSTAR_SESSION]', JSON.stringify(quickstarSession, null, 2));

  if (!quickstarSession.ok) {
    return { skipped: true, reason: 'quickstar_session_invalid', inquiry, quickstarSession };
  }

  const quickstarWorkerPage = await getOrCreateQuickstarWorkerPage(browser, context);
  const quickstarResult = await fetchQuickstarByInvoice(quickstarWorkerPage, inquiry.invoiceNo);
  console.log('[QUICKSTAR]', JSON.stringify(quickstarResult, null, 2));

  const draft = buildDeliveryDraft({ inquiry, shipment: quickstarResult });
  if (!draft?.text) {
    return { skipped: true, reason: 'draft_missing', inquiry, quickstarResult };
  }

  if (CONFIG.qnaMode === 'assist') {
    return {
      skipped: false,
      assist: true,
      inquiry,
      quickstarResult,
      draft,
      assistItem: buildAssistItem({ inquiry, draft, source: 'delivery' }),
    };
  }

  if (CONFIG.dryRun) {
    console.log('[DRY_RUN] 실제 답변 등록은 하지 않았습니다.');
    return { skipped: false, dryRun: true, inquiry, quickstarResult, draft };
  }

  await openReplyEditor(row);
  await fillAnswer(page, row, draft.text);
  const submitted = await submitAnswer(page, row);

  return {
    skipped: false,
    submitted,
    inquiry,
    quickstarResult,
    draft,
  };
}

async function main() {
  console.log('[START] smartstore-cs-worker run-once');
  console.log('[CONFIG]', JSON.stringify(CONFIG));

  const { browser, context } = await connectContext();
  const assistItems = [];

  try {
    const page = await getOrCreateSmartstorePage(context);

    await ensureQaPage(page);
    await applyUnansweredFilter(page);

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
        if (result?.assistItem) assistItems.push(result.assistItem);
        await sleep(1500);
      } catch (error) {
        console.error('[ERROR]', index, error);
      }
    }

    if (CONFIG.qnaMode === 'assist') {
      await writeAssistReport(CONFIG.assistReportPath, assistItems);
      console.log('[ASSIST_REPORT]', CONFIG.assistReportPath);
    }
  } finally {
    await detachCdpBrowser(browser).catch(() => {});
  }

  console.log('[DONE] run-once finished');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[FATAL]', error);
    process.exit(1);
  });
