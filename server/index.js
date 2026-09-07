import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { createConfigRouter } from './routes/config.js';
import { createMilestonesRouter } from './routes/milestones.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the Express app. The server never decrypts anything and never
 * logs request bodies, so plaintext titles/photos are never persisted or
 * printed - only ciphertext + non-secret metadata flow through here.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Express}
 */
export function createApp(db) {
  const app = express();

  // Raised limit to accommodate base64-encoded media payloads (100MB binary ~133MB base64).
  app.use(express.json({ limit: '150mb' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api', createConfigRouter(db));
  app.use('/api/milestones', createMilestonesRouter(db));

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const db = openDb(process.env.DB_PATH || undefined);
  const app = createApp(db);
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    console.log(`Milestones server listening on port ${port}`);
  });
}
