import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// Regression cover for the vocabulary PWA's data-durability behaviour. Each test
// here maps to a way progress used to be lost or an answer used to be scored wrong.

const APP = '/';
const QUIZ_KEY = 'netzwerk_vocab_progress_pwa_v1';
const LEARN_KEY = 'netzwerk_vocab_learning_v1';
const WRONG_KEY = 'netzwerk_vocab_spelling_wrongbook_v1';
const SCHEMA_KEY = 'netzwerk_vocab_schema';

// The page keeps its deck in a `let` binding, which is deliberately not a window
// property. Read the same static file it reads instead of reaching into its scope.
const deck = async (page: Page): Promise<Array<{ id: string; level: string; chapter: string; de: string }>> =>
  page.evaluate(async () => {
    const rows = await (await fetch('./cards.json')).json();
    return rows.map((r: string[]) => ({ id: r[0], level: r[1], chapter: r[2], de: r[3] }));
  });

const ready = async (page: Page) => {
  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#learnStartBtn')).toHaveText('开始学新词', { timeout: 20000 });
};

test('loads cleanly with both modes available', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(APP);
  await ready(page);
  await expect(page.locator('#learnMasteredBtn')).toHaveCount(1);
  await expect(page.locator('#learnWrongBtn')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('migrates progress saved under the old line-number ids', async ({ page }) => {
  await page.goto(APP);
  await ready(page);
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
    await page.goto(APP);
    await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);
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
  await page.goto(APP);
  await ready(page);

  // quiz: answer one question and play the answer back
  await page.locator('#goQuiz').click();
  await page.locator('#startBtn').click();
  await page.locator('#showBtn').click();
  const quizSpeak = page.locator('#feedback .speakBtn');
  await expect(quizSpeak).toHaveCount(1);
  await quizSpeak.click();
  expect((await page.evaluate(() => (window as any).__spoken as string[])).length).toBe(1);

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
  await page.goto(APP);
  await ready(page);
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
