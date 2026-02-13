/**
 * PDF Parser module — downloads probate petition PDFs and extracts
 * structured data (decedent info, executor info, estate values).
 */
import pdfParse from 'pdf-parse';

/**
 * Download a PDF from the viewer URL and extract text.
 *
 * @param {import('playwright-core').Page} page
 * @param {import('playwright-core').BrowserContext} context
 * @param {string} pdfViewerUrl - URL of the PDF viewer page
 * @returns {Promise<string>} Extracted text content
 */
export async function downloadAndParsePDF(page, context, pdfViewerUrl) {
  const pdfPage = await context.newPage();

  try {
    await pdfPage.goto(pdfViewerUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await new Promise((r) => setTimeout(r, 3000));

    // Try to find the actual PDF URL from embed/iframe/object
    let pdfDirectUrl = await pdfPage.evaluate(() => {
      const embed = document.querySelector('embed[type="application/pdf"]');
      if (embed) return embed.src;

      const iframe = document.querySelector('iframe');
      if (iframe && iframe.src) return iframe.src;

      const obj = document.querySelector('object[type="application/pdf"]');
      if (obj) return obj.data;

      const downloadLink = document.querySelector(
        'a[href*=".pdf"], a[download]'
      );
      if (downloadLink) return downloadLink.href;

      return null;
    });

    let pdfBuffer;

    if (pdfDirectUrl) {
      const response = await pdfPage.goto(pdfDirectUrl, {
        waitUntil: 'load',
        timeout: 20000,
      });
      pdfBuffer = await response.body();
    } else {
      pdfBuffer = await tryInterceptPDF(pdfPage);
    }

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Could not download PDF content');
    }

    const data = await pdfParse(pdfBuffer);
    return data.text;
  } finally {
    await pdfPage.close();
  }
}

/**
 * Try to intercept PDF binary data by reloading with response capture.
 */
async function tryInterceptPDF(pdfPage) {
  let pdfBuffer = null;

  pdfPage.on('response', async (response) => {
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('pdf') || response.url().includes('.pdf')) {
      try {
        pdfBuffer = await response.body();
      } catch {
        // Response body may not be available
      }
    }
  });

  await pdfPage.reload({ waitUntil: 'load', timeout: 20000 });
  await new Promise((r) => setTimeout(r, 3000));

  return pdfBuffer;
}

/**
 * Parse extracted PDF text to get structured probate petition data.
 */
export function parseProbateText(text) {
  const result = {
    decedentName: null,
    decedentAddress: null,
    dateOfDeath: null,
    placeOfDeath: null,
    executorName: null,
    executorAddress: null,
    estateValueLower: null,
    estateValueUpper: null,
    personalProperty: null,
    improvedRealProperty: null,
    unimprovedRealProperty: null,
    parseErrors: [],
  };

  try {
    // --- Section 2: Decedent Info ---
    const decedentNameMatch = text.match(
      /(?:2\.\s+The name.*?decedent.*?follows:|2\.\s+.*?(?:\(a\)\s*)?Name:)\s*([A-Z][A-Z\s.]+?)(?:\n|\(|Date)/si
    );
    if (decedentNameMatch) {
      result.decedentName = cleanName(decedentNameMatch[1]);
    }

    if (!result.decedentName) {
      const willOfMatch = text.match(
        /WILL\s+OF:\s*([A-Z][A-Z\s.]+?)(?:\n|a\/k\/a)/si
      );
      if (willOfMatch) {
        result.decedentName = cleanName(willOfMatch[1]);
      }
    }

    const dodMatch = text.match(
      /Date\s+of\s+death\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/si
    );
    if (dodMatch) {
      result.dateOfDeath = dodMatch[1].trim();
    }

    const placeMatch = text.match(
      /Place\s+of\s+death\s*[:\-]?\s*([A-Za-z,.\s]+?)(?:\n|\(d\)|Domicile)/si
    );
    if (placeMatch) {
      result.placeOfDeath = cleanAddress(placeMatch[1]);
    }

    const domicileMatch = text.match(
      /Domicile:\s*Street\s*([^\n]+?)(?:\n\s*City.*?(?:Village|Town)\s*([^\n]+?))?(?:\n\s*County\s*([^\n]+?))?\s*State\s*([^\n]+)/si
    );
    if (domicileMatch) {
      const street = cleanAddress(domicileMatch[1]);
      const city = cleanAddress(domicileMatch[2] || '');
      const county = cleanAddress(domicileMatch[3] || '');
      const state = cleanAddress(domicileMatch[4] || '');
      result.decedentAddress = [street, city, county, state]
        .filter(Boolean)
        .join(', ');
    }

    if (!result.decedentAddress) {
      const altDomicile = text.match(
        /(?:\(d\)\s*)?Domicile.*?Street\s+(.+?)(?:City|Village|Town)/si
      );
      if (altDomicile) {
        result.decedentAddress = cleanAddress(altDomicile[1]);
      }
    }

    // --- Section 1: Executor/Petitioner Info ---
    const petitionerMatch = text.match(
      /petitioner\s+are\s+as\s+follows:\s*(?:Name:)?\s*([A-Z][A-Z\s.]+?)(?:\n|\(First\))/si
    );
    if (petitionerMatch) {
      result.executorName = cleanName(petitionerMatch[1]);
    }

    if (!result.executorName) {
      const nameFieldMatch = text.match(
        /Name:\s*([A-Z][a-zA-Z]+)\s*\.?\s*([A-Z])?\.?\s*\(First\)\s*\(Middle\)\s*([A-Z][a-zA-Z]+)\s*\(Last\)/si
      );
      if (nameFieldMatch) {
        const first = nameFieldMatch[1].trim();
        const middle = nameFieldMatch[2]
          ? nameFieldMatch[2].trim() + '.'
          : '';
        const last = nameFieldMatch[3].trim();
        result.executorName = [first, middle, last].filter(Boolean).join(' ');
      }
    }

    const execAddrMatch = text.match(
      /Domicile\s+or\s+Principal\s+Office:\s*([^\n]+?)(?:\n\s*\(Street.*?\)\s*\n\s*([^\n]+?))?(?:\n.*?\(City|$)/si
    );
    if (execAddrMatch) {
      const street = cleanAddress(execAddrMatch[1]);
      const cityLine = cleanAddress(execAddrMatch[2] || '');
      result.executorAddress = [street, cityLine].filter(Boolean).join(', ');
    }

    // --- Section 9: Estate Values ---
    const valueRangeMatch = text.match(
      /greater\s+than\s+\$\s*([0-9,.]+)\s*(?:\.00)?\s*(?:but\s+)?less\s+than\s+\$\s*([0-9,.]+)/si
    );
    if (valueRangeMatch) {
      result.estateValueLower = parseAmount(valueRangeMatch[1]);
      result.estateValueUpper = parseAmount(valueRangeMatch[2]);
    }

    const personalMatch = text.match(
      /Personal\s+Property\s+\$\s*([0-9,.]+|NONE)/si
    );
    if (personalMatch) {
      result.personalProperty = parseAmount(personalMatch[1]);
    }

    const improvedMatch = text.match(
      /Improved\s+real\s+property.*?\$\s*([0-9,.]+|NONE)/si
    );
    if (improvedMatch) {
      result.improvedRealProperty = parseAmount(improvedMatch[1]);
    }

    const unimprovedMatch = text.match(
      /Unimproved\s+real\s+property.*?\$\s*([0-9,.]+|NONE)/si
    );
    if (unimprovedMatch) {
      result.unimprovedRealProperty = parseAmount(unimprovedMatch[1]);
    }
  } catch (err) {
    result.parseErrors.push(err.message);
  }

  return result;
}

/**
 * Check if estate meets minimum value threshold (using upper bound).
 */
export function meetsValueThreshold(parsed, minValue) {
  if (parsed.estateValueUpper === null) return true; // include for manual review
  return parsed.estateValueUpper > minValue;
}

// --- Helpers ---

function cleanName(str) {
  if (!str) return null;
  return (
    str
      .replace(/\s+/g, ' ')
      .replace(/[^A-Za-z\s.',-]/g, '')
      .trim() || null
  );
}

function cleanAddress(str) {
  if (!str) return null;
  return (
    str
      .replace(/\s+/g, ' ')
      .replace(/\(.*?\)/g, '')
      .trim() || null
  );
}

function parseAmount(str) {
  if (!str || str.toUpperCase() === 'NONE') return 0;
  const cleaned = str.replace(/[,$\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
