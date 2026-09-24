/**
 * 知识点结构化抽取引擎
 * 从纯文本中抽取：定义型知识卡片、大纲树、公式/符号、事实数据、语义关系与共现关系。
 */

import {
  splitSentences,
  tokenize,
  rankTerms,
  buildVector,
  escapeReg,
  containsCJK,
  isCredibleTerm,
  hasSuffixHint,
  passIntegrity as isGoodTerm,
  STOPWORDS
} from "./tokenize.js";

/* ---------------- 定义句识别 ---------------- */

const TERM = "[\\u4e00-\\u9fa5A-Za-z][\\u4e00-\\u9fa5A-Za-z0-9·＋＋\\-_/]{0,13}";
// 注意：动词候选按长度从长到短排列，避免贪婪回溯切出“X被 + 称为”这类碎片
const VERB = "指的是|定义为|也就是|被称为|是指|亦称|称为|即为|是";
const DEF_PATTERNS = [
  // 基本型：X是… / X是指… / X被称为…
  new RegExp(`(${TERM})\\s*(${VERB})\\s*([^。；\\n]{4,140})`, "g"),
  // 同位型：X，即… / X，简称…
  new RegExp(`(${TERM})\\s*(?:，即|，也称作|，简称)\\s*([^。；\\n]{4,100})`, "g")
];

const LIST_RE = /(包括|包含|分为|分成|由.{0,8}组成|主要有|主要有以下)/;

/**
 * 抽取定义型句子
 * @returns Map<term, {definition, sentence}>
 */
export function extractDefinitions(sentences) {
  const defs = new Map();
  const joinedText = sentences.map((s) => s.text).join("\n");
  for (const s of sentences) {
    for (const re of DEF_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s.text)) !== null) {
        const term = trimTerm(m[1]);
        if (!isValidTerm(term)) continue;
        // 术语必须在原文中有可靠的成词边界，否则视为切分碎片
        if (!isCredibleTerm(joinedText, term, { defined: true, suffix: hasSuffixHint(term) })) continue;
        let def = m[3].trim();
        if (!def || def.length < 4) continue;
        // 过滤"这是一个/X是一种"中的虚指
        if (/^(一个|一种|一类|这个|它|其|由于|因为)/.test(def)) continue;
        const full = `${term}${m[2]}${def}`.replace(/[，,]$/, "");
        const prev = defs.get(term);
        if (!prev || full.length > prev.definition.length) {
          defs.set(term, { definition: full, sentence: s.text, idx: s.idx });
        }
      }
    }
  }
  return defs;
}

function countOf(text, term) {
  let n = 0,
    p = text.indexOf(term);
  while (p >= 0) {
    n++;
    p = text.indexOf(term, p + 1);
  }
  return n;
}

function trimTerm(t) {
  return (t || "").replace(/^(所谓|所谓的|而且|并且|因此|所以|同时|其中|例如|比如|此外)/, "").trim();
}

function isValidTerm(t) {
  if (!t || t.length < 2 || t.length > 14) return false;
  if (!isGoodTerm(t)) return false;
  if (!containsCJK(t)) {
    if (t.length < 3) return false;
    if (STOPWORDS.has(t.toLowerCase())) return false;
  }
  if (/^[0-9]+$/.test(t)) return false;
  if (/^(我们|他们|它们|这些|那些|有人|有些|许多|所谓|如果|由于|通过)/.test(t)) return false;
  return true;
}

/* ---------------- 公式 / 符号 / 数据 ---------------- */

const GREEK = "[αβγδεζηθικλμνξπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΠΡΣΤΥΦΧΨΩ]";

export function extractFormulas(text) {
  const set = new Set();
  const add = (v) => {
    v = v.trim();
    if (v.length >= 2) set.add(v.replace(/^[,，、。；;]+|[、，。；;]+$/g, ""));
  };

  // LaTeX 行内公式
  (text.match(/\$[^$\n]{2,80}\$/g) || []).forEach(add);
  //  독립 LaTeX $$...$$
  (text.match(/\$\$[^$\n]{2,120}\$\$/g) || []).forEach(add);
  // 含等号/希腊字母的数学式
  (text.match(/[A-Za-z\u4e00-\u9fa5]?[A-Za-z\u4e00-\u9fa50-9]{0,10}\s*[=≈≡∝]\s*[^，。；\n]{1,45}/g) || [])
    .forEach((x) => {
      if (/[=≈≡∝]/.test(x) && (containsCJK(x) || /[A-Za-z]/.test(x))) add(x);
    });
  // 希腊字母表达式
  (text.match(new RegExp(`[^\\s，。；]{0,12}${GREEK}[^\\s，。；]{0,20}`, "gu")) || []).forEach(add);
  // 化学式
  (text.match(/\b[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*){1,5}\b/g) || []).forEach((x) => {
    if (/\d/.test(x) && x.length >= 3) add(x);
  });
  // 上下标如 x²、10⁻³、m/s
  (text.match(/[A-Za-z\u4e00-\u9fa5][⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁰-₉]{1,4}/gu) || []).forEach(add);
  (text.match(/\b[A-Za-z]+\/[A-Za-z]+\b/g) || []).forEach(add);

  return [...set].filter((x) => x && x.length > 1).slice(0, 40);
}

const UNIT_RE = /(?:％|%|[0-9]+\s*(?:°|℃|℉|米|m|km|千米|厘米|cm|毫米|mm|克|g|kg|千克|吨|秒|s|分钟|小时|天|年|次|倍|焦|焦耳|J|瓦|W|千瓦|牛|N|安|A|伏|V|欧|Ω|mol|摩尔|升|L|毫升|ml|像素|px|个|种|类|层|代|亿|万))/;

export function keyNumbers(sentences) {
  const out = [];
  for (const s of sentences) {
    if (UNIT_RE.test(s.text)) out.push(s);
  }
  return out;
}

/* ---------------- 大纲树 ---------------- */

const HEAD_RE = [
  /^(第[一二三四五六七八九十百]+[章节讲部分篇编])(.*)$/,
  /^([一二三四五六七八九十]+[、.])(.*)$/,
  /^(\d+(?:\.\d+)*)[、.\s]+(.*)$/,
  /^([（(]\d+[）)])(.*)$/
];

export function buildOutline(text) {
  const lines = text.split(/\n+/);
  const heads = [];
  let cursor = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const at = line ? text.indexOf(line, cursor) : -1;
    if (at >= 0) cursor = at + line.length;
    if (!line || line.length > 60) continue;
    for (let li = 0; li < HEAD_RE.length; li++) {
      const m = line.match(HEAD_RE[li]);
      if (m) {
        heads.push({ mark: m[1], text: (m[2] || m[1]).trim() || line, level: li + 1, offset: at });
        break;
      }
    }
  }
  // 无显式标题时，取靠前的定义句作为替代
  if (heads.length < 2) {
    const sents = splitSentences(text).slice(0, 60);
    sents.forEach((s, i) => {
      if (s.length <= 30 && !/[。？！]$/.test(s))
        heads.push({ mark: `${i + 1}`, text: s, level: 2, offset: text.indexOf(s.slice(0, 10)) });
    });
  }
  return heads.slice(0, 40);
}

/* ---------------- 关系抽取 ---------------- */

const REL_RULES = [
  { re: /([^，。；、\s]{2,12})(?:包括|包含|含有|主要有|可分为|分为|分成)([^。；\n]{2,80})/g, type: "include", label: "包含" },
  { re: /([^，。；、\s]{2,12})由([^。；\n]{2,60})组成/g, type: "compose", label: "组成" },
  { re: /([^，。；、\s]{2,12})(?:会导致|会造成|引起|决定了|决定了)([^。；\n]{2,60})/g, type: "cause", label: "导致" },
  { re: /([^，。；、\s]{2,12})属于([^。；\n]{2,30})/g, type: "isa", label: "属于" },
  { re: /([^，。；、\s]{2,12})(?:依赖于|取决于|受)([^。；\n]{2,40})/g, type: "depend", label: "依赖" },
  { re: /([^，。；、\s]{2,12})(?:区别于|不同于|相较于)([^。；\n]{2,40})/g, type: "contrast", label: "对比" }
];

export function splitItems(str) {
  return str
    .replace(/等$/, "")
    .split(/[、,，以及和与\/]|(?:\s{1,})/)
    .map((x) => x.replace(/[的了其之]/g, "").trim())
    .filter((x) => x.length >= 2 && x.length <= 14);
}

export function extractRelations(sentences, termSet) {
  const rels = [];
  const seen = new Set();
  for (const s of sentences) {
    for (const rule of REL_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(s.text)) !== null) {
        const src = trimTerm(m[1]);
        if (!termSet.has(src)) continue;
        for (const dst of splitItems(m[2])) {
          if (!termSet.has(dst) || dst === src) continue;
          const key = `${src}|${rule.type}|${dst}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rels.push({ source: src, target: dst, type: rule.type, label: rule.label, sentIdx: s.idx });
        }
      }
    }
  }
  return rels;
}

/* ---------------- 主流程 ---------------- */

const PERSON_RE = /(?:·|(?:(?:先生|女士|教授|院士|科学家|诗人|作家|学者|同学|老师)))/;

/** 按出现顺序为每句标注在原文中的起始字符偏移（原文里句子只被 trim，不会重排） */
function attachOffsets(sentences, text) {
  let cursor = 0;
  for (const s of sentences) {
    const probe = s.text.slice(0, Math.min(10, s.text.length));
    const at = probe ? text.indexOf(probe, cursor) : -1;
    s.offset = at >= 0 ? at : cursor;
    cursor = s.offset + s.text.length;
  }
}

/**
 * @param {{id:string,title:string,text:string}} material
 */
export function extractKnowledge(material) {
  const text = (material.text || "").trim();
  const sentences = splitSentences(text).map((t, i) => ({
    idx: i,
    text: t,
    materialId: material.id,
    materialTitle: material.title,
    vector: null
  }));
  // 预计算句向量（供答疑检索复用）
  for (const s of sentences) s.vector = buildVector(tokenize(s.text));
  // 计算每句在原文中的字符偏移，用于「知识点 → 所属章节」的归属判断
  attachOffsets(sentences, text);

  const defs = extractDefinitions(sentences);
  const ranked = rankTerms(text, 60);

  // 标记标题句（短、无句末标点、符合标题格式）——答疑时降权，避免把目录当答案
  for (const s of sentences) {
    const t = s.text.trim();
    s.isHeading =
      t.length <= 40 &&
      (!/[，,。？！；;：:]/.test(t) || HEAD_RE.some((re) => re.test(t)));
  }

  // 合并：术语表中的术语 + 定义句中的术语
  const termSet = new Set();

  const cards = new Map();

  const ensureCard = (term) => {
    if (cards.has(term)) return cards.get(term);
    const card = {
      id: `${material.id}::${term}`,
      term,
      materialId: material.id,
      materialTitle: material.title,
      aliases: [],
      type: "term",
      definition: "",
      defSentence: "",
      freq: 0,
      score: 0,
      mentions: [],
      examples: [],
      related: []
    };
    cards.set(term, card);
    return card;
  };

  for (const r of ranked) {
    termSet.add(r.term);
    const c = ensureCard(r.term);
    c.freq = Math.max(c.freq, r.count);
    c.score = Math.max(c.score, r.score);
  }
  for (const [term, d] of defs) {
    termSet.add(term);
    const c = ensureCard(term);
    const sentObj = sentences.find((x) => x.idx === d.idx);
    if (sentObj) sentObj.defFlag = true;
    if (!c.definition || d.definition.length > c.definition.length) {
      c.definition = d.definition;
      c.defSentence = d.sentence;
    }
    c.score += 6;
  }

  // 统计提及句子 & 举例句
  sentences.forEach((s) => {
    for (const term of cards.keys()) {
      if (s.text.includes(term)) {
        const c = cards.get(term);
        c.mentions.push(s.idx);
        if (!c.primarySentence && !s.isHeading && s.text.length > 16) c.primarySentence = s.text;
        if (/例如|比如|举例|以.{0,10}为例/.test(s.text) && c.examples.length < 3)
          c.examples.push(s.text);
      }
    }
  });

  // 别名
  for (const c of cards.values()) {
    const m = c.definition.match(/(?:又称|亦称|简称|也叫|也称作)([^，。；、\s]{2,10})/);
    if (m) c.aliases.push(m[1]);
  }

  // 类型判别
  for (const c of cards.values()) {
    if (PERSON_RE.test(c.term) || /提出|发现|发明|创立/.test(c.defSentence.slice(0, 30)) && c.term.length <= 4)
      c.type = "person";
    else if (c.definition) c.type = "concept";
    else if (/\d/.test(c.term) || /\d/.test(c.defSentence)) c.type = "fact";
    else c.type = "term";
  }

  const list = [...cards.values()].sort((a, b) => b.score - a.score);
  const max = list[0]?.score || 1;
  for (const c of list) {
    c.importance = Math.min(100, Math.round((c.score / max) * 100));
    c.level = c.importance >= 70 ? "核心" : c.importance >= 40 ? "重要" : "了解";
  }

  const relations = extractRelations(sentences, termSet);

  // 共现关系（补充图谱边）
  const cooccur = [];
  const topTerms = list.slice(0, 22).map((c) => c.term);
  for (let i = 0; i < topTerms.length; i++) {
    for (let j = i + 1; j < topTerms.length; j++) {
      let w = 0;
      for (const s of sentences) {
        if (s.text.includes(topTerms[i]) && s.text.includes(topTerms[j])) w++;
      }
      if (w >= 1) cooccur.push({ source: topTerms[i], target: topTerms[j], weight: w, type: "cooccur", label: "共现" });
    }
  }

  return {
    materialId: material.id,
    sentences,
    terms: list,
    termSet,
    relations,
    cooccur,
    outline: buildOutline(text),
    formulas: extractFormulas(text),
    numberSentences: keyNumbers(sentences).map((s) => s.text),
    stats: {
      chars: text.length,
      sentences: sentences.length,
      terms: list.length,
      defined: list.filter((c) => c.definition).length,
      relations: relations.length + cooccur.length,
      formulas: extractFormulas(text).length
    }
  };
}

export { escapeReg };
