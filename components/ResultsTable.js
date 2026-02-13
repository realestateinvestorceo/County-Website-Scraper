'use client';

import { useState } from 'react';

/**
 * Sortable results table showing included probate filings.
 */
export default function ResultsTable({ results }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const includedResults = results.filter((r) => r.status === 'included');

  if (includedResults.length === 0) return null;

  const columns = [
    { key: 'fileNumber', label: 'File #', width: 'w-28' },
    { key: 'fileDate', label: 'File Date', width: 'w-24' },
    { key: 'decedentName', label: 'Decedent Name', width: 'w-40' },
    { key: 'decedentAddress', label: 'Decedent Address', width: 'w-52' },
    { key: 'dateOfDeath', label: 'DOD', width: 'w-28' },
    { key: 'executorName', label: 'Executor Name', width: 'w-40' },
    { key: 'executorAddress', label: 'Executor Address', width: 'w-52' },
    { key: 'estateValueRange', label: 'Estate Value', width: 'w-36' },
    { key: 'improvedRealProperty', label: 'Improved Real Prop.', width: 'w-32' },
  ];

  function getValue(row, key) {
    if (key === 'fileNumber') return row.fileNumber;
    if (key === 'fileDate') return row.fileDate;
    if (key === 'estateValueRange') {
      const d = row.data || {};
      return d.estateValueUpper || 0;
    }
    return row.data?.[key] || '';
  }

  function handleSort(key) {
    if (sortCol === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(key);
      setSortDir('asc');
    }
  }

  const sortedResults = [...includedResults].sort((a, b) => {
    if (!sortCol) return 0;
    const valA = getValue(a, sortCol);
    const valB = getValue(b, sortCol);

    if (typeof valA === 'number' && typeof valB === 'number') {
      return sortDir === 'asc' ? valA - valB : valB - valA;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    return sortDir === 'asc'
      ? strA.localeCompare(strB)
      : strB.localeCompare(strA);
  });

  const fmt = (num) => {
    if (num == null || num === 0) return '$0';
    return `$${Number(num).toLocaleString()}`;
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-3">
        Results ({includedResults.length} estates above threshold)
      </h3>
      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={`${col.width} cursor-pointer px-3 py-2 text-left font-semibold text-gray-700 hover:bg-gray-100 select-none`}
                >
                  {col.label}
                  {sortCol === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u2191' : '\u2193'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedResults.map((row, i) => {
              const d = row.data || {};
              return (
                <tr key={row.fileNumber || i} className="hover:bg-blue-50">
                  <td className="px-3 py-2 font-mono text-xs">{row.fileNumber}</td>
                  <td className="px-3 py-2">{row.fileDate}</td>
                  <td className="px-3 py-2 font-medium">{d.decedentName || '-'}</td>
                  <td className="px-3 py-2 text-xs">{d.decedentAddress || '-'}</td>
                  <td className="px-3 py-2">{d.dateOfDeath || '-'}</td>
                  <td className="px-3 py-2 font-medium">{d.executorName || '-'}</td>
                  <td className="px-3 py-2 text-xs">{d.executorAddress || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmt(d.estateValueLower)}-{fmt(d.estateValueUpper)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {fmt(d.improvedRealProperty)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
