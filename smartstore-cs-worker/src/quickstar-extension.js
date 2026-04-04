import { sleep } from './utils.js';

export async function getQuickstarState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('quickstar-host#quickstar-tracker-host');
    const root = host?.shadowRoot;
    const input = root?.querySelector('.qs-search-input');
    const mainButton = root?.querySelector('.qs-main-btn');
    const statusBox = root?.querySelector('.qs-search-box > div[style*="display: block"], .qs-search-box + div, .qs-draft-text') || null;

    return {
      hasHost: !!host,
      hasShadowRoot: !!root,
      hasMainButton: !!mainButton,
      hasInput: !!input,
      inputValue: input?.value || '',
      statusText: statusBox?.textContent?.trim() || '',
    };
  });
}

export async function ensureQuickstarLoaded(page) {
  const state = await getQuickstarState(page);
  if (!state.hasHost || !state.hasShadowRoot || !state.hasInput) {
    throw new Error('퀵스타 확장 UI를 찾지 못했습니다. 확장 로드/활성 상태를 확인하세요.');
  }
  return state;
}

export async function openQuickstarPanel(page) {
  await ensureQuickstarLoaded(page);

  await page.evaluate(() => {
    const host = document.querySelector('quickstar-host#quickstar-tracker-host');
    const root = host?.shadowRoot;
    const mainButton = root?.querySelector('.qs-main-btn');
    if (!mainButton) throw new Error('퀵스타 메인 버튼을 찾지 못했습니다.');
    mainButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await sleep(300);
}

export async function lookupTrackingWithExtension(page, invoiceNo) {
  await openQuickstarPanel(page);

  await page.evaluate((value) => {
    const host = document.querySelector('quickstar-host#quickstar-tracker-host');
    const root = host?.shadowRoot;
    const input = root?.querySelector('.qs-search-input');
    if (!input) throw new Error('퀵스타 검색 입력창을 찾지 못했습니다.');

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  }, invoiceNo);

  await page.waitForFunction(() => {
    const host = document.querySelector('quickstar-host#quickstar-tracker-host');
    const root = host?.shadowRoot;
    if (!root) return false;

    const draftText = root.querySelector('.qs-draft-text')?.textContent?.trim() || '';
    const statusText = root.querySelector('.qs-search-box')?.textContent || '';

    return Boolean(draftText) || statusText.includes('조회 결과 없음') || statusText.includes('통관 조회 중') || statusText.includes('퀵스타 조회 중') || statusText.includes('CJ배송 조회 중');
  }, { timeout: 15000 });

  await sleep(3000);

  return page.evaluate(() => {
    const host = document.querySelector('quickstar-host#quickstar-tracker-host');
    const root = host?.shadowRoot;
    if (!root) throw new Error('퀵스타 shadow root를 찾지 못했습니다.');

    const draftText = root.querySelector('.qs-draft-text')?.textContent?.trim() || '';
    const statusLinks = Array.from(root.querySelectorAll('.qs-status-link'))
      .map(el => el.textContent?.trim())
      .filter(Boolean);

    const statusBoxText = root.querySelector('.qs-search-box')?.textContent?.trim() || '';
    const inputValue = root.querySelector('.qs-search-input')?.value || '';

    return {
      invoiceNo: inputValue,
      draftText,
      statusLinks,
      statusBoxText,
      hasResult: Boolean(draftText || statusLinks.length),
      noResult: statusBoxText.includes('조회 결과 없음'),
    };
  });
}
