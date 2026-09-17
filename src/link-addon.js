/* QUIZ_LINK_ADDON_V1 */
// 单词检测 and 背词 kept separate books on the same words. The same das Haus
// could be 已掌握 on one side and 没学过 on the other, and twenty minutes of
// testing taught the schedule nothing — so 今日任务 went on asking about words
// that had just been answered, and stayed quiet about ones that had just been
// missed.
//
// They are not the same exercise, but they are the same two skills. Typing the
// German from a prompt is what the spelling layer asks for; reading a German
// word and giving its meaning is recognition. So a 检测 answer is fed back as
// exactly that kind of answer, through the same transition 背词 uses.
const LQUIZ_AS = { "en-de": "spell", "de-en": "recognize" };
let lastQuizFeed = null;

// Never introduces a word. A 200-question round over the whole deck would
// otherwise pour hundreds of never-taught words into 今日任务, which is the
// opposite of what the daily plan is for.
function LquizFeed(c, ok) {
  if (!c) return null;
  const s = Lstate(c);
  if (!s.introduced) return null;
  const dirEl = document.getElementById("direction");
  const type = LQUIZ_AS[(dirEl && dirEl.value) || "en-de"] || "recognize";
  const before = { mastered: Lmastered(s), due: s.due || 0 };
  LapplyAnswer(s, ok, type);
  Lsave(c, s);
  return { ok, type, state: s, before };
}
const LQUIZ_STEPS = [
  [60 * 1000, "几分钟后"], [2 * 60 * 60 * 1000, "今天晚些时候"], [36 * 60 * 60 * 1000, "明天"],
  [5 * 24 * 60 * 60 * 1000, "几天后"], [20 * 24 * 60 * 60 * 1000, "两周后"], [50 * 24 * 60 * 60 * 1000, "一个月后"],
];
function LwhenAgain(due) {
  const gap = Math.max(0, (due || 0) - Date.now());
  for (const [ms, label] of LQUIZ_STEPS) if (gap <= ms) return label;
  return "三个月后";
}
// Said out loud in the feedback: a schedule that moves silently because of
// something you did in another mode is the kind of thing people call a bug.
function LquizFeedNote(fed) {
  if (!fed) return "";
  const s = fed.state;
  if (!fed.ok) return `<div class="meta">已记入背词进度：<b>${fed.before.mastered ? "退回“学习中”" : "回到复习队列"}</b>，很快会再问一次。</div>`;
  return `<div class="meta">已记入背词进度：下次复习<b>${LwhenAgain(s.due)}</b>${Lmastered(s) ? " · 已进入“已掌握”" : ""}。</div>`;
}

function LinitQuizLink() {
  if (typeof window.save !== "function" || window.__quizLinkV1) return;
  window.__quizLinkV1 = true;

  const baseSave = window.save;
  window.save = function (c, ok) {
    baseSave(c, ok);
    try { lastQuizFeed = LquizFeed(c, ok); } catch (e) { lastQuizFeed = null; }
  };

  // The feedback is written by reveal() straight after save(), so the note is
  // appended once that panel exists rather than threaded through it. A function
  // declaration in a classic script is the window property, so check() and the
  // buttons reach this wrapper without being rewired.
  const baseReveal = window.reveal;
  if (typeof baseReveal === "function") {
    window.reveal = function (ok) {
      lastQuizFeed = null;
      baseReveal(ok);
      const fb = document.getElementById("feedback");
      if (fb && lastQuizFeed) fb.insertAdjacentHTML("beforeend", LquizFeedNote(lastQuizFeed));
    };
  }

  // And the other direction: a word the schedule wants to see today should be
  // likelier to come up here too, instead of each mode picking in ignorance of
  // the other. Gated on 优先抽错词 / 生词, which is the switch that already
  // promises this — unticked, 检测 stays a flat sample of the whole deck.
  const baseWeighted = window.weighted;
  if (typeof baseWeighted === "function") {
    window.weighted = function (a) {
      const order = baseWeighted(a);
      const pref = document.getElementById("weakFirst");
      if (!pref || !pref.checked) return order;
      const now = Date.now();
      const rank = (c) => {
        const s = Lstate(c);
        if (!s.introduced || Lmastered(s)) return 1;
        return (s.due || 0) <= now ? 0 : 1;
      };
      return order.map((c, i) => ({ c, i, k: rank(c) })).sort((x, y) => x.k - y.k || x.i - y.i).map((x) => x.c);
    };
  }
}
