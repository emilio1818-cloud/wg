import { h, Fragment, useEffect, useState } from '../lib/ui.ts';
import { navigate } from '../lib/router.ts';
import { AVATAR_EMOJIS, HOUSEHOLD_EMOJIS, MEMBER_COLORS } from '../../../core/src/categories.ts';
import { CHORE_TEMPLATES } from '../../../core/src/chores.ts';
import { formatInviteCode, normalizeInviteCode } from '../../../core/src/ids.ts';
import { t } from '../i18n/index.ts';
import type { Key } from '../i18n/index.ts';
import { freqLabel } from '../i18n/format.ts';
import * as api from '../state/api.ts';
import { createHousehold, joinHousehold } from '../state/actions.ts';
import { loadDemo } from '../state/demo.ts';
import { household } from '../state/selectors.ts';
import { store } from '../state/store.ts';
import { prefs } from '../state/prefs.ts';
import { Avatar, Button, ColorRow, cx, EmojiGrid, Field, Icon, IconButton } from '../components/core.tsx';
import { confetti, confirmDialog, toast } from '../components/overlays.tsx';
import { InvitePanel } from '../components/invite.tsx';
import { LogoGlyph } from '../components/brand.tsx';

void Fragment;

function Blobs() {
  return (
    <>
      <div class="blob" style={{ width: '320px', height: '320px', background: '#8b6cff', top: '-120px', right: '-120px' }} />
      <div class="blob" style={{ width: '260px', height: '260px', background: '#ff7aa2', top: '180px', left: '-150px', animationDelay: '-4s' }} />
      <div class="blob" style={{ width: '220px', height: '220px', background: '#ffc56b', bottom: '-80px', right: '-60px', animationDelay: '-8s', opacity: 0.35 }} />
    </>
  );
}

export function Welcome() {
  const features: { emoji: string; title: Key; sub: Key }[] = [
    { emoji: '💸', title: 'welcome.f1.title', sub: 'welcome.f1.sub' },
    { emoji: '✨', title: 'welcome.f2.title', sub: 'welcome.f2.sub' },
    { emoji: '🛒', title: 'welcome.f3.title', sub: 'welcome.f3.sub' },
    { emoji: '📄', title: 'welcome.f4.title', sub: 'welcome.f4.sub' },
  ];
  const existing = store.session;
  return (
    <div class="welcome">
      <Blobs />
      {existing ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <IconButton icon="x" label={t('common.close')} onClick={() => navigate('/', { replace: true })} />
        </div>
      ) : null}
      <div style={{ marginTop: existing ? '8px' : '28px' }}>
        <div class="logo-mark">
          <LogoGlyph size={50} />
        </div>
        <h1 class="brand-name">Nestly</h1>
        <p class="pitch">{t('welcome.pitch')}</p>
      </div>
      <div class="feature-list">
        {features.map((f, i) => (
          <div key={f.title} class="feature" style={{ animationDelay: `${120 + i * 70}ms` }}>
            <div class="fe">{f.emoji}</div>
            <div class="ft">{t(f.title)}</div>
            <div class="fs">{t(f.sub)}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto' }} class="stack">
        <Button variant="brand" block onClick={() => navigate('/create')}>
          {t('welcome.create')}
        </Button>
        <Button block onClick={() => navigate('/join')} style={{ background: 'var(--card)', boxShadow: 'var(--shadow)' }}>
          <Icon name="key" size={19} /> {t('welcome.join')}
        </Button>
        <Button
          variant="ghost"
          block
          onClick={() => {
            loadDemo();
            navigate('/', { replace: true });
          }}
        >
          {t('welcome.demo')}
        </Button>
        <div class="trust">
          <Icon name="shield" size={15} /> {t('welcome.trust')}
        </div>
      </div>
    </div>
  );
}

function StepHeader(props: { step: number; total: number; onBack: () => void }) {
  return (
    <div class="hstack" style={{ paddingTop: '4px' }}>
      <IconButton icon="chevronLeft" label={t('common.back')} onClick={props.onBack} />
      <div class="grow steps-dots">
        {Array.from({ length: props.total }, (_, i) => (
          <i key={i} class={i <= props.step ? 'on' : ''} />
        ))}
      </div>
      <div style={{ width: '40px' }} />
    </div>
  );
}

const STARTER_CHORES = ['kitchen', 'bathroom', 'vacuum', 'trash', 'glass', 'plants', 'dishwasher', 'mop', 'bottles', 'fridge'];

export function CreateFlow() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(AVATAR_EMOJIS[0]!);
  const [color, setColor] = useState(MEMBER_COLORS[0]!);
  const [wgName, setWgName] = useState('');
  const [wgEmoji, setWgEmoji] = useState(HOUSEHOLD_EMOJIS[0]!);
  const [roommates, setRoommates] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [chores, setChores] = useState<string[]>(['kitchen', 'bathroom', 'vacuum', 'trash']);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const back = () => (step === 0 ? navigate('/welcome', { replace: true }) : setStep(step - 1));
  const canNext = step === 0 ? name.trim().length > 0 : step === 1 ? wgName.trim().length > 0 : true;

  const addRoommate = () => {
    const n = draft.trim();
    if (!n) return;
    setRoommates([...roommates, n]);
    setDraft('');
  };

  const finish = async () => {
    if (store.session && store.session.mode !== 'demo') {
      const ok = await confirmDialog({ title: t('settings.leaveTitle'), message: t('settings.leaveSub'), confirm: t('create.finish'), emoji: '🏠' });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const all = draft.trim() ? [...roommates, draft.trim()] : roommates;
      await createHousehold({ myName: name, myEmoji: emoji, myColor: color, wgName, wgEmoji, roommates: all, chores });
    } catch {
      /* stays local; invite screen offers to connect later */
    }
    setBusy(false);
    setDone(true);
    setTimeout(() => confetti(innerWidth / 2, innerHeight * 0.3, 40), 150);
  };

  if (done) {
    return (
      <div class="welcome">
        <Blobs />
        <div class="center" style={{ marginTop: '20px' }}>
          <div style={{ fontSize: '58px' }}>🎉</div>
          <h1 class="step-title">{t('create.doneTitle')}</h1>
          <p class="muted" style={{ margin: '0 auto 22px', maxWidth: '330px' }}>
            {t('create.doneSub')}
          </p>
        </div>
        <InvitePanel />
        <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
          <Button variant="brand" block onClick={() => navigate('/', { replace: true })}>
            {t('create.goHome')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div class="welcome">
      <StepHeader step={step} total={4} onBack={back} />
      <div key={step} class="fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {step === 0 ? (
          <>
            <h1 class="step-title">{t('create.step1.title')}</h1>
            <p class="muted" style={{ marginTop: 0 }}>
              {t('create.step1.sub')}
            </p>
            <div class="center" style={{ margin: '12px 0 18px' }}>
              <Avatar member={{ name: name || '?', emoji, color }} size={92} />
            </div>
            <Field>
              <input
                class="input"
                placeholder={t('create.namePlaceholder')}
                value={name}
                autoFocus
                autoComplete="given-name"
                maxLength={40}
                onInput={(e: any) => setName(e.target.value)}
                onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && canNext && setStep(1)}
              />
            </Field>
            <div class="overline">{t('create.avatar')}</div>
            <EmojiGrid options={AVATAR_EMOJIS} value={emoji} onChange={setEmoji} />
            <div class="mt-16">
              <ColorRow options={MEMBER_COLORS} value={color} onChange={setColor} />
            </div>
          </>
        ) : step === 1 ? (
          <>
            <h1 class="step-title">{t('create.step2.title')}</h1>
            <p class="muted" style={{ marginTop: 0 }}>
              {t('create.step2.sub')}
            </p>
            <div class="center" style={{ margin: '10px 0 18px' }}>
              <span class="tile xl" style={{ background: 'var(--card)', boxShadow: 'var(--shadow)', fontSize: '46px', width: '92px', height: '92px', borderRadius: '30px' }}>
                {wgEmoji}
              </span>
            </div>
            <Field>
              <input
                class="input"
                placeholder={t('create.wgPlaceholder')}
                value={wgName}
                autoFocus
                maxLength={50}
                onInput={(e: any) => setWgName(e.target.value)}
                onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && canNext && setStep(2)}
              />
            </Field>
            <div class="chips" style={{ marginBottom: '18px' }}>
              {(['create.idea1', 'create.idea2', 'create.idea3', 'create.idea4', 'create.idea5'] as Key[]).map((k) => (
                <button key={k} type="button" class="chip soft" onClick={() => setWgName(t(k))}>
                  {t(k)}
                </button>
              ))}
            </div>
            <EmojiGrid options={HOUSEHOLD_EMOJIS} value={wgEmoji} onChange={setWgEmoji} />
          </>
        ) : step === 2 ? (
          <>
            <h1 class="step-title">{t('create.step3.title')}</h1>
            <p class="muted" style={{ marginTop: 0 }}>
              {t('create.step3.sub')}
            </p>
            <div class="list" style={{ margin: '8px 0 14px' }}>
              <div class="row compact">
                <Avatar member={{ name, emoji, color }} size={34} />
                <div class="main">
                  <div class="title">
                    {name} <span class="faint">({t('common.you')})</span>
                  </div>
                </div>
              </div>
              {roommates.map((r, i) => (
                <div key={r + i} class="row compact">
                  <Avatar member={{ name: r, color: MEMBER_COLORS[(MEMBER_COLORS.indexOf(color) + i + 1) % MEMBER_COLORS.length]! }} size={34} />
                  <div class="main">
                    <div class="title">{r}</div>
                  </div>
                  <IconButton icon="x" label={t('common.delete')} variant="plain" size={18} onClick={() => setRoommates(roommates.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>
            <div class="input-group">
              <input
                class="input"
                placeholder={t('create.roommatePlaceholder')}
                value={draft}
                autoFocus
                maxLength={40}
                onInput={(e: any) => setDraft(e.target.value)}
                onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && addRoommate()}
              />
              <span class="addon">
                <IconButton icon="plus" label={t('common.add')} onClick={addRoommate} style={{ background: 'var(--primary)', color: '#fff' }} />
              </span>
            </div>
          </>
        ) : (
          <>
            <h1 class="step-title">{t('create.step4.title')}</h1>
            <p class="muted" style={{ marginTop: 0 }}>
              {t('create.step4.sub')}
            </p>
            <div class="template-grid" style={{ marginTop: '8px' }}>
              {STARTER_CHORES.map((key) => {
                const tpl = CHORE_TEMPLATES.find((c) => c.key === key)!;
                const on = chores.includes(key);
                return (
                  <button key={key} type="button" class={on ? 'active' : ''} onClick={() => setChores(on ? chores.filter((c) => c !== key) : [...chores, key])}>
                    <span class="e">{tpl.emoji}</span>
                    {t(`tpl.${key}` as Key)}
                    <span class="caption">{freqLabel(tpl.frequency)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div style={{ marginTop: 'auto', paddingTop: '24px' }}>
          {step < 3 ? (
            <Button variant="primary" block disabled={!canNext} onClick={() => setStep(step + 1)}>
              {step === 2 && roommates.length === 0 && !draft.trim() ? t('common.skip') : t('common.next')}
            </Button>
          ) : (
            <Button variant="brand" block disabled={busy} onClick={finish}>
              {busy ? t('create.creating') : t('create.finish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function JoinFlow(props: { code?: string }) {
  const [code, setCode] = useState(props.code ? formatInviteCode(props.code) : '');
  const [preview, setPreview] = useState<api.InvitePreview | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(AVATAR_EMOJIS[1]!);
  const [serverUrl, setServerUrl] = useState(prefs.serverUrl ?? '');
  const [needServer, setNeedServer] = useState(false);

  const check = async (raw = code) => {
    const c = normalizeInviteCode(raw);
    if (c.length !== 6) return;
    setBusy(true);
    setError(null);
    let server = needServer && serverUrl.trim() ? serverUrl.trim().replace(/\/+$/, '') : await api.resolveServer();
    if (server && !/^https?:\/\//.test(server)) server = 'https://' + server;
    if (!server) {
      setNeedServer(true);
      setError(t('join.noServer'));
      setBusy(false);
      return;
    }
    try {
      const p = await api.previewInvite(server, c);
      setBase(server);
      setPreview(p);
      const free = p.members.filter((m) => !m.claimed);
      setClaim(free.length ? free[0]!.id : null);
    } catch (err) {
      const e = err as api.ApiError;
      setError(e.status === 404 ? t('join.notFound') : e.status === 0 ? t('error.network') : t('join.error'));
      if (e.status === 0) setNeedServer(true);
    }
    setBusy(false);
  };

  useEffect(() => {
    if (props.code) void check(props.code);
  }, []);

  const join = async () => {
    if (!preview || !base) return;
    if (store.session && store.session.mode !== 'demo' && store.session.householdId !== preview.householdId) {
      const ok = await confirmDialog({ title: t('settings.leaveTitle'), message: t('settings.leaveSub'), confirm: t('join.join'), emoji: '🔑' });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const claimed = preview.members.find((m) => m.id === claim);
      await joinHousehold(base, normalizeInviteCode(code), preview, claim, {
        name: claim ? (claimed?.name ?? name) : name,
        emoji: claim ? (claimed?.emoji ?? emoji) : emoji,
        color: claimed?.color ?? MEMBER_COLORS[preview.members.length % MEMBER_COLORS.length]!,
      });
      navigate('/', { replace: true });
      setTimeout(() => {
        confetti(innerWidth / 2, innerHeight * 0.3, 40);
        toast(t('join.welcome', { name: household()?.name ?? preview.name }), { emoji: preview.emoji });
      }, 200);
    } catch (err) {
      const e = err as api.ApiError;
      setError(e.code === 'member_claimed' ? t('join.claimed') : t('join.error'));
    }
    setBusy(false);
  };

  const backToStart = () => (preview ? setPreview(null) : navigate(store.session ? '/' : '/welcome', { replace: true }));

  if (!preview) {
    return (
      <div class="welcome">
        <StepHeader step={0} total={2} onBack={backToStart} />
        <div class="fade-in">
          <h1 class="step-title">{t('join.title')}</h1>
          <p class="muted" style={{ marginTop: 0 }}>
            {t('join.sub')}
          </p>
          <input
            class="code-input mt-16"
            placeholder="ABC-123"
            value={code}
            autoFocus
            maxLength={7}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellcheck={false}
            onInput={(e: any) => {
              const v = normalizeInviteCode(e.target.value).slice(0, 6);
              const formatted = v.length > 3 ? `${v.slice(0, 3)}-${v.slice(3)}` : v;
              setCode(formatted);
              if (v.length === 6) void check(v);
            }}
            onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && check()}
          />
          {error ? <div class="error-text center mt-12">{error}</div> : null}
          {needServer ? (
            <Field label={t('invite.serverUrl')} class="mt-16">
              <input class="input" type="url" inputMode="url" placeholder="https://nestly.example.com" value={serverUrl} onInput={(e: any) => setServerUrl(e.target.value)} />
            </Field>
          ) : null}
        </div>
        <div style={{ marginTop: 'auto', paddingTop: '24px' }}>
          <Button variant="primary" block disabled={busy || normalizeInviteCode(code).length !== 6} onClick={() => check()}>
            {busy ? '…' : t('join.check')}
          </Button>
        </div>
      </div>
    );
  }

  const canJoin = claim !== null || name.trim().length > 0;
  return (
    <div class="welcome">
      <StepHeader step={1} total={2} onBack={backToStart} />
      <div class="fade-in">
        <div class="center" style={{ marginTop: '14px' }}>
          <span class="tile xl" style={{ background: 'var(--card)', boxShadow: 'var(--shadow)', margin: '0 auto' }}>
            {preview.emoji}
          </span>
          <h1 class="step-title" style={{ marginBottom: '4px' }}>
            {preview.name}
          </h1>
          <p class="muted" style={{ marginTop: 0 }}>
            {t('join.whoSub')}
          </p>
        </div>
        <div class="list mt-16">
          {preview.members.map((m) => (
            <button key={m.id} type="button" class="row" disabled={m.claimed} style={m.claimed ? { opacity: 0.5 } : undefined} onClick={() => setClaim(m.id)}>
              <Avatar member={m} size={40} />
              <div class="main">
                <div class="title">{m.name}</div>
                {m.claimed ? <div class="sub">{t('join.claimed')}</div> : null}
              </div>
              <span class={cx('check', claim === m.id && 'on')}>
                <Icon name="check" size={17} stroke={3} />
              </span>
            </button>
          ))}
          <button type="button" class="row" onClick={() => setClaim(null)}>
            <span class="avatar emoji" style={{ '--size': '40px', '--c': 'var(--primary)' }}>
              <Icon name="plus" size={20} />
            </span>
            <div class="main">
              <div class="title">{t('join.newProfile')}</div>
            </div>
            <span class={cx('check', claim === null && 'on')}>
              <Icon name="check" size={17} stroke={3} />
            </span>
          </button>
        </div>
        {claim === null ? (
          <div class="mt-16 fade-in">
            <Field label={t('join.yourName')}>
              <input class="input" value={name} autoFocus maxLength={40} placeholder={t('create.namePlaceholder')} onInput={(e: any) => setName(e.target.value)} />
            </Field>
            <EmojiGrid options={AVATAR_EMOJIS.slice(0, 10)} value={emoji} onChange={setEmoji} />
          </div>
        ) : null}
        {error ? <div class="error-text center mt-12">{error}</div> : null}
      </div>
      <div style={{ marginTop: 'auto', paddingTop: '24px' }}>
        <Button variant="brand" block disabled={busy || !canJoin} onClick={join}>
          {busy ? '…' : t('join.join')}
        </Button>
      </div>
    </div>
  );
}
