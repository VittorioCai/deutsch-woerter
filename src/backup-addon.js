/* BACKUP_ADDON_V1 */
// A year of study lives in one browser's localStorage. The app has always been
// able to write a backup file; what it could not do was tell you how exposed you
// were, or put the file anywhere you would find it again.
//
// What a device can do differs, so the panel offers what is actually there:
// a folder on desktop Chromium (point it at iCloud or Drive and it is synced,
// with no server here), the share sheet on a phone, a download everywhere else.

function LbackupStyles() {
  if (document.getElementById("backupStyles")) return;
  const st = document.createElement("style");
  st.id = "backupStyles";
  st.textContent = `.backupOverlay{position:fixed;inset:0;z-index:9999;background:rgba(18,25,38,.58);display:flex;align-items:flex-end;justify-content:center}.backupOverlay.hidden{display:none}.backupSheet{background:#fff;width:min(620px,100%);max-height:92vh;border-radius:22px 22px 0 0;padding:18px;overflow:auto;box-shadow:0 -16px 50px rgba(0,0,0,.18)}.backupHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}.backupHead h2{margin:0;font-size:23px}.backupRisk{border-radius:14px;padding:13px 14px;line-height:1.65;font-size:14px;border:1px solid}.backupRisk.ok{background:#edf9f3;border-color:#bfe9d4}.backupRisk.warn{background:#fff8e8;border-color:#f0dcae}.backupWay{border:1px solid var(--line);border-radius:14px;padding:13px;margin-top:10px}.backupWay h4{margin:0 0 3px;font-size:16px}.backupWay p{margin:0 0 10px;font-size:13px;color:var(--muted);line-height:1.6}.backupWay button{padding:9px 14px;font-size:13px}.backupWay.off{opacity:.55}@media(min-width:700px){.backupOverlay{align-items:center;padding:18px}.backupSheet{border-radius:22px;max-height:88vh}}`;
  document.head.appendChild(st);
}
function LbuildBackupUI() {
  LbackupStyles();
  if (L$("backupOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "backupOverlay";
  ov.className = "backupOverlay hidden";
  ov.innerHTML = `<div class="backupSheet"><div class="backupHead"><h2>🛟 备份</h2><button class="secondary" id="backupClose">关闭</button></div><div id="backupContent"></div></div>`;
  document.body.appendChild(ov);
  L$("backupClose").onclick = () => L$("backupOverlay").classList.add("hidden");
  ov.addEventListener("click", (e) => { if (e.target === ov) L$("backupOverlay").classList.add("hidden") });
}
async function LopenBackup() {
  LbuildBackupUI();
  L$("backupOverlay").classList.remove("hidden");
  await LrenderBackup();
}
// New words and review are both work worth protecting, but only one of them is
// a number of words. Saying "你又学了 30 个词" about ten words reviewed twice
// would be the app telling the learner something untrue about their own week.
function LsinceText(st) {
  if (st.sinceWords && st.since > st.sinceWords) return `你又学了 ${st.sinceWords} 个新词，还复习了一些`;
  if (st.sinceWords) return `你又学了 ${st.sinceWords} 个新词`;
  if (st.since) return "你又复习了一些词";
  return "没有新的记录";
}
function LbackupBusy(msg) {
  const box = L$("backupContent");
  if (box) box.innerHTML = `<div class="backupRisk warn">${Lesc(msg)}</div>`;
}
async function LrenderBackup() {
  const box = L$("backupContent");
  if (!box) return;
  const st = await DWStore.backupState();
  const auto = st.folder && st.folder.permission === "granted";
  // Said in words the learner can act on: not "14 days", but how much of their
  // own work is currently in one place only.
  const risk = auto && !st.since
    ? `<div class="backupRisk ok"><b>自动备份开着，而且是最新的。</b><br>写到文件夹 <b>${Lesc(st.folder.name)}</b>，每次打开应用时更新。</div>`
    : st.at === 0
      ? `<div class="backupRisk warn"><b>还没有备份过。</b><br>你的全部学习记录只存在这个浏览器里。清一次缓存、换台设备、手机重置，就全没了。</div>`
      : `<div class="backupRisk warn"><b>上次备份${st.days === 0 ? "就在今天" : `是 ${st.days} 天前`}，之后${LsinceText(st)}。</b><br>这些只存在这个浏览器里。</div>`;

  const ways = [];
  ways.push(st.ways.folder
    ? `<div class="backupWay"><h4>选一个文件夹，以后自动备份${auto ? "（已开）" : ""}</h4><p>${auto ? `现在写到 <b>${Lesc(st.folder.name)}</b>。` : "选 iCloud 云盘 / Google 云端硬盘 / OneDrive 的文件夹，就等于自动同步到云上——这里不需要服务器，也不需要账号。"}每次打开应用时写一次，并且会保留上一份，不会一次写坏就全没。</p><div class="row"><button class="${auto ? "secondary" : "primary"}" id="backupPick">${auto ? "换个文件夹" : "选文件夹"}</button>${auto ? `<button class="secondary" id="backupNow">立即备份</button><button class="secondary" id="backupOff">关掉自动备份</button>` : ""}</div></div>`
    : `<div class="backupWay off"><h4>自动备份到文件夹</h4><p>这个浏览器不支持（目前只有电脑版 Chrome / Edge）。手机上请用下面的「发送备份」。</p></div>`);
  if (st.ways.share) ways.push(`<div class="backupWay"><h4>发送备份…</h4><p>打开系统的分享菜单，可以存进「文件」「云盘」，或者发给自己。手机上这是最省事的一种。</p><div class="row"><button class="primary" id="backupShare">发送备份…</button></div></div>`);
  ways.push(`<div class="backupWay"><h4>导出文件</h4><p>下载一个 <code>.json</code>，随便放哪。想恢复的时候用首页的「导入学习记录」——导入是<b>合并</b>，不会覆盖掉更新的记录。</p><div class="row"><button class="secondary" id="backupExport">导出文件</button></div></div>`);

  box.innerHTML = risk + ways.join("");
  const wire = (id, fn) => { const b = L$(id); if (b) b.onclick = fn };
  wire("backupPick", async () => {
    LbackupBusy("正在等你选文件夹…");
    try { await DWStore.chooseBackupFolder() } catch (e) { if (e && e.name !== "AbortError") alert(String((e && e.message) || e)) }
    await LrenderBackup();
  });
  wire("backupNow", async () => {
    LbackupBusy("正在写备份…");
    const r = await DWStore.runBackup({ ask: true });
    await LrenderBackup();
    if (!r.done) alert(`没写成：${r.error || r.why}`);
  });
  wire("backupOff", async () => {
    if (!confirm("关掉自动备份吗？\n\n已经写出去的备份文件不会被删除，但以后不再更新。")) return;
    await DWStore.forgetBackupFolder();
    await LrenderBackup();
  });
  wire("backupShare", async () => {
    try { await DWStore.shareBackup() } catch (e) { if (e && e.name !== "AbortError") alert(String((e && e.message) || e)) }
    await LrenderBackup();
  });
  wire("backupExport", async () => { DWStore.exportBackup(); await LrenderBackup() });
}
function LinitBackupUI() {
  const anchor = L$("exportBtn");
  if (anchor && !L$("backupBtn")) {
    const b = document.createElement("button");
    b.id = "backupBtn";
    b.className = "secondary";
    b.textContent = "🛟 备份";
    anchor.before(b);
    b.onclick = LopenBackup;
  }
  LbuildBackupUI();
}
