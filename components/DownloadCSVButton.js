'use client';

import { generateCSVString, downloadCSV } from '@/lib/csvGenerator';

/**
 * Button to download results as CSV file.
 */
export default function DownloadCSVButton({ results }) {
  const includedCount = results.filter((r) => r.status === 'included').length;

  if (includedCount === 0) return null;

  function handleDownload() {
    const csv = generateCSVString(results);
    downloadCSV(csv);
  }

  return (
    <button
      onClick={handleDownload}
      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      Download CSV ({includedCount} records)
    </button>
  );
}
