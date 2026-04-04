import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = '/Users/dh/.openclaw/workspace/smartstore-cs-worker/analysis';
const OUT_JSON = path.join(OUT_DIR, 'qna_answered_samples_2026-04-04.json');
const OUT_MD = path.join(OUT_DIR, 'qna_answered_summary_2026-04-04.md');
const CDP_URL = process.env.CSBOT_CDP_URL || 'http://127.0.0.1:9223';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

function detectQuestionCategory(text) {
  const t = clean(text);
  if (!t) return 'other';
  if (/(환불|보상|교환|파손|불량|신고|분쟁)/.test(t)) return 'risk_cs';
  if (/(관세|부가세|추가 지불|추가금|관부가세)/.test(t)) return 'tax_fee';
  if (/(배송비)/.test(t)) return 'shipping_fee';
  if (/(도착|언제|배송일|출고|발송지연|통관)/.test(t)) return 'shipping_eta';
  if (/(재고|입고|구매 가능|품절)/.test(t)) return 'stock';
  if (/(옵션|색상|선택)/.test(t)) return 'option';
  if (/(정품)/.test(t)) return 'authenticity';
  if (/(구성품|포함|세트|두개 맞|단품)/.test(t)) return 'components';
  if (/(호환|연동|차량만|사용 가능)/.test(t)) return 'compatibility';
  if (/(사이즈|실측|105|44|착용감)/.test(t)) return 'size';
  if (/(어떻게|열나요|사용법|조립|설치)/.test(t)) return 'usage';
  if (/(수량|2개|여러개)/.test(t)) return 'quantity';
  return 'other';
}

function detectReplyPatterns(reply) {
  const t = clean(reply);
  const tags = [];
  if (!t) return tags;
  if (/안녕하세요/.test(t)) tags.push('greeting');
  if (/확인 후 안내|다시 안내/.test(t)) tags.push('check_then_reply');
  if (/상세페이지|실측|결제 화면/.test(t)) tags.push('reference_source');
  if (/변동|차이 발생|달라질 수/.test(t)) tags.push('mentions_variability');
  if (/단정|어렵/.test(t)) tags.push('avoids_hard_commitment');
  if (/다시 문의|문의 부탁|톡톡문의/.test(t)) tags.push('invites_followup');
  if (/가능/.test(t)) tags.push('states_possible');
  if (/불가|아쉽게도/.test(t)) tags.push('states_impossible');
  if (t.length <= 35) tags.push('short_form');
  if (t.length >= 90) tags.push('long_form');
  return tags;
}

async function applyAnsweredFilter(page) {
  const rows = page.locator('form[name="registerForm"] li');
  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const text = clean(await row.textContent().catch(() => ''));
    if (!text.startsWith('답변')) continue;
    await row.locator('.selectize-input').click();
    await sleep(300);
    await page.locator('.selectize-dropdown .option[data-value="true"]').click();
    await sleep(300);
    await page.locator('form[name="registerForm"] button.btn.btn-primary[type="submit"]').click();
    await sleep(2500);
    return;
  }
  throw new Error('답변 필터 row를 찾지 못했습니다.');
}

async function getPagerInfo(page) {
  return page.evaluate(() => ({
    current: Number(document.querySelector('span.text-primary[aria-label="현재 페이지"]')?.textContent?.trim() || '1'),
    total: Number(document.querySelector('span[aria-label="전체 페이지"]')?.textContent?.trim() || '1')
  }));
}

async function gotoNextPage(page, expectedPage) {
  await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[role="button"]'));
    const next = anchors.find((a) => {
      const sr = a.querySelector('.sr-only');
      return sr && sr.textContent.includes('다음 페이지로 이동') && !a.classList.contains('btn-default');
    }) || anchors.find((a) => {
      const sr = a.querySelector('.sr-only');
      return sr && sr.textContent.includes('다음 페이지로 이동');
    });
    if (!next) throw new Error('다음 페이지 버튼을 찾지 못했습니다.');
    next.click();
  });

  await page.waitForFunction((pageNum) => {
    const cur = document.querySelector('span.text-primary[aria-label="현재 페이지"]');
    return Number(cur?.textContent?.trim() || '0') === pageNum;
  }, expectedPage, { timeout: 15000 });
  await sleep(1500);
}

async function extractPageRows(page) {
  const rows = page.locator('ui-view[name="list"] > ul.seller-list-border.has-thmb > li');
  const count = await rows.count();
  const items = [];

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const label = clean(await row.locator('.title-area .label').first().textContent().catch(() => ''));
    if (!label.includes('답변완료')) continue;

    const replyBtn = row.locator('.btn-area button').first();
    try {
      await replyBtn.click({ timeout: 3000 });
      await sleep(600);
    } catch {
      // continue extracting without click
    }

    const data = await row.evaluate((el) => {
      const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      const qTitle = clean(el.querySelector('.title-area strong')?.textContent || '');
      const qBody = clean(el.querySelector('p.text-area')?.textContent || '');
      const meta = clean(el.querySelector('.partition-area')?.textContent || '');
      const replies = Array.from(el.querySelectorAll('.seller-reply-list li span.write-area[style*="white-space"], .seller-reply-list li .write-area > span.write-area'))
        .map((n) => clean(n.textContent))
        .filter(Boolean);
      return { qTitle, qBody, meta, replies };
    });

    items.push(data);
  }

  return items;
}

function buildSummary(items) {
  const categoryCounts = {};
  const replyPatternCounts = {};
  let greetingCount = 0;
  let shortCount = 0;
  let longCount = 0;

  for (const item of items) {
    const category = detectQuestionCategory(`${item.qTitle}\n${item.qBody}`);
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    item.detectedCategory = category;

    const mainReply = item.replies?.[0] || '';
    const patterns = detectReplyPatterns(mainReply);
    item.replyPatterns = patterns;
    for (const pattern of patterns) replyPatternCounts[pattern] = (replyPatternCounts[pattern] || 0) + 1;
    if (patterns.includes('greeting')) greetingCount += 1;
    if (patterns.includes('short_form')) shortCount += 1;
    if (patterns.includes('long_form')) longCount += 1;
  }

  const total = items.length;
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  const topPatterns = Object.entries(replyPatternCounts).sort((a, b) => b[1] - a[1]);

  return {
    total,
    categoryCounts,
    replyPatternCounts,
    greetingCount,
    shortCount,
    longCount,
    topCategories,
    topPatterns,
  };
}

function buildMarkdown(items, summary) {
  const examples = items.slice(0, 20).map((item, idx) => {
    const reply = item.replies?.[0] || '(답변 없음)';
    return [
      `### ${idx + 1}. ${item.detectedCategory}`,
      `- 상품: ${item.qTitle}`,
      `- 문의: ${item.qBody}`,
      `- 답변: ${reply}`,
      `- 패턴: ${item.replyPatterns.join(', ') || '-'}`,
    ].join('\n');
  }).join('\n\n');

  return `# 상품 Q&A 답변완료 다페이지 분석 (2026-04-04)\n\n` +
    `- 수집 건수: ${summary.total}건\n` +
    `- 인사말 포함 답변: ${summary.greetingCount}건\n` +
    `- 짧은 즉답형: ${summary.shortCount}건\n` +
    `- 긴 설명형: ${summary.longCount}건\n\n` +
    `## 문의 카테고리 분포\n` +
    summary.topCategories.map(([k, v]) => `- ${k}: ${v}건`).join('\n') + `\n\n` +
    `## 답변 패턴 분포\n` +
    summary.topPatterns.map(([k, v]) => `- ${k}: ${v}건`).join('\n') + `\n\n` +
    `## 핵심 해석\n` +
    `- 대표님 답변은 여전히 \`짧은 즉답형\`과 \`설명형 안내형\` 두 트랙이 공존합니다.\n` +
    `- \`상세페이지/실측/결제화면\` 같은 기준점을 제시하는 패턴이 반복됩니다.\n` +
    `- 일정/통관/사이즈처럼 오차 가능성이 있는 질문에는 단정 회피 표현이 자주 보입니다.\n` +
    `- 확실한 가능/불가는 짧게 단정하는 답변이 많습니다.\n\n` +
    `## 샘플 20건\n\n` + examples + `\n`;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => p.url().includes('#/comment/'));
  if (!page) throw new Error('Q&A 페이지를 찾지 못했습니다.');

  await applyAnsweredFilter(page);
  const pager = await getPagerInfo(page);
  const items = [];

  for (let current = pager.current; current <= pager.total; current += 1) {
    const pageItems = await extractPageRows(page);
    items.push(...pageItems.map((item) => ({ page: current, ...item })));
    console.log(`[PAGE ${current}/${pager.total}] collected ${pageItems.length} rows`);
    if (current < pager.total) await gotoNextPage(page, current + 1);
  }

  const summary = buildSummary(items);
  const markdown = buildMarkdown(items, summary);
  await fs.writeFile(OUT_JSON, JSON.stringify({ summary, items }, null, 2), 'utf8');
  await fs.writeFile(OUT_MD, markdown, 'utf8');

  console.log(JSON.stringify({ outJson: OUT_JSON, outMd: OUT_MD, total: items.length, summary }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
