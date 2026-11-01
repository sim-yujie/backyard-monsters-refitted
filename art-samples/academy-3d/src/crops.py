"""crops.py : Flash beside 3D, one area enlarged, at the same scale (both on grass).

    LV=<level> python crops.py <render.png> <name> x0 y0 x1 y1 [zoom]   -> work/crop-<name>.png
Coordinates are Flash px around the origin (fref.FRAME); the render covers FRAME at any whole K px per Flash px.
"""
import sys
from PIL import Image, ImageDraw, ImageFont
import fref

GRASS = (96, 140, 60)


def crop(render, x0, y0, x1, y1, zoom=8, level=None, frame=0):
    fx, fy = fref.FRAME[:2]
    import os
    level = level or int(os.environ.get("LV", "1"))
    r = Image.open(render).convert("RGBA")
    k = r.width // (fref.FRAME[2] - fref.FRAME[0])
    w, h = (x1 - x0) * zoom, (y1 - y0) * zoom
    out = []
    f = fref.flash_rgba(level, 1, frame).crop((x0 - fx, y0 - fy, x1 - fx, y1 - fy)).resize((w, h), Image.LANCZOS)
    t = r.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize((w, h), Image.LANCZOS)
    for im in (f, t):
        bg = Image.new("RGBA", (w, h), GRASS + (255,))
        bg.alpha_composite(im)
        out.append(bg.convert("RGB"))
    sheet = Image.new("RGB", (2 * w + 30, h + 40), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    try:
        fnt = ImageFont.truetype("arialbd.ttf", 22)
    except OSError:
        fnt = ImageFont.load_default()
    for i, (im, lab) in enumerate(zip(out, ("Flash", "3D"))):
        sheet.paste(im, (10 + i * (w + 10), 35))
        d.text((14 + i * (w + 10), 6), lab, fill=(255, 255, 255), font=fnt)
    return sheet


if __name__ == "__main__":
    a = sys.argv
    z = int(a[7]) if len(a) > 7 else 8
    crop(a[1], *map(int, a[3:7]), zoom=z).save(f"work/crop-{a[2]}.png")
