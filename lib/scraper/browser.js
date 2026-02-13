/**
 * Browser connection module — Playwright + Browserless.io (server-only).
 *
 * Uses the /stealth endpoint with solveCaptchas=true to bypass the
 * hCaptcha on the court website's AuthenticatePage.
 *
 * Gate flow:
 *   1. /Home/Welcome → click "Start Search" → redirects to AuthenticatePage
 *   2. /Home/AuthenticatePage → solve hCaptcha → click "File Search" button
 *   3. → lands on /File/FileSearch (the actual search form)
 */
import { chromium } from 'playwright-core';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL, PAGE_TIMEOUT_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '@/lib/config';

/**
 * Connect to Browserless.io and navigate through the court website's
 * 3-step gate (Welcome → CAPTCHA → File Search).
 *
 * On success, returns with the page already on /File/FileSearch.
 */
export async function connectBrowser() {
  const apiKey = process.env.BROWSERLESS_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    throw new Error(
      'BROWSERLESS_API_KEY is not configured. Set it in Vercel Environment Variables.'
    );
  }

  const wsEndpoint = BROWSERLESS_WS_ENDPOINT(apiKey);
  console.log(`Connecting to Browserless at ${wsEndpoint.replace(apiKey, 'KEY_HIDDEN')}...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
  } catch (err) {
    const msg = err.message || String(err);
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
  page.setDefaultNavigationTimeout(20000);

  // ── Step 1: Welcome page → click "Start Search" ──
  console.log('Gate step 1: Welcome page...');
  await page.goto(`${BASE_URL}/Home/Welcome`, {
    waitUntil: 'domcontentloaded',
    timeout: 12000,
  });

  const startBtn = await page.$('button[name="WelcomePageButton"][value="Start"]');
  if (startBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }),
      startBtn.click(),
    ]);
    console.log('Welcome passed. Now on:', page.url());
  } else {
    console.log('No welcome button — may already be past gate.');
  }

  // ── Step 2: AuthenticatePage — solve hCaptcha ──
  const urlAfterWelcome = page.url();
  if (urlAfterWelcome.includes('Authenticate')) {
    console.log('Gate step 2: Solving hCaptcha...');

    // Set up CDP session for CAPTCHA solving
    const cdp = await page.context().newCDPSession(page);

    // Wait for Browserless to detect the CAPTCHA, then solve it
    const captchaSolved = await new Promise((resolve) => {
      let done = false;

      cdp.on('Browserless.captchaFound', async () => {
        console.log('hCaptcha detected by Browserless, solving...');
        try {
          const result = await cdp.send('Browserless.solveCaptcha');
          console.log('CAPTCHA result:', JSON.stringify(result));
          if (!done) { done = true; resolve(result.solved !== false); }
        } catch (err) {
          console.error('solveCaptcha error:', err.message);
          if (!done) { done = true; resolve(false); }
        }
      });

      // Timeout after 20s — if no captchaFound event fires, the stealth
      // mode may have bypassed it or there's an issue
      setTimeout(() => {
        if (!done) {
          done = true;
          console.log('CAPTCHA wait timed out (20s). Proceeding anyway...');
          resolve(false);
        }
      }, 20000);
    });

    console.log(`CAPTCHA solved: ${captchaSolved}`);

    // Give the page a moment to process the CAPTCHA response
    await delay(1500);

    // Now click "File Search" — this submits the form with the CAPTCHA
    // response, which sets the session and redirects to /File/FileSearch
    const fileSearchBtn = await page.$(
      'button[name="LinkButton"][value="ToFileSearch"]:not([disabled])'
    );
    if (fileSearchBtn) {
      console.log('Gate step 3: Clicking "File Search"...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }),
        fileSearchBtn.click(),
      ]);
      console.log('File Search clicked. Now on:', page.url());
    } else {
      console.warn('No enabled "File Search" button found.');
    }
  } else {
    console.log('Not on AuthenticatePage — skipping CAPTCHA.');
  }

  // ── Verify we made it to File Search ──
  const finalUrl = page.url();
  console.log(`Gate bypass complete. Final URL: ${finalUrl}`);

  if (finalUrl.includes('Welcome') || finalUrl.includes('Authenticate')) {
    throw new Error(
      `Gate bypass failed — still on ${finalUrl}. CAPTCHA may not have been solved. ` +
      `Check that your Browserless plan supports CAPTCHA solving.`
    );
  }

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
      const backoff = attempt * 1500;
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
