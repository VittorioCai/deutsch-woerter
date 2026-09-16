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
function LauxOf(c) {
  const m = (c.grammar || "").trim().match(/,\s*(hat|ist)\s+(\S.*)$/);
  return m ? { aux: m[1] === "hat" ? "haben" : "sein", part: m[2].trim() } : null;
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

function LdrillPoolFor(kind) {
  return kind === "plural" ? LdrillPluralNouns()
    : kind === "dictation" ? LdictationCards()
    : kind === "aux" ? LauxCards()
    : kind === "cloze" ? LclozeCards()
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
  st.textContent = `.drillOverlay{position:fixed;inset:0;z-index:9997;background:rgba(18,25,38,.58);display:flex;align-items:flex-end;justify-content:center}.drillOverlay.hidden{display:none}.drillSheet{background:#fff;width:min(760px,100%);max-height:92vh;border-radius:22px 22px 0 0;padding:18px;overflow:auto;box-shadow:0 -16px 50px rgba(0,0,0,.18)}.drillHead{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;background:#fff;padding:16px 0 10px;z-index:2}.drillHead h2{margin:0;font-size:24px}.drillTabs{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}.drillTabs button{flex:1 1 30%;padding:10px 6px;font-size:13px}.genderGrid.two{grid-template-columns:repeat(2,1fr)}.clozeSentence{font-size:clamp(18px,4.4vw,24px);line-height:1.8;text-align:center;margin:22px 0 8px;font-weight:650;word-break:break-word}.clozeBlank{display:inline-block;min-width:92px;border-bottom:3px solid var(--accent)}.clozeHit{color:var(--accent)}.drillTabs button.on{background:var(--accent);color:#fff}.drillWord{font-size:clamp(30px,8vw,46px);font-weight:800;text-align:center;margin:26px 0 6px;word-break:break-word}.drillHint{text-align:center;color:var(--muted);font-size:13px;margin-bottom:22px}.genderGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.genderGrid button{padding:20px 0;font-size:21px;font-weight:800}.genderGrid button.correct{background:#0a8f55;color:#fff}.genderGrid button.wrong{background:#c73737;color:#fff}.drillStats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.drillEmpty{text-align:center;padding:45px 10px;color:var(--muted)}.drillBreak{display:grid;gap:6px;margin-top:10px;font-size:13px;color:var(--muted)}.drillRow{display:flex;justify-content:space-between;gap:10px;padding:7px 10px;border:1px solid var(--line);border-radius:10px}@media(min-width:700px){.drillOverlay{align-items:center;padding:18px}.drillSheet{border-radius:22px;max-height:88vh}}`;
  document.head.appendChild(st);
}
function LbuildDrillUI() {
  LdrillStyles();
  const ov = document.createElement("div");
  ov.id = "drillOverlay";
  ov.className = "drillOverlay hidden";
  ov.innerHTML = `<div class="drillSheet"><div class="drillHead"><h2>🎲 专项训练</h2><button class="secondary" id="drillClose">关闭</button></div><div id="drillContent"></div></div>`;
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
  { kind: "aux", id: "tabAux", tab: "haben / sein" },
  { kind: "cloze", id: "tabCloze", tab: "例句填空" },
  { kind: "dictation", id: "tabDictation", tab: "听写" },
];
function LdrillBlurb(kind, n) {
  if (kind === "gender") return `<b>性别专项 · 可练 ${n} 个名词。</b> 拼写检查默认不强制冠词，所以性别几乎没被单独考过。已掌握的词不会出现。`;
  if (kind === "plural") return `<b>复数专项 · 可练 ${n} 个名词。</b> 复数形式由词库的词形记号推导（<code>"</code> 表示变音），无法确定的词不会出题。`;
  if (kind === "aux") return `<b>haben / sein · 可练 ${n} 个动词。</b> 完成时该用哪个助动词，词形栏里早就写着（<code>ist gegangen</code>），但从来没考过。大体上位移和状态变化用 sein，其余用 haben —— 例外只能靠练出来。`;
  if (kind === "cloze") return `<b>例句填空 · 可练 ${n} 个词。</b> 把词从它自己的例句里挖掉，看着句子写回去。原形和句子里的变化形式都算对。`;
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
  const s = LdrillAccuracy(drillKind), label = drillKind === "plural" ? "复数" : drillKind === "cloze" ? "例句填空" : "听写";
  return `<div class="drillRow"><span>${label}练习准确率</span><span>${s.n ? `${s.pct}% （${s.ok}/${s.n}）` : "还没练过"}</span></div>`;
}
function LrenderDrillHome() {
  const box = L$("drillContent"), pool = LdrillPool();
  box.innerHTML = `<div class="drillTabs">${LDRILLS.map(d => `<button class="secondary ${d.kind === drillKind ? "on" : ""}" id="${d.id}" data-kind="${d.kind}">${d.tab}</button>`).join("")}</div>
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
    box.innerHTML = `<div class="sessionDone"><div class="big">🎲</div><h2>本轮完成</h2><p class="sub">${drillScore} / ${drillQueue.length} 正确，正确率 ${pct}%。</p><div class="wrongActions"><button class="primary" id="drillAgain">再来 20 题</button><button class="secondary" id="drillBack">返回</button></div></div>`;
    L$("drillAgain").onclick = LstartDrill;
    L$("drillBack").onclick = LrenderDrillHome;
    return;
  }
  drillAnswered = false;
  const c = drillQueue[drillPos];
  const head = `<div class="wrongMini">${drillPos + 1} / ${drillQueue.length} · ${Lesc(c.level)} Kapitel ${Lesc(String(c.chapter))}</div>`;
  if (drillKind === "dictation") {
    box.innerHTML = `${head}<div class="drillWord">🔊</div><div class="drillHint">听德语，写出这个词</div><div class="wrongActions" style="justify-content:center"><button class="primary" id="drillPlay">再听一遍</button></div><div class="wrongPracticeBox"><input id="drillAnswer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" placeholder="写下你听到的…">${LcharBar("drillAnswer")}<div class="wrongActions"><button class="primary" id="drillCheck">检查</button><button class="secondary" id="drillShow">听不出</button></div></div><div id="drillFeedback"></div>`;
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
    b.textContent = "🎲 专项训练";
    anchor.after(b);
    b.onclick = () => LopenDrill();
  }
  LbuildDrillUI();
}
