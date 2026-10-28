import type { Frequency, ISODate } from './types.ts';

/*
 * Calendar-date helpers operating on `YYYY-MM-DD` strings.
 * All arithmetic happens in UTC so daylight-saving shifts can never move a date.
 */

const DAY = 86_400_000;

export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's local calendar date. */
export function today(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function parseDate(s: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function toUTC(s: ISODate): number {
  const { y, m, d } = parseDate(s);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function isValidDate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUTC(toUTC(s)) === s;
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromUTC(toUTC(s) + n * DAY);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds months, clamping the day to the end of the target month (Jan 31 + 1 → Feb 28/29). */
export function addMonths(s: ISODate, n: number, anchorDay?: number): ISODate {
  const { y, m, d } = parseDate(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(ny, nm));
  return `${ny}-${pad2(nm)}-${pad2(day)}`;
}

export function addFrequency(s: ISODate, f: Frequency, times = 1): ISODate {
  const n = f.every * times;
  switch (f.unit) {
    case 'day':
      return addDays(s, n);
    case 'week':
      return addDays(s, n * 7);
    case 'month':
      return addMonths(s, n);
    case 'year':
      return addMonths(s, n * 12);
  }
}

/** Whole days from `a` to `b` (positive if b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(s: ISODate): number {
  return (new Date(toUTC(s)).getUTCDay() + 6) % 7;
}

export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, -weekdayIndex(s));
}

export function startOfMonth(s: ISODate): ISODate {
  return s.slice(0, 8) + '01';
}

export function endOfMonth(s: ISODate): ISODate {
  const { y, m } = parseDate(s);
  return `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
}

/** `YYYY-MM` */
export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

export function isBetween(s: ISODate, from: ISODate, to: ISODate): boolean {
  return s >= from && s <= to;
}

/** Date-only value to a JS Date at local noon (safe for formatting). */
export function dateToLocal(s: ISODate): Date {
  const { y, m, d } = parseDate(s);
  return new Date(y, m - 1, d, 12);
}

/** Matrix of weeks (Mon–Sun) covering a month, for calendar grids. */
export function monthGrid(monthAnyDay: ISODate): ISODate[][] {
  const first = startOfMonth(monthAnyDay);
  const last = endOfMonth(monthAnyDay);
  let cursor = startOfWeek(first);
  const weeks: ISODate[][] = [];
  while (cursor <= last || weeks.length < 6) {
    const week: ISODate[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    if (weeks.length >= 6) break;
  }
  return weeks;
}

/** Next date on or after `from` that falls on `day` of a month (clamped to short months). */
export function nextMonthDay(from: ISODate, day: number): ISODate {
  const { y, m, d } = parseDate(from);
  const thisMonth = `${y}-${pad2(m)}-${pad2(Math.min(day, daysInMonth(y, m)))}`;
  if (Math.min(day, daysInMonth(y, m)) >= d) return thisMonth;
  return addMonths(`${y}-${pad2(m)}-01`, 1, day);
}

/** Next date on or after `from` that is the given weekday (0 = Monday … 6 = Sunday). */
export function nextWeekday(from: ISODate, weekday: number): ISODate {
  return addDays(from, (weekday - weekdayIndex(from) + 7) % 7);
}

/** Next occurrence of an annual `MM-DD` date on or after `from`. */
export function nextAnnual(mmdd: string, from: ISODate): ISODate {
  const { y } = parseDate(from);
  const [mm, dd] = mmdd.split('-').map(Number);
  const make = (year: number) => {
    const day = Math.min(dd!, daysInMonth(year, mm!));
    return `${year}-${pad2(mm!)}-${pad2(day)}`;
  };
  const thisYear = make(y);
  return thisYear >= from ? thisYear : make(y + 1);
}
