import { chromium } from 'playwright';
import { ensureQuickstarSession, getOrCreateQuickstarPage } from '../src/quickstar-direct.js';

const CDP_URL = 'http://127.0.0.1:9223';

async function detachCdpBrowser(browser) {
  await browser?._connection?.close?.();
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  try {
    const page = await getOrCreateQuickstarPage(context);
    const state = await ensureQuickstarSession(page);
    console.log(JSON.stringify(state, null, 2));

    if (!state.ok) {
      console.error('QUICKSTAR_SESSION_INVALID');
      process.exit(2);
    }
  } finally {
    await detachCdpBrowser(browser).catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
