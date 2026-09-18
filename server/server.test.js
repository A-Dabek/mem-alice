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
  const app = createApp(db, { auth: (req, res, next) => next() });

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

function makePayload(label) {
  return {
    title: `title-${label}`,
    subtitle: `subtitle-${label}`,
    drive_item_id: `item-${label}`,
    drive_id: `drive-${label}`,
    drive_endpoint: 'https://api.onedrive.com/v1.0',
    media_mime: 'image/jpeg',
    media_width: 1200,
    media_height: 800,
    item_name: `${label}.jpg`,
  };
}

test('GET /api/config returns clientId and consumer authority', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.clientId === null || typeof body.clientId === 'string');
    assert.equal(body.authority, 'https://login.microsoftonline.com/consumers');
  } finally {
    await close();
  }
});

test('POST /api/milestones then GET /api/milestones round-trips a Graph reference', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const payload = makePayload('first');
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
    assert.equal(rows[0].title, payload.title);
    assert.equal(rows[0].subtitle, payload.subtitle);
    assert.equal(rows[0].drive_item_id, payload.drive_item_id);
    assert.equal(rows[0].drive_id, payload.drive_id);
    assert.equal(rows[0].drive_endpoint, payload.drive_endpoint);
    assert.equal(rows[0].media_mime, payload.media_mime);
    assert.equal(rows[0].media_width, payload.media_width);
    assert.equal(rows[0].media_height, payload.media_height);
    assert.equal(rows[0].item_name, payload.item_name);
    assert.equal(rows[0].created_at, undefined);
  } finally {
    await close();
  }
});

test('POST defaults subtitle to empty string and optional refs to null', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Only title',
        drive_item_id: 'item-1',
        media_mime: 'video/mp4',
      }),
    });
    assert.equal(response.status, 201);

    const rows = await (await fetch(`${baseUrl}/api/milestones`)).json();
    assert.equal(rows[0].subtitle, '');
    assert.equal(rows[0].drive_id, null);
    assert.equal(rows[0].drive_endpoint, null);
    assert.equal(rows[0].media_width, null);
    assert.equal(rows[0].media_height, null);
    assert.equal(rows[0].item_name, null);
  } finally {
    await close();
  }
});

test('GET /api/milestones returns entries ordered oldest first', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    for (const label of ['first', 'second', 'third']) {
      const response = await fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makePayload(label)),
      });
      assert.equal(response.status, 201);
    }

    const rows = await (await fetch(`${baseUrl}/api/milestones`)).json();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].title, 'title-first');
    assert.equal(rows[1].title, 'title-second');
    assert.equal(rows[2].title, 'title-third');
    assert.ok(rows[0].id < rows[1].id);
    assert.ok(rows[1].id < rows[2].id);
  } finally {
    await close();
  }
});

test('POST /api/milestones rejects a payload missing required fields', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const response = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'missing refs' }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(typeof body.error, 'string');

    const rows = await (await fetch(`${baseUrl}/api/milestones`)).json();
    assert.equal(rows.length, 0);
  } finally {
    await close();
  }
});

test('DELETE /api/milestones/:id deletes a single milestone', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const create = (label) =>
      fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makePayload(label)),
      });

    const { id: id1 } = await (await create('first')).json();
    const { id: id2 } = await (await create('second')).json();

    const del = await fetch(`${baseUrl}/api/milestones/${id1}`, { method: 'DELETE' });
    assert.equal(del.status, 200);
    assert.equal((await del.json()).ok, true);

    const rows = await (await fetch(`${baseUrl}/api/milestones`)).json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id2);
    assert.equal(rows[0].title, 'title-second');
  } finally {
    await close();
  }
});

test('DELETE /api/milestones/:id returns 400 for bad id and 404 for missing', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const res = await fetch(`${baseUrl}/api/milestones/${bad}`, { method: 'DELETE' });
      assert.equal(res.status, 400, `expected 400 for id=${bad}`);
    }

    const missing = await fetch(`${baseUrl}/api/milestones/9999`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});

test('DELETE /api/milestones bulk truncates and resets ids', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload('first')),
    });

    const delBulk = await fetch(`${baseUrl}/api/milestones`, { method: 'DELETE' });
    assert.equal(delBulk.status, 200);

    const rows = await (await fetch(`${baseUrl}/api/milestones`)).json();
    assert.equal(rows.length, 0);

    const post2 = await fetch(`${baseUrl}/api/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload('again')),
    });
    assert.equal(post2.status, 201);
    assert.equal((await post2.json()).id, 1);
  } finally {
    await close();
  }
});

test('POST /api/milestones enforces the MIME allowlist', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const post = (payload) =>
      fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4']) {
      const res = await post({ ...makePayload(mime), media_mime: mime });
      assert.equal(res.status, 201, `expected 201 for ${mime}`);
    }

    for (const mime of ['image/svg+xml', 'application/pdf', 'text/html', 'video/webm']) {
      const res = await post({ ...makePayload(mime), media_mime: mime });
      assert.equal(res.status, 400, `expected 400 for ${mime}`);
    }
  } finally {
    await close();
  }
});

test('POST /api/milestones enforces length caps', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const post = (payload) =>
      fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    assert.equal((await post({ ...makePayload('ok'), title: 'x'.repeat(200) })).status, 201);
    assert.equal((await post({ ...makePayload('long'), title: 'x'.repeat(201) })).status, 400);
    assert.equal((await post({ ...makePayload('sub'), subtitle: 'x'.repeat(501) })).status, 400);
    assert.equal(
      (await post({ ...makePayload('id'), drive_item_id: 'x'.repeat(513) })).status,
      400
    );
  } finally {
    await close();
  }
});

test('POST /api/milestones validates media dimensions', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const post = (fields) =>
      fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...makePayload('dim'), ...fields }),
      });

    assert.equal((await post({ media_width: 900, media_height: 1200 })).status, 201);
    assert.equal((await post({ media_width: null, media_height: null })).status, 201);

    for (const fields of [
      { media_width: 0 },
      { media_width: -10 },
      { media_width: 1.5 },
      { media_width: '900' },
      { media_height: 0 },
      { media_height: 'x' },
      { media_width: 100001 },
    ]) {
      assert.equal(
        (await post(fields)).status,
        400,
        `expected 400 for ${JSON.stringify(fields)}`
      );
    }
  } finally {
    await close();
  }
});

test('POST /api/milestones re-checks the drive_endpoint host', async () => {
  const { baseUrl, close } = await startTestServer();

  try {
    const post = (endpoint) =>
      fetch(`${baseUrl}/api/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...makePayload(endpoint), drive_endpoint: endpoint }),
      });

    for (const endpoint of [
      'https://api.onedrive.com/v1.0',
      'https://my.microsoftpersonalcontent.com/_api/v2.0',
      'https://tenant-my.sharepoint.com',
    ]) {
      assert.equal((await post(endpoint)).status, 201, `expected 201 for ${endpoint}`);
    }

    for (const endpoint of [
      'http://api.onedrive.com/v1.0',
      'https://evil.example/v1.0',
      'https://onedrive.com.evil.example/v1.0',
    ]) {
      assert.equal((await post(endpoint)).status, 400, `expected 400 for ${endpoint}`);
    }
  } finally {
    await close();
  }
});
