export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function extract12DigitInvoice(text) {
  if (!text) return null;
  const match = String(text).match(/\b\d{12}\b/);
  return match ? match[0] : null;
}

export async function firstVisibleLocator(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1000 })) {
        return { selector, locator };
      }
    } catch {
      // ignore and continue
    }
  }
  return null;
}

export async function firstExistingSelector(page, selectors = []) {
  for (const selector of selectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) return selector;
    } catch {
      // ignore and continue
    }
  }
  return null;
}
