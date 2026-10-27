import { addDays, addFrequency, diffDays, startOfWeek } from './dates.ts';
import type { CalendarEvent, Chore, ChoreLog, ID, ISODate, Member } from './types.ts';

export type ChoreState = 'overdue' | 'today' | 'soon' | 'later' | 'paused';

/** Is a member away (vacation mode or an "away" calendar event) on `date`? */
export function isAway(member: Member, date: ISODate, events: CalendarEvent[] = []): boolean {
  if (member.awayFrom && member.awayUntil && date >= member.awayFrom && date <= member.awayUntil) return true;
  if (member.awayFrom && !member.awayUntil && date >= member.awayFrom) return true;
  return events.some(
    (e) => !e.deleted && e.type === 'away' && e.memberIds?.includes(member.id) && date >= e.date && date <= (e.endDate ?? e.date),
  );
}

export function isActiveMember(m: Member): boolean {
  return !m.deleted && !m.leftAt;
}

/** Members of the chore pool that can take the chore on `date`, in pool order. */
export function eligibleMembers(chore: Chore, members: Member[], date: ISODate, events: CalendarEvent[] = []): Member[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const pool = chore.memberIds.length ? chore.memberIds : members.map((m) => m.id);
  return pool
    .map((id) => byId.get(id))
    .filter((m): m is Member => !!m && isActiveMember(m) && !isAway(m, date, events));
}

/** Points per member from completed chores in [from, to]. */
export function pointsByMember(logs: ChoreLog[], from?: ISODate, to?: ISODate): Map<ID, number> {
  const map = new Map<ID, number>();
  for (const l of logs) {
    if (l.deleted || l.action !== 'done') continue;
    if (from && l.date < from) continue;
    if (to && l.date > to) continue;
    map.set(l.memberId, (map.get(l.memberId) ?? 0) + l.points);
  }
  return map;
}

/** Who is next after a completion, according to the chore's rotation mode. */
export function nextAssignee(
  chore: Chore,
  completedBy: ID | undefined,
  members: Member[],
  logs: ChoreLog[],
  date: ISODate,
  events: CalendarEvent[] = [],
): ID | undefined {
  const eligible = eligibleMembers(chore, members, date, events);
  if (chore.rotation === 'anyone') return undefined;
  if (eligible.length === 0) return chore.assigneeId;
  if (chore.rotation === 'fixed') {
    return eligible.some((m) => m.id === chore.assigneeId) ? chore.assigneeId : eligible[0]!.id;
  }
  if (chore.rotation === 'fair') {
    const points = pointsByMember(logs, addDays(date, -28), date);
    const countThis = new Map<ID, number>();
    for (const l of logs) if (!l.deleted && l.choreId === chore.id && l.action === 'done') countThis.set(l.memberId, (countThis.get(l.memberId) ?? 0) + 1);
    return [...eligible].sort(
      (a, b) =>
        (points.get(a.id) ?? 0) - (points.get(b.id) ?? 0) ||
        (countThis.get(a.id) ?? 0) - (countThis.get(b.id) ?? 0) ||
        (a.id === completedBy ? 1 : 0) - (b.id === completedBy ? 1 : 0),
    )[0]!.id;
  }
  // rotate: the person after whoever did it (or after the current assignee).
  const pool = chore.memberIds.length ? chore.memberIds : members.filter(isActiveMember).map((m) => m.id);
  const ref = completedBy && pool.includes(completedBy) ? completedBy : chore.assigneeId;
  const start = ref ? pool.indexOf(ref) : -1;
  const eligibleIds = new Set(eligible.map((m) => m.id));
  for (let step = 1; step <= pool.length; step++) {
    const candidate = pool[(start + step + pool.length) % pool.length]!;
    if (eligibleIds.has(candidate)) return candidate;
  }
  return eligible[0]!.id;
}

/** Next due date after completing (or skipping) a chore on `doneOn`. */
export function nextDueDate(chore: Chore, doneOn: ISODate): ISODate | null {
  const f = chore.frequency;
  if (!f) return null;
  if (chore.fixedSchedule) {
    let next = addFrequency(chore.dueDate, f);
    for (let i = 0; i < 10_000 && next <= doneOn; i++) next = addFrequency(next, f);
    return next;
  }
  // Flexible rhythm: the next round counts from the day it was actually done.
  return addFrequency(doneOn, f);
}

export interface CompletionResult {
  /** Fields to merge into the chore, or `null` if a one-off task is finished. */
  patch: Partial<Chore> | null;
  log: Omit<ChoreLog, 'id' | 'createdAt' | 'updatedAt'>;
}

export function completeChore(
  chore: Chore,
  memberId: ID,
  date: ISODate,
  members: Member[],
  logs: ChoreLog[],
  events: CalendarEvent[] = [],
  action: 'done' | 'skipped' = 'done',
): CompletionResult {
  const log = {
    choreId: chore.id,
    memberId,
    date,
    points: action === 'done' ? chore.points : 0,
    action,
    title: chore.title,
    emoji: chore.emoji,
  };
  const due = nextDueDate(chore, date);
  if (!due) return { patch: null, log };
  const assigneeId =
    action === 'skipped' ? chore.assigneeId : nextAssignee(chore, memberId, members, [...logs, { ...log, id: '_', createdAt: 0, updatedAt: 0 }], due, events);
  return { patch: { dueDate: due, assigneeId }, log };
}

export function choreState(chore: Chore, todayDate: ISODate): ChoreState {
  if (chore.paused) return 'paused';
  const d = diffDays(todayDate, chore.dueDate);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 6) return 'soon';
  return 'later';
}

export interface LeaderboardEntry {
  memberId: ID;
  points: number;
  count: number;
}

export function leaderboard(logs: ChoreLog[], memberIds: ID[], from?: ISODate, to?: ISODate): LeaderboardEntry[] {
  const entries = new Map<ID, LeaderboardEntry>(memberIds.map((id) => [id, { memberId: id, points: 0, count: 0 }]));
  for (const l of logs) {
    if (l.deleted || l.action !== 'done') continue;
    if (from && l.date < from) continue;
    if (to && l.date > to) continue;
    const e = entries.get(l.memberId);
    if (!e) continue;
    e.points += l.points;
    e.count += 1;
  }
  return [...entries.values()].sort((a, b) => b.points - a.points || b.count - a.count);
}

/** Consecutive weeks (ending with the current or previous week) with at least one completed chore. */
export function weeklyStreak(logs: ChoreLog[], memberId: ID, todayDate: ISODate): number {
  const weeks = new Set<ISODate>();
  for (const l of logs) if (!l.deleted && l.action === 'done' && l.memberId === memberId) weeks.add(startOfWeek(l.date));
  let week = startOfWeek(todayDate);
  if (!weeks.has(week)) week = addDays(week, -7);
  let streak = 0;
  while (weeks.has(week)) {
    streak++;
    week = addDays(week, -7);
  }
  return streak;
}

/** Ready-made chores for the onboarding starter pack and quick add. */
export const CHORE_TEMPLATES: { key: string; emoji: string; points: number; frequency: Chore['frequency']; fixedSchedule?: boolean }[] = [
  { key: 'kitchen', emoji: '🍳', points: 30, frequency: { unit: 'week', every: 1 } },
  { key: 'bathroom', emoji: '🛁', points: 40, frequency: { unit: 'week', every: 1 } },
  { key: 'vacuum', emoji: '🧹', points: 30, frequency: { unit: 'week', every: 1 } },
  { key: 'trash', emoji: '🗑️', points: 10, frequency: { unit: 'week', every: 1 }, fixedSchedule: true },
  { key: 'mop', emoji: '🧽', points: 30, frequency: { unit: 'week', every: 2 } },
  { key: 'glass', emoji: '🍾', points: 20, frequency: { unit: 'week', every: 2 } },
  { key: 'bottles', emoji: '♻️', points: 20, frequency: { unit: 'week', every: 2 } },
  { key: 'paper', emoji: '📦', points: 10, frequency: { unit: 'week', every: 2 }, fixedSchedule: true },
  { key: 'dishwasher', emoji: '🍽️', points: 10, frequency: { unit: 'day', every: 2 } },
  { key: 'plants', emoji: '🪴', points: 10, frequency: { unit: 'week', every: 1 } },
  { key: 'fridge', emoji: '🧊', points: 30, frequency: { unit: 'month', every: 1 } },
  { key: 'towels', emoji: '🧺', points: 20, frequency: { unit: 'week', every: 2 } },
  { key: 'hallway', emoji: '🚪', points: 20, frequency: { unit: 'week', every: 2 } },
  { key: 'windows', emoji: '🪟', points: 50, frequency: { unit: 'month', every: 3 } },
];
