import { h, Fragment, useState } from '../lib/ui.ts';
import { closeTopSheet, openSheet } from '../lib/router.ts';
import { addDays, diffDays, startOfMonth, today } from '../../../core/src/dates.ts';
import { CHORE_TEMPLATES, choreState, eligibleMembers, leaderboard, nextAssignee, pointsByMember, weeklyStreak } from '../../../core/src/chores.ts';
import type { Chore, Frequency, ID, RotationMode } from '../../../core/src/types.ts';
import { t, tp } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { fmtDate, freqLabel, percent, timeAgo } from '../i18n/format.ts';
import { get, list, remove, update } from '../state/store.ts';
import { displayName, member, members, memberIsAway, myId } from '../state/selectors.ts';
import { finishChore, saveChore } from '../state/actions.ts';
import { Avatar, Button, Check, cx, Empty, EmojiGrid, Field, Icon, IconButton, MemberPicker, Row, Segmented, SwitchRow, Tile } from '../components/core.tsx';
import { confetti, confirmDialog, Sheet, toast, undoToast } from '../components/overlays.tsx';

void Fragment;

/** Chores due today or earlier that are mine or open to anyone. */
export function choresDueForMe(): Chore[] {
  const T = today();
  return list('chores')
    .filter((c) => !c.paused && c.dueDate <= T && isMine(c))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Assigned to me, or open to anyone (rotation "anyone" or nobody assigned). */
function isMine(c: Chore): boolean {
  return c.assigneeId === myId() || c.rotation === 'anyone' || !c.assigneeId;
}

function dueLabel(c: Chore): string {
  const d = diffDays(today(), c.dueDate);
  if (d < 0) return tp('chores.due.overdue', -d);
  if (d === 0) return t('chores.due.today');
  if (d === 1) return t('chores.due.tomorrow');
  if (d < 7) return t('chores.due.inDays', { n: d });
  return fmtDate(c.dueDate, 'weekday');
}

function complete(c: Chore, e?: MouseEvent): void {
  const undo = finishChore(c.id, 'done');
  confetti(e?.clientX, e?.clientY, 22);
  undoToast(t('chores.doneToast', { points: c.points }), undo, c.emoji);
}

/** Points a chore is worth, as a quiet badge. */
function Points(props: { n: number }) {
  return <span class="badge num">+{props.n}</span>;
}

export function ChoreRow(props: { chore: Chore; showAssignee?: boolean }) {
  const c = props.chore;
  const state = choreState(c, today());
  const assignee = member(c.assigneeId);
  const anyone = c.rotation === 'anyone' || !c.assigneeId;
  return (
    <Row
      onClick={() => openChoreDetail(c.id)}
      lead={<Tile emoji={c.emoji} color={state === 'overdue' ? 'var(--red)' : undefined} />}
      title={c.title}
      sub={
        <span class="chore-sub">
          {props.showAssignee !== false ? (
            anyone ? (
              <>
                <Icon name="users" size={15} class="faint" />
                <span class="who">{t('chores.anyone')}</span>
              </>
            ) : (
              <>
                <Avatar member={assignee} size={18} />
                <span class="who">{displayName(c.assigneeId)}</span>
              </>
            )
          ) : null}
          <span class={cx('when', state === 'overdue' && 'neg')}>· {dueLabel(c)}</span>
        </span>
      }
      end={
        <div class="hstack" style={{ gap: '10px' }}>
          <Points n={c.points} />
          {state !== 'paused' ? <Check on={false} big label={t('chore.markDone')} onClick={(e) => complete(c, e)} color="var(--green)" /> : null}
        </div>
      }
    />
  );
}

type Tab = 'upcoming' | 'all' | 'ranking';

export function Chores() {
  const [tab, setTab] = useState<Tab>('upcoming');
  return (
    <div class="screen">
      <h1 class="large-title" style={{ paddingTop: '14px' }}>
        {t('chores.title')}
      </h1>
      <Segmented
        class="mt-12"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: t('chores.tab.upcoming') },
          { value: 'all', label: t('chores.tab.all') },
          { value: 'ranking', label: t('chores.tab.ranking') },
        ]}
      />
      <div key={tab} class="fade-in">
        {tab === 'upcoming' ? <Upcoming /> : tab === 'all' ? <AllChores /> : <Ranking />}
      </div>
      <button type="button" class="fab" onClick={() => openChoreEditor()}>
        <Icon name="plus" size={22} stroke={2.6} /> {t('chores.add')}
      </button>
    </div>
  );
}

function Upcoming() {
  const [mine, setMine] = useState(false);
  const T = today();
  const all = list('chores').filter((c) => !c.paused);
  if (!list('chores').length) {
    return (
      <Empty
        art="🧽"
        title={t('chores.emptyTitle')}
        sub={t('chores.emptySub')}
        action={
          <Button variant="primary" icon="plus" onClick={() => openChoreEditor()}>
            {t('chores.new')}
          </Button>
        }
      />
    );
  }
  const visible = all.filter((c) => !mine || isMine(c)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const groups: { key: string; title: string; items: Chore[] }[] = [
    { key: 'overdue', title: t('chores.overdue'), items: visible.filter((c) => c.dueDate < T) },
    { key: 'today', title: t('chores.today'), items: visible.filter((c) => c.dueDate === T) },
    { key: 'week', title: t('chores.thisWeek'), items: visible.filter((c) => c.dueDate > T && diffDays(T, c.dueDate) <= 6) },
    { key: 'later', title: t('chores.later'), items: visible.filter((c) => diffDays(T, c.dueDate) > 6) },
  ];
  const pending = groups[0]!.items.length + groups[1]!.items.length;
  return (
    <>
      <div class="chips mt-16">
        <button type="button" class={cx('chip', !mine ? 'active' : '')} onClick={() => setMine(false)}>
          {t('common.all')}
        </button>
        <button type="button" class={cx('chip', mine ? 'active' : '')} onClick={() => setMine(true)}>
          {t('chores.onlyMine')}
        </button>
      </div>
      {pending === 0 ? (
        <div class="card hstack mt-16" style={{ padding: '14px 16px' }}>
          <span class="tile" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
            <Icon name="check" size={20} stroke={2.6} />
          </span>
          <div>
            <div style={{ fontWeight: 650 }}>{t('chores.allClearTitle')}</div>
            <div class="muted" style={{ fontSize: '14px' }}>
              {t('chores.allClearSub')}
            </div>
          </div>
        </div>
      ) : null}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.key}>
            <div class={cx('overline', g.key === 'overdue' && 'neg')}>{g.title}</div>
            <div class="list">
              {g.items.map((c) => (
                <ChoreRow key={c.id} chore={c} />
              ))}
            </div>
          </div>
        ))}
    </>
  );
}

function AllChores() {
  const items = [...list('chores')].sort((a, b) => a.title.localeCompare(b.title));
  if (!items.length) {
    return <Empty art="🧽" title={t('chores.emptyTitle')} sub={t('chores.emptySub')} action={<Button variant="primary" icon="plus" onClick={() => openChoreEditor()}>{t('chores.new')}</Button>} />;
  }
  return (
    <div class="list mt-16">
      {items.map((c) => (
        <Row
          key={c.id}
          onClick={() => openChoreDetail(c.id)}
          lead={<Tile emoji={c.emoji} />}
          title={c.title}
          sub={`${freqLabel(c.frequency)} · ${t(`rot.${c.rotation}` as Key)}${c.paused ? ' · ' + t('chores.paused') : ''}`}
          end={<Points n={c.points} />}
          chevron
        />
      ))}
    </div>
  );
}

function Ranking() {
  const T = today();
  const ms = members();
  const logs = list('choreLogs');
  const board = leaderboard(logs, ms.map((m) => m.id), startOfMonth(T));
  const total = board.reduce((a, e) => a + e.points, 0);
  const last30 = pointsByMember(logs, addDays(T, -30), T);
  const sum30 = [...last30.values()].reduce((a, b) => a + b, 0);
  const ideal = 1 / Math.max(1, ms.length);
  const maxDev = ms.length ? Math.max(...ms.map((m) => Math.abs((last30.get(m.id) ?? 0) / Math.max(1, sum30) - ideal))) : 0;
  const recent = [...logs].filter((l) => l.action === 'done').sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  if (total === 0 && !recent.length) {
    return <Empty art="🏆" title={t('rank.emptyTitle')} sub={t('rank.emptySub')} />;
  }
  const podium = [board[1], board[0], board[2]];
  return (
    <>
      <div class="card mt-16" style={{ paddingBottom: 0, overflow: 'hidden' }}>
        <div class="hstack" style={{ justifyContent: 'space-between' }}>
          <div>
            <div class="caption">{t('rank.month')}</div>
            <div style={{ fontWeight: 700, fontSize: '18px' }}>{t('rank.champion')}</div>
          </div>
          <span class="badge">{fmtDate(T, 'monthYear')}</span>
        </div>
        <div class="podium">
          {podium.map((e, i) => {
            if (!e) return <div key={i} class="place" />;
            const m = member(e.memberId);
            const place = i === 1 ? 1 : i === 0 ? 2 : 3;
            return (
              <div key={e.memberId} class={`place p${place}`}>
                {place === 1 ? <Icon name="crown" size={20} stroke={2.2} style={{ color: 'var(--amber)', marginBottom: '-2px' }} /> : null}
                <Avatar member={m} size={place === 1 ? 58 : 48} />
                <div class="name">{displayName(e.memberId)}</div>
                <div class="pts num">{t('rank.points', { n: e.points })}</div>
                <div class="block">{place}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div class="list mt-16">
        {board.map((e, i) => {
          const m = member(e.memberId);
          const streak = weeklyStreak(logs, e.memberId, T);
          return (
            <Row
              key={e.memberId}
              lead={
                <span class="hstack" style={{ gap: '10px' }}>
                  <span class="num faint" style={{ width: '16px', fontWeight: 650 }}>
                    {i + 1}
                  </span>
                  <Avatar member={m} size={38} />
                </span>
              }
              title={displayName(e.memberId)}
              sub={tp('rank.tasks', e.count)}
              end={
                <span class="hstack" style={{ gap: '8px' }}>
                  {streak >= 2 ? (
                    <span class="badge amber" title={t('rank.streak', { n: streak })} aria-label={t('rank.streak', { n: streak })}>
                      <Icon name="flame" size={13} stroke={2.4} /> {streak}
                    </span>
                  ) : null}
                  <span class="num" style={{ fontWeight: 700, fontSize: '17px' }}>
                    {e.points}
                  </span>
                </span>
              }
            />
          );
        })}
      </div>

      <div class="section-title">{t('rank.fairness')}</div>
      <div class="card">
        <div class="caption mb-12">{t('rank.fairnessSub')}</div>
        <div style={{ display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', gap: '2px' }}>
          {ms.map((m) => {
            const share = sum30 ? (last30.get(m.id) ?? 0) / sum30 : ideal;
            return <i key={m.id} style={{ flex: `${Math.max(0.02, share)} 1 0`, background: m.color }} title={m.name} />;
          })}
        </div>
        <div class="hstack mt-12" style={{ flexWrap: 'wrap', gap: '12px' }}>
          {ms.map((m) => (
            <span key={m.id} class="hstack caption" style={{ gap: '5px' }}>
              <i style={{ width: '9px', height: '9px', borderRadius: '50%', background: m.color, display: 'inline-block' }} />
              {displayName(m.id)} {percent(sum30 ? (last30.get(m.id) ?? 0) / sum30 : 0)}
            </span>
          ))}
        </div>
        <div class={cx('badge mt-12', maxDev < 0.12 ? 'green' : 'amber')}>{maxDev < 0.12 ? t('rank.fairGood') : t('rank.fairBad')}</div>
      </div>

      {recent.length ? (
        <>
          <div class="section-title">{t('rank.recent')}</div>
          <div class="list">
            {recent.map((l) => (
              <Row key={l.id} lead={<Tile emoji={l.emoji} size="sm" />} compact title={l.title} sub={`${displayName(l.memberId)} · ${timeAgo(l.createdAt)}`} end={<Points n={l.points} />} />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Detail                                                              */
/* ------------------------------------------------------------------ */

export function openChoreDetail(id: ID): void {
  openSheet(() => <ChoreDetail id={id} />);
}

function ChoreDetail(props: { id: ID }) {
  const c = get('chores', props.id);
  if (!c) return <Sheet title="" />;
  const ms = members();
  const T = today();
  const history = list('choreLogs')
    .filter((l) => l.choreId === c.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10);
  const after = c.rotation !== 'anyone' ? nextAssignee(c, c.assigneeId, list('members'), list('choreLogs'), T, list('events')) : undefined;
  const state = choreState(c, T);

  const done = async (e: MouseEvent) => {
    await closeTopSheet();
    complete(c, e);
  };
  const skip = async () => {
    await closeTopSheet();
    const undo = finishChore(c.id, 'skipped');
    undoToast(t('chores.skippedToast'), undo);
  };
  const del = async () => {
    const ok = await confirmDialog({ title: t('common.confirmDelete'), message: c.title, confirm: t('common.delete'), destructive: true, emoji: c.emoji });
    if (!ok) return;
    await closeTopSheet();
    const undo = remove('chores', c.id);
    undoToast(t('chore.deleted'), undo);
  };

  return (
    <Sheet
      title=""
      right={
        <>
          <IconButton icon="pencil" label={t('common.edit')} variant="soft" size={18} onClick={() => closeTopSheet().then(() => openChoreEditor(c.id))} />
          <IconButton icon="trash" label={t('common.delete')} variant="soft" size={18} onClick={del} style={{ color: 'var(--red)' }} />
        </>
      }
    >
      <div class="center" style={{ marginTop: '-8px' }}>
        <Tile emoji={c.emoji} size="xl" color={state === 'overdue' ? 'var(--red)' : 'var(--amber)'} />
        <h2 style={{ margin: '12px 0 4px', fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em' }}>{c.title}</h2>
        <div class="muted">
          {freqLabel(c.frequency)} · {t('chore.pointsValue', { n: c.points })}
        </div>
        <div class="hstack" style={{ justifyContent: 'center', marginTop: '12px', gap: '8px', flexWrap: 'wrap' }}>
          <span class={cx('badge', state === 'overdue' ? 'red' : state === 'today' ? 'amber' : '')}>
            <Icon name="calendar" size={13} stroke={2.4} /> {dueLabel(c)}
          </span>
          <span class="badge">
            <Icon name="repeat" size={13} stroke={2.4} /> {t(`rot.${c.rotation}` as Key)}
          </span>
        </div>
      </div>
      {c.description ? <p class="muted center">{c.description}</p> : null}

      <div class="list mt-16">
        <Row
          lead={c.assigneeId ? <Avatar member={member(c.assigneeId)} size={40} /> : <Tile icon="users" />}
          title={c.assigneeId ? displayName(c.assigneeId) : t('chores.anyone')}
          sub={after && after !== c.assigneeId ? (after === myId() ? t('chore.nextUpMe') : t('chore.nextUp', { name: displayName(after) })) : t('chore.assignee')}
        />
      </div>

      {c.rotation !== 'anyone' ? (
        <>
          <div class="overline">{t('chore.assignee')}</div>
          <MemberPicker
            members={ms}
            value={c.assigneeId ? [c.assigneeId] : []}
            onChange={(ids) => update('chores', c.id, { assigneeId: ids[0] })}
            meId={myId()}
          />
        </>
      ) : null}

      <div class="form-row mt-16">
        <Button variant="primary" icon="check" onClick={done}>
          {t('chore.markDone')}
        </Button>
        <Button icon="skip" onClick={skip}>
          {t('chore.skip')}
        </Button>
      </div>
      <Button variant="ghost" block size="md" class="mt-8" onClick={() => update('chores', c.id, { paused: !c.paused })}>
        {c.paused ? t('chore.resume') : t('chore.pause')}
      </Button>

      <div class="overline">{t('chore.history')}</div>
      {history.length ? (
        <div class="list">
          {history.map((l) => (
            <Row
              key={l.id}
              compact
              lead={<Avatar member={member(l.memberId)} size={30} />}
              title={displayName(l.memberId)}
              sub={l.action === 'skipped' ? t('chores.skippedToast') : fmtDate(l.date, 'weekday')}
              end={l.action === 'done' ? <Points n={l.points} /> : <Icon name="skip" size={16} class="faint" />}
            />
          ))}
        </div>
      ) : (
        <p class="muted center">{t('chore.noHistory')}</p>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

const FREQ_OPTIONS: { label: () => string; f: Frequency | null }[] = [
  { label: () => t('freq.daily'), f: { unit: 'day', every: 1 } },
  { label: () => t('freq.every2days'), f: { unit: 'day', every: 2 } },
  { label: () => t('freq.weekly'), f: { unit: 'week', every: 1 } },
  { label: () => t('freq.biweekly'), f: { unit: 'week', every: 2 } },
  { label: () => t('freq.monthly'), f: { unit: 'month', every: 1 } },
  { label: () => t('freq.quarterly'), f: { unit: 'month', every: 3 } },
  { label: () => t('freq.once'), f: null },
];

const CHORE_EMOJIS = ['🧽', '🛁', '🍳', '🧹', '🗑️', '🍾', '♻️', '📦', '🍽️', '🪴', '🧊', '🧺', '🚪', '🪟', '🚽', '🛒', '🐱', '🔧', '🧴', '✨'];

function freqKey(f: Frequency | null): string {
  return f ? `${f.unit}-${f.every}` : 'once';
}

export function openChoreEditor(id?: ID): void {
  openSheet(() => <ChoreEditor id={id} />);
}

function ChoreEditor(props: { id?: ID }) {
  const existing = props.id ? get('chores', props.id) : undefined;
  const ms = members();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🧽');
  const [freq, setFreq] = useState<Frequency | null>(existing ? existing.frequency : { unit: 'week', every: 1 });
  const [points, setPoints] = useState(existing?.points ?? 20);
  const [rotation, setRotation] = useState<RotationMode>(existing?.rotation ?? 'rotate');
  const [pool, setPool] = useState<ID[]>(existing?.memberIds?.length ? existing.memberIds : ms.map((m) => m.id));
  const [assignee, setAssignee] = useState<ID | undefined>(existing?.assigneeId ?? myId());
  const [due, setDue] = useState(existing?.dueDate ?? today());
  const [fixed, setFixed] = useState(existing?.fixedSchedule ?? false);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [showEmojis, setShowEmojis] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTemplate = (key: string) => {
    const tpl = CHORE_TEMPLATES.find((c) => c.key === key)!;
    setTitle(t(`tpl.${key}` as Key));
    setEmoji(tpl.emoji);
    setFreq(tpl.frequency);
    setPoints(tpl.points);
    setFixed(!!tpl.fixedSchedule);
  };

  const save = () => {
    if (!title.trim()) return setError(t('chore.titleRequired'));
    const memberIds = pool.length ? pool : ms.map((m) => m.id);
    let assigneeId = rotation === 'anyone' ? undefined : assignee && memberIds.includes(assignee) ? assignee : undefined;
    if (rotation !== 'anyone' && !assigneeId) {
      const draft = { memberIds, rotation, assigneeId: undefined } as unknown as Chore;
      assigneeId = eligibleMembers(draft, list('members'), due, list('events'))[0]?.id ?? memberIds[0];
    }
    saveChore(
      {
        title: title.trim(),
        emoji,
        frequency: freq,
        points,
        rotation,
        memberIds,
        assigneeId,
        dueDate: due,
        fixedSchedule: freq ? fixed : false,
        description: description.trim() || undefined,
        paused: existing?.paused,
      },
      existing?.id,
    );
    closeTopSheet();
    toast(t('chore.saved'), { emoji });
  };

  return (
    <Sheet
      title={existing ? t('chores.edit') : t('chores.new')}
      footer={
        <Button variant="primary" block onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      {!existing ? (
        <>
          <div class="overline" style={{ marginTop: '4px' }}>
            {t('chore.templates')}
          </div>
          <div class="chips scroll">
            {CHORE_TEMPLATES.map((tpl) => (
              <button key={tpl.key} type="button" class="chip soft" onClick={() => applyTemplate(tpl.key)}>
                {tpl.emoji} {t(`tpl.${tpl.key}` as Key)}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div class="hstack mt-16" style={{ alignItems: 'stretch' }}>
        <button type="button" class="tile lg" style={{ height: '52px', width: '52px', borderRadius: '15px' }} onClick={() => setShowEmojis(!showEmojis)} aria-label="Emoji">
          {emoji}
        </button>
        <input class="input grow" placeholder={t('chore.namePlaceholder')} value={title} maxLength={60} autoFocus={!existing} onInput={(e: any) => setTitle(e.target.value)} />
      </div>
      {showEmojis ? (
        <div class="mt-12 fade-in">
          <EmojiGrid
            options={CHORE_EMOJIS}
            value={emoji}
            onChange={(e) => {
              setEmoji(e);
              setShowEmojis(false);
            }}
          />
        </div>
      ) : null}

      <div class="overline">{t('chore.frequency')}</div>
      <div class="chips">
        {FREQ_OPTIONS.map((o) => (
          <button key={freqKey(o.f)} type="button" class={cx('chip', freqKey(o.f) === freqKey(freq) ? 'active' : 'soft')} onClick={() => setFreq(o.f)}>
            {o.label()}
          </button>
        ))}
      </div>

      <div class="overline" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{t('chore.effort')}</span>
        <span style={{ textTransform: 'none', letterSpacing: 0 }} class="badge">
          +{points} {t('common.points')}
        </span>
      </div>
      <Segmented
        value={String(points)}
        onChange={(v) => setPoints(Number(v))}
        options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n * 10), label: t(`effort.${n}` as Key) }))}
      />

      <div class="overline">{t('chore.rotation')}</div>
      <div class="template-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {(['rotate', 'fair', 'fixed', 'anyone'] as RotationMode[]).map((r) => (
          <button key={r} type="button" class={rotation === r ? 'active' : ''} onClick={() => setRotation(r)} style={{ alignItems: 'flex-start', textAlign: 'left', padding: '12px 14px' }}>
            <span style={{ fontWeight: 650, fontSize: '15px' }}>{t(`rot.${r}` as Key)}</span>
            <span class="caption">{t(`rot.${r}Sub` as Key)}</span>
          </button>
        ))}
      </div>

      {rotation !== 'anyone' ? (
        <>
          <div class="overline">{t('chore.who')}</div>
          <MemberPicker members={ms} value={pool} multiple onChange={setPool} meId={myId()} />
          <div class="overline">{t('chore.assignee')}</div>
          <MemberPicker members={ms.filter((m) => pool.includes(m.id))} value={assignee ? [assignee] : []} onChange={(ids) => setAssignee(ids[0])} meId={myId()} />
          {ms.some((m) => memberIsAway(m)) ? <p class="hint">{t('cal.awayHint')}</p> : null}
        </>
      ) : null}

      <div class="form-row mt-16">
        <Field label={t('chore.firstDue')}>
          <input class="input" type="date" value={due} onInput={(e: any) => e.target.value && setDue(e.target.value)} />
        </Field>
      </div>
      {freq ? (
        <div class="list">
          <SwitchRow title={t('chore.fixedSchedule')} sub={t('chore.fixedScheduleHint')} on={fixed} onChange={setFixed} />
        </div>
      ) : null}
      <Field label={t('chore.description')} class="mt-16">
        <textarea class="textarea" style={{ minHeight: '80px' }} placeholder={t('chore.descPlaceholder')} value={description} maxLength={500} onInput={(e: any) => setDescription(e.target.value)} />
      </Field>
      {error ? <div class="error-text center">{error}</div> : null}
    </Sheet>
  );
}
