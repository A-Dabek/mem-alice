import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'milestones.db');

/**
 * Opens (creating if necessary) the sqlite database at the given path and
 * ensures the required tables exist.
 *
 * @param {string} [dbPath] - path to the sqlite file. Defaults to data/milestones.db.
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(dbPath = DEFAULT_DB_PATH) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // No date/timestamp columns: milestones are ordered purely by insertion
  // order (the autoincrementing id), oldest first - there are no dates
  // anywhere in this app, including the database.
  db.exec(`
    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title_ct TEXT NOT NULL,
      title_iv TEXT NOT NULL,
      subtitle_ct TEXT NOT NULL DEFAULT '',
      subtitle_iv TEXT NOT NULL DEFAULT '',
      media_ct TEXT NOT NULL,
      media_iv TEXT NOT NULL,
      media_mime TEXT NOT NULL
    );
  `);

  // Migration for pre-existing databases created before the subtitle field
  // was added: add the columns (non-nullable, with a default so existing
  // rows stay valid) if they aren't there yet.
  const existingColumns = db.prepare('PRAGMA table_info(milestones)').all();
  const hasSubtitleCt = existingColumns.some((col) => col.name === 'subtitle_ct');
  const hasSubtitleIv = existingColumns.some((col) => col.name === 'subtitle_iv');

  if (!hasSubtitleCt) {
    db.exec(`ALTER TABLE milestones ADD COLUMN subtitle_ct TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasSubtitleIv) {
    db.exec(`ALTER TABLE milestones ADD COLUMN subtitle_iv TEXT NOT NULL DEFAULT ''`);
  }

  return db;
}

export { DEFAULT_DB_PATH };
