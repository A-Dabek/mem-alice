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
 * The server stores only Graph references + plaintext title/subtitle for the
 * PoC; media itself never leaves OneDrive. There are no dates anywhere -
 * milestones are ordered purely by insertion order (autoincrementing id).
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
    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      drive_item_id TEXT NOT NULL,
      drive_id TEXT,
      drive_endpoint TEXT,
      media_mime TEXT NOT NULL,
      item_name TEXT
    );
  `);

  return db;
}

export { DEFAULT_DB_PATH };
