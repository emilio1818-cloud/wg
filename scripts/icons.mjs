#!/usr/bin/env node
/** Renders PNG app icons and the social preview image from SVG using Playwright (dev only). */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'app', 'public', 'icons');

const glyph = (color = '#8a55f2') => `
  <path d="M24 7.5 8.5 19.2c-.95.72-1.5 1.84-1.5 3.03V37a4 4 0 0 0 4 4h26a4 4 0 0 0 4-4V22.23c0-1.19-.55-2.31-1.5-3.03L24 7.5Z" fill="#fff"/>
  <path d="M15.5 30.5c2.2 3.2 5.2 4.8 8.5 4.8s6.3-1.6 8.5-4.8" stroke="${color}" stroke-width="3.6" stroke-linecap="round" fill="none"/>
  <circle cx="18" cy="24.5" r="2.4" fill="${color}"/>
  <circle cx="30" cy="24.5" r="2.4" fill="${color}"/>`;

const gradient = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7357ff"/><stop offset="0.48" stop-color="#a64ff0"/><stop offset="1" stop-color="#ff6a88"/></linearGradient></defs>`;

/** Square icon; `inset` shrinks the glyph (maskable icons need a safe zone), `radius` rounds the corners. */
function iconSvg({ radius = 0, inset = 0.125 } = {}) {
  const scale = (512 * (1 - inset * 2)) / 48;
  const offset = 512 * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${gradient}
    <clipPath id="c"><rect width="512" height="512" rx="${radius}"/></clipPath>
    <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
    <circle cx="420" cy="80" r="150" fill="#fff" opacity="0.12" clip-path="url(#c)"/>
    <g transform="translate(${offset} ${offset - 4}) scale(${scale})">${glyph()}</g></svg>`;
}

const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g>${glyph('#000')}</g></svg>`;

const ogHtml = `<!doctype html><html><head><style>
  body{margin:0;width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box;
  font-family:ui-rounded,'SF Pro Rounded',system-ui,sans-serif;color:#fff;
  background:radial-gradient(700px 400px at 90% 0%,rgba(255,255,255,.18),transparent 60%),linear-gradient(135deg,#7357ff 0%,#a64ff0 48%,#ff6a88 100%)}
  h1{font-size:96px;margin:0;letter-spacing:-4px;font-weight:850}
  p{font-size:36px;margin:12px 0 0;opacity:.92;font-weight:600;line-height:1.25;max-width:620px}
  .row{display:flex;gap:14px;margin-top:34px;font-size:30px}
  .row span{background:rgba(255,255,255,.2);padding:10px 18px;border-radius:18px}
  </style></head><body>
  <svg width="260" height="260" viewBox="0 0 512 512">${iconSvg({ radius: 116 }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>
  <div><h1>Nestly</h1><p>Die App für eure WG. Geld, Putzplan, Einkauf &amp; Verträge – an einem Ort.</p>
  <div class="row"><span>💸 Splitten</span><span>✨ Putzplan</span><span>🛒 Einkauf</span></div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, size, file, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: transparent });
}

fs.mkdirSync(out, { recursive: true });
await render(iconSvg({ radius: 0 }), 192, 'icon-192.png');
await render(iconSvg({ radius: 0 }), 512, 'icon-512.png');
await render(iconSvg({ radius: 0, inset: 0.2 }), 512, 'maskable-512.png');
await render(iconSvg({ radius: 0 }), 180, 'apple-touch-icon.png');
await render(iconSvg({ radius: 110 }), 32, 'favicon-32.png', true);
await render(badgeSvg, 96, 'badge-96.png', true);
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogHtml);
await page.screenshot({ path: path.join(out, 'og-image.png') });
await browser.close();
console.log('✔ Icons written to app/public/icons');
