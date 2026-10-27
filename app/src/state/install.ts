import { scheduleRender } from '../lib/ui.ts';

/* PWA installation helpers: Android/desktop install prompt and iOS detection. */

let deferredPrompt: any = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  scheduleRender();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  scheduleRender();
});

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Can we offer installation on this device (prompt or iOS instructions)? */
export function canInstall(): boolean {
  return !isStandalone() && (!!deferredPrompt || isIOS());
}

export function hasNativePrompt(): boolean {
  return !!deferredPrompt;
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  scheduleRender();
  return choice?.outcome === 'accepted';
}
