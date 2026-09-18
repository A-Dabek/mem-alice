import express from 'express';
import { logger } from '../logger.js';

const REQUIRED_FIELDS = ['title', 'drive_item_id', 'media_mime'];

const LIST_COLUMNS =
  'id, title, subtitle, drive_item_id, drive_id, media_mime, item_name';

/**
 * Validates the milestone payload. No auth or MIME allowlist yet (PoC) - just
 * enough to guarantee the columns the UI relies on are present and typed.
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

  for (const field of ['subtitle', 'drive_id', 'item_name']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      return `Field "${field}" must be a string`;
    }
  }

  return null;
}

/**
 * Builds the /api/milestones router.
 *
 * The server never talks to Graph and never sees media: it only stores the
 * references returned by the picker plus the plaintext title/subtitle. There
 * are no dates anywhere - milestones are ordered purely by insertion order
 * (autoincrementing id), oldest first.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createMilestonesRouter(db) {
  const router = express.Router();

  const listStmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM milestones ORDER BY id ASC`
  );
  const insertStmt = db.prepare(
    `INSERT INTO milestones (title, subtitle, drive_item_id, drive_id, media_mime, item_name)
     VALUES (@title, @subtitle, @drive_item_id, @drive_id, @media_mime, @item_name)`
  );
  const deleteOneStmt = db.prepare('DELETE FROM milestones WHERE id = ?');

  router.get('/', (req, res) => {
    const rows = listStmt.all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const error = validateMilestonePayload(req.body);
    if (error) {
      logger.warn('error while adding milestone', { reason: error });
      res.status(400).json({ error });
      return;
    }

    const {
      title,
      subtitle = '',
      drive_item_id,
      drive_id = null,
      media_mime,
      item_name = null,
    } = req.body;

    const result = insertStmt.run({
      title,
      subtitle,
      drive_item_id,
      drive_id,
      media_mime,
      item_name,
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
  // Not used in prod; safe to keep.
  router.delete('/', (req, res) => {
    db.prepare('DELETE FROM milestones').run();
    try {
      db.prepare("DELETE FROM sqlite_sequence WHERE name='milestones'").run();
    } catch {}
    res.json({ ok: true });
  });

  return router;
}
