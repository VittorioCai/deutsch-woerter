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
  const BACKUP_REMINDER_DAYS = 14;

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
      notice("bad", `存档 <code>${esc(key)}</code> 已损坏，已重置这一项以便应用继续使用。如果你有备份，请用「导入学习记录」恢复。`);
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
          ? "<b>浏览器存储空间已满，刚才的进度没能保存。</b> 请导出学习记录备份，然后清理本站数据或删掉一些错题。"
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
        version: 5,
        schema: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        quizProgress: read(QUIZ, {}),
        learnProgress: read(LEARN, {}),
        spellingWrongBook: read(WRONG, {}),
      };
    },

    exportBackup() {
      download("netzwerk_vocab_all_progress_backup.json", api.snapshot());
      try { localStorage.setItem(BACKUP_AT, String(Date.now())); } catch (_) {}
    },

    // Progress keys used to be `${level}-${chapter}-${lineNumber}`, so inserting a
    // single word renumbered almost the whole deck and orphaned everything saved
    // against it. Cards now carry a content-derived id; this remaps what is
    // already on the device, once, and keeps a copy of the old state first.
    migrate(cards) {
      let done = 0;
      try { done = +(localStorage.getItem(SCHEMA) || 0); } catch (_) { return; }
      if (done >= SCHEMA_VERSION) return api.backupReminder();
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
        return api.backupReminder();
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

    backupReminder() {
      let at = 0;
      try { at = +(localStorage.getItem(BACKUP_AT) || 0); } catch (_) { return; }
      const days = at ? (Date.now() - at) / 86400000 : Infinity;
      if (days < BACKUP_REMINDER_DAYS) return;
      const learnCount = Object.keys(read(LEARN, {})).length;
      if (learnCount < 50) return;
      notice(
        "warn",
        at
          ? `距离上次备份已经 <b>${Math.floor(days)}</b> 天了。浏览器可能在长时间不用后清除本站数据，建议导出一份。`
          : "学习记录只存在这台设备的浏览器里，<b>还没有备份过</b>。浏览器清理数据或换设备都会丢失，建议导出一份。",
        [{ label: "导出备份", run: row => { api.exportBackup(); row.remove(); } }],
      );
    },

    markBackedUp() { try { localStorage.setItem(BACKUP_AT, String(Date.now())); } catch (_) {} },
    download,
    downloadText,
  };

  window.DWStore = api;
})();
