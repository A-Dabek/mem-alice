import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  apiIdTokenStorageKey,
  decodeExpiry,
  describeError,
  fetchWithAuth,
  forgetApiIdTokens,
  getIdToken,
  lastAuthDiagnostic,
  readStoredApiIdToken,
  rememberApiIdToken,
  selectApiIdToken,
} from './auth.js';

const HOUR_MS = 60 * 60 * 1000;

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

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function jwtWithExp(exp) {
  return `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(
    JSON.stringify({ exp })
  )}.sig`;
}

function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

beforeEach(() => {
  globalThis.sessionStorage = createStorage();
  lastAuthDiagnostic.stage = '';
  lastAuthDiagnostic.code = '';
  lastAuthDiagnostic.subError = '';
});

afterEach(() => {
  delete globalThis.sessionStorage;
});

test('decodeExpiry reads exp in ms and rejects opaque/malformed tokens', () => {
  const expSeconds = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(decodeExpiry(jwtWithExp(expSeconds)), expSeconds * 1000);
  assert.equal(decodeExpiry('e2e-id-token'), null);
  assert.equal(decodeExpiry('a.b.c'), null);
  assert.equal(decodeExpiry(''), null);
  assert.equal(decodeExpiry(undefined), null);
});

test('apiIdTokenStorageKey prefers homeAccountId, then username, else empty', () => {
  assert.equal(apiIdTokenStorageKey({ homeAccountId: 'home-1' }), 'mem-alice.idtoken.home-1');
  assert.equal(apiIdTokenStorageKey({ username: 'a@x.com' }), 'mem-alice.idtoken.a@x.com');
  assert.equal(
    apiIdTokenStorageKey({ homeAccountId: 'home-1', username: 'a@x.com' }),
    'mem-alice.idtoken.home-1'
  );
  assert.equal(apiIdTokenStorageKey(null), '');
  assert.equal(apiIdTokenStorageKey({}), '');
});

test('remember then read round-trips a token and its decoded expiry', () => {
  const expSeconds = Math.floor(Date.now() / 1000) + 3600;
  const account = { homeAccountId: 'home-1' };
  rememberApiIdToken(account, jwtWithExp(expSeconds));

  const stored = readStoredApiIdToken(account);
  assert.equal(stored.token, jwtWithExp(expSeconds));
  assert.equal(stored.expiresOn, expSeconds * 1000);
});

test('remember falls back to a TTL for an opaque token', () => {
  const now = Date.now();
  rememberApiIdToken({ homeAccountId: 'home-1' }, 'opaque-token', now);
  const stored = readStoredApiIdToken({ homeAccountId: 'home-1' });
  assert.equal(stored.token, 'opaque-token');
  assert.ok(stored.expiresOn > now);
});

test('selectApiIdToken: silent hit wins and is considered cached', () => {
  assert.equal(
    selectApiIdToken({
      silentIdToken: 'silent',
      persistedToken: { token: 'persisted', expiresOn: Date.now() + HOUR_MS },
    }),
    'silent'
  );
});

test('selectApiIdToken: empty silent falls back to an unexpired persisted token', () => {
  assert.equal(
    selectApiIdToken({
      silentIdToken: null,
      persistedToken: { token: 'persisted', expiresOn: Date.now() + HOUR_MS },
    }),
    'persisted'
  );
});

test('selectApiIdToken: expired persisted token yields no token (AUTH_REQUIRED path)', () => {
  const token = selectApiIdToken({
    silentIdToken: null,
    persistedToken: { token: 'persisted', expiresOn: Date.now() - 1 },
  });
  assert.equal(token, null);

  // An entry inside the 60s margin is also rejected.
  assert.equal(
    selectApiIdToken({
      silentIdToken: null,
      persistedToken: { token: 'persisted', expiresOn: Date.now() + 30 * 1000 },
    }),
    null
  );
});

test('selectApiIdToken: no silent and no persisted yields null', () => {
  assert.equal(selectApiIdToken({}), null);
  assert.equal(selectApiIdToken({ persistedToken: { token: '', expiresOn: 0 } }), null);
});

test('getIdToken returns a silent id token and caches it', async () => {
  const account = { homeAccountId: 'home-1' };
  const expSeconds = Math.floor(Date.now() / 1000) + 3600;
  const silent = jwtWithExp(expSeconds);
  const app = {
    getActiveAccount: () => account,
    getAllAccounts: () => [account],
    acquireTokenSilent: async () => ({ account, idToken: silent, accessToken: 'a' }),
  };

  assert.equal(await getIdToken({ getApp: async () => app }), silent);
  assert.equal(readStoredApiIdToken(account).token, silent);
  assert.equal(lastAuthDiagnostic.code, 'silent');
});

test('getIdToken falls back to an unexpired persisted token', async () => {
  const account = { homeAccountId: 'home-1' };
  const persisted = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
  rememberApiIdToken(account, persisted);
  const app = {
    getActiveAccount: () => account,
    getAllAccounts: () => [account],
    acquireTokenSilent: async () => ({ account, idToken: null, accessToken: 'a' }),
  };

  assert.equal(await getIdToken({ getApp: async () => app }), persisted);
  assert.equal(lastAuthDiagnostic.code, 'persisted');
});

test('getIdToken throws AUTH_REQUIRED when silent is empty and persisted is expired', async () => {
  const account = { homeAccountId: 'home-1' };
  rememberApiIdToken(account, jwtWithExp(Math.floor(Date.now() / 1000) - 120));
  const app = {
    getActiveAccount: () => account,
    getAllAccounts: () => [account],
    acquireTokenSilent: async () => ({ account, idToken: null, accessToken: 'a' }),
  };

  await assert.rejects(getIdToken({ getApp: async () => app }), {
    code: 'AUTH_REQUIRED',
  });
});

test('forgetApiIdTokens removes only ID-token keys', () => {
  rememberApiIdToken({ homeAccountId: 'a' }, 'token-a');
  rememberApiIdToken({ homeAccountId: 'b' }, 'token-b');
  globalThis.sessionStorage.setItem('odResolve:a:ITEM', 'keep');
  globalThis.sessionStorage.setItem('msal.something', 'keep');

  forgetApiIdTokens();

  assert.equal(readStoredApiIdToken({ homeAccountId: 'a' }), null);
  assert.equal(readStoredApiIdToken({ homeAccountId: 'b' }), null);
  assert.equal(globalThis.sessionStorage.getItem('odResolve:a:ITEM'), 'keep');
  assert.equal(globalThis.sessionStorage.getItem('msal.something'), 'keep');
});

test('describeError normalizes MSAL and plain errors', () => {
  const msal = Object.assign(new Error('boom'), {
    name: 'InteractionRequiredAuthError',
    errorCode: 'interaction_required',
    subError: 'consent_required',
  });
  assert.deepEqual(describeError(msal), {
    errorCode: 'interaction_required',
    subError: 'consent_required',
    name: 'InteractionRequiredAuthError',
    message: 'boom',
  });
  assert.deepEqual(describeError({ code: 'AUTH_REQUIRED' }), {
    errorCode: 'AUTH_REQUIRED',
    subError: '',
    name: '',
    message: '',
  });
});

test('fetchWithAuth throws AUTH_REQUIRED and forwards X-Auth-Error/X-Auth-Stage', async () => {
  const calls = [];
  await withFetch(
    async (url, options) => {
      calls.push({ url, options });
      return { ok: false, status: 401 };
    },
    async () => {
      await assert.rejects(
        fetchWithAuth('/api/milestones', {}, {
          getIdToken: async () => {
            const error = new Error('no token');
            error.code = 'AUTH_REQUIRED';
            throw error;
          },
        }),
        { code: 'AUTH_REQUIRED' }
      );
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.get('X-Auth-Error'), 'AUTH_REQUIRED');
  assert.equal(calls[0].options.headers.get('X-Auth-Stage'), 'getIdToken');
  assert.equal(calls[0].options.headers.get('Authorization'), null);
});

test('fetchWithAuth assumes the token provider stage when one is recorded', async () => {
  const calls = [];
  await withFetch(
    async (url, options) => {
      calls.push({ url, options });
      return { ok: false, status: 401 };
    },
    async () => {
      await assert.rejects(
        fetchWithAuth('/api/milestones', {}, {
          getIdToken: async () => {
            lastAuthDiagnostic.stage = 'getIdToken';
            lastAuthDiagnostic.code = 'interaction_required';
            lastAuthDiagnostic.subError = 'consent_required';
            const error = new Error('no token');
            error.code = 'AUTH_REQUIRED';
            throw error;
          },
        }),
        { code: 'AUTH_REQUIRED' }
      );
    }
  );

  assert.equal(calls[0].options.headers.get('X-Auth-Error'), 'interaction_required');
  assert.equal(calls[0].options.headers.get('X-Auth-Stage'), 'getIdToken');
});

test('fetchWithAuth attaches the bearer token when one is available', async () => {
  const calls = [];
  await withFetch(
    async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
    () => fetchWithAuth('/api/milestones', { method: 'GET' }, { getIdToken: async () => 'tok' })
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.get('Authorization'), 'Bearer tok');
  assert.equal(calls[0].options.headers.get('X-Auth-Error'), null);
});
