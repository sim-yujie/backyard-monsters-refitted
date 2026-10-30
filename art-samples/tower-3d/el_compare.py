"""el_compare.py : <tower>-3d/camera-23-vs-30.png, the old 23 degree camera (render/el23/t<N>.png, kept from before the
switch) beside the 30 degree one (render/t<N>/full-h09.png), one row per tier, cropped to the tower and enlarged, on grass
green, bottoms lined up (owner, 28 Oct: Cannon and Sniper go to the game's 30 degrees, as the Laser).

  python art-samples/tower-3d/el_compare.py [cannon sniper]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

A = Path(__file__).resolve().parent.parent
SCALE = 1.25
GRASS, PAD, BAR = (96, 150, 64, 255), 24, 44


def crop(path):
    im = Image.open(path).convert("RGBA")
    im = im.crop(im.getbbox())
    return im.resize((round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS)


def sheet(tower):
    font = ImageFont.truetype("arialbd.ttf", 26)
    R = A / f"{tower}-3d" / "render"
    rows = [[(f"tier {t}: 23° (old)", crop(R / "el23" / f"t{t}.png")),
             (f"tier {t}: 30° (game)", crop(R / f"t{t}" / "full-h09.png"))] for t in (1, 2, 3)]
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
    out = A / f"{tower}-3d" / "camera-23-vs-30.png"
    S.convert("RGB").save(out, optimize=True)
    print(out, S.size)


if __name__ == "__main__":
    for tw in sys.argv[1:] or ("cannon", "sniper"):
        sheet(tw)
