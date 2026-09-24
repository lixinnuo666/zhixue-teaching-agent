/**
 * 智学 · 多模态教学智能体 —— 应用主控
 * 流程：素材输入 → 图文解析 → 知识点抽取 → 知识图谱 → 答疑辅导 → 练习测评 → 学习报告
 */

import { extractKnowledge } from "./nlp/extract.js";
import { buildCorpus, ask, suggestQuestions, mdToHtml } from "./nlp/qa.js";
import { generateQuiz, grade } from "./nlp/quiz.js";
import { analyzeImage, ocrImage, createSamplePage } from "./image/imageAnalyzer.js";
import { SAMPLES } from "./data/samples.js";
import { store, exportMarkdown } from "./store.js";
import { buildMindMap, layoutMindMap, renderMindMap, renderLegend } from "./ui/mindmap.js";
import { CATEGORIES, getCategory, classifyMaterial, suggestTags } from "./nlp/classify.js";
import { kb, kbExportMarkdown } from "./data/kb.js";

const $ = (id) => document.getElementById(id);
const els = {};
[
  "engineChip", "btnSamples", "btnExport", "btnTheme",
  "dropzone", "btnPickImage", "btnPasteText", "fileInput", "pasteBox", "pasteArea",
  "btnCancelPaste", "btnSubmitPaste",
  "materialList", "materialEmpty", "btnClearAll",
  "matSearch", "matCatFilter", "matSort", "btnSaveAllKb",
  "kbSearch", "kbCatFilter", "kbOverview", "kbCats", "kbList", "btnKbExport", "btnKbClear",
  "statMat", "statTerm", "statRel", "statQa",
  "tabs", "imageStage", "imagePlaceholder", "imagePreview", "imgSourceHint",
  "imgViewport", "imgWrap", "blockOverlay", "imgMeta", "imgToolbar",
  "btnZoomIn", "btnZoomOut", "imgZoom", "btnImgFit", "btnImg100", "btnImgRotate", "btnImgReset",
  "btnImgBlocks", "btnImgFull", "btnImgEnhance", "histCanvas", "qualityBox", "suggestBox",
  "lightbox", "lbImg", "lbBody", "lbInfo", "lbClose", "lbFit", "lb100",
  "imageMetrics", "colorBar", "btnOcr", "ocrTip",
  "textWork", "parseChips", "btnExtract", "extractLog",
  "termSearch", "termTypeFilter", "outlineBox", "formulaBox", "relationBox",
  "mindMode", "mindDepth", "mindDepthLabel", "mindBox", "mindDetail", "mindLegend",
  "btnMindExpand", "btnMindCollapse",
  "graphDepth", "btnGraphReset", "graphCanvas", "graphGroup", "graphCatFilter", "graphLegend",
  "chatWindow", "modeRow", "suggestRow", "qaInput", "btnAsk",
  "quizCount", "btnGenQuiz", "quizBox", "quizSubmitRow", "btnSubmitQuiz", "btnRedoQuiz", "quizResult",
  "masteryCanvas", "reportStats", "wrongBox", "toast"
].forEach((id) => (els[id] = $(id)));

const state = {
  materials: [],
  runtime: new Map(), // id -> {blob, blobUrl}
  extractions: new Map(),
  corpus: null,
  activeId: null,
  mode: "direct",
  chat: [],
  quiz: null,
  qaCount: 0,
  collapsedCats: new Set(), // 侧栏分类分组的折叠状态
  kbCat: "", // 知识库面板当前选中的分类
  graphGroup: "category", // 图谱分区维度：category / type / material
  graphCat: "" // 图谱当前聚焦的分区
};

/* ================= 分类与个人知识库 ================= */

function catOf(m) {
  return getCategory((m && m.category) || "general");
}

/** 判定/更新素材的学科分类；manual 为 true 表示用户手动指定过，不再自动改 */
function refreshCategory(m, force = false) {
  if (!m) return null;
  if (!force && m.categoryManual && m.category) return catOf(m);
  if (!force && m.subject) {
    const bySubject = getCategory(m.subject);
    if (bySubject.key !== "general") {
      m.category = bySubject.key;
      m.categoryAuto = false;
      return bySubject;
    }
  }
  const g = classifyMaterial({ title: m.title, text: m.text || "" });
  m.category = g.key;
  m.categoryAuto = true;
  m.categoryConfidence = g.confidence;
  return getCategory(g.key);
}

/** 把素材的知识点按分类写入个人知识库 */
function syncKbFromMaterial(mat) {
  const ex = state.extractions.get(mat.id);
  if (!ex) return { added: 0, updated: 0, skipped: 0 };
  return kb.addFromMaterial(mat, ex);
}

function fillCategorySelects() {
  const opts = CATEGORIES.map((c) => `<option value="${c.key}">${c.icon} ${c.name}</option>`).join("");
  if (els.matCatFilter && els.matCatFilter.dataset.filled !== "1") {
    els.matCatFilter.insertAdjacentHTML("beforeend", opts);
    els.matCatFilter.dataset.filled = "1";
  }
  if (els.kbCatFilter && els.kbCatFilter.dataset.filled !== "1") {
    els.kbCatFilter.insertAdjacentHTML("beforeend", opts);
    els.kbCatFilter.dataset.filled = "1";
  }
}

/* ================= 通用 UI ================= */

function toast(msg, ms = 2400) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), ms);
}

function log(msg) {
  const d = document.createElement("div");
  d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  els.extractLog.appendChild(d);
  els.extractLog.scrollTop = els.extractLog.scrollHeight;
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  if (tab === "graph") showGraph();
  if (tab === "report") renderReport();
  if (tab === "parse") {
    // 面板重新可见后视口尺寸才有效，需要重新适配与重绘
    requestAnimationFrame(() => {
      fitImg();
      applyImgView();
      drawHistogram(activeMaterial()?.analysis);
    });
  }
  if (tab === "library") renderLibrary();
}

function activeMaterial() {
  return state.materials.find((m) => m.id === state.activeId) || null;
}

/* ================= 素材管理 ================= */

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function addImageMaterial(file, title) {
  const id = makeId("img");
  const blobUrl = URL.createObjectURL(file);
  state.runtime.set(id, { blob: file, blobUrl });
  const mat = {
    id,
    title: title || file.name || "图片素材",
    subject: "图片",
    kind: "image",
    imageUrl: null,
    analysis: null,
    text: "",
    category: "",
    tags: [],
    created: Date.now()
  };
  refreshCategory(mat);
  state.materials.unshift(mat);
  state.activeId = id;
  renderMaterials();
  log(`载入图片素材：${mat.title}（${(file.size / 1024).toFixed(0)} KB）`);
  try {
    const analysis = await analyzeImage(file);
    mat.analysis = analysis;
    log(
      `视觉分析完成：${analysis.width}×${analysis.height}，${analysis.layout}，估算文字行数 ${analysis.textRows}`
    );
  } catch (e) {
    log(`视觉分析失败：${e.message}`);
  }
  renderActive();
  persist();
  // 有 OCR 引擎时自动识别一次
  if (window.Tesseract) {
    await runOcr(id, true);
  } else {
    log("未检测到 OCR 引擎（离线或 CDN 不可达），请手动粘贴文本或点击「识别图中文字」重试。");
  }
  if (!mat.text) {
    toast("图片视觉分析已完成；请点击「识别图中文字」，或手动粘贴文本后抽取知识点");
    // OCR 不可用或未识别到文字时，直接展开文本输入/粘贴区，降低使用门槛
    els.pasteBox.classList.remove("hidden");
    els.pasteArea.placeholder = "OCR 不可用时，可直接把图片中的文字粘贴到此处，将补录到当前图片素材…";
    els.pasteArea.focus();
  }
}

function addTextMaterial(text, title, kind = "text") {
  const id = makeId("txt");
  const mat = {
    id,
    title: title || `文本素材 ${new Date().toLocaleTimeString()}`,
    subject: "文本",
    kind,
    analysis: null,
    text: text.trim(),
    category: "",
    tags: [],
    created: Date.now()
  };
  refreshCategory(mat);
  state.materials.unshift(mat);
  state.activeId = id;
  renderMaterials();
  renderActive();
  extractMaterial(mat);
  persist();
}

async function addSample(sample, silent = false) {
  if (state.materials.some((m) => m.id === sample.id)) {
    if (!silent) toast("该示例已在素材库中");
    return;
  }
  const mat = {
    id: sample.id,
    title: sample.title,
    subject: sample.subject,
    kind: "sample",
    analysis: null,
    text: sample.text,
    category: "",
    tags: [],
    created: Date.now(),
    preset: true
  };
  refreshCategory(mat);
  try {
    const dataUrl = createSamplePage(sample);
    if (dataUrl.length < 260000) mat.imageUrl = dataUrl;
    const analysis = await analyzeImage(dataUrl);
    mat.analysis = analysis;
    if (!silent)
      log(`视觉分析：${analysis.layout}，估算文字行数 ${analysis.textRows}，主色 ${analysis.colors[0].hex}`);
  } catch (e) {
    log(`示例图片生成/分析失败：${e.message}`);
  }
  state.materials.push(mat);
  if (!state.activeId) state.activeId = mat.id;
  renderMaterials();
  renderActive();
  extractMaterial(mat, silent);
  persist();
}

function removeMaterial(id) {
  state.materials = state.materials.filter((m) => m.id !== id);
  state.extractions.delete(id);
  state.runtime.delete(id);
  if (state.activeId === id) state.activeId = state.materials[0]?.id || null;
  store.removeMaterial(id);
  rebuildCorpus();
  renderMaterials();
  renderActive();
  renderKnowledge();
}

function persist() {
  for (const m of state.materials) {
    const light = { ...m };
    // 缩略图是体积较大的 dataURL，不写入 localStorage（避免超出配额）
    if (light.analysis && light.analysis.thumb) {
      light.analysis = { ...light.analysis };
      delete light.analysis.thumb;
    }
    store.setMaterial(light);
  }
}

/* ================= 解析流程 ================= */

async function runOcr(id, silent = false) {
  const mat = state.materials.find((m) => m.id === id);
  if (!mat) return;
  const rt = state.runtime.get(id);
  const src = rt?.blob || mat.imageUrl;
  if (!src) {
    toast("该素材没有可用的图片数据");
    return;
  }
  if (!window.Tesseract) {
    toast("OCR 引擎未就绪：请检查网络后刷新页面，或手动粘贴文本");
    return;
  }
  els.btnOcr.disabled = true;
  els.btnOcr.textContent = "识别中…";
  log("开始 OCR 文字识别（首次需下载中文模型，约 15MB）…");
  const res = await ocrImage(src, (p, status) => {
    els.btnOcr.textContent = `识别中 ${Math.round(p * 100)}%`;
  });
  els.btnOcr.disabled = false;
  els.btnOcr.textContent = "▶ 识别图中文字";
  if (res.ok) {
    mat.text = res.text;
    els.textWork.value = res.text;
    refreshCategory(mat, true); // 拿到正文后重新判定学科
    log(`OCR 完成，识别 ${res.text.length} 字（置信度 ${res.confidence}）。`);
    toast("文字识别完成，已填入文本框");
    if (!silent) extractMaterial(mat);
    else extractMaterial(mat, true);
  } else {
    log(res.reason);
    toast("OCR 不可用，视觉分析仍已完成，可手动粘贴文本");
  }
  persist();
}

function extractMaterial(mat, silent = false) {
  if (!mat || !mat.text || mat.text.trim().length < 12) {
    if (!silent) toast("文本过短，暂时无法抽取知识点");
    return;
  }
  const t0 = performance.now();
  const ex = extractKnowledge({ id: mat.id, title: mat.title, text: mat.text });
  state.extractions.set(mat.id, ex);
  const cost = Math.round(performance.now() - t0);
  log(
    `抽取完成：${ex.stats.sentences} 句 / ${ex.stats.terms} 个知识点（其中 ${ex.stats.defined} 个含定义）/ ${ex.stats.relations} 条关系，耗时 ${cost} ms`
  );
  // 有了正文后可以给出更可靠的学科判定；手动指定过的分类不动
  const before = mat.category;
  refreshCategory(mat, !!(mat.categoryAuto && !mat.categoryManual));
  mat.tags = suggestTags(ex, 4);
  // 自动按分类沉淀到个人知识库
  const kbRes = syncKbFromMaterial(mat);

  rebuildCorpus();
  renderKnowledge();
  updateStats();
  renderActive();
  renderMaterials();
  renderLibrary();
  if (!silent) {
    const cat = catOf(mat);
    const kbTip = kbRes.added || kbRes.updated ? `，已存入「${kbRes.category?.name || cat.name}」知识库` : "";
    toast(`已抽取 ${ex.stats.terms} 个知识点 · 归类为${cat.name}${kbTip}`);
  }
  if (before !== mat.category) log(`素材「${mat.title}」归类为 ${catOf(mat).name}${mat.categoryAuto ? "（自动判定）" : ""}`);
  return ex;
}

function rebuildCorpus() {
  const list = [...state.extractions.values()];
  state.corpus = list.length ? buildCorpus(list) : null;
  updateStats();
  renderSuggest();
}

function updateStats() {
  const terms = state.corpus?.cards.length || 0;
  els.statMat.textContent = state.materials.length;
  els.statTerm.textContent = terms;
  els.statRel.textContent = state.corpus?.relations.length || 0;
  els.statQa.textContent = state.qaCount;
}

/* ================= 渲染 ================= */

function renderMaterials() {
  els.materialList.innerHTML = "";
  const kw = (els.matSearch?.value || "").trim();
  const catFilter = els.matCatFilter?.value || "";
  const sort = els.matSort?.value || "cat";

  let list = state.materials.filter((m) => {
    if (catFilter && catOf(m).key !== catFilter) return false;
    if (!kw) return true;
    return (
      m.title.includes(kw) ||
      (m.text || "").includes(kw) ||
      catOf(m).name.includes(kw) ||
      (m.tags || []).some((t) => t.includes(kw))
    );
  });

  if (sort === "time") list = list.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
  else if (sort === "name") list = list.slice().sort((a, b) => a.title.localeCompare(b.title, "zh"));

  els.materialEmpty.classList.toggle("hidden", list.length > 0);
  els.materialEmpty.textContent = state.materials.length
    ? "没有匹配的素材，试试其它关键词或分类"
    : "暂无素材，先添加图片或文本 →";

  const catOptions = CATEGORIES.map(
    (c) => `<option value="${c.key}">${c.icon} ${c.name}</option>`
  ).join("");

  const buildItem = (m) => {
    const li = document.createElement("li");
    li.className = "material-item" + (m.id === state.activeId ? " active" : "");
    const rt = state.runtime.get(m.id);
    const src = rt?.blobUrl || m.imageUrl;
    const thumb = src
      ? `<img class="mat-thumb" src="${src}" alt="" />`
      : `<div class="mat-thumb txt">${m.kind === "image" ? "🖼️" : "📄"}</div>`;
    const hasEx = state.extractions.has(m.id);
    const c = catOf(m);
    const auto = m.categoryAuto && !m.categoryManual;
    const tip = auto
      ? `自动判定为「${c.name}」（置信度 ${m.categoryConfidence || 0}%），可手动改分类`
      : `分类：${c.name}`;
    const tags = (m.tags || []).slice(0, 2).map((t) => `<span class="mat-cat-chip">#${escapeHtml(t)}</span>`).join("");
    li.innerHTML = `${thumb}
      <div class="mat-meta">
        <div class="mat-title" title="${escapeAttr(m.title)}">${escapeHtml(m.title)}</div>
        <div class="mat-sub">
          <select class="mat-cat-chip${auto ? " auto" : ""}" title="${escapeAttr(tip)}" data-cat-for="${m.id}">
            ${catOptions}
          </select>
          <span>${hasEx ? state.extractions.get(m.id).stats.terms + " 个知识点" : "未抽取"}</span>
          ${tags}
        </div>
      </div>
      <div class="mat-actions">
        <button class="mat-star${m.starred ? " on" : ""}" title="收藏">★</button>
        <button class="mat-kb" title="存入个人知识库">⇪</button>
        <button class="mat-del" title="删除">✕</button>
      </div>`;
    const sel = li.querySelector("select");
    sel.value = c.key;
    sel.onchange = () => {
      m.category = sel.value;
      m.categoryManual = true;
      m.categoryAuto = false;
      toast(`已把「${m.title}」归到 ${getCategory(sel.value).name}`);
      persist();
      renderMaterials();
      if (state.extractions.has(m.id)) syncKbFromMaterial(m);
    };
    li.querySelector(".mat-star").onclick = (e) => {
      e.stopPropagation();
      m.starred = !m.starred;
      persist();
      renderMaterials();
    };
    li.querySelector(".mat-kb").onclick = (e) => {
      e.stopPropagation();
      const r = syncKbFromMaterial(m);
      if (!r.added && !r.updated) toast("该素材还没有抽取结果，请先抽取知识点");
      else toast(`已存入个人知识库 · ${r.category.name}（新增 ${r.added}，更新 ${r.updated}）`);
      renderLibrary();
    };
    li.querySelector(".mat-del").onclick = (e) => {
      e.stopPropagation();
      removeMaterial(m.id);
    };
    li.onclick = () => {
      state.activeId = m.id;
      renderMaterials();
      renderActive();
    };
    return li;
  };

  if (sort === "cat") {
    const groups = new Map();
    for (const m of list) {
      const k = catOf(m).key;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    for (const c of CATEGORIES) {
      const items = groups.get(c.key);
      if (!items || !items.length) continue;
      const collapsed = state.collapsedCats.has(c.key);
      const head = document.createElement("li");
      head.className = "mat-group";
      head.innerHTML = `<i class="cat-dot" style="background:${c.color}"></i>
        <span class="grp-name">${escapeHtml(c.name)}</span>
        <span class="grp-count">${items.length} 份</span>
        <span class="grp-fold">${collapsed ? "▸" : "▾"}</span>`;
      head.onclick = () => {
        if (state.collapsedCats.has(c.key)) state.collapsedCats.delete(c.key);
        else state.collapsedCats.add(c.key);
        renderMaterials();
      };
      els.materialList.appendChild(head);
      if (!collapsed) items.forEach((m) => els.materialList.appendChild(buildItem(m)));
    }
  } else {
    list.forEach((m) => els.materialList.appendChild(buildItem(m)));
  }
}

/* ================= 个人知识库面板 ================= */

function renderLibrary() {
  const stats = kb.stats();
  const all = kb.all();
  const total = all.length;
  const sources = new Set(all.map((e) => e.materialId).filter(Boolean)).size;
  const updated = kb.updatedAt();

  els.kbOverview.innerHTML = `
    <span><b>${total}</b>条知识点</span>
    <span><b>${stats.length}</b>个学科分类</span>
    <span><b>${sources}</b>份来源素材</span>
    <span>${updated ? "最近入库 " + new Date(updated).toLocaleString() : "尚未入库"}</span>`;

  const active = state.kbCat;
  els.kbCats.innerHTML = stats.length
    ? stats
        .map(
          (s) => `<div class="kb-cat${s.key === active ? " on" : ""}" data-cat="${s.key}">
            <div class="kc-top"><i class="cat-dot" style="background:${s.color}"></i><span>${escapeHtml(s.name)}</span></div>
            <div class="kc-num">${s.count}</div>
            <div class="kc-sub">${s.materials} 份素材 · 平均重要度 ${s.avgImportance}</div>
          </div>`
        )
        .join("")
    : `<p class="micro">知识库还没有内容。解析素材后会自动按学科入库，也可点击侧栏「全部素材存入知识库」。</p>`;

  els.kbCats.querySelectorAll(".kb-cat").forEach((el) => {
    el.onclick = () => {
      state.kbCat = state.kbCat === el.dataset.cat ? "" : el.dataset.cat;
      els.kbCatFilter.value = state.kbCat;
      renderLibrary();
    };
  });

  const kw = (els.kbSearch?.value || "").trim();
  const list = kb.search({ keyword: kw, category: active });
  if (!list.length) {
    els.kbList.innerHTML = `<p class="micro">${
      total ? "没有匹配的知识点。" : "知识库为空，先去「图文解析」抽取知识点吧。"
    }</p>`;
    return;
  }
  const byCat = new Map();
  for (const e of list) {
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category).push(e);
  }
  let html = "";
  for (const c of CATEGORIES) {
    const items = byCat.get(c.key);
    if (!items || !items.length) continue;
    html += `<div class="kb-group-title"><i class="cat-dot" style="background:${c.color}"></i>${escapeHtml(c.name)} · ${items.length} 条</div>`;
    for (const e of items) {
      html += `<div class="kb-entry" data-id="${escapeAttr(e.id)}">
        <div class="ke-main">
          <div class="ke-term">${escapeHtml(e.term)} <span class="mat-cat-chip">${escapeHtml(e.level)} ${e.importance}</span></div>
          <div class="ke-def">${escapeHtml(e.definition || e.sentence || "（素材中未给出明确定义）")}</div>
          <div class="ke-src">来源：${escapeHtml(e.materialTitle || "—")}</div>
        </div>
        <button class="ke-del" title="移出知识库">✕</button>
      </div>`;
    }
  }
  els.kbList.innerHTML = html;
  els.kbList.querySelectorAll(".kb-entry").forEach((el) => {
    el.querySelector(".ke-del").onclick = () => {
      kb.remove(el.dataset.id);
      renderLibrary();
      toast("已移出知识库");
    };
  });
}

function saveAllToKb() {
  let added = 0;
  let updated = 0;
  let n = 0;
  for (const m of state.materials) {
    if (!state.extractions.has(m.id)) continue;
    const r = syncKbFromMaterial(m);
    added += r.added || 0;
    updated += r.updated || 0;
    n++;
  }
  if (!n) {
    toast("还没有已抽取的素材，请先解析并抽取知识点");
    return;
  }
  toast(`已把 ${n} 份素材存入个人知识库（新增 ${added}，更新 ${updated}）`);
  renderLibrary();
}

function renderActive() {
  const m = activeMaterial();
  renderMaterialsListState();
  if (!m) {
    showImageViewport(false);
    els.textWork.value = "";
    els.imageMetrics.innerHTML = "";
    els.colorBar.innerHTML = "";
    els.parseChips.innerHTML = "";
    els.imgSourceHint.textContent = "";
    els.imgMeta.innerHTML = "";
    renderQuality(null);
    drawHistogram(null);
    return;
  }
  const rt = state.runtime.get(m.id);
  const src = rt?.blobUrl || m.imageUrl;
  if (src) {
    if (els.imagePreview.getAttribute("src") !== src) {
      els.imagePreview.src = src;
      resetImgView(true);
    }
    showImageViewport(true);
    els.imagePreview.onload = () => {
      fitImg();
      applyImgView();
      drawBlockOverlay();
    };
    if (els.imagePreview.complete && els.imagePreview.naturalWidth) fitImg();
  } else {
    showImageViewport(false);
    els.imagePlaceholder.textContent = m.kind === "image" ? "图片数据已释放，文本内容仍可用" : "纯文本素材";
  }
  els.imgSourceHint.textContent = m.preset ? "内置示例（已预置标准文本）" : m.kind === "image" ? "" : "文本素材";
  els.textWork.value = m.text || "";
  els.btnOcr.classList.toggle("hidden", m.kind !== "image" || !src);
  renderImgMeta(m, m.analysis);

  const a = m.analysis;
  if (a) {
    const metrics = [
      ["尺寸", `${a.width}×${a.height}`],
      ["版面判断", a.layout],
      ["估算文字行", `${a.textRows} 行`],
      ["平均亮度", a.brightness],
      ["对比度", a.contrast],
      ["文字占比", `${a.inkRatio}%`],
      ["边缘密度", `${a.edgeDensity}%`],
      ["清晰度", `${a.sharpness}（${a.sharpnessLabel}）`],
      ["倾斜角", `${a.skew}°`],
      ["分栏数", `${a.columns} 栏`],
      ["饱和度", `${a.saturation}（${a.warmthLabel}）`],
      ["文字区块", `${(a.textBlocks || []).length} 块`],
      ["颜色数", a.colorCount],
      ["宽高比", a.ratio]
    ];
    els.imageMetrics.innerHTML = metrics
      .map(([k, v]) => `<div class="metric"><span>${k}</span><b>${escapeHtml(String(v))}</b></div>`)
      .join("");
    els.colorBar.innerHTML = a.colors
      .map((c) => `<i style="width:${Math.max(3, c.ratio * 100)}%;background:${c.hex}" title="${c.hex} ${Math.round(
        c.ratio * 100
      )}%"></i>`)
      .join("");
    renderQuality(a);
    drawHistogram(a);
    drawBlockOverlay();
  } else {
    els.imageMetrics.innerHTML = "";
    els.colorBar.innerHTML = "";
    renderQuality(null);
    drawHistogram(null);
  }

  const ex = state.extractions.get(m.id);
  els.parseChips.innerHTML = "";
  const chips = [];
  chips.push(["素材已就绪", m.text ? "ok" : "warn"]);
  if (ex) chips.push([`${ex.stats.terms} 个知识点`, "ok"], [`${ex.stats.defined} 条定义`, "ok"], [`${ex.stats.formulas} 项公式/数据`, "ok"]);
  else chips.push(["尚未抽取知识点", "warn"]);
  if (m.analysis) chips.push([m.analysis.layout, ""]);
  els.parseChips.innerHTML = chips.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join("");
}

function renderMaterialsListState() {
  els.btnExport.disabled = !state.materials.length;
}

/* 图像预览视图状态：缩放 / 平移 / 旋转 / 是否标注文字区 */
const imgView = { scale: 1, base: 1, tx: 0, ty: 0, rot: 0, blocks: false };

function showImageViewport(on) {
  if (els.imgViewport) els.imgViewport.hidden = !on;
  if (els.imagePlaceholder) els.imagePlaceholder.hidden = on;
  if (els.imgToolbar) els.imgToolbar.style.display = on ? "" : "none";
}

function applyImgView() {
  const w = els.imgWrap;
  if (!w) return;
  w.style.transform = `translate(${imgView.tx}px, ${imgView.ty}px) rotate(${imgView.rot}deg) scale(${imgView.scale})`;
  if (els.imgZoom) els.imgZoom.textContent = `${Math.round(imgView.scale * imgView.base * 100)}%`;
}

function resetImgView(fit = true) {
  imgView.tx = 0;
  imgView.ty = 0;
  imgView.rot = 0;
  imgView.scale = 1;
  if (fit) fitImg();
  applyImgView();
}

/** 让图片按布局尺寸适应视口（后续缩放都基于这个基准） */
function fitImg() {
  const img = els.imagePreview;
  const vp = els.imgViewport;
  if (!img || !vp || !img.naturalWidth) return;
  // 面板隐藏时 clientWidth 为 0，这里兜底用默认视口尺寸
  const vw = Math.max(160, vp.clientWidth || 420);
  const vh = Math.max(140, vp.clientHeight || 300);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const k = Math.min(vw / nw, vh / nh, 1);
  imgView.base = k;
  img.style.width = `${Math.round(nw * k)}px`;
  img.style.height = `${Math.round(nh * k)}px`;
  drawBlockOverlay();
}

function zoomImg(factor, origin) {
  const prev = imgView.scale;
  imgView.scale = Math.min(8, Math.max(0.15, prev * factor));
  if (origin) {
    // 以视口中心为锚点做补偿位移，缩放手感更自然
    const vp = els.imgViewport;
    const cx = origin.x - (vp.clientWidth || 0) / 2;
    const cy = origin.y - (vp.clientHeight || 0) / 2;
    const r = imgView.scale / prev;
    imgView.tx = cx - (cx - imgView.tx) * r;
    imgView.ty = cy - (cy - imgView.ty) * r;
  }
  applyImgView();
}

/** 在预览图上叠加检测到的文字行区域 */
function drawBlockOverlay() {
  const cv = els.blockOverlay;
  const m = activeMaterial();
  const img = els.imagePreview;
  if (!cv || !img) return;
  const w = img.clientWidth || 0;
  const h = img.clientHeight || 0;
  if (!w || !h) {
    cv.width = 0;
    cv.height = 0;
    return;
  }
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  if (!imgView.blocks || !m || !m.analysis || !m.analysis.textBlocks || !img.naturalWidth) return;
  const kx = w / img.naturalWidth;
  const ky = h / img.naturalHeight;
  ctx.lineWidth = 1.5;
  m.analysis.textBlocks.forEach((b, i) => {
    ctx.strokeStyle = i % 2 ? "rgba(79,70,229,.85)" : "rgba(22,163,74,.85)";
    ctx.fillStyle = i % 2 ? "rgba(79,70,229,.12)" : "rgba(22,163,74,.12)";
    const x = b.x * kx;
    const y = b.y * ky;
    const bw = b.w * kx;
    const bh = b.h * ky;
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeRect(x, y, bw, bh);
  });
}

/** 亮度直方图 + 行投影叠加（行投影用折线表示文字行密集处） */
function drawHistogram(analysis) {
  const cv = els.histCanvas;
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 360;
  const h = 70;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!analysis || !analysis.histogram) return;
  const bins = analysis.histogram;
  const max = analysis.histMax || Math.max(1, ...bins);
  const bw = w / bins.length;
  for (let i = 0; i < bins.length; i++) {
    const v = bins[i] / max;
    const bh = Math.max(1, v * (h - 8));
    const g = ctx.createLinearGradient(0, h - bh, 0, h);
    const t = i / (bins.length - 1);
    g.addColorStop(0, `rgba(79,70,229,${0.35 + t * 0.5})`);
    g.addColorStop(1, `rgba(79,70,229,0.12)`);
    ctx.fillStyle = g;
    ctx.fillRect(i * bw + 0.6, h - bh, bw - 1.2, bh);
  }
  // 行投影折线：反映文字行在纵向的分布
  if (analysis.rowProfile && analysis.rowProfile.length) {
    const p = analysis.rowProfile;
    const pm = Math.max(0.05, ...p);
    ctx.beginPath();
    for (let i = 0; i < p.length; i++) {
      const x = (i / (p.length - 1)) * w;
      const y = h - (p[i] / pm) * (h - 10) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(239,68,68,.55)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.strokeStyle = "var(--border)";
  ctx.strokeStyle = "rgba(148,163,184,.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();
}

function renderQuality(analysis) {
  if (!analysis || typeof analysis.quality !== "number") {
    els.qualityBox.innerHTML = "";
    els.suggestBox.innerHTML = "";
    return;
  }
  const q = analysis.quality;
  const color = q >= 78 ? "var(--green)" : q >= 58 ? "var(--primary)" : q >= 38 ? "var(--amber)" : "var(--red)";
  els.qualityBox.innerHTML = `
    <span class="q-score">
      <span class="q-ring" style="background:${color}">${q}</span>
      <span class="q-label">图像质量 ${analysis.qualityLabel}</span>
    </span>
    <span class="q-ocr">${escapeHtml(analysis.ocrHint || "")}</span>`;
  const list = analysis.suggestions || [];
  els.suggestBox.innerHTML = list
    .map(
      (s) =>
        `<div class="suggest-item${s.startsWith("图像质量良好") ? " ok" : ""}">${escapeHtml(s)}</div>`
    )
    .join("");
}

function renderImgMeta(m, a) {
  if (!m) {
    els.imgMeta.innerHTML = "";
    return;
  }
  const rt = state.runtime.get(m.id);
  const blob = rt?.blob;
  const kb = blob ? `${(blob.size / 1024).toFixed(0)} KB` : a && a.bytes ? `${(a.bytes / 1024).toFixed(0)} KB` : "—";
  const parts = [`<span>文件 <b>${escapeHtml(m.title)}</b></span>`];
  if (a) parts.push(`<span>尺寸 <b>${a.width}×${a.height}</b></span>`);
  if (a && a.ratio) parts.push(`<span>宽高比 <b>${a.ratio}</b></span>`);
  parts.push(`<span>大小 <b>${kb}</b></span>`);
  if (blob && blob.type) parts.push(`<span>格式 <b>${escapeHtml(blob.type.replace("image/", "").toUpperCase())}</b></span>`);
  if (a) parts.push(`<span>版面 <b>${escapeHtml(a.layout)}</b></span>`);
  els.imgMeta.innerHTML = parts.join("");
}

/* 思维导图的折叠状态与当前选中项 */
const mindState = { collapsed: new Set(), selected: null };

function renderKnowledge() {
  if (!state.corpus) {
    els.mindBox.innerHTML = `<p class="micro">暂无知识点，请先完成解析与抽取。</p>`;
    els.mindDetail.innerHTML = `<div class="md-empty">完成素材解析与知识点抽取后，这里会以思维导图的形式呈现知识结构。</div>`;
    els.mindLegend.innerHTML = "";
    els.outlineBox.innerHTML = "";
    els.formulaBox.innerHTML = "";
    els.relationBox.innerHTML = "";
    return;
  }

  // 清理失效的选中项
  if (mindState.selected && !state.corpus.cardByTerm?.has(mindState.selected)) mindState.selected = null;

  renderMind();
  renderOutline();
  renderFormula();
  renderRelations();
  restartGraph();
}

function renderMind() {
  const exList = [...state.extractions.values()];
  const granularity = +els.mindDepth.value || 2;
  const tree = buildMindMap(state.corpus, exList, {
    mode: els.mindMode.value,
    granularity,
    keyword: els.termSearch.value,
    type: els.termTypeFilter.value
  });
  const laid = layoutMindMap(tree, { collapsed: mindState.collapsed });
  renderMind._last = laid;
  els.mindBox.innerHTML = renderMindMap(laid, { keyword: tree.keyword });
  els.mindLegend.innerHTML = renderLegend();
  bindMindEvents();
  renderMindDetail(mindState.selected);
}

function bindMindEvents() {
  els.mindBox.querySelectorAll("[data-role]").forEach((g) => {
    g.onclick = () => {
      const key = g.dataset.key;
      const role = g.dataset.role;
      if (role === "toggle") {
        if (mindState.collapsed.has(key)) mindState.collapsed.delete(key);
        else mindState.collapsed.add(key);
        renderMind();
      } else if (role === "more") {
        // 「+N 项次要要点」→ 提高粒度以展开
        if (+els.mindDepth.value < 3) {
          els.mindDepth.value = "3";
          syncGrainLabel();
          renderMind();
          toast("已切换到「详尽」粒度，展示全部要点");
        }
      } else if (role === "leaf") {
        mindState.selected = g.dataset.term;
        renderMind();
        const c = state.corpus.cardByTerm?.get(g.dataset.term);
        if (c) showCardActions(c);
      }
    };
    g.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        g.click();
      }
    };
  });
}

function syncGrainLabel() {
  els.mindDepthLabel.textContent = { 1: "精简", 2: "标准", 3: "详尽" }[+els.mindDepth.value] || "标准";
}

function renderMindDetail(term) {
  const box = els.mindDetail;
  if (!term) {
    box.innerHTML = `<div class="md-empty">
      <b>点击导图中的任一要点</b>，这里会显示它的定义、出处与关联。<br>
      · 左侧色条 = 知识点类型<br>
      · 实线框 = 素材中有明确定义，虚线框 = 仅出现于上下文<br>
      · 红点 = 核心，橙点 = 重要<br>
      · 点击分支上的「＋/−」可折叠展开
    </div>`;
    return;
  }
  const c = state.corpus.cardByTerm?.get(term);
  if (!c) {
    box.innerHTML = `<div class="md-empty">未找到「${escapeHtml(term)}」的详细信息。</div>`;
    return;
  }
  const color = TYPE_COLOR[c.type] || "#94a3b8";
  const rels = (state.corpus.relations || [])
    .filter((r) => r.source === c.term || r.target === c.term)
    .slice(0, 6);
  const examples = (c.examples || []).slice(0, 2);
  box.innerHTML = `
    <div class="md-head">
      <span class="md-term">${escapeHtml(c.term)}</span>
      <span class="md-type" style="background:${color}">${typeLabel(c.type)}</span>
      <span class="md-level">${c.level} ${c.importance}</span>
    </div>
    <div class="md-meta">
      <span class="tag">出现 ${c.freq} 次</span>
      ${c.definition ? `<span class="tag">有定义</span>` : `<span class="tag">仅上下文</span>`}
      <span class="tag">${escapeHtml(c.materialTitle || "")}</span>
    </div>
    <div class="md-sec">
      <h5>定义 / 释义</h5>
      <div class="md-def">${escapeHtml(c.definition || c.defSentence || "素材中未给出明确定义，可结合上下文理解。")}</div>
    </div>
    ${c.primarySentence ? `<div class="md-sec"><h5>原文出处</h5><div class="md-sent">${escapeHtml(c.primarySentence)}</div></div>` : ""}
    ${examples.length ? `<div class="md-sec"><h5>举例</h5><div class="md-sent">${examples.map((s) => escapeHtml(s)).join("<br>")}</div></div>` : ""}
    ${rels.length ? `<div class="md-sec"><h5>关联关系</h5><div class="md-sent">${rels
      .map(
        (r) =>
          `<div><b>${escapeHtml(r.source)}</b> —<span class="tag">${escapeHtml(r.label)}</span>→ <b>${escapeHtml(
            r.target
          )}</b></div>`
      )
      .join("")}</div></div>` : ""}
    <div class="md-actions">
      <button class="btn sm primary" data-mdask="什么是${escapeAttr(c.term)}？">提问</button>
      <button class="btn sm ghost" data-mdask="请分步讲解${escapeAttr(c.term)}">分步讲解</button>
      <button class="btn sm ghost" data-mdask="请举一个${escapeAttr(c.term)}的例子">举例说明</button>
    </div>`;
  box.querySelectorAll("[data-mdask]").forEach((b) => {
    b.onclick = () => {
      switchTab("qa");
      els.qaInput.value = b.dataset.mdask;
      handleAsk();
    };
  });
}

function showCardActions() {
  /* 选中后焦点保持在详情区，便于直接点提问按钮 */
  const btn = els.mindDetail.querySelector(".md-actions button");
  if (btn && typeof btn.scrollIntoView === "function") btn.scrollIntoView({ block: "nearest" });
}

function renderOutline() {
  const outlines = [];
  for (const [id, ex] of state.extractions) {
    if (!ex.outline.length) continue;
    outlines.push(
      `<div class="outline-item" style="padding-left:0;font-weight:600">📘 ${escapeHtml(
        state.materials.find((m) => m.id === id)?.title || id
      )}</div>` +
        ex.outline
          .map(
            (o) =>
              `<div class="outline-item"><span class="lv">${escapeHtml(o.mark)}</span>${escapeHtml(o.text)}</div>`
          )
          .join("")
    );
  }
  els.outlineBox.innerHTML = outlines.join("") || `<p class="micro">未检测到章节标题。</p>`;
}

function renderFormula() {
  const formulas = new Set();
  for (const ex of state.extractions.values()) ex.formulas.forEach((f) => formulas.add(f));
  els.formulaBox.innerHTML = formulas.size
    ? `<ul>${[...formulas].slice(0, 30).map((f) => `<li class="formula">${escapeHtml(f)}</li>`).join("")}</ul>`
    : `<p class="micro">未检测到公式或计量数据。</p>`;
}

function renderRelations() {
  const rels = (state.corpus.relations || []).filter((r) => r.type !== "cooccur").slice(0, 30);
  els.relationBox.innerHTML = rels.length
    ? `<ul>${rels
        .map(
          (r) =>
            `<li class="rel-line"><b>${escapeHtml(r.source)}</b> —<span class="tag">${r.label}</span>→ <b>${escapeHtml(
              r.target
            )}</b></li>`
        )
        .join("")}</ul>`
    : `<p class="micro">未检测到明确的语义关系（图谱中仍会展示共现关系）。</p>`;
}

function typeLabel(t) {
  return { concept: "核心概念", fact: "事实数据", person: "人物/名词", term: "术语" }[t] || "术语";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

/* ================= 图谱 ================= */

const G = {
  nodes: [],
  links: [],
  ctx: null,
  k: 1,
  ox: 0,
  oy: 0,
  drag: null,
  hover: null,
  builtW: 0,
  raf: 0,
  alpha: 1,
  running: false
};

/* 物理参数：全部做上限裁剪，保证不会出现「越拖越炸」的震荡 */
const PHYS = {
  REP: 2200,       // 斥力系数
  REP_MAX: 5,      // 单对节点斥力上限
  REST: 120,       // 弹簧自然长度
  SPRING: 0.02,    // 弹簧系数
  SPRING_MAX: 8,   // 弹簧力上限
  CENTER: 0.012,   // 向心力
  DAMP: 0.86,      // 速度阻尼
  MAX_V: 12,       // 单帧最大位移速度
  MIN_ALPHA: 0.02,
  CROSS: 1.9,      // 跨分区斥力倍数（让分区彼此分开）
  CROSS_MIN: 74,   // 跨分区最小间距，靠近时额外推开
  CLUSTER: 1.5     // 节点被自己分区中心吸引的强度
};

function initGraph() {
  const c = els.graphCanvas;
  G.ctx = c.getContext("2d");

  // ---- 滚轮缩放（以光标为锚点）----
  function onWheel(e) {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const f = e.deltaY < 0 ? 1.12 : 0.89;
    const nk = Math.min(3, Math.max(0.25, G.k * f));
    G.ox = cx - ((cx - G.ox) * nk) / G.k;
    G.oy = cy - ((cy - G.oy) * nk) / G.k;
    G.k = nk;
    drawGraph();
  }

  // ---- 按下：命中节点则拖拽该节点，否则平移画布 ----
  function onDown(e) {
    const p = toGraphPos(e);
    const n = pickNode(p);
    if (n) {
      n.fixed = true;
      n.vx = 0;
      n.vy = 0;
      G.drag = { node: n, dx: n.x - p.x, dy: n.y - p.y };
      c.style.cursor = "grabbing";
    } else {
      G.drag = { pan: true, cx: e.clientX, cy: e.clientY };
      c.style.cursor = "grabbing";
    }
  }

  // ---- 移动：只更新被拖节点坐标 + 唤醒仿真，绝不重建节点 ----
  function onMove(e) {
    if (!G.drag) {
      updateHover(e);
      return;
    }
    if (G.drag.pan) {
      G.ox += e.clientX - G.drag.cx;
      G.oy += e.clientY - G.drag.cy;
      G.drag.cx = e.clientX;
      G.drag.cy = e.clientY;
      drawGraph();
      return;
    }
    const p = toGraphPos(e);
    const n = G.drag.node;
    n.x = p.x + G.drag.dx;
    n.y = p.y + G.drag.dy;
    n.vx = 0;
    n.vy = 0;
    reheat(0.3); // 邻居节点平滑跟随，不会整图重排
    drawGraph();
  }

  function onUp() {
    if (G.drag && G.drag.node) {
      G.drag.node.fixed = true; // 松手后钉住，避免回弹乱飞（双击可解除）
    }
    G.drag = null;
    c.style.cursor = "grab";
    reheat(0.15);
    drawGraph();
  }

  c.addEventListener("wheel", onWheel, { passive: false });
  c.addEventListener("mousedown", (e) => {
    e.preventDefault();
    onDown(e);
  });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  c.addEventListener("dblclick", (e) => {
    const n = pickNode(toGraphPos(e));
    if (n) {
      n.fixed = false;
      reheat(0.25);
    }
  });

  // 触屏
  c.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        onDown(e.touches[0]);
      }
    },
    { passive: false }
  );
  c.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        onMove(e.touches[0]);
      }
    },
    { passive: false }
  );
  window.addEventListener("touchend", onUp);

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => resizeCanvas()).observe(c);
  }
  window.addEventListener("resize", () => resizeCanvas());
}

/* 命中测试：容差随缩放自适应，缩小后也点得中 */
function pickNode(p) {
  let best = null;
  let bd = Infinity;
  for (const n of G.nodes) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    const tol = n.r + 8 / G.k;
    if (d < tol && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

function updateHover(e) {
  const n = pickNode(toGraphPos(e));
  if (n !== G.hover) {
    G.hover = n;
    els.graphCanvas.style.cursor = n ? "pointer" : "grab";
    if (!G.running) drawGraph();
  }
}

/* 唤醒仿真：只加热 alpha，不重建任何节点 */
function reheat(target) {
  G.alpha = Math.max(G.alpha, target == null ? 0.5 : target);
  if (!G.running) {
    G.running = true;
    G.raf = requestAnimationFrame(tick);
  }
}

function resizeCanvas() {
  const c = els.graphCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 800;
  const h = c.clientHeight || 460;
  if (c.width === Math.round(w * dpr) && c.height === Math.round(h * dpr)) return;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  if (G.ctx) G.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGraph();
}

function toGraphPos(e) {
  const r = els.graphCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left - G.ox) / G.k,
    y: (e.clientY - r.top - G.oy) / G.k
  };
}

/* 分区中心：K 个分区均匀分布在画布中环上 */
function groupCenter(i, k, W, H) {
  const cx = W / 2;
  const cy = H / 2;
  if (k <= 1) return { x: cx, y: cy };
  const rad = Math.min(W, H) * (k <= 2 ? 0.24 : 0.3);
  const ang = -Math.PI / 2 + (i / k) * Math.PI * 2;
  return { x: cx + Math.cos(ang) * rad * 1.35, y: cy + Math.sin(ang) * rad * 0.7 };
}

/* 重建拓扑。keepPos=true 时复用已有节点坐标，避免「跳变」 */
function rebuildGraph(opts) {
  const o = opts || {};
  if (!state.corpus) return;
  const depth = +els.graphDepth.value;
  const W = els.graphCanvas.clientWidth || 800;
  const H = els.graphCanvas.clientHeight || 460;
  // 按重要度取前 N 个知识点：否则后加入的素材永远进不了图，分区也就少一块
  const limit = Math.min(46, 12 + depth * 3);
  const picked = state.corpus.cards
    .slice()
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, limit);

  // 1) 先统计分区
  const meta = new Map();
  for (const c of picked) {
    const g = graphGroupOf(c);
    if (!meta.has(g.key)) meta.set(g.key, { key: g.key, name: g.name, color: g.color, count: 0 });
    meta.get(g.key).count++;
  }
  // 分区顺序固定按学科表/类型表排，避免每次重排位置跳来跳去
  const order =
    state.graphGroup === "category"
      ? CATEGORIES.map((c) => "c:" + c.key)
      : state.graphGroup === "type"
      ? Object.keys(TYPE_LABEL).map((t) => "t:" + t)
      : null;
  const groups = [...meta.values()].sort((a, b) => {
    if (order) {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      if (ia !== -1 && ib !== -1) return ia - ib;
    }
    return b.count - a.count;
  });
  G.groups = groups.map((g) => g.key);
  G.groupMeta = new Map(groups.map((g) => [g.key, g]));

  // 2) 只看某一分区时，其余节点不参与布局
  const focus = state.graphCat;
  const top = focus && G.groupMeta.has(focus) ? picked.filter((c) => graphGroupOf(c).key === focus) : picked;

  const nameSet = new Set(top.map((c) => c.term));
  const old = new Map(G.nodes.map((n) => [n.term, n]));

  G.nodes = top.map((c, i) => {
    const g = graphGroupOf(c);
    const prev = o.keepPos ? old.get(c.term) : null;
    if (prev) {
      prev.imp = c.importance;
      prev.type = c.type;
      prev.group = g.key;
      prev.color = g.color;
      prev.r = 8 + Math.sqrt(c.importance) * 1.5;
      return prev;
    }
    // 初始就撒在自己分区的中心附近，收敛更快、分区更清楚
    const gi = Math.max(0, groups.findIndex((x) => x.key === g.key));
    const ctr = groupCenter(gi, Math.max(1, groups.length), W, H);
    const ang = (i / Math.max(1, top.length)) * Math.PI * 2;
    const rad = Math.min(W, H) * 0.15;
    return {
      term: c.term,
      imp: c.importance,
      type: c.type,
      group: g.key,
      color: g.color,
      r: 8 + Math.sqrt(c.importance) * 1.5,
      x: ctr.x + Math.cos(ang) * rad + (Math.random() - 0.5) * 12,
      y: ctr.y + Math.sin(ang) * rad * 0.8 + (Math.random() - 0.5) * 12,
      vx: 0,
      vy: 0,
      fixed: false
    };
  });

  const DEG = Math.max(1, depth);
  const degMap = new Map();
  const links = [];
  const all = [...(state.corpus.relations || [])].sort((a, b) => (b.weight || 1) - (a.weight || 1));
  for (const r of all) {
    if (!nameSet.has(r.source) || !nameSet.has(r.target)) continue;
    const ds = degMap.get(r.source) || 0;
    const dt = degMap.get(r.target) || 0;
    if (ds >= DEG || dt >= DEG) continue;
    degMap.set(r.source, ds + 1);
    degMap.set(r.target, dt + 1);
    links.push({ s: r.source, t: r.target, w: r.weight || 1, type: r.type });
  }
  G.links = links;
  G.builtW = W;
  G.hover = null;
  G.alpha = o.alpha == null ? 1 : o.alpha;
  populateGraphFilter(groups);
  renderGraphLegend(groups);
  if (!G.running) {
    G.running = true;
    G.raf = requestAnimationFrame(tick);
  }
}

/* 完全重排（重置按钮 / 换素材） */
function restartGraph() {
  rebuildGraph({ keepPos: false, alpha: 1 });
}

/* 切换到图谱页时调用：尺寸没变就保留现有布局 */
function showGraph() {
  resizeCanvas();
  const W = els.graphCanvas.clientWidth || 800;
  if (!G.nodes.length || G.builtW !== W) {
    rebuildGraph({ keepPos: false });
  } else {
    reheat(0.35);
    drawGraph();
  }
  // 图例可能早于首次布局渲染，这里补一次
  if (G.groups && G.groupMeta) {
    renderGraphLegend(G.groups.map((k) => G.groupMeta.get(k)).filter(Boolean));
  }
}

function tick() {
  const nodes = G.nodes;
  const links = G.links;
  if (!nodes.length) {
    G.running = false;
    return;
  }
  const W = els.graphCanvas.clientWidth || 800;
  const H = els.graphCanvas.clientHeight || 460;
  const cx = W / 2;
  const cy = H / 2;
  const flat = W / Math.max(1, H); // 竖向收敛更快一点，铺成椭圆
  const nameIdx = new Map(nodes.map((n, i) => [n.term, i]));

  // 分区中心（每帧按当前画布尺寸算，缩放窗口也不会跑偏）
  const gKeys = G.groups || [];
  const gIdx = new Map(gKeys.map((k, i) => [k, i]));
  const centers = gKeys.map((k, i) => groupCenter(i, gKeys.length, W, H));

  // 节点间斥力：跨分区的互相推得更开，同分区保持紧凑
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = (Math.random() - 0.5) * 0.6;
        dy = (Math.random() - 0.5) * 0.6;
        d2 = dx * dx + dy * dy + 0.01;
      }
      const d = Math.sqrt(d2);
      const cross = a.group !== b.group;
      let f = Math.min(PHYS.REP_MAX, (PHYS.REP * (cross ? PHYS.CROSS : 1)) / d2);
      if (cross && d < PHYS.CROSS_MIN) f += (PHYS.CROSS_MIN - d) * 0.05;
      const ux = dx / d;
      const uy = dy / d;
      a.vx -= ux * f;
      a.vy -= uy * f;
      b.vx += ux * f;
      b.vy += uy * f;
    }
  }

  // 关系边弹簧
  for (const l of links) {
    const a = nodes[nameIdx.get(l.s)];
    const b = nodes[nameIdx.get(l.t)];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.01;
    let f = (d - PHYS.REST) * PHYS.SPRING * (0.4 + Math.min(1, l.w / 4));
    if (f > PHYS.SPRING_MAX) f = PHYS.SPRING_MAX;
    else if (f < -PHYS.SPRING_MAX) f = -PHYS.SPRING_MAX;
    const ux = dx / d;
    const uy = dy / d;
    a.vx += ux * f;
    a.vy += uy * f;
    b.vx -= ux * f;
    b.vy -= uy * f;
  }

  // 积分
  const alpha = G.alpha;
  for (const n of nodes) {
    // 主要被自己分区的中心吸引，再叠加一个弱的整体向心力防止漂移
    const gi = gIdx.get(n.group);
    const ctr = gi == null ? { x: cx, y: cy } : centers[gi];
    n.vx += (ctr.x - n.x) * PHYS.CENTER * PHYS.CLUSTER;
    n.vy += (ctr.y - n.y) * PHYS.CENTER * PHYS.CLUSTER;
    n.vx += (cx - n.x) * PHYS.CENTER * 0.45;
    n.vy += (cy - n.y) * PHYS.CENTER * 0.45 * flat;
    if (n.fixed || n === (G.drag && G.drag.node)) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= PHYS.DAMP;
    n.vy *= PHYS.DAMP;
    const v = Math.hypot(n.vx, n.vy);
    if (v > PHYS.MAX_V) {
      n.vx = (n.vx / v) * PHYS.MAX_V;
      n.vy = (n.vy / v) * PHYS.MAX_V;
    }
    n.x += n.vx * alpha;
    n.y += n.vy * alpha;
    // 兜底：不允许跑出画布太远
    if (n.x < -60) n.x = -60;
    else if (n.x > W + 60) n.x = W + 60;
    if (n.y < -60) n.y = -60;
    else if (n.y > H + 60) n.y = H + 60;
  }

  // alpha 向目标值收敛；拖拽中保持 0.3 让邻居持续跟随
  const target = G.drag && !G.drag.pan ? 0.3 : 0;
  G.alpha += (target - G.alpha) * 0.12;
  drawGraph();

  if (G.alpha < PHYS.MIN_ALPHA && !G.drag) {
    G.running = false;
    G.alpha = PHYS.MIN_ALPHA;
    return;
  }
  G.raf = requestAnimationFrame(tick);
}

const TYPE_COLOR = {
  concept: "#4f46e5",
  fact: "#0e7490",
  person: "#7c3aed",
  term: "#b45309"
};

const TYPE_LABEL = {
  concept: "核心概念",
  fact: "事实数据",
  person: "人物/名词",
  term: "术语"
};

/* 按素材分区时用的中性配色 */
const GROUP_PALETTE = ["#4f46e5", "#0e7490", "#0f766e", "#b45309", "#6d28d9", "#64748b"];

/** 按当前分区维度，算出某知识点卡片属于哪个分区 */
function graphGroupOf(c) {
  const mode = state.graphGroup || "category";
  const mat = state.materials.find((m) => m.id === c.materialId);
  if (mode === "type") {
    const key = c.type || "term";
    return { key: "t:" + key, name: TYPE_LABEL[key] || "其它", color: TYPE_COLOR[key] || "#64748b" };
  }
  if (mode === "material") {
    const key = c.materialId || "?";
    const idx = Math.max(0, state.materials.findIndex((m) => m.id === key));
    return { key: "m:" + key, name: mat ? mat.title : "未标注素材", color: GROUP_PALETTE[idx % GROUP_PALETTE.length] };
  }
  const cat = mat ? catOf(mat) : getCategory("general");
  return { key: "c:" + cat.key, name: cat.name, color: cat.color };
}

/** 刷新「只看某一分区」下拉框，选项随当前分区结果变化 */
function populateGraphFilter(groups) {
  const sel = els.graphCatFilter;
  if (!sel) return;
  const cur = state.graphCat;
  const opts = ['<option value="">全部分区</option>'].concat(
    groups.map((g) => `<option value="${escapeAttr(g.key)}">${escapeHtml(g.name)}（${g.count}）</option>`)
  );
  sel.innerHTML = opts.join("");
  sel.value = groups.some((g) => g.key === cur) ? cur : "";
  state.graphCat = sel.value;
}

/** 图谱图例：点一下只看该分区，再点取消 */
function renderGraphLegend(groups) {
  const box = els.graphLegend;
  if (!box) return;
  if (!groups.length) {
    box.innerHTML = `<span class="micro">还没有可绘制的知识点，先去「图文解析」抽取。</span>`;
    return;
  }
  box.innerHTML = groups
    .map(
      (g) => `<span class="gl-item${g.key === state.graphCat ? " on" : ""}" data-g="${escapeAttr(g.key)}">
        <i class="cat-dot" style="background:${g.color}"></i>${escapeHtml(g.name)} <b>${g.count}</b>
      </span>`
    )
    .join("");
  box.querySelectorAll(".gl-item").forEach((el) => {
    el.onclick = () => {
      state.graphCat = state.graphCat === el.dataset.g ? "" : el.dataset.g;
      restartGraph();
    };
  });
}

function drawGraph() {
  const ctx = G.ctx;
  if (!ctx) return;
  const W = els.graphCanvas.clientWidth || 800;
  const H = els.graphCanvas.clientHeight || 460;
  ctx.save();
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.translate(G.ox, G.oy);
  ctx.scale(G.k, G.k);

  const pos = new Map(G.nodes.map((n) => [n.term, n]));

  // 分区轮廓：一圈淡淡的色晕 + 虚线，标注分区名与数量
  const gKeys = G.groups || [];
  if (gKeys.length > 1) {
    for (const key of gKeys) {
      const members = G.nodes.filter((n) => n.group === key);
      if (!members.length) continue;
      let sx = 0;
      let sy = 0;
      for (const m of members) {
        sx += m.x;
        sy += m.y;
      }
      const ccx = sx / members.length;
      const ccy = sy / members.length;
      let R = 0;
      for (const m of members) R = Math.max(R, Math.hypot(m.x - ccx, m.y - ccy) + m.r);
      R = Math.min(R + 20, Math.min(W, H) * 0.42);
      const g = G.groupMeta && G.groupMeta.get(key);
      const color = (g && g.color) || "#64748b";
      ctx.beginPath();
      ctx.arc(ccx, ccy, R, 0, Math.PI * 2);
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.font = '11.5px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = color;
      ctx.fillText(`${g ? g.name : ""} · ${members.length}`, ccx, ccy - R - 7);
      ctx.globalAlpha = 1;
    }
  }

  // 边
  for (const l of G.links) {
    const a = pos.get(l.s),
      b = pos.get(l.t);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle =
      l.type === "include" || l.type === "compose" ? "rgba(22,163,74,.55)" :
      l.type === "cause" ? "rgba(239,68,68,.5)" : "rgba(120,130,180,.35)";
    ctx.lineWidth = Math.min(2.4, 0.6 + l.w * 0.35);
    ctx.stroke();
  }
  // 节点
  const dark = document.documentElement.dataset.theme === "dark";
  const dragging = G.drag && G.drag.node;
  for (const n of G.nodes) {
    const color = n.color || TYPE_COLOR[n.type] || "#64748b";
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.16 + (n.imp / 100) * 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = n === dragging || n === G.hover ? 2.4 : 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
    // 钉住的节点画一圈虚线，提示「已固定」
    if (n.fixed) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = dark ? "rgba(230,233,240,.55)" : "rgba(30,36,48,.45)";
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = dark ? "#e6e9f0" : "#1e2430";
    ctx.font = `${Math.min(15, 10 + n.r / 3)}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(n.term, n.x, n.y - n.r - 5);
  }
  // 缩放比例提示
  ctx.restore();
  ctx.save();
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  ctx.font = '12px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = "right";
  ctx.fillStyle = dark ? "rgba(230,233,240,.5)" : "rgba(30,36,48,.45)";
  ctx.fillText(`缩放 ${Math.round(G.k * 100)}%`, W - 10, H - 10);
  ctx.restore();
}

/* ================= 答疑 ================= */

function pushChat(role, text, html, extra) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = (html || escapeHtml(text).replace(/\n/g, "<br>")) + (extra || "");
  els.chatWindow.appendChild(div);
  els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
  return div;
}

function handleAsk(question) {
  const q = (question || els.qaInput.value).trim();
  if (!q) return;
  els.qaInput.value = "";
  pushChat("user", q);
  store.pushChat({ role: "user", text: q });
  if (!state.corpus) {
    const tip = "还没有可检索的知识库，请先上传/粘贴素材并点击「抽取知识点」。";
    pushChat("bot", tip);
    return;
  }
  state.qaCount++;
  updateStats();
  const res = ask(state.corpus, q, state.mode);
  const conf = Math.round((res.confidence || 0) * 100);
  let meta = `<div class="meta">置信度 ${conf}% · ${res.hits.length ? "命中知识点：" + res.hits.map((h) => escapeHtml(h.term)).join("、") : "未命中明确知识点"}`;
  if (res.refs.length) {
    meta += ` <br>来源：` + res.refs.map((r) => `<span class="cite">${escapeHtml(r.title)}·第${r.idx}句</span>`).join(" ");
  }
  meta += `</div>`;
  pushChat("bot", res.text, res.html, meta);
  store.pushChat({ role: "bot", text: res.text });
  renderSuggest(res.suggested);
}

function renderSuggest(list) {
  const items = list && list.length ? list : state.corpus ? suggestQuestions(state.corpus, "", 4) : [];
  els.suggestRow.innerHTML = items
    .map((q) => `<button class="suggest-chip">${escapeHtml(q)}</button>`)
    .join("");
  els.suggestRow.querySelectorAll(".suggest-chip").forEach((b) => {
    b.onclick = () => handleAsk(b.textContent);
  });
}

/* ================= 测验 ================= */

function renderQuiz() {
  const box = els.quizBox;
  if (!state.corpus) {
    box.innerHTML = `<p class="micro">请先完成知识点抽取。</p>`;
    els.quizSubmitRow.classList.add("hidden");
    return;
  }
  const n = +els.quizCount.value;
  state.quiz = generateQuiz(state.corpus, n);
  if (!state.quiz.length) {
    box.innerHTML = `<p class="micro">知识点数量不足，至少需要 3 个知识点才能生成试题。</p>`;
    els.quizSubmitRow.classList.add("hidden");
    return;
  }
  box.innerHTML = state.quiz
    .map((it, i) => {
      let input = "";
      if (it.type === "choice") {
        input = it.options
          .map(
            (o, oi) =>
              `<label class="opt"><input type="radio" name="q${i}" value="${escapeAttr(o)}" />${String.fromCharCode(
                65 + oi
              )}. ${escapeHtml(o)}</label>`
          )
          .join("");
      } else if (it.type === "fill") {
        input = `<input class="quiz-fill" data-i="${i}" placeholder="填写术语" />`;
      } else {
        input = `<textarea rows="3" data-i="${i}" placeholder="请简要作答…"></textarea>`;
      }
      const label = { choice: "单选", fill: "填空", short: "简答" }[it.type];
      return `<div class="quiz-item" data-i="${i}">
        <div class="quiz-q"><span class="qtype">${label}</span>${i + 1}. ${escapeHtml(it.q)}</div>
        ${input}
      </div>`;
    })
    .join("");
  els.quizSubmitRow.classList.remove("hidden");
  els.quizResult.classList.add("hidden");
}

function submitQuiz() {
  if (!state.quiz) return;
  // 避免重复提交时叠加批改结果
  els.quizBox.querySelectorAll(".verdict").forEach((n) => n.remove());
  const results = [];
  state.quiz.forEach((item, i) => {
    let ans = "";
    if (item.type === "choice") {
      const el = els.quizBox.querySelector(`input[name="q${i}"]:checked`);
      ans = el ? el.value : "";
    } else {
      const el = els.quizBox.querySelector(
        item.type === "fill" ? `input.quiz-fill[data-i="${i}"]` : `textarea[data-i="${i}"]`
      );
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) ans = el.value;
    }
    const g = grade(item, ans);
    results.push({ item, ans, g });
    store.recordMastery(item.term, g.correct);
    if (!g.correct) store.pushWrong({ term: item.term, q: item.q, answer: item.answer, userAnswer: ans });
  });
  const total = results.reduce((s, r) => s + r.g.score, 0);
  const pct = Math.round((total / results.length) * 100);
  els.quizBox.querySelectorAll(".quiz-item").forEach((node, i) => {
    const r = results[i];
    const v = document.createElement("div");
    v.className = `verdict ${r.g.correct ? "ok" : "bad"}`;
    v.innerHTML = `${r.g.correct ? "✔ 正确" : "✘ 待巩固"}（得分 ${r.g.score}）${escapeHtml(r.g.feedback)}<br><span class="micro">参考答案：${escapeHtml(
      r.g.reference
    )}</span>`;
    node.appendChild(v);
  });
  els.quizResult.innerHTML = `<h3>本次测评得分：${pct} 分（共 ${results.length} 题）</h3>
    <p class="micro">正确 ${results.filter((r) => r.g.correct).length} 题 · 待巩固 ${
    results.filter((r) => !r.g.correct).length
  } 题，已同步到「学习报告」与错题本。</p>`;
  els.quizResult.classList.remove("hidden");
  const st = store.all;
  store.patch({ quizCount: st.quizCount + results.length, quizCorrect: st.quizCorrect + results.filter((r) => r.g.correct).length });
  toast(`测评完成：${pct} 分`);
}

/* ================= 学习报告 ================= */

function renderReport() {
  const st = store.all;
  const mastery = st.mastery || {};
  const entries = Object.entries(mastery).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const totalQ = st.quizCount || 0;
  const correct = st.quizCorrect || 0;
  const rate = totalQ ? Math.round((correct / totalQ) * 100) : 0;

  els.reportStats.innerHTML = `
    <div class="stat"><b>${state.materials.length}</b><span>素材数</span></div>
    <div class="stat"><b>${state.corpus?.cards.length || 0}</b><span>知识点</span></div>
    <div class="stat"><b>${st.qaCount || state.qaCount}</b><span>累计提问</span></div>
    <div class="stat"><b>${rate}%</b><span>练习正确率</span></div>`;

  const cv = els.masteryCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 600;
  const h = 320;
  cv.width = w * dpr;
  cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!entries.length) {
    ctx.fillStyle = getComputedStyle(document.body).color;
    ctx.font = "13px sans-serif";
    ctx.fillText("还没有练习记录，先去「练习测评」做几道题吧。", 20, 40);
  } else {
    const padL = 96;
    const barH = Math.min(30, (h - 40) / entries.length - 8);
    entries.forEach(([term, m], i) => {
      const y = 20 + i * (barH + 10);
      const pctm = Math.round((m.correct / m.total) * 100);
      ctx.fillStyle = getComputedStyle(document.body).color;
      ctx.font = "12px sans-serif";
      ctx.fillText(term.length > 8 ? term.slice(0, 8) + "…" : term, 8, y + barH / 2 + 4);
      const maxW = w - padL - 60;
      ctx.fillStyle = "rgba(120,130,180,.22)";
      roundRect(ctx, padL, y, maxW, barH, 6);
      ctx.fill();
      const grad = ctx.createLinearGradient(padL, 0, padL + maxW, 0);
      grad.addColorStop(0, "#4f46e5");
      grad.addColorStop(1, pctm >= 60 ? "#16a34a" : "#f59e0b");
      ctx.fillStyle = grad;
      roundRect(ctx, padL, y, Math.max(6, (maxW * m.correct) / m.total), barH, 6);
      ctx.fill();
      ctx.fillStyle = getComputedStyle(document.body).color;
      ctx.fillText(`${pctm}% (${m.correct}/${m.total})`, padL + maxW + 8, y + barH / 2 + 4);
    });
  }

  const wrong = st.wrong || [];
  els.wrongBox.innerHTML = wrong.length
    ? `<ul>${wrong
        .slice(0, 10)
        .map(
          (wI) =>
            `<li><b>${escapeHtml(wI.term)}</b>：${escapeHtml(wI.q)}<br><span class="micro">参考答案：${escapeHtml(
              String(wI.answer || "")
            )}</span></li>`
        )
        .join("")}</ul>`
    : `<p class="micro">暂无错题记录。</p>`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================= 导出 ================= */

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function exportNotes() {
  if (!state.materials.length) {
    toast("暂无可导出的内容");
    return;
  }
  const md = exportMarkdown(
    state.materials,
    (id) => state.extractions.get(id)?.terms || [],
    store.all.chat.slice(-20)
  );
  downloadText(md, `智学笔记-${Date.now()}.md`);
  toast("笔记已导出为 Markdown");
}

/* ================= 事件绑定 ================= */

/* ================= 图像预览交互 ================= */

function bindImageViewer() {
  const vp = els.imgViewport;
  if (!vp) return;

  els.btnZoomIn.onclick = () => zoomImg(1.25);
  els.btnZoomOut.onclick = () => zoomImg(0.8);
  els.btnImgFit.onclick = () => {
    resetImgView(true);
    applyImgView();
  };
  els.btnImg100.onclick = () => {
    // 1:1 —— 基准尺寸设为原始像素
    const img = els.imagePreview;
    if (!img || !img.naturalWidth) return;
    imgView.base = 1;
    imgView.scale = 1;
    imgView.tx = 0;
    imgView.ty = 0;
    imgView.rot = 0;
    img.style.width = `${img.naturalWidth}px`;
    img.style.height = `${img.naturalHeight}px`;
    drawBlockOverlay();
    applyImgView();
  };
  els.btnImgRotate.onclick = () => {
    imgView.rot = (imgView.rot + 90) % 360;
    applyImgView();
  };
  els.btnImgReset.onclick = () => resetImgView(true);
  els.btnImgBlocks.onclick = () => {
    imgView.blocks = !imgView.blocks;
    els.btnImgBlocks.classList.toggle("on", imgView.blocks);
    drawBlockOverlay();
    toast(imgView.blocks ? "已标注检测到的文字区块" : "已隐藏文字区块标注");
  };
  els.btnImgFull.onclick = openLightbox;
  els.btnImgEnhance.onclick = () => {
    const on = !els.imagePreview.classList.contains("enhanced");
    els.imagePreview.classList.toggle("enhanced", on);
    els.btnImgEnhance.classList.toggle("on", on);
    toast(on ? "已开启增强对比（仅影响预览，不改变原图）" : "已关闭增强对比");
  };

  // 滚轮缩放
  vp.addEventListener(
    "wheel",
    (e) => {
      if (!els.imagePreview || !els.imagePreview.naturalWidth) return;
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      zoomImg(e.deltaY < 0 ? 1.12 : 0.89, { x: e.clientX - r.left, y: e.clientY - r.top });
    },
    { passive: false }
  );

  // 拖拽平移
  let dragging = null;
  vp.addEventListener("pointerdown", (e) => {
    if (!els.imagePreview || !els.imagePreview.naturalWidth) return;
    dragging = { x: e.clientX, y: e.clientY, tx: imgView.tx, ty: imgView.ty };
    vp.classList.add("drag");
    if (vp.setPointerCapture) vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    imgView.tx = dragging.tx + (e.clientX - dragging.x);
    imgView.ty = dragging.ty + (e.clientY - dragging.y);
    applyImgView();
  });
  const endDrag = () => {
    dragging = null;
    vp.classList.remove("drag");
  };
  vp.addEventListener("pointerup", endDrag);
  vp.addEventListener("pointercancel", endDrag);
  vp.addEventListener("pointerleave", endDrag);

  // 双击重置
  vp.addEventListener("dblclick", () => resetImgView(true));

  // 原图查看器
  els.lbClose.onclick = closeLightbox;
  els.lightbox.onclick = (e) => {
    if (e.target === els.lightbox || e.target === els.lbBody) closeLightbox();
  };
  els.lbFit.onclick = () => setLightboxScale("fit");
  els.lb100.onclick = () => setLightboxScale("1");
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.lightbox.hidden) closeLightbox();
  });
  window.addEventListener("resize", () => {
    drawHistogram(activeMaterial()?.analysis);
    drawBlockOverlay();
  });
}

function openLightbox() {
  const m = activeMaterial();
  const rt = m && state.runtime.get(m.id);
  const src = rt?.blobUrl || m?.imageUrl;
  if (!src) {
    toast("当前素材没有可查看的图片");
    return;
  }
  els.lbImg.src = src;
  els.lbInfo.textContent = m.analysis ? `${m.title} · ${m.analysis.width}×${m.analysis.height}` : m.title || "";
  els.lightbox.hidden = false;
  setLightboxScale("fit");
}

function closeLightbox() {
  els.lightbox.hidden = true;
  els.lbImg.src = "";
}

function setLightboxScale(mode) {
  const img = els.lbImg;
  if (!img) return;
  if (mode === "1") {
    img.style.maxWidth = "none";
    img.style.width = img.naturalWidth ? `${img.naturalWidth}px` : "auto";
  } else {
    img.style.width = "auto";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "calc(100vh - 120px)";
  }
}

function bindEvents() {
  els.tabs.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) switchTab(t.dataset.tab);
  });

  els.btnTheme.onclick = () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    if (document.querySelector('.tab.active')?.dataset.tab === 'report') renderReport();
    drawGraph();
  };

  els.btnPickImage.onclick = () => els.fileInput.click();
  els.fileInput.onchange = (e) => {
    [...e.target.files].forEach((f) => addImageMaterial(f));
    e.target.value = "";
  };

  const dz = els.dropzone;
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("over");
    })
  );
  dz.addEventListener("drop", (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) files.forEach((f) => addImageMaterial(f));
    else toast("请拖入图片文件");
  });
  // 阻止整页默认拖放
  ["dragover", "drop"].forEach((ev) =>
    window.addEventListener(ev, (e) => {
      if (!dz.contains(e.target)) e.preventDefault();
    })
  );
  window.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) addImageMaterial(f, "剪贴板图片");
      }
    }
  });

  els.btnPasteText.onclick = () => {
    const m = activeMaterial();
    els.pasteBox.classList.toggle("hidden");
    els.pasteArea.placeholder =
      m && m.kind === "image" && !m.text
        ? "OCR 不可用时，可直接把图片中的文字粘贴到此处，将补录到当前图片素材…"
        : "在此粘贴讲义、课文、试题等文字内容…";
    els.pasteArea.focus();
  };
  els.btnCancelPaste.onclick = () => {
    els.pasteBox.classList.add("hidden");
    els.pasteArea.value = "";
  };
  els.btnSubmitPaste.onclick = () => {
    const t = els.pasteArea.value.trim();
    if (t.length < 10) return toast("请粘贴至少 10 个字符");
    const m = activeMaterial();
    // 当前选中的是尚未取得文字的图片素材时，直接把文本补给它，避免素材重复
    if (m && m.kind === "image" && !m.text) {
      m.text = t;
      els.textWork.value = t;
      renderMaterials();
      renderActive();
      extractMaterial(m);
      persist();
    } else {
      addTextMaterial(t, `文本素材 · ${t.slice(0, 10)}…`);
    }
    els.pasteArea.value = "";
    els.pasteBox.classList.add("hidden");
    switchTab("knowledge");
  };

  els.btnClearAll.onclick = () => {
    if (!state.materials.length) return;
    if (!confirm("确定清空全部素材、笔记与学习记录？此操作不可撤销。")) return;
    store.clearAll();
    state.materials = [];
    state.extractions.clear();
    state.runtime.clear();
    state.corpus = null;
    state.activeId = null;
    state.chat = [];
    els.chatWindow.innerHTML = "";
    els.extractLog.innerHTML = "";
    renderMaterials();
    renderActive();
    renderKnowledge();
    renderReport();
    toast("已清空");
  };

  els.btnOcr.onclick = () => runOcr(state.activeId);

  bindImageViewer();

  els.textWork.addEventListener("input", () => {
    const m = activeMaterial();
    if (m) m.text = els.textWork.value;
  });
  els.btnExtract.onclick = () => {
    const m = activeMaterial();
    if (!m) return toast("请先选择一个素材");
    m.text = els.textWork.value;
    extractMaterial(m);
    persist();
    switchTab("knowledge");
  };

  els.termSearch.addEventListener("input", renderKnowledge);
  els.termTypeFilter.addEventListener("change", renderKnowledge);

  // 素材库：搜索 / 分类筛选 / 排序 / 整体入库
  els.matSearch.addEventListener("input", renderMaterials);
  els.matCatFilter.addEventListener("change", renderMaterials);
  els.matSort.addEventListener("change", renderMaterials);
  els.btnSaveAllKb.onclick = saveAllToKb;

  // 个人知识库
  els.kbSearch.addEventListener("input", renderLibrary);
  els.kbCatFilter.addEventListener("change", () => {
    state.kbCat = els.kbCatFilter.value;
    renderLibrary();
  });
  els.btnKbExport.onclick = () => {
    if (!kb.count()) {
      toast("知识库还是空的");
      return;
    }
    downloadText(kbExportMarkdown(), "我的个人知识库.md");
    toast("已导出个人知识库");
  };
  els.btnKbClear.onclick = () => {
    if (!kb.count()) return;
    kb.clear();
    state.kbCat = "";
    els.kbCatFilter.value = "";
    renderLibrary();
    toast("已清空个人知识库");
  };

  els.mindMode.addEventListener("change", () => {
    mindState.collapsed.clear();
    renderKnowledge();
  });
  els.mindDepth.addEventListener("input", () => {
    syncGrainLabel();
    renderKnowledge();
  });
  els.btnMindCollapse.onclick = () => {
    const keys = [];
    (function walk(n) {
      if (n.children && n.children.length && n.kind === "branch") keys.push(n.key);
      (n.children || []).forEach(walk);
    })(renderMind._last?.root || { children: [] });
    keys.forEach((k) => mindState.collapsed.add(k));
    renderKnowledge();
    toast("已折叠所有分支");
  };
  els.btnMindExpand.onclick = () => {
    mindState.collapsed.clear();
    renderKnowledge();
    toast("已展开所有分支");
  };
  // 调整深度：保留已有节点坐标，只增删节点，避免整图跳变
  els.graphDepth.addEventListener("input", () => rebuildGraph({ keepPos: true, alpha: 0.6 }));
  els.btnGraphReset.onclick = () => {
    G.k = 1;
    G.ox = 0;
    G.oy = 0;
    for (const n of G.nodes) n.fixed = false;
    restartGraph();
    toast("已重置布局");
  };
  // 切换分区维度：重新分组并重排（布局必然变化，不能沿用旧坐标）
  els.graphGroup.addEventListener("change", () => {
    state.graphGroup = els.graphGroup.value;
    state.graphCat = "";
    els.graphCatFilter.value = "";
    for (const n of G.nodes) n.fixed = false;
    restartGraph();
    const label = els.graphGroup.selectedOptions[0]?.textContent || "";
    toast(`图谱已按「${label}」分区`);
  });
  els.graphCatFilter.addEventListener("change", () => {
    state.graphCat = els.graphCatFilter.value;
    for (const n of G.nodes) n.fixed = false;
    restartGraph();
  });

  els.btnSamples.onclick = async () => {
    for (const s of SAMPLES.slice(0, 3)) {
      if (!state.materials.some((m) => m.id === s.id)) await addSample(s, true);
    }
    toast("已载入 3 份示例素材，可直接提问");
    switchTab("knowledge");
  };

  els.btnExport.onclick = exportNotes;

  els.modeRow.addEventListener("click", (e) => {
    const b = e.target.closest(".mode");
    if (!b) return;
    state.mode = b.dataset.mode;
    els.modeRow.querySelectorAll(".mode").forEach((x) => x.classList.toggle("active", x === b));
    toast(`已切换为「${b.textContent}」模式`);
  });

  els.btnAsk.onclick = () => handleAsk();
  els.qaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAsk();
  });

  els.btnGenQuiz.onclick = () => {
    switchTab("quiz");
    renderQuiz();
    if (state.quiz && state.quiz.length) toast(`已生成 ${state.quiz.length} 道题`);
  };
  els.btnSubmitQuiz.onclick = submitQuiz;
  els.btnRedoQuiz.onclick = renderQuiz;
}

/* ================= 启动 ================= */

async function boot() {
  initGraph();
  bindEvents();
  syncGrainLabel();
  fillCategorySelects();
  if (els.graphGroup) els.graphGroup.value = state.graphGroup;

  const st = store.all;
  state.qaCount = st.qaCount || 0;
  // 恢复素材
  for (const m of st.materials) {
    state.materials.push({ ...m });
    if (m.text) {
      state.extractions.set(m.id, extractKnowledge({ id: m.id, title: m.title, text: m.text }));
      if (!m.category) refreshCategory(m);
      else if (m.categoryAuto && !m.categoryManual) refreshCategory(m, true);
    }
  }
  if (state.materials.length) {
    state.activeId = state.materials[0].id;
    rebuildCorpus();
    renderMaterials();
    renderActive();
    renderKnowledge();
    log(`已恢复 ${state.materials.length} 份素材`);
  }
  if (!state.materials.length) {
    await addSample(SAMPLES[0], true);
    await addSample(SAMPLES[4], true);
    state.activeId = state.materials[0]?.id;
    renderMaterials();
    renderActive();
    rebuildCorpus();
    renderKnowledge();
    log("首次进入，已自动载入 2 份示例素材（生物·光合作用 / 信息技术·HTTP）");
  }
  // 恢复对话
  (st.chat || []).forEach((c) => pushChat(c.role, c.text));
  renderSuggest();
  updateStats();
  renderLibrary();
  switchTab("parse");

  // 引擎状态自检
  setTimeout(() => {
    if (window.Tesseract) {
      els.engineChip.textContent = "本地引擎 + OCR 可用";
    } else {
      els.engineChip.textContent = "本地引擎就绪 · OCR 离线降级";
      els.engineChip.style.color = "var(--amber)";
      els.engineChip.style.borderColor = "color-mix(in srgb, var(--amber) 40%, transparent)";
      els.engineChip.style.background = "color-mix(in srgb, var(--amber) 12%, transparent)";
    }
  }, 1200);
}

// 调试/测试钩子（不影响正常功能）
if (typeof window !== "undefined") {
  window.__MTA__ = {
    G, state, els, rebuildGraph, restartGraph, showGraph, reheat, drawGraph, pickNode, PHYS,
    imgView, fitImg, applyImgView, drawHistogram, drawBlockOverlay, renderQuality, zoomImg,
    kb, refreshCategory, syncKbFromMaterial, renderLibrary, saveAllToKb, catOf,
    graphGroupOf, groupCenter, renderGraphLegend, populateGraphFilter
  };
}

boot();
