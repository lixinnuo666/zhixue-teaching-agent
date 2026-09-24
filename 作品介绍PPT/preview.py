# -*- coding: utf-8 -*-
"""把 PPT 每页渲染成缩略图拼版，用于人工目视检查排版"""
import os
from pptx import Presentation
from pptx.util import Emu
from PIL import Image, ImageDraw, ImageFont

EMU_PX = 914400 / 96.0
SRC = r"C:\Users\86180\LearnBuddy\2026-09-24-17-58-17\智学-教学智能体-作品介绍.pptx"
OUT = r"C:\Users\86180\LearnBuddy\2026-09-24-17-58-17\作品介绍PPT\preview.png"
import sys

S = 0.4  # 缩放
# 支持 --pages 6,11,12 --scale 0.8 只看某几页的大图
ONLY = None
for a in sys.argv[1:]:
    if a.startswith("--pages"):
        ONLY = [int(v) for v in a.split("=", 1)[1].split(",")] if "=" in a else None
    if a.startswith("--scale="):
        S = float(a.split("=", 1)[1])
if "--pages" in sys.argv:
    ONLY = [int(v) for v in sys.argv[sys.argv.index("--pages") + 1].split(",")]

FONT_PATHS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]
FP = None
for p in FONT_PATHS:
    if os.path.exists(p):
        FP = p
        break
print("font:", FP)

prs = Presentation(SRC)
W = int(prs.slide_width / EMU_PX * S)
H = int(prs.slide_height / EMU_PX * S)
COLS = 3
pages = list(prs.slides)
if ONLY:
    pages = [pages[k - 1] for k in ONLY]
    COLS = min(3, len(pages))
rows = (len(pages) + COLS - 1) // COLS
sheet = Image.new("RGB", (W * COLS + 20 * (COLS + 1), H * rows + 20 * (rows + 1)), (230, 235, 242))
sd = ImageDraw.Draw(sheet)


def rgb(c):
    try:
        return (c[0], c[1], c[2])
    except Exception:
        return (200, 200, 200)


def fill_of(sh):
    try:
        f = sh.fill
        if f.type is not None and f.type == 1:
            return rgb(f.fore_color.rgb)
    except Exception:
        pass
    return None


for i, slide in enumerate(pages):
    r, c = divmod(i, COLS)
    px = 20 + c * (W + 20)
    py = 20 + r * (H + 20)
    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for sh in slide.shapes:
        try:
            x = sh.left / EMU_PX * S
            y = sh.top / EMU_PX * S
            w = sh.width / EMU_PX * S
            h = sh.height / EMU_PX * S
        except Exception:
            continue
        col = fill_of(sh)
        nm = str(sh.shape_type)
        box = [x, y, x + w, y + h]
        if box[2] <= 0 or box[3] <= 0 or box[0] >= W or box[1] >= H:
            continue
        box[0] = max(box[0], -2)
        box[1] = max(box[1], -2)
        box[2] = min(box[2], W + 2)
        box[3] = min(box[3], H + 2)
        try:
            if "OVAL" in nm:
                d.ellipse(box, fill=col)
            elif col is not None:
                d.rectangle(box, fill=col)
            elif sh.has_text_frame and sh.text_frame.text.strip():
                pass
            else:
                d.rectangle(box, outline=(210, 216, 226))
        except Exception:
            pass
        if sh.has_text_frame and sh.text_frame.text.strip():
            yy = box[1] + 1
            for p in sh.text_frame.paragraphs:
                line = "".join(run.text for run in p.runs)
                if not line:
                    yy += 4
                    continue
                sz = max([run.font.size.pt for run in p.runs if run.font.size] or [18])
                bold = any(run.font.bold for run in p.runs)
                colr = None
                for run in p.runs:
                    try:
                        if run.font.color and run.font.color.type is not None:
                            colr = rgb(run.font.color.rgb)
                            break
                    except Exception:
                        pass
                fsz = max(6, int(sz * S))
                try:
                    fnt = ImageFont.truetype(FP, fsz, index=(1 if bold and FP.endswith("ttc") else 0))
                except Exception:
                    fnt = ImageFont.load_default()
                per = max(1, int((box[2] - box[0]) / (fsz * 0.98)))
                for k in range(0, max(1, -(-len(line) // per))):
                    seg = line[k * per:(k + 1) * per]
                    try:
                        d.text((box[0] + 1, yy), seg, font=fnt, fill=colr or (30, 30, 30))
                    except Exception:
                        pass
                    yy += int(fsz * 1.35)
                yy += 2
    sheet.paste(img, (px, py))
    sd.rectangle([px - 1, py - 1, px + W, py + H], outline=(120, 130, 150))
    sd.text((px + 4, py + H - 14), "P%02d" % (ONLY[i] if ONLY else i + 1), fill=(40, 40, 40))

sheet.save(OUT)
print("SAVED", OUT, sheet.size)
