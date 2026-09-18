import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { createMilestonesRouter } from './routes/milestones.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the Express app. The server only stores picker references and
 * plaintext title/subtitle for the PoC - media lives in OneDrive and never
 * flows through here. Request bodies are never logged.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Express}
 */
export function createApp(db) {
  const app = express();

  app.use(express.json());

  app.use((err, req, res, next) => {
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

  app.get('/api/config', (req, res) => {
    res.json({
      clientId: process.env.MS_CLIENT_ID ?? null,
      authority:
        process.env.MS_AUTHORITY || 'https://login.microsoftonline.com/consumers',
    });
  });

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

  if (!process.env.MS_CLIENT_ID) {
    logger.warn('MS_CLIENT_ID is not set - sign-in is disabled', {
      hint: 'start with MS_CLIENT_ID=<azure-app-id> pnpm start',
    });
  }

  app.listen(port, () => {
    logger.info('server listening', { port });
  });
}
