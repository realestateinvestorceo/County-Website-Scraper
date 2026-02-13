'use client';

import { useState, useRef } from 'react';
import { COURTS, LIST_TYPES, BATCH_SIZE } from '@/lib/config';
import ProgressPanel from './ProgressPanel';
import ResultsTable from './ResultsTable';
import DownloadCSVButton from './DownloadCSVButton';

/**
 * Main form component — handles the entire scrape lifecycle:
 * 1. User fills in county, list type, date range
 * 2. Phase 1: POST /api/search → collect file numbers
 * 3. Phase 2: POST /api/process-batch in batches → accumulate results
 * 4. Display results table + CSV download
 */
export default function ScrapeForm() {
  // Form state
  const [county, setCounty] = useState(COURTS[0]?.value || '');
  const [listType, setListType] = useState(LIST_TYPES[0]?.value || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [minEstateValue, setMinEstateValue] = useState(100000);

  // Scrape state
  const [phase, setPhase] = useState('idle'); // idle | searching | processing | complete | error
  const [allFiles, setAllFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Abort controller for cancellation
  const abortRef = useRef(null);

  function addLog(msg) {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  }

  function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  // Convert YYYY-MM-DD (from date input) to MM/DD/YYYY (for API)
  function toAPIDate(isoDate) {
    if (!isoDate) return '';
    const [year, month, day] = isoDate.split('-');
    return `${month}/${day}/${year}`;
  }

  async function handleRunScrape(e) {
    e.preventDefault();

    const apiFromDate = toAPIDate(fromDate);
    const apiToDate = toAPIDate(toDate);

    if (!apiFromDate || !apiToDate) {
      setErrorMsg('Please select both From and To dates.');
      return;
    }

    // Reset state
    setPhase('searching');
    setResults([]);
    setLogs([]);
    setErrorMsg('');
    setStats({ found: 0, processed: 0, included: 0, skipped: 0, errors: 0 });
    setAllFiles([]);
    setCurrentBatch(0);
    setTotalBatches(0);

    abortRef.current = new AbortController();

    try {
      // === PHASE 1: Search ===
      addLog(`Searching ${COURTS.find(c => c.value === county)?.label || county} for ${LIST_TYPES.find(l => l.value === listType)?.label || listType}...`);
      addLog(`Date range: ${apiFromDate} to ${apiToDate}`);

      const searchRes = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          county,
          proceeding: listType,
          fromDate: apiFromDate,
          toDate: apiToDate,
        }),
        signal: abortRef.current.signal,
      });

      if (!searchRes.ok) {
        let errMsg = `Search failed (HTTP ${searchRes.status})`;
        try {
          const err = await searchRes.json();
          errMsg = err.error || errMsg;
        } catch {
          // Response wasn't JSON — read as text for debugging
          try {
            const text = await searchRes.text();
            errMsg = text.substring(0, 200) || errMsg;
          } catch { /* ignore */ }
        }
        throw new Error(errMsg);
      }

      let searchData;
      try {
        searchData = await searchRes.json();
      } catch {
        const text = await searchRes.text();
        throw new Error(`Server returned invalid response: ${text.substring(0, 200)}`);
      }
      const { files, totalCount, dateChunks } = searchData;

      setAllFiles(files);
      setStats((s) => ({ ...s, found: totalCount }));
      addLog(`Found ${totalCount} filings across ${dateChunks.length} month chunk(s).`);

      if (totalCount === 0) {
        setPhase('complete');
        addLog('No filings found. Done.');
        return;
      }

      // === PHASE 2: Process in batches ===
      setPhase('processing');
      const batches = chunkArray(files, BATCH_SIZE);
      setTotalBatches(batches.length);

      let allResults = [];
      let runningStats = { found: totalCount, processed: 0, included: 0, skipped: 0, errors: 0 };

      for (let i = 0; i < batches.length; i++) {
        if (abortRef.current?.signal.aborted) {
          addLog('Scrape cancelled by user.');
          setPhase('error');
          setErrorMsg('Cancelled');
          return;
        }

        setCurrentBatch(i + 1);
        addLog(`Processing batch ${i + 1}/${batches.length} (${batches[i].length} files)...`);

        let batchResponse;
        try {
          batchResponse = await fetch('/api/process-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              county,
              files: batches[i],
              minEstateValue,
            }),
            signal: abortRef.current.signal,
          });
        } catch (fetchErr) {
          if (fetchErr.name === 'AbortError') {
            addLog('Scrape cancelled.');
            setPhase('error');
            return;
          }
          addLog(`Batch ${i + 1} failed: ${fetchErr.message}. Skipping...`);
          runningStats.errors += batches[i].length;
          runningStats.processed += batches[i].length;
          setStats({ ...runningStats });
          continue;
        }

        if (!batchResponse.ok) {
          let errMsg = `HTTP ${batchResponse.status}`;
          try { const d = await batchResponse.json(); errMsg = d.error || errMsg; } catch {
            try { errMsg = (await batchResponse.text()).substring(0, 200); } catch {}
          }
          addLog(`Batch ${i + 1} error: ${errMsg}. Skipping...`);
          runningStats.errors += batches[i].length;
          runningStats.processed += batches[i].length;
          setStats({ ...runningStats });
          continue;
        }

        let batchData;
        try { batchData = await batchResponse.json(); } catch {
          addLog(`Batch ${i + 1}: invalid response from server. Skipping...`);
          runningStats.errors += batches[i].length;
          runningStats.processed += batches[i].length;
          setStats({ ...runningStats });
          continue;
        }
        const { results: batchResults, batchStats } = batchData;

        allResults = [...allResults, ...batchResults];
        setResults([...allResults]);

        runningStats.included += batchStats.included;
        runningStats.skipped += batchStats.skipped;
        runningStats.errors += batchStats.errors;
        runningStats.processed += batchResults.length;
        setStats({ ...runningStats });

        // Log individual outcomes
        for (const r of batchResults) {
          if (r.status === 'included') {
            const d = r.data || {};
            const lower = d.estateValueLower?.toLocaleString() || '?';
            const upper = d.estateValueUpper?.toLocaleString() || '?';
            addLog(`  INCLUDED: ${r.fileNumber} - ${d.decedentName || r.fileName} ($${lower}-$${upper})`);
          } else if (r.status === 'skipped') {
            addLog(`  SKIPPED: ${r.fileNumber} - ${r.reason}`);
          } else {
            addLog(`  ERROR: ${r.fileNumber} - ${r.reason}`);
          }
        }
      }

      setPhase('complete');
      addLog(`Complete. Included: ${runningStats.included}, Skipped: ${runningStats.skipped}, Errors: ${runningStats.errors}`);
    } catch (err) {
      if (err.name === 'AbortError') {
        addLog('Scrape cancelled.');
        setPhase('error');
        return;
      }
      setErrorMsg(err.message);
      setPhase('error');
      addLog(`Fatal error: ${err.message}`);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  const isRunning = phase === 'searching' || phase === 'processing';

  return (
    <div>
      {/* Form */}
      <form onSubmit={handleRunScrape} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* County */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
            <select
              value={county}
              onChange={(e) => setCounty(e.target.value)}
              disabled={isRunning}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            >
              {COURTS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* List Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">List Type</label>
            <select
              value={listType}
              onChange={(e) => setListType(e.target.value)}
              disabled={isRunning}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            >
              {LIST_TYPES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Min Estate Value */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Estate Value ($)</label>
            <input
              type="number"
              value={minEstateValue}
              onChange={(e) => setMinEstateValue(Number(e.target.value))}
              disabled={isRunning}
              min={0}
              step={10000}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* From Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={isRunning}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* To Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={isRunning}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-end gap-3">
            {!isRunning ? (
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
              >
                Run Scrape
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg bg-red-600 px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
      </form>

      {/* Progress */}
      <ProgressPanel
        phase={phase}
        currentBatch={currentBatch}
        totalBatches={totalBatches}
        stats={stats}
        logs={logs}
      />

      {/* Results Table */}
      <ResultsTable results={results} />

      {/* Download Button */}
      <DownloadCSVButton results={results} />
    </div>
  );
}
