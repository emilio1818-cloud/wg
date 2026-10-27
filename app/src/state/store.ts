import { COLLECTIONS } from '../../../core/src/types.ts';
import type { Change, CollectionName, Collections, ID } from '../../../core/src/types.ts';
import { kvDelete, kvGet, kvSet } from '../lib/idb.ts';
import { scheduleRender } from '../lib/ui.ts';

/*
 * Local-first data store. Holds every record of the active household (including
 * tombstones), tracks unsynced ("dirty") records, persists to IndexedDB and
 * triggers a re-render on every change.
 */

export interface Session {
  householdId: ID;
  memberId: ID;
  /** local = this device only · cloud = synced via server · demo = sample data */
  mode: 'local' | 'cloud' | 'demo';
  serverUrl?: string;
  token?: string;
  inviteCode?: string;
  cursor: number;
}

export type Tables = { [C in CollectionName]: Map<ID, Collections[C]> };

type Entity<C extends CollectionName> = Collections[C];

interface Snapshot {
  tables: { [C in CollectionName]?: Entity<C>[] };
  dirty: string[];
}

function emptyTables(): Tables {
  const t = {} as Record<CollectionName, Map<ID, unknown>>;
  for (const c of COLLECTIONS) t[c] = new Map();
  return t as Tables;
}

const listeners = new Set<(c: CollectionName) => void>();
const writeListeners = new Set<() => void>();

export const store = {
  session: null as Session | null,
  tables: emptyTables(),
  dirty: new Set<string>(),
  /** Bumped on every change of a collection; used to memoise derived data. */
  versions: Object.fromEntries(COLLECTIONS.map((c) => [c, 0])) as Record<CollectionName, number>,
  loaded: false,
};

const listCache = new Map<CollectionName, { v: number; list: unknown[] }>();

/** Live (non-deleted) records of a collection. Cached until the collection changes. */
export function list<C extends CollectionName>(c: C): Entity<C>[] {
  const v = store.versions[c];
  const hit = listCache.get(c);
  if (hit && hit.v === v) return hit.list as Entity<C>[];
  const out: Entity<C>[] = [];
  for (const e of store.tables[c].values()) if (!e.deleted) out.push(e as Entity<C>);
  listCache.set(c, { v, list: out });
  return out;
}

export function get<C extends CollectionName>(c: C, id: ID | undefined | null): Entity<C> | undefined {
  if (!id) return undefined;
  const e = store.tables[c].get(id) as Entity<C> | undefined;
  return e && !e.deleted ? e : undefined;
}

/** Including tombstones. */
export function getRaw<C extends CollectionName>(c: C, id: ID): Entity<C> | undefined {
  return store.tables[c].get(id) as Entity<C> | undefined;
}

/** Monotonic clock so consecutive writes on one device always increase. */
let lastClock = 0;
export function clock(): number {
  const now = Date.now();
  lastClock = now > lastClock ? now : lastClock + 1;
  return lastClock;
}

function changed(c: CollectionName): void {
  store.versions[c]++;
  for (const l of listeners) l(c);
  schedulePersist();
  scheduleRender();
}

/** Inserts or replaces a record (stamps `updatedAt`, marks it for sync). */
export function put<C extends CollectionName>(c: C, entity: Entity<C>): Entity<C> {
  const prev = store.tables[c].get(entity.id);
  const u = Math.max(clock(), (prev?.updatedAt ?? 0) + 1);
  const next = { ...entity, updatedAt: u } as Entity<C>;
  if (!next.createdAt) next.createdAt = u;
  if (!next.createdBy && store.session) next.createdBy = store.session.memberId;
  store.tables[c].set(entity.id, next as never);
  store.dirty.add(`${c}:${entity.id}`);
  changed(c);
  for (const l of writeListeners) l();
  return next;
}

export function update<C extends CollectionName>(c: C, id: ID, patch: Partial<Entity<C>>): Entity<C> | undefined {
  const prev = store.tables[c].get(id) as Entity<C> | undefined;
  if (!prev) return undefined;
  return put(c, { ...prev, ...patch });
}

/** Soft delete (tombstone). Returns an undo function. */
export function remove<C extends CollectionName>(c: C, id: ID): () => void {
  const prev = store.tables[c].get(id) as Entity<C> | undefined;
  if (!prev || prev.deleted) return () => {};
  put(c, { ...prev, deleted: true });
  return () => {
    const cur = store.tables[c].get(id) as Entity<C> | undefined;
    if (cur) put(c, { ...cur, deleted: false });
  };
}

/** Applies records from the server using last-write-wins. Returns the number applied. */
export function applyRemote(changes: Change[]): number {
  const touched = new Set<CollectionName>();
  let applied = 0;
  for (const ch of changes) {
    if (!COLLECTIONS.includes(ch.c)) continue;
    const table = store.tables[ch.c];
    const local = table.get(ch.id);
    if (local) {
      if (local.updatedAt > ch.u) continue;
      if (local.updatedAt === ch.u && JSON.stringify(local) >= JSON.stringify(ch.data)) continue;
    }
    table.set(ch.id, { ...(ch.data as object), updatedAt: ch.u } as never);
    if (ch.u > lastClock) lastClock = ch.u;
    store.dirty.delete(`${ch.c}:${ch.id}`);
    touched.add(ch.c);
    applied++;
  }
  for (const c of touched) changed(c);
  return applied;
}

/** Collects unsynced records for upload. */
export function pendingChanges(limit = 1500): Change[] {
  const out: Change[] = [];
  for (const key of store.dirty) {
    if (out.length >= limit) break;
    const i = key.indexOf(':');
    const c = key.slice(0, i) as CollectionName;
    const id = key.slice(i + 1);
    const e = store.tables[c]?.get(id);
    if (!e) {
      store.dirty.delete(key);
      continue;
    }
    out.push({ c, id, u: e.updatedAt, data: e as unknown as Record<string, unknown> });
  }
  return out;
}

/** Marks uploaded records as clean unless they changed again during the upload. */
export function markSynced(sent: Change[]): void {
  for (const ch of sent) {
    const e = store.tables[ch.c].get(ch.id);
    if (e && e.updatedAt === ch.u) store.dirty.delete(`${ch.c}:${ch.id}`);
  }
  schedulePersist();
}

export function onChange(fn: (c: CollectionName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called after every local write (not for records applied from the server). */
export function onLocalWrite(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 250);
}

export async function persistNow(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const snapshot: Snapshot = { tables: {}, dirty: [...store.dirty] };
  for (const c of COLLECTIONS) (snapshot.tables as Record<string, unknown[]>)[c] = [...store.tables[c].values()];
  try {
    await kvSet('session', s);
    await kvSet(`data:${s.householdId}`, snapshot);
  } catch (err) {
    console.warn('persist failed', err);
  }
}

export async function loadPersisted(): Promise<boolean> {
  const session = await kvGet<Session>('session');
  if (!session) {
    store.loaded = true;
    scheduleRender();
    return false;
  }
  const snap = await kvGet<Snapshot>(`data:${session.householdId}`);
  store.session = session;
  store.tables = emptyTables();
  if (snap) {
    for (const c of COLLECTIONS) {
      for (const e of snap.tables[c] ?? []) {
        store.tables[c].set(e.id, e as never);
        if (e.updatedAt > lastClock) lastClock = e.updatedAt;
      }
    }
    store.dirty = new Set(snap.dirty);
  }
  for (const c of COLLECTIONS) store.versions[c]++;
  store.loaded = true;
  scheduleRender();
  return true;
}

/** Starts a fresh household on this device (replacing any previous one). */
export function resetStore(session: Session | null): void {
  const old = store.session;
  store.session = session;
  store.tables = emptyTables();
  store.dirty = new Set();
  for (const c of COLLECTIONS) store.versions[c]++;
  listCache.clear();
  if (old && (!session || old.householdId !== session.householdId)) void kvDelete(`data:${old.householdId}`);
  if (!session) void kvDelete('session');
  schedulePersist();
  scheduleRender();
}

export function setSession(patch: Partial<Session>): void {
  if (!store.session) return;
  store.session = { ...store.session, ...patch };
  schedulePersist();
  scheduleRender();
}
