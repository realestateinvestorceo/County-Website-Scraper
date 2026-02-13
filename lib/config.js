/**
 * Extensible configuration registry.
 *
 * To add a new county: add an entry to COURTS.
 * To add a new list type: add an entry to LIST_TYPES.
 */

export const COURTS = [
  { value: '15', label: 'Erie County' },
  // Future counties:
  // { value: '31', label: 'New York County' },
  // { value: '24', label: 'Kings County' },
];

export const LIST_TYPES = [
  { value: 'PROBATE PETITION', label: 'Probate' },
  // Future list types:
  // { value: 'ADMINISTRATION PETITION', label: 'Administration' },
];

export const BASE_URL = 'https://websurrogates.nycourts.gov';
export const REQUEST_DELAY_MS = 1500;
export const MAX_RETRIES = 2;
export const PAGE_TIMEOUT_MS = 15000;
export const BATCH_SIZE = 2; // files per API call (keep under 60s Vercel timeout)

// Use /stealth endpoint to avoid bot detection + solveCaptchas for hCaptcha
export const BROWSERLESS_WS_ENDPOINT = (apiKey) =>
  `wss://production-sfo.browserless.io/stealth?token=${apiKey}&solveCaptchas=true`;
