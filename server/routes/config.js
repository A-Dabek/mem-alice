import express from 'express';
import crypto from 'node:crypto';

const SALT_KEY = 'pbkdf2_salt';

/**
 * Builds the /api/salt router.
 *
 * The salt is non-secret and only used as PBKDF2 input on the client to
 * derive the AES key from the passphrase. It is generated once and then
 * persisted so that the same key can always be re-derived.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createConfigRouter(db) {
  const router = express.Router();

  const getStmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const insertStmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');

  router.get('/salt', (req, res) => {
    const existing = getStmt.get(SALT_KEY);

    if (existing) {
      res.json({ salt: existing.value });
      return;
    }

    const salt = crypto.randomBytes(16).toString('base64');
    insertStmt.run(SALT_KEY, salt);
    res.json({ salt: getStmt.get(SALT_KEY).value });
  });

  return router;
}
