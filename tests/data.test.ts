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

// The word lists carry more than a meaning per word: a reflexive verb's `sich`,
// a verb's auxiliary, a sentence the word appears in. Each of these used to be
// printed and never checked, and the first of them was actively scored wrong.
describe('what the grammar and example columns encode', () => {
  const DWStoreStub = { KEYS: { LEARN: 'l' }, read: () => ({}), onMigrated: () => {}, prefs: () => ({}), queue: () => {} };
  const documentStub = { addEventListener: () => {} };
  type Card = { de: string; zh?: string; en?: string; grammar?: string; example?: string };
  const learn = load<{
    LspellAccepted(c: Card, input: string): boolean;
    LisReflexive(c: Card): boolean;
    LexampleDe(c: Card): string;
    LexampleZh(c: Card): string;
    Lnorm(s: string): string;
    Lvariants(de: string): string[];
  }>('learn.core.js', '{ LspellAccepted, LisReflexive, LexampleDe, LexampleZh, Lnorm, Lvariants }',
    { DWStore: DWStoreStub, document: documentStub });

  type Span = { before: string; word: string; after: string };
  const drills = load<{
    LauxOf(c: Card): { aux: string; part: string } | null;
    LclozeSpan(c: Card): Span | null;
    LclozeAccepted(c: Card, span: Span, input: string): boolean;
    LdrillArticles(c: Card): string[];
  }>('drills-addon.js', '{ LauxOf, LclozeSpan, LclozeAccepted, LdrillArticles }',
    { DWStore: DWStoreStub, document: documentStub, LexampleDe: learn.LexampleDe, Lnorm: learn.Lnorm,
      DWInsight: load<any>('insight.js', 'DWInsight') });

  // A word list writes alternatives with a slash, and the app used to demand the
  // slash back: der/die Deutsche was only "right" when typed with both articles,
  // and even the bare noun was refused, because a headword starting "der/" was
  // not recognised as a noun at all. 39 entries of the 5434-word deck are like
  // this, most of them nominalised adjectives naming people.
  describe('a headword that offers two forms', () => {
    const deutsche: Card = { de: 'der/die Deutsche', zh: '德国人' };
    const joghurt: Card = { de: 'der/das Joghurt', zh: '酸奶' };

    it('takes either article, or none', () => {
      for (const typed of ['der Deutsche', 'die Deutsche', 'Deutsche', 'der/die Deutsche']) {
        expect(learn.LspellAccepted(deutsche, typed), typed).toBe(true);
      }
      expect(learn.LspellAccepted(joghurt, 'das Joghurt')).toBe(true);
      expect(learn.LspellAccepted(deutsche, 'der Deutscher')).toBe(false);
    });

    it('takes either spelling when the alternatives are not articles', () => {
      const dizzy: Card = { de: 'schwindelig/schwindlig', zh: '头晕的' };
      expect(learn.LspellAccepted(dizzy, 'schwindlig')).toBe(true);
      expect(learn.LspellAccepted(dizzy, 'schwindelig')).toBe(true);
      const plum: Card = { de: 'die Zwetschge/Zwetschke', zh: '洋李' };
      expect(learn.LspellAccepted(plum, 'die Zwetschge')).toBe(true);
      expect(learn.LspellAccepted(plum, 'Zwetschke')).toBe(true);
    });

    // A slash against a hyphen is a shortened compound, not a choice: the whole
    // word is die Ja-/Nein-Frage, and "die Ja-" is not a word.
    it('does not split a shortened compound into words that do not exist', () => {
      const question: Card = { de: 'die Ja-/Nein-Frage', zh: '一般疑问句' };
      expect(learn.Lvariants(question.de)).toEqual(['die Ja-/Nein-Frage']);
      expect(learn.LspellAccepted(question, 'die Ja-/Nein-Frage')).toBe(true);
      expect(learn.LspellAccepted(question, 'die Ja-')).toBe(false);
      expect(learn.LspellAccepted(question, 'Nein-Frage')).toBe(false);
    });

    it('offers each article to the der/die/das drill, so neither is marked wrong', () => {
      expect(drills.LdrillArticles(deutsche)).toEqual(['der', 'die']);
      expect(drills.LdrillArticles(joghurt)).toEqual(['der', 'das']);
      expect(drills.LdrillArticles({ de: 'das Haus' })).toEqual(['das']);
      // the drill is about nouns; a pronoun listing its three forms is not one
      expect(drills.LdrillArticles({ de: 'derselbe / dieselbe / dasselbe' })).toEqual([]);
      expect(drills.LdrillArticles({ de: 'die Ja-/Nein-Frage' })).toEqual(['die']);
    });
  });

  describe('reflexive verbs', () => {
    // `sich` is shown in the meaning column and nowhere else, so scoring against
    // `de` alone marked a learner wrong for writing the form the card taught.
    const freuen: Card = { de: 'freuen', zh: '（sich auf +A）期待', en: 'to be pleased' };

    it('accepts the sich the card itself teaches', () => {
      expect(learn.LspellAccepted(freuen, 'sich freuen')).toBe(true);
    });

    it('still accepts the bare infinitive, which is what `de` holds', () => {
      expect(learn.LspellAccepted(freuen, 'freuen')).toBe(true);
    });

    it('accepts either way round when a deck does put sich in the headword', () => {
      const other: Card = { de: 'sich erinnern', zh: '记得' };
      expect(learn.LspellAccepted(other, 'erinnern')).toBe(true);
      expect(learn.LspellAccepted(other, 'sich erinnern')).toBe(true);
    });

    it('does not hand out sich to a verb that is not reflexive', () => {
      const kaufen: Card = { de: 'kaufen', zh: '买', en: 'to buy' };
      expect(learn.LisReflexive(kaufen)).toBe(false);
      expect(learn.LspellAccepted(kaufen, 'sich kaufen')).toBe(false);
    });

    it('is not fooled into accepting a different verb', () => {
      expect(learn.LspellAccepted(freuen, 'sich fahren')).toBe(false);
    });
  });

  describe('the auxiliary', () => {
    it('reads haben or sein off the end of the grammar column', () => {
      expect(drills.LauxOf({ de: 'gehen', grammar: 'er geht, ist gegangen' }))
        .toEqual({ aux: 'sein', part: 'gegangen' });
      expect(drills.LauxOf({ de: 'kaufen', grammar: 'er kauft, hat gekauft' }))
        .toEqual({ aux: 'haben', part: 'gekauft' });
    });

    it('takes the last form when a B1 entry also lists the Präteritum', () => {
      expect(drills.LauxOf({ de: 'verschwinden', grammar: 'er verschwindet, verschwand, ist verschwunden' }))
        .toEqual({ aux: 'sein', part: 'verschwunden' });
    });

    it('keeps a participle that is more than one word', () => {
      expect(drills.LauxOf({ de: 'ernst nehmen', grammar: 'er nimmt ernst, nahm ernst, hat ernst genommen' }))
        .toEqual({ aux: 'haben', part: 'ernst genommen' });
    });

    it('asks nothing of a word whose perfect is not written down', () => {
      expect(drills.LauxOf({ de: 'die Tür', grammar: '-en' })).toBe(null);
      expect(drills.LauxOf({ de: 'schnell' })).toBe(null);
      // An impersonal entry spells the subject out again, so there is no clean
      // auxiliary to ask for.
      expect(drills.LauxOf({ de: 'geben', grammar: 'es gibt, es hat gegeben' })).toBe(null);
    });
  });

  describe('blanking a word out of its own example', () => {
    const span = (c: Card) => drills.LclozeSpan(c);

    it('finds the word where it stands unchanged', () => {
      expect(span({ de: 'die Blume', example: 'Die Blume ist schön.（这朵花很美。）' }))
        .toEqual({ before: 'Die ', word: 'Blume', after: ' ist schön.' });
    });

    it('covers the whole inflected form, not just the stem', () => {
      expect(span({ de: 'international', example: 'Frankfurt hat einen internationalen Flughafen.（…）' })?.word)
        .toBe('internationalen');
      expect(span({ de: 'kaufen', example: 'Ich kaufe ein Brot.（我买一个面包。）' })?.word).toBe('kaufe');
    });

    // A wrong blank is worse than no question: it asks for a word that is not
    // the one missing.
    it('says nothing when the word is not recoverable from the sentence', () => {
      // separable verb, split across the clause
      expect(span({ de: 'zuordnen', example: 'Ordnen Sie die Bilder zu.（请把图片配对。）' })).toBe(null);
      // strong stem change
      expect(span({ de: 'sein', example: 'Hallo, ich bin Julia.（…）' })).toBe(null);
      expect(span({ de: 'die Tür', example: '' })).toBe(null);
    });

    it('will not blank a two-letter word out of the middle of a longer one', () => {
      // "an" must not swallow the "An" of "Anna"
      expect(span({ de: 'an', example: 'Ich heiße Anna.（我叫安娜。）' })).toBe(null);
    });

    it('takes the dictionary form or the form the sentence uses', () => {
      const c: Card = { de: 'kaufen', example: 'Ich kaufe ein Brot.（我买一个面包。）' };
      const s = span(c)!;
      expect(drills.LclozeAccepted(c, s, 'kaufe')).toBe(true);
      expect(drills.LclozeAccepted(c, s, 'kaufen')).toBe(true);
      expect(drills.LclozeAccepted(c, s, 'trinke')).toBe(false);
    });

    it('splits the two languages the example field packs together', () => {
      const c: Card = { de: 'die Blume', example: 'Die Blume ist schön.（这朵花很美。）' };
      expect(learn.LexampleDe(c)).toBe('Die Blume ist schön.');
      expect(learn.LexampleZh(c)).toBe('这朵花很美。');
      expect(learn.LexampleZh({ de: 'x', example: 'Nur Deutsch.' })).toBe('');
    });
  });
});

// Scheduling is the whole product: a word that comes back too late is forgotten
// and one that never comes back was never really learnt.
describe('when a word comes back', () => {
  const documentStub = { addEventListener: () => {} };
  type S = Record<string, unknown>;
  const srs = (progress: Record<string, S> = {}, cards: unknown[] = []) =>
    load<{
      Linterval(s: S): number;
      Lmastered(s: S): boolean;
      LspotCards(n: number): Array<{ id: string }>;
      LdueCards(): Array<{ id: string }>;
      LtomorrowCount(): number;
    }>('learn.core.js', '{ Linterval, Lmastered, LspotCards, LdueCards, LtomorrowCount }', {
      DWStore: { KEYS: { LEARN: 'l' }, read: () => progress, onMigrated: () => {}, prefs: () => ({}), queue: () => {} },
      document: documentStub,
      CARDS: cards,
    });

  const DAY = 24 * 60 * 60 * 1000;
  const card = (id: string) => ({ id, level: 'A1', chapter: '1', de: id });
  const mastered = (due: number, extra: S = {}) =>
    ({ introduced: true, strength: 5, cycles: 3, spellingPass: true, known: false, due, ...extra });

  it('keeps stretching the gap past the fortnight it used to stop at', () => {
    const { Linterval } = srs();
    const at = (cycles: number) => Linterval({ cycles, spellingPass: true, hard: 0 });
    expect(at(0)).toBe(10 * 60 * 1000);
    expect(at(1)).toBe(DAY);
    expect(at(2)).toBe(3 * DAY);
    expect(at(3)).toBe(14 * DAY);
    // A deck that takes a year to work through needs the far end of the ladder;
    // it used to flatten out here and the word was dropped instead.
    expect(at(4)).toBe(30 * DAY);
    expect(at(5)).toBe(90 * DAY);
    expect(at(12)).toBe(90 * DAY);
  });

  // The lapse used to leave the word due in ten minutes, so every mistake made
  // in a round came straight back as 到期复习 on the home screen: the more you
  // got wrong, the longer the list, and the list is what people feel.
  describe('a missed question is asked again before the round ends', () => {
    type Q = { type: string; c: { id: string }; spot?: boolean; retry?: boolean; tries?: number; closes?: string };
    const round = (progress: Record<string, S> = {}, spelling = true) => {
      const api = load<{
        Lrecord(c: { id: string }, ok: boolean, type: string): { again: boolean; tomorrow: boolean };
        Lstate(c: { id: string }): S;
        Lmastered(s: S): boolean;
        queue(): Q[];
        start(q: Q[]): void;
        advance(): void;
      }>('learn.core.js', '{ Lrecord, Lstate, Lmastered, queue: () => learnQueue, start: (q) => { learnQueue = q; learnPos = 0; learnSpelling = spelling }, advance: () => { learnPos++ } }', {
        DWStore: { KEYS: { LEARN: 'l' }, read: () => progress, onMigrated: () => {}, prefs: () => ({}), queue: () => {} },
        // Lsave refreshes the counters after every answer; the stub has no elements
        document: { ...documentStub, getElementById: () => null },
        CARDS: [],
        spelling,
      });
      return api;
    };
    const w = { id: 'w' };
    const HOUR = 60 * 60 * 1000;

    it('appends the same question to the end of the round, once', () => {
      const api = round();
      api.start([{ type: 'spell', c: w }]);
      const r = api.Lrecord(w, false, 'spell');
      expect(r.again).toBe(true);
      expect(api.queue()).toHaveLength(2);
      expect(api.queue()[1]).toMatchObject({ type: 'spell', c: w, retry: true, tries: 1 });
      // until it is answered, the word is only a ten-minute lapse (an abandoned round)
      expect((api.Lstate(w).due as number) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    });

    it('sends a repaired word to tomorrow with no cycle credit', () => {
      const api = round();
      api.start([{ type: 'spell', c: w }]);
      api.Lrecord(w, false, 'spell');
      api.advance();
      api.Lrecord(w, true, 'spell');
      const s = api.Lstate(w);
      expect(s.cycles).toBe(0);
      expect(s.spellingPass).toBe(true);
      const gap = (s.due as number) - Date.now();
      expect(gap).toBeGreaterThan(23 * HOUR);
      expect(gap).toBeLessThan(25 * HOUR);
    });

    it('gives up after two retries and says tomorrow instead of ten minutes', () => {
      const api = round();
      api.start([{ type: 'recognize', c: w }]);
      expect(api.Lrecord(w, false, 'recognize').again).toBe(true);
      api.advance();
      expect(api.Lrecord(w, false, 'recognize').again).toBe(true);
      api.advance();
      const last = api.Lrecord(w, false, 'recognize');
      expect(last.again).toBe(false);
      expect(last.tomorrow).toBe(true);
      expect(api.queue()).toHaveLength(3);
      expect((api.Lstate(w).due as number) - Date.now()).toBeGreaterThan(23 * HOUR);
    });

    // A review round asks for the spelling only from words that have never
    // written themselves from memory. The rest close on the reverse question,
    // and that has to be what moves them up the ladder, or their interval would
    // never grow and the same words would come back every day for ever.
    it('moves a word up the ladder on whatever stage closes its round', () => {
      const api = round({ w: { introduced: true, strength: 3, cycles: 1, spellingPass: true, due: 1 } });
      api.start([{ type: 'reverse', c: w, closes: 'reverse' }]);
      api.Lrecord(w, true, 'reverse');
      expect(api.Lstate(w).cycles).toBe(2);
      const gap = (api.Lstate(w).due as number) - Date.now();
      expect(gap).toBeGreaterThan(2.9 * 24 * HOUR);   // 3 days: the rung above
      expect(gap).toBeLessThan(3.1 * 24 * HOUR);
    });

    it('does not move it up on a stage the round has not finished with', () => {
      const api = round({ w: { introduced: true, strength: 3, cycles: 1, spellingPass: false, due: 1 } });
      api.start([{ type: 'reverse', c: w, closes: 'spell' }, { type: 'spell', c: w, closes: 'spell' }]);
      api.Lrecord(w, true, 'reverse');
      expect(api.Lstate(w).cycles).toBe(1);
      api.advance();
      api.Lrecord(w, true, 'spell');
      expect(api.Lstate(w).cycles).toBe(2);
    });

    it('costs a mastered word one rung of the ladder, not the whole ladder', () => {
      const api = round({ w: { introduced: true, strength: 5, cycles: 3, spellingPass: true, known: true, due: 1 } });
      api.start([{ type: 'spell', c: w, spot: true }]);
      api.Lrecord(w, false, 'spell');
      expect(api.Lmastered(api.Lstate(w))).toBe(false);
      expect(api.queue()[1]).toMatchObject({ spot: true, retry: true });
      api.advance();
      api.Lrecord(w, true, 'spell');
      const s = api.Lstate(w);
      expect(s.cycles).toBe(2);
      expect(api.Lmastered(s)).toBe(false);
      const gap = (s.due as number) - Date.now();
      expect(gap).toBeGreaterThan(2.9 * 24 * HOUR);
      expect(gap).toBeLessThan(3.1 * 24 * HOUR);
    });
  });

  it('brings a mastered word back once its interval is up, oldest first', () => {
    const now = Date.now();
    const { LspotCards, LdueCards } = srs(
      { a: mastered(now - DAY), b: mastered(now + 30 * DAY), c: mastered(now - 2 * DAY) },
      ['a', 'b', 'c'].map(card));
    expect(LspotCards(5).map((c) => c.id)).toEqual(['c', 'a']);
    // and never through the ordinary queue, which is for words still being learnt
    expect(LdueCards()).toEqual([]);
  });

  it('caps a day’s spot checks so they cannot crowd out the actual review', () => {
    const now = Date.now();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const progress = Object.fromEntries(ids.map((id, i) => [id, mastered(now - (i + 1) * DAY)]));
    expect(srs(progress, ids.map(card)).LspotCards(5)).toHaveLength(5);
  });

  it('checks a word claimed with 这个我已经会 rather than taking its word for it', () => {
    const now = Date.now();
    // That button set a due date 30 days out and Lmastered ignored it, so the
    // claim was never tested: clicking it simply deleted the word from the app.
    const claimed = mastered(now - 1, { known: true });
    const { Lmastered, LspotCards } = srs({ a: claimed }, [card('a')]);
    expect(Lmastered(claimed)).toBe(true);
    expect(LspotCards(5).map((c) => c.id)).toEqual(['a']);
  });

  it('counts tomorrow, so an empty today does not read as an empty deck', () => {
    const now = Date.now();
    const { LtomorrowCount } = srs({
      a: { introduced: true, due: now + 2 * 60 * 60 * 1000 },
      b: { introduced: true, due: now + 5 * DAY },
      c: { introduced: false, due: now + 60 * 1000 },
    }, ['a', 'b', 'c'].map(card));
    expect(LtomorrowCount()).toBe(1);
  });
});

// A word can mean something different in the chapter you met it in, and the deck
// marks that with a 这里：/ hier: prefix. Among four options it was a tell.
describe('a chapter-specific sense', () => {
  const documentStub = { addEventListener: () => {} };
  type C = { id?: string; level?: string; chapter?: string; de: string; zh?: string; en?: string };
  const opts = (cards: C[] = []) =>
    load<{
      LsenseFree(s: string): string;
      LoptionEn(c: C): string;
      Ldistractors(c: C, count?: number, labelOf?: (c: C) => string): C[];
    }>('learn.core.js', '{ LsenseFree, LoptionEn, Ldistractors }', {
      DWStore: { KEYS: { LEARN: 'l' }, read: () => ({}), onMigrated: () => {}, prefs: () => ({}), queue: () => {} },
      document: documentStub, CARDS: cards,
    });

  it('drops the marker, wherever in the meaning it sits', () => {
    const { LsenseFree } = opts();
    expect(LsenseFree('这里：情况还好；进行得顺利')).toBe('情况还好；进行得顺利');
    expect(LsenseFree('还；仍然；这里：任何')).toBe('还；仍然；任何');
    expect(LsenseFree('hier: to be okay')).toBe('to be okay');
    expect(LsenseFree('yet, even, hier: any')).toBe('yet, even, any');
  });

  it('leaves alone the words that merely look like the marker', () => {
    const { LsenseFree, LoptionEn } = opts();
    // the entry for the word hier is itself 这里, with no colon
    expect(LsenseFree('这里')).toBe('这里');
    expect(LsenseFree('hierarchical')).toBe('hierarchical');
    expect(LoptionEn({ de: 'hierarchisch', en: 'hierarchical' })).toBe('hierarchical');
    // and a meaning that is nothing but the marker keeps something to show
    expect(LsenseFree('这里：')).toBe('这里：');
  });

  // Removing the tell exposed a question with two right answers, which the tell
  // had been hiding: both entries for gehen are correct meanings of gehen.
  it('never offers another sense of the same word as a wrong answer', () => {
    const cards: C[] = [
      { id: 'g1', level: 'A1', chapter: '1', de: 'gehen', en: 'to go' },
      { id: 'g2', level: 'A1', chapter: '1', de: 'gehen', en: 'hier: to be okay' },
      { id: 'k', level: 'A1', chapter: '1', de: 'kaufen', en: 'to buy' },
      { id: 'l', level: 'A1', chapter: '1', de: 'lesen', en: 'to read' },
      { id: 's', level: 'A1', chapter: '1', de: 'sehen', en: 'to see' },
      { id: 't', level: 'A1', chapter: '1', de: 'trinken', en: 'to drink' },
    ];
    const { Ldistractors } = opts(cards);
    for (const target of [cards[0], cards[1]]) {
      const picked = Ldistractors(target);
      expect(picked).toHaveLength(3);
      expect(picked.map((x) => x.de)).not.toContain('gehen');
    }
  });

  it('still separates two options that only differ by the marker', () => {
    // stripping must not be able to produce two identical buttons
    const cards: C[] = [
      { id: 'a', level: 'A1', chapter: '1', de: 'laufen', en: 'hier: to run' },
      { id: 'b', level: 'A1', chapter: '1', de: 'rennen', en: 'to run' },
      { id: 'c', level: 'A1', chapter: '1', de: 'kaufen', en: 'to buy' },
      { id: 'd', level: 'A1', chapter: '1', de: 'lesen', en: 'to read' },
      { id: 'e', level: 'A1', chapter: '1', de: 'sehen', en: 'to see' },
    ];
    const { Ldistractors, LoptionEn } = opts(cards);
    const picked = Ldistractors(cards[0]);
    expect(picked.map((x) => x.de)).not.toContain('rennen');
    expect(new Set([cards[0], ...picked].map(LoptionEn)).size).toBe(4);
  });
});

// Five thousand words in file order is not a curriculum. The daily plan handed
// out the first unlearned words it found, so somebody halfway through A2 was fed
// A1 Kapitel 1 every morning; and there was no way to look a word up at all.
describe('where you are in a deck this size', () => {
  type Row = { id: string; level: string; chapter: string; de: string; zh?: string; en?: string; grammar?: string };
  const documentStub = { addEventListener: () => {}, getElementById: () => null };
  type Progress = Record<string, { introduced?: boolean; known?: boolean; cycles?: number; strength?: number; spellingPass?: boolean; due?: number }>;
  type Group = { level: string; chapter: string; cards: Row[] };

  const learnAt = (cards: Row[], prefs: Record<string, unknown> = {}, progress: Progress = {}) =>
    load<{
      LfreshCards(n: number): Row[];
      LchapGroups(): Group[];
      LposGroup(): Group | null;
      LposIndex(): number;
      Lunlearned(c: Row): boolean;
      Lstate(c: Row): Record<string, unknown>;
      Lmastered(s: Record<string, unknown>): boolean;
    }>('learn.core.js',
      '{ LfreshCards, LchapGroups, LposGroup, LposIndex, Lunlearned, Lstate, Lmastered }',
      {
        DWStore: { KEYS: { LEARN: 'l' }, read: () => progress, onMigrated: () => {}, prefs: () => prefs, queue: () => {} },
        document: documentStub,
        CARDS: cards,
      });

  // Written so a chapter's words are findable by name: the Kapitel a word lands
  // in is the whole point of every assertion below.
  const word = (level: string, chapter: string, de: string): Row =>
    ({ id: `${level}-${chapter}-${de}`, level, chapter, de, zh: de, en: de });
  const DECK: Row[] = [
    word('A1', '1', 'Hallo'), word('A1', '1', 'danke'),
    word('A2', '7', 'die Rechnung'), word('A2', '7', 'aufstehen'),
    word('A1', '2', 'das Haus'),
    word('A2', '8', 'die Meinung'),
    word('B1', '1', 'verschwinden'),
  ];
  const learnt = { introduced: true, cycles: 1, strength: 2, due: 0 };

  it('orders the deck by level and Kapitel, not by where the rows happen to sit', () => {
    // A1 Kapitel 2 is written after A2 Kapitel 7 in this file, as chapters added
    // later always are. Reading position off file order would step over it.
    const g = learnAt(DECK).LchapGroups();
    expect(g.map((x) => `${x.level}K${x.chapter}`)).toEqual(['A1K1', 'A1K2', 'A2K7', 'A2K8', 'B1K1']);
  });

  it('starts the new words at the Kapitel you said you were on', () => {
    const l = learnAt(DECK, { posLevel: 'A2', posChapter: '7' });
    expect(l.LfreshCards(3).map((c) => c.de)).toEqual(['die Rechnung', 'aufstehen', 'die Meinung']);
  });

  it('still starts at the beginning when nobody has said where they are', () => {
    // The position is new; every existing install has none, and must behave as
    // it did yesterday rather than silently jumping somewhere.
    expect(learnAt(DECK).LfreshCards(2).map((c) => c.de)).toEqual(['Hallo', 'danke']);
  });

  it('moves on by itself once the Kapitel you are on is finished', () => {
    const done: Progress = { 'A2-7-die Rechnung': { ...learnt }, 'A2-7-aufstehen': { ...learnt } };
    const l = learnAt(DECK, { posLevel: 'A2', posChapter: '7' }, done);
    const g = l.LposGroup();
    expect(`${g!.level}K${g!.chapter}`).toBe('A2K8');
    expect(l.LfreshCards(1).map((c) => c.de)).toEqual(['die Meinung']);
  });

  it('goes back for what was stepped over, but only once nothing is left ahead', () => {
    const ahead: Progress = {
      'A2-7-die Rechnung': { ...learnt }, 'A2-7-aufstehen': { ...learnt },
      'A2-8-die Meinung': { ...learnt }, 'B1-1-verschwinden': { ...learnt },
    };
    // A1 was skipped over when the position was set; reporting the deck finished
    // while those words sit unlearned would be a lie.
    expect(learnAt(DECK, { posLevel: 'A2', posChapter: '7' }, ahead).LfreshCards(5).map((c) => c.de))
      .toEqual(['Hallo', 'danke', 'das Haus']);
  });

  it('treats a word waved through as learnt, not as new', () => {
    const waved: Progress = { 'A2-7-die Rechnung': { introduced: true, known: true } };
    const l = learnAt(DECK, { posLevel: 'A2', posChapter: '7' }, waved);
    expect(l.LfreshCards(2).map((c) => c.de)).toEqual(['aufstehen', 'die Meinung']);
    expect(l.Lmastered(l.Lstate(DECK[2]))).toBe(true);
  });

  it('reports no position rather than guessing one when the Kapitel is gone', () => {
    // Swapping in a deck that has no A2 Kapitel 7 must not leave the plan stuck.
    const l = learnAt(DECK, { posLevel: 'A2', posChapter: '99' });
    expect(l.LposIndex()).toBe(-1);
    expect(l.LfreshCards(1).map((c) => c.de)).toEqual(['Hallo']);
  });
});

describe('finding one word among five thousand', () => {
  type Row = { id: string; level: string; chapter: string; de: string; zh?: string; en?: string; grammar?: string };
  const documentStub = { addEventListener: () => {}, getElementById: () => null };
  const DECK: Row[] = [
    { id: '1', level: 'A1', chapter: '1', de: 'die Tür', zh: '门', en: 'door' },
    { id: '2', level: 'A1', chapter: '2', de: 'der Bruder', zh: '哥哥；弟弟', en: 'brother' },
    { id: '3', level: 'A2', chapter: '6', de: 'die Rechnung', zh: '账单', en: 'bill, invoice', grammar: 'Plural: die Rechnungen' },
    { id: '4', level: 'A2', chapter: '6', de: 'rechnen', zh: '计算', en: 'to calculate' },
    { id: '5', level: 'B1', chapter: '1', de: 'die Tüte', zh: '袋子', en: 'bag' },
  ];
  // The same 这里：-stripping the options use, so a chapter note never decides
  // which search result comes first.
  const senseFree = load<(s: string) => string>('learn.core.js', 'LsenseFree',
    { DWStore: { KEYS: { LEARN: 'l' }, read: () => ({}), onMigrated: () => {}, prefs: () => ({}), queue: () => {} }, document: documentStub });
  const browse = load<{
    LbrowseFind(q: string): Row[];
    LfoldBase(s: string): string;
    LfoldAe(s: string): string;
  }>('browse-addon.js', '{ LbrowseFind, LfoldBase, LfoldAe }',
    { document: documentStub, LallLearningCards: () => DECK, LsenseFree: senseFree });

  it('finds a word by its German, its Chinese or its English', () => {
    expect(browse.LbrowseFind('Rechnung').map((c) => c.id)).toEqual(['3']);
    expect(browse.LbrowseFind('账单').map((c) => c.id)).toEqual(['3']);
    expect(browse.LbrowseFind('invoice').map((c) => c.id)).toEqual(['3']);
  });

  it('finds an umlaut from a keyboard that has none, spelled either way', () => {
    // Nobody types ü on a phone in a hurry. Both conventions have to land.
    expect(browse.LbrowseFind('tur').map((c) => c.de)).toEqual(['die Tür']);
    expect(browse.LbrowseFind('tuer').map((c) => c.de)).toEqual(['die Tür']);
    expect(browse.LbrowseFind('Tür').map((c) => c.de)).toEqual(['die Tür']);
  });

  it('does not read an honest ue as an umlaut', () => {
    // Folding the query instead of the deck would turn `Bruder` into `Brder`
    // and lose it — so the deck is folded both ways and the query left alone.
    expect(browse.LbrowseFind('bruder').map((c) => c.id)).toEqual(['2']);
    expect(browse.LfoldBase('der Bruder')).toBe('der bruder');
    expect(browse.LfoldAe('die Tür')).toBe('die tuer');
  });

  it('puts the word you typed above the words that merely contain it', () => {
    expect(browse.LbrowseFind('rechnen')[0].de).toBe('rechnen');
    expect(browse.LbrowseFind('rechn').map((c) => c.de)).toEqual(['die Rechnung', 'rechnen']);
  });

  it('ranks an exact Chinese sense above a word that merely contains it', () => {
    // 花 is 花园's first character. Ranking German alone left 花园 on top, which
    // is the wrong answer to a one-character query.
    const withGarden = [...DECK, { id: '6', level: 'A1', chapter: '1', de: 'der Garten', zh: '花园', en: 'garden' },
      { id: '7', level: 'A1', chapter: '4', de: 'die Blume', zh: '花', en: 'flower' }];
    const b = load<{ LbrowseFind(q: string): Row[] }>('browse-addon.js', '{ LbrowseFind }',
      { document: documentStub, LallLearningCards: () => withGarden, LsenseFree: senseFree });
    expect(b.LbrowseFind('花').map((c) => c.de)).toEqual(['die Blume', 'der Garten']);
  });

  it('does not let a 这里： note decide the ranking', () => {
    const sensed = [{ id: '8', level: 'A1', chapter: '1', de: 'gut', zh: '好；好的', en: 'good' },
      { id: '9', level: 'A1', chapter: '4', de: 'gut', zh: '这里：好的；没问题', en: 'hier: okay' }];
    const b = load<{ LbrowseFind(q: string): Row[] }>('browse-addon.js', '{ LbrowseFind }',
      { document: documentStub, LallLearningCards: () => sensed, LsenseFree: senseFree });
    // Both are exact hits on 好的; neither is demoted for carrying the prefix.
    expect(b.LbrowseFind('好的').map((c) => c.id)).toEqual(['8', '9']);
  });

  it('searches the word-form column too, and says nothing when there is nothing', () => {
    expect(browse.LbrowseFind('Rechnungen').map((c) => c.id)).toEqual(['3']);
    expect(browse.LbrowseFind('Fahrrad')).toEqual([]);
    expect(browse.LbrowseFind('   ')).toEqual([]);
  });
});

// Two more columns the deck has always carried and the app has only ever
// printed: which preposition a word governs, and what a verb does to its own
// stem in the third person.
describe('the two things a Chinese gloss cannot tell you', () => {
  type Card = { id?: string; level?: string; chapter?: string; de: string; zh?: string; en?: string; grammar?: string };
  const documentStub = { addEventListener: () => {}, getElementById: () => null };
  const DWStoreStub = { KEYS: { LEARN: 'l' }, read: () => ({}), onMigrated: () => {}, prefs: () => ({}), queue: () => {} };
  const learn = load<{ Lnorm(s: string): string; LsenseFree(s: string): string; Lmeaning(c: Card): string; Lenglish(c: Card): string; LhasZh(c: Card): boolean; Lshuffle<T>(a: T[]): T[] }>(
    'learn.core.js', '{ Lnorm, LsenseFree, Lmeaning, Lenglish, LhasZh, Lshuffle }', { DWStore: DWStoreStub, document: documentStub });

  type Rek = { kind: 'prep'; combos: Array<{ prep: string; kase: string }> } | { kind: 'case'; cases: string[]; isPrep: boolean } | null;
  type Conj = { inf: string; present: string; past: string; perfect: string; aux: string; participle: string; separable: boolean; regular: boolean; multiword: boolean } | null;
  const drillsOver = (cards: Card[]) => load<{
    LrektionOf(c: Card): Rek;
    LrektionHint(c: Card): string;
    LrektionAccepted(c: Card, picked: string): boolean;
    LrektionOptions(c: Card): string[];
    LrektionCombos(): string[];
    LconjOf(c: Card): Conj;
    LconjAsk(c: Card, i: number): string;
    LconjAccepted(c: Card, ask: string, input: string): boolean;
  }>('drills-addon.js',
    '{ LrektionOf, LrektionHint, LrektionAccepted, LrektionOptions, LrektionCombos, LconjOf, LconjAsk, LconjAccepted }',
    { DWStore: DWStoreStub, document: documentStub, CARDS: cards, Lnorm: learn.Lnorm, LsenseFree: learn.LsenseFree,
      DWInsight: load<any>('insight.js', 'DWInsight'),
      Lenglish: learn.Lenglish, Lshuffle: learn.Lshuffle,
      // In the app the Chinese lives in a ZH map keyed by id, filled from c.zh
      // at boot; here it is read off the card, which is the same value.
      Lmeaning: (c: Card) => c.zh || learn.Lenglish(c), LhasZh: (c: Card) => !!c.zh });

  describe('which preposition, and which case', () => {
    const warten: Card = { id: 'w', de: 'warten', zh: '等待（auf +A 等某人／某事）', en: 'to wait (auf +A)' };
    const sprechen: Card = { id: 's', de: 'sprechen', zh: '说；讲（mit +D 和某人说；über +A 谈论）', en: 'to speak' };
    const aus: Card = { id: 'a', de: 'aus', zh: '这里：来自（+三格）', en: 'hier: from (+D)' };
    const d = drillsOver([warten, sprechen, aus]);

    it('reads the preposition and the case out of the gloss', () => {
      expect(d.LrektionOf(warten)).toEqual({ kind: 'prep', combos: [{ prep: 'auf', kase: '四格' }] });
    });

    it('keeps both prepositions when a verb governs two', () => {
      // sprechen mit +D and sprechen über +A are both right, so neither may be
      // offered as the other's wrong answer.
      const r = d.LrektionOf(sprechen)!;
      expect(r.kind).toBe('prep');
      expect((r as { combos: Array<{ prep: string }> }).combos.map((x) => x.prep)).toEqual(['mit', 'über']);
      expect(d.LrektionAccepted(sprechen, 'mit + 三格')).toBe(true);
      expect(d.LrektionAccepted(sprechen, 'über + 四格')).toBe(true);
      expect(d.LrektionAccepted(sprechen, 'auf + 四格')).toBe(false);
      expect(d.LrektionOptions(sprechen)).not.toContain('über + 四格');
    });

    it('asks a preposition about its own case instead of about itself', () => {
      expect(d.LrektionOf(aus)).toEqual({ kind: 'case', cases: ['三格'], isPrep: true });
      expect(d.LrektionOptions(aus)).toEqual(['三格', '四格', '二格']);
      expect(d.LrektionAccepted(aus, '三格')).toBe(true);
      expect(d.LrektionAccepted(aus, '四格')).toBe(false);
    });

    it('takes the answer back out of the hint', () => {
      // The gloss writes the answer in brackets. Printing it under the question
      // is the same tell the multiple-choice options used to have.
      expect(d.LrektionHint(warten)).toBe('等待');
      expect(d.LrektionHint(sprechen)).toBe('说；讲');
      expect(d.LrektionHint(aus)).toBe('来自');
      for (const c of [warten, sprechen, aus]) expect(d.LrektionHint(c)).not.toMatch(/\+\s*(A|D|G|三格|四格|二格)/);
    });

    it('says nothing rather than guessing at a case marker loose in prose', () => {
      // The deck writes a Rektion note as its own bracket. A `+A` in the middle
      // of running text is not one, and neither is a noun a preposition.
      const noise: Card = { id: 'n', de: 'das Haus', zh: '房子（很大 +A 的那种）', en: 'house' };
      expect(drillsOver([noise]).LrektionOf(noise)).toBe(null);
    });

    it('asks a dative verb about its case without calling it a preposition', () => {
      // helfen takes the dative with no preposition at all — Ich helfe dir,
      // never dich. Same three answers, different question.
      const helfen: Card = { id: 'h', de: 'helfen', zh: '帮助（+D 帮某人）', en: 'to help (+D)' };
      const r = drillsOver([helfen]).LrektionOf(helfen)!;
      expect(r).toEqual({ kind: 'case', cases: ['三格'], isPrep: false });
      const ausR = drillsOver([aus]).LrektionOf(aus)!;
      expect(ausR.kind === 'case' && ausR.isPrep).toBe(true);
    });
  });

  describe('what a verb does to its own stem', () => {
    const nehmen: Card = { id: 'n', de: 'nehmen', zh: '拿；取', grammar: 'er nimmt, hat genommen' };
    const aufstehen: Card = { id: 'a', de: 'aufstehen', zh: '起床', grammar: 'er steht auf, ist aufgestanden' };
    const kochen: Card = { id: 'k', de: 'kochen', zh: '做饭', grammar: 'er kocht, hat gekocht' };
    const sprechen: Card = { id: 's', de: 'sprechen', zh: '说', grammar: 'er spricht, sprach, hat gesprochen' };
    const d = drillsOver([nehmen, aufstehen, kochen, sprechen]);

    it('marks the stem change that nobody warns you about', () => {
      // One reading of the column serves the drills and the explanations alike,
      // so the auxiliary and the participle come out of the same call.
      expect(d.LconjOf(nehmen)).toEqual({
        inf: 'nehmen', present: 'nimmt', past: '', perfect: 'hat genommen',
        aux: 'haben', participle: 'genommen', separable: false, regular: false, multiword: false,
      });
      expect(d.LconjOf(kochen)!.regular).toBe(true);
    });

    it('knows a separable prefix goes to the end', () => {
      const k = d.LconjOf(aufstehen)!;
      expect(k.present).toBe('steht auf');
      expect(k.separable).toBe(true);
      expect(d.LconjAccepted(aufstehen, 'present', 'er steht auf')).toBe(true);
      expect(d.LconjAccepted(aufstehen, 'present', 'steht auf')).toBe(true);
      expect(d.LconjAccepted(aufstehen, 'present', 'aufsteht')).toBe(false);
    });

    it('scores er nimmt right and er nehmt wrong', () => {
      expect(d.LconjAccepted(nehmen, 'present', 'er nimmt')).toBe(true);
      expect(d.LconjAccepted(nehmen, 'present', 'nimmt')).toBe(true);
      expect(d.LconjAccepted(nehmen, 'present', 'nehmt')).toBe(false);
    });

    it('reaches the Präteritum the B1 entries carry, and only those', () => {
      expect(d.LconjOf(sprechen)!.past).toBe('sprach');
      // Alternating by position keeps a round predictable; a two-form entry has
      // no Präteritum to ask for, so it never gets that question.
      expect(d.LconjAsk(sprechen, 1)).toBe('past');
      expect(d.LconjAsk(sprechen, 0)).toBe('present');
      expect(d.LconjAsk(nehmen, 1)).toBe('present');
      expect(d.LconjAccepted(sprechen, 'past', 'sprach')).toBe(true);
      expect(d.LconjAccepted(sprechen, 'past', 'spricht')).toBe(false);
    });

    it('refuses a multi-word entry rather than asking a question about half of it', () => {
      const spazieren: Card = { id: 'z', de: 'spazieren gehen', zh: '散步', grammar: 'er geht spazieren, ist spazieren gegangen' };
      const plural: Card = { id: 'p', de: 'die Frage', zh: '问题', grammar: 'Plural: die Fragen' };
      const dd = drillsOver([spazieren, plural]);
      expect(dd.LconjOf(spazieren)).toBe(null);
      expect(dd.LconjOf(plural)).toBe(null);
    });
  });
});

// bleiben–blieb–geblieben and schreiben–schrieb–geschrieben are one pattern, not
// two facts. The class comes off the three forms the deck already carries, so it
// costs nothing per word — but a pattern read wrongly is worse than none.
describe('why a verb changes the way it does', () => {
  const DWInsight = load<any>('insight.js', 'DWInsight');
  type Card = { de: string; zh?: string; en?: string; grammar?: string; level?: string; chapter?: string };
  const verb = (de: string, grammar: string, zh = de, level = 'A1', chapter = '1'): Card =>
    ({ de, zh, en: de, grammar, level, chapter });
  const STRONG: Card[] = [
    verb('bleiben', 'er bleibt, blieb, ist geblieben'),
    verb('schreiben', 'er schreibt, schrieb, hat geschrieben'),
    verb('scheinen', 'er scheint, schien, hat geschienen'),
    verb('beschreiben', 'er beschreibt, beschrieb, hat beschrieben'),
    verb('nehmen', 'er nimmt, nahm, hat genommen'),
    verb('sprechen', 'er spricht, sprach, hat gesprochen'),
    verb('treffen', 'er trifft, traf, hat getroffen'),
    verb('gehen', 'er geht, ging, ist gegangen'),
    verb('kaufen', 'er kauft, hat gekauft'),
  ];

  it('reads the class off the three forms, prefix and all', () => {
    // verschreiben's first vowel is the e of ver-; the stem vowel is what the
    // class is about.
    expect(DWInsight.LablautClass(STRONG[0])).toBe('ei–ie–ie');
    expect(DWInsight.LablautClass(STRONG[3])).toBe('ei–ie–ie');
    expect(DWInsight.LablautClass(STRONG[4])).toBe('e–a–o');
    expect(DWInsight.LablautClass(STRONG[7])).toBe('e–i–a');
  });

  it('shows the other verbs that change the same way', () => {
    const ab = DWInsight.Lablaut(STRONG[0], STRONG);
    expect(ab.label).toBe('ei → ie → ie');
    expect(ab.family).toEqual(['schreiben', 'scheinen', 'beschreiben']);
  });

  it('says nothing about a verb with no Präteritum to compare', () => {
    // A1 and A2 entries carry two forms, not three. There is no class to read.
    expect(DWInsight.LablautClass(STRONG[8])).toBe(null);
    expect(DWInsight.Lablaut(STRONG[8], STRONG)).toBe(null);
  });

  it('refuses a triple that is not a class German has', () => {
    // Which is also what catches a stem vowel read wrongly: an invented class
    // would otherwise look exactly like a real finding.
    expect(DWInsight.LablautClass(verb('quaxen', 'er quaxt, quox, hat gequuxen'))).toBe(null);
  });

  it('needs a family before it calls something a pattern', () => {
    const lonely = [verb('nehmen', 'er nimmt, nahm, hat genommen'), verb('kaufen', 'er kauft, hat gekauft')];
    expect(DWInsight.Lablaut(lonely[0], lonely)).toBe(null);
  });

  describe('haben or sein', () => {
    // "sein means motion" explains 89% of this deck's ist-verbs and misfires on
    // eight hat-verbs, which is below the bar for stating a rule. Nothing here
    // predicts the auxiliary: it names the group only once the card has said ist.
    const MOVERS: Card[] = [
      verb('gehen', 'er geht, ging, ist gegangen'),
      verb('kommen', 'er kommt, kam, ist gekommen'),
      verb('fahren', 'er fährt, fuhr, ist gefahren'),
      verb('anziehen', 'er zieht an, zog an, hat angezogen'),
    ];

    it('explains the sein a card has already declared', () => {
      const se = DWInsight.Lsein(MOVERS[0], MOVERS);
      expect(se.participle).toBe('gegangen');
      expect(se.family).toEqual(['kommen → ist gekommen', 'fahren → ist gefahren']);
    });

    it('stays silent on a haben verb, however much it looks like motion', () => {
      // anziehen is the ziehen family splitting: transitive takes haben.
      expect(DWInsight.Lsein(MOVERS[3], MOVERS)).toBe(null);
      expect(DWInsight.Lanalyse(MOVERS[3], MOVERS).some((r: any) => r.kind === 'aux')).toBe(false);
    });
  });

  describe('one word, two entries', () => {
    const SPLIT: Card[] = [
      { de: 'der Rock', zh: '裙子', level: 'A1', chapter: '3' },
      { de: 'der Rock', zh: '摇滚乐', level: 'A2', chapter: '12' },
      { de: 'der Gefallen', zh: '人情；帮忙', level: 'B1', chapter: '2' },
      { de: 'das Gefallen', zh: '喜爱', level: 'B1', chapter: '7' },
      { de: 'gut', zh: '这里：好的；没问题', level: 'A1', chapter: '4' },
      { de: 'gut', zh: '好；好地', level: 'A1', chapter: '1' },
    ];

    it('points at the other sense instead of leaving two right answers around', () => {
      const s = DWInsight.Lsenses(SPLIT[0], SPLIT);
      expect(s).toEqual([{ art: 'der', sense: '摇滚乐', where: 'A2 K12', gendered: false }]);
    });

    it('calls out the pair that differs only by its article', () => {
      const s = DWInsight.Lsenses(SPLIT[2], SPLIT);
      expect(s[0].gendered).toBe(true);
      const row = DWInsight.Lanalyse(SPLIT[2], SPLIT).find((r: any) => r.kind === 'senses');
      expect(row.label).toBe('换个性别就换个意思');
      expect(row.text).toContain('das Gefallen = 喜爱');
    });

    it('strips the 这里： note before comparing, and before showing', () => {
      const s = DWInsight.Lsenses(SPLIT[5], SPLIT);
      expect(s).toEqual([{ art: '', sense: '好的；没问题', where: 'A1 K4', gendered: false }]);
    });

    it('says nothing when the same word is listed twice with the same meaning', () => {
      const same = [{ de: 'die Tür', zh: '门', level: 'A1', chapter: '1' }, { de: 'die Tür', zh: '门', level: 'A2', chapter: '3' }];
      expect(DWInsight.Lsenses(same[0], same)).toEqual([]);
    });
  });
});

// The deck the app ships is every first visitor's first impression. Four of the
// seven drills were empty on it; this pins that they never go empty again.
describe('the starter deck shows every drill working', () => {
  const documentStub = { addEventListener: () => {}, getElementById: () => null };
  const DWStoreStub = { KEYS: { LEARN: 'l' }, read: () => ({}), onMigrated: () => {}, prefs: () => ({}), queue: () => {} };
  const raw = JSON.parse(readFileSync(new URL('../src/starter-deck.json', import.meta.url), 'utf8'));
  const cards: Array<Record<string, string>> = (raw.cards as Array<Record<string, string>>).map((c, i) => ({ ...c, id: `s${i}`, chapter: String(c.chapter) }));
  const src = ['insight.js', 'learn.core.js', 'drills-addon.js']
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n');
  const api = new Function('DWStore', 'document', 'window', 'CARDS',
    `${src}\nZH=Object.fromEntries(CARDS.filter(c=>c.zh).map(c=>[c.id,c.zh]));\nreturn { LdrillPoolFor, DWInsight };`)(
    DWStoreStub, documentStub, {}, cards) as { LdrillPoolFor(kind: string): unknown[]; DWInsight: any };

  it.each(['gender', 'plural', 'conj', 'aux', 'rektion', 'cloze', 'dictation'])('has at least eight %s questions', (kind) => {
    expect(api.LdrillPoolFor(kind).length).toBeGreaterThanOrEqual(8);
  });

  it('carries examples in the format the app itself defines, with the Chinese half', () => {
    const withExample = cards.filter((c) => c.example);
    expect(withExample.length).toBeGreaterThanOrEqual(60);
    for (const c of withExample) expect(c.example, c.de).toMatch(/^[^（）]+（[^（）]+）$/);
  });

  it('lets the insight panel explain sein for the verbs that take it', () => {
    let sein = 0;
    for (const c of cards) for (const r of api.DWInsight.Lanalyse(c, cards)) if (r.kind === 'aux') sein++;
    expect(sein).toBeGreaterThanOrEqual(5);
  });
});
