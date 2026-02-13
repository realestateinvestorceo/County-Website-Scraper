/**
 * File History module — looks up individual files by file number
 * and extracts party info + locates the Probate Petition PDF link.
 */
import { BASE_URL } from '@/lib/config';
import { delay, withRetry } from './browser';

/**
 * Look up a single file by file number and extract metadata + PDF link.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} fileNumber - e.g., "2022-4682/A"
 * @param {string} courtValue - Court dropdown value (e.g., "15")
 */
export async function lookupFile(page, fileNumber, courtValue) {
  await withRetry(async () => {
    await page.goto(`${BASE_URL}/File/FileSearch`, {
      waitUntil: 'domcontentloaded',
      timeout: 12000,
    });
  }, `Navigate for file ${fileNumber}`);

  // Wait for the court dropdown to confirm page is ready
  await page.waitForSelector('#CourtSelect', { timeout: 8000 });

  // Fill form
  await page.selectOption('#CourtSelect', courtValue);
  await page.fill('#FileNumber', fileNumber);
  await delay(200);

  // Click File Number Search button
  const fileSearchBtn = await page.$('#FileSearchSubmit');
  if (!fileSearchBtn) throw new Error('Could not find File Number Search button (#FileSearchSubmit)');

  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    fileSearchBtn.click(),
  ]);
  await delay(800);

  // If we landed on search results instead of file history, click the file button
  const currentUrl = page.url();
  if (!currentUrl.includes('FileHistory')) {
    const fileBtn = await page.$(`button[value="${fileNumber}"]`);
    if (fileBtn) {
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        fileBtn.click(),
      ]);
      await delay(800);
    }
  }

  const parties = await extractParties(page);
  const metadata = await extractFileMetadata(page);
  const pdfUrl = await findProbatePetitionLink(page);

  return { parties, pdfUrl, metadata };
}

/**
 * Extract party info from the File History party table.
 */
async function extractParties(page) {
  return page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const parties = [];

    for (const table of tables) {
      const headers = table.querySelectorAll('th');
      const headerTexts = Array.from(headers).map((h) =>
        h.textContent.trim().toUpperCase()
      );

      if (headerTexts.includes('PARTY') && headerTexts.includes('ROLE')) {
        const rows = table.querySelectorAll('tr');
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('td');
          if (cells.length >= 3) {
            parties.push({
              name: cells[0].textContent.trim(),
              role: cells[1].textContent.trim(),
              dod: cells[2].textContent.trim(),
            });
          }
        }
        break;
      }
    }

    return parties;
  });
}

/**
 * Extract metadata from the File History header.
 */
async function extractFileMetadata(page) {
  return page.evaluate(() => {
    const bodyText = document.body.textContent;
    const metadata = {};

    const fileDate = bodyText.match(/File Date:\s*(\d{2}\/\d{2}\/\d{4})/);
    if (fileDate) metadata.fileDate = fileDate[1];

    const estateClosed = bodyText.match(/Estate Closed:\s*(\w)/);
    if (estateClosed) metadata.estateClosed = estateClosed[1];

    const judge = bodyText.match(/Judge:\s*(.+?)(?:\n|$)/);
    if (judge) metadata.judge = judge[1].trim();

    const attorney = bodyText.match(/Estate Attorney:\s*(.+?)(?:\n|$)/);
    if (attorney) metadata.attorney = attorney[1].trim();

    return metadata;
  });
}

/**
 * Find the "PROBATE PETITION" document link on the File History page.
 */
async function findProbatePetitionLink(page) {
  const link = await page.$('a:has-text("PROBATE PETITION")');
  if (!link) return null;

  const href = await link.getAttribute('href');
  if (href) {
    if (href.startsWith('http')) return href;
    return `${BASE_URL}${href}`;
  }

  return null;
}

/**
 * Click the Probate Petition link and get the PDF URL from the new tab.
 */
export async function openProbatePetitionPDF(page, context) {
  const link = await page.$('a:has-text("PROBATE PETITION")');
  if (!link) return null;

  const [newPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }),
    link.click(),
  ]);

  await newPage.waitForLoadState('domcontentloaded');
  await delay(1000);

  const pdfUrl = newPage.url();
  await newPage.close();

  return pdfUrl;
}
