import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  readCachedResolution,
  writeCachedResolution,
  resolveItemCached,
  clearResolutionCache,
  RESOLUTION_TTL_MS,
} from './onedriveCache.js';

const ENDPOINT = 'https://my.microsoftpersonalcontent.com/_api/v2.0';

function createStorage() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

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

function itemBody(downloadUrl) {
  return {
    id: 'ITEM',
    name: 'photo.jpg',
    file: { mimeType: 'image/jpeg' },
    '@content.downloadUrl': downloadUrl,
    parentReference: { driveId: 'DRIVE' },
  };
}

beforeEach(() => {
  globalThis.sessionStorage = createStorage();
});

afterEach(() => {
  delete globalThis.sessionStorage;
});

test('read returns what write stored', () => {
  writeCachedResolution('acct', 'ITEM', { downloadUrl: 'u' });
  assert.deepEqual(readCachedResolution('acct', 'ITEM'), { downloadUrl: 'u' });
});

test('read misses for unknown account or item', () => {
  writeCachedResolution('acct', 'ITEM', { downloadUrl: 'u' });
  assert.equal(readCachedResolution('other', 'ITEM'), null);
  assert.equal(readCachedResolution('acct', 'OTHER'), null);
  assert.equal(readCachedResolution('', 'ITEM'), null);
});

test('read drops and returns null for an expired entry', () => {
  const now = Date.now();
  writeCachedResolution('acct', 'ITEM', { downloadUrl: 'u' }, now - RESOLUTION_TTL_MS - 1);
  assert.equal(readCachedResolution('acct', 'ITEM', now), null);
  assert.equal(globalThis.sessionStorage.getItem('odResolve:acct:ITEM'), null);
});

test('read returns null for corrupt JSON', () => {
  globalThis.sessionStorage.setItem('odResolve:acct:ITEM', 'not json');
  assert.equal(readCachedResolution('acct', 'ITEM'), null);
});

test('clearResolutionCache removes only cached resolutions', () => {
  writeCachedResolution('acct', 'A', { n: 1 });
  writeCachedResolution('acct', 'B', { n: 2 });
  globalThis.sessionStorage.setItem('msal.something', 'keep');
  clearResolutionCache();
  assert.equal(readCachedResolution('acct', 'A'), null);
  assert.equal(readCachedResolution('acct', 'B'), null);
  assert.equal(globalThis.sessionStorage.getItem('msal.something'), 'keep');
});

test('resolveItemCached resolves on miss and hits the cache afterwards', async () => {
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return jsonResponse(200, itemBody('https://download.example/one'));
    },
    async () => {
      const first = await resolveItemCached('acct', 'ITEM', 'DRIVE', ENDPOINT, 'token');
      const second = await resolveItemCached('acct', 'ITEM', 'DRIVE', ENDPOINT, 'token');
      assert.equal(calls, 1);
      assert.equal(first.downloadUrl, 'https://download.example/one');
      assert.deepEqual(second, first);
    }
  );
});

test('resolveItemCached refetches and replaces an expired entry', async () => {
  writeCachedResolution(
    'acct',
    'ITEM',
    { downloadUrl: 'https://stale.example' },
    Date.now() - RESOLUTION_TTL_MS - 1
  );

  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return jsonResponse(200, itemBody('https://download.example/fresh'));
    },
    async () => {
      const result = await resolveItemCached('acct', 'ITEM', 'DRIVE', ENDPOINT, 'token');
      assert.equal(calls, 1);
      assert.equal(result.downloadUrl, 'https://download.example/fresh');
      assert.equal(
        readCachedResolution('acct', 'ITEM').downloadUrl,
        'https://download.example/fresh'
      );
    }
  );
});

test('resolveItemCached does not cache failures', async () => {
  await withFetch(
    async () => jsonResponse(404, {}),
    async () => {
      await assert.rejects(
        resolveItemCached('acct', 'ITEM', 'DRIVE', ENDPOINT, 'token'),
        { code: 'NOT_FOUND' }
      );
      assert.equal(readCachedResolution('acct', 'ITEM'), null);
    }
  );
});

test('cache is unavailable without sessionStorage (no throw)', async () => {
  delete globalThis.sessionStorage;
  assert.equal(readCachedResolution('acct', 'ITEM'), null);
  writeCachedResolution('acct', 'ITEM', { downloadUrl: 'u' });
  clearResolutionCache();

  await withFetch(
    async () => jsonResponse(200, itemBody('https://download.example/one')),
    async () => {
      const result = await resolveItemCached('acct', 'ITEM', 'DRIVE', ENDPOINT, 'token');
      assert.equal(result.downloadUrl, 'https://download.example/one');
    }
  );
});
