#!/usr/bin/env python3
"""Forge collage composer: 2x3 labeled collage from a job's rendered shots.
Usage: python collage.py <jobdir> <png1..png6>"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

jdir = sys.argv[1]
tiles = sys.argv[2:7] if len(sys.argv) > 2 else []
if not tiles:
    print("no tiles"); sys.exit(1)

TW, TH, GAP, BAR = 600, 338, 8, 54
W = TW * 3 + GAP * 4
H = TH * 2 + GAP * 3 + BAR


def font(sz):
    for name in ("seguisb.ttf", "segoeuib.ttf", "arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, sz)
        except Exception:
            continue
    return ImageFont.load_default()


canvas = Image.new("RGB", (W, H), (24, 22, 20))
d = ImageDraw.Draw(canvas)
d.text((GAP + 8, 14), "TILT FORGE - ballroom stage photoreal", fill=(232, 222, 205), font=font(22))
for i, name in enumerate(tiles):
    r, c = divmod(i, 3)
    x = GAP + c * (TW + GAP)
    y = BAR + GAP + r * (TH + GAP)
    try:
        im = Image.open(os.path.join(jdir, name)).convert("RGB").resize((TW, TH), Image.LANCZOS)
        canvas.paste(im, (x, y))
        d.text((x + 8, y + 6), name.replace("bal_", "").replace(".png", ""),
               fill=(255, 255, 255), font=font(15))
    except Exception as e:
        d.rectangle((x, y, x + TW, y + TH), fill=(40, 36, 33))
        d.text((x + 8, y + 8), "missing: %s" % name, fill=(200, 80, 60), font=font(14))
d.rectangle((0, 0, W - 1, H - 1), outline=(90, 80, 65))
out = os.path.join(jdir, "collage.png")
canvas.save(out)
print("collage ->", out)
