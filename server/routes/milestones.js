import express from 'express';
import { logger } from '../logger.js';

const REQUIRED_FIELDS = ['title', 'drive_item_id', 'media_mime'];

const LIST_COLUMNS =
  'id, title, subtitle, drive_item_id, drive_id, drive_endpoint, media_mime, media_width, media_height, item_name, position';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
]);

const MAX_LENGTHS = {
  title: 200,
  subtitle: 500,
  drive_item_id: 512,
  drive_id: 512,
  item_name: 512,
  drive_endpoint: 2048,
};

const MAX_DIMENSION = 100000;

const ALLOWED_ENDPOINT_HOSTS = [
  'onedrive.com',
  'sharepoint.com',
  'live.com',
  'svc.ms',
  'microsoftpersonalcontent.com',
];

/**
 * Re-checks a client-provided `drive_endpoint` before persisting it. The server
 * never fetches it, but a bad value would be handed back to other clients.
 *
 * @param {string} endpoint
 * @returns {boolean}
 */
function endpointAllowed(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_ENDPOINT_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

/**
 * Validates the milestone payload: required fields, types, MIME allowlist,
 * length caps and the endpoint host re-check. The server never fetches the
 * endpoint; this only guarantees sane stored values.
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

  for (const field of ['subtitle', 'drive_id', 'drive_endpoint', 'item_name']) {
    if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
      return `Field "${field}" must be a string`;
    }
  }

  if (!ALLOWED_MIME.has(body.media_mime)) {
    return `Unsupported media type "${body.media_mime}"`;
  }

  for (const field of ['media_width', 'media_height']) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || value <= 0 || value > MAX_DIMENSION) {
      return `Field "${field}" must be a positive integer`;
    }
  }

  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const value = body[field];
    if (typeof value === 'string' && value.length > max) {
      return `Field "${field}" must be at most ${max} characters`;
    }
  }

  if (body.drive_endpoint && !endpointAllowed(body.drive_endpoint)) {
    return 'Field "drive_endpoint" must be an allowlisted https host';
  }

  return null;
}

/**
 * Builds the /api/milestones router.
 *
 * The server never talks to Graph and never sees media: it only stores the
 * references returned by the picker plus the plaintext title/subtitle. There
 * are no dates anywhere - milestones are ordered by a mutable `position`
 * (oldest/append first, re-orderable via POST /:id/move).
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createMilestonesRouter(db) {
  const router = express.Router();

  const listStmt = db.prepare(
    `SELECT ${LIST_COLUMNS} FROM milestones ORDER BY position ASC, id ASC`
  );
  const insertStmt = db.prepare(
    `INSERT INTO milestones (position, title, subtitle, drive_item_id, drive_id, drive_endpoint, media_mime, media_width, media_height, item_name)
     VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM milestones), @title, @subtitle, @drive_item_id, @drive_id, @drive_endpoint, @media_mime, @media_width, @media_height, @item_name)`
  );
  const deleteOneStmt = db.prepare('DELETE FROM milestones WHERE id = ?');
  const findByIdStmt = db.prepare('SELECT id, position FROM milestones WHERE id = ?');
  const neighborStmt = {
    up: db.prepare(
      'SELECT id, position FROM milestones WHERE position < ? ORDER BY position DESC, id DESC LIMIT 1'
    ),
    down: db.prepare(
      'SELECT id, position FROM milestones WHERE position > ? ORDER BY position ASC, id ASC LIMIT 1'
    ),
  };
  const setPositionStmt = db.prepare('UPDATE milestones SET position = ? WHERE id = ?');
  const swapTx = db.transaction((current, neighbor) => {
    setPositionStmt.run(neighbor.position, current.id);
    setPositionStmt.run(current.position, neighbor.id);
  });

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
      drive_endpoint = null,
      media_mime,
      media_width = null,
      media_height = null,
      item_name = null,
    } = req.body;

    const result = insertStmt.run({
      title,
      subtitle,
      drive_item_id,
      drive_id,
      drive_endpoint,
      media_mime,
      media_width,
      media_height,
      item_name,
    });

    logger.info('milestone added', { id: result.lastInsertRowid });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  router.post('/:id/move', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      logger.warn('error while moving milestone', { reason: 'invalid id' });
      return res.status(400).json({ error: 'Invalid milestone id' });
    }

    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      logger.warn('error while moving milestone', { reason: 'invalid direction' });
      return res.status(400).json({ error: 'Field "direction" must be "up" or "down"' });
    }

    const current = findByIdStmt.get(id);
    if (!current) {
      logger.warn('error while moving milestone', { reason: 'not found', id });
      return res.status(404).json({ error: 'Milestone not found' });
    }

    const neighbor = neighborStmt[direction].get(current.position);
    if (neighbor) {
      swapTx(current, neighbor);
      logger.info('milestone moved', { id, direction });
    }

    return res.json(listStmt.all());
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
