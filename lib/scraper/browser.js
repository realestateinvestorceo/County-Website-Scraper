/**
 * Browser connection module — Playwright + Browserless.io (server-only).
 *
 * Uses the /stealth endpoint with solveCaptchas=true to bypass the
 * hCaptcha on the court website's AuthenticatePage.
 */
import { chromium } from 'playwright-core';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL, PAGE_TIMEOUT_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '@/lib/config';

/**
 * Connect to Browserless.io cloud browser and navigate through the
 * court website's welcome → hCaptcha → search gate.
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

  // ── Court website gate: Welcome → hCaptcha → File Search ──
  // Step 1: Welcome page — click "Start Search"
  console.log('Step 1: Bypassing welcome page...');
  try {
    await page.goto(`${BASE_URL}/Home/Welcome`, {
      waitUntil: 'domcontentloaded',
      timeout: 12000,
    });

    const startBtn = await page.$('button[name="WelcomePageButton"][value="Start"]');
    if (startBtn) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        startBtn.click(),
      ]);
      console.log('Welcome page passed.');
    } else {
      console.log('No welcome button found — may already be past gate.');
    }
  } catch (err) {
    console.warn('Welcome page issue:', err.message);
  }

  // Step 2: AuthenticatePage — hCaptcha
  // After clicking "Start Search", the site goes to /Home/AuthenticatePage
  // which has an hCaptcha + search option buttons. Browserless /stealth
  // with solveCaptchas=true should auto-solve the hCaptcha. We then need
  // to click "File Search" to reach the actual search form.
  console.log('Step 2: Handling AuthenticatePage (hCaptcha)...');
  try {
    const currentUrl = page.url();
    console.log(`Current URL after welcome: ${currentUrl}`);

    if (currentUrl.includes('AuthenticatePage') || currentUrl.includes('Authenticate')) {
      // Set up CDP session to monitor for CAPTCHA solving
      const cdp = await page.context().newCDPSession(page);

      // Wait for Browserless to detect & solve the CAPTCHA
      // The /stealth?solveCaptchas=true should handle this automatically
      // but we listen for the event and trigger solve if needed
      try {
        // Give Browserless time to detect and solve the captcha
        await new Promise((resolve) => {
          let resolved = false;

          // Listen for captcha found event
          cdp.on('Browserless.captchaFound', async () => {
            console.log('CAPTCHA detected, solving...');
            try {
              const result = await cdp.send('Browserless.solveCaptcha');
              console.log('CAPTCHA solve result:', JSON.stringify(result));
            } catch (solveErr) {
              console.warn('CAPTCHA solve error:', solveErr.message);
            }
          });

          // Also set a timeout — the captcha might already be solved
          // or the stealth mode might have bypassed it
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          }, 15000);

          // Also resolve if page navigates away (captcha was solved)
          page.on('framenavigated', () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          });
        });
      } catch (captchaErr) {
        console.warn('CAPTCHA handling note:', captchaErr.message);
      }

      // After CAPTCHA is solved, click "File Search" button if present
      await delay(1000);
      const fileSearchBtn = await page.$('button:has-text("File Search"), a:has-text("File Search")');
      if (fileSearchBtn) {
        await Promise.all([
          page.waitForLoadState('domcontentloaded'),
          fileSearchBtn.click(),
        ]);
        console.log('Clicked "File Search" on AuthenticatePage.');
      } else {
        console.log('No "File Search" button found on AuthenticatePage.');
      }
    } else {
      console.log('Not on AuthenticatePage — skipping CAPTCHA step.');
    }
  } catch (err) {
    console.warn('AuthenticatePage handling issue:', err.message);
  }

  // Step 3: Verify we can reach File Search
  const finalUrl = page.url();
  console.log(`Final URL after gate bypass: ${finalUrl}`);

  if (finalUrl.includes('Welcome') || finalUrl.includes('Authenticate')) {
    console.warn('WARNING: Still on gate page. Search may fail.');
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
