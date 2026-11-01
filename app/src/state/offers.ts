import { sanitizeOfferLinks } from '../../../core/src/offers.ts';
import type { OfferLinks } from '../../../core/src/offers.ts';
import type { ContractCategory } from '../../../core/src/types.ts';
import { prefs } from './prefs.ts';

/* Tarif-Check partner links and legal pages, both configured at build time (scripts/build.mjs). */

let links: OfferLinks | null = null;

function offerLinks(): OfferLinks {
  links ??= sanitizeOfferLinks(window.NESTLY_CONFIG?.offers);
  return links;
}

/** True when this build ships partner links at all (controls the settings switch). */
export function offersConfigured(): boolean {
  return Object.keys(offerLinks()).length > 0;
}

/** The partner link for a category, or null when none is configured or the user switched hints off. */
export function offerLink(category: ContractCategory): string | null {
  if (prefs.offers === false) return null;
  return offerLinks()[category] ?? null;
}

/** True when imprint and privacy policy were rendered into this build. */
export function legalPagesAvailable(): boolean {
  return window.NESTLY_CONFIG?.legal === true;
}
