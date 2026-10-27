import { h, Fragment, useState } from '../lib/ui.ts';
import { closeTopSheet, goBack, navigate, openSheet } from '../lib/router.ts';
import { AVATAR_EMOJIS, MEMBER_COLORS } from '../../../core/src/categories.ts';
import { formatIban, isValidIban, paypalLink } from '../../../core/src/balances.ts';
import { today } from '../../../core/src/dates.ts';
import type { ID } from '../../../core/src/types.ts';
import { t } from '../i18n/index.ts';
import { fmtDate, money } from '../i18n/format.ts';
import { get, store, update } from '../state/store.ts';
import * as api from '../state/api.ts';
import { allMembers, balances, firstName, memberIsAway, members, myId, settleTransfers } from '../state/selectors.ts';
import { addMember, moveOut } from '../state/actions.ts';
import { Avatar, Button, ColorRow, cx, EmojiGrid, Field, IconButton, Row, SwitchRow, TopBar } from '../components/core.tsx';
import { confirmDialog, copyText, Sheet, toast } from '../components/overlays.tsx';
import { InvitePanel } from '../components/invite.tsx';
import { openSettle } from './money.tsx';

void Fragment;

export function openInvite(): void {
  openSheet(() => (
    <Sheet title={t('invite.title')}>
      <p class="muted center" style={{ marginTop: 0 }}>
        {t('invite.sub')}
      </p>
      <InvitePanel />
    </Sheet>
  ));
}

export function Members() {
  const ms = members();
  const former = allMembers().filter((m) => m.leftAt);
  const bal = balances();
  return (
    <div class="screen">
      <TopBar title={t('members.title')} fallback="/wg" right={<IconButton icon="userPlus" label={t('wg.invite')} onClick={() => openInvite()} />} />
      <div class="list mt-8">
        {ms.map((m) => {
          const b = bal.get(m.id) ?? 0;
          const away = memberIsAway(m);
          return (
            <Row
              key={m.id}
              onClick={() => navigate(`/wg/members/${m.id}`)}
              lead={<Avatar member={m} size={46} away={away} />}
              title={
                <>
                  {m.name}
                  {m.id === myId() ? <span class="faint"> · {t('common.you')}</span> : null}
                </>
              }
              sub={!m.claimed ? `⏳ ${t('members.notJoined')}` : away ? `🧳 ${m.awayUntil ? t('members.awayUntil', { date: fmtDate(m.awayUntil, 'dayMonth') }) : t('members.away')}` : t('members.joinedOn', { date: fmtDate(new Date(m.createdAt).toISOString().slice(0, 10), 'medium') })}
              end={b !== 0 ? <span class={cx('num', b > 0 ? 'pos' : 'neg')} style={{ fontWeight: 750 }}>{money(b, { sign: true })}</span> : null}
              chevron
            />
          );
        })}
      </div>
      <AddMemberCard />
      {former.length ? (
        <>
          <div class="overline">{t('members.former')}</div>
          <div class="list">
            {former.map((m) => (
              <Row key={m.id} onClick={() => navigate(`/wg/members/${m.id}`)} lead={<Avatar member={m} size={40} />} title={m.name} sub={`📦 ${t('members.left')}`} chevron />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function AddMemberCard() {
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    const m = addMember(name);
    setName('');
    toast(t('members.added', { name: m.name }), { emoji: '🙋' });
  };
  return (
    <div class="card mt-16">
      <div style={{ fontWeight: 750 }}>{t('members.add')}</div>
      <div class="caption" style={{ margin: '2px 0 12px' }}>
        {t('members.addSub')}
      </div>
      <div class="input-group">
        <input class="input" placeholder={t('create.roommatePlaceholder')} value={name} maxLength={40} onInput={(e: any) => setName(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && add()} />
        <span class="addon">
          <IconButton icon="plus" label={t('common.add')} onClick={add} style={{ background: 'var(--primary)', color: '#fff' }} />
        </span>
      </div>
    </div>
  );
}

export function MemberDetail(props: { id: ID }) {
  const m = get('members', props.id);
  if (!m) {
    return (
      <div class="screen">
        <TopBar fallback="/wg/members" />
      </div>
    );
  }
  const isMe = m.id === myId();
  const editable = isMe || !m.claimed;
  const b = balances().get(m.id) ?? 0;
  const away = memberIsAway(m);
  const toMe = settleTransfers().find((tr) => tr.from === myId() && tr.to === m.id);
  const fromThem = settleTransfers().find((tr) => tr.from === m.id && tr.to === myId());

  const session = store.session;
  const canRelease = !isMe && m.claimed && !m.leftAt && session?.mode === 'cloud';
  const release = async () => {
    const ok = await confirmDialog({ title: t('members.releaseTitle', { name: firstName(m.name) }), message: t('members.releaseSub', { name: firstName(m.name) }), confirm: t('members.release'), destructive: true, emoji: '📱' });
    if (!ok || !session?.serverUrl || !session.token) return;
    try {
      await api.releaseMember(session.serverUrl, session.householdId, session.token, m.id);
      update('members', m.id, { claimed: false });
      toast(t('members.released', { name: firstName(m.name) }), { emoji: '📱' });
    } catch {
      toast(t('error.network'), { emoji: '⚠️' });
    }
  };

  const doMoveOut = async () => {
    if (b !== 0) {
      await confirmDialog({ title: t('members.moveOutTitle', { name: firstName(m.name) }), message: t('members.moveOutBlocked', { amount: money(Math.abs(b)) }), confirm: t('common.ok'), emoji: '💸' });
      return;
    }
    const ok = await confirmDialog({ title: t('members.moveOutTitle', { name: firstName(m.name) }), message: t('members.moveOutSub', { name: firstName(m.name) }), confirm: t('members.moveOut'), destructive: true, emoji: '📦' });
    if (!ok) return;
    moveOut(m.id);
    goBack('/wg/members');
  };

  return (
    <div class="screen">
      <TopBar title={isMe ? t('profile.title') : firstName(m.name)} fallback="/wg/members" right={editable ? <IconButton icon="pencil" label={t('members.edit')} onClick={() => openProfileEditor(m.id)} /> : null} />
      <div class="center fade-in" style={{ padding: '10px 0 18px' }}>
        <Avatar member={m} size={104} away={away} />
        <h1 style={{ margin: '14px 0 2px', fontSize: '28px', letterSpacing: '-0.03em' }}>{m.name}</h1>
        <div class="muted">
          {m.leftAt ? `📦 ${t('members.left')}` : !m.claimed ? `⏳ ${t('members.notJoined')}` : away ? `🧳 ${t('members.away')}` : t('members.joinedOn', { date: fmtDate(new Date(m.createdAt).toISOString().slice(0, 10), 'medium') })}
        </div>
        <div class={cx('badge mt-12 num', b > 0 ? 'green' : b < 0 ? 'red' : '')} style={{ height: '28px', fontSize: '14px', padding: '0 12px' }}>
          {t('members.balance')}: {money(b, { sign: true })}
        </div>
      </div>

      {!isMe && (toMe || fromThem) ? (
        <Button variant="primary" block icon="handCoins" onClick={() => openSettle(toMe ?? fromThem)}>
          {t('home.settleUp')} · {money((toMe ?? fromThem)!.amount)}
        </Button>
      ) : null}
      {!isMe && m.paypal && toMe ? (
        <Button block class="mt-8" style={{ background: '#0070e0', color: '#fff' }} onClick={() => window.open(paypalLink(m.paypal!, toMe.amount), '_blank', 'noopener')}>
          {t('settle.paypalOpen')}
        </Button>
      ) : null}
      {!m.claimed && !m.leftAt ? (
        <Button variant="primary" block icon="userPlus" class="mt-8" onClick={() => openInvite()}>
          {t('wg.invite')}
        </Button>
      ) : null}

      <div class="list mt-16">
        {m.paypal ? <Row compact title={`paypal.me/${m.paypal}`} sub="PayPal" end={<IconButton icon="copy" label={t('common.copy')} variant="plain" size={18} onClick={() => copyText(`https://paypal.me/${m.paypal}`)} />} /> : null}
        {m.iban ? <Row compact title={<span class="num">{formatIban(m.iban)}</span>} sub={t('profile.iban')} end={<IconButton icon="copy" label={t('common.copy')} variant="plain" size={18} onClick={() => copyText(m.iban!.replace(/\s/g, ''))} />} /> : null}
        {m.birthday ? <Row compact title={`🎂 ${fmtDate(`2000-${m.birthday}`, 'dayMonthLong')}`} sub={t('profile.birthday')} /> : null}
        {m.awayFrom ? <Row compact title={`🧳 ${fmtDate(m.awayFrom, 'dayMonth')}${m.awayUntil ? ' – ' + fmtDate(m.awayUntil, 'dayMonth') : ''}`} sub={t('profile.away')} /> : null}
      </div>

      {isMe ? (
        <Button block class="mt-16" icon="settings" onClick={() => navigate('/wg/settings')}>
          {t('wg.settings')}
        </Button>
      ) : null}
      {canRelease ? (
        <Button block class="mt-24" icon="smartphone" onClick={release}>
          {t('members.release')}
        </Button>
      ) : null}
      {!m.leftAt ? (
        <Button variant="danger" block class={canRelease ? 'mt-8' : 'mt-24'} icon="door" onClick={doMoveOut}>
          {t('members.moveOut')}
        </Button>
      ) : (
        <Button block class="mt-24" icon="home" onClick={() => update('members', m.id, { leftAt: undefined })}>
          {t('members.moveIn')}
        </Button>
      )}
    </div>
  );
}

export function openProfileEditor(id: ID): void {
  openSheet(() => <ProfileEditor id={id} />);
}

function ProfileEditor(props: { id: ID }) {
  const m = get('members', props.id);
  const [name, setName] = useState(m?.name ?? '');
  const [emoji, setEmoji] = useState(m?.emoji ?? '');
  const [color, setColor] = useState(m?.color ?? MEMBER_COLORS[0]!);
  const [paypal, setPaypal] = useState(m?.paypal ?? '');
  const [iban, setIban] = useState(m?.iban ? formatIban(m.iban) : '');
  const [birthday, setBirthday] = useState(m?.birthday ? `2000-${m.birthday}` : '');
  const [awayOn, setAwayOn] = useState(!!m?.awayFrom);
  const [awayFrom, setAwayFrom] = useState(m?.awayFrom ?? today());
  const [awayUntil, setAwayUntil] = useState(m?.awayUntil ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!m) return <Sheet title="" />;
  const save = () => {
    if (!name.trim()) return;
    if (iban.trim() && !isValidIban(iban)) return setError(t('profile.ibanInvalid'));
    update('members', m.id, {
      name: name.trim(),
      emoji: emoji || undefined,
      color,
      paypal: paypal.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?paypal\.me\//i, '') || undefined,
      iban: iban.replace(/\s/g, '').toUpperCase() || undefined,
      birthday: birthday ? birthday.slice(5) : undefined,
      awayFrom: awayOn ? awayFrom : undefined,
      awayUntil: awayOn && awayUntil ? awayUntil : undefined,
    });
    closeTopSheet();
    toast(t('profile.saved'), { emoji: emoji || '✨' });
  };
  return (
    <Sheet
      title={t('members.edit')}
      footer={
        <Button variant="primary" block onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <div class="center mb-12">
        <Avatar member={{ name: name || '?', emoji, color }} size={84} />
      </div>
      <Field label={t('common.name')}>
        <input class="input" value={name} maxLength={40} onInput={(e: any) => setName(e.target.value)} />
      </Field>
      <div class="overline">{t('profile.emoji')}</div>
      <EmojiGrid options={['', ...AVATAR_EMOJIS]} value={emoji} onChange={setEmoji} />
      <div class="mt-16">
        <ColorRow options={MEMBER_COLORS} value={color} onChange={setColor} />
      </div>
      <div class="overline">💸 {t('settle.title')}</div>
      <Field label={t('profile.paypal')} hint={t('profile.paypalHint')}>
        <div class="input-group">
          <span class="faint" style={{ position: 'absolute', left: '16px', fontWeight: 600 }}>
            paypal.me/
          </span>
          <input class="input" style={{ paddingLeft: '102px' }} value={paypal} autoCapitalize="none" spellcheck={false} onInput={(e: any) => setPaypal(e.target.value)} />
        </div>
      </Field>
      <Field label={t('profile.iban')} error={error}>
        <input class="input num" value={iban} autoCapitalize="characters" spellcheck={false} placeholder="DE00 0000 0000 0000 0000 00" onInput={(e: any) => setIban(formatIban(e.target.value))} />
      </Field>
      <Field label={t('profile.birthday')}>
        <input class="input" type="date" value={birthday} onInput={(e: any) => setBirthday(e.target.value)} />
      </Field>
      <div class="list">
        <SwitchRow lead={<span style={{ fontSize: '22px' }}>🧳</span>} title={t('profile.away')} sub={t('profile.awayHint')} on={awayOn} onChange={setAwayOn} />
      </div>
      {awayOn ? (
        <div class="form-row mt-12 fade-in">
          <Field label={t('profile.awayFrom')}>
            <input class="input" type="date" value={awayFrom} onInput={(e: any) => e.target.value && setAwayFrom(e.target.value)} />
          </Field>
          <Field label={t('profile.awayUntil')}>
            <input class="input" type="date" value={awayUntil} min={awayFrom} onInput={(e: any) => setAwayUntil(e.target.value)} />
          </Field>
        </div>
      ) : null}
    </Sheet>
  );
}
