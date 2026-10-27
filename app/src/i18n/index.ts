import { de } from './de.ts';
import { en } from './en.ts';

export type Key = keyof typeof de;
export type Dict = Record<Key, string>;
export type Lang = 'de' | 'en';

/** Keys that come in `_one` / `_other` pairs. */
export type PluralKey = Key extends infer K ? (K extends `${infer B}_one` ? B : never) : never;

let lang: Lang = 'de';
let dict: Dict = de;

export function detectLang(): Lang {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const code = l.toLowerCase().slice(0, 2);
    if (code === 'de') return 'de';
    if (code === 'en') return 'en';
  }
  return 'de';
}

export function setLang(l: Lang): void {
  lang = l;
  dict = l === 'en' ? en : de;
  document.documentElement.lang = l;
}

export function getLang(): Lang {
  return lang;
}

/** BCP-47 locale used for Intl formatting. */
export function intlLocale(): string {
  return lang === 'de' ? 'de-DE' : 'en-GB';
}

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function t(key: Key, params?: Record<string, string | number>): string {
  return interpolate(dict[key] ?? de[key] ?? key, params);
}

const pluralRules: Record<Lang, Intl.PluralRules> = {
  de: new Intl.PluralRules('de'),
  en: new Intl.PluralRules('en'),
};

export function tp(key: PluralKey, n: number, params?: Record<string, string | number>): string {
  const form = pluralRules[lang].select(n) === 'one' ? 'one' : 'other';
  return t(`${key}_${form}` as Key, { n, ...params });
}
