import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const WORKDIR = '/Users/dh/.openclaw/workspace';
const cfg = JSON.parse(fs.readFileSync(path.join(WORKDIR, 'runtime-data/navertalk-local-config.json'), 'utf8'));
const talkUrl = cfg.talkUrl;
const quickstarUrl = cfg.quickstarUrl || 'https://quickstar.co.kr/mypage/mypage.php';
const latestPath = path.join(WORKDIR, 'runtime-data/talktalk-watch-state.latest.json');
const prevPath = path.join(WORKDIR, 'runtime-data/talktalk-watch-state.json');
const CDP_URL = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
const nowKst = () => {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(d);
  const get = (t) => parts.find(p => p.type===t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
};
const normId = (id='') => {
  try { const u = new URL(id); return u.pathname + u.hash; } catch { return String(id || '').replace(/^https?:\/\/[^/]+/, ''); }
};
const isDelivery = (text='') => /배송|출고|언제\s*올|언제\s*도착|도착|통관|운송장|택배|송장|반입|배송조회|조회|받을 수|출발/.test(text);
const classifyOther = (text='') => {
  if (/옵션|색상|사이즈|재고|품절|선택/.test(text)) return '옵션/재고 문의';
  return '일반문의';
};

async function detach(browser) { await browser?._connection?.close?.(); }
async function getContext() { const browser = await chromium.connectOverCDP(CDP_URL); const context = browser.contexts()[0] || await browser.newContext(); return { browser, context }; }

async function getOrCreatePage(context, matcher, url) {
  let page = context.pages().find(matcher);
  let created = false;
  if (!page) {
    page = await context.newPage();
    created = true;
  }
  if ((!page.url() || page.url() === 'about:blank' || page.url().startsWith('data:')) && url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  return { page, created };
}

async function ensureSmartstoreLogin(context) {
  const { page, created } = await getOrCreatePage(
    context,
    (p) => p.url().includes('#/talktalk/chat') || p.url().includes('accounts.commerce.naver.com') || p.url().includes('#/home/about') || p.url().includes('talk.sell.smartstore.naver.com'),
    talkUrl,
  );
  if (!page.url().includes('#/talktalk/chat') && !page.url().includes('accounts.commerce.naver.com') && !page.url().includes('#/home/about') && !page.url().includes('talk.sell.smartstore.naver.com')) {
    await page.goto(talkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  await sleep(2000);
  const finalUrl = page.url();
  const body = clean(await page.locator('body').textContent().catch(() => ''));
  const ok = !finalUrl.includes('/login') && !finalUrl.startsWith('https://sell.smartstore.naver.com/#/home/about') && /톡톡|채팅|대화|고객/.test(body + ' ' + finalUrl);
  if (!ok && created) {
    await page.close().catch(() => {});
  }
  return { ok, page, url: finalUrl, body: body.slice(0, 300) };
}

async function dismissModal(page) {
  const closeTargets = [page.getByText('일주일간 보지 않기', { exact: false }), page.getByText('닫기', { exact: true }), page.locator('button').filter({ hasText: '일주일간 보지 않기' }), page.locator('button[aria-label="닫기"]')];
  for (const target of closeTargets) {
    try { if (await target.first().isVisible({ timeout: 1000 })) { await target.first().click({ timeout: 1000 }); await sleep(800); return; } } catch {}
  }
  try { await page.keyboard.press('Escape'); await sleep(500); } catch {}
}

async function collectItems(page) {
  const listLocator = page.locator('.customer_list_area, .customer_list, [class*="customer_list"], [class*="list_area"]').first();
  await listLocator.waitFor({ timeout: 7000 }).catch(() => {});
  const items = [];
  async function collectBatch() {
    return page.evaluate(() => {
      const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      const parseUnread = (row) => { const t = clean(row.querySelector('.label_unread, .icon_unread, .count, .badge, [class*="unread"]')?.textContent || ''); const m = t.match(/\d+/); return m ? Number(m[0]) : 0; };
      const rows = Array.from(document.querySelectorAll('.customer_list_area .customer_item, .customer_list .customer_item, li.customer_item, [class*="customer_item"]')).map((row) => {
        const link = row.querySelector('a[href]');
        const href = link?.href || link?.getAttribute('href') || '';
        const popupPath = row.getAttribute('data-popup-path') || link?.getAttribute('data-popup-path') || '';
        const candidateId = row.getAttribute('data-candidate-id') || link?.getAttribute('data-candidate-id') || '';
        const name = clean(row.querySelector('.customer_name, .name, [class*="name"]')?.textContent || '');
        const preview = clean(row.querySelector('.last_message, .message, .preview, [class*="message"], [class*="preview"]')?.textContent || '');
        const timeLabel = clean(row.querySelector('.date, .time, [class*="date"], [class*="time"]')?.textContent || '');
        return { id: popupPath || href || candidateId, popupPath, href, candidateId, customerName: name, previewText: preview, timeLabel, unreadCount: parseUnread(row) };
      }).filter((item) => item.id && (item.customerName || item.previewText));
      return rows.slice(0, 40);
    });
  }
  for (let i = 0; i < 8; i += 1) {
    const batch = await collectBatch();
    for (const item of batch) if (!items.find((x) => normId(x.id) === normId(item.id))) items.push(item);
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
  return items.slice(0, 40);
}

function compare(latest, prev) {
  const prevMap = new Map((prev?.items || []).map(item => [normId(item.id || item.popupPath || item.href || item.candidateId || ''), item]));
  const changes = [];
  for (const item of latest.items || []) {
    const key = normId(item.id || item.popupPath || item.href || item.candidateId || '');
    const old = prevMap.get(key);
    if (!old) { changes.push({ kind: '신규', item }); continue; }
    if ((item.previewText || '') !== (old.previewText || '')) { changes.push({ kind: '문장변경', item, old }); continue; }
    if ((item.timeLabel || '') !== (old.timeLabel || '')) { changes.push({ kind: '시간변경', item, old }); continue; }
    if (Number(item.unreadCount || 0) > Number(old.unreadCount || 0)) { changes.push({ kind: `안읽음+${Number(item.unreadCount||0)-Number(old.unreadCount||0)}`, item, old }); }
  }
  return changes;
}

async function main() {
  const { browser, context } = await getContext();
  try {
    const smart = await ensureSmartstoreLogin(context);
    if (!smart.ok) {
      console.log('[로그인 해제 알림]\n- 스마트스토어/톡톡 로그인 해제 상태\n- 자동 로그인 1회 시도 후에도 미복구\n- 조치 필요: 자동화 Chrome에서 로그인 확인');
      process.exit(0);
    }
    const page = smart.page;
    await page.goto(talkUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(2500);
    await dismissModal(page);
    const items = await collectItems(page);
    const latest = { capturedAt: new Date().toISOString(), talkUrl, items };
    fs.writeFileSync(latestPath, JSON.stringify(latest, null, 2));
    const prev = fs.existsSync(prevPath) ? JSON.parse(fs.readFileSync(prevPath, 'utf8')) : null;
    const changes = compare(latest, prev);
    fs.writeFileSync(prevPath, JSON.stringify(latest, null, 2));
    if (!changes.length) { console.log('NO_REPLY'); return; }
    const top = changes.slice(0, 10);
    const delivery = top.filter(c => isDelivery(`${c.item.customerName} ${c.item.previewText}`));
    const others = top.filter(c => !isDelivery(`${c.item.customerName} ${c.item.previewText}`));
    const otherCounts = new Map();
    for (const c of others) { const k = classifyOther(c.item.previewText); otherCounts.set(k, (otherCounts.get(k) || 0) + 1); }
    const lines = [];
    lines.push('[톡톡 watcher 변화 감지]');
    lines.push(`- 감지시각: ${nowKst()}`);
    lines.push(`- 변화 건수: ${changes.length}건`);
    lines.push(`- 생성된 승인카드 수: ${delivery.length}건`);
    lines.push('- 배송문의:');
    if (delivery.length) {
      lines.push('');
      for (const c of delivery) lines.push(`  - ${c.item.customerName || '(이름없음)'} | [${c.kind}] | 안읽음 ${Number(c.item.unreadCount || 0)} | 시간 ${c.item.timeLabel || '-'} | "${clean(c.item.previewText).slice(0, 80)}"`);
      lines.push('');
      lines.push('  [진행]');
      lines.push('  - 위 배송문의 건은 초안 작성 대상입니다.');
      lines.push('  - 각 건은 초안을 포함한 승인 카드로 올립니다.');
      lines.push('  - 대표님 승인 후 실제 톡톡 발행까지 이어갑니다.');
    } else {
      lines.push('');
      lines.push('  - 없음');
    }
    lines.push('');
    lines.push('- 기타 문의 요약:');
    if (otherCounts.size) {
      for (const [k, v] of otherCounts) lines.push(`  - ${k} ${v}건`);
    } else {
      lines.push('  - 없음');
    }
    lines.push('- 메모: 목록 변화만 감지했고, 후속 배송문의 처리는 별도 단계에서 진행합니다.');
    console.log(lines.join('\n'));
  } finally { await detach(browser).catch(() => {}); }
}

main().catch((err) => { console.error(err?.stack || String(err)); process.exit(1); });
