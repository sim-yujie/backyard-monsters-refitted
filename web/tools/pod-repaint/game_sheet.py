"""Flash vs Modern Resource Pod sheet from the SHIPPED game files and the art rows (1x world offsets).

usage: python -I web/tools/pod-repaint/game_sheet.py <worktree> <outdir> [scale]
Copied from web/tools/underhall-repaint/game_sheet.py (branch art/underhall-modern).
Writes sheet-all@<s>x.png (the one look x whole/damaged/destroyed, Flash left, Modern right, on Inferno lava with
each look's own shadow) and look<N>@3x.png crops, plus prints brightness/saturation stats of each top picture.
"""
import glob
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

repo, out = Path(sys.argv[1]), Path(sys.argv[2])
S = int(sys.argv[3]) if len(sys.argv) > 3 else 2
out.mkdir(parents=True, exist_ok=True)
A = repo / "server" / "public" / "assets"
F = A / "buildings" / "istoragesilo"

FLASH = {
    1: [("top.1.v2.png", -45, -58), ("top.1.damaged.v2.png", -47, -56), ("top.1.destroyed.v2.png", -54, -14),
        ("shadow.1.v2.jpg", -48, 17), ("shadow.1.damaged.v2.jpg", -47, 17), ("shadow.1.destroyed.v2.jpg", -54, 12)],
}
MODERN = {
    1: [("top.c1@2x.webp", -45, -53), ("top.c1.damaged@2x.webp", -48, -49), ("top.c1.destroyed@2x.webp", -53, -15),
        ("shadow.1.v2.jpg", -48, 17), ("shadow.1.damaged.v2.jpg", -47, 17), ("shadow.1.destroyed.v2.jpg", -54, 12)],
}
STATES = ["whole", "damaged", "destroyed"]
X0, Y0, W, H = -75, -80, 150, 160  # 1x world box around the origin

try:
    FONT = ImageFont.truetype("arial.ttf", 16)
except OSError:
    FONT = ImageFont.load_default()

tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(A / "yardbg" / "lava" / "*inferno_lava*.png")))]


def lava(w, h):
    rng = np.random.default_rng(5)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g


def draw(rows, level, st, s):
    top, tx, ty = rows[level][st]
    sh, sx, sy = rows[level][3 + st]
    bg = lava(W, H).resize((W * s, H * s), Image.BILINEAR)
    a = np.asarray(bg).astype(float)
    shimg = Image.open(F / sh).convert("RGB")
    shimg = shimg.resize((shimg.width * s, shimg.height * s), Image.BILINEAR)
    sa = np.asarray(shimg).astype(float)
    x, y = (sx - X0) * s, (sy - Y0) * s
    a[y:y + sa.shape[0], x:x + sa.shape[1]] *= sa / 255
    bg = Image.fromarray(a.astype("uint8")).convert("RGBA")
    im = Image.open(F / top).convert("RGBA")
    if "@2x" in top:  # 2x file: half its pixels in world px
        im = im.resize((round(im.width * s / 2), round(im.height * s / 2)), Image.LANCZOS)
    else:
        im = im.resize((im.width * s, im.height * s), Image.BILINEAR)
    bg.alpha_composite(im, (round((tx - X0) * s), round((ty - Y0) * s)))
    return bg.convert("RGB"), im


def stats(im):
    a = np.asarray(im.convert("RGBA")).astype(float)
    m = a[..., 3] > 200
    rgb = a[..., :3][m] / 255
    v = rgb.max(1)
    mn = rgb.min(1)
    sat = np.where(v > 0, (v - mn) / np.maximum(v, 1e-6), 0)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    return f"bright {lum.mean()*100:4.1f}%  dark5% {np.percentile(lum,5)*100:4.1f}%  sat {sat.mean()*100:4.1f}%"


cells = {}
for level in (1,):
    for st in range(3):
        f, fi = draw(FLASH, level, st, S)
        m, mi = draw(MODERN, level, st, S)
        cells[(level, st)] = (f, m)
        print(f"L{level} {STATES[st]:9s} Flash  {stats(Image.open(F / FLASH[level][st][0]))}")
        print(f"L{level} {STATES[st]:9s} Modern {stats(Image.open(F / MODERN[level][st][0]))}")
        ff = Image.open(F / FLASH[level][st][0]).getbbox()
        mm = Image.open(F / MODERN[level][st][0]).getbbox()
        fh = ff[3] - ff[1]; mh = (mm[3] - mm[1]) / 2
        fb = FLASH[level][st][2] + ff[3]; mb = MODERN[level][st][2] + mm[3] / 2
        fw = ff[2] - ff[0]; mw = (mm[2] - mm[0]) / 2
        print(f"    size Flash {fw}x{fh} bottom {fb}   Modern {mw:.0f}x{mh:.0f} bottom {mb:.0f}")


def crop_box(level):
    # union bbox of all pictures in a look row (non-lava): just use a fixed generous box
    return None


# full sheet
cw, ch = W * S, H * S
gap, lab = 8, 24
sheet = Image.new("RGB", (3 * (2 * cw + gap) + 4 * gap * 2, 1 * (ch + lab) + 2 * gap), (28, 28, 28))
d = ImageDraw.Draw(sheet)
for level in (1,):
    for st in range(3):
        f, m = cells[(level, st)]
        x = gap * 2 + st * (2 * cw + gap * 3)
        y = gap + (level - 1) * (ch + lab + gap)
        lv = "levels 1-10"
        d.text((x, y + 2), f"Look {level} ({lv}) {STATES[st]}: Flash | Modern", fill=(235, 235, 235), font=FONT)
        sheet.paste(f, (x, y + lab))
        sheet.paste(m, (x + cw + gap, y + lab))
sheet.save(out / f"sheet-all@{S}x.png")
sheet.save(out / f"sheet-all@{S}x.jpg", quality=88)

# per-look 3x pairs, cropped tight
for level in (1,):
    pairs = []
    for st in range(3):
        f, _ = draw(FLASH, level, st, 3)
        m, _ = draw(MODERN, level, st, 3)
        pairs.append((f, m))
    # crop box: union of non-ground content found by differencing against plain lava
    base = np.asarray(lava(W, H).resize((W * 3, H * 3), Image.BILINEAR)).astype(int)
    ys, xs = [], []
    for f, m in pairs:
        for im in (f, m):
            dmask = np.abs(np.asarray(im).astype(int) - base).sum(2) > 30
            yy, xx = np.nonzero(dmask)
            ys += [yy.min(), yy.max()]; xs += [xx.min(), xx.max()]
    box = (max(0, min(xs) - 12), max(0, min(ys) - 12), min(W * 3, max(xs) + 12), min(H * 3, max(ys) + 12))
    bw, bh = box[2] - box[0], box[3] - box[1]
    img = Image.new("RGB", (2 * bw + gap, 3 * (bh + lab) + 2 * gap), (28, 28, 28))
    d = ImageDraw.Draw(img)
    for st, (f, m) in enumerate(pairs):
        y = st * (bh + lab + gap)
        d.text((4, y + 2), f"Look {level} {STATES[st]} (3x): Flash left, Modern right", fill=(235, 235, 235), font=FONT)
        img.paste(f.crop(box), (0, y + lab))
        img.paste(m.crop(box), (bw + gap, y + lab))
    img.save(out / f"look{level}@3x.png")
print("wrote", out)
