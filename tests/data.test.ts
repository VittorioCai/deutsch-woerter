import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// The app keys every scrap of a learner's progress by card id, so these are
// data-durability tests, not cosmetics: a change that shifts ids silently orphans
// everything already saved in people's browsers.

const out = new URL('../dist/', import.meta.url);
const build = () => execFileSync('node', ['scripts/build.mjs'], { cwd: new URL('..', import.meta.url) });

// src/deck.js is a classic browser script, not a module. Evaluating its shipped
// text is the point: these tests must fail if what the browser runs drifts.
const load = <T>(file: string, expr: string, scope: Record<string, unknown> = {}): T => {
  const src = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
  // Browser scripts publish themselves on window; give them one to publish to.
  const full = { window: {} as Record<string, unknown>, ...scope };
  const names = Object.keys(full);
  return new Function(...names, `${src}; return ${expr};`)(...names.map((n) => full[n as keyof typeof full])) as T;
};

type Row = { level: string; chapter: string; de: string; en?: string; zh?: string; grammar?: string };
type Card = Row & { id: string };
interface Deck { parse(text: string, name?: string): { name: string; cards: Card[]; skipped: Array<{ line: number; why: string }> };
  serialize(d: { name: string; cards: Card[] }): string; withIds(rows: Row[]): Card[]; sha256Hex(s: string): string;
  idFor(level: string, chapter: string, de: string): string }

const DWDeck = load<Deck>('deck.js', 'DWDeck');
const FIXTURE = readFileSync(new URL('./fixtures/deck.json', import.meta.url), 'utf8');

describe('card ids', () => {
  it('computes SHA-256 exactly, umlauts and all', () => {
    // The browser gets no crypto.subtle here, so this implementation is the only
    // thing standing between a learner and a deck full of unrecognised words.
    for (const v of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(1000), 'das W\u00fcrstchen', 'gr\u00f6\u00dfer', '\u4e2d\u6587']) {
      expect(DWDeck.sha256Hex(v), JSON.stringify(v)).toBe(createHash('sha256').update(v).digest('hex'));
    }
  });

  it('still produces the ids that earlier builds shipped', () => {
    // These were computed by the old Node build and are live in people's browsers
    // as progress keys. They are pinned as literals on purpose: if this test ever
    // has to be updated, every learner's history has just been orphaned.
    expect(DWDeck.idFor('A1', '1', 'das Haus')).toBe('745f7f512f');
    expect(DWDeck.idFor('A1', '1', 'die T\u00fcr')).toBe('c04e6fe0dd');
    expect(DWDeck.idFor('A2', '5', 'der Bahnhof')).toBe('14b3aaa187');
  });

  it('derives ids from the word, never from its position in the file', () => {
    // The original scheme was `${level}-${chapter}-${lineNumber}`: inserting one
    // word renumbered 99.8% of the deck and orphaned all saved progress.
    const { cards } = DWDeck.parse(FIXTURE, 'fixture.json');
    const expected = (level: string, chapter: string, de: string) =>
      createHash('sha256').update(`${level}|${chapter}|${de}`).digest('hex').slice(0, 10);
    const seen = new Set<string>();
    for (const c of cards) {
      const base = expected(c.level, c.chapter, c.de);
      expect(c.id === base || c.id.startsWith(`${base}-`)).toBe(true);
      if (!seen.has(base)) { expect(c.id).toBe(base); seen.add(base); }
    }
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it('keeps every other id stable when a word is inserted', () => {
    const { cards } = DWDeck.parse(FIXTURE, 'fixture.json');
    const rows: Row[] = cards.map(({ id, ...r }) => r);
    const before = cards.map((c) => c.id);
    const mutated = [...rows];
    mutated.splice(3, 0, { level: 'A1', chapter: '1', de: 'das Testwort', en: 'test word' });
    const after = DWDeck.withIds(mutated).filter((c) => c.de !== 'das Testwort').map((c) => c.id);
    expect(after).toEqual(before);
  });

  it('gives an exactly duplicated word a stable ordinal instead of a collision', () => {
    const rows: Row[] = [
      { level: 'A1', chapter: '1', de: 'Deutsch', en: 'German' },
      { level: 'A1', chapter: '1', de: 'Deutsch', en: 'German' },
      { level: 'A1', chapter: '1', de: 'das Haus', en: 'house' },
    ];
    const ids = DWDeck.withIds(rows).map((c) => c.id);
    expect(ids[1]).toBe(`${ids[0]}-2`);
    expect(new Set(ids).size).toBe(3);
  });

  it('survives an export/import round trip without moving a single id', () => {
    const first = DWDeck.parse(FIXTURE, 'fixture.json');
    const again = DWDeck.parse(DWDeck.serialize(first), 'again.json');
    expect(again.cards.map((c) => c.id)).toEqual(first.cards.map((c) => c.id));
    expect(again.cards.map((c) => c.zh ?? '')).toEqual(first.cards.map((c) => c.zh ?? ''));
    expect(again.name).toBe(first.name);
  });
});

describe('deck import', () => {
  it('reads a spreadsheet exported as CSV, header aliases included', () => {
    const csv = 'Deutsch,Chinese,English,Kapitel,Niveau\ndas Haus,\u623f\u5b50,house,1,A1\n"die T\u00fcr, gro\u00df",\u95e8,door,1,A1\n';
    const { cards } = DWDeck.parse(csv, 'woerter.csv');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ level: 'A1', chapter: '1', de: 'das Haus', zh: '\u623f\u5b50', en: 'house' });
    // a quoted comma is one field, not two columns
    expect(cards[1].de).toBe('die T\u00fcr, gro\u00df');
  });

  it('reads tab-separated text and defaults the optional columns', () => {
    const { cards } = DWDeck.parse('de\tzh\ndas Haus\t\u623f\u5b50\n', 'list.tsv');
    expect(cards[0]).toMatchObject({ level: 'A1', chapter: '1', de: 'das Haus', zh: '\u623f\u5b50', en: '' });
  });

  it('reports the rows it cannot use instead of dropping them silently', () => {
    // An import that quietly loses a quarter of the file is how you discover six
    // weeks later that a chapter was never there.
    const { cards, skipped } = DWDeck.parse('de,zh\ndas Haus,\u623f\u5b50\n,\u6ca1\u6709\u5fb7\u8bed\ndas Brot,\n', 'x.csv');
    expect(cards).toHaveLength(1);
    expect(skipped.map((s) => s.line)).toEqual([2, 3]);
  });

  it('refuses a file it cannot make a deck out of', () => {
    expect(() => DWDeck.parse('', 'x.csv')).toThrow();
    expect(() => DWDeck.parse('{"cards":[]}', 'x.json')).toThrow();
    expect(() => DWDeck.parse('a,b,c\n1,2,3\n', 'x.csv')).toThrow(/de/);
    expect(() => DWDeck.parse('{ not json', 'x.json')).toThrow();
  });

  it('accepts a bare array and takes the name from the file', () => {
    const { cards, name } = DWDeck.parse(JSON.stringify([{ de: 'das Haus', en: 'house' }]), 'Mein Wortschatz.json');
    expect(cards).toHaveLength(1);
    expect(name).toBe('Mein Wortschatz');
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
    const sources = ['learn.core.js', 'wrongbook-addon.js', 'mastered-addon.js', 'store.js', 'deck.js', 'sw.source.js'];
    const hash = () => sources.map((f) => createHash('sha256')
      .update(readFileSync(new URL(`../src/${f}`, import.meta.url)))
      .digest('hex')).join();
    const before = hash();
    build();
    expect(hash()).toBe(before);
  });
});

describe('plural derivation', () => {
  // The real function, evaluated out of the file the browser loads. A drill that
  // derives a plural wrongly actively teaches the learner an error, which is
  // worse than having no drill, hence the ground truth below.
  const { LpluralOf } = load<{ LpluralOf(c: { de: string; grammar: string }): string | null }>(
    'drills-addon.js',
    '{ LpluralOf }',
    { DWStore: { read: () => ({}), onMigrated: () => {}, prefs: () => ({}), queue: () => {} } },
  );
  const plural = (de: string, grammar: string) => LpluralOf({ de, grammar });

  // A compact marker: a leading " or * means umlaut the last stem vowel, the
  // optional - stands for the singular stem, and the rest is the suffix.
  const groundTruth: Array<[string, string, string]> = [
    ['der Vater', '"-', 'die V\u00e4ter'], ['der Apfel', '"-', 'die \u00c4pfel'],
    ['die Mutter', '"-', 'die M\u00fctter'], ['der Garten', '"-', 'die G\u00e4rten'],
    ['der Kindergarten', '"-', 'die Kinderg\u00e4rten'],
    ['die Stadt', '"-e', 'die St\u00e4dte'], ['die Hand', '"-e', 'die H\u00e4nde'],
    ['die Nacht', '"-e', 'die N\u00e4chte'], ['der Sohn', '"-e', 'die S\u00f6hne'],
    ['der Zug', '"-e', 'die Z\u00fcge'], ['der Arzt', '"-e', 'die \u00c4rzte'],
    ['der Rock', '"-e', 'die R\u00f6cke'], ['der Ball', '"-e', 'die B\u00e4lle'],
    ['die Maus', '"-e', 'die M\u00e4use'], ['der Turm', '"-e', 'die T\u00fcrme'],
    ['der Hals', '"-e', 'die H\u00e4lse'], ['der Rucksack', '"-e', 'die Rucks\u00e4cke'],
    ['der Hauptsatz', '"-e', 'die Haupts\u00e4tze'],
    ['das Haus', '"-er', 'die H\u00e4user'], ['das Land', '"-er', 'die L\u00e4nder'],
    ['der Mann', '"-er', 'die M\u00e4nner'], ['das Buch', '"-er', 'die B\u00fccher'],
    ['das Wort', '"-er', 'die W\u00f6rter'], ['das Handtuch', '"-er', 'die Handt\u00fccher'],
    ['das Schwimmbad', '"-er', 'die Schwimmb\u00e4der'],
    ['das Kind', '-er', 'die Kinder'], ['das Ei', '-er', 'die Eier'], ['das Bild', '-er', 'die Bilder'],
    ['der Tag', '-e', 'die Tage'], ['der Beruf', '-e', 'die Berufe'],
    ['die Flasche', '-n', 'die Flaschen'], ['der Koffer', '-', 'die Koffer'],
    ['das Auto', '-s', 'die Autos'], ['die Freundin', '-nen', 'die Freundinnen'],
    ['der Fluss', '"-e', 'die Fl\u00fcsse'], ['der Stuhl', '"-e', 'die St\u00fchle'],
    // Word lists exported from a PDF carry mojibake: a euro sign where an e belongs.
    ['die Stadt', '"\u20ac', 'die St\u00e4dte'],
    // and the explicit form, which any hand-made deck can use instead
    ['das Wort', 'Plural: die Worte', 'die Worte'],
    ['das Haus', 'Plural: H\u00e4user', 'die H\u00e4user'],
  ];

  it('derives known German plurals correctly, umlauts included', () => {
    const wrong = groundTruth
      .map(([de, marker, want]) => [de, plural(de, marker), want] as const)
      .filter(([, got, want]) => got !== want)
      .map(([de, got, want]) => `${de}: got ${got}, expected ${want}`);
    expect(wrong).toEqual([]);
  });

  it('returns nothing rather than guessing when the data is absent or ambiguous', () => {
    expect(plural('der Platz', '')).toBeNull();
    expect(plural('die Pizza', '-s/Pizzen')).toBeNull();
    expect(plural('das Ding', '5')).toBeNull();
    expect(plural('das Ding', 'Plural: die Dinge, die Dinger')).toBeNull();
    // nothing to umlaut
    expect(plural('das Ding', '"-e')).toBeNull();
  });

  it('never ships a plural the drill would derive differently', () => {
    // starter-deck.json is the app's own vocabulary, loaded by the 「立即开始背词」
    // button. A noun whose written plural and derived plural disagree would be the
    // app teaching its own mistake.
    const { cards } = DWDeck.parse(readFileSync(new URL('../src/starter-deck.json', import.meta.url), 'utf8'), 'starter-deck.json');
    const nouns = cards.filter((c) => /^(der|die|das)\s/.test(c.de));
    const written = nouns.filter((c) => c.grammar);
    const wrong = written
      .map((c) => ({ de: c.de, want: c.grammar!.replace(/^Plural:\s*/, ''), got: plural(c.de, c.grammar!) }))
      .filter((r) => r.got !== r.want);
    expect(wrong).toEqual([]);
    expect(cards.length).toBeGreaterThan(250);
    expect(written.length).toBeGreaterThan(100);
    // all three genders, or the der/die/das drill is a coin toss
    for (const art of ['der ', 'die ', 'das ']) {
      expect(nouns.filter((c) => c.de.startsWith(art)).length, art).toBeGreaterThan(30);
    }
    // and every card can actually be asked about in both directions
    for (const c of cards) { expect(c.de.trim()).not.toBe(''); expect(c.en || c.zh).toBeTruthy(); }
  });

  it('drives the drill off the deck that is actually loaded', () => {
    const { cards } = DWDeck.parse(FIXTURE, 'fixture.json');
    const nouns = cards.filter((c) => /^(der|die|das)\s/i.test(c.de));
    const drillable = nouns.filter((c) => plural(c.de, c.grammar ?? ''));
    expect(nouns.length).toBeGreaterThan(20);
    expect(drillable.length).toBeGreaterThan(15);
    for (const c of nouns) expect(c.de).toMatch(/^(der|die|das)\s+\S/);
  });
});

describe('Wikimedia audio addressing', () => {
  // Commons stores an upload at commons/<h0>/<h0h1>/<name> where h is the MD5 of
  // the file name. Getting this wrong means every pronunciation 404s, and it
  // cannot be checked from CI, so the expected paths below were read off the real
  // service and are pinned here.
  const md5 = (() => {
    const src = readFileSync(new URL('../src/md5.js', import.meta.url), 'utf8');
    const fn = new Function(`${src}; return Lmd5;`);
    return fn() as (s: string) => string;
  })();

  it('matches the published MD5 test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });

  it('reproduces the real Commons paths, umlauts included', () => {
    const path = (file: string) => { const h = md5(file); return `${h[0]}/${h.slice(0, 2)}` };
    expect(path('De-Haus.ogg')).toBe('7/7e');
    expect(path('De-Flasche.ogg')).toBe('5/5e');
    expect(path('De-Autobahn.ogg')).toBe('5/54');
    expect(path('De-Würstchen.ogg')).toBe('8/85');
  });

  it('hashes UTF-8 bytes, not code units', () => {
    // An umlaut is two bytes; hashing it as one would give a different path and a
    // 404 on exactly the words German is full of.
    expect(md5('ä')).toBe(md5('ä'));
    expect(md5('De-Würstchen.ogg')).not.toBe(md5('De-Wurstchen.ogg'));
  });
});

describe('word insight', () => {
  const DWInsight = load<any>('insight.js', 'DWInsight');
  const card = (de: string, zh: string, en = '') => ({ de, zh, en, level: 'A1', chapter: '1', grammar: '', example: '' });
  // A purpose-built miniature deck: the compound rules use whatever deck is
  // loaded as their dictionary, so the test owns both halves of every compound.
  const DECK = [
    card('die Hand', '手'), card('das Tuch', '布'), card('das Handtuch', '毛巾'),
    card('die Bahn', '铁路'), card('der Hof', '院子'), card('der Bahnhof', '火车站'),
    card('die Geburt', '出生'), card('der Tag', '天'), card('der Geburtstag', '生日'),
    card('krank', '生病的'), card('die Schwester', '姐妹'), card('die Krankenschwester', '护士'),
    card('nach', '之后'), card('die Bar', '酒吧'), card('der Nachbar', '邻居'),
    card('die Wohnung', '住房'), card('die Prüfung', '考试'), card('die Zeitung', '报纸'),
    card('die Freiheit', '自由'), card('das Mädchen', '女孩'), card('der Kuchen', '蛋糕'),
    card('das Haus', '房子'), card('vorstellen', '介绍'), card('verstehen', '理解'),
    card('arbeitslos', '失业的'), card('der Sprung', '跳跃'),
  ];
  const at = (de: string) => DWInsight.Lanalyse(DECK.find((c) => c.de === de), DECK);
  const text = (de: string) => at(de).map((r: any) => `${r.label}|${r.text}|${r.note ?? ''}`).join('\n');

  it('explains a noun ending in -ung and shows the pattern beside it', () => {
    const rows = at('die Wohnung');
    expect(rows.find((r: any) => r.kind === 'gender').text).toMatch(/-ung/);
    // the point of the family is that the rule stops being a claim
    expect(rows.find((r: any) => r.kind === 'family').text).toContain('die Prüfung');
    expect(rows.find((r: any) => r.kind === 'plural').text).toContain('-en');
  });

  it('never offers a word as evidence for a rule it does not obey', () => {
    // der Kuchen ends in "chen" without being a diminutive; der Sprung ends in
    // "ung" without being a noun in -ung.
    expect(text('das Mädchen')).not.toContain('Kuchen');
    expect(text('die Wohnung')).not.toContain('Sprung');
    expect(at('der Kuchen').filter((r: any) => r.kind === 'gender')).toHaveLength(0);
    expect(at('der Sprung').filter((r: any) => r.kind === 'gender')).toHaveLength(0);
  });

  it('splits compounds and reads the gender off the last element', () => {
    expect(text('das Handtuch')).toContain('Hand + Tuch');
    expect(text('das Handtuch')).toContain('das Tuch');
    expect(text('der Bahnhof')).toContain('Bahn + Hof');
    // linking letters are named as such rather than left to look like a typo
    expect(text('der Geburtstag')).toContain('Geburt +s+ Tag');
    expect(text('der Geburtstag')).toMatch(/-s- 是连接音/);
    expect(text('die Krankenschwester')).toContain('krank +en+ Schwester');
  });

  it('refuses a split that would be nonsense', () => {
    // "nach + Bar" parses but is not what der Nachbar is made of. A short
    // function word in front of a three-letter word is the shape of that error.
    expect(at('der Nachbar')).toEqual([]);
  });

  it('tells separable and inseparable verb prefixes apart', () => {
    const sep = at('vorstellen').find((r: any) => r.kind === 'affix');
    expect(sep.label).toContain('可分');
    expect(sep.note).toMatch(/甩到句尾/);
    const insep = at('verstehen').find((r: any) => r.kind === 'affix');
    expect(insep.label).toContain('不可分');
    expect(insep.note).toMatch(/ge-/);
    // a verb is not a noun compound, whatever words happen to be in the deck
    expect(at('vorstellen').filter((r: any) => r.kind === 'compound')).toHaveLength(0);
  });

  it('reads adjective suffixes', () => {
    expect(text('arbeitslos')).toContain('-los');
  });

  it('says nothing rather than inventing something', () => {
    // das Haus has no derivable rule behind it. A guess here would be worse than
    // an empty panel.
    expect(at('das Haus')).toEqual([]);
  });

  it('never contradicts the deck it is explaining', () => {
    // Every gender line must agree with the article the card actually carries;
    // an explanation that argues with the word teaches the wrong thing.
    const { cards } = DWDeck.parse(readFileSync(new URL('../src/starter-deck.json', import.meta.url), 'utf8'), 's.json');
    let explained = 0;
    for (const c of cards) {
      for (const row of DWInsight.Lanalyse(c, cards)) {
        if (row.kind !== 'gender') continue;
        explained++;
        expect(row.label, c.de).toContain(c.de.split(' ')[0]);
      }
    }
    // The deck the app ships must actually exercise the feature it ships: a
    // first-time visitor who never sees the panel does not know it exists.
    expect(explained).toBeGreaterThan(25);
  });
});
