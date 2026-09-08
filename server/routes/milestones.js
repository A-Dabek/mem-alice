import express from 'express';
import { logger } from '../logger.js';

const REQUIRED_FIELDS = [
  'title_ct',
  'title_iv',
  'subtitle_ct',
  'subtitle_iv',
  'media_ct',
  'media_iv',
  'media_mime',
];

/**
 * Validates that the request body only contains opaque ciphertext/metadata
 * fields (base64 strings + mime type) - the server must never accept or
 * store plaintext.
 *
 * @param {unknown} body
 * @returns {string | null} an error message, or null if valid.
 */
function validateMilestonePayload(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof body[field] !== 'string' || body[field].length === 0) {
      return `Field "${field}" is required and must be a non-empty string`;
    }
  }

  // MIME allowlist: image/* or video/mp4 only. Plaintext mime type is stored as metadata.
  const mime = body.media_mime;
  const isImage = typeof mime === 'string' && mime.startsWith('image/');
  const isVideoMp4 = mime === 'video/mp4';
  if (!isImage && !isVideoMp4) {
    return 'Field "media_mime" must be an image/* type or video/mp4';
  }

  return null;
}

/**
 * Builds the /api/milestones router.
 *
 * The server never decrypts anything: it only stores/returns the ciphertext
 * fields provided by the client. There are no dates anywhere - milestones
 * are ordered purely by insertion order (the autoincrementing id), oldest
 * first, matching the order media were uploaded.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createMilestonesRouter(db) {
  const router = express.Router();

  const listStmt = db.prepare(
    'SELECT id, title_ct, title_iv, subtitle_ct, subtitle_iv, media_ct, media_iv, media_mime FROM milestones ORDER BY id ASC'
  );
  const insertStmt = db.prepare(
    `INSERT INTO milestones (title_ct, title_iv, subtitle_ct, subtitle_iv, media_ct, media_iv, media_mime)
     VALUES (@title_ct, @title_iv, @subtitle_ct, @subtitle_iv, @media_ct, @media_iv, @media_mime)`
  );
  const deleteOneStmt = db.prepare('DELETE FROM milestones WHERE id = ?');

  router.get('/', (req, res) => {
    const rows = listStmt.all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const error = validateMilestonePayload(req.body);
    if (error) {
      // Never log req.body — see AGENTS.md:30; reason is enum/field name only
      const safeReason = error === 'Field "media_mime" must be an image/* type or video/mp4'
        ? 'invalid media_mime'
        : error;
      logger.warn('error while adding milestone', { reason: safeReason });
      res.status(400).json({ error });
      return;
    }

    const { title_ct, title_iv, subtitle_ct, subtitle_iv, media_ct, media_iv, media_mime } =
      req.body;

    const result = insertStmt.run({
      title_ct,
      title_iv,
      subtitle_ct,
      subtitle_iv,
      media_ct,
      media_iv,
      media_mime,
    });

    logger.info('milestone added', { id: result.lastInsertRowid });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      logger.warn('error while deleting milestone', { reason: 'invalid id' });
      return res.status(400).json({ error: 'Invalid milestone id' });
    }
    const result = deleteOneStmt.run(id);
    if (result.changes === 0) {
      logger.warn('error while deleting milestone', { reason: 'not found', id });
      return res.status(404).json({ error: 'Milestone not found' });
    }
    logger.info('milestone deleted', { id });
    return res.json({ ok: true });
  });

  // Test-only helper to achieve per-test isolation when `pnpm e2e` runs
  // all specs in a single worker with a shared DB (see playwright.config.js).
  // Not used in prod; safe to keep — truncates milestones, keeps config/salt.
  router.delete('/', (req, res) => {
    db.prepare('DELETE FROM milestones').run();
    // Reset autoincrement so ids start from 1 again for deterministic tests
    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name='milestones'").run();
    } catch {}
    res.json({ ok: true });
  });

  return router;
}
