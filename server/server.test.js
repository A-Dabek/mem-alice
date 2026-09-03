import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from './db.js';
import { createApp } from './index.js';

/**
 * Starts the app on an ephemeral port backed by an in-memory database.
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
function startTestServer() {
  const db = openDb(':memory:');
  const app = createApp(db);

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => {
            server.close(() => {
              db.close();
              res();
            });
          }),
      });
    });
  });
}

test('GET /api/salt generates a salt on first call and persists it', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const first = await fetch(`${baseUrl}/api/salt`);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(typeof firstBody.salt, 'string');
    assert.ok(firstBody.salt.length > 0);

    const second = await fetch(`${baseUrl}/api/salt`);
    const secondBody = await second.json();

    assert.equal(secondBody.salt, firstBody.salt);
  } finally {
    await close();
  }
});

test('POST /api/milestones then GET /api/milestones round-trips fake ciphertext', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = {
      title_ct: 'ZmFrZS1jaXBoZXJ0ZXh0',
      title_iv: 'ZmFrZS1pdg==',
      photo_ct: 'ZmFrZS1waG90by1jaXBoZXJ0ZXh0',
      photo_iv: 'ZmFrZS1waG90by1pdg==',
      photo_mime: 'image/jpeg',
    };

    const postResponse = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(postResponse.status, 201);
    const postBody = await postResponse.json();
    assert.equal(typeof postBody.id, 'number');
    assert.equal(typeof postBody.created_at, 'string');

    const getResponse = await fetch(`${baseUrl}/api/milestones`);
    assert.equal(getResponse.status, 200);
    const rows = await getResponse.json();

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, postBody.id);
    assert.equal(rows[0].created_at, postBody.created_at);
    assert.equal(rows[0].title_ct, payload.title_ct);
    assert.equal(rows[0].title_iv, payload.title_iv);
    assert.equal(rows[0].photo_ct, payload.photo_ct);
    assert.equal(rows[0].photo_iv, payload.photo_iv);
    assert.equal(rows[0].photo_mime, payload.photo_mime);
  } finally {
    await close();
  }
});

test('POST /api/milestones rejects payloads missing required ciphertext fields', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'plaintext should never be accepted' }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');

    const getResponse = await fetch(`${baseUrl}/api/milestones`);
    const rows = await getResponse.json();
    assert.equal(rows.length, 0);
  } finally {
    await close();
  }
});
