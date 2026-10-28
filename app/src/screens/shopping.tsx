import { h, Fragment, useRef, useState } from '../lib/ui.ts';
import { closeTopSheet, navigate, openSheet } from '../lib/router.ts';
import { ITEM_CATEGORY_EMOJI, ITEM_CATEGORY_ORDER, LIST_SUGGESTIONS, listKind } from '../../../core/src/shopping.ts';
import { LIST_COLORS } from '../../../core/src/categories.ts';
import { parseAmount } from '../../../core/src/money.ts';
import type { ID, ItemCategory, ShoppingItem } from '../../../core/src/types.ts';
import { getLang, t, tp } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { money } from '../i18n/format.ts';
import { get, list, remove, update } from '../state/store.ts';
import { displayName, member, members, myId } from '../state/selectors.ts';
import { prefs } from '../state/prefs.ts';
import { addItems, deleteList, finishShopping, saveList, toggleItem } from '../state/actions.ts';
import { AmountInput, Avatar, Button, Check, ColorRow, cx, Empty, EmojiGrid, Field, Icon, IconButton, MemberPicker, SwitchRow } from '../components/core.tsx';
import { confetti, confirmDialog, Sheet, shareText, toast, undoToast } from '../components/overlays.tsx';

void Fragment;

function sortedLists() {
  return [...list('lists')].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

function suggestionsFor(listId: ID): string[] {
  const l = get('lists', listId);
  if (!l) return [];
  const open = new Set(list('items').filter((i) => i.listId === listId && !i.checked).map((i) => i.name.toLowerCase()));
  const kind = listKind(l.name, l.emoji);
  const defaults = LIST_SUGGESTIONS[kind]![getLang()];
  const frequent = Object.entries(prefs.itemHistory)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
  const merged: string[] = [];
  for (const n of [...frequent.slice(0, 6), ...defaults]) {
    if (!open.has(n.toLowerCase()) && !merged.some((m) => m.toLowerCase() === n.toLowerCase())) merged.push(n);
  }
  return merged.slice(0, 12);
}

export function Shopping(props: { listId?: ID }) {
  const lists = sortedLists();
  const current = (props.listId && get('lists', props.listId)) || lists[0];
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>();

  if (!current) {
    return (
      <div class="screen">
        <h1 class="large-title" style={{ paddingTop: '14px' }}>
          {t('shop.title')}
        </h1>
        <Empty art="🛒" title={t('shop.noLists')} action={<Button variant="primary" icon="plus" onClick={() => openListEditor()}>{t('shop.newList')}</Button>} />
      </div>
    );
  }

  const items = list('items').filter((i) => i.listId === current.id);
  const open = items.filter((i) => !i.checked);
  const cart = items.filter((i) => i.checked).sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
  const groups = ITEM_CATEGORY_ORDER.map((cat) => ({
    cat,
    items: open.filter((i) => i.category === cat).sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || a.createdAt - b.createdAt),
  })).filter((g) => g.items.length);

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    const added = addItems(current.id, v);
    setDraft('');
    if (added.length === 1) toast(t('shop.added', { name: added[0]!.name }), { emoji: ITEM_CATEGORY_EMOJI[added[0]!.category] });
    inputRef.current?.focus();
  };

  const share = () => {
    const text = `${current.emoji} ${current.name}\n` + open.map((i) => `• ${i.quantity ? i.quantity + ' ' : ''}${i.name}${i.urgent ? ' ❗' : ''}`).join('\n');
    void shareText(text, current.name);
  };

  return (
    <div class="screen">
      <div class="hstack" style={{ paddingTop: '14px' }}>
        <h1 class="large-title grow">{t('shop.title')}</h1>
        <IconButton icon="share" label={t('shop.shareList')} onClick={share} />
        <IconButton icon="more" label={t('shop.editList')} onClick={() => openListEditor(current.id)} />
      </div>

      <div class="chips scroll mt-12">
        {lists.map((l) => {
          const n = list('items').filter((i) => i.listId === l.id && !i.checked).length;
          return (
            <button key={l.id} type="button" class={cx('chip', l.id === current.id && 'active')} onClick={() => navigate(`/shopping/${l.id}`, { replace: true })}>
              {l.emoji} {l.name}
              {n ? <span class="count">{n}</span> : null}
            </button>
          );
        })}
        <button type="button" class="chip outline" onClick={() => openListEditor()}>
          <Icon name="plus" size={16} stroke={2.6} /> {t('shop.newList')}
        </button>
      </div>

      <div class="input-group mt-16" style={{ position: 'sticky', top: 'calc(var(--safe-top) + 8px)', zIndex: 15 }}>
        <input
          ref={inputRef}
          class="input"
          style={{ background: 'var(--card)', boxShadow: 'var(--shadow)', height: '56px', paddingLeft: '48px', fontSize: '17px' }}
          placeholder={t('shop.addPlaceholder')}
          value={draft}
          enterKeyHint="done"
          onInput={(e: any) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && submit()}
        />
        <Icon name="plus" size={22} stroke={2.6} class="faint" style={{ position: 'absolute', left: '16px', color: current.color }} />
        {draft.trim() ? (
          <span class="addon">
            <Button size="sm" variant="primary" onClick={submit} style={{ background: current.color }}>
              {t('common.add')}
            </Button>
          </span>
        ) : null}
      </div>

      {focused || open.length === 0 ? (
        <div class="fade-in">
          <div class="overline">{t('shop.suggestions')}</div>
          <div class="chips">
            {suggestionsFor(current.id).map((s) => (
              <button
                key={s}
                type="button"
                class="chip"
                onMouseDown={(e: MouseEvent) => e.preventDefault()}
                onClick={() => {
                  addItems(current.id, s);
                  toast(t('shop.added', { name: s }));
                }}
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {open.length === 0 && cart.length === 0 ? <Empty art="🧺" title={t('shop.emptyTitle')} sub={t('shop.emptySub')} /> : null}

      {groups.map((g) => (
        <div key={g.cat}>
          <div class="overline">{t(`icat.${g.cat}` as Key)}</div>
          <div class="list">
            {g.items.map((i) => (
              <ItemRow key={i.id} item={i} color={current.color} />
            ))}
          </div>
        </div>
      ))}

      {cart.length ? (
        <>
          <div class="overline">
            {t('shop.inCart')} ({cart.length})
          </div>
          <div class="list" style={{ opacity: 0.75 }}>
            {cart.map((i) => (
              <ItemRow key={i.id} item={i} color={current.color} />
            ))}
          </div>
          <Button variant="primary" block class="mt-16" icon="check" onClick={() => openFinish(current.id)} style={{ background: current.color, boxShadow: 'none' }}>
            {t('shop.finish')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

function ItemRow(props: { item: ShoppingItem; color: string }) {
  const i = props.item;
  const by = i.createdBy && i.createdBy !== myId() ? member(i.createdBy) : undefined;
  return (
    <div class="row compact" style={{ minHeight: '56px' }}>
      <Check on={i.checked} color={props.color} label={i.name} onClick={() => toggleItem(i.id)} />
      <button type="button" class="main" style={{ textAlign: 'left' }} onClick={() => openItemEditor(i.id)}>
        <div class="title" style={{ textDecoration: i.checked ? 'line-through' : undefined, color: i.checked ? 'var(--text-3)' : undefined }}>
          {i.quantity ? <span class="faint num" style={{ fontWeight: 700 }}>{i.quantity} </span> : null}
          {i.name}
          {i.urgent && !i.checked ? (
            <span class="urgent" title={t('shop.urgent')} aria-label={t('shop.urgent')}>
              <Icon name="alert" size={15} stroke={2.4} />
            </span>
          ) : null}
        </div>
        {i.note ? <div class="sub">{i.note}</div> : null}
      </button>
      {by && !i.checked ? <Avatar member={by} size={24} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sheets                                                              */
/* ------------------------------------------------------------------ */

/** Quick add from anywhere (home screen). */
export function openQuickAdd(preset = ''): void {
  openSheet(() => <QuickAddSheet preset={preset} />);
}

function QuickAddSheet(props: { preset: string }) {
  const lists = sortedLists();
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const [draft, setDraft] = useState(props.preset);
  const submit = () => {
    if (!draft.trim() || !listId) return;
    const added = addItems(listId, draft);
    closeTopSheet();
    // "Du hast 3 Artikel …" – the second-person text, not "{name} hat …" with name "Du".
    if (added.length) toast(added.length === 1 ? t('shop.added', { name: added[0]!.name }) : tp('activity.items_added_me', added.length));
  };
  return (
    <Sheet
      title={t('shop.addPlaceholder')}
      footer={
        <Button variant="primary" block disabled={!draft.trim()} onClick={submit}>
          {t('common.add')}
        </Button>
      }
    >
      <div class="chips scroll mb-12">
        {lists.map((l) => (
          <button key={l.id} type="button" class={cx('chip', l.id === listId ? 'active' : 'soft')} onClick={() => setListId(l.id)}>
            {l.emoji} {l.name}
          </button>
        ))}
      </div>
      <input class="input" autoFocus placeholder={t('shop.multiPlaceholder')} value={draft} onInput={(e: any) => setDraft(e.target.value)} onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && submit()} />
      <div class="chips mt-12">
        {listId
          ? suggestionsFor(listId)
              .slice(0, 8)
              .map((s) => (
                <button key={s} type="button" class="chip" onClick={() => setDraft(draft.trim() ? `${draft.trim().replace(/,$/, '')}, ${s}` : s)}>
                  + {s}
                </button>
              ))
          : null}
      </div>
    </Sheet>
  );
}

function openItemEditor(id: ID): void {
  openSheet(() => <ItemEditor id={id} />);
}

function ItemEditor(props: { id: ID }) {
  const item = get('items', props.id);
  const [name, setName] = useState(item?.name ?? '');
  const [quantity, setQuantity] = useState(item?.quantity ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [category, setCategory] = useState<ItemCategory>(item?.category ?? 'other');
  const [urgent, setUrgent] = useState(!!item?.urgent);
  const [listId, setListId] = useState(item?.listId ?? '');
  if (!item) return <Sheet title="" />;
  const save = () => {
    update('items', item.id, { name: name.trim() || item.name, quantity: quantity.trim() || undefined, note: note.trim() || undefined, category, urgent, listId });
    closeTopSheet();
  };
  const del = async () => {
    await closeTopSheet();
    const undo = remove('items', item.id);
    undoToast(t('common.deleted'), undo);
  };
  return (
    <Sheet
      title={t('shop.editItem')}
      right={<IconButton icon="trash" label={t('common.delete')} variant="soft" size={18} onClick={del} style={{ color: 'var(--red)' }} />}
      footer={
        <Button variant="primary" block onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <Field label={t('common.name')}>
        <input class="input" value={name} maxLength={80} onInput={(e: any) => setName(e.target.value)} />
      </Field>
      <div class="form-row">
        <Field label={t('shop.quantity')}>
          <input class="input" placeholder={t('shop.quantityPlaceholder')} value={quantity} maxLength={20} onInput={(e: any) => setQuantity(e.target.value)} />
        </Field>
        <Field label={t('shop.list')}>
          <select class="select" value={listId} onChange={(e: any) => setListId(e.target.value)}>
            {sortedLists().map((l) => (
              <option key={l.id} value={l.id}>
                {l.emoji} {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t('common.note')}>
        <input class="input" value={note} maxLength={200} onInput={(e: any) => setNote(e.target.value)} placeholder={t('shop.notePlaceholder')} />
      </Field>
      <div class="list mb-12">
        <SwitchRow title={t('shop.urgent')} on={urgent} onChange={setUrgent} />
      </div>
      <div class="overline">{t('common.category')}</div>
      <div class="chips">
        {ITEM_CATEGORY_ORDER.map((c) => (
          <button key={c} type="button" class={cx('chip', c === category ? 'active' : 'soft')} onClick={() => setCategory(c)}>
            {ITEM_CATEGORY_EMOJI[c]} {t(`icat.${c}` as Key)}
          </button>
        ))}
      </div>
      {item.createdBy ? (
        <p class="hint center mt-16">
          {t('shop.addedBy', { name: item.createdBy === myId() ? (member(myId())?.name ?? '') : displayName(item.createdBy) })}
        </p>
      ) : null}
    </Sheet>
  );
}

const LIST_EMOJIS = ['🛒', '🧴', '🛋️', '🔨', '🍺', '🥦', '🎉', '🐾', '💊', '🎁', '🧺', '📦'];

export function openListEditor(id?: ID): void {
  openSheet(() => <ListEditor id={id} />);
}

function ListEditor(props: { id?: ID }) {
  const existing = props.id ? get('lists', props.id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🛒');
  const [color, setColor] = useState(existing?.color ?? LIST_COLORS[list('lists').length % LIST_COLORS.length]!);
  const save = () => {
    if (!name.trim()) return;
    const l = saveList({ name: name.trim(), emoji, color, order: existing?.order ?? list('lists').length }, existing?.id);
    closeTopSheet().then(() => navigate(`/shopping/${l.id}`, { replace: true }));
  };
  const del = async () => {
    if (!existing) return;
    const ok = await confirmDialog({ title: t('shop.deleteList'), message: t('shop.deleteListConfirm', { name: existing.name }), confirm: t('common.delete'), destructive: true, emoji: existing.emoji });
    if (!ok) return;
    await closeTopSheet();
    const undo = deleteList(existing.id);
    navigate('/shopping', { replace: true });
    undoToast(t('common.deleted'), undo);
  };
  const clearChecked = () => {
    if (!existing) return;
    const undos = list('items')
      .filter((i) => i.listId === existing.id && i.checked)
      .map((i) => remove('items', i.id));
    closeTopSheet();
    if (undos.length) undoToast(t('common.deleted'), () => undos.forEach((u) => u()));
  };
  return (
    <Sheet
      title={existing ? t('shop.editList') : t('shop.newList')}
      footer={
        <Button variant="primary" block disabled={!name.trim()} onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <Field label={t('shop.listName')}>
        <input class="input" autoFocus={!existing} placeholder={t('shop.listNamePlaceholder')} value={name} maxLength={40} onInput={(e: any) => setName(e.target.value)} />
      </Field>
      {!existing ? (
        <div class="chips mb-12">
          {[
            ['IKEA', '🛋️'],
            ['dm', '🧴'],
            [getLang() === 'de' ? 'Baumarkt' : 'Hardware store', '🔨'],
            [getLang() === 'de' ? 'Getränke' : 'Drinks', '🍺'],
          ].map(([n, e]) => (
            <button
              key={n}
              type="button"
              class="chip soft"
              onClick={() => {
                setName(n!);
                setEmoji(e!);
              }}
            >
              {e} {n}
            </button>
          ))}
        </div>
      ) : null}
      <EmojiGrid options={LIST_EMOJIS} value={emoji} onChange={setEmoji} />
      <div class="mt-16">
        <ColorRow options={LIST_COLORS} value={color} onChange={setColor} />
      </div>
      {existing ? (
        <div class="stack mt-24">
          <Button block icon="check" onClick={clearChecked}>
            {t('shop.clearChecked')}
          </Button>
          <Button variant="danger" block icon="trash" onClick={del}>
            {t('shop.deleteList')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

function openFinish(listId: ID): void {
  openSheet(() => <FinishSheet listId={listId} />);
}

function FinishSheet(props: { listId: ID }) {
  const ms = members();
  const cart = list('items').filter((i) => i.listId === props.listId && i.checked);
  const [amountStr, setAmountStr] = useState('');
  const [paidBy, setPaidBy] = useState(myId());
  const amount = parseAmount(amountStr) ?? 0;
  const done = (withExpense: boolean) => {
    finishShopping(props.listId, withExpense && amount > 0 ? { amount, paidBy } : null);
    closeTopSheet();
    confetti(innerWidth / 2, innerHeight * 0.5, 24);
    toast(t('shop.finished'));
  };
  return (
    <Sheet
      title={t('shop.finish')}
      footer={
        <div style={{ width: '100%' }} class="stack">
          <Button variant="primary" block disabled={amount <= 0} onClick={() => done(true)} icon="receipt">
            {t('shop.finishWithExpense')}
            {amount > 0 ? ` · ${money(amount)}` : ''}
          </Button>
          <Button variant="ghost" block size="md" onClick={() => done(false)}>
            {t('shop.finishWithout')}
          </Button>
        </div>
      }
    >
      <p class="muted center" style={{ margin: '0 0 4px' }}>
        {tp('shop.finishSub', cart.length)}
      </p>
      <div class="caption center">{cart.map((i) => i.name).join(', ')}</div>
      <div class="overline center">{t('shop.spent')}</div>
      <AmountInput value={amountStr} autoFocus onInput={setAmountStr} style={{ paddingTop: 0 }} />
      <p class="hint center">
        {t('shop.splitAll')}
        {amount > 0 && ms.length ? ` · ${money(Math.round(amount / ms.length))} ${t('common.perPerson')}` : ''}
      </p>
      <div class="overline">{t('shop.paidBy')}</div>
      <MemberPicker members={ms} value={[paidBy]} onChange={(ids) => setPaidBy(ids[0]!)} meId={myId()} />
    </Sheet>
  );
}
