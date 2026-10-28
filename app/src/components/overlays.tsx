import { h, Fragment, scheduleRender, useEffect } from '../lib/ui.ts';
import type { Child } from '../lib/ui.ts';
import { closeTopSheet, openSheet, sheets } from '../lib/router.ts';
import { t } from '../i18n/index.ts';
import { Button, cx, haptic, IconButton } from './core.tsx';

void Fragment;

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

export function Sheet(props: { title?: Child; children?: Child; footer?: Child; right?: Child; noClose?: boolean }) {
  return (
    <>
      <div class="grabber" />
      {props.title != null || !props.noClose ? (
        <div class="sheet-head">
          <h2>{props.title}</h2>
          {props.right}
          {props.noClose ? null : <IconButton icon="x" label={t('common.close')} variant="soft" size={19} onClick={() => closeTopSheet()} />}
        </div>
      ) : null}
      <div class="sheet-body">{props.children}</div>
      {props.footer ? <div class="sheet-foot">{props.footer}</div> : null}
    </>
  );
}

export function SheetHost() {
  // Lock page scroll while any sheet is open.
  const open = sheets.length > 0;
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
  }, [open]);
  return (
    <div>
      {sheets.map((s, i) => (
        <div key={s.id} style={{ position: 'relative', zIndex: 100 + i * 2 }}>
          <div class={cx('backdrop', s.closing && 'closing')} onClick={() => !s.closing && closeTopSheet()} />
          <div class={cx(s.kind === 'dialog' ? 'dialog' : 'sheet', s.closing && 'closing')} role="dialog" aria-modal="true">
            {s.render()}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confirm dialog                                                      */
/* ------------------------------------------------------------------ */

export function confirmDialog(opts: { title: string; message?: string; confirm: string; cancel?: string; destructive?: boolean; emoji?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    openSheet(
      () => (
        <>
          {opts.emoji ? <div class="emoji">{opts.emoji}</div> : null}
          <h3>{opts.title}</h3>
          {opts.message ? <p>{opts.message}</p> : null}
          <div class="actions">
            <Button
              variant={opts.destructive ? 'danger' : 'primary'}
              block
              onClick={() => {
                result = true;
                closeTopSheet();
              }}
            >
              {opts.confirm}
            </Button>
            <Button variant="ghost" block onClick={() => closeTopSheet()}>
              {opts.cancel ?? t('common.cancel')}
            </Button>
          </div>
        </>
      ),
      { kind: 'dialog', onClose: () => resolve(result) },
    );
  });
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

interface ToastState {
  id: number;
  message: string;
  emoji?: string;
  action?: { label: string; run: () => void };
  leaving: boolean;
}

let toastSeq = 0;
let current: ToastState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(message: string, opts: { emoji?: string; action?: { label: string; run: () => void }; duration?: number } = {}): void {
  if (timer) clearTimeout(timer);
  current = { id: ++toastSeq, message, emoji: opts.emoji, action: opts.action, leaving: false };
  scheduleRender();
  const id = current.id;
  timer = setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 5000 : 2800));
}

/** Toast with an undo action. */
export function undoToast(message: string, undo: () => void, emoji?: string): void {
  toast(message, { emoji, action: { label: t('common.undo'), run: undo } });
}

function dismissToast(id: number): void {
  if (!current || current.id !== id) return;
  current.leaving = true;
  scheduleRender();
  setTimeout(() => {
    if (current?.id === id) {
      current = null;
      scheduleRender();
    }
  }, 250);
}

export function ToastHost(props: { withTabs: boolean }) {
  if (!current) return null;
  const c = current;
  return (
    <div class="toast-wrap" style={props.withTabs ? undefined : { bottom: 'calc(var(--safe-bottom) + 18px)' }}>
      <div key={c.id} class={cx('toast', c.leaving && 'leaving')} role="status">
        {c.emoji ? <span class="emoji">{c.emoji}</span> : null}
        <span class="msg">{c.message}</span>
        {c.action ? (
          <button
            type="button"
            onClick={() => {
              c.action!.run();
              haptic(8);
              dismissToast(c.id);
            }}
          >
            {c.action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */

const CONFETTI_COLORS = ['#6b4ef6', '#a68bff', '#12a072', '#f2b322'];

/**
 * A small, quick burst of confetti from a screen point (or the center) as feedback for
 * finishing something. Deliberately modest: about half the pieces it is asked for, a short
 * reach and under a second on screen.
 */
export function confetti(x?: number, y?: number, count = 24): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const cx0 = x ?? innerWidth / 2;
  const cy0 = y ?? innerHeight / 2;
  const n = Math.min(16, Math.ceil(count / 2));
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 70;
    p.style.left = cx0 + 'px';
    p.style.top = cy0 + 'px';
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(angle) * dist + 50 + Math.random() * 40 + 'px');
    p.style.setProperty('--rot', Math.random() * 360 - 180 + 'deg');
    p.style.animationDelay = Math.random() * 60 + 'ms';
    if (i % 3 === 0) p.style.borderRadius = '50%';
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1100);
}

/* ------------------------------------------------------------------ */
/* Clipboard & share                                                   */
/* ------------------------------------------------------------------ */

export async function copyText(text: string, message?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
  }
  haptic(10);
  toast(message ?? t('common.copied'));
}

/** Native share sheet when available, clipboard otherwise. */
export async function shareText(text: string, title?: string, url?: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ text, title, url });
      return;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
    }
  }
  await copyText(url ? `${text}` : text);
}

export function downloadFile(name: string, content: string, type = 'application/json'): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
