/**
 * GET /api/debug
 *
 * Diagnostic endpoint to test Browserless.io connection and report
 * what's working and what's not. Does NOT scrape anything — just
 * tests the connection chain step by step.
 *
 * Includes the welcome gate bypass that the court website requires.
 */
import { NextResponse } from 'next/server';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL } from '@/lib/config';

export const maxDuration = 45;

export async function GET() {
  const results = {
    timestamp: new Date().toISOString(),
    steps: [],
    env: {},
    error: null,
  };

  // Step 1: Check env variable
  const apiKey = process.env.BROWSERLESS_API_KEY;
  const hasKey = !!apiKey && apiKey !== 'your_api_key_here';
  results.env.BROWSERLESS_API_KEY = hasKey ? `set (${apiKey.length} chars, starts with ${apiKey.substring(0, 4)}...)` : 'NOT SET';
  results.env.NODE_ENV = process.env.NODE_ENV;
  results.env.VERCEL_ENV = process.env.VERCEL_ENV || 'not on vercel';
  results.env.VERCEL_REGION = process.env.VERCEL_REGION || 'unknown';

  results.steps.push({
    step: 'Check API key',
    status: hasKey ? 'PASS' : 'FAIL',
    detail: hasKey ? `Key is ${apiKey.length} characters` : 'BROWSERLESS_API_KEY env var is missing or is placeholder',
  });

  if (!hasKey) {
    results.error = 'No valid API key found. Set BROWSERLESS_API_KEY in Vercel Environment Variables.';
    return NextResponse.json(results);
  }

  // Step 2: Check playwright-core loads
  let chromium;
  try {
    const pw = await import('playwright-core');
    chromium = pw.chromium;
    results.steps.push({
      step: 'Load playwright-core',
      status: 'PASS',
      detail: 'Module loaded successfully',
    });
  } catch (err) {
    results.steps.push({
      step: 'Load playwright-core',
      status: 'FAIL',
      detail: err.message.substring(0, 300),
    });
    results.error = `playwright-core failed to load: ${err.message}`;
    return NextResponse.json(results);
  }

  // Step 3: Test Browserless.io connection
  const wsEndpoint = BROWSERLESS_WS_ENDPOINT(apiKey);
  results.steps.push({
    step: 'Build WebSocket URL',
    status: 'PASS',
    detail: wsEndpoint.replace(apiKey, 'API_KEY_HIDDEN'),
  });

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsEndpoint);
    results.steps.push({
      step: 'Connect to Browserless.io via CDP',
      status: 'PASS',
      detail: 'Browser connected',
    });
  } catch (err) {
    results.steps.push({
      step: 'Connect to Browserless.io via CDP',
      status: 'FAIL',
      detail: err.message.substring(0, 500),
    });
    results.error = `Browserless connection failed: ${err.message.substring(0, 300)}`;
    return NextResponse.json(results);
  }

  // Step 4: Create page
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);

    results.steps.push({
      step: 'Create browser page',
      status: 'PASS',
      detail: 'Page created',
    });

    // Step 5: Bypass the Welcome gate
    // The court website redirects all first-visit requests to /Home/Welcome
    // and requires clicking "Start Search" to set a session cookie.
    await page.goto(`${BASE_URL}/Home/Welcome`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    const welcomeUrl = page.url();
    const welcomeTitle = await page.title();

    const startBtn = await page.$('button[name="WelcomePageButton"][value="Start"]');
    if (startBtn) {
      await startBtn.click();
      await page.waitForLoadState('domcontentloaded');
      results.steps.push({
        step: 'Bypass welcome gate',
        status: 'PASS',
        detail: `Clicked "Start Search" on welcome page (${welcomeUrl})`,
      });
    } else {
      results.steps.push({
        step: 'Bypass welcome gate',
        status: 'PASS',
        detail: `No welcome button found — may already be past the gate (url: ${welcomeUrl}, title: "${welcomeTitle}")`,
      });
    }

    // Small delay to let cookie settle
    await new Promise((r) => setTimeout(r, 1000));

    // Step 6: Navigate to the File Search page
    const targetUrl = BASE_URL + '/File/FileSearch';
    let response;
    try {
      response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
    } catch {
      response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }

    const title = await page.title();
    const url = page.url();
    const httpStatus = response?.status() || 'unknown';

    // Check if we got redirected back to welcome
    const redirectedBack = url.includes('/Home/Welcome');

    results.steps.push({
      step: 'Navigate to File Search page',
      status: redirectedBack ? 'FAIL' : 'PASS',
      detail: redirectedBack
        ? `Redirected back to welcome page: ${url}`
        : `HTTP ${httpStatus} — URL: ${url} — Title: "${title}"`,
    });

    if (redirectedBack) {
      results.error = 'Still being redirected to Welcome page after bypass attempt.';
      await page.close();
      return NextResponse.json(results, { status: 500 });
    }

    // Step 7: Capture page snapshot
    const bodyText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 2000) || '(empty body)';
    });
    const formElements = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      const selectInfo = Array.from(selects).map(s => ({
        id: s.id,
        name: s.name,
        options: s.options.length,
      }));
      const inputs = document.querySelectorAll('input');
      const inputInfo = Array.from(inputs).map(inp => ({
        id: inp.id,
        name: inp.name,
        type: inp.type,
      }));
      const buttons = document.querySelectorAll('button');
      const buttonInfo = Array.from(buttons).map(b => ({
        id: b.id,
        name: b.name,
        type: b.type,
        text: b.textContent?.trim()?.substring(0, 50),
      }));
      return { selects: selectInfo, inputs: inputInfo, buttons: buttonInfo };
    });

    results.steps.push({
      step: 'Capture page snapshot',
      status: 'PASS',
      detail: `Body text starts with: "${bodyText.substring(0, 200).replace(/\n/g, ' ')}"`,
      formElements,
    });

    // Step 8: Check form elements
    const courtDropdown = await page.$('#CourtSelect');
    const proceedingDropdown = await page.$('#SelectedProceeding');
    const fileInput = await page.$('#FileNumber');
    const dateFrom = await page.$('#txtFilingDateFrom');
    const dateTo = await page.$('#txtFilingDateTo');
    const searchBtn1 = await page.$('#FileSearchSubmit');
    const searchBtn2 = await page.$('#FileSearchSubmit2');

    const formCheck = {
      courtDropdown: !!courtDropdown,
      proceedingDropdown: !!proceedingDropdown,
      fileNumberInput: !!fileInput,
      fromDateInput: !!dateFrom,
      toDateInput: !!dateTo,
      fileSearchButton: !!searchBtn1,
      dateSearchButton: !!searchBtn2,
    };

    const allFormFound = Object.values(formCheck).every(Boolean);

    results.steps.push({
      step: 'Verify court form elements',
      status: allFormFound ? 'PASS' : 'FAIL',
      detail: allFormFound
        ? 'All 7 form elements found'
        : `Missing: ${Object.entries(formCheck).filter(([,v]) => !v).map(([k]) => k).join(', ')}`,
      formCheck,
    });

    // Step 9: Try selecting Erie County
    if (courtDropdown) {
      try {
        await page.selectOption('#CourtSelect', '15');
        const selectedValue = await page.$eval('#CourtSelect', el => el.value);
        results.steps.push({
          step: 'Select Erie County (value=15)',
          status: selectedValue === '15' ? 'PASS' : 'FAIL',
          detail: selectedValue === '15' ? 'Successfully selected Erie County' : `Selected value is: ${selectedValue}`,
        });
      } catch (err) {
        results.steps.push({
          step: 'Select Erie County (value=15)',
          status: 'FAIL',
          detail: err.message.substring(0, 200),
        });
      }
    }

    await page.close();
  } catch (err) {
    results.steps.push({
      step: 'Navigate/verify court website',
      status: 'FAIL',
      detail: err.message.substring(0, 300),
    });
    results.error = `Navigation failed: ${err.message.substring(0, 300)}`;
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }

  // Summary
  const allPassed = results.steps.every((s) => s.status === 'PASS');
  if (allPassed && !results.error) {
    results.summary = 'ALL TESTS PASSED — Connection, welcome bypass, and form verification all working.';
  }

  return NextResponse.json(results, { status: results.error ? 500 : 200 });
}
