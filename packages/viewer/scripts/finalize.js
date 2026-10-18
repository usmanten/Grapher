// Turns the built page into the template Grapher fills in. It computes a hash
// for each inline script and style so the page's Content Security Policy can
// allow exactly those and nothing else: no other script, no network access.
import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');

const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const bodies = (tag, skip) =>
  [...html.matchAll(new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)</${tag}>`, 'g'))]
    .filter((m) => !skip?.test(m[1]))
    .map((m) => m[2]);

const scripts = bodies('script', /type="application\/json"/).map(hash);
const styles = bodies('style').map(hash);
if (scripts.length === 0) throw new Error('No inline script found in the built page');

const csp = [
  "default-src 'none'",
  `script-src ${scripts.join(' ')}`,
  `style-src ${styles.join(' ')}`,
  'img-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const count = (s) => html.split(s).length - 1;
for (const placeholder of ['__GRAPHER_CSP__', '"__GRAPHER_DATA__"']) {
  if (count(placeholder) !== 1) throw new Error(`Expected ${placeholder} exactly once`);
}

await writeFile(
  new URL('template.html', dist),
  html.replace('__GRAPHER_CSP__', () => csp),
);
await rm(new URL('index.html', dist));
console.log(`Wrote dist/template.html (${scripts.length} script, ${styles.length} style hashes)`);
