/**
 * 轻量中文文本处理：句切分、混合分词（中文 bigram + 英文词 + 数字）、
 * 候选术语 n-gram 抽取、TF-IDF 向量与余弦相似度。
 * 无任何依赖，可在浏览器与 Node 中直接运行。
 */

const CJK = /[\u4e00-\u9fa5]/;
const CJK_RANGE = "\\u4e00-\\u9fa5";

/** 句末标点（不切分分号，保留“首先…；其次…；最后…”这类并列句便于提取步骤） */
const SENT_END = "。！？!?";
/** 句中停顿 */
const CLAUSE = "，,、：:（）()【】[]“”\"‘’'《》〈〉—…·";

/** 常见停用字（用于过滤候选词边界） */
const BAD_EDGE = new Set(
  ("的了是我在有和就不也都很而及与其之为被把让使从到对于于上中下里前后内外这那些个们" +
    "要会能可以所将被已还又再更最很太只才都就没不如但可是所以然后并且或不一个我你他她它" +
    "我们你们他们这样那样其中由于因此同时同时也等一种非常主要进行通过以及并且" +
    "所着所给将由受向因该等把从而则").split("")
);

/** 独立停用词 */
const STOPWORDS = new Set([
  "可以", "我们", "你们", "他们", "因为", "所以", "但是", "如果", "虽然", "然而", "因此",
  "并且", "以及", "或者", "这个", "那个", "什么", "如何", "怎么", "一些", "很多", "非常",
  "进行", "通过", "由于", "同时", "主要", "例如", "比如", "此外", "另外", "其它", "其他",
  "过程", "方式", "方法", "内容", "情况", "问题", "部分", "方面", "作用", "特点", "表示",
  "the", "and", "for", "with", "that", "this", "from", "into", "are", "was", "were"
]);

/** 术语内部不允许出现的虚词（出现即判定为非术语） */
const INNER_BAD = "的了是在有和就也都很而其之被把让使从到与及并且则但若却所已这那它";

/** 常见动词/虚词黑名单：即便高频也不作为知识点 */
const BLACKLIST = new Set([
  "包括", "包含", "出现", "表示", "进行", "使用", "采用", "通过", "需要", "称为", "具有",
  "变成", "得到", "可能", "应该", "一定", "因为", "所以", "但是", "而且", "主要", "常见",
  "例如", "比如", "分为", "有着", "这些", "那些", "这样", "那样", "接着", "然后", "首先",
  "其次", "再次", "最后", "同时", "此外", "另外", "其它", "其他", "不同", "之一", "之间",
  "以下", "以上", "所谓", "什么", "如何", "怎么", "为什么", "在于", "对于", "关于", "中在"
]);

/** 学科后缀/线索词，用于提升候选术语得分 */
const SUFFIX_HINT = [
  "定律", "定理", "公式", "方程", "函数", "效应", "现象", "机制", "过程", "反应", "结构",
  "系统", "模型", "算法", "协议", "技术", "方法", "原理", "概念", "性质", "特征", "单位",
  "细胞", "组织", "器官", "分子", "原子", "元素", "化合", "能量", "速率", "质量", "密度",
  "压力", "温度", "电流", "电压", "电阻", "功率", "网络", "服务器", "客户端", "数据库",
  "基因", "蛋白", "酶", "光合", "呼吸", "生态", "种群", "群落", "电压表", "加速度",
  "抛物线", "对称轴", "顶点", "系数", "常数", "变量", "向量", "矩阵", "概率", "分布"
];

const AKA_RE = /(?:又称|亦称|简称|也叫|即称为|也就是)([^，。；、\s]{2,10})/;

export function isCJK(ch) {
  return CJK.test(ch);
}

export function containsCJK(s) {
  return CJK.test(s);
}

/** 切分为句子（保留标点） */
export function splitSentences(text) {
  if (!text) return [];
  const clean = text.replace(/\r/g, "");
  const out = [];
  let buf = "";
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    buf += ch;
    if (SENT_END.includes(ch)) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else if (ch === "\n") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
    } else if (buf.length > 220) {
      out.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length >= 2);
}

/** 混合分词：英文单词 / 数字 / 中文 bigram */
export function tokenize(text) {
  const tokens = [];
  if (!text) return tokens;
  const re = new RegExp(`([A-Za-z][A-Za-z0-9+#.\\-]{1,}|[0-9]+(?:\\.[0-9]+)?|[${
    CJK_RANGE
  }]+)`, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    const tk = m[0];
    if (/^[0-9.]+$/.test(tk)) {
      tokens.push("NUM");
    } else if (CJK.test(tk)) {
      if (tk.length === 1) {
        tokens.push(tk);
      } else {
        for (let i = 0; i < tk.length - 1; i++) tokens.push(tk.slice(i, i + 2));
      }
    } else {
      tokens.push(tk.toLowerCase());
    }
  }
  return tokens.filter((t) => t.length > 0);
}

/** 抽取中文候选术语 n-gram（2~6 字），返回 Map<term, {count, firstIndex}> */
export function candidateGrams(text) {
  const map = new Map();
  if (!text) return map;
  const re = new RegExp(`[${CJK_RANGE}A-Za-z0-9]{2,}`, "g");
  const runs = [];
  let m;
  while ((m = re.exec(text)) !== null) runs.push({ s: m[0], idx: m.index });

  for (const { s, idx } of runs) {
    if (!CJK.test(s)) {
      // 纯英文/数字串
      if (/^[A-Za-z][A-Za-z0-9+#.\-]{1,}$/.test(s) && !STOPWORDS.has(s.toLowerCase())) {
        bump(map, s, idx);
      }
      continue;
    }
    if (!CJK.test(s[0]) || !CJK.test(s[s.length - 1])) continue;
    const n = s.length;
    const maxLen = Math.min(6, n);
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i + len <= n; i++) {
        const g = s.slice(i, i + len);
        if (BAD_EDGE.has(g[0]) || BAD_EDGE.has(g[g.length - 1])) continue;
        if (STOPWORDS.has(g)) continue;
        if (/^(.)\1+$/.test(g)) continue;
        bump(map, g, idx + i);
      }
    }
  }
  return map;
}

function bump(map, term, idx) {
  const rec = map.get(term);
  if (rec) rec.count++;
  else map.set(term, { count: 1, firstIndex: idx });
}

/** 术语前后的强边界标记 */
const RIGHT_BREAK = new Set([
  "的", "是", "之", "，", "、", "：", "；", "。", "）", ")", "》", "」", "”", "在", "为", "由", "包", "分", "又", "中", "与"
]);

/** 该词在文本中是否存在"独立成词"的边界证据 */
export function hasBoundaryEvidence(text, term) {
  const t = text || "";
  let pos = t.indexOf(term);
  while (pos >= 0) {
    const prev = pos > 0 ? t[pos - 1] : "\n";
    const next = t[pos + term.length] || "。";
    if (!/[\u4e00-\u9fa5]/.test(prev) || !/[\u4e00-\u9fa5]/.test(next) || RIGHT_BREAK.has(next))
      return true;
    pos = t.indexOf(term, pos + 1);
  }
  return false;
}

/** 常见动词/引导词开头：这些开头的串基本是短语碎片而非术语 */
const FRAG_PREFIX = [
  "接着", "称为", "求解", "表示", "合成", "判断", "确定", "利用", "使用", "采用", "通过",
  "出现", "得到", "变成", "进行", "产生", "使得", "导致", "存在", "具有", "然后", "其次",
  "另外", "此外", "同时", "例如", "比如", "因此", "所以", "总结", "可见", "需要", "应该",
  "可以", "能够", "主要", "常见", "首先", "最后", "综上", "由此", "随之", "指出", "认为",
  "抛保存在", "分为", "包括", "包含", "即为", "也就是", "还可", "并且", "或是"
];

function countOcc(text, term) {
  let n = 0,
    p = text.indexOf(term);
  while (p >= 0) {
    n++;
    p = text.indexOf(term, p + 1);
  }
  return n;
}

/** 词首边界比例：出现位置之前是标点/换行/空格/西文/数字/行首的比例 */
export function startBoundaryRate(text, term) {
  const t = text || "";
  let pos = t.indexOf(term);
  let total = 0,
    open = 0;
  while (pos >= 0) {
    total++;
    const prev = pos > 0 ? t[pos - 1] : "\n";
    if (!/[\u4e00-\u9fa5]/.test(prev)) open++;
    pos = t.indexOf(term, pos + 1);
  }
  return total ? open / total : 0;
}

/** 词尾边界比例 */
export function endBoundaryRate(text, term) {
  const t = text || "";
  let pos = t.indexOf(term);
  let total = 0,
    open = 0;
  while (pos >= 0) {
    total++;
    const next = t[pos + term.length] || "。";
    if (!/[\u4e00-\u9fa5]/.test(next)) open++;
    pos = t.indexOf(term, pos + 1);
  }
  return total ? open / total : 0;
}

/** 至少有一次「两侧同时断开」的独立出现 */
export function isolatedCount(text, term) {
  const t = text || "";
  let pos = t.indexOf(term);
  let n = 0;
  while (pos >= 0) {
    const prev = pos > 0 ? t[pos - 1] : "\n";
    const next = t[pos + term.length] || "。";
    if (!/[\u4e00-\u9fa5]/.test(prev) && !/[\u4e00-\u9fa5]/.test(next)) n++;
    pos = t.indexOf(term, pos + 1);
  }
  return n;
}

export function hasSuffixHint(term) {
  return SUFFIX_HINT.some((s) => term.endsWith(s));
}

/**
 * 综合判定一个候选串是否为可信术语
 * @param {object} opts {defined: 是否出现在定义句, suffix: 是否带学科后缀}
 */
export function isCredibleTerm(text, term, opts = {}) {
  if (!term) return false;
  const cnt = countOcc(text, term);
  if (cnt >= 3) return true;
  if (isolatedCount(text, term) >= 1) return true;
  if (FRAG_PREFIX.some((p) => term.startsWith(p))) return false;
  const sr = startBoundaryRate(text, term);
  const er = endBoundaryRate(text, term);
  if (opts.suffix && cnt >= 2 && sr >= 0.5) return true;
  if (opts.defined && sr >= 0.5) return true;
  if (cnt >= 2 && sr >= 0.5 && er >= 0.5) return true;
  return false;
}

/**
 * 候选术语打分与清洗
 * @returns [{term, count, score, firstIndex}]
 */
export function rankTerms(text, topN = 40) {
  const grams = candidateGrams(text);
  const len = Math.max(200, (text || "").length);

  // 先按长度降序处理，便于计算“被更长术语吸收”的重复计数
  const all = [...grams.entries()]
    .map(([term, info]) => ({ term, count: info.count, firstIndex: info.firstIndex }))
    .filter((it) => passIntegrity(it.term))
    .filter(
      (it) =>
        it.count >= 2 ||
        SUFFIX_HINT.some((s) => it.term.endsWith(s)) ||
        /^[A-Z]/.test(it.term[0])
    )
    // 低频词需要有可靠的成词边界，避免抽出跨词的短语碎片
    // 必须有可靠的成词边界，否则视为跨词短语碎片
    .filter((it) => isCredibleTerm(text, it.term, { suffix: hasSuffixHint(it.term) }))
    .sort((a, b) => b.term.length - a.term.length || b.count - a.count);

  const kept = [];
  for (const it of all) {
    let cover = 0;
    for (const k of kept) if (k.term.includes(it.term)) cover += k.count;
    const indep = Math.max(0, it.count - cover);
    if (indep === 0) continue; // 完全被更长术语包含，属于碎片词
    kept.push({ ...it, cover, indep });
  }

  const items = kept.map((it) => {
    const eff = it.indep + 0.35 * it.cover;
    let score = eff * (1 + 0.16 * (it.term.length - 2));
    if (SUFFIX_HINT.some((s) => it.term.endsWith(s))) score *= 2.1;
    const quoted = new RegExp(`[《「"'“]([^》」"'”]{0,3})?${escapeReg(it.term)}`).test(text);
    if (quoted) score *= 1.8;
    if (new RegExp(`${escapeReg(it.term)}(?:是|是指|指的是|定义为)`).test(text)) score *= 2.4;
    if (/^[A-Z]/.test(it.term[0])) score *= 1.5;
    score *= 1 + 0.35 * Math.max(0, 1 - it.firstIndex / len);
    return { term: it.term, count: it.count, indep: it.indep, score, firstIndex: it.firstIndex };
  });

  items.sort((a, b) => b.score - a.score);

  // 轻度去重：同一位置起始、相互包含的近似词只保留较长者
  const picked = [];
  for (const it of items) {
    const dup = picked.some(
      (p) => p.term.includes(it.term) && Math.abs(p.firstIndex - it.firstIndex) < 3
    );
    if (dup) continue;
    picked.push(it);
  }
  return picked.slice(0, topN);
}

export function passIntegrity(term) {
  if (STOPWORDS.has(term) || BLACKLIST.has(term)) return false;
  for (const ch of term) if (INNER_BAD.includes(ch)) return false;
  if (/^\d+$/.test(term)) return false;
  return true;
}

export function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 词频向量 */
export function buildVector(tokens) {
  const v = new Map();
  for (const t of tokens) v.set(t, (v.get(t) || 0) + 1);
  let norm = 0;
  for (const val of v.values()) norm += val * val;
  norm = Math.sqrt(norm) || 1;
  return { v, norm };
}

export function cosine(a, b) {
  if (!a || !b) return 0;
  let [small, large] = a.v.size < b.v.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [k, val] of small.v) {
    const ov = large.v.get(k);
    if (ov) dot += val * ov;
  }
  return dot / (a.norm * b.norm || 1);
}

/** 字符 bigram Dice 相似度，用于简答题判分 */
export function diceSimilarity(a, b) {
  const bi = (s) => {
    const set = new Set();
    s = (s || "").replace(/\s+/g, "");
    if (s.length < 2) return set.add(s) && set;
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bi(a),
    B = bi(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export { STOPWORDS, SUFFIX_HINT, AKA_RE, CLAUSE };
