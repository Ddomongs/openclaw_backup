import { chromium } from 'playwright';
import { buildTalktalkDraft } from '../src/talktalk-drafts.js';
import { buildTalktalkAssistItem, writeTalktalkAssistReport } from '../src/talktalk-assist.js';

const CDP_URL = process.env.CSBOT_CDP_URL || 'http://127.0.0.1:9223';
const REPORT_PATH = process.env.CSBOT_TALKTALK_REPORT_PATH || '/Users/dh/.openclaw/workspace/smartstore-cs-worker/runtime-data/talktalk-assist-latest.md';
const LIMIT = Number(process.env.CSBOT_TALKTALK_ASSIST_LIMIT || 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

async function getTalkPage(context) {
  const page = context.pages().find((p) => p.url().includes('/talktalk/chat'));
  if (!page) throw new Error('톡톡 페이지를 찾지 못했습니다.');
  return page;
}

async function getTalkFrame(page) {
  const frame = page.frames().find((f) => f.url().includes('talk.sell.smartstore.naver.com'));
  if (!frame) throw new Error('톡톡 iframe을 찾지 못했습니다.');
  return frame;
}

async function clickWaitingFilter(frame) {
  const buttons = frame.locator('button');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    const text = clean(await btn.textContent().catch(() => ''));
    if (text.includes('새로운 상담') && text.includes('대기')) {
      await btn.click();
      await sleep(1200);
      return true;
    }
  }
  return false;
}

async function collectConversationMeta(frame) {
  const results = new Map();

  for (let step = 0; step < 12; step += 1) {
    const batch = await frame.evaluate(() => {
      const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('ul.list_chat_result > li.item_chat_result')).map((li) => {
        const link = li.querySelector('a[href*="/chat/ct/"]');
        if (!link) return null;
        const href = link.href;
        const name = clean(li.querySelector('.text_name, .chat_name, [title]')?.textContent || '');
        const tag = clean(li.querySelector('.profile_badge, .badge, .tag, .label')?.textContent || '');
        const unreadText = clean(li.querySelector('[aria-label*="읽지 않은 메시지"], .num, .count')?.textContent || '0');
        const unreadCount = Number((unreadText.match(/\d+/) || ['0'])[0]);
        const preview = clean(li.querySelector('[class*="message"], .txt, .text, .last_chat')?.textContent || li.innerText || '');
        return { href, name, tag, unreadCount, preview };
      }).filter(Boolean);
    });

    batch.forEach((item) => {
      if (!results.has(item.href)) results.set(item.href, item);
    });

    if (results.size >= LIMIT) break;

    const changed = await frame.evaluate(() => {
      const list = document.querySelector('ul.list_chat_result.scroll_vertical, ul.list_chat_result');
      if (!list) return false;
      const before = list.scrollTop;
      list.scrollTop = Math.min(list.scrollTop + 650, list.scrollHeight);
      return list.scrollTop !== before;
    });
    if (!changed) break;
    await sleep(600);
  }

  return Array.from(results.values())
    .sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0))
    .slice(0, LIMIT);
}

async function openConversation(frame, href) {
  await frame.evaluate((url) => {
    window.location.href = url;
  }, href);
  await sleep(1200);
}

async function extractConversation(frame, meta) {
  return frame.evaluate((fallback) => {
    const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

    const customerName = clean(
      document.querySelector('.chat_header .chat_name, .profile_info .chat_name')?.textContent
      || fallback.name
      || ''
    );
    const tag = clean(
      document.querySelector('.chat_header .profile_badge, .chat_header .badge, .chat_header .tag')?.textContent
      || fallback.tag
      || ''
    );
    const product = clean(
      document.querySelector('.product_name, .link_product, .chat_product a, .chat_product .title')?.textContent
      || ''
    );

    const messages = Array.from(document.querySelectorAll('.message_section li._message')).map((li) => {
      const sender = li.getAttribute('data-sender') || '';
      const content = Array.from(li.querySelectorAll('p._copy_area'))
        .map((p) => clean(p.textContent))
        .filter(Boolean)
        .join('\n');
      return { sender, content };
    }).filter((msg) => msg.content);

    const customerMessages = messages
      .filter((msg) => msg.sender === 'user')
      .map((msg) => msg.content);

    const sellerReplies = messages
      .filter((msg) => msg.sender === 'partner')
      .map((msg) => msg.content)
      .filter((text) => !text.includes('어서오세요. 또몽이네 스토어') && !text.includes('상품을 문의 주셨습니다. 어떤 점이 궁금하신가요?'));

    return {
      customerName,
      tag,
      product,
      customerMessages,
      sellerReplies,
      latestCustomerMessage: customerMessages[customerMessages.length - 1] || fallback.preview || '',
      unreadCount: fallback.unreadCount || 0,
      preview: fallback.preview || '',
    };
  }, meta);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  try {
    const page = await getTalkPage(context);
    const frame = await getTalkFrame(page);

    await clickWaitingFilter(frame).catch(() => false);
    const metas = await collectConversationMeta(frame);
    const items = [];

    for (const meta of metas) {
      await openConversation(frame, meta.href);
      const conversation = await extractConversation(frame, meta);
      const draft = buildTalktalkDraft(conversation);
      if (!draft.matched) {
        console.log('[SKIP]', conversation.customerName, draft.reason || 'unmatched');
        continue;
      }
      items.push(buildTalktalkAssistItem({ conversation, draft }));
      console.log('[ASSIST_ITEM]', conversation.customerName, draft.templateCode || draft.reason || 'none');
    }

    await writeTalktalkAssistReport(REPORT_PATH, items);
    console.log('[REPORT]', REPORT_PATH);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
