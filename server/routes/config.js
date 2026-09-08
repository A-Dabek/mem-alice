import express from 'express';
import crypto from 'node:crypto';
import { logger } from '../logger.js';

const SALT_KEY = 'pbkdf2_salt';
const VERIFIER_CT_KEY = 'verifier_ct';
const VERIFIER_IV_KEY = 'verifier_iv';

/**
 * Builds the /api/salt router (also hosts /api/verifier for password guard).
 *
 * The salt is non-secret and only used as PBKDF2 input on the client to
 * derive the AES key from the passphrase. It is generated once and then
 * persisted so that the same key can always be re-derived.
 *
 * The verifier is an opaque ciphertext pair (verifier_ct + verifier_iv) of a
 * known sentinel encrypted with the derived key. First successful unlock
 * creates it; subsequent unlocks must decrypt it. This allows password
 * validation even when no milestones exist, and blocks wrong passwords from
 * entering the Timeline (avoids "Could not decrypt" leak). No passwords or
 * hashes are stored - only ciphertext.
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

  router.get('/verifier', (req, res) => {
    const ct = getStmt.get(VERIFIER_CT_KEY);
    const iv = getStmt.get(VERIFIER_IV_KEY);

    if (ct && iv) {
      res.json({ verifier_ct: ct.value, verifier_iv: iv.value });
      return;
    }

    res.status(404).json({ error: 'verifier not set' });
  });

  router.post('/verifier', (req, res) => {
    const { verifier_ct, verifier_iv } = req.body || {};

    if (typeof verifier_ct !== 'string' || verifier_ct.length === 0) {
      logger.warn('error while creating verifier', { reason: 'missing verifier_ct' });
      res.status(400).json({ error: 'Field "verifier_ct" is required and must be a non-empty string' });
      return;
    }

    if (typeof verifier_iv !== 'string' || verifier_iv.length === 0) {
      logger.warn('error while creating verifier', { reason: 'missing verifier_iv' });
      res.status(400).json({ error: 'Field "verifier_iv" is required and must be a non-empty string' });
      return;
    }

    const existingCt = getStmt.get(VERIFIER_CT_KEY);
    const existingIv = getStmt.get(VERIFIER_IV_KEY);

    if (existingCt && existingIv) {
      logger.warn('error while creating verifier', { reason: 'already set' });
      res.status(409).json({ error: 'verifier already set' });
      return;
    }

    // Use INSERT OR IGNORE to handle race between concurrent first unlocks
    const ctResult = insertStmt.run(VERIFIER_CT_KEY, verifier_ct);
    const ivResult = insertStmt.run(VERIFIER_IV_KEY, verifier_iv);

    // If another request won the race between our check and insert, treat as conflict
    if (ctResult.changes === 0 || ivResult.changes === 0) {
      logger.warn('error while creating verifier', { reason: 'already set' });
      res.status(409).json({ error: 'verifier already set' });
      return;
    }

    logger.info('verifier created');
    res.status(201).json({ ok: true });
  });

  return router;
}
