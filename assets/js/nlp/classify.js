/**
 * 学科/主题分类器
 *
 * 纯规则实现：对标题与正文做关键词加权命中，选出得分最高的学科。
 * 设计要点：
 *  - 标题命中权重更高（标题往往直接写明学科）；
 *  - 长关键词权重更高（"光合作用" 比 "细胞" 更具判别力）；
 *  - 返回置信度 = 第一名相对第二名的优势度，便于 UI 提示"自动判定/需确认"。
 */

export const CATEGORIES = [
  {
    key: "biology",
    name: "生物",
    icon: "🧬",
    color: "#16a34a",
    words: ["细胞", "光合作用", "叶绿体", "线粒体", "基因", "遗传", "DNA", "RNA", "蛋白质", "酶", "呼吸作用", "生态系统", "种群", "群落", "染色体", "细胞分裂", "光合", "ATP", "有机物", "生物", "植物", "动物", "微生物", "神经", "血液", "免疫", "进化"]
  },
  {
    key: "physics",
    name: "物理",
    icon: "🧲",
    color: "#0891b2",
    words: ["牛顿", "力学", "加速度", "速度", "质量", "重力", "摩擦力", "动能", "势能", "能量守恒", "动量", "压强", "浮力", "电流", "电压", "电阻", "磁场", "电磁", "光的反射", "折射", "波长", "频率", "功率", "惯性", "物理", "单位", "焦耳", "瓦特"]
  },
  {
    key: "chemistry",
    name: "化学",
    icon: "⚗️",
    color: "#7c3aed",
    words: ["化学反应", "化合物", "元素", "原子", "分子", "氧化", "还原", "酸碱", "溶液", "摩尔", "化学键", "方程式", "催化剂", "金属", "非金属", "有机物", "无机物", "沉淀", "电解", "化学"]
  },
  {
    key: "math",
    name: "数学",
    icon: "📐",
    color: "#4f46e5",
    words: ["函数", "二次函数", "方程", "不等式", "导数", "积分", "极限", "几何", "三角形", "圆", "概率", "统计", "向量", "矩阵", "数列", "集合", "坐标系", "抛物线", "顶点", "对称轴", "数学", "证明", "定理", "公式"]
  },
  {
    key: "chinese",
    name: "语文",
    icon: "📖",
    color: "#f59e0b",
    words: ["古诗", "唐诗", "宋词", "诗人", "李白", "杜甫", "散文", "小说", "文言", "修辞", "比喻", "拟人", "排比", "阅读理解", "作文", "字词", "成语", "作者", "课文", "语文", "文学", "段落", "主旨"]
  },
  {
    key: "english",
    name: "英语",
    icon: "🔤",
    color: "#0ea5e9",
    words: ["英语", "单词", "语法", "时态", "被动语态", "从句", "vocabulary", "grammar", "tense", "phrase", "sentence", "reading", "单词表", "介词", "动词", "名词", "形容词"]
  },
  {
    key: "history",
    name: "历史",
    icon: "🏛️",
    color: "#b45309",
    words: ["历史", "朝代", "皇帝", "战争", "革命", "条约", "文明", "考古", "年代", "王朝", "改革", "运动", "帝国", "封建", "史料"]
  },
  {
    key: "geo",
    name: "地理",
    icon: "🌏",
    color: "#0d9488",
    words: ["地理", "气候", "地形", "纬度", "经度", "洋流", "季风", "板块", "地震", "火山", "人口", "城市", "资源", "地图", "流域", "高原", "盆地"]
  },
  {
    key: "politics",
    name: "政治",
    icon: "⚖️",
    color: "#db2777",
    words: ["政治", "法律", "宪法", "权利", "义务", "政府", "制度", "经济", "市场", "货币", "通货膨胀", "哲学", "唯物", "辩证", "价值观", "公民"]
  },
  {
    key: "cs",
    name: "信息技术",
    icon: "💻",
    color: "#0f766e",
    words: ["HTTP", "TCP", "IP", "协议", "服务器", "客户端", "浏览器", "请求", "响应", "状态码", "网络", "编程", "代码", "算法", "数据结构", "数据库", "操作系统", "计算机", "软件", "硬件", "端口", "域名", "URL", "信息技术", "信息安全", "加密"]
  },
  {
    key: "ai",
    name: "人工智能",
    icon: "🤖",
    color: "#6366f1",
    words: ["机器学习", "深度学习", "神经网络", "人工智能", "AI", "模型", "训练", "特征", "监督学习", "无监督", "强化学习", "数据集", "过拟合", "梯度", "分类", "聚类", "回归", "自然语言", "大模型", "推理", "准确率", "召回率"]
  },
  {
    key: "general",
    name: "通识",
    icon: "📚",
    color: "#64748b",
    words: []
  }
];

const CAT_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
const CAT_BY_NAME = new Map(CATEGORIES.map((c) => [c.name, c]));

export function getCategory(keyOrName) {
  return CAT_BY_KEY.get(keyOrName) || CAT_BY_NAME.get(keyOrName) || CAT_BY_KEY.get("general");
}

export const DEFAULT_CATEGORY = "general";

/**
 * 判定素材所属学科
 * @param {{title?:string, text?:string}} m
 * @returns {{key:string, name:string, icon:string, color:string, confidence:number, hits:string[], auto:true}}
 */
export function classifyMaterial(m) {
  const title = (m && m.title) || "";
  const text = (m && m.text) || "";
  const body = text.slice(0, 6000);
  const scores = new Map();

  const add = (key, w) => scores.set(key, (scores.get(key) || 0) + w);

  for (const c of CATEGORIES) {
    if (!c.words.length) continue;
    for (const w of c.words) {
      const weight = w.length >= 4 ? 3 : w.length >= 3 ? 2 : 1;
      // 标题命中额外加权
      if (title && title.includes(w)) add(c.key, weight * 4);
      let at = body.indexOf(w);
      let n = 0;
      while (at >= 0 && n < 12) {
        add(c.key, weight);
        n++;
        at = body.indexOf(w, at + w.length);
      }
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 3) {
    const g = getCategory(DEFAULT_CATEGORY);
    return { ...g, confidence: 0, hits: [], auto: true };
  }
  const top = ranked[0];
  const second = ranked[1] ? ranked[1][1] : 0;
  const dominance = top[1] / (top[1] + second || 1); // 0.5 ~ 1
  const confidence = Math.max(35, Math.min(99, Math.round(35 + dominance * 64)));
  const cat = getCategory(top[0]);
  const hits = cat.words.filter((w) => title.includes(w) || body.includes(w)).slice(0, 5);
  return { ...cat, confidence, hits, auto: true };
}

/**
 * 从抽取结果中挑出适合作为标签的术语
 * @param {object} ex extractKnowledge 的产物
 * @param {number} n
 */
export function suggestTags(ex, n = 4) {
  if (!ex || !Array.isArray(ex.terms)) return [];
  const scored = ex.terms
    .filter((t) => t.term && t.term.length >= 2)
    .map((t) => ({
      term: t.term,
      score: (t.importance || 0) + (t.definition ? 25 : 0) + Math.min(20, (t.freq || 0) * 4)
    }))
    .sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    if (seen.has(s.term)) continue;
    // 避免与其它标签互为子串
    if (out.some((t) => t.includes(s.term) || s.term.includes(t))) continue;
    seen.add(s.term);
    out.push(s.term);
    if (out.length >= n) break;
  }
  return out;
}
