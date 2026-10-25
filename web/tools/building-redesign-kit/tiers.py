"""tiers.py <building> : the owner's tier overview (R2-A, tiers 1-2-3) -> art-samples/redesign/<building>/overview-tiers.png

One row per tier, labelled with its level range. Each row: at game size (1x) the Flash picture(s) for those levels and the new
tier; then zoomed (4x) the Flash picture the tier was painted from and the new tier. Tier 3 is the approved R2-A picture.
Every picture is on the yard grass with Gorgo level 3 (approved repaint) beside it at true game scale. All pictures share one
canvas (the top level's), so the sizes compare directly. The new pictures get the same stand-in shadow as sheet.py.
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

b = sys.argv[1]
OUT = REPO / "art-samples" / "redesign" / b

# every Town Hall level as its own entry, offsets from the game's art table (Flash has a picture per level)
art = (REPO / "web" / "src" / "game" / "yard" / "buildingArtData.ts").read_text(encoding="utf-8")
th = art[art.index('[14, "Town Hall"'):]
for L in range(1, 11):
    m = re.search(rf'\[{L},\["(top\.{L}\.png)",(-?\d+),(-?\d+)\].*?\["(shadow\.{L}\.jpg)",(-?\d+),(-?\d+)\]', th)
    common.TOWERS[f"townhall{L}"] = dict(folder="townhall", button=14, top=(m[1], int(m[2]), int(m[3])),
                                         shadow=(m[4], int(m[5]), int(m[6])), anim=None, frame=0, what="")

# (label, Flash pictures shown at 1x as (key, label), the Flash picture the tier was painted from, sample folder)
if b == "cannon":
    ALL = "Flash (same picture at every level)"
    TIERS = [("Tier 1 = levels 1-3", [("cannon", ALL)], ("cannon", ALL), "T1"),
             ("Tier 2 = levels 4-6", [("cannon", ALL)], ("cannon", ALL), "T2"),
             ("Tier 3 = levels 7-10  (R2-A, approved)", [("cannon", ALL)], ("cannon", ALL), "R2A")]
else:
    lv = lambda L: (f"townhall{L}", f"Flash level {L}")          # noqa: E731
    TIERS = [("Tier 1 = levels 1-3  (painted from Flash level 2)", [lv(1), lv(2), lv(3)], lv(2), "T1"),
             ("Tier 2 = levels 4-6  (painted from Flash level 5)", [lv(4), lv(5), lv(6)], lv(5), "T2"),
             ("Tier 3 = levels 7-10  (R2-A, approved, painted from Flash level 10)", [lv(7), lv(8), lv(9), lv(10)], lv(10), "R2A")]
TITLE = {"cannon": "Cannon Tower", "townhall": "Town Hall"}[b]
NEWLAB = {"T1": "New tier 1", "T2": "New tier 2", "R2A": "New tier 3 (R2-A)"}

W, H, cx0, cy0 = canvas(b)
CHW = 110
top, tox, toy = old_rgba(b)                       # the top level: Gorgo stands beside its right edge, on its base line
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
g4 = g4.crop(g4.getbbox())
ta = np.asarray(top)[..., 3] >= 200
base_y = cy0 - toy + np.where(ta)[0].max() + 1
fx1 = cx0 - tox + np.where(ta)[1].max() + 1


def stand_in_shadow(bg, im4):
    """A soft shadow from the building's outline, squashed and pushed to the lower right like the Flash shadows."""
    a = np.asarray(resize_pm(im4, (W, H)))[..., 3].astype(float) / 255
    bot = np.where(a.max(1) > 0.5)[0].max()
    sq = Image.fromarray((a * 255).astype("uint8")).transform(
        (W, H), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35), Image.BILINEAR)
    sh = np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255
    arr = np.asarray(bg).astype(float)
    arr[:, :W] *= (1 - 0.45 * sh[..., None])
    return Image.fromarray(arr.astype("uint8"))


def scene(src, S):
    """src = ('flash', key) or ('new', folder); the picture at scale S on grass, with Gorgo beside it."""
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


def crop_box():
    boxes = []
    for _, flashes, _, new in TIERS:
        for k, _ in flashes:
            o, ox, oy = old_rgba(k)
            boxes.append((cx0 - ox, cy0 - oy, cx0 - ox + o.width, cy0 - oy + o.height))
        boxes.append(tuple(v / 4 for v in Image.open(OUT / new / "new-4x.png").getbbox()))
    x0 = max(0, min(bx[0] for bx in boxes) - 6); y0 = max(0, min(bx[1] for bx in boxes) - 6)
    x1 = max(max(bx[2] for bx in boxes), fx1 + 8 + g4.width / 4) + 10
    return int(x0), int(y0), int(min(x1, W + CHW)), H


x0, y0, x1, y1 = crop_box()


def tile(src, S):
    return scene(src, S).crop((x0 * S, y0 * S, x1 * S, y1 * S))


BG, FG, HL = (36, 36, 40), (235, 235, 235), (255, 214, 102)
F = ImageFont.truetype("arial.ttf", 26); FB = ImageFont.truetype("arialbd.ttf", 34)
PAD, LAB, GAP = 24, 34, 60
sw, sh = x1 - x0, y1 - y0
tw, th = sw * 4, sh * 4
n1 = max(len(f) for _, f, _, _ in TIERS) + 1
labs = [lab for _, f, _, _ in TIERS for _, lab in f] + list(NEWLAB.values()) + ["Flash (all levels)"]
cw = max(sw, max(round(F.getlength(t)) for t in labs) + 12)   # 1x column: wide enough for its label
left = PAD + n1 * (cw + PAD) + GAP                 # where the 4x pair starts
LINE1 = (f"{TITLE}: the 3 tiers in R2-A (Flash design, refreshed, hand-painted).  Left: game size (1x).  "
         "Right: zoomed (4x).")
LINE2 = ("Gorgo level 3 (approved repaint) beside each, at true game scale.  Same canvas for every picture, so sizes "
         "compare directly.  New pictures: simple stand-in shadow.")
width = max(left + 2 * (tw + PAD), PAD * 2 + round(max(F.getlength(LINE1), F.getlength(LINE2))))
rowh = LAB + 10 + LAB + th + PAD * 2
height = 100 + len(TIERS) * rowh
g = Image.new("RGB", (width, height), BG)
d = ImageDraw.Draw(g)
d.text((PAD, 12), LINE1, fill=FG, font=F)
d.text((PAD, 48), LINE2, fill=FG, font=F)
y = 100
for label, flashes, base, new in TIERS:
    d.text((PAD, y), label, fill=HL, font=FB)
    yy = y + LAB + 10
    x = PAD
    for k, lab in flashes + [(None, NEWLAB[new])]:
        im = tile(("new", new) if k is None else ("flash", k), 1)
        d.text((x, yy), "Flash (all levels)" if b == "cannon" and k else lab, fill=HL if k is None else FG, font=F)
        g.paste(im, (x, yy + LAB))
        x += cw + PAD
    for i, (src, lab) in enumerate([(("flash", base[0]), base[1] + "  (4x)"), (("new", new), NEWLAB[new] + "  (4x)")]):
        xx = left + i * (tw + PAD)
        d.text((xx, yy), lab, fill=HL if i else FG, font=F)
        g.paste(tile(src, 4), (xx, yy + LAB))
    y += rowh
g.save(OUT / "overview-tiers.png", optimize=True)
print(OUT / "overview-tiers.png", g.size)
