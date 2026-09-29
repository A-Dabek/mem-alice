import { resolveItemCached } from '../onedriveCache.js';
import { fetchWithAuth, getAccount, getPickerToken, trySilentPickerToken } from '../auth.js';

export const LOAD_ERROR = 'Nie można wczytać kamieni milowych. Spróbuj ponownie.';
export const LOADING_ITEM = 'Ładowanie podglądu...';
export const REAUTH_ITEM = 'Sesja wygasła. Zaloguj się ponownie.';
export const GONE_ITEM = 'Ten element nie jest już dostępny.';
export const RESOLVE_ERROR = 'Nie udało się wczytać podglądu.';

/**
 * Builds a typed `AUTH_REQUIRED` error with the re-auth message.
 *
 * @returns {Error & { code: string }}
 */
export function authRequiredError() {
  const error = new Error(REAUTH_ITEM);
  error.code = 'AUTH_REQUIRED';
  return error;
}

/**
 * Acquires a picker token. Lazy rows resolve silently only: the
 * IntersectionObserver path has no user gesture, so an interactive popup would
 * be blocked. Interactive acquisition happens exclusively from an explicit
 * button click.
 *
 * @param {boolean} interactive
 * @returns {Promise<string>}
 */
async function acquirePickerToken(interactive) {
  try {
    return interactive ? await getPickerToken() : await trySilentPickerToken();
  } catch {
    const error = new Error('re-auth required');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }
}

/**
 * Resolves one milestone, using the cache and the silent-only token path.
 *
 * @param {object} milestone
 * @param {boolean} interactive
 * @returns {Promise<object>}
 */
export async function resolveMilestone(milestone, interactive) {
  const account = await getAccount();
  const accountId = account?.homeAccountId || account?.username || '';
  const token = await acquirePickerToken(interactive);
  return resolveItemCached(
    accountId,
    milestone.drive_item_id,
    milestone.drive_id,
    milestone.drive_endpoint,
    token
  );
}

/**
 * Maps a resolution error to a row/home state.
 *
 * @param {Error & { code?: string }} error
 * @returns {'needs-auth' | 'gone' | 'error'}
 */
export function statusForError(error) {
  if (error?.code === 'AUTH_REQUIRED') return 'needs-auth';
  if (error?.code === 'NOT_FOUND') return 'gone';
  return 'error';
}

/**
 * Reserves a media box's aspect ratio before the media loads: the resolved
 * intrinsic size when known, else 16/9 for video and 4/3 otherwise. Keeps the
 * wall/home from reflowing as thumbnails and expanded media arrive.
 *
 * @param {string} mime
 * @param {number | null} [width]
 * @param {number | null} [height]
 * @returns {string}
 */
export function aspectFor(mime, width, height) {
  if (width && height) return `${width} / ${height}`;
  return (mime || '').startsWith('video/') ? '16 / 9' : '4 / 3';
}

/**
 * Fetches the stored milestone list, oldest first.
 *
 * @returns {Promise<Array<object>>}
 */
export async function fetchMilestones() {
  let response;
  try {
    response = await fetchWithAuth('/api/milestones');
  } catch (error) {
    if (error?.code === 'AUTH_REQUIRED') throw authRequiredError();
    throw new Error(LOAD_ERROR);
  }
  if (response.status === 401) throw authRequiredError();
  if (!response.ok) {
    throw new Error(LOAD_ERROR);
  }
  return response.json();
}
