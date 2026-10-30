"""spikes_compare.py : spikes-before-after.png, the ring of spikes moved down below the barrel's swing (owner, 28 Oct),
against the c4d709e8 Cannon (spikes standing round the barrel, always drawn behind it; lowest tilt 8 down). Same headings
and tilts on both sides, cropped to the top of the tower and enlarged, on grass green. Before: render-c4d/ (a copy of the
renders of c4d709e8); after: render/.

  python spikes_compare.py [TIER]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
GRASS, PAD, BAR, SCALE, TOP = (96, 150, 64, 255), 24, 44, 1.5, 0.72
BEFORE, AFTER = [-22, -14, -6, 2, 8], [-22, -12, -2, 8, 18]
# (row before, row after, heading): the game's still turned away left and right, the same 8 down over the back spikes,
# then each one's lowest tilt
CELLS = [(0, 0, 17), (0, 0, 25), (4, 3, 14), (4, 3, 24), (4, 4, 4), (4, 4, 24)]


def tilt(p):
    return f"{abs(p)}° {'up' if p < 0 else 'down'}"


def cell(src, tier, r, k):
    im = Image.open(HERE / src / tier / "body-4x.png").convert("RGBA")
    im.alpha_composite(Image.open(HERE / src / tier / "tilt-4x" / f"r{r}_h{k:02d}.png").convert("RGBA"))
    return im


def sheet(tier="t2"):
    font = ImageFont.truetype("arialbd.ttf", 26)
    rows = []
    for rb, ra, k in CELLS:
        b, a = cell("render-c4d", tier, rb, k), cell("render", tier, ra, k)
        x0, y0, x1, y1 = b.getbbox()
        bx = a.getbbox()
        x0, y0, x1 = min(x0, bx[0]), min(y0, bx[1]), max(x1, bx[2])
        box = (x0, y0, x1, y0 + round((max(y1, bx[3]) - y0) * TOP))     # the top: turret, ring and spikes
        rows.append([(f"before: {tilt(BEFORE[rb])}, heading {k}", b.crop(box)),
                     (f"after: {tilt(AFTER[ra])}, heading {k}", a.crop(box))])
    rows = [[(t, im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)) for t, im in r]
            for r in rows]
    cw = max(im.width for r in rows for _, im in r) + 2 * PAD
    hs = [max(im.height for _, im in r) + BAR + PAD for r in rows]
    S = Image.new("RGBA", (2 * cw, sum(hs)), GRASS)
    d = ImageDraw.Draw(S)
    y = 0
    for r, h in zip(rows, hs):
        for c, (label, im) in enumerate(r):
            x = c * cw
            tw = d.textlength(label, font=font)
            d.text((x + (cw - tw) / 2, y + 8), label, fill=(255, 255, 255, 255), font=font, stroke_width=2,
                   stroke_fill=(0, 0, 0, 255))
            S.alpha_composite(im, (x + (cw - im.width) // 2, y + BAR))
        y += h
    out = HERE / "spikes-before-after.png"
    S.convert("RGB").save(out, optimize=True)
    print(out, S.size)


if __name__ == "__main__":
    sheet(*sys.argv[1:])
