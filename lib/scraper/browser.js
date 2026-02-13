/**
 * Browser connection module — Playwright + Browserless.io (server-only).
 */
import { chromium } from 'playwright-core';
import { BROWSERLESS_WS_ENDPOINT, PAGE_TIMEOUT_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '@/lib/config';

/**
 * Connect to Browserless.io cloud browser.
 * Reads API key from process.env.BROWSERLESS_API_KEY.
 */
export async function connectBrowser() {
  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error('BROWSERLESS_API_KEY is not configured');
  }

  const wsEndpoint = BROWSERLESS_WS_ENDPOINT(apiKey);
  const browser = await chromium.connectOverCDP(wsEndpoint);

  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  return { browser, page, context };
}

/**
 * Delay helper for rate limiting.
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || REQUEST_DELAY_MS));
}

/**
 * Retry a function with exponential backoff.
 */
export async function withRetry(fn, label = 'operation') {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const backoff = attempt * 2000;
      console.warn(
        `[Retry ${attempt}/${MAX_RETRIES}] ${label} failed: ${err.message}. Waiting ${backoff}ms...`
      );
      if (attempt === MAX_RETRIES) {
        throw new Error(`${label} failed after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      await delay(backoff);
    }
  }
}
