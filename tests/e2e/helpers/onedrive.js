/**
 * E2E OneDrive API stub.
 *
 * `public/onedrive.js` resolves picked/seeded items against the
 * `@sharePoint.endpoint` host. We intercept that host and reply with a fake
 * item (including expanded thumbnails) plus CORS headers, and serve a real PNG
 * for the download/thumbnail URLs so `<img>`/`<video>` elements render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PNG = path.join(__dirname, '..', 'fixtures', 'sample.png');

export const TEST_ENDPOINT = 'https://my.microsoftpersonalcontent.com/_api/v2.0';
export const TEST_DRIVE_ID = 'test-drive';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

/**
 * Builds a fake resolved-item shape shared by specs and the API stub.
 *
 * @param {{ id: string, title?: string, subtitle?: string, mime?: string, name?: string, width?: number, height?: number }} input
 */
export function makeItem({ id, title, subtitle = '', mime = 'image/png', name, width, height }) {
  const isVideo = mime === 'video/mp4';
  return {
    id,
    title: title || id,
    subtitle,
    mime,
    name: name || `${id}.${isVideo ? 'mp4' : 'png'}`,
    driveId: TEST_DRIVE_ID,
    downloadUrl: `https://media.example/${id}`,
    thumbUrl: `https://media.example/${id}?thumb=1`,
    width: width ?? (isVideo ? 1920 : 1200),
    height: height ?? (isVideo ? 1080 : 900),
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<typeof makeItem>[]} items
 */
export async function stubOneDrive(page, items) {
  const byId = new Map(items.map((item) => [item.id, item]));

  await page.route('**/my.microsoftpersonalcontent.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }

    const match = /\/items\/([^/?]+)/.exec(request.url());
    const item = match ? byId.get(decodeURIComponent(match[1])) : null;
    if (!item) {
      return route.fulfill({
        status: 404,
        headers: CORS_HEADERS,
        json: { error: { code: 'itemNotFound' } },
      });
    }

    return route.fulfill({
      status: 200,
      headers: CORS_HEADERS,
      json: {
        id: item.id,
        name: item.name,
        file: { mimeType: item.mime },
        '@content.downloadUrl': item.downloadUrl,
        parentReference: { driveId: item.driveId },
        thumbnails: [{ large: { url: item.thumbUrl } }],
        ...(item.mime.startsWith('video/')
          ? { video: { width: item.width, height: item.height } }
          : { image: { width: item.width, height: item.height } }),
      },
    });
  });

  const png = fs.readFileSync(FIXTURE_PNG);
  await page.route('**/media.example/**', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'image/png' },
      body: png,
    })
  );
}
