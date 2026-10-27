/**
 * End-to-end tests: real server + real browser (Playwright/Chromium), two devices.
 * Requires a build (`npm run build`). Run with `npm run test:e2e`.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/src/app.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'app', 'dist');
const shots = process.env.E2E_SCREENSHOTS ? path.resolve(process.env.E2E_SCREENSHOTS) : null;

let app;
let base;
let browser;

async function device(locale = 'de-DE') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
}

async function snap(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(450); // let enter animations finish
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

before(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'run `npm run build` first');
  app = createApp({ dbPath: ':memory:', staticDir: dist, rateLimit: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await app?.close();
});

describe('Nestly end-to-end', () => {
  const state = {};

  it('creates a flat share through onboarding', async () => {
    const a = await device();
    state.a = a;
    const { page } = a;
    await page.goto(base + '?nosw');
    await page.getByRole('button', { name: 'Neue WG gründen' }).click();
    await page.getByPlaceholder('Dein Vorname').fill('Emil');
    await snap(page, 'onboarding-1-name');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByPlaceholder('z. B. WG Kastanienallee').fill('WG Sonnendeck');
    await snap(page, 'onboarding-2-wg');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await page.getByPlaceholder('Name eingeben').fill('Sophie');
    await page.keyboard.press('Enter');
    await page.getByPlaceholder('Name eingeben').fill('Ben');
    await page.keyboard.press('Enter');
    await snap(page, 'onboarding-3-roommates');
    await page.getByRole('button', { name: 'Weiter' }).click();
    await snap(page, 'onboarding-4-chores');
    await page.getByRole('button', { name: 'WG erstellen' }).click();
    await page.getByText('Willkommen zuhause!').waitFor();
    const code = (await page.locator('.kbd-code').first().textContent()).trim();
    assert.match(code, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    state.code = code;
    await snap(page, 'onboarding-5-invite');
    await page.getByRole('button', { name: 'Los geht’s' }).click();
    await page.getByText('Guten', { exact: false }).first().waitFor();
    await page.getByText('Emil 👋').waitFor();
  });

  it('lets a roommate join with the invite link and claim their profile', async () => {
    const b = await device();
    state.b = b;
    const { page } = b;
    await page.goto(`${base}?nosw#/join/${state.code.replace('-', '')}`);
    await page.getByText('WG Sonnendeck').waitFor();
    await page.locator('.row', { hasText: 'Sophie' }).click();
    await snap(page, 'join-1-who');
    await page.getByRole('button', { name: 'Beitreten' }).click();
    await page.getByText('Sophie 👋').waitFor();
    // Sophie now sees the chores Emil created during onboarding.
    await page.evaluate(() => (location.hash = '#/chores'));
    await page.getByText('Bad putzen').first().waitFor();
  });

  it('syncs a new expense to the other device in real time', async () => {
    const { page } = state.a;
    await page.evaluate(() => (location.hash = '#/money'));
    await page.locator('.fab').click();
    await page.locator('.amount-input input').fill('60');
    await page.getByPlaceholder('Wofür?').fill('Pizza-Abend');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await page.getByText('Ausgabe gespeichert').waitFor();

    const pb = state.b.page;
    await pb.evaluate(() => (location.hash = '#/money?tab=history'));
    await pb.getByText('Pizza-Abend').waitFor({ timeout: 10_000 });
    // 60 € split between 3 people: Sophie owes 20 €.
    await pb.evaluate(() => (location.hash = '#/'));
    await pb.getByText('Du schuldest noch').waitFor({ timeout: 10_000 });
    assert.match(await pb.locator('.hero .big').textContent(), /20,00/);
    await snap(pb, 'sync-1-home-b');
  });

  it('settles up and both devices agree everything is even', async () => {
    const pb = state.b.page;
    await pb.getByRole('button', { name: 'Begleichen' }).first().click();
    await pb.getByRole('button', { name: 'Als bezahlt markieren' }).click();
    await pb.getByText('Ausgeglichen! 🙌').waitFor();
    const pa = state.a.page;
    await pa.evaluate(() => (location.hash = '#/money'));
    // Ben (placeholder) still owes Emil 20 €; Sophie's debt is gone.
    await pa.locator('.list .row', { hasText: 'Ben → Du' }).waitFor({ timeout: 10_000 });
    await pa.locator('.list .row', { hasText: 'Sophie → Du' }).waitFor({ state: 'detached', timeout: 10_000 });
  });

  it('shares the shopping list, including items added while offline', async () => {
    const pb = state.b.page;
    await pb.evaluate(() => (location.hash = '#/shopping'));
    await pb.getByPlaceholder('Was fehlt?').fill('Hafermilch, 2x Nudeln');
    await pb.keyboard.press('Enter');
    await pb.getByText('Hafermilch').first().waitFor();

    const pa = state.a.page;
    await pa.evaluate(() => (location.hash = '#/shopping'));
    await pa.getByText('Hafermilch').waitFor({ timeout: 10_000 });
    await pa.getByText('Nudeln').waitFor();
    // Categorised automatically.
    await pa.getByText('Milch, Käse & Eier', { exact: false }).waitFor();

    await state.b.ctx.setOffline(true);
    await pb.getByPlaceholder('Was fehlt?').fill('Klopapier');
    await pb.keyboard.press('Enter');
    await pb.waitForTimeout(800);
    await state.b.ctx.setOffline(false);
    await pb.evaluate(() => window.dispatchEvent(new Event('online')));
    await pa.getByText('Klopapier').waitFor({ timeout: 15_000 });
    await snap(pa, 'sync-2-shopping-a');
  });

  it('completes a chore and awards points on both devices', async () => {
    const pa = state.a.page;
    await pa.evaluate(() => (location.hash = '#/chores'));
    const row = pa.locator('.list .row', { hasText: 'Küche putzen' }).first();
    await row.locator('.check').click();
    await pa.getByText('Stark! +30 Punkte').waitFor();
    await pa.locator('.seg button', { hasText: 'Rangliste' }).click();
    await pa.getByText('WG-Champion').waitFor();
    const pb = state.b.page;
    await pb.evaluate(() => (location.hash = '#/activity'));
    await pb.getByText('Emil hat „Küche putzen“ erledigt').waitFor({ timeout: 10_000 });
  });

  it('keeps data after a reload (persisted locally)', async () => {
    const pa = state.a.page;
    await pa.evaluate(() => (location.hash = '#/'));
    await pa.reload();
    await pa.getByText('Emil 👋').waitFor();
    await pa.evaluate(() => (location.hash = '#/money?tab=history'));
    await pa.getByText('Pizza-Abend').waitFor();
  });

  it('turns text shared from another app into shopping items', async () => {
    const pa = state.a.page;
    const shared = encodeURIComponent('Pfannkuchen\n- 2x Milch\n- Eier\n1. Mehl');
    await pa.goto(`${base}?nosw&share_text=${shared}#/`);
    const input = pa.locator('.sheet input.input');
    await input.waitFor();
    assert.equal(await input.inputValue(), 'Pfannkuchen, 2x Milch, Eier, Mehl');
    await pa.getByRole('button', { name: 'Hinzufügen' }).click();
    await pa.getByText('Mehl').waitFor();
    assert.ok(!(await pa.evaluate(() => location.search)).includes('share_text'));
  });

  it('had no runtime errors on either device', () => {
    assert.deepEqual(state.a.errors, []);
    assert.deepEqual(state.b.errors, []);
  });

  it('renders every screen of the demo without errors (English)', async () => {
    const d = await device('en-GB');
    await d.page.goto(base + '?nosw');
    await d.page.getByRole('button', { name: 'Just look around' }).click();
    await d.page.getByText('Alex 👋').waitFor();
    const routes = ['#/', '#/money', '#/money?tab=history', '#/money?tab=recurring', '#/money?tab=stats', '#/chores', '#/shopping', '#/wg', '#/wg/contracts', '#/wg/calendar', '#/wg/board', '#/wg/wifi', '#/wg/members', '#/wg/settings', '#/wg/info', '#/activity'];
    for (const r of routes) {
      await d.page.evaluate((h) => (location.hash = h), r);
      await d.page.waitForTimeout(250);
      const text = await d.page.locator('#app').innerText();
      assert.ok(text.length > 40, `route ${r} rendered content`);
    }
    // Calendar export produces a valid iCalendar file.
    await d.page.evaluate(() => (location.hash = '#/wg/calendar'));
    const [download] = await Promise.all([d.page.waitForEvent('download'), d.page.getByRole('button', { name: 'Export to calendar' }).click()]);
    assert.match(download.suggestedFilename(), /\.ics$/);
    const ics = fs.readFileSync(await download.path(), 'utf8');
    assert.match(ics, /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT[\s\S]*END:VCALENDAR/);
    assert.deepEqual(d.errors, []);
    await d.ctx.close();
  });
});
