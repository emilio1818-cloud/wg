/**
 * Notification texts for Web Push (German default, English). Records come from
 * clients, so every field is checked before use.
 */
import { formatMoney } from '../../core/src/money.ts';
import type { Activity } from '../../core/src/types.ts';

export type Lang = 'de' | 'en';

/** What the service worker shows: `{ title, body, tag, url }`. */
export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export interface HouseholdInfo {
  name: string;
  emoji: string;
  currency: string;
  /** member id → display name */
  memberNames: ReadonlyMap<string, string>;
}

export interface ReminderContent {
  /** Titles of chores due today (or overdue). */
  chores: string[];
  /** Contracts whose cancellation deadline is close. */
  deadlines: { name: string; daysLeft: number }[];
}

const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 600;
const MAX_REMINDER_CHORES = 6;

export function normalizeLang(value: unknown): Lang {
  return typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en' : 'de';
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join('').trimEnd() + '…' : text;
}

function quote(lang: Lang, text: string): string {
  const t = clip(text.replace(/\s+/g, ' '), MAX_TITLE_CHARS);
  return lang === 'de' ? `„${t}“` : `“${t}”`;
}

export function money(cents: number, currency: string, lang: Lang): string {
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  try {
    return formatMoney(Math.round(cents), currency || 'EUR', locale);
  } catch {
    // Unknown currency code in the household record.
    return formatMoney(Math.round(cents), 'EUR', locale);
  }
}

/** Notification title: household emoji + name. */
export function householdTitle(info: HouseholdInfo): string {
  return clip(`${info.emoji} ${info.name}`.trim(), MAX_TITLE_CHARS) || 'Nestly';
}

function memberName(info: HouseholdInfo, id: unknown, lang: Lang): string {
  const name = typeof id === 'string' ? info.memberNames.get(id)?.trim() : undefined;
  return clip(name || (lang === 'de' ? 'Jemand' : 'Someone'), 40);
}

const ACTIVITY_URLS: Partial<Record<Activity['type'], string>> = {
  expense_added: './#/money?tab=history',
  transfer_added: './#/money?tab=history',
  chore_done: './#/chores',
  items_added: './#/shopping',
  items_bought: './#/shopping',
  event_added: './#/wg/calendar',
  note_added: './#/wg/board',
  contract_added: './#/wg/contracts',
  member_joined: './#/activity',
};

/**
 * Push text for an activity record as seen by `recipientId`, or null for
 * types that do not notify (edits, automatic bookings, …).
 */
export function activityMessage(
  activity: Record<string, unknown>,
  info: HouseholdInfo,
  recipientId: string,
  lang: Lang,
): PushMessage | null {
  const type = activity.type as Activity['type'];
  const url = typeof type === 'string' ? ACTIVITY_URLS[type] : undefined;
  if (!url) return null;
  const de = lang === 'de';
  const name = memberName(info, activity.actorId, lang);
  const title = str(activity.title);
  const amount = num(activity.amount);
  const count = num(activity.count);
  const amountText = amount !== null ? money(amount, info.currency, lang) : '';

  let body: string;
  switch (type) {
    case 'expense_added':
      body = de
        ? `${name} hat ${title ? quote(lang, title) : 'eine Ausgabe'} eingetragen`
        : `${name} added ${title ? quote(lang, title) : 'an expense'}`;
      if (amountText) body += ` · ${amountText}`;
      break;
    case 'transfer_added': {
      const what = amountText || (de ? 'Geld' : 'money');
      if (activity.targetId === recipientId) body = de ? `${name} hat dir ${what} gezahlt` : `${name} paid you ${what}`;
      else {
        const to = memberName(info, activity.targetId, lang);
        body = de ? `${name} hat ${to} ${what} gezahlt` : `${name} paid ${to} ${what}`;
      }
      break;
    }
    case 'chore_done':
      body = de
        ? `${name} hat ${title ? quote(lang, title) : 'eine Aufgabe'} erledigt`
        : `${name} did ${title ? quote(lang, title) : 'a chore'}`;
      if (str(activity.emoji)) body += ` ${clip(str(activity.emoji), 8)}`;
      break;
    case 'items_added': {
      const n = count ?? 1;
      if (n <= 1 && title) body = de ? `${name} braucht ${quote(lang, title)}` : `${name} needs ${quote(lang, title)}`;
      else body = de ? `${name} hat ${n} Artikel auf die Liste gesetzt` : `${name} added ${n} items to the list`;
      break;
    }
    case 'items_bought': {
      const n = count ?? 0;
      body = de ? `${name} war einkaufen (${n} Artikel)` : `${name} went shopping (${n} ${n === 1 ? 'item' : 'items'})`;
      if (amountText) body += ` · ${amountText}`;
      break;
    }
    case 'event_added':
      body = de
        ? `${name} hat ${title ? quote(lang, title) : 'einen Termin'} in den Kalender eingetragen`
        : `${name} added ${title ? quote(lang, title) : 'an event'} to the calendar`;
      break;
    case 'note_added':
      body = de ? `${name} hat etwas an die Pinnwand gehängt` : `${name} pinned something to the board`;
      break;
    case 'contract_added':
      body = de
        ? `${name} hat ${title ? `den Vertrag ${quote(lang, title)}` : 'einen Vertrag'} angelegt`
        : `${name} added ${title ? `the contract ${quote(lang, title)}` : 'a contract'}`;
      break;
    case 'member_joined':
      body = de ? `${name} ist der WG beigetreten 👋` : `${name} joined the flat 👋`;
      break;
    default:
      return null;
  }
  const actor = typeof activity.actorId === 'string' ? activity.actorId : '';
  return { title: householdTitle(info), body: clip(body, MAX_BODY_CHARS), tag: `act-${type}-${actor}`, url };
}

function deadlineLine(name: string, daysLeft: number, lang: Lang): string {
  const n = clip(name.replace(/\s+/g, ' '), MAX_TITLE_CHARS);
  if (lang === 'de') {
    const when = daysLeft <= 0 ? 'heute' : daysLeft === 1 ? 'morgen' : `in ${daysLeft} Tagen`;
    return `Kündigungsfrist ${n} ${when}`;
  }
  const when = daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
  return `Cancellation deadline for ${n} ${when}`;
}

/** The daily reminder, or null if nothing is due. */
export function reminderMessage(content: ReminderContent, info: HouseholdInfo, lang: Lang): PushMessage | null {
  const chores = content.chores.map((c) => clip(c.replace(/\s+/g, ' '), MAX_TITLE_CHARS)).filter(Boolean);
  if (chores.length === 0 && content.deadlines.length === 0) return null;
  const de = lang === 'de';
  const lines: string[] = [];
  if (chores.length > 0) {
    const shown = chores.slice(0, MAX_REMINDER_CHORES);
    const extra = chores.length - shown.length;
    let line = `${de ? 'Heute dran' : 'Today'}: ${shown.join(', ')}`;
    if (extra > 0) line += de ? ` und ${extra} weitere` : ` and ${extra} more`;
    lines.push(line);
  }
  for (const d of content.deadlines) lines.push(deadlineLine(d.name, d.daysLeft, lang));
  return {
    title: householdTitle(info),
    body: clip(lines.join('\n'), MAX_BODY_CHARS),
    tag: 'reminder',
    url: chores.length > 0 ? './#/chores' : './#/wg/contracts',
  };
}
