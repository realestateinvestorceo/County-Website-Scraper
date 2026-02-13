'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * /logs — Error log viewer + debug runner.
 *
 * Shows:
 *  1. A "Run Debug Test" button that hits /api/debug
 *  2. Recent error log entries from /api/errors
 *  3. Auto-refresh toggle
 */
export default function LogsPage() {
  const [errors, setErrors] = useState([]);
  const [debugResult, setDebugResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchErrors = useCallback(async () => {
    try {
      const res = await fetch('/api/errors');
      const data = await res.json();
      setErrors(data.errors || []);
    } catch (err) {
      console.error('Failed to fetch errors:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  // Auto-refresh every 5s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchErrors, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchErrors]);

  async function handleRunDebug() {
    setDebugLoading(true);
    setDebugResult(null);
    try {
      const res = await fetch('/api/debug');
      const data = await res.json();
      setDebugResult(data);
    } catch (err) {
      setDebugResult({ error: `Fetch failed: ${err.message}` });
    } finally {
      setDebugLoading(false);
    }
  }

  async function handleClearErrors() {
    try {
      await fetch('/api/errors', { method: 'DELETE' });
      setErrors([]);
    } catch (err) {
      console.error('Failed to clear errors:', err);
    }
  }

  async function handleRefresh() {
    setLoading(true);
    await fetchErrors();
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Diagnostics & Logs</h1>
          <a href="/" className="text-sm text-blue-600 hover:underline">&larr; Back to Scraper</a>
        </div>

        {/* Debug Section */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Connection Debug Test</h2>
          <p className="text-sm text-gray-600 mb-4">
            Tests the full connection chain: API key &rarr; playwright-core &rarr; Browserless.io &rarr; court website.
          </p>
          <button
            onClick={handleRunDebug}
            disabled={debugLoading}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
          >
            {debugLoading ? 'Running...' : 'Run Debug Test'}
          </button>

          {debugResult && (
            <div className="mt-4 space-y-3">
              {/* Environment */}
              {debugResult.env && (
                <div className="rounded-md bg-gray-50 p-3 text-sm">
                  <h3 className="font-medium text-gray-700 mb-1">Environment</h3>
                  <div className="space-y-1 font-mono text-xs text-gray-600">
                    {Object.entries(debugResult.env).map(([k, v]) => (
                      <div key={k}><span className="text-gray-500">{k}:</span> {v}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Steps */}
              {debugResult.steps && debugResult.steps.map((step, i) => (
                <div
                  key={i}
                  className={`rounded-md p-3 text-sm ${
                    step.status === 'PASS'
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-red-50 border border-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-bold ${step.status === 'PASS' ? 'text-green-700' : 'text-red-700'}`}>
                      {step.status === 'PASS' ? '\u2713' : '\u2717'}
                    </span>
                    <span className="font-medium text-gray-800">{step.step}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600 ml-6">{step.detail}</p>
                </div>
              ))}

              {/* Summary / Error */}
              {debugResult.summary && (
                <div className="rounded-md bg-green-100 border border-green-300 p-3 text-sm font-medium text-green-800">
                  {debugResult.summary}
                </div>
              )}
              {debugResult.error && (
                <div className="rounded-md bg-red-100 border border-red-300 p-3 text-sm font-medium text-red-800">
                  {debugResult.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Error Log Section */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">
              Error Log <span className="text-sm font-normal text-gray-500">({errors.length} entries)</span>
            </h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                Auto-refresh
              </label>
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
              <button
                onClick={handleClearErrors}
                className="rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {errors.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No errors logged. Run a scrape or debug test to see entries here.</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {errors.map((err, i) => (
                <div key={i} className="rounded-md bg-red-50 border border-red-100 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-red-800">{err.source}</span>
                    <span className="text-xs text-gray-500">{new Date(err.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-red-700">{err.message}</p>
                  {err.details && Object.keys(err.details).length > 0 && (
                    <pre className="mt-2 text-xs text-gray-600 bg-white rounded p-2 overflow-x-auto">
                      {JSON.stringify(err.details, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Note about Vercel logs */}
        <p className="text-xs text-gray-400 text-center">
          Note: In-memory error log resets on each serverless cold start. For persistent logs, check Vercel Function Logs.
        </p>
      </div>
    </div>
  );
}
