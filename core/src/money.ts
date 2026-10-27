import type { Cents, Expense, ID, SplitMode, SplitPart } from './types.ts';

/**
 * Distributes `total` cents proportionally to `weights` so that the parts are
 * integers and always sum to exactly `total` (largest remainder method,
 * ties broken by input order).
 */
export function distribute(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (weights.length === 0) return [];
  if (sum <= 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (w > 0 ? (abs * w) / sum : 0));
  const parts = exact.map(Math.floor);
  let rest = abs - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v), w: weights[i]! }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && order.length > 0; k = (k + 1) % order.length) {
    parts[order[k]!.i]! += 1;
    rest--;
  }
  return parts.map((p) => p * sign);
}

/** Computes each participant's share of an expense in cents. */
export function computeShares(amount: Cents, mode: SplitMode, split: SplitPart[]): Map<ID, Cents> {
  const result = new Map<ID, Cents>();
  if (split.length === 0) return result;
  let parts: Cents[];
  switch (mode) {
    case 'equal':
      parts = distribute(amount, split.map(() => 1));
      break;
    case 'shares':
    case 'percent':
      parts = distribute(amount, split.map((p) => p.value));
      break;
    case 'exact':
      parts = split.map((p) => Math.round(p.value));
      break;
  }
  split.forEach((p, i) => result.set(p.memberId, (result.get(p.memberId) ?? 0) + parts[i]!));
  return result;
}

export function expenseShares(e: Pick<Expense, 'amount' | 'splitMode' | 'split'>): Map<ID, Cents> {
  return computeShares(e.amount, e.splitMode, e.split);
}

/** Validates a split; returns an error code or null when valid. */
export function validateSplit(amount: Cents, mode: SplitMode, split: SplitPart[]): null | 'no_participants' | 'sum_mismatch' | 'percent_mismatch' | 'zero_weights' {
  if (split.length === 0) return 'no_participants';
  if (mode === 'exact') {
    const sum = split.reduce((a, p) => a + Math.round(p.value), 0);
    return sum === amount ? null : 'sum_mismatch';
  }
  if (mode === 'percent') {
    const sum = split.reduce((a, p) => a + p.value, 0);
    return Math.abs(sum - 100) < 0.001 ? null : 'percent_mismatch';
  }
  if (mode === 'shares') {
    return split.some((p) => p.value > 0) ? null : 'zero_weights';
  }
  return null;
}

/**
 * Parses user input like "12,50", "1.234,56", "12.5", "€ 7" into cents.
 * Returns null for unparsable input.
 */
export function parseAmount(input: string): Cents | null {
  let s = input.replace(/[^\d.,\-]/g, '');
  if (!s || s === '-' || s === ',' || s === '.') return null;
  const decimalIdx = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // A single separator followed by exactly 3 digits is a thousands separator ("1.234").
  const sepCount = (s.match(/[.,]/g) ?? []).length;
  const digitsAfter = decimalIdx >= 0 ? s.length - decimalIdx - 1 : 0;
  if (sepCount === 1 && digitsAfter === 3) {
    s = s.replace(/[.,]/g, '');
  } else if (decimalIdx >= 0) {
    const intPart = s.slice(0, decimalIdx).replace(/[.,]/g, '');
    const fracPart = s.slice(decimalIdx + 1).replace(/[.,]/g, '');
    s = intPart + '.' + fracPart;
  }
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Formats cents for an `<input>` value in the given locale ("12,50"). */
export function centsToInput(cents: Cents, locale = 'de-DE'): string {
  if (!cents) return '';
  return (cents / 100).toLocaleString(locale, { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2, useGrouping: false });
}

const formatterCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: Cents, currency = 'EUR', locale = 'de-DE', opts: { sign?: boolean; compact?: boolean } = {}): string {
  const key = `${locale}|${currency}|${opts.sign ? 1 : 0}|${opts.compact ? 1 : 0}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      signDisplay: opts.sign ? 'exceptZero' : 'auto',
      minimumFractionDigits: opts.compact ? 0 : 2,
      maximumFractionDigits: opts.compact ? 0 : 2,
    });
    formatterCache.set(key, f);
  }
  return f.format(cents / 100);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}
