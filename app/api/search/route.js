/**
 * POST /api/search
 *
 * Phase 1: Search for all matching probate filings in a date range.
 * Returns the list of file numbers to be processed in batches.
 *
 * Typically completes in 5-30 seconds (well within Vercel timeout).
 */
import { NextResponse } from 'next/server';
import { connectBrowser, delay, withRetry } from '@/lib/scraper/browser';
import { splitDateRange } from '@/lib/scraper/dateUtils';
import { searchAndCollectFiles } from '@/lib/scraper/search';
import { logError } from '@/lib/errorLog';

// Vercel serverless timeout (seconds)
export const maxDuration = 60;

export async function POST(request) {
  let browser;

  try {
    const { county, proceeding, fromDate, toDate } = await request.json();

    // Validate
    if (!county || !proceeding || !fromDate || !toDate) {
      return NextResponse.json(
        { error: 'Missing required fields: county, proceeding, fromDate, toDate' },
        { status: 400 }
      );
    }

    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return NextResponse.json(
        { error: 'Dates must be in MM/DD/YYYY format' },
        { status: 400 }
      );
    }

    // Split date range into month chunks
    const dateChunks = splitDateRange(fromDate, toDate);

    // Connect to Browserless.io
    const connection = await connectBrowser();
    browser = connection.browser;
    const { page } = connection;

    // Search each month chunk and collect all file numbers
    const allFiles = [];
    for (const chunk of dateChunks) {
      const files = await withRetry(
        () => searchAndCollectFiles(page, chunk.from, chunk.to, county, proceeding),
        `Search ${chunk.from}-${chunk.to}`
      );
      allFiles.push(...files);
      await delay(500);
    }

    // Deduplicate by file number
    const seen = new Set();
    const uniqueFiles = allFiles.filter((f) => {
      if (seen.has(f.fileNumber)) return false;
      seen.add(f.fileNumber);
      return true;
    });

    return NextResponse.json({
      success: true,
      files: uniqueFiles,
      totalCount: uniqueFiles.length,
      dateChunks,
    });
  } catch (err) {
    logError('api/search', err.message, {
      stack: err.stack?.substring(0, 500),
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
