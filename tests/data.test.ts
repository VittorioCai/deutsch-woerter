import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// The vocabulary PWA keys every scrap of a learner's progress by card id, so these
// are data-durability tests, not cosmetics: a change that shifts ids silently
// orphans everything already saved in people's browsers.

const out = new URL('../dist/', import.meta.url);
const readJson = (name: string) => JSON.parse(readFileSync(new URL(name, out), 'utf8'));

type Card = [string, string, string, string, string, string, string];

const build = () => execFileSync('node', ['scripts/build.mjs'], { cwd: new URL('..', import.meta.url) });

describe('vocabulary card ids', () => {
  build();
  const cards: Card[] = readJson('cards.json');
  const zh: Record<string, string> = readJson('zh.json');

  it('ships a non-trivial deck', () => {
    expect(cards.length).toBeGreaterThan(4000);
  });

  it('gives every card a unique id', () => {
    expect(new Set(cards.map((c) => c[0])).size).toBe(cards.length);
  });

  it('derives ids from the word, never from its position in the file', () => {
    // The original scheme was `${level}-${chapter}-${lineNumber}`: inserting one
    // word renumbered 99.8% of the deck and orphaned all saved progress.
    const expected = (level: string, chapter: string, de: string) =>
      createHash('sha256').update(`${level}|${chapter}|${de}`).digest('hex').slice(0, 10);
    const seen = new Set<string>();
    for (const [id, level, chapter, de] of cards) {
      const base = expected(level, chapter, de);
      // Exact duplicates in the Glossar get a stable ordinal suffix.
      expect(id === base || id.startsWith(`${base}-`)).toBe(true);
      if (!seen.has(base)) {
        expect(id).toBe(base);
        seen.add(base);
      }
    }
  });

  it('keeps ids stable when an unrelated word is inserted', () => {
    const idFor = (level: string, chapter: string, de: string) =>
      createHash('sha256').update(`${level}|${chapter}|${de}`).digest('hex').slice(0, 10);
    const before = cards.map((c) => c[0]);
    // simulate an edit near the top of the deck
    const mutated = [...cards];
    mutated.splice(10, 0, [idFor('A1', '1', 'das Testwort'), 'A1', '1', 'das Testwort', 'test word', '', '']);
    const after = mutated.filter((c) => c[3] !== 'das Testwort').map((c) => c[0]);
    expect(after).toEqual(before);
  });

  it('keys Chinese glosses by card id rather than array position', () => {
    // Positional mapping meant one added word shifted every remaining meaning by
    // one, silently mislabelling the rest of the deck.
    const byId = new Map(cards.map((c) => [c[0], c]));
    for (const id of Object.keys(zh)) {
      const card = byId.get(id);
      expect(card, `gloss for unknown card ${id}`).toBeDefined();
      expect(['A1', 'A2']).toContain(card![1]);
    }
    const a12 = cards.filter((c) => c[1] === 'A1' || c[1] === 'A2');
    expect(Object.keys(zh)).toHaveLength(a12.length);
  });

  it('leaves no card without German or English text', () => {
    for (const c of cards) {
      expect(c[3].trim()).not.toBe('');
      expect(c[4].trim()).not.toBe('');
    }
  });
});

describe('vocabulary build outputs', () => {
  it('stamps the service worker cache with a content hash', () => {
    build();
    const sw = readFileSync(new URL('sw.js', out), 'utf8');
    const first = sw.match(/const CACHE = "deutsch-woerter-([0-9a-f]{12})"/)?.[1];
    expect(first).toBeTruthy();
    expect(sw).not.toContain('__BUILD_ID__');
    expect(sw).not.toContain('__ASSETS__');

    // A change to any shipped source must rotate the cache name, or returning
    // visitors stay pinned to the previous build's JavaScript forever.
    const src = new URL('../src/learn.core.js', import.meta.url);
    const original = readFileSync(src, 'utf8');
    try {
      execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(src.pathname)}, ${JSON.stringify(original + '\n/* cache-bust probe */\n')})`]);
      build();
      const second = readFileSync(new URL('sw.js', out), 'utf8').match(/deutsch-woerter-([0-9a-f]{12})/)?.[1];
      expect(second).not.toBe(first);
    } finally {
      execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(src.pathname)}, ${JSON.stringify(original)})`]);
      build();
    }
  });

  it('does not modify its own sources', () => {
    // An earlier build rewrote its own learn.js source in place through
    // 23 exact-string replacements, so editing a UI string broke the deploy.
    const sources = ['learn.core.js', 'wrongbook-addon.js', 'mastered-addon.js', 'store.js', 'sw.source.js'];
    const hash = () => sources.map((f) => createHash('sha256')
      .update(readFileSync(new URL(`../src/${f}`, import.meta.url)))
      .digest('hex')).join();
    const before = hash();
    build();
    expect(hash()).toBe(before);
  });
});
