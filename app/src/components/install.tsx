import { h } from '../lib/ui.ts';
import { openSheet } from '../lib/router.ts';
import { t } from '../i18n/index.ts';
import { canInstall, hasNativePrompt, promptInstall } from '../state/install.ts';
import { prefs, setPrefs } from '../state/prefs.ts';
import { Button, Icon, IconButton } from './core.tsx';
import { Sheet } from './overlays.tsx';
import { LogoGlyph } from './brand.tsx';

/** Opens the native install prompt, or step-by-step instructions on iOS. */
export function openInstall(): void {
  if (hasNativePrompt()) {
    void promptInstall();
    return;
  }
  openSheet(() => (
    <Sheet title={t('install.title')}>
      <div class="list">
        {[t('install.iosStep1'), t('install.iosStep2'), t('install.iosStep3')].map((step, i) => (
          <div key={i} class="row">
            <span class="tile" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: 800, fontSize: '17px' }}>
              {i === 0 ? <Icon name="share" size={20} /> : i === 1 ? <Icon name="plus" size={20} /> : '✓'}
            </span>
            <div class="main">
              <div class="title" style={{ whiteSpace: 'normal' }}>{step}</div>
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  ));
}

/** Dismissible home-screen banner inviting the user to install the PWA. */
export function InstallBanner() {
  if (!canInstall() || prefs.dismissed.includes('install')) return null;
  return (
    <div class="banner mt-16">
      <span class="logo-mark" style={{ width: '44px', height: '44px', borderRadius: '14px', animation: 'none', boxShadow: 'none', flexShrink: 0 }}>
        <LogoGlyph size={26} />
      </span>
      <div class="b-main">
        <div class="b-title">{t('install.title')}</div>
        <div class="b-sub">{t('install.sub')}</div>
      </div>
      <Button size="sm" variant="primary" onClick={openInstall}>
        {t('install.cta')}
      </Button>
      <IconButton icon="x" label={t('common.close')} variant="plain" size={17} onClick={() => setPrefs({ dismissed: [...prefs.dismissed, 'install'] })} />
    </div>
  );
}
