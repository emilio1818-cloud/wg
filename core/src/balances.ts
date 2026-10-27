import { expenseShares } from './money.ts';
import type { Cents, Expense, ExpenseCategory, ID } from './types.ts';

export interface Transfer {
  from: ID;
  to: ID;
  amount: Cents;
}

/**
 * Net balance per member: positive = the WG owes them money,
 * negative = they owe money. Sums to zero across all members.
 */
export function computeBalances(expenses: Expense[], memberIds: ID[] = []): Map<ID, Cents> {
  const balances = new Map<ID, Cents>();
  for (const id of memberIds) balances.set(id, 0);
  for (const e of expenses) {
    if (e.deleted) continue;
    balances.set(e.paidBy, (balances.get(e.paidBy) ?? 0) + e.amount);
    for (const [memberId, share] of expenseShares(e)) {
      balances.set(memberId, (balances.get(memberId) ?? 0) - share);
    }
  }
  return balances;
}

/**
 * Minimal set of transfers that settles all balances. Greedy matching of the
 * largest creditor with the largest debtor yields at most n−1 transfers.
 */
export function simplifyDebts(balances: Map<ID, Cents>): Transfer[] {
  const creditors: { id: ID; amount: Cents }[] = [];
  const debtors: { id: ID; amount: Cents }[] = [];
  for (const [id, amount] of balances) {
    if (amount > 0) creditors.push({ id, amount });
    else if (amount < 0) debtors.push({ id, amount: -amount });
  }
  const byAmount = (a: { id: ID; amount: Cents }, b: { id: ID; amount: Cents }) => b.amount - a.amount || (a.id < b.id ? -1 : 1);
  const transfers: Transfer[] = [];
  creditors.sort(byAmount);
  debtors.sort(byAmount);
  while (creditors.length && debtors.length) {
    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.amount, d.amount);
    if (amount > 0) transfers.push({ from: d.id, to: c.id, amount });
    c.amount -= amount;
    d.amount -= amount;
    if (c.amount === 0) creditors.shift();
    if (d.amount === 0) debtors.shift();
    creditors.sort(byAmount);
    debtors.sort(byAmount);
  }
  return transfers;
}

/** How a single expense affects one member: positive = they get money back. */
export function expenseImpact(e: Expense, memberId: ID): Cents {
  const share = expenseShares(e).get(memberId) ?? 0;
  return (e.paidBy === memberId ? e.amount : 0) - share;
}

export interface SpendingStats {
  total: Cents;
  byCategory: Map<ExpenseCategory, Cents>;
  byMonth: Map<string, Cents>;
  paidBy: Map<ID, Cents>;
  consumedBy: Map<ID, Cents>;
}

/** Spending statistics over real expenses (transfers are excluded). */
export function spendingStats(expenses: Expense[], from?: string, to?: string): SpendingStats {
  const stats: SpendingStats = { total: 0, byCategory: new Map(), byMonth: new Map(), paidBy: new Map(), consumedBy: new Map() };
  for (const e of expenses) {
    if (e.deleted || e.kind !== 'expense') continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    stats.total += e.amount;
    stats.byCategory.set(e.category, (stats.byCategory.get(e.category) ?? 0) + e.amount);
    const month = e.date.slice(0, 7);
    stats.byMonth.set(month, (stats.byMonth.get(month) ?? 0) + e.amount);
    stats.paidBy.set(e.paidBy, (stats.paidBy.get(e.paidBy) ?? 0) + e.amount);
    for (const [id, share] of expenseShares(e)) stats.consumedBy.set(id, (stats.consumedBy.get(id) ?? 0) + share);
  }
  return stats;
}

/** PayPal.me deep link for a settle-up transfer. */
export function paypalLink(handle: string, amount: Cents, currency = 'EUR'): string {
  const clean = handle.replace(/^@/, '').replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/\/.*$/, '');
  return `https://paypal.me/${encodeURIComponent(clean)}/${(amount / 100).toFixed(2)}${currency}`;
}

/** Formats an IBAN in groups of four. */
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

/** ISO 13616 mod-97 IBAN check. */
export function isValidIban(iban: string): boolean {
  const s = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of v) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}
