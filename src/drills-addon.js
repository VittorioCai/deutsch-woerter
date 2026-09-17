/* GRAMMAR_DRILLS_V1 */
// Gender and plural drills over the noun data. Both fields were previously only
// ever displayed, never tested — and the app's spelling check accepts an answer
// without its article, so gender was effectively untested anywhere.
const DRILL_KEY = "netzwerk_vocab_grammar_drills_v1";
let drillProgress = DWStore.read(DRILL_KEY, {});
DWStore.onMigrated(() => { drillProgress = DWStore.read(DRILL_KEY, {}) });
let drillKind = DWStore.prefs().drill || "gender", drillLevel = DWStore.prefs().drillLevel || "ALL", drillQueue = [], drillPos = 0, drillScore = 0, drillAnswered = false;

const LdrillState = (id, kind) => (drillProgress[id] || {})[kind] || { n: 0, ok: 0, miss: 0 };
function LdrillSave(id, kind, correct) {
  const cur = LdrillState(id, kind);
  const next = { n: cur.n + 1, ok: cur.ok + (correct ? 1 : 0), miss: correct ? 0 : (cur.miss || 0) + 1 };
  drillProgress[id] = Object.assign({}, drillProgress[id], { [kind]: next });
  DWStore.queue(DRILL_KEY, () => drillProgress);
}

const LdrillArticle = c => (c.de.match(/^(der|die|das)\b/i) || [])[1]?.toLowerCase() || "";
const LdrillStem = c => c.de.replace(/^(der|die|das)\s+/i, "").trim();
const LdrillNouns = () => CARDS.filter(c => LdrillArticle(c) && !Lmastered(Lstate(c)));

// Word lists write plurals compactly: a leading " or * marks an umlaut, an
// optional - stands for the singular stem, and the rest is the suffix. A few
// entries carry mojibake (a € where an e belongs) that means the same thing.
function LumlautStem(stem) {
  const m = /(au|[aou])(?![\s\S]*(?:au|[aou]))/i.exec(stem);
  if (!m) return null;
  const map = { a: "ä", o: "ö", u: "ü", au: "äu", A: "Ä", O: "Ö", U: "Ü", Au: "Äu", AU: "ÄU" };
  const hit = m[1], rep = map[hit] || map[hit.toLowerCase()];
  if (!rep) return null;
  return stem.slice(0, m.index) + rep + stem.slice(m.index + hit.length);
}
function LpluralOf(c) {
  const raw = (c.grammar || "").trim();
  if (!raw) return null;
  const explicit = raw.match(/^Plural:\s*(?:die\s+)?(.+)$/i);
  if (explicit) {
    const form = explicit[1].trim();
    // Accented letters appear in loanwords the deck legitimately contains
    // (die Cafés, die Menus). Rejecting them cost those nouns their drill.
    return /^\p{L}[^\s\d|/,;()]*$/u.test(form) ? `die ${form}` : null;
  }
  const short = raw.match(/^(["*]*)-?(n|en|nen|e|er|s|se|ien|es|€)?$/);
  if (!short) return null;
  const umlaut = !!short[1];
  const suffix = (short[2] || "").replace(/€/g, "e");
  let stem = LdrillStem(c);
  if (!stem || /[\s|/]/.test(stem)) return null;
  if (umlaut) {
    const u = LumlautStem(stem);
    if (!u) return null;
    stem = u;
  }
  return `die ${stem}${suffix}`;
}
const LdrillPluralNouns = () => LdrillNouns().filter(c => LpluralOf(c));
// Dictation needs a word a synthesiser can actually pronounce as one unit —
// multi-word or slashed entries read as gibberish.
const LdictationCards = () => CARDS.filter(c => !Lmastered(Lstate(c)) && /^(?:(?:der|die|das)\s+)?[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{2,}$/.test(c.de.trim()));
function LpluralAlts(c) {
  const want = LpluralOf(c);
  const alts = new Set(want ? [want] : []);
  for (const x of CARDS) if (x.de === c.de) { const p = LpluralOf(x); if (p) alts.add(p) }
  return [...alts];
}

// ---- haben / sein ----------------------------------------------------------
// The word lists already spell the perfect out: whatever follows the final comma
// in the grammar column is the auxiliary and the participle. Nothing has ever
// tested it, and it is the one ending a native ear catches instantly — "Ich habe
// gegangen" lands wrong the way a scrambled sentence does. Guessing is weak cover
// too: unlike der/die/das there are only two answers, so knowing beats guessing
// within a round.
// The word-form column is read in exactly one place (DWInsight.Lforms) so the
// drills and the explanations can never disagree about what it says.
function LauxOf(c) {
  const f = DWInsight.Lforms(c);
  return f && f.aux ? { aux: f.aux, part: f.participle } : null;
}
const LauxCards = () => CARDS.filter(c => !Lmastered(Lstate(c)) && LauxOf(c));

// ---- cloze -----------------------------------------------------------------
// Blanking a word out of its own example turns sentences the app only ever
// printed into recall practice. The word is usually inflected where it stands
// (gehen shows up as "gehe", international as "internationalen"), so the span is
// located by stem and the blank covers whichever form is actually there.
//
// The stem has to be long enough to be worth matching by prefix: "an" would
// happily blank the "An" of "Anna". Anything that cannot be located — separable
// verbs split across the clause, strong stem changes like sein → bin — simply
// gets no question rather than a wrong one.
const LclozeStem = c => c.de.replace(/^(der|die|das)\s+/i, "").replace(/^sich\s+/i, "").trim();
const Lrx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function LclozeSpan(c) {
  const sent = LexampleDe(c), stem = LclozeStem(c);
  if (!sent || !stem || /[\s|/]/.test(stem)) return null;
  const root = stem.replace(/(en|n)$/i, "");
  const tries = [new RegExp("(^|[^\\p{L}])(" + Lrx(stem) + ")([^\\p{L}]|$)", "iu")];
  if (stem.length >= 4 && root.length >= 3) tries.push(new RegExp("(^|[^\\p{L}])(" + Lrx(root) + "\\p{L}*)", "iu"));
  for (const rx of tries) {
    const m = rx.exec(sent);
    if (!m || m[2].length < 3) continue;
    const at = m.index + m[1].length;
    return { before: sent.slice(0, at), word: m[2], after: sent.slice(at + m[2].length) };
  }
  return null;
}
const LclozeCards = () => CARDS.filter(c => !Lmastered(Lstate(c)) && LclozeSpan(c));
// The exercise asks which word belongs here, not how to inflect it, so the
// dictionary form counts as much as the form the sentence happens to use.
function LclozeAccepted(c, span, input) {
  const n = s => Lnorm(s).replace(/^(der|die|das)\s+/, "").replace(/^sich\s+/, "");
  return [span.word, LclozeStem(c), c.de].some(w => n(input) === n(w));
}

// ---- Rektion ---------------------------------------------------------------
// Which preposition a verb takes, and which case follows it, is not derivable
// from the Chinese: 等待 is `warten auf` + Akkusativ, 想 is `denken an` +
// Akkusativ, 高兴 splits between `sich freuen über` (already happened) and
// `sich freuen auf` (still to come). Get it wrong and a German listener still
// understands you, so nobody corrects it — which is exactly why it has to be
// drilled, and why B1 examines it. The meaning column has carried the answer
// all along, written as （auf +A）.
//
// Two shapes live in that notation and they are different skills: a word that
// governs a preposition, and a preposition that governs a case. A word only
// counts as a preposition if it is one — anything else gets no question rather
// than a wrong one.
const LCASE_NAME = { A: "四格", D: "三格", G: "二格", "四格": "四格", "三格": "三格", "二格": "二格" };
const LprepKey = (s) => String(s || "").toLowerCase().replace(/ß/g, "ss").trim();
const LPREPS = new Set(["ab", "an", "auf", "aus", "ausser", "ausserhalb", "bei", "bis", "durch", "entgegen", "für", "gegen", "gegenüber", "hinter", "in", "innerhalb", "mit", "nach", "neben", "ohne", "seit", "statt", "trotz", "über", "um", "unter", "von", "vor", "während", "wegen", "zu", "zwischen"].map(LprepKey));
const LRX_REKTION = /([A-Za-zÄÖÜäöüß]{2,})\s*\+\s*(A|D|G|三格|四格|二格)(?![\p{L}])/gu;
const LRX_CASE = /\+\s*(A|D|G|三格|四格|二格)(?![\p{L}])/gu;
// The deck writes a bare-case note as its own bracket — 帮助（+D 帮某人）,
// 来自（+三格）. A `+A` loose in running prose is not that, and inventing a
// question from it would be inventing the grammar too.
const LRX_CASE_NOTE = /[（(]\s*(?:sich\s+)?\+\s*(A|D|G|三格|四格|二格)(?![\p{L}])/u;
const LrektionCache = new Map();
function LrektionOf(c) {
  if (LrektionCache.has(c.id)) return LrektionCache.get(c.id);
  const zh = String(c.zh || ""), head = LprepKey(Lnorm(c.de).replace(/^(der|die|das)\s+/, "").replace(/^sich\s+/, ""));
  const isPrep = LPREPS.has(head);
  const combos = [];
  for (const m of zh.matchAll(LRX_REKTION)) {
    const prep = LprepKey(m[1]), kase = LCASE_NAME[m[2]];
    // `nach` as a headword glossed 「fragen nach +三格」 is asking about itself;
    // it is a case question, not a collocation one.
    if (!kase || !LPREPS.has(prep) || prep === head) continue;
    if (!combos.some((x) => x.prep === prep && x.kase === kase)) combos.push({ prep, kase });
  }
  let out = null;
  if (combos.length) out = { kind: "prep", combos };
  else if (isPrep || LRX_CASE_NOTE.test(zh)) {
    // A preposition governs a case; so does a verb like helfen, which takes the
    // dative with no preposition at all (Ich helfe dir, never dich). Same three
    // answers, different question, so the shape says which.
    const cases = [];
    for (const m of zh.matchAll(LRX_CASE)) { const k = LCASE_NAME[m[1]]; if (k && !cases.includes(k)) cases.push(k) }
    if (cases.length) out = { kind: "case", cases, isPrep };
  }
  LrektionCache.set(c.id, out);
  return out;
}
// The gloss spells the answer out in brackets, so the hint has to lose exactly
// those brackets — the same tell the multiple-choice options had. Emptying the
// hint is better than leaking it: the German word alone is still a fair question.
const LrektionHint = (c) => {
  const drop = (s) => String(s || "")
    .replace(/（[^（）]*\+\s*(?:A|D|G|三格|四格|二格)[^（）]*）/g, "")
    .replace(/\([^()]*\+\s*(?:A|D|G|三格|四格|二格)[^()]*\)/g, "").trim();
  for (const raw of [LhasZh(c) ? Lmeaning(c) : "", Lenglish(c)]) {
    const t = drop(LsenseFree(raw));
    if (t && !LRX_CASE.test(t)) { LRX_CASE.lastIndex = 0; return t }
    LRX_CASE.lastIndex = 0;
  }
  return "";
};
// A collocation question needs something to be wrong about. On a deck carrying
// only one or two combinations there is nothing to choose between, so those
// cards get no question rather than a one-button one; a case question always has
// its three answers.
const LrektionCards = () => CARDS.filter((c) => {
  const r = !Lmastered(Lstate(c)) && LrektionOf(c);
  return r && (r.kind === "case" || LrektionDistractors(c).length >= 1);
});
const LrektionLabel = (x) => `${x.prep} + ${x.kase}`;
let LrektionPoolCache = null, LrektionPoolFor = null;
function LrektionCombos() {
  if (LrektionPoolFor === CARDS && LrektionPoolCache) return LrektionPoolCache;
  const m = new Map();
  for (const c of CARDS) {
    const r = LrektionOf(c);
    if (!r || r.kind !== "prep") continue;
    for (const x of r.combos) m.set(LrektionLabel(x), (m.get(LrektionLabel(x)) || 0) + 1);
  }
  LrektionPoolCache = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  LrektionPoolFor = CARDS;
  return LrektionPoolCache;
}
// A verb may govern more than one preposition (sprechen mit +D, über +A); both
// are right, so neither may turn up as the other's wrong answer.
function LrektionDistractors(c) {
  const right = LrektionOf(c).combos.map(LrektionLabel);
  return LrektionCombos().filter((x) => !right.includes(x));
}
function LrektionOptions(c) {
  const r = LrektionOf(c);
  if (r.kind === "case") return ["三格", "四格", "二格"];
  return Lshuffle([r.combos.map(LrektionLabel)[0], ...Lshuffle(LrektionDistractors(c)).slice(0, 3)]);
}
const LrektionAccepted = (c, picked) => {
  const r = LrektionOf(c);
  return r.kind === "case" ? r.cases.includes(picked) : r.combos.map(LrektionLabel).includes(picked);
};

// ---- Konjugation -----------------------------------------------------------
// `nehmen` becomes `er nimmt`, not `er nehmt`: the strong verbs change their
// stem vowel in exactly the third person you need most. Separable verbs split
// instead — `aufstehen` is `er steht auf`, with the prefix thrown to the end of
// the clause. Both are written out in the word-form column and neither has ever
// been asked; the auxiliary drill only ever showed the participle.
// A multi-word headword (spazieren gehen, los sein) has no single form to ask
// for, so it gets no question rather than one about half of it.
function LconjOf(c) {
  const f = DWInsight.Lforms(c);
  return f && !f.multiword ? f : null;
}
const LconjCards = () => CARDS.filter((c) => !Lmastered(Lstate(c)) && LconjOf(c));
// Alternating by position rather than at random keeps a round predictable and a
// test honest, and still reaches the Präteritum the B1 entries carry.
const LconjAsk = (c, i) => (LconjOf(c).past && i % 2 === 1 ? "past" : "present");
function LconjAccepted(c, ask, input) {
  const want = ask === "past" ? LconjOf(c).past : LconjOf(c).present;
  const n = (s) => Lnorm(s).replace(/^er\s+/, "").replace(/\s+/g, " ").trim();
  return n(input) === n(want);
}

function LdrillPoolFor(kind) {
  return kind === "plural" ? LdrillPluralNouns()
    : kind === "dictation" ? LdictationCards()
    : kind === "aux" ? LauxCards()
    : kind === "cloze" ? LclozeCards()
    : kind === "rektion" ? LrektionCards()
    : kind === "conj" ? LconjCards()
    : LdrillNouns();
}
function LdrillPool() {
  const base = LdrillPoolFor(drillKind);
  return drillLevel === "ALL" ? base : base.filter(c => c.level === drillLevel);
}
// Unseen first, then whatever is currently being missed.
function LdrillPick(n) {
  const pool = LdrillPool();
  const score = c => { const s = LdrillState(c.id, drillKind); return (s.n ? 1 : 0) - Math.min(3, s.miss || 0) * 2 + Math.random() * 0.9 };
  return pool.map(c => ({ c, k: score(c) })).sort((a, b) => a.k - b.k).slice(0, n).map(x => x.c);
}

function LdrillStyles() {
  const st = document.createElement("style");
  st.textContent = `.drillOverlay{position:fixed;inset:0;z-index:9997;background:rgba(18,25,38,.58);display:flex;align-items:flex-end;justify-content:center}.drillOverlay.hidden{display:none}.drillSheet{background:#fff;width:min(760px,100%);max-height:92vh;border-radius:20px 20px 0 0;padding:18px;overflow:auto;box-shadow:0 -16px 50px rgba(0,0,0,.18)}.drillHead{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;background:#fff;padding:16px 0 10px;z-index:2}.drillHead h2{margin:0;font-size:22px}.drillGroups{display:grid;gap:8px;margin-bottom:12px}.drillGroupName{font-size:11px;font-weight:700;color:var(--muted);margin:0 0 4px 2px}.drillTabs{display:flex;gap:8px;flex-wrap:wrap}.drillTabs button{flex:1 1 28%;padding:9px 6px;font-size:13px;display:inline-flex;align-items:center;justify-content:center;gap:5px}.drillTabs button.off{opacity:.5}.drillN{font-size:11px;font-weight:600;background:rgba(0,0,0,.07);border-radius:999px;padding:1px 7px}.drillTabs button.on .drillN{background:rgba(255,255,255,.25)}.genderGrid.two{grid-template-columns:repeat(2,1fr)}.clozeSentence{font-size:clamp(18px,4.4vw,24px);line-height:1.8;text-align:center;margin:20px 0 8px;font-weight:600;word-break:break-word}.clozeBlank{display:inline-block;min-width:92px;border-bottom:3px solid var(--accent)}.clozeHit{color:var(--accent)}.drillTabs button.on{background:var(--accent);color:#fff}.drillWord{font-size:clamp(30px,8vw,46px);font-weight:800;text-align:center;margin:26px 0 6px;word-break:break-word}.drillEar{color:var(--accent)}.drillHint{text-align:center;color:var(--muted);font-size:13px;margin-bottom:22px}.genderGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.genderGrid button{padding:20px 0;font-size:21px;font-weight:800}.genderGrid button.correct{background:#0a8f55;color:#fff}.genderGrid button.wrong{background:#c73737;color:#fff}.drillStats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.drillEmpty{text-align:center;padding:45px 10px;color:var(--muted)}.drillBreak{display:grid;gap:6px;margin-top:10px;font-size:13px;color:var(--muted)}.drillRow{display:flex;justify-content:space-between;gap:10px;padding:7px 10px;border:1px solid var(--line);border-radius:10px}@media(min-width:700px){.drillOverlay{align-items:center;padding:18px}.drillSheet{border-radius:20px;max-height:88vh}}`;
  document.head.appendChild(st);
}
function LbuildDrillUI() {
  LdrillStyles();
  const ov = document.createElement("div");
  ov.id = "drillOverlay";
  ov.className = "drillOverlay hidden";
  ov.innerHTML = `<div class="drillSheet"><div class="drillHead"><h2>专项训练</h2><button class="secondary" id="drillClose">关闭</button></div><div id="drillContent"></div></div>`;
  document.body.appendChild(ov);
  L$("drillClose").onclick = LcloseDrill;
  ov.addEventListener("click", e => { if (e.target === ov) LcloseDrill() });
}
function LopenDrill(kind) { if (kind) drillKind = kind; drillQueue = []; LrenderDrillHome(); L$("drillOverlay").classList.remove("hidden") }
function LcloseDrill() { L$("drillOverlay").classList.add("hidden"); Lstats(); LhomeStats() }

function LdrillAccuracy(kind, filter) {
  let n = 0, ok = 0;
  // Counted over nouns regardless of drill, which quietly reported dictation
  // accuracy over a set dictation never draws from.
  for (const c of LdrillPoolFor(kind)) {
    if (filter && !filter(c)) continue;
    const s = LdrillState(c.id, kind);
    n += s.n; ok += s.ok;
  }
  return { n, ok, pct: n ? Math.round(ok / n * 100) : null };
}
const LDRILLS = [
  { kind: "gender", id: "tabGender", tab: "der / die / das" },
  { kind: "plural", id: "tabPlural", tab: "复数形式" },
  { kind: "conj", id: "tabConj", tab: "动词变位" },
  { kind: "aux", id: "tabAux", tab: "haben/sein" },
  { kind: "rektion", id: "tabRektion", tab: "介词 + 格" },
  { kind: "cloze", id: "tabCloze", tab: "例句填空" },
  { kind: "dictation", id: "tabDictation", tab: "听写" },
];
// An empty drill says what the deck is missing and where to put it, instead of
// describing a feature it cannot demonstrate on this deck.
function LdrillEmpty(kind) {
  const fix = (col) => `点学习卡上的「词条有错」，在${col}补上；或者导入带这一栏的词库。`;
  if (kind === "conj" || kind === "aux") return `<b>这个词库的动词没写变位。</b> 词形栏写成 <code>er nimmt, hat genommen</code> 就能出题。${fix("词形栏")}`;
  if (kind === "rektion") return `<b>这个词库的释义里没有支配格标记。</b> 释义写成 <code>等待（auf +A）</code> 或 <code>帮助（+D）</code> 就能出题。${fix("中文释义")}`;
  if (kind === "cloze") return `<b>这个词库没有能定位到词的例句。</b> 例句写成 <code>Deutscher Satz.（中文）</code>，而且词要出现在句子里。${fix("例句")}`;
  if (kind === "plural") return `<b>这个词库的名词没写复数。</b> 词形栏写 <code>Plural: die Häuser</code> 或 <code>"er</code> 就能出题。${fix("词形栏")}`;
  if (kind === "gender") return `<b>这个词库里没有带冠词的名词。</b> 德语名词写成 <code>das Haus</code>，性别题才有东西可问。`;
  return `<b>这个词库里没有能单独朗读的词。</b>`;
}
function LdrillBlurb(kind, n) {
  if (!n) return LdrillEmpty(kind);
  if (kind === "gender") return `<b>性别专项 · 可练 ${n} 个名词。</b> 拼写检查默认不强制冠词，所以性别几乎没被单独考过。已掌握的词不会出现。`;
  if (kind === "plural") return `<b>复数专项 · 可练 ${n} 个名词。</b> 复数形式由词库的词形记号推导（<code>"</code> 表示变音），无法确定的词不会出题。`;
  if (kind === "aux") return `<b>haben / sein · 可练 ${n} 个动词。</b> 完成时该用哪个助动词，词形栏里早就写着（<code>ist gegangen</code>），但从来没考过。大体上位移和状态变化用 sein，其余用 haben —— 例外只能靠练出来。`;
  if (kind === "cloze") return `<b>例句填空 · 可练 ${n} 个词。</b> 把词从它自己的例句里挖掉，看着句子写回去。原形和句子里的变化形式都算对。`;
  if (kind === "conj") return `<b>动词变位 · 可练 ${n} 个动词。</b> <code>nehmen → er nimmt</code>（不是 nehmt），<code>aufstehen → er steht auf</code>（前缀甩到后面）。词形栏里写得清清楚楚，但之前只被拿来出助动词题。带 Präteritum 的词条会轮到过去式。`;
  if (kind === "rektion") return `<b>介词 + 格 · 可练 ${n} 个词条。</b> 德语动词跟哪个介词、带哪个格，<b>不跟中文走</b>：等待是 <code>warten auf +四格</code>，不是 für。写错了德国人也听得懂，所以没人纠正你——B1 考的正是这个。提示里的括号会先摘掉，不然等于把答案写在题面上。`;
  return `<b>听写 · 可练 ${n} 个词。</b> 听德语写出来，先不给中文。${LhasGermanVoice() ? "" : "<br><b>注意：这台设备没有德语语音</b>，朗读会带口音甚至读错，建议先在系统里装一个德语语音。"}`;
}
// One overall figure flatters the learner whenever an answer is much commoner
// than the rest: guessing "die" alone scores about 45%. Both drills with a
// lopsided answer set are broken out per answer instead.
function LdrillRow(label, total, stat) {
  return `<div class="drillRow"><span><b>${label}</b> · 词库 ${total}</span><span>${stat.n ? `${stat.pct}% （${stat.ok}/${stat.n}）` : "还没练过"}</span></div>`;
}
function LdrillBreakdown() {
  if (drillKind === "gender") return ["der", "die", "das"]
    .map(a => LdrillRow(a, LdrillNouns().filter(c => LdrillArticle(c) === a).length, LdrillAccuracy("gender", c => LdrillArticle(c) === a))).join("");
  if (drillKind === "aux") return ["haben", "sein"]
    .map(a => LdrillRow(a, LauxCards().filter(c => LauxOf(c).aux === a).length, LdrillAccuracy("aux", c => LauxOf(c).aux === a))).join("");
  if (drillKind === "rektion") return [["搭配（词 + 介词 + 格）", "prep"], ["介词支配的格", "case"]]
    .map(([label, k]) => LdrillRow(label, LrektionCards().filter((c) => LrektionOf(c).kind === k).length, LdrillAccuracy("rektion", (c) => LrektionOf(c).kind === k))).join("");
  // Three different ways to get a conjugation wrong, and one score would hide
  // the only one that matters: a stem vowel nobody warned you about.
  if (drillKind === "conj") {
    const pick = { "变元音 / 不规则": (c) => !LconjOf(c).regular && !LconjOf(c).separable, "可分动词": (c) => LconjOf(c).separable, "规则变位": (c) => LconjOf(c).regular, "过去式 (Präteritum)": (c) => !!LconjOf(c).past };
    return Object.entries(pick).map(([label, f]) => LdrillRow(label, LconjCards().filter(f).length, LdrillAccuracy("conj", f))).join("");
  }
  const s = LdrillAccuracy(drillKind), label = drillKind === "plural" ? "复数" : drillKind === "cloze" ? "例句填空" : "听写";
  return `<div class="drillRow"><span>${label}练习准确率</span><span>${s.n ? `${s.pct}% （${s.ok}/${s.n}）` : "还没练过"}</span></div>`;
}
const LDRILL_GROUPS = [["名词", ["gender", "plural"]], ["动词", ["conj", "aux", "rektion"]], ["综合", ["cloze", "dictation"]]];
function LdrillCount(kind) {
  const base = LdrillPoolFor(kind);
  return (drillLevel === "ALL" ? base : base.filter((c) => c.level === drillLevel)).length;
}
// Seven tabs in one row wrapped 3/3/1. Grouped by what they train, each one
// says how many questions this deck gives it, and an empty one is dimmed — but
// still opens, because its panel explains what the deck is missing.
function LrenderDrillHome() {
  const box = L$("drillContent"), pool = LdrillPool();
  const tab = (d) => { const n = LdrillCount(d.kind); return `<button class="secondary ${d.kind === drillKind ? "on" : ""} ${n ? "" : "off"}" id="${d.id}" data-kind="${d.kind}">${d.tab}<span class="drillN">${n}</span></button>` };
  box.innerHTML = `<div class="drillGroups">${LDRILL_GROUPS.map(([name, kinds]) => `<div class="drillGroup"><div class="drillGroupName">${name}</div><div class="drillTabs">${kinds.map((k) => tab(LDRILLS.find((d) => d.kind === k))).join("")}</div></div>`).join("")}</div>
<div class="coverage">${LdrillBlurb(drillKind, pool.length)}</div>
<label style="margin:12px 0 4px">级别<select id="drillLevel">${LlevelChoices()}</select></label>
<div class="drillBreak">${LdrillBreakdown()}</div>
<div class="wrongActions" style="margin-top:14px"><button class="primary" id="drillStart" ${pool.length ? "" : "disabled"}>开始 20 题</button></div>`;
  L$("drillLevel").value = drillLevel;
  L$("drillLevel").onchange = e => { drillLevel = e.target.value; DWStore.prefs({ drillLevel }); LrenderDrillHome() };
  box.querySelectorAll(".drillTabs button").forEach(b => b.onclick = () => { drillKind = b.dataset.kind; DWStore.prefs({ drill: drillKind }); LrenderDrillHome() });
  L$("drillStart").onclick = LstartDrill;
}
function LstartDrill() { drillQueue = LdrillPick(20); drillPos = 0; drillScore = 0; drillAnswered = false; LrenderDrill() }

function LrenderDrill() {
  const box = L$("drillContent");
  if (drillPos >= drillQueue.length) {
    const pct = drillQueue.length ? Math.round(drillScore / drillQueue.length * 100) : 0;
    box.innerHTML = `<div class="sessionDone"><div class="big">🎉</div><h2>本轮完成</h2><p class="sub">${drillScore} / ${drillQueue.length} 正确，正确率 ${pct}%。</p><div class="wrongActions"><button class="primary" id="drillAgain">再来 20 题</button><button class="secondary" id="drillBack">返回</button></div></div>`;
    L$("drillAgain").onclick = LstartDrill;
    L$("drillBack").onclick = LrenderDrillHome;
    return;
  }
  drillAnswered = false;
  const c = drillQueue[drillPos];
  const head = `<div class="wrongMini">${drillPos + 1} / ${drillQueue.length} · ${Lesc(c.level)} Kapitel ${Lesc(String(c.chapter))}</div>`;
  if (drillKind === "dictation") {
    box.innerHTML = `${head}<div class="drillWord drillEar">${Licon("speaker",44)}</div><div class="drillHint">听德语，写出这个词</div><div class="wrongActions" style="justify-content:center"><button class="primary" id="drillPlay">再听一遍</button></div><div class="wrongPracticeBox"><input id="drillAnswer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="写下你听到的…">${LcharBar("drillAnswer")}<div class="wrongActions"><button class="primary" id="drillCheck">检查</button><button class="secondary" id="drillShow">听不出</button></div></div><div id="drillFeedback"></div>`;
    const input = L$("drillAnswer");
    L$("drillPlay").onclick = () => Lspeak(c.de);
    L$("drillCheck").onclick = () => LanswerDictation(c, false);
    L$("drillShow").onclick = () => LanswerDictation(c, true);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); LanswerDictation(c, false) } });
    setTimeout(() => { Lspeak(c.de); input.focus() }, 120);
  } else if (drillKind === "gender") {
    box.innerHTML = `${head}<div class="drillWord">${Lesc(LdrillStem(c))}</div><div class="drillHint">${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))}</div><div class="genderGrid">${["der", "die", "das"].map(a => `<button class="secondary" data-a="${a}">${a}</button>`).join("")}</div><div id="drillFeedback"></div>`;
    document.querySelectorAll("#drillContent .genderGrid button").forEach(b => b.onclick = () => LanswerGender(c, b.dataset.a));
  } else if (drillKind === "aux") {
    const a = LauxOf(c);
    box.innerHTML = `${head}<div class="drillWord">___ ${Lesc(a.part)}</div><div class="drillHint">${Lesc(c.de)} · ${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))}<br>完成时用哪个助动词？</div><div class="genderGrid two">${["haben", "sein"].map(x => `<button class="secondary" data-a="${x}">${x}</button>`).join("")}</div><div id="drillFeedback"></div>`;
    document.querySelectorAll("#drillContent .genderGrid button").forEach(b => b.onclick = () => LanswerAux(c, b.dataset.a));
  } else if (drillKind === "rektion") {
    const r = LrektionOf(c), opts = LrektionOptions(c), hint = LrektionHint(c);
    const ask = r.kind !== "case" ? "跟哪个介词？带什么格？" : r.isPrep ? "这个介词支配什么格？" : "这个词后面直接跟哪个格？";
    box.innerHTML = `${head}<div class="drillWord">${Lesc(c.de)}</div><div class="drillHint">${hint ? `${Lesc(hint)}<br>` : ""}${ask}</div><div class="genderGrid ${r.kind === "case" ? "" : "two"}">${opts.map((x) => `<button class="secondary" data-a="${Lesc(x)}">${Lesc(x)}</button>`).join("")}</div><div id="drillFeedback"></div>`;
    document.querySelectorAll("#drillContent .genderGrid button").forEach((b) => { b.onclick = () => LanswerRektion(c, b.dataset.a) });
  } else if (drillKind === "conj") {
    const k = LconjOf(c), ask = LconjAsk(c, drillPos);
    box.innerHTML = `${head}<div class="drillWord">${Lesc(c.de)}</div><div class="drillHint">${Lesc(LsenseFree(LhasZh(c) ? Lmeaning(c) : Lenglish(c)))}<br>${ask === "past" ? "写出过去式：<b>er ___</b>（Präteritum）" : "写出第三人称现在时：<b>er ___</b>"}</div><div class="wrongPracticeBox"><input id="drillAnswer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="er …">${LcharBar("drillAnswer")}<div class="wrongActions"><button class="primary" id="drillCheck">检查</button><button class="secondary" id="drillShow">看答案</button></div></div><div id="drillFeedback"></div>`;
    const input = L$("drillAnswer");
    L$("drillCheck").onclick = () => LanswerConj(c, ask, false);
    L$("drillShow").onclick = () => LanswerConj(c, ask, true);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); LanswerConj(c, ask, false) } });
    setTimeout(() => input.focus(), 60);
  } else if (drillKind === "cloze") {
    const span = LclozeSpan(c);
    box.innerHTML = `${head}<div class="drillHint">把句子补完整</div><div class="clozeSentence">${Lesc(span.before)}<span class="clozeBlank"></span>${Lesc(span.after)}</div><div class="drillHint">${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))}</div><div class="wrongPracticeBox"><input id="drillAnswer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="填进去的词…">${LcharBar("drillAnswer")}<div class="wrongActions"><button class="primary" id="drillCheck">检查</button><button class="secondary" id="drillShow">看答案</button></div></div><div id="drillFeedback"></div>`;
    const input = L$("drillAnswer");
    L$("drillCheck").onclick = () => LanswerCloze(c, false);
    L$("drillShow").onclick = () => LanswerCloze(c, true);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); LanswerCloze(c, false) } });
    setTimeout(() => input.focus(), 60);
  } else {
    box.innerHTML = `${head}<div class="drillWord">${Lesc(c.de)}</div><div class="drillHint">${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))} · 写出复数形式</div><div class="wrongPracticeBox"><input id="drillAnswer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="die …">${LcharBar("drillAnswer")}<div class="wrongActions"><button class="primary" id="drillCheck">检查</button><button class="secondary" id="drillShow">看答案</button></div></div><div id="drillFeedback"></div>`;
    const input = L$("drillAnswer");
    L$("drillCheck").onclick = () => LanswerPlural(c, false);
    L$("drillShow").onclick = () => LanswerPlural(c, true);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); LanswerPlural(c, false) } });
    setTimeout(() => input.focus(), 60);
  }
}
function LdrillNext(ok, correctHTML) {
  const fb = L$("drillFeedback");
  fb.className = "feedback show " + (ok ? "ok" : "no");
  fb.innerHTML = `<b>${ok ? "✓ 对了" : "✗ 正确答案"}</b>${correctHTML}<div class="wrongActions"><button class="primary" id="drillNext">下一题</button></div>`;
  L$("drillNext").onclick = () => { drillPos++; LrenderDrill() };
  Lbring(L$("drillNext"), "end");
}
function LanswerGender(c, picked) {
  if (drillAnswered) return;
  drillAnswered = true;
  const right = LdrillArticle(c), ok = picked === right;
  if (ok) drillScore++;
  LdrillSave(c.id, "gender", ok);
  document.querySelectorAll("#drillContent .genderGrid button").forEach(b => {
    b.disabled = true;
    if (b.dataset.a === right) b.classList.add("correct");
    else if (b.dataset.a === picked) b.classList.add("wrong");
  });
  const pl = LpluralOf(c);
  LdrillNext(ok, `<div class="answerRow"><div class="deAnswer">${Lesc(c.de)}</div>${LspeakBtn(c.de)}</div>${pl ? `<div class="meta">复数：${Lesc(pl)} ${LspeakBtn(pl)}</div>` : ""}`);
}
function LanswerDictation(c, show) {
  if (drillAnswered) return;
  const input = L$("drillAnswer"), v = input.value.trim();
  if (!show && !v) return;
  drillAnswered = true;
  // Reuse the learning mode's spelling rule so the article stays optional here too.
  const ok = !show && LspellAccepted(c, v);
  if (ok) drillScore++;
  LdrillSave(c.id, "dictation", ok);
  input.disabled = L$("drillCheck").disabled = L$("drillShow").disabled = true;
  LdrillNext(ok, `<div class="answerRow"><div class="deAnswer">${Lesc(c.de)}</div>${LspeakBtn(c.de)}</div><div class="meta">${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))}</div>${!ok && !show && v ? `<div class="wrongInput">你写的是：${Lesc(v)}</div>` : ""}`);
}
function LanswerPlural(c, show) {
  if (drillAnswered) return;
  const input = L$("drillAnswer"), v = input.value.trim();
  if (!show && !v) return;
  drillAnswered = true;
  const want = LpluralOf(c), alts = LpluralAlts(c);
  const norm = s => Lnorm(s).replace(/^die\s+/, "");
  const ok = !show && alts.some(a => norm(v) === norm(a));
  if (ok) drillScore++;
  LdrillSave(c.id, "plural", ok);
  input.disabled = L$("drillCheck").disabled = L$("drillShow").disabled = true;
  LdrillNext(ok, `<div class="answerRow"><div class="deAnswer">${Lesc(want)}</div>${LspeakBtn(want)}</div>${alts.length > 1 ? `<div class="meta">也可以是：${alts.filter(a => a !== want).map(Lesc).join(" / ")}</div>` : ""}<div class="meta">单数：${Lesc(c.de)}${c.grammar ? ` · 词形记号 ${Lesc(c.grammar)}` : ""}</div>${!ok && !show && v ? `<div class="wrongInput">你写的是：${Lesc(v)}</div>` : ""}`);
}

function LanswerAux(c, picked) {
  if (drillAnswered) return;
  drillAnswered = true;
  const a = LauxOf(c), ok = picked === a.aux;
  if (ok) drillScore++;
  LdrillSave(c.id, "aux", ok);
  document.querySelectorAll("#drillContent .genderGrid button").forEach(b => {
    b.disabled = true;
    if (b.dataset.a === a.aux) b.classList.add("correct");
    else if (b.dataset.a === picked) b.classList.add("wrong");
  });
  const perfect = `er ${a.aux === "haben" ? "hat" : "ist"} ${a.part}`;
  LdrillNext(ok, `<div class="answerRow"><div class="deAnswer">${Lesc(perfect)}</div>${LspeakBtn(perfect)}</div><div class="meta">${Lesc(c.de)} · ${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))}</div><div class="meta">词形：${Lesc(c.grammar)}</div>`);
}
function LanswerRektion(c, picked) {
  if (drillAnswered) return;
  drillAnswered = true;
  const r = LrektionOf(c), ok = LrektionAccepted(c, picked);
  if (ok) drillScore++;
  LdrillSave(c.id, "rektion", ok);
  const right = r.kind === "case" ? r.cases : r.combos.map(LrektionLabel);
  document.querySelectorAll("#drillContent .genderGrid button").forEach((b) => {
    b.disabled = true;
    if (right.includes(b.dataset.a)) b.classList.add("correct");
    else if (b.dataset.a === picked) b.classList.add("wrong");
  });
  const shown = r.kind === "case" ? `${c.de} + ${right.join(" / ")}` : right.map((x) => `${LdrillStem(c)} ${x}`).join("　/　");
  LdrillNext(ok, `<div class="answerRow"><div class="deAnswer">${Lesc(shown)}</div></div><div class="meta">${Lesc(LhasZh(c) ? Lmeaning(c) : Lenglish(c))}</div>${c.example ? `<div class="example"><div class="exampleDe">${Lesc(LexampleDe(c))}</div></div>` : ""}`);
}
function LanswerConj(c, ask, show) {
  if (drillAnswered) return;
  const v = L$("drillAnswer").value.trim();
  if (!show && !v) return;
  drillAnswered = true;
  const k = LconjOf(c), want = ask === "past" ? k.past : k.present;
  const ok = !show && LconjAccepted(c, ask, v);
  if (ok) drillScore++;
  LdrillSave(c.id, "conj", ok);
  L$("drillAnswer").disabled = L$("drillCheck").disabled = L$("drillShow").disabled = true;
  // The whole row is shown whichever form was asked: the point of a strong verb
  // is that its three forms go together.
  const row = [`er ${k.present}`, k.past ? `er ${k.past}` : "", k.perfect ? `er ${k.perfect}` : ""].filter(Boolean).join("　·　");
  const why = k.separable ? "可分动词：前缀甩到句末。" : k.regular ? "" : "强变化：词干元音变了，这类只能记。";
  LdrillNext(ok, `<div class="answerRow"><div class="deAnswer">er ${Lesc(want)}</div>${LspeakBtn(`er ${want}`)}</div><div class="meta">${Lesc(row)}</div>${why ? `<div class="meta">${why}</div>` : ""}${!ok && !show && v ? `<div class="wrongInput">你写的是：${Lesc(v)}</div>` : ""}`);
}
function LanswerCloze(c, show) {
  if (drillAnswered) return;
  const input = L$("drillAnswer"), v = input.value.trim();
  if (!show && !v) return;
  drillAnswered = true;
  const span = LclozeSpan(c), ok = !show && LclozeAccepted(c, span, v);
  if (ok) drillScore++;
  LdrillSave(c.id, "cloze", ok);
  input.disabled = L$("drillCheck").disabled = L$("drillShow").disabled = true;
  const full = LexampleDe(c), zh = LexampleZh(c);
  LdrillNext(ok, `<div class="clozeSentence">${Lesc(span.before)}<b class="clozeHit">${Lesc(span.word)}</b>${Lesc(span.after)} ${LspeakBtn(full)}</div>${zh ? `<div class="meta">${Lesc(zh)}</div>` : ""}<div class="meta">词条：${Lesc(c.de)}</div>${!ok && !show && v ? `<div class="wrongInput">你写的是：${Lesc(v)}</div>` : ""}`);
}

function LinitDrillUI() {
  const anchor = L$("learnMasteredBtn") || L$("learnWrongBtn") || L$("learnReviewBtn");
  if (anchor && !L$("learnDrillBtn")) {
    const b = document.createElement("button");
    b.id = "learnDrillBtn";
    b.className = "secondary";
    b.textContent = "专项训练";
    anchor.after(b);
    b.onclick = () => LopenDrill();
  }
  LbuildDrillUI();
}
