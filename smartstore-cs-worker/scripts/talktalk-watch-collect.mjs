import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WORKDIR = '/Users/dh/.openclaw/workspace';
const cfg = JSON.parse(fs.readFileSync(path.join(WORKDIR, 'runtime-data/navertalk-local-config.json'), 'utf8'));
const outPath = path.join(WORKDIR, 'runtime-data/talktalk-watch-state.latest.json');
const talkUrl = cfg.talkUrl;
const CDP_URL = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dismissModal(page) {
  const closeTargets = [
    page.getByText('일주일간 보지 않기', { exact: false }),
    page.getByText('닫기', { exact: true }),
    page.locator('button').filter({ hasText: '일주일간 보지 않기' }),
    page.locator('button[aria-label="닫기"]'),
  ];
  for (const target of closeTargets) {
    try {
      if (await target.first().isVisible({ timeout: 1000 })) {
        await target.first().click({ timeout: 1000 });
        await sleep(800);
        return;
      }
    } catch {}
  }
  try {
    await page.keyboard.press('Escape');
    await sleep(500);
  } catch {}
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    let page = context.pages().find((p) => p.url().startsWith(talkUrl) || p.url().includes('#/talktalk/chat') || p.url().startsWith('https://sell.smartstore.naver.com/') || p.url().includes('/web/accounts/102199949/chat'));
    if (!page) {
      page = await context.newPage();
      await page.goto(talkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      if (!page.url().startsWith(talkUrl)) {
        await page.goto(talkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      }
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await sleep(2500);
    await dismissModal(page);

    const listLocator = page.locator('.customer_list_area, .customer_list, [class*="customer_list"], [class*="list_area"]').first();
    await listLocator.waitFor({ timeout: 5000 }).catch(() => {});

    async function collectBatch() {
      return page.evaluate(() => {
        const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
        const parseUnread = (row) => {
          const t = clean(row.querySelector('.label_unread, .icon_unread, .count, .badge, [class*="unread"]')?.textContent || '');
          const m = t.match(/\d+/);
          return m ? Number(m[0]) : 0;
        };
        const rows = Array.from(document.querySelectorAll('.customer_list_area .customer_item, .customer_list .customer_item, li.customer_item, [class*="customer_item"]')).map((row) => {
          const link = row.querySelector('a[href]');
          const href = link?.href || link?.getAttribute('href') || '';
          const popupPath = row.getAttribute('data-popup-path') || link?.getAttribute('data-popup-path') || '';
          const candidateId = row.getAttribute('data-candidate-id') || link?.getAttribute('data-candidate-id') || '';
          const name = clean(row.querySelector('.customer_name, .name, [class*="name"]')?.textContent || '');
          const preview = clean(row.querySelector('.last_message, .message, .preview, [class*="message"], [class*="preview"]')?.textContent || '');
          const timeLabel = clean(row.querySelector('.date, .time, [class*="date"], [class*="time"]')?.textContent || '');
          return {
            id: popupPath || href || candidateId,
            popupPath,
            href,
            candidateId,
            customerName: name,
            previewText: preview,
            timeLabel,
            unreadCount: parseUnread(row),
          };
        }).filter((item) => item.id && (item.customerName || item.previewText));
        return rows.slice(0, 40);
      });
    }

    const items = [];
    for (let i = 0; i < 8; i += 1) {
      const batch = await collectBatch();
      for (const item of batch) {
        if (!items.find((x) => x.id === item.id)) items.push(item);
      }
      if (items.length >= 40) break;
      const moved = await page.evaluate(() => {
        const target = document.querySelector('.customer_list_area, .customer_list, [class*="customer_list"], [class*="list_area"]');
        if (!target) return false;
        const before = target.scrollTop;
        target.scrollTop = Math.min(target.scrollTop + Math.max(500, target.clientHeight - 100), target.scrollHeight);
        return target.scrollTop !== before;
      }).catch(() => false);
      if (!moved) break;
      await sleep(700);
    }

    const result = { capturedAt: new Date().toISOString(), talkUrl, items: items.slice(0, 40) };
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: true, count: result.items.length, outPath }));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
