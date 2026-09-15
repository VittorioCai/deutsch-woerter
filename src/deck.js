// The word list. It used to be baked into the build; it is not any more.
//
// The app ships with no vocabulary of its own: you import a list once and it
// lives in IndexedDB on your device. Two reasons that is IndexedDB and not
// localStorage, which everything else here uses: a deck runs to hundreds of
// kilobytes, and localStorage is a single ~5 MB origin quota that learning
// progress is already eating into — a deck sharing it is exactly how a progress
// write starts failing silently. IndexedDB also stores the parsed object, so
// boot does not re-parse half a megabyte of JSON.
const DWDeck = (() => {
  "use strict";
  const DB_NAME = "dw-deck", DB_VERSION = 1, STORE = "deck", KEY = "current";
  const FORMAT = "deutsch-woerter-deck";
  const MAX_CARDS = 200000;
  const MAX_BYTES = 24 * 1024 * 1024;

  // ---- SHA-256 --------------------------------------------------------------
  // Deliberately hand-written rather than crypto.subtle. This hash IS the
  // identity of every card and therefore the key every progress record is filed
  // under, so it has to produce the same digits on every device, forever.
  // crypto.subtle is missing outside a secure context (a phone opening the dev
  // server over plain http, say) and is async on top; one path that always works
  // is worth more than the native speed on 5000 short strings.
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  function sha256Hex(str) {
    const msg = new TextEncoder().encode(str), len = msg.length;
    const buf = new Uint8Array(((((len + 8) >> 6) + 1) << 6));
    buf.set(msg); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor(len * 8 / 0x100000000));
    dv.setUint32(buf.length - 4, (len * 8) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = w[i - 15], y = w[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    let out = "";
    for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, "0");
    return out;
  }

  // Card ids are content-derived so that adding or removing a word never
  // renumbers another one. Changing anything about this function orphans every
  // progress record ever saved, so it does not change.
  const idFor = (level, chapter, de) => sha256Hex(`${level}|${chapter}|${de}`).slice(0, 10);

  function withIds(rows) {
    const seen = new Map();
    return rows.map((r) => {
      const base = idFor(r.level, r.chapter, r.de);
      // Exact duplicates happen in real word lists (a textbook glossary can list
      // the same word twice in one chapter). They get an ordinal suffix, which
      // stays put as long as the duplicate count for that word does — which is
      // why deck order is part of the format.
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { ...r, id: n === 1 ? base : `${base}-${n}` };
    });
  }

  // ---- parsing --------------------------------------------------------------
  const COLUMNS = ["level", "chapter", "de", "en", "grammar", "example", "zh"];
  const ALIASES = {
    level: "level", niveau: "level", stufe: "level", 级别: "level", 等级: "level",
    chapter: "chapter", kapitel: "chapter", lektion: "chapter", unit: "chapter", 章节: "chapter", 单元: "chapter",
    de: "de", german: "de", deutsch: "de", wort: "de", word: "de", 德语: "de", 单词: "de",
    en: "en", english: "en", englisch: "en", meaning: "en", translation: "en", 英文: "en", 英语: "en",
    grammar: "grammar", grammatik: "grammar", note: "grammar", notes: "grammar", 语法: "grammar", 备注: "grammar",
    example: "example", beispiel: "example", satz: "example", sentence: "example", 例句: "example",
    zh: "zh", chinese: "zh", cn: "zh", 中文: "zh", 释义: "zh", 意思: "zh",
  };

  // RFC 4180 enough for a spreadsheet export: quoted fields, doubled quotes,
  // newlines inside quotes, CRLF.
  function splitTable(text, sep) {
    const rows = []; let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += ch;
        continue;
      }
      if (ch === '"' && field === "") { quoted = true; continue; }
      if (ch === sep) { row.push(field); field = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        continue;
      }
      field += ch;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  function fromTable(text) {
    const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
    const sep = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
    const rows = splitTable(text, sep);
    if (!rows.length) throw new Error("文件里没有内容");
    const header = rows[0].map((h) => ALIASES[h.trim().toLowerCase().replace(/^﻿/, "")] || "");
    if (!header.includes("de")) {
      throw new Error(`第一行必须是表头，并且要有一列叫 de（德语）。当前第一行是：${rows[0].slice(0, 6).join(" / ")}`);
    }
    return rows.slice(1).map((cells) => {
      const o = {};
      header.forEach((key, i) => { if (key && cells[i] != null) o[key] = cells[i]; });
      return o;
    });
  }

  const str = (v) => (v == null ? "" : String(v)).replace(/ /g, " ").trim();

  // A row that survives this has a German word and at least one meaning; the
  // rest is optional. Rows that do not are reported, never silently dropped —
  // an import that quietly loses a quarter of the file is how you find out six
  // weeks later that a chapter was never there.
  function normalise(raw) {
    const kept = [], skipped = [];
    raw.forEach((r, i) => {
      const row = Array.isArray(r)
        ? { level: r[0], chapter: r[1], de: r[2], en: r[3], grammar: r[4], example: r[5], zh: r[6] }
        : (r && typeof r === "object" ? r : {});
      const card = {
        level: str(row.level) || "A1",
        chapter: str(row.chapter) || "1",
        de: str(row.de),
        en: str(row.en),
        grammar: str(row.grammar),
        example: str(row.example),
        zh: str(row.zh),
      };
      if (!card.de) { skipped.push({ line: i + 1, why: "没有德语单词" }); return; }
      if (!card.en && !card.zh) { skipped.push({ line: i + 1, why: `“${card.de}” 没有任何释义` }); return; }
      kept.push(card);
    });
    return { kept, skipped };
  }

  // Accepts our own export, a bare array, or a spreadsheet saved as CSV/TSV.
  function parse(text, filename = "") {
    if (typeof text !== "string" || !text.trim()) throw new Error("文件是空的");
    if (text.length > MAX_BYTES) throw new Error("文件太大了（超过 24 MB）");
    const looksJson = /^\s*[[{]/.test(text);
    let name = String(filename).replace(/\.[^.]+$/, "").trim(), raw;
    if (looksJson) {
      let doc;
      try { doc = JSON.parse(text); } catch (e) { throw new Error(`这个 JSON 读不出来：${e.message}`); }
      if (Array.isArray(doc)) raw = doc;
      else if (doc && Array.isArray(doc.cards)) { raw = doc.cards; if (doc.name) name = String(doc.name); }
      else throw new Error("JSON 里没有找到 cards 数组");
    } else {
      raw = fromTable(text);
    }
    if (raw.length > MAX_CARDS) throw new Error(`词条太多了（${raw.length} 条，上限 ${MAX_CARDS}）`);
    const { kept, skipped } = normalise(raw);
    if (!kept.length) throw new Error("没有读到任何可用的词条");
    return { name: name || "我的词库", cards: withIds(kept), skipped };
  }

  function serialize(deck) {
    return JSON.stringify({
      format: FORMAT,
      version: 1,
      name: deck.name || "我的词库",
      exportedAt: new Date().toISOString(),
      // Order matters: identical words in the same chapter are told apart by
      // their position, so keep these rows in this order.
      cards: (deck.cards || []).map((c) => {
        const o = { level: c.level, chapter: String(c.chapter), de: c.de };
        for (const k of ["en", "grammar", "example", "zh"]) if (c[k]) o[k] = c[k];
        return o;
      }),
    });
  }

  // ---- storage --------------------------------------------------------------
  function db() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(new Error("这个浏览器不允许本站使用本地数据库（无痕模式？）")); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("打不开本地数据库"));
      req.onblocked = () => reject(new Error("本地数据库被另一个标签页占着，请关掉其他标签页再试"));
    });
  }

  function tx(mode, run) {
    return db().then((d) => new Promise((resolve, reject) => {
      let result;
      const t = d.transaction(STORE, mode);
      t.oncomplete = () => { d.close(); resolve(result); };
      t.onerror = () => { d.close(); reject(t.error || new Error("本地数据库操作失败")); };
      t.onabort = () => { d.close(); reject(t.error || new Error("本地数据库操作被中断")); };
      const req = run(t.objectStore(STORE));
      if (req) req.onsuccess = () => { result = req.result; };
    }));
  }

  async function load() {
    const rec = await tx("readonly", (s) => s.get(KEY));
    if (!rec || !Array.isArray(rec.cards) || !rec.cards.length) return null;
    // Old records could predate a field; rebuilding the ids here would be wrong
    // (they are the saved identity), so only fill in what is cosmetic.
    return { name: rec.name || "我的词库", savedAt: rec.savedAt || 0, source: rec.source || "", cards: rec.cards };
  }

  async function save(deck) {
    const rec = { name: deck.name || "我的词库", savedAt: Date.now(), source: deck.source || "", cards: deck.cards };
    await tx("readwrite", (s) => s.put(rec, KEY));
    return rec;
  }

  const clear = () => tx("readwrite", (s) => s.delete(KEY));

  return { parse, serialize, load, save, clear, sha256Hex, idFor, withIds, COLUMNS, FORMAT };
})();

// A top-level const in a classic script is a lexical binding, not a window
// property, and other modules reach for it by name off window — the same way
// store.js publishes DWStore.
window.DWDeck = DWDeck;
