/**
 * POST /api/process-batch
 *
 * Phase 2: Process a batch of file numbers (typically 3 per call).
 * For each file: lookup, find PDF, download, parse, apply value filter.
 *
 * Batch of 3 files typically completes in ~45 seconds.
 */
import { NextResponse } from 'next/server';
import { connectBrowser, delay, withRetry } from '@/lib/scraper/browser';
import { lookupFile, openProbatePetitionPDF } from '@/lib/scraper/fileHistory';
import {
  downloadAndParsePDF,
  parseProbateText,
  meetsValueThreshold,
} from '@/lib/scraper/pdfParser';

// Vercel serverless timeout (seconds)
export const maxDuration = 60;

export async function POST(request) {
  let browser;

  try {
    const { county, files, minEstateValue = 100000 } = await request.json();

    if (!county || !files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: county, files (array)' },
        { status: 400 }
      );
    }

    // Connect to Browserless.io
    const connection = await connectBrowser();
    browser = connection.browser;
    const { page, context } = connection;

    const results = [];
    const batchStats = { included: 0, skipped: 0, errors: 0 };

    for (const file of files) {
      try {
        // Look up the file
        const { parties, pdfUrl, metadata } = await withRetry(
          () => lookupFile(page, file.fileNumber, county),
          `Lookup ${file.fileNumber}`
        );

        // Try to get the PDF URL
        let pdfViewerUrl = pdfUrl;
        if (!pdfViewerUrl) {
          pdfViewerUrl = await openProbatePetitionPDF(page, context);
        }

        if (!pdfViewerUrl) {
          results.push({
            fileNumber: file.fileNumber,
            fileDate: file.fileDate,
            fileName: file.fileName,
            status: 'error',
            reason: 'No PDF available',
          });
          batchStats.errors++;
          continue;
        }

        // Download and parse the PDF
        const pdfText = await withRetry(
          () => downloadAndParsePDF(page, context, pdfViewerUrl),
          `PDF parse ${file.fileNumber}`
        );

        if (!pdfText || pdfText.trim().length === 0) {
          results.push({
            fileNumber: file.fileNumber,
            fileDate: file.fileDate,
            fileName: file.fileName,
            status: 'skipped',
            reason: 'PDF text extraction empty (possible scanned image)',
          });
          batchStats.skipped++;
          continue;
        }

        // Parse the structured data
        const parsed = parseProbateText(pdfText);

        // Apply value filter
        if (!meetsValueThreshold(parsed, minEstateValue)) {
          const lower = parsed.estateValueLower?.toLocaleString() || '?';
          const upper = parsed.estateValueUpper?.toLocaleString() || '?';
          results.push({
            fileNumber: file.fileNumber,
            fileDate: file.fileDate,
            fileName: file.fileName,
            status: 'skipped',
            reason: `Estate value $${lower}-$${upper} below $${minEstateValue.toLocaleString()} threshold`,
          });
          batchStats.skipped++;
          continue;
        }

        // Include this result
        results.push({
          fileNumber: file.fileNumber,
          fileDate: file.fileDate,
          fileName: file.fileName,
          status: 'included',
          data: {
            ...parsed,
            attorney: metadata?.attorney || '',
          },
        });
        batchStats.included++;
      } catch (err) {
        results.push({
          fileNumber: file.fileNumber,
          fileDate: file.fileDate,
          fileName: file.fileName,
          status: 'error',
          reason: err.message,
        });
        batchStats.errors++;
      }

      // Rate limiting between files
      await delay();
    }

    return NextResponse.json({
      success: true,
      results,
      batchStats,
    });
  } catch (err) {
    console.error('Process-batch API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}
