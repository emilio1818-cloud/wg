#!/usr/bin/env node
/**
 * Renders the Google Play feature graphic (1024 × 500) from the logo and the app screenshots.
 * Usage: node scripts/feature-graphic.mjs [de|en]   → docs/store/feature-graphic[-en].png
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lang = process.argv[2] === 'en' ? 'en' : 'de';

const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(root, file)).toString('base64')}`;
const logo = dataUrl('app/public/icons/icon.svg', 'image/svg+xml');
const shots = ['home-light.jpg', 'money-light.jpg'].map((f) => dataUrl(`docs/screenshots/${f}`, 'image/jpeg'));
const text =
  lang === 'de'
    ? { title: 'Die App für eure WG', sub: 'Geld teilen, Putzplan, Einkauf und Verträge – an einem Ort.', badge: 'Kostenlos · ohne Limit · ohne Tracker' }
    : { title: 'The app for your flatshare', sub: 'Split bills, chores, shopping and contracts – in one place.', badge: 'Free · unlimited · no trackers' };

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1024px; height: 500px; overflow: hidden; font-family: Inter, system-ui, sans-serif; color: #fff;
    background: linear-gradient(135deg, #7357ff 0%, #a64ff0 48%, #ff6a88 100%); position: relative; }
  .glow { position: absolute; width: 520px; height: 520px; border-radius: 50%; background: rgba(255,255,255,.12); right: -120px; top: -220px; }
  .copy { position: absolute; left: 64px; top: 0; bottom: 0; width: 480px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
  .brand img { width: 64px; height: 64px; border-radius: 16px; box-shadow: 0 8px 24px rgba(40,10,90,.25); }
  .brand span { font: 700 34px/1 'Inter Display', Inter, sans-serif; letter-spacing: -0.02em; }
  h1 { font: 800 48px/1.05 'Inter Display', Inter, sans-serif; letter-spacing: -0.03em; }
  p { font-size: 21px; line-height: 1.4; margin-top: 16px; opacity: .92; }
  .badge { margin-top: 26px; align-self: flex-start; padding: 9px 16px; border-radius: 999px; background: rgba(255,255,255,.18); font-weight: 600; font-size: 16px; }
  .phone { position: absolute; width: 230px; border-radius: 30px; overflow: hidden; border: 6px solid #15121f; box-shadow: 0 24px 60px rgba(30,5,70,.35); background: #15121f; }
  .phone img { display: block; width: 100%; }
  .p1 { left: 580px; top: 58px; transform: rotate(-4deg); }
  .p2 { left: 770px; top: 96px; transform: rotate(5deg); }
</style></head><body>
  <div class="glow"></div>
  <div class="copy">
    <div class="brand"><img src="${logo}" alt=""><span>Nestly</span></div>
    <h1>${text.title}</h1>
    <p>${text.sub}</p>
    <div class="badge">${text.badge}</div>
  </div>
  <div class="phone p1"><img src="${shots[0]}" alt=""></div>
  <div class="phone p2"><img src="${shots[1]}" alt=""></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
const out = path.join(root, 'docs', 'store', lang === 'de' ? 'feature-graphic.png' : 'feature-graphic-en.png');
await page.screenshot({ path: out });
await browser.close();
console.log(`✔ ${path.relative(root, out)}`);
