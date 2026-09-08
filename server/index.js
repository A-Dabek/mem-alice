import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { createConfigRouter } from './routes/config.js';
import { createMilestonesRouter } from './routes/milestones.js';
import { logger } from './logger.js';

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

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      logger.warn('error while adding milestone', {
        method: req.method,
        path: req.path,
        reason: 'payload too large',
        limit: '150mb',
      });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      return res.status(413).json({ error: 'Payload too large' });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      logger.warn('error while parsing request', {
        method: req.method,
        path: req.path,
        reason: 'invalid json',
      });
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    next(err);
  });

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
  });

  app.use(
    express.static(path.join(__dirname, '..', 'public'), {
      etag: false,
      lastModified: false,
      cacheControl: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
      },
    }),
  );

  app.use('/api', createConfigRouter(db));
  app.use('/api/milestones', createMilestonesRouter(db));

  app.use((req, res) => {
    logger.warn('unknown route', { method: req.method, path: req.path });
    res.status(404).json({ error: 'Not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error('internal server error', {
      method: req.method,
      path: req.path,
      reason: err.message,
    });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const db = openDb(process.env.DB_PATH || undefined);
  const app = createApp(db);
  const port = process.env.PORT || 3000;

  app.listen(port, () => {
    logger.info('server listening', { port });
  });
}
