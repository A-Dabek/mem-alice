import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
} from 'jose';

import { createAuthMiddleware, parseList } from './auth.js';
import { createApp } from './index.js';
import { openDb } from './db.js';

const ISSUER = 'https://login.example/tenant/v2.0';
const CLIENT_ID = 'client-123';
const ALLOWED_EMAIL = 'user@example.com';

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(
  privateKey,
  {
    issuer = ISSUER,
    audience = CLIENT_ID,
    email = ALLOWED_EMAIL,
    expiresIn = '5m',
  } = {}
) {
  return new SignJWT(email ? { email } : {})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

function buildAuth({ keys, ...overrides } = {}) {
  return createAuthMiddleware({
    clientId: CLIENT_ID,
    authority: 'https://authority.example',
    allowedEmails: [ALLOWED_EMAIL],
    allowedOrigins: [],
    authDisabled: false,
    nodeEnv: 'test',
    resolveDiscovery: async () => ({ issuer: ISSUER, jwks: keys.jwks }),
    ...overrides,
  });
}

function makeRequest({ method = 'GET', token, origin, host = 'localhost:3000' } = {}) {
  const headers = { host };
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  return {
    method,
    get: (name) => headers[name.toLowerCase()],
  };
}

function invoke(middleware, request) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        resolve({ next: false, status: this.statusCode, body });
        return this;
      },
    };
    middleware(request, res, () => resolve({ next: true, status: 200 }));
  });
}

test('parseList trims, lowercases and drops empties', () => {
  assert.deepEqual(parseList(' A@x.com, b@y.com ,, '), ['a@x.com', 'b@y.com']);
  assert.deepEqual(parseList(undefined), []);
});

test('auth rejects a missing bearer token with 401', async () => {
  const { jwks } = await makeKeys();
  const result = await invoke(buildAuth({ keys: { jwks } }), makeRequest());
  assert.equal(result.status, 401);
});

test('auth accepts a valid token and sets req.identity', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey);
  const request = makeRequest({ token });
  const result = await invoke(buildAuth({ keys }), request);
  assert.equal(result.next, true);
  assert.equal(request.identity, ALLOWED_EMAIL);
});

test('auth rejects a wrong audience with 401', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey, { audience: 'someone-else' });
  const result = await invoke(buildAuth({ keys }), makeRequest({ token }));
  assert.equal(result.status, 401);
});

test('auth rejects a wrong issuer with 401', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey, {
    issuer: 'https://evil.example/v2.0',
  });
  const result = await invoke(buildAuth({ keys }), makeRequest({ token }));
  assert.equal(result.status, 401);
});

test('auth rejects an expired token with 401', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey, { expiresIn: '-1m' });
  const result = await invoke(buildAuth({ keys }), makeRequest({ token }));
  assert.equal(result.status, 401);
});

test('auth rejects an account outside the allowlist with 403', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey, { email: 'intruder@example.com' });
  const result = await invoke(buildAuth({ keys }), makeRequest({ token }));
  assert.equal(result.status, 403);
});

test('auth denies when the allowlist is empty', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey);
  const result = await invoke(
    buildAuth({ keys, allowedEmails: [] }),
    makeRequest({ token })
  );
  assert.equal(result.status, 403);
});

test('auth requires a same-origin Origin on mutations', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey);

  const foreign = await invoke(
    buildAuth({ keys }),
    makeRequest({ method: 'POST', token, origin: 'https://evil.example' })
  );
  assert.equal(foreign.status, 403);

  const sameOrigin = await invoke(
    buildAuth({ keys }),
    makeRequest({ method: 'POST', token, origin: 'http://localhost:3000' })
  );
  assert.equal(sameOrigin.next, true);

  const allowlisted = await invoke(
    buildAuth({ keys, allowedOrigins: ['https://app.example'] }),
    makeRequest({ method: 'POST', token, origin: 'https://app.example' })
  );
  assert.equal(allowlisted.next, true);
});

test('auth does not require an Origin on reads', async () => {
  const keys = await makeKeys();
  const token = await sign(keys.privateKey);
  const result = await invoke(buildAuth({ keys }), makeRequest({ token }));
  assert.equal(result.next, true);
});

test('AUTH_DISABLED=1 bypasses auth outside production', async () => {
  const { jwks } = await makeKeys();
  const result = await invoke(
    buildAuth({ keys: { jwks }, authDisabled: true, nodeEnv: 'development' }),
    makeRequest()
  );
  assert.equal(result.next, true);
});

test('AUTH_DISABLED=1 is ignored in production', async () => {
  const { jwks } = await makeKeys();
  const result = await invoke(
    buildAuth({ keys: { jwks }, authDisabled: true, nodeEnv: 'production' }),
    makeRequest()
  );
  assert.equal(result.status, 401);
});

test('auth mounts on /api/milestones: 200 allowed, 401 missing, 403 disallowed', async () => {
  const keys = await makeKeys();
  const db = openDb(':memory:');
  const app = createApp(db, { auth: buildAuth({ keys }) });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const allowed = await fetch(`${baseUrl}/api/milestones`, {
      headers: { Authorization: `Bearer ${await sign(keys.privateKey)}` },
    });
    assert.equal(allowed.status, 200);

    const missing = await fetch(`${baseUrl}/api/milestones`);
    assert.equal(missing.status, 401);

    const disallowed = await fetch(`${baseUrl}/api/milestones`, {
      headers: {
        Authorization: `Bearer ${await sign(keys.privateKey, {
          email: 'intruder@example.com',
        })}`,
      },
    });
    assert.equal(disallowed.status, 403);

    const config = await fetch(`${baseUrl}/api/config`);
    assert.equal(config.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
