/** 本地持久化：素材、对话、掌握度、错题 */

const KEY = "mta.v2";

const blank = {
  materials: [],
  chat: [],
  mastery: {},
  wrong: [],
  qaCount: 0,
  quizCount: 0,
  quizCorrect: 0
};

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...blank, ...JSON.parse(raw) } : { ...blank };
  } catch (e) {
    cache = { ...blank };
  }
  return cache;
}

export const store = {
  get all() {
    return read();
  },
  patch(part) {
    cache = { ...read(), ...part };
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn("本地存储写入失败（可能超出配额）", e);
    }
    return cache;
  },
  setMaterial(m) {
    const cur = read();
    const idx = cur.materials.findIndex((x) => x.id === m.id);
    const light = { ...m, blob: null };
    if (idx >= 0) cur.materials[idx] = light;
    else cur.materials.push(light);
    this.patch({ materials: cur.materials });
  },
  removeMaterial(id) {
    const cur = read();
    this.patch({ materials: cur.materials.filter((m) => m.id !== id) });
  },
  clearAll() {
    cache = { ...blank, materials: [] };
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (e) {}
  },
  /** 更新知识点掌握度 */
  recordMastery(term, ok) {
    const cur = read();
    const m = cur.mastery[term] || { total: 0, correct: 0, last: 0 };
    m.total++;
    if (ok) m.correct++;
    m.last = Date.now();
    cur.mastery[term] = m;
    this.patch({ mastery: cur.mastery });
    return m;
  },
  pushWrong(item) {
    const cur = read();
    if (!cur.wrong.some((w) => w.term === item.term && w.q === item.q)) {
      cur.wrong.unshift({ ...item, at: Date.now() });
      cur.wrong = cur.wrong.slice(0, 40);
      this.patch({ wrong: cur.wrong });
    }
  },
  clearWrong() {
    this.patch({ wrong: [] });
  },
  pushChat(msg) {
    const cur = read();
    cur.chat.push(msg);
    cur.chat = cur.chat.slice(-40);
    this.patch({ chat: cur.chat });
  },
  resetChat() {
    this.patch({ chat: [] });
  }
};

export function exportMarkdown(materials, termsByMaterial, chat) {
  const lines = ["# 智学 · 学习笔记", "", `> 导出时间：${new Date().toLocaleString()}`, ""];
  lines.push("## 一、素材清单", "");
  materials.forEach((m, i) => {
    lines.push(`${i + 1}. **${m.title}**（${m.subject || "未分类"}）`);
  });
  lines.push("", "## 二、知识点卡片", "");
  for (const m of materials) {
    const terms = termsByMaterial(m.id) || [];
    if (!terms.length) continue;
    lines.push(`### ${m.title}`, "");
    terms.slice(0, 15).forEach((c) => {
      lines.push(`- **${c.term}**（${c.level}，重要度 ${c.importance}）：${(c.definition || c.defSentence || "—").replace(/\n/g, " ")}`);
    });
    lines.push("");
  }
  lines.push("## 三、答疑记录", "");
  chat.forEach((c) => {
    lines.push(`**${c.role === "user" ? "我" : "助教"}**：${c.text.replace(/\n/g, " · ").slice(0, 400)}`, "");
  });
  return lines.join("\n");
}
