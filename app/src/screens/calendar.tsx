import { h, Fragment, useState } from '../lib/ui.ts';
import { closeTopSheet, openSheet } from '../lib/router.ts';
import { addDays, addFrequency, addMonths, diffDays, monthGrid, nextAnnual, startOfMonth, today } from '../../../core/src/dates.ts';
import { occurrencesBetween } from '../../../core/src/recurring.ts';
import { contractStatus, deadlineDaysLeft } from '../../../core/src/contracts.ts';
import { EVENT_TYPES } from '../../../core/src/categories.ts';
import type { CalendarEvent, EventType, ID, ISODate } from '../../../core/src/types.ts';
import { t } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { fmtDate, money, relDay } from '../i18n/format.ts';
import { get, list, remove } from '../state/store.ts';
import { displayName, firstName, household, members, myId } from '../state/selectors.ts';
import { saveEvent } from '../state/actions.ts';
import { AvatarStack, Button, cx, Field, Icon, IconButton, MemberPicker, Row, SwitchRow, Tile, TopBar } from '../components/core.tsx';
import { downloadFile, Sheet, toast, undoToast } from '../components/overlays.tsx';
import { buildIcs } from '../../../core/src/ical.ts';
import { openChoreDetail } from './chores.tsx';

void Fragment;

type Layer = 'events' | 'chores' | 'money' | 'deadlines' | 'birthdays';

interface Entry {
  key: string;
  date: ISODate;
  endDate?: ISODate;
  time?: string;
  title: string;
  emoji: string;
  color: string;
  layer: Layer;
  sub?: string;
  onClick?: () => void;
  event?: CalendarEvent;
}

const LAYER_COLORS: Record<Layer, string> = {
  events: '#ec4899',
  chores: '#f59e0b',
  money: '#10b981',
  deadlines: '#8b5cf6',
  birthdays: '#3b82f6',
};

/** Collects everything that happens in [from, to] across all modules. */
function collectEntries(from: ISODate, to: ISODate, layers: Set<Layer>): Entry[] {
  const out: Entry[] = [];
  if (layers.has('events')) {
    for (const e of list('events')) {
      if ((e.endDate ?? e.date) < from || e.date > to) continue;
      const meta = EVENT_TYPES[e.type];
      out.push({
        key: 'e' + e.id,
        date: e.date,
        endDate: e.endDate,
        time: e.time,
        title: e.title,
        emoji: meta.emoji,
        color: meta.color,
        layer: 'events',
        sub: [e.time ? e.time + (e.endTime ? '–' + e.endTime : '') : t('cal.allDay'), e.location].filter(Boolean).join(' · '),
        onClick: () => openEventEditor(undefined, e.id),
        event: e,
      });
    }
  }
  if (layers.has('chores')) {
    for (const c of list('chores')) {
      if (c.paused) continue;
      let d = c.dueDate;
      for (let i = 0; i < 40 && d <= to; i++) {
        if (d >= from) {
          out.push({ key: `c${c.id}${d}`, date: d, title: c.title, emoji: c.emoji, color: LAYER_COLORS.chores, layer: 'chores', sub: i === 0 && c.assigneeId ? displayName(c.assigneeId) : undefined, onClick: () => openChoreDetail(c.id) });
        }
        if (!c.frequency) break;
        d = addFrequency(d, c.frequency);
      }
    }
  }
  if (layers.has('money')) {
    for (const r of list('recurring')) {
      if (!r.active) continue;
      for (const d of occurrencesBetween(r.startDate, r.frequency, addDays(from, -1), to, 40)) {
        if (r.endDate && d > r.endDate) break;
        out.push({ key: `r${r.id}${d}`, date: d, title: t('cal.payment', { title: r.title }), emoji: r.emoji ?? '💸', color: LAYER_COLORS.money, layer: 'money', sub: money(r.amount) });
      }
    }
  }
  if (layers.has('deadlines')) {
    for (const c of list('contracts')) {
      const s = contractStatus(c, today());
      // Includes a deadline that ends today – that is the most important one to see.
      if (s.cancelBy && deadlineDaysLeft(s) != null && s.cancelBy >= from && s.cancelBy <= to) {
        out.push({ key: `d${c.id}`, date: s.cancelBy, title: t('cal.deadline', { name: c.name }), emoji: '⏳', color: LAYER_COLORS.deadlines, layer: 'deadlines', sub: c.provider });
      }
    }
  }
  if (layers.has('birthdays')) {
    for (const m of members()) {
      if (!m.birthday) continue;
      const d = nextAnnual(m.birthday, from);
      if (d <= to) out.push({ key: `b${m.id}${d}`, date: d, title: t('cal.birthday', { name: firstName(m.name) }), emoji: '🎂', color: LAYER_COLORS.birthdays, layer: 'birthdays' });
    }
  }
  return out.sort((a, b) => (a.date + (a.time ?? '00:00')).localeCompare(b.date + (b.time ?? '00:00')));
}

function onDay(e: Entry, d: ISODate): boolean {
  return d >= e.date && d <= (e.endDate ?? e.date);
}

/** "Heute · 28. Oktober", "In 3 Tagen · 31. Oktober" or – further away – just "Montag, 9. November". */
function dayHeading(d: ISODate, T: ISODate): string {
  if (d === T) return `${t('common.today')} · ${fmtDate(d, 'dayMonthLong')}`;
  if (Math.abs(diffDays(T, d)) < 7) {
    const rel = relDay(d, T);
    return `${rel.charAt(0).toUpperCase()}${rel.slice(1)} · ${fmtDate(d, 'dayMonthLong')}`;
  }
  return fmtDate(d, 'long');
}

export function CalendarScreen() {
  const T = today();
  const [month, setMonth] = useState(startOfMonth(T));
  const [selected, setSelected] = useState(T);
  const [layers, setLayers] = useState<Set<Layer>>(new Set(['events', 'chores', 'money', 'deadlines', 'birthdays']));
  const grid = monthGrid(month);
  const from = grid[0]![0]!;
  const to = grid[grid.length - 1]![6]!;
  const entries = collectEntries(from, addDays(to, 30), layers);
  const dayEntries = entries.filter((e) => onDay(e, selected));
  const upcoming = entries.filter((e) => e.layer === 'events' && (e.endDate ?? e.date) >= T).slice(0, 6);
  const dows = Array.from({ length: 7 }, (_, i) => fmtDate(addDays('2024-01-01', i), 'weekdayShort'));

  const toggle = (l: Layer) => {
    const next = new Set(layers);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    setLayers(next);
  };

  const exportIcs = () => {
    const items = collectEntries(addDays(T, -30), addDays(T, 180), layers);
    const ics = buildIcs(
      household()?.name ?? 'Nestly',
      items.map((e) => ({
        uid: e.key,
        title: `${e.emoji} ${e.title}`,
        date: e.date,
        endDate: e.endDate,
        time: e.time,
        endTime: e.event?.endTime,
        description: [e.sub, e.event?.note].filter(Boolean).join('\n') || undefined,
        location: e.event?.location,
        yearly: e.layer === 'birthdays',
      })),
    );
    downloadFile(`${(household()?.name ?? 'nestly').replace(/[^\p{L}\d]+/gu, '-')}.ics`, ics, 'text/calendar;charset=utf-8');
    toast(t('cal.exported'));
  };

  return (
    <div class="screen">
      <TopBar title={t('cal.title')} fallback="/wg" right={<IconButton icon="download" label={t('cal.export')} onClick={exportIcs} />} />
      <div class="card mt-8">
        <div class="hstack mb-12">
          <IconButton icon="chevronLeft" label={t('common.prevMonth')} variant="soft" onClick={() => setMonth(addMonths(month, -1))} />
          <button type="button" class="grow center" style={{ fontWeight: 650, fontSize: '17px' }} onClick={() => {
            setMonth(startOfMonth(T));
            setSelected(T);
          }}>
            {fmtDate(month, 'monthYear')}
          </button>
          <IconButton icon="chevronRight" label={t('common.nextMonth')} variant="soft" onClick={() => setMonth(addMonths(month, 1))} />
        </div>
        <div class="cal-grid">
          {dows.map((d) => (
            <div key={d} class="dow">
              {d}
            </div>
          ))}
          {grid.flat().map((d) => {
            const dots = entries.filter((e) => onDay(e, d));
            const colors = [...new Set(dots.map((e) => e.color))].slice(0, 3);
            return (
              <button
                key={d}
                type="button"
                class={cx('day', d.slice(0, 7) !== month.slice(0, 7) && 'other', d === T && 'today', d === selected && 'sel')}
                onClick={() => {
                  setSelected(d);
                  if (d.slice(0, 7) !== month.slice(0, 7)) setMonth(startOfMonth(d));
                }}
              >
                {Number(d.slice(8))}
                <span class="dots">
                  {colors.map((c) => (
                    <i key={c} style={{ '--dc': c }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div class="chips scroll mt-12">
        {(Object.keys(LAYER_COLORS) as Layer[]).map((l) => (
          <button key={l} type="button" class={cx('chip layer-chip', !layers.has(l) && 'off')} style={{ '--lc': LAYER_COLORS[l] }} aria-pressed={layers.has(l)} onClick={() => toggle(l)}>
            <span class="sw" />
            {t(`cal.layer.${l}` as Key)}
          </button>
        ))}
      </div>

      <div class="section-title">{dayHeading(selected, T)}</div>
      {dayEntries.length ? (
        <div class="list">
          {dayEntries.map((e) => (
            <Row
              key={e.key}
              onClick={e.onClick}
              lead={<Tile emoji={e.emoji} color={e.color} />}
              title={e.title}
              sub={e.sub}
              end={e.event?.memberIds?.length ? <AvatarStack members={members().filter((m) => e.event!.memberIds!.includes(m.id))} size={24} max={3} /> : null}
            />
          ))}
        </div>
      ) : (
        <div class="card muted center" style={{ padding: '20px' }}>
          {t('cal.nothing')}
        </div>
      )}

      {upcoming.length ? (
        <>
          <div class="section-title">{t('cal.upcoming')}</div>
          <div class="list">
            {upcoming.map((e) => (
              <Row key={e.key} onClick={e.onClick} lead={<Tile emoji={e.emoji} color={e.color} />} title={e.title} sub={`${relDay(e.date)}${e.time ? ' · ' + e.time : ''}${e.endDate ? ' – ' + fmtDate(e.endDate, 'dayMonth') : ''}`} chevron />
            ))}
          </div>
        </>
      ) : null}

      <button type="button" class="fab" onClick={() => openEventEditor(selected)}>
        <Icon name="plus" size={22} stroke={2.6} /> {t('cal.add')}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function openEventEditor(date?: ISODate, id?: ID): void {
  openSheet(() => <EventEditor date={date} id={id} />);
}

function EventEditor(props: { date?: ISODate; id?: ID }) {
  const existing = props.id ? get('events', props.id) : undefined;
  const ms = members();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [type, setType] = useState<EventType>(existing?.type ?? 'party');
  const [date, setDate] = useState(existing?.date ?? props.date ?? today());
  const [endDate, setEndDate] = useState(existing?.endDate ?? '');
  const [allDay, setAllDay] = useState(existing ? !existing.time : false);
  const [time, setTime] = useState(existing?.time ?? '19:00');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [who, setWho] = useState<ID[]>(existing?.memberIds ?? (type === 'away' ? [myId()] : []));
  const [error, setError] = useState<string | null>(null);

  const isAway = type === 'away';
  const effectiveAllDay = isAway || allDay;

  const save = () => {
    const finalTitle = title.trim() || (isAway && who.length ? t('cal.awayTitle', { name: who.map((id) => firstName(members().find((m) => m.id === id)?.name ?? '')).join(', ') }) : '');
    if (!finalTitle) return setError(t('cal.titleRequired'));
    saveEvent(
      {
        title: finalTitle,
        type,
        date,
        endDate: endDate && endDate > date ? endDate : undefined,
        time: effectiveAllDay ? undefined : time,
        endTime: effectiveAllDay || !endTime ? undefined : endTime,
        location: location.trim() || undefined,
        note: note.trim() || undefined,
        memberIds: who.length ? who : undefined,
      },
      existing?.id,
    );
    closeTopSheet();
    toast(t('cal.saved'), { emoji: EVENT_TYPES[type].emoji });
  };

  const del = async () => {
    if (!existing) return;
    await closeTopSheet();
    const undo = remove('events', existing.id);
    undoToast(t('cal.deleted'), undo);
  };

  return (
    <Sheet
      title={existing ? t('cal.edit') : t('cal.new')}
      right={existing ? <IconButton icon="trash" label={t('common.delete')} variant="soft" size={18} onClick={del} style={{ color: 'var(--red)' }} /> : null}
      footer={
        <Button variant="primary" block onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <div class="chips scroll mb-12">
        {(Object.keys(EVENT_TYPES) as EventType[]).map((k) => (
          <button
            key={k}
            type="button"
            class={cx('chip', type === k ? 'active' : 'soft')}
            onClick={() => {
              setType(k);
              if (k === 'away' && !who.length) setWho([myId()]);
            }}
          >
            {EVENT_TYPES[k].emoji} {t(`etype.${k}` as Key)}
          </button>
        ))}
      </div>
      <Field>
        <input class="input" placeholder={isAway ? t('cal.awayTitle', { name: firstName(members().find((m) => m.id === (who[0] ?? myId()))?.name ?? '') }) : t('cal.titlePlaceholder')} value={title} maxLength={80} autoFocus={!existing} onInput={(e: any) => setTitle(e.target.value)} />
      </Field>
      <div class="form-row">
        <Field label={t('common.date')}>
          <input class="input" type="date" value={date} onInput={(e: any) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label={t('cal.endDate')}>
          <input class="input" type="date" value={endDate} min={date} onInput={(e: any) => setEndDate(e.target.value)} />
        </Field>
      </div>
      {!isAway ? (
        <>
          <div class="list mb-12">
            <SwitchRow title={t('cal.allDay')} on={allDay} onChange={setAllDay} />
          </div>
          {!allDay ? (
            <div class="form-row">
              <Field label={t('common.time')}>
                <input class="input" type="time" value={time} onInput={(e: any) => setTime(e.target.value)} />
              </Field>
              <Field label={t('cal.endTime')}>
                <input class="input" type="time" value={endTime} onInput={(e: any) => setEndTime(e.target.value)} />
              </Field>
            </div>
          ) : null}
          <Field label={t('cal.location')}>
            <input class="input" value={location} maxLength={80} onInput={(e: any) => setLocation(e.target.value)} />
          </Field>
        </>
      ) : null}
      <div class="overline">{isAway ? t('cal.awayWho') : t('cal.participants')}</div>
      <MemberPicker members={ms} value={who} multiple onChange={setWho} meId={myId()} />
      {isAway ? <p class="hint">{t('cal.awayHint')}</p> : null}
      <Field label={t('common.note')} class="mt-16">
        <textarea class="textarea" style={{ minHeight: '76px' }} value={note} maxLength={500} onInput={(e: any) => setNote(e.target.value)} />
      </Field>
      {error ? <div class="error-text center">{error}</div> : null}
    </Sheet>
  );
}
