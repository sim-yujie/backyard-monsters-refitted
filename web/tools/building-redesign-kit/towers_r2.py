"""towers_r2.py : one overview of the R2-A top tier for the six other towers -> art-samples/redesign/overview-towers-r2a.png

One row per tower: at game size (1x) Flash | sharp Flash (the faithful tower sample, Part 1) | R2-A, then the same three zoomed
(4x). Every picture is on the yard grass with Gorgo level 3 (approved repaint) beside it at true game scale. Flash keeps its own
shadow, the sharp sample too; R2-A gets the stand-in shadow from sheet.py.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, REPO, grass, old_rgba, resize_pm, shadow_on  # noqa: E402
from finish import canvas  # noqa: E402

TOWERS = [("sniper", "Sniper Tower"), ("tesla", "Tesla Tower"), ("laser", "Laser Tower"), ("aerial", "Aerial Defense Tower"),
          ("railgun", "Railgun"), ("bunker", "Monster Bunker")]
COLS = [("flash", "Flash (now)"), ("sharp", "Sharp Flash (Part 1)"), ("R2A", "R2-A  Flash refreshed, hand-painted")]
OUT = REPO / "art-samples" / "redesign"
CHW = 110
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
g4 = g4.crop(g4.getbbox())


def tower(t):
    """All the pictures of one tower: {col: (1x tile, 4x tile)}."""
    W, H, cx0, cy0 = canvas(t)
    old, ox, oy = old_rgba(t)
    oa = np.asarray(old)[..., 3] >= 200
    base_y = cy0 - oy + np.where(oa)[0].max() + 1
    fx1 = cx0 - ox + np.where(oa)[1].max() + 1

    def new4(src):
        if src == "R2A":
            return Image.open(OUT / t / "R2A" / "new-4x.png").convert("RGBA")
        t4 = Image.open(REPO / "art-samples" / "towers" / t / "new-4x.png").convert("RGBA")   # on the old canvas
        c4 = Image.new("RGBA", (W * 4, H * 4), (0, 0, 0, 0))
        c4.alpha_composite(t4, ((cx0 - ox) * 4, (cy0 - oy) * 4))
        return c4

    def stand_in_shadow(bg, im4):
        a = np.asarray(resize_pm(im4, (W, H)))[..., 3].astype(float) / 255
        bot = np.where(a.max(1) > 0.5)[0].max()
        sq = Image.fromarray((a * 255).astype("uint8")).transform(
            (W, H), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35), Image.BILINEAR)
        sh = np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255
        arr = np.asarray(bg).astype(float)
        arr[:, :W] *= (1 - 0.45 * sh[..., None])
        return Image.fromarray(arr.astype("uint8"))

    def scene(src, S):
        bg = grass(W + CHW, H, seed=7)
        if src == "R2A":
            im4 = new4(src)
            bg = stand_in_shadow(bg, im4)
        else:
            bg = shadow_on(bg, t, cx0, cy0)
        d = ImageDraw.Draw(bg, "RGBA")
        gx = fx1 + 8
        gw, gh = g4.width / 4, g4.height / 4
        d.ellipse((gx + gw * 0.1, base_y - 6, gx + gw * 0.9, base_y + 4), fill=(0, 0, 0, 70))
        big = bg.resize(((W + CHW) * S, H * S), Image.BILINEAR).convert("RGBA")
        if src == "flash":
            o = old if S == 1 else old.resize((old.width * S, old.height * S), Image.BILINEAR)
            big.alpha_composite(o, ((cx0 - ox) * S, (cy0 - oy) * S))
        else:
            big.alpha_composite(resize_pm(new4(src), (W * S, H * S)))
        gs = resize_pm(g4, (round(gw * S), round(gh * S)))
        big.alpha_composite(gs, (round(gx * S), round(base_y * S - gs.height)))
        return big.convert("RGB")

    boxes = [(cx0 - ox, cy0 - oy, cx0 - ox + old.width, cy0 - oy + old.height)]
    boxes += [tuple(v / 4 for v in new4(c).getbbox()) for c in ("sharp", "R2A")]
    x0 = int(max(0, min(b[0] for b in boxes) - 6)); y0 = int(max(0, min(b[1] for b in boxes) - 6))
    x1 = int(min(W + CHW, max(max(b[2] for b in boxes), fx1 + 8 + g4.width / 4) + 10))
    return {c: tuple(scene(c, S).crop((x0 * S, y0 * S, x1 * S, H * S)) for S in (1, 4)) for c, _ in COLS}


BG, FG, HL = (36, 36, 40), (235, 235, 235), (255, 214, 102)
F = ImageFont.truetype("arial.ttf", 26); FB = ImageFont.truetype("arialbd.ttf", 34)
PAD, LAB, GAP = 24, 34, 60
rows = [(name, tower(t)) for t, name in TOWERS]
cw = max(max(r[c][0].width for c, _ in COLS) for _, r in rows)
cw = max(cw, max(round(F.getlength(l)) for _, l in COLS[:2]) + 12)
tw = max(max(r[c][1].width for c, _ in COLS) for _, r in rows)
left = PAD + 3 * (cw + PAD) + GAP
width = left + 3 * (tw + PAD)
heights = [LAB + 10 + LAB + max(r[c][1].height for c, _ in COLS) + PAD * 2 for _, r in rows]
g = Image.new("RGB", (width, 100 + sum(heights)), BG)
d = ImageDraw.Draw(g)
d.text((PAD, 12), "The other six towers, top tier in R2-A (Flash design, refreshed, hand-painted), next to Flash and the sharp "
                  "Flash sample.  Left: game size (1x).  Right: zoomed (4x).", fill=FG, font=F)
d.text((PAD, 48), "Gorgo level 3 (approved repaint) beside each, at true game scale.  R2-A has a simple stand-in shadow.",
       fill=FG, font=F)
y = 100
for (name, r), h in zip(rows, heights):
    d.text((PAD, y), name, fill=HL, font=FB)
    yy = y + LAB + 10
    for i, (c, lab) in enumerate(COLS):
        short = "R2-A" if c == "R2A" else lab
        d.text((PAD + i * (cw + PAD), yy), short, fill=HL if c == "R2A" else FG, font=F)
        g.paste(r[c][0], (PAD + i * (cw + PAD), yy + LAB))
        d.text((left + i * (tw + PAD), yy), lab + "  (4x)", fill=HL if c == "R2A" else FG, font=F)
        g.paste(r[c][1], (left + i * (tw + PAD), yy + LAB))
    y += h
g.save(OUT / "overview-towers-r2a.png", optimize=True)
print(OUT / "overview-towers-r2a.png", g.size)
