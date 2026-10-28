"""before_after.py : <tower>-3d/materials-before-after.png, the old metals (art-samples/before/, rendered with
LOOK3D_OLD_METAL=1) beside the polished ones (render/<tier>/full-hNN.png), one row per tier, cropped to the tower and
enlarged, on grass green.

  python art-samples/tower-3d/before_after.py [cannon sniper laser]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

A = Path(__file__).resolve().parent.parent
HEADING = dict(cannon=9, sniper=9, laser=3)
SCALE = dict(cannon=1.25, sniper=1.25, laser=1.0)      # the 4x renders, enlarged so each tower is about 330-560 px tall
GRASS, PAD, BAR = (96, 150, 64, 255), 24, 44


def crop(path):
    im = Image.open(path).convert("RGBA")
    return im.crop(im.getbbox())


def sheet(tower):
    font = ImageFont.truetype("arialbd.ttf", 26)
    rows = []
    for t in (1, 2, 3):
        b = crop(A / "before" / f"{tower}-t{t}.png")
        a = crop(A / f"{tower}-3d" / "render" / f"t{t}" / f"full-h{HEADING[tower]:02d}.png")
        k = SCALE[tower]
        rows.append([(f"tier {t}: before", b.resize((round(b.width * k), round(b.height * k)), Image.LANCZOS)),
                     (f"tier {t}: polished", a.resize((round(a.width * k), round(a.height * k)), Image.LANCZOS))])
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
            S.alpha_composite(im, (x + (cw - im.width) // 2, y + h - PAD // 2 - im.height))
        y += h
    out = A / f"{tower}-3d" / "materials-before-after.png"
    S.convert("RGB").save(out, optimize=True)
    print(out, S.size)


if __name__ == "__main__":
    for tw in sys.argv[1:] or ("cannon", "sniper", "laser"):
        sheet(tw)
