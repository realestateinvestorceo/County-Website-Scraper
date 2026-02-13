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
  // Navigate to search page
  await withRetry(async () => {
    await page.goto(`${BASE_URL}/File/FileSearch`, { waitUntil: 'domcontentloaded' });
  }, 'Navigate to File Search');

  await delay(1000);

  // Select court
  await page.selectOption('select[id*="Court"], select[name*="Court"]', courtValue);
  await delay(500);

  // Select proceeding type
  const proceedingSelectors = await page.$$('select');
  let proceedingSelect = null;
  for (const sel of proceedingSelectors) {
    const options = await sel.$$('option');
    for (const opt of options) {
      const text = await opt.textContent();
      if (text.trim() === proceeding) {
        proceedingSelect = sel;
        break;
      }
    }
    if (proceedingSelect) break;
  }

  if (proceedingSelect) {
    await proceedingSelect.selectOption({ label: proceeding });
  } else {
    throw new Error(`Could not find proceeding dropdown option: ${proceeding}`);
  }
  await delay(500);

  // Fill date fields
  const textInputs = await page.$$('input[type="text"]');
  const dateInputs = [];
  for (const input of textInputs) {
    const name = await input.getAttribute('name');
    const id = await input.getAttribute('id');
    if (
      name?.includes('Date') || name?.includes('date') ||
      id?.includes('Date') || id?.includes('date')
    ) {
      dateInputs.push(input);
    }
  }

  if (dateInputs.length >= 2) {
    await dateInputs[0].click({ clickCount: 3 });
    await dateInputs[0].fill(fromDate);
    await dateInputs[1].click({ clickCount: 3 });
    await dateInputs[1].fill(toDate);
  } else {
    // Fallback: use last two text inputs (skip File # input)
    const allInputs = await page.$$('input[type="text"]');
    if (allInputs.length >= 3) {
      await allInputs[1].click({ clickCount: 3 });
      await allInputs[1].fill(fromDate);
      await allInputs[2].click({ clickCount: 3 });
      await allInputs[2].fill(toDate);
    } else {
      throw new Error('Could not locate date input fields');
    }
  }

  await delay(500);

  // Click the File Information Search button (second Search button on page)
  const searchButtons = await page.$$('button[type="submit"]');
  let fileInfoSearchBtn = null;
  for (const btn of searchButtons) {
    const text = (await btn.textContent()).trim();
    if (text === 'Search') {
      fileInfoSearchBtn = btn;
    }
  }

  if (!fileInfoSearchBtn) {
    throw new Error('Could not find the File Information Search button');
  }

  await fileInfoSearchBtn.click();
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
