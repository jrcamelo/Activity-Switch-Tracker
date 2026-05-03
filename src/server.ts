import 'dotenv/config';

import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import path from 'node:path';

import { db } from './db';
import { daySchema } from './schema';

type EntryRow = {
  id: string;
  time: string | null;
  arrow: '→' | '↝' | '↻';
  text: string;
};

type ExistingEntryTimestamps = {
  id: string;
  created_at: string;
};

type LoginAttemptState = {
  failures: number;
  blockedUntil: number | null;
};

const loginWindowMs = 24 * 60 * 60 * 1000;
const maxFailedLoginAttempts = 3;
const loginAttempts = new Map<string, LoginAttemptState>();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const cookieName = process.env.COOKIE_NAME ?? 'activity_session';
const webDist = path.join(process.cwd(), 'web', 'dist');
const indexFile = path.join(webDist, 'index.html');

app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function sqliteTimestamp(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function loginBlockRemaining(blockedUntil: number): number {
  return Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000));
}

function isLoginBlocked(ip: string): number | null {
  const attempt = loginAttempts.get(ip);

  if (!attempt?.blockedUntil) {
    return null;
  }

  if (attempt.blockedUntil <= Date.now()) {
    loginAttempts.delete(ip);
    return null;
  }

  return loginBlockRemaining(attempt.blockedUntil);
}

function recordFailedLogin(ip: string): number | null {
  const attempt = loginAttempts.get(ip);

  if (!attempt) {
    loginAttempts.set(ip, { failures: 1, blockedUntil: null });
    return null;
  }

  const failures = attempt.failures + 1;

  if (failures >= maxFailedLoginAttempts) {
    const blockedUntil = Date.now() + loginWindowMs;
    loginAttempts.set(ip, { failures, blockedUntil });
    return loginBlockRemaining(blockedUntil);
  }

  loginAttempts.set(ip, { failures, blockedUntil: null });
  return null;
}

function clearFailedLogins(ip: string) {
  loginAttempts.delete(ip);
}

function rowsForSaving(rows: EntryRow[]): EntryRow[] {
  const trimmed = [...rows];

  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    if (last.time === null && last.text.trim() === '') {
      trimmed.pop();
      continue;
    }
    break;
  }

  return trimmed;
}

function ensureAuthConfig(): string | null {
  if (!process.env.APP_PASSWORD_HASH) {
    return 'APP_PASSWORD_HASH is not configured';
  }

  if (!process.env.SESSION_SECRET) {
    return 'SESSION_SECRET is not configured';
  }

  return null;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!process.env.SESSION_SECRET) {
    return res.status(500).json({ error: 'Server auth is not configured' });
  }

  const token = req.cookies[cookieName];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    jwt.verify(token, process.env.SESSION_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

const selectDayEntries = db.prepare(`
  SELECT id, time, arrow, text
  FROM entries
  WHERE date = ?
  ORDER BY position ASC
`);

const deleteDayEntries = db.prepare('DELETE FROM entries WHERE date = ?');

const selectDayCreatedAt = db.prepare(`
  SELECT id, created_at
  FROM entries
  WHERE date = ?
`);

const insertEntry = db.prepare(`
  INSERT INTO entries (id, date, position, time, arrow, text, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`);

const replaceDayEntries = db.transaction((date: string, rows: EntryRow[]) => {
  const existingCreatedAt = new Map<string, string>();
  const now = sqliteTimestamp();

  for (const row of selectDayCreatedAt.all(date) as ExistingEntryTimestamps[]) {
    existingCreatedAt.set(row.id, row.created_at);
  }

  deleteDayEntries.run(date);

  rows.forEach((row, position) => {
    insertEntry.run(
      row.id,
      date,
      position,
      row.time,
      row.arrow,
      row.text,
      existingCreatedAt.get(row.id) ?? now
    );
  });
});

app.post('/api/login', async (req, res) => {
  const configError = ensureAuthConfig();

  if (configError) {
    return res.status(500).json({ error: configError });
  }

  const ip = clientIp(req);
  const blockedFor = isLoginBlocked(ip);

  if (blockedFor !== null) {
    res.setHeader('Retry-After', String(blockedFor));
    return res.status(429).json({ error: 'Too many login attempts. Try again tomorrow.' });
  }

  const password = String(req.body?.password ?? '');
  const valid = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH ?? '');

  if (!valid) {
    const retryAfter = recordFailedLogin(ip);

    if (retryAfter !== null) {
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many login attempts. Try again tomorrow.' });
    }

    return res.status(401).json({ error: 'Invalid password' });
  }

  clearFailedLogins(ip);

  const token = jwt.sign(
    { authenticated: true },
    process.env.SESSION_SECRET!,
    { expiresIn: '30d' }
  );

  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });

  res.sendStatus(204);
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  res.sendStatus(204);
});

app.get('/api/me', requireAuth, (_req, res) => {
  res.json({ authenticated: true });
});

app.use('/api/days', requireAuth);

app.get('/api/days/:date', (req, res) => {
  if (!isValidDate(req.params.date)) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  const rows = selectDayEntries.all(req.params.date) as EntryRow[];
  res.json(rows);
});

app.put('/api/days/:date', (req, res) => {
  if (!isValidDate(req.params.date)) {
    return res.status(400).json({ error: 'Invalid date' });
  }

  const parsed = daySchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  replaceDayEntries(req.params.date, rowsForSaving(parsed.data));
  res.sendStatus(204);
});

app.use(express.static(webDist));

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(indexFile, (error) => {
    if (error) {
      res.status(503).send('Frontend build not found. Run npm run build:web.');
    }
  });
});

app.listen(port, () => {
  console.log(`Activity Tracker listening on http://localhost:${port}`);
});
