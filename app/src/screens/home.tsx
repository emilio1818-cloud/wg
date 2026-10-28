import { h, Fragment } from '../lib/ui.ts';
import { navigate } from '../lib/router.ts';
import { today } from '../../../core/src/dates.ts';
import { contractStatus } from '../../../core/src/contracts.ts';
import { monthlyEquivalent, nextDue } from '../../../core/src/recurring.ts';
import { leaderboard } from '../../../core/src/chores.ts';
import { startOfMonth } from '../../../core/src/dates.ts';
import { t, tp } from '../i18n/index.ts';
import { fmtDate, greeting, money, relDay } from '../i18n/format.ts';
import { list, store } from '../state/store.ts';
import { syncState } from '../state/sync.ts';
import { leaveHousehold } from '../state/actions.ts';
import { activeItemsCount, firstName, household, me, members, myBalance, myId, settleTransfers, sortedActivity } from '../state/selectors.ts';
import { prefs, setPrefs } from '../state/prefs.ts';
import { Avatar, AvatarStack, Button, Icon, IconButton, SectionTitle } from '../components/core.tsx';
import type { IconName } from '../lib/icons.ts';
import { ActivityRow } from '../components/activity.tsx';
import { openExpenseEditor, openSettle } from './money.tsx';
import { ChoreRow, choresDueForMe } from './chores.tsx';
import { openChoreEditor } from './chores.tsx';
import { openQuickAdd } from './shopping.tsx';
import { deadlineAlert, warnDeadline } from './contracts.tsx';
import { openEventEditor } from './calendar.tsx';
import { openInvite } from './members.tsx';
import { openWifi } from './wg.tsx';
import { InstallBanner, NotifyBanner } from '../components/install.tsx';
import { SetupBanner, setupBannerVisible } from './setup.tsx';

void Fragment;

function BalanceHero() {
  const bal = myBalance();
  const transfers = settleTransfers();
  const mine = transfers.filter((tr) => tr.from === myId() || tr.to === myId());
  const counterpart = mine.map((tr) => (tr.from === myId() ? tr.to : tr.from));
  const people = members().filter((m) => counterpart.includes(m.id));
  const variant = bal > 0 ? 'green' : bal < 0 ? 'red' : '';
  return (
    <div class={`hero ${variant}`}>
      <div class="label">{bal === 0 ? t('home.balance') : bal > 0 ? t('home.youGet') : t('home.youOwe')}</div>
      <div class="big num" style={bal === 0 ? { fontSize: '30px' } : undefined}>
        {bal === 0 ? t('home.settled') : money(Math.abs(bal))}
      </div>
      <div class="hstack" style={{ minHeight: '30px' }}>
        {people.length ? <AvatarStack members={people} size={28} /> : null}
        <span class="sub">
          {bal === 0
            ? t('home.settledSub')
            : mine
                .slice(0, 2)
                .map((tr) => (tr.from === myId() ? `→ ${firstName(members().find((m) => m.id === tr.to)?.name ?? '')}` : `← ${firstName(members().find((m) => m.id === tr.from)?.name ?? '')}`))
                .join(' · ')}
        </span>
      </div>
      <div class="actions">
        {bal !== 0 ? (
          <Button variant="white" size="md" icon="handCoins" onClick={() => openSettle(mine[0])}>
            {t('home.settleUp')}
          </Button>
        ) : null}
        <Button variant="white" size="md" icon="plus" onClick={() => openExpenseEditor()}>
          {t('home.addExpense')}
        </Button>
      </div>
    </div>
  );
}

function BentoTile(props: { icon: IconName; accent: string; label: string; value: any; sub?: any; onClick: () => void; wide?: boolean; badge?: any }) {
  return (
    <button type="button" class={props.wide ? 'tile-card wide' : 'tile-card'} style={{ '--accent': props.accent }} onClick={props.onClick}>
      <div class="t-head">
        <span class="t-icon">
          <Icon name={props.icon} size={20} stroke={2.3} />
        </span>
        {props.badge}
      </div>
      <div>
        <div class="t-label">{props.label}</div>
        <div class="t-value num">{props.value}</div>
      </div>
      {props.sub ? <div class="t-sub">{props.sub}</div> : null}
    </button>
  );
}

function Overview() {
  const T = today();
  const open = activeItemsCount();
  const lists = list('lists');
  const busiest = lists
    .map((l) => ({ l, n: list('items').filter((i) => i.listId === l.id && !i.checked).length }))
    .sort((a, b) => b.n - a.n)[0];
  const choresOpen = list('chores').filter((c) => !c.paused && c.dueDate <= T).length;
  const board = leaderboard(list('choreLogs'), members().map((m) => m.id), startOfMonth(T));
  const leader = board[0] && board[0].points > 0 ? members().find((m) => m.id === board[0]!.memberId) : null;
  const recurring = list('recurring').filter((r) => r.active);
  const monthly = recurring.reduce((a, r) => a + monthlyEquivalent(r.amount, r.frequency), 0);
  const perPerson = members().length ? Math.round(monthly / members().length) : 0;
  const nextPayment = recurring
    .map((r) => ({ r, d: nextDue(r, T) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d!.localeCompare(b.d!))[0];
  const contracts = list('contracts');
  const deadlines = contracts
    .map((c) => ({ c, s: contractStatus(c, T) }))
    .filter((x) => warnDeadline(x.s) != null)
    .sort((a, b) => a.s.daysLeft! - b.s.daysLeft!);
  const events = list('events')
    .filter((e) => (e.endDate ?? e.date) >= T)
    .sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
  const hh = household();
  return (
    <div class="bento">
      <BentoTile
        icon="cart"
        accent="var(--blue)"
        label={t('home.tile.shopping')}
        value={open ? String(open) : '✓'}
        sub={open && busiest ? `${busiest.l.emoji} ${busiest.l.name}` : t('home.tile.shoppingEmpty')}
        onClick={() => navigate('/shopping')}
      />
      <BentoTile
        icon="sparkles"
        accent="var(--amber)"
        label={t('home.tile.chores')}
        value={choresOpen ? `${choresOpen} ${t('home.tile.choresOpen')}` : '✓'}
        sub={leader ? t('home.tile.choresLeader', { name: firstName(leader.name) }) : undefined}
        onClick={() => navigate('/chores')}
      />
      <BentoTile
        icon="repeat"
        accent="var(--green)"
        label={t('home.tile.fixed')}
        value={recurring.length ? money(perPerson, { compact: perPerson >= 100000 }) : '–'}
        sub={nextPayment ? `${nextPayment.r.emoji ?? '🔁'} ${nextPayment.r.title} · ${relDay(nextPayment.d!)}` : recurring.length ? t('home.tile.fixedSub') : t('home.tile.fixedEmpty')}
        onClick={() => navigate('/money?tab=recurring')}
      />
      <BentoTile
        icon="file"
        accent="var(--violet)"
        label={t('home.tile.contracts')}
        value={
          deadlines.length
            ? deadlines[0]!.s.daysLeft
              ? `${deadlines[0]!.s.daysLeft} ${tp('unit.day', deadlines[0]!.s.daysLeft!)}`
              : t('contract.lastDay')
            : contracts.length
              ? String(contracts.length)
              : '–'
        }
        sub={deadlines.length ? `${deadlines[0]!.c.emoji ?? '📄'} ${deadlines[0]!.c.name}` : contracts.length ? t('home.tile.contractsOk') : t('home.tile.contractsEmpty')}
        onClick={() => navigate(deadlines.length ? `/wg/contracts/${deadlines[0]!.c.id}` : '/wg/contracts')}
      />
      <BentoTile
        icon="calendar"
        accent="var(--pink)"
        label={t('home.tile.calendar')}
        value={events[0] ? relDay(events[0].date) : '–'}
        sub={events[0] ? `${events[0].title}${events[0].time ? ' · ' + events[0].time : ''}` : t('home.tile.calendarEmpty')}
        onClick={() => navigate('/wg/calendar')}
      />
      <BentoTile
        icon="wifi"
        accent="var(--teal)"
        label={t('home.tile.wifi')}
        value={hh?.wifiSsid ? <span style={{ fontSize: '17px' }}>{hh.wifiSsid}</span> : '–'}
        sub={hh?.wifiSsid ? t('home.tile.wifiSub') : t('wg.wifiMissing')}
        onClick={() => (hh?.wifiSsid ? openWifi() : navigate('/wg/wifi'))}
      />
    </div>
  );
}

function DeadlineBanners() {
  const T = today();
  const urgent = list('contracts')
    .map((c) => ({ c, s: contractStatus(c, T) }))
    .filter((x) => warnDeadline(x.s) != null && (x.s.urgency === 'urgent' || x.s.daysLeft! <= 30))
    .filter((x) => !prefs.dismissed.includes(`deadline:${x.c.id}:${x.s.cancelBy}`))
    .slice(0, 2);
  if (!urgent.length) return null;
  return (
    <div class="stack mt-16">
      {urgent.map(({ c, s }) => (
        <div key={c.id} class={s.urgency === 'urgent' ? 'banner danger' : 'banner warn'}>
          <span class="b-emoji">{c.emoji ?? '📄'}</span>
          <button type="button" class="b-main" style={{ textAlign: 'left' }} onClick={() => navigate(`/wg/contracts/${c.id}`)}>
            <div class="b-title">{deadlineAlert(c.name, s.daysLeft!)}</div>
            <div class="b-sub">
              {t('contract.cancelBy', { date: fmtDate(s.cancelBy!, 'dayMonthLong') })} · {t('contract.deadlineAlertSub')}
            </div>
          </button>
          <IconButton icon="x" label={t('common.close')} variant="plain" size={18} onClick={() => setPrefs({ dismissed: [...prefs.dismissed, `deadline:${c.id}:${s.cancelBy}`] })} />
        </div>
      ))}
    </div>
  );
}

export function Home() {
  const self = me();
  const hh = household();
  const s = store.session!;
  const forMe = choresDueForMe();
  const activity = sortedActivity();
  const unseen = activity.some((a) => a.createdAt > prefs.activitySeenAt && a.actorId !== myId());
  const pinned = list('notes')
    .filter((n) => n.pinned)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const alone = members().length <= 1;

  return (
    <div class="screen">
      <header class="hstack" style={{ padding: '10px 0 14px' }}>
        <button type="button" onClick={() => navigate(`/wg/members/${myId()}`)} aria-label={t('profile.title')}>
          <Avatar member={self} size={46} />
        </button>
        <div class="grow">
          <div class="caption" style={{ fontSize: '13.5px' }}>
            {fmtDate(today(), 'long')}
          </div>
          <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {greeting()}, {firstName(self?.name ?? '')}{'\u00a0'}👋
          </div>
        </div>
        <IconButton
          icon="bell"
          label={t('activity.title')}
          dot={unseen}
          onClick={() => {
            setPrefs({ activitySeenAt: Date.now() });
            navigate('/activity');
          }}
        />
      </header>

      {syncState.status === 'offline' ? (
        <div class="badge amber mb-12" style={{ height: '28px', padding: '0 12px', fontSize: '13px' }}>
          <Icon name="cloudOff" size={15} /> {t('sync.offline')}
        </div>
      ) : null}

      {syncState.status === 'unauthorized' ? (
        <button
          type="button"
          class="banner danger mb-12"
          onClick={async () => {
            await leaveHousehold();
            navigate('/join', { replace: true });
          }}
        >
          <span class="b-emoji">
            <Icon name="lock" size={20} />
          </span>
          <div class="b-main">
            <div class="b-title">{t('error.sessionExpired')}</div>
          </div>
          <Icon name="chevronRight" size={18} class="faint" />
        </button>
      ) : null}

      {s.mode === 'demo' ? (
        <div class="banner info mb-12">
          <span class="b-emoji">
            <Icon name="info" size={20} />
          </span>
          <div class="b-main">
            <div class="b-title">{t('home.demoTitle')}</div>
            <div class="b-sub">{t('home.demoSub')}</div>
          </div>
          <Button size="sm" variant="primary" onClick={() => navigate('/create')}>
            {t('home.demoCta')}
          </Button>
        </div>
      ) : alone && !setupBannerVisible() ? (
        <button type="button" class="banner info mb-12" onClick={() => openInvite()}>
          <span class="b-emoji">
            <Icon name="userPlus" size={20} />
          </span>
          <div class="b-main">
            <div class="b-title">{t('home.inviteTitle')}</div>
            <div class="b-sub">{t('home.inviteSub')}</div>
          </div>
          <Icon name="chevronRight" size={18} class="faint" />
        </button>
      ) : null}

      <BalanceHero />

      <div class="quick mt-24">
        <button type="button" onClick={() => openExpenseEditor()}>
          <span class="q-ico">
            <Icon name="receipt" size={23} />
          </span>
          {t('home.quick.expense')}
        </button>
        <button type="button" onClick={() => openQuickAdd()}>
          <span class="q-ico">
            <Icon name="cart" size={23} />
          </span>
          {t('home.quick.item')}
        </button>
        <button type="button" onClick={() => openChoreEditor()}>
          <span class="q-ico">
            <Icon name="sparkles" size={23} />
          </span>
          {t('home.quick.chore')}
        </button>
        <button type="button" onClick={() => openEventEditor()}>
          <span class="q-ico">
            <Icon name="calendar" size={23} />
          </span>
          {t('home.quick.event')}
        </button>
      </div>

      <DeadlineBanners />
      <SetupBanner />
      <NotifyBanner />
      <InstallBanner />

      <SectionTitle title={t('home.forYou')} action={forMe.length ? t('home.seeAll') : undefined} onAction={() => navigate('/chores')} />
      {forMe.length ? (
        <div class="list">
          {forMe.slice(0, 4).map((c) => (
            <ChoreRow key={c.id} chore={c} />
          ))}
        </div>
      ) : (
        <div class="card hstack" style={{ padding: '12px 16px' }}>
          <span class="tile sm" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
            <Icon name="check" size={18} stroke={2.6} />
          </span>
          <span class="muted" style={{ fontWeight: 500 }}>
            {t('home.allDone')}
          </span>
        </div>
      )}

      <SectionTitle title={t('home.overview')} />
      <Overview />

      {pinned ? (
        <>
          <SectionTitle title={t('home.pinned')} action={t('home.seeAll')} onAction={() => navigate('/wg/board')} />
          <button type="button" class="note is-pinned" style={{ '--nc': pinned.color }} onClick={() => navigate('/wg/board')}>
            <span class="pinned">
              <Icon name="pin" size={16} />
            </span>
            <div class="text">{pinned.text}</div>
            <div class="meta">
              <Avatar member={members().find((m) => m.id === pinned.authorId)} size={18} />
              {firstName(members().find((m) => m.id === pinned.authorId)?.name ?? '')}
            </div>
          </button>
        </>
      ) : null}

      {activity.length ? (
        <>
          <SectionTitle
            title={t('home.activity')}
            action={t('home.seeAll')}
            onAction={() => {
              setPrefs({ activitySeenAt: Date.now() });
              navigate('/activity');
            }}
          />
          <div class="list">
            {activity.slice(0, 4).map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </div>
        </>
      ) : null}
      <div class="caption center mt-24">
        {hh?.emoji} {hh?.name}
      </div>
    </div>
  );
}
