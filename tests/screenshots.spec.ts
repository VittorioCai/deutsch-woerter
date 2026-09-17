import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Regenerates the screenshots in README.md:
//
//     npm run screenshots
//
// It is skipped in the normal suite — it asserts nothing, it draws. Keeping it
// here rather than shooting by hand means the README cannot quietly drift years
// out of date with the app.
const OUT = fileURLToPath(new URL('../docs/screenshots', import.meta.url));
// GitHub caches README images by URL for a long time, so a regenerated file under
// the same name keeps showing the old picture. Bump REV when regenerating and
// replace the old prefix in both READMEs.
const REV = 'r2';
test.use({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });

test('capture the README screenshots', async ({ page }) => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, 'set CAPTURE_SCREENSHOTS=1 to regenerate');
  await page.route('**://*.wikimedia.org/**', (r) => r.abort('failed'));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { cancel() {}, addEventListener() {}, speak() {},
        getVoices: () => [{ name: 'Anna (Premium)', lang: 'de-DE', voiceURI: 'anna', localService: true }] },
    });
    (window as any).SpeechSynthesisUtterance = class { text = ''; lang = ''; rate = 1; voice: unknown = null; constructor(t: string) { this.text = t } };
  });

  await page.goto('/');
  await page.waitForSelector('#deckDemoBtn');
  await page.screenshot({ path: `${OUT}/${REV}-01-start.png`, clip: { x: 0, y: 0, width: 400, height: 620 } });

  await page.locator('#deckDemoBtn').click();
  await page.waitForSelector('#homeView');

  // A screenshot of an empty app sells nothing. Seed a plausible two weeks in.
  const ids: string[] = await page.evaluate(() => (window as any).__deck.cards.map((c: any) => c.id));
  await page.evaluate(([ids]) => {
    const learn: Record<string, unknown> = {};
    const now = Date.now();
    ids.slice(0, 96).forEach((id: string, i: number) => {
      if (i < 58) learn[id] = { introduced: true, strength: 5, cycles: 3, spellingPass: true, known: false, wrong: 0, last: now, due: now + 12e8 };
      else if (i < 79) learn[id] = { introduced: true, strength: 3, cycles: 1, spellingPass: false, known: false, wrong: 1, last: now, due: now - 1e6 };
      else learn[id] = { introduced: true, strength: 2, cycles: 1, spellingPass: false, known: false, wrong: 0, last: now, due: now + 6e7 };
    });
    localStorage.setItem('netzwerk_vocab_learning_v1', JSON.stringify(learn));
    localStorage.setItem('netzwerk_vocab_schema', '2');
    localStorage.setItem('netzwerk_vocab_last_backup_at', String(now));
    localStorage.setItem('netzwerk_vocab_prefs_v1', JSON.stringify({ posLevel: 'A1', posChapter: '5', level: 'A1', chapter: '5' }));
    const quiz: Record<string, unknown> = {};
    ids.slice(100, 118).forEach((id: string) => { quiz[id] = { seen: 4, correct: 2, wrong: 2, mastery: 2, last: now } });
    localStorage.setItem('netzwerk_vocab_progress_pwa_v1', JSON.stringify(quiz));
  }, [ids] as const);
  await page.reload();
  await page.waitForSelector('#goToday:not([disabled])');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${REV}-02-home.png` });

  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A1');
  await page.selectOption('#learnChapter', '5');
  await page.locator('#learnStartBtn').click();
  await page.waitForSelector('#learnBody .learnWord');
  await page.locator('#learnCard').screenshot({ path: `${OUT}/${REV}-03-learn.png` });

  // A card whose word the rules have something to say about.
  await page.locator('#modeBack').click();
  await page.locator('#goLearn').click();
  await page.selectOption('#learnLevel', 'A2');
  await page.selectOption('#learnChapter', '6');
  await page.locator('#learnStartBtn').click();
  await page.waitForSelector('.insightBox');
  await page.locator('#learnCard').screenshot({ path: `${OUT}/${REV}-07-insight.png` });
  for (let i = 0; i < 3 && !(await page.locator('.insightBox').innerText()).includes('拆开看'); i++) {
    await page.locator('#learnRemember').click();
    await page.waitForSelector('.insightBox');
  }
  await page.locator('#learnCard').screenshot({ path: `${OUT}/${REV}-08-compound.png` });

  for (let i = 0; i < 6 && !(await page.locator('#learnBody .choice').count()); i++) {
    await page.locator('#learnRemember').click();
  }
  await page.waitForSelector('#learnBody .choice');
  await page.locator('#learnCard').screenshot({ path: `${OUT}/${REV}-04-choice.png` });

  await page.goto('/');
  await page.waitForSelector('#homeView');
  await page.locator('#learnDrillBtn').click();
  await page.locator('#drillStart').click();
  await page.waitForSelector('.genderGrid button');
  await page.locator('.genderGrid button').first().click();
  await page.waitForSelector('#drillNext');
  await page.locator('.drillSheet').screenshot({ path: `${OUT}/${REV}-05-drill.png` });

  await page.goto('/?mastered=1');
  await page.waitForSelector('#masteredOverlay .masterItem');
  await page.locator('.masterSheet').screenshot({ path: `${OUT}/${REV}-06-mastered.png` });
});
