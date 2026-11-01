/**
 * Renders the static Kündigungs-Vorlagen pages: /kuendigen/ and /kuendigen/<slug>/.
 * Pure HTML that works without JavaScript (search engines see all text); client.js adds the
 * letter generator. Everything typed into the form stays in the browser.
 */
import { FORM_NOTE, PAGES, UPDATED } from './content.mjs';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout({ title, description, canonical, root, assets, body, headExtra, legal }) {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    ${canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : ''}
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${root}icons/og-image.png" />
    <link rel="icon" href="${root}icons/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${assets}style.css" />
    ${headExtra ?? ''}
  </head>
  <body>
    <header class="top"><a class="brand" href="${root}"><img src="${root}icons/icon.svg" alt="" width="28" height="28" /> Nestly</a><a href="${assets}">Alle Vorlagen</a></header>
    <main>
${body}
    </main>
    <footer>
      <p>Diese Seite ersetzt keine Rechtsberatung. Angaben ohne Gewähr, Stand: ${UPDATED}.</p>
      <p><a href="${root}">Nestly – die App für WGs</a>${legal ? ` · <a href="${root}impressum.html">Impressum</a> · <a href="${root}datenschutz.html">Datenschutz</a>` : ''}</p>
    </footer>
  </body>
</html>
`;
}

function appCta(root) {
  return `      <section class="card cta">
        <h2>Nie wieder eine Frist verpassen</h2>
        <p>Nestly ist die kostenlose App für WGs: Verträge mit Kündigungsfristen und Erinnerungen, Fixkosten, geteilte Ausgaben und Putzplan – ohne Anmeldung, ohne Werbebanner.</p>
        <a class="btn primary" href="${root}">Nestly kostenlos öffnen</a>
      </section>`;
}

function tipBox(tipUrl) {
  if (!tipUrl) return '';
  return `      <p class="tip">Hat dir die Vorlage geholfen? Nestly ist kostenlos – über einen Kaffee freue ich mich trotzdem ☕ <a href="${esc(tipUrl)}" rel="noopener" target="_blank">Nestly unterstützen</a></p>`;
}

function offerBox(page, offers) {
  const href = page.offer.map((c) => offers[c]).find(Boolean);
  if (!href) return '';
  return `      <section class="card offer">
        <h2>${page.offerTitle}</h2>
        <p>${page.offerText}</p>
        <a class="btn" href="${esc(href)}" rel="sponsored noopener" target="_blank">Tarife vergleichen ↗</a>
        <p class="small">Anzeige · Partnerlink: Kommt darüber ein Vertrag zustande, erhalten wir ggf. eine Provision. Für dich ändert sich nichts, und es werden keine Daten aus diesem Formular übertragen.</p>
      </section>`;
}

function letterForm(page) {
  return `      <section class="card">
        <form class="letter-form" data-contract="${esc(page.contractName)}" autocomplete="on">
          <label>Dein Name <input name="name" autocomplete="name" placeholder="Vor- und Nachname" /></label>
          <label>Deine Adresse <textarea name="address" rows="2" autocomplete="street-address" placeholder="Straße Nr., PLZ Ort"></textarea></label>
          <label>Anbieter <textarea name="provider" rows="2" placeholder="Name und Adresse des Anbieters"></textarea></label>
          <div class="row2">
            <label>Kundennummer <input name="customer" /></label>
            <label>Vertragsnummer <input name="contract" /></label>
          </div>
          <div class="row2">
            <label>Kündigen zum <input type="date" name="end" /><small>leer lassen = nächstmöglicher Termin</small></label>
            <label>Dein Ort <input name="city" autocomplete="address-level2" /></label>
          </div>
        </form>
        <h2 class="letter-title">Dein Kündigungsschreiben</h2>
        <pre id="letter" class="letter" aria-live="polite">Bitte JavaScript aktivieren, um das Schreiben automatisch zu erstellen.</pre>
        <div class="actions">
          <button type="button" class="btn primary" data-act="copy">Kopieren</button>
          <button type="button" class="btn" data-act="mail">Als E-Mail</button>
          <button type="button" class="btn" data-act="print">Drucken / PDF</button>
        </div>
        <p class="small">Deine Eingaben bleiben in deinem Browser und werden nicht gespeichert oder übertragen.</p>
      </section>`;
}

function contractPage(page, opts) {
  const root = '../../';
  const rules = [...page.rules, FORM_NOTE].map((r) => `          <li>${r}</li>`).join('\n');
  const faq = page.faq.map(([q, a]) => `        <details><summary>${q}</summary><p>${a}</p></details>`).join('\n');
  const body = `      <h1>${page.h1}</h1>
      <p class="lead">Trag deine Daten ein – das Schreiben ist sofort fertig zum Kopieren, Mailen oder Drucken. Kostenlos und ohne Anmeldung.</p>
${offerBox(page, opts.offers)}
${letterForm(page)}
      <section>
        <h2>${page.rulesTitle}</h2>
        <ul class="rules">
${rules}
        </ul>
      </section>
      <section>
        <h2>Häufige Fragen</h2>
${faq}
      </section>
${appCta(root)}
${tipBox(opts.tipUrl)}
      <script type="module" src="../client.js"></script>`;
  return layout({
    title: page.title,
    description: page.description,
    canonical: opts.siteUrl ? `${opts.siteUrl}kuendigen/${page.slug}/` : '',
    root,
    assets: '../',
    body,
    headExtra: opts.headExtra,
    legal: opts.legal,
  });
}

function overviewPage(opts) {
  const root = '../';
  const cards = PAGES.map(
    (p) => `          <a class="card pick" href="${p.slug}/"><span class="e">${p.emoji}</span><span><strong>${p.label}</strong><br /><span class="small">${esc(p.contractName)} kündigen</span></span></a>`,
  ).join('\n');
  const body = `      <h1>Kündigen ohne Stress: kostenlose Vorlagen</h1>
      <p class="lead">Wähle deinen Vertrag, trag deine Daten ein, fertig. Zu jeder Vorlage findest du die wichtigsten Fristen und Sonderkündigungsrechte – verständlich und ohne Anmeldung.</p>
      <nav class="grid">
${cards}
      </nav>
${appCta(root)}
${tipBox(opts.tipUrl)}`;
  return layout({
    title: 'Kündigungsschreiben-Vorlagen – kostenlos & ohne Anmeldung | Nestly',
    description: 'Kostenlose Vorlagen zum Kündigen von Strom, Gas, Internet, Handy, Versicherung und Fitnessstudio – mit Fristen und Sonderkündigungsrechten einfach erklärt.',
    canonical: opts.siteUrl ? `${opts.siteUrl}kuendigen/` : '',
    root,
    assets: './',
    body,
    headExtra: opts.headExtra,
    legal: opts.legal,
  });
}

/**
 * @param {{ offers: Record<string, string>, tipUrl: string, legal: boolean, siteUrl: string, headExtra?: string }} opts
 * @returns {Record<string, string>} path inside dist → HTML
 */
export function renderToolPages(opts) {
  const out = { 'kuendigen/index.html': overviewPage(opts) };
  for (const page of PAGES) out[`kuendigen/${page.slug}/index.html`] = contractPage(page, opts);
  return out;
}
