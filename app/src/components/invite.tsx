import { h, Fragment, useState } from '../lib/ui.ts';
import { formatInviteCode } from '../../../core/src/ids.ts';
import { t } from '../i18n/index.ts';
import * as api from '../state/api.ts';
import { goCloud } from '../state/actions.ts';
import { household } from '../state/selectors.ts';
import { prefs } from '../state/prefs.ts';
import { setSession, store } from '../state/store.ts';
import { QrCode } from './charts.tsx';
import { Button, Field, Icon } from './core.tsx';
import { copyText, shareText, toast } from './overlays.tsx';

void Fragment;

export function inviteLink(code: string): string {
  const base = location.href.split('#')[0]!.replace(/\?.*$/, '');
  return `${base}#/join/${code}`;
}

/** Invite code, QR and share actions — or the "connect a sync server" form in local mode. */
export function InvitePanel() {
  const s = store.session;
  const hh = household();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState(prefs.serverUrl ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!s || !hh) return null;

  if (s.mode === 'demo') {
    return (
      <div class="banner info">
        <span class="b-emoji">
          <Icon name="info" size={20} />
        </span>
        <div class="b-main">{t('invite.demo')}</div>
      </div>
    );
  }

  if (s.mode === 'local' || !s.inviteCode) {
    const connect = async () => {
      setBusy(true);
      setError(null);
      try {
        const target = url.trim() ? url.trim().replace(/\/+$/, '') : undefined;
        const ok = await goCloud(target ? (/^https?:\/\//.test(target) ? target : 'https://' + target) : undefined);
        if (!ok) setError(t('invite.connectFailed'));
      } catch {
        setError(t('invite.connectFailed'));
      } finally {
        setBusy(false);
      }
    };
    return (
      <div class="card pad-lg">
        <div class="hstack" style={{ marginBottom: '10px' }}>
          <span class="tile" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            <Icon name="cloud" />
          </span>
          <div class="grow">
            <div style={{ fontWeight: 650, fontSize: '17px' }}>{t('invite.localTitle')}</div>
          </div>
        </div>
        <p class="muted" style={{ margin: '0 0 14px', fontSize: '14.5px' }}>
          {t('invite.localSub')}
        </p>
        <Field label={t('invite.serverUrl')} error={error}>
          <input class="input" type="url" inputMode="url" placeholder="https://nestly.example.com" value={url} onInput={(e: any) => setUrl(e.target.value)} autoComplete="url" />
        </Field>
        <Button variant="primary" block disabled={busy} onClick={connect} icon="link">
          {busy ? t('invite.connecting') : t('invite.connect')}
        </Button>
      </div>
    );
  }

  const code = s.inviteCode;
  const link = inviteLink(code);
  const message = t('invite.message', { name: hh.name, link, code: formatInviteCode(code) });

  const rotate = async () => {
    if (!s.serverUrl || !s.token) return;
    try {
      const res = await api.rotateInvite(s.serverUrl, s.householdId, s.token);
      setSession({ inviteCode: res.inviteCode });
      toast(t('invite.rotated'));
    } catch {
      toast(t('error.network'));
    }
  };

  return (
    <div class="center">
      <div class="qr-box">
        <QrCode text={link} size={196} />
      </div>
      <div class="caption" style={{ marginTop: '10px' }}>
        {t('invite.scan')}
      </div>
      <div class="overline" style={{ marginTop: '22px' }}>
        {t('invite.code')}
      </div>
      <button type="button" class="kbd-code" style={{ fontSize: '34px', color: 'var(--text)' }} onClick={() => copyText(formatInviteCode(code))}>
        {formatInviteCode(code)}
      </button>
      <div class="stack mt-24" style={{ textAlign: 'left' }}>
        <Button variant="primary" block icon="share" onClick={() => shareText(message, 'Nestly', link)}>
          {t('invite.share')}
        </Button>
        <div class="form-row">
          <Button block icon="link" onClick={() => copyText(link)}>
            {t('invite.copyLink')}
          </Button>
          <Button block icon="send" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener')}>
            {t('invite.whatsapp')}
          </Button>
        </div>
        <Button variant="ghost" block size="md" icon="refresh" onClick={rotate}>
          {t('invite.rotate')}
        </Button>
      </div>
    </div>
  );
}
