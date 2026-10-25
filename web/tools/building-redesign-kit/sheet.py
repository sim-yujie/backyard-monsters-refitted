"""sheet.py <building> : the owner's overview for one building -> art-samples/redesign/<building>/overview.png

Top: game size (1x), Flash | A1 | A2 | B1 | B2 in a row. Below: zoomed (4x), Flash on the left and the four combos as a 2x2 grid
(A1 A2 / B1 B2). Every picture is on the yard grass, with Gorgo level 3 (approved repaint) standing beside it for scale.
The Flash building has its own shadow; the new ones get a simple stand-in shadow made from their outline.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, REPO, grass, old_rgba, resize_pm, shadow_on  # noqa: E402
from finish import canvas  # noqa: E402

b = sys.argv[1]
OUT = REPO / "art-samples" / "redesign" / b
COMBOS = ["A1", "A2", "B1", "B2"]
NAME = {"A1": "A1  hand-painted + backyard junk", "A2": "A2  hand-painted + military/tech",
        "B1": "B1  3D render + backyard junk", "B2": "B2  3D render + military/tech"}
TITLE = {"cannon": "Cannon Tower", "townhall": "Town Hall"}[b]
W, H, cx0, cy0 = canvas(b)
CHW = 110                                  # room on the right for the champion
old, ox, oy = old_rgba(b)
# Gorgo level 3, idle facing the viewer (column 2, row 0 of the 4x sheet, cell 103x88)
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
gb = g4.getbbox()
g4 = g4.crop(gb)
base_y = cy0 - oy + np.where(np.asarray(old)[..., 3] >= 200)[0].max() + 1      # old base line on the canvas
fx1 = cx0 - ox + np.where(np.asarray(old)[..., 3] >= 200)[1].max() + 1          # old right edge


def stand_in_shadow(bg, im4):
    """A soft shadow from the building's outline, squashed and pushed to the lower right like the Flash shadows."""
    a = np.asarray(resize_pm(im4, (W, H)))[..., 3].astype(float) / 255
    ys = np.where(a.max(1) > 0.5)[0]
    bot = ys.max()
    sq = Image.fromarray((a * 255).astype("uint8")).transform(
        (W, H), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35), Image.BILINEAR)
    sh = np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255
    arr = np.asarray(bg).astype(float)
    arr[:, :W] *= (1 - 0.45 * sh[..., None])
    return Image.fromarray(arr.astype("uint8"))


def scene(src, S):
    """src = 'flash' or a combo; the picture at scale S (1 or 4) on grass, with Gorgo beside it."""
    bg = grass(W + CHW, H, seed=7)
    if src == "flash":
        bg = shadow_on(bg, b, cx0, cy0)
    else:
        im4 = Image.open(OUT / src / "new-4x.png")
        bg = stand_in_shadow(bg, im4)
    # Gorgo's contact shadow
    d = ImageDraw.Draw(bg, "RGBA")
    gx = fx1 + 8
    gw, gh = g4.width / 4, g4.height / 4
    d.ellipse((gx + gw * 0.1, base_y - 6, gx + gw * 0.9, base_y + 4), fill=(0, 0, 0, 70))
    big = bg.resize(((W + CHW) * S, H * S), Image.BILINEAR).convert("RGBA")
    if src == "flash":
        o = old if S == 1 else old.resize((old.width * S, old.height * S), Image.BILINEAR)
        big.alpha_composite(o, ((cx0 - ox) * S, (cy0 - oy) * S))
    else:
        big.alpha_composite(resize_pm(im4, (W * S, H * S)))
    gs = resize_pm(g4, (round(gw * S), round(gh * S)))
    big.alpha_composite(gs, (round(gx * S), round(base_y * S - gs.height)))
    return big.convert("RGB")


def crop_box():
    """Union of everything drawn (1x canvas coords), so empty sky is trimmed."""
    boxes = [(cx0 - ox, cy0 - oy, cx0 - ox + old.width, cy0 - oy + old.height)]
    for c in COMBOS:
        bb = Image.open(OUT / c / "new-4x.png").getbbox()
        boxes.append(tuple(v / 4 for v in bb))
    x0 = max(0, min(bx[0] for bx in boxes) - 6); y0 = max(0, min(bx[1] for bx in boxes) - 6)
    x1 = max(max(bx[2] for bx in boxes), fx1 + 8 + g4.width / 4) + 10      # up to Gorgo's right side
    return int(x0), int(y0), int(min(x1, W + CHW)), H


x0, y0, x1, y1 = crop_box()
BG, FG = (36, 36, 40), (235, 235, 235)


def tile(src, S):
    return scene(src, S).crop((x0 * S, y0 * S, x1 * S, y1 * S))


small = [("Flash (now)", tile("flash", 1))] + [(c, tile(c, 1)) for c in COMBOS]
bigs = {c: tile(c, 4) for c in ["flash"] + COMBOS}
tw, th = bigs["flash"].size
sw, sh = small[0][1].size
PAD, LAB = 24, 28
width = PAD + tw + PAD * 2 + 2 * (tw + PAD)
height = 80 + LAB + 8 + LAB + sh + 40 + LAB + 8 + 2 * (th + LAB + 6 + PAD) + PAD
g = Image.new("RGB", (width, height), BG)
d = ImageDraw.Draw(g)
try:
    from PIL import ImageFont
    F = ImageFont.truetype("arial.ttf", 22); FB = ImageFont.truetype("arialbd.ttf", 30)
except OSError:
    F = FB = None
d.text((PAD, 10), f"{TITLE}, top tier: Flash vs 4 new designs.  Style A = hand-painted (like the approved champion repaints), "
                  f"B = chunky 3D render.", fill=FG, font=F)
d.text((PAD, 38), "Theme 1 = backyard junk, 2 = military/tech.  Gorgo level 3 (approved repaint) beside each, at true game scale.",
       fill=FG, font=F)
y = 80
d.text((PAD, y), "Game size (1x)", fill=FG, font=FB); y += LAB + 8
x = PAD
for label, im in small:
    d.text((x, y), label, fill=FG, font=F)
    g.paste(im, (x, y + LAB)); x += sw + PAD * 2
y += LAB + sh + 40
d.text((PAD, y), "Zoomed (4x)", fill=FG, font=FB); y += LAB + 8
d.text((PAD, y), "Flash (now)", fill=FG, font=F)
g.paste(bigs["flash"], (PAD, y + LAB))
gx = PAD + tw + PAD * 2
for i, c in enumerate(COMBOS):
    cx = gx + (i % 2) * (tw + PAD)
    cy = y + (i // 2) * (th + LAB + PAD)
    d.text((cx, cy), NAME[c], fill=FG, font=FB)
    g.paste(bigs[c], (cx, cy + LAB + 6))
g.save(OUT / "overview.png", optimize=True)
print(OUT / "overview.png", g.size)
