import { computeBalances, simplifyDebts } from '../../../core/src/balances.ts';
import type { Transfer } from '../../../core/src/balances.ts';
import { isAway } from '../../../core/src/chores.ts';
import { today } from '../../../core/src/dates.ts';
import type { Cents, CollectionName, Household, ID, Member } from '../../../core/src/types.ts';
import { t } from '../i18n/index.ts';
import { get, list, store } from './store.ts';

/** Memoises a derived value until one of the given collections changes. */
export function memo<T>(deps: CollectionName[], fn: () => T): () => T {
  let key = '';
  let value: T;
  return () => {
    const k = deps.map((d) => store.versions[d]).join(',') + '|' + (store.session?.householdId ?? '');
    if (k !== key) {
      key = k;
      value = fn();
    }
    return value;
  };
}

export function session() {
  return store.session;
}

export function myId(): ID {
  return store.session?.memberId ?? '';
}

export function household(): Household | undefined {
  return store.session ? get('household', store.session.householdId) : undefined;
}

export function me(): Member | undefined {
  return get('members', myId());
}

const sortMembers = (a: Member, b: Member) => a.createdAt - b.createdAt || a.name.localeCompare(b.name);

/** Current residents (not moved out), in join order. */
export const members = memo(['members'], () => list('members').filter((m) => !m.leftAt).sort(sortMembers));

/** Everyone including former residents. */
export const allMembers = memo(['members'], () => [...list('members')].sort(sortMembers));

export function member(id: ID | undefined): Member | undefined {
  return id ? (store.tables.members.get(id) as Member | undefined) : undefined;
}

/** "Du" for the current user, otherwise the first name. */
export function displayName(id: ID | undefined): string {
  if (!id) return '?';
  if (id === myId()) return t('common.you');
  return firstName(member(id)?.name ?? '?');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function memberIsAway(m: Member, date = today()): boolean {
  return isAway(m, date, list('events'));
}

export const balances = memo(['expenses', 'members'], () => computeBalances(list('expenses'), members().map((m) => m.id)));

export const settleTransfers = memo(['expenses', 'members'], (): Transfer[] => simplifyDebts(balances()));

export function myBalance(): Cents {
  return balances().get(myId()) ?? 0;
}

export const activeItemsCount = memo(['items'], () => list('items').filter((i) => !i.checked).length);

export const sortedActivity = memo(['activity'], () => [...list('activity')].sort((a, b) => b.createdAt - a.createdAt));
