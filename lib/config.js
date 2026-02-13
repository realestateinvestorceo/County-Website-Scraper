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
export const REQUEST_DELAY_MS = 2500;
export const MAX_RETRIES = 3;
export const PAGE_TIMEOUT_MS = 30000;
export const BATCH_SIZE = 3; // files per API call (keep under 60s Vercel timeout)

export const BROWSERLESS_WS_ENDPOINT = (apiKey) =>
  `wss://production-sfo.browserless.io?token=${apiKey}`;
