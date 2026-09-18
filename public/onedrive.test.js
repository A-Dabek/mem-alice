import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertEndpoint, resolveItem } from './onedrive.js';

const FALLBACK = 'https://api.onedrive.com/v1.0';
const ENDPOINT = 'https://my.microsoftpersonalcontent.com/_api/v2.0';

function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function resolveWith(status) {
  return withFetch(
    async () => jsonResponse(status, {}),
    () => resolveItem('ITEM', 'DRIVE', ENDPOINT, 'token')
  );
}

test('assertEndpoint accepts allowlisted Microsoft hosts', () => {
  const valid = [
    'https://api.onedrive.com/v1.0',
    'https://onedrive.com/v1.0',
    'https://mytenant-my.sharepoint.com',
    'https://storage.live.com',
    'https://foo.svc.ms',
    'https://my.microsoftpersonalcontent.com/_api/v2.0',
  ];
  for (const endpoint of valid) {
    assert.equal(assertEndpoint(endpoint), endpoint.replace(/\/$/, ''));
  }
});

test('assertEndpoint strips a trailing slash', () => {
  assert.equal(
    assertEndpoint('https://api.onedrive.com/v1.0/'),
    'https://api.onedrive.com/v1.0'
  );
});

test('assertEndpoint falls back when the endpoint is missing', () => {
  assert.equal(assertEndpoint(undefined), FALLBACK);
  assert.equal(assertEndpoint(null), FALLBACK);
  assert.equal(assertEndpoint(''), FALLBACK);
});

test('assertEndpoint rejects lookalike host suffixes', () => {
  assert.throws(
    () => assertEndpoint('https://onedrive.com.evil.com/v1.0'),
    { code: 'ENDPOINT_INVALID' }
  );
  assert.throws(
    () => assertEndpoint('https://not-onedrive.com/v1.0'),
    { code: 'ENDPOINT_INVALID' }
  );
});

test('assertEndpoint rejects non-https and malformed URLs', () => {
  assert.throws(
    () => assertEndpoint('http://api.onedrive.com/v1.0'),
    { code: 'ENDPOINT_INVALID' }
  );
  assert.throws(() => assertEndpoint('api.onedrive.com/v1.0'), {
    code: 'ENDPOINT_INVALID',
  });
  assert.throws(() => assertEndpoint('https://'), { code: 'ENDPOINT_INVALID' });
});

test('resolveItem uses one combined request and returns thumbUrl', async () => {
  const calls = [];
  const result = await withFetch(
    async (url) => {
      calls.push(url);
      return jsonResponse(200, {
        id: 'ITEM',
        name: 'photo.jpg',
        file: { mimeType: 'image/jpeg' },
        '@content.downloadUrl': 'https://download.example/photo',
        parentReference: { driveId: 'DRIVE' },
        thumbnails: [{ large: { url: 'https://thumb.example/large' } }],
      });
    },
    () => resolveItem('ITEM', 'DRIVE', ENDPOINT, 'token')
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0], /\$expand=thumbnails/);
  assert.deepEqual(result, {
    id: 'ITEM',
    name: 'photo.jpg',
    mime: 'image/jpeg',
    downloadUrl: 'https://download.example/photo',
    thumbUrl: 'https://thumb.example/large',
    driveId: 'DRIVE',
    width: null,
    height: null,
  });
});

test('resolveItem falls back to item + thumbnails when downloadUrl is missing', async () => {
  const calls = [];
  const result = await withFetch(
    async (url) => {
      calls.push(url);
      if (url.includes('$expand')) {
        return jsonResponse(200, {
          id: 'ITEM',
          name: 'photo.jpg',
          file: { mimeType: 'image/jpeg' },
        });
      }
      if (url.endsWith('/thumbnails')) {
        return jsonResponse(200, {
          value: [{ medium: { url: 'https://thumb.example/medium' } }],
        });
      }
      return jsonResponse(200, {
        id: 'ITEM',
        name: 'photo.jpg',
        file: { mimeType: 'image/jpeg' },
        '@content.downloadUrl': 'https://download.example/photo',
      });
    },
    () => resolveItem('ITEM', 'DRIVE', ENDPOINT, 'token')
  );

  assert.equal(calls.length, 3);
  assert.match(calls[0], /\$expand/);
  assert.match(calls[1], /\/items\/ITEM$/);
  assert.match(calls[2], /\/thumbnails$/);
  assert.equal(result.downloadUrl, 'https://download.example/photo');
  assert.equal(result.thumbUrl, 'https://thumb.example/medium');
});

test('resolveItem falls back when the combined request errors', async () => {
  const calls = [];
  const result = await withFetch(
    async (url) => {
      calls.push(url);
      if (url.includes('$expand')) return jsonResponse(400, {});
      if (url.endsWith('/thumbnails')) return jsonResponse(404, {});
      return jsonResponse(200, {
        id: 'ITEM',
        name: 'clip.mp4',
        file: { mimeType: 'video/mp4' },
        '@content.downloadUrl': 'https://download.example/clip',
      });
    },
    () => resolveItem('ITEM', 'DRIVE', ENDPOINT, 'token')
  );

  assert.equal(calls.length, 3);
  assert.equal(result.downloadUrl, 'https://download.example/clip');
  assert.equal(result.thumbUrl, null);
});

test('resolveItem returns name, mime, downloadUrl and driveId', async () => {
  const result = await withFetch(
    async () =>
      jsonResponse(200, {
        id: 'ITEM',
        name: 'photo.jpg',
        file: { mimeType: 'image/jpeg' },
        '@content.downloadUrl': 'https://download.example/photo',
        parentReference: { driveId: 'DRIVE' },
      }),
    () => resolveItem('ITEM', null, ENDPOINT, 'token')
  );
  assert.deepEqual(result, {
    id: 'ITEM',
    name: 'photo.jpg',
    mime: 'image/jpeg',
    downloadUrl: 'https://download.example/photo',
    thumbUrl: null,
    driveId: 'DRIVE',
    width: null,
    height: null,
  });
});

test('resolveItem reads width/height from image > photo > video facets', async () => {
  async function resolveWithFacets(facets) {
    return withFetch(
      async () =>
        jsonResponse(200, {
          id: 'ITEM',
          name: 'photo.jpg',
          file: { mimeType: 'image/jpeg' },
          '@content.downloadUrl': 'https://download.example/photo',
          ...facets,
        }),
      () => resolveItem('ITEM', null, ENDPOINT, 'token')
    );
  }

  const imageOnly = await resolveWithFacets({
    image: { width: 1200, height: 800 },
  });
  assert.deepEqual([imageOnly.width, imageOnly.height], [1200, 800]);

  const photoOnly = await resolveWithFacets({
    photo: { width: 640, height: 480 },
  });
  assert.deepEqual([photoOnly.width, photoOnly.height], [640, 480]);

  const videoOnly = await resolveWithFacets({
    video: { width: 1920, height: 1080 },
  });
  assert.deepEqual([videoOnly.width, videoOnly.height], [1920, 1080]);

  const precedence = await resolveWithFacets({
    image: { width: 1200, height: 800 },
    photo: { width: 640, height: 480 },
    video: { width: 1920, height: 1080 },
  });
  assert.deepEqual([precedence.width, precedence.height], [1200, 800]);
});

test('resolveItem maps 401 and 403 to AUTH_REQUIRED with status', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(resolveWith(status), (error) => {
      assert.equal(error.code, 'AUTH_REQUIRED');
      assert.equal(error.status, status);
      return true;
    });
  }
});

test('resolveItem maps 404 to NOT_FOUND with status', async () => {
  await assert.rejects(resolveWith(404), (error) => {
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.status, 404);
    return true;
  });
});

test('resolveItem maps other non-2xx to SERVER_ERROR with status', async () => {
  await assert.rejects(resolveWith(500), (error) => {
    assert.equal(error.code, 'SERVER_ERROR');
    assert.equal(error.status, 500);
    return true;
  });
});

test('resolveItem maps a rejected fetch to NETWORK_ERROR without status', async () => {
  await withFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      await assert.rejects(
        resolveItem('ITEM', null, ENDPOINT, 'token'),
        (error) => {
          assert.equal(error.code, 'NETWORK_ERROR');
          assert.equal(error.status, undefined);
          return true;
        }
      );
    }
  );
});
