import { h, Fragment, useLayoutEffect, useMemo, useRef, useState } from '../lib/ui.ts';
import { closeTopSheet, getRoute, navigate, openSheet } from '../lib/router.ts';
import { addMonths, monthKey, startOfMonth, endOfMonth, today, addDays } from '../../../core/src/dates.ts';
import { centsToInput, computeShares, parseAmount, validateSplit } from '../../../core/src/money.ts';
import { expenseImpact, paypalLink, formatIban, spendingStats } from '../../../core/src/balances.ts';
import type { Transfer } from '../../../core/src/balances.ts';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_ORDER, guessExpenseCategory } from '../../../core/src/categories.ts';
import { monthlyEquivalent, nextDue } from '../../../core/src/recurring.ts';
import type { Expense, ExpenseCategory, Frequency, ID, Recurring, SplitMode } from '../../../core/src/types.ts';
import { t } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { currencySymbol, fmtDate, freqLabel, money } from '../i18n/format.ts';
import { get, list, remove } from '../state/store.ts';
import { balances, displayName, firstName, member, members, myId, settleTransfers } from '../state/selectors.ts';
import { bookDueRecurring, saveExpense, saveRecurring, settleUp } from '../state/actions.ts';
import { amountWidth, Avatar, Button, cx, Empty, Field, Icon, IconButton, MemberPicker, Row, scrollActiveChip, Segmented, SwitchRow, Tile } from '../components/core.tsx';
import { confetti, confirmDialog, copyText, Sheet, toast, undoToast } from '../components/overlays.tsx';
import { BarChart, Donut } from '../components/charts.tsx';

void Fragment;

type Tab = 'balances' | 'history' | 'recurring' | 'stats';

export function Money() {
  const route = getRoute();
  const initial = (route.query.get('tab') as Tab) || 'balances';
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div class="screen">
      <h1 class="large-title" style={{ paddingTop: '14px' }}>
        {t('money.title')}
      </h1>
      <Segmented
        class="mt-12"
        value={tab}
        onChange={(v) => {
          setTab(v);
          navigate(`/money?tab=${v}`, { replace: true });
        }}
        options={[
          { value: 'balances', label: t('money.tab.balances') },
          { value: 'history', label: t('money.tab.history') },
          { value: 'recurring', label: t('money.tab.recurring') },
          { value: 'stats', label: t('money.tab.stats') },
        ]}
      />
      <div key={tab} class="fade-in">
        {tab === 'balances' ? <Balances /> : tab === 'history' ? <History /> : tab === 'recurring' ? <RecurringList /> : <Stats />}
      </div>
      {tab === 'recurring' ? (
        <button type="button" class="fab" style={{ '--fab-bg': 'var(--green)' }} onClick={() => openRecurringEditor()}>
          <Icon name="plus" size={22} stroke={2.6} /> {t('recurring.add')}
        </button>
      ) : (
        <button type="button" class="fab" onClick={() => openExpenseEditor()}>
          <Icon name="plus" size={22} stroke={2.6} /> {t('money.addExpense')}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

function Balances() {
  const bal = balances();
  const ms = members();
  const transfers = settleTransfers();
  const max = Math.max(1, ...[...bal.values()].map(Math.abs));
  const hasExpenses = list('expenses').length > 0;
  if (!hasExpenses) {
    return <Empty art="💸" title={t('money.emptyTitle')} sub={t('money.emptySub')} action={<Button variant="primary" icon="plus" onClick={() => openExpenseEditor()}>{t('money.newExpense')}</Button>} />;
  }
  return (
    <>
      <div class="section-title">{t('money.balancesTitle')}</div>
      <div class="card">
        {ms.map((m) => {
          const v = bal.get(m.id) ?? 0;
          return (
            <div key={m.id} class="bal-row">
              <Avatar member={m} size={34} />
              <span class="name">{displayName(m.id)}</span>
              <div class="track">
                <i class="mid" />
                {v !== 0 ? <i class={cx('fill', v > 0 ? 'pos' : 'neg')} style={{ width: `${Math.max(3, (Math.abs(v) / max) * 50)}%` }} /> : null}
              </div>
              <span class={cx('amt num', v > 0 && 'pos', v < 0 && 'neg', v === 0 && 'faint')}>{v === 0 ? '±0' : money(v, { sign: true })}</span>
            </div>
          );
        })}
      </div>

      <div class="section-title">{t('money.howToSettle')}</div>
      {transfers.length ? (
        <>
          <p class="caption" style={{ margin: '-4px 4px 10px' }}>
            {t('money.howToSettleSub')}
          </p>
          <div class="list">
            {transfers.map((tr) => (
              <div key={tr.from + tr.to} class="row">
                <div class="avatar-stack">
                  <Avatar member={member(tr.from)} size={36} ring />
                  <Avatar member={member(tr.to)} size={36} ring />
                </div>
                <div class="main">
                  <div class="title">{t('money.transferRow', { from: displayName(tr.from), to: displayName(tr.to) })}</div>
                  <div class="sub num" style={{ fontWeight: 700, color: tr.from === myId() ? 'var(--red)' : tr.to === myId() ? 'var(--green)' : 'var(--text-2)' }}>
                    {money(tr.amount)}
                  </div>
                </div>
                <Button size="sm" variant={tr.from === myId() || tr.to === myId() ? 'primary' : 'default'} onClick={() => openSettle(tr)}>
                  {t('money.markPaid')}
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div class="card center" style={{ padding: '26px 16px' }}>
          <div style={{ fontSize: '40px' }}>🎉</div>
          <div style={{ fontWeight: 750, fontSize: '17px', marginTop: '6px' }}>{t('money.allSettled')}</div>
          <div class="muted" style={{ fontSize: '14.5px' }}>
            {t('money.allSettledSub')}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function ExpenseRow(props: { e: Expense }) {
  const e = props.e;
  const me = myId();
  if (e.kind === 'transfer') {
    const to = e.split[0]?.memberId;
    return (
      <Row
        onClick={() => openExpenseEditor(e.id)}
        lead={<Tile emoji="🤝" color="#14B8A6" />}
        title={t('money.transferRow', { from: displayName(e.paidBy), to: displayName(to) })}
        sub={`${t('money.transfer')} · ${fmtDate(e.date, 'dayMonth')}`}
        end={<div class="amount num">{money(e.amount)}</div>}
      />
    );
  }
  const impact = expenseImpact(e, me);
  const involved = e.paidBy === me || e.split.some((p) => p.memberId === me);
  const cat = EXPENSE_CATEGORIES[e.category];
  return (
    <Row
      onClick={() => openExpenseEditor(e.id)}
      lead={<Tile emoji={cat.emoji} color={cat.color} />}
      title={e.title}
      sub={`${displayName(e.paidBy)} · ${fmtDate(e.date, 'dayMonth')}${e.recurringId ? ' · 🔁' : ''}`}
      end={
        <>
          <div class="amount num">{money(e.amount)}</div>
          <div
            class={cx('caption num', involved && impact > 0 && 'pos', involved && impact < 0 && 'neg')}
            style={{ fontWeight: 700 }}
            title={!involved ? t('money.notInvolved') : impact > 0 ? t('money.youLent') : t('money.youBorrowed')}
          >
            {!involved || impact === 0 ? '–' : money(impact, { sign: true })}
          </div>
        </>
      }
    />
  );
}

function History() {
  const [q, setQ] = useState('');
  const all = list('expenses');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...all]
      .filter((e) => !needle || e.title.toLowerCase().includes(needle) || (e.note ?? '').toLowerCase().includes(needle) || t(`cat.${e.category}` as Key).toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }, [all, q]);
  if (!all.length) {
    return <Empty art="🧾" title={t('money.emptyTitle')} sub={t('money.emptySub')} action={<Button variant="primary" icon="plus" onClick={() => openExpenseEditor()}>{t('money.newExpense')}</Button>} />;
  }
  const groups = new Map<string, Expense[]>();
  for (const e of filtered) {
    const k = monthKey(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(e);
  }
  return (
    <>
      <div class="input-group mt-16">
        <input class="input" type="search" placeholder={t('money.searchPlaceholder')} value={q} onInput={(e: any) => setQ(e.target.value)} style={{ paddingLeft: '44px' }} />
        <Icon name="search" size={19} class="faint" style={{ position: 'absolute', left: '15px' }} />
      </div>
      {filtered.length === 0 ? <p class="muted center mt-24">{t('money.noResults')}</p> : null}
      {[...groups.entries()].map(([month, items]) => {
        const total = items.filter((e) => e.kind === 'expense').reduce((a, e) => a + e.amount, 0);
        return (
          <div key={month}>
            <div class="overline" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{fmtDate(month + '-01', 'monthYear')}</span>
              <span class="num">{money(total)}</span>
            </div>
            <div class="list">
              {items.map((e) => (
                <ExpenseRow key={e.id} e={e} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Recurring                                                           */
/* ------------------------------------------------------------------ */

function RecurringList() {
  const items = [...list('recurring')].sort((a, b) => Number(b.active) - Number(a.active) || b.amount - a.amount);
  const T = today();
  if (!items.length) {
    return (
      <Empty
        art="🔁"
        title={t('recurring.emptyTitle')}
        sub={t('recurring.emptySub')}
        action={
          <Button variant="primary" icon="plus" onClick={() => openRecurringEditor()}>
            {t('recurring.new')}
          </Button>
        }
      />
    );
  }
  const active = items.filter((r) => r.active);
  const monthly = active.reduce((a, r) => a + monthlyEquivalent(r.amount, r.frequency), 0);
  const n = Math.max(1, members().length);
  return (
    <>
      <div class="hero green mt-16">
        <div class="label">{t('recurring.perMonth')}</div>
        <div class="big num">{money(monthly)}</div>
        <div class="sub">{t('recurring.perPerson', { amount: money(Math.round(monthly / n)) })}</div>
      </div>
      <p class="caption" style={{ margin: '14px 4px 10px' }}>
        {t('recurring.sub')}
      </p>
      <div class="list">
        {items.map((r) => {
          const next = r.active ? nextDue(r, T) : null;
          const cat = EXPENSE_CATEGORIES[r.category];
          return (
            <Row
              key={r.id}
              onClick={() => openRecurringEditor(r.id)}
              lead={<Tile emoji={r.emoji ?? cat.emoji} color={cat.color} />}
              title={r.title}
              sub={
                !r.active
                  ? t('recurring.paused')
                  : `${freqLabel(r.frequency)} · ${r.autoBook && next ? t('recurring.next', { date: fmtDate(next, 'dayMonth') }) : displayName(r.paidBy)}`
              }
              end={
                <>
                  <div class="amount num" style={!r.active ? { color: 'var(--text-3)' } : undefined}>
                    {money(r.amount)}
                  </div>
                  <div class="caption num">{money(Math.round(r.amount / Math.max(1, r.split.length)))} {t('common.perPersonShort')}</div>
                </>
              }
            />
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

function Stats() {
  const [month, setMonth] = useState(startOfMonth(today()));
  const expenses = list('expenses');
  const cur = spendingStats(expenses, month, endOfMonth(month));
  const prevMonth = addMonths(month, -1);
  const prev = spendingStats(expenses, prevMonth, endOfMonth(prevMonth));
  const ms = members();
  const slices = EXPENSE_CATEGORY_ORDER.map((c) => ({ key: c, value: cur.byCategory.get(c) ?? 0, color: EXPENSE_CATEGORIES[c].color })).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const bars = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(month, i - 5);
    const v = spendingStats(expenses, m, endOfMonth(m)).total;
    return { key: m, label: fmtDate(m, 'month'), value: v, current: i === 5, display: v ? money(v, { compact: true }) : '' };
  });
  const delta = prev.total ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null;
  return (
    <>
      <div class="hstack mt-16">
        <IconButton icon="chevronLeft" label="prev" onClick={() => setMonth(addMonths(month, -1))} />
        <div class="grow center" style={{ fontWeight: 750, fontSize: '17px' }}>
          {fmtDate(month, 'monthYear')}
        </div>
        <IconButton icon="chevronRight" label="next" onClick={() => setMonth(addMonths(month, 1))} />
      </div>
      <div class="card mt-12">
        <div class="caption">{t('money.totalMonth')}</div>
        <div style={{ fontSize: '34px', fontWeight: 820, letterSpacing: '-0.03em' }} class="num">
          {money(cur.total)}
        </div>
        <div class="hstack" style={{ gap: '8px', flexWrap: 'wrap' }}>
          <span class="badge primary num">
            {t('stats.avgPerPerson')} {money(Math.round(cur.total / Math.max(1, ms.length)))}
          </span>
          {delta != null ? <span class={cx('badge num', delta > 0 ? 'red' : 'green')}>{t('stats.vsLast', { pct: (delta > 0 ? '+' : '') + delta + ' %' })}</span> : null}
        </div>
      </div>

      <div class="section-title">{t('stats.byCategory')}</div>
      <div class="card">
        {slices.length ? (
          <div class="donut-wrap">
            <Donut
              slices={slices}
              center={
                <>
                  <span style={{ fontSize: '24px' }}>{EXPENSE_CATEGORIES[slices[0]!.key as ExpenseCategory].emoji}</span>
                  <span class="caption">{Math.round((slices[0]!.value / cur.total) * 100)} %</span>
                </>
              }
            />
            <div class="legend">
              {slices.slice(0, 6).map((s) => (
                <div key={s.key} class="li">
                  <span class="sw" style={{ background: s.color }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t(`cat.${s.key}` as Key)}</span>
                  <span class="v num">{money(s.value, { compact: true })}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p class="muted center">{t('stats.noData')}</p>
        )}
      </div>

      <div class="section-title">{t('stats.last6')}</div>
      <div class="card">
        <BarChart bars={bars} />
      </div>

      <div class="section-title">{t('stats.whoPaid')}</div>
      <div class="list">
        {ms.map((m) => {
          const paid = cur.paidBy.get(m.id) ?? 0;
          const share = cur.consumedBy.get(m.id) ?? 0;
          const maxV = Math.max(1, ...ms.map((x) => Math.max(cur.paidBy.get(x.id) ?? 0, cur.consumedBy.get(x.id) ?? 0)));
          return (
            <div key={m.id} class="row">
              <Avatar member={m} size={36} />
              <div class="main">
                <div class="title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{displayName(m.id)}</span>
                  <span class="num" style={{ fontSize: '14px' }}>
                    {money(paid)}
                  </span>
                </div>
                <div class="progress mt-8" style={{ height: '6px' }}>
                  <i style={{ width: `${(paid / maxV) * 100}%`, '--bar': m.color }} />
                </div>
                <div class="caption mt-8 num">
                  {t('stats.consumed')}: {money(share)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Expense editor                                                      */
/* ------------------------------------------------------------------ */

export function openExpenseEditor(id?: ID, preset: Partial<Expense> = {}): void {
  openSheet(() => <ExpenseEditor id={id} preset={preset} />);
}

function ExpenseEditor(props: { id?: ID; preset: Partial<Expense> }) {
  const existing = props.id ? get('expenses', props.id) : undefined;
  if (existing?.kind === 'transfer') return <TransferView e={existing} />;
  const ms = members();
  const me = myId();
  const init = existing ?? (props.preset as Partial<Expense>);
  const [amountStr, setAmountStr] = useState(init.amount ? centsToInput(init.amount) : '');
  const [title, setTitle] = useState(init.title ?? '');
  const [category, setCategory] = useState<ExpenseCategory>(init.category ?? 'other');
  const [catTouched, setCatTouched] = useState(!!existing || !!init.category);
  const [paidBy, setPaidBy] = useState(init.paidBy ?? me);
  const [date, setDate] = useState(init.date ?? today());
  const [mode, setMode] = useState<SplitMode>(init.splitMode ?? 'equal');
  const [selected, setSelected] = useState<ID[]>(init.split?.map((p) => p.memberId) ?? ms.map((m) => m.id));
  const [values, setValues] = useState<Record<ID, string>>(() => {
    const v: Record<ID, string> = {};
    for (const p of init.split ?? []) v[p.memberId] = init.splitMode === 'exact' ? centsToInput(p.value) : String(p.value);
    return v;
  });
  const [note, setNote] = useState(init.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const chipsRef = useRef<HTMLDivElement>();
  useLayoutEffect(() => scrollActiveChip(chipsRef.current), [category]);

  const amount = parseAmount(amountStr) ?? 0;
  // Former members stay visible on old expenses.
  const people = [...ms, ...(init.split ?? []).map((p) => member(p.memberId)).filter((m): m is NonNullable<typeof m> => !!m && !ms.includes(m))];

  const defaultValue = (id: ID): string => {
    if (mode === 'shares') return '1';
    if (mode === 'percent') return String(Math.round((100 / Math.max(1, selected.length)) * 100) / 100);
    return '';
  };
  const split = selected.map((memberId) => {
    const raw = values[memberId] ?? defaultValue(memberId);
    const value = mode === 'equal' ? 1 : mode === 'exact' ? (parseAmount(raw) ?? 0) : Number(String(raw).replace(',', '.')) || 0;
    return { memberId, value };
  });
  const shares = computeShares(amount, mode, split);
  const splitError = amount > 0 ? validateSplit(amount, mode, split) : null;
  let splitHint: string | null = null;
  if (mode === 'equal' && selected.length && amount) splitHint = t('expense.each', { amount: money(Math.round(amount / selected.length)) });
  if (mode === 'exact') {
    const diff = amount - split.reduce((a, p) => a + p.value, 0);
    if (diff > 0) splitHint = t('expense.remaining', { amount: money(diff) });
    if (diff < 0) splitHint = t('expense.tooMuch', { amount: money(-diff) });
  }
  if (mode === 'percent') {
    const diff = Math.round((100 - split.reduce((a, p) => a + p.value, 0)) * 100) / 100;
    if (diff > 0) splitHint = t('expense.percentLeft', { n: diff });
    if (diff < 0) splitHint = t('expense.percentTooMuch', { n: -diff });
  }

  const onTitle = (v: string) => {
    setTitle(v);
    if (!catTouched) {
      const g = guessExpenseCategory(v);
      if (g) setCategory(g);
    }
  };

  const save = () => {
    if (!amount || amount <= 0) return setError(t('expense.amountRequired'));
    if (!title.trim()) return setError(t('expense.titleRequired'));
    if (!selected.length) return setError(t('expense.participantsRequired'));
    if (splitError) return setError(splitHint ?? t('error.generic'));
    saveExpense(
      {
        kind: 'expense',
        title: title.trim(),
        amount,
        paidBy,
        date,
        category,
        splitMode: mode,
        split,
        note: note.trim() || undefined,
        recurringId: existing?.recurringId,
        listId: existing?.listId ?? props.preset.listId,
      },
      existing?.id,
    );
    closeTopSheet();
    toast(t('expense.saved'), { emoji: EXPENSE_CATEGORIES[category].emoji });
  };

  const del = async () => {
    if (!existing) return;
    await closeTopSheet();
    const undo = remove('expenses', existing.id);
    undoToast(t('expense.deleted'), undo, '🗑️');
  };

  return (
    <Sheet
      title={existing ? t('money.editExpense') : t('money.newExpense')}
      right={existing ? <IconButton icon="trash" label={t('common.delete')} variant="soft" size={18} onClick={del} style={{ color: 'var(--red)' }} /> : null}
      footer={
        <Button variant="primary" block onClick={save} disabled={!amount}>
          {t('expense.save')}
        </Button>
      }
    >
      <div class="amount-input">
        <input
          inputMode="decimal"
          placeholder="0"
          value={amountStr}
          autoFocus={!existing}
          aria-label={t('common.amount')}
          onInput={(e: any) => {
            setAmountStr(e.target.value.replace(/[^\d.,]/g, ''));
            setError(null);
          }}
          style={{ width: amountWidth(amountStr) }}
        />
        <span class="cur">{currencySymbol()}</span>
      </div>
      <div class="input-group mb-12">
        <input
          class="input"
          placeholder={t('expense.titlePlaceholder')}
          value={title}
          maxLength={80}
          onInput={(e: any) => onTitle(e.target.value)}
          style={{ paddingLeft: '58px' }}
        />
        <span style={{ position: 'absolute', left: '8px' }}>
          <Tile emoji={EXPENSE_CATEGORIES[category].emoji} color={EXPENSE_CATEGORIES[category].color} size="sm" />
        </span>
      </div>
      <div class="chips scroll mb-12" ref={chipsRef}>
        {EXPENSE_CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            class={cx('chip', c === category ? 'active' : 'soft')}
            onClick={() => {
              setCategory(c);
              setCatTouched(true);
            }}
          >
            {EXPENSE_CATEGORIES[c].emoji} {t(`cat.${c}` as Key)}
          </button>
        ))}
      </div>

      <div class="overline">{t('expense.paidBy')}</div>
      <MemberPicker members={people} value={[paidBy]} onChange={(ids) => setPaidBy(ids[0]!)} meId={me} />

      <div class="overline" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{t('expense.splitBetween')}</span>
        {splitHint ? <span style={{ textTransform: 'none', letterSpacing: 0, color: splitError ? 'var(--red)' : 'var(--text-2)' }}>{splitHint}</span> : null}
      </div>
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setValues({});
        }}
        options={[
          { value: 'equal', label: t('expense.split.equal') },
          { value: 'shares', label: t('expense.split.shares') },
          { value: 'exact', label: t('expense.split.exact') },
          { value: 'percent', label: '%' },
        ]}
      />
      <div class="list mt-12">
        {people.map((m) => {
          const on = selected.includes(m.id);
          const share = shares.get(m.id) ?? 0;
          return (
            <div key={m.id} class="row compact">
              <button
                type="button"
                class={cx('check', on && 'on')}
                aria-pressed={on}
                onClick={() => setSelected(on ? selected.filter((x) => x !== m.id) : [...selected, m.id])}
              >
                <Icon name="check" size={16} stroke={3} />
              </button>
              <Avatar member={m} size={32} />
              <div class="main">
                <div class="title" style={{ fontSize: '15px' }}>
                  {displayName(m.id)}
                </div>
                {on && mode !== 'equal' && mode !== 'exact' && amount ? <div class="sub num">{money(share)}</div> : null}
              </div>
              {on ? (
                mode === 'equal' ? (
                  <span class="num muted" style={{ fontWeight: 650 }}>
                    {amount ? money(share) : ''}
                  </span>
                ) : mode === 'shares' ? (
                  <div class="hstack" style={{ gap: '6px' }}>
                    <IconButton icon="minus" label="-" variant="soft" size={16} onClick={() => setValues({ ...values, [m.id]: String(Math.max(0, (Number(values[m.id] ?? 1) || 0) - 1)) })} />
                    <span class="num" style={{ minWidth: '22px', textAlign: 'center', fontWeight: 750 }}>
                      {values[m.id] ?? '1'}
                    </span>
                    <IconButton icon="plus" label="+" variant="soft" size={16} onClick={() => setValues({ ...values, [m.id]: String((Number(values[m.id] ?? 1) || 0) + 1) })} />
                  </div>
                ) : (
                  <div class="input-group" style={{ width: '112px' }}>
                    <input
                      class="input num"
                      inputMode="decimal"
                      style={{ height: '40px', paddingRight: '30px', textAlign: 'right', fontSize: '15px' }}
                      placeholder={mode === 'exact' ? '0,00' : defaultValue(m.id)}
                      value={values[m.id] ?? (mode === 'percent' ? defaultValue(m.id) : '')}
                      onInput={(e: any) => setValues({ ...values, [m.id]: e.target.value })}
                    />
                    <span class="faint" style={{ position: 'absolute', right: '12px', fontWeight: 700, fontSize: '14px' }}>
                      {mode === 'exact' ? currencySymbol() : '%'}
                    </span>
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>

      <div class="form-row mt-16">
        <Field label={t('common.date')}>
          <input class="input" type="date" value={date} onInput={(e: any) => e.target.value && setDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t('expense.note')}>
        <input class="input" placeholder={t('expense.notePlaceholder')} value={note} maxLength={300} onInput={(e: any) => setNote(e.target.value)} />
      </Field>
      {existing?.recurringId ? <p class="hint">🔁 {t('expense.fromRecurring')}</p> : null}
      {existing?.listId ? <p class="hint">🛒 {t('expense.fromShopping')}</p> : null}
      {error ? <div class="error-text center">{error}</div> : null}
    </Sheet>
  );
}

function TransferView(props: { e: Expense }) {
  const e = props.e;
  const to = e.split[0]?.memberId;
  const del = async () => {
    await closeTopSheet();
    const undo = remove('expenses', e.id);
    undoToast(t('expense.deleted'), undo, '🗑️');
  };
  return (
    <Sheet title={t('money.transfer')}>
      <div class="center" style={{ padding: '12px 0 20px' }}>
        <div class="hstack" style={{ justifyContent: 'center', gap: '14px' }}>
          <Avatar member={member(e.paidBy)} size={60} />
          <Icon name="arrowRight" size={26} class="faint" />
          <Avatar member={member(to)} size={60} />
        </div>
        <div style={{ fontSize: '40px', fontWeight: 820, marginTop: '14px', letterSpacing: '-0.03em' }} class="num">
          {money(e.amount)}
        </div>
        <div class="muted">
          {t('money.transferRow', { from: displayName(e.paidBy), to: displayName(to) })} · {fmtDate(e.date, 'medium')}
        </div>
        {e.method ? <span class="badge mt-12">{t(`method.${e.method}` as Key)}</span> : null}
      </div>
      <Button variant="danger" block icon="trash" onClick={del}>
        {t('common.delete')}
      </Button>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Settle up                                                           */
/* ------------------------------------------------------------------ */

export function openSettle(tr?: Transfer): void {
  openSheet(() => <SettleSheet tr={tr} />);
}

function SettleSheet(props: { tr?: Transfer }) {
  const ms = members();
  const me = myId();
  const fallback = settleTransfers().find((x) => x.from === me || x.to === me);
  const tr = props.tr ?? fallback;
  const [from, setFrom] = useState(tr?.from ?? me);
  const [to, setTo] = useState(tr?.to ?? ms.find((m) => m.id !== me)?.id ?? me);
  const [amountStr, setAmountStr] = useState(tr ? centsToInput(tr.amount) : '');
  const [method, setMethod] = useState<NonNullable<Expense['method']>>('paypal');
  const amount = parseAmount(amountStr) ?? 0;
  const recipient = member(to);

  const confirm = () => {
    if (from === to || amount <= 0) return;
    settleUp(from, to, amount, method);
    closeTopSheet();
    confetti(innerWidth / 2, innerHeight * 0.4);
    toast(t('settle.done'), { emoji: '🤝' });
  };

  return (
    <Sheet
      title={t('settle.title')}
      footer={
        <Button variant="primary" block disabled={from === to || amount <= 0} onClick={confirm} icon="check">
          {t('settle.confirm')}
        </Button>
      }
    >
      <div class="overline">{t('settle.from')}</div>
      <MemberPicker members={ms} value={[from]} onChange={(ids) => setFrom(ids[0]!)} meId={me} />
      <div class="overline">{t('settle.to')}</div>
      <MemberPicker members={ms} value={[to]} onChange={(ids) => setTo(ids[0]!)} meId={me} />
      {from === to ? <div class="error-text">{t('settle.same')}</div> : null}
      <div class="amount-input">
        <input inputMode="decimal" placeholder="0" value={amountStr} onInput={(e: any) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ''))} style={{ width: amountWidth(amountStr) }} />
        <span class="cur">{currencySymbol()}</span>
      </div>
      <div class="overline">{t('settle.method')}</div>
      <div class="chips">
        {(['paypal', 'bank', 'cash', 'other'] as const).map((m) => (
          <button key={m} type="button" class={cx('chip', method === m ? 'active' : 'soft')} onClick={() => setMethod(m)}>
            {m === 'paypal' ? '🅿️' : m === 'bank' ? '🏦' : m === 'cash' ? '💶' : '✨'} {t(`method.${m}` as Key)}
          </button>
        ))}
      </div>
      {from === me && method === 'paypal' && recipient ? (
        recipient.paypal ? (
          <Button block class="mt-16" style={{ background: '#0070e0', color: '#fff' }} onClick={() => window.open(paypalLink(recipient.paypal!, amount), '_blank', 'noopener')}>
            {t('settle.paypalOpen')} · {money(amount)}
          </Button>
        ) : (
          <p class="hint">{t('settle.noPaypal', { name: firstName(recipient.name) })}</p>
        )
      ) : null}
      {from === me && method === 'bank' && recipient?.iban ? (
        <div class="card flat mt-16" style={{ background: 'var(--fill)' }}>
          <div class="caption">{t('settle.ibanOf', { name: firstName(recipient.name) })}</div>
          <div class="hstack mt-8">
            <span class="kbd-code grow" style={{ letterSpacing: '0.04em', fontSize: '15px' }}>
              {formatIban(recipient.iban)}
            </span>
            <IconButton icon="copy" label={t('settle.copyIban')} onClick={() => copyText(recipient.iban!.replace(/\s/g, ''))} />
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Recurring editor                                                    */
/* ------------------------------------------------------------------ */

const FREQS: { key: string; f: Frequency }[] = [
  { key: 'weekly', f: { unit: 'week', every: 1 } },
  { key: 'monthly', f: { unit: 'month', every: 1 } },
  { key: 'quarterly', f: { unit: 'month', every: 3 } },
  { key: 'yearly', f: { unit: 'year', every: 1 } },
];

export function openRecurringEditor(id?: ID): void {
  openSheet(() => <RecurringEditor id={id} />);
}

function RecurringEditor(props: { id?: ID }) {
  const existing = props.id ? get('recurring', props.id) : undefined;
  const ms = members();
  const me = myId();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [amountStr, setAmountStr] = useState(existing ? centsToInput(existing.amount) : '');
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'rent');
  const [catTouched, setCatTouched] = useState(!!existing);
  const [freqKey, setFreqKey] = useState(FREQS.find((x) => x.f.unit === existing?.frequency.unit && x.f.every === existing?.frequency.every)?.key ?? 'monthly');
  const [start, setStart] = useState(existing?.startDate ?? addDays(today(), 1));
  const [paidBy, setPaidBy] = useState(existing?.paidBy ?? me);
  const [selected, setSelected] = useState<ID[]>(existing?.split.map((p) => p.memberId) ?? ms.map((m) => m.id));
  const [autoBook, setAutoBook] = useState(existing?.autoBook ?? true);
  const [active, setActive] = useState(existing?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmount(amountStr) ?? 0;

  const save = () => {
    if (!title.trim()) return setError(t('expense.titleRequired'));
    if (!amount) return setError(t('expense.amountRequired'));
    if (!selected.length) return setError(t('expense.participantsRequired'));
    const data: Omit<Recurring, 'id' | 'createdAt' | 'updatedAt'> = {
      title: title.trim(),
      emoji: EXPENSE_CATEGORIES[category].emoji,
      amount,
      category,
      paidBy,
      splitMode: 'equal',
      split: selected.map((memberId) => ({ memberId, value: 1 })),
      frequency: FREQS.find((x) => x.key === freqKey)!.f,
      startDate: start,
      autoBook,
      active,
      lastBooked: existing && existing.startDate === start ? existing.lastBooked : undefined,
      contractId: existing?.contractId,
    };
    saveRecurring(data, existing?.id);
    const booked = bookDueRecurring();
    closeTopSheet();
    toast(booked ? t('recurring.booked', { title: data.title }) : t('expense.saved'), { emoji: '🔁' });
  };

  const del = async () => {
    if (!existing) return;
    const ok = await confirmDialog({ title: t('common.confirmDelete'), message: existing.title, confirm: t('common.delete'), destructive: true, emoji: '🗑️' });
    if (!ok) return;
    await closeTopSheet();
    const undo = remove('recurring', existing.id);
    undoToast(t('common.deleted'), undo);
  };

  return (
    <Sheet
      title={existing ? t('recurring.edit') : t('recurring.new')}
      right={existing ? <IconButton icon="trash" label={t('common.delete')} variant="soft" size={18} onClick={del} style={{ color: 'var(--red)' }} /> : null}
      footer={
        <Button variant="primary" block onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <div class="amount-input">
        <input inputMode="decimal" placeholder="0" value={amountStr} autoFocus={!existing} onInput={(e: any) => setAmountStr(e.target.value.replace(/[^\d.,]/g, ''))} style={{ width: amountWidth(amountStr) }} />
        <span class="cur">{currencySymbol()}</span>
      </div>
      <Field>
        <input
          class="input"
          placeholder={t('recurring.titlePlaceholder')}
          value={title}
          maxLength={60}
          onInput={(e: any) => {
            setTitle(e.target.value);
            if (!catTouched) {
              const g = guessExpenseCategory(e.target.value);
              if (g) setCategory(g);
            }
          }}
        />
      </Field>
      <div class="chips scroll mb-12">
        {(['rent', 'utilities', 'internet', 'subscriptions', 'insurance', 'household', 'other'] as ExpenseCategory[]).map((c) => (
          <button
            key={c}
            type="button"
            class={cx('chip', c === category ? 'active' : 'soft')}
            onClick={() => {
              setCategory(c);
              setCatTouched(true);
            }}
          >
            {EXPENSE_CATEGORIES[c].emoji} {t(`cat.${c}` as Key)}
          </button>
        ))}
      </div>
      <div class="form-row">
        <Field label={t('recurring.frequency')}>
          <select class="select" value={freqKey} onChange={(e: any) => setFreqKey(e.target.value)}>
            {FREQS.map((x) => (
              <option key={x.key} value={x.key}>
                {freqLabel(x.f)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('recurring.start')}>
          <input class="input" type="date" value={start} onInput={(e: any) => e.target.value && setStart(e.target.value)} />
        </Field>
      </div>
      <div class="overline">{t('expense.paidBy')}</div>
      <MemberPicker members={ms} value={[paidBy]} onChange={(ids) => setPaidBy(ids[0]!)} meId={me} />
      <div class="overline">{t('expense.splitBetween')}</div>
      <MemberPicker members={ms} value={selected} multiple onChange={setSelected} meId={me} />
      <div class="list mt-16">
        <SwitchRow title={t('recurring.autoBook')} sub={t('recurring.autoBookHint')} on={autoBook} onChange={setAutoBook} />
        {existing ? <SwitchRow title={t('recurring.active')} on={active} onChange={setActive} /> : null}
      </div>
      {error ? <div class="error-text center mt-12">{error}</div> : null}
    </Sheet>
  );
}
