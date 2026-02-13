/**
 * Browser connection module — Playwright + Browserless.io (server-only).
 *
 * The court website (websurrogates.nycourts.gov) has TWO layers of protection:
 *   Layer 1: Cloudflare challenge (JS check / Turnstile) on every first request
 *   Layer 2: hCaptcha on /Home/AuthenticatePage + "File Search" button click
 *
 * We use Browserless /stealth?solveCaptchas=true which should handle both.
 * The CDP captchaFound/solveCaptcha events fire for Cloudflare AND hCaptcha.
 */
import { chromium } from 'playwright-core';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL, PAGE_TIMEOUT_MS, REQUEST_DELAY_MS, MAX_RETRIES } from '@/lib/config';

/**
 * Wait for Cloudflare challenge to clear by polling the page URL.
 * Cloudflare adds __cf_chl_rt_tk to the URL during its challenge.
 * Once the challenge passes, the page should no longer have that param.
 */
async function waitForCloudflare(page, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');

    // Cloudflare challenge indicators
    const isCfChallenge =
      url.includes('__cf_chl') ||
      bodyText.includes('Checking your browser') ||
      bodyText.includes('Just a moment') ||
      bodyText.includes('Verify you are human');

    if (!isCfChallenge) {
      return true; // Cloudflare passed
    }

    console.log('Waiting for Cloudflare challenge to resolve...');
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false; // Timed out
}

/**
 * Connect to Browserless.io and navigate through all protection layers
 * to reach /File/FileSearch.
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
      throw new Error('Cannot reach Browserless.io — check internet or API key.');
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
      throw new Error('Browserless.io rejected your API key.');
    }
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      throw new Error('Connection to Browserless.io timed out.');
    }
    throw new Error(`Browserless connection failed: ${msg.substring(0, 200)}`);
  }

  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(25000);

  // ── Set up CDP session for CAPTCHA solving BEFORE navigating ──
  // This way Browserless can detect Cloudflare challenges from the start
  const cdp = await page.context().newCDPSession(page);
  let captchaCount = 0;

  cdp.on('Browserless.captchaFound', async () => {
    captchaCount++;
    console.log(`CAPTCHA #${captchaCount} detected, solving...`);
    try {
      const result = await cdp.send('Browserless.solveCaptcha');
      console.log(`CAPTCHA #${captchaCount} result:`, JSON.stringify(result));
    } catch (err) {
      console.error(`CAPTCHA #${captchaCount} solve error:`, err.message);
    }
  });

  // ── Step 1: Navigate to the site and wait for Cloudflare ──
  console.log('Step 1: Navigating to court site (may trigger Cloudflare)...');
  await page.goto(`${BASE_URL}/Home/Welcome`, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });

  // Wait for Cloudflare challenge to resolve
  const cfPassed = await waitForCloudflare(page, 25000);
  console.log(`Cloudflare passed: ${cfPassed}. URL: ${page.url()}`);

  if (!cfPassed) {
    const bodySnippet = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || '').catch(() => '');
    throw new Error(
      `Cloudflare challenge did not resolve within 25s. Page shows: "${bodySnippet}". ` +
      `Browserless stealth may not be handling this site's Cloudflare setup.`
    );
  }

  // ── Step 2: Handle Welcome page ──
  console.log('Step 2: Checking for Welcome page...');
  let currentUrl = page.url();

  // We might already be past Welcome if Cloudflare redirected us
  if (currentUrl.includes('Welcome')) {
    const startBtn = await page.$('button[name="WelcomePageButton"][value="Start"]');
    if (startBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        startBtn.click(),
      ]);
      console.log('Welcome page passed. Now on:', page.url());
    }
  }

  // ── Step 3: Handle AuthenticatePage (hCaptcha) ──
  currentUrl = page.url();
  console.log('Step 3: Checking for AuthenticatePage...', currentUrl);

  if (currentUrl.includes('Authenticate')) {
    console.log('On AuthenticatePage — waiting for hCaptcha to be solved...');

    // Wait for the CAPTCHA to be solved (CDP events fire automatically)
    // Poll for the h-captcha-response textarea to be filled
    const captchaSolved = await new Promise((resolve) => {
      let done = false;

      // Poll for captcha response being filled
      const pollInterval = setInterval(async () => {
        try {
          const hasResponse = await page.evaluate(() => {
            const textarea = document.querySelector('textarea[name="h-captcha-response"]');
            return textarea && textarea.value.length > 0;
          });
          if (hasResponse && !done) {
            done = true;
            clearInterval(pollInterval);
            resolve(true);
          }
        } catch { /* page might be navigating */ }
      }, 1000);

      // Timeout after 25s
      setTimeout(() => {
        if (!done) {
          done = true;
          clearInterval(pollInterval);
          resolve(false);
        }
      }, 25000);
    });

    console.log(`hCaptcha solved: ${captchaSolved}`);

    if (captchaSolved) {
      await delay(500);
    }

    // Click "File Search" button
    const fileSearchBtn = await page.$(
      'button[name="LinkButton"][value="ToFileSearch"]:not([disabled])'
    );
    if (fileSearchBtn) {
      console.log('Step 4: Clicking "File Search"...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        fileSearchBtn.click(),
      ]);
      console.log('File Search clicked. Now on:', page.url());
    } else {
      // Maybe the buttons are disabled because CAPTCHA wasn't solved
      // Try clicking even the disabled one as a fallback
      const anyFileSearchBtn = await page.$('button[value="ToFileSearch"]');
      if (anyFileSearchBtn) {
        console.log('Only disabled File Search button found. CAPTCHA may not be solved.');
      }
      console.warn('No enabled "File Search" button found.');
    }
  }

  // ── Final check ──
  const finalUrl = page.url();
  console.log(`Gate bypass complete. Final URL: ${finalUrl}`);
  console.log(`Total CAPTCHAs detected/solved: ${captchaCount}`);

  if (finalUrl.includes('Welcome') || finalUrl.includes('Authenticate')) {
    throw new Error(
      `Gate bypass failed — still on ${finalUrl}. ` +
      `CAPTCHAs detected: ${captchaCount}. ` +
      `This site uses Cloudflare + hCaptcha. Check that your Browserless ` +
      `plan supports CAPTCHA solving (costs 10 units per solve).`
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
