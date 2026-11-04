// Window math (ADR-015). Pure functions over local calendar days in a given IANA timezone.
// A "day number" is the count of days since 1970-01-01 for a local calendar date (no time, no zone).
// Ranges are inclusive at both ends, wrap past New Year when `to < from`, and clamp 02/29 → 02/28 in non-leap years.
import type { WindowDef } from '../db/schema.js';

const DAY_MS = 86_400_000;

export const dayNumber = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);

export function fromDayNumber(day: number): { y: number; m: number; d: number } {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The local calendar day of an instant in a timezone. */
export function localDay(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return dayNumber(get('year'), get('month'), get('day'));
}

/** Offset (ms) of a timezone from UTC at an instant. */
function tzOffset(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The instant of local midnight at the start of a calendar day in a timezone (DST-safe). */
export function localMidnight(day: number, tz: string): number {
  const guess = day * DAY_MS;
  let instant = guess - tzOffset(guess, tz);
  instant = guess - tzOffset(instant, tz);
  return instant;
}

function parseMmDd(s: string): { m: number; d: number } {
  const match = s.trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) throw new Error(`Bad MM/DD date: ${s}`);
  const m = Number(match[1]);
  const d = Number(match[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) throw new Error(`Bad MM/DD date: ${s}`);
  return { m, d };
}

function clampDay(y: number, m: number, d: number): number {
  if (m === 2 && d === 29 && !isLeap(y)) return dayNumber(y, 2, 28);
  return dayNumber(y, m, d);
}

/** Easter Sunday (Gregorian, anonymous computus). */
export function easter(y: number): number {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(y, month, day);
}

/** nth weekday of a month (weekday 0=Sun…6=Sat; nth 1..5, or -1 for the last). */
export function nthWeekday(y: number, month: number, weekday: number, nth: number): number {
  if (nth === -1) {
    const last = dayNumber(y, month + 1, 0);
    const lastDow = new Date(last * DAY_MS).getUTCDay();
    return last - ((lastDow - weekday + 7) % 7);
  }
  const first = dayNumber(y, month, 1);
  const firstDow = new Date(first * DAY_MS).getUTCDay();
  return first + ((weekday - firstDow + 7) % 7) + (nth - 1) * 7;
}

/** The window's occurrence anchored in `year`, as [start, end] inclusive day numbers. */
export function occurrence(w: WindowDef, year: number): { start: number; end: number } {
  switch (w.type) {
    case 'range': {
      const from = parseMmDd(w.from);
      const to = parseMmDd(w.to);
      const wraps = to.m < from.m || (to.m === from.m && to.d < from.d);
      const start = clampDay(year, from.m, from.d) - (w.leadDays ?? 0);
      const end = clampDay(wraps ? year + 1 : year, to.m, to.d) + (w.lagDays ?? 0);
      return { start, end };
    }
    case 'nth_weekday': {
      const center = nthWeekday(year, w.month, w.weekday, w.nth);
      return { start: center - w.before, end: center + w.after };
    }
    case 'easter': {
      const center = easter(year);
      return { start: center - w.before, end: center + w.after };
    }
  }
}

export function isOpen(w: WindowDef | null, day: number): boolean {
  if (!w) return true;
  const y = fromDayNumber(day).y;
  return [y - 1, y, y + 1].some((yy) => {
    const o = occurrence(w, yy);
    return day >= o.start && day <= o.end;
  });
}

export type Transition = { day: number; kind: 'opens' | 'closes' };

/** Upcoming opens/closes from `fromDay` (exclusive of a transition on fromDay itself unless `inclusive`). */
export function transitions(w: WindowDef | null, fromDay: number, count = 4, inclusive = false): Transition[] {
  if (!w) return [];
  const y = fromDayNumber(fromDay).y;
  const out: Transition[] = [];
  for (let yy = y - 1; yy <= y + 3; yy++) {
    const o = occurrence(w, yy);
    out.push({ day: o.start, kind: 'opens' }, { day: o.end + 1, kind: 'closes' });
  }
  return out
    .filter((t) => (inclusive ? t.day >= fromDay : t.day > fromDay))
    .sort((a, b) => a.day - b.day || (a.kind === 'closes' ? -1 : 1))
    .slice(0, count);
}

/** If the window is closed now but opens within `leadDays`, the day it opens. */
export function opensWithin(w: WindowDef | null, today: number, leadDays: number): number | null {
  if (!w || isOpen(w, today)) return null;
  const next = transitions(w, today, 4).find((t) => t.kind === 'opens');
  return next && next.day - today <= leadDays ? next.day : null;
}

export function formatDay(day: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(day * DAY_MS));
}
