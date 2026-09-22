// Storage layer for the vocabulary app. Loaded before every other script.
//
// Everything the learner accumulates lives in localStorage, so this file owns the
// three failure modes that used to lose it silently:
//   - a corrupted value threw during page load and took a whole mode down
//   - a rejected write (quota, private mode) was never noticed by anyone
//   - progress was keyed by a word's line number, so editing the deck orphaned it
(() => {
  const QUIZ = "netzwerk_vocab_progress_pwa_v1";
  const LEARN = "netzwerk_vocab_learning_v1";
  const WRONG = "netzwerk_vocab_spelling_wrongbook_v1";
  const SCHEMA = "netzwerk_vocab_schema";
  const BACKUP_AT = "netzwerk_vocab_last_backup_at";
  const PREFS = "netzwerk_vocab_prefs_v1";
  const SCHEMA_VERSION = 2;
  const FLUSH_MS = 1500;
  const BACKUP_AT_WORK = "netzwerk_vocab_last_backup_work";
  const BACKUP_AT_WORDS = "netzwerk_vocab_last_backup_words";
  const BACKUP_REMINDER_DAYS = 14;
  // A year of study in one browser is the whole risk, and it does not accumulate
  // on a calendar — somebody who gets through four hundred words in a week is
  // more exposed than somebody who got through ten in a fortnight. Either enough
  // time or enough unsaved work now asks.
  const BACKUP_REMINDER_WORK = 60;
  const BACKUP_FILE = "deutsch-woerter-backup.json";
  const BACKUP_PREV = "deutsch-woerter-backup-previous.json";
  const BACKUP_DIR_KEY = "backup-dir";

  const pending = new Map();
  const rehydrators = [];
  let prefsCache = null;
  let timer = null;
  let degraded = false;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

  // ---- notices -------------------------------------------------------------
  function bar() {
    let el = document.getElementById("dwNotice");
    if (el) return el;
    el = document.createElement("div");
    el.id = "dwNotice";
    el.className = "dwNotice";
    const wrap = document.querySelector(".wrap");
    if (wrap) wrap.insertBefore(el, wrap.firstChild); else document.body.prepend(el);
    return el;
  }
  function notice(tone, html, actions = []) {
    const run = () => {
      const el = bar();
      const row = document.createElement("div");
      row.className = `dwNoticeItem ${tone}`;
      row.innerHTML = `<div>${html}</div>`;
      const box = document.createElement("div");
      box.className = "dwNoticeActions";
      for (const a of actions) {
        const b = document.createElement("button");
        b.className = "secondary";
        b.textContent = a.label;
        b.onclick = () => a.run(row);
        box.appendChild(b);
      }
      const dismiss = document.createElement("button");
      dismiss.className = "secondary";
      dismiss.textContent = "知道了";
      dismiss.onclick = () => row.remove();
      box.appendChild(dismiss);
      row.appendChild(box);
      el.appendChild(row);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
  }

  // ---- raw access ----------------------------------------------------------
  // A corrupted value must never throw into module scope: that is what used to
  // erase the entire learning mode from the page.
  function read(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (e) {
      degraded = true;
      notice("warn", "浏览器不允许本站保存数据（无痕模式？），这次的学习记录<b>不会被保存</b>。");
      return fallback;
    }
    if (raw == null || raw === "") return fallback;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      return parsed;
    } catch (e) {
      try { localStorage.removeItem(key); } catch (_) {}
      notice("bad", `存档 <code>${esc(key)}</code> 已损坏，已重置这一项以便应用继续使用。如果你有备份，请用「从备份恢复」恢复。`);
      return fallback;
    }
  }

  function writeNow(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      degraded = true;
      const full = e && /quota|exceed/i.test(e.name + " " + e.message);
      notice(
        "bad",
        full
          ? "<b>浏览器存储空间已满，刚才的进度没能保存。</b> 请先点首页那一行的「备份」，然后清理本站数据或删掉一些错题。"
          : "<b>学习记录保存失败，进度可能会丢。</b> 建议现在导出一份备份。",
        [{ label: "立即导出备份", run: () => api.exportBackup() }],
      );
      return false;
    }
  }

  // Writes used to happen on every single answer — a full ~800KB re-serialise
  // each time. They are batched now, with a synchronous flush whenever the page
  // is backgrounded or closed so nothing is lost on the way out.
  function queue(key, getValue) {
    pending.set(key, getValue);
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
  }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    let ok = true;
    for (const [key, getValue] of pending) ok = writeNow(key, getValue()) && ok;
    pending.clear();
    return ok;
  }
  addEventListener("pagehide", flush);
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

  // ---- migration -----------------------------------------------------------
  function downloadText(name, text, type = "application/json") {
    const u = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 500);
  }
  const download = (name, obj) => downloadText(name, JSON.stringify(obj, null, 2));

  // How much study is in the store, as a number that only ever grows. Entry
  // counts alone would sit still through a month of review, so each learnt word
  // also counts its completed cycles.
  function workUnits() {
    let n = 0;
    try {
      const l = read(LEARN, {});
      for (const k in l) { const s = l[k]; n += 1 + (s && +s.cycles > 0 ? +s.cycles : 0) + (s && s.known ? 1 : 0); }
      n += Object.keys(read(QUIZ, {})).length + Object.keys(read(WRONG, {})).length;
    } catch (_) { return 0; }
    return n;
  }
  // How many words have been met at all. Counted apart from the work units
  // because the two answer different questions and only one of them can be put
  // in a sentence: a month of review moves the units and not this, so reporting
  // units as "words you have learnt" would be saying something untrue.
  function wordCount() {
    try { return Object.keys(read(LEARN, {})).length; } catch (_) { return 0; }
  }
  const readNum = (k) => { try { return +(localStorage.getItem(k) || 0) || 0; } catch (_) { return 0; } };

  // The File System Access API is desktop Chromium only. Everywhere else the
  // share sheet is the real equivalent — it is how a file gets to iCloud or
  // Drive on a phone — and a plain download is the last resort.
  const canFolder = () => typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
  const canShare = () => {
    try {
      return !!(navigator.canShare && navigator.share
        && navigator.canShare({ files: [new File(["{}"], BACKUP_FILE, { type: "application/json" })] }));
    } catch (_) { return false; }
  };
  const deckStore = () => (typeof window !== "undefined" && window.DWDeck) || null;
  async function backupDir() {
    const d = deckStore();
    if (!d || !d.getMeta) return null;
    try { return (await d.getMeta(BACKUP_DIR_KEY)) || null; } catch (_) { return null; }
  }
  async function dirPermission(handle, ask) {
    if (!handle || !handle.queryPermission) return "unsupported";
    try {
      const opts = { mode: "readwrite" };
      let state = await handle.queryPermission(opts);
      if (state !== "granted" && ask) state = await handle.requestPermission(opts);
      return state;
    } catch (_) { return "denied" }
  }
  // Written as two files, never one: overwriting the only copy is the moment a
  // backup can destroy what it exists to protect. The previous good file is
  // copied aside first, so a failed or truncated write still leaves one.
  async function writeInto(handle, text) {
    try {
      const cur = await handle.getFileHandle(BACKUP_FILE).then((h) => h.getFile()).catch(() => null);
      if (cur) {
        const prev = await handle.getFileHandle(BACKUP_PREV, { create: true });
        const pw = await prev.createWritable();
        await pw.write(await cur.text());
        await pw.close();
      }
    } catch (_) { /* no previous copy to keep is not a reason to skip the backup */ }
    const f = await handle.getFileHandle(BACKUP_FILE, { create: true });
    const w = await f.createWritable();
    await w.write(text);
    await w.close();
  }

  const api = {
    KEYS: { QUIZ, LEARN, WRONG },
    read, queue, flush, notice,

    // Small UI preferences — the level and Kapitel you had open, the drill tab.
    // Kept apart from progress so a corrupted prefs blob can never cost a
    // learner their study history.
    //
    // Merged into an in-memory copy, never re-read from storage per call: writes
    // are batched, so two changes inside one flush window (picking a level and
    // then a Kapitel) would both start from the same stale value and the first
    // would be lost.
    prefs(patch) {
      if (!prefsCache) prefsCache = read(PREFS, {});
      if (!patch) return prefsCache;
      Object.assign(prefsCache, patch);
      queue(PREFS, () => prefsCache);
      return prefsCache;
    },
    onMigrated(fn) { rehydrators.push(fn); },
    get degraded() { return degraded; },

    snapshot() {
      return {
        version: 7,
        schema: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        quizProgress: read(QUIZ, {}),
        learnProgress: read(LEARN, {}),
        spellingWrongBook: read(WRONG, {}),
        // Corrections made inside the app are the learner's work too, and they
        // are not in the word list they correct — a backup without them loses
        // every fix on restore.
        cardPatches: (typeof window !== "undefined" && window.DWPatches) ? window.DWPatches.get() : {},
        // Which Kapitel you had reached, the round size, the voice, whether
        // spelling is on. Restoring without these leaves the learner on a
        // correct history and a stranger's settings.
        prefs: read(PREFS, {}),
      };
    },

    exportBackup() {
      download("netzwerk_vocab_all_progress_backup.json", api.snapshot());
      api.markBackedUp();
    },

    // ---- backup, on whatever this device can actually do --------------------
    backupWays() { return { folder: canFolder(), share: canShare() } },
    async backupState() {
      const at = readNum(BACKUP_AT), dir = await backupDir();
      return {
        at,
        days: at ? Math.floor((Date.now() - at) / 86400000) : null,
        since: Math.max(0, workUnits() - readNum(BACKUP_AT_WORK)),
        sinceWords: Math.max(0, wordCount() - readNum(BACKUP_AT_WORDS)),
        folder: dir ? { name: dir.name || "已选文件夹", permission: await dirPermission(dir, false) } : null,
        ways: api.backupWays(),
      };
    },
    // Picking the folder is the whole feature: point it at an iCloud or Drive
    // folder and the backup is synced off the device without a server here.
    async chooseBackupFolder() {
      if (!canFolder()) throw new Error("这个浏览器不支持选择文件夹（目前只有电脑版 Chrome / Edge 支持）。");
      const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "dw-backup" });
      const d = deckStore();
      if (!d || !d.putMeta) throw new Error("本地数据库不可用，记不住这个文件夹。");
      await d.putMeta(BACKUP_DIR_KEY, handle);
      return api.runBackup({ ask: true });
    },
    async forgetBackupFolder() {
      const d = deckStore();
      if (d && d.delMeta) await d.delMeta(BACKUP_DIR_KEY);
    },
    async shareBackup() {
      const file = new File([JSON.stringify(api.snapshot(), null, 2)], BACKUP_FILE, { type: "application/json" });
      await navigator.share({ files: [file], title: "Deutsch Wörter 学习记录备份" });
      api.markBackedUp();
    },
    // Returns what happened rather than announcing it: at startup a silent
    // success is the point, and only the caller knows whether a person is
    // watching.
    async runBackup({ ask = false } = {}) {
      const dir = await backupDir();
      if (!dir) return { done: false, why: "no-folder" };
      const state = await dirPermission(dir, ask);
      if (state !== "granted") return { done: false, why: "permission", folder: dir.name || "" };
      try {
        await writeInto(dir, JSON.stringify(api.snapshot(), null, 2));
        api.markBackedUp();
        return { done: true, folder: dir.name || "" };
      } catch (e) {
        return { done: false, why: "write", error: String((e && e.message) || e), folder: dir.name || "" };
      }
    },

    // Progress keys used to be `${level}-${chapter}-${lineNumber}`, so inserting a
    // single word renumbered almost the whole deck and orphaned everything saved
    // against it. Cards now carry a content-derived id; this remaps what is
    // already on the device, once, and keeps a copy of the old state first.
    migrate(cards) {
      let done = 0;
      try { done = +(localStorage.getItem(SCHEMA) || 0); } catch (_) { return; }
      if (done >= SCHEMA_VERSION) return void api.backupReminder().catch(() => {});
      flush();

      const legacy = new Map();
      cards.forEach((c, i) => legacy.set(`${c.level}-${c.chapter}-${i + 1}`, c.id));

      const quiz = read(QUIZ, {}), learn = read(LEARN, {}), wrong = read(WRONG, {});
      const hadAnything = Object.keys(quiz).length + Object.keys(learn).length + Object.keys(wrong).length > 0;
      if (!hadAnything) {
        try { localStorage.setItem(SCHEMA, String(SCHEMA_VERSION)); } catch (_) {}
        return;
      }

      const before = { version: 5, schema: 1, exportedAt: new Date().toISOString(), quizProgress: quiz, learnProgress: learn, spellingWrongBook: wrong };
      const cardsById = new Set(cards.map(c => c.id));
      const remap = (obj, fixValue) => {
        const next = {}; let moved = 0, kept = 0, dropped = 0;
        for (const [k, v] of Object.entries(obj)) {
          if (cardsById.has(k)) { next[k] = v; kept++; continue; }   // already migrated
          const id = legacy.get(k);
          if (!id) { dropped++; continue; }
          next[id] = fixValue ? fixValue(v, id) : v;
          moved++;
        }
        return { next, moved, kept, dropped };
      };

      const q = remap(quiz), l = remap(learn), w = remap(wrong, (v, id) => ({ ...v, id }));
      const moved = q.moved + l.moved + w.moved;
      const dropped = q.dropped + l.dropped + w.dropped;

      if (moved === 0 && dropped === 0) {
        try { localStorage.setItem(SCHEMA, String(SCHEMA_VERSION)); } catch (_) {}
        return void api.backupReminder().catch(() => {});
      }

      // The old state goes to disk before anything is overwritten.
      try { download("netzwerk_vocab_backup_before_upgrade.json", before); } catch (_) {}

      const ok = writeNow(QUIZ, q.next) && writeNow(LEARN, l.next) && writeNow(WRONG, w.next);
      if (!ok) {
        notice("bad", "<b>存档升级没能写入。</b> 旧数据还在，请先导出备份再刷新页面重试。");
        return;
      }
      try { localStorage.setItem(SCHEMA, String(SCHEMA_VERSION)); } catch (_) {}
      // Modules read their state into memory at load, before the deck and therefore
      // the migration are available; without this their stale copy would be flushed
      // straight back over the migrated data on the next answer.
      for (const fn of rehydrators) { try { fn(); } catch (e) { console.error(e); } }

      notice(
        "ok",
        `学习记录已升级到新的存档格式，<b>${moved}</b> 条记录迁移完成${dropped ? `，${dropped} 条已经无法对应到当前词库、已丢弃` : ""}。迁移前的备份已自动下载；以后再增删词条也不会再丢进度了。`,
        [{ label: "再下载一次备份", run: () => download("netzwerk_vocab_backup_before_upgrade.json", before) }],
      );
      api.__before = before;
    },

    // Runs once a page load. A folder that is still permitted is written to
    // without saying anything — an automatic backup that announces itself every
    // morning is an automatic backup people turn off.
    async backupReminder() {
      const st = await api.backupState().catch(() => null);
      if (!st) return;
      if (st.folder && st.folder.permission === "granted") {
        if (!st.since) return;
        const r = await api.runBackup();
        if (r.done) return;
        notice("warn", `<b>自动备份没写成</b>（${esc(r.error || "文件夹不可用")}）。学习记录还在这台设备上，但那份副本没更新。`,
          [{ label: "重新选文件夹", run: (row) => { api.chooseBackupFolder().then(() => row.remove()).catch(() => {}) } }]);
        return;
      }
      if (st.folder) {
        // Chromium drops the grant between sessions; re-asking needs a click, so
        // the notice is the click.
        notice("warn", `自动备份的文件夹 <b>${esc(st.folder.name)}</b> 需要你再授权一次，浏览器重启后会这样。`,
          [{ label: "恢复自动备份", run: (row) => { api.runBackup({ ask: true }).then((r) => { if (r.done) row.remove() }) } }]);
        return;
      }
      const days = st.at ? st.days : null;
      if (days !== null && days < BACKUP_REMINDER_DAYS && st.since < BACKUP_REMINDER_WORK) return;
      if (days === null && st.since < BACKUP_REMINDER_WORK) return;
      // The home screen carries a standing backup line that turns amber on the
      // same conditions and opens the same panel. Where it exists, a notice on
      // top of it would be the same reminder twice, on every page.
      if (document.getElementById("homeBackupLine")) return;
      const what = days === null
        ? "一年的学习记录只存在这台设备的浏览器里，<b>还没有备份过</b>。清一次缓存、换台设备，就全没了。"
        : `距离上次备份 <b>${days}</b> 天${st.sinceWords ? `，之后你又学了 <b>${st.sinceWords}</b> 个新词` : "，之后你又复习了不少"}。浏览器可能在长时间不用后清除本站数据。`;
      const actions = [];
      if (st.ways.folder) actions.push({ label: "选个文件夹自动备份", run: (row) => { api.chooseBackupFolder().then(() => row.remove()).catch(() => {}) } });
      if (st.ways.share) actions.push({ label: "发送备份…", run: (row) => { api.shareBackup().then(() => row.remove()).catch(() => {}) } });
      actions.push({ label: "导出文件", run: (row) => { api.exportBackup(); row.remove() } });
      notice("warn", what, actions);
    },

    markBackedUp() {
      try {
        localStorage.setItem(BACKUP_AT, String(Date.now()));
        localStorage.setItem(BACKUP_AT_WORK, String(workUnits()));
        localStorage.setItem(BACKUP_AT_WORDS, String(wordCount()));
      } catch (_) {}
    },
    workUnits, wordCount,
    download,
    downloadText,
  };

  window.DWStore = api;
})();
