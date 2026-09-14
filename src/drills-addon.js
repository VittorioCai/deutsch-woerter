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
    return /^[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*$/.test(form) ? `die ${form}` : null;
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

function LdrillPool() {
  const base = drillKind === "plural" ? LdrillPluralNouns() : drillKind === "dictation" ? LdictationCards() : LdrillNouns();
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
  st.textContent = `.drillOverlay{position:fixed;inset:0;z-index:9997;background:rgba(18,25,38,.58);display:flex;align-items:flex-end;justify-content:center}.drillOverlay.hidden{display:none}.drillSheet{background:#fff;width:min(760px,100%);max-height:92vh;border-radius:22px 22px 0 0;padding:18px;overflow:auto;box-shadow:0 -16px 50px rgba(0,0,0,.18)}.drillHead{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;background:#fff;padding:16px 0 10px;z-index:2}.drillHead h2{margin:0;font-size:24px}.drillTabs{display:flex;gap:8px;margin-bottom:12px}.drillTabs button{flex:1}.drillTabs button.on{background:var(--accent);color:#fff}.drillWord{font-size:clamp(30px,8vw,46px);font-weight:800;text-align:center;margin:26px 0 6px;word-break:break-word}.drillHint{text-align:center;color:var(--muted);font-size:13px;margin-bottom:22px}.genderGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.genderGrid button{padding:20px 0;font-size:21px;font-weight:800}.genderGrid button.correct{background:#0a8f55;color:#fff}.genderGrid button.wrong{background:#c73737;color:#fff}.drillStats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.drillEmpty{text-align:center;padding:45px 10px;color:var(--muted)}.drillBreak{display:grid;gap:6px;margin-top:10px;font-size:13px;color:var(--muted)}.drillRow{display:flex;justify-content:space-between;gap:10px;padding:7px 10px;border:1px solid var(--line);border-radius:10px}@media(min-width:700px){.drillOverlay{align-items:center;padding:18px}.drillSheet{border-radius:22px;max-height:88vh}}`;
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
  for (const c of LdrillNouns()) {
    if (filter && !filter(c)) continue;
    const s = LdrillState(c.id, kind);
    n += s.n; ok += s.ok;
  }
  return { n, ok, pct: n ? Math.round(ok / n * 100) : null };
}
function LrenderDrillHome() {
  const box = L$("drillContent"), pool = LdrillPool();
  const genderOn = drillKind === "gender", pluralOn = drillKind === "plural", dictOn = drillKind === "dictation";
  // Guessing "die" alone scores about 45%, so a single overall figure flatters
  // the learner. Accuracy is broken out per article instead.
  const perArticle = ["der", "die", "das"].map(a => {
    const s = LdrillAccuracy("gender", c => LdrillArticle(c) === a);
    const total = LdrillNouns().filter(c => LdrillArticle(c) === a).length;
    return `<div class="drillRow"><span><b>${a}</b> · 词库 ${total}</span><span>${s.n ? `${s.pct}% （${s.ok}/${s.n}）` : "还没练过"}</span></div>`;
  }).join("");
  const plural = LdrillAccuracy("plural");
  box.innerHTML = `<div class="drillTabs"><button class="secondary ${genderOn ? "on" : ""}" id="tabGender">der / die / das</button><button class="secondary ${pluralOn ? "on" : ""}" id="tabPlural">复数形式</button><button class="secondary ${dictOn ? "on" : ""}" id="tabDictation">听写</button></div>
<div class="coverage">${genderOn
    ? `<b>性别专项 · 可练 ${pool.length} 个名词。</b> 拼写检查默认不强制冠词，所以性别几乎没被单独考过。已掌握的词不会出现。`
    : pluralOn
    ? `<b>复数专项 · 可练 ${pool.length} 个名词。</b> 复数形式由词库的词形记号推导（<code>"</code> 表示变音），无法确定的词不会出题。`
    : `<b>听写 · 可练 ${pool.length} 个词。</b> 听德语写出来，先不给中文。${LhasGermanVoice() ? "" : "<br><b>注意：这台设备没有德语语音</b>，朗读会带口音甚至读错，建议先在系统里装一个德语语音。"}`}</div>
<label style="margin:12px 0 4px">级别<select id="drillLevel">${LlevelChoices()}</select></label>
<div class="drillBreak">${genderOn ? perArticle : `<div class="drillRow"><span>${pluralOn ? "复数" : "听写"}练习准确率</span><span>${(() => { const s = LdrillAccuracy(drillKind); return s.n ? `${s.pct}% （${s.ok}/${s.n}）` : "还没练过" })()}</span></div>`}</div>
<div class="wrongActions" style="margin-top:14px"><button class="primary" id="drillStart" ${pool.length ? "" : "disabled"}>开始 20 题</button></div>`;
  L$("drillLevel").value = drillLevel;
  L$("drillLevel").onchange = e => { drillLevel = e.target.value; DWStore.prefs({ drillLevel }); LrenderDrillHome() };
  L$("tabGender").onclick = () => { drillKind = "gender"; DWStore.prefs({ drill: drillKind }); LrenderDrillHome() };
  L$("tabPlural").onclick = () => { drillKind = "plural"; DWStore.prefs({ drill: drillKind }); LrenderDrillHome() };
  L$("tabDictation").onclick = () => { drillKind = "dictation"; DWStore.prefs({ drill: drillKind }); LrenderDrillHome() };
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
