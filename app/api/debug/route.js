/**
 * GET /api/debug
 *
 * Diagnostic endpoint that uses the same connectBrowser() flow as the
 * scraper, then checks if we actually reached the File Search page.
 */
import { NextResponse } from 'next/server';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL } from '@/lib/config';

export const maxDuration = 60;

export async function GET() {
  const results = {
    timestamp: new Date().toISOString(),
    steps: [],
    env: {},
    error: null,
  };

  // Environment info
  const apiKey = process.env.BROWSERLESS_API_KEY;
  const hasKey = !!apiKey && apiKey !== 'your_api_key_here';
  results.env.BROWSERLESS_API_KEY = hasKey ? `set (${apiKey.length} chars, starts with ${apiKey.substring(0, 4)}...)` : 'NOT SET';
  results.env.NODE_ENV = process.env.NODE_ENV;
  results.env.VERCEL_ENV = process.env.VERCEL_ENV || 'not on vercel';
  results.env.VERCEL_REGION = process.env.VERCEL_REGION || 'unknown';

  if (!hasKey) {
    results.steps.push({ step: 'Check API key', status: 'FAIL', detail: 'BROWSERLESS_API_KEY not set' });
    results.error = 'No valid API key found.';
    return NextResponse.json(results);
  }

  results.steps.push({ step: 'Check API key', status: 'PASS', detail: `Key is ${apiKey.length} characters` });

  // Use connectBrowser — this tests the full Welcome → CAPTCHA → Search flow
  let browser;
  try {
    const { connectBrowser } = await import('@/lib/scraper/browser');

    results.steps.push({ step: 'Load modules', status: 'PASS', detail: 'browser.js loaded' });

    const startTime = Date.now();
    const connection = await connectBrowser();
    browser = connection.browser;
    const { page } = connection;
    const connectTime = Date.now() - startTime;

    results.steps.push({
      step: 'connectBrowser() (includes welcome + CAPTCHA)',
      status: 'PASS',
      detail: `Completed in ${(connectTime / 1000).toFixed(1)}s — final URL: ${page.url()}`,
    });

    // Now try navigating to File Search
    await page.goto(`${BASE_URL}/File/FileSearch`, {
      waitUntil: 'domcontentloaded',
      timeout: 12000,
    });

    const url = page.url();
    const title = await page.title();

    // Check if redirected to welcome or authenticate
    if (url.includes('Welcome') || url.includes('Authenticate')) {
      results.steps.push({
        step: 'Navigate to File Search',
        status: 'FAIL',
        detail: `Redirected to gate page: ${url}`,
      });

      // Capture what we see for debugging
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '(empty)');
      results.steps.push({
        step: 'Page content',
        status: 'FAIL',
        detail: bodyText.replace(/\n/g, ' ').substring(0, 300),
      });

      results.error = `Cannot reach File Search — redirected to: ${url}`;
    } else {
      results.steps.push({
        step: 'Navigate to File Search',
        status: 'PASS',
        detail: `URL: ${url} — Title: "${title}"`,
      });

      // Check form elements
      const formCheck = {
        courtDropdown: !!(await page.$('#CourtSelect')),
        proceedingDropdown: !!(await page.$('#SelectedProceeding')),
        fileNumberInput: !!(await page.$('#FileNumber')),
        fromDateInput: !!(await page.$('#txtFilingDateFrom')),
        toDateInput: !!(await page.$('#txtFilingDateTo')),
      };

      const allFound = Object.values(formCheck).every(Boolean);
      results.steps.push({
        step: 'Verify form elements',
        status: allFound ? 'PASS' : 'FAIL',
        detail: allFound
          ? 'All form elements found'
          : `Missing: ${Object.entries(formCheck).filter(([,v]) => !v).map(([k]) => k).join(', ')}`,
        formCheck,
      });

      // Try selecting Erie County
      if (formCheck.courtDropdown) {
        try {
          await page.selectOption('#CourtSelect', '15');
          results.steps.push({ step: 'Select Erie County', status: 'PASS', detail: 'value=15 selected' });
        } catch (err) {
          results.steps.push({ step: 'Select Erie County', status: 'FAIL', detail: err.message.substring(0, 200) });
        }
      }
    }

    await page.close();
  } catch (err) {
    results.steps.push({
      step: 'connectBrowser() or navigation',
      status: 'FAIL',
      detail: err.message.substring(0, 400),
    });
    results.error = err.message.substring(0, 300);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  const allPassed = results.steps.every((s) => s.status === 'PASS');
  if (allPassed && !results.error) {
    results.summary = 'ALL TESTS PASSED — Full gate bypass + form verification working.';
  }

  return NextResponse.json(results, { status: results.error ? 500 : 200 });
}
