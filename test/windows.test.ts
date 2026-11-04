import { describe, it, expect } from 'vitest';
import { dayNumber, isOpen, transitions, opensWithin, localDay, localMidnight, easter, nthWeekday, fromDayNumber } from '../src/domain/windows.js';
import type { WindowDef } from '../src/db/schema.js';

const range = (from: string, to: string): WindowDef => ({ type: 'range', from, to });
const d = dayNumber;

describe('fixed ranges (Kometa range(MM/DD-MM/DD))', () => {
  it('is inclusive at both ends', () => {
    const xmas = range('12/01', '12/31');
    expect(isOpen(xmas, d(2026, 11, 30))).toBe(false);
    expect(isOpen(xmas, d(2026, 12, 1))).toBe(true);
    expect(isOpen(xmas, d(2026, 12, 31))).toBe(true);
    expect(isOpen(xmas, d(2027, 1, 1))).toBe(false);
  });

  it('wraps past New Year (New Year’s Day 12/26–01/04)', () => {
    const ny = range('12/26', '01/04');
    expect(isOpen(ny, d(2026, 12, 25))).toBe(false);
    expect(isOpen(ny, d(2026, 12, 26))).toBe(true);
    expect(isOpen(ny, d(2027, 1, 1))).toBe(true);
    expect(isOpen(ny, d(2027, 1, 4))).toBe(true);
    expect(isOpen(ny, d(2027, 1, 5))).toBe(false);
  });

  it('clamps 02/29 to 02/28 in non-leap years (Valentine’s 02/01–02/29)', () => {
    const v = range('02/01', '02/29');
    expect(isOpen(v, d(2027, 2, 28))).toBe(true);
    expect(isOpen(v, d(2027, 3, 1))).toBe(false);
    expect(isOpen(v, d(2028, 2, 29))).toBe(true);
    expect(isOpen(v, d(2028, 3, 1))).toBe(false);
    expect(transitions(v, d(2027, 1, 15), 2)).toEqual([
      { day: d(2027, 2, 1), kind: 'opens' },
      { day: d(2027, 3, 1), kind: 'closes' },
    ]);
  });

  it('accepts unpadded dates (Memorial Day range(5/18-6/7))', () => {
    expect(isOpen(range('5/18', '6/7'), d(2027, 6, 7))).toBe(true);
  });

  it('lists the next transitions; same-day close and open sort close first', () => {
    const t = transitions(range('11/01', '11/30'), d(2026, 11, 2), 2);
    expect(t).toEqual([{ day: d(2026, 12, 1), kind: 'closes' }, { day: d(2027, 11, 1), kind: 'opens' }]);
  });

  it('knows when a window opens within the pre-review lead time', () => {
    const xmas = range('12/01', '12/31');
    expect(opensWithin(xmas, d(2026, 11, 17), 14)).toBe(d(2026, 12, 1));
    expect(opensWithin(xmas, d(2026, 11, 16), 14)).toBeNull();
    expect(opensWithin(xmas, d(2026, 12, 5), 14)).toBeNull();
  });

  it('treats a missing window as always open', () => {
    expect(isOpen(null, d(2026, 7, 4))).toBe(true);
  });
});

describe('relative rules', () => {
  it('computes Easter Sunday', () => {
    expect(fromDayNumber(easter(2026))).toEqual({ y: 2026, m: 4, d: 5 });
    expect(fromDayNumber(easter(2027))).toEqual({ y: 2027, m: 3, d: 28 });
  });

  it('computes nth and last weekdays (Thanksgiving: 4th Thursday of November)', () => {
    expect(fromDayNumber(nthWeekday(2026, 11, 4, 4))).toEqual({ y: 2026, m: 11, d: 26 });
    expect(fromDayNumber(nthWeekday(2027, 5, 1, -1))).toEqual({ y: 2027, m: 5, d: 31 }); // Memorial Day
    const thanksgiving: WindowDef = { type: 'nth_weekday', month: 11, weekday: 4, nth: 4, before: 10, after: 3 };
    expect(isOpen(thanksgiving, d(2026, 11, 16))).toBe(true);
    expect(isOpen(thanksgiving, d(2026, 11, 15))).toBe(false);
    expect(isOpen(thanksgiving, d(2026, 11, 29))).toBe(true);
    expect(isOpen(thanksgiving, d(2026, 11, 30))).toBe(false);
  });

  it('supports Easter offsets', () => {
    const w: WindowDef = { type: 'easter', before: 14, after: 1 };
    expect(isOpen(w, d(2026, 3, 22))).toBe(true);
    expect(isOpen(w, d(2026, 4, 7))).toBe(false);
  });
});

describe('time zones', () => {
  const tz = 'America/New_York';
  it('finds the local day of an instant', () => {
    expect(localDay(Date.UTC(2026, 11, 1, 4, 30), tz)).toBe(d(2026, 11, 30)); // 23:30 EST on 30 Nov
    expect(localDay(Date.UTC(2026, 11, 1, 5, 0), tz)).toBe(d(2026, 12, 1));
  });

  it('puts local midnight at the right instant, including DST weeks', () => {
    expect(localMidnight(d(2026, 12, 1), tz)).toBe(Date.UTC(2026, 11, 1, 5, 0)); // EST, UTC-5
    expect(localMidnight(d(2026, 7, 4), tz)).toBe(Date.UTC(2026, 6, 4, 4, 0)); // EDT, UTC-4
    expect(localMidnight(d(2026, 3, 8), tz)).toBe(Date.UTC(2026, 2, 8, 5, 0)); // DST starts at 02:00 that day
    expect(localMidnight(d(2026, 11, 1), tz)).toBe(Date.UTC(2026, 10, 1, 4, 0)); // DST ends at 02:00 that day
  });
});
