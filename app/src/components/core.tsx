import { h, Fragment, useRef } from '../lib/ui.ts';
import type { Child } from '../lib/ui.ts';
import { ICONS } from '../lib/icons.ts';
import type { IconName } from '../lib/icons.ts';
import { goBack } from '../lib/router.ts';
import { t } from '../i18n/index.ts';
import { currencyBefore, currencySymbol } from '../i18n/format.ts';
import type { Member } from '../../../core/src/types.ts';

void Fragment;

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function haptic(pattern: number | number[] = 8): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export function Icon(props: { name: IconName; size?: number; stroke?: number; class?: string; style?: any }) {
  const size = props.size ?? 22;
  return (
    <svg
      class={props.class}
      style={props.style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.stroke ?? 2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[props.name] }}
    />
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '?';
  const second = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + (second ?? '')).toUpperCase();
}

export function Avatar(props: { member?: Pick<Member, 'name' | 'emoji' | 'color'> & { awayFrom?: string; awayUntil?: string; leftAt?: number } | null; size?: number; ring?: boolean; away?: boolean; class?: string }) {
  const m = props.member;
  const size = props.size ?? 40;
  if (!m) return <span class="avatar" style={{ '--size': size + 'px', '--c': 'var(--fill-2)' }} />;
  return (
    <span
      class={cx('avatar', m.emoji && 'emoji', props.ring && 'ring', !!m.leftAt && 'dim', props.class)}
      style={{ '--size': size + 'px', '--c': m.color }}
      title={m.name}
    >
      {m.emoji || initials(m.name)}
      {props.away ? <span class="away">🧳</span> : null}
    </span>
  );
}

export function AvatarStack(props: { members: Member[]; size?: number; max?: number }) {
  const max = props.max ?? 5;
  const shown = props.members.slice(0, max);
  const rest = props.members.length - shown.length;
  return (
    <span class="avatar-stack">
      {shown.map((m) => (
        <Avatar key={m.id} member={m} size={props.size ?? 30} ring />
      ))}
      {rest > 0 ? (
        <span class="avatar ring" style={{ '--size': (props.size ?? 30) + 'px', '--c': 'var(--fill-2)', color: 'var(--text-2)' }}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

type ButtonVariant = 'primary' | 'brand' | 'danger' | 'ghost' | 'white' | 'default';

export function Button(props: {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  children?: Child;
  type?: string;
  class?: string;
  style?: any;
  label?: string;
}) {
  return (
    <button
      type={props.type ?? 'button'}
      class={cx('btn', props.variant && props.variant !== 'default' && props.variant, props.size === 'sm' && 'sm', props.size === 'md' && 'md', props.block && 'block', props.class)}
      style={props.style}
      disabled={props.disabled}
      aria-label={props.label}
      onClick={(e: MouseEvent) => {
        haptic(6);
        props.onClick?.(e);
      }}
    >
      {props.icon ? <Icon name={props.icon} size={props.size === 'sm' ? 17 : 20} stroke={2.4} /> : null}
      {props.children}
    </button>
  );
}

export function IconButton(props: { icon: IconName; onClick?: (e: MouseEvent) => void; label: string; variant?: 'plain' | 'soft'; dot?: boolean; size?: number; class?: string; style?: any }) {
  return (
    <button type="button" class={cx('icon-btn', props.variant, props.class)} style={props.style} aria-label={props.label} title={props.label} onClick={props.onClick}>
      <Icon name={props.icon} size={props.size ?? 21} stroke={2.2} />
      {props.dot ? <span class="dot" /> : null}
    </button>
  );
}

/** Sub-page header with back button and centered title. */
export function TopBar(props: { title?: string; fallback?: string; right?: Child; onBack?: () => void }) {
  return (
    <header class="topbar">
      <IconButton icon="chevronLeft" label={t('common.back')} onClick={() => (props.onBack ? props.onBack() : goBack(props.fallback ?? '/'))} />
      <div class="title-sm">{props.title}</div>
      <div style={{ minWidth: '40px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>{props.right}</div>
    </header>
  );
}

export function SectionTitle(props: { title: Child; action?: string; onAction?: () => void; class?: string }) {
  return (
    <div class={cx('section-title', props.class)}>
      <span>{props.title}</span>
      {props.action ? (
        <button type="button" class="action" onClick={props.onAction}>
          {props.action}
        </button>
      ) : null}
    </div>
  );
}

export function Tile(props: { emoji?: string; icon?: IconName; color?: string; size?: 'sm' | 'lg' | 'xl'; class?: string }) {
  const color = props.color;
  return (
    <span
      class={cx('tile', props.size, props.class)}
      style={color ? { background: `color-mix(in srgb, ${color} 15%, transparent)`, color } : undefined}
    >
      {props.icon ? <Icon name={props.icon} size={props.size === 'sm' ? 18 : 22} /> : props.emoji}
    </span>
  );
}

export function Row(props: {
  lead?: Child;
  title: Child;
  sub?: Child;
  end?: Child;
  onClick?: (e: MouseEvent) => void;
  chevron?: boolean;
  compact?: boolean;
  class?: string;
  style?: any;
}) {
  const content = (
    <>
      {props.lead}
      <div class="main">
        <div class="title">{props.title}</div>
        {props.sub != null && props.sub !== '' ? <div class="sub">{props.sub}</div> : null}
      </div>
      {props.end != null ? <div class="end">{props.end}</div> : null}
      {props.chevron ? <Icon name="chevronRight" size={18} class="chev" /> : null}
    </>
  );
  if (props.onClick) {
    return (
      <button type="button" class={cx('row', props.compact && 'compact', props.class)} style={props.style} onClick={props.onClick}>
        {content}
      </button>
    );
  }
  return <div class={cx('row', props.compact && 'compact', props.class)} style={props.style}>{content}</div>;
}

export function Empty(props: { art: string; title: string; sub?: string; action?: Child }) {
  return (
    <div class="empty fade-in">
      <div class="art">{props.art}</div>
      <h3>{props.title}</h3>
      {props.sub ? <p>{props.sub}</p> : null}
      {props.action}
    </div>
  );
}

export function Segmented<T extends string>(props: { options: { value: T; label: Child }[]; value: T; onChange: (v: T) => void; class?: string }) {
  return (
    <div class={cx('seg', props.class)} role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === props.value}
          class={o.value === props.value ? 'active' : ''}
          onClick={() => {
            if (o.value !== props.value) haptic(4);
            props.onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch(props: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      class={cx('switch', props.on && 'on')}
      onClick={() => {
        haptic(6);
        props.onChange(!props.on);
      }}
    />
  );
}

export function Field(props: { label?: Child; hint?: Child; error?: string | null; children?: Child; class?: string }) {
  return (
    <label class={cx('field', props.class)}>
      {props.label ? <span class="label">{props.label}</span> : null}
      {props.children}
      {props.error ? <div class="error-text">{props.error}</div> : props.hint ? <div class="hint">{props.hint}</div> : null}
    </label>
  );
}

export function SwitchRow(props: { title: Child; sub?: Child; on: boolean; onChange: (v: boolean) => void; lead?: Child }) {
  return <Row class="multiline" lead={props.lead} title={props.title} sub={props.sub} end={<Switch on={props.on} onChange={props.onChange} label={typeof props.title === 'string' ? props.title : undefined} />} />;
}

export function Check(props: { on: boolean; onClick?: (e: MouseEvent) => void; big?: boolean; color?: string; label?: string }) {
  return (
    <button
      type="button"
      class={cx('check', props.on && 'on', props.big && 'big')}
      style={props.color ? { '--check': props.color } : undefined}
      aria-label={props.label}
      aria-pressed={props.on}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        haptic(props.on ? 5 : [6, 30, 12]);
        props.onClick?.(e);
      }}
    >
      <Icon name="check" size={props.big ? 20 : 17} stroke={3} />
    </button>
  );
}

export function Progress(props: { value: number; color?: string }) {
  return (
    <div class="progress">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, props.value)) * 100)}%`, '--bar': props.color }} />
    </div>
  );
}

export function EmojiGrid(props: { options: string[]; value?: string; onChange: (v: string) => void }) {
  return (
    <div class="emoji-grid">
      {props.options.map((e) => (
        <button key={e || 'none'} type="button" class={e === props.value ? 'active' : ''} onClick={() => props.onChange(e)}>
          {e || <span style={{ fontSize: '16px', fontWeight: 650, color: 'var(--text-2)' }}>Aa</span>}
        </button>
      ))}
    </div>
  );
}

export function ColorRow(props: { options: string[]; value?: string; onChange: (v: string) => void }) {
  return (
    <div class="color-row">
      {props.options.map((c) => (
        <button key={c} type="button" aria-label={c} class={c === props.value ? 'active' : ''} style={{ '--c': c }} onClick={() => props.onChange(c)} />
      ))}
    </div>
  );
}

/** Horizontal avatar picker for single or multiple members. */
export function MemberPicker(props: { members: Member[]; value: string[]; multiple?: boolean; onChange: (ids: string[]) => void; meId?: string }) {
  return (
    <div class="member-pick">
      {props.members.map((m) => {
        const active = props.value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            class={active ? 'active' : ''}
            aria-pressed={active}
            onClick={() => {
              haptic(5);
              if (!props.multiple) return props.onChange([m.id]);
              props.onChange(active ? props.value.filter((id) => id !== m.id) : [...props.value, m.id]);
            }}
          >
            <Avatar member={m} size={48} />
            <span>{m.id === props.meId ? t('common.you') : m.name.split(' ')[0]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Width for the big centered amount input so the currency sign hugs the number. */
export function amountWidth(value: string): string {
  const digits = (value.match(/\d/g) ?? []).length || 1;
  const separators = (value.match(/[.,]/g) ?? []).length;
  return `${digits + separators * 0.45 + 0.15}ch`;
}

/** Big centered amount entry with the currency sign on the locale's side. */
export function AmountInput(props: { value: string; onInput: (v: string) => void; autoFocus?: boolean; style?: any }) {
  const before = currencyBefore();
  const sign = <span class="cur">{currencySymbol()}</span>;
  return (
    <div class="amount-input" style={props.style}>
      {before ? sign : null}
      <input
        inputMode="decimal"
        placeholder="0"
        value={props.value}
        autoFocus={props.autoFocus}
        aria-label={t('common.amount')}
        onInput={(e: any) => props.onInput(e.target.value.replace(/[^\d.,]/g, ''))}
        style={{ width: amountWidth(props.value), textAlign: before ? 'left' : 'right' }}
      />
      {before ? null : sign}
    </div>
  );
}

/** Keeps the active chip of a horizontal chip row visible. */
export function scrollActiveChip(container: Element | null | undefined): void {
  const active = container?.querySelector('.chip.active') as HTMLElement | null;
  if (!active || !container) return;
  const c = container as HTMLElement;
  const left = active.offsetLeft - c.clientWidth / 2 + active.clientWidth / 2;
  c.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
}

/** Text input that auto-selects on focus (handy for amounts). */
export function SelectOnFocus(props: Record<string, any>) {
  const ref = useRef<HTMLInputElement>();
  return <input {...props} ref={ref} onFocus={() => setTimeout(() => ref.current?.select(), 0)} />;
}
