const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Random URL-safe id (base62, ~95 bits for the default length). */
export function uid(length = 16): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 62];
  return out;
}

/** Normalises user-typed invite codes: uppercase, no spaces or dashes. */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/** "K7Q9XM" → "K7Q-9XM" */
export function formatInviteCode(code: string): string {
  const c = normalizeInviteCode(code);
  return c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}
