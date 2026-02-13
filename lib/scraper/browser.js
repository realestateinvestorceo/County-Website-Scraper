/**
 * Browser connection module — Playwright + Browserless.io (server-only).
 */
import { chromium } from 'playwright-core';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL, PAGE_TIMEOUT_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '@/lib/config';

/**
 * Connect to Browserless.io cloud browser.
 * Reads API key from process.env.BROWSERLESS_API_KEY.
 */
export async function connectBrowser() {
  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error(
      'BROWSERLESS_API_KEY is not configured. Set it in Vercel Environment Variables.'
    );
  }

  const wsEndpoint = BROWSERLESS_WS_ENDPOINT(apiKey);
  console.log(`Connecting to Browserless.io at ${wsEndpoint.replace(apiKey, 'API_KEY_HIDDEN')}...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
  } catch (err) {
    const msg = err.message || String(err);
    // Provide a user-friendly message instead of raw HTML/connection errors
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      throw new Error('Cannot reach Browserless.io — check your internet connection or API key.');
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
      throw new Error('Browserless.io rejected your API key. Check that BROWSERLESS_API_KEY is valid.');
    }
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      throw new Error('Connection to Browserless.io timed out. Try again.');
    }
    throw new Error(`Browserless.io connection failed: ${msg.substring(0, 200)}`);
  }

  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  // ── Welcome gate bypass ──────────────────────────────────
  // The court website redirects all first-time visitors to a
  // Welcome page and requires clicking "Start Search" before
  // granting access to any search page.  We need to do this
  // once per browser session to set the session cookie.
  console.log('Bypassing court website welcome gate...');
  try {
    await page.goto(`${BASE_URL}/Home/Welcome`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Click the "Start Search" button to accept and set session cookie
    const startBtn = await page.$('button[name="WelcomePageButton"][value="Start"]');
    if (startBtn) {
      await startBtn.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('Welcome gate passed — session cookie set.');
    } else {
      // If no button found, we might already be past the gate
      console.log('No welcome button found — may already be past gate.');
    }
  } catch (err) {
    console.warn('Welcome gate bypass encountered an issue:', err.message);
    // Non-fatal — continue anyway, the scraper will retry navigation
  }

  console.log('Connected to Browserless.io successfully.');
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
