/**
 * OneDrive item resolution for picked files.
 *
 * The server stores only the picker references (drive_item_id / drive_id /
 * drive_endpoint); everything the UI renders is resolved here on demand.
 *
 * Consumer (personal Microsoft accounts) items live in the OneDrive API, NOT
 * Microsoft Graph. The picker hands back `@sharePoint.endpoint` for the item,
 * and the picker token (`OneDrive.ReadOnly`) is scoped to that same resource.
 * Calling graph.microsoft.com with that token fails with
 * `InvalidAuthenticationToken: The token could not be read`, and Graph also
 * uses a different download annotation (`@microsoft.graph.downloadUrl`). The
 * OneDrive API returns `@content.downloadUrl`.
 *
 * @see https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/
 */

import { getPickerToken } from './auth.js';

const FALLBACK_ENDPOINT = 'https://api.onedrive.com/v1.0';

/**
 * Builds the OneDrive item path for a picked item. The base URL comes from the
 * picker payload (`@sharePoint.endpoint`); without it we fall back to the
 * consumer OneDrive API.
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @param {string | null} [endpoint]
 * @returns {string}
 */
function itemPath(id, driveId, endpoint) {
  const base = (endpoint || FALLBACK_ENDPOINT).replace(/\/$/, '');
  return driveId
    ? `${base}/drives/${driveId}/items/${id}`
    : `${base}/me/drive/items/${id}`;
}

/**
 * Fetches a OneDrive resource with the picker token. When no token is supplied
 * (e.g. lazy Timeline resolution) one is acquired silently, falling back to an
 * interactive popup.
 *
 * @param {string} url
 * @param {string} [token]
 * @returns {Promise<object>}
 */
async function odFetch(url, token) {
  const accessToken = token || (await getPickerToken());
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`OneDrive request failed (${response.status})`);
  }
  return response.json();
}

/**
 * Resolves a picked item to its metadata + default download URL.
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @param {string | null} [endpoint]
 * @param {string} [token] - reuse the picker token acquired for the pick flow.
 * @returns {Promise<{ id: string, name: string, mime: string, downloadUrl: string | null, driveId: string | null }>}
 */
export async function resolveItem(id, driveId, endpoint, token) {
  const item = await odFetch(itemPath(id, driveId, endpoint), token);

  return {
    id: item.id,
    name: item.name || '',
    mime: item.file?.mimeType || '',
    downloadUrl: item['@content.downloadUrl'] || null,
    driveId: item.parentReference?.driveId || driveId || null,
  };
}

/**
 * Resolves a thumbnail URL for a picked item, or null when unavailable
 * (e.g. the service has not generated thumbnails for it).
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @param {string | null} [endpoint]
 * @param {string} [token]
 * @returns {Promise<string | null>}
 */
export async function getThumbnailUrl(id, driveId, endpoint, token) {
  try {
    const { value } = await odFetch(
      `${itemPath(id, driveId, endpoint)}/thumbnails`,
      token
    );
    const thumbnails = Array.isArray(value) ? value : [];
    const thumb = thumbnails[0];
    return thumb?.medium?.url || thumb?.small?.url || null;
  } catch {
    return null;
  }
}
