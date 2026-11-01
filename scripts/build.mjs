#!/usr/bin/env node
/**
 * Builds the Nestly web app into app/dist:
 *   1. compiles TypeScript (app + core) to native ES modules with tsc,
 *   2. copies static assets,
 *   3. writes index.html with module preloads, config.js and a versioned service worker.
 *
 * Usage: node scripts/build.mjs [--watch]
 * Env (all optional):
 *   NESTLY_SERVER_URL        default sync server baked into config.js
 *   NESTLY_OFFERS            JSON object: contract category → https partner link for the
 *                            "Tarif-Check" (see docs/offers.example.json)
 *   NESTLY_OPERATOR_NAME     operator of the hosted service – together with ADDRESS and
 *   NESTLY_OPERATOR_ADDRESS  EMAIL this renders impressum.html and datenschutz.html from
 *   NESTLY_OPERATOR_EMAIL    app/legal/ and links them in the settings
 *   NESTLY_OPERATOR_PHONE    optional phone number for the imprint
 *   NESTLY_LEGAL_HOSTING     optional hosting provider (name and address) for the privacy policy
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeOfferLinks } from '../core/src/offers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');
const dist = path.join(app, 'dist');
const watch = process.argv.includes('--watch');

function findTsc() {
  const local = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  return fs.existsSync(local) ? local : 'tsc';
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Partner links for the Tarif-Check; invalid JSON fails the build instead of silently shipping without. */
function offerLinks() {
  const raw = process.env.NESTLY_OFFERS?.trim();
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`✖ NESTLY_OFFERS is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  const links = sanitizeOfferLinks(parsed);
  const dropped = Object.keys(parsed ?? {}).filter((k) => !(k in links));
  if (dropped.length) console.warn(`⚠ NESTLY_OFFERS: ignored ${dropped.join(', ')} (unknown category or not an https link)`);
  return links;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Renders the imprint and privacy policy from app/legal/ with the operator's details.
 * Without name, address and e-mail nothing is written: a placeholder imprint must never go live.
 * Template syntax: {{key}} (HTML-escaped), <!--IF:flag-->…<!--END:flag--> blocks.
 */
function renderLegal(hasOffers) {
  const env = process.env;
  const name = env.NESTLY_OPERATOR_NAME?.trim();
  const address = env.NESTLY_OPERATOR_ADDRESS?.trim();
  const email = env.NESTLY_OPERATOR_EMAIL?.trim();
  if (!name || !address || !email) return false;
  const lines = (s) => s.split(/\r?\n|\s*\|\s*/).map((l) => escapeHtml(l.trim())).filter(Boolean).join('<br />');
  const phone = env.NESTLY_OPERATOR_PHONE?.trim();
  const hosting = env.NESTLY_LEGAL_HOSTING?.trim();
  const values = { name: escapeHtml(name), address: lines(address), email: escapeHtml(email), phone: phone ? escapeHtml(phone) : '', hosting: hosting ? lines(hosting) : '' };
  const flags = { phone: !!phone, hosting: !!hosting, noHosting: !hosting, offers: hasOffers };
  for (const file of ['impressum.html', 'datenschutz.html']) {
    let html = fs.readFileSync(path.join(app, 'legal', file), 'utf8');
    html = html.replace(/<!--IF:(\w+)-->([\s\S]*?)<!--END:\1-->/g, (_, flag, body) => (flags[flag] ? body : ''));
    html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
    fs.writeFileSync(path.join(dist, file), html);
  }
  return true;
}

/** Copies assets and regenerates index.html, config.js and sw.js. */
function finalize() {
  copyDir(path.join(app, 'public'), dist);
  fs.copyFileSync(path.join(app, 'src', 'styles.css'), path.join(dist, 'styles.css'));
  const serverUrl = process.env.NESTLY_SERVER_URL || '';
  const offers = offerLinks();
  const legal = renderLegal(Object.keys(offers).length > 0);
  const config = { serverUrl: serverUrl || undefined, offers: Object.keys(offers).length ? offers : undefined, legal: legal || undefined };
  fs.writeFileSync(path.join(dist, 'config.js'), `window.NESTLY_CONFIG = ${JSON.stringify(config)};\n`);

  const files = walk(dist).filter((f) => f !== 'sw.js' && f !== 'index.html' && !f.endsWith('.map'));
  const hash = createHash('sha256');
  for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
  hash.update(fs.readFileSync(path.join(app, 'index.html')));
  const version = hash.digest('hex').slice(0, 10);

  const modules = files.filter((f) => f.startsWith('js/') && f.endsWith('.js'));
  const preload = modules.map((m) => `<link rel="modulepreload" href="${m}" />`).join('\n    ');
  const html = fs
    .readFileSync(path.join(app, 'index.html'), 'utf8')
    .replaceAll('__VERSION__', version)
    .replace('<!--MODULEPRELOAD-->', preload);
  fs.writeFileSync(path.join(dist, 'index.html'), html);

  const precache = ['./', 'index.html', ...files.filter((f) => !f.startsWith('icons/og-') && f !== '404.html' && f !== '.nojekyll')];
  const sw = fs.readFileSync(path.join(app, 'sw.js'), 'utf8').replaceAll('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 2));
  fs.writeFileSync(path.join(dist, 'sw.js'), sw);
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.writeFileSync(path.join(dist, '404.html'), html);
  return { version, modules: modules.length };
}

if (!watch) {
  fs.rmSync(dist, { recursive: true, force: true });
  const started = Date.now();
  const res = spawnSync(findTsc(), ['-p', path.join(app, 'tsconfig.json')], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error('✖ TypeScript compilation failed');
    process.exit(res.status ?? 1);
  }
  const { version, modules } = finalize();
  console.log(`✔ Built app/dist (${modules} modules, version ${version}) in ${Date.now() - started} ms`);
  if (!fs.existsSync(path.join(dist, 'impressum.html'))) {
    console.log('ℹ No imprint/privacy policy: set NESTLY_OPERATOR_NAME, _ADDRESS and _EMAIL before publishing (docs/LAUNCH.md)');
  }
} else {
  fs.mkdirSync(dist, { recursive: true });
  const tsc = spawn(findTsc(), ['-p', path.join(app, 'tsconfig.json'), '--watch', '--preserveWatchOutput'], { stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
  tsc.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (/Found 0 errors/.test(text)) {
      const { version } = finalize();
      console.log(`✔ app/dist updated (${version})`);
    }
  });
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { version } = finalize();
      console.log(`✔ assets updated (${version})`);
    }, 100);
  };
  fs.watch(path.join(app, 'src', 'styles.css'), refresh);
  fs.watch(path.join(app, 'public'), { recursive: true }, refresh);
  fs.watch(path.join(app, 'index.html'), refresh);
  fs.watch(path.join(app, 'legal'), refresh);
  process.on('SIGINT', () => {
    tsc.kill();
    process.exit(0);
  });
}
