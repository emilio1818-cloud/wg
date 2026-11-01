/**
 * Site settings and the pages generated from them: config.js values, imprint and privacy
 * policy, Kündigungs-Vorlagen, sitemap, robots.txt, Android asset links.
 *
 * Settings live in site.config.json (committed, so a commit is enough to change them) and can
 * be overridden by environment variables for CI and Docker builds:
 *   NESTLY_SITE_URL, NESTLY_SERVER_URL, NESTLY_SYNC (1 = the build is served by a sync server),
 *   NESTLY_OPERATOR_NAME/_ADDRESS/_EMAIL/_PHONE, NESTLY_LEGAL_HOSTING, NESTLY_OFFERS (JSON),
 *   NESTLY_TIP_URL, NESTLY_GOOGLE_SITE_VERIFICATION, NESTLY_TWA_PACKAGE, NESTLY_TWA_SHA256.
 * Empty variables count as unset (GitHub Actions passes unset repository variables as '').
 */
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeOfferLinks } from '../core/src/offers.ts';
import { renderToolPages } from '../app/tools/render.mjs';

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** An absolute https URL, or '' (anything else fails the build: a broken link must not go live). */
function httpsUrl(value, name) {
  const v = (value ?? '').trim();
  if (!v) return '';
  let url;
  try {
    url = new URL(v);
  } catch {
    fail(`${name} is not a valid URL: ${v}`);
  }
  if (url.protocol !== 'https:') fail(`${name} must start with https:// (${v})`);
  return url.href;
}

/** Reads site.config.json and applies environment overrides. */
export function loadSettings(root, env = process.env) {
  let file = {};
  const configPath = path.join(root, 'site.config.json');
  if (fs.existsSync(configPath)) {
    try {
      file = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      fail(`site.config.json is not valid JSON: ${err.message}`);
    }
  }
  const pick = (envName, fileValue) => {
    const e = env[envName]?.trim();
    return e ? e : typeof fileValue === 'string' ? fileValue.trim() : '';
  };

  let offersInput = file.offers ?? {};
  if (env.NESTLY_OFFERS?.trim()) {
    try {
      offersInput = JSON.parse(env.NESTLY_OFFERS);
    } catch (err) {
      fail(`NESTLY_OFFERS is not valid JSON: ${err.message}`);
    }
  }
  const offers = sanitizeOfferLinks(offersInput);
  const dropped = Object.keys(offersInput ?? {}).filter((k) => !(k in offers));
  if (dropped.length) console.warn(`⚠ offers: ignored ${dropped.join(', ')} (unknown category or not an https link)`);

  let siteUrl = httpsUrl(pick('NESTLY_SITE_URL', file.siteUrl), 'siteUrl');
  if (siteUrl && !siteUrl.endsWith('/')) siteUrl += '/';
  const serverUrl = pick('NESTLY_SERVER_URL', file.serverUrl);
  const sha = env.NESTLY_TWA_SHA256?.trim() ? env.NESTLY_TWA_SHA256.split(',') : file.android?.sha256 ?? [];

  return {
    siteUrl,
    serverUrl,
    sync: !!serverUrl || env.NESTLY_SYNC === '1',
    operator: {
      name: pick('NESTLY_OPERATOR_NAME', file.operator?.name),
      address: pick('NESTLY_OPERATOR_ADDRESS', file.operator?.address),
      email: pick('NESTLY_OPERATOR_EMAIL', file.operator?.email),
      phone: pick('NESTLY_OPERATOR_PHONE', file.operator?.phone),
    },
    hosting: pick('NESTLY_LEGAL_HOSTING', file.hosting),
    offers,
    tipUrl: httpsUrl(pick('NESTLY_TIP_URL', file.tipUrl), 'tipUrl'),
    googleSiteVerification: pick('NESTLY_GOOGLE_SITE_VERIFICATION', file.googleSiteVerification).replace(/[^\w-]/g, ''),
    android: { package: pick('NESTLY_TWA_PACKAGE', file.android?.package), sha256: sha.map((f) => String(f).trim().toUpperCase()).filter(Boolean) },
  };
}

/** Multi-line value (newlines or " | ") → escaped HTML lines. */
const lines = (s) => s.split(/\r?\n|\s*\|\s*/).map((l) => escapeHtml(l.trim())).filter(Boolean).join('<br />');

/** Fills {{key}} (values are HTML) and <!--IF:flag-->…<!--END:flag--> blocks. */
export function fillTemplate(html, values, flags) {
  return html
    .replace(/<!--IF:(\w+)-->([\s\S]*?)<!--END:\1-->/g, (_, flag, body) => (flags[flag] ? body : ''))
    .replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}

/**
 * Imprint and privacy policy from app/legal/. Without name, address and e-mail nothing is
 * written: a placeholder imprint must never go live.
 */
function writeLegal(appDir, dist, s) {
  const { name, address, email, phone } = s.operator;
  if (!name || !address || !email) return false;
  const values = { name: escapeHtml(name), address: lines(address), email: escapeHtml(email), phone: escapeHtml(phone), hosting: lines(s.hosting), tipHost: s.tipUrl ? escapeHtml(new URL(s.tipUrl).host) : '' };
  const flags = { phone: !!phone, hosting: !!s.hosting, sync: s.sync, nosync: !s.sync, offers: Object.keys(s.offers).length > 0, tip: !!s.tipUrl };
  for (const file of ['impressum.html', 'datenschutz.html']) {
    fs.writeFileSync(path.join(dist, file), fillTemplate(fs.readFileSync(path.join(appDir, 'legal', file), 'utf8'), values, flags));
  }
  return true;
}

/** Digital Asset Links for the Play Store app (Trusted Web Activity), if configured. */
function writeAssetLinks(dist, s) {
  const { package: pkg, sha256 } = s.android;
  if (!pkg || !sha256.length) return;
  const bad = sha256.filter((f) => !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(pkg) || bad.length) fail(`Android package/fingerprint invalid (${bad.length ? 'fingerprint ' + bad.join(', ') : 'package ' + pkg})`);
  const links = [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: sha256 } }];
  fs.mkdirSync(path.join(dist, '.well-known'), { recursive: true });
  fs.writeFileSync(path.join(dist, '.well-known', 'assetlinks.json'), JSON.stringify(links, null, 2) + '\n');
}

/**
 * Writes everything derived from the settings into dist. Returns the config for config.js
 * and the meta tags for the head of index.html.
 */
export function writeSite(appDir, dist, s) {
  const legal = writeLegal(appDir, dist, s);
  // Partner links make the site commercial, which requires an imprint: without one they stay off.
  const hasOffers = legal && Object.keys(s.offers).length > 0;
  if (!legal && Object.keys(s.offers).length) console.warn('⚠ Partner links stay off until operator name, address and e-mail are set (imprint required)');
  writeAssetLinks(dist, s);

  const verification = s.googleSiteVerification ? `<meta name="google-site-verification" content="${s.googleSiteVerification}" />` : '';
  const pages = renderToolPages({
    offers: hasOffers ? s.offers : {},
    tipUrl: s.tipUrl,
    legal,
    siteUrl: s.siteUrl,
    headExtra: verification,
  });
  for (const [file, html] of Object.entries(pages)) {
    fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
    fs.writeFileSync(path.join(dist, file), html);
  }
  for (const asset of ['client.js', 'style.css']) fs.copyFileSync(path.join(appDir, 'tools', asset), path.join(dist, 'kuendigen', asset));

  if (s.siteUrl) {
    const urls = ['', ...Object.keys(pages).map((f) => f.replace(/index\.html$/, ''))];
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${escapeHtml(s.siteUrl + u)}</loc></url>`)
      .join('\n')}\n</urlset>\n`;
    fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);
    fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${s.siteUrl}sitemap.xml\n`);
  }

  return {
    config: {
      serverUrl: s.serverUrl || undefined,
      offers: hasOffers ? s.offers : undefined,
      legal: legal || undefined,
      tipUrl: s.tipUrl || undefined,
    },
    headExtra: verification,
  };
}
