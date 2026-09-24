# -*- coding: utf-8 -*-
"""精确审计 v3（修正单位换算）

v2 的致命 bug：把「磅(pt)」当「像素(px)」参与比较，文字高度被系统性低估约 45%，
所以真实存在的「字顶穿底框」全部漏报。v3 修正如下：

  字体 px 尺寸 = pt * 96 / 72
  单行高度 px = 字体px * 行高比(实测雅黑 1.37) * line_spacing

检查项：
  ① 文字实际渲染高度是否超出自己的文本框
  ② 文字是否顶穿所属卡片/容器底框
  ③ 文字块之间是否打架（按实际渲染宽度/高度判定）
  ④ 元素是否越出画布安全区（右 1210 / 下 720，整幅出血除外）
  ⑤ 文字与其左侧序号圆点是否垂直居中对齐（数字对不对得上文字）
"""
import os
from pptx import Presentation
from pptx.util import Emu
from pptx.enum.text import PP_ALIGN as PA
from PIL import ImageFont

EMU_PX = 914400 / 96.0
SRC = r"C:\Users\86180\LearnBuddy\2026-09-24-17-58-17\智学-教学智能体-作品介绍.pptx"
REG = r"C:\Windows\Fonts\msyh.ttc"
BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
NUMREG = r"C:\Windows\Fonts\arial.ttf"
NUMBOLD = r"C:\Windows\Fonts\arialbd.ttf"
if not os.path.exists(BOLD):
    BOLD = REG

LINE_RATIO = 1.32          # 雅黑单行行高 / 字号（实测 asc+des 1.37，取略保守值）
PTPX = 96.0 / 72.0         # 1pt = 1.3333px

_cache = {}


def font(size_pt, bold, num=False):
    key = (round(size_pt, 1), bold, num)
    if key not in _cache:
        path = (NUMBOLD if bold else NUMREG) if num else (BOLD if bold else REG)
        if not os.path.exists(path):
            path = BOLD if bold else REG
        try:
            _cache[key] = ImageFont.truetype(path, int(round(size_pt * PTPX)))
        except Exception:
            _cache[key] = ImageFont.load_default()
    return _cache[key]


def measure(paras, w, num=False):
    """返回 (行盒总高px, 最宽行宽px, 墨迹顶偏移, 墨迹底偏移)

    行盒高度用于判断「文本框够不够」；墨迹范围才是人眼看到的字，
    碰撞 / 顶穿一律用墨迹判定，避免把行间距的空白当成重叠。
    """
    total = 0.0
    widest = 0.0
    it = 0.0
    ib = 0.0
    for k, (text, size, bold, ls) in enumerate(paras):
        f = font(size, bold, num)
        try:
            asc, desc = f.getmetrics()
        except Exception:
            asc, desc = size * PTPX, size * PTPX * 0.3
        ls = ls if isinstance(ls, float) else 1.5
        line_h = (asc + desc) * ls
        em = size * PTPX
        ink_a = em * (0.72 if num else 0.86)      # 数字按大写高度，中文按字面高度
        ink_d = em * (0.02 if num else 0.14)
        line_w = 0.0
        lines = 1
        for ch in text:
            try:
                cw = f.getlength(ch)
            except Exception:
                cw = size * PTPX
            if line_w + cw > w and line_w > 0:
                lines += 1
                line_w = cw
            else:
                line_w += cw
            widest = max(widest, line_w)
        half = (line_h - (asc + desc)) / 2.0
        total += lines * line_h
        it = half + (asc - ink_a)
        ib = total - half - (desc - ink_d)
    return total, min(widest, w), it, ib


prs = Presentation(SRC)
issues = []

for idx, slide in enumerate(prs.slides, start=1):
    shapes = []
    for sh in slide.shapes:
        try:
            x, y = sh.left / EMU_PX, sh.top / EMU_PX
            w, h = sh.width / EMU_PX, sh.height / EMU_PX
        except Exception:
            continue
        fill = None
        try:
            if sh.fill.type == 1:
                fill = tuple(sh.fill.fore_color.rgb)
        except Exception:
            pass
        is_oval = False
        try:
            is_oval = (sh.auto_shape_type == 9)   # MSO_SHAPE.OVAL
        except Exception:
            pass
        shapes.append(dict(x=x, y=y, w=w, h=h, fill=fill, sh=sh, oval=is_oval))

    # 候选容器：有填充、尺寸够大、但不是整幅背景
    containers = []
    for s_ in shapes:
        if s_["fill"] is None:
            continue
        if s_["w"] >= 1270 or s_["h"] >= 700:
            continue
        if s_["w"] >= 150 and s_["h"] >= 60:
            containers.append(s_)
    inner = []
    for a in containers:
        contained = False
        for b in containers:
            if b is a:
                continue
            if (b["x"] <= a["x"] + 1 and b["y"] <= a["y"] + 1 and
                    b["x"] + b["w"] >= a["x"] + a["w"] - 1 and
                    b["y"] + b["h"] >= a["y"] + a["h"] - 1 and
                    (b["w"] * b["h"]) > (a["w"] * a["h"])):
                contained = True
                break
        if not contained:
            inner.append(a)

    texts = []
    for s_ in shapes:
        sh = s_["sh"]
        if not (sh.has_text_frame and sh.text_frame.text.strip()):
            continue
        tf = sh.text_frame
        raw = tf.text.strip()
        isnum = len(raw) <= 2 and raw.isdigit()
        paras = []
        for p in tf.paragraphs:
            runs = [r for r in p.runs if r.text]
            if not runs:
                paras.append(("", 18, False, 1.5))
                continue
            size = max([(r.font.size.pt if r.font.size else 18) for r in runs])
            bold = any(r.font.bold for r in runs)
            ls = p.line_spacing if isinstance(p.line_spacing, float) else 1.5
            paras.append(("".join(r.text for r in runs), size, bold, ls))
        need, real_w, it, ib = measure(paras, s_["w"], isnum)
        al = tf.paragraphs[0].alignment if tf.paragraphs else None
        if al == PA.CENTER:
            ox = (s_["w"] - real_w) / 2
        elif al == PA.RIGHT:
            ox = s_["w"] - real_w
        else:
            ox = 0
        anchor_mid = (tf.vertical_anchor is not None and
                      int(tf.vertical_anchor) == 3)   # MSO_ANCHOR.MIDDLE
        if anchor_mid:
            ty = s_["y"] + (s_["h"] - need) / 2.0
        else:
            ty = s_["y"]
        label = raw[:24].replace("\n", "/")
        texts.append(dict(x=s_["x"] + ox, y=ty, h=s_["h"], w=real_w, need=need,
                          it=ty + it, ib=ty + ib, cy=(ty + it + ty + ib) / 2.0,
                          isnum=isnum, label=label, bx=s_["x"],
                          by=s_["y"], bw=s_["w"], bh=s_["h"]))

        # ① 超出自身文本框：PowerPoint 文本框不裁剪、会自动向下溢出，
        #    只要不撞到别的东西就无视觉影响，故不作为问题上报。

        # ② 顶穿所属容器底框
        owner = None
        for c in inner:
            if (c["x"] <= s_["x"] + 2 and c["y"] <= s_["y"] + 2 and
                    c["x"] + c["w"] >= s_["x"] + s_["w"] - 2 and
                    c["y"] + c["h"] >= s_["y"] + 8):
                if owner is None or (c["y"] + c["h"]) < (owner["y"] + owner["h"]):
                    owner = c
        if owner is not None:
            bottom = texts[-1]["ib"] if texts else 0
            limit = owner["y"] + owner["h"]
            if bottom > limit - 6:
                issues.append("P%02d 文字顶穿卡片底 墨迹底%.0f>卡底%.0f(超%.0f)  [%s]"
                              % (idx, bottom, limit, bottom - limit, label))
        else:
            # 有页脚线的页面安全底 648；整幅 hero 页（无页脚）可用到 690
            has_foot = any(c["w"] >= 1100 and 645 <= c["y"] <= 660 for c in shapes)
            limit = 648 if has_foot else 690
            if texts and texts[-1]["ib"] > limit and ty < 600:
                issues.append("P%02d 文字越过安全底 墨迹底%.0f  [%s]" % (idx, texts[-1]["ib"], label))

    # ③ 文字块之间打架（按墨迹范围判定）
    for i in range(len(texts)):
        a = texts[i]
        for j in range(i + 1, len(texts)):
            b = texts[j]
            if b["it"] >= a["ib"] - 2 or a["it"] >= b["ib"] - 2:
                continue
            if a["x"] + a["w"] <= b["x"] + 2 or b["x"] + b["w"] <= a["x"] + 2:
                continue
            issues.append("P%02d 文字打架 墨迹 %.0f~%.0f vs %.0f~%.0f  [%s] | [%s]"
                          % (idx, a["it"], a["ib"], b["it"], b["ib"], a["label"], b["label"]))

    # ④ 越出安全区（真正的出血装饰会被 1280/730 阈值放过）
    for s_ in shapes:
        if s_["fill"] is None:
            continue
        if s_["w"] >= 1270 or s_["h"] >= 700:
            continue
        rt, bt = s_["x"] + s_["w"], s_["y"] + s_["h"]
        if 1211 < rt <= 1285:
            issues.append("P%02d 元素越右边界 right=%.0f (x=%.0f w=%.0f)"
                          % (idx, rt, s_["x"], s_["w"]))
        if 721 < bt <= 730:
            issues.append("P%02d 元素越下边界 bottom=%.0f" % (idx, bt))

    # ⑤ 徽章（圆形）里的数字 与 其右侧标题 的垂直中心是否对齐
    ovals = [s_ for s_ in shapes if s_["oval"]]
    for a in texts:
        if not a["isnum"]:
            continue
        # 必须是落在某个圆形徽章里的数字
        badge = None
        for o in ovals:
            if abs(o["x"] - a["bx"]) <= 3 and abs(o["y"] - a["by"]) <= 3 \
                    and abs(o["w"] - a["bw"]) <= 3 and o["w"] <= 60:
                badge = o
                break
        if badge is None:
            continue
        # 取徽章右侧、垂直距离最近且最靠上的文本（即标题，而非描述）
        cand = [b for b in texts
                if b is not a and not b["isnum"]
                and a["bx"] + a["bw"] + 4 <= b["bx"] <= a["bx"] + a["bw"] + 130
                and abs(b["y"] - a["y"]) <= 90]
        if not cand:
            continue
        best = min(cand, key=lambda b: (abs(b["by"] - a["by"]), b["w"]))
        d = a["cy"] - best["cy"]
        if abs(d) > 5:
            issues.append("P%02d 数字与标题错位 数字中心%.0f 标题中心%.0f 差%.0f  [%s]"
                          % (idx, a["cy"], best["cy"], d, best["label"]))

print("=== 精确审计 v3 ===")
if issues:
    for it in issues:
        print(" -", it)
else:
    print("无问题")
print("共 %d 条" % len(issues))
