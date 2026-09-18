/**
 * Microsoft Graph helpers for resolving picked OneDrive items.
 *
 * The server stores only the picker references (drive_item_id / drive_id);
 * everything the UI renders is resolved here on demand with a Graph token.
 */

import { getGraphToken } from './auth.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Builds the Graph item path for a picked item. Falls back to /me/drive when
 * the picker did not return a drive id.
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @returns {string}
 */
function itemPath(id, driveId) {
  return driveId
    ? `${GRAPH_BASE}/drives/${driveId}/items/${id}`
    : `${GRAPH_BASE}/me/drive/items/${id}`;
}

async function graphFetch(url) {
  const token = await getGraphToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Graph request failed (${response.status})`);
  }
  return response.json();
}

/**
 * Resolves a picked item to its metadata + default download URL.
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @returns {Promise<{ id: string, name: string, mime: string, downloadUrl: string | null, driveId: string | null }>}
 */
export async function resolveItem(id, driveId) {
  const item = await graphFetch(
    `${itemPath(id, driveId)}?$select=id,name,file,image,video,parentReference`
  );

  return {
    id: item.id,
    name: item.name || '',
    mime: item.file?.mimeType || '',
    downloadUrl: item['@microsoft.graph.downloadUrl'] || null,
    driveId: item.parentReference?.driveId || driveId || null,
  };
}

/**
 * Resolves a thumbnail URL for a picked item, or null when unavailable
 * (e.g. Graph has not generated thumbnails for it).
 *
 * @param {string} id
 * @param {string | null} [driveId]
 * @returns {Promise<string | null>}
 */
export async function getThumbnailUrl(id, driveId) {
  try {
    const { value } = await graphFetch(`${itemPath(id, driveId)}/thumbnails`);
    const thumbnails = Array.isArray(value) ? value : [];
    const thumb = thumbnails[0];
    return thumb?.medium?.url || thumb?.small?.url || null;
  } catch {
    return null;
  }
}
