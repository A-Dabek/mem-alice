import express from 'express';

const REQUIRED_FIELDS = [
  'title_ct',
  'title_iv',
  'subtitle_ct',
  'subtitle_iv',
  'photo_ct',
  'photo_iv',
  'photo_mime',
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

  return null;
}

/**
 * Builds the /api/milestones router.
 *
 * The server never decrypts anything: it only stores/returns the ciphertext
 * fields provided by the client. There are no dates anywhere - milestones
 * are ordered purely by insertion order (the autoincrementing id), oldest
 * first, matching the order photos were uploaded.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
export function createMilestonesRouter(db) {
  const router = express.Router();

  const listStmt = db.prepare(
    'SELECT id, title_ct, title_iv, subtitle_ct, subtitle_iv, photo_ct, photo_iv, photo_mime FROM milestones ORDER BY id ASC'
  );
  const insertStmt = db.prepare(
    `INSERT INTO milestones (title_ct, title_iv, subtitle_ct, subtitle_iv, photo_ct, photo_iv, photo_mime)
     VALUES (@title_ct, @title_iv, @subtitle_ct, @subtitle_iv, @photo_ct, @photo_iv, @photo_mime)`
  );

  router.get('/', (req, res) => {
    const rows = listStmt.all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const error = validateMilestonePayload(req.body);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    const { title_ct, title_iv, subtitle_ct, subtitle_iv, photo_ct, photo_iv, photo_mime } =
      req.body;

    const result = insertStmt.run({
      title_ct,
      title_iv,
      subtitle_ct,
      subtitle_iv,
      photo_ct,
      photo_iv,
      photo_mime,
    });

    res.status(201).json({ id: result.lastInsertRowid });
  });

  return router;
}
