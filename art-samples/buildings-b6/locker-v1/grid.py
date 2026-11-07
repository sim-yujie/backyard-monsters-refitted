"""grid.py : Flash and a fit render side by side, cropped to Flash px x0..x1, y0..y1, with a 10 px grid.
    python grid.py <level> <render.png|-> <out.png> [x0 y0 x1 y1] [k]
"""
import sys
from PIL import Image, ImageDraw
import fref


def gridded(im, x0, y0, x1, y1, k):
    s = im.width // (fref.FRAME[2] - fref.FRAME[0])
    c = im.crop(((x0 + 72) * s, (y0 + 100) * s, (x1 + 72) * s, (y1 + 100) * s))
    c = c.resize(((x1 - x0) * k, (y1 - y0) * k), Image.LANCZOS if s > 1 else Image.NEAREST)
    bg = Image.new("RGB", c.size, (96, 140, 60))
    bg.paste(c, (0, 0), c)
    d = ImageDraw.Draw(bg)
    for fx in range(x0 - x0 % 10, x1 + 1, 10):
        X = (fx - x0) * k
        d.line((X, 0, X, bg.height), fill=(255, 0, 0) if fx == 0 else (230, 230, 0))
        d.text((X + 2, 2), str(fx), fill=(255, 255, 255))
    for fy in range(y0 - y0 % 10, y1 + 1, 10):
        Y = (fy - y0) * k
        d.line((0, Y, bg.width, Y), fill=(255, 0, 0) if fy == 0 else (230, 230, 0))
        d.text((2, Y + 2), str(fy), fill=(255, 255, 255))
    return bg


def main():
    lv = int(sys.argv[1])
    box = [int(v) for v in sys.argv[4:8]] if len(sys.argv) > 7 else [-60, -90, 60, 40]
    k = int(sys.argv[8]) if len(sys.argv) > 8 else 4
    ims = [gridded(fref.flash_rgba(lv, 0), *box, k)]
    if sys.argv[2] != "-":
        ims.append(gridded(Image.open(sys.argv[2]).convert("RGBA"), *box, k))
    out = Image.new("RGB", (sum(i.width for i in ims) + 6 * (len(ims) - 1), ims[0].height), (0, 0, 0))
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.width + 6
    out.save(sys.argv[3])
    print(sys.argv[3], out.size)


if __name__ == "__main__":
    main()
