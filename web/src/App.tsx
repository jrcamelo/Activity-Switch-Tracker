import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ApiError, getCurrentSession, getDay, login, logout, putDay } from './api';
import { addDays, formatDisplayDate, todayString } from './date';
import { roundUpToFiveMinutes } from './time';
import type { Arrow, Entry } from './types';

const arrowCycle: readonly Arrow[] = ['→', '↝', '↻'] as const;
const saveDelayMs = 500;
const isDemoPage = window.location.pathname === '/demo';

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyEntry(): Entry {
  return {
    id: createId(),
    time: null,
    arrow: '→',
    text: ''
  };
}

function isEmpty(entry: Entry): boolean {
  return entry.time === null && entry.text.trim() === '';
}

function rowsForSaving(entries: Entry[]): Entry[] {
  const rows = [...entries];

  while (rows.length > 0 && isEmpty(rows[rows.length - 1])) {
    rows.pop();
  }

  return rows;
}

function ensureTrailingEmpty(entries: Entry[]): Entry[] {
  const rows = entries.length > 0 ? [...entries] : [];

  if (rows.length === 0 || !isEmpty(rows[rows.length - 1])) {
    rows.push(createEmptyEntry());
  }

  return rows;
}

function nextArrow(current: Arrow): Arrow {
  return arrowCycle[(arrowCycle.indexOf(current) + 1) % arrowCycle.length];
}

function demoEntries(): Entry[] {
  return [
    { id: 'demo-1', time: '14:10', arrow: '→', text: 'starting task X' },
    { id: 'demo-2', time: '14:30', arrow: '↝', text: 'got distracted' },
    { id: 'demo-3', time: '15:00', arrow: '↝', text: 'shower' },
    { id: 'demo-4', time: '15:20', arrow: '↻', text: 'task X' },
    { id: 'demo-5', time: '15:45', arrow: '→', text: 'starting task Y' },
    createEmptyEntry()
  ];
}

function sanitizeTimeInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);

  if (digits.length <= 2) {
    return digits;
  }

  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function normalizeTimeValue(value: string): string | null {
  if (value.trim() === '') {
    return null;
  }

  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${match[1]}:${match[2]}`;
}

function resizeTextarea(target: HTMLTextAreaElement) {
  target.style.height = '0px';
  target.style.height = `${target.scrollHeight}px`;
}

type AuthState = 'checking' | 'anonymous' | 'authenticated';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(isDemoPage ? 'authenticated' : 'checking');
  const [selectedDate, setSelectedDate] = useState(() => todayString());
  const [entries, setEntries] = useState<Entry[]>(() => (isDemoPage ? demoEntries() : [createEmptyEntry()]));
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoadingDay, setIsLoadingDay] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const lastPersistedSnapshotRef = useRef('[]');
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);

  useEffect(() => {
    if (isDemoPage) {
      return;
    }

    void (async () => {
      try {
        await getCurrentSession();
        setAuthState('authenticated');
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setAuthState('anonymous');
          return;
        }

        setAuthState('anonymous');
        setError('Unable to verify the current session.');
      }
    })();
  }, []);

  useEffect(() => {
    if (isDemoPage) {
      setEntries(demoEntries());
      setIsLoadingDay(false);
      return;
    }

    if (authState !== 'authenticated') {
      return;
    }

    const requestId = ++loadRequestRef.current;
    setIsLoadingDay(true);
    setError(null);

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    void (async () => {
      try {
        const rows = await getDay(selectedDate);

        if (requestId !== loadRequestRef.current) {
          return;
        }

        setEntries(ensureTrailingEmpty(rows));
        lastPersistedSnapshotRef.current = JSON.stringify(rowsForSaving(rows));
        dirtyRef.current = false;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setAuthState('anonymous');
          setEntries([createEmptyEntry()]);
          return;
        }

        setError('Unable to load this day.');
      } finally {
        if (requestId === loadRequestRef.current) {
          setIsLoadingDay(false);
        }
      }
    })();
  }, [authState, selectedDate]);

  useEffect(() => {
    if (isDemoPage) {
      return;
    }

    if (authState !== 'authenticated' || isLoadingDay) {
      return;
    }

    const snapshot = JSON.stringify(rowsForSaving(entries));

    if (snapshot === lastPersistedSnapshotRef.current) {
      dirtyRef.current = false;
      return;
    }

    dirtyRef.current = true;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void saveNow(selectedDate, entries);
    }, saveDelayMs);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [authState, entries, isLoadingDay, selectedDate]);

  async function saveNow(date: string, currentEntries: Entry[]) {
    if (isDemoPage) {
      return true;
    }

    const rows = rowsForSaving(currentEntries);
    const snapshot = JSON.stringify(rows);

    if (snapshot === lastPersistedSnapshotRef.current) {
      dirtyRef.current = false;
      return true;
    }

    setIsSaving(true);

    try {
      await putDay(date, rows);
      lastPersistedSnapshotRef.current = snapshot;
      dirtyRef.current = false;
      setError(null);
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setAuthState('anonymous');
        return false;
      }

      setError('Unable to save changes.');
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function flushPendingSave() {
    if (isDemoPage) {
      return true;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!dirtyRef.current || authState !== 'authenticated' || isLoadingDay) {
      return true;
    }

    return saveNow(selectedDate, entries);
  }

  function updateEntries(updater: (current: Entry[]) => Entry[]) {
    setEntries((current) => ensureTrailingEmpty(updater(current)));
  }

  function updateEntry(id: string, updater: (entry: Entry) => Entry) {
    updateEntries((current) =>
      current.map((entry) => (entry.id === id ? updater(entry) : entry))
    );
  }

  function removeEntry(id: string) {
    updateEntries((current) => current.filter((entry) => entry.id !== id));
  }

  function moveEntry(id: string, direction: -1 | 1) {
    updateEntries((current) => {
      const rows = [...current];
      const index = rows.findIndex((entry) => entry.id === id);
      const lastMovableIndex = rows.length - 2;

      if (index < 0 || index > lastMovableIndex) {
        return rows;
      }

      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex > lastMovableIndex) {
        return rows;
      }

      [rows[index], rows[nextIndex]] = [rows[nextIndex], rows[index]];
      return rows;
    });
  }

  async function navigateToDate(nextDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate) || nextDate === selectedDate) {
      return;
    }

    const saved = await flushPendingSave();

    if (saved) {
      setSelectedDate(nextDate);
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      await login(password);
      setPassword('');
      setAuthState('authenticated');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Invalid password.');
        return;
      }

      setError('Unable to sign in.');
    }
  }

  async function handleLogout() {
    loadRequestRef.current += 1;

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    await flushPendingSave();

    try {
      await logout();
    } finally {
      setAuthState('anonymous');
      setEntries([createEmptyEntry()]);
      lastPersistedSnapshotRef.current = '[]';
      dirtyRef.current = false;
    }
  }

  if (authState === 'checking') {
    return (
      <main className="shell">
        <section className="panel panel--centered">
          <p className="muted">Checking session…</p>
        </section>
      </main>
    );
  }

  if (authState === 'anonymous') {
    return (
      <main className="shell">
        <section className="panel panel--login">
          <div className="eyebrow">Activity Tracker</div>
          <h1>Enter master password</h1>
          <form className="loginForm" onSubmit={handleLoginSubmit}>
            <input
              autoComplete="current-password"
              className="loginInput"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              value={password}
            />
            <button className="primaryButton" type="submit">
              Sign in
            </button>
          </form>
          {error ? <p className="errorText">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="panel">
        <header className="toolbar">
          <div className="dateNav">
            <button
              className="navButton"
              onClick={() => void navigateToDate(addDays(selectedDate, -1))}
              type="button"
            >
              ←
            </button>
            <label className="dateButton">
              <span>{formatDisplayDate(selectedDate)}</span>
              <input
                aria-label="Select date"
                className="dateInput"
                onChange={(event) => void navigateToDate(event.target.value)}
                type="date"
                value={selectedDate}
              />
              <span aria-hidden="true" className="dateOverlay" />
            </label>
            <button
              className="navButton"
              onClick={() => void navigateToDate(addDays(selectedDate, 1))}
              type="button"
            >
              →
            </button>
          </div>
          <div className="statusGroup">
            {isDemoPage ? (
              <span className="statusText">Demo mode</span>
            ) : (
              <>
                <span className="statusText">
                  {isLoadingDay ? 'Loading…' : isSaving ? 'Saving…' : 'Saved'}
                </span>
                <button className="ghostButton" onClick={() => void handleLogout()} type="button">
                  Logout
                </button>
              </>
            )}
          </div>
        </header>

        {error ? <p className="errorText errorText--inline">{error}</p> : null}

        <div className="page">
          {entries.map((entry, index) => {
            const hasTime = entry.time !== null;
            const isTrailingEmptyRow = index === entries.length - 1;
            const hasText = entry.text.trim() !== '';
            const showArrowControl = hasTime || hasText;
            const canMoveUp = index > 0 && !isTrailingEmptyRow;
            const canMoveDown = index < entries.length - 2;
            const showMoveControls = hasText && !isTrailingEmptyRow;
            const canRemove = !hasText && entries.length > 1;

            return (
              <div className="row" key={entry.id}>
                {showMoveControls ? (
                  <div className="moveButtons">
                    <button
                      aria-label="Move entry up"
                      className="moveButton"
                      disabled={!canMoveUp}
                      onClick={() => moveEntry(entry.id, -1)}
                      type="button"
                    >
                      ▴
                    </button>
                    <button
                      aria-label="Move entry down"
                      className="moveButton"
                      disabled={!canMoveDown}
                      onClick={() => moveEntry(entry.id, 1)}
                      type="button"
                    >
                      ▾
                    </button>
                  </div>
                ) : canRemove ? (
                  <button
                    aria-label="Remove row"
                    className="removeButton"
                    onClick={() => removeEntry(entry.id)}
                    type="button"
                  >
                    -
                  </button>
                ) : (
                  <span aria-hidden="true" className="controlSpacer" />
                )}

                {hasTime ? (
                  <input
                    className="timeInput"
                    onChange={(event) =>
                      updateEntry(entry.id, (current) => ({
                        ...current,
                        time: sanitizeTimeInput(event.target.value)
                      }))
                    }
                    onBlur={(event) =>
                      updateEntry(entry.id, (current) => ({
                        ...current,
                        time: normalizeTimeValue(event.target.value)
                      }))
                    }
                    inputMode="numeric"
                    maxLength={5}
                    pattern="[0-9]{2}:[0-9]{2}"
                    placeholder="hh:mm"
                    type="text"
                    value={entry.time ?? ''}
                  />
                ) : (
                  <button
                    className="timeButton"
                    onClick={() =>
                      updateEntry(entry.id, (current) => ({
                        ...current,
                        time: roundUpToFiveMinutes()
                      }))
                    }
                    type="button"
                  >
                    <span className="timePlaceholder">hh:mm</span>
                  </button>
                )}

                {showArrowControl ? (
                  <button
                    className="arrowButton"
                    onClick={() =>
                      updateEntry(entry.id, (current) => ({
                        ...current,
                        arrow: nextArrow(current.arrow)
                      }))
                    }
                    type="button"
                  >
                    {entry.arrow}
                  </button>
                ) : (
                  <span aria-hidden="true" className="arrowSpacer" />
                )}

                <textarea
                  className="textInput"
                  onChange={(event) =>
                    updateEntry(entry.id, (current) => ({
                      ...current,
                      text: event.target.value
                    }))
                  }
                  onInput={(event) => resizeTextarea(event.currentTarget)}
                  placeholder="Write the next activity…"
                  ref={(node) => {
                    if (node) {
                      resizeTextarea(node);
                    }
                  }}
                  rows={1}
                  value={entry.text}
                />
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
