import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const src = new URL('../src/', import.meta.url);
const data = new URL('./data/', src);
const out = new URL('../dist/', import.meta.url);

const MIN_TOTAL = 4000;
const ZH_PARTS = [
  { file: 'zh-a1-1-6.json', level: 'A1', chapters: [1, 6], count: 1076 },
  { file: 'zh-a1-7-12.json', level: 'A1', chapters: [7, 12], count: 888 },
  { file: 'zh-a2-1-6.json', level: 'A2', chapters: [1, 6], count: 685 },
  { file: 'zh-a2-7-12.json', level: 'A2', chapters: [7, 12], count: 797 },
];
const STATIC = ['index.html', 'learn.css', 'icon.svg', 'app.webmanifest'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of STATIC) copyFileSync(new URL(name, src), new URL(name, out));

// ---- card rows -------------------------------------------------------------
const parts = Array.from({ length: 8 }, (_, i) =>
  readFileSync(new URL(`cards-mini-${String(i).padStart(2, '0')}.txt`, data), 'utf8').trim(),
);
const rows = JSON.parse(gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8'));
if (!Array.isArray(rows) || rows.length < MIN_TOTAL) {
  throw new Error(`Vocabulary build failed: expected at least ${MIN_TOTAL} rows, got ${Array.isArray(rows) ? rows.length : 'invalid data'}`);
}

// Stable, content-derived card ids. Progress is keyed by these, so an id must
// depend only on the word itself — never on its position in the file. Adding or
// removing a word must not renumber anything else.
const idFor = (level, chapter, de) =>
  createHash('sha256').update(`${level}|${chapter}|${de}`).digest('hex').slice(0, 10);

const seen = new Map();
const cards = rows.map(([level, chapter, de, en, grammar = '', example = '']) => {
  const base = idFor(level, chapter, de);
  // Exact duplicates do exist in the Glossar (e.g. A1 K1 lists "Deutsch" twice).
  // They get a stable ordinal suffix, which stays put as long as the duplicate
  // count for that word does.
  const n = (seen.get(base) || 0) + 1;
  seen.set(base, n);
  return [n === 1 ? base : `${base}-${n}`, level, chapter, de, en, grammar, example];
});
if (new Set(cards.map((c) => c[0])).size !== cards.length) {
  throw new Error('Vocabulary build failed: card id collision');
}

// ---- Chinese helper glosses ------------------------------------------------
// The gloss files are positional arrays. Resolving them against the deck happens
// HERE, once, where a mismatch throws — instead of at runtime, where a silent
// off-by-one would mislabel every remaining word.
const zh = {};
let cursor = 0;
for (const part of ZH_PARTS) {
  const list = JSON.parse(readFileSync(new URL(part.file, data), 'utf8'));
  if (!Array.isArray(list) || list.length !== part.count) {
    throw new Error(`Vocabulary build failed: ${part.file} expected ${part.count} glosses, got ${Array.isArray(list) ? list.length : 'invalid data'}`);
  }
  const slice = cards.filter(
    (c) => c[1] === part.level && +c[2] >= part.chapters[0] && +c[2] <= part.chapters[1],
  );
  if (slice.length !== part.count) {
    throw new Error(`Vocabulary build failed: ${part.file} covers ${part.count} glosses but the deck has ${slice.length} ${part.level} K${part.chapters.join('-')} words`);
  }
  slice.forEach((c, i) => { zh[c[0]] = list[i]; });
  cursor += part.count;
}
if (Object.keys(zh).length !== cursor) {
  throw new Error(`Vocabulary build failed: ${cursor} glosses read but ${Object.keys(zh).length} mapped — duplicate ids?`);
}

writeFileSync(new URL('cards.json', out), JSON.stringify(cards));
writeFileSync(new URL('zh.json', out), JSON.stringify(zh));

// ---- learning module -------------------------------------------------------
// Plain concatenation, no source rewriting: an earlier build patched its own
// source through exact-string replacements, so editing a UI string broke it.
const read = (name) => readFileSync(new URL(name, src), 'utf8').trim();
writeFileSync(
  new URL('learn.js', out),
  `(()=>{\n${read('learn.core.js')}\n${read('wrongbook-addon.js')}\n${read('mastered-addon.js')}\n${read('drills-addon.js')}\nLboot();\n})();\n`,
);
writeFileSync(new URL('store.js', out), `${read('store.js')}\n`);

// ---- service worker --------------------------------------------------------
// The cache name is derived from the content it caches, so a deploy can never
// leave a returning visitor pinned to stale JS. Nothing here is bumped by hand.
const shipped = [...STATIC, 'store.js', 'learn.js', 'cards.json', 'zh.json'];
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

console.log(`Built ${cards.length} cards, ${Object.keys(zh).length} glosses into dist/ (build ${buildId}).`);
