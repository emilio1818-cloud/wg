import { completeChore as computeCompletion, CHORE_TEMPLATES } from '../../../core/src/chores.ts';
import { addDays, today } from '../../../core/src/dates.ts';
import { recurringToExpense, dueOccurrences } from '../../../core/src/recurring.ts';
import { categorizeItem, expenseCategoryForItems, parseItemInput } from '../../../core/src/shopping.ts';
import { uid } from '../../../core/src/ids.ts';
import { LIST_COLORS, MEMBER_COLORS } from '../../../core/src/categories.ts';
import type {
  Activity,
  ActivityType,
  CalendarEvent,
  Cents,
  Change,
  Chore,
  Contract,
  Expense,
  ID,
  ISODate,
  Member,
  Note,
  Recurring,
  ShoppingItem,
  ShoppingList,
} from '../../../core/src/types.ts';
import { COLLECTIONS } from '../../../core/src/types.ts';
import { t } from '../i18n/index.ts';
import * as api from './api.ts';
import { prefs, setPrefs } from './prefs.ts';
import { members, myId } from './selectors.ts';
import { get, getRaw, list, markSynced, pendingChanges, put, remove, resetStore, setSession, store, update } from './store.ts';
import { startSync, stopSync, syncNow } from './sync.ts';
import { refreshPush } from './push.ts';

type New<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

function stamp<T extends object>(e: T): T & { id: ID; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { id: uid(), createdAt: now, updatedAt: now, ...e } as T & { id: ID; createdAt: number; updatedAt: number };
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export function logActivity(type: ActivityType, fields: Partial<Activity> = {}): void {
  put('activity', stamp({ type, actorId: myId(), ...fields }) as Activity);
}

/* ------------------------------------------------------------------ */
/* Household lifecycle                                                 */
/* ------------------------------------------------------------------ */

export interface CreateInput {
  myName: string;
  myEmoji: string;
  myColor: string;
  wgName: string;
  wgEmoji: string;
  roommates: string[];
  chores: string[];
}

export async function createHousehold(input: CreateInput): Promise<void> {
  const householdId = 'h_' + uid(20);
  const memberId = 'm_' + uid(20);
  resetStore({ householdId, memberId, mode: 'local', cursor: 0 });
  const now = Date.now();

  put('household', { id: householdId, name: input.wgName.trim(), emoji: input.wgEmoji, currency: 'EUR', timezone: localTimezone(), createdAt: now, updatedAt: now });
  put('members', { id: memberId, name: input.myName.trim(), emoji: input.myEmoji, color: input.myColor, claimed: true, createdAt: now, updatedAt: now });
  input.roommates
    .map((n) => n.trim())
    .filter(Boolean)
    .forEach((name, i) => {
      put('members', {
        id: 'm_' + uid(20),
        name,
        color: MEMBER_COLORS[(MEMBER_COLORS.indexOf(input.myColor) + i + 1) % MEMBER_COLORS.length]!,
        createdAt: now + i + 1,
        updatedAt: now + i + 1,
      });
    });

  createDefaultLists();
  const all = members();
  input.chores.forEach((key, i) => {
    const tpl = CHORE_TEMPLATES.find((c) => c.key === key);
    if (!tpl) return;
    put('chores', stamp({
      title: t(`tpl.${key}` as 'tpl.kitchen'),
      emoji: tpl.emoji,
      frequency: tpl.frequency,
      points: tpl.points,
      rotation: 'rotate',
      memberIds: all.map((m) => m.id),
      assigneeId: all[i % all.length]!.id,
      dueDate: addDays(today(), Math.min(i, 6)),
      fixedSchedule: tpl.fixedSchedule,
    }) as Chore);
  });
  logActivity('member_joined');
  await goCloud();
}

export function localTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export function createDefaultLists(): void {
  const defaults: [string, string][] = [
    [t('list.supermarket'), '🛒'],
    [t('list.drugstore'), '🧴'],
  ];
  defaults.forEach(([name, emoji], i) => {
    put('lists', stamp({ name, emoji, color: LIST_COLORS[i]!, order: i }) as ShoppingList);
  });
}

/**
 * Registers the local household on a sync server (if one is reachable) and
 * switches the session to cloud mode. Returns false when no server is available.
 */
export async function goCloud(serverUrl?: string): Promise<boolean> {
  const s = store.session;
  if (!s || s.mode === 'demo') return false;
  const base = serverUrl ?? (await api.resolveServer());
  if (!base) return false;
  if (!(await api.health(base))) return false;
  const all = pendingChanges(100_000);
  const household = all.filter((c) => c.c === 'household');
  const first = [...household, ...all.filter((c) => c.c === 'members'), ...all.filter((c) => c.c !== 'household' && c.c !== 'members')].slice(0, 1800);
  const res = await api.createHousehold(base, s.householdId, s.memberId, first);
  markSynced(first);
  setSession({ mode: 'cloud', serverUrl: base, token: res.token, inviteCode: res.inviteCode, cursor: 0 });
  if (serverUrl) setPrefs({ serverUrl });
  startSync();
  await syncNow();
  void refreshPush();
  return true;
}

export async function joinHousehold(base: string, code: string, preview: api.InvitePreview, claimId: ID | null, profile: { name: string; emoji: string; color: string }): Promise<void> {
  const memberId = claimId ?? 'm_' + uid(20);
  const now = Date.now();
  const existing = preview.members.find((m) => m.id === claimId);
  const memberRecord: Member = {
    id: memberId,
    name: profile.name.trim() || existing?.name || '?',
    emoji: profile.emoji || existing?.emoji,
    color: profile.color || existing?.color || MEMBER_COLORS[0]!,
    claimed: true,
    createdAt: now,
    updatedAt: now,
  };
  const res = await api.joinHousehold(base, code, memberId, []);
  resetStore({ householdId: res.householdId, memberId, mode: 'cloud', serverUrl: base, token: res.token, cursor: 0 });
  await syncNow();
  const prev = getRaw('members', memberId);
  put('members', { ...(prev ?? memberRecord), ...memberRecord, createdAt: prev?.createdAt ?? now, claimed: true, deleted: false });
  logActivity('member_joined');
  try {
    const inv = await api.getInvite(base, res.householdId, res.token);
    setSession({ inviteCode: inv.inviteCode });
  } catch {
    /* not critical */
  }
  startSync();
  void refreshPush();
}

export async function leaveHousehold(): Promise<void> {
  const s = store.session;
  if (s?.mode === 'cloud' && s.token && s.serverUrl) {
    try {
      await api.leave(s.serverUrl, s.householdId, s.token);
    } catch {
      /* leaving locally anyway */
    }
  }
  stopSync();
  resetStore(null);
}

/* ------------------------------------------------------------------ */
/* Members & household                                                 */
/* ------------------------------------------------------------------ */

export function addMember(name: string): Member {
  const used = new Set(members().map((m) => m.color));
  const color = MEMBER_COLORS.find((c) => !used.has(c)) ?? MEMBER_COLORS[members().length % MEMBER_COLORS.length]!;
  const m = put('members', stamp({ name: name.trim(), color }) as Member);
  logActivity('member_added', { title: m.name, targetId: m.id });
  return m;
}

export function moveOut(memberId: ID): void {
  update('members', memberId, { leftAt: Date.now() });
  logActivity('member_left', { actorId: memberId });
  // Remove from chore pools and hand chores over.
  for (const c of list('chores')) {
    if (!c.memberIds.includes(memberId) && c.assigneeId !== memberId) continue;
    const pool = c.memberIds.filter((id) => id !== memberId);
    update('chores', c.id, { memberIds: pool, assigneeId: c.assigneeId === memberId ? pool[0] : c.assigneeId });
  }
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export function saveExpense(data: New<Expense>, existingId?: ID): Expense {
  if (existingId) {
    const e = update('expenses', existingId, data as Partial<Expense>)!;
    logActivity('expense_edited', { title: e.title, amount: e.amount, targetId: e.id });
    return e;
  }
  const e = put('expenses', stamp(data) as Expense);
  logActivity('expense_added', { title: e.title, amount: e.amount, targetId: e.id, actorId: myId() });
  return e;
}

export function settleUp(from: ID, to: ID, amount: Cents, method: Expense['method']): Expense {
  const e = put('expenses', stamp({
    kind: 'transfer',
    title: t('money.transfer'),
    amount,
    paidBy: from,
    date: today(),
    category: 'other',
    splitMode: 'exact',
    split: [{ memberId: to, value: amount }],
    method,
  }) as Expense);
  logActivity('transfer_added', { actorId: from, targetId: to, amount });
  return e;
}

export function saveRecurring(data: New<Recurring>, existingId?: ID): Recurring {
  if (existingId) return update('recurring', existingId, data as Partial<Recurring>)!;
  return put('recurring', stamp(data) as Recurring);
}

/** Books all due occurrences of recurring payments. Idempotent across devices. */
export function bookDueRecurring(): number {
  if (!store.session) return 0;
  let booked = 0;
  const now = Date.now();
  for (const r of list('recurring')) {
    const due = dueOccurrences(r, today());
    if (!due.length) continue;
    let lastBooked: { date: string; id: ID } | null = null;
    for (const date of due) {
      const exp = recurringToExpense(r, date, now);
      if (!getRaw('expenses', exp.id)) {
        put('expenses', exp);
        lastBooked = { date, id: exp.id };
        booked++;
      }
    }
    // One feed entry per run, dated on the due day, so catching up never floods the feed.
    if (lastBooked) {
      const actId = `act_rec_${r.id}_${lastBooked.date}`;
      const [y, m, d] = lastBooked.date.split('-').map(Number);
      const ts = Math.min(now, new Date(y!, m! - 1, d!, 9).getTime());
      if (!getRaw('activity', actId)) {
        put('activity', { id: actId, type: 'recurring_booked', actorId: r.paidBy, title: r.title, amount: r.amount, targetId: lastBooked.id, createdAt: ts, updatedAt: ts });
      }
    }
    update('recurring', r.id, { lastBooked: due[due.length - 1] });
  }
  return booked;
}

/* ------------------------------------------------------------------ */
/* Chores                                                              */
/* ------------------------------------------------------------------ */

export function saveChore(data: New<Chore>, existingId?: ID): Chore {
  if (existingId) return update('chores', existingId, data as Partial<Chore>)!;
  const c = put('chores', stamp(data) as Chore);
  logActivity('chore_added', { title: c.title, emoji: c.emoji, targetId: c.id });
  return c;
}

/** Adds a batch of chores (setup assistant) without flooding the activity feed. */
export function addChores(data: New<Chore>[]): void {
  data.forEach((d) => put('chores', stamp(d) as Chore));
}

/** Marks a chore done (or skipped). Returns an undo function. */
export function finishChore(choreId: ID, action: 'done' | 'skipped' = 'done', memberId: ID = myId()): () => void {
  const chore = get('chores', choreId);
  if (!chore) return () => {};
  const before = { ...chore };
  const { patch, log } = computeCompletion(chore, memberId, today(), list('members'), list('choreLogs'), list('events'), action);
  const logEntry = put('choreLogs', stamp(log) as never);
  let activityId: ID | null = null;
  if (action === 'done') {
    const a = put('activity', stamp({ type: 'chore_done', actorId: memberId, title: chore.title, emoji: chore.emoji, points: log.points, targetId: chore.id }) as Activity);
    activityId = a.id;
  }
  if (patch) update('chores', choreId, patch);
  else remove('chores', choreId);
  return () => {
    put('chores', { ...before, deleted: false });
    remove('choreLogs', (logEntry as { id: ID }).id);
    if (activityId) remove('activity', activityId);
  };
}

/* ------------------------------------------------------------------ */
/* Shopping                                                            */
/* ------------------------------------------------------------------ */

export function saveList(data: New<ShoppingList>, existingId?: ID): ShoppingList {
  if (existingId) return update('lists', existingId, data as Partial<ShoppingList>)!;
  return put('lists', stamp(data) as ShoppingList);
}

export function deleteList(listId: ID): () => void {
  const undos = list('items')
    .filter((i) => i.listId === listId)
    .map((i) => remove('items', i.id));
  undos.push(remove('lists', listId));
  return () => undos.forEach((u) => u());
}

/** Adds one or more items ("Milch, 2x Brot, Eier") to a list. */
export function addItems(listId: ID, input: string): ShoppingItem[] {
  const parts = input
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const added: ShoppingItem[] = [];
  const history = { ...prefs.itemHistory };
  for (const p of parts) {
    const { name, quantity } = parseItemInput(p);
    const dupe = list('items').find((i) => i.listId === listId && !i.checked && i.name.toLowerCase() === name.toLowerCase());
    if (dupe) {
      if (quantity) update('items', dupe.id, { quantity });
      continue;
    }
    added.push(put('items', stamp({ listId, name, quantity, category: categorizeItem(name), checked: false }) as ShoppingItem));
    history[name] = (history[name] ?? 0) + 1;
  }
  setPrefs({ itemHistory: history });
  if (added.length) {
    const lst = get('lists', listId);
    logActivity('items_added', { title: added.length === 1 ? added[0]!.name : lst?.name, count: added.length, targetId: listId });
  }
  return added;
}

export function toggleItem(itemId: ID): void {
  const item = get('items', itemId);
  if (!item) return;
  update('items', itemId, item.checked ? { checked: false, checkedAt: undefined, checkedBy: undefined } : { checked: true, checkedAt: Date.now(), checkedBy: myId() });
}

/** Clears the cart of a list and optionally books the trip as a shared expense. */
export function finishShopping(listId: ID, expense: { amount: Cents; paidBy: ID } | null): Expense | null {
  const lst = get('lists', listId);
  const items = list('items').filter((i) => i.listId === listId && i.checked);
  for (const i of items) remove('items', i.id);
  let e: Expense | null = null;
  if (expense && expense.amount > 0) {
    e = put('expenses', stamp({
      kind: 'expense',
      title: lst ? t('shop.itemTitle', { list: lst.name }) : t('shop.title'),
      amount: expense.amount,
      paidBy: expense.paidBy,
      date: today(),
      category: expenseCategoryForItems(items.map((i) => i.category)),
      splitMode: 'equal',
      split: members().map((m) => ({ memberId: m.id, value: 1 })),
      listId,
      note: items.map((i) => i.name).join(', '),
    }) as Expense);
  }
  logActivity('items_bought', { actorId: expense?.paidBy ?? myId(), count: items.length, amount: e?.amount, title: lst?.name, targetId: listId });
  return e;
}

/* ------------------------------------------------------------------ */
/* Contracts, calendar, board                                          */
/* ------------------------------------------------------------------ */

export function saveContract(data: New<Contract>, existingId?: ID, linkRecurring = false, firstBooking?: ISODate): Contract {
  let c: Contract;
  if (existingId) c = update('contracts', existingId, data as Partial<Contract>)!;
  else {
    c = put('contracts', stamp(data) as Contract);
    logActivity('contract_added', { title: c.name, emoji: c.emoji, targetId: c.id });
  }
  syncContractRecurring(c, linkRecurring, firstBooking);
  return c;
}

/** Keeps the linked recurring payment in line with the contract's monthly cost. */
function syncContractRecurring(c: Contract, link: boolean, firstBooking?: ISODate): void {
  const existing = c.recurringId ? get('recurring', c.recurringId) : undefined;
  if (!link || !c.monthlyCost) {
    if (existing && !link) update('recurring', existing.id, { active: false });
    return;
  }
  const base = {
    title: c.name,
    emoji: c.emoji,
    amount: c.monthlyCost,
    category: c.category === 'internet' ? 'internet' : c.category === 'rent' ? 'rent' : ['electricity', 'gas', 'water'].includes(c.category) ? 'utilities' : ['insurance', 'liability'].includes(c.category) ? 'insurance' : 'subscriptions',
    active: !c.cancelled,
    endDate: c.cancelled ? c.endDate : undefined,
  } as const;
  if (existing) {
    update('recurring', existing.id, base);
    return;
  }
  const r = saveRecurring({
    ...base,
    paidBy: c.holderId ?? myId(),
    splitMode: 'equal',
    split: members().map((m) => ({ memberId: m.id, value: 1 })),
    frequency: { unit: 'month', every: 1 },
    startDate: firstBooking ?? addDays(today(), 1),
    autoBook: true,
    contractId: c.id,
  });
  update('contracts', c.id, { recurringId: r.id });
}

export function saveEvent(data: New<CalendarEvent>, existingId?: ID): CalendarEvent {
  if (existingId) return update('events', existingId, data as Partial<CalendarEvent>)!;
  const e = put('events', stamp(data) as CalendarEvent);
  logActivity('event_added', { title: e.title, targetId: e.id });
  return e;
}

export function saveNote(data: New<Note>, existingId?: ID): Note {
  if (existingId) return update('notes', existingId, data as Partial<Note>)!;
  const n = put('notes', stamp(data) as Note);
  logActivity('note_added', { targetId: n.id });
  return n;
}

export function toggleReaction(noteId: ID, emoji: string): void {
  const n = get('notes', noteId);
  if (!n) return;
  const me = myId();
  const reactions = { ...(n.reactions ?? {}) };
  const ids = new Set(reactions[emoji] ?? []);
  if (ids.has(me)) ids.delete(me);
  else ids.add(me);
  if (ids.size) reactions[emoji] = [...ids];
  else delete reactions[emoji];
  update('notes', noteId, { reactions });
}

/* ------------------------------------------------------------------ */
/* Backup                                                              */
/* ------------------------------------------------------------------ */

export function exportData(): string {
  const out: Record<string, unknown[]> = {};
  for (const c of COLLECTIONS) out[c] = list(c);
  return JSON.stringify({ app: 'nestly', version: 1, exportedAt: new Date().toISOString(), data: out }, null, 2);
}

export function expensesCsv(): string {
  const rows = [['date', 'title', 'category', 'amount', 'paid_by', 'kind', 'split'].join(';')];
  const name = (id: ID) => get('members', id)?.name ?? id;
  for (const e of [...list('expenses')].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push(
      [e.date, JSON.stringify(e.title), e.category, (e.amount / 100).toFixed(2).replace('.', ','), JSON.stringify(name(e.paidBy)), e.kind, JSON.stringify(e.split.map((p) => name(p.memberId)).join(', '))].join(';'),
    );
  }
  return rows.join('\n');
}

export type { Change };
