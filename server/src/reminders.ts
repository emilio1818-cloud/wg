/**
 * Daily reminder selection: which chores and contract deadlines to remind a
 * member of, and the household's local date/hour. Pure functions over the
 * (untrusted) record data stored by the sync server.
 */
import { choreState, isAway } from '../../core/src/chores.ts';
import { contractStatus } from '../../core/src/contracts.ts';
import { isValidDate } from '../../core/src/dates.ts';
import type { CalendarEvent, Chore, Contract, ISODate, Member } from '../../core/src/types.ts';
import type { ReminderContent } from './push-text.ts';

export const DEFAULT_TIMEZONE = 'Europe/Berlin';

type Data = Record<string, unknown>;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f) return f;
  try {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return null; // not an IANA zone; invalid names are not cached
  }
  formatters.set(timeZone, f);
  return f;
}

/** Local calendar date and hour (0–23) at `now` in `timeZone` (falls back to Europe/Berlin). */
export function localDateHour(now: Date, timeZone: unknown): { date: ISODate; hour: number } {
  const f = (typeof timeZone === 'string' && timeZone && formatter(timeZone)) || formatter(DEFAULT_TIMEZONE)!;
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(now)) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** Household data needed to pick reminders, read once per household and run. */
export interface ReminderData {
  members: Data[];
  chores: Data[];
  contracts: Data[];
  events: Data[];
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** Contract deadlines (same for every member) that fall within the next three days. */
export function dueDeadlines(contracts: Data[], date: ISODate): ReminderContent['deadlines'] {
  const deadlines: ReminderContent['deadlines'] = [];
  for (const c of contracts) {
    if (c.deleted === true || !(isString(c.name) || isString(c.provider))) continue;
    let status;
    try {
      status = contractStatus(c as unknown as Contract, date);
    } catch {
      continue; // malformed dates
    }
    const daysLeft = status.daysLeft;
    if (daysLeft == null || daysLeft > 3) continue;
    if (daysLeft >= 1 || status.urgency === 'urgent') {
      deadlines.push({ name: String(c.name || c.provider), daysLeft });
    }
  }
  return deadlines.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));
}

/** Chores due today or overdue for `memberId`: assigned to them, or open to anyone in the pool. */
export function dueChores(data: ReminderData, memberId: string, date: ISODate): string[] {
  const member = data.members.find((m) => m.id === memberId) as Member | undefined;
  if (member && (member.deleted || member.leftAt)) return [];
  const events = data.events.filter((e) => e.deleted !== true && Array.isArray(e.memberIds)) as unknown as CalendarEvent[];
  if (member && isAway(member, date, events)) return [];
  const due: { title: string; dueDate: string }[] = [];
  for (const raw of data.chores) {
    const c = raw as unknown as Chore;
    if (c.deleted || c.paused || !isString(c.title) || !c.title.trim() || !isValidDate(c.dueDate)) continue;
    const state = choreState(c, date);
    if (state !== 'today' && state !== 'overdue') continue;
    const pool = Array.isArray(c.memberIds) ? c.memberIds : [];
    const open = c.rotation === 'anyone' || !c.assigneeId;
    if (open ? pool.length === 0 || pool.includes(memberId) : c.assigneeId === memberId) {
      due.push({ title: c.title.trim(), dueDate: c.dueDate });
    }
  }
  return due.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title)).map((c) => c.title);
}
