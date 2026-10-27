import { dateToLocal, diffDays, today } from '../../../core/src/dates.ts';
import { formatMoney } from '../../../core/src/money.ts';
import type { Cents, Frequency, ISODate } from '../../../core/src/types.ts';
import { getLang, intlLocale, t, tp } from './index.ts';

let currency = 'EUR';

export function setCurrency(c: string): void {
  currency = c || 'EUR';
}

export function getCurrency(): string {
  return currency;
}

export function money(cents: Cents, opts: { sign?: boolean; compact?: boolean } = {}): string {
  return formatMoney(cents, currency, intlLocale(), opts);
}

/** Currency symbol for amount inputs ("€"). */
export function currencySymbol(): string {
  const part = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

const dateFormats: Record<string, Intl.DateTimeFormatOptions> = {
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { weekday: 'long', day: 'numeric', month: 'long' },
  dayMonth: { day: 'numeric', month: 'short' },
  dayMonthLong: { day: 'numeric', month: 'long' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
  monthYear: { month: 'long', year: 'numeric' },
  month: { month: 'short' },
  weekdayShort: { weekday: 'short' },
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();

export function fmtDate(iso: ISODate, style: keyof typeof dateFormats = 'medium'): string {
  const key = intlLocale() + style;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(), dateFormats[style]);
    dtfCache.set(key, f);
  }
  return f.format(dateToLocal(iso));
}

/** "Heute", "Morgen", "Gestern", "in 3 Tagen", otherwise a short date. */
export function relDay(iso: ISODate, base: ISODate = today()): string {
  const d = diffDays(base, iso);
  if (d === 0) return t('common.today');
  if (d === 1) return t('common.tomorrow');
  if (d === -1) return t('common.yesterday');
  if (Math.abs(d) < 7) {
    return new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' }).format(d, 'day');
  }
  return fmtDate(iso, 'weekday');
}

export function timeAgo(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto', style: 'short' });
  if (diff < 60_000) return getLang() === 'de' ? 'gerade eben' : 'just now';
  if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), 'minute');
  if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), 'hour');
  const d = new Date(ts);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return relDay(iso);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 11) return t('greet.morning');
  if (h >= 11 && h < 17) return t('greet.day');
  if (h >= 17 && h < 23) return t('greet.evening');
  return t('greet.night');
}

export function freqLabel(f: Frequency | null): string {
  if (!f) return t('freq.once');
  const { unit, every } = f;
  if (unit === 'day') return every === 1 ? t('freq.daily') : every === 2 ? t('freq.every2days') : t('freq.everyNDays', { n: every });
  if (unit === 'week') return every === 1 ? t('freq.weekly') : every === 2 ? t('freq.biweekly') : t('freq.everyNWeeks', { n: every });
  if (unit === 'month') return every === 1 ? t('freq.monthly') : every === 3 ? t('freq.quarterly') : t('freq.everyNMonths', { n: every });
  return every === 1 ? t('freq.yearly') : t('freq.everyNYears', { n: every });
}

export function unitLabel(unit: 'day' | 'week' | 'month' | 'year', n: number): string {
  return tp(`unit.${unit}`, n);
}

export function fmtDuration(n: number, unit: 'day' | 'week' | 'month' | 'year'): string {
  return `${n} ${unitLabel(unit, n)}`;
}
