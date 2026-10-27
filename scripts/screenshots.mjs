#!/usr/bin/env node
/**
 * Captures store/README screenshots of the demo flat (light + dark).
 * Usage: npm run build && node scripts/screenshots.mjs [outDir] [locale]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/src/app.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'screenshots'));
const locale = process.argv[3] ?? 'de-DE';
fs.mkdirSync(out, { recursive: true });

const app = createApp({ dbPath: ':memory:', staticDir: path.join(root, 'app', 'dist'), rateLimit: false });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}/`;
const browser = await chromium.launch();

const shots = [
  { name: 'home', hash: '#/' },
  { name: 'money', hash: '#/money' },
  { name: 'chores', hash: '#/chores' },
  { name: 'ranking', hash: '#/chores', click: '.seg button:nth-child(3)' },
  { name: 'shopping', hash: '#/shopping' },
  { name: 'contracts', hash: '#/wg/contracts' },
  { name: 'contract', hash: '#/wg/contracts', click: '.list .row' },
  { name: 'calendar', hash: '#/wg/calendar' },
  { name: 'board', hash: '#/wg/board' },
  { name: 'flat', hash: '#/wg' },
];

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(base + '?nosw');
  if (scheme === 'light') await page.screenshot({ path: path.join(out, `welcome-${scheme}.jpg`), type: 'jpeg', quality: 90 });
  await page.locator('.welcome .btn.ghost').click();
  await page.waitForTimeout(600);
  // Hide the demo banner for clean marketing shots.
  await page.addStyleTag({ content: '.banner.info.mb-12{display:none!important}' });
  for (const s of shots) {
    await page.evaluate((h) => (location.hash = h), s.hash);
    await page.waitForTimeout(500);
    if (s.click) {
      await page.locator(s.click).first().click();
      await page.waitForTimeout(600);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, `${s.name}-${scheme}.jpg`), type: 'jpeg', quality: 90 });
  }
  await ctx.close();
}

await browser.close();
await app.close();
console.log(`✔ Screenshots written to ${path.relative(root, out)}`);
