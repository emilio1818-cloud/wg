import { h, Fragment, useState } from '../lib/ui.ts';
import { closeTopSheet, goBack, navigate, openSheet } from '../lib/router.ts';
import { addDays, today } from '../../../core/src/dates.ts';
import { cancellationLetter, CONTRACT_TEMPLATES, contractStatus } from '../../../core/src/contracts.ts';
import type { ContractStatus } from '../../../core/src/contracts.ts';
import { centsToInput, parseAmount } from '../../../core/src/money.ts';
import type { Contract, ContractCategory, ID } from '../../../core/src/types.ts';
import { getLang, t, tp } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { currencySymbol, fmtDate, money } from '../i18n/format.ts';
import { get, list, remove, update } from '../state/store.ts';
import { displayName, household, member, members, myId } from '../state/selectors.ts';
import { saveContract } from '../state/actions.ts';
import { Avatar, Button, cx, Empty, Field, Icon, IconButton, MemberPicker, Row, SwitchRow, Tile, TopBar } from '../components/core.tsx';
import { confirmDialog, copyText, Sheet, shareText, toast, undoToast } from '../components/overlays.tsx';

void Fragment;

function statusText(s: ContractStatus): string {
  switch (s.phase) {
    case 'minTerm':
      return s.daysLeft === 0 ? t('contract.phase.openEnded') : t('contract.phase.minTerm', { date: fmtDate(s.termEnd!, 'medium') });
    case 'renewing':
      return t('contract.phase.renewing', { date: fmtDate(addDays(s.termEnd!, 1), 'medium') });
    case 'openEnded':
      return t('contract.phase.openEnded');
    case 'cancelled':
      return s.termEnd ? t('contract.phase.cancelled', { date: fmtDate(s.termEnd, 'medium') }) : t('contract.phase.cancelledNoDate');
    case 'ended':
      return t('contract.phase.ended');
    default:
      return t('contract.phase.unknown');
  }
}

function StatusBadge(props: { s: ContractStatus }) {
  const s = props.s;
  if (s.cancelBy && s.daysLeft && s.daysLeft > 0 && (s.urgency === 'urgent' || s.urgency === 'soon')) {
    return <span class={cx('badge', s.urgency === 'urgent' ? 'red' : 'amber')}>⏳ {tp('contract.daysLeft', s.daysLeft)}</span>;
  }
  if (s.phase === 'cancelled') return <span class="badge">✓ {t('contract.phase.cancelledNoDate')}</span>;
  if (s.phase === 'openEnded' || (s.phase === 'minTerm' && s.daysLeft === 0)) return <span class="badge green">{t('contract.phase.openEnded')}</span>;
  return null;
}

export function Contracts() {
  const T = today();
  const items = list('contracts').map((c) => ({ c, s: contractStatus(c, T) }));
  const active = items.filter((x) => x.s.phase !== 'ended' && x.s.phase !== 'cancelled');
  const monthly = active.reduce((a, x) => a + (x.c.monthlyCost ?? 0), 0);
  const n = Math.max(1, members().length);
  const deadlines = active.filter((x) => x.s.cancelBy && (x.s.daysLeft ?? 0) > 0 && (x.s.urgency === 'urgent' || x.s.urgency === 'soon')).sort((a, b) => a.s.daysLeft! - b.s.daysLeft!);
  const sorted = [...items].sort((a, b) => {
    const rank = (x: typeof a) => (x.s.phase === 'ended' ? 3 : x.s.phase === 'cancelled' ? 2 : x.s.urgency === 'urgent' ? 0 : x.s.urgency === 'soon' ? 0.5 : 1);
    return rank(a) - rank(b) || (b.c.monthlyCost ?? 0) - (a.c.monthlyCost ?? 0);
  });
  return (
    <div class="screen">
      <TopBar title={t('contract.title')} fallback="/wg" />
      {items.length === 0 ? (
        <Empty art="📄" title={t('contract.emptyTitle')} sub={t('contract.emptySub')} action={<Button variant="primary" icon="plus" onClick={() => openContractEditor()}>{t('contract.new')}</Button>} />
      ) : (
        <>
          <div class="hero mt-8" style={{ background: 'linear-gradient(135deg, #6d5dfc 0%, #8b5cf6 60%, #c084fc 100%)' }}>
            <div class="label">{t('contract.monthly')}</div>
            <div class="big num">{money(monthly)}</div>
            <div class="sub">
              {t('contract.perPerson', { amount: money(Math.round(monthly / n)) })} · {t('contract.yearly', { amount: money(monthly * 12, { compact: true }) })}
            </div>
          </div>
          {deadlines.length ? (
            <div class="stack mt-16">
              {deadlines.map(({ c, s }) => (
                <button key={c.id} type="button" class={s.urgency === 'urgent' ? 'banner danger' : 'banner warn'} onClick={() => navigate(`/wg/contracts/${c.id}`)}>
                  <span class="b-emoji">{c.emoji ?? '📄'}</span>
                  <div class="b-main">
                    <div class="b-title">{t('contract.deadlineAlert', { name: c.name, n: s.daysLeft! })}</div>
                    <div class="b-sub">{t('contract.cancelBy', { date: fmtDate(s.cancelBy!, 'medium') })}</div>
                  </div>
                  <Icon name="chevronRight" size={18} class="faint" />
                </button>
              ))}
            </div>
          ) : null}
          <p class="caption" style={{ margin: '16px 4px 10px' }}>
            {t('contract.sub')}
          </p>
          <div class="list">
            {sorted.map(({ c, s }) => (
              <Row
                key={c.id}
                onClick={() => navigate(`/wg/contracts/${c.id}`)}
                lead={<Tile emoji={c.emoji ?? '📄'} />}
                title={c.name}
                sub={`${c.provider || t(`ccat.${c.category}` as Key)} · ${statusText(s)}`}
                end={
                  <>
                    {c.monthlyCost ? <div class="amount num">{money(c.monthlyCost)}</div> : null}
                    <StatusBadge s={s} />
                  </>
                }
                style={s.phase === 'ended' ? { opacity: 0.55 } : undefined}
              />
            ))}
          </div>
        </>
      )}
      <button type="button" class="fab" style={{ '--fab-bg': 'var(--violet)' }} onClick={() => openContractEditor()}>
        <Icon name="plus" size={22} stroke={2.6} /> {t('contract.add')}
      </button>
    </div>
  );
}

function CopyRow(props: { label: string; value?: string }) {
  if (!props.value) return null;
  return (
    <Row
      compact
      title={<span class="num">{props.value}</span>}
      sub={props.label}
      end={<IconButton icon="copy" label={t('common.copy')} variant="plain" size={18} onClick={() => copyText(props.value!, t('contract.copiedValue', { value: props.label }))} />}
    />
  );
}

export function ContractDetail(props: { id: ID }) {
  const c = get('contracts', props.id);
  if (!c) {
    return (
      <div class="screen">
        <TopBar fallback="/wg/contracts" />
      </div>
    );
  }
  const T = today();
  const s = contractStatus(c, T);
  const holder = member(c.holderId);
  const del = async () => {
    const ok = await confirmDialog({ title: t('common.confirmDelete'), message: c.name, confirm: t('common.delete'), destructive: true, emoji: c.emoji });
    if (!ok) return;
    const undo = remove('contracts', c.id);
    if (c.recurringId) update('recurring', c.recurringId, { active: false });
    goBack('/wg/contracts');
    undoToast(t('contract.deleted'), undo, '🗑️');
  };
  const toggleCancelled = () => {
    if (c.cancelled) {
      update('contracts', c.id, { cancelled: false, endDate: undefined });
      if (c.recurringId) update('recurring', c.recurringId, { active: true, endDate: undefined });
      return;
    }
    const end = s.termEnd ?? T;
    update('contracts', c.id, { cancelled: true, endDate: end });
    if (c.recurringId) update('recurring', c.recurringId, { endDate: end });
    toast(t('contract.cancelledToast'), { emoji: '✅' });
  };
  const notice = c.noticeValue != null ? `${c.noticeValue} ${tp(`unit.${c.noticeUnit ?? 'month'}` as 'unit.month', c.noticeValue)}` : '–';
  return (
    <div class="screen">
      <TopBar
        title={c.name}
        fallback="/wg/contracts"
        right={
          <>
            <IconButton icon="pencil" label={t('common.edit')} onClick={() => openContractEditor(c.id)} />
          </>
        }
      />
      <div class="center fade-in" style={{ padding: '6px 0 18px' }}>
        <Tile emoji={c.emoji ?? '📄'} size="xl" color="var(--violet)" />
        <h1 style={{ margin: '12px 0 2px', fontSize: '26px', letterSpacing: '-0.03em' }}>{c.name}</h1>
        <div class="muted">{c.provider}</div>
        {c.monthlyCost ? (
          <div style={{ fontSize: '30px', fontWeight: 820, marginTop: '10px', letterSpacing: '-0.03em' }} class="num">
            {money(c.monthlyCost)}
            <span class="faint" style={{ fontSize: '16px', fontWeight: 650 }}>
              {' '}
              {t('common.perMonth')}
            </span>
          </div>
        ) : null}
      </div>

      <div class={cx('card', s.urgency === 'urgent' && 'pad-lg')} style={s.urgency === 'urgent' ? { boxShadow: '0 0 0 2px var(--red)' } : undefined}>
        <div class="hstack" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 750 }}>{t('contract.term')}</div>
          <StatusBadge s={s} />
        </div>
        <div class="muted mt-8" style={{ fontSize: '15px' }}>
          {statusText(s)}
        </div>
        {s.minTermEnd && c.startDate ? (
          <>
            <div class="timeline">
              <i style={{ width: `${Math.round((s.progress ?? 0) * 100)}%` }} />
              <span class="marker" style={{ left: `${Math.round((s.progress ?? 0) * 100)}%` }} />
            </div>
            <div class="hstack caption" style={{ justifyContent: 'space-between' }}>
              <span>{fmtDate(c.startDate, 'short')}</span>
              <span>{fmtDate(s.minTermEnd, 'short')}</span>
            </div>
          </>
        ) : null}
        {s.cancelBy && s.phase !== 'cancelled' && s.phase !== 'ended' ? (
          <div class={cx('banner mt-12', s.urgency === 'urgent' ? 'danger' : s.urgency === 'soon' ? 'warn' : 'info')}>
            <span class="b-emoji">⏳</span>
            <div class="b-main">
              <div class="b-title">{s.daysLeft === 0 ? t('contract.phase.openEnded') : t('contract.cancelBy', { date: fmtDate(s.cancelBy, 'long') })}</div>
              <div class="b-sub">{s.daysLeft === 0 ? t('contract.earliestEnd', { date: fmtDate(s.termEnd!, 'medium') }) : t('contract.endsThen', { date: fmtDate(s.termEnd!, 'medium') })}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div class="section-title">{t('contract.cancelSection')}</div>
      <div class="stack">
        {s.phase !== 'cancelled' && s.phase !== 'ended' ? (
          <Button variant="primary" block icon="send" onClick={() => openLetter(c.id)} style={{ background: 'var(--violet)', boxShadow: 'none' }}>
            {t('contract.writeLetter')}
          </Button>
        ) : null}
        <Button block icon={c.cancelled ? 'undo' : 'check'} onClick={toggleCancelled}>
          {c.cancelled ? t('contract.reactivate') : t('contract.markCancelled')}
        </Button>
      </div>

      <div class="section-title">{t('contract.details')}</div>
      <div class="list">
        <CopyRow label={t('contract.customerNo')} value={c.customerNumber} />
        <CopyRow label={t('contract.contractNo')} value={c.contractNumber} />
        <CopyRow label={t('contract.meterNo')} value={c.meterNumber} />
        <Row compact title={c.startDate ? fmtDate(c.startDate, 'medium') : '–'} sub={t('contract.start')} />
        <Row compact title={c.minTermMonths ? `${c.minTermMonths} ${tp('unit.month', c.minTermMonths)}` : t('contract.noTerm')} sub={t('contract.minTerm')} />
        <Row compact title={notice} sub={t('contract.notice')} />
        {holder ? <Row compact lead={<Avatar member={holder} size={30} />} title={displayName(holder.id)} sub={t('contract.holder')} /> : null}
        {c.recurringId && get('recurring', c.recurringId)?.active ? <Row compact title={`🔁 ${t('contract.linked')}`} onClick={() => navigate('/money?tab=recurring')} chevron /> : null}
      </div>

      {c.phone || c.email || c.website ? (
        <>
          <div class="section-title">{t('contract.contact')}</div>
          <div class="form-row">
            {c.phone ? (
              <Button icon="phone" onClick={() => (location.href = `tel:${c.phone}`)}>
                {t('contract.phone')}
              </Button>
            ) : null}
            {c.email ? (
              <Button icon="mail" onClick={() => (location.href = `mailto:${c.email}`)}>
                {t('contract.email')}
              </Button>
            ) : null}
            {c.website ? (
              <Button icon="external" onClick={() => window.open(c.website, '_blank', 'noopener')}>
                Web
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {c.notes ? (
        <>
          <div class="section-title">{t('contract.notes')}</div>
          <div class="card" style={{ whiteSpace: 'pre-wrap' }}>
            {c.notes}
          </div>
        </>
      ) : null}

      <Button variant="danger" block icon="trash" class="mt-24" onClick={del}>
        {t('common.delete')}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cancellation letter                                                 */
/* ------------------------------------------------------------------ */

function openLetter(id: ID): void {
  openSheet(() => <LetterSheet id={id} />);
}

function LetterSheet(props: { id: ID }) {
  const c = get('contracts', props.id);
  if (!c) return <Sheet title="" />;
  const s = contractStatus(c, today());
  const holder = member(c.holderId) ?? member(myId());
  const hh = household();
  const city = (hh?.address ?? '').split(/[\n,]/).pop()?.replace(/^\s*\d{4,5}\s*/, '').trim();
  const letter = cancellationLetter({
    locale: getLang(),
    holderName: holder?.name ?? '',
    holderAddress: hh?.address,
    provider: c.provider || c.name,
    contractName: c.name,
    customerNumber: c.customerNumber,
    contractNumber: c.contractNumber,
    termEnd: s.termEnd ? fmtDate(s.termEnd, 'short') : undefined,
    dateLine: `${city ? city + ', ' : ''}${fmtDate(today(), 'short')}`,
  });
  const subject = getLang() === 'de' ? `Kündigung ${c.name}${c.customerNumber ? ' – Kundennr. ' + c.customerNumber : ''}` : `Cancellation ${c.name}`;
  return (
    <Sheet title={t('contract.letterTitle')}>
      <p class="muted" style={{ marginTop: 0, fontSize: '14.5px' }}>
        {t('contract.letterSub')}
      </p>
      <div class="letter printable">{letter}</div>
      <div class="stack mt-16">
        <Button variant="primary" block icon="copy" onClick={() => copyText(letter)}>
          {t('contract.copyLetter')}
        </Button>
        <div class="form-row">
          <Button icon="mail" onClick={() => (location.href = `mailto:${c.email ?? ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter)}`)}>
            {t('contract.mailLetter')}
          </Button>
          <Button icon="share" onClick={() => shareText(letter, subject)}>
            {t('common.share')}
          </Button>
          <Button icon="printer" onClick={() => window.print()} label={t('contract.print')} />
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function openContractEditor(id?: ID): void {
  openSheet(() => <ContractEditor id={id} />);
}

function ContractEditor(props: { id?: ID }) {
  const existing = props.id ? get('contracts', props.id) : undefined;
  const [category, setCategory] = useState<ContractCategory | null>(existing?.category ?? null);
  const [name, setName] = useState(existing?.name ?? '');
  const [provider, setProvider] = useState(existing?.provider ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📄');
  const [costStr, setCostStr] = useState(existing?.monthlyCost ? centsToInput(existing.monthlyCost) : '');
  const [customerNumber, setCustomerNumber] = useState(existing?.customerNumber ?? '');
  const [contractNumber, setContractNumber] = useState(existing?.contractNumber ?? '');
  const [meterNumber, setMeterNumber] = useState(existing?.meterNumber ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? '');
  const [minTerm, setMinTerm] = useState(existing?.minTermMonths != null ? String(existing.minTermMonths) : '');
  const [renewal, setRenewal] = useState(existing?.renewalMonths != null ? String(existing.renewalMonths) : '0');
  const [noticeValue, setNoticeValue] = useState(existing?.noticeValue != null ? String(existing.noticeValue) : '');
  const [noticeUnit, setNoticeUnit] = useState<'day' | 'week' | 'month'>(existing?.noticeUnit ?? 'month');
  const [holderId, setHolderId] = useState<ID | undefined>(existing?.holderId ?? myId());
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [website, setWebsite] = useState(existing?.website ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [link, setLink] = useState(existing ? !!(existing.recurringId && get('recurring', existing.recurringId)?.active) : true);
  const [error, setError] = useState<string | null>(null);

  const pick = (cat: ContractCategory) => {
    const tpl = CONTRACT_TEMPLATES.find((x) => x.category === cat)!;
    setCategory(cat);
    setName(t(`ccat.${cat}` as Key));
    setEmoji(tpl.emoji);
    setMinTerm(tpl.minTermMonths != null ? String(tpl.minTermMonths) : '');
    setRenewal(String(tpl.renewalMonths ?? 0));
    setNoticeValue(tpl.noticeValue != null ? String(tpl.noticeValue) : '');
    setNoticeUnit(tpl.noticeUnit ?? 'month');
    if (tpl.monthlyCost) setCostStr(centsToInput(tpl.monthlyCost));
    if (cat === 'broadcast') setProvider(getLang() === 'de' ? 'ARD ZDF Deutschlandradio Beitragsservice' : '');
    if (cat === 'rent') setLink(false);
  };

  if (!category) {
    return (
      <Sheet title={t('contract.pickType')}>
        <div class="template-grid">
          {CONTRACT_TEMPLATES.map((tpl) => (
            <button key={tpl.category} type="button" onClick={() => pick(tpl.category)}>
              <span class="e">{tpl.emoji}</span>
              {t(`ccat.${tpl.category}` as Key)}
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  const save = () => {
    if (!name.trim()) return setError(t('contract.nameRequired'));
    const data: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'> = {
      name: name.trim(),
      provider: provider.trim(),
      category,
      emoji,
      monthlyCost: parseAmount(costStr) ?? undefined,
      customerNumber: customerNumber.trim() || undefined,
      contractNumber: contractNumber.trim() || undefined,
      meterNumber: meterNumber.trim() || undefined,
      startDate: startDate || undefined,
      minTermMonths: minTerm ? Number(minTerm) : undefined,
      renewalMonths: Number(renewal) || 0,
      noticeValue: noticeValue !== '' ? Number(noticeValue) : undefined,
      noticeUnit,
      holderId,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      website: website.trim() ? (/^https?:\/\//.test(website.trim()) ? website.trim() : 'https://' + website.trim()) : undefined,
      notes: notes.trim() || undefined,
      cancelled: existing?.cancelled,
      endDate: existing?.endDate,
      recurringId: existing?.recurringId,
      remindDays: existing?.remindDays,
    };
    const c = saveContract(data, existing?.id, link);
    closeTopSheet().then(() => {
      if (!existing) navigate(`/wg/contracts/${c.id}`);
    });
    toast(t('contract.saved'), { emoji });
  };

  return (
    <Sheet
      title={existing ? t('contract.edit') : t('contract.new')}
      footer={
        <Button variant="primary" block onClick={save}>
          {t('common.save')}
        </Button>
      }
    >
      <div class="hstack mb-12" style={{ alignItems: 'stretch' }}>
        <span class="tile lg" style={{ height: '52px', width: '52px', borderRadius: '15px' }}>
          {emoji}
        </span>
        <input class="input grow" placeholder={t('contract.name')} value={name} maxLength={60} onInput={(e: any) => setName(e.target.value)} />
      </div>
      <Field label={t('contract.provider')}>
        <input class="input" placeholder={t('contract.providerPlaceholder')} value={provider} maxLength={80} onInput={(e: any) => setProvider(e.target.value)} />
      </Field>
      <Field label={t('contract.cost')}>
        <div class="input-group">
          <input class="input num" inputMode="decimal" placeholder="0,00" value={costStr} onInput={(e: any) => setCostStr(e.target.value.replace(/[^\d.,]/g, ''))} />
          <span class="faint" style={{ position: 'absolute', right: '16px', fontWeight: 700 }}>
            {currencySymbol()}
          </span>
        </div>
      </Field>
      {parseAmount(costStr) ? (
        <div class="list mb-12">
          <SwitchRow title={t('contract.linkRecurring')} sub={t('contract.linkRecurringHint')} on={link} onChange={setLink} />
        </div>
      ) : null}

      <div class="overline">{t('contract.term')}</div>
      <div class="form-row">
        <Field label={t('contract.start')}>
          <input class="input" type="date" value={startDate} onInput={(e: any) => setStartDate(e.target.value)} />
        </Field>
        <Field label={t('contract.minTerm')}>
          <select class="select" value={minTerm} onChange={(e: any) => setMinTerm(e.target.value)}>
            <option value="">{t('contract.noTerm')}</option>
            {[1, 3, 6, 12, 18, 24, 36].map((n) => (
              <option key={n} value={String(n)}>
                {n} {tp('unit.month', n)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div class="form-row">
        <Field label={t('contract.renewal')}>
          <select class="select" value={renewal} onChange={(e: any) => setRenewal(e.target.value)}>
            <option value="0">{t('contract.renewalOpen')}</option>
            {[1, 3, 6, 12, 24].map((n) => (
              <option key={n} value={String(n)}>
                {t('contract.renewalN', { n })}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div class="form-row">
        <Field label={t('contract.notice')}>
          <input class="input num" inputMode="numeric" placeholder="1" value={noticeValue} onInput={(e: any) => setNoticeValue(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label={'\u00a0'}>
          <select class="select" value={noticeUnit} onChange={(e: any) => setNoticeUnit(e.target.value)}>
            {(['day', 'week', 'month'] as const).map((u) => (
              <option key={u} value={u}>
                {tp(`unit.${u}`, Number(noticeValue) || 2)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div class="overline">{t('contract.details')}</div>
      <Field label={t('contract.customerNo')}>
        <input class="input" value={customerNumber} maxLength={60} onInput={(e: any) => setCustomerNumber(e.target.value)} />
      </Field>
      <div class="form-row">
        <Field label={t('contract.contractNo')}>
          <input class="input" value={contractNumber} maxLength={60} onInput={(e: any) => setContractNumber(e.target.value)} />
        </Field>
        {category === 'electricity' || category === 'gas' || category === 'water' ? (
          <Field label={t('contract.meterNo')}>
            <input class="input" value={meterNumber} maxLength={60} onInput={(e: any) => setMeterNumber(e.target.value)} />
          </Field>
        ) : null}
      </div>
      <div class="overline">{t('contract.holder')}</div>
      <MemberPicker members={members()} value={holderId ? [holderId] : []} onChange={(ids) => setHolderId(ids[0])} meId={myId()} />

      <div class="overline">{t('contract.contact')}</div>
      <div class="form-row">
        <Field label={t('contract.phone')}>
          <input class="input" type="tel" value={phone} onInput={(e: any) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('contract.email')}>
          <input class="input" type="email" value={email} onInput={(e: any) => setEmail(e.target.value)} />
        </Field>
      </div>
      <Field label={t('contract.website')}>
        <input class="input" type="url" inputMode="url" value={website} onInput={(e: any) => setWebsite(e.target.value)} />
      </Field>
      <Field label={t('contract.notes')}>
        <textarea class="textarea" style={{ minHeight: '80px' }} value={notes} onInput={(e: any) => setNotes(e.target.value)} />
      </Field>
      {error ? <div class="error-text center">{error}</div> : null}
    </Sheet>
  );
}
