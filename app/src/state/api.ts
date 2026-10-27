import type { Change, ID } from '../../../core/src/types.ts';
import { prefs } from './prefs.ts';

/* HTTP client for the Nestly sync server (see docs/SYNC_PROTOCOL.md). */

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

declare global {
  interface Window {
    NESTLY_CONFIG?: { serverUrl?: string };
  }
}

function clean(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function request<T>(base: string, path: string, init: RequestInit & { token?: string; timeout?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeout ?? 15_000);
  let res: Response;
  try {
    res = await fetch(clean(base) + path, { ...init, headers, signal: ctrl.signal });
  } catch (err) {
    throw new ApiError(0, 'network', (err as Error)?.message);
  } finally {
    clearTimeout(timer);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'http_' + res.status, body?.message);
  return body as T;
}

export async function health(base: string): Promise<boolean> {
  try {
    const r = await request<{ ok: boolean }>(base, '/api/health', { timeout: 4000 });
    return !!r?.ok;
  } catch {
    return false;
  }
}

let resolved: Promise<string | null> | null = null;

/**
 * Finds a sync server: build-time config, then the page's own origin (when the
 * app is served by the Nestly server), then a user-provided URL.
 */
export function resolveServer(force = false): Promise<string | null> {
  if (resolved && !force) return resolved;
  resolved = (async () => {
    const candidates = [window.NESTLY_CONFIG?.serverUrl, location.protocol.startsWith('http') ? location.origin : undefined, prefs.serverUrl].filter(
      (u): u is string => !!u,
    );
    for (const c of candidates) if (await health(c)) return clean(c);
    return null;
  })();
  return resolved;
}

export interface CreateResult {
  token: string;
  inviteCode: string;
  cursor: number;
}

export function createHousehold(base: string, householdId: ID, memberId: ID, changes: Change[]): Promise<CreateResult> {
  return request(base, '/api/households', { method: 'POST', body: JSON.stringify({ householdId, memberId, changes }) });
}

export interface InvitePreview {
  householdId: ID;
  name: string;
  emoji: string;
  members: { id: ID; name: string; emoji?: string; color: string; claimed: boolean }[];
}

export function previewInvite(base: string, code: string): Promise<InvitePreview> {
  return request(base, `/api/invites/${encodeURIComponent(code)}`);
}

export function joinHousehold(base: string, code: string, memberId: ID, changes: Change[]): Promise<{ householdId: ID; memberId: ID; token: string; cursor: number }> {
  return request(base, `/api/invites/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ memberId, changes }) });
}

export interface SyncResult {
  changes: Change[];
  cursor: number;
  more: boolean;
}

export function sync(base: string, householdId: ID, token: string, since: number, changes: Change[]): Promise<SyncResult> {
  return request(base, `/api/households/${householdId}/sync`, { method: 'POST', token, body: JSON.stringify({ since, changes }), timeout: 30_000 });
}

export function getInvite(base: string, householdId: ID, token: string): Promise<{ inviteCode: string }> {
  return request(base, `/api/households/${householdId}/invite`, { token });
}

export function rotateInvite(base: string, householdId: ID, token: string): Promise<{ inviteCode: string }> {
  return request(base, `/api/households/${householdId}/invite`, { method: 'POST', token });
}

export function leave(base: string, householdId: ID, token: string): Promise<unknown> {
  return request(base, `/api/households/${householdId}/leave`, { method: 'POST', token, timeout: 5000 });
}

export function releaseMember(base: string, householdId: ID, token: string, memberId: ID): Promise<{ ok: boolean; revoked: number }> {
  return request(base, `/api/households/${householdId}/release`, { method: 'POST', token, body: JSON.stringify({ memberId }) });
}

export function pushKey(base: string): Promise<{ publicKey: string }> {
  return request(base, '/api/push/key');
}

export function subscribePush(base: string, householdId: ID, token: string, subscription: PushSubscriptionJSON, lang: string): Promise<unknown> {
  return request(base, `/api/households/${householdId}/push`, { method: 'POST', token, body: JSON.stringify({ subscription, lang }) });
}

export function unsubscribePush(base: string, householdId: ID, token: string, endpoint: string): Promise<unknown> {
  return request(base, `/api/households/${householdId}/push`, { method: 'DELETE', token, body: JSON.stringify({ endpoint }), timeout: 5000 });
}

export function eventsUrl(base: string, householdId: ID, token: string): string {
  return `${clean(base)}/api/households/${householdId}/events?token=${encodeURIComponent(token)}`;
}
