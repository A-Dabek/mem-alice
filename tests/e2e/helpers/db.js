/**
 * Seeds/clears milestones through the real API. The E2E server runs with
 * AUTH_DISABLED=1, so the request context needs no bearer token.
 */

import { TEST_ENDPOINT } from './onedrive.js';

/**
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function clearMilestones(request) {
  const res = await request.delete('/api/milestones');
  if (!res.ok() && res.status() !== 404) {
    throw new Error(`clearMilestones failed: ${res.status()}`);
  }
}

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {object[]} items - shapes from helpers/onedrive.js `makeItem`.
 */
export async function seedMilestones(request, items) {
  for (const item of items) {
    const res = await request.post('/api/milestones', {
      data: {
        title: item.title,
        subtitle: item.subtitle ?? '',
        drive_item_id: item.id,
        drive_id: item.driveId,
        drive_endpoint: TEST_ENDPOINT,
        media_mime: item.mime,
        item_name: item.name,
      },
    });
    if (!res.ok()) {
      throw new Error(`seedMilestones failed: ${res.status()}`);
    }
  }
}
