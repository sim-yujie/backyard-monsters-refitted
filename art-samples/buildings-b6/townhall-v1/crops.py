"""crops.py : Flash above/beside 3D, one area enlarged, at the same scale (both on grass).

    python crops.py <level> <render.png|-> <name> x0 y0 x1 y1 [zoom]   -> work/crop-L<level>-<name>.png
Coordinates are Flash px around the origin (fref.FRAME); the render covers FRAME at any whole K px per Flash px.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import fref

HERE = Path(__file__).resolve().parent
GRASS = (96, 140, 60)


def crop(level, render, x0, y0, x1, y1, zoom=6, flash=None):
    fx, fy = fref.FRAME[:2]
    r = Image.open(render).convert("RGBA")
    k = r.width // (fref.FRAME[2] - fref.FRAME[0])
    w, h = (x1 - x0) * zoom, (y1 - y0) * zoom
    out = []
    f = (flash or fref.flash_rgba(level)).crop((x0 - fx, y0 - fy, x1 - fx, y1 - fy)).resize((w, h), Image.LANCZOS)
    t = r.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize((w, h), Image.LANCZOS)
    for im in (f, t):
        bg = Image.new("RGBA", (w, h), GRASS + (255,))
        bg.alpha_composite(im)
        out.append(bg.convert("RGB"))
    side = w <= h * 1.3
    W, H = (2 * w + 30, h + 40) if side else (w + 20, 2 * h + 70)
    sheet = Image.new("RGB", (W, H), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    try:
        fnt = ImageFont.truetype("arialbd.ttf", 22)
    except OSError:
        fnt = ImageFont.load_default()
    for i, (im, lab) in enumerate(zip(out, ("Flash", "3D"))):
        x, y = (10 + i * (w + 10), 35) if side else (10, 35 + i * (h + 35))
        sheet.paste(im, (x, y))
        d.text((x + 4, y - 29), f"{lab} L{level}", fill=(255, 255, 255), font=fnt)
    return sheet


if __name__ == "__main__":
    a = sys.argv
    lv = int(a[1])
    src = HERE / f"work/fit-L{lv}.png" if a[2] == "-" else Path(a[2])
    z = int(a[8]) if len(a) > 8 else 6
    crop(lv, src, *map(int, a[4:8]), zoom=z).save(HERE / f"work/crop-L{lv}-{a[3]}.png")
