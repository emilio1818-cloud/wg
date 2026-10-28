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
import http from 'node:http';
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
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

/* A fake push service that records Web Push deliveries. */
const pushInbox = [];
let pushService;
let pushPort;

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** RFC 8291 receiver side: decrypts an aes128gcm Web Push body. */
function decryptPush(body, ecdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverKey = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const prkKey = hmac(authSecret, ecdh.computeSecret(serverKey));
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo).subarray(0, 32);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([decipher.update(ct.subarray(0, ct.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

before(async () => {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'run `npm run build` first');
  pushService = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      pushInbox.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201).end();
    });
  });
  await new Promise((resolve) => pushService.listen(0, '127.0.0.1', resolve));
  pushPort = pushService.address().port;
  app = createApp({ dbPath: ':memory:', staticDir: dist, rateLimit: false, reminders: false });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await app?.close();
  pushService?.close();
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
    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
    await page.getByPlaceholder('z. B. WG Kastanienallee').fill('WG Sonnendeck');
    await snap(page, 'onboarding-2-wg');
    await page.getByRole('button', { name: 'WG erstellen' }).click();
    await page.getByText('Willkommen zuhause!').waitFor();
    await snap(page, 'onboarding-3-intro');
    await page.getByRole('button', { name: 'Setup starten' }).click();

    // Setup assistant: flat → roommates → costs → chores → lists → Wi-Fi → summary.
    const next = () => page.getByRole('button', { name: 'Weiter', exact: true }).click();
    await page.getByText('Eure Wohnung').waitFor();
    await page.getByLabel('Adresse').fill('Sonnenallee 12, 12045 Berlin');
    await next();
    await page.getByText('Wer wohnt bei euch?').waitFor();
    await page.getByPlaceholder('Name eingeben').fill('Sophie');
    await page.keyboard.press('Enter');
    await page.getByPlaceholder('Name eingeben').fill('Ben');
    await page.keyboard.press('Enter');
    await page.locator('.row', { hasText: 'Ben' }).waitFor();
    const code = (await page.locator('.kbd-code').first().textContent()).trim();
    assert.match(code, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    state.code = code;
    await snap(page, 'setup-2-members');
    await next();
    await page.getByText('Miete & Fixkosten').waitFor();
    // Turning a cost on without an amount is caught before moving on.
    await page.getByRole('button', { name: /Strom/ }).click();
    await next();
    await page.getByText('Betrag fehlt').waitFor();
    await page.getByRole('button', { name: /Strom/ }).click();
    await snap(page, 'setup-3-costs');
    await page.getByRole('button', { name: 'Überspringen' }).click();
    await page.getByText('Euer Putzplan').waitFor();
    await snap(page, 'setup-4-chores');
    await next();
    await page.getByText('Einkaufslisten').first().waitFor();
    await page.getByRole('button', { name: /Getränke/ }).click();
    await next();
    await page.getByText('WLAN für Gäste').waitFor();
    await page.getByLabel('Netzwerkname (SSID)').fill('Sonnendeck');
    await page.getByLabel('Passwort').fill('kaffee-und-kuchen');
    await next();
    await page.getByText('Alles startklar').waitFor();
    await page.getByText('3 Personen in der WG').waitFor();
    await page.getByText('4 Aufgaben im Putzplan').waitFor();
    await page.getByText('3 Einkaufslisten').waitFor();
    await snap(page, 'setup-7-done');
    await page.getByRole('button', { name: 'Zur WG' }).click();
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
    await pb.locator('.toast', { hasText: 'Ausgeglichen' }).waitFor();
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

  it('notifies roommates via Web Push', async () => {
    // The browser's push service is faked: the subscription points at our local inbox.
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const authSecret = randomBytes(16);
    const sub = { endpoint: `http://127.0.0.1:${pushPort}/push/sophie`, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) };
    const { ctx, page: pb } = state.b;
    await ctx.grantPermissions(['notifications']);
    await ctx.addInitScript((s) => {
      let key = null;
      const subscription = {
        endpoint: s.endpoint,
        get options() {
          return { applicationServerKey: key };
        },
        toJSON: () => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }),
        unsubscribe: async () => true,
      };
      const pushManager = {
        getSubscription: async () => (key ? subscription : null),
        subscribe: async (opts) => {
          key = opts.applicationServerKey.buffer.slice(0);
          return subscription;
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }), register: async () => ({}) } });
    }, sub);
    await pb.reload();
    await pb.evaluate(() => (location.hash = '#/wg/settings'));
    await pb.getByRole('switch', { name: 'Benachrichtigungen' }).click();
    await pb.getByText('Benachrichtigungen sind an').waitFor();

    const pa = state.a.page;
    await pa.evaluate(() => (location.hash = '#/money'));
    await pa.locator('.fab').click();
    await pa.locator('.amount-input input').fill('18');
    await pa.getByPlaceholder('Wofür?').fill('Kinoabend');
    await pa.getByRole('button', { name: 'Speichern' }).click();

    const deadline = Date.now() + 10_000;
    while (!pushInbox.some((m) => m.url === '/push/sophie') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const msg = pushInbox.find((m) => m.url === '/push/sophie');
    assert.ok(msg, 'push delivered to the fake push service');
    assert.equal(msg.headers['content-encoding'], 'aes128gcm');
    assert.match(msg.headers.authorization, /^vapid t=.+, k=.+$/);
    const payload = decryptPush(msg.body, ecdh, authSecret);
    assert.match(payload.title, /WG Sonnendeck/);
    assert.match(payload.body, /Emil/);
    assert.match(payload.body, /Kinoabend/);
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

  it('brings the linked fixed cost back when deleting a contract is undone', async () => {
    const d = await device();
    const { page } = d;
    await page.goto(base + '?nosw');
    await page.getByRole('button', { name: 'Erstmal umschauen' }).click();
    await page.getByText('Alex 👋').waitFor();
    const stromCost = () => page.locator('.list .row', { hasText: 'Strom' }).first();

    await page.evaluate(() => (location.hash = '#/wg/contracts'));
    await page.locator('.list .row', { hasText: 'Stadtwerke Berlin' }).click();
    await page.getByRole('button', { name: 'Löschen' }).click();
    await page.locator('.dialog .btn.danger').click();
    await page.locator('.toast', { hasText: 'Vertrag gelöscht' }).waitFor();

    // Deleting the contract pauses its fixed cost …
    await page.evaluate(() => (location.hash = '#/money?tab=recurring'));
    await stromCost().getByText('Pausiert').waitFor();
    // … and undoing brings both back.
    await page.locator('.toast').getByRole('button', { name: 'Rückgängig' }).click();
    await stromCost().getByText('Nächste Buchung', { exact: false }).waitFor();
    await page.evaluate(() => (location.hash = '#/wg/contracts'));
    await page.locator('.list .row', { hasText: 'Stadtwerke Berlin' }).waitFor();

    // The floating action button stays in view on long screens (it used to sit at the end of the page).
    await page.evaluate(() => (location.hash = '#/wg/calendar'));
    await page.locator('.fab').waitFor();
    await page.waitForTimeout(400);
    const fab = await page.locator('.fab').boundingBox();
    assert.ok(fab && fab.y + fab.height <= 844, `FAB visible (bottom at ${fab && fab.y + fab.height})`);
    assert.deepEqual(d.errors, []);
    await d.ctx.close();
  });
});
