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
 * Hosts the picker may return in `@sharePoint.endpoint`. Matching is done on
 * the hostname as either the apex domain or a subdomain of it.
 */
const ALLOWED_ENDPOINT_HOSTS = [
  'onedrive.com',
  'sharepoint.com',
  'live.com',
  'svc.ms',
  'microsoftpersonalcontent.com',
];

function odError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  if (status) {
    error.status = status;
  }
  return error;
}

/**
 * Validates a picker-provided `@sharePoint.endpoint` before we ever append a
 * token-bearing request to it. Only https on the allowlisted Microsoft hosts is
 * accepted. A missing endpoint is allowed and falls back to the consumer
 * OneDrive API.
 *
 * @param {string | null | undefined} endpoint
 * @returns {string} normalized endpoint (no trailing slash)
 * @throws {Error & { code: 'ENDPOINT_INVALID' }}
 */
export function assertEndpoint(endpoint) {
  if (!endpoint) {
    return FALLBACK_ENDPOINT;
  }

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw odError('ENDPOINT_INVALID', `Invalid OneDrive endpoint: ${endpoint}`);
  }

  if (url.protocol !== 'https:') {
    throw odError(
      'ENDPOINT_INVALID',
      `OneDrive endpoint must use https: ${endpoint}`
    );
  }

  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_ENDPOINT_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
  if (!allowed) {
    throw odError(
      'ENDPOINT_INVALID',
      `OneDrive endpoint host is not allowlisted: ${host}`
    );
  }

  return endpoint.replace(/\/$/, '');
}

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
  const base = assertEndpoint(endpoint);
  return driveId
    ? `${base}/drives/${driveId}/items/${id}`
    : `${base}/me/drive/items/${id}`;
}

/**
 * Maps an HTTP status to a typed error code.
 *
 * @param {number} status
 * @returns {'AUTH_REQUIRED' | 'NOT_FOUND' | 'SERVER_ERROR'}
 */
function classifyStatus(status) {
  if (status === 401 || status === 403) return 'AUTH_REQUIRED';
  if (status === 404) return 'NOT_FOUND';
  return 'SERVER_ERROR';
}

/**
 * Fetches a OneDrive resource with the picker token. When no token is supplied
 * (e.g. lazy Timeline resolution) one is acquired silently, falling back to an
 * interactive popup.
 *
 * Failures are thrown as typed errors (`error.code`) so callers can tell a
 * re-auth apart from a deleted item or a transient outage:
 *  - `AUTH_REQUIRED` (401/403)
 *  - `NOT_FOUND` (404)
 *  - `NETWORK_ERROR` (fetch rejected)
 *  - `SERVER_ERROR` (any other non-2xx)
 * HTTP-backed errors also carry `error.status`.
 *
 * @param {string} url
 * @param {string} [token]
 * @returns {Promise<object>}
 */
async function odFetch(url, token) {
  const accessToken = token || (await getPickerToken());

  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw odError('NETWORK_ERROR', 'OneDrive request failed (network)');
  }

  if (!response.ok) {
    throw odError(
      classifyStatus(response.status),
      `OneDrive request failed (${response.status})`,
      response.status
    );
  }
  return response.json();
}

/**
 * Picks the best available thumbnail URL from a thumbnail object (large →
 * medium → small), or null.
 *
 * @param {{ large?: { url?: string }, medium?: { url?: string }, small?: { url?: string } } | null} [thumb]
 * @returns {string | null}
 */
function thumbUrlOf(thumb) {
  return thumb?.large?.url || thumb?.medium?.url || thumb?.small?.url || null;
}

/**
 * Reads the first thumbnail URL out of a thumbnail collection. The OneDrive API
 * returns an array when thumbnails are `$expand`ed on an item, and a `{ value }`
 * envelope from the standalone `/thumbnails` endpoint.
 *
 * @param {unknown} collection
 * @returns {string | null}
 */
function firstThumbUrl(collection) {
  const list = Array.isArray(collection)
    ? collection
    : Array.isArray(collection?.value)
      ? collection.value
      : [];
  return thumbUrlOf(list[0]);
}

/**
 * Reads the item's intrinsic pixel size from its media facet. OneDrive exposes
 * `{ width, height }` on `image` (photos), `photo` (camera metadata) and `video`
 * (video dimensions); `image` wins when several are present. Missing/non-finite
 * values degrade to null so the UI can fall back to a MIME-based ratio.
 *
 * @param {object} item
 * @returns {{ width: number | null, height: number | null }}
 */
function intrinsicSize(item) {
  const facet = item.image || item.photo || item.video || null;
  return {
    width: Number.isFinite(facet?.width) ? facet.width : null,
    height: Number.isFinite(facet?.height) ? facet.height : null,
  };
}

/**
 * Shapes an item payload into the resolution result the UI consumes.
 *
 * @param {object} item
 * @param {string | null | undefined} driveId
 * @param {string | null} thumbUrl
 * @returns {{ id: string, name: string, mime: string, downloadUrl: string | null, thumbUrl: string | null, driveId: string | null, width: number | null, height: number | null }}
 */
function toResolution(item, driveId, thumbUrl) {
  const { width, height } = intrinsicSize(item);
  return {
    id: item.id,
    name: item.name || '',
    mime: item.file?.mimeType || '',
    downloadUrl: item['@content.downloadUrl'] || null,
    thumbUrl: thumbUrl || null,
    driveId: item.parentReference?.driveId || driveId || null,
    width,
    height,
  };
}

/**
 * Legacy two-request thumbnail lookup (`/thumbnails`). Kept as the A4 fallback
 * for items/endpoints where the combined request does not work.
 *
 * @param {string} id
 * @param {string | null | undefined} driveId
 * @param {string | null | undefined} endpoint
 * @param {string} [token]
 * @returns {Promise<string | null>}
 */
async function fetchThumbnail(id, driveId, endpoint, token) {
  const { value } = await odFetch(
    `${itemPath(id, driveId, endpoint)}/thumbnails`,
    token
  );
  return firstThumbUrl({ value });
}

/**
 * Resolves a picked item to its metadata, default download URL and (best-effort)
 * thumbnail URL.
 *
 * Uses a single request expanding thumbnails. If that request fails or the item
 * comes back without `@content.downloadUrl`, it retries the legacy two-request
 * path (item GET + `/thumbnails`).
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @param {string | null} [endpoint]
 * @param {string} [token] - reuse the picker token acquired for the pick flow.
 * @returns {Promise<{ id: string, name: string, mime: string, downloadUrl: string | null, thumbUrl: string | null, driveId: string | null, width: number | null, height: number | null }>}
 */
export async function resolveItem(id, driveId, endpoint, token) {
  const base = itemPath(id, driveId, endpoint);

  try {
    const item = await odFetch(
      `${base}?$expand=thumbnails($select=large,medium,small)`,
      token
    );
    if (item['@content.downloadUrl']) {
      return toResolution(item, driveId, firstThumbUrl(item.thumbnails));
    }
  } catch {
    // fall through to the legacy two-request path
  }

  const item = await odFetch(base, token);
  let thumbUrl = null;
  try {
    thumbUrl = await fetchThumbnail(id, driveId, endpoint, token);
  } catch {
    // thumbnails are best-effort; a failure must not fail the resolution
  }
  return toResolution(item, driveId, thumbUrl);
}

/**
 * Resolves a thumbnail URL for a picked item, or null when unavailable
 * (e.g. the service has not generated thumbnails for it). Delegates to
 * {@link resolveItem} so it benefits from the combined request.
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @param {string | null} [endpoint]
 * @param {string} [token]
 * @returns {Promise<string | null>}
 */
export async function getThumbnailUrl(id, driveId, endpoint, token) {
  try {
    const { thumbUrl } = await resolveItem(id, driveId, endpoint, token);
    return thumbUrl;
  } catch {
    return null;
  }
}
