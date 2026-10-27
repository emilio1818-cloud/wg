import { detectLang, setLang } from '../i18n/index.ts';
import { prefs } from './prefs.ts';

/** Applies the language preference (or the browser language for "auto"). */
export function applyLanguage(): void {
  setLang(prefs.locale === 'auto' ? detectLang() : prefs.locale);
}
