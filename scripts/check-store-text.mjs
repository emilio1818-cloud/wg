#!/usr/bin/env node
/**
 * Checks the store texts in docs/store/*.md against the store character limits.
 * Texts are marked with <!-- store:<lang>:<field> --> … <!-- /store -->.
 * Usage: node scripts/check-store-text.mjs   (exit code 1 if a text is too long)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'store');
// Google Play: title 30, short description 80, full description 4000.
// App Store: name 30, subtitle 30, keywords 100, promotional text 170, description 4000.
const limits = { title: 30, short: 80, full: 4000, name: 30, subtitle: 30, keywords: 100, promo: 170, description: 4000 };

let failed = false;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const m of text.matchAll(/<!-- store:(\w+):(\w+) -->\n([\s\S]*?)\n<!-- \/store -->/g)) {
    const [, lang, field, body] = m;
    const length = [...body.trim()].length; // code points, as the stores count them
    const limit = limits[field];
    const ok = limit == null || length <= limit;
    if (!ok) failed = true;
    console.log(`${ok ? '✔' : '✖'} ${file} ${lang}:${field} ${length}${limit ? '/' + limit : ''}`);
  }
}
process.exit(failed ? 1 : 0);
