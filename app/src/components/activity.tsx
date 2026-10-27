import { h } from '../lib/ui.ts';
import type { Activity } from '../../../core/src/types.ts';
import { t, tp } from '../i18n/index.ts';
import { money, timeAgo } from '../i18n/format.ts';
import { displayName, member, myId } from '../state/selectors.ts';
import type { Key } from '../i18n/index.ts';
import { Avatar, Row } from './core.tsx';

export function describeActivity(a: Activity): string {
  const me = myId();
  const name = displayName(a.actorId);
  const p = { name, title: a.title ?? '', n: a.count ?? 0, amount: a.amount != null ? money(a.amount) : '', to: displayName(a.targetId) };
  // Second-person phrasing for the user's own actions ("Du hast …").
  const self = a.actorId === me && a.type !== 'recurring_booked';
  switch (a.type) {
    case 'items_added':
      return tp(self ? 'activity.items_added_me' : 'activity.items_added', a.count ?? 1, p);
    case 'items_bought':
      return t(self ? 'activity.items_bought_me' : 'activity.items_bought', p) + (a.amount ? ` · ${money(a.amount)}` : '');
    case 'transfer_added':
      if (a.targetId === me) return t('activity.transfer_added_toMe', p);
      return t(self ? 'activity.transfer_added_me' : 'activity.transfer_added', p);
    default:
      return t(`activity.${a.type}${self ? '_me' : ''}` as Key, p);
  }
}

const TYPE_EMOJI: Partial<Record<Activity['type'], string>> = {
  expense_added: '💸',
  expense_edited: '✏️',
  transfer_added: '🤝',
  items_added: '🛒',
  items_bought: '🛍️',
  event_added: '📅',
  note_added: '📌',
  contract_added: '📄',
  member_joined: '👋',
  member_added: '🙋',
  member_left: '📦',
  recurring_booked: '🔁',
  chore_added: '🧽',
};

export function ActivityRow(props: { a: Activity }) {
  const a = props.a;
  const actor = member(a.actorId);
  const emoji = a.type === 'chore_done' ? (a.emoji ?? '✨') : TYPE_EMOJI[a.type] ?? '•';
  return (
    <Row
      lead={
        <span style={{ position: 'relative' }}>
          <Avatar member={actor} size={40} />
          <span style={{ position: 'absolute', right: '-5px', bottom: '-4px', fontSize: '15px', lineHeight: 1 }}>{emoji}</span>
        </span>
      }
      title={<span style={{ whiteSpace: 'normal', fontWeight: 600, fontSize: '15px' }}>{describeActivity(a)}</span>}
      sub={timeAgo(a.createdAt) + (a.type === 'chore_done' && a.points ? ` · +${a.points} ${t('common.points')}` : '')}
    />
  );
}
