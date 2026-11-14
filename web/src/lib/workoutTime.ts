import type { WorkoutSession } from '../types/routine';

const validMillis = (value: number): number | null =>
  Number.isFinite(value) && Math.abs(value) <= 8_640_000_000_000_000 ? value : null;

/** Accept live Firestore timestamps and the same values after JSON serialization. */
export function timestampMillis(value: unknown): number | null {
  if (typeof value === 'number') return validMillis(value);
  if (value instanceof Date) return validMillis(value.getTime());
  if (typeof value === 'string') return value.trim() ? validMillis(Date.parse(value)) : null;
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as {
    toMillis?: () => number;
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
  };
  if (typeof timestamp.toMillis === 'function') {
    try { return validMillis(timestamp.toMillis()); } catch { return null; }
  }
  const seconds = timestamp.seconds ?? timestamp._seconds;
  const nanos = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)
    || typeof nanos !== 'number' || !Number.isFinite(nanos) || nanos < 0 || nanos >= 1_000_000_000) return null;
  return validMillis(seconds * 1000 + nanos / 1_000_000);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** datetime-local uses local calendar fields, never an ISO string's UTC fields. */
export function toLocalDateTimeInput(value: unknown): string {
  const millis = timestampMillis(value);
  if (millis === null) return '';
  const date = new Date(millis);
  const year = date.getFullYear();
  if (year < 1 || year > 9999) return '';
  return `${String(year).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Reject impossible dates and local clock times skipped by a DST transition. */
export function parseLocalDateTimeInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fractionText = ''] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59) return null;
  const millisecond = Number(fractionText.padEnd(3, '0'));
  // setFullYear avoids the Date constructor's special mapping of years 0–99.
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, millisecond);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second) return null;
  return validMillis(date.getTime());
}

/** The persisted start keeps active elapsed time correct after reload or navigation. */
export function elapsedSeconds(session: WorkoutSession, now = Date.now()): number | null {
  const start = timestampMillis(session.started_at);
  if (session.status === 'active') {
    if (start === null || validMillis(now) === null || now < start) return null;
    return Math.floor((now - start) / 1000);
  }
  const end = timestampMillis(session.completed_at);
  if (start !== null && end !== null) return end >= start ? Math.floor((end - start) / 1000) : null;
  if (typeof session.duration_sec === 'number' && Number.isFinite(session.duration_sec) && session.duration_sec >= 0) {
    return Math.floor(session.duration_sec);
  }
  if (typeof session.duration_min === 'number' && Number.isFinite(session.duration_min) && session.duration_min >= 0) {
    return Math.round(session.duration_min * 60);
  }
  return null;
}

export function formatElapsedTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(remaining)}` : `${pad(minutes)}:${pad(remaining)}`;
}
