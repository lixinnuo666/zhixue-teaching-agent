/**
 * 大模型接入（方案 A：使用者自带 Key）
 *
 * 设计要点：
 * 1. 配置只存在浏览器 localStorage，不上传、不硬编码任何密钥
 * 2. 调用 OpenAI 兼容的 /chat/completions 接口，因此 DeepSeek / 智谱 / 通义 / Moonshot / OpenAI 等都能用
 * 3. 本地检索负责找素材（RAG 的 R），大模型负责组织表达（RAG 的 G）
 * 4. 任何异常都向上抛出，由调用方降级回本地规则引擎
 */

const STORE_KEY = "zhixue.llm.config";

/** 预设服务商，均为 OpenAI 兼容接口；选“自定义”可手填任意兼容地址 */
export const PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", hint: "deepseek.com 控制台申请" },
  { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", hint: "open.bigmodel.cn 控制台申请" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", hint: "阿里云百炼控制台申请" },
  { id: "moonshot", name: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", hint: "platform.moonshot.cn 申请" },
  { id: "siliconflow", name: "硅基流动 SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", hint: "cloud.siliconflow.cn 申请，有免费额度" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", hint: "platform.openai.com 申请" },
  { id: "local", name: "本地代理（解决跨域）", baseUrl: "http://127.0.0.1:8787/v1", model: "deepseek-chat", hint: "先运行 node tools/llm-proxy.mjs，模型名按你的上游填" },
  { id: "custom", name: "自定义（兼容 OpenAI）", baseUrl: "", model: "", hint: "填写任意 OpenAI 兼容服务地址" }
];

const DEFAULT_CFG = { provider: "deepseek", baseUrl: "", apiKey: "", model: "", enabled: true, timeout: 45 };

export function getConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_CFG };
    return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CFG };
  }
}

export function saveConfig(cfg) {
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  localStorage.removeItem(STORE_KEY);
}

/** 是否已填好可发起调用的配置 */
export function isReady(cfg = getConfig()) {
  return !!(cfg && cfg.enabled && cfg.baseUrl && cfg.apiKey && cfg.model);
}

function endpoint(baseUrl) {
  return baseUrl.replace(/\/+$/, "") + "/chat/completions";
}

/**
 * 发起一次对话请求（OpenAI 兼容格式）
 * @returns {Promise<string>} 模型输出的文本
 */
export async function chat(messages, cfg = getConfig(), { timeoutSec = 45 } = {}) {
  if (!isReady(cfg)) throw new Error("未配置大模型");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), (cfg.timeout || timeoutSec) * 1000);
  let res;
  try {
    res = await fetch(endpoint(cfg.baseUrl), {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.3,
        stream: false
      })
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("请求超时，可尝试调大超时时间或换一个模型");
    // fetch 直接失败：绝大多数是浏览器跨域（CORS）拦截，也可能是网络不通
    throw new Error("请求被浏览器拦截或网络不可达（常见于 CORS 跨域限制），请改用支持浏览器直连的服务，或检查地址是否正确");
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json();
      detail = (j && (j.error?.message || j.message)) || "";
    } catch {
      detail = await res.text().catch(() => "");
    }
    if (res.status === 401 || res.status === 403) throw new Error("鉴权失败（401/403）：API Key 不正确或已失效");
    if (res.status === 429) throw new Error("触发限流（429）：稍等片刻再试，或确认账户余额");
    if (res.status === 404) throw new Error("接口不存在（404）：Base URL 或模型名可能有误");
    throw new Error(`调用失败 ${res.status}${detail ? "：" + detail : ""}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("返回内容为空，请确认模型名是否正确");
  return String(text).trim();
}

const MODE_STYLE = {
  direct: "直接、准确地回答，先给结论，再补充关键细节。",
  steps: "分步骤讲解，用 1. 2. 3. 编号列出，每步说明「做什么」和「为什么」。",
  example: "在讲解后必须给出至少一个贴近生活的具体例子，帮助学生理解。",
  socratic: "不要直接给出答案。用 2-3 个层层递进的反问引导学生自己思考，最后再给出简要提示。"
};

/**
 * 基于本地检索到的素材片段，让大模型组织答案（RAG）
 * @param {string} question
 * @param {Array<{title:string,idx:number,text:string}>} refs 本地检索命中的原句
 * @param {"direct"|"steps"|"example"|"socratic"} mode
 */
export async function answer(question, refs, mode = "direct", cfg = getConfig()) {
  const ctx = (refs || []).slice(0, 6).map((r, i) => `[${i + 1}] ${r.text}`).join("\n");
  const system = [
    "你是一个耐心、严谨的教学助教，服务于一个教学辅助工具。",
    "你会收到「素材片段」和「学生提问」。",
    "规则：",
    "1. 优先依据素材片段回答；素材里没有的内容，明确说明「素材中未提及」，然后可以基于常识补充，并注明这是常识补充。",
    "2. 不要编造素材中不存在的数字、公式或结论。",
    "3. 使用 Markdown 输出，条理清晰，语言简洁，面向学生。",
    "4. 回答控制在 300 字以内，除非问题确实需要更长篇幅。",
    "当前讲解方式：" + (MODE_STYLE[mode] || MODE_STYLE.direct)
  ].join("\n");

  const user = [
    ctx ? `素材片段：\n${ctx}\n` : "（本次没有检索到素材片段）\n",
    `学生提问：${question}`
  ].join("\n");

  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    cfg
  );
}

/** 连通性自检，用于设置面板的「测试连接」 */
export async function testConnection(cfg = getConfig()) {
  const t0 = Date.now();
  const text = await chat([{ role: "user", content: "回复两个字：正常" }], cfg, { timeoutSec: 30 });
  return { ok: true, ms: Date.now() - t0, sample: text.slice(0, 60) };
}
