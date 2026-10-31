"""mbtex.py : the matchbook cover's print (Flash's red cover, yellow flame with a match, white "MATCH BOOK"), painted
flat in the cover's own plane for store.py to map onto it.

    python mbtex.py        -> matchbook.png  (200 px per world unit; left = stack.MB_X0, top = stack.MB_Z1)
"""
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import stack as S

HERE = Path(__file__).resolve().parent
PPU = 200
W, H = int((S.MB_X1 - S.MB_X0) * PPU), int((S.MB_Z1 - S.MB_Z0) * PPU)


def tx(x):
    return (x - S.MB_X0) * PPU


def ty(z):
    return (S.MB_Z1 - z) * PPU


def font(n):
    return ImageFont.truetype("ariblk.ttf", n)


def text_fit(img, s, box, fill, outline, out_w):
    """s stretched to fill box (x0, y0, x1, y1), white with a soft dark-red edge."""
    f = font(200)
    l, t, r, b = f.getbbox(s)
    layer = Image.new("RGBA", (r - l + 2 * out_w + 8, b - t + 2 * out_w + 8), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((out_w + 4 - l, out_w + 4 - t), s, font=f, fill=fill, stroke_width=out_w, stroke_fill=outline)
    x0, y0, x1, y1 = [int(v) for v in box]
    layer = layer.resize((x1 - x0, y1 - y0), Image.LANCZOS)
    img.alpha_composite(layer, (x0, y0))


def main():
    rng = np.random.default_rng(12)
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    # the cover: Flash's pinkish red, paler toward the top left, deeper toward the bottom and the fold on the right
    base = np.array((204, 58, 74), float)
    light = (1.0 - 0.6 * (xx / W) - 0.6 * (yy / H)).clip(-0.6, 1.0)
    col = base[None, None] * (1 + 0.1 * light[..., None])
    col[..., 1:] += 10 * light[..., None].clip(0, 1)
    # soft mottle (printed card that has been handled)
    n = rng.normal(0, 1, (H // 24 + 2, W // 24 + 2))
    n = np.array(Image.fromarray(((n + 3) * 40).clip(0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), float)
    col *= (1 + (n - 120) / 120 * 0.05)[..., None]
    img = Image.fromarray(col.clip(0, 255).astype(np.uint8)).convert("RGBA")
    d = ImageDraw.Draw(img)

    # a pale band under "MATCH" (Flash's lighter stripe between the two words)
    band = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(band).rectangle((0, ty(1.62), tx(1.5), ty(1.5)), fill=(236, 150, 160, 150))
    img.alpha_composite(band.filter(ImageFilter.GaussianBlur(3)))

    # the flame: a rounded drop, its tip up and to the right, with an orange rim
    cx, cy = tx(-0.45), ty(3.5)
    pts = []
    for i in range(120):
        a = 2 * math.pi * i / 120
        r = 1.0 + 0.5 * max(0.0, math.cos(a + math.radians(30))) ** 6      # the tip down and to the right
        pts.append((cx + 205 * r * math.cos(a) * 0.95, cy - 128 * r * math.sin(a)))
    fl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(fl)
    fd.polygon(pts, fill=(226, 160, 52, 255))
    inner = [(cx + (x - cx) * 0.94, cy + (y - cy) * 0.92) for x, y in pts]
    fd.polygon(inner, fill=(238, 196, 64, 255))
    hi = [(cx - 30 + (x - cx) * 0.55, cy - 22 + (y - cy) * 0.45) for x, y in pts]
    fd.polygon(hi, fill=(244, 208, 90, 255))
    fl = fl.filter(ImageFilter.GaussianBlur(4))
    img.alpha_composite(fl)

    # the match: a pale stick from the dark head (in the flame) down to the right, over the text
    hx, hy = tx(-0.98), ty(3.22)
    ex, ey = tx(1.1), ty(2.25)
    m = Image.new("RGBA", img.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(m)
    md.line((hx, hy, ex, ey), fill=(244, 226, 222, 255), width=11)
    ang = math.atan2(ey - hy, ex - hx)
    hp = []
    for i in range(40):
        a = 2 * math.pi * i / 40
        u, v = 46 * math.cos(a), 26 * math.sin(a)
        hp.append((hx + u * math.cos(ang) - v * math.sin(ang), hy + u * math.sin(ang) + v * math.cos(ang)))
    md.polygon(hp, fill=(26, 30, 60, 255))
    img.alpha_composite(m.filter(ImageFilter.GaussianBlur(2)))

    # the words: "MATCH" over "BOOK", heavy white letters with a dark red edge, nearly the cover's width
    t = Image.new("RGBA", img.size, (0, 0, 0, 0))
    text_fit(t, "MATCH", (tx(-3.0), ty(2.45), tx(1.05), ty(1.62)), (246, 234, 236, 255), (214, 120, 132, 255), 5)
    text_fit(t, "BOOK", (tx(-2.98), ty(1.5), tx(0.98), ty(0.62)), (242, 226, 230, 255), (214, 120, 132, 255), 5)
    img.alpha_composite(t.filter(ImageFilter.GaussianBlur(1.5)))

    # worn: a few pale scuffs and creases
    wr = random.Random(5)
    s = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(s)
    for _ in range(14):
        x, y = wr.uniform(0, W), wr.uniform(0, H)
        sd.line((x, y, x + wr.uniform(-60, 60), y + wr.uniform(-20, 20)), fill=(250, 200, 205, 60), width=3)
    img.alpha_composite(s.filter(ImageFilter.GaussianBlur(2)))
    img.convert("RGB").save(HERE / "matchbook.png")
    print("matchbook.png", img.size)


if __name__ == "__main__":
    main()
