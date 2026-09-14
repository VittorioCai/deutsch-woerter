# Deutsch Wörter

An installable, offline German vocabulary trainer. No account, no server, no
tracking: everything — your word list and your progress — stays in your browser.

Live at
[vittoriocai.github.io/deutsch-woerter](https://vittoriocai.github.io/deutsch-woerter/).

**It ships with no vocabulary.** You import your own word list once and it is
stored on your device. That is a deliberate choice, not a missing feature: most
usable word lists are somebody's copyrighted material, and publishing an app is
not a licence to redistribute them. It also means the app works for any German
course, not just the one it happened to be written for.

## What it does

- **今日任务** — one button: every word due for review across all chapters, plus a
  few new ones. Spaced repetition is supposed to decide what you study; the
  chapter pickers are there when you want them, not on the daily path.
- **学新词** — staged learning per chapter: meet the word, recognise its meaning,
  recall the German, then spell it, with spaced review between sessions. Spelling
  can be switched off for a recognition-only session — from the home screen as
  well as the learning panel, since 今日任务 starts from the home screen. Those
  words still advance through the review intervals but cannot reach 已掌握, which
  in this app means you can produce the word, not just recognise it.
- **单词检测** — the quiz: weak words first, both directions, spelling checked.
- **专项训练** — der/die/das, plural forms (derived from the grammar column), and
  dictation.
- **Pronunciation** — a recorded native pronunciation from Wikimedia Commons when
  one exists for the word, falling back to the best German voice the device has.

## The word list

Import from the first screen, or from 更换词库 later. Two formats:

**A spreadsheet saved as CSV or TSV.** The first row is a header. Only `de` is
required, and at least one of `zh` / `en`:

```csv
de,zh,en,level,chapter,grammar,example
das Haus,房子,house,A1,1,Plural: Häuser,Das Haus ist alt.
die Tür,门,door,A1,1,-en,
```

| Column | Meaning |
| --- | --- |
| `de` | the German word, with its article for nouns — required |
| `zh` | Chinese meaning, shown as the primary gloss |
| `en` | English meaning, used for the quiz and as a fallback gloss |
| `level` | any label you like (`A1`, `B2`, `Beruf`…) — defaults to `A1` |
| `chapter` | any label — defaults to `1` |
| `grammar` | plural marker, e.g. `Plural: Häuser`, `-en`, `"-e` (`"` = umlaut) |
| `example` | a sentence shown with the answer |

German, English, Chinese and a few other spellings of the header names are
accepted (`Deutsch`, `Kapitel`, `中文`, `释义`…).

**JSON**, which is what 导出词库 produces:

```json
{"name":"Mein Wortschatz","cards":[{"de":"das Haus","zh":"房子","level":"A1","chapter":"1"}]}
```

[`tests/fixtures/deck.json`](tests/fixtures/deck.json) is a small working
example.

Rows that cannot be used are listed before the import goes ahead, never dropped
quietly. Keep the row order stable: a word that appears twice in the same chapter
is told apart from its twin by its position.

## Your data

Progress, the spelling wrong-book and the mastered archive live in
`localStorage`; the word list lives in IndexedDB. Nothing is sent anywhere, which
also means nothing is backed up for you:

- **导出学习记录** writes a JSON backup. Do it every so often — a browser that
  clears site data takes your history with it. The app nags after 30 days.
- **导入学习记录** merges by default (newer record wins per word) rather than
  replacing, so restoring a backup from another device cannot wipe this one.
- **导出词库** writes your word list back out. Keep it somewhere you can reach
  from your phone; you need it again on every new device.

Progress is keyed by a hash of `level|chapter|de`, not by a row number, so adding
or removing words never disturbs anything you have already learned — and a word
that exists in two different decks keeps its history across a swap. That hash is
computed identically in the browser and in `tests/data.test.ts`, with the
expected values pinned as literals: if that test ever needs updating, somebody's
learning history has just been orphaned.

## Local development

```sh
npm ci
npx playwright install chromium   # --with-deps on Linux
npm run dev                       # builds, then serves dist/ at 127.0.0.1:4321
```

Before committing, run the same gate CI runs:

```sh
npm run verify                    # tsc + vitest + build + playwright
```

The end-to-end suite brings its own small made-up deck
(`tests/fixtures/deck.json`) and imports it through the app's own parser, so a
broken import turns the whole suite red. It never touches the network: Wikimedia
is stubbed, because a test that quietly tests something different depending on
where it runs is worse than no test.

## Structure

`scripts/build.mjs` turns everything in `src/` into the files the page loads,
written to `dist/`. It runs as part of `npm run dev`, `npm test` and
`npm run build`; `dist/` is never committed.

| Edit | Generated into `dist/` |
| --- | --- |
| `src/index.html`, `src/learn.css`, `src/icon.svg`, `src/app.webmanifest` | copied as-is |
| `src/learn.core.js`, `src/wrongbook-addon.js`, `src/mastered-addon.js`, `src/drills-addon.js`, `src/md5.js` | `learn.js` |
| `src/store.js` | `store.js` |
| `src/deck.js` | `deck.js` |
| `src/sw.source.js` | `sw.js` |

`src/store.js` owns every read and write to `localStorage`, including the
one-time migration of progress saved under the pre-2026 id scheme. Writes are
batched, so anything that reads its own state back must keep an in-memory copy
and merge into that — re-reading storage inside a flush window sees a stale value
and silently drops the pending change.

`src/deck.js` owns the word list: parsing, the card ids, and IndexedDB. It
implements SHA-256 by hand rather than calling `crypto.subtle`, which is
unavailable outside a secure context and asynchronous on top; one code path that
always produces the same digits matters more here than native speed, because
those digits are how your progress finds its words.

The service worker's cache name is derived from the content it caches, so a
deploy can never leave a returning visitor pinned to stale JavaScript.

## Licence

[MIT](LICENSE). The code only — any word list you import is yours and stays
yours.
