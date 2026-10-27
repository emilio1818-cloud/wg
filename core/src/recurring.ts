import { addDays, addFrequency, parseDate } from './dates.ts';
import type { Cents, Expense, Frequency, ISODate, Recurring } from './types.ts';

/** n-th occurrence (0-based) of a schedule, always derived from the anchor to avoid drift. */
export function occurrence(start: ISODate, f: Frequency, n: number): ISODate {
  if (f.unit === 'month' || f.unit === 'year') {
    // Keep the anchor day (31st stays end-of-month instead of drifting to the 28th).
    const months = f.unit === 'month' ? f.every * n : f.every * 12 * n;
    const { y, m, d } = parseDate(start);
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
  }
  return addFrequency(start, f, n);
}

/** All occurrences in (after, until], capped to protect against bad data. */
export function occurrencesBetween(start: ISODate, f: Frequency, after: ISODate | undefined, until: ISODate, cap = 400): ISODate[] {
  const out: ISODate[] = [];
  if (f.every <= 0) return out;
  for (let n = 0; n < 100_000 && out.length < cap; n++) {
    const d = occurrence(start, f, n);
    if (d > until) break;
    if (!after || d > after) out.push(d);
  }
  return out;
}

/** Next due date of a recurring payment on or after `from`. */
export function nextDue(r: Pick<Recurring, 'startDate' | 'frequency' | 'endDate' | 'lastBooked'>, from: ISODate): ISODate | null {
  if (r.frequency.every <= 0) return null;
  const lowerBound = r.lastBooked && r.lastBooked >= from ? addDays(r.lastBooked, 1) : from;
  for (let n = 0; n < 100_000; n++) {
    const d = occurrence(r.startDate, r.frequency, n);
    if (r.endDate && d > r.endDate) return null;
    if (d >= lowerBound) return d;
  }
  return null;
}

/** Deterministic id so that two devices booking the same occurrence produce one expense. */
export function recurringExpenseId(recurringId: string, date: ISODate): string {
  return `rec_${recurringId}_${date}`;
}

/** Due occurrences that still need to be booked as expenses. */
export function dueOccurrences(r: Recurring, todayDate: ISODate): ISODate[] {
  if (!r.active || r.deleted || !r.autoBook) return [];
  const until = r.endDate && r.endDate < todayDate ? r.endDate : todayDate;
  return occurrencesBetween(r.startDate, r.frequency, r.lastBooked, until);
}

export function recurringToExpense(r: Recurring, date: ISODate, now: number): Expense {
  return {
    id: recurringExpenseId(r.id, date),
    kind: 'expense',
    title: r.title,
    amount: r.amount,
    paidBy: r.paidBy,
    date,
    category: r.category,
    splitMode: r.splitMode,
    split: r.split.map((p) => ({ ...p })),
    recurringId: r.id,
    createdAt: now,
    updatedAt: now,
    createdBy: r.createdBy,
  };
}

/** Normalised monthly cost of a schedule (for "Fixkosten pro Monat"). */
export function monthlyEquivalent(amount: Cents, f: Frequency): Cents {
  const perYear = { day: 365, week: 52, month: 12, year: 1 }[f.unit] / f.every;
  return Math.round((amount * perYear) / 12);
}
