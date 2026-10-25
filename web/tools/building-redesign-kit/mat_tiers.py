"""mat_tiers.py [tower ...] : tower tiers as wall-block materials -> art-samples/redesign/overview-tiers-blocks.png

Owner, 25 Oct evening: tier 1 = the normal tower refreshed (R2-A), tier 2 = GOLD (like the Gold Blocks), tier 3 = BLACK DIAMOND
with gold edges (like the Black Diamond Blocks). Per tower: a game-size (1x) row Flash | tier 1 | tier 2 | tier 3, then a zoomed
(4x) row tier 1 | tier 2 | tier 3, with the matching wall block under tiers 2 and 3. Every picture is on the yard grass with
Gorgo level 3 (approved repaint) beside it at true game scale; the new pictures get the stand-in shadow from sheet.py.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, REPO, grass, old_rgba, resize_pm, shadow_on  # noqa: E402
from finish import canvas  # noqa: E402

NAMES = {"cannon": "Cannon Tower", "tesla": "Tesla Tower", "sniper": "Sniper Tower", "laser": "Laser Tower",
         "aerial": "Aerial Defense Tower", "railgun": "Railgun", "bunker": "Monster Bunker"}
TOWERS = sys.argv[1:] or ["cannon", "tesla"]
TIER1 = {"cannon": "T2"}                    # same as make.py MAT_TIER1: the picture reused as tier 1
OUT = REPO / "art-samples" / "redesign"
BLOCK = {"GOLD": ("top.4.v2.png", "Gold Blocks (wall level 4)"), "BLACK": ("top.5.png", "Black Diamond Blocks (wall level 5)")}
CHW = 110
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
g4 = g4.crop(g4.getbbox())


def tower(t):
    """{'flash' | 'T1' | 'GOLD' | 'BLACK': (1x tile, 4x tile)} for one tower, all cropped to the same box."""
    W, H, cx0, cy0 = canvas(t)
    old, ox, oy = old_rgba(t)
    oa = np.asarray(old)[..., 3] >= 200
    base_y = cy0 - oy + np.where(oa)[0].max() + 1
    fx1 = cx0 - ox + np.where(oa)[1].max() + 1
    src = {"T1": TIER1.get(t, "R2A"), "GOLD": "GOLD", "BLACK": "BLACK"}
    new4 = {k: Image.open(OUT / t / v / "new-4x.png").convert("RGBA") for k, v in src.items()}

    def stand_in_shadow(bg, im4):
        a = np.asarray(resize_pm(im4, (W, H)))[..., 3].astype(float) / 255
        bot = np.where(a.max(1) > 0.5)[0].max()
        sq = Image.fromarray((a * 255).astype("uint8")).transform(
            (W, H), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35), Image.BILINEAR)
        sh = np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255
        arr = np.asarray(bg).astype(float)
        arr[:, :W] *= (1 - 0.45 * sh[..., None])
        return Image.fromarray(arr.astype("uint8"))

    def scene(k, S):
        bg = grass(W + CHW, H, seed=7)
        bg = shadow_on(bg, t, cx0, cy0) if k == "flash" else stand_in_shadow(bg, new4[k])
        d = ImageDraw.Draw(bg, "RGBA")
        gx = fx1 + 8
        gw, gh = g4.width / 4, g4.height / 4
        d.ellipse((gx + gw * 0.1, base_y - 6, gx + gw * 0.9, base_y + 4), fill=(0, 0, 0, 70))
        big = bg.resize(((W + CHW) * S, H * S), Image.BILINEAR).convert("RGBA")
        if k == "flash":
            o = old if S == 1 else old.resize((old.width * S, old.height * S), Image.BILINEAR)
            big.alpha_composite(o, ((cx0 - ox) * S, (cy0 - oy) * S))
        else:
            big.alpha_composite(resize_pm(new4[k], (W * S, H * S)))
        gs = resize_pm(g4, (round(gw * S), round(gh * S)))
        big.alpha_composite(gs, (round(gx * S), round(base_y * S - gs.height)))
        return big.convert("RGB")

    boxes = [(cx0 - ox, cy0 - oy, cx0 - ox + old.width, cy0 - oy + old.height)]
    boxes += [tuple(v / 4 for v in im.getbbox()) for im in new4.values()]
    x0 = int(max(0, min(b[0] for b in boxes) - 6)); y0 = int(max(0, min(b[1] for b in boxes) - 6))
    x1 = int(min(W + CHW, max(max(b[2] for b in boxes), fx1 + 8 + g4.width / 4) + 10))
    return {k: tuple(scene(k, S).crop((x0 * S, y0 * S, x1 * S, H * S)) for S in (1, 4)) for k in ("flash", "T1", "GOLD", "BLACK")}


def block(k, S):
    """The wall block on a patch of yard grass at scale S."""
    im = Image.open(ASSETS / "buildings" / "walls" / BLOCK[k][0]).convert("RGBA")
    g = grass(im.width + 24, im.height + 16, seed=5).convert("RGBA")
    g.alpha_composite(im, (12, 8))
    return g.resize((g.width * S, g.height * S), Image.BILINEAR if S > 1 else Image.NEAREST).convert("RGB")


BG, FG, HL = (36, 36, 40), (235, 235, 235), (255, 214, 102)
F = ImageFont.truetype("arial.ttf", 26); FB = ImageFont.truetype("arialbd.ttf", 34)
PAD, LAB = 24, 34
LBL = {"flash": "Flash (now)", "T1": "Tier 1 (levels 1-3): normal, refreshed", "GOLD": "Tier 2 (levels 4-6): gold",
       "BLACK": "Tier 3 (levels 7-10): black diamond"}
rows = [(t, tower(t)) for t in TOWERS]
cw = max(max(r[k][0].width for k in r) for _, r in rows)
cw = max(cw, max(round(F.getlength(v)) for v in LBL.values()) + 12)
tw = max(max(r[k][1].width for k in r) for _, r in rows)
b1h, b4h = block("GOLD", 1).height, block("GOLD", 4).height
LINE1 = ("Defensive tower tiers following the wall blocks: tier 1 normal (R2-A), tier 2 gold (Gold Blocks), tier 3 black diamond "
         "(Black Diamond Blocks).")
LINE2 = "Gorgo level 3 (approved repaint) beside each, at true game scale.  The matching wall block is under tiers 2 and 3."
width = max(PAD + 4 * (cw + PAD), PAD + 3 * (tw + PAD), PAD * 2 + round(F.getlength(LINE1)))
heights = []
for _, r in rows:
    h1 = max(r[k][0].height for k in r)
    h4 = max(r[k][1].height for k in r)
    heights.append(LAB + 10 + LAB + h1 + 8 + LAB + b1h + 30 + LAB + h4 + 8 + LAB + b4h + PAD * 2)
g = Image.new("RGB", (width, 100 + sum(heights)), BG)
d = ImageDraw.Draw(g)
d.text((PAD, 12), LINE1, fill=FG, font=F)
d.text((PAD, 48), LINE2, fill=FG, font=F)
y = 100
for (t, r), h in zip(rows, heights):
    d.text((PAD, y), NAMES[t], fill=HL, font=FB)
    y += LAB + 10
    h1 = max(r[k][0].height for k in r)
    for i, k in enumerate(("flash", "T1", "GOLD", "BLACK")):        # game size
        x = PAD + i * (cw + PAD)
        d.text((x, y), LBL[k], fill=FG if k == "flash" else HL, font=F)
        g.paste(r[k][0], (x, y + LAB))
        if k in BLOCK:
            d.text((x, y + LAB + h1 + 8), BLOCK[k][1], fill=FG, font=F)
            g.paste(block(k, 1), (x, y + LAB + h1 + 8 + LAB))
    y += LAB + h1 + 8 + LAB + b1h + 30
    h4 = max(r[k][1].height for k in r)
    for i, k in enumerate(("T1", "GOLD", "BLACK")):                  # zoomed
        x = PAD + i * (tw + PAD)
        d.text((x, y), LBL[k] + "  (4x)", fill=HL, font=F)
        g.paste(r[k][1], (x, y + LAB))
        if k in BLOCK:
            d.text((x, y + LAB + h4 + 8), BLOCK[k][1] + "  (4x)", fill=FG, font=F)
            g.paste(block(k, 4), (x, y + LAB + h4 + 8 + LAB))
    y += LAB + h4 + 8 + LAB + b4h + PAD * 2
g.save(OUT / "overview-tiers-blocks.png", optimize=True)
print(OUT / "overview-tiers-blocks.png", g.size)
