import { h, Fragment, useState } from '../lib/ui.ts';
import { navigate, openSheet } from '../lib/router.ts';
import { addDays, today } from '../../../core/src/dates.ts';
import { contractStatus } from '../../../core/src/contracts.ts';
import { t, tp } from '../i18n/index.ts';
import { fmtDate, relDay } from '../i18n/format.ts';
import type { IconName } from '../lib/icons.ts';
import { list, update } from '../state/store.ts';
import { household, members, sortedActivity } from '../state/selectors.ts';
import { prefs, setPrefs } from '../state/prefs.ts';
import { AvatarStack, Button, Empty, Field, Icon, IconButton, Row, Segmented, Tile, TopBar } from '../components/core.tsx';
import { copyText, Sheet, toast } from '../components/overlays.tsx';
import { QrCode } from '../components/charts.tsx';
import { ActivityRow } from '../components/activity.tsx';
import { openInvite } from './members.tsx';
import { openSetup } from './setup.tsx';

void Fragment;

function HubTile(props: { icon: IconName; color: string; title: string; sub: string; onClick: () => void; badge?: string }) {
  return (
    <button type="button" class="tile-card" style={{ '--accent': props.color, minHeight: '118px' }} onClick={props.onClick}>
      <div class="t-head">
        <span class="t-icon">
          <Icon name={props.icon} size={20} stroke={2.3} />
        </span>
        {props.badge ? <span class="badge red">{props.badge}</span> : null}
      </div>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ fontWeight: 750, fontSize: '16px' }}>{props.title}</div>
        <div class="t-sub" style={{ marginTop: '2px' }}>
          {props.sub}
        </div>
      </div>
    </button>
  );
}

export function WgHub() {
  const hh = household();
  const ms = members();
  const T = today();
  const contracts = list('contracts');
  const urgent = contracts.filter((c) => contractStatus(c, T).urgency === 'urgent').length;
  const soonEvents = list('events').filter((e) => (e.endDate ?? e.date) >= T && e.date <= addDays(T, 14)).length;
  const notes = list('notes').length;
  return (
    <div class="screen">
      <div style={{ paddingTop: '14px' }} />
      <div class="hero" style={{ textAlign: 'center', paddingTop: '26px' }}>
        <div style={{ fontSize: '54px', lineHeight: 1 }}>{hh?.emoji}</div>
        <div style={{ fontSize: '26px', fontWeight: 820, letterSpacing: '-0.03em', marginTop: '10px' }}>{hh?.name}</div>
        {hh?.address ? <div class="sub" style={{ marginTop: '2px' }}>{hh.address}</div> : null}
        <div class="hstack" style={{ justifyContent: 'center', marginTop: '14px' }}>
          <AvatarStack members={ms} size={34} max={6} />
        </div>
        <div class="actions" style={{ justifyContent: 'center' }}>
          <Button variant="white" size="md" icon="userPlus" onClick={() => openInvite()}>
            {t('wg.invite')}
          </Button>
          <Button variant="white" size="md" icon="users" onClick={() => navigate('/wg/members')}>
            {tp('wg.members', ms.length)}
          </Button>
        </div>
      </div>

      <div class="section-title">{t('wg.organize')}</div>
      <div class="bento">
        <HubTile icon="file" color="var(--violet)" title={t('wg.contracts')} sub={tp('wg.contractsCount', contracts.length)} badge={urgent ? '!' : undefined} onClick={() => navigate('/wg/contracts')} />
        <HubTile icon="calendar" color="var(--pink)" title={t('wg.calendar')} sub={tp('wg.eventsSoon', soonEvents)} onClick={() => navigate('/wg/calendar')} />
        <HubTile icon="pin" color="var(--orange)" title={t('wg.board')} sub={tp('wg.notes', notes)} onClick={() => navigate('/wg/board')} />
        <HubTile icon="wifi" color="var(--teal)" title={t('wg.wifi')} sub={hh?.wifiSsid ? t('wg.wifiReady') : t('wg.wifiMissing')} onClick={() => navigate('/wg/wifi')} />
      </div>

      <div class="section-title">{t('wg.title')}</div>
      <div class="list">
        <Row lead={<Tile icon="repeat" color="var(--green)" />} title={t('wg.recurring')} onClick={() => navigate('/money?tab=recurring')} chevron />
        <Row lead={<Tile icon="users" color="var(--blue)" />} title={t('wg.members')} onClick={() => navigate('/wg/members')} chevron />
        <Row lead={<Tile icon="home" color="var(--primary)" />} title={t('wg.info')} onClick={() => navigate('/wg/info')} chevron />
        <Row lead={<Tile icon="sparkles" color="var(--violet)" />} title={t('wg.setup')} onClick={openSetup} chevron />
        <Row lead={<Tile icon="bell" color="var(--amber)" />} title={t('wg.activity')} onClick={() => navigate('/activity')} chevron />
      </div>

      <div class="section-title">{t('wg.app')}</div>
      <div class="list">
        <Row lead={<Tile icon="settings" color="var(--text-2)" />} title={t('wg.settings')} onClick={() => navigate('/wg/settings')} chevron />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wi-Fi                                                               */
/* ------------------------------------------------------------------ */

function wifiPayload(ssid: string, password: string, security: string): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${security === 'nopass' ? 'nopass' : security};S:${esc(ssid)};${security === 'nopass' ? '' : `P:${esc(password)};`};`;
}

export function openWifi(): void {
  openSheet(() => (
    <Sheet title={t('wifi.title')}>
      <WifiCard />
    </Sheet>
  ));
}

function WifiCard() {
  const hh = household();
  const [show, setShow] = useState(false);
  if (!hh?.wifiSsid) return null;
  const payload = wifiPayload(hh.wifiSsid, hh.wifiPassword ?? '', hh.wifiSecurity ?? 'WPA');
  return (
    <div class="center">
      <div class="qr-box">
        <QrCode text={payload} size={210} />
      </div>
      <div class="caption mt-12">{t('wifi.scan')}</div>
      <div class="list mt-16" style={{ textAlign: 'left' }}>
        <Row compact title={hh.wifiSsid} sub={t('wifi.ssid')} end={<IconButton icon="copy" label={t('common.copy')} variant="plain" size={18} onClick={() => copyText(hh.wifiSsid!)} />} />
        {hh.wifiSecurity !== 'nopass' ? (
          <Row
            compact
            title={<span class="kbd-code" style={{ letterSpacing: '0.02em' }}>{show ? hh.wifiPassword : '••••••••••'}</span>}
            sub={t('wifi.password')}
            end={
              <div class="hstack" style={{ gap: '4px' }}>
                <IconButton icon={show ? 'eyeOff' : 'eye'} label={show ? t('common.hide') : t('common.show')} variant="plain" size={18} onClick={() => setShow(!show)} />
                <IconButton icon="copy" label={t('common.copy')} variant="plain" size={18} onClick={() => copyText(hh.wifiPassword ?? '')} />
              </div>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

export function WifiScreen() {
  const hh = household();
  const [editing, setEditing] = useState(!hh?.wifiSsid);
  const [ssid, setSsid] = useState(hh?.wifiSsid ?? '');
  const [password, setPassword] = useState(hh?.wifiPassword ?? '');
  const [security, setSecurity] = useState<'WPA' | 'WEP' | 'nopass'>(hh?.wifiSecurity ?? 'WPA');
  if (!hh) return null;
  const save = () => {
    if (!ssid.trim()) return;
    update('household', hh.id, { wifiSsid: ssid.trim(), wifiPassword: password, wifiSecurity: security });
    setEditing(false);
    toast(t('info.saved'), { emoji: '📶' });
  };
  return (
    <div class="screen">
      <TopBar title={t('wifi.title')} fallback="/wg" right={hh.wifiSsid && !editing ? <IconButton icon="pencil" label={t('wifi.edit')} onClick={() => setEditing(true)} /> : null} />
      {!editing && hh.wifiSsid ? (
        <div class="fade-in mt-16">
          <p class="muted center" style={{ marginTop: 0 }}>
            {t('wifi.sub')}
          </p>
          <WifiCard />
        </div>
      ) : (
        <div class="fade-in mt-16">
          {!hh.wifiSsid ? <Empty art="📶" title={t('wifi.emptyTitle')} sub={t('wifi.emptySub')} /> : null}
          <Field label={t('wifi.ssid')}>
            <input class="input" value={ssid} autoComplete="off" maxLength={64} onInput={(e: any) => setSsid(e.target.value)} />
          </Field>
          <Field label={t('wifi.security')}>
            <Segmented
              value={security}
              onChange={setSecurity}
              options={[
                { value: 'WPA', label: 'WPA/WPA2/3' },
                { value: 'WEP', label: 'WEP' },
                { value: 'nopass', label: t('wifi.none') },
              ]}
            />
          </Field>
          {security !== 'nopass' ? (
            <Field label={t('wifi.password')}>
              <input class="input" value={password} autoComplete="off" spellcheck={false} maxLength={64} onInput={(e: any) => setPassword(e.target.value)} />
            </Field>
          ) : null}
          <Button variant="primary" block disabled={!ssid.trim()} onClick={save}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WG info                                                             */
/* ------------------------------------------------------------------ */

export function InfoScreen() {
  const hh = household();
  const [address, setAddress] = useState(hh?.address ?? '');
  const [name, setName] = useState(hh?.landlordName ?? '');
  const [phone, setPhone] = useState(hh?.landlordPhone ?? '');
  const [email, setEmail] = useState(hh?.landlordEmail ?? '');
  if (!hh) return null;
  const dirty = address !== (hh.address ?? '') || name !== (hh.landlordName ?? '') || phone !== (hh.landlordPhone ?? '') || email !== (hh.landlordEmail ?? '');
  const save = () => {
    update('household', hh.id, { address: address.trim() || undefined, landlordName: name.trim() || undefined, landlordPhone: phone.trim() || undefined, landlordEmail: email.trim() || undefined });
    toast(t('info.saved'), { emoji: '🏠' });
  };
  return (
    <div class="screen">
      <TopBar title={t('info.title')} fallback="/wg" />
      <div class="overline">{t('info.address')}</div>
      <Field>
        <textarea class="textarea" style={{ minHeight: '76px' }} placeholder={t('settings.addressPlaceholder')} value={address} onInput={(e: any) => setAddress(e.target.value)} />
      </Field>
      <div class="overline">{t('info.landlord')}</div>
      <Field label={t('info.landlordName')}>
        <input class="input" value={name} onInput={(e: any) => setName(e.target.value)} />
      </Field>
      <div class="form-row">
        <Field label={t('info.landlordPhone')}>
          <input class="input" type="tel" value={phone} onInput={(e: any) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('info.landlordEmail')}>
          <input class="input" type="email" value={email} onInput={(e: any) => setEmail(e.target.value)} />
        </Field>
      </div>
      {hh.landlordPhone || hh.landlordEmail ? (
        <div class="form-row mb-12">
          {hh.landlordPhone ? (
            <Button icon="phone" onClick={() => (location.href = `tel:${hh.landlordPhone}`)}>
              {t('contract.phone')}
            </Button>
          ) : null}
          {hh.landlordEmail ? (
            <Button icon="mail" onClick={() => (location.href = `mailto:${hh.landlordEmail}`)}>
              {t('contract.email')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Button variant="primary" block disabled={!dirty} onClick={save}>
        {t('common.save')}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export function ActivityScreen() {
  const items = sortedActivity().slice(0, 150);
  if (prefs.activitySeenAt < (items[0]?.createdAt ?? 0)) setTimeout(() => setPrefs({ activitySeenAt: Date.now() }), 500);
  const groups = new Map<string, typeof items>();
  for (const a of items) {
    const d = new Date(a.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  return (
    <div class="screen">
      <TopBar title={t('activity.title')} fallback="/" />
      {items.length === 0 ? <Empty art="🔔" title={t('activity.emptyTitle')} sub={t('activity.emptySub')} /> : null}
      {[...groups.entries()].map(([day, acts]) => (
        <div key={day}>
          <div class="overline">{Math.abs(new Date(day).getTime() - Date.now()) < 7 * 86_400_000 ? relDay(day) : fmtDate(day, 'medium')}</div>
          <div class="list">
            {acts.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
