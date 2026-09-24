/**
 * 依据抽取出的知识点自动生成练习题并支持自动判分
 * 题型：单选（定义辨析 / 关系辨析）、填空（术语回填）、简答（要点复述）
 */

import { diceSimilarity, tokenize } from "./tokenize.js";

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shortDef(card) {
  const d = (card.definition || card.defSentence || "").replace(/^(所谓|所谓的)/, "");
  return d.length > 90 ? d.slice(0, 90) + "…" : d;
}

/** 去掉术语本身后的定义内容，用于选项 */
function defTail(card) {
  let d = shortDef(card);
  const i = d.indexOf(card.term);
  if (i === 0) return d.slice(card.term.length).replace(/^是|^是指|^指的是|^定义为/, "").trim();
  return d;
}

export function generateQuiz(corpus, count = 8) {
  const all = corpus.cards.filter((c) => c.importance >= 22);
  if (all.length < 3) return [];

  // 有定义的知识点优先出定义类题，避免出现大量同质化的关系题
  const withDef = all.filter((c) => c.definition && c.definition.length >= 12);
  const withoutDef = all.filter((c) => !(c.definition && c.definition.length >= 12));
  const cards = shuffle(withDef).concat(shuffle(withoutDef));

  const items = [];
  const used = new Set();
  const sentenceOf = (term) =>
    corpus.sentences.find(
      (s) => s.text.includes(term) && !s.isHeading && s.text.length >= 22 && s.text.length <= 140
    );

  const relMap = new Map();
  for (const r of corpus.relations || []) {
    if (!relMap.has(r.source)) relMap.set(r.source, []);
    relMap.get(r.source).push(r.target);
    if (r.type === "cooccur") {
      if (!relMap.has(r.target)) relMap.set(r.target, []);
      relMap.get(r.target).push(r.source);
    }
  }

  for (const card of cards) {
    if (items.length >= count) break;
    if (used.has(card.term)) continue;
    const kind = items.length % 3;
    const others = cards.filter((c) => c.term !== card.term);
    let pushed = false;

    if (kind === 0 && card.definition) {
      const right = defTail(card) || shortDef(card);
      const distractors = shuffle(others)
        .filter((c) => defTail(c) && defTail(c).length > 10)
        .slice(0, 3)
        .map((c) => defTail(c));
      if (right.length > 8 && distractors.length === 3) {
        items.push({
          type: "choice",
          term: card.term,
          q: `下列关于「${card.term}」的表述，正确的一项是？`,
          options: shuffle([right, ...distractors]),
          answer: right,
          reference: shortDef(card)
        });
        pushed = true;
      }
    }

    if (!pushed && kind === 1 && card.definition) {
      const d = shortDef(card);
      const idx = d.indexOf(card.term);
      const stem = idx >= 0 ? d.replace(card.term, "＿＿＿＿") : null;
      if (stem && stem !== d) {
        items.push({
          type: "fill",
          term: card.term,
          q: `补全下列表述：${stem}`,
          answer: card.term,
          aliases: card.aliases || [],
          reference: shortDef(card)
        });
        pushed = true;
      }
    }

    if (!pushed) {
      // 原文辨析：选出真正讲到该知识点的那句话
      const s = sentenceOf(card.term);
      if (s) {
        const pool = shuffle(corpus.sentences.filter(
          (x) => !x.isHeading && x.materialId === s.materialId && !x.text.includes(card.term) && x.text.length >= 22 && x.text.length <= 140
        ));
        const distractors = [];
        for (const cand of pool) {
          if (distractors.length >= 3) break;
          if (!distractors.some((d) => diceSimilarity(d, cand.text) > 0.7)) distractors.push(cand.text);
        }
        if (distractors.length === 3) {
          items.push({
            type: "choice",
            term: card.term,
            q: `下列哪一句是素材中关于「${card.term}」的正确描述？`,
            options: shuffle([s.text, ...distractors]),
            answer: s.text,
            reference: s.text
          });
          pushed = true;
        }
      }
    }

    if (!pushed) {
      const relTargets = relMap.get(card.term) || [];
      const neighbor = relTargets.find((t) => others.some((o) => o.term === t) && !used.has(t));
      if (neighbor) {
        const distract = shuffle(others.filter((o) => o.term !== neighbor).slice(0, 20))
          .slice(0, 3)
          .map((o) => o.term);
        if (distract.length === 3) {
          items.push({
            type: "choice",
            term: card.term,
            q: `在素材内容中，与「${card.term}」联系最紧密的概念是？`,
            options: shuffle([neighbor, ...distract]),
            answer: neighbor,
            reference: `依据素材共现/语义关系：${card.term} ↔ ${neighbor}`
          });
          pushed = true;
        }
      }
    }

    if (pushed) used.add(card.term);
  }

  return items.slice(0, count);
}

function topKeywords(card) {
  const src = `${card.term}${card.definition || ""}${card.defSentence || ""}`;
  const freq = new Map();
  for (const t of tokenize(src)) {
    if (t.length < 2) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((x) => x[0]);
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[\s，。、；：""''（）()]/g, "");
}

/**
 * 判分
 * @returns {{score:number, correct:boolean, feedback:string, reference:string}}
 */
export function grade(item, userAnswer) {
  const ref = item.reference || item.answer || "";
  if (item.type === "choice") {
    const ok = normalize(userAnswer) === normalize(item.answer);
    return {
      score: ok ? 1 : 0,
      correct: ok,
      feedback: ok ? "回答正确！" : `正确答案：${item.answer}`,
      reference: ref
    };
  }
  if (item.type === "fill") {
    const u = normalize(userAnswer);
    const hit =
      u === normalize(item.answer) || (item.aliases || []).some((a) => normalize(a) === u);
    const sim = diceSimilarity(normalize(item.answer), u);
    const ok = hit || sim >= 0.62;
    return {
      score: ok ? 1 : Math.max(0, sim),
      correct: ok,
      feedback: ok ? "回答正确！" : `参考答案：${item.answer}`,
      reference: ref
    };
  }
  // 简答：相似度 + 关键词覆盖
  const u = normalize(userAnswer);
  if (!u) return { score: 0, correct: false, feedback: "未作答", reference: ref };
  const sim = diceSimilarity(ref, u);
  const kws = item.keywords || [];
  const covered = kws.filter((k) => u.includes(k)).length;
  const cov = kws.length ? covered / kws.length : sim;
  const score = Math.min(1, 0.45 * sim + 0.55 * cov);
  return {
    score: +score.toFixed(2),
    correct: score >= 0.6,
    feedback:
      score >= 0.6
        ? `回答到位（命中关键词 ${covered}/${kws.length}）`
        : `还差一点：关键词命中 ${covered}/${kws.length}，注意包含 ${kws.slice(0, 3).join("、")} 等要点。`,
    reference: ref
  };
}

export { shuffle };
