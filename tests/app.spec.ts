import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Regression cover for the vocabulary PWA's data-durability behaviour. Each test
// here maps to a way progress used to be lost or an answer used to be scored wrong.

const APP = '/';
const QUIZ_KEY = 'netzwerk_vocab_progress_pwa_v1';
const LEARN_KEY = 'netzwerk_vocab_learning_v1';
const WRONG_KEY = 'netzwerk_vocab_spelling_wrongbook_v1';
const SCHEMA_KEY = 'netzwerk_vocab_schema';

// The app ships with no vocabulary of its own, so every test brings its own deck.
// It is a small, made-up word list rather than a copy of anyone's textbook, and
// it is deliberately shaped like a real one: three chapters, two levels, nouns of
// all three genders, two words sharing a meaning, and one word listed twice.
const FIXTURE = readFileSync(new URL('./fixtures/deck.json', import.meta.url), 'utf8');

const deck = async (page: Page): Promise<Array<{ id: string; level: string; chapter: string; de: string }>> =>
  page.evaluate(() =>
    (window as any).__deck.cards.map((c: any) => ({ id: c.id, level: c.level, chapter: String(c.chapter), de: c.de })));

test.beforeEach(async ({ page }) => {
  await page.route('**://*.wikimedia.org/**', (route) => route.abort('failed'));
});

const ready = async (page: Page) => {
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#learnStartBtn')).toHaveText('开始学新词', { timeout: 20000 });
};

// Loading the app for the first time lands on the import gate. Seeding through
// the app's own parser and store (rather than writing IndexedDB by hand) keeps
// the fixture honest: if import breaks, every test here goes red.
const seedDeck = async (page: Page) => {
  await page.evaluate(async (raw) => {
    const d = (window as any).DWDeck;
    await d.save(d.parse(raw, 'fixture.json'));
  }, FIXTURE);
};

const open = async (page: Page) => {
  await page.goto(APP);
  if (await page.locator('#deckGate').isVisible()) {
    await seedDeck(page);
    await page.reload();
  }
  await ready(page);
};

test('loads cleanly with both modes available', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.locator('#learnMasteredBtn')).toHaveCount(1);
  await expect(page.locator('#learnWrongBtn')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('migrates progress saved under the old line-number ids', async ({ page }) => {
  await open(page);
  await page.evaluate(([quizKey, learnKey, schemaKey]) => {
    const quiz: Record<string, unknown> = {};
    const learn: Record<string, unknown> = {};
    for (let i = 1; i <= 25; i++) {
      quiz[`A1-1-${i}`] = { seen: 3, correct: 2, wrong: 1, mastery: 4, last: 1_700_000_000_000 };
      learn[`A1-1-${i}`] = { introduced: true, strength: 5, cycles: 3, spellingPass: true, wrong: 0, last: 1, due: 1, known: false };
    }
    localStorage.setItem(quizKey, JSON.stringify(quiz));
    localStorage.setItem(learnKey, JSON.stringify(learn));
    localStorage.removeItem(schemaKey);
  }, [QUIZ_KEY, LEARN_KEY, SCHEMA_KEY]);

  await page.reload();
  await ready(page);

  const cardIds = (await deck(page)).map((c) => c.id);
  const result = await page.evaluate(([learnKey, schemaKey, cardIds]) => {
    const learn = JSON.parse(localStorage.getItem(learnKey as string) || '{}');
    const ids = new Set(cardIds);
    return {
      total: Object.keys(learn).length,
      matched: Object.keys(learn).filter((k) => ids.has(k)).length,
      legacyLeft: Object.keys(learn).filter((k) => /^A1-1-\d+$/.test(k)).length,
      schema: localStorage.getItem(schemaKey as string),
    };
  }, [LEARN_KEY, SCHEMA_KEY, cardIds] as const);

  expect(result.matched).toBe(25);
  expect(result.total).toBe(25);
  expect(result.legacyLeft).toBe(0);
  expect(result.schema).toBe('2');
  await expect(page.locator('#dwNotice')).toContainText('迁移完成');
  await expect(page.locator('#homeMastered')).toHaveText('25');
});

for (const key of [QUIZ_KEY, LEARN_KEY, WRONG_KEY]) {
  test(`survives a corrupted ${key.replace('netzwerk_vocab_', '')} value`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page);
    await page.evaluate((k) => localStorage.setItem(k, '{"A1-1-1":'), key);
    await page.reload();
    // A corrupted value used to throw at module scope and delete a whole mode
    // from the page; it must now reset just that store and say so.
    await ready(page);
    await expect(page.locator('#startBtn')).toBeEnabled();
    await expect(page.locator('#dwNotice')).toContainText('损坏');
    expect(errors).toEqual([]);
  });
}

test('importing a backup merges instead of replacing', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const [a, b, c] = [cards[0].id, cards[1].id, cards[9].id];
  await page.evaluate(([quizKey, schemaKey, a, b]) => {
    localStorage.setItem(quizKey, JSON.stringify({
      [a]: { seen: 9, correct: 9, wrong: 0, mastery: 5, last: 2000 },
      [b]: { seen: 1, correct: 1, wrong: 0, mastery: 1, last: 5000 },
    }));
    localStorage.setItem(schemaKey, '2');
  }, [QUIZ_KEY, SCHEMA_KEY, a, b] as const);
  await page.reload();
  await ready(page);

  const merged = await page.evaluate(async ([quizKey, a, b, c]) => {
    const backup = {
      version: 4,
      quizProgress: {
        [b]: { seen: 7, correct: 7, wrong: 0, mastery: 5, last: 9000 },
        [c]: { seen: 2, correct: 2, wrong: 0, mastery: 2, last: 3000 },
      },
      learnProgress: {},
      spellingWrongBook: {},
    };
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(backup)], 'b.json', { type: 'application/json' }));
    const input = document.getElementById('fileImport') as HTMLInputElement;
    input.files = dt.files;
    window.alert = () => {};
    window.confirm = () => true; // merge
    input.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 500));
    const after = JSON.parse(localStorage.getItem(quizKey) || '{}');
    return { keptLocal: !!after[a], addedRemote: !!after[c], newerWins: after[b]?.last === 9000, count: Object.keys(after).length };
  }, [QUIZ_KEY, a, b, c] as const);

  expect(merged.keptLocal).toBe(true);
  expect(merged.addedRemote).toBe(true);
  expect(merged.newerWins).toBe(true);
  expect(merged.count).toBe(3);
});

test('scores German-to-English answers on whole meanings, not substrings', async ({ page }) => {
  await open(page);
  const verdicts = await page.evaluate(() => {
    (document.getElementById('direction') as HTMLSelectElement).value = 'de-en';
    const check = (en: string, input: string) =>
      (window as any).accepted({ de: 'x', en, level: 'A1', chapter: '1', id: 't' }, input);
    return {
      rejected: [
        check('to understand', 'unde'),
        check('the neighbour', 'neigh'),
        check('to go', 'to g'),
        check('holiday resort', 'holiday'),
      ],
      accepted: [
        check('to understand', 'understand'),
        check('the neighbour', 'neighbour'),
        check('here: alright', 'alright'),
        check('to complain/exchange', 'exchange'),
      ],
    };
  });
  expect(verdicts.rejected).toEqual([false, false, false, false]);
  expect(verdicts.accepted).toEqual([true, true, true, true]);
});

test('a missed word comes back this session instead of in two weeks', async ({ page }) => {
  await open(page);
  const a1k1 = (await deck(page)).filter((c) => c.level === 'A1' && String(c.chapter) === '1').map((c) => c.id);
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 5, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: false, cycles: 3, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, a1k1] as const);
  await page.reload();
  await ready(page);

  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '1');
  await page.locator('#learnReviewBtn').click();
  await expect(page.locator('#learnBody .choice').first()).toBeVisible();

  const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), LEARN_KEY);
  const byId = new Map((await deck(page)).map((c) => [c.id, c]));
  const shown = ((await page.locator('#learnBody .learnWord').innerText()) || '').trim();
  const optionIds = await page.locator('#learnBody .choice').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.id ?? ''),
  );
  // A card with a different German form necessarily has a different id, which is
  // what Lchoice() compares, so this click is deterministically a miss.
  const wrongIndex = optionIds.findIndex((id) => (byId.get(id)?.de ?? '').trim() !== shown);
  expect(wrongIndex, `no option distinguishable from "${shown}" in ${JSON.stringify(optionIds)}`).toBeGreaterThanOrEqual(0);
  await page.locator('#learnBody .choice').nth(wrongIndex).click();
  await expect(page.locator('#learnBody .choice.wrong')).toHaveCount(1);
  await expect(page.locator('#learnNextBtn')).toBeVisible();

  const after = await page.evaluate((k) => {
    (window as any).DWStore.flush();
    return JSON.parse(localStorage.getItem(k) || '{}');
  }, LEARN_KEY);
  const changed = Object.entries(after).filter(([id, v]) => JSON.stringify(v) !== JSON.stringify(before[id]));
  expect(changed).toHaveLength(1);
  const state = changed[0][1] as any;
  // Linterval() keys off cycles, which was never decremented on a miss, so a word
  // with three cycles behind it used to be rescheduled 14 days out.
  expect(state.due - Date.now()).toBeLessThanOrEqual(11 * 60 * 1000);
  expect(state.cycles).toBe(2);
  expect(state.spellingPass).toBe(false);
});

test('never renders the correct answer twice in one multiple-choice question', async ({ page }) => {
  await open(page);
  // A1 Kapitel 1 contains several words that share a meaning ("Deutsch"/"Deutsch",
  // "das Würstchen"/"das Würstchen", five words glossed "the"), which used to
  // produce two identical options with only one counted correct.
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '1');
  await page.selectOption('#learnCount', '15');
  await page.locator('#learnStartBtn').click();

  let questions = 0;
  for (let step = 0; step < 70; step++) {
    if (/本轮完成/.test((await page.locator('#learnBadge').textContent()) || '')) break;
    const choices = page.locator('#learnBody .choice');
    if (await choices.count()) {
      const texts = await choices.allInnerTexts();
      const normalised = texts.map((t) => t.trim().toLowerCase().replace(/\s+/g, ' '));
      expect(new Set(normalised).size, `duplicate option in ${JSON.stringify(texts)}`).toBe(texts.length);
      expect(texts.length).toBe(4);
      questions++;
      await choices.nth(0).click();
      await page.locator('#learnNextBtn').click();
      continue;
    }
    if (await page.locator('#learnRemember').count()) {
      await page.locator('#learnRemember').click();
      continue;
    }
    if (await page.locator('#learnAnswer').count()) {
      await page.locator('#learnAnswer').fill('zzz');
      await page.locator('#learnSubmit').click();
      await page.locator('#learnNextBtn').click();
      continue;
    }
    break;
  }
  expect(questions).toBeGreaterThanOrEqual(20);
});

test('?mastered=1 opens the mastered archive', async ({ page }) => {
  await open(page);
  const firstId = (await deck(page))[0].id;
  await page.evaluate(([learnKey, schemaKey, id]) => {
    localStorage.setItem(learnKey, JSON.stringify({
      [id]: { introduced: true, strength: 5, cycles: 3, spellingPass: true, known: true, wrong: 0, last: 1, due: 1 },
    }));
    localStorage.setItem(schemaKey, '2');
  }, [LEARN_KEY, SCHEMA_KEY, firstId] as const);
  await page.goto(`${APP}?mastered=1`);
  await expect(page.locator('#masteredOverlay')).toBeVisible();
  await expect(page.locator('#masteredContent')).toContainText('已掌握 1 个');
});

test('batches writes instead of re-serialising the whole store per answer', async ({ page }) => {
  await open(page);
  const card = (await deck(page))[10];
  const result = await page.evaluate((card) => {
    const save = (window as any).save;
    let writes = 0;
    const real = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => { writes++; return real(k, v); };
    for (let i = 0; i < 30; i++) save(card, i % 2 === 0);
    const during = writes;
    (window as any).DWStore.flush();
    const total = writes;
    localStorage.setItem = real;
    return { during, total };
  }, card);
  expect(result.during).toBe(0);
  expect(result.total).toBeGreaterThanOrEqual(1);
});

test('today card clears due words across chapters in one session', async ({ page }) => {
  await open(page);
  // Due words spread over three different Kapitel. Review used to be locked to
  // whichever chapter the picker showed, so this needed three separate sessions.
  const cards = await deck(page);
  const pick = ['1', '2', '3'].map((ch) => cards.filter((c) => c.level === 'A1' && String(c.chapter) === ch).slice(0, 4));
  const ids = pick.flat().map((c) => c.id);
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 3, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: false, cycles: 1, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, ids] as const);
  await page.reload();
  await ready(page);

  await expect(page.locator('#todayCount')).toHaveText(/\d+/);
  await expect(page.locator('#todayBreak')).toContainText('12 个到期复习');
  await page.locator('#goToday').click();
  await expect(page.locator('#learnCard')).toBeVisible();
  await expect(page.locator('#learnBadge')).toContainText('1/');

  // The queue length is the proof that it spans chapters: each due word costs
  // three stages, so 12 due words across three Kapitel means at least 36 items.
  // Chapter-locked review would have found only the 4 words in one Kapitel.
  const total = Number((await page.locator('#learnBadge').textContent())!.match(/\/(\d+)/)![1]);
  expect(total).toBeGreaterThanOrEqual(36);
});

test('gender drill asks for der/die/das and scores per article', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await expect(page.locator('#drillOverlay')).toBeVisible();
  await expect(page.locator('#drillContent')).toContainText('性别专项');
  await page.locator('#drillStart').click();

  const buttons = page.locator('#drillContent .genderGrid button');
  await expect(buttons).toHaveCount(3);
  await expect(buttons.nth(0)).toHaveText('der');
  // the prompt must hide the article, or the question answers itself
  await expect(page.locator('.drillWord')).not.toContainText(/^(der|die|das)\s/);
  await buttons.nth(0).click();
  await expect(page.locator('#drillContent .genderGrid button.correct')).toHaveCount(1);
  await expect(page.locator('#drillNext')).toBeVisible();
  await page.locator('#drillNext').click();
  await expect(page.locator('.drillWord')).toBeVisible();

  await page.locator('#drillClose').click();
  await page.locator('#learnDrillBtn').click();
  await expect(page.locator('#drillContent')).toContainText('%'); // per-article accuracy recorded
});

test('plural drill accepts every attested plural of the same noun', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabPlural').click();
  await expect(page.locator('#drillContent')).toContainText('复数专项');
  await page.locator('#drillStart').click();
  await expect(page.locator('#drillAnswer')).toBeVisible();
  // the German character bar must be reachable from the plural input
  await expect(page.locator('.charBar[data-target="drillAnswer"] .charKey')).toHaveCount(7);
  await page.locator('.charBar[data-target="drillAnswer"] .charKey', { hasText: 'ä' }).first().click();
  await expect(page.locator('#drillAnswer')).toHaveValue('ä');
  await page.locator('#drillShow').click();
  await expect(page.locator('#drillFeedback')).toContainText('正确答案');
  await expect(page.locator('#drillFeedback .deAnswer')).toContainText('die ');
});

test('wrong-book explains what kind of mistake was made', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const noun = cards.find((c) => /^die\s/.test(c.de))!;
  await page.evaluate(([wrongKey, schemaKey, noun]) => {
    const n = noun as { id: string; level: string; chapter: string; de: string };
    const stem = n.de.replace(/^die\s+/, '');
    localStorage.setItem(wrongKey as string, JSON.stringify({
      u: { id: 'u', level: 'A1', chapter: '1', de: 'die Bücher', zh: '书', en: 'books', wrongCount: 1, lastAt: 3, lastInput: 'die Bucher' },
      a: { id: 'a', level: 'A1', chapter: '1', de: n.de, zh: '', en: 'x', wrongCount: 1, lastAt: 2, lastInput: `der ${stem}` },
      t: { id: 't', level: 'A1', chapter: '1', de: 'die Flasche', zh: '瓶子', en: 'bottle', wrongCount: 1, lastAt: 1, lastInput: 'die Flashe' },
    }));
    localStorage.setItem(schemaKey as string, '2');
  }, [WRONG_KEY, SCHEMA_KEY, noun] as const);
  await page.reload();
  await ready(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnWrongBtn').click();
  await expect(page.locator('#wrongOverlay')).toBeVisible();
  const summary = page.locator('.causeBox');
  await expect(summary).toContainText('错因分析');
  await expect(summary).toContainText('变音漏写或写错');
  await expect(summary).toContainText('冠词错');
  await expect(summary).toContainText('拼写接近');
});

test('dictation asks by ear and does not leak the word', async ({ page }) => {
  // Headless Chromium has no speech synthesis, so stub it and record what the
  // drill asks to be spoken — that is the actual question here.
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [{ lang: 'de-DE', name: 'stub' }],
        speak: (u: { text: string }) => (window as any).__spoken.push(u.text),
      },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; constructor(t: string) { this.text = t } };
  });
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabDictation').click();
  await expect(page.locator('#drillContent')).toContainText('听写');
  await page.locator('#drillStart').click();
  await expect(page.locator('#drillAnswer')).toBeVisible();

  // the word is spoken shortly after the input renders, not with it
  await page.waitForFunction(() => ((window as any).__spoken as string[]).length > 0);
  const spoken = await page.evaluate(() => (window as any).__spoken as string[]);
  const word = spoken[spoken.length - 1];
  // The prompt must not show the word, its meaning, or its English gloss.
  const shown = await page.locator('#drillContent').innerText();
  expect(shown).not.toContain(word);

  await page.locator('#drillAnswer').fill(word);
  await page.locator('#drillCheck').click();
  await expect(page.locator('#drillFeedback')).toContainText('对了');
  // the meaning appears only after answering
  await expect(page.locator('#drillFeedback .meta')).not.toHaveText('');
});

test('the revealed answer can be played back in every mode', async ({ page }) => {
  await page.route('**upload.wikimedia.org/**', (route) => route.fulfill({ status: 404, body: 'no' }));
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [{ lang: 'de-DE', name: 'stub' }],
        speak: (u: { text: string }) => (window as any).__spoken.push(u.text),
      },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; constructor(t: string) { this.text = t } };
  });
  await open(page);

  // quiz: answer one question and play the answer back
  await page.locator('#goQuiz').click();
  await page.locator('#startBtn').click();
  await page.locator('#showBtn').click();
  const quizSpeak = page.locator('#feedback .speakBtn');
  await expect(quizSpeak).toHaveCount(1);
  await quizSpeak.click();
  // speech is asynchronous now: a recording is tried before synthesis
  await expect.poll(() => page.evaluate(() => ((window as any).__spoken as string[]).length)).toBe(1);

  // learning mode: same button on the revealed answer
  await page.locator('#modeBack').click();
  await page.locator('#goLearn').click();
  await page.locator('#learnStartBtn').click();
  // a group is five introductions before the first recognition question
  for (let i = 0; i < 6 && !(await page.locator('#learnBody .choice').count()); i++) {
    await page.locator('#learnRemember').click();
  }
  await page.locator('#learnBody .choice').first().click();
  await expect(page.locator('#learnFeedback .speakBtn')).toHaveCount(1);
});

test('remembers the level and Kapitel across reloads', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A2');
  await page.selectOption('#learnChapter', '5');
  await page.evaluate(() => (window as any).DWStore.flush());
  expect(await page.evaluate(() => localStorage.getItem('netzwerk_vocab_prefs_v1')))
    .toBe(JSON.stringify({ level: 'A2', chapter: '5' }));

  await page.reload();
  await ready(page);
  await page.locator('#goLearn').click();
  await expect(page.locator('#learnLevel')).toHaveValue('A2');
  await expect(page.locator('#learnChapter')).toHaveValue('5');
});

test('spelling can be switched off without stalling review pacing', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '1');
  await page.selectOption('#learnCount', '5');
  await page.locator('#learnSpellToggle').uncheck();
  await expect(page.locator('#learnSpellNote')).toContainText('不会进入「已掌握」');
  await page.locator('#learnStartBtn').click();

  const lookup = await page.evaluate(() => {
    const clean = (s: string) => (s || '').replace(/^[_\-–—\s]+/, '').replace(/\s*\([^)]*\)\s*$/, ' ').trim();
    const byId: Record<string, { de: string; meaning: string }> = {};
    for (const c of (window as any).__deck.cards) byId[c.id] = { de: c.de, meaning: c.zh || clean(c.en) };
    return byId;
  });
  const answerCorrectly = async () => {
    const ids = await page.locator('#learnBody .choice').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.id ?? ''));
    const german = (await page.locator('#learnBody .learnWord').count())
      ? ((await page.locator('#learnBody .learnWord').innerText()) || '').trim() : null;
    const meaning = (await page.locator('#learnBody .learnZh').count())
      ? ((await page.locator('#learnBody .learnZh').innerText()) || '').trim() : null;
    const idx = ids.findIndex((id) => german ? lookup[id]?.de === german : lookup[id]?.meaning === meaning);
    expect(idx, `no option matched ${JSON.stringify(german ?? meaning)}`).toBeGreaterThanOrEqual(0);
    await page.locator('#learnBody .choice').nth(idx).click();
    await expect(page.locator('#learnBody .choice.wrong')).toHaveCount(0);
    await page.locator('#learnNextBtn').click();
  };

  const stages: string[] = [];
  for (let step = 0; step < 40; step++) {
    const badge = (await page.locator('#learnBadge').textContent()) || '';
    if (/本轮完成/.test(badge)) break;
    stages.push(badge);
    if (await page.locator('#learnRemember').count()) { await page.locator('#learnRemember').click(); continue }
    if (await page.locator('#learnBody .choice').count()) { await answerCorrectly(); continue }
    break;
  }
  // no spelling stage was ever queued, and the input never appeared
  expect(stages.filter((s) => /主动拼写/.test(s))).toHaveLength(0);
  expect(stages.filter((s) => /认识新词/.test(s)).length).toBe(5);
  // guard against the assertion above going vacuous again: the same walk with
  // spelling on must find the stage
  expect(stages.some((s) => /看意思认出德语|第 2 层/.test(s))).toBe(true);

  // Linterval keys off cycles, which only advanced on a correct spelling. If the
  // round never closed, every word would sit on the 10-minute step and come back
  // forever — the reverse stage has to close it instead.
  const state = await page.evaluate((k) => {
    (window as any).DWStore.flush();
    const learn = JSON.parse(localStorage.getItem(k) || '{}');
    return Object.values(learn) as Array<{ cycles: number; spellingPass: boolean; due: number }>;
  }, LEARN_KEY);
  const advanced = state.filter((s) => (s.cycles || 0) >= 1);
  expect(advanced.length).toBeGreaterThan(0);
  for (const s of advanced) {
    expect(s.due - Date.now()).toBeGreaterThan(60 * 60 * 1000); // pushed past the 10-minute step
    expect(s.spellingPass).toBeFalsy(); // but not credited with spelling
  }
});

test('a word cannot reach mastered while spelling is off', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const target = cards.find((c) => c.level === 'A1' && String(c.chapter) === '1')!;
  // three completed cycles and full strength — everything except having spelled it
  await page.evaluate(([learnKey, schemaKey, id]) => {
    localStorage.setItem(learnKey, JSON.stringify({
      [id]: { introduced: true, strength: 5, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: false, cycles: 3, known: false },
    }));
    localStorage.setItem(schemaKey, '2');
  }, [LEARN_KEY, SCHEMA_KEY, target.id] as const);
  await page.reload();
  await ready(page);
  await expect(page.locator('#homeMastered')).toHaveText('0');
  // and it is still offered for review rather than archived
  await expect(page.locator('#todayBreak')).toContainText('到期复习');
});


test('the spelling toggle reaches review and the daily session too', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const due = cards.filter((c) => c.level === 'A1' && String(c.chapter) === '1').slice(0, 8).map((c) => c.id);
  const seed = async (spelling: boolean) => {
    await page.evaluate(([learnKey, schemaKey, prefsKey, ids, spelling]) => {
      const learn: Record<string, unknown> = {};
      for (const id of ids as string[]) {
        learn[id] = { introduced: true, strength: 3, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: false, cycles: 1, known: false };
      }
      localStorage.setItem(learnKey as string, JSON.stringify(learn));
      localStorage.setItem(schemaKey as string, '2');
      localStorage.setItem(prefsKey as string, JSON.stringify({ spelling }));
    }, [LEARN_KEY, SCHEMA_KEY, 'netzwerk_vocab_prefs_v1', due, spelling] as const);
    await page.reload();
    await ready(page);
  };
  // The badge is "第 3 层 · 主动拼写 · 5/24"; match the whole string, not a field.
  const walk = async () => {
    let total = 0, spell = 0;
    for (let i = 0; i < 80; i++) {
      const badge = (await page.locator('#learnBadge').textContent()) || '';
      if (/本轮完成/.test(badge)) break;
      total++;
      if (/主动拼写/.test(badge)) spell++;
      if (await page.locator('#learnRemember').count()) { await page.locator('#learnRemember').click(); continue }
      if (await page.locator('#learnBody .choice').count()) {
        await page.locator('#learnBody .choice').first().click();
        await page.locator('#learnNextBtn').click();
        continue;
      }
      if (await page.locator('#learnAnswer').count()) {
        await page.locator('#learnAnswer').fill('zzz');
        await page.locator('#learnSubmit').click();
        await page.locator('#learnNextBtn').click();
        continue;
      }
      break;
    }
    return { total, spell };
  };

  await seed(true);
  await page.locator('#goLearn').click();
  await page.locator('#learnReviewBtn').click();
  const withSpelling = await walk();
  expect(withSpelling.spell).toBeGreaterThan(0);

  await seed(false);
  await page.locator('#goLearn').click();
  await page.locator('#learnReviewBtn').click();
  const withoutSpelling = await walk();
  expect(withoutSpelling.spell).toBe(0);
  expect(withoutSpelling.total).toBeLessThan(withSpelling.total);

  // 今日任务 starts from the home screen, so the setting has to be reachable there
  await seed(false);
  await expect(page.locator('#homeSpellToggle')).toBeVisible();
  await expect(page.locator('#homeSpellToggle')).not.toBeChecked();
  await expect(page.locator('#homeSpellHint')).toContainText('已关闭拼写');
  await page.locator('#goToday').click();
  expect((await walk()).spell).toBe(0);
});

test('the two spelling toggles stay in sync', async ({ page }) => {
  await open(page);
  await expect(page.locator('#homeSpellToggle')).toBeChecked();
  await page.locator('#homeSpellToggle').uncheck();
  await page.locator('#goLearn').click();
  await expect(page.locator('#learnSpellToggle')).not.toBeChecked();
  await page.locator('#learnSpellToggle').check();
  await page.locator('#modeBack').click();
  await expect(page.locator('#homeSpellToggle')).toBeChecked();
  await expect(page.locator('#homeSpellHint')).toHaveText('');
});

test('speech picks the best German voice the device has', async ({ page }) => {
  await page.route('**upload.wikimedia.org/**', (route) => route.fulfill({ status: 404, body: 'no' }));
  // A realistic Apple + Google mix: the default the browser would have chosen is
  // the compact one, which is exactly what made pronunciation sound robotic.
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    const voices = [
      { name: 'Anna (Compact)', lang: 'de-DE', voiceURI: 'anna-compact', localService: true },
      { name: 'Grandma (German (Germany))', lang: 'de-DE', voiceURI: 'grandma', localService: true },
      { name: 'Anna (Enhanced)', lang: 'de-DE', voiceURI: 'anna-enhanced', localService: true },
      { name: 'Google Deutsch', lang: 'de-DE', voiceURI: 'google-de', localService: false },
      { name: 'Anna (Premium)', lang: 'de-DE', voiceURI: 'anna-premium', localService: true },
      { name: 'Markus', lang: 'de-AT', voiceURI: 'markus-at', localService: true },
      { name: 'Samantha', lang: 'en-US', voiceURI: 'sam', localService: true },
    ];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        addEventListener() {},
        getVoices: () => voices,
        speak: (u: any) => (window as any).__spoken.push({ text: u.text, voice: u.voice?.voiceURI, rate: u.rate }),
      },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t } };
  });
  await open(page);
  await page.locator('#goLearn').click();

  // English is excluded; the premium German voice wins
  const options = await page.locator('#voicePick option').allTextContents();
  expect(options.some((o) => /Samantha/.test(o))).toBe(false);
  expect(options[0]).toContain('Premium');
  expect(options[0]).toContain('★');

  await page.locator('#voiceTest').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.length)).toBe(1);
  const first = await page.evaluate(() => (window as any).__spoken[0]);
  expect(first.voice).toBe('anna-premium');
  expect(first.rate).toBe(0.85);

  // an explicit choice is honoured and persists
  await page.selectOption('#voicePick', 'google-de');
  await page.selectOption('#voiceRate', '0.7');
  await page.evaluate(() => (window as any).DWStore.flush());
  await page.reload();
  await ready(page);
  await page.locator('#goLearn').click();
  await page.locator('#voiceTest').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.length)).toBeGreaterThan(0);
  const after = await page.evaluate(() => {
    const s = (window as any).__spoken as Array<{ voice: string; rate: number }>;
    return s[s.length - 1];
  });
  expect(after.voice).toBe('google-de');
  expect(after.rate).toBe(0.7);
});

test('says how to get a better voice when only basic ones exist', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {}, addEventListener() {}, speak() {},
        getVoices: () => [{ name: 'Anna (Compact)', lang: 'de-DE', voiceURI: 'anna-compact', localService: true }],
      },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t } };
  });
  await open(page);
  await page.locator('#goLearn').click();
  await expect(page.locator('#voiceHint')).toContainText('基础音质');
  await expect(page.locator('#voiceHint')).toContainText(/设置|系统设置|Chrome/);
});

test('handles a device with no German voice at all', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, addEventListener() {}, speak() {}, getVoices: () => [{ name: 'Samantha', lang: 'en-US', voiceURI: 'sam', localService: true }] },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t } };
  });
  await open(page);
  await page.locator('#goLearn').click();
  await expect(page.locator('#voicePick')).toBeDisabled();
  await expect(page.locator('#voiceHint')).toContainText('没有德语语音');
});

test('round size offers larger sets and remembers the choice', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  expect(await page.locator('#learnCount option').allTextContents())
    .toEqual(['5', '10', '15', '20', '30', '50']);
  await expect(page.locator('#learnCount')).toHaveValue('10');

  await page.selectOption('#learnCount', '30');
  await page.evaluate(() => (window as any).DWStore.flush());
  await page.reload();
  await ready(page);
  await page.locator('#goLearn').click();
  await expect(page.locator('#learnCount')).toHaveValue('30');

  // the size actually drives the session
  await page.selectOption('#learnCount', '20');
  await page.locator('#learnStartBtn').click();
  const total = Number((await page.locator('#learnBadge').textContent())!.match(/\/(\d+)/)![1]);
  expect(total).toBe(20 * 4); // intro + three stages per word
});

test('Android is told to install the German voice data, not just switch browser', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {}, addEventListener() {}, speak() {},
        // Android voices advertise nothing about their quality either way
        getVoices: () => [{ name: 'Deutsch (Deutschland)', lang: 'de-DE', voiceURI: 'de-de', localService: true }],
      },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t } };
  });
  await open(page);
  await page.locator('#goLearn').click();
  const hint = page.locator('#voiceHint');
  await expect(hint).toContainText('文字转语音');
  await expect(hint).toContainText('Google');
  // a voice that says nothing about its quality must not be called basic, nor starred
  await expect(hint).not.toContainText('基础音质');
  expect(await page.locator('#voicePick option').allTextContents()).toEqual(['Deutsch (Deutschland)']);
});

// Commons is not reachable from CI, so it is simulated: the point of these tests
// is the fetch/cache/fallback logic, and the URL shape is pinned separately in
// tests/data.test.ts against paths read off the real service.
const stubAudio = async (page: Page, opts: { status?: number } = {}) => {
  await page.addInitScript(() => {
    (window as any).__played = [];
    (window as any).__spoken = [];
    (window as any).Audio = class {
      src: string;
      onended: (() => void) | null = null;
      constructor(src: string) { this.src = src; (window as any).__played.push(src) }
      play() { return Promise.resolve() }
      pause() {}
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {}, addEventListener() {},
        getVoices: () => [{ name: 'Anna (Premium)', lang: 'de-DE', voiceURI: 'anna', localService: true }],
        speak: (u: { text: string }) => (window as any).__spoken.push(u.text),
      },
    });
    (window as any).SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t } };
  });
  const seen: string[] = [];
  await page.route('**upload.wikimedia.org/**', async (route) => {
    seen.push(route.request().url());
    if (opts.status && opts.status !== 200) return route.fulfill({ status: opts.status, body: 'no' });
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from([0xff, 0xfb, 0x90, 0x00]) });
  });
  return seen;
};

test('plays the recorded pronunciation and caches it', async ({ page }) => {
  const requests = await stubAudio(page);
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#voiceTest').click();   // speaks "Haus"

  await expect.poll(() => requests.length).toBe(1);
  // the exact path verified against the live service
  expect(requests[0]).toBe(
    'https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7e/De-Haus.ogg/De-Haus.ogg.mp3',
  );
  expect(await page.evaluate(() => (window as any).__played.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__spoken)).toEqual([]); // no synthesis

  // second play comes from the cache, not the network
  await page.locator('#voiceTest').click();
  await expect.poll(() => page.evaluate(() => (window as any).__played.length)).toBe(2);
  expect(requests.length).toBe(1);
});

test('falls back to synthesis when a word has no recording, and stops retrying it', async ({ page }) => {
  const requests = await stubAudio(page, { status: 404 });
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#voiceTest').click();

  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(['Haus']);
  expect(await page.evaluate(() => (window as any).__played)).toEqual([]);
  expect(requests.length).toBe(1);

  // a known miss is remembered, so the same word is not fetched again
  await page.locator('#voiceTest').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.length)).toBe(2);
  expect(requests.length).toBe(1);
});

test('recorded audio can be turned off', async ({ page }) => {
  const requests = await stubAudio(page);
  await open(page);
  await page.locator('#goLearn').click();
  await expect(page.locator('#recordedToggle')).toBeChecked();
  await expect(page.locator('#recordedNote')).toContainText('Wikimedia Commons');

  await page.locator('#recordedToggle').uncheck();
  await expect(page.locator('#recordedNote')).toContainText('只用设备语音合成');
  await page.locator('#voiceTest').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(['Haus']);
  expect(requests).toEqual([]);
});

test('a network failure still produces sound', async ({ page }) => {
  await stubAudio(page);
  await page.route('**upload.wikimedia.org/**', (route) => route.abort('failed'));
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#voiceTest').click();
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(['Haus']);
});

test('the first visit asks for a word list and keeps it afterwards', async ({ page }) => {
  await page.goto(APP);
  // Nothing is bundled with the app, so a fresh browser has no vocabulary at all.
  await expect(page.locator('#deckGate')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();

  await page.locator('#deckFile').setInputFiles({
    name: 'meine-woerter.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('de,zh,en,level,chapter\ndas Haus,房子,house,A1,1\ndie Tür,门,door,A1,1\n', 'utf8'),
  });
  await ready(page);
  await expect(page.locator('#deckInfo')).toContainText('2 个词条');
  await expect(page.locator('#bankInfo')).toContainText('A1 2');

  // and it is still there on the next visit, offline included
  await page.reload();
  await ready(page);
  await expect(page.locator('#deckGate')).toBeHidden();
  await expect(page.locator('#deckInfo')).toContainText('meine-woerter');
});

test('a deck the browser builds gets the same ids the old build shipped', async ({ page }) => {
  // The ids are the keys every progress record is filed under. If the browser
  // computed them differently from the build that produced the deployed site,
  // everyone's history would silently detach on the next visit.
  await open(page);
  const byWord = new Map((await deck(page)).map((c) => [`${c.level}|${c.chapter}|${c.de}`, c.id]));
  expect(byWord.get('A1|1|das Haus')).toBe('745f7f512f');
  expect(byWord.get('A1|1|die Tür')).toBe('c04e6fe0dd');
  expect(byWord.get('A2|5|der Bahnhof')).toBe('14b3aaa187');
});

test('swapping the deck keeps the progress of words both decks share', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const haus = cards.find((c) => c.de === 'das Haus')!;
  await page.evaluate(([learnKey, schemaKey, id]) => {
    localStorage.setItem(learnKey, JSON.stringify({
      [id]: { introduced: true, strength: 5, cycles: 3, spellingPass: true, known: true, wrong: 0, last: 1, due: 1 },
    }));
    localStorage.setItem(schemaKey, '2');
  }, [LEARN_KEY, SCHEMA_KEY, haus.id] as const);
  await page.reload();
  await ready(page);
  await expect(page.locator('#homeMastered')).toHaveText('1');

  page.on('dialog', (d) => d.accept());
  await page.locator('#deckFile').setInputFiles({
    name: 'anderer-wortschatz.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('de,zh,level,chapter\ndas Haus,房子,A1,1\ndas Boot,船,A1,1\n', 'utf8'),
  });
  await ready(page);

  await expect(page.locator('#deckInfo')).toContainText('2 个词条');
  // same word, same id, so the mastered record it already had is still its own
  await expect(page.locator('#homeMastered')).toHaveText('1');
  expect((await deck(page)).find((c) => c.de === 'das Haus')!.id).toBe(haus.id);
});

test('an unreadable file is refused with a reason, leaving the deck alone', async ({ page }) => {
  await open(page);
  const before = (await deck(page)).length;
  const dialogs: string[] = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.locator('#deckFile').setInputFiles({
    name: 'nonsense.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('alpha,beta\n1,2\n', 'utf8'),
  });
  await expect.poll(() => dialogs.length).toBeGreaterThan(0);
  expect(dialogs.join('\n')).toMatch(/de/);
  expect((await deck(page)).length).toBe(before);
});

test('the demo deck is one click away and is a working app, not a sample', async ({ page }) => {
  await page.goto(APP);
  // The first screen a stranger sees must not be a file picker: asking for a word
  // list before showing anything is how a visitor becomes a bounce.
  await expect(page.locator('#deckDemoBtn')).toBeVisible();
  await page.locator('#deckDemoBtn').click();
  await ready(page);

  const cards = await deck(page);
  expect(cards.length).toBeGreaterThan(250);
  await expect(page.locator('#deckInfo')).toContainText('示例词库');
  await expect(page.locator('#deckInfo')).toContainText('更换词库');

  // every mode has enough data to actually run
  await page.locator('#goLearn').click();
  expect(await page.locator('#learnLevel option').allTextContents()).toEqual(['A1', 'A2']);
  await page.locator('#learnStartBtn').click();
  await expect(page.locator('#learnBody .learnZh')).not.toHaveText('');
  await page.locator('#modeBack').click();

  await page.locator('#goQuiz').click();
  await page.locator('#startBtn').click();
  await expect(page.locator('#prompt')).not.toHaveText('');
  await page.locator('#modeBack').click();

  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await expect(page.locator('#drillStart')).toBeEnabled();
  await page.locator('#tabPlural').click();
  await expect(page.locator('#drillStart')).toBeEnabled();

  // and it survives the reload, like any imported deck
  await page.reload();
  await ready(page);
  await expect(page.locator('#deckGate')).toBeHidden();
});
