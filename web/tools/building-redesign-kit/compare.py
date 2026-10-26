"""compare.py <plain|taller|all> : side-by-side sheets for the owner's feedback on the material tiers (25 Oct, late evening).

plain  -> art-samples/redesign/overview-plain-black.png: black-and-gold top tier next to plain black, for the Town Hall
          (level 10), Cannon and Tesla.
taller [tower] -> art-samples/redesign/<tower>/overview-taller.png (default cannon): tier 1 as now, tier 2 (gold) and tier 3 (black diamond)
          standing taller on the same footprint.
all    -> art-samples/redesign/all-towers-taller.png: the three tiers of all seven defensive towers, at 1x and 2x.
Per row: a game-size (1x) strip and a zoomed (4x) strip, on the yard grass with Gorgo level 3 (approved repaint) beside each.
The pictures sit on canvases that share their bottom edge (finish.py), so they are lined up by it.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, REPO, grass, old_rgba, resize_pm  # noqa: E402
from finish import canvas  # noqa: E402

OUT = REPO / "art-samples" / "redesign"
MODE = sys.argv[1]
NM = {"cannon": "Cannon Tower", "tesla": "Tesla Tower", "sniper": "Sniper Tower", "laser": "Laser Tower",
      "aerial": "Aerial Defense", "railgun": "Railgun", "bunker": "Monster Bunker"}
ZOOM = 2 if MODE == "all" else 4
if MODE == "plain":
    BB, PB = "Black and gold (as shown before)", "Plain black (no gold)"
    ROWS = [("Town Hall, level 10", "townhall", [("BLACK", BB), ("PLAIN", PB)]),
            ("Cannon Tower, tier 3 (levels 7-10)", "cannon", [("BLACK", BB), ("PLAIN", PB)]),
            ("Tesla Tower, tier 3 (levels 7-10)", "tesla", [("BLACK", BB), ("PLAIN", PB)])]
    DEST = OUT / "overview-plain-black.png"
    LINE1 = "Top tier: black-and-gold (left) next to plain black with no gold (right).  Left half: game size (1x)."
elif MODE == "all":
    # every defensive tower's three tiers (owner, 25 Oct night): tier 1 as now, tier 2 gold and taller, tier 3 black and gold, taller again
    ROWS = [(NM[tb], tb, [("T2" if tb == "cannon" else "R2A", "Tier 1, as now"), ("TALL2", "Tier 2, gold"),
                          ("TALL3", "Tier 3, black and gold")]) for tb in NM]
    DEST = OUT / "all-towers-taller.png"
    LINE1 = ("All seven defensive towers: higher tiers stand taller (range grows with level), same footprint.  "
             "Tier 1 = levels 1-3, tier 2 = 4-6, tier 3 = 7-10.")
else:
    # taller <tower>: any defensive tower (owner, 25 Oct night); tier 1 is the cannon's clean steel T2, the others' R2-A
    tb = sys.argv[2] if len(sys.argv) > 2 else "cannon"
    ROWS = [(f"{NM[tb]}: higher tiers stand taller (same footprint)", tb,
             [("T2" if tb == "cannon" else "R2A", "Tier 1 (levels 1-3), as now"), ("TALL2", "Tier 2 (levels 4-6), gold, taller"),
              ("TALL3", "Tier 3 (levels 7-10), black and gold, taller")])]
    DEST = OUT / tb / "overview-taller.png"
    LINE1 = f"{NM[tb]} tiers growing taller with level (range grows with level).  Same footprint on the ground."
LINE2 = "Gorgo level 3 (approved repaint) beside each, at true game scale.  New pictures: simple stand-in shadow."
CHW = 110
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
g4 = g4.crop(g4.getbbox())


def row(b, cols):
    """[(1x tile, 4x tile)] for one building, every picture on one canvas tall enough for all, lined up by the bottom."""
    pics = {f: Image.open(OUT / b / f / "new-4x.png").convert("RGBA") for f, _ in cols}
    W, H, cx0, cy0 = canvas(b)
    Hm = max(p.height for p in pics.values()) // 4                   # tallest canvas; all share the bottom edge
    lift = Hm - H
    old, ox, oy = old_rgba(b)
    oa = np.asarray(old)[..., 3] >= 200
    base_y = lift + cy0 - oy + np.where(oa)[0].max() + 1
    fx1 = cx0 - ox + np.where(oa)[1].max() + 1

    def placed(p):
        c = Image.new("RGBA", (W * 4, Hm * 4), (0, 0, 0, 0))
        c.alpha_composite(p, (0, Hm * 4 - p.height))
        return c

    pics = {f: placed(p) for f, p in pics.items()}

    def scene(im4, S):
        a = np.asarray(resize_pm(im4, (W, Hm)))[..., 3].astype(float) / 255
        bot = np.where(a.max(1) > 0.5)[0].max()
        sq = Image.fromarray((a * 255).astype("uint8")).transform(
            (W, Hm), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35), Image.BILINEAR)
        sh = np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255
        arr = np.asarray(grass(W + CHW, Hm, seed=7)).astype(float)
        arr[:, :W] *= (1 - 0.45 * sh[..., None])
        bg = Image.fromarray(arr.astype("uint8"))
        d = ImageDraw.Draw(bg, "RGBA")
        gx = fx1 + 8
        gw, gh = g4.width / 4, g4.height / 4
        d.ellipse((gx + gw * 0.1, base_y - 6, gx + gw * 0.9, base_y + 4), fill=(0, 0, 0, 70))
        big = bg.resize(((W + CHW) * S, Hm * S), Image.BILINEAR).convert("RGBA")
        big.alpha_composite(resize_pm(im4, (W * S, Hm * S)))
        gs = resize_pm(g4, (round(gw * S), round(gh * S)))
        big.alpha_composite(gs, (round(gx * S), round(base_y * S - gs.height)))
        return big.convert("RGB")

    boxes = [tuple(v / 4 for v in p.getbbox()) for p in pics.values()]
    x0 = int(max(0, min(bx[0] for bx in boxes) - 6)); y0 = int(max(0, min(bx[1] for bx in boxes) - 6))
    x1 = int(min(W + CHW, max(max(bx[2] for bx in boxes), fx1 + 8 + g4.width / 4) + 10))
    return [tuple(scene(pics[f], S).crop((x0 * S, y0 * S, x1 * S, Hm * S)) for S in (1, ZOOM)) for f, _ in cols]


BG, FG, HL = (36, 36, 40), (235, 235, 235), (255, 214, 102)
F = ImageFont.truetype("arial.ttf", 26); FB = ImageFont.truetype("arialbd.ttf", 34)
PAD, LAB, GAP = 24, 34, 60
built = [(label, cols, row(b, cols)) for label, b, cols in ROWS]
cw = max(max(t[0].width for t in r) for _, _, r in built)
cw = max(cw, max(round(F.getlength(lab)) for _, cols, _ in built for _, lab in cols) + 12)
tw = max(max(t[1].width for t in r) for _, _, r in built)
tw = max(tw, max(round(F.getlength(lab + f"  ({ZOOM}x)")) for _, cols, _ in built for _, lab in cols) + 12)
n = max(len(cols) for _, cols, _ in built)
left = PAD + n * (cw + PAD) + GAP
width = max(left + n * (tw + PAD), PAD * 2 + round(F.getlength(LINE1 + f"  Left: game size (1x).  Right: zoomed ({ZOOM}x).")))
heights = [LAB + 10 + LAB + max(t[1].height for t in r) + PAD * 2 for _, _, r in built]
g = Image.new("RGB", (width, 100 + sum(heights)), BG)
d = ImageDraw.Draw(g)
d.text((PAD, 12), LINE1 + ("  Right: zoomed (4x)." if MODE == "plain" else f"  Left: game size (1x).  Right: zoomed ({ZOOM}x)."),
       fill=FG, font=F)
d.text((PAD, 48), LINE2, fill=FG, font=F)
y = 100
for (label, cols, r), h in zip(built, heights):
    d.text((PAD, y), label, fill=HL, font=FB)
    yy = y + LAB + 10
    for i, ((_, lab), (t1, t4)) in enumerate(zip(cols, r)):
        d.text((PAD + i * (cw + PAD), yy), lab, fill=FG, font=F)
        g.paste(t1, (PAD + i * (cw + PAD), yy + LAB))
        d.text((left + i * (tw + PAD), yy), lab + f"  ({ZOOM}x)", fill=HL, font=F)
        g.paste(t4, (left + i * (tw + PAD), yy + LAB))
    y += h
g.save(DEST, optimize=True)
print(DEST, g.size)
