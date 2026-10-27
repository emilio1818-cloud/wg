import { getLang } from '../i18n/index.ts';
import * as api from './api.ts';
import { prefs, setPrefs } from './prefs.ts';
import { store } from './store.ts';
import { isCloud } from './sync.ts';

/*
 * Web Push: subscribes this device via the service worker and registers the
 * subscription with the sync server, which then notifies about roommates'
 * activity and sends a daily "it's your turn" reminder.
 */

export type PushResult = 'ok' | 'local' | 'denied' | 'unsupported' | 'error';

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function pushSupported(): boolean {
  return notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function notificationsEnabled(): boolean {
  return prefs.notify && notificationsSupported() && Notification.permission === 'granted';
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Creates (or reuses) the push subscription and registers it with the server. */
async function subscribe(): Promise<PushResult> {
  const s = store.session;
  if (!s || !isCloud() || !pushSupported()) return 'local';
  const reg = await registration();
  if (!reg) return 'local';
  const { publicKey } = await api.pushKey(s.serverUrl!);
  let sub = await reg.pushManager.getSubscription();
  if (sub && bytesToBase64Url(sub.options.applicationServerKey) !== publicKey) {
    // The server's VAPID key changed (e.g. a new server): start over.
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  await api.subscribePush(s.serverUrl!, s.householdId, s.token!, sub.toJSON(), getLang());
  setPrefs({ pushEndpoint: sub.endpoint });
  return 'ok';
}

export async function enableNotifications(): Promise<PushResult> {
  if (!notificationsSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  setPrefs({ notify: true });
  try {
    return await subscribe();
  } catch {
    // Push service unavailable: in-app notifications still work while the app runs.
    return 'error';
  }
}

export async function disableNotifications(): Promise<void> {
  setPrefs({ notify: false });
  const s = store.session;
  try {
    const reg = await registration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      if (s?.serverUrl && s.token) await api.unsubscribePush(s.serverUrl, s.householdId, s.token, sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
  } finally {
    setPrefs({ pushEndpoint: undefined });
  }
}

/** Re-registers an existing subscription (new household, server restart, language change). */
export async function refreshPush(): Promise<void> {
  if (!notificationsEnabled() || !isCloud()) return;
  try {
    await subscribe();
  } catch {
    /* try again next start */
  }
}
