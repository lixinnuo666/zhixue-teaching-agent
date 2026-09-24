# -*- coding: utf-8 -*-
"""生成「智学·多模态教学智能体」作品介绍 PPT（14 页，1280x720）—— v2 规整栅格版

栅格约定（全局唯一，禁止临时发挥）：
  L = 70      左边界          R = 1210   右边界         W = 1140   满宽
  标题块 A: y 20-120        内容区 B: y 130-645       页脚线: y 652
  内容右列起点 X2 = 410     三栏右列起点 X3 = 730
"""
import math
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

PX = 1 / 96.0
FONT = "Microsoft YaHei"
NUMF = "Arial"

BG    = RGBColor(0xFF, 0xFF, 0xFF)
PANEL = RGBColor(0xF8, 0xFA, 0xFC)
CARD  = RGBColor(0xF1, 0xF5, 0xF9)
MAIN  = RGBColor(0x25, 0x63, 0xEB)
MAIN2 = RGBColor(0x1D, 0x4E, 0xD8)
SUB   = RGBColor(0x06, 0xB6, 0xD4)
ACC   = RGBColor(0xF5, 0x9E, 0x0B)
TXT   = RGBColor(0x0F, 0x17, 0x2A)
TXT2  = RGBColor(0x47, 0x55, 0x69)
FOOT  = RGBColor(0x64, 0x74, 0x8B)
LINE  = RGBColor(0xCB, 0xD5, 0xE1)
DARK  = RGBColor(0x0A, 0x1F, 0x44)
DARK2 = RGBColor(0x14, 0x3A, 0x6E)
DEEP  = RGBColor(0x1E, 0x3A, 0x60)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SOFTB = RGBColor(0xBF, 0xDB, 0xFE)
SOFTC = RGBColor(0xC7, 0xD6, 0xEC)
MUTED = RGBColor(0x93, 0xA9, 0xC9)
AMBER = RGBColor(0x92, 0x40, 0x0E)
AMBERBG = RGBColor(0xFF, 0xF7, 0xED)

L, R, W = 70, 1210, 1140
X2, X3 = 410, 730
TOP, BOT = 130, 645
PAD = 26          # 卡片内边距
RAD = 0.05        # 卡片圆角


def I(v):
    return Inches(v * PX)


def rect(sl, x, y, w, h, fill, shape=MSO_SHAPE.RECTANGLE, adj=None, line=None, lw=1.0):
    s = sl.shapes.add_shape(shape, I(x), I(y), I(w), I(h))
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(lw)
    s.shadow.inherit = False
    if adj is not None and shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            s.adjustments[0] = adj
        except Exception:
            pass
    try:
        s.text_frame.text = ""
    except Exception:
        pass
    return s


def card(sl, x, y, w, h, fill=PANEL, line=LINE, rad=RAD):
    return rect(sl, x, y, w, h, fill, MSO_SHAPE.ROUNDED_RECTANGLE, rad, line)


def rich(sl, x, y, w, h, paras, align=PP_ALIGN.LEFT, ls=1.5, anchor=MSO_ANCHOR.TOP):
    tb = sl.shapes.add_textbox(I(x), I(y), I(w), I(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    tf.margin_top = 0
    tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    for i, segs in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = ls
        for seg in segs:
            fnt = seg[4] if len(seg) > 4 else FONT
            r = p.add_run()
            r.text = seg[0]
            r.font.size = Pt(seg[1])
            r.font.bold = seg[2]
            r.font.color.rgb = seg[3]
            r.font.name = fnt
    return tb


def txt(sl, x, y, w, h, lines, size=20, bold=False, color=TXT, align=PP_ALIGN.LEFT,
        ls=1.5, font=FONT, anchor=MSO_ANCHOR.TOP):
    return rich(sl, x, y, w, h, [[(l, size, bold, color, font)] for l in lines],
                align=align, ls=ls, anchor=anchor)


def header(sl, title, page):
    rect(sl, L, 34, 7, 46, MAIN, MSO_SHAPE.ROUNDED_RECTANGLE, 0.3)
    txt(sl, 92, 32, 900, 50, [title], size=36, bold=True, color=TXT, ls=1.2)
    rect(sl, L, 652, W, 1, LINE)
    txt(sl, L, 664, 700, 22, ["智学 · 多模态教学智能体  ｜  越众队"], size=14, color=FOOT)
    txt(sl, 1050, 664, 160, 22, ["%02d / 14" % page], size=14, color=FOOT, align=PP_ALIGN.RIGHT)


def dot(sl, x, y, d, fill, line=None):
    return rect(sl, x, y, d, d, fill, MSO_SHAPE.OVAL, line=line, lw=1.5)


def arrow(sl, x, y, w, color, h=12):
    return rect(sl, x, y, w, h, color, MSO_SHAPE.RIGHT_ARROW)


def connect(sl, x1, y1, x2, y2, color=RGBColor(0xC7, 0xD6, 0xEC), w=2):
    c = sl.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, I(x1), I(y1), I(x2), I(y2))
    c.line.color.rgb = color
    c.line.width = Pt(w)
    return c


prs = Presentation()
prs.slide_width = I(1280)
prs.slide_height = I(720)
BLANK = prs.slide_layouts[6]


def new():
    return prs.slides.add_slide(BLANK)


# ══════════════ 01 封面 ══════════════
s = new()
rect(s, 0, 0, 1280, 720, DARK)
rect(s, 780, -70, 540, 540, DARK2, MSO_SHAPE.OVAL)
rect(s, 1000, 390, 320, 320, MAIN2, MSO_SHAPE.OVAL)
rect(s, 660, 570, 660, 200, DEEP, MSO_SHAPE.OVAL)
rect(s, L, 200, 90, 5, ACC)
txt(s, L, 152, 700, 28, ["粤港澳大湾区 AI Coding 创新大赛 · AI 应用创新赛道"], size=17, color=SUB)
txt(s, L, 224, 760, 88, ["智学"], size=72, bold=True, color=WHITE, ls=1.1)
txt(s, L, 332, 760, 82, ["多模态教学智能体"], size=60, bold=True, color=WHITE, ls=1.1)
txt(s, L, 442, 700, 38, ["把一份讲义，变成一张可交互的知识网络"], size=26, color=RGBColor(0xCB, 0xD5, 0xE1))
txt(s, L, 496, 700, 30, ["零后端 · 纯前端 · 本地检索 ＋ 大模型生成"], size=17, color=MUTED)
rect(s, L, 546, 1, 74, RGBColor(0x33, 0x4E, 0x7A))
txt(s, 92, 548, 600, 34, ["越众队"], size=26, bold=True, color=WHITE, ls=1.2)
txt(s, 92, 612, 760, 30, ["李信诺（金融科技学院）  ·  李承杰（计算机与软件学院）"], size=16, color=FOOT)

# ══════════════ 02 目录 ══════════════
s = new()
header(s, "目录", 2)
rect(s, L, TOP, 300, 515, MAIN, MSO_SHAPE.ROUNDED_RECTANGLE, 0.04)
txt(s, 100, 172, 240, 26, ["CONTENTS"], size=15, bold=True, color=SOFTB, font=NUMF)
txt(s, 100, 208, 240, 56, ["作品导读"], size=34, bold=True, color=WHITE, ls=1.2)
txt(s, 100, 286, 240, 150,
    ["从真实教学痛点出发，", "拆解「智学」的能力构成、", "AI 技术路径与工程取舍，", "并交代团队的协作方式。"],
    size=16, color=RGBColor(0xDB, 0xEA, 0xFE), ls=1.75)

items = [
    ("01", "问题与定位", "讲义为什么用不起来，作品到底是什么"),
    ("02", "赛题对应", "方向一：AI + 教学管理助手"),
    ("03", "AI 能力拆解", "多模态解析 / 知识图谱 / RAG 答疑"),
    ("04", "工程与工具", "零后端架构、韧性设计、LearnBuddy 实践"),
    ("05", "团队", "跨专业组队与分工"),
]
yy = 140
for num, name, desc in items:
    txt(s, X2, yy, 62, 44, [num], size=30, bold=True, color=MAIN, font=NUMF, ls=1.0)
    txt(s, 486, yy + 3, 620, 36, [name], size=24, bold=True, color=TXT, ls=1.3)
    txt(s, 486, yy + 46, 640, 30, [desc], size=17, color=TXT2, ls=1.4)
    rect(s, X2, yy + 82, 800, 1, LINE)
    yy += 100

# ══════════════ 03 痛点 ══════════════
s = new()
header(s, "讲义为什么用不起来", 3)
txt(s, L, 140, 300, 200, ["3"], size=140, bold=True, color=ACC, font=NUMF, ls=1.0)
txt(s, 76, 320, 300, 40, ["类真实教学痛点"], size=24, bold=True, color=TXT, ls=1.3)
txt(s, 76, 372, 290, 110,
    ["设计之前我们先问自己：", "一份讲义拿到手之后，", "学生到底卡在哪一步？"],
    size=17, color=TXT2, ls=1.7)

pains = [
    ("讲义是静态的", "课件、PDF、截图堆在文件夹里，知识点散落各处，无法检索也无法关联，考前只能从头再翻一遍。"),
    ("复习没有抓手", "不知道哪些是重点、哪里没真正掌握，错题散落各处，缺少可量化的掌握度反馈。"),
    ("答疑排不上队", "课后问题得不到及时回应，老师反复解答同类问题，个性化辅导根本无从谈起。"),
]
yy = 140
for i, (t_, d_) in enumerate(pains):
    c = card(s, X2, yy, 800, 168, CARD)
    rect(s, X2, yy, 7, 168, MAIN if i != 2 else SUB)
    txt(s, 444, yy + 22, 90, 40, ["0%d" % (i + 1)], size=26, bold=True, color=MAIN, font=NUMF, ls=1.0)
    txt(s, 534, yy + 22, 660, 38, [t_], size=26, bold=True, color=TXT, ls=1.3)
    txt(s, 444, yy + 76, 742, 66, [d_], size=16, color=TXT2, ls=1.55)
    yy += 168

# ══════════════ 04 作品简介 ══════════════
s = new()
header(s, "作品简介", 4)
rect(s, L, 128, W, 322, DARK, MSO_SHAPE.ROUNDED_RECTANGLE, 0.035)
for i in range(3):
    dot(s, 102 + i * 22, 156, 10, RGBColor(0x47, 0x60, 0x8C))
rect(s, 168, 152, 460, 16, DEEP, MSO_SHAPE.ROUNDED_RECTANGLE, 0.5)
txt(s, 102, 192, 520, 28, ["智学 · 一站式学习工作台"], size=18, color=SUB)

mods = ["图文解析", "知识结构", "知识图谱", "答疑辅导", "练习测评", "学习报告", "知识库"]
mw, mgap = 148, 12
total = len(mods) * mw + (len(mods) - 1) * mgap
mx = L + (W - total) / 2
for i, m in enumerate(mods):
    x = mx + i * (mw + mgap)
    rect(s, x, 238, mw, 88, MAIN2 if i < 4 else SUB, MSO_SHAPE.ROUNDED_RECTANGLE, 0.09)
    txt(s, x, 248, mw, 24, ["0%d" % (i + 1)], size=13, bold=True, color=SOFTB,
        align=PP_ALIGN.CENTER, font=NUMF, ls=1.1)
    txt(s, x, 274, mw, 38, [m], size=17, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, ls=1.2)
    if i < len(mods) - 1:
        arrow(s, x + mw + 1, 278, mgap - 2, RGBColor(0x33, 0x55, 0x88), h=10)
txt(s, 102, 352, 1076, 60,
    ["上传讲义 → 自动解析知识点 → 生成思维导图与关系图谱 → 基于原文答疑 → 自动出题并生成学习报告"],
    size=18, color=SOFTC, align=PP_ALIGN.CENTER, ls=1.5)

txt(s, L, 456, W, 40,
    ["一句话定位：把静态讲义重组成可检索、可关联、可检验的知识网络"],
    size=22, bold=True, color=TXT, ls=1.4)
card(s, L, 520, 560, 122)
txt(s, 96, 542, 520, 30, ["源码版"], size=20, bold=True, color=MAIN, ls=1.3)
txt(s, 96, 594, 528, 30, ["原生 ES Module，分模块组织，便于二次开发。"],
    size=16, color=TXT2, ls=1.4)
card(s, 650, 520, 560, 122)
txt(s, 676, 542, 520, 30, ["单文件版"], size=20, bold=True, color=MAIN, ls=1.3)
txt(s, 676, 594, 528, 30, ["CSS / JS 全内联为一个 HTML，双击即可运行。"],
    size=16, color=TXT2, ls=1.4)

# ══════════════ 05 赛题方向 ══════════════
s = new()
rect(s, 0, 0, 1280, 720, MAIN)
rect(s, 640, -90, 680, 680, MAIN2, MSO_SHAPE.OVAL)
rect(s, -70, 470, 440, 440, SUB, MSO_SHAPE.OVAL)
txt(s, 140, 152, 1000, 28, ["SAI  TI  FANG  XIANG"], size=16, bold=True,
    color=SOFTB, align=PP_ALIGN.CENTER, font=NUMF)
txt(s, 140, 196, 1000, 80, ["方向一"], size=56, bold=True, color=WHITE, align=PP_ALIGN.CENTER, ls=1.2)
txt(s, 140, 284, 1000, 76, ["AI + 教学管理助手"], size=48, bold=True, color=WHITE,
    align=PP_ALIGN.CENTER, ls=1.2)
rect(s, 590, 374, 100, 6, ACC)
txt(s, 140, 394, 1000, 84, ["多模态教学智能体"], size=52, bold=True, color=ACC,
    align=PP_ALIGN.CENTER, ls=1.2)
txt(s, 200, 500, 880, 90,
    ["与赛事手册给出的示例题目完全对应：以多模态输入（讲义图片 / 文本）为入口，",
     "完成知识点结构化、知识图谱构建、智能答疑与学习评估的完整闭环。"],
    size=19, color=RGBColor(0xDB, 0xEA, 0xFE), align=PP_ALIGN.CENTER, ls=1.65)
txt(s, 140, 664, 1000, 28, ["深大计软 × 腾讯云 · 粤港澳大湾区 AI Coding 创新大赛"], size=15,
    color=SOFTB, align=PP_ALIGN.CENTER)

# ══════════════ 06 核心流程 ══════════════
s = new()
header(s, "从一份讲义到一张知识网络", 6)
steps = [
    ("素材输入", "讲义截图、照片，或直接粘贴文本"),
    ("图文解析", "视觉分析 + OCR 识别，失败自动降级"),
    ("知识点抽取", "术语、公式、概念关系自动识别"),
    ("结构与图谱", "思维导图 + 力导向知识图谱"),
    ("智能答疑", "本地检索 ＋ 大模型生成（RAG）"),
    ("测评与报告", "自动出题、判分、掌握度雷达图"),
]
yy = 136
for i, (name, desc) in enumerate(steps):
    card(s, L, yy, 690, 78, WHITE if i % 2 == 0 else CARD)
    rect(s, L, yy, 7, 78, MAIN if i % 2 == 0 else SUB)
    dot(s, 96, yy + 8, 38, MAIN if i % 2 == 0 else SUB)
    txt(s, 96, yy + 8, 38, 38, [str(i + 1)], size=17, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, font=NUMF, anchor=MSO_ANCHOR.MIDDLE)
    txt(s, 150, yy + 1, 230, 32, [name], size=21, bold=True, color=TXT, ls=1.3)
    txt(s, 150, yy + 40, 580, 24, [desc], size=15, color=TXT2, ls=1.35)
    if i < len(steps) - 1:
        arrow(s, 400, yy + 79, 24, LINE, h=4)
    yy += 84

card(s, X3, 136, 480, 508)
txt(s, 758, 164, 424, 42, ["设计取舍"], size=24, bold=True, color=MAIN, ls=1.3)
txt(s, 758, 222, 424, 300,
    ["整条链路不依赖后端，",
     "每一步都在浏览器本地完成。",
     "输出能被下一步复用：",
     "解析结果进入语料库，",
     "知识点既喂给图谱，",
     "也喂给答疑和出题。",
     "一次输入，六个环节自动串起。"],
    size=16, color=TXT2, ls=1.6)
rect(s, 758, 556, 424, 62, MAIN, MSO_SHAPE.ROUNDED_RECTANGLE, 0.1)
txt(s, 758, 556, 424, 62, ["一次输入，全链路复用"], size=19, bold=True, color=WHITE,
    align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)

# ══════════════ 07 多模态解析 ══════════════
s = new()
header(s, "AI 能力一：多模态图文解析", 7)
rect(s, L, TOP, 640, 500, DARK, MSO_SHAPE.ROUNDED_RECTANGLE, 0.035)
rect(s, 96, 158, 560, 272, DEEP, MSO_SHAPE.ROUNDED_RECTANGLE, 0.02)
for i in range(7):
    rect(s, 116, 190 + i * 32, 300 + (i % 3) * 70, 9, RGBColor(0x3B, 0x5B, 0x8C),
         MSO_SHAPE.ROUNDED_RECTANGLE, 0.5)
rect(s, 116, 186, 520, 3, SUB)
rect(s, 116, 402, 520, 3, SUB)
txt(s, 96, 442, 560, 26, ["扫描线 → 文字区定位"], size=15, color=SUB)

metrics = [("尺寸", "画幅与分辨率"), ("主色", "色彩分布提取"), ("清晰度", "梯度方差估计"),
           ("倾斜", "边缘角度检测"), ("分栏", "版面结构判定"), ("文字区", "文本块定位")]
mw2, mgap2 = 86, 8
mtotal = len(metrics) * mw2 + (len(metrics) - 1) * mgap2
mx2 = 96 + (560 - mtotal) / 2
for i, (m, d_) in enumerate(metrics):
    x = mx2 + i * (mw2 + mgap2)
    rect(s, x, 470, mw2, 64, MAIN2, MSO_SHAPE.ROUNDED_RECTANGLE, 0.12)
    txt(s, x, 478, mw2, 26, [m], size=16, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, ls=1.15)
    txt(s, x, 505, mw2, 22, [d_], size=11, color=SOFTB, align=PP_ALIGN.CENTER, ls=1.1)
txt(s, 96, 548, 560, 30, ["六维视觉指标实时计算"], size=18, bold=True, color=SUB, ls=1.3)
txt(s, 96, 586, 560, 24,
    ["纯 Canvas 2D 逐像素分析，不调用任何视觉云服务。"],
    size=14, color=SOFTC, ls=1.5)

blocks = [
    ("OCR 文字识别", "集成 Tesseract.js，联网下载一次中文模型后即可离线识别，中英文混排可用。", MAIN, PANEL),
    ("失败自动降级", "模型下载失败或识别超时，自动切换为「粘贴文本」通道，其余功能完全不受影响。", ACC, AMBERBG),
    ("素材统一入库", "识别结果与手动输入走同一套语料结构，后续抽取、答疑、出题无需区分来源。", SUB, PANEL),
]
yy = 136
for t_, d_, c, bg in blocks:
    card(s, X3, yy, 480, 156, bg)
    rect(s, X3, yy, 7, 156, c)
    txt(s, 758, yy + 18, 430, 34, [t_], size=22, bold=True, color=TXT, ls=1.3)
    txt(s, 758, yy + 60, 434, 82, [d_], size=16, color=TXT2, ls=1.55)
    yy += 168

# ══════════════ 08 知识图谱 ══════════════
s = new()
header(s, "AI 能力二：知识抽取与图谱", 8)
cx, cy, RX, RY = 380, 382, 160, 168
nodes = ["光合作用", "叶绿体", "光反应", "暗反应", "ATP", "葡萄糖"]
sat = []
for i, n in enumerate(nodes):
    a = math.pi / 2 + i * (2 * math.pi / len(nodes))
    sat.append((cx + RX * math.cos(a), cy + RY * math.sin(a), n))
for (x, y, _) in sat:
    connect(s, cx, cy, x, y)
dot(s, cx - 68, cy - 68, 136, MAIN)
txt(s, cx - 68, cy - 68, 136, 136, ["知识点"], size=21, bold=True, color=WHITE,
    align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
for i, (x, y, n) in enumerate(sat):
    rect(s, x - 62, y - 22, 124, 44, SUB if i % 2 == 0 else MAIN2,
         MSO_SHAPE.ROUNDED_RECTANGLE, 0.3)
    txt(s, x - 62, y - 22, 124, 44, [n], size=15, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
txt(s, 96, 596, 620, 30, ["力导向关系图谱 · Canvas 手绘 · 支持拖拽钉住与缩放"], size=15, color=FOOT)

algos = [
    ("分词与向量化", "按 n-gram 与词典混合切分，构建词频向量。"),
    ("TF-IDF 加权", "压低通用词权重，让专业术语浮上来。"),
    ("余弦相似度", "用向量夹角衡量知识点相关度。"),
    ("Dice 系数", "补充字面重合度，提升短术语匹配率。"),
]
yy = 136
for t_, d_ in algos:
    card(s, X3, yy, 480, 110)
    rect(s, X3, yy, 7, 110, SUB)
    txt(s, 758, yy + 18, 430, 32, [t_], size=20, bold=True, color=TXT, ls=1.3)
    txt(s, 758, yy + 60, 434, 30, [d_], size=15, color=TXT2, ls=1.45)
    yy += 126

# ══════════════ 09 RAG 答疑（Hero） ══════════════
s = new()
header(s, "AI 能力三：RAG 智能答疑", 9)
txt(s, L, 140, 300, 200, ["4"], size=140, bold=True, color=ACC, font=NUMF, ls=1.0)
txt(s, 76, 320, 300, 40, ["种讲解方式"], size=24, bold=True, color=TXT, ls=1.3)
txt(s, 76, 372, 280, 170,
    ["直接回答 / 分步讲解", "举例说明 / 引导启发", "",
     "风格约束一并传给大模型", "同一个问题，讲出四种味道。"],
    size=16, color=TXT2, ls=1.7)

chain = ["学生提问", "本地检索", "素材片段", "大模型生成", "带标签答案"]
cw, cgap = 158, 16
ctx = 350
for i, c in enumerate(chain):
    x = ctx + i * (cw + cgap)
    fill = MAIN if i in (1, 3) else (MAIN2 if i == 2 else DEEP)
    rect(s, x, 148, cw, 92, fill, MSO_SHAPE.ROUNDED_RECTANGLE, 0.08)
    txt(s, x, 148, cw, 92, [c], size=17, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    if i < len(chain) - 1:
        arrow(s, x + cw + 2, 188, cgap - 4, SOFTB, h=12)
    if i in (1, 3):
        txt(s, x, 248, cw, 26, ["检索层 R" if i == 1 else "生成层 G"], size=13,
            color=MAIN if i == 1 else ACC, align=PP_ALIGN.CENTER)

card(s, 350, 284, 854, 166)
txt(s, 378, 302, 798, 34, ["为什么是 RAG，而不是直接问大模型？"], size=21, bold=True, color=TXT, ls=1.3)
txt(s, 378, 356, 798, 76,
    ["本地检索负责「找得准」：TF-IDF 与余弦相似度从你自己的材料里召回原文；",
     "大模型负责「讲得好」：素材里没写的一律声明，抑制幻觉。"],
    size=16, color=TXT2, ls=1.55)

txt(s, 350, 466, 854, 32, ["四种讲解方式（透传至大模型）"], size=19, bold=True, color=TXT, ls=1.3)
modes = ["直接回答", "分步讲解", "举例说明", "引导启发"]
mcw, mgap3 = 198, 20
for i, m in enumerate(modes):
    x = 350 + i * (mcw + mgap3)
    rect(s, x, 508, mcw, 56, CARD if i != 3 else AMBERBG,
         MSO_SHAPE.ROUNDED_RECTANGLE, 0.1, MAIN if i != 3 else ACC, 1.5)
    txt(s, x, 508, mcw, 56, [m], size=18, bold=True, color=MAIN if i != 3 else ACC,
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
rect(s, 350, 576, 854, 58, AMBERBG, MSO_SHAPE.ROUNDED_RECTANGLE, 0.1, ACC, 1.5)
txt(s, 378, 582, 798, 30,
    ["大模型不可用、超时或鉴权失败时，自动降级为本地引擎，核心功能零中断。"],
    size=16, color=AMBER, ls=1.5)

# ══════════════ 10 技术方案 ══════════════
s = new()
header(s, "技术方案", 10)
rect(s, L, TOP, 300, 515, MAIN, MSO_SHAPE.ROUNDED_RECTANGLE, 0.04)
txt(s, 100, 172, 240, 26, ["ARCHITECTURE"], size=15, bold=True, color=SOFTB, font=NUMF)
txt(s, 100, 208, 240, 56, ["四层技术栈"], size=32, bold=True, color=WHITE, ls=1.2)
txt(s, 100, 286, 240, 160,
    ["零构建、零依赖、零后端。", "全部由原生 HTML / CSS /", "JavaScript 实现，起一个", "静态服务器就能跑起来。"],
    size=16, color=RGBColor(0xDB, 0xEA, 0xFE), ls=1.75)

layers = [
    ("界面与交互层", "原生 HTML + CSS，七个功能面板单页切换，无框架无打包，源码即产物。", MAIN),
    ("图形渲染层", "图像视觉分析、知识图谱、思维导图与雷达图，全部 Canvas 2D 手绘。", SUB),
    ("算法层", "分词向量化、TF-IDF、余弦相似度、Dice 系数、自动出题与判分。", MAIN),
    ("模型接入层", "OpenAI 兼容协议封装，可切换多家大模型，密钥仅存本地。", ACC),
]
yy = 136
for i, (t_, d_, c) in enumerate(layers):
    card(s, X2, yy, 800, 118, CARD if i % 2 == 0 else PANEL)
    rect(s, X2, yy, 7, 118, c)
    txt(s, 438, yy + 16, 300, 32, [t_], size=21, bold=True, color=TXT, ls=1.3)
    txt(s, 438, yy + 58, 754, 30, [d_], size=16, color=TXT2, ls=1.45)
    yy += 128

# ══════════════ 11 工程三个坚持 ══════════════
s = new()
header(s, "工程上的三个坚持", 11)
rect(s, L, 128, W, 192, DARK, MSO_SHAPE.ROUNDED_RECTANGLE, 0.045)
txt(s, 108, 156, 1064, 44,
    ["不为演示方便牺牲架构：能本地算的绝不依赖服务，能降级的绝不硬失败。"],
    size=24, bold=True, color=WHITE, ls=1.3)
txt(s, 108, 214, 1064, 80,
    ["三条原则贯穿全部模块——它们不是加分项，而是决定这个工具能不能真正被老师与学生日常使用的基本盘。"],
    size=17, color=SOFTC, ls=1.55)
for i, c in enumerate([MAIN, SUB, ACC]):
    dot(s, 900 + i * 58, 264, 24, c)

cards = [
    ("零后端部署", "整个项目是静态文件，单文件版双击即用；无服务器、无数据库、无运维成本。", MAIN, "零运维"),
    ("失败可降级", "OCR 下载失败走手动粘贴；大模型超时或鉴权失败自动回退本地引擎，不白屏。", ACC, "零中断"),
    ("数据不出本机", "讲义、语料、错题留在浏览器内存；密钥只写 localStorage，不进代码、不进仓库。", SUB, "零上传"),
]
cw3 = (W - 2 * 18) / 3.0
xx = L
for i, (t_, d_, c, tag) in enumerate(cards):
    card(s, xx, 340, cw3, 300)
    rect(s, xx, 340, cw3, 8, c)
    dot(s, xx + 28, 372, 46, c)
    txt(s, xx + 28, 372, 46, 46, [str(i + 1)], size=20, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, font=NUMF, anchor=MSO_ANCHOR.MIDDLE)
    txt(s, xx + 28, 438, cw3 - 56, 36, [t_], size=23, bold=True, color=TXT, ls=1.3)
    txt(s, xx + 28, 482, cw3 - 56, 100, [d_], size=14, color=TXT2, ls=1.55)
    rect(s, xx + 28, 596, cw3 - 56, 36, c)
    txt(s, xx + 28, 596, cw3 - 56, 36, [tag], size=14, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    xx += cw3 + 18

# ══════════════ 12 LearnBuddy（Hero） ══════════════
s = new()
header(s, "我们用 LearnBuddy 是怎么做的", 12)
txt(s, L, 140, 300, 200, ["5"], size=140, bold=True, color=ACC, font=NUMF, ls=1.0)
txt(s, 76, 320, 300, 40, ["个环节"], size=24, bold=True, color=TXT, ls=1.3)
txt(s, 76, 372, 290, 190,
    ["AI 承担执行与加速，", "选题、架构权衡、", "内容把关与最终决策，", "始终由我们两个人拍板。"],
    size=16, color=TXT2, ls=1.7)

lb = [
    ("需求与方案", "多轮讨论赛题与技术路线，自主选定「自带密钥 + 前端直连」。"),
    ("编码与调试", "模块级代码生成与逐个问题修复，打包、跨域等问题由我们定位。"),
    ("工程自动化", "源码抓取与还原、单文件打包、仓库推送，全部 AI 脚本化完成。"),
    ("文档与物料", "说明文档、视频脚本、操作指南与作品介绍，均由我们审阅定稿。"),
    ("过程可追溯", "完整对话记录随作品提交，人机分工清晰——AI 是工具不是替代者。"),
]
yy = 136
for i, (t_, d_) in enumerate(lb):
    card(s, 400, yy, 810, 92, CARD if i % 2 == 0 else PANEL)
    dot(s, 426, yy + 16, 40, MAIN if i % 2 == 0 else SUB)
    txt(s, 426, yy + 16, 40, 40, [str(i + 1)], size=17, bold=True, color=WHITE,
        align=PP_ALIGN.CENTER, font=NUMF, anchor=MSO_ANCHOR.MIDDLE)
    txt(s, 484, yy + 12, 240, 30, [t_], size=20, bold=True, color=TXT, ls=1.3)
    txt(s, 484, yy + 52, 698, 30, [d_], size=15, color=TXT2, ls=1.45)
    yy += 100

# ══════════════ 13 团队 ══════════════
s = new()
header(s, "团队成员", 13)
people = [
    ("李信诺", "金融科技学院",
     ["从教学场景与学习者视角定义需求，", "负责知识结构、题库口径与答辩材料。"],
     MAIN, RGBColor(0xDB, 0xEA, 0xFE)),
    ("李承杰", "计算机与软件学院",
     ["负责前端架构与算法实现，", "含图文解析、图谱渲染、RAG 与容错。"],
     SUB, RGBColor(0xC7, 0xF0, 0xFA)),
]
yy = 136
for name, dept, descs, c, soft in people:
    rect(s, L, yy, 560, 224, c, MSO_SHAPE.ROUNDED_RECTANGLE, 0.05)
    txt(s, 100, yy + 28, 500, 46, [name], size=30, bold=True, color=WHITE, ls=1.2)
    txt(s, 100, yy + 80, 500, 36, [dept], size=22, color=soft, ls=1.3)
    txt(s, 100, yy + 130, 500, 80, descs, size=16, color=soft, ls=1.55)
    yy += 240

card(s, X3, 136, 480, 120)
txt(s, 758, 156, 424, 32, ["共同完成"], size=22, bold=True, color=TXT, ls=1.3)
txt(s, 758, 196, 424, 30, ["两人共同完成前端开发与智能体整体构建。"],
    size=15, color=TXT2, ls=1.5)

rect(s, X3, 272, 480, 152, AMBERBG, MSO_SHAPE.ROUNDED_RECTANGLE, 0.05, ACC, 1.5)
txt(s, 758, 292, 424, 32, ["跨专业组队"], size=22, bold=True, color=AMBER, ls=1.3)
txt(s, 758, 330, 424, 60,
    ["金融科技 × 计算机与软件，业务视角", "与工程能力互补，既贴场景又保证质量。"],
    size=15, color=AMBER, ls=1.5)

rect(s, X3, 440, 480, 160, DARK, MSO_SHAPE.ROUNDED_RECTANGLE, 0.05)
txt(s, 758, 460, 424, 32, ["队名：越众"], size=22, bold=True, color=WHITE, ls=1.3)
txt(s, 758, 498, 424, 76,
    ["取「越过众人」之意——不追逐更大的模型，而是把已有的能力组织得更好用一点。"],
    size=15, color=SOFTC, ls=1.5)

# ══════════════ 14 结束页 ══════════════
s = new()
rect(s, 0, 0, 1280, 720, DARK)
rect(s, 850, -90, 540, 540, DARK2, MSO_SHAPE.OVAL)
rect(s, -90, 420, 420, 420, MAIN2, MSO_SHAPE.OVAL)
rect(s, 640, 300, 90, 6, ACC)
txt(s, 140, 248, 1000, 88, ["让每一份讲义，"], size=54, bold=True, color=WHITE,
    align=PP_ALIGN.CENTER, ls=1.2)
txt(s, 140, 342, 1000, 88, ["都变成可交互的知识网络"], size=54, bold=True, color=WHITE,
    align=PP_ALIGN.CENTER, ls=1.2)
txt(s, 140, 456, 1000, 38, ["智学 · 多模态教学智能体"], size=24, color=SUB, align=PP_ALIGN.CENTER)
txt(s, 140, 566, 1000, 32, ["越众队 · 李信诺 · 李承杰"], size=19, color=MUTED, align=PP_ALIGN.CENTER)
txt(s, 140, 612, 1000, 28, ["深大计软 × 腾讯云 · 粤港澳大湾区 AI Coding 创新大赛"], size=15,
    color=FOOT, align=PP_ALIGN.CENTER)

out = r"C:\Users\86180\LearnBuddy\2026-09-24-17-58-17\智学-教学智能体-作品介绍.pptx"
prs.save(out)
print("SAVED", out, "slides =", len(prs.slides._sldIdLst))
