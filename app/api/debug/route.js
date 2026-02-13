/**
 * GET /api/debug
 *
 * Diagnostic endpoint to test Browserless.io connection and report
 * what's working and what's not. Does NOT scrape anything — just
 * tests the connection chain step by step.
 */
import { NextResponse } from 'next/server';
import { BROWSERLESS_WS_ENDPOINT, BASE_URL } from '@/lib/config';

export const maxDuration = 30;

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

  // Step 4: Create page and navigate
  try {
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();

    results.steps.push({
      step: 'Create browser page',
      status: 'PASS',
      detail: 'Page created',
    });

    // Step 5: Navigate to the court website
    await page.goto(BASE_URL + '/File/FileSearch', { waitUntil: 'domcontentloaded', timeout: 15000 });
    const title = await page.title();
    const url = page.url();

    results.steps.push({
      step: 'Navigate to court website',
      status: 'PASS',
      detail: `Loaded: ${url} — Title: "${title}"`,
    });

    // Step 6: Check that the page has the expected form elements
    const courtDropdown = await page.$('select[id*="Court"], select[name*="Court"]');
    const hasForm = !!courtDropdown;

    results.steps.push({
      step: 'Verify court form elements',
      status: hasForm ? 'PASS' : 'FAIL',
      detail: hasForm ? 'Court dropdown found on page' : 'Court dropdown NOT found — page may have changed',
    });

    await page.close();
  } catch (err) {
    results.steps.push({
      step: 'Navigate to court website',
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
    results.summary = 'ALL TESTS PASSED — Browserless.io connection and court website are working.';
  }

  return NextResponse.json(results, { status: results.error ? 500 : 200 });
}
