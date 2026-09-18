/**
 * Read-through cache for resolved OneDrive items.
 *
 * `@content.downloadUrl` is short-lived (~1h) and every Timeline mount would
 * otherwise re-resolve every row. We keep the latest resolution in
 * `sessionStorage`, keyed by account + `drive_item_id`, and treat it as fresh
 * for a conservative TTL so an expired URL is never served.
 *
 * The cache is per-tab (sessionStorage) and per-account: switching accounts
 * cannot read another account's entries because the account id is part of the
 * key. {@link clearResolutionCache} is the sign-out hook.
 */

import { resolveItem } from './onedrive.js';

const RESOLUTION_TTL_MS = 50 * 60 * 1000; // 50 minutes (< ~1h download URL)
const KEY_PREFIX = 'odResolve:';

/**
 * @returns {Storage | null}
 */
function getStore() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

/**
 * @param {string} account
 * @param {string} id
 * @returns {string}
 */
function entryKey(account, id) {
  return `${KEY_PREFIX}${account}:${id}`;
}

/**
 * Reads a fresh cached resolution, or null when missing/expired/corrupt.
 * Expired entries are removed.
 *
 * @param {string} account
 * @param {string} id
 * @param {number} [now]
 * @returns {object | null}
 */
export function readCachedResolution(account, id, now = Date.now()) {
  const store = getStore();
  if (!store || !account || !id) return null;

  const key = entryKey(account, id);
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!entry || typeof entry.savedAt !== 'number') return null;

  if (now - entry.savedAt >= RESOLUTION_TTL_MS) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
    return null;
  }

  return entry.value || null;
}

/**
 * Stores a resolution for the given account + item.
 *
 * @param {string} account
 * @param {string} id
 * @param {object} value
 * @param {number} [now]
 */
export function writeCachedResolution(account, id, value, now = Date.now()) {
  const store = getStore();
  if (!store || !account || !id) return;
  try {
    store.setItem(entryKey(account, id), JSON.stringify({ savedAt: now, value }));
  } catch {
    // quota/private mode: caching is best-effort
  }
}

/**
 * Read-through resolver: returns the cached resolution when fresh, otherwise
 * resolves via the OneDrive API and caches the result. Failures are not cached.
 *
 * @param {string} account
 * @param {string} id
 * @param {string | null} [driveId]
 * @param {string | null} [endpoint]
 * @param {string} [token]
 * @returns {Promise<object>}
 */
export async function resolveItemCached(account, id, driveId, endpoint, token) {
  const cached = readCachedResolution(account, id);
  if (cached) return cached;

  const value = await resolveItem(id, driveId, endpoint, token);
  writeCachedResolution(account, id, value);
  return value;
}

/**
 * Sign-out hook: drops every cached resolution for this tab.
 */
export function clearResolutionCache() {
  const store = getStore();
  if (!store) return;
  const keys = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(KEY_PREFIX)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export { RESOLUTION_TTL_MS };
