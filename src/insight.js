// Why this word is what it is.
//
// German is unusually rule-governed: gender is largely predictable from the
// ending, a compound takes the gender and plural of its last element, and verb
// prefixes carry meaning. So the explanations here are DERIVED from the word,
// not stored next to it. That matters because the app has no vocabulary of its
// own — anything stored per-word would help only words somebody pre-wrote, while
// a rule helps every deck anyone ever imports, offline, at no size cost.
//
// The bar for showing a rule is that it is worth trusting. A hedge on every line
// teaches nothing, so only near-exceptionless rules are stated as facts, and the
// words that merely END in those letters without carrying the suffix are listed
// out by hand.
const DWInsight = (() => {
  "use strict";

  const ART = /^(der|die|das)\s+/i;
  const stemOf = (de) => de.replace(ART, "").trim();
  const artOf = (de) => (de.match(ART) || [])[1]?.toLowerCase() || "";

  // ---- gender by ending ------------------------------------------------------
  const GENDER = [
    { suf: "ung", art: "die", not: ["Sprung", "Schwung", "Ursprung", "Aufschwung", "Umschwung", "Dung", "Vorsprung", "Absprung"], why: "-ung 结尾的名词几乎全是阴性", plural: "-en" },
    { suf: "heit", art: "die", not: [], why: "-heit 结尾一律阴性", plural: "-en" },
    { suf: "keit", art: "die", not: [], why: "-keit 结尾一律阴性", plural: "-en" },
    { suf: "schaft", art: "die", not: [], why: "-schaft 结尾一律阴性", plural: "-en" },
    { suf: "tion", art: "die", not: [], why: "-tion 结尾一律阴性", plural: "-en" },
    { suf: "sion", art: "die", not: [], why: "-sion 结尾一律阴性", plural: "-en" },
    { suf: "tät", art: "die", not: [], why: "-tät 结尾一律阴性（对应英语 -ty）", plural: "-en" },
    { suf: "enz", art: "die", not: [], why: "-enz 结尾一律阴性", plural: "-en" },
    { suf: "anz", art: "die", not: [], why: "-anz 结尾一律阴性", plural: "-en" },
    { suf: "ie", art: "die", not: ["Knie"], why: "-ie 结尾基本都是阴性", plural: "-n" },
    { suf: "chen", art: "das", not: null, why: "指小词 -chen 一律中性，哪怕指的是人（das Mädchen）", plural: "不变" },
    { suf: "lein", art: "das", not: null, why: "指小词 -lein 一律中性", plural: "不变" },
    { suf: "ment", art: "das", not: ["Moment"], why: "-ment 结尾基本都是中性", plural: "-e" },
    { suf: "ismus", art: "der", not: [], why: "-ismus 结尾一律阳性", plural: "-en（Ismus → Ismen）" },
    { suf: "ling", art: "der", not: [], why: "-ling 结尾一律阳性", plural: "-e" },
    { suf: "ist", art: "der", not: ["Mist", "Obst", "Frist", "Brust", "Nest"], why: "-ist 结尾指人，一律阳性（n 变化）", plural: "-en" },
    { suf: "eur", art: "der", not: [], why: "-eur 结尾指人，阳性（来自法语）", plural: "-e" },
    { suf: "or", art: "der", not: ["Tor", "Chor", "Ohr", "Rohr", "Moor", "Motor"], why: "-or 结尾指人或器物，阳性", plural: "-en（重音后移：Dóktor → Doktóren）" },
  ];
  // -chen / -lein need suffix matching, not word matching: der Kuchen ends in
  // "chen" but is not a diminutive.
  const NOT_DIMINUTIVE = /(ku|kno|re|dra|bra|fla|zei|ma|spre|ste|ro|ri|wo|sa|ta|la)chen$|(b|w|st|sch|kl|r|h|m|p)ein$/i;

  function Lgender(card) {
    const art = artOf(card.de);
    if (!art) return null;
    const stem = stemOf(card.de);
    if (/[\s|/]/.test(stem)) return null;
    for (const r of GENDER) {
      if (!stem.toLowerCase().endsWith(r.suf)) continue;
      if (stem.length <= r.suf.length + 1) continue;
      if (r.not === null) { if (NOT_DIMINUTIVE.test(stem)) continue; }
      else if (r.not.some((w) => stem === w)) continue;
      if (r.art !== art) continue;          // the rule and the word disagree — say nothing
      return { art, suf: r.suf, why: r.why, plural: r.plural };
    }
    return null;
  }

  // ---- compounds -------------------------------------------------------------
  // Built from whatever deck is loaded: the learner's own words are the
  // dictionary, so the parts that get named are parts they have already met.
  let INDEX = null, INDEXED = null;
  function Lindex(cards) {
    if (INDEXED === cards && INDEX) return INDEX;
    INDEX = new Map();
    for (const c of cards) {
      const s = stemOf(c.de);
      if (/[\s|/]/.test(s) || s.length < 3) continue;
      const k = s.toLowerCase();
      if (!INDEX.has(k)) INDEX.set(k, c);
    }
    INDEXED = cards;
    return INDEX;
  }

  const PARTICLE = new Set(["ab","an","auf","aus","bei","bis","durch","ein","für","gegen","hin","her","in","mit","nach","ohne","pro","um","unter","von","vor","zu","über"]);
  // Fugenlaute: the connective letters German glues compounds with.
  const LINKS = ["es", "ens", "en", "er", "s", "n", "e"];
  function Lpart(index, word) {
    const hit = index.get(word.toLowerCase());
    if (hit) return { card: hit, link: "" };
    for (const l of LINKS) {
      if (word.length <= l.length + 2 || !word.toLowerCase().endsWith(l)) continue;
      const base = word.slice(0, word.length - l.length);
      const h = index.get(base.toLowerCase());
      if (h) return { card: h, link: l };
    }
    for (const e of ["en", "n"]) {
      const h = index.get((word + e).toLowerCase());
      if (h && !ART.test(h.de)) return { card: h, link: "", stem: true };
    }
    return null;
  }

  function Lcompound(card, cards) {
    if (!ART.test(card.de)) return null;
    const stem = stemOf(card.de);
    if (stem.length < 6 || /[\s|/]/.test(stem)) return null;
    const index = Lindex(cards);
    // Longest head wins: Handtuch is Hand+Tuch, not Han+dtuch.
    for (let i = 2; i <= stem.length - 3; i++) {
      const tail = stem.slice(i);
      if (tail.length < 3) break;
      const head = index.get(tail.toLowerCase());
      if (!head || head.de === card.de) continue;
      const front = Lpart(index, stem.slice(0, i));
      if (!front) continue;
      // A preposition in front of a three-letter word finds nonsense: der Nachbar
      // is not "nach + Bar". Short function words need a substantial head.
      if (PARTICLE.has(stem.slice(0, i).toLowerCase()) && tail.length < 4) continue;
      return { front: front.card, link: front.link, stem: !!front.stem, head, headArt: artOf(head.de) };
    }
    return null;
  }

  // ---- affixes ---------------------------------------------------------------
  const SEPARABLE = {
    ab: "离开、取下", an: "开始、朝向", auf: "打开、向上", aus: "出去、完成",
    ein: "进入", mit: "一起", nach: "之后、追随", vor: "在前、预先",
    zu: "关上、朝向", zurück: "返回", weg: "离开", los: "开始、松开",
    her: "朝说话人来", hin: "朝说话人去", zusammen: "一起", fest: "牢固地",
  };
  const INSEPARABLE = {
    be: "让动词带上直接宾语", emp: "感受", ent: "脱离、去除", er: "达成、完成",
    ver: "做错、用尽、彻底", zer: "弄碎、破坏", miss: "错误地", ge: "（无重音）",
  };
  const ADJ = {
    bar: "能……的（essbar 能吃的）", los: "没有……的（arbeitslos 失业的）",
    voll: "充满……的", haft: "具有……性质的", sam: "倾向于……的",
    ig: "带有……性质的", lich: "……的（常由名词变来）", isch: "……的（常指来源）",
  };

  function Laffix(card) {
    const w = card.de.trim();
    if (ART.test(w) || /\s/.test(w)) return null;
    if (/(en|ern|eln)$/.test(w)) {
      for (const [p, mean] of Object.entries(SEPARABLE)) {
        if (w.length > p.length + 3 && w.startsWith(p)) return { kind: "sep", prefix: p, rest: w.slice(p.length), mean };
      }
      for (const [p, mean] of Object.entries(INSEPARABLE)) {
        if (w.length > p.length + 3 && w.startsWith(p)) return { kind: "insep", prefix: p, rest: w.slice(p.length), mean };
      }
      return null;
    }
    for (const [s, mean] of Object.entries(ADJ)) {
      if (w.length >= s.length + 3 && w.toLowerCase().endsWith(s)) return { kind: "adj", suffix: s, mean };
    }
    return null;
  }

  // ---- same-ending family ----------------------------------------------------
  // Seeing four more -ung words next to the rule is what turns the rule from a
  // claim into a pattern.
  function Lfamily(card, cards, suf, max = 4) {
    const self = stemOf(card.de).toLowerCase();
    const seen = new Set(), out = [];
    for (const c of cards) {
      if (!ART.test(c.de)) continue;
      const s = stemOf(c.de), k = s.toLowerCase();
      if (k === self || seen.has(k) || !k.endsWith(suf) || s.length <= suf.length + 1) continue;
      const g = Lgender(c);
      if (!g || g.suf !== suf) continue;   // must pass the same rule, exceptions and all
      seen.add(k);
      out.push(c.de);
      if (out.length >= max) break;
    }
    return out;
  }

  // ---- the public call -------------------------------------------------------
  // Returns [] when there is nothing solid to say, which is most short words.
  // Inventing an explanation would be worse than showing none.
  function Lanalyse(card, cards) {
    if (!card || !card.de) return [];
    const out = [];
    const comp = Lcompound(card, cards || []);
    const gen = Lgender(card);

    if (comp) {
      const gloss = (c) => (c.zh || c.en || "").replace(/^\s*(here|hier)\s*[:：]\s*/i, "").replace(/^\s*这里\s*[:：]\s*/, "").replace(/^(to|the|a|an)\s+/, "").split(/[;；]/)[0].trim();
      const parts = `${stemOf(comp.front.de)}${comp.link ? ` +${comp.link}+ ` : " + "}${stemOf(comp.head.de)}`;
      out.push({ kind: "compound", label: "拆开看",
        text: `${parts} —— ${gloss(comp.front) || "?"} + ${gloss(comp.head) || "?"}`,
        note: comp.stem ? "动词放在复合词前半节时去掉词尾 -en。"
          : comp.link ? `中间的 -${comp.link}- 是连接音，没有意思。` : "" });
      if (comp.headArt && artOf(card.de) === comp.headArt) {
        out.push({ kind: "gender", label: `为什么是 ${comp.headArt}`,
          text: `复合词的性别由最后一节决定：${comp.head.de} → ${comp.headArt} ${stemOf(card.de)}` });
      }
    }
    if (gen && !out.some((x) => x.kind === "gender")) {
      out.push({ kind: "gender", label: `为什么是 ${gen.art}`, text: gen.why });
      const fam = Lfamily(card, cards || [], gen.suf);
      if (fam.length >= 2) out.push({ kind: "family", label: "同样的结尾", text: fam.join("、") });
      if (gen.plural) out.push({ kind: "plural", label: "复数规律", text: `-${gen.suf} → ${gen.plural}` });
    }

    const af = Laffix(card);
    if (af && af.kind === "sep") {
      out.push({ kind: "affix", label: "可分动词", text: `${af.prefix}- + ${af.rest} —— ${af.prefix}- 表「${af.mean}」`,
        note: `造句时 ${af.prefix} 要甩到句尾：Ich ${af.rest.replace(/en$/, "e")} … ${af.prefix}.` });
    } else if (af && af.kind === "insep") {
      out.push({ kind: "affix", label: "不可分前缀", text: `${af.prefix}- + ${af.rest} —— ${af.prefix}- 表「${af.mean}」`,
        note: `${af.prefix}- 不重读、不分离，过去分词也不加 ge-。` });
    } else if (af && af.kind === "adj") {
      out.push({ kind: "affix", label: "构词", text: `-${af.suffix} = ${af.mean}` });
    }
    return out;
  }

  return { Lanalyse, Lgender, Lcompound, Laffix, Lfamily, stemOf, artOf };
})();

window.DWInsight = DWInsight;
