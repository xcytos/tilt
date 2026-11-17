"""Generate luxury restyle of wall_clock_diff atlas: black dial + gold
Roman numerals, gold bezel ring/frame bits, gold hands. Original kept."""
from PIL import Image, ImageDraw, ImageFont
import numpy as np, math, os

SRC = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets\wall_clock\textures\wall_clock_diff_2k.jpg"
DST = r"C:\Users\syedm\Downloads\tools\TILT\render-lab\assets\wall_clock\textures\wall_clock_diff_luxury_2k.jpg"

im = Image.open(SRC).convert("RGB")
a = np.array(im).astype(np.float32)
H, W = a.shape[:2]
CX, CY, R_DIAL, R_RING = 547.0, 1500.0, 516.0, 640.0

yy, xx = np.mgrid[0:H, 0:W]
r = np.hypot(xx - CX, yy - CY)

# ---- 1) gold-tint the bezel ring + flat frame bits (neutral bright, left atlas)
lum = a.mean(axis=2)
neutral = np.abs(a[:, :, 0] - a[:, :, 2]) < 14
gold_zone = (xx < 1100) & (yy > 850) & (r > 514) & (r < R_RING)
corner_zone = (xx < 1100) & (yy > 850) & (r >= R_RING)
bright = lum > 135
tint_mask = ((gold_zone | corner_zone) & neutral & bright)
tf = np.array([1.0, 0.855, 0.52], dtype=np.float32)
a[tint_mask] = np.clip(a[tint_mask] * tf, 0, 255)

# ---- 2) luxury black dial inside R_DIAL
dial = r <= R_DIAL
# radial gradient: slightly lifted center -> deep black edge
t = np.clip(r / R_DIAL, 0, 1)
shade = 26 - 22 * t ** 1.4            # 26 -> 4
for c, k in enumerate((1.0, 1.0, 1.06)):
    a[:, :, c] = np.where(dial, shade * k, a[:, :, c])

img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
d = ImageDraw.Draw(img)

GOLD = (212, 175, 55)
GOLD_SOFT = (190, 158, 74)
FONT = r"C:\Windows\Fonts\times.ttf"
FONTB = r"C:\Windows\Fonts\timesbd.ttf"

def ctr_text(xy, text, font, fill):
    b = d.textbbox((0, 0), text, font=font)
    d.text((xy[0] - (b[2] - b[0]) / 2 - b[0], xy[1] - (b[3] - b[1]) / 2 - b[1]),
           text, font=font, fill=fill)

# faint guilloche rings
for rr in range(70, 505, 26):
    d.ellipse([CX - rr, CY - rr, CX + rr, CY + rr], outline=(40, 38, 30))

# chapter line
d.ellipse([CX - 434, CY - 434, CX + 434, CY + 434], outline=(120, 100, 46), width=2)

# minute track
for i in range(60):
    ang = math.radians(i * 6 - 90)
    major = (i % 5 == 0)
    r0, r1 = (448, 486) if major else (468, 486)
    w = 7 if major else 3
    x0, y0 = CX + r0 * math.cos(ang), CY + r0 * math.sin(ang)
    x1, y1 = CX + r1 * math.cos(ang), CY + r1 * math.sin(ang)
    d.line([x0, y0, x1, y1], fill=GOLD, width=w)

# roman numerals
romans = {1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI",
          7: "VII", 8: "VIII", 9: "IX", 10: "X", 11: "XI", 12: "XII"}
fnum = ImageFont.truetype(FONT, 92)
for h in range(1, 13):
    ang = math.radians(h * 30 - 90)
    px = CX + 384 * math.cos(ang)
    py = CY + 384 * math.sin(ang)
    ctr_text((px, py), romans[h], fnum, GOLD)

# brand + label
fbrand = ImageFont.truetype(FONTB, 64)
flabel = ImageFont.truetype(FONT, 27)
ctr_text((CX, CY - 195), "LUXE", fbrand, GOLD)
ctr_text((CX, CY + 235), "AUTOMATIC", flabel, GOLD_SOFT)

# center hub
d.ellipse([CX - 16, CY - 16, CX + 16, CY + 16], fill=GOLD)

# ---- 3) gold hands: right-atlas dark cores + every red pixel (second hand)
a = np.array(img).astype(np.float32)
right = xx >= 1100
dark = right & (lum < 78)
red = (a[:, :, 0] > 100) & (a[:, :, 0] - a[:, :, 1] > 45) & (a[:, :, 0] - a[:, :, 2] > 45)
# second-hand tail island at bottom-left, outside the dial circle
corner_hand = (xx < 260) & (yy > 1650) & (r > R_DIAL)
dark = dark | (corner_hand & (lum < 78))
hand_gold = np.array([214, 178, 92], dtype=np.float32)
a[dark] = hand_gold
a[red] = hand_gold

# ---- 4) silver case/frame -> gold (frame UVs sample the bright bluish photo
#      region on the right half; keep anything already gold or neutral-white)
lum4 = a.mean(axis=2)
silver = (lum4 > 100) & (a[:, :, 2] > a[:, :, 0] + 8)
a[silver] = np.clip(a[silver] * np.array([1.10, 0.92, 0.42], dtype=np.float32), 0, 255)

Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(DST, quality=95)
print("WROTE", DST, "silver->gold px:", int(silver.sum()))
