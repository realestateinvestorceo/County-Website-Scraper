/**
 * Client-side CSV generator.
 * Pure function: results array → CSV string → browser download.
 */

const HEADERS = [
  'File Number',
  'File Date',
  'Decedent Name',
  'Decedent Address',
  'Date of Death',
  'Executor Name',
  'Executor Address',
  'Estate Value Lower',
  'Estate Value Upper',
  'Personal Property',
  'Improved Real Property',
  'Unimproved Real Property',
  'Estate Attorney',
];

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate a CSV string from an array of included results.
 *
 * @param {Array} results - Array of result objects with status === 'included'
 * @returns {string} CSV content
 */
export function generateCSVString(results) {
  const includedResults = results.filter((r) => r.status === 'included');

  const rows = [HEADERS.map(escapeCSV).join(',')];

  for (const r of includedResults) {
    const d = r.data || {};
    const row = [
      r.fileNumber || '',
      r.fileDate || '',
      d.decedentName || '',
      d.decedentAddress || '',
      d.dateOfDeath || '',
      d.executorName || '',
      d.executorAddress || '',
      d.estateValueLower != null ? d.estateValueLower : '',
      d.estateValueUpper != null ? d.estateValueUpper : '',
      d.personalProperty != null ? d.personalProperty : '',
      d.improvedRealProperty != null ? d.improvedRealProperty : '',
      d.unimprovedRealProperty != null ? d.unimprovedRealProperty : '',
      d.attorney || '',
    ];
    rows.push(row.map(escapeCSV).join(','));
  }

  return rows.join('\n');
}

/**
 * Trigger a browser download of a CSV file.
 *
 * @param {string} csvContent - CSV string content
 * @param {string} [filename] - Download filename
 */
export function downloadCSV(csvContent, filename) {
  const name =
    filename || `probate_results_${new Date().toISOString().split('T')[0]}.csv`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
