'use client';

/**
 * Progress panel — shows phase, progress bar, stats, and log messages.
 */
export default function ProgressPanel({ phase, currentBatch, totalBatches, stats, logs }) {
  if (phase === 'idle') return null;

  const phaseLabel = {
    searching: 'Searching for filings...',
    processing: `Processing batch ${currentBatch} of ${totalBatches}...`,
    complete: 'Complete!',
    error: 'Error occurred',
  }[phase] || '';

  const progressPercent =
    phase === 'searching'
      ? null
      : phase === 'complete'
        ? 100
        : totalBatches > 0
          ? Math.round((currentBatch / totalBatches) * 100)
          : 0;

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      {/* Phase label */}
      <div className="flex items-center gap-3 mb-3">
        {phase !== 'complete' && phase !== 'error' && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        )}
        {phase === 'complete' && (
          <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
        {phase === 'error' && (
          <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span className="font-semibold text-gray-800">{phaseLabel}</span>
      </div>

      {/* Progress bar */}
      {progressPercent !== null && (
        <div className="mb-3 h-3 w-full rounded-full bg-gray-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              phase === 'error' ? 'bg-red-500' : phase === 'complete' ? 'bg-green-500' : 'bg-blue-600'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Pulsing bar for search phase */}
      {progressPercent === null && (
        <div className="mb-3 h-3 w-full rounded-full bg-gray-200 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-blue-600 animate-pulse" />
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="flex flex-wrap gap-4 mb-3 text-sm">
          <span className="text-gray-600">
            Found: <span className="font-bold text-gray-900">{stats.found}</span>
          </span>
          <span className="text-gray-600">
            Processed: <span className="font-bold text-gray-900">{stats.processed}/{stats.found}</span>
          </span>
          <span className="text-green-700">
            Included: <span className="font-bold">{stats.included}</span>
          </span>
          <span className="text-yellow-700">
            Skipped: <span className="font-bold">{stats.skipped}</span>
          </span>
          <span className="text-red-700">
            Errors: <span className="font-bold">{stats.errors}</span>
          </span>
        </div>
      )}

      {/* Log area */}
      {logs.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-300">
          {logs.map((log, i) => (
            <div key={i} className={`${
              log.includes('INCLUDED') ? 'text-green-400' :
              log.includes('SKIPPED') ? 'text-yellow-400' :
              log.includes('ERROR') || log.includes('error') ? 'text-red-400' :
              'text-gray-300'
            }`}>
              {log}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
