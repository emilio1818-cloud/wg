import { scheduleRender } from '../lib/ui.ts';

/** Device-local preferences (not synced). Stored in localStorage so the theme applies before first paint. */
export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  locale: 'auto' | 'de' | 'en';
  /** Browser notifications for activity of roommates. */
  notify: boolean;
  /** How often items were added per list kind — powers quick-add suggestions. */
  itemHistory: Record<string, number>;
  /** Last activity timestamp the user has seen (for the bell badge). */
  activitySeenAt: number;
  /** Home tips the user dismissed. */
  dismissed: string[];
  /** Fallback sync server for static hosting (e.g. GitHub Pages). */
  serverUrl?: string;
}

const KEY = 'nestly:prefs';

const defaults: Prefs = { theme: 'system', locale: 'auto', notify: false, itemHistory: {}, activitySeenAt: 0, dismissed: [] };

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export const prefs: Prefs = load();

export function setPrefs(patch: Partial<Prefs>): void {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage full or disabled — preferences stay in memory */
  }
  if ('theme' in patch) applyTheme();
  scheduleRender();
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function isDark(): boolean {
  return prefs.theme === 'dark' || (prefs.theme === 'system' && !!media?.matches);
}

export function applyTheme(): void {
  const dark = isDark();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0a11' : '#f4f3f9');
}

media?.addEventListener('change', () => {
  applyTheme();
  scheduleRender();
});
