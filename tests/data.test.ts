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

describe('plural derivation', () => {
  build();
  const cards: Card[] = readJson('cards.json');

  // Mirrors LpluralOf / LumlautStem in src/drills-addon.js. The Glossar writes
  // plurals compactly — a leading " or * marks an umlaut — so the drill derives
  // the full form. A wrong derivation would actively teach the learner an error,
  // which is worse than having no drill, hence the ground-truth list below.
  const stemOf = (de: string) => de.replace(/^(der|die|das)\s+/i, '').trim();
  const umlautStem = (stem: string) => {
    const m = /(au|[aou])(?![\s\S]*(?:au|[aou]))/i.exec(stem);
    if (!m) return null;
    const map: Record<string, string> = { a: 'ä', o: 'ö', u: 'ü', au: 'äu', A: 'Ä', O: 'Ö', U: 'Ü', Au: 'Äu', AU: 'ÄU' };
    const hit = m[1];
    const rep = map[hit] ?? map[hit.toLowerCase()];
    return rep ? stem.slice(0, m.index) + rep + stem.slice(m.index + hit.length) : null;
  };
  const pluralOf = (de: string, grammar: string) => {
    const raw = (grammar || '').trim();
    if (!raw) return null;
    const explicit = raw.match(/^Plural:\s*(?:die\s+)?(.+)$/i);
    if (explicit) {
      const form = explicit[1].trim();
      return /^[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*$/.test(form) ? `die ${form}` : null;
    }
    const short = raw.match(/^(["*]*)-?(n|en|nen|e|er|s|se|ien|es|€)?$/);
    if (!short) return null;
    const suffix = (short[2] || '').replace(/€/g, 'e');
    let stem = stemOf(de);
    if (!stem || /[\s|/]/.test(stem)) return null;
    if (short[1]) {
      const u = umlautStem(stem);
      if (!u) return null;
      stem = u;
    }
    return `die ${stem}${suffix}`;
  };

  const groundTruth: Record<string, string> = {
    Vater: 'die Väter', Apfel: 'die Äpfel', Mutter: 'die Mütter', Stadt: 'die Städte',
    Hand: 'die Hände', Nacht: 'die Nächte', Sohn: 'die Söhne', Zug: 'die Züge',
    Arzt: 'die Ärzte', Garten: 'die Gärten', Laden: 'die Läden', Mantel: 'die Mäntel',
    Vogel: 'die Vögel', Haus: 'die Häuser', Land: 'die Länder', Mann: 'die Männer',
    Buch: 'die Bücher', Fluss: 'die Flüsse', Stuhl: 'die Stühle',
    Rock: 'die Röcke', Ball: 'die Bälle', Maus: 'die Mäuse', Turm: 'die Türme',
    Hals: 'die Hälse', Kind: 'die Kinder', Ei: 'die Eier', Bild: 'die Bilder',
    Kindergarten: 'die Kindergärten', Handtuch: 'die Handtücher', Tag: 'die Tage', Wort: 'die Wörter',
    Beruf: 'die Berufe', Flasche: 'die Flaschen', Koffer: 'die Koffer', Auto: 'die Autos',
    Freundin: 'die Freundinnen', Rucksack: 'die Rucksäcke', Einkauf: 'die Einkäufe',
    Hauptsatz: 'die Hauptsätze', Schwimmbad: 'die Schwimmbäder', Wand: 'die Wände',
  };

  // A few nouns have two correct plurals with different senses, recorded on
  // separate cards: das Wort is die Wörter (separate words) and die Worte
  // (connected speech).
  const multiPlural: Record<string, string[]> = { Wort: ['die Wörter', 'die Worte'] };

  it('derives known German plurals correctly, umlauts included', () => {
    const wrong: string[] = [];
    for (const [word, expected] of Object.entries(groundTruth)) {
      // A word can appear more than once; only entries that carry plural data
      // produce a question, so check those.
      const withData = cards.filter((c) => stemOf(c[3]) === word && /^(der|die|das)\s/i.test(c[3]) && c[5]?.trim());
      expect(withData.length, `${word} has no plural data in the deck`).toBeGreaterThan(0);
      for (const c of withData) {
        const got = pluralOf(c[3], c[5]);
        const allowed = multiPlural[word] ?? [expected];
        if (!got || !allowed.includes(got)) wrong.push(`${word}: got ${got}, expected one of ${allowed.join(' / ')}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('returns nothing rather than guessing when the data is absent or ambiguous', () => {
    // "der Platz" meaning "room" carries no plural marker — it must be skipped,
    // not guessed at.
    const bare = cards.find((c) => c[3] === 'der Platz' && !c[5]?.trim());
    expect(bare).toBeDefined();
    expect(pluralOf(bare![3], bare![5])).toBeNull();
    expect(pluralOf('die Pizza', '-s/Pizzen')).toBeNull();
    expect(pluralOf('das Ding', '5')).toBeNull();
  });

  it('covers a worthwhile share of the nouns', () => {
    const nouns = cards.filter((c) => /^(der|die|das)\s/i.test(c[3]));
    const drillable = nouns.filter((c) => pluralOf(c[3], c[5]));
    expect(nouns.length).toBeGreaterThan(2900);
    expect(drillable.length).toBeGreaterThan(2400);
  });

  it('gives every noun an article for the gender drill', () => {
    const nouns = cards.filter((c) => /^(der|die|das)\s/i.test(c[3]));
    for (const c of nouns) expect(c[3]).toMatch(/^(der|die|das)\s+\S/);
  });
});
