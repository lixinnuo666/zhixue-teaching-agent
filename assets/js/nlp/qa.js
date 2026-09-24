/**
 * 本地检索式答疑引擎（不依赖任何云端大模型）
 * 流程：问题分词 → IDF 加权 TF-IDF 检索 → 概念命中加权 → 依据讲解模式组织答案 → 附来源引用
 */

import { tokenize, buildVector, cosine, diceSimilarity } from "./tokenize.js";

export function buildCorpus(extractions) {
  const sentences = [];
  const cards = [];
  const relations = [];
  for (const ex of extractions) {
    sentences.push(...ex.sentences);
    cards.push(...ex.terms);
    relations.push(...(ex.relations || []), ...(ex.cooccur || []));
  }

  // IDF
  const df = new Map();
  for (const s of sentences) {
    const seen = new Set(tokenize(s.text));
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = Math.max(1, sentences.length);
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log(N / (c + 1)) + 1);

  // 句向量（IDF 加权）
  for (const s of sentences) {
    const tk = tokenize(s.text);
    const raw = buildVector(tk);
    const weighted = new Map();
    for (const [k, v] of raw.v) weighted.set(k, v * (idf.get(k) || 1));
    let norm = 0;
    for (const v of weighted.values()) norm += v * v;
    s.vecW = { v: weighted, norm: Math.sqrt(norm) || 1 };
  }

  const cardByTerm = new Map();
  const sortedTerms = cards
    .slice()
    .sort((a, b) => b.term.length - a.term.length);
  for (const c of sortedTerms) if (!cardByTerm.has(c.term)) cardByTerm.set(c.term, c);

  return { sentences, cards, relations, idf, cardByTerm, termList: sortedTerms.map((c) => c.term) };
}

function queryVector(q, idf) {
  const tk = tokenize(q);
  const raw = buildVector(tk);
  const weighted = new Map();
  for (const [k, v] of raw.v) weighted.set(k, v * (idf.get(k) || 1));
  let norm = 0;
  for (const v of weighted.values()) norm += v * v;
  return { v: weighted, norm: Math.sqrt(norm) || 1 };
}

/** 找出问题中直接命中的知识点（长词优先） */
function hitTerms(question, corpus) {
  const hits = [];
  for (const term of corpus.termList) {
    if (term.length < 2) continue;
    if (question.includes(term)) {
      hits.push(corpus.cardByTerm.get(term));
      if (hits.length >= 4) break;
    }
  }
  return hits.filter(Boolean);
}

/** 意图识别 */
function detectIntent(question) {
  const q = question.trim();
  const intents = [];
  if (/(区别|差异|不同|比较|对比|相比|异同)/.test(q)) intents.push("compare");
  if (/(为什么|为何|原因|为何会|怎么会)/.test(q)) intents.push("why");
  if (/(怎么|如何|怎样|步骤|流程|过程是|做法|方法)/.test(q)) intents.push("how");
  if (/(哪些|哪几种|包括|分为|种类|类型|几个|几步|有哪些)/.test(q)) intents.push("list");
  if (/(是什么|什么是|定义|含义|指的是|意思)/.test(q)) intents.push("define");
  if (/(举例|例子|举个例子|实例)/.test(q)) intents.push("example");
  if (/(多少|数值|等于|公式|计算)/.test(q)) intents.push("number");
  if (!intents.length) intents.push("define");
  return intents;
}

const STEP_MARK = /(首先|其次|再次|然后|接着|最后|第一步|第二步|第三步|第一|第二|第三|阶段1|阶段一)/;

function cite(s, i) {
  return `［${s.materialTitle || "素材"}·第${s.idx + 1}句］`;
}

/**
 * 检索 + 组织答案
 * @returns {{text:string, html:string, hits:Array, refs:Array, confidence:number, mode:string}}
 */
export function ask(corpus, question, mode = "direct") {
  if (!corpus.sentences.length) {
    return {
      text: "当前素材库为空，请先在左侧上传图片或粘贴文本并完成知识点抽取。",
      html: "当前素材库为空，请先在左侧上传图片或粘贴文本并完成知识点抽取。",
      hits: [],
      refs: [],
      confidence: 0,
      mode
    };
  }

  const q = question.trim();
  const intents = detectIntent(q);
  const qv = queryVector(q, corpus.idf);
  const hits = hitTerms(q, corpus);

  // 若命中了明确知识点，检索范围收敛到"提到该知识点"或"同一素材"的句子，避免跨素材串台
  let candidates = corpus.sentences;
  if (hits.length) {
    const focusMat = hits[0].materialId;
    const near = corpus.sentences.filter(
      (s) => hits.some((h) => s.text.includes(h.term)) || s.materialId === focusMat
    );
    if (near.length >= 4) candidates = near;
  }

  const scored = candidates.map((s) => {
    let base = cosine(s.vecW, qv);
    let boost = 0;
    for (const c of hits) {
      if (s.text.includes(c.term)) boost += 0.16 * (0.5 + c.importance / 200);
    }
    if (s.defFlag) boost += 0.12;
    if (s.isHeading) boost -= 0.3; // 标题/目录不作为答案主体
    if (s.text.length < 14) boost -= 0.12;
    if (intents.includes("number") && /\d/.test(s.text)) boost += 0.08;
    if (intents.includes("how") || intents.includes("list")) {
      if (STEP_MARK.test(s.text)) boost += 0.1;
      if (/(包括|分为|包含|有以下|主要有)/.test(s.text)) boost += 0.08;
    }
    if (intents.includes("example") && /(例如|比如|举例)/.test(s.text)) boost += 0.25;
    if (intents.includes("why") && /(因为|由于|原因是|使得|从而)/.test(s.text)) boost += 0.15;
    if (intents.includes("compare") && /(区别|不同于|相比|而)/.test(s.text)) boost += 0.12;
    boost += Math.min(0.06, s.text.length / 6000);
    return { s, score: base + boost, base };
  });

  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const byCos = [...scored].sort((a, b) => b.base - a.base).slice(0, 3);
  const merged = [];
  for (const item of [...byCos, ...byScore]) {
    if (!merged.includes(item) && item.score > 0.005) merged.push(item);
  }
  const top = merged.slice(0, 7);
  const refs = top.slice(0, 3);
  const topBase = Math.max(0, ...top.map((x) => x.base));
  const confidence = +Math.max(
    0.18,
    Math.min(0.96, topBase * 1.9 + (hits.length ? 0.24 : 0) + (top[0]?.defFlag ? 0.08 : 0))
  ).toFixed(2);

  // 过滤掉被更长命中词包含的碎片词（例如“手法”⊂“艺术手法”）
  const cleanHits = [];
  for (const c of hits) {
    if (cleanHits.some((o) => o.term.includes(c.term))) continue;
    cleanHits.push(c);
  }
  hits.length = 0;
  hits.push(...cleanHits);

  const focus = hits[0];
  const body = [];

  // ---- 开头：要点结论 ----
  let usedAsLead = null;
  if (focus && focus.definition) {
    body.push(`**${focus.term}**：${cleanDef(focus.definition)}`);
  } else if (focus) {
    // 没有明确定义时，选用该知识点相关性最高的描述句（排除标题）
    const best = top.find((x) => x.s.text.includes(focus.term) && !x.s.isHeading && x.s.text.length > 18);
    if (best) {
      body.push(`**${focus.term}**：${trimLen(best.s.text, 130)}`);
      usedAsLead = best.s;
    }
  }

  // ---- 主体：按意图/模式组织 ----
  const pool = top.map((x) => x.s).filter(
    (s) =>
      s !== usedAsLead &&
      !s.isHeading &&
      s.text.length > 12 &&
      !(focus && focus.defSentence && s.text === focus.defSentence)
  );

  if (mode === "steps" || intents.includes("how") || intents.includes("list")) {
    const steps = toSteps(q, corpus, hits, pool);
    if (steps.length) {
      body.push("");
      body.push("**分步讲解**");
      steps.forEach((t, i) => body.push(`${i + 1}. ${t}`));
    }
  } else if (mode === "example" || intents.includes("example")) {
    const ex = pickExample(hits, corpus);
    body.push("");
    body.push("**举例说明**");
    body.push(ex);
  } else if (mode === "socratic") {
    return socraticAnswer(corpus, hits, top, confidence, q);
  } else {
    // 直接回答：补充证据句（去重，避免与定义重复）
    let added = 0;
    for (const s of pool) {
      if (added >= 3) break;
      const t = trimLen(s.text, 130);
      if (!t || body.some((b) => diceSimilarity(b, t) > 0.7)) continue;
      body.push(t);
      added++;
    }
  }

  // ---- 总结 / 关联 ----
  const related = hits.slice(1, 4).filter((c) => c.importance >= 20 && !c.term.includes(focus?.term));
  if (related.length) {
    body.push("");
    body.push("**关联延伸**");
    for (const c of related) {
      const d = c.definition || c.primarySentence || "";
      body.push(`· ${c.term}：${trimLen(cleanDef(d), 70)}`);
    }
  }

  if (!hits.length && top.length) {
    body.unshift("未在素材中找到完全匹配的概念，以下是内容上与你的提问最接近的表述：");
  }

  const text = body.filter((x) => x !== undefined).join("\n");
  return {
    text,
    html: mdToHtml(text),
    hits: hits.map((c) => ({ term: c.term, importance: c.importance, definition: c.definition })),
    refs: refs.map((x) => ({ title: x.s.materialTitle, idx: x.s.idx + 1, text: x.s.text, score: +(x.score).toFixed(3) })),
    confidence,
    mode,
    suggested: suggestQuestions(corpus, q, 3)
  };
}

function cleanDef(d) {
  return trimLen(d.replace(/^(所谓|所谓的)/, ""), 160);
}

function trimLen(s, n) {
  s = (s || "").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** 生成步骤列表 */
function toSteps(question, corpus, hits, pool) {
  const focusTerm = hits[0]?.term;
  const src = [];
  const pushList = (list) => list.forEach((t) => !src.includes(t) && src.push(t));
  // 先给含有焦点概念的句子，保证步骤围绕提问对象展开
  if (focusTerm) pushList(pool.filter((s) => s.text.includes(focusTerm)).map((s) => s.text));
  pushList(pool.map((s) => s.text));
  if (hits[0] && corpus.sentences.length) {
    for (const idx of hits[0].mentions.slice(0, 6)) {
      const s = corpus.sentences.find((x) => x.idx === idx && x.materialId === hits[0].materialId);
      if (s && !s.isHeading && !src.includes(s.text)) src.push(s.text);
    }
  }
  const out = [];
  for (const line of src) {
    if (STEP_MARK.test(line) || /(包括|分为|包含|主要有|有以下)/.test(line)) {
      line
        .split(/[；;]/)
        .map((x) => x.trim())
        .filter((x) => x.length > 6)
        .forEach((x) => {
          const clean = x.replace(/^(首先|其次|再次|然后|接着|最后)[，,、]?/, "");
          if (!out.some((o) => diceSimilarity(o, clean) > 0.82)) out.push(clean);
        });
    }
  }
  if (!out.length) {
    out.push(...src.slice(0, 4).map((x) => trimLen(x, 110)));
  }
  return out.slice(0, 6);
}

/** 挑举例：优先同一知识点、再同一素材内的"例如"句，避免跨素材串台 */
function pickExample(hits, corpus) {
  const focus = hits[0];
  if (focus) {
    const own = (focus.examples || []).find((e) => e.includes(focus.term));
    if (own) return own;
    if (focus.examples && focus.examples.length) return focus.examples[0];
    const inMaterial = corpus.sentences.find(
      (s) =>
        /(例如|比如|举例|以.{0,10}为例)/.test(s.text) &&
        s.materialId === focus.materialId &&
        s.text.includes(focus.term)
    );
    if (inMaterial) return inMaterial.text;
    const anyInMaterial = corpus.sentences.find(
      (s) => /(例如|比如|举例|以.{0,10}为例)/.test(s.text) && s.materialId === focus.materialId
    );
    if (anyInMaterial)
      return `素材中未针对「${focus.term}」给出专门例子，可参考同一素材中的这句话：${anyInMaterial.text}`;
    return `素材里还没有关于「${focus.term}」的举例。可以这样自测：先回忆它的定义，再想一个生活或题目中的应用场景，说给我听，我来帮你校正。`;
  }
  const s = corpus.sentences.find(
    (x) => /(例如|比如|举例|以.{0,10}为例)/.test(x.text) && !x.isHeading
  );
  return s ? s.text : "素材中没有出现明显举例，可在讲义里补充「例如/比如」句，我能据此生成更具体的讲解。";
}

/** 苏格拉底式引导 */
function socraticAnswer(corpus, hits, top, confidence, question) {
  const lines = [];
  const target = hits[0] || (top[0] ? { term: "这个概念", definition: top[0].s.text } : null);
  if (!target) {
    return {
      text: "素材中还没有足够的知识点，先完成解析与抽取，我再带你一步步推导 🙂",
      html: "素材中还没有足够的知识点，先完成解析与抽取，我再带你一步步推导 🙂",
      hits: [], refs: [], confidence: 0, mode: "socratic", suggested: []
    };
  }
  const def = cleanDef(target.definition || target.defSentence || "");
  const cloze = makeCloze(def, target.term);
  lines.push("我们先不急着给结论，一起推一推 👇");
  lines.push("");
  lines.push("**第 1 步：先说出你的理解**");
  lines.push(`关于「${target.term}」，你能用自己的话描述它是什么、用来解决什么问题吗？`);
  lines.push("");
  lines.push("**第 2 步：补全关键表述**");
  lines.push(`> ${cloze}`);
  lines.push("");
  lines.push("**第 3 步：用它解释一个现象**");
  lines.push(`举一个你会用到「${target.term}」的场景，发给我，我会指出遗漏的要点；也可以点上方「直接回答」查看标准讲解。`);
  const text = lines.join("\n");
  return {
    text,
    html: mdToHtml(text),
    hits: hits.map((c) => ({ term: c.term, importance: c.importance, definition: c.definition })),
    refs: top.slice(0, 2).map((x) => ({ title: x.s.materialTitle, idx: x.s.idx + 1, text: x.s.text, score: +x.score.toFixed(3) })),
    confidence,
    mode: "socratic",
    suggested: suggestQuestions(corpus, question, 3)
  };
}

function firstName(term) {
  return term && term.length ? `关于「${term}」` : "在这个知识点上";
}

function makeCloze(def, term) {
  if (!def) return "（暂无可用定义）";
  const idx = def.indexOf(term);
  if (idx >= 0) return def.replace(term, "＿＿＿＿");
  const parts = def.split(/[，,、]/);
  if (parts.length > 1) {
    const cut = parts[parts.length - 1];
    return def.replace(cut, "＿＿＿＿");
  }
  return def.slice(0, Math.max(4, def.length - 12)) + "＿＿＿＿";
}

/** 推荐提问 */
export function suggestQuestions(corpus, basedOn, n = 4) {
  const defined = corpus.cards.filter((c) => c.definition && c.importance >= 25);
  const top = (defined.length >= 3 ? defined : corpus.cards.filter((c) => c.importance >= 45)).slice(0, 14);
  if (!top.length) return [];
  const templates = [
    (t) => `什么是${t}？`,
    (t) => `${t}的核心要点是什么？`,
    (t) => `请分步讲解${t}的过程`,
    (t) => `${t}有什么实际应用？举例说明`,
    (t) => `为什么要学习${t}？`
  ];
  const picked = [];
  const used = new Set();
  let i = 0;
  while (picked.length < n && i < top.length * 3) {
    const card = top[i % top.length];
    const tpl = templates[Math.floor(i / top.length) % templates.length];
    const q = tpl(card.term);
    if (!used.has(q) && q !== basedOn) {
      used.add(q);
      picked.push(q);
    }
    i++;
  }
  return picked;
}

/** 极简 Markdown → HTML（只处理粗体、引用、列表、换行） */
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc(md).split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    let l = line.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if (/^&gt;\s?/.test(l)) {
      l = `<blockquote style="margin:6px 0;padding-left:10px;border-left:3px solid var(--primary);color:var(--muted)">${l.replace(/^&gt;\s?/, "")}</blockquote>`;
    }
    if (/^\d+\.\s/.test(l)) {
      if (!inList) { html += "<ol>"; inList = true; }
      html += `<li>${l.replace(/^\d+\.\s/, "")}</li>`;
      continue;
    }
    if (inList) { html += "</ol>"; inList = false; }
    html += l ? `<p style="margin:4px 0">${l}</p>` : `<div style="height:6px"></div>`;
  }
  if (inList) html += "</ol>";
  return html;
}
