/**
 * Search module — submits search form and collects all file numbers
 * across paginated results.
 */
import { BASE_URL } from '@/lib/config';
import { delay, withRetry } from './browser';

/**
 * Submit a probate petition search for a single date range chunk
 * and collect ALL file numbers across all result pages.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} fromDate - MM/DD/YYYY
 * @param {string} toDate   - MM/DD/YYYY
 * @param {string} courtValue - Court dropdown value (e.g., "15")
 * @param {string} proceeding - Proceeding label (e.g., "PROBATE PETITION")
 * @returns {Promise<Array<{fileNumber, fileDate, fileName, proceeding, dod}>>}
 */
export async function searchAndCollectFiles(page, fromDate, toDate, courtValue, proceeding) {
  // Navigate to search page — use networkidle to ensure JS fully loads
  await withRetry(async () => {
    try {
      await page.goto(`${BASE_URL}/File/FileSearch`, { waitUntil: 'networkidle', timeout: 20000 });
    } catch {
      // Fallback if networkidle times out
      await page.goto(`${BASE_URL}/File/FileSearch`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
  }, 'Navigate to File Search');

  await delay(1500);

  // Select court — use precise ID from live page
  await page.selectOption('#CourtSelect', courtValue);
  await delay(500);

  // Select proceeding type — use precise ID from live page
  await page.selectOption('#SelectedProceeding', { label: proceeding });
  await delay(500);

  // Fill date fields — use precise IDs from live page
  await page.fill('#txtFilingDateFrom', fromDate);
  await delay(200);
  await page.fill('#txtFilingDateTo', toDate);
  await delay(500);

  // Click the File Information Search button (the second form's submit)
  // id="FileSearchSubmit2" is the date-range search button
  const searchBtn = await page.$('#FileSearchSubmit2');
  if (!searchBtn) {
    throw new Error('Could not find the File Information Search button (#FileSearchSubmit2)');
  }

  await searchBtn.click();
  await page.waitForLoadState('domcontentloaded');
  await delay(1500);

  // Check for errors / no results
  const pageText = await page.textContent('body');
  if (pageText.includes('No records found') || pageText.includes('no records')) {
    return [];
  }
  if (pageText.includes('must be within one calendar month')) {
    throw new Error('Date range exceeds one calendar month');
  }

  // Collect all file numbers across all pages
  const allFiles = [];
  let hasMorePages = true;

  while (hasMorePages) {
    const pageResults = await extractResultsFromPage(page);
    allFiles.push(...pageResults);

    const resultsInfo = await page.textContent('body');
    const match = resultsInfo.match(/Results\s+(\d+)\s*-\s*(\d+)\s+of\s+(\d+)/);

    if (match) {
      const endIdx = parseInt(match[2]);
      const total = parseInt(match[3]);

      if (endIdx < total) {
        const nextLink = await page.$('a:has-text(">")');
        if (nextLink) {
          await nextLink.click();
          await page.waitForLoadState('domcontentloaded');
          await delay(1500);
        } else {
          hasMorePages = false;
        }
      } else {
        hasMorePages = false;
      }
    } else {
      hasMorePages = false;
    }
  }

  return allFiles;
}

/**
 * Extract file data from the current search results page.
 */
async function extractResultsFromPage(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('table tr');
    const results = [];

    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].querySelectorAll('td');
      if (cells.length < 5) continue;

      const button = cells[0].querySelector('button.ButtonAsLink');
      if (!button) continue;

      results.push({
        fileNumber: button.value.trim(),
        fileDate: cells[1].textContent.trim(),
        fileName: cells[2].textContent.trim(),
        proceeding: cells[3].textContent.trim(),
        dod: cells[4].textContent.trim(),
      });
    }

    return results;
  });
}
