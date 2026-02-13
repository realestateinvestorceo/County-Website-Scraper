/**
 * Server-side error log.
 *
 * Stores the last N errors in memory so they can be viewed via /api/errors.
 * Note: This resets when the serverless function cold-starts, which is fine
 * for debugging. For persistent logs, use Vercel's built-in log drain.
 */

const MAX_ENTRIES = 100;
const errorLog = [];

/**
 * Log an error with context.
 * @param {string} source - Which API route or module produced the error
 * @param {string} message - Error message
 * @param {Object} [details] - Additional context (file number, phase, etc.)
 */
export function logError(source, message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    message: typeof message === 'string' ? message.substring(0, 1000) : String(message),
    details,
  };

  errorLog.unshift(entry); // newest first
  if (errorLog.length > MAX_ENTRIES) {
    errorLog.length = MAX_ENTRIES;
  }

  // Also log to console so it shows up in Vercel's function logs
  console.error(`[${entry.source}] ${entry.message}`, details);
}

/**
 * Get all logged errors.
 */
export function getErrors() {
  return [...errorLog];
}

/**
 * Clear the error log.
 */
export function clearErrors() {
  errorLog.length = 0;
}
