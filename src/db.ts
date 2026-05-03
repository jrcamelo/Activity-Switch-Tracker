import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'activity.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    position INTEGER NOT NULL,
    time TEXT,
    arrow TEXT NOT NULL DEFAULT '→',
    text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_entries_date_position
  ON entries(date, position);
`);
