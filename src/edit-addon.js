/* EDIT_ADDON_V1 */
// Proofreading a five-thousand-word deck used to mean leaving the app: fix the
// spreadsheet, re-import, and hope nothing shifted. Corrections now live here as
// a patch layer keyed by card id, kept in IndexedDB beside the deck, so they
// survive re-importing the word list they correct.
//
// A patch may change what a word means, how it inflects and the sentence it
// appears in. It may never change `de`: the card id is a hash of
// level|chapter|de, so editing the headword is not editing a card, it is
// discarding one and its entire history. Rename a word in the source file, with
// the consequences visible, or not at all.
const LEDIT_FIELDS = [
  { key: "zh", label: "中文释义", hint: "「这里：」开头表示这一章教的是这个意思——出选择题时会自动摘掉。" },
  { key: "en", label: "英文释义", hint: "" },
  { key: "grammar", label: "词形信息", hint: "名词写 <code>Plural: die Häuser</code> 或 <code>\"er</code>；动词写 <code>er nimmt, hat genommen</code>（B1 三分形中间加过去式）。专项训练全靠这一栏。" },
  { key: "example", label: "例句", hint: "写成 <code>Deutscher Satz.（中文翻译）</code>，例句填空和整句朗读靠这个格式。" },
];

function LeditStyles() {
  if (document.getElementById("editStyles")) return;
  const st = document.createElement("style");
  st.id = "editStyles";
  st.textContent = `.editOverlay{position:fixed;inset:0;z-index:9999;background:rgba(18,25,38,.58);display:flex;align-items:flex-end;justify-content:center}.editOverlay.hidden{display:none}.editSheet{background:#fff;width:min(620px,100%);max-height:92vh;border-radius:22px 22px 0 0;padding:18px;overflow:auto;box-shadow:0 -16px 50px rgba(0,0,0,.18)}.editHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.editHead h2{margin:0;font-size:23px}.editWord{font-size:26px;font-weight:800}.editLocked{font-size:12px;color:var(--muted);line-height:1.6;background:#f5f7fb;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:12px}.editField{margin-bottom:12px}.editField label{font-size:13px;color:var(--muted);margin-bottom:5px;display:block}.editField textarea{width:100%;border:1px solid #cfd5e2;border-radius:12px;padding:11px;font-size:15px;font-family:inherit;line-height:1.55;resize:vertical;min-height:52px}.editField .small{margin-top:5px}.editChanged{color:var(--accent);font-weight:700}.editBtn{padding:4px 10px;font-size:12px;white-space:nowrap}@media(min-width:700px){.editOverlay{align-items:center;padding:18px}.editSheet{border-radius:22px;max-height:88vh}}`;
  document.head.appendChild(st);
}
function LbuildEditUI() {
  LeditStyles();
  if (L$("editOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "editOverlay";
  ov.className = "editOverlay hidden";
  ov.innerHTML = `<div class="editSheet"><div class="editHead"><h2>✏️ 编辑词条</h2><button class="secondary" id="editClose">关闭</button></div><div id="editContent"></div></div>`;
  document.body.appendChild(ov);
  L$("editClose").onclick = LcloseEdit;
  ov.addEventListener("click", (e) => { if (e.target === ov) LcloseEdit() });
}
function LcloseEdit() { L$("editOverlay").classList.add("hidden") }
function LeditBtn(id) { return `<button type="button" class="secondary editBtn" data-edit="${Lesc(id)}">✏️ 改</button>` }
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-edit]");
  if (!b) return;
  e.preventDefault();
  LopenEdit(b.dataset.edit);
});

function LopenEdit(id) {
  const c = LallLearningCards().find((x) => x.id === id);
  if (!c) return;
  DWPatches.remember(c);
  LbuildEditUI();
  LrenderEdit(c);
  L$("editOverlay").classList.remove("hidden");
}
function LrenderEdit(c) {
  const patch = (DWPatches.get() || {})[c.id] || {};
  L$("editContent").innerHTML = `<div class="editWord">${Lesc(c.de)}</div>
<div class="editLocked"><b>德语词本身改不了。</b>卡片的编号是 <code>${Lesc(c.level)}|${Lesc(String(c.chapter))}|${Lesc(c.de)}</code> 算出来的哈希，改掉它等于换了一张新卡——这个词的全部学习进度会清零。真要改拼写，请在词库文件里改完重新导入。</div>
${LEDIT_FIELDS.map((f) => `<div class="editField"><label>${f.label}${patch[f.key] !== undefined ? ` · <span class="editChanged">已改过</span>` : ""}</label><textarea id="edit_${f.key}" rows="${f.key === "zh" || f.key === "en" ? 2 : 3}">${Lesc(c[f.key] || "")}</textarea>${f.hint ? `<div class="small">${f.hint}</div>` : ""}</div>`).join("")}
<div class="row"><button class="primary" id="editSave">保存</button>${Object.keys(patch).length ? `<button class="secondary" id="editRevert">恢复词库原文</button>` : ""}<button class="secondary" id="editCancel">取消</button></div>
<div class="small" style="margin-top:10px">改动只存在这台设备上，作为一层「补丁」记在词条编号上——<b>以后重新导入词库也不会丢</b>。备份里会带上。</div>`;
  L$("editSave").onclick = () => LsaveEdit(c);
  L$("editCancel").onclick = LcloseEdit;
  const rev = L$("editRevert");
  if (rev) rev.onclick = () => {
    if (!confirm(`把「${c.de}」恢复成词库里的原文吗？\n\n你在这里做的修改会被丢掉，学习进度不受影响。`)) return;
    DWPatches.clear(c.id).then(() => { LapplyPatchTo(c); LafterEdit(c); LcloseEdit() });
  };
}
function LsaveEdit(c) {
  const next = {};
  for (const f of LEDIT_FIELDS) {
    const v = L$(`edit_${f.key}`).value.trim();
    if (v !== String(DWPatches.original(c)[f.key] || "")) next[f.key] = v;
  }
  DWPatches.set(c.id, next).then(() => { LapplyPatchTo(c); LafterEdit(c); LcloseEdit() });
}
// The card objects are shared by every module, so the edit is written into the
// one that is already on screen rather than waiting for a reload.
function LapplyPatchTo(c) {
  const orig = DWPatches.original(c), patch = (DWPatches.get() || {})[c.id] || {};
  for (const f of LEDIT_FIELDS) c[f.key] = patch[f.key] !== undefined ? patch[f.key] : (orig[f.key] || "");
}
// Several modules memoise what they derived from a card, and none of them
// expected a card to change under them. Editing one and restoring a backup full
// of them are the same event as far as those caches and the open screens are
// concerned, so both go through here.
function LcardsChanged(ids) {
  const all = !ids;
  for (const c of LallLearningCards()) {
    if (!all && !ids.has(c.id)) continue;
    if (c.zh) ZH[c.id] = c.zh; else delete ZH[c.id];
  }
  if (typeof LbrowseHays !== "undefined") { if (all) LbrowseHays.clear(); else ids.forEach((id) => LbrowseHays.delete(id)) }
  if (typeof LrektionCache !== "undefined") {
    if (all) LrektionCache.clear(); else ids.forEach((id) => LrektionCache.delete(id));
    LrektionPoolCache = null;
  }
  const ov = L$("browseOverlay");
  if (typeof LrenderBrowse === "function" && ov && !ov.classList.contains("hidden")) LrenderBrowse();
  const t = learnQueue[learnPos];
  if (t && (all || ids.has(t.c.id)) && !learnAnswered) Lrender();
  Lstats(); LhomeStats();
}
function LafterEdit(c) { LcardsChanged(new Set([c.id])) }
function LinitEditUI() { LbuildEditUI() }
