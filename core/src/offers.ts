import { cancellableAnyTime, deadlineDaysLeft } from './contracts.ts';
import type { ContractStatus } from './contracts.ts';
import type { Contract, ContractCategory } from './types.ts';

/*
 * "Tarif-Check": a clearly labelled partner link to a comparison portal, shown on a
 * contract at the moment the household can actually switch. The links come from the
 * build environment (NESTLY_OFFERS) and carry only the partner id — no user data.
 */

/** Contract kinds where switching provider is common and comparison portals exist. */
export const SWITCHABLE_CATEGORIES: readonly ContractCategory[] = ['electricity', 'gas', 'internet', 'phone', 'liability', 'insurance'];

/**
 * - `deadline`: the cancellation deadline is close (inside the reminder window)
 * - `anyTime`: past the minimum term, the contract can be ended any time
 * - `cancelled`: cancelled but still running — the household needs a follow-up contract
 */
export type OfferReason = 'deadline' | 'anyTime' | 'cancelled';

/** Partner link per contract category. */
export type OfferLinks = Partial<Record<ContractCategory, string>>;

/**
 * Whether a "compare tariffs" hint helps for this contract right now, and why.
 * Never during a running minimum term far from its deadline: the hint must be
 * actionable, not a nag.
 */
export function offerReason(c: Contract, s: ContractStatus): OfferReason | null {
  if (!SWITCHABLE_CATEGORIES.includes(c.category)) return null;
  if (s.phase === 'ended') return null;
  if (s.phase === 'cancelled') return 'cancelled';
  if (cancellableAnyTime(s)) return 'anyTime';
  const days = deadlineDaysLeft(s);
  if (days != null && (s.urgency === 'soon' || s.urgency === 'urgent')) return 'deadline';
  return null;
}

/**
 * Keeps only absolute https links for switchable categories. Input is untrusted
 * configuration (a JSON object from the environment); anything else is dropped.
 */
export function sanitizeOfferLinks(input: unknown): OfferLinks {
  const out: OfferLinks = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!SWITCHABLE_CATEGORIES.includes(key as ContractCategory) || typeof value !== 'string') continue;
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    out[key as ContractCategory] = url.href;
  }
  return out;
}
