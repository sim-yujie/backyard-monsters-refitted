"""th_levels.py : art-samples/redesign/townhall/overview.png, the Town Hall's ten levels (owner, 25 Oct night: one picture per level;
levels 1-4 normal, 5-8 gold, 9-10 black and gold). One column per level: the Flash picture above, the new one below, first at game
size (1x), then at 2x, on the yard grass with Gorgo level 3 (approved repaint) beside each. All pictures share the level 10 canvas
(finish.py), so their sizes compare directly. Level 2, 5 and 10 use the earlier pictures of those levels (T1, GOLD, BLACK) unless an
L2 / L5 / L10 picture has been painted.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-sample-kit"))
sys.path.insert(0, str(Path(__file__).parent))
from common import ASSETS, REPO, grass, layers, resize_pm, shadow_on  # noqa: E402
from finish import canvas  # noqa: E402

TH = REPO / "art-samples" / "redesign" / "townhall"
EARLIER = {2: "T1", 5: "GOLD", 10: "BLACK"}          # pictures of these levels painted before the per-level round
BAND = {n: "normal" if n <= 4 else "gold" if n <= 8 else "black and gold" for n in range(1, 11)}
W, H, cx0, cy0 = canvas("townhall")                  # the level 10 canvas, shared by every level
CHW = 40                                             # room for Gorgo to the right of each building
g4 = Image.open(ASSETS / "monsters" / "ape_3-repaint@4x.png").convert("RGBA").crop((2 * 103 * 4, 0, 3 * 103 * 4, 88 * 4))
g4 = g4.crop(g4.getbbox())


def folder(n):
    f = f"L{n}"
    return f if (TH / f / "new-4x.png").exists() else EARLIER[n]


def flash4(n):
    """The Flash picture of level n on the shared canvas, 4x (nearest, so the old pixels stay as they were)."""
    c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for im, x, y in layers(f"townhall{n}"):
        c.alpha_composite(im, (cx0 + x, cy0 + y))
    return c.resize((W * 4, H * 4), Image.NEAREST)


def scene(im4, S, n, flash, x1, base_y):
    """im4 (4x, shared canvas) on grass at scale S, with its shadow (Flash: its own JPEG; new: a simple stand-in) and Gorgo."""
    if flash:
        bg = shadow_on(grass(W + CHW, H, seed=7), f"townhall{n}", cx0, cy0)
    else:
        a = np.asarray(resize_pm(im4, (W, H)))[..., 3].astype(float) / 255
        bot = np.where(a.max(1) > 0.5)[0].max()
        sq = Image.fromarray((a * 255).astype("uint8")).transform(
            (W, H), Image.AFFINE, (1, 0.9, -0.9 * bot, 0, 1 / 0.35, bot - bot / 0.35), Image.BILINEAR)
        sh = np.asarray(sq.filter(ImageFilter.GaussianBlur(3))).astype(float) / 255
        arr = np.asarray(grass(W + CHW, H, seed=7)).astype(float)
        arr[:, :W] *= (1 - 0.45 * sh[..., None])
        bg = Image.fromarray(arr.astype("uint8"))
    d = ImageDraw.Draw(bg, "RGBA")
    gx, gw, gh = x1 + 4, g4.width / 4, g4.height / 4
    d.ellipse((gx + gw * 0.1, base_y - 5, gx + gw * 0.9, base_y + 3), fill=(0, 0, 0, 70))
    big = bg.resize(((W + CHW) * S, H * S), Image.BILINEAR).convert("RGBA")
    big.alpha_composite(im4.resize((W * S, H * S), Image.NEAREST) if flash and S > 1 else resize_pm(im4, (W * S, H * S)))
    gs = resize_pm(g4, (round(gw * S), round(gh * S)))
    big.alpha_composite(gs, (round(gx * S), round(base_y * S - gs.height)))
    return big.convert("RGB")


def column(n):
    """{S: (flash tile, new tile)} for level n, both cropped to the same box so they line up."""
    fl = flash4(n)
    nw = Image.open(TH / folder(n) / "new-4x.png").convert("RGBA")
    boxes = [tuple(v / 4 for v in p.getbbox()) for p in (fl, nw)]
    fa = np.asarray(fl)[..., 3] >= 200
    base_y = (np.where(fa)[0].max() + 1) / 4          # Gorgo stands on the Flash picture's ground line
    x1 = max(bx[2] for bx in boxes)
    X0 = int(max(0, min(bx[0] for bx in boxes) - 4)); Y0 = int(max(0, min(bx[1] for bx in boxes) - 6))
    X1 = int(min(W + CHW, x1 + 4 + g4.width / 4 + 6)); Y1 = int(min(H, base_y + 14))
    return {S: tuple(scene(p, S, n, f, x1, base_y).crop((X0 * S, Y0 * S, X1 * S, Y1 * S)) for p, f in ((fl, True), (nw, False)))
            for S in (1, 2)}


cols = {n: column(n) for n in range(1, 11)}
BG, FG, HL = (36, 36, 40), (235, 235, 235), (255, 214, 102)
F = ImageFont.truetype("arial.ttf", 22); FB = ImageFont.truetype("arialbd.ttf", 30)
PAD, LAB, RL = 24, 30, 90                            # RL: room for the row labels on the left
LINE1 = ("Town Hall, one picture per level, each painted from that level's own Flash picture.  "
         "Levels 1-4 normal, 5-8 gold, 9-10 black and gold.")
LINE2 = ("Top: Flash.  Below: new.  Gorgo level 3 (approved repaint) beside each.  All on one shared canvas, so sizes compare.  "
         "New pictures: simple stand-in shadow.")


def note(n):
    f = folder(n)
    return {"T1": "earlier tier 1 picture", "GOLD": "approved gold test", "BLACK": "approved black-and-gold test"}.get(f, "")


def block(S):
    ws = [max(cols[n][S][0].width, round(F.getlength(BAND[n])) + 8, round(F.getlength(note(n))) + 8) for n in range(1, 11)]
    hf = max(cols[n][S][0].height for n in cols); hn = max(cols[n][S][1].height for n in cols)
    w = RL + sum(ws) + PAD * 10
    h = LAB * 4 + hf + hn + PAD * 2
    g = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(g)
    d.text((0, 0), "Game size (1x)" if S == 1 else "Zoomed (2x)", fill=HL, font=FB)
    x = RL
    for i, n in enumerate(range(1, 11)):
        d.text((x, LAB + 6), f"Level {n}", fill=HL, font=FB if S == 2 else F)
        d.text((x, LAB * 2 + 8), BAND[n], fill=FG, font=F)
        fl, nw = cols[n][S]
        y = LAB * 3 + 10
        g.paste(fl, (x, y + hf - fl.height))
        y2 = y + hf + PAD
        g.paste(nw, (x, y2 + hn - nw.height))
        if note(n):
            d.text((x, y2 + hn + 4), note(n), fill=FG, font=F)
        x += ws[i] + PAD
    d.text((0, LAB * 3 + 10 + hf // 2), "Flash", fill=FG, font=FB)
    d.text((0, LAB * 3 + 10 + hf + PAD + hn // 2), "New", fill=HL, font=FB)
    return g


blocks = [block(1), block(2)]
width = max(b.width for b in blocks) + PAD * 2
width = max(width, PAD * 2 + round(F.getlength(LINE2)))
out = Image.new("RGB", (width, 90 + sum(b.height + PAD * 2 for b in blocks)), BG)
d = ImageDraw.Draw(out)
d.text((PAD, 16), LINE1, fill=FG, font=F)
d.text((PAD, 48), LINE2, fill=FG, font=F)
y = 90
for b in blocks:
    out.paste(b, (PAD, y)); y += b.height + PAD * 2
out.save(TH / "overview.png", optimize=True)
print("saved", (TH / "overview.png").as_posix(), out.size)
