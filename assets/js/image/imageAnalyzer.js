/**
 * 图像解析：
 * 1) 纯本地 Canvas 视觉分析 —— 尺寸、主色、明暗对比、Sobel 边缘密度、
 *    行投影估算文字行数与版面类型判定；
 * 2) OCR —— 优先调用 Tesseract.js（需联网下载语言模型），失败则优雅降级。
 */

export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    if (source instanceof Blob) img.src = URL.createObjectURL(source);
    else img.src = source;
  });
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {Blob|string} source File/Blob 或图片 URL
 * @returns {Promise<object>} 视觉分析结果
 */
export async function analyzeImage(source) {
  const img = await loadImage(source);
  const W = 480;
  const scale = Math.min(1, W / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // ---- 主色量化统计 ----
  const bucket = new Map();
  let sum = 0,
    sumSq = 0,
    dark = 0;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = lum;
    sum += lum;
    sumSq += lum * lum;
    if (lum < 110) dark++;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    const rec = bucket.get(key);
    if (rec) {
      rec.n++;
      rec.r += r;
      rec.g += g;
      rec.b += b;
    } else bucket.set(key, { n: 1, r, g, b });
  }
  const total = w * h;
  const mean = sum / total;
  const contrast = Math.sqrt(Math.max(0, sumSq / total - mean * mean));
  const inkRatio = dark / total;

  const colors = [...bucket.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((c) => ({
      hex: rgbToHex(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)),
      rgb: [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)],
      ratio: +(c.n / total).toFixed(3)
    }));
  const colorfulness = colors.length >= 4 && colors[0].ratio < 0.8;

  // ---- Sobel 边缘密度 ----
  let edge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag > 90) edge++;
    }
  }
  const edgeDensity = edge / total;

  // ---- 行投影：估算文字行数 ----
  const thr = Math.max(60, mean * 0.72);
  const rowDark = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (gray[y * w + x] < thr) c++;
    rowDark[y] = c / w;
  }
  let rows = 0,
    run = 0;
  for (let y = 0; y < h; y++) {
    if (rowDark[y] > 0.05) {
      run++;
    } else {
      if (run >= 2 && run <= h * 0.5) rows++;
      run = 0;
    }
  }
  if (run >= 2) rows++;

  // ---- 清晰度：拉普拉斯方差（越大越清晰）----
  let lapSum = 0,
    lapSq = 0,
    lapN = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += lap;
      lapSq += lap * lap;
      lapN++;
    }
  }
  const lapVar = lapN ? Math.max(0, lapSq / lapN - (lapSum / lapN) ** 2) : 0;
  const sharpness = Math.min(100, Math.round(lapVar / 12));
  const sharpnessLabel = sharpness >= 60 ? "清晰" : sharpness >= 30 ? "一般" : "偏模糊";

  // ---- 色彩：平均饱和度与冷暖倾向 ----
  let satSum = 0,
    warmSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
    warmSum += r - b;
  }
  const saturation = Math.round((satSum / total) * 100);
  const warmth = Math.round(warmSum / total);
  const warmthLabel = warmth > 12 ? "偏暖" : warmth < -12 ? "偏冷" : "中性";

  // ---- 列投影：分栏与版面结构 ----
  const colDark = new Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) if (gray[y * w + x] < thr) c++;
    colDark[x] = c / h;
  }
  const colSegs = [];
  {
    let s = -1;
    const gap = Math.max(4, Math.round(w * 0.03));
    for (let x = 0; x < w; x++) {
      const on = colDark[x] > 0.015;
      if (on && s < 0) s = x;
      if (!on && s >= 0) {
        if (x - s > gap) colSegs.push([s, x]);
        s = -1;
      }
    }
    if (s >= 0 && w - s > gap) colSegs.push([s, w]);
  }
  const columns = Math.min(4, Math.max(1, colSegs.length));

  // ---- 文字行区间 → 文字块 bounding box（换算回原图坐标）----
  const invScale = 1 / Math.max(scale, 1e-6);
  const rowBands = [];
  {
    let s = -1;
    for (let y = 0; y < h; y++) {
      const on = rowDark[y] > 0.05;
      if (on && s < 0) s = y;
      if (!on && s >= 0) {
        if (y - s >= 2) rowBands.push([s, y]);
        s = -1;
      }
    }
    if (s >= 0 && h - s >= 2) rowBands.push([s, h]);
  }
  const textBlocks = rowBands.slice(0, 14).map(([y0, y1]) => {
    // 在该行带内找左右边界
    let x0 = w,
      x1 = 0;
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let y = y0; y < y1; y++) if (gray[y * w + x] < thr) c++;
      if (c > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (x1 <= x0) {
      x0 = 0;
      x1 = w;
    }
    return {
      x: Math.round(x0 * invScale),
      y: Math.round(y0 * invScale),
      w: Math.round((x1 - x0 + 1) * invScale),
      h: Math.round((y1 - y0 + 1) * invScale)
    };
  });

  // ---- 亮度直方图（32 bin）----
  const histogram = new Array(32).fill(0);
  for (let p = 0; p < total; p++) {
    histogram[Math.min(31, (gray[p] / 8) | 0)]++;
  }
  const histMax = Math.max(1, ...histogram);

  // ---- 行投影剖面（压缩到 120 点，供可视化绘图）----
  const profileN = 120;
  const rowProfile = new Array(profileN).fill(0);
  for (let i = 0; i < profileN; i++) {
    const a = Math.floor((i * h) / profileN);
    const b = Math.max(a + 1, Math.floor(((i + 1) * h) / profileN));
    let s = 0;
    for (let y = a; y < b; y++) s += rowDark[y];
    rowProfile[i] = +(s / (b - a)).toFixed(4);
  }

  // ---- 倾斜角估计：在 ±8° 内找行投影方差最大的角度 ----
  const skew = estimateSkew(gray, w, h, thr);

  // ---- 版面类型判定 ----
  let layout = "照片 / 实景图";
  if (inkRatio < 0.55 && rows >= 3 && edgeDensity > 0.01) layout = "文档 / 印刷体截图";
  if (rows >= 6 && colors[0] && colors[0].rgb.every((v) => v > 225)) layout = "课件 / 讲义截图";
  if (colorfulness && edgeDensity < 0.05) layout = "示意图 / 插画";
  if (rows >= 2 && edgeDensity > 0.02 && inkRatio > 0.25) layout = "表格 / 图表页";
  if (columns >= 2 && rows >= 6) layout = "分栏排版（" + columns + " 栏）";

  // ---- 质量评分与建议 ----
  const { quality, qualityLabel, suggestions, ocrHint } = assess({
    sharpness,
    contrast,
    brightness: mean,
    inkRatio,
    edgeDensity,
    rows,
    skew,
    columns
  });

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    ratio: +(img.naturalWidth / img.naturalHeight).toFixed(2),
    bytes: source instanceof Blob ? source.size : null,
    colors,
    colorCount: bucket.size,
    brightness: Math.round(mean),
    contrast: Math.round(contrast),
    inkRatio: +(inkRatio * 100).toFixed(1),
    edgeDensity: +(edgeDensity * 100).toFixed(2),
    textRows: rows,
    sharpness,
    sharpnessLabel,
    saturation,
    warmth,
    warmthLabel,
    skew,
    columns,
    textBlocks,
    histogram,
    histMax,
    rowProfile,
    layout,
    quality,
    qualityLabel,
    suggestions,
    ocrHint,
    thumb: cv.toDataURL("image/jpeg", 0.72)
  };
}

/** 倾斜角估计：行投影方差最大的角度（降采样，控制耗时） */
function estimateSkew(gray, w, h, thr) {
  let best = 0;
  let bestVar = -1;
  const step = Math.max(1, Math.round(h / 160));
  for (let deg = -8; deg <= 8; deg += 1) {
    const tan = Math.tan((deg * Math.PI) / 180);
    const rows = [];
    for (let y = 0; y < h; y += step) {
      let c = 0;
      for (let x = 0; x < w; x += 2) {
        const sx = Math.round(x + (y - h / 2) * tan);
        if (sx < 0 || sx >= w) continue;
        if (gray[y * w + sx] < thr) c++;
      }
      rows.push(c);
    }
    if (!rows.length) continue;
    const m = rows.reduce((a, b) => a + b, 0) / rows.length;
    const v = rows.reduce((a, b) => a + (b - m) * (b - m), 0) / rows.length;
    if (v > bestVar) {
      bestVar = v;
      best = deg;
    }
  }
  return best;
}

/** 综合质量评估 + 针对性改进建议 + OCR 效果预判 */
function assess(m) {
  const suggestions = [];
  let score = 0;

  // 清晰度 40
  const sSharp = Math.min(40, (m.sharpness / 100) * 40);
  score += sSharp;
  if (m.sharpness < 30) suggestions.push("图像偏模糊：建议重新拍摄或用更高分辨率的原图，文字识别准确率会明显下降。");

  // 对比度 25
  score += Math.min(25, (m.contrast / 70) * 25);
  if (m.contrast < 25) suggestions.push("对比度偏低：可尝试提高拍摄光线或对图片做「增亮/去雾」预处理。");

  // 亮度 20（过暗或过曝都扣分）
  const bScore = m.brightness < 70 || m.brightness > 215 ? 6 : 20 - Math.abs(m.brightness - 150) / 8;
  score += Math.max(0, Math.min(20, bScore));
  if (m.brightness < 70) suggestions.push("画面偏暗：暗部细节可能丢失，建议补光后重拍。");
  if (m.brightness > 215) suggestions.push("画面过曝：高光区域文字可能被冲淡，建议降低曝光。");

  // 文字密度 15
  const inkScore = m.inkRatio > 0.02 && m.inkRatio < 0.6 ? 15 : 7;
  score += inkScore;
  if (m.inkRatio < 0.02) suggestions.push("几乎检测不到文字笔画：这张图可能不含正文，或需要裁剪出文字区域再识别。");
  if (m.inkRatio > 0.6) suggestions.push("文字/墨迹占比过高：版面过于拥挤，建议按区域分别识别。");

  if (Math.abs(m.skew) >= 2) suggestions.push(`检测到约 ${m.skew}° 倾斜：矫正后再识别可提升准确率（可在看图工具中先旋转）。`);

  const quality = Math.round(Math.max(0, Math.min(100, score)));
  const qualityLabel = quality >= 78 ? "优良" : quality >= 58 ? "可用" : quality >= 38 ? "一般" : "较差";
  const ocrHint =
    quality >= 78 ? "预计识别效果：好" : quality >= 58 ? "预计识别效果：一般" : "预计识别效果：较差，建议先按下方建议处理";
  if (!suggestions.length) suggestions.push("图像质量良好，可直接进行文字识别与知识点抽取。");
  return { quality, qualityLabel, suggestions, ocrHint };
}

/**
 * OCR 识别（Tesseract.js）。离线或模型不可用时会返回 ok:false。
 * @param {Blob|string} source
 * @param {(p:number,status:string)=>void} onProgress
 */
export async function ocrImage(source, onProgress = () => {}) {
  const T = window.Tesseract;
  if (!T) {
    return { ok: false, reason: "OCR 引擎未加载（离线或 CDN 不可达），请手动粘贴文本。" };
  }
  const url = source instanceof Blob ? URL.createObjectURL(source) : source;
  let worker = null;
  try {
    onProgress(0.02, "初始化识别引擎…");
    worker = await T.createWorker("chi_sim+eng", 1, {
      logger: (m) => {
        if (m.status && typeof m.progress === "number") onProgress(m.progress, m.status);
      }
    });
    onProgress(0.3, "正在识别图中文字…");
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("识别超时（>90s），已降级为视觉分析模式")), 90000)
    );
    const job = worker.recognize(url);
    const { data } = await Promise.race([job, timeout]);
    onProgress(1, "识别完成");
    const text = (data.text || "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 1)
      .join("\n");
    return {
      ok: text.length > 1,
      text,
      confidence: Math.round((data.confidence || 0) / 1) + "%",
      reason: text.length > 1 ? "" : "未识别到有效文字，可尝试更清晰的图片或手动粘贴。"
    };
  } catch (e) {
    return { ok: false, reason: `OCR 不可用：${e.message || e}。视觉分析已完成，可手动粘贴文本继续。` };
  } finally {
    if (worker && worker.terminate) {
      try {
        await worker.terminate();
      } catch (_) {}
    }
  }
}

/**
 * 生成一张“课件/讲义扫描页”风格的示例图片，用于演示图文解析流程
 */
export function createSamplePage({ title, subtitle, lines = 18, accent = "#4f46e5" }) {
  const cv = document.createElement("canvas");
  cv.width = 940;
  cv.height = 1240;
  const c = cv.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, cv.width, cv.height);
  // 页边
  c.strokeStyle = "#e8eaf0";
  c.lineWidth = 2;
  c.strokeRect(30, 30, cv.width - 60, cv.height - 60);
  // 标题
  c.fillStyle = "#1e2430";
  c.font = "bold 46px 'Microsoft YaHei', sans-serif";
  c.fillText(title, 70, 130);
  // 标题下划线
  c.fillStyle = accent;
  c.fillRect(70, 152, 300, 6);
  // 副标题
  c.fillStyle = "#6b7280";
  c.font = "22px 'Microsoft YaHei', sans-serif";
  c.fillText(subtitle, 70, 195);

  // 伪文本行
  let y = 250;
  for (let i = 0; i < lines; i++) {
    const full = Math.random() > 0.22;
    const width = full ? 800 : 320 + Math.random() * 420;
    c.fillStyle = "#3a4152";
    c.fillRect(70, y, width, 12);
    y += 34;
    if (Math.random() > 0.86) {
      // 小标题
      c.fillStyle = accent;
      c.fillRect(70, y + 8, 180, 14);
      y += 44;
    }
  }
  // 右下角页码
  c.fillStyle = "#9aa3b2";
  c.font = "18px sans-serif";
  c.fillText("— 示例素材 · 智学智能体 —", 70, cv.height - 60);
  return cv.toDataURL("image/png");
}
