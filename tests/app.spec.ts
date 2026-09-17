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
const PREFS_KEY = 'netzwerk_vocab_prefs_v1';

// The app ships with no vocabulary of its own, so every test brings its own deck.
// It is a small, made-up word list rather than a copy of anyone's textbook, and
// it is deliberately shaped like a real one: four chapters, two levels, nouns of
// all three genders, two words sharing a meaning, one word listed twice, and a
// chapter of verbs carrying the conjugation and example data the drills read.
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

test('a chapter-specific sense does not announce itself among the options', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '4');
  await page.selectOption('#learnCount', '10');
  await page.locator('#learnStartBtn').click();

  // Kapitel 4 holds gehen twice: 走；去 and 这里：进行得顺利. The marked one used
  // to be the only option wearing a 这里, which answers the question without
  // knowing the word — and its twin used to be offerable as a wrong answer,
  // which asks a question with two right answers.
  const options: string[] = [];
  const prompts: string[] = [];
  for (let i = 0; i < 140; i++) {
    const badge = (await page.locator('#learnBadge').textContent()) || '';
    if (/本轮完成/.test(badge)) break;
    if (await page.locator('#learnRemember').count()) { await page.locator('#learnRemember').click(); continue }
    const choices = page.locator('#learnBody .choice');
    if (await choices.count()) {
      const word = await page.locator('#learnBody .learnWord').count()
        ? (await page.locator('#learnBody .learnWord').textContent()) || '' : '';
      const texts = await choices.allTextContents();
      if (word) { prompts.push(word); if (word.trim() === 'gehen') expect(texts.filter((t) => /进行得顺利|走；去/.test(t))).toHaveLength(1) }
      options.push(...texts);
      await choices.first().click();
    } else if (/主动拼写/.test(badge)) {
      await page.locator('#learnShow').click();
    }
    await page.locator('#learnNextBtn').click();
  }

  expect(options.length).toBeGreaterThan(20);
  expect(prompts).toContain('gehen');
  expect(options.filter((t) => /这里|hier:/i.test(t))).toEqual([]);
});

test('a mastered word comes back for a spot check instead of vanishing', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const ids = cards.filter((c) => c.level === 'A1' && String(c.chapter) === '1').slice(0, 3).map((c) => c.id);
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    // exactly what 「这个我已经会」 leaves behind, with its interval elapsed
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 5, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: true, cycles: 3, known: true };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, ids] as const);
  await page.reload();
  await ready(page);

  await expect(page.locator('#homeMastered')).toHaveText('3');
  // these used to be gone for good; the daily session now checks a few
  await expect(page.locator('#todayBreak')).toContainText('3 个已掌握抽查');
  await page.locator('#goToday').click();
  await expect(page.locator('#learnBadge')).toContainText('已掌握抽查');
  await expect(page.locator('#learnAnswer')).toBeVisible();

  // and a missed check puts the word back into learning rather than leaving the
  // claim standing
  await page.locator('#learnAnswer').fill('nichtdaswort');
  await page.locator('#learnSubmit').click();
  await expect(page.locator('#learnFeedback')).toContainText('这次先记住它');
  await page.locator('#modeBack').click();
  await expect(page.locator('#homeMastered')).toHaveText('2');
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

test('a reflexive verb spelled with its sich is not marked wrong', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '4');
  await page.selectOption('#learnCount', '5');
  await page.locator('#learnSpellToggle').check();
  await page.locator('#learnStartBtn').click();

  // Walk the round until the reflexive verb comes up for active spelling. The
  // card teaches `sich freuen` in its meaning column but stores the bare
  // `freuen` as the headword, and the answer used to be scored against the
  // headword alone — so the learner who had absorbed the sich was the one
  // marked wrong.
  let typed = false;
  for (let i = 0; i < 80 && !typed; i++) {
    const badge = (await page.locator('#learnBadge').textContent()) || '';
    if (/本轮完成/.test(badge)) break;
    if (await page.locator('#learnRemember').count()) { await page.locator('#learnRemember').click(); continue }
    if (/主动拼写/.test(badge)) {
      const zh = (await page.locator('#learnBody .learnZh').textContent()) || '';
      if (/期待/.test(zh)) {
        expect(zh).toContain('sich');   // the only place the sich is ever shown
        await page.locator('#learnAnswer').fill('sich freuen');
        await page.locator('#learnSubmit').click();
        await expect(page.locator('#learnFeedback')).toContainText('✓ 对了');
        typed = true;
        break;
      }
      await page.locator('#learnShow').click();
    } else if (await page.locator('#learnBody .choice').count()) {
      await page.locator('#learnBody .choice').first().click();
    }
    await page.locator('#learnNextBtn').click();
  }
  expect(typed).toBe(true);
});

test('haben/sein drill asks for the auxiliary and scores each one apart', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabAux').click();
  await expect(page.locator('#drillContent')).toContainText('haben / sein');
  await page.locator('#drillStart').click();

  const buttons = page.locator('#drillContent .genderGrid button');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveText('haben');
  await expect(buttons.nth(1)).toHaveText('sein');
  // the prompt shows the participle only: printing hat/ist would answer it
  await expect(page.locator('.drillWord')).toContainText('___');
  await expect(page.locator('.drillWord')).not.toContainText(/\b(hat|ist)\b/);

  await buttons.nth(0).click();
  await expect(page.locator('#drillContent .genderGrid button.correct')).toHaveCount(1);
  await expect(page.locator('#drillFeedback .deAnswer')).toContainText(/^er (hat|ist) /);
  await page.locator('#drillNext').click();
  await expect(page.locator('.drillWord')).toBeVisible();

  // Guessing the commoner auxiliary scores well over half, so one combined
  // figure would flatter the learner the way a single gender score does.
  await page.locator('#drillClose').click();
  await page.locator('#learnDrillBtn').click();
  const rows = page.locator('#drillContent .drillRow');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('haben');
  await expect(rows.nth(1)).toContainText('sein');
});

test('cloze blanks the word out of its own example without leaking it', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabCloze').click();
  await expect(page.locator('#drillContent')).toContainText('例句填空');
  await page.locator('#drillStart').click();

  await expect(page.locator('.clozeBlank')).toHaveCount(1);
  const asked = (await page.locator('.clozeSentence').textContent()) || '';
  expect(asked.length).toBeGreaterThan(5);

  await page.locator('#drillShow').click();
  const answer = (await page.locator('#drillFeedback .clozeHit').textContent()) || '';
  expect(answer.length).toBeGreaterThan(2);
  // the question must not have contained the word it was asking for
  expect(asked).not.toContain(answer);
  // and the whole sentence, not just the word, can be played back
  await expect(page.locator('#drillFeedback .speakBtn')).toHaveAttribute('data-say', /\s/);
});

test('an example is shown in German first and read aloud whole', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '4');
  await page.locator('#learnStartBtn').click();

  await expect(page.locator('#learnBody .exampleDe')).toBeVisible();
  const de = (await page.locator('#learnBody .exampleDe').textContent()) || '';
  // the translation is packed into the same field but stays behind a tap
  expect(de).not.toMatch(/[一-鿿]/);
  await expect(page.locator('#learnBody .exampleZhShown')).toHaveCount(0);

  // every earlier spoken thing in the app was a single word
  const say = await page.locator('#learnBody .example .speakBtn').getAttribute('data-say');
  expect(say).toContain(' ');
  expect(say).not.toMatch(/[一-鿿]/);

  await page.locator('#learnBody .exampleZh').click();
  await expect(page.locator('#learnBody .exampleZhShown')).toHaveText(/[一-鿿]/);
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
  // Scoped to the answer row: a card carrying an example now has a second button
  // for the sentence, so a bare count here would pass or fail on the shuffle.
  const learnSpeak = page.locator('#learnFeedback .answerRow .speakBtn');
  await expect(learnSpeak).toHaveCount(1);
  await expect(learnSpeak).not.toHaveAttribute('data-say', /[\u4e00-\u9fff]/);
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

test('the learning card explains why the word is what it is', async ({ page }) => {
  await page.goto(APP);
  await page.locator('#deckDemoBtn').click();
  await ready(page);
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A2');
  await page.selectOption('#learnChapter', '6');
  await page.selectOption('#learnCount', '10');
  await page.locator('#learnStartBtn').click();
  await expect(page.locator('#learnBody .learnWord')).toBeVisible();

  // Walk the session and collect every explanation shown along the way.
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.insightBox').count()) seen.push(await page.locator('.insightBox').innerText());
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
  const all = seen.join('\n');
  // gender derived from an ending, a compound taken apart, and a separable verb
  expect(all, '巧记面板一次都没出现').not.toBe('');
  expect(all).toMatch(/为什么是 (der|die|das)/);
  expect(all).toMatch(/拆开看|可分动词|不可分前缀/);
});

test('an explanation never argues with the word it explains', async ({ page }) => {
  // Every gender line must name the article the card actually carries. A panel
  // that says "为什么是 die" under a der-word teaches the error it is meant to fix.
  await page.goto(APP);
  await page.locator('#deckDemoBtn').click();
  await ready(page);
  const bad = await page.evaluate(() => {
    const cards = (window as any).__deck.cards;
    const out: string[] = [];
    for (const c of cards) {
      for (const row of (window as any).DWInsight.Lanalyse(c, cards)) {
        if (row.kind === 'gender' && !row.label.includes(c.de.split(' ')[0])) out.push(`${c.de}: ${row.label}`);
        // Same bar for the auxiliary: "sein 那一类" under a hat-verb would be
        // teaching Ich habe gegangen. The rule only ever explains what the card
        // has already said, so it cannot get this wrong — this is the guard.
        if (row.kind === 'aux' && !/,\s*ist\s/.test(c.grammar || '')) out.push(`${c.de}: ${row.label}`);
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('the home screen asks where you are before it hands out A1 Kapitel 1', async ({ page }) => {
  await open(page);
  // Nothing stored yet: the bar asks rather than silently starting at the front.
  await expect(page.locator('#posBar')).toContainText('你已经学到哪一章了');
  await page.locator('#posEdit').click();
  await expect(page.locator('#browseOverlay')).toBeVisible();

  // The map is the empty state of the search sheet, one tile per Kapitel.
  await expect(page.locator('.mapTile')).toHaveCount(7);
  await page.locator('.mapTile', { hasText: 'Kapitel 4' }).first().click();
  await expect(page.locator('.mapActions')).toContainText('A1 Kapitel 4');
  await page.locator('#mapStartHere').click();
  await page.locator('#browseClose').click();

  await expect(page.locator('#posBar')).toContainText('学到 A1 Kapitel 4');

  // And the daily plan actually moves: the new words now come from Kapitel 4,
  // not from the Hallo/danke at the top of the file.
  await page.locator('#goToday').click();
  await expect(page.locator('#learnCard')).toBeVisible();
  const chapters = new Set<string>();
  const cards = await deck(page);
  const byDe = new Map(cards.map((c) => [c.de, `${c.level}K${c.chapter}`]));
  for (let i = 0; i < 4; i++) {
    const word = (await page.locator('#learnBody .learnWord').first().textContent())!.trim();
    if (byDe.has(word)) chapters.add(byDe.get(word)!);
    await page.locator('#learnRemember').click();
  }
  expect([...chapters]).toEqual(['A1K4']);
});

test('the position moves on by itself when a Kapitel runs out', async ({ page }) => {
  await open(page);
  const cards = await deck(page);
  const k4 = cards.filter((c) => c.level === 'A1' && c.chapter === '4').map((c) => c.id);
  await page.evaluate(([learnKey, schemaKey, prefsKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 3, wrong: 0, hard: 0, last: 1, due: Date.now() + 8.64e7, spellingPass: false, cycles: 1, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
    localStorage.setItem(prefsKey as string, JSON.stringify({ posLevel: 'A1', posChapter: '4' }));
  }, [LEARN_KEY, SCHEMA_KEY, PREFS_KEY, k4] as const);
  await page.reload();
  await ready(page);
  // A1 Kapitel 4 has nothing new left, so the bar reads the next Kapitel that
  // does — without anybody having to go and change it by hand.
  await expect(page.locator('#posBar')).toContainText('学到 A2 Kapitel 1');
});

test('a word can be looked up by German, by Chinese, and without its umlaut', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await expect(page.locator('#browseOverlay')).toBeVisible();

  await page.locator('#browseInput').fill('Blume');
  await expect(page.locator('.browseItem')).toHaveCount(1);
  await expect(page.locator('.browseItem').first()).toContainText('die Blume');
  // The result says where the word lives and whether it has been met yet —
  // the two things you open a search for.
  await expect(page.locator('.browseItem').first()).toContainText('Kapitel 4');
  await expect(page.locator('.browseItem .browseTag').first()).toHaveText('还没学');

  await page.locator('#browseInput').fill('花');
  await expect(page.locator('.browseItem').first()).toContainText('die Blume');

  await page.locator('#browseInput').fill('tur');
  await expect(page.locator('.browseItem').first()).toContainText('die Tür');

  await page.locator('#browseInput').fill('Fahrrad');
  await expect(page.locator('.browseEmpty')).toContainText('词库里没有');

  // Emptying the box returns to the map rather than to a blank sheet.
  await page.locator('#browseInput').fill('');
  await expect(page.locator('.mapTile').first()).toBeVisible();
});

test('a whole Kapitel can be marked known without clicking through it', async ({ page }) => {
  await open(page);
  page.on('dialog', (d) => d.accept());
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('.mapTile', { hasText: 'Kapitel 2' }).first().click();
  await expect(page.locator('.mapActions')).toContainText('A1 Kapitel 2');
  await page.locator('#mapKnowThis').click();

  // All six words of the Kapitel are known, and their spot checks are fanned out
  // across the 30–90 day window instead of all landing on one morning.
  const cards = await deck(page);
  const ids = cards.filter((c) => c.level === 'A1' && c.chapter === '2').map((c) => c.id);
  const dues = await page.evaluate(([key, ids]) => {
    const learn = JSON.parse(localStorage.getItem(key as string) || '{}');
    return (ids as string[]).map((id) => (learn[id] ? { known: learn[id].known, due: learn[id].due } : null));
  }, [LEARN_KEY, ids] as const);
  expect(dues.every((d) => d && d.known === true)).toBe(true);
  const spread = Math.max(...dues.map((d) => d!.due)) - Math.min(...dues.map((d) => d!.due));
  expect(spread).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);

  // And they stop being offered as new words.
  await expect(page.locator('.mapTile', { hasText: 'Kapitel 2' }).first()).toContainText('6/6 学过');
});

test('the preposition drill asks which one, and does not print it in the hint', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabRektion').click();
  await expect(page.locator('#drillContent .coverage')).toContainText('介词 + 格');
  // Two different skills, scored apart: a word governing a preposition, and a
  // preposition governing a case.
  await expect(page.locator('.drillRow')).toHaveCount(2);
  await page.locator('#drillStart').click();

  // Five entries in the fixture carry a Rektion note: freuen, warten, sprechen,
  // die Frage and the preposition aus itself.
  const total = Number((await page.locator('.wrongMini').textContent())!.match(/\/\s*(\d+)/)![1]);
  expect(total).toBe(5);
  for (let i = 0; i < total; i++) {
    const word = (await page.locator('.drillWord').textContent())!.trim();
    const hint = (await page.locator('.drillHint').textContent())!;
    // The gloss spells the answer out in brackets; the question must not.
    expect(hint, word).not.toMatch(/\+\s*(A|D|G|三格|四格|二格)/);
    const buttons = page.locator('#drillContent .genderGrid button');
    const labels = await buttons.allTextContents();
    if (word === 'aus') expect(labels).toEqual(['三格', '四格', '二格']);
    else {
      // Four on a real deck; fewer here only because this fixture holds four
      // combinations in total and a verb's own second preposition is excluded
      // from its wrong answers.
      expect(labels.length).toBeGreaterThanOrEqual(2);
      expect(labels.length).toBeLessThanOrEqual(4);
      expect(new Set(labels).size).toBe(labels.length);
    }
    await buttons.first().click();
    await expect(page.locator('#drillFeedback')).toBeVisible();
    await page.locator('#drillNext').click();
  }
  await expect(page.locator('#drillContent')).toContainText('本轮完成');
});

test('a verb governing two prepositions is not marked wrong for the other one', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabRektion').click();
  // sprechen takes mit +D and über +A. Both are right, so neither may turn up
  // as the other's wrong answer.
  const both = await page.evaluate(() => {
    const cards = (window as any).__deck.cards;
    const c = cards.find((x: any) => x.de === 'sprechen');
    const w = window as any;
    return { r: w.__drillPeek ? null : null, de: c.de, zh: c.zh };
  });
  expect(both.zh).toContain('mit +D');
  await page.locator('#drillStart').click();
  const total = Number((await page.locator('.wrongMini').textContent())!.match(/\/\s*(\d+)/)![1]);
  for (let i = 0; i < total; i++) {
    const word = (await page.locator('.drillWord').textContent())!.trim();
    const labels = await page.locator('#drillContent .genderGrid button').allTextContents();
    if (word === 'sprechen') {
      expect(labels.filter((l) => l === 'mit + 三格' || l === 'über + 四格')).toHaveLength(1);
      // Whichever of the two is offered, clicking it is correct.
      const right = labels.find((l) => l === 'mit + 三格' || l === 'über + 四格')!;
      await page.locator('#drillContent .genderGrid button', { hasText: right }).click();
      await expect(page.locator('#drillFeedback')).toContainText('✓ 对了');
      return;
    }
    await page.locator('#drillContent .genderGrid button').first().click();
    await page.locator('#drillNext').click();
  }
  throw new Error('sprechen never came up in the round');
});

test('the conjugation drill wants er nimmt, not er nehmt', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabConj').click();
  // Four ways to get a conjugation wrong; one score would hide the only one
  // that matters.
  await expect(page.locator('.drillRow')).toHaveCount(4);
  await expect(page.locator('.drillRow').first()).toContainText('变元音');
  await page.locator('#drillStart').click();

  let sawStrong = false, sawSeparable = false;
  const total = Number((await page.locator('.wrongMini').textContent())!.match(/\/\s*(\d+)/)![1]);
  for (let i = 0; i < total; i++) {
    const word = (await page.locator('.drillWord').textContent())!.trim();
    const hint = (await page.locator('.drillHint').textContent())!;
    if (word === 'nehmen' && hint.includes('第三人称')) {
      await page.locator('#drillAnswer').fill('er nehmt');
      await page.locator('#drillCheck').click();
      await expect(page.locator('#drillFeedback')).toContainText('✗ 正确答案');
      await expect(page.locator('#drillFeedback .deAnswer')).toHaveText('er nimmt');
      await expect(page.locator('#drillFeedback')).toContainText('强变化');
      sawStrong = true;
    } else if (word === 'aufstehen' && hint.includes('第三人称')) {
      // The prefix goes to the end of the clause, which is the whole question.
      await page.locator('#drillAnswer').fill('steht auf');
      await page.locator('#drillCheck').click();
      await expect(page.locator('#drillFeedback')).toContainText('✓ 对了');
      await expect(page.locator('#drillFeedback')).toContainText('可分动词');
      sawSeparable = true;
    } else {
      await page.locator('#drillShow').click();
    }
    // Whatever was asked, the whole row is shown: a strong verb's forms belong
    // together.
    await expect(page.locator('#drillFeedback .meta').first()).toContainText('er ');
    if (sawStrong && sawSeparable) return;
    await page.locator('#drillNext').click();
  }
  expect({ sawStrong, sawSeparable }).toEqual({ sawStrong: true, sawSeparable: true });
});

// A year of study lives in one browser's localStorage. These cover the part the
// app can actually do something about: knowing how exposed you are, and putting
// the file somewhere you will find it again.
const BACKUP_AT_KEY = 'netzwerk_vocab_last_backup_at';
const BACKUP_WORK_KEY = 'netzwerk_vocab_last_backup_work';

// A real FileSystemDirectoryHandle cannot be faked through IndexedDB — handles
// are not structured-cloneable when hand-built — so the meta slot is held in
// memory and only the write/permission logic is exercised, which is the part
// this repo wrote.
const fakeFolder = async (page: Page) =>
  page.addInitScript(() => {
    const files: Record<string, string> = {};
    (window as any).__files = files;
    const fileHandle = (name: string) => ({
      kind: 'file',
      name,
      async getFile() {
        if (!(name in files)) throw new Error('not found');
        return { text: async () => files[name] };
      },
      async createWritable() {
        let buf = '';
        return { write: async (t: string) => { buf += t; }, close: async () => { files[name] = buf; } };
      },
    });
    const dir: any = {
      kind: 'directory',
      name: 'Backups',
      __perm: 'granted',
      async queryPermission() { return dir.__perm; },
      async requestPermission() { dir.__perm = 'granted'; return 'granted'; },
      async getFileHandle(name: string, opts?: { create?: boolean }) {
        if (!(name in files) && !(opts && opts.create)) throw new Error('not found');
        return fileHandle(name);
      },
    };
    (window as any).__dir = dir;
    (window as any).showDirectoryPicker = async () => dir;
    const meta = new Map<string, unknown>();
    (window as any).__meta = meta;
    let real: any;
    Object.defineProperty(window, 'DWDeck', {
      configurable: true,
      get: () => real,
      set: (v) => {
        real = v;
        if (!v) return;
        v.getMeta = async (k: string) => meta.get(k);
        v.putMeta = async (k: string, val: unknown) => { meta.set(k, val); };
        v.delMeta = async (k: string) => { meta.delete(k); };
      },
    });
  });

const seedProgress = async (page: Page, n: number, opts: { backedUpAt?: number; work?: number } = {}) => {
  const cards = await deck(page);
  const ids = cards.slice(0, n).map((c) => c.id);
  await page.evaluate(([learnKey, schemaKey, atKey, workKey, ids, o]) => {
    (window as any).DWStore.flush();
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 3, wrong: 0, hard: 0, last: 1, due: Date.now() + 8.64e7, spellingPass: false, cycles: 2, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
    const opt = o as { backedUpAt?: number; work?: number };
    if (opt.backedUpAt !== undefined) localStorage.setItem(atKey as string, String(opt.backedUpAt));
    if (opt.work !== undefined) localStorage.setItem(workKey as string, String(opt.work));
  }, [LEARN_KEY, SCHEMA_KEY, BACKUP_AT_KEY, BACKUP_WORK_KEY, ids, opts] as const);
};

test('the backup panel says how much is only in this browser, not how many days', async ({ page }) => {
  await open(page);
  await seedProgress(page, 20);
  await page.reload();
  await ready(page);

  await page.locator('#backupBtn').click();
  await expect(page.locator('.backupRisk')).toContainText('还没有备份过');

  const download = page.waitForEvent('download');
  await page.locator('#backupExport').click();
  await download;
  // Having exported, the panel counts from here: not "0 days" but "nothing new".
  await expect(page.locator('.backupRisk')).toContainText('上次备份就在今天，之后没有新的记录');
});

test('a reminder arrives for work done, not only for days elapsed', async ({ page }) => {
  await open(page);
  // Backed up an hour ago, then a long session. The old rule was 14 days and
  // would have said nothing at all.
  await seedProgress(page, 30, { backedUpAt: Date.now() - 3600_000, work: 0 });
  await page.reload();
  await ready(page);
  await expect(page.locator('.dwNoticeItem.warn')).toContainText('之后你又学了 30 个新词');
  await expect(page.locator('.dwNoticeItem.warn')).toContainText('0 天');
});

test('nothing is said when little has changed since the last backup', async ({ page }) => {
  await open(page);
  await seedProgress(page, 3, { backedUpAt: Date.now() - 3600_000, work: 0 });
  await page.reload();
  await ready(page);
  await expect(page.locator('.dwNoticeItem.warn')).toHaveCount(0);
});

test('a chosen folder is written to on every visit, keeping the previous copy', async ({ page }) => {
  await fakeFolder(page);
  await open(page);
  await seedProgress(page, 12);
  await page.reload();
  await ready(page);

  await page.locator('#backupBtn').click();
  await page.locator('#backupPick').click();
  await expect(page.locator('.backupRisk')).toContainText('自动备份开着');

  const first = await page.evaluate(() => Object.keys((window as any).__files));
  expect(first).toEqual(['deutsch-woerter-backup.json']);
  const learnt = await page.evaluate(() => Object.keys(JSON.parse((window as any).__files['deutsch-woerter-backup.json']).learnProgress).length);
  expect(learnt).toBe(12);

  // More study, then the startup path again. (Driven directly rather than by
  // reloading: a hand-built handle cannot survive one, since addInitScript
  // rebuilds the fake from scratch.) The backup updates by itself, and the copy
  // it replaces is kept — overwriting the only copy is when a backup can destroy
  // what it exists to protect.
  await seedProgress(page, 25);
  await page.evaluate(() => (window as any).DWStore.backupReminder());
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).__files).sort())).toEqual(
    ['deutsch-woerter-backup-previous.json', 'deutsch-woerter-backup.json'],
  );
  const now = await page.evaluate(() => ({
    latest: Object.keys(JSON.parse((window as any).__files['deutsch-woerter-backup.json']).learnProgress).length,
    previous: Object.keys(JSON.parse((window as any).__files['deutsch-woerter-backup-previous.json']).learnProgress).length,
  }));
  expect(now).toEqual({ latest: 25, previous: 12 });
});

test('a folder whose permission lapsed asks for it back instead of failing quietly', async ({ page }) => {
  await fakeFolder(page);
  await open(page);
  await seedProgress(page, 12);
  await page.reload();
  await ready(page);
  await page.locator('#backupBtn').click();
  await page.locator('#backupPick').click();
  await page.locator('#backupClose').click();

  // Chromium drops the grant between sessions; re-asking needs a click.
  await page.evaluate(() => { (window as any).__dir.__perm = 'prompt'; });
  await seedProgress(page, 25);
  await page.evaluate(() => (window as any).DWStore.backupReminder());
  await expect(page.locator('.dwNoticeItem.warn')).toContainText('需要你再授权一次');
  await page.locator('.dwNoticeItem.warn button', { hasText: '恢复自动备份' }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse((window as any).__files['deutsch-woerter-backup.json']).learnProgress).length)).toBe(25);
});

test('a phone is offered the share sheet, which is how a file reaches iCloud', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shared = [];
    (navigator as any).canShare = (d: any) => !!(d && d.files && d.files.length);
    (navigator as any).share = async (d: any) => { (window as any).__shared.push(d.files.map((f: File) => f.name)); };
    delete (window as any).showDirectoryPicker;
  });
  await open(page);
  await seedProgress(page, 12);
  await page.reload();
  await ready(page);
  await page.locator('#backupBtn').click();
  // No folder picker on this device, so the panel says so instead of offering it.
  await expect(page.locator('.backupWay.off')).toContainText('这个浏览器不支持');
  await page.locator('#backupShare').click();
  await expect.poll(() => page.evaluate(() => (window as any).__shared)).toEqual([['deutsch-woerter-backup.json']]);
  await expect(page.locator('.backupRisk')).toContainText('上次备份就在今天');
});

test('a correction survives re-importing the word list it corrects', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('Blume');
  const before = (await deck(page)).find((c) => c.de === 'die Blume')!;

  await page.locator('.browseItem [data-edit]').first().click();
  await expect(page.locator('.editWord')).toHaveText('die Blume');
  // The headword is the card's identity, so the sheet says so instead of
  // offering a box that would silently discard a word's whole history.
  await expect(page.locator('.editLocked')).toContainText('德语词本身改不了');
  await expect(page.locator('#editContent textarea')).toHaveCount(4);

  await page.locator('#edit_zh').fill('花；花朵（可数）');
  await page.locator('#edit_example').fill('Die Blume ist rot.（这朵花是红色的。）');
  await page.locator('#editSave').click();
  await expect(page.locator('#editOverlay')).toBeHidden();
  await expect(page.locator('.browseItem').first()).toContainText('花；花朵（可数）');

  // Re-importing the very deck that carries the old text must not undo the fix,
  // and must not move the card's id.
  await seedDeck(page);
  await page.reload();
  await ready(page);
  const after = (await deck(page)).find((c) => c.de === 'die Blume')!;
  expect(after.id).toBe(before.id);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('Blume');
  const row = page.locator('.browseItem').first();
  await expect(row).toContainText('花；花朵（可数）');
  await expect(row).toContainText('Die Blume ist rot.');
  // Fields nobody touched still come from the deck.
  await expect(row).toContainText('flower');
});

test('an edit reaches the drills that read the column it changed', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('kochen');
  await page.locator('.browseItem [data-edit]').first().click();
  // kochen ships as a regular verb; teaching the app a Präteritum has to reach
  // the conjugation drill, not just the card.
  await page.locator('#edit_grammar').fill('er kocht, kochte, hat gekocht');
  await page.locator('#editSave').click();
  await page.locator('#browseClose').click();

  await page.locator('#learnDrillBtn').click();
  await page.locator('#tabConj').click();
  await expect(page.locator('.drillRow', { hasText: 'Präteritum' })).toContainText('词库 2');
});

test('a correction can be taken back, and the deck text comes back with it', async ({ page }) => {
  await open(page);
  page.on('dialog', (d) => d.accept());
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('Blume');
  await page.locator('.browseItem [data-edit]').first().click();
  await page.locator('#edit_zh').fill('错的');
  await page.locator('#editSave').click();
  await expect(page.locator('.browseItem').first()).toContainText('错的');

  await page.locator('.browseItem [data-edit]').first().click();
  await expect(page.locator('.editChanged')).toHaveCount(1);
  await page.locator('#editRevert').click();
  await expect(page.locator('#editOverlay')).toBeHidden();
  await expect(page.locator('.browseItem').first()).toContainText('花');
  await expect(page.locator('.browseItem').first()).not.toContainText('错的');
});

test('corrections travel in the backup, and come back on restore', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('Blume');
  await page.locator('.browseItem [data-edit]').first().click();
  await page.locator('#edit_zh').fill('花（补过的）');
  await page.locator('#editSave').click();
  await expect(page.locator('#editOverlay')).toBeHidden();

  const snap = await page.evaluate(() => (window as any).DWStore.snapshot());
  expect(Object.values((snap as { cardPatches: Record<string, { zh: string }> }).cardPatches)).toEqual([{ zh: '花（补过的）' }]);

  // Wipe the correction the way clearing site data would, then restore.
  await page.evaluate(() => (window as any).DWPatches.replace({}));
  await page.reload();
  await ready(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('Blume');
  await expect(page.locator('.browseItem').first()).not.toContainText('补过的');
  await page.locator('#browseClose').click();

  page.on('dialog', (d) => d.accept());
  await page.evaluate((snap) => {
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify(snap)], 'backup.json', { type: 'application/json' }));
    const input = document.getElementById('fileImport') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, snap);
  // Opened while the import is still in flight: restoring a backup has to
  // refresh what is already on screen, not only what is drawn next.
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('Blume');
  await expect(page.locator('.browseItem').first()).toContainText('花（补过的）');
});

// 单词检测 and 背词 used to keep separate books on the same words: twenty minutes
// of testing taught the schedule nothing, and the same word could be 已掌握 on
// one side and 没学过 on the other.
const fullDeck = async (page: Page): Promise<Array<{ id: string; level: string; chapter: string; de: string; en: string }>> =>
  page.evaluate(() => (window as any).__deck.cards.map((c: any) =>
    ({ id: c.id, level: c.level, chapter: String(c.chapter), de: c.de, en: c.en || '' })));

const answerQuiz = async (page: Page, cards: Array<{ de: string; en: string }>, right: boolean) => {
  const prompt = (await page.locator('#prompt').textContent())!.trim();
  const card = cards.find((c) => c.en.replace(/^[_\-–—\s]+/, '').trim() === prompt);
  if (!card) throw new Error(`no card for prompt ${prompt}`);
  await page.locator('#answer').fill(right ? card.de : 'zzz');
  await page.locator('#submitBtn').click();
  return card;
};

// Writes are batched, so the store is flushed before the file is read — this is
// asserting what was saved, not what a 1500ms timer had got round to.
const stateOf = (page: Page, id: string) =>
  page.evaluate(([key, id]) => {
    (window as any).DWStore.flush();
    return JSON.parse(localStorage.getItem(key as string) || '{}')[id as string];
  }, [LEARN_KEY, id] as const);

test('a word tested in 单词检测 counts towards the schedule that asks about it', async ({ page }) => {
  await open(page);
  const cards = await fullDeck(page);
  const pick = cards.filter((c) => c.level === 'A1' && c.chapter === '2');
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 2, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: false, cycles: 1, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, pick.map((c) => c.id)] as const);
  await page.reload();
  await ready(page);

  await page.locator('#goQuiz').click();
  await page.selectOption('#level', 'A1');
  await page.selectOption('#chapter', '2');
  await page.locator('#startBtn').click();
  const card = await answerQuiz(page, pick, true);

  // Typing the German is the spelling layer's question, so it counts as one —
  // and the learner is told, because a schedule that moves silently is a bug.
  await expect(page.locator('#feedback')).toContainText('已记入背词进度');
  const after = await stateOf(page, pick.find((c) => c.de === card.de)!.id);
  expect(after.spellingPass).toBe(true);
  expect(after.cycles).toBe(2);
  expect(after.due).toBeGreaterThan(Date.now() + 60_000);
});

test('missing a word in 单词检测 knocks it back down the schedule', async ({ page }) => {
  await open(page);
  const cards = await fullDeck(page);
  const pick = cards.filter((c) => c.level === 'A1' && c.chapter === '2');
  // One cycle short of mastered, spelling already passed. Actually mastered
  // words never reach 检测 at all — they are filtered out of it — so this is the
  // furthest along a word can be and still be asked here.
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 5, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: true, cycles: 2, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, pick.map((c) => c.id)] as const);
  await page.reload();
  await ready(page);

  await page.locator('#goQuiz').click();
  await page.selectOption('#level', 'A1');
  await page.selectOption('#chapter', '2');
  await page.locator('#startBtn').click();
  const card = await answerQuiz(page, pick, false);
  await expect(page.locator('#feedback')).toContainText('回到复习队列');

  const after = await stateOf(page, pick.find((c) => c.de === card.de)!.id);
  expect(after.cycles).toBe(1);
  expect(after.spellingPass).toBe(false);
  expect(after.known).toBe(false);
  expect(after.due).toBeLessThan(Date.now() + 60 * 60 * 1000);
});

test('a mastered word is never asked in 单词检测, so it cannot be knocked back there', async ({ page }) => {
  await open(page);
  const cards = await fullDeck(page);
  const pick = cards.filter((c) => c.level === 'A1' && c.chapter === '2');
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 5, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: true, cycles: 3, known: true };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, pick.map((c) => c.id)] as const);
  await page.reload();
  await ready(page);
  await expect(page.locator('#homeMastered')).toHaveText('6');

  await page.locator('#goQuiz').click();
  await page.selectOption('#level', 'A1');
  await page.selectOption('#chapter', '2');
  page.once('dialog', (d) => d.accept());
  await page.locator('#startBtn').click();
  // The whole Kapitel is mastered, so there is nothing left to ask.
  await expect(page.locator('#prompt')).toContainText('选择级别');
});

test('单词检测 never introduces a word the learner has not been taught', async ({ page }) => {
  await open(page);
  const cards = await fullDeck(page);
  const pick = cards.filter((c) => c.level === 'A1' && c.chapter === '2');
  await page.locator('#goQuiz').click();
  await page.selectOption('#level', 'A1');
  await page.selectOption('#chapter', '2');
  await page.locator('#startBtn').click();
  const card = await answerQuiz(page, pick, true);

  // A 200-question round over the whole deck would otherwise pour hundreds of
  // untaught words into 今日任务 — the opposite of what it is for.
  await expect(page.locator('#feedback')).not.toContainText('已记入背词进度');
  expect(await stateOf(page, pick.find((c) => c.de === card.de)!.id)).toBeUndefined();
});

test('a round of 单词检测 starts with what the schedule wants today', async ({ page }) => {
  await open(page);
  const cards = await fullDeck(page);
  const a1 = cards.filter((c) => c.level === 'A1' && c.chapter === '1');
  const due = a1.slice(-3);
  await page.evaluate(([learnKey, schemaKey, ids]) => {
    const learn: Record<string, unknown> = {};
    for (const id of ids as string[]) {
      learn[id] = { introduced: true, strength: 2, wrong: 0, hard: 0, last: 1, due: 1, spellingPass: false, cycles: 1, known: false };
    }
    localStorage.setItem(learnKey as string, JSON.stringify(learn));
    localStorage.setItem(schemaKey as string, '2');
  }, [LEARN_KEY, SCHEMA_KEY, due.map((c) => c.id)] as const);
  await page.reload();
  await ready(page);

  await page.locator('#goQuiz').click();
  await page.selectOption('#level', 'A1');
  await page.selectOption('#chapter', '1');
  await page.selectOption('#count', '10');
  await page.locator('#startBtn').click();

  // Three words are due; they come first, whatever the weighting did with the
  // other twenty-seven.
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    seen.push((await page.locator('#prompt').textContent())!.trim());
    await page.locator('#showBtn').click();
    await page.locator('#nextBtn').click();
  }
  const dueEn = due.map((c) => c.en.replace(/^[_\-–—\s]+/, '').trim());
  expect(seen.sort()).toEqual(dueEn.sort());
});

test('a verb is explained by the pattern it belongs to, not as three separate facts', async ({ page }) => {
  await open(page);
  await page.locator('#goLearn').click();
  await page.locator('#learnBrowseBtn').click();
  await page.locator('#browseInput').fill('gehen');
  await page.locator('#browseClose').click();

  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '4');
  await page.selectOption('#learnCount', '10');
  await page.locator('#learnStartBtn').click();

  // gehen ships with ist gegangen. The panel may name the sein group — it is
  // only ever explaining what the card itself has already said.
  for (let i = 0; i < 10; i++) {
    const word = (await page.locator('#learnBody .learnWord').first().textContent())!.trim();
    if (word === 'gehen') {
      await expect(page.locator('.insightBox')).toContainText('完成时用 sein');
      await expect(page.locator('.insightBox')).toContainText('ist gegangen');
      return;
    }
    await page.locator('#learnRemember').click();
  }
  throw new Error('gehen never came up');
});

test('the other sense of a word is shown, not only kept out of the wrong answers', async ({ page }) => {
  await open(page);
  // The fixture lists gehen twice in A1 Kapitel 4: 走；去 and 这里：进行得顺利.
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '4');
  await page.selectOption('#learnCount', '10');
  await page.locator('#learnStartBtn').click();
  for (let i = 0; i < 10; i++) {
    const word = (await page.locator('#learnBody .learnWord').first().textContent())!.trim();
    if (word === 'gehen') {
      const box = page.locator('.insightBox');
      await expect(box).toContainText('同一个词的别的意思');
      // Shown without the chapter note that would have given a quiz away.
      await expect(box).not.toContainText('这里：');
      return;
    }
    await page.locator('#learnRemember').click();
  }
  throw new Error('gehen never came up');
});
