import { chromium } from 'playwright';
import { buildTalktalkDraft } from '../src/talktalk-drafts.js';
import { buildTalktalkAssistItem, writeTalktalkAssistReport } from '../src/talktalk-assist.js';
import { buildDeliveryDraft, ensureQuickstarSession, getOrCreateQuickstarPage, resolveQuickstarShipment } from '../src/quickstar-direct.js';

const CDP_URL = process.env.CSBOT_CDP_URL || 'http://127.0.0.1:9223';
const REPORT_PATH = process.env.CSBOT_TALKTALK_REPORT_PATH || '/Users/dh/.openclaw/workspace/smartstore-cs-worker/runtime-data/talktalk-assist-latest.md';
const LIMIT = Number(process.env.CSBOT_TALKTALK_ASSIST_LIMIT || 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

async function getTalkPage(context) {
  let page = context.pages().find((p) => p.url().includes('/talktalk/chat'));
  if (!page) {
    page = await context.newPage();
    await page.goto('https://sell.smartstore.naver.com/#/talktalk/chat', { waitUntil: 'domcontentloaded' });
  }
  await page.bringToFront().catch(() => {});
  await sleep(1000);
  return page;
}

async function getTalkFrame(page) {
  let frame = page.frames().find((f) => f.url().includes('talk.sell.smartstore.naver.com'));
  const started = Date.now();
  while (!frame && Date.now() - started < 15000) {
    await sleep(500);
    frame = page.frames().find((f) => f.url().includes('talk.sell.smartstore.naver.com'));
  }
  if (!frame) throw new Error('톡톡 iframe을 찾지 못했습니다.');
  return frame;
}

async function ensureQuickstarReady(context) {
  const quickstarPage = await getOrCreateQuickstarPage(context);
  const state = await ensureQuickstarSession(quickstarPage);
  if (!state.ok) {
    throw new Error(`퀵스타 로그인 세션이 유효하지 않습니다. url=${state.url}`);
  }
  return state;
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

async function expandDeliveryInfo(frame) {
  const buttons = frame.locator('button');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    const text = clean(await btn.textContent().catch(() => ''));
    if (text.includes('배송지 정보')) {
      await btn.click().catch(() => {});
      await sleep(300);
    }
  }
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
    const bodyText = clean(document.body?.innerText || '');

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

    const buyerNameMatch = bodyText.match(/구매자명:?\s*([가-힣A-Za-z0-9_*]{2,20})/);
    const buyerName = clean(buyerNameMatch?.[1] || '');
    const receiverNameMatch = bodyText.match(/수령인\s*([가-힣A-Za-z0-9_*]{2,20})/);
    const receiverName = clean(receiverNameMatch?.[1] || '');
    const receiverPhoneMatch = bodyText.match(/연락처\s*(010-\d{4}-\d{4})/);
    const receiverPhone = clean(receiverPhoneMatch?.[1] || '');

    const orderNumbers = Array.from(bodyText.matchAll(/주문번호\s*:?\s*(\d{10,})/g)).map((m) => m[1]);

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
      buyerName,
      receiverName,
      receiverPhone,
      orderNumbers,
      unreadCount: fallback.unreadCount || 0,
      preview: fallback.preview || '',
    };
  }, meta);
}

function isShippingCategory(category) {
  return ['shipping_eta_basic', 'shipping_eta_long', 'shipping_delay_apology'].includes(category);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  try {
    const page = await getTalkPage(context);
    const frame = await getTalkFrame(page);
    const quickstarState = await ensureQuickstarReady(context);
    console.log('[QUICKSTAR_SESSION]', JSON.stringify(quickstarState));

    await clickWaitingFilter(frame).catch(() => false);
    const metas = await collectConversationMeta(frame);
    const items = [];

    for (const meta of metas) {
      await openConversation(frame, meta.href);
      await expandDeliveryInfo(frame);
      const conversation = await extractConversation(frame, meta);
      let draft = buildTalktalkDraft(conversation);

      if (draft.matched && isShippingCategory(draft.category)) {
        const quickstarPage = await getOrCreateQuickstarPage(context);
        const shipmentLookup = await resolveQuickstarShipment(quickstarPage, {
          text: [
            conversation.latestCustomerMessage,
            conversation.preview,
            conversation.receiverPhone,
            conversation.orderNumbers?.join(' '),
          ].filter(Boolean).join(' '),
          customerName: conversation.receiverName || conversation.customerName,
          buyerName: conversation.buyerName,
        });

        if (shipmentLookup.ok) {
          const deliveryDraft = buildDeliveryDraft({
            inquiry: {
              body: conversation.latestCustomerMessage,
              rawText: [conversation.latestCustomerMessage, conversation.preview].filter(Boolean).join('\n'),
            },
            shipment: shipmentLookup.result,
          });

          draft = {
            ...draft,
            templateCode: 'quickstar_delivery_result',
            text: deliveryDraft.text,
            tone: deliveryDraft.confidence === 'medium' ? 'long' : draft.tone,
            quickstarQuery: shipmentLookup.query,
          };
        } else {
          draft = {
            ...draft,
            route: 'handoff_required',
            reason: `quickstar_${shipmentLookup.reason}`,
          };
        }
      }

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
