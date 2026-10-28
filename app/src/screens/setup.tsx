import { h, Fragment, useState } from '../lib/ui.ts';
import type { Child } from '../lib/ui.ts';
import { navigate } from '../lib/router.ts';
import { CHORE_TEMPLATES } from '../../../core/src/chores.ts';
import { CONTRACT_TEMPLATES } from '../../../core/src/contracts.ts';
import { addDays, nextMonthDay, nextWeekday, today } from '../../../core/src/dates.ts';
import { centsToInput, parseAmount } from '../../../core/src/money.ts';
import { monthlyEquivalent } from '../../../core/src/recurring.ts';
import { formatInviteCode } from '../../../core/src/ids.ts';
import { HOUSEHOLD_EMOJIS, LIST_COLORS } from '../../../core/src/categories.ts';
import type { Chore, ContractCategory, Frequency, ID, Member, RotationMode } from '../../../core/src/types.ts';
import { intlLocale, t, tp } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { fmtDate, freqLabel, money } from '../i18n/format.ts';
import { addChores, addMember, saveContract, saveList, saveRecurring } from '../state/actions.ts';
import { firstName, household, members, myId } from '../state/selectors.ts';
import { prefs, setPrefs } from '../state/prefs.ts';
import { list, remove, store, update } from '../state/store.ts';
import { Avatar, Button, Check, cx, Field, Icon, IconButton, Segmented } from '../components/core.tsx';
import type { IconName } from '../lib/icons.ts';
import { confetti, copyText, shareText } from '../components/overlays.tsx';
import { inviteLink } from '../components/invite.tsx';
import { openInvite } from './members.tsx';

void Fragment;

/*
 * Setup assistant: walks a new flat through everything worth entering once –
 * flat details, roommates, rent & fixed costs, chore plan, shopping lists and
 * Wi-Fi. Every step saves on "Next" and can be skipped; the assistant can be
 * closed at any time and resumed from the home screen or the WG tab.
 */

const STEPS = ['flat', 'members', 'costs', 'chores', 'lists', 'wifi'] as const;
type StepKey = (typeof STEPS)[number];

export function openSetup(): void {
  navigate('/setup');
}

function go(step: StepKey | 'done', back = false): void {
  navigate(step === 'flat' ? '/setup' : `/setup/${step}`, { replace: true, fade: back });
}

function closeSetup(): void {
  navigate('/', { replace: true, fade: true });
}

/** Areas the home banner counts as "set up". */
export function setupAreas(): { key: StepKey; done: boolean }[] {
  const hh = household();
  return [
    { key: 'members', done: members().length > 1 },
    { key: 'costs', done: list('recurring').some((r) => r.active) },
    { key: 'chores', done: list('chores').length > 0 },
    { key: 'wifi', done: !!hh?.wifiSsid },
    { key: 'flat', done: !!hh?.address },
  ];
}

function showSetupBanner(): boolean {
  const hh = household();
  if (!hh || hh.setupDone || store.session?.mode === 'demo' || prefs.dismissed.includes('setup')) return false;
  if (Date.now() - hh.createdAt > 30 * 86_400_000) return false;
  return !setupAreas().every((a) => a.done);
}

/** Home-screen entry point (next to the install banner) to start or resume the assistant. */
export function SetupBanner() {
  if (!showSetupBanner()) return null;
  const areas = setupAreas();
  const done = areas.filter((a) => a.done).length;
  return (
    <div class="banner mt-16">
      <span class="tile" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
        <Icon name="sparkles" size={21} />
      </span>
      <div class="b-main">
        <div class="b-title">{t('setup.bannerTitle')}</div>
        <div class="b-sub">{done ? t('setup.bannerProgress', { done, total: areas.length }) : t('setup.bannerSub')}</div>
      </div>
      <Button size="sm" variant="primary" onClick={openSetup}>
        {done ? t('setup.bannerContinue') : t('setup.bannerCta')}
      </Button>
      <IconButton icon="x" label={t('common.close')} variant="plain" size={17} onClick={() => setPrefs({ dismissed: [...prefs.dismissed, 'setup'] })} />
    </div>
  );
}

/** True while the setup banner is visible (the home screen then hides its invite hint). */
export function setupBannerVisible(): boolean {
  return showSetupBanner();
}

export function SetupWizard(props: { step?: string }) {
  if (!household()) return null;
  if (props.step === 'done') return <DoneStep />;
  const key: StepKey = (STEPS as readonly string[]).includes(props.step ?? '') ? (props.step as StepKey) : 'flat';
  const index = STEPS.indexOf(key);
  const nav: StepNav = {
    index,
    next: () => go(STEPS[index + 1] ?? 'done'),
    back: () => (index === 0 ? closeSetup() : go(STEPS[index - 1]!, true)),
  };
  switch (key) {
    case 'flat':
      return <FlatStep nav={nav} />;
    case 'members':
      return <MembersStep nav={nav} />;
    case 'costs':
      return <CostsStep nav={nav} />;
    case 'chores':
      return <ChoresStep nav={nav} />;
    case 'lists':
      return <ListsStep nav={nav} />;
    case 'wifi':
      return <WifiStep nav={nav} />;
  }
}

interface StepNav {
  index: number;
  next: () => void;
  back: () => void;
}

function Frame(props: { nav: StepNav; title: string; sub: string; onNext: () => void; children?: Child }) {
  const { nav } = props;
  return (
    <div class="setup">
      <div class="setup-head">
        <IconButton icon="chevronLeft" label={t('common.back')} onClick={nav.back} />
        <div class="grow">
          <div class="setup-progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={nav.index + 1}>
            <i style={{ width: `${((nav.index + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
        <button type="button" class="setup-later" onClick={closeSetup}>
          {t('setup.later')}
        </button>
      </div>
      <div class="setup-step">{t('setup.stepOf', { n: nav.index + 1, total: STEPS.length })}</div>
      <h1 class="step-title">{props.title}</h1>
      <p class="muted setup-sub">{props.sub}</p>
      <div class="setup-body">{props.children}</div>
      <div class="setup-foot">
        <Button variant="ghost" onClick={nav.next}>
          {t('common.skip')}
        </Button>
        <Button variant="primary" onClick={props.onNext}>
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · Flat                                                            */
/* ------------------------------------------------------------------ */

function FlatStep(props: { nav: StepNav }) {
  const hh = household()!;
  const [name, setName] = useState(hh.name);
  const [emoji, setEmoji] = useState(hh.emoji);
  const [address, setAddress] = useState(hh.address ?? '');
  const [landlordName, setLandlordName] = useState(hh.landlordName ?? '');
  const [landlordPhone, setLandlordPhone] = useState(hh.landlordPhone ?? '');
  const [landlordEmail, setLandlordEmail] = useState(hh.landlordEmail ?? '');

  const save = () => {
    update('household', hh.id, {
      name: name.trim() || hh.name,
      emoji,
      address: address.trim() || undefined,
      landlordName: landlordName.trim() || undefined,
      landlordPhone: landlordPhone.trim() || undefined,
      landlordEmail: landlordEmail.trim() || undefined,
    });
    props.nav.next();
  };

  return (
    <Frame nav={props.nav} title={t('setup.flat.title')} sub={t('setup.flat.sub')} onNext={save}>
      <Field label={t('setup.flat.name')}>
        <input class="input" value={name} maxLength={50} onInput={(e: any) => setName(e.target.value)} />
      </Field>
      <div class="chips scroll setup-emojis" role="radiogroup" aria-label="Emoji">
        {HOUSEHOLD_EMOJIS.map((e) => (
          <button key={e} type="button" role="radio" aria-checked={e === emoji} class={cx('chip', e === emoji ? 'active' : 'soft')} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <Field label={t('info.address')}>
        <input class="input" value={address} placeholder={t('setup.flat.addressPlaceholder')} autoComplete="street-address" maxLength={160} onInput={(e: any) => setAddress(e.target.value)} />
      </Field>
      <div class="overline">{t('info.landlord')}</div>
      <Field>
        <input class="input" value={landlordName} placeholder={t('info.landlordName')} maxLength={80} onInput={(e: any) => setLandlordName(e.target.value)} />
      </Field>
      <div class="form-row">
        <Field>
          <input class="input" type="tel" value={landlordPhone} placeholder={t('info.landlordPhone')} maxLength={40} onInput={(e: any) => setLandlordPhone(e.target.value)} />
        </Field>
        <Field>
          <input class="input" type="email" value={landlordEmail} placeholder={t('info.landlordEmail')} maxLength={120} onInput={(e: any) => setLandlordEmail(e.target.value)} />
        </Field>
      </div>
      <p class="hint">{t('setup.flat.hint')}</p>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · Roommates                                                       */
/* ------------------------------------------------------------------ */

/** A placeholder can be removed again as long as nothing refers to it yet. */
function removable(m: Member): boolean {
  if (m.claimed || m.id === myId()) return false;
  const id = m.id;
  return (
    !list('expenses').some((e) => e.paidBy === id || e.split.some((s) => s.memberId === id)) &&
    !list('recurring').some((r) => r.paidBy === id || r.split.some((s) => s.memberId === id)) &&
    !list('chores').some((c) => c.assigneeId === id || c.memberIds.includes(id)) &&
    !list('choreLogs').some((l) => l.memberId === id) &&
    !list('contracts').some((c) => c.holderId === id)
  );
}

function MembersStep(props: { nav: StepNav }) {
  const ms = members();
  const [draft, setDraft] = useState('');
  const s = store.session;
  const hh = household()!;

  const add = () => {
    const n = draft.trim();
    if (!n) return;
    addMember(n);
    setDraft('');
  };

  const save = () => {
    add();
    props.nav.next();
  };

  const code = s?.mode === 'cloud' ? s.inviteCode : undefined;
  return (
    <Frame nav={props.nav} title={t('setup.members.title')} sub={t('setup.members.sub')} onNext={save}>
      <div class="list">
        {ms.map((m) => (
          <div key={m.id} class="row compact">
            <Avatar member={m} size={36} />
            <div class="main">
              <div class="title">
                {m.name} {m.id === myId() ? <span class="faint">({t('common.you')})</span> : null}
              </div>
              {!m.claimed ? <div class="sub">{t('members.notJoined')}</div> : null}
            </div>
            {removable(m) ? <IconButton icon="x" label={t('common.delete')} variant="plain" size={18} onClick={() => remove('members', m.id)} /> : null}
          </div>
        ))}
      </div>
      <div class="input-group mt-12">
        <input
          class="input"
          placeholder={t('create.roommatePlaceholder')}
          value={draft}
          maxLength={40}
          autoComplete="off"
          onInput={(e: any) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && add()}
        />
        <span class="addon">
          <IconButton icon="plus" label={t('common.add')} onClick={add} style={{ background: 'var(--primary)', color: '#fff' }} />
        </span>
      </div>
      {code ? (
        <div class="card setup-invite mt-24">
          <div class="hstack">
            <div class="grow">
              <div class="caption">{t('invite.code')}</div>
              <button type="button" class="kbd-code setup-code" onClick={() => copyText(formatInviteCode(code))}>
                {formatInviteCode(code)}
              </button>
            </div>
            <Button
              size="md"
              variant="primary"
              icon="share"
              onClick={() => shareText(t('invite.message', { name: hh.name, link: inviteLink(code), code: formatInviteCode(code) }), 'Nestly', inviteLink(code))}
            >
              {t('common.share')}
            </Button>
          </div>
          <button type="button" class="setup-link" onClick={() => openInvite()}>
            {t('setup.members.more')}
          </button>
        </div>
      ) : s?.mode === 'local' ? (
        <div class="banner info mt-24">
          <span class="b-emoji">
            <Icon name="cloud" size={20} />
          </span>
          <div class="b-main">
            <div class="b-sub">{t('setup.members.local')}</div>
          </div>
        </div>
      ) : null}
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · Rent & fixed costs                                              */
/* ------------------------------------------------------------------ */

type CostKey = 'rent' | 'electricity' | 'gas' | 'internet' | 'broadcast' | 'insurance' | 'streaming';

const COSTS: { key: CostKey; emoji: string; label: Key }[] = [
  { key: 'rent', emoji: '🔑', label: 'cat.rent' },
  { key: 'electricity', emoji: '⚡', label: 'ccat.electricity' },
  { key: 'internet', emoji: '🌐', label: 'ccat.internet' },
  { key: 'gas', emoji: '🔥', label: 'ccat.gas' },
  { key: 'broadcast', emoji: '📺', label: 'ccat.broadcast' },
  { key: 'insurance', emoji: '🏠', label: 'ccat.insurance' },
  { key: 'streaming', emoji: '🎬', label: 'ccat.streaming' },
];

interface CostDraft {
  on: boolean;
  amount: string;
  day: number;
  payer: ID;
  provider: string;
  /** `YYYY-MM` */
  since: string;
}

function existingCost(key: CostKey): number | null {
  if (key === 'rent') {
    const r = list('recurring').find((x) => x.category === 'rent' && x.active);
    return r ? monthlyEquivalent(r.amount, r.frequency) : null;
  }
  const c = list('contracts').find((x) => x.category === key && !x.cancelled);
  return c ? (c.monthlyCost ?? 0) : null;
}

function CostsStep(props: { nav: StepNav }) {
  const ms = members();
  const [drafts, setDrafts] = useState<Record<CostKey, CostDraft>>(() => {
    const init = {} as Record<CostKey, CostDraft>;
    for (const c of COSTS) {
      const tpl = CONTRACT_TEMPLATES.find((x) => x.category === c.key);
      init[c.key] = { on: false, amount: tpl?.monthlyCost ? centsToInput(tpl.monthlyCost, intlLocale()) : '', day: 1, payer: myId(), provider: '', since: '' };
    }
    return init;
  });
  const [tried, setTried] = useState(false);
  const patch = (key: CostKey, p: Partial<CostDraft>) => setDrafts({ ...drafts, [key]: { ...drafts[key], ...p } });

  const active = COSTS.filter((c) => drafts[c.key].on && existingCost(c.key) === null);
  const amounts = active.map((c) => parseAmount(drafts[c.key].amount) ?? 0);
  const total = amounts.reduce((a, b) => a + b, 0);

  const save = () => {
    if (amounts.some((a) => a <= 0)) {
      setTried(true);
      return;
    }
    const T = today();
    const split = members().map((m) => ({ memberId: m.id, value: 1 }));
    active.forEach((c, i) => {
      const d = drafts[c.key];
      const amount = amounts[i]!;
      const first = nextMonthDay(T, d.day);
      if (c.key === 'rent') {
        saveRecurring({
          title: t('cat.rent'),
          emoji: c.emoji,
          amount,
          category: 'rent',
          paidBy: d.payer,
          splitMode: 'equal',
          split,
          frequency: { unit: 'month', every: 1 },
          startDate: first,
          autoBook: true,
          active: true,
        });
        return;
      }
      const tpl = CONTRACT_TEMPLATES.find((x) => x.category === c.key);
      // Without a start date a minimum term cannot be placed in time, so only open-ended terms are copied.
      const terms = tpl && (d.since || !tpl.minTermMonths) ? { minTermMonths: tpl.minTermMonths, renewalMonths: tpl.renewalMonths, noticeValue: tpl.noticeValue, noticeUnit: tpl.noticeUnit } : {};
      saveContract(
        {
          name: t(c.label),
          provider: d.provider.trim(),
          category: c.key as ContractCategory,
          emoji: c.emoji,
          monthlyCost: amount,
          holderId: d.payer,
          ...(d.since ? { startDate: `${d.since}-01` } : {}),
          ...terms,
        },
        undefined,
        true,
        first,
      );
    });
    props.nav.next();
  };

  return (
    <Frame nav={props.nav} title={t('setup.costs.title')} sub={t('setup.costs.sub')} onNext={save}>
      <div class="setup-items">
        {COSTS.map((c) => {
          const existing = existingCost(c.key);
          const d = drafts[c.key];
          const missing = tried && d.on && (parseAmount(d.amount) ?? 0) <= 0;
          if (existing !== null) {
            return (
              <div key={c.key} class="setup-item done">
                <div class="setup-item-head">
                  <span class="setup-emoji">{c.emoji}</span>
                  <div class="main">
                    <div class="title">{t(c.label)}</div>
                    <div class="sub">
                      {t('setup.costs.exists')}
                      {existing ? ` · ${money(existing)}` : ''}
                    </div>
                  </div>
                  <Icon name="check" size={18} stroke={2.6} class="setup-done-icon" />
                </div>
              </div>
            );
          }
          return (
            <div key={c.key} class={cx('setup-item', d.on && 'on')}>
              <button type="button" class="setup-item-head" aria-pressed={d.on} onClick={() => patch(c.key, { on: !d.on })}>
                <span class="setup-emoji">{c.emoji}</span>
                <div class="main">
                  <div class="title">{t(c.label)}</div>
                  {!d.on && d.amount ? <div class="sub">{money(parseAmount(d.amount) ?? 0)}</div> : null}
                </div>
                <span class={cx('switch', d.on && 'on')} aria-hidden="true" />
              </button>
              {d.on ? (
                <div class="setup-item-body">
                  <div class="form-row">
                    <Field label={c.key === 'rent' ? t('setup.costs.rentTotal') : t('setup.costs.amount')} error={missing ? t('setup.costs.amountMissing') : null}>
                      <input
                        class="input"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={d.amount}
                        autoFocus={!d.amount}
                        aria-label={`${t(c.label)} ${t('common.amount')}`}
                        onInput={(e: any) => patch(c.key, { amount: e.target.value.replace(/[^\d.,]/g, '') })}
                      />
                    </Field>
                    <Field label={t('setup.costs.day')}>
                      <select class="select" value={String(d.day)} onChange={(e: any) => patch(c.key, { day: Number(e.target.value) })}>
                        {Array.from({ length: 28 }, (_, i) => (
                          <option key={i} value={String(i + 1)}>
                            {t('setup.costs.dayN', { n: i + 1 })}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  {ms.length > 1 ? (
                    <>
                      <div class="setup-label">{c.key === 'rent' ? t('setup.costs.rentPayer') : t('setup.costs.payer')}</div>
                      <div class="chips scroll">
                        {ms.map((m) => (
                          <button key={m.id} type="button" class={cx('chip', d.payer === m.id ? 'active' : 'soft')} onClick={() => patch(c.key, { payer: m.id })}>
                            <Avatar member={m} size={20} /> {m.id === myId() ? t('common.you') : firstName(m.name)}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}
                  {c.key !== 'rent' ? (
                    <div class="form-row mt-12">
                      <Field label={t('setup.costs.provider')}>
                        <input class="input" value={d.provider} placeholder={t('common.optional')} maxLength={60} onInput={(e: any) => patch(c.key, { provider: e.target.value })} />
                      </Field>
                      {CONTRACT_TEMPLATES.find((x) => x.category === c.key)?.minTermMonths ? (
                        <Field label={t('setup.costs.since')}>
                          <input class="input" type="month" value={d.since} max={today().slice(0, 7)} onInput={(e: any) => patch(c.key, { since: e.target.value })} />
                        </Field>
                      ) : null}
                    </div>
                  ) : null}
                  <div class="hint">{t('setup.costs.firstBooking', { date: fmtDate(nextMonthDay(today(), d.day), 'medium') })}</div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {total > 0 ? (
        <div class="setup-total">
          <span>{t('setup.costs.total')}</span>
          <span class="num">{money(total)}</span>
          <span class="faint">{t('setup.costs.perPerson', { amount: money(Math.round(total / Math.max(1, ms.length))) })}</span>
        </div>
      ) : null}
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · Chore plan                                                      */
/* ------------------------------------------------------------------ */

const FREQS: { value: string; f: Frequency }[] = [
  { value: 'day-1', f: { unit: 'day', every: 1 } },
  { value: 'day-2', f: { unit: 'day', every: 2 } },
  { value: 'week-1', f: { unit: 'week', every: 1 } },
  { value: 'week-2', f: { unit: 'week', every: 2 } },
  { value: 'month-1', f: { unit: 'month', every: 1 } },
  { value: 'month-3', f: { unit: 'month', every: 3 } },
];

function freqValue(f: Frequency | null): string {
  return f ? `${f.unit}-${f.every}` : 'week-1';
}

function freqFrom(value: string): Frequency {
  return FREQS.find((x) => x.value === value)?.f ?? { unit: 'week', every: 1 };
}

interface ChoreDraft {
  key: string;
  title: string;
  emoji: string;
  points: number;
  freq: string;
  fixedSchedule?: boolean;
}

const DEFAULT_CHORES = ['kitchen', 'bathroom', 'vacuum', 'trash'];

function ChoresStep(props: { nav: StepNav }) {
  const existing = list('chores');
  const existingTitles = new Set(existing.map((c) => c.title.trim().toLowerCase()));
  const templates: ChoreDraft[] = CHORE_TEMPLATES.map((tpl) => ({
    key: tpl.key,
    title: t(`tpl.${tpl.key}` as Key),
    emoji: tpl.emoji,
    points: tpl.points,
    freq: freqValue(tpl.frequency),
    fixedSchedule: tpl.fixedSchedule,
  }));
  const [picked, setPicked] = useState<string[]>(() => (existing.length ? [] : DEFAULT_CHORES));
  const [freqs, setFreqs] = useState<Record<string, string>>({});
  const [customs, setCustoms] = useState<ChoreDraft[]>([]);
  const [draft, setDraft] = useState('');
  const [rotation, setRotation] = useState<RotationMode>('rotate');
  const [day, setDay] = useState<number | null>(null);

  const addCustom = () => {
    const title = draft.trim();
    if (!title) return;
    const key = 'custom:' + customs.length + ':' + title;
    setCustoms([...customs, { key, title, emoji: '✨', points: 20, freq: 'week-1' }]);
    setPicked([...picked, key]);
    setDraft('');
  };

  const all = [...templates, ...customs];
  const toggle = (key: string) => setPicked(picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key]);

  const save = () => {
    const chosen = all.filter((c) => picked.includes(c.key) && !existingTitles.has(c.title.toLowerCase()));
    const extra = draft.trim();
    if (extra) chosen.push({ key: 'custom', title: extra, emoji: '✨', points: 20, freq: 'week-1' });
    const pool = members().map((m) => m.id);
    const T = today();
    addChores(
      chosen.map((c, i) => {
        const frequency = freqFrom(freqs[c.key] ?? c.freq);
        const onCleaningDay = day !== null && frequency.unit !== 'day';
        const draftChore: Omit<Chore, 'id' | 'createdAt' | 'updatedAt'> = {
          title: c.title,
          emoji: c.emoji,
          frequency,
          points: c.points,
          rotation,
          memberIds: pool,
          assigneeId: rotation === 'anyone' ? undefined : pool[(existing.length + i) % pool.length],
          // Spread the first round over the coming week unless the flat has a cleaning day.
          dueDate: onCleaningDay ? nextWeekday(T, day) : addDays(T, Math.min(i, 6)),
        };
        if (onCleaningDay || c.fixedSchedule) draftChore.fixedSchedule = true;
        if (!draftChore.assigneeId) delete draftChore.assigneeId;
        return draftChore;
      }),
    );
    props.nav.next();
  };

  const weekdays = Array.from({ length: 7 }, (_, i) => fmtDate(addDays('2024-01-01', i), 'weekdayShort'));

  return (
    <Frame nav={props.nav} title={t('setup.chores.title')} sub={t('setup.chores.sub')} onNext={save}>
      <div class="list">
        {all.map((c) => {
          const has = existingTitles.has(c.title.toLowerCase());
          const on = has || picked.includes(c.key);
          return (
            <div key={c.key} class={cx('row compact setup-chore', has && 'is-done')}>
              <Check on={on} label={c.title} onClick={has ? undefined : () => toggle(c.key)} />
              <div class="main">
                <button type="button" class="setup-chore-name" disabled={has} onClick={() => toggle(c.key)}>
                  <span class="setup-chore-emoji">{c.emoji}</span>
                  {c.title}
                </button>
                {on && !has ? (
                  <select class="select xs" aria-label={`${c.title}: ${t('chore.frequency')}`} value={freqs[c.key] ?? c.freq} onChange={(e: any) => setFreqs({ ...freqs, [c.key]: e.target.value })}>
                    {FREQS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {freqLabel(o.f)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div class="sub">{has ? t('setup.chores.exists') : freqLabel(freqFrom(c.freq))}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div class="input-group mt-12">
        <input
          class="input"
          placeholder={t('setup.chores.custom')}
          value={draft}
          maxLength={60}
          onInput={(e: any) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && addCustom()}
        />
        <span class="addon">
          <IconButton icon="plus" label={t('common.add')} onClick={addCustom} style={{ background: 'var(--primary)', color: '#fff' }} />
        </span>
      </div>

      <div class="overline">{t('chore.rotation')}</div>
      <Segmented<RotationMode>
        value={rotation}
        onChange={setRotation}
        options={(['rotate', 'fair', 'anyone'] as RotationMode[]).map((r) => ({ value: r, label: t(`rot.${r}` as Key) }))}
      />
      <p class="hint">{t(`rot.${rotation}Sub` as Key)}</p>

      <div class="overline">{t('setup.chores.day')}</div>
      <div class="chips scroll">
        <button type="button" class={cx('chip', day === null ? 'active' : 'soft')} onClick={() => setDay(null)}>
          {t('setup.chores.dayAny')}
        </button>
        {weekdays.map((label, i) => (
          <button key={i} type="button" class={cx('chip', day === i ? 'active' : 'soft')} onClick={() => setDay(i)}>
            {label}
          </button>
        ))}
      </div>
      <p class="hint">{day === null ? t('setup.chores.dayAnyHint') : t('setup.chores.dayHint')}</p>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · Shopping lists                                                  */
/* ------------------------------------------------------------------ */

const LIST_TEMPLATES: { label: Key; emoji: string }[] = [
  { label: 'list.supermarket', emoji: '🛒' },
  { label: 'list.drugstore', emoji: '🧴' },
  { label: 'list.ikea', emoji: '🛋️' },
  { label: 'list.drinks', emoji: '🥤' },
  { label: 'list.hardware', emoji: '🔨' },
  { label: 'list.pharmacy', emoji: '💊' },
];

function ListsStep(props: { nav: StepNav }) {
  const lists = list('lists');
  const names = new Set(lists.map((l) => l.name.trim().toLowerCase()));
  const [picked, setPicked] = useState<string[]>([]);
  const [customs, setCustoms] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  const options = [...LIST_TEMPLATES.map((l) => ({ name: t(l.label), emoji: l.emoji })), ...customs.map((name) => ({ name, emoji: '🛍️' }))];
  const addCustom = () => {
    const n = draft.trim();
    if (!n || names.has(n.toLowerCase()) || customs.includes(n)) return setDraft('');
    setCustoms([...customs, n]);
    setPicked([...picked, n]);
    setDraft('');
  };

  const save = () => {
    const extra = draft.trim();
    const chosen = options.filter((o) => picked.includes(o.name) && !names.has(o.name.toLowerCase()));
    if (extra && !names.has(extra.toLowerCase()) && !chosen.some((o) => o.name === extra)) chosen.push({ name: extra, emoji: '🛍️' });
    chosen.forEach((o, i) => {
      const order = lists.length + i;
      saveList({ name: o.name, emoji: o.emoji, color: LIST_COLORS[order % LIST_COLORS.length]!, order });
    });
    props.nav.next();
  };

  return (
    <Frame nav={props.nav} title={t('setup.lists.title')} sub={t('setup.lists.sub')} onNext={save}>
      <div class="template-grid">
        {options.map((o) => {
          const has = names.has(o.name.toLowerCase());
          const on = has || picked.includes(o.name);
          return (
            <button key={o.name} type="button" class={on ? 'active' : ''} aria-pressed={on} disabled={has} onClick={() => setPicked(on ? picked.filter((p) => p !== o.name) : [...picked, o.name])}>
              <span class="e">{o.emoji}</span>
              {o.name}
              {has ? <span class="caption">{t('setup.lists.exists')}</span> : null}
            </button>
          );
        })}
      </div>
      <div class="input-group mt-16">
        <input
          class="input"
          placeholder={t('setup.lists.custom')}
          value={draft}
          maxLength={40}
          onInput={(e: any) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && addCustom()}
        />
        <span class="addon">
          <IconButton icon="plus" label={t('common.add')} onClick={addCustom} style={{ background: 'var(--primary)', color: '#fff' }} />
        </span>
      </div>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* 6 · Wi-Fi                                                           */
/* ------------------------------------------------------------------ */

function WifiStep(props: { nav: StepNav }) {
  const hh = household()!;
  const [ssid, setSsid] = useState(hh.wifiSsid ?? '');
  const [password, setPassword] = useState(hh.wifiPassword ?? '');
  const [security, setSecurity] = useState<'WPA' | 'WEP' | 'nopass'>(hh.wifiSecurity ?? 'WPA');
  const [show, setShow] = useState(false);

  const save = () => {
    if (ssid.trim()) {
      update('household', hh.id, { wifiSsid: ssid.trim(), wifiPassword: security === 'nopass' ? undefined : password, wifiSecurity: security });
    }
    props.nav.next();
  };

  return (
    <Frame nav={props.nav} title={t('setup.wifi.title')} sub={t('setup.wifi.sub')} onNext={save}>
      <Field label={t('wifi.ssid')}>
        <input class="input" value={ssid} autoComplete="off" autoCapitalize="none" spellcheck={false} maxLength={64} onInput={(e: any) => setSsid(e.target.value)} />
      </Field>
      {security !== 'nopass' ? (
        <Field label={t('wifi.password')}>
          <div class="input-group">
            <input class="input" type={show ? 'text' : 'password'} value={password} autoComplete="off" autoCapitalize="none" spellcheck={false} maxLength={128} onInput={(e: any) => setPassword(e.target.value)} />
            <span class="addon">
              <IconButton icon={show ? 'eyeOff' : 'eye'} label={show ? t('common.hide') : t('common.show')} variant="plain" size={19} onClick={() => setShow(!show)} />
            </span>
          </div>
        </Field>
      ) : null}
      <div class="setup-label">{t('wifi.security')}</div>
      <Segmented<'WPA' | 'WEP' | 'nopass'>
        value={security}
        onChange={setSecurity}
        options={[
          { value: 'WPA', label: 'WPA/WPA2' },
          { value: 'WEP', label: 'WEP' },
          { value: 'nopass', label: t('wifi.none') },
        ]}
      />
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function DoneStep() {
  const hh = household()!;
  const ms = members();
  const s = store.session;
  const monthly = list('recurring')
    .filter((r) => r.active)
    .reduce((sum, r) => sum + monthlyEquivalent(r.amount, r.frequency), 0);
  const chores = list('chores').filter((c) => !c.paused);
  const lists = [...list('lists')].sort((a, b) => a.order - b.order);
  const names = (xs: string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join(', ')} …` : xs.join(', '));
  // The flat keeps its own emoji; the other areas use the same icons as the rest of the app.
  const rows: { step: StepKey; emoji?: string; icon?: IconName; title: string; sub?: string; done: boolean }[] = [
    { step: 'flat', emoji: hh.emoji, title: hh.name, sub: hh.address ?? t('setup.sum.noAddress'), done: !!hh.address },
    { step: 'members', icon: 'users', title: tp('setup.sum.members', ms.length), sub: names(ms.map((m) => firstName(m.name))), done: ms.length > 1 },
    {
      step: 'costs',
      icon: 'banknote',
      title: monthly ? t('setup.sum.costs', { total: money(monthly) }) : t('setup.sum.costsNone'),
      sub: monthly ? t('setup.costs.perPerson', { amount: money(Math.round(monthly / Math.max(1, ms.length))) }) : undefined,
      done: monthly > 0,
    },
    { step: 'chores', icon: 'sparkles', title: chores.length ? tp('setup.sum.chores', chores.length) : t('setup.sum.choresNone'), sub: names(chores.map((c) => c.title)), done: chores.length > 0 },
    { step: 'lists', icon: 'cart', title: tp('setup.sum.lists', lists.length), sub: names(lists.map((l) => l.name)), done: lists.length > 0 },
    { step: 'wifi', icon: 'wifi', title: hh.wifiSsid ? t('setup.sum.wifi') : t('setup.sum.wifiNone'), sub: hh.wifiSsid, done: !!hh.wifiSsid },
  ];
  const needsInvite = s?.mode === 'cloud' && ms.some((m) => !m.claimed);

  const finish = () => {
    update('household', hh.id, { setupDone: true });
    navigate('/', { replace: true });
    setTimeout(() => confetti(innerWidth / 2, innerHeight * 0.3, 36), 200);
  };

  return (
    <div class="setup">
      <div class="setup-head">
        <IconButton icon="chevronLeft" label={t('common.back')} onClick={() => go(STEPS[STEPS.length - 1]!, true)} />
        <div class="grow">
          <div class="setup-progress">
            <i style={{ width: '100%' }} />
          </div>
        </div>
        <div style={{ width: '40px' }} />
      </div>
      <h1 class="step-title">{t('setup.done.title')}</h1>
      <p class="muted setup-sub">{t('setup.done.sub')}</p>
      <div class="setup-body">
        <div class="list">
          {rows.map((r) => (
            <button key={r.step} type="button" class="row" onClick={() => go(r.step, true)}>
              <span class="setup-emoji">{r.icon ? <Icon name={r.icon} size={20} /> : r.emoji}</span>
              <div class="main">
                <div class="title">{r.title}</div>
                {r.sub ? <div class="sub">{r.sub}</div> : null}
              </div>
              {r.done ? <Icon name="check" size={18} stroke={2.6} class="setup-done-icon" /> : <span class="setup-open">{t('setup.done.add')}</span>}
            </button>
          ))}
        </div>
      </div>
      <div class="setup-foot column">
        {needsInvite ? (
          <Button block icon="userPlus" onClick={() => openInvite()}>
            {t('invite.title')}
          </Button>
        ) : null}
        <Button variant="primary" block onClick={finish}>
          {t('setup.done.go')}
        </Button>
      </div>
    </div>
  );
}
