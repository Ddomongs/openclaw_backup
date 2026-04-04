import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const context = browser.contexts()[0];
const page = context.pages().find((p) => p.url().includes('/talktalk/chat'));
const frame = page.frames().find((f) => f.url().includes('talk.sell.smartstore.naver.com'));

await frame.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/chat/ct/"]')].find((el) => el.innerText.includes('mirror4271'));
  if (a) window.location.href = a.href;
});
await sleep(1500);

const buttons = frame.locator('button');
const count = await buttons.count();
for (let i = 0; i < count; i += 1) {
  const txt = await buttons.nth(i).textContent().catch(() => '');
  if ((txt || '').includes('배송지 정보')) {
    await buttons.nth(i).click();
    await sleep(1200);
    break;
  }
}

const data = await frame.evaluate(() => ({
  body: document.body.innerText.slice(0, 3500),
  modals: Array.from(document.querySelectorAll('[role="dialog"], .modal, .layer, .popup')).map((el) => ({
    text: (el.innerText || '').slice(0, 500),
    cls: el.className,
    outer: el.outerHTML.slice(0, 500),
  })).slice(0, 20),
}));

console.log(JSON.stringify(data, null, 2));
await browser.close();
