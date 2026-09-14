import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const src = new URL('../src/', import.meta.url);
const out = new URL('../dist/', import.meta.url);

const STATIC = ['index.html', 'learn.css', 'icon.svg', 'app.webmanifest'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of STATIC) copyFileSync(new URL(name, src), new URL(name, out));

// ---- scripts ---------------------------------------------------------------
// Plain concatenation, no source rewriting: an earlier build patched its own
// source through exact-string replacements, so editing a UI string broke it.
const read = (name) => readFileSync(new URL(name, src), 'utf8').trim();
writeFileSync(
  new URL('learn.js', out),
  `(()=>{\n${read('md5.js')}\n${read('learn.core.js')}\n${read('wrongbook-addon.js')}\n${read('mastered-addon.js')}\n${read('drills-addon.js')}\nLboot();\n})();\n`,
);
writeFileSync(new URL('store.js', out), `${read('store.js')}\n`);
writeFileSync(new URL('deck.js', out), `${read('deck.js')}\n`);

// No vocabulary is built into the app. The word list is imported by the person
// using it and lives in their browser's IndexedDB — see README.md.

// ---- service worker --------------------------------------------------------
// The cache name is derived from the content it caches, so a deploy can never
// leave a returning visitor pinned to stale JS. Nothing here is bumped by hand.
const shipped = [...STATIC, 'store.js', 'deck.js', 'learn.js'];
const fingerprint = createHash('sha256');
for (const name of shipped) fingerprint.update(readFileSync(new URL(name, out)));
const buildId = fingerprint.digest('hex').slice(0, 12);

const sw = read('sw.source.js')
  .replace('__BUILD_ID__', buildId)
  .replace('__ASSETS__', JSON.stringify(shipped.map((n) => `./${n}`)));
if (sw.includes('__BUILD_ID__') || sw.includes('__ASSETS__')) {
  throw new Error('Service worker build failed: placeholders not substituted');
}
writeFileSync(new URL('sw.js', out), sw);

console.log(`Built dist/ (build ${buildId}).`);
