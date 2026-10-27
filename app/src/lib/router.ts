import { scheduleRender } from './ui.ts';

/*
 * Hash router (works on any static host) plus a sheet stack that cooperates with
 * the browser/Android back button: opening a sheet pushes a history entry, the
 * back gesture closes it.
 */

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const clean = '/' + (path ?? '').split('/').filter(Boolean).join('/');
  return { path: clean, segments: clean.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

let current = parse();
/** Number of in-app navigations, so "back" knows whether history has a previous app page. */
let depth = 0;
let direction: 'forward' | 'back' | 'none' = 'none';
/** Set while a hash change initiated by `navigate` is in flight. */
let pendingNav = false;

export function getRoute(): Route {
  return current;
}

export function navDirection(): 'forward' | 'back' | 'none' {
  return direction;
}

export function navigate(path: string, opts: { replace?: boolean; fade?: boolean } = {}): void {
  if (sheets.length) {
    closeAllSheets().then(() => navigate(path, opts));
    return;
  }
  const target = '#' + path;
  if (location.hash === target) return;
  // Query-only changes (e.g. switching a tab) are not page transitions.
  if (path.split('?')[0] !== current.path) direction = opts.fade ? 'none' : 'forward';
  if (opts.replace) {
    history.replaceState(history.state, '', target);
    current = parse();
    scheduleRender();
  } else {
    depth++;
    pendingNav = true;
    location.hash = path;
  }
}

/** Goes back in history if we navigated inside the app, otherwise to `fallback`. */
export function goBack(fallback = '/'): void {
  if (sheets.length) {
    closeTopSheet();
    return;
  }
  if (depth > 0) {
    history.back();
  } else {
    direction = 'back';
    history.replaceState(history.state, '', '#' + fallback);
    current = parse();
    scheduleRender();
  }
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

export interface SheetEntry {
  id: number;
  render: () => any;
  closing: boolean;
  /** Visual style: bottom sheet or centered dialog. */
  kind: 'sheet' | 'dialog';
  onClose?: () => void;
}

export const sheets: SheetEntry[] = [];
let sheetSeq = 0;
let closeWaiters: (() => void)[] = [];
const CLOSE_MS = 220;

export function openSheet(render: () => any, opts: { kind?: 'sheet' | 'dialog'; onClose?: () => void } = {}): number {
  const id = ++sheetSeq;
  sheets.push({ id, render, closing: false, kind: opts.kind ?? 'sheet', onClose: opts.onClose });
  history.pushState({ sheet: id }, '', location.href);
  scheduleRender();
  return id;
}

/** Closes the top sheet via history so the back stack stays consistent. */
export function closeTopSheet(): Promise<void> {
  if (!sheets.length) return Promise.resolve();
  return new Promise((resolve) => {
    closeWaiters.push(resolve);
    history.back();
  });
}

export async function closeAllSheets(): Promise<void> {
  while (sheets.length) await closeTopSheet();
}

function dismissTop(): void {
  const top = [...sheets].reverse().find((s) => !s.closing);
  if (!top) return;
  top.closing = true;
  scheduleRender();
  setTimeout(() => {
    const i = sheets.indexOf(top);
    if (i >= 0) sheets.splice(i, 1);
    top.onClose?.();
    scheduleRender();
    const waiters = closeWaiters;
    closeWaiters = [];
    waiters.forEach((w) => w());
  }, CLOSE_MS);
}

window.addEventListener('popstate', (e) => {
  const openIds = sheets.filter((s) => !s.closing).map((s) => s.id);
  const stateSheet = (e.state && e.state.sheet) as number | undefined;
  if (openIds.length && (stateSheet === undefined || stateSheet < openIds[openIds.length - 1]!)) {
    dismissTop();
    return;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheets.some((s) => !s.closing)) {
    e.preventDefault();
    void closeTopSheet();
  }
});

window.addEventListener('hashchange', () => {
  if (pendingNav) {
    direction = 'forward';
  } else {
    direction = 'back';
    depth = Math.max(0, depth - 1);
  }
  pendingNav = false;
  current = parse();
  scheduleRender();
});
