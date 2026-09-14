# Deutsch Wörter

A German vocabulary trainer for *Netzwerk neu* A1–B1, published as an installable
offline PWA at
[vittoriocai.github.io/deutsch-woerter](https://vittoriocai.github.io/deutsch-woerter/).

Two modes over the same 5452-word deck:

- **学新词** — staged learning per Kapitel: meet the word, recognise its meaning,
  recall the German, then spell it, with spaced review between sessions.
- **单词检测** — the quiz: weak words first, both directions, spelling checked.

Progress, the spelling wrong-book, and the mastered archive live in the browser's
`localStorage` and never leave the device. Export a backup from the home screen.

## Local development

```sh
npm ci
npx playwright install chromium   # --with-deps on Linux
npm run dev                       # builds, then serves dist/ at 127.0.0.1:4321
```

Before committing, run the same gate CI runs:

```sh
npm run verify
```

## Structure

`scripts/build.mjs` turns everything in `src/` into the files the page loads,
written to `dist/`. It runs as part of `npm run dev`, `npm test`, and
`npm run build`; `dist/` is never committed.

| Edit | Generated into `dist/` |
| --- | --- |
| `src/index.html`, `src/learn.css`, `src/icon.svg`, `src/app.webmanifest` | copied as-is |
| `src/learn.core.js`, `src/wrongbook-addon.js`, `src/mastered-addon.js` | `learn.js` |
| `src/store.js` | `store.js` |
| `src/sw.source.js` | `sw.js` |
| `src/data/cards-mini-*.txt` | `cards.json` |
| `src/data/zh-*.json` | `zh.json` |

`src/store.js` owns every read and write to `localStorage`, including the one-time
migration of progress saved under the pre-2026 id scheme.

## Rules that keep saved progress intact

Everything a learner accumulates is keyed by card id, so these are not style
preferences — breaking either one silently destroys data already sitting in
people's browsers.

- **Card ids are derived from the word, never from its position in the file.**
  Ids were once `${level}-${chapter}-${lineNumber}`; inserting a single word
  renumbered 99.8% of the deck and orphaned every saved record. `tests/data.test.ts`
  enforces the current scheme and that it survives an insertion.
- **The Chinese gloss files are positional arrays** resolved against the deck at
  build time. Adding or removing an A1/A2 word without updating the matching
  `src/data/zh-*.json` fails the build, and the error names the file to fix. This
  is deliberate: the mapping used to happen at runtime, where an off-by-one would
  silently mislabel every remaining word instead of failing.

The service worker's cache name is a hash of the files it caches, so any deploy
that changes an asset invalidates it automatically. Nothing is version-bumped by
hand — a stale cache name used to pin returning visitors to old JavaScript.

## Deployment

`.github/workflows/deploy.yml` runs the full gate on every pull request against
`main` and on every push to `main`. Only a push to `main` goes on to deploy
through GitHub Pages. Set the repository's Pages source to **GitHub Actions**.

The published path must stay `/deutsch-woerter/`: learners' progress is scoped to
that origin, and the installed PWA points at it.
