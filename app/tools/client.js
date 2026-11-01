// Letter generator for the Kündigungs-Vorlagen pages. Reuses the app's letter (core/src/contracts.ts),
// compiled by the app build. Nothing leaves the browser.
import { cancellationLetter } from '../js/core/src/contracts.js';

const form = document.querySelector('.letter-form');
const out = document.getElementById('letter');

const pad = (n) => String(n).padStart(2, '0');
const isoToDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const now = new Date();
const todayDe = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;

function values() {
  const v = Object.fromEntries(new FormData(form));
  for (const k of Object.keys(v)) v[k] = String(v[k]).trim();
  return v;
}

function letter() {
  const v = values();
  return cancellationLetter({
    locale: 'de',
    holderName: v.name || '[Dein Name]',
    holderAddress: v.address || undefined,
    provider: v.provider || '[Anbieter]',
    contractName: form.dataset.contract,
    customerNumber: v.customer || undefined,
    contractNumber: v.contract || undefined,
    termEnd: isoToDe(v.end) || undefined,
    dateLine: `${v.city ? v.city + ', ' : ''}${todayDe}`,
  });
}

function render() {
  out.textContent = letter();
}

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = old), 1600);
}

async function copy(button) {
  try {
    await navigator.clipboard.writeText(letter());
    flash(button, 'Kopiert ✓');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(out);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    flash(button, 'Markiert – jetzt kopieren');
  }
}

function mail() {
  const v = values();
  const subject = `Kündigung ${form.dataset.contract}${v.customer ? ' – Kundennr. ' + v.customer : ''}`;
  location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(letter())}`;
}

if (form && out) {
  form.addEventListener('input', render);
  document.querySelector('.actions')?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    if (button.dataset.act === 'copy') copy(button);
    else if (button.dataset.act === 'mail') mail();
    else if (button.dataset.act === 'print') window.print();
  });
  render();
}
