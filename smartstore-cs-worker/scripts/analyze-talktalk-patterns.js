import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = '/Users/dh/.openclaw/workspace/smartstore-cs-worker/analysis';
const OUT_JSON = path.join(OUT_DIR, 'talktalk_patterns_2026-04-04.json');
const OUT_MD = path.join(OUT_DIR, 'talktalk_patterns_2026-04-04.md');
const CDP_URL = 'http://127.0.0.1:9223';
const MAX_CONVERSATIONS = Number(process.env.CSBOT_TALKTALK_ANALYZE_LIMIT || 30);

async function detachCdpBrowser(browser) {
  await browser?._connection?.close?.();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

function detectCategory(text) {
  const t = clean(text);
  if (!t) return 'other';
  if (/(취소|환불|반품|교환)/.test(t)) return 'cancel_refund';
  if (/(관세|부가세|추가금|관부가세|포함금액)/.test(t)) return 'tax_fee';
  if (/(언제|도착|배송|통관|출고|발송|평균배송일)/.test(t)) return 'shipping_eta';
  if (/(재고|입고|구할수|구할 수|있을까요|가능할까요|품절)/.test(t)) return 'stock';
  if (/(옵션|선택|16:9|4:3|색상)/.test(t)) return 'option';
  if (/(정품)/.test(t)) return 'authenticity';
  if (/(구성품|포함|세트|단품)/.test(t)) return 'components';
  if (/(어떻게|설치|조립|열어|사용법)/.test(t)) return 'usage';
  if (/(사이즈|실측|추천|105|44)/.test(t)) return 'size';
  return 'other';
}

function detectReplyPatterns(text) {
  const t = clean(text);
  const patterns = [];
  if (!t) return patterns;
  if (/안녕하세요|고객님/.test(t)) patterns.push('greeting');
  if (/확인 후|다시 안내/.test(t)) patterns.push('check_then_reply');
  if (/상세페이지|실측|결제 화면|옵션/.test(t)) patterns.push('reference_source');
  if (/차이|변동|상황에 따라|예상/.test(t)) patterns.push('mentions_variability');
  if (/죄송/.test(t)) patterns.push('apology');
  if (/톡톡문의|다시 문의|문의 남겨/.test(t)) patterns.push('invites_followup');
  if (/가능|없으십니다|맞습니다/.test(t)) patterns.push('states_possible');
  if (/불가|아쉽게도|어렵/.test(t)) patterns.push('states_impossible');
  if (t.length <= 35) patterns.push('short_form');
  if (t.length >= 90) patterns.push('long_form');
  return patterns;
}

function summarize(items) {
  const categoryCounts = {};
  const patternCounts = {};
  let withSellerReply = 0;

  for (const item of items) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    if (item.sellerReplies.length) withSellerReply += 1;
    for (const pattern of item.replyPatterns) {
      patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
    }
  }

  return {
    total: items.length,
    withSellerReply,
    categoryCounts,
    replyPatternCounts: patternCounts,
    topCategories: Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]),
    topPatterns: Object.entries(patternCounts).sort((a, b) => b[1] - a[1]),
  };
}

function buildMarkdown(items, summary) {
  const examples = items.slice(0, 20).map((item, idx) => {
    return [
      `### ${idx + 1}. ${item.customerName} / ${item.category}`,
      `- 태그: ${item.tag || '-'}`,
      `- 최근 문의: ${item.customerMessages[0] || item.preview || '-'}`,
      `- 대표님 답변: ${item.sellerReplies[0] || '(답변 없음)'}`,
      `- 패턴: ${item.replyPatterns.join(', ') || '-'}`,
    ].join('\n');
  }).join('\n\n');

  return `# 톡톡 답변 패턴 분석 (2026-04-04)\n\n` +
    `- 수집 대화 수: ${summary.total}건\n` +
    `- 대표님 답변 포함 대화: ${summary.withSellerReply}건\n\n` +
    `## 카테고리 분포\n` + summary.topCategories.map(([k, v]) => `- ${k}: ${v}건`).join('\n') + `\n\n` +
    `## 답변 패턴 분포\n` + summary.topPatterns.map(([k, v]) => `- ${k}: ${v}건`).join('\n') + `\n\n` +
    `## 핵심 해석\n` +
    `- 톡톡은 상품 Q&A보다 배송/통관/관세/취소 문의 비중이 높아 자동화 적합도가 더 높습니다.\n` +
    `- 대표님 답변은 짧은 즉답형과 설명형 안내형이 함께 나타나며, 배송 지연/통관 이슈에서는 사과 + 진행상황 설명 패턴이 보입니다.\n` +
    `- 확실한 사실(추가금 없음, 가능/불가)은 짧게 답하고, 배송 일정/통관 변수는 보수적으로 안내하는 흐름이 유지됩니다.\n\n` +
    `## 샘플 20건\n\n` + examples + `\n`;
}

async function getTalkFrame(page) {
  const frame = page.frames().find((f) => f.url().includes('talk.sell.smartstore.naver.com'));
  if (!frame) throw new Error('톡톡 iframe을 찾지 못했습니다.');
  return frame;
}

async function collectConversationMeta(frame) {
  const results = new Map();

  for (let step = 0; step < 15; step += 1) {
    const batch = await frame.evaluate(() => {
      const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('ul.list_chat_result > li.item_chat_result')).map((li) => {
        const link = li.querySelector('a[href*="/chat/ct/"]');
        if (!link) return null;
        const href = link.href;
        const name = clean(li.querySelector('[title]')?.textContent || li.querySelector('.text_name, .chat_name, strong')?.textContent || '');
        const tag = clean(li.querySelector('.profile_badge, .label, .badge, .tag')?.textContent || '');
        const texts = clean(li.innerText || '');
        return { href, name, tag, preview: texts };
      }).filter(Boolean);
    });

    batch.forEach((item) => results.set(item.href, item));
    if (results.size >= MAX_CONVERSATIONS) break;

    const changed = await frame.evaluate(() => {
      const list = document.querySelector('ul.list_chat_result.scroll_vertical, ul.list_chat_result');
      if (!list) return false;
      const before = list.scrollTop;
      list.scrollTop = Math.min(list.scrollTop + 650, list.scrollHeight);
      return list.scrollTop !== before;
    });
    if (!changed) break;
    await sleep(700);
  }

  return Array.from(results.values()).slice(0, MAX_CONVERSATIONS);
}

async function openConversation(frame, href) {
  await frame.evaluate((url) => {
    window.location.href = url;
  }, href);
  await sleep(1200);
}

async function extractCurrentConversation(frame, fallbackMeta) {
  return frame.evaluate((fallback) => {
    const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const chatName = clean(document.querySelector('.chat_header .chat_name, .profile_info .chat_name')?.textContent || fallback.name || '');
    const tag = clean(document.querySelector('.chat_header .profile_badge, .chat_header .label, .chat_header .tag')?.textContent || fallback.tag || '');
    const product = clean(document.querySelector('.product_name, .link_product, .chat_product a, .chat_product .title')?.textContent || '');
    const orderInfo = clean(document.querySelector('.consulting_info, .product_order, .history_inner, .purchase_history')?.textContent || '');

    const messages = Array.from(document.querySelectorAll('.message_section li._message')).map((li) => {
      const sender = li.getAttribute('data-sender') || '';
      const content = Array.from(li.querySelectorAll('p._copy_area')).map((p) => clean(p.textContent)).filter(Boolean).join('\n');
      const contentType = li.getAttribute('data-content-type') || '';
      return { sender, content, contentType, cls: li.className };
    }).filter((msg) => msg.content);

    return {
      customerName: chatName,
      tag,
      product,
      orderInfo,
      messages,
    };
  }, fallbackMeta);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages().find((p) => p.url().includes('/talktalk/chat'));
  if (!page) throw new Error('톡톡 페이지를 찾지 못했습니다.');
  const frame = await getTalkFrame(page);

  const metas = await collectConversationMeta(frame);
  const items = [];

  for (const meta of metas) {
    await openConversation(frame, meta.href);
    const current = await extractCurrentConversation(frame, meta);
    const customerMessages = current.messages.filter((m) => m.sender === 'user').map((m) => m.content);
    const sellerReplies = current.messages
      .filter((m) => m.sender === 'partner')
      .map((m) => m.content)
      .filter((text) => !text.includes('어서오세요. 또몽이네 스토어') && !text.includes('상품을 문의 주셨습니다. 어떤 점이 궁금하신가요?'));

    const seedText = `${current.tag}\n${customerMessages.join('\n')}`;
    const category = detectCategory(seedText);
    const replyPatterns = detectReplyPatterns(sellerReplies[0] || '');

    items.push({
      href: meta.href,
      customerName: current.customerName || meta.name,
      tag: current.tag || meta.tag,
      product: current.product,
      orderInfo: current.orderInfo,
      preview: meta.preview,
      customerMessages,
      sellerReplies,
      category,
      replyPatterns,
    });
    console.log(`[COLLECT] ${items.length}/${metas.length} ${current.customerName || meta.name}`);
  }

  const summary = summarize(items);
  const markdown = buildMarkdown(items, summary);
  await fs.writeFile(OUT_JSON, JSON.stringify({ summary, items }, null, 2), 'utf8');
  await fs.writeFile(OUT_MD, markdown, 'utf8');

  console.log(JSON.stringify({ outJson: OUT_JSON, outMd: OUT_MD, summary }, null, 2));
  await detachCdpBrowser(browser);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
