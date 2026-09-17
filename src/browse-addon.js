/* BROWSE_ADDON_V1 */
// A deck of 5434 words across 36 Kapitel had no way to answer either of the two
// questions you actually ask it: "where is this word" and "where am I". This is
// both — one sheet whose empty state is the map of the deck and whose typing
// state is a search over it. Setting the study position lives here too, because
// the map is where you point at a chapter anyway.

let browseQuery = "";
let browsePick = null;
const LBROWSE_LIMIT = 60;

// Search has to survive a keyboard without umlauts. Folding both ways on the
// haystack rather than guessing at the needle keeps `Bruder` from being read as
// `Brüder` while still letting `tuer` and `tur` both find `die Tür`.
const LfoldBase = (s) => String(s || "").toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
const LfoldAe = (s) => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
const LbrowseHays = new Map();
function LbrowseHay(c) {
  let h = LbrowseHays.get(c.id);
  if (h === undefined) {
    h = [LfoldBase(c.de), LfoldAe(c.de), String(c.zh || "").toLowerCase(), LfoldBase(c.en), String(c.grammar || "").toLowerCase()].join("\n");
    LbrowseHays.set(c.id, h);
  }
  return h;
}
function LbrowseMatch(c, needle) {
  return !needle || LbrowseHay(c).includes(needle);
}
function LbrowseFind(q) {
  const needle = LfoldBase(String(q || "").trim());
  if (!needle) return [];
  const hit = [];
  for (const c of LallLearningCards()) if (LbrowseMatch(c, needle)) hit.push(c);
  // An exact word is what you meant, in either language: typing 花 should reach
  // 花 before 花园, exactly as typing `Tür` reaches `die Tür` before `die Türklinke`.
  // A gloss is several senses in one field, so each is compared on its own.
  const senses = (s) => String(s || "").split(/[；;，,、/]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const rank = (c) => {
    const de = LfoldBase(c.de), bare = de.replace(/^(der|die|das)\s+/, "");
    if (de === needle || bare === needle) return 0;
    const gloss = senses(LsenseFree(c.zh)).concat(senses(LfoldBase(LsenseFree(c.en))));
    if (gloss.includes(needle)) return 1;
    if (de.startsWith(needle) || bare.startsWith(needle)) return 2;
    if (gloss.some((x) => x.startsWith(needle))) return 3;
    if (de.includes(needle)) return 4;
    return 5;
  };
  return hit.map((c, i) => ({ c, r: rank(c), i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
}

function LcardStatus(c) {
  const s = Lstate(c);
  if (Lmastered(s)) return { key: "mastered", label: "已掌握" };
  if (!s.introduced) return { key: "fresh", label: "还没学" };
  if ((s.due || 0) <= Date.now()) return { key: "due", label: "待复习" };
  return { key: "learning", label: "学习中" };
}
function LchapStat(g) {
  const out = { fresh: 0, learning: 0, due: 0, mastered: 0, total: g.cards.length };
  for (const c of g.cards) out[LcardStatus(c).key]++;
  out.done = out.mastered + out.learning + out.due;
  return out;
}

function LbrowseStyles() {
  if (document.getElementById("browseStyles")) return;
  const st = document.createElement("style");
  st.id = "browseStyles";
  st.textContent = `.posBar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--soft);border:1px solid #d7deff;border-radius:14px;padding:11px 14px;margin-bottom:12px}.posBar:empty{display:none}.posNow{font-size:14px;line-height:1.5}.posAsk{display:flex;flex-direction:column;gap:3px;flex:1 1 220px}.posBar button{padding:8px 14px;font-size:13px}
.browseOverlay{position:fixed;inset:0;z-index:9998;background:rgba(18,25,38,.58);display:flex;align-items:flex-end;justify-content:center}.browseOverlay.hidden{display:none}.browseSheet{background:#fff;width:min(760px,100%);max-height:92vh;border-radius:22px 22px 0 0;padding:18px;overflow:auto;box-shadow:0 -16px 50px rgba(0,0,0,.18)}.browseHead{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-18px;background:#fff;padding:16px 0 10px;z-index:2}.browseHead h2{margin:0;font-size:24px}#browseInput{margin-bottom:6px}
.mapLevel{margin-top:14px}.mapLevel h3{margin:0 0 8px;font-size:15px;color:var(--muted)}.mapGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}.mapTile{text-align:left;background:#fff;border:1px solid var(--line);border-radius:12px;padding:9px 10px;font-weight:700;font-size:13px;cursor:pointer}.mapTile.on{border-color:var(--accent);box-shadow:0 0 0 2px rgba(49,94,251,.16)}.mapTile.here{background:var(--soft)}.mapBar{height:6px;border-radius:99px;background:#e9edf5;overflow:hidden;margin:7px 0 5px;display:flex}.mapBar i{display:block;height:100%}.mapBar .m{background:#0a8f55}.mapBar .l{background:#4a69ff}.mapCount{font-size:11px;color:var(--muted);font-weight:600}
.mapActions{border:1px solid var(--line);border-radius:14px;padding:13px;margin-top:12px;background:#fbfcff}.mapActions h4{margin:0 0 4px;font-size:17px}.mapActions .row{margin-top:10px}.mapActions button{padding:9px 13px;font-size:13px}
.browseList{display:grid;gap:8px;margin-top:10px}.browseItem{border:1px solid var(--line);border-radius:12px;padding:11px 12px;background:#fff}.browseTop{display:flex;justify-content:space-between;gap:10px;align-items:baseline}.browseWord{font-size:19px;font-weight:800}.browseTag{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;white-space:nowrap}.browseTag.fresh{background:#eef1f6;color:var(--muted)}.browseTag.learning{background:#eaf0ff;color:#3a53bf}.browseTag.due{background:#fff2e2;color:#a4620f}.browseTag.mastered{background:#e7f6ee;color:var(--good)}.browseWhere{font-size:12px;color:var(--muted);margin-top:5px}.browseEmpty{text-align:center;padding:38px 10px;color:var(--muted)}
@media(min-width:700px){.browseOverlay{align-items:center;padding:18px}.browseSheet{border-radius:22px;max-height:88vh}}`;
  document.head.appendChild(st);
}

// The home screen says where you are before it says what is due, because the
// first question anyone has on reopening a year-long deck is "where was I".
function LrenderPosBar() {
  const el = L$("posBar");
  if (!el || typeof CARDS === "undefined" || !CARDS.length) return;
  const g = LposGroup();
  if (!g) { el.innerHTML = ""; return; }
  if (LposIndex() >= 0) {
    const left = g.cards.filter(Lunlearned).length;
    // Browsing a different Kapitel on the learn page is allowed and does not
    // move the position, so the bar says so instead of letting the two disagree
    // in silence.
    const sc = Lscope(), elsewhere = sc.level !== g.level || String(sc.chapter) !== g.chapter;
    el.innerHTML = `<div class="posNow">📍 学到 <b>${Lesc(g.level)} Kapitel ${Lesc(g.chapter)}</b> · 本章还有 <b>${left}</b> 个新词没学（共 ${g.cards.length}）${elsewhere ? `<br><span class="small">学新词页上次在看 ${Lesc(sc.level)} Kapitel ${Lesc(String(sc.chapter))}</span>` : ""}</div><button class="secondary" id="posEdit">换一章</button>`;
  } else {
    el.innerHTML = `<div class="posAsk"><b>你已经学到哪一章了？</b><span class="small">不说的话，今日任务会从词库第一章开始给新词。</span></div><button class="primary" id="posEdit">告诉它</button>`;
  }
  L$("posEdit").onclick = () => LopenBrowse("");
}

function LbuildBrowseUI() {
  LbrowseStyles();
  if (L$("browseOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "browseOverlay";
  ov.className = "browseOverlay hidden";
  ov.innerHTML = `<div class="browseSheet"><div class="browseHead"><h2>🔍 查词 · 章节地图</h2><button class="secondary" id="browseClose">关闭</button></div><input id="browseInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="德语、中文或英文都能查…"><div id="browseBody"></div></div>`;
  document.body.appendChild(ov);
  L$("browseClose").onclick = LcloseBrowse;
  ov.addEventListener("click", (e) => { if (e.target === ov) LcloseBrowse(); });
  L$("browseInput").addEventListener("input", (e) => { browseQuery = e.target.value; browsePick = null; LrenderBrowse(); });
}
function LopenBrowse(q = "") {
  LbuildBrowseUI();
  browseQuery = q;
  browsePick = null;
  L$("browseInput").value = q;
  LrenderBrowse();
  L$("browseOverlay").classList.remove("hidden");
  if (q) setTimeout(() => { try { L$("browseInput").focus({ preventScroll: true }); } catch (e) { L$("browseInput").focus(); } }, 60);
}
function LcloseBrowse() { L$("browseOverlay").classList.add("hidden"); }

function LmapTile(g, i) {
  const st = LchapStat(g), here = LposGroup() === g;
  const pct = (n) => `${Math.round((n / Math.max(1, st.total)) * 100)}%`;
  return `<button class="mapTile ${browsePick === i ? "on" : ""} ${here ? "here" : ""}" data-i="${i}">Kapitel ${Lesc(g.chapter)}${here ? " 📍" : ""}<div class="mapBar"><i class="m" style="width:${pct(st.mastered)}"></i><i class="l" style="width:${pct(st.learning + st.due)}"></i></div><div class="mapCount">${st.done}/${st.total} 学过</div></button>`;
}
function LmapActions(i) {
  const gs = LchapGroups(), g = gs[i], st = LchapStat(g);
  const before = gs.slice(0, i).reduce((n, x) => n + x.cards.filter(Lunlearned).length, 0);
  return `<div class="mapActions"><h4>${Lesc(g.level)} Kapitel ${Lesc(g.chapter)}</h4><div class="small">${st.total} 个词 · 还没学 ${st.fresh} · 学习中 ${st.learning + st.due} · 已掌握 ${st.mastered}</div>
<div class="row"><button class="primary" id="mapStartHere">从这一章开始</button>${before ? `<button class="secondary" id="mapKnowBefore">这之前的 ${before} 个我都会了</button>` : ""}${st.fresh ? `<button class="secondary" id="mapKnowThis">这一章我都会了</button>` : ""}<button class="secondary" id="mapListThis">看这一章的词</button></div></div>`;
}
function LrenderBrowse() {
  const box = L$("browseBody"), q = String(browseQuery || "").trim();
  if (q) {
    const hits = LbrowseFind(q);
    box.innerHTML = hits.length
      ? `<div class="coverage">找到 <b>${hits.length}</b> 个${hits.length > LBROWSE_LIMIT ? `，先显示前 ${LBROWSE_LIMIT} 个` : ""}。</div><div class="browseList">${hits.slice(0, LBROWSE_LIMIT).map(LbrowseRow).join("")}</div>`
      : `<div class="browseEmpty"><div style="font-size:40px">🔍</div><h3>词库里没有「${Lesc(q)}」</h3><p class="small">德语、中文、英文和词形栏都查了。变音字母可以不打，<code>tur</code> 和 <code>tuer</code> 都能找到 <code>die Tür</code>。</p></div>`;
    return;
  }
  const gs = LchapGroups(), byLevel = new Map();
  gs.forEach((g, i) => { if (!byLevel.has(g.level)) byLevel.set(g.level, []); byLevel.get(g.level).push(i); });
  box.innerHTML = `<div class="coverage">共 ${gs.length} 章 · ${LallLearningCards().length} 个词。<b>📍 是今日任务取新词的位置</b>，点任意一章可以改。</div>`
    + [...byLevel.entries()].map(([lv, idx]) => `<div class="mapLevel"><h3>${Lesc(lv)}</h3><div class="mapGrid">${idx.map((i) => LmapTile(gs[i], i)).join("")}</div></div>`).join("")
    + (browsePick == null ? "" : LmapActions(browsePick));
  box.querySelectorAll(".mapTile").forEach((b) => { b.onclick = () => { const i = +b.dataset.i; browsePick = browsePick === i ? null : i; LrenderBrowse(); }; });
  if (browsePick != null) LbindMapActions(browsePick);
}
function LbrowseRow(c) {
  const st = LcardStatus(c), zh = LhasZh(c) ? Lmeaning(c) : "", en = Lenglish(c);
  return `<div class="browseItem"><div class="browseTop"><div class="browseWord">${Lesc(c.de)}</div><span class="browseTag ${st.key}">${st.label}</span></div><div>${zh ? `${Lesc(zh)}${en ? ` <span class="browseWhere">· ${Lesc(en)}</span>` : ""}` : Lesc(en)}</div><div class="browseWhere">${Lesc(c.level)} · Kapitel ${Lesc(String(c.chapter))}${c.grammar ? ` · ${Lesc(c.grammar)}` : ""}</div>${c.example ? `<div class="browseWhere">${Lesc(LexampleDe(c))}</div>` : ""}<div class="editRow">${typeof LeditBtn === "function" ? LeditBtn(c.id) : ""}</div></div>`;
}
function LbindMapActions(i) {
  const gs = LchapGroups(), g = gs[i];
  L$("mapStartHere").onclick = () => { LsetPos(g.level, g.chapter); LrenderBrowse(); };
  const before = L$("mapKnowBefore");
  if (before) before.onclick = () => { if (LmarkKnown(gs.slice(0, i).flatMap((x) => x.cards), `${g.level} Kapitel ${g.chapter} 之前`)) { LsetPos(g.level, g.chapter); LrenderBrowse(); } };
  const this_ = L$("mapKnowThis");
  if (this_) this_.onclick = () => { if (LmarkKnown(g.cards, `${g.level} Kapitel ${g.chapter}`)) LrenderBrowse(); };
  L$("mapListThis").onclick = () => { browseQuery = ""; L$("browseInput").value = ""; LshowChapterList(i); };
}
function LshowChapterList(i) {
  const g = LchapGroups()[i];
  L$("browseBody").innerHTML = `<div class="coverage"><b>${Lesc(g.level)} Kapitel ${Lesc(g.chapter)} · ${g.cards.length} 个词</b> <button class="secondary" id="mapBack" style="padding:5px 11px;font-size:12px">← 回到地图</button></div><div class="browseList">${g.cards.map(LbrowseRow).join("")}</div>`;
  L$("mapBack").onclick = LrenderBrowse;
}

// Marking a chapter known is the same promise the 「这个我已经会」 button makes,
// so it takes the same shape — including the spot check that now follows it. The
// due dates are fanned out across the 30–90 day window rather than all landing on
// one morning, so a whole Kapitel waved through does not arrive as a wall.
function LmarkKnown(cards, label) {
  const todo = cards.filter(Lunlearned);
  if (!todo.length) return false;
  if (!confirm(`把 ${label} 的 ${todo.length} 个词标为「已会」吗？\n\n它们会进入「已掌握」，不再作为新词出现，但每天最多 5 个会回到今日任务抽查一次——答错就退回学习中。\n\n改主意了可以在学习页用「重置当前章节进度」撤销。`)) return false;
  const now = Date.now(), span = 60 * 24 * 60 * 60 * 1000, base = 30 * 24 * 60 * 60 * 1000;
  // Written straight into the progress map rather than one Lsave per card: that
  // path redraws every counter on the page, and a whole A1 is 1956 of them.
  todo.forEach((c, i) => {
    const s = Lstate(c);
    s.introduced = true; s.known = true; s.strength = 5; s.spellingPass = true; s.cycles = 3;
    s.last = now;
    s.due = now + base + Math.round((span * i) / Math.max(1, todo.length - 1));
    learnProgress[c.id] = s;
  });
  DWStore.queue(LEARN_KEY, () => learnProgress);
  DWStore.flush();
  if (typeof bank === "function") bank();
  Lstats();
  LhomeStats();
  if (typeof LupdateMasteredBadge === "function") LupdateMasteredBadge();
  return true;
}

function LinitBrowseUI() {
  const anchor = L$("learnDrillBtn") || L$("learnMasteredBtn") || L$("learnWrongBtn") || L$("learnReviewBtn");
  if (anchor && !L$("learnBrowseBtn")) {
    const b = document.createElement("button");
    b.id = "learnBrowseBtn";
    b.className = "secondary";
    b.textContent = "🔍 查词";
    anchor.after(b);
    b.onclick = () => LopenBrowse("");
  }
  LbuildBrowseUI();
  LrenderPosBar();
}
