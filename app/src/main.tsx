import { h, render, scheduleRender, useLayoutEffect, useRef } from './lib/ui.ts';
import { getRoute, navDirection, navigate, sheets } from './lib/router.ts';
import { t } from './i18n/index.ts';
import { setCurrency } from './i18n/format.ts';
import { applyTheme } from './state/prefs.ts';
import { applyLanguage } from './state/locale.ts';
import { LogoGlyph } from './components/brand.tsx';
import { loadPersisted, store, update } from './state/store.ts';
import { startSync, setActivityDescriber, onAfterSync } from './state/sync.ts';
import { bookDueRecurring, localTimezone } from './state/actions.ts';
import { refreshPush } from './state/push.ts';
import { household } from './state/selectors.ts';
import { cx, Icon } from './components/core.tsx';
import type { IconName } from './lib/icons.ts';
import { SheetHost, ToastHost } from './components/overlays.tsx';
import { describeActivity } from './components/activity.tsx';
import { activeItemsCount } from './state/selectors.ts';
import { Welcome, CreateFlow, JoinFlow } from './screens/onboarding.tsx';
import { Home } from './screens/home.tsx';
import { Money } from './screens/money.tsx';
import { Chores } from './screens/chores.tsx';
import { Shopping } from './screens/shopping.tsx';
import { WgHub, WifiScreen, InfoScreen, ActivityScreen } from './screens/wg.tsx';
import { Contracts, ContractDetail } from './screens/contracts.tsx';
import { CalendarScreen } from './screens/calendar.tsx';
import { Board } from './screens/board.tsx';
import { Members, MemberDetail } from './screens/members.tsx';
import { Settings } from './screens/settings.tsx';
import { SetupWizard } from './screens/setup.tsx';
import { choresDueForMe } from './screens/chores.tsx';
import { openQuickAdd } from './screens/shopping.tsx';

const TABS: { path: string; label: () => string; icon: IconName }[] = [
  { path: '/', label: () => t('tab.home'), icon: 'home' },
  { path: '/money', label: () => t('tab.money'), icon: 'wallet' },
  { path: '/chores', label: () => t('tab.chores'), icon: 'sparkles' },
  { path: '/shopping', label: () => t('tab.shopping'), icon: 'cart' },
  { path: '/wg', label: () => t('tab.wg'), icon: 'grid' },
];

function tabOf(path: string): string {
  const first = '/' + (path.split('/')[1] ?? '');
  if (first === '/activity') return '/';
  return TABS.some((t) => t.path === first) ? first : '/';
}

function TabBar(props: { path: string }) {
  const active = tabOf(props.path);
  const badges: Record<string, number> = {
    '/chores': choresDueForMe().length,
    '/shopping': activeItemsCount(),
  };
  return (
    <nav class="tabbar">
      {TABS.map((tab) => (
        <button
          key={tab.path}
          type="button"
          class={tab.path === active ? 'active' : ''}
          aria-current={tab.path === active ? 'page' : undefined}
          onClick={() => {
            if (tab.path === active && props.path !== tab.path) navigate(tab.path, { replace: true, fade: true });
            else if (tab.path === active) window.scrollTo({ top: 0, behavior: 'smooth' });
            else navigate(tab.path, { replace: true, fade: true });
          }}
        >
          <span class="ico">
            <Icon name={tab.icon} size={22} stroke={tab.path === active ? 2.4 : 2} />
          </span>
          {tab.label()}
          {badges[tab.path] ? <span class="tab-badge">{badges[tab.path]! > 99 ? '99+' : badges[tab.path]}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function routeScreen(segments: string[]) {
  const [a, b, c] = segments;
  switch (a) {
    case undefined:
    case 'home':
      return <Home />;
    case 'money':
      return <Money />;
    case 'chores':
      return <Chores />;
    case 'shopping':
      return <Shopping listId={b} />;
    case 'activity':
      return <ActivityScreen />;
    case 'wg':
      switch (b) {
        case undefined:
          return <WgHub />;
        case 'contracts':
          return c ? <ContractDetail id={c} /> : <Contracts />;
        case 'calendar':
          return <CalendarScreen />;
        case 'board':
          return <Board />;
        case 'wifi':
          return <WifiScreen />;
        case 'info':
          return <InfoScreen />;
        case 'members':
          return c ? <MemberDetail id={c} /> : <Members />;
        case 'settings':
          return <Settings />;
      }
  }
  return <Home />;
}

const scrollPositions = new Map<string, number>();

/** Mirrors open work on the installed app icon (Badging API). */
function updateAppBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => {});
}

/** Text shared into Nestly from another app (Web Share Target) becomes shopping items. */
function consumeSharedText(): void {
  const params = new URLSearchParams(location.search);
  const text = [params.get('share_title'), params.get('share_text')].filter(Boolean).join('\n').trim();
  if (!text) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (!store.session) return;
  const items = text
    .split(/\n|,|;|•/)
    .map((l) => l.replace(/^\s*(?:[-*–·•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && l.length < 60 && !/^https?:/i.test(l));
  navigate('/shopping', { replace: true });
  setTimeout(() => openQuickAdd(items.join(', ')), 300);
}

function App() {
  const route = getRoute();
  const lastPath = useRef(route.path);
  const hh = household();
  if (hh) setCurrency(hh.currency);

  useLayoutEffect(() => {
    if (lastPath.current === route.path) return;
    scrollPositions.set(lastPath.current, window.scrollY);
    lastPath.current = route.path;
    const y = navDirection() === 'back' ? (scrollPositions.get(route.path) ?? 0) : 0;
    window.scrollTo(0, y);
  }, [route.path]);

  useLayoutEffect(() => {
    updateAppBadge(store.session ? choresDueForMe().length : 0);
  });

  if (!store.loaded) {
    return (
      <div class="splash">
        <div class="logo-mark">
          <LogoGlyph size={46} />
        </div>
      </div>
    );
  }

  const [first, code] = route.segments;
  const session = store.session;
  let content;
  let withTabs = false;
  if (first === 'join') content = <JoinFlow code={code} />;
  else if (!session || first === 'welcome' || first === 'create') {
    content = first === 'create' ? <CreateFlow /> : <Welcome />;
  } else if (first === 'setup') {
    content = <SetupWizard step={code} />;
  } else {
    content = routeScreen(route.segments);
    withTabs = true;
  }
  const dir = navDirection();
  return (
    <div>
      <div key={route.path} class={cx(dir === 'back' ? 'screen-back' : dir === 'forward' ? 'screen-enter' : 'fade-in')}>
        {content}
      </div>
      {withTabs ? <TabBar path={route.path} /> : null}
      <ToastHost withTabs={withTabs && sheets.length === 0} />
      <SheetHost />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot(): Promise<void> {
  applyLanguage();
  applyTheme();
  setActivityDescriber(describeActivity);
  render(<App />, document.getElementById('app')!);
  await loadPersisted();
  document.getElementById('boot-splash')?.remove();
  if (store.session) {
    bookDueRecurring();
    startSync();
    void refreshPush();
    const hh = household();
    if (hh && !hh.timezone && store.session.mode !== 'demo') update('household', hh.id, { timezone: localTimezone() });
  }
  onAfterSync(() => bookDueRecurring());
  consumeSharedText();
  // Re-check recurring bookings when the app comes back the next day.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (store.session) bookDueRecurring();
    scheduleRender(); // relative dates ("heute", "morgen") may have changed
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]nosw/.test(location.search)) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support unavailable */
    });
  }
}

void boot();
