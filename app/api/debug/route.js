/**
 * GET /api/debug
 *
 * Tests the full connection + gate bypass flow:
 * Browserless connect → Welcome page → hCaptcha → File Search
 *
 * connectBrowser() should land on /File/FileSearch if successful.
 */
import { NextResponse } from 'next/server';

export const maxDuration = 60;

export async function GET() {
  const results = {
    timestamp: new Date().toISOString(),
    steps: [],
    env: {},
    error: null,
  };

  // Environment
  const apiKey = process.env.BROWSERLESS_API_KEY;
  const hasKey = !!apiKey && apiKey !== 'your_api_key_here';
  results.env.BROWSERLESS_API_KEY = hasKey ? `set (${apiKey.length} chars)` : 'NOT SET';
  results.env.NODE_ENV = process.env.NODE_ENV;
  results.env.VERCEL_REGION = process.env.VERCEL_REGION || 'unknown';

  if (!hasKey) {
    results.steps.push({ step: 'Check API key', status: 'FAIL', detail: 'BROWSERLESS_API_KEY not set' });
    results.error = 'No valid API key found.';
    return NextResponse.json(results);
  }
  results.steps.push({ step: 'Check API key', status: 'PASS', detail: `${apiKey.length} chars` });

  let browser;
  try {
    const { connectBrowser } = await import('@/lib/scraper/browser');
    results.steps.push({ step: 'Load modules', status: 'PASS', detail: 'OK' });

    // connectBrowser does: connect → welcome → captcha → file search
    const t0 = Date.now();
    const connection = await connectBrowser();
    browser = connection.browser;
    const { page } = connection;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const url = page.url();

    results.steps.push({
      step: 'connectBrowser() — full gate bypass',
      status: 'PASS',
      detail: `${elapsed}s — landed on: ${url}`,
    });

    // Verify we have the search form
    await page.waitForSelector('#CourtSelect', { timeout: 5000 });

    const formCheck = {
      courtDropdown: !!(await page.$('#CourtSelect')),
      proceedingDropdown: !!(await page.$('#SelectedProceeding')),
      fileNumberInput: !!(await page.$('#FileNumber')),
      fromDateInput: !!(await page.$('#txtFilingDateFrom')),
      toDateInput: !!(await page.$('#txtFilingDateTo')),
    };
    const allFound = Object.values(formCheck).every(Boolean);

    results.steps.push({
      step: 'Verify search form',
      status: allFound ? 'PASS' : 'FAIL',
      detail: allFound
        ? 'All form elements found on File Search page'
        : `Missing: ${Object.entries(formCheck).filter(([,v]) => !v).map(([k]) => k).join(', ')}`,
      formCheck,
    });

    if (allFound) {
      await page.selectOption('#CourtSelect', '15');
      results.steps.push({ step: 'Select Erie County', status: 'PASS', detail: 'value=15' });
    }

    await page.close();
  } catch (err) {
    results.steps.push({
      step: 'Gate bypass or verification',
      status: 'FAIL',
      detail: err.message.substring(0, 500),
    });
    results.error = err.message.substring(0, 400);
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }

  const allPassed = results.steps.every((s) => s.status === 'PASS');
  if (allPassed && !results.error) {
    results.summary = 'ALL TESTS PASSED — Browserless + gate bypass + form verification working.';
  }

  return NextResponse.json(results, { status: results.error ? 500 : 200 });
}
