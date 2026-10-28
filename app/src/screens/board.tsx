import { h, Fragment, useState } from '../lib/ui.ts';
import { closeTopSheet, openSheet } from '../lib/router.ts';
import { NOTE_COLORS } from '../../../core/src/categories.ts';
import type { ID } from '../../../core/src/types.ts';
import { t } from '../i18n/index.ts';
import { timeAgo } from '../i18n/format.ts';
import { get, list, remove, update } from '../state/store.ts';
import { firstName, household, member, myId } from '../state/selectors.ts';
import { saveNote, toggleReaction } from '../state/actions.ts';
import { Avatar, Button, ColorRow, cx, Empty, Field, Icon, IconButton, TopBar } from '../components/core.tsx';
import { Sheet, toast, undoToast } from '../components/overlays.tsx';

void Fragment;

const REACTIONS = ['👍', '❤️', '😂', '🙋', '🙈'];

export function Board() {
  const hh = household();
  const notes = [...list('notes')].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  return (
    <div class="screen">
      <TopBar title={t('board.title')} fallback="/wg" />
      <button type="button" class="card mt-8" style={{ width: '100%', textAlign: 'left', display: 'block' }} onClick={() => openRulesEditor()}>
        <div class="hstack" style={{ justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ fontWeight: 650, fontSize: '17px' }}>{t('board.rules')}</div>
          <Icon name="pencil" size={17} class="faint" />
        </div>
        <div class={hh?.houseRules ? '' : 'muted'} style={{ whiteSpace: 'pre-wrap', fontSize: '15px', lineHeight: 1.55 }}>
          {hh?.houseRules || t('board.noRules')}
        </div>
      </button>

      {notes.length === 0 ? (
        <Empty art="📌" title={t('board.emptyTitle')} sub={t('board.emptySub')} />
      ) : (
        <div class="notes mt-16">
          {notes.map((n) => {
            const author = member(n.authorId);
            return (
              <div key={n.id} class={cx('note', n.pinned && 'is-pinned')} style={{ '--nc': n.color }}>
                {n.pinned ? (
                  <span class="pinned" aria-label={t('board.pin')}>
                    <Icon name="pin" size={16} />
                  </span>
                ) : null}
                <button type="button" class="text" style={{ textAlign: 'left', width: '100%', display: 'block', color: 'inherit' }} onClick={() => openNoteEditor(n.id)}>
                  {n.text}
                </button>
                <div class="reactions">
                  {Object.entries(n.reactions ?? {}).map(([emoji, ids]) => (
                    <button key={emoji} type="button" class={ids.includes(myId()) ? 'mine' : ''} aria-pressed={ids.includes(myId())} onClick={() => toggleReaction(n.id, emoji)}>
                      {emoji} {ids.length}
                    </button>
                  ))}
                  <button type="button" aria-label={t('board.react')} title={t('board.react')} onClick={() => openReactionPicker(n.id)} style={{ opacity: 0.7 }}>
                    ＋
                  </button>
                </div>
                <div class="meta">
                  <Avatar member={author} size={18} />
                  {firstName(author?.name ?? '')} · {timeAgo(n.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" class="fab" onClick={() => openNoteEditor()}>
        <Icon name="plus" size={22} stroke={2.6} /> {t('board.add')}
      </button>
    </div>
  );
}

function openReactionPicker(id: ID): void {
  openSheet(
    () => (
      <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: '34px' }}>
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              toggleReaction(id, r);
              closeTopSheet();
            }}
          >
            {r}
          </button>
        ))}
      </div>
    ),
    { kind: 'dialog' },
  );
}

function openNoteEditor(id?: ID): void {
  openSheet(() => <NoteEditor id={id} />);
}

function NoteEditor(props: { id?: ID }) {
  const existing = props.id ? get('notes', props.id) : undefined;
  const [text, setText] = useState(existing?.text ?? '');
  const [color, setColor] = useState(existing?.color ?? NOTE_COLORS[list('notes').length % NOTE_COLORS.length]!);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (!text.trim()) return setError(t('board.textRequired'));
    saveNote({ text: text.trim(), color, pinned, authorId: existing?.authorId ?? myId(), reactions: existing?.reactions }, existing?.id);
    closeTopSheet();
    toast(t('info.saved'));
  };
  const del = async () => {
    if (!existing) return;
    await closeTopSheet();
    const undo = remove('notes', existing.id);
    undoToast(t('common.deleted'), undo);
  };
  return (
    <Sheet
      title={existing ? t('board.edit') : t('board.new')}
      right={existing ? <IconButton icon="trash" label={t('common.delete')} variant="soft" size={18} onClick={del} style={{ color: 'var(--red)' }} /> : null}
      footer={
        <>
          <Button onClick={() => setPinned(!pinned)} icon="pin" style={pinned ? { background: 'var(--primary-soft)', color: 'var(--primary)' } : undefined}>
            {pinned ? t('board.unpin') : t('board.pin')}
          </Button>
          <Button variant="primary" block onClick={save} class="grow">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <textarea
        class="textarea"
        style={{ background: color, color: '#2a2433', minHeight: '160px', fontSize: '17px', fontWeight: 500, border: 0 }}
        placeholder={t('board.placeholder')}
        autoFocus
        value={text}
        maxLength={1000}
        onInput={(e: any) => setText(e.target.value)}
      />
      <div class="overline">{t('board.color')}</div>
      <ColorRow options={NOTE_COLORS} value={color} onChange={setColor} />
      {error ? <div class="error-text center mt-12">{error}</div> : null}
    </Sheet>
  );
}

function openRulesEditor(): void {
  openSheet(() => <RulesEditor />);
}

function RulesEditor() {
  const hh = household();
  const [rules, setRules] = useState(hh?.houseRules ?? '');
  if (!hh) return null;
  return (
    <Sheet
      title={t('board.editRules')}
      footer={
        <Button
          variant="primary"
          block
          onClick={() => {
            update('household', hh.id, { houseRules: rules.trim() || undefined });
            closeTopSheet();
            toast(t('info.saved'));
          }}
        >
          {t('common.save')}
        </Button>
      }
    >
      <Field>
        <textarea class="textarea" style={{ minHeight: '220px' }} autoFocus placeholder={t('board.rulesPlaceholder')} value={rules} maxLength={3000} onInput={(e: any) => setRules(e.target.value)} />
      </Field>
    </Sheet>
  );
}
