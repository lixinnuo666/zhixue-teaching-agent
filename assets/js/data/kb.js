/**
 * 个人知识库
 *
 * 把各素材抽取出的知识点，「按学科分类」沉淀到一个长期保存的个人知识库中。
 * 与临时素材库（mta.v2）解耦：素材删掉后，已入库的知识点仍然保留。
 *
 * 存储结构（localStorage: mta.kb.v1）
 *   { version:1, entries:[ { id, term, type, category, definition, sentence,
 *                            materialId, materialTitle, importance, level, freq,
 *                            addedAt, updatedAt } ], updatedAt }
 */

import { getCategory, classifyMaterial, DEFAULT_CATEGORY } from "../nlp/classify.js";

const KEY = "mta.kb.v1";
const MAX_ENTRIES = 500;

const blank = { version: 1, entries: [], updatedAt: 0 };

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    cache = parsed && Array.isArray(parsed.entries) ? { ...blank, ...parsed } : { ...blank };
  } catch (e) {
    cache = { ...blank };
  }
  return cache;
}

function write(data) {
  cache = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    // 配额超限时裁掉最旧的一批再试一次
    try {
      const trimmed = { ...data, entries: data.entries.slice(0, Math.floor(data.entries.length / 2)) };
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      cache = trimmed;
      return false;
    } catch (e2) {
      return false;
    }
  }
}

function entryKey(category, term) {
  return `${category}::${term}`;
}

function dedupeKey(e) {
  return entryKey(e.category, e.term);
}

/** 判定素材应归入的分类：优先用素材上已确认的分类，其次自动分类 */
function resolveCategory(material) {
  if (material && material.category && material.category !== DEFAULT_CATEGORY) {
    return getCategory(material.category);
  }
  return classifyMaterial(material || {});
}

export const kb = {
  all() {
    return read().entries.slice();
  },

  /** 按分类统计：条目数、涉及素材数、平均重要度 */
  stats() {
    const entries = read().entries;
    const map = new Map();
    for (const e of entries) {
      let r = map.get(e.category);
      if (!r) {
        const c = getCategory(e.category);
        r = { key: c.key, name: c.name, icon: c.icon, color: c.color, count: 0, materials: new Set(), imp: 0 };
        map.set(e.category, r);
      }
      r.count++;
      r.imp += e.importance || 0;
      if (e.materialId) r.materials.add(e.materialId);
    }
    return [...map.values()]
      .map((r) => ({
        key: r.key,
        name: r.name,
        icon: r.icon,
        color: r.color,
        count: r.count,
        materials: r.materials.size,
        avgImportance: r.count ? Math.round(r.imp / r.count) : 0
      }))
      .sort((a, b) => b.count - a.count);
  },

  /**
   * 把一份素材的知识点按分类写入知识库（已存在则更新释义）
   * @returns {{added:number, updated:number, skipped:number, category:object, total:number}}
   */
  addFromMaterial(material, extraction, opts = {}) {
    if (!extraction || !Array.isArray(extraction.terms) || !extraction.terms.length) {
      return { added: 0, updated: 0, skipped: 0, category: resolveCategory(material), total: read().entries.length };
    }
    const cat = resolveCategory(material);
    const limit = opts.limit || 20;
    const minImp = typeof opts.minImportance === "number" ? opts.minImportance : 30;

    const picked = extraction.terms
      .filter((t) => t && t.term && (t.importance || 0) >= minImp)
      .slice(0, limit);

    const data = read();
    const index = new Map(data.entries.map((e) => [dedupeKey(e), e]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const now = Date.now();

    for (const t of picked) {
      const k = entryKey(cat.key, t.term);
      const prev = index.get(k);
      const payload = {
        term: t.term,
        type: t.type || "term",
        category: cat.key,
        definition: t.definition || "",
        sentence: t.defSentence || t.primarySentence || "",
        materialId: material?.id || extraction.materialId || "",
        materialTitle: material?.title || extraction.materialTitle || "",
        importance: t.importance || 0,
        level: t.level || "了解",
        freq: t.freq || 0
      };
      if (prev) {
        // 保留更完整的释义
        const better = (payload.definition || "").length > (prev.definition || "").length;
        Object.assign(prev, {
          ...payload,
          definition: better ? payload.definition : prev.definition,
          importance: Math.max(prev.importance || 0, payload.importance),
          updatedAt: now
        });
        updated++;
        continue;
      }
      if (data.entries.length >= MAX_ENTRIES) {
        skipped++;
        continue;
      }
      const entry = { id: `kb-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...payload, addedAt: now, updatedAt: now };
      data.entries.push(entry);
      index.set(k, entry);
      added++;
    }

    data.updatedAt = now;
    write(data);
    return { added, updated, skipped, category: cat, total: data.entries.length };
  },

  remove(id) {
    const data = read();
    data.entries = data.entries.filter((e) => e.id !== id);
    data.updatedAt = Date.now();
    write(data);
  },

  removeByMaterial(materialId) {
    const data = read();
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.materialId !== materialId);
    data.updatedAt = Date.now();
    write(data);
    return before - data.entries.length;
  },

  clear() {
    write({ ...blank, updatedAt: Date.now() });
  },

  /** 检索：关键词 + 分类过滤 */
  search(opts = {}) {
    const kw = (opts.keyword || "").trim();
    const cat = opts.category || "";
    return read()
      .entries.filter((e) => {
        if (cat && e.category !== cat) return false;
        if (!kw) return true;
        return (
          e.term.includes(kw) ||
          (e.definition || "").includes(kw) ||
          (e.sentence || "").includes(kw) ||
          (e.materialTitle || "").includes(kw)
        );
      })
      .sort((a, b) => (b.importance || 0) - (a.importance || 0) || (b.addedAt || 0) - (a.addedAt || 0));
  },

  count() {
    return read().entries.length;
  },

  updatedAt() {
    return read().updatedAt;
  }
};

/** 导出为 Markdown（按分类分节） */
export function kbExportMarkdown() {
  const entries = kb.all().sort((a, b) => a.category.localeCompare(b.category) || (b.importance || 0) - (a.importance || 0));
  const lines = ["# 我的个人知识库", "", `> 导出时间：${new Date().toLocaleString()} · 共 ${entries.length} 条`, ""];
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category).push(e);
  }
  let idx = 1;
  for (const [cat, list] of groups) {
    const c = getCategory(cat);
    lines.push(`## ${idx++}. ${c.icon} ${c.name}（${list.length} 条）`, "");
    for (const e of list) {
      lines.push(`### ${e.term}`);
      lines.push(`- 类型：${e.type} · 重要度：${e.importance}（${e.level}）`);
      if (e.definition) lines.push(`- 定义：${e.definition.replace(/\n/g, " ")}`);
      if (e.sentence) lines.push(`- 出处：${e.sentence.replace(/\n/g, " ")}`);
      if (e.materialTitle) lines.push(`- 来源素材：${e.materialTitle}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
