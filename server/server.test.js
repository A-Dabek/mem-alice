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
      subtitle_ct: 'ZmFrZS1zdWJ0aXRsZS1jaXBoZXJ0ZXh0',
      subtitle_iv: 'ZmFrZS1zdWJ0aXRsZS1pdg==',
      media_ct: 'ZmFrZS1waG90by1jaXBoZXJ0ZXh0',
      media_iv: 'ZmFrZS1waG90by1pdg==',
      media_mime: 'image/jpeg',
    };

    const postResponse = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(postResponse.status, 201);
    const postBody = await postResponse.json();
    assert.equal(typeof postBody.id, 'number');

    const getResponse = await fetch(`${baseUrl}/api/milestones`);
    assert.equal(getResponse.status, 200);
    const rows = await getResponse.json();

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, postBody.id);
    assert.equal(rows[0].title_ct, payload.title_ct);
    assert.equal(rows[0].title_iv, payload.title_iv);
    assert.equal(rows[0].subtitle_ct, payload.subtitle_ct);
    assert.equal(rows[0].subtitle_iv, payload.subtitle_iv);
    assert.equal(rows[0].media_ct, payload.media_ct);
    assert.equal(rows[0].media_iv, payload.media_iv);
    assert.equal(rows[0].media_mime, payload.media_mime);
  } finally {
    await close();
  }
});

test('GET /api/milestones returns entries ordered oldest first (by upload/insertion order)', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const makePayload = (label) => ({
      title_ct: `title-ct-${label}`,
      title_iv: `title-iv-${label}`,
      subtitle_ct: `subtitle-ct-${label}`,
      subtitle_iv: `subtitle-iv-${label}`,
      media_ct: `media-ct-${label}`,
      media_iv: `media-iv-${label}`,
      media_mime: 'image/jpeg',
    });

    for (const label of ['first', 'second', 'third']) {
      const response = await fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makePayload(label)),
      });
      assert.equal(response.status, 201);
    }

    const getResponse = await fetch(`${baseUrl}/api/milestones`);
    const rows = await getResponse.json();

    assert.equal(rows.length, 3);
    assert.equal(rows[0].title_ct, 'title-ct-first');
    assert.equal(rows[1].title_ct, 'title-ct-second');
    assert.equal(rows[2].title_ct, 'title-ct-third');
    assert.ok(rows[0].id < rows[1].id);
    assert.ok(rows[1].id < rows[2].id);
    assert.equal(rows[0].created_at, undefined);
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

test('POST /api/milestones with media_mime video/mp4 round-trips', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = {
      title_ct: 'tct',
      title_iv: 'tiv',
      subtitle_ct: 'sct',
      subtitle_iv: 'siv',
      media_ct: 'mct',
      media_iv: 'miv',
      media_mime: 'video/mp4',
    };
    const postResponse = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(postResponse.status, 201);
    const getResponse = await fetch(`${baseUrl}/api/milestones`);
    const rows = await getResponse.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].media_mime, 'video/mp4');
    assert.equal(rows[0].media_ct, payload.media_ct);
  } finally {
    await close();
  }
});

test('POST /api/milestones rejects disallowed mime types like video/webm', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = {
      title_ct: 'tct',
      title_iv: 'tiv',
      subtitle_ct: 'sct',
      subtitle_iv: 'siv',
      media_ct: 'mct',
      media_iv: 'miv',
      media_mime: 'video/webm',
    };
    const response = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');
    assert.match(body.error, /media_mime/);
  } finally {
    await close();
  }
});

test('POST /api/milestones rejects application/octet-stream mime', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = {
      title_ct: 'tct',
      title_iv: 'tiv',
      subtitle_ct: 'sct',
      subtitle_iv: 'siv',
      media_ct: 'mct',
      media_iv: 'miv',
      media_mime: 'application/octet-stream',
    };
    const response = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 400);
  } finally {
    await close();
  }
});

test('DELETE /api/milestones/:id deletes single milestone and preserves order', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const first = {
      title_ct: 'tct-first',
      title_iv: 'tiv-first',
      subtitle_ct: 'sct-first',
      subtitle_iv: 'siv-first',
      media_ct: 'mct-first',
      media_iv: 'miv-first',
      media_mime: 'image/jpeg',
    };
    const second = {
      title_ct: 'tct-second',
      title_iv: 'tiv-second',
      subtitle_ct: 'sct-second',
      subtitle_iv: 'siv-second',
      media_ct: 'mct-second',
      media_iv: 'miv-second',
      media_mime: 'video/mp4',
    };

    const r1 = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(first),
    });
    assert.equal(r1.status, 201);
    const { id: id1 } = await r1.json();

    const r2 = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(second),
    });
    assert.equal(r2.status, 201);
    const { id: id2 } = await r2.json();

    let get = await fetch(`${baseUrl}/api/milestones`);
    let rows = await get.json();
    assert.equal(rows.length, 2);

    const del = await fetch(`${baseUrl}/api/milestones/${id1}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    const delBody = await del.json();
    assert.equal(delBody.ok, true);

    get = await fetch(`${baseUrl}/api/milestones`);
    rows = await get.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id2);
    assert.equal(rows[0].title_ct, second.title_ct);
  } finally {
    await close();
  }
});

test('DELETE /api/milestones/:id returns 404 for missing id', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const res = await fetch(`${baseUrl}/api/milestones/9999`, { method: 'DELETE' });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
  } finally {
    await close();
  }
});

test('DELETE /api/milestones/:id returns 400 for non-numeric id', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const res = await fetch(`${baseUrl}/api/milestones/${bad}`, { method: 'DELETE' });
      assert.equal(res.status, 400, `expected 400 for id=${bad}`);
    }
  } finally {
    await close();
  }
});

test('DELETE /api/milestones/:id is idempotent — second delete 404', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = {
      title_ct: 'tct',
      title_iv: 'tiv',
      subtitle_ct: 'sct',
      subtitle_iv: 'siv',
      media_ct: 'mct',
      media_iv: 'miv',
      media_mime: 'image/jpeg',
    };
    const post = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(post.status, 201);
    const { id } = await post.json();

    const first = await fetch(`${baseUrl}/api/milestones/${id}`, { method: 'DELETE' });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/milestones/${id}`, { method: 'DELETE' });
    assert.equal(second.status, 404);
  } finally {
    await close();
  }
});

test('DELETE /api/milestones bulk still truncates and resets sqlite_sequence', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = {
      title_ct: 'tct',
      title_iv: 'tiv',
      subtitle_ct: 'sct',
      subtitle_iv: 'siv',
      media_ct: 'mct',
      media_iv: 'miv',
      media_mime: 'image/jpeg',
    };
    const post = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(post.status, 201);

    const delBulk = await fetch(`${baseUrl}/api/milestones`, { method: 'DELETE' });
    assert.equal(delBulk.status, 200);

    let get = await fetch(`${baseUrl}/api/milestones`);
    let rows = await get.json();
    assert.equal(rows.length, 0);

    const post2 = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(post2.status, 201);
    const { id } = await post2.json();
    assert.equal(id, 1);
  } finally {
    await close();
  }
});
