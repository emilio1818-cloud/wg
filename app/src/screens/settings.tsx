import { h, Fragment, useState } from '../lib/ui.ts';
import { navigate } from '../lib/router.ts';
import { HOUSEHOLD_EMOJIS } from '../../../core/src/categories.ts';
import { t, tp } from '../i18n/index.ts';
import { timeAgo } from '../i18n/format.ts';
import { store, update } from '../state/store.ts';
import { household, me, myId } from '../state/selectors.ts';
import { prefs, setPrefs } from '../state/prefs.ts';
import { applyLanguage } from '../state/locale.ts';
import { syncNow, syncState } from '../state/sync.ts';
import { exportData, expensesCsv, leaveHousehold } from '../state/actions.ts';
import { Avatar, Button, cx, EmojiGrid, Field, Icon, Row, Segmented, SwitchRow, Tile, TopBar } from '../components/core.tsx';
import { confirmDialog, downloadFile, toast } from '../components/overlays.tsx';
import { openProfileEditor } from './members.tsx';
import { openInvite } from './members.tsx';

void Fragment;

export const APP_VERSION = '1.0.0';

let installPrompt: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

export function canInstall(): boolean {
  return !!installPrompt;
}

export async function promptInstall(): Promise<void> {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
}

function SyncStatusRow() {
  const s = store.session!;
  const pending = store.dirty.size;
  let title: string;
  let icon: 'cloud' | 'cloudOff' | 'refresh' = 'cloud';
  let color = 'var(--green)';
  if (s.mode === 'demo') {
    title = t('sync.demo');
    icon = 'cloudOff';
    color = 'var(--text-3)';
  } else if (s.mode === 'local') {
    title = t('sync.local');
    icon = 'cloudOff';
    color = 'var(--amber)';
  } else if (syncState.status === 'syncing') {
    title = t('sync.syncing');
    icon = 'refresh';
    color = 'var(--blue)';
  } else if (syncState.status === 'offline') {
    title = t('sync.offline');
    icon = 'cloudOff';
    color = 'var(--amber)';
  } else if (syncState.status === 'error') {
    title = t('sync.error');
    icon = 'cloudOff';
    color = 'var(--red)';
  } else if (syncState.status === 'unauthorized') {
    title = t('error.sessionExpired');
    icon = 'cloudOff';
    color = 'var(--red)';
  } else {
    title = t('sync.cloud');
  }
  const sub = s.mode === 'cloud' ? [pending ? tp('sync.pending', pending) : null, syncState.lastSync ? t('sync.lastSync', { time: timeAgo(syncState.lastSync) }) : null, s.serverUrl?.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ') : undefined;
  return (
    <Row
      lead={<Tile icon={icon} color={color} />}
      title={title}
      sub={sub}
      end={s.mode === 'cloud' ? <Button size="sm" onClick={() => syncNow()}>{t('sync.now')}</Button> : s.mode === 'local' ? <Button size="sm" variant="primary" onClick={() => openInvite()}>{t('invite.connect')}</Button> : null}
    />
  );
}

export function Settings() {
  const hh = household();
  const self = me();
  const s = store.session;
  const [wgName, setWgName] = useState(hh?.name ?? '');
  const [showEmoji, setShowEmoji] = useState(false);
  if (!hh || !s) return null;

  const notifSupported = typeof Notification !== 'undefined';
  const toggleNotify = async (on: boolean) => {
    if (!on) return setPrefs({ notify: false });
    if (!notifSupported) return;
    const perm = await Notification.requestPermission();
    if (perm === 'granted') setPrefs({ notify: true });
    else toast(t('settings.notifDenied'), { emoji: '🔕' });
  };

  const leave = async () => {
    const ok = await confirmDialog({
      title: s.mode === 'demo' ? t('settings.exitDemo') : t('settings.leaveTitle'),
      message: s.mode === 'local' ? t('settings.leaveLocalSub') : s.mode === 'demo' ? undefined : t('settings.leaveSub'),
      confirm: s.mode === 'demo' ? t('settings.exitDemo') : t('settings.leave'),
      destructive: true,
      emoji: '👋',
    });
    if (!ok) return;
    await leaveHousehold();
    navigate('/welcome', { replace: true });
  };

  return (
    <div class="screen">
      <TopBar title={t('settings.title')} fallback="/wg" />

      <button type="button" class="card hstack mt-8" style={{ width: '100%', textAlign: 'left' }} onClick={() => openProfileEditor(myId())}>
        <Avatar member={self} size={56} />
        <div class="grow">
          <div style={{ fontWeight: 780, fontSize: '18px' }}>{self?.name}</div>
          <div class="muted" style={{ fontSize: '14px' }}>
            {t('members.edit')}
          </div>
        </div>
        <Icon name="chevronRight" size={18} class="faint" />
      </button>

      <div class="overline">{t('settings.wg')}</div>
      <div class="card">
        <div class="hstack" style={{ alignItems: 'stretch' }}>
          <button type="button" class="tile lg" style={{ height: '52px', width: '52px', borderRadius: '15px' }} onClick={() => setShowEmoji(!showEmoji)} aria-label={t('settings.wgEmoji')}>
            {hh.emoji}
          </button>
          <input
            class="input grow"
            value={wgName}
            maxLength={50}
            aria-label={t('settings.wgName')}
            onInput={(e: any) => setWgName(e.target.value)}
            onBlur={() => wgName.trim() && wgName.trim() !== hh.name && update('household', hh.id, { name: wgName.trim() })}
          />
        </div>
        {showEmoji ? (
          <div class="mt-12 fade-in">
            <EmojiGrid
              options={HOUSEHOLD_EMOJIS}
              value={hh.emoji}
              onChange={(e) => {
                update('household', hh.id, { emoji: e });
                setShowEmoji(false);
              }}
            />
          </div>
        ) : null}
        <Field label={t('settings.currency')} class="mt-12">
          <select class="select" value={hh.currency} onChange={(e: any) => update('household', hh.id, { currency: e.target.value })}>
            {['EUR', 'CHF', 'GBP', 'USD', 'PLN', 'CZK', 'SEK', 'DKK', 'NOK'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div class="overline">{t('settings.sync')}</div>
      <div class="list">
        <SyncStatusRow />
      </div>

      <div class="overline">{t('settings.appearance')}</div>
      <Segmented
        value={prefs.theme}
        onChange={(v) => setPrefs({ theme: v })}
        options={[
          { value: 'system', label: `✨ ${t('theme.system')}` },
          { value: 'light', label: `☀️ ${t('theme.light')}` },
          { value: 'dark', label: `🌙 ${t('theme.dark')}` },
        ]}
      />
      <div class="overline">{t('settings.language')}</div>
      <Segmented
        value={prefs.locale}
        onChange={(v) => {
          setPrefs({ locale: v });
          applyLanguage();
        }}
        options={[
          { value: 'auto', label: t('lang.auto') },
          { value: 'de', label: '🇩🇪 Deutsch' },
          { value: 'en', label: '🇬🇧 English' },
        ]}
      />

      <div class="overline">{t('settings.notifications')}</div>
      <div class="list">
        <SwitchRow lead={<Tile icon="bell" color="var(--amber)" />} title={t('settings.notifications')} sub={t('settings.notificationsHint')} on={prefs.notify && notifSupported && Notification.permission === 'granted'} onChange={toggleNotify} />
      </div>

      {canInstall() ? (
        <>
          <div class="overline">{t('settings.install')}</div>
          <div class="list">
            <Row lead={<Tile icon="smartphone" color="var(--primary)" />} title={t('home.installTitle')} sub={t('home.installSub')} onClick={() => promptInstall()} chevron />
          </div>
        </>
      ) : null}

      <div class="overline">{t('settings.data')}</div>
      <div class="list">
        <Row lead={<Tile icon="download" color="var(--blue)" />} title={t('settings.export')} onClick={() => downloadFile(`nestly-${hh.name.replace(/\W+/g, '-').toLowerCase()}.json`, exportData())} chevron />
        <Row lead={<Tile icon="receipt" color="var(--green)" />} title={t('settings.exportCsv')} onClick={() => downloadFile(`nestly-expenses.csv`, '﻿' + expensesCsv(), 'text/csv;charset=utf-8')} chevron />
      </div>

      <div class="overline">{t('settings.about')}</div>
      <div class="card">
        <div class="hstack">
          <Tile icon="shield" color="var(--green)" />
          <div class="grow">
            <div style={{ fontWeight: 750 }}>{t('settings.privacy')}</div>
          </div>
        </div>
        <p class="muted" style={{ fontSize: '14px', margin: '10px 0 0' }}>
          {t('settings.privacyText')}
        </p>
      </div>

      <Button variant="danger" block class="mt-24" icon="logout" onClick={leave}>
        {s.mode === 'demo' ? t('settings.exitDemo') : t('settings.leave')}
      </Button>
      <p class={cx('caption center mt-24')}>
        Nestly · {t('settings.version', { v: APP_VERSION })}
        <br />
        {t('settings.madeWith')}
      </p>
    </div>
  );
}
