"""th_mat.py : Town Hall test of the gold / black-diamond progression -> art-samples/redesign/townhall/overview-blocks.png

Owner, 25 Oct evening: one Town Hall picture per level (each from Flash's own level picture), with the towers' wall-block
progression. Test of 2 pictures: level 5 with gold elements, level 10 with black-diamond elements. Per level: a game-size (1x)
row and a zoomed (4x) row of Flash | new style (R2-A) | gold or black diamond, with the matching wall block under the last one.
Every picture is on the yard grass with Gorgo level 3 (approved repaint) beside it; all share the level 10 canvas.
"""
import re
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
sys.path.insert(0, str(Path(__file__).parent))
import common  # noqa: E402
from common import ASSETS, REPO, grass, old_rgba, resize_pm, shadow_on  # noqa: E402
from finish import canvas  # noqa: E402

OUT = REPO / "art-samples" / "redesign" / "townhall"
art = (REPO / "web" / "src" / "game" / "yard" / "buildingArtData.ts").read_text(encoding="utf-8")
th = art[art.index('[14, "Town Hall"'):]
for L in (5, 10):
    m = re.search(rf'\[{L},\["(top\.{L}\.png)",(-?\d+),(-?\d+)\].*?\["(shadow\.{L}\.jpg)",(-?\d+),(-?\d+)\]', th)
    common.TOWERS[f"townhall{L}"] = dict(folder="townhall", button=14, top=(m[1], int(m[2]), int(m[3])),
                                         shadow=(m[4], int(m[5]), int(m[6])), anim=None, frame=0, what="")
# (row label, Flash key, new-style folder, material folder, wall block file, block label)
ROWS = [("Level 5: gold elements added", "townhall5", "T2", "GOLD", "top.4.v2.png", "Gold Blocks (wall level 4)"),
        ("Level 10: black-diamond elements", "townhall10", "R2A", "BLACK", "top.5.png", "Black Diamond Blocks (wall level 5)")]
W, H, cx0, cy0 = canvas("townhall")
CHW = 110
top, tox, toy = old_rgba("townhall")
ta = np.asarray(top)[..., 3] >= 200
base_y = cy0 - toy + np.where(ta)[0].max() + 1
fx1 = cx0 - tox + np.where(ta)[1].max() + 1
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
g4 = g4.crop(g4.getbbox())


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
    """src = ('flash', key) or ('new', folder)."""
    bg = grass(W + CHW, H, seed=7)
    if src[0] == "flash":
        bg = shadow_on(bg, src[1], cx0, cy0)
    else:
        im4 = Image.open(OUT / src[1] / "new-4x.png")
        bg = stand_in_shadow(bg, im4)
    d = ImageDraw.Draw(bg, "RGBA")
    gx = fx1 + 8
    gw, gh = g4.width / 4, g4.height / 4
    d.ellipse((gx + gw * 0.1, base_y - 6, gx + gw * 0.9, base_y + 4), fill=(0, 0, 0, 70))
    big = bg.resize(((W + CHW) * S, H * S), Image.BILINEAR).convert("RGBA")
    if src[0] == "flash":
        o, ox, oy = old_rgba(src[1])
        if S > 1:
            o = o.resize((o.width * S, o.height * S), Image.BILINEAR)
        big.alpha_composite(o, ((cx0 - ox) * S, (cy0 - oy) * S))
    else:
        big.alpha_composite(resize_pm(im4, (W * S, H * S)))
    gs = resize_pm(g4, (round(gw * S), round(gh * S)))
    big.alpha_composite(gs, (round(gx * S), round(base_y * S - gs.height)))
    return big.convert("RGB")


boxes = []
for _, fk, nf, mf, _, _ in ROWS:
    o, ox, oy = old_rgba(fk)
    boxes.append((cx0 - ox, cy0 - oy, cx0 - ox + o.width, cy0 - oy + o.height))
    boxes += [tuple(v / 4 for v in Image.open(OUT / f / "new-4x.png").getbbox()) for f in (nf, mf)]
x0 = int(max(0, min(b[0] for b in boxes) - 6)); y0 = int(max(0, min(b[1] for b in boxes) - 6))
x1 = int(min(W + CHW, max(max(b[2] for b in boxes), fx1 + 8 + g4.width / 4) + 10))


def tile(src, S):
    return scene(src, S).crop((x0 * S, y0 * S, x1 * S, H * S))


def block(f, S):
    im = Image.open(ASSETS / "buildings" / "walls" / f).convert("RGBA")
    g = grass(im.width + 24, im.height + 16, seed=5).convert("RGBA")
    g.alpha_composite(im, (12, 8))
    return g.resize((g.width * S, g.height * S), Image.BILINEAR if S > 1 else Image.NEAREST).convert("RGB")


BG, FG, HL = (36, 36, 40), (235, 235, 235), (255, 214, 102)
F = ImageFont.truetype("arial.ttf", 26); FB = ImageFont.truetype("arialbd.ttf", 34)
PAD, LAB = 24, 34
sw, sh = x1 - x0, H - y0
tw, th4 = sw * 4, sh * 4
LINE1 = ("Town Hall test: one picture per level, with the towers' wall-block progression.  2 pictures: level 5 + gold, "
         "level 10 + black diamond.")
LINE2 = "Gorgo level 3 (approved repaint) beside each, at true game scale.  All on the level 10 canvas, so sizes compare."
cw = max(sw, round(F.getlength("New style (R2-A), level 10")) + 12)
b1h, b4h = block("top.5.png", 1).height, block("top.5.png", 4).height
rowh = LAB + 10 + LAB + sh + 8 + LAB + b1h + 30 + LAB + th4 + 8 + LAB + b4h + PAD * 2
width = max(PAD + 3 * (tw + PAD), PAD * 2 + round(F.getlength(LINE1)))
g = Image.new("RGB", (width, 100 + len(ROWS) * rowh), BG)
d = ImageDraw.Draw(g)
d.text((PAD, 12), LINE1, fill=FG, font=F)
d.text((PAD, 48), LINE2, fill=FG, font=F)
y = 100
for label, fk, nf, mf, bf, bl in ROWS:
    lvl = fk[len("townhall"):]
    cols = [(("flash", fk), f"Flash level {lvl}"), (("new", nf), f"New style (R2-A), level {lvl}"),
            (("new", mf), "Gold version" if mf == "GOLD" else "Black diamond version")]
    d.text((PAD, y), label, fill=HL, font=FB)
    y += LAB + 10
    for S, w, h, bh in ((1, cw, sh, b1h), (4, tw, th4, b4h)):
        for i, (src, lab) in enumerate(cols):
            x = PAD + i * (w + PAD)
            d.text((x, y), lab + ("  (4x)" if S > 1 else ""), fill=HL if i == 2 else FG, font=F)
            g.paste(tile(src, S), (x, y + LAB))
            if i == 2:
                d.text((x, y + LAB + h + 8), bl + ("  (4x)" if S > 1 else ""), fill=FG, font=F)
                g.paste(block(bf, S), (x, y + LAB + h + 8 + LAB))
        y += LAB + h + 8 + LAB + bh + 30
    y += PAD * 2 - 30
g.save(OUT / "overview-blocks.png", optimize=True)
print(OUT / "overview-blocks.png", g.size)
