/**
 * Date utility functions for splitting date ranges into calendar-month chunks.
 *
 * The NY Surrogate Court website requires date ranges to be within
 * a single calendar month. This module splits a user-provided range
 * (e.g., 01/15/2026 - 03/10/2026) into valid month-sized chunks.
 */

/**
 * Parse a date string in MM/DD/YYYY format into a Date object.
 */
export function parseDate(dateStr) {
  const [month, day, year] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date object into MM/DD/YYYY string.
 */
export function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Get the last day of the month for a given date.
 */
function lastDayOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Split a date range into calendar-month chunks.
 *
 * Example:
 *   splitDateRange('01/15/2026', '03/10/2026')
 *   => [
 *     { from: '01/15/2026', to: '01/31/2026' },
 *     { from: '02/01/2026', to: '02/28/2026' },
 *     { from: '03/01/2026', to: '03/10/2026' },
 *   ]
 */
export function splitDateRange(fromStr, toStr) {
  const from = parseDate(fromStr);
  const to = parseDate(toStr);
  const chunks = [];

  let currentStart = new Date(from);

  while (currentStart <= to) {
    const monthEnd = lastDayOfMonth(currentStart);
    const chunkEnd = monthEnd < to ? monthEnd : to;

    chunks.push({
      from: formatDate(currentStart),
      to: formatDate(chunkEnd),
    });

    currentStart = new Date(
      currentStart.getFullYear(),
      currentStart.getMonth() + 1,
      1
    );
  }

  return chunks;
}
