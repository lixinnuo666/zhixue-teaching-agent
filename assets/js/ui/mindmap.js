/**
 * 知识思维导图：把零散的知识点聚合成「中心主题 → 分区分支 → 要点 → 子项」的层级结构。
 *
 * 解决的核心问题是「知识点太琐碎」：
 *   1. 分区（branch）先做主题聚合，避免 40+ 张平铺卡片；
 *   2. 去琐碎：低重要度、无定义、低频的术语不单独占主干，折叠进「次要要点」；
 *   3. 差异：分支用独立色系，要点按类型着色，重要度用尺寸/描边/徽标区分。
 *
 * 纯函数模块，不依赖 DOM，可在 Node 中直接测试。
 */

export const TYPE_COLOR = {
  concept: "#4f46e5",
  fact: "#0e7490",
  person: "#7c3aed",
  term: "#b45309"
};

export const TYPE_LABEL = {
  concept: "核心概念",
  fact: "事实数据",
  person: "人物/名词",
  term: "术语"
};

/* 分区配色：同色系低饱和，保证可区分但不喧宾夺主 */
export const BRANCH_PALETTE = [
  "#4f46e5",
  "#0e7490",
  "#0f766e",
  "#b45309",
  "#6d28d9",
  "#64748b"
];

/** 分区维度 */
export const MINDMAP_MODES = [
  { value: "chapter", label: "按章节分区" },
  { value: "type", label: "按类型分区" },
  { value: "level", label: "按重要度分区" },
  { value: "material", label: "按素材分区" }
];

/** 粒度档位：每档限制分区数与每个分支的主干要点数，避免导图层级过碎 */
const GRANULARITY = {
  1: { perBranch: 3, maxBranch: 4, showMinor: false, depth: 2, name: "精简" },
  2: { perBranch: 4, maxBranch: 6, showMinor: "fold", depth: 2, name: "标准" },
  3: { perBranch: 10, maxBranch: 8, showMinor: true, depth: 3, name: "详尽" }
};

const MINOR_THRESHOLD = 35; // 重要度低于此且无定义且低频 → 次要要点

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ------------------------------------------------------------------ */
/* 文本宽度估算（中文按 1em，西文/数字按 0.56em）                        */
/* ------------------------------------------------------------------ */
export function measureText(text, fontSize) {
  let w = 0;
  for (const ch of String(text)) {
    w += /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.56;
  }
  return w;
}

function ellipsis(text, fontSize, maxWidth) {
  if (measureText(text, fontSize) <= maxWidth) return text;
  let out = "";
  let w = 0;
  const limit = maxWidth - fontSize;
  for (const ch of String(text)) {
    const cw = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.56;
    if (w + cw > limit) break;
    out += ch;
    w += cw;
  }
  return out + "…";
}

/* ------------------------------------------------------------------ */
/* 章节归属                                                            */
/* ------------------------------------------------------------------ */

/** 由大纲标题（带 offset）构造章节区间 */
export function buildChapters(extractions) {
  const chapters = [];
  for (const ex of extractions || []) {
    const heads = (ex.outline || [])
      .filter((h) => (h.level || 2) <= 2 && typeof h.offset === "number" && h.offset >= 0)
      .sort((a, b) => a.offset - b.offset);
    if (!heads.length) continue;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const next = heads[i + 1];
      chapters.push({
        title: h.text || h.mark,
        mark: h.mark,
        start: h.offset,
        end: next ? next.offset : Number.MAX_SAFE_INTEGER,
        materialId: ex.materialId,
        materialTitle: ex.materialTitle || ex.materialId
      });
    }
  }
  return chapters;
}

/* ------------------------------------------------------------------ */
/* 构建思维导图                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {object} corpus  buildCorpus 产物
 * @param {Array}  extractions 各素材抽取结果
 * @param {object} opts { mode, granularity, keyword, type, expanded:Set, collapsed:Set }
 */
export function buildMindMap(corpus, extractions, opts = {}) {
  const mode = opts.mode || "chapter";
  const g = GRANULARITY[opts.granularity] || GRANULARITY[2];
  const keyword = (opts.keyword || "").trim();
  const typeFilter = opts.type || "";
  const exById = new Map((extractions || []).map((e) => [e.materialId, e]));

  let cards = (corpus?.cards || []).slice();
  if (typeFilter) cards = cards.filter((c) => c.type === typeFilter);
  if (keyword) {
    cards = cards.filter(
      (c) => c.term.includes(keyword) || (c.definition || "").includes(keyword) || (c.defSentence || "").includes(keyword)
    );
  }

  // 命中搜索时不做「去琐碎」裁剪，否则会搜不到东西
  const keepAll = !!keyword;

  /* --- 1. 分区 --- */
  const chapters = buildChapters(extractions);
  const useChapter = mode === "chapter" && chapters.length > 0;
  // 没有可识别的章节标题时，按素材分区兜底
  const useMaterial = mode === "material" || (mode === "chapter" && !chapters.length);

  const sentOffsetOf = (card) => {
    const ex = exById.get(card.materialId);
    const idx = (card.mentions || [])[0];
    if (!ex || idx == null) return -1;
    const s = ex.sentences[idx];
    return s && typeof s.offset === "number" ? s.offset : -1;
  };

  const chapterOf = (card) => {
    const off = sentOffsetOf(card);
    if (off < 0) return null;
    for (const ch of chapters) {
      if (ch.materialId === card.materialId && off >= ch.start && off < ch.end) return ch;
    }
    return null;
  };

  const LEVEL_TITLE = {
    core: "核心要点",
    major: "重点理解",
    minor: "拓展了解"
  };

  const buckets = [];
  const bucketByKey = new Map();
  for (const card of cards) {
    let key;
    let title;
    let extra = {};
    if (useChapter) {
      const ch = chapterOf(card);
      key = ch ? `${ch.materialId}::${ch.title}` : "__other__";
      title = ch ? ch.title : "其他要点";
      extra = ch ? { mark: ch.mark, materialTitle: ch.materialTitle } : { muted: true };
    } else if (useMaterial) {
      key = card.materialId;
      title = card.materialTitle || card.materialId;
    } else if (mode === "level") {
      key = card.importance >= 70 ? "core" : card.importance >= 40 ? "major" : "minor";
      title = LEVEL_TITLE[key];
    } else {
      key = card.type;
      title = TYPE_LABEL[card.type] || "术语";
    }
    let b = bucketByKey.get(key);
    if (!b) {
      b = { key, title, items: [], ...extra };
      bucketByKey.set(key, b);
      buckets.push(b);
    }
    b.items.push(card);
  }

  // level 模式固定展示顺序；其余按知识点数量/权重排序
  if (mode === "level") {
    const order = ["core", "major", "minor"];
    buckets.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else {
    buckets.sort((a, b) => {
      if (a.muted !== b.muted) return a.muted ? 1 : -1;
      const wa = a.items.reduce((s, c) => s + (c.importance || 0), 0);
      const wb = b.items.reduce((s, c) => s + (c.importance || 0), 0);
      return b.items.length - a.items.length || wb - wa;
    });
  }
  // 分区过多同样会显得琐碎：只保留权重最高的若干分区，其余合并为「其他分区」
  if (buckets.length > g.maxBranch) {
    const head = buckets.slice(0, g.maxBranch - 1);
    const tail = buckets.slice(g.maxBranch - 1);
    let other = tail.find((b) => b.key === "__other__");
    if (!other) {
      other = { key: "__other__", title: "其他分区", items: [], muted: true };
      tail.push(other);
    }
    for (const b of tail) {
      if (b === other) continue;
      other.items.push(...b.items);
    }
    buckets.length = 0;
    buckets.push(...head, other);
  }
  for (const b of buckets) b.items.sort((x, y) => y.importance - x.importance || y.freq - x.freq);

  /* --- 2. 层级化：分支 → 主干要点 →（详尽档）子项 --- */
  const relationChildren = new Map();
  if (g.depth >= 3) {
    for (const r of corpus?.relations || []) {
      if (r.type !== "include" && r.type !== "compose" && r.type !== "isa") continue;
      if (!relationChildren.has(r.source)) relationChildren.set(r.source, []);
      const arr = relationChildren.get(r.source);
      if (!arr.includes(r.target)) arr.push(r.target);
    }
  }

  const rootTitle =
    (extractions || []).length === 1
      ? (extractions[0].materialTitle || extractions[0].materialId || "知识结构")
      : `全部素材 · ${(extractions || []).length} 份`;

  let seq = 0;
  const root = {
    key: "__root__",
    kind: "root",
    label: rootTitle,
    sub: `${cards.length} 个知识点 · ${buckets.length} 个分区`,
    children: [],
    color: "#4f46e5",
    depth: 0
  };

  buckets.forEach((b, bi) => {
    const items = b.items;
    const isMinor = (c) =>
      (c.importance || 0) < MINOR_THRESHOLD && !c.definition && (c.freq || 0) <= 1;

    let main = items;
    let minor = [];
    if (!keepAll && g.showMinor !== true) {
      main = items.filter((c) => !isMinor(c));
      minor = items.filter((c) => isMinor(c));
    }
    const capped = main.slice(0, g.perBranch);
    const restCount = main.length - capped.length + (g.showMinor === false ? minor.length : 0);
    const foldedMinor = g.showMinor === "fold" ? minor : [];

    const branch = {
      key: `b${bi}`,
      kind: "branch",
      label: b.title,
      sub: `${items.length} 项`,
      color: b.muted ? "#94a3b8" : BRANCH_PALETTE[bi % BRANCH_PALETTE.length],
      muted: !!b.muted,
      bucketKey: b.key,
      children: [],
      depth: 1
    };

    for (const c of capped) {
      const leaf = {
        key: `l${seq++}`,
        kind: "leaf",
        label: c.term,
        term: c.term,
        card: c,
        type: c.type,
        color: TYPE_COLOR[c.type] || "#64748b",
        hasDef: !!c.definition,
        importance: c.importance || 0,
        level: c.level || "了解",
        freq: c.freq || 0,
        children: [],
        depth: 2
      };
      if (g.depth >= 3) {
        const subs = (relationChildren.get(c.term) || []).slice(0, 4);
        for (const t of subs) {
          const subCard = corpus.cardByTerm?.get(t);
          leaf.children.push({
            key: `s${seq++}`,
            kind: "leaf",
            label: t,
            term: t,
            card: subCard || null,
            type: subCard?.type || "term",
            color: TYPE_COLOR[subCard?.type] || "#94a3b8",
            hasDef: !!subCard?.definition,
            importance: subCard?.importance || 0,
            level: subCard?.level || "了解",
            freq: subCard?.freq || 0,
            children: [],
            depth: 3,
            isSub: true
          });
        }
      }
      branch.children.push(leaf);
    }

    if (foldedMinor.length || restCount > 0) {
      const hidden = foldedMinor.length ? foldedMinor : [];
      branch.children.push({
        key: `m${seq++}`,
        kind: "more",
        label: `+${hidden.length || restCount} 项次要要点`,
        sub: hidden.length ? hidden.map((c) => c.term).join("、") : "提高「粒度」可展开",
        color: "#94a3b8",
        children: [],
        hiddenCards: hidden,
        restCount,
        depth: 2
      });
    }

    root.children.push(branch);
  });

  return {
    root,
    mode,
    granularity: opts.granularity || 2,
    keyword,
    stats: {
      total: (corpus?.cards || []).length,
      shown: cards.length,
      branches: buckets.length
    }
  };
}

/* ------------------------------------------------------------------ */
/* 布局：中心在左，向右展开                                             */
/* ------------------------------------------------------------------ */

const LAYOUT = {
  padX: 16,
  padY: 14,
  colGap: 78,
  vGap: 10,
  branchGap: 16,
  maxW: { 0: 210, 1: 206, 2: 176, 3: 152 },
  font: { 0: 15, 1: 13.5, 2: 13, 3: 12 },
  h: { 0: 46, 1: 34, 2: 30, 3: 26 }
};

export function layoutMindMap(tree, opts = {}) {
  const collapsed = opts.collapsed || new Set();
  const root = tree.root;
  const maxW = LAYOUT.maxW;

  // 预计算列起点
  const colX = [];
  let x = LAYOUT.padX;
  for (let d = 0; d < 4; d++) {
    colX[d] = x;
    x += maxW[d] + LAYOUT.colGap;
  }

  let cursorY = LAYOUT.padY;
  let maxDepth = 0;

  function place(node, depth) {
    if (depth > maxDepth) maxDepth = depth;
    const fs = LAYOUT.font[Math.min(depth, 3)];
    const h = LAYOUT.h[Math.min(depth, 3)];
    const label = node.label || "";
    const badge = depth === 1 && node.sub ? ` ${node.sub}` : "";
    const pad = 30;
    const slack = 4; // 宽度余量，保证「未触及上限」时绝不会被误截断
    const w = Math.min(
      maxW[Math.min(depth, 3)],
      Math.max(70, measureText(label, fs) + measureText(badge, fs - 2) + pad + slack + (depth >= 2 ? 8 : 0))
    );
    node.depth = depth;
    node.x = colX[Math.min(depth, 3)];
    node.w = w;
    node.h = h;
    node.fs = fs;
    node.badge = badge.trim();
    node.text = ellipsis(label, fs, w - pad - measureText(badge, fs - 2));
    node.isCollapsed = collapsed.has(node.key);

    const kids = node.children || [];
    if (!kids.length || node.isCollapsed) {
      node.y = cursorY + h / 2;
      cursorY += h + LAYOUT.vGap;
      node.top = node.y - h / 2;
      node.bottom = node.y + h / 2;
      return;
    }
    const startTop = cursorY;
    for (const k of kids) place(k, depth + 1);
    let endBottom = cursorY - LAYOUT.vGap;
    if (depth === 0) endBottom = cursorY - LAYOUT.vGap;
    node.y = (startTop + endBottom) / 2;
    node.top = Math.min(node.y - h / 2, startTop);
    node.bottom = Math.max(node.y + h / 2, endBottom);
    cursorY = node.bottom + (depth === 0 ? LAYOUT.vGap : LAYOUT.branchGap);
  }

  place(root, 0);

  const d = Math.min(maxDepth, 3);
  const width = colX[d] + maxW[d] + LAYOUT.padX;
  const height = Math.max(220, cursorY + LAYOUT.padY);
  return { root, width, height, depth: maxDepth };
}

/* ------------------------------------------------------------------ */
/* 渲染 SVG                                                            */
/* ------------------------------------------------------------------ */

function nodeFill(node) {
  if (node.kind === "root") return "var(--primary)";
  if (node.kind === "branch") return "var(--surface-2)";
  if (node.kind === "more") return "var(--surface-2)";
  return node.hasDef ? "var(--surface)" : "var(--surface-2)";
}

function renderNode(node, keyword) {
  const x = node.x;
  const y = node.y - node.h / 2;
  const w = node.w;
  const h = node.h;
  const fs = node.fs;
  const hit = keyword && node.kind === "leaf" && node.label.includes(keyword);
  const cls = ["mm-node", `mm-${node.kind}`];
  if (node.kind === "leaf") cls.push(`mm-t-${node.type}`);
  if (node.kind === "leaf" && node.hasDef) cls.push("mm-hasdef");
  if (hit) cls.push("mm-hit");
  if (node.muted) cls.push("mm-muted");
  if (node.isCollapsed && node.children.length) cls.push("mm-folded");
  const clickable = node.children.length > 0 || node.kind === "leaf" || node.kind === "more";
  if (clickable) cls.push("mm-click");

  const attrs = [
    `class="${cls.join(" ")}"`,
    `data-key="${esc(node.key)}"`,
    clickable ? `data-role="${node.children.length ? "toggle" : node.kind === "more" ? "more" : "leaf"}"` : "",
    node.kind === "leaf" ? `data-term="${esc(node.term)}"` : "",
    clickable ? 'tabindex="0"' : ""
  ]
    .filter(Boolean)
    .join(" ");

  let inner = "";
  // 悬停显示完整文本（被截断时很有用）
  const tipText =
    node.kind === "leaf"
      ? `${node.label}${node.hasDef ? "" : "（素材中无明确定义）"} · ${node.level} ${node.importance}`
      : node.label + (node.sub ? ` · ${node.sub}` : "");
  inner += `<title>${esc(tipText)}</title>`;
  // 类型色条
  if (node.kind === "leaf") {
    inner += `<rect class="mm-bar" x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${node.color}"></rect>`;
  } else if (node.kind === "branch") {
    inner += `<rect class="mm-bar" x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${node.color}"></rect>`;
  }
  inner += `<rect class="mm-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${node.kind === "root" ? 12 : 8}" fill="${nodeFill(node)}"></rect>`;

  // 文本
  const tx = x + (node.kind === "leaf" || node.kind === "branch" ? 12 : 14);
  const ty = node.kind === "root" && node.sub ? y + h / 2 - 6 : y + h / 2 + fs * 0.35;
  const fill = node.kind === "root" ? "#fff" : "var(--text)";
  inner += `<text class="mm-text" x="${tx}" y="${ty}" font-size="${fs}" fill="${fill}">${esc(node.text)}</text>`;

  if (node.kind === "root" && node.sub) {
    inner += `<text class="mm-sub" x="${tx}" y="${y + h / 2 + 13}" font-size="10.5" fill="rgba(255,255,255,.82)">${esc(node.sub)}</text>`;
  } else if (node.badge && node.kind === "branch") {
    inner += `<text class="mm-badge" x="${x + w - 8}" y="${y + h / 2 + 4}" font-size="10" text-anchor="end" fill="var(--muted)">${esc(node.badge)}</text>`;
  }

  // 重要度徽标（核心/重要）
  if (node.kind === "leaf" && !node.isSub && (node.level === "核心" || node.level === "重要")) {
    inner += `<circle cx="${x + w - 9}" cy="${y + h / 2}" r="3" fill="${node.level === "核心" ? "#ef4444" : "#f59e0b"}"></circle>`;
  }
  // 折叠指示
  if (node.children.length) {
    const cx = x + w + 9;
    inner += `<circle class="mm-dot" cx="${cx}" cy="${node.y}" r="7.5" fill="var(--surface)" stroke="${node.color}" stroke-width="1.2"></circle>`;
    inner += `<text class="mm-toggle" x="${cx}" y="${node.y + 3.6}" font-size="10" text-anchor="middle" fill="${node.color}">${node.isCollapsed ? "+" : "−"}</text>`;
  }

  return `<g ${attrs}>${inner}</g>`;
}

function renderLink(parent, child) {
  const px = parent.x + parent.w;
  const py = parent.y;
  const cx = child.x;
  const cy = child.y;
  const dx = Math.max(18, (cx - px) * 0.5);
  const color = child.kind === "more" ? "#cbd5e1" : child.color || parent.color;
  const width = child.kind === "branch" ? 1.8 : child.isSub ? 0.9 : 1.2;
  const op = child.kind === "more" ? 0.75 : child.isSub ? 0.5 : 0.85;
  return `<path class="mm-link" d="M${px} ${py} C${px + dx} ${py}, ${cx - dx} ${cy}, ${cx} ${cy}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${op}"></path>`;
}

export function renderMindMap(tree, opts = {}) {
  const keyword = (opts.keyword || tree.keyword || "").trim();
  const flat = [];
  (function walk(n) {
    flat.push(n);
    if (!n.isCollapsed) (n.children || []).forEach(walk);
  })(tree.root);

  let links = "";
  let nodes = "";
  for (const n of flat) {
    for (const c of n.children || []) {
      if (n.isCollapsed) continue;
      links += renderLink(n, c);
    }
    nodes += renderNode(n, keyword);
  }
  // 连线画在节点下层
  const svg = `<svg class="mind-svg" viewBox="0 0 ${tree.width} ${tree.height}" width="${tree.width}" height="${tree.height}" role="img" aria-label="知识思维导图">
    <g class="mm-links">${links}</g>
    <g class="mm-nodes">${nodes}</g>
  </svg>`;
  return svg;
}

/** 图例：说明颜色/形状差异 */
export function renderLegend() {
  const types = Object.keys(TYPE_COLOR)
    .map((t) => `<span class="lg-item"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</span>`)
    .join("");
  return `<div class="mind-legend">
    <span class="lg-title">图例</span>
    ${types}
    <span class="lg-item"><i class="lg-solid"></i>有明确定义</span>
    <span class="lg-item"><i class="lg-dash"></i>仅有上下文</span>
    <span class="lg-item"><i class="lg-dot lg-red"></i>核心</span>
    <span class="lg-item"><i class="lg-dot lg-amber"></i>重要</span>
    <span class="lg-tip">点击「＋/−」折叠展开分支，点击要点查看释义并追问</span>
  </div>`;
}
