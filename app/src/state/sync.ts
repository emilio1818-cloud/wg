import type { Activity } from '../../../core/src/types.ts';
import { scheduleRender } from '../lib/ui.ts';
import { t } from '../i18n/index.ts';
import * as api from './api.ts';
import { prefs } from './prefs.ts';
import { applyRemote, list, markSynced, onLocalWrite, pendingChanges, setSession, store } from './store.ts';

/*
 * Sync engine: pushes dirty records and pulls new ones in a single round trip,
 * reacts to server-sent events from roommates and retries with backoff when offline.
 */

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'unauthorized';

export const syncState = {
  status: 'idle' as SyncStatus,
  lastSync: 0,
};

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let source: EventSource | null = null;
const afterSyncHooks: (() => void)[] = [];

export function onAfterSync(fn: () => void): void {
  afterSyncHooks.push(fn);
}

function setStatus(s: SyncStatus): void {
  if (syncState.status !== s) {
    syncState.status = s;
    scheduleRender();
  }
}

export function isCloud(): boolean {
  const s = store.session;
  return !!s && s.mode === 'cloud' && !!s.token && !!s.serverUrl;
}

export function scheduleSync(delay = 400): void {
  if (!isCloud()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, delay);
}

export async function syncNow(): Promise<void> {
  const s = store.session;
  if (!s || !isCloud()) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus('syncing');
  const seenActivity = new Set(list('activity').map((a) => a.id));
  try {
    let since = s.cursor;
    for (let round = 0; round < 50; round++) {
      const pending = pendingChanges();
      const res = await api.sync(s.serverUrl!, s.householdId, s.token!, since, pending);
      markSynced(pending);
      applyRemote(res.changes);
      since = res.cursor;
      setSession({ cursor: since });
      if (!res.more && store.dirty.size === 0) break;
      if (!res.more && pendingChanges(1).length === 0) break;
    }
    failures = 0;
    syncState.lastSync = Date.now();
    setStatus('idle');
    notifyNewActivity(seenActivity);
    for (const fn of afterSyncHooks) fn();
  } catch (err) {
    const e = err as api.ApiError;
    if (e.status === 401) {
      setStatus('unauthorized');
    } else {
      failures++;
      setStatus(e.status === 0 ? 'offline' : 'error');
      // Exponential backoff up to 2 minutes.
      const delay = Math.min(120_000, 2000 * 2 ** Math.min(failures, 6));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), delay);
    }
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(200);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Realtime                                                            */
/* ------------------------------------------------------------------ */

function connectEvents(): void {
  disconnectEvents();
  const s = store.session;
  if (!s || !isCloud() || typeof EventSource === 'undefined') return;
  source = new EventSource(api.eventsUrl(s.serverUrl!, s.householdId, s.token!));
  source.addEventListener('sync', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data);
      if (data.by !== s.memberId && data.cursor > (store.session?.cursor ?? 0)) scheduleSync(50);
    } catch {
      scheduleSync(50);
    }
  });
  source.addEventListener('hello', (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data);
      if (data.cursor > (store.session?.cursor ?? 0)) scheduleSync(50);
    } catch {
      /* ignore */
    }
  });
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) {
      disconnectEvents();
      setTimeout(connectEvents, 10_000);
    }
  };
}

function disconnectEvents(): void {
  source?.close();
  source = null;
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

let describeActivity: ((a: Activity) => string) | null = null;

export function setActivityDescriber(fn: (a: Activity) => string): void {
  describeActivity = fn;
}

function notifyNewActivity(seen: Set<string>): void {
  if (!prefs.notify || prefs.pushEndpoint || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const me = store.session?.memberId;
  const fresh = list('activity').filter((a) => !seen.has(a.id) && a.actorId !== me && Date.now() - a.createdAt < 10 * 60_000);
  for (const a of fresh.slice(-3)) {
    const body = describeActivity ? describeActivity(a) : t('activity.title');
    navigator.serviceWorker?.ready
      .then((reg) => reg.showNotification('Nestly', { body, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', tag: a.id }))
      .catch(() => {
        try {
          new Notification('Nestly', { body });
        } catch {
          /* ignore */
        }
      });
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

let started = false;

/** (Re)starts syncing for the current session. Safe to call repeatedly. */
export function startSync(): void {
  if (!started) {
    started = true;
    onLocalWrite(() => scheduleSync());
    window.addEventListener('online', () => {
      failures = 0;
      void syncNow();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNow();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') void syncNow();
    }, 60_000);
  }
  if (isCloud()) {
    connectEvents();
    void syncNow();
  } else {
    disconnectEvents();
  }
}

export function stopSync(): void {
  disconnectEvents();
  if (timer) clearTimeout(timer);
  timer = null;
  setStatus('idle');
}
