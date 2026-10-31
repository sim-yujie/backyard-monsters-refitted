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

    # the flame: Flash's flat yellow "guitar pick": a rounded triangle, its top side running up to the right, its point
    # down (corners in world units round its middle, from the Flash picture)
    cx, cy = -0.45, 3.55
    corners = [(-1.08, -0.3), (0.98, 0.8), (0.16, -0.74)]
    bulge = (0.16, 0.2, 0.2)          # how far each side (corner k to k+1) bows outward
    pts = []
    for k in range(3):
        (x0, z0), (x1, z1) = corners[k], corners[(k + 1) % 3]
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        nx, nz = -(z1 - z0), x1 - x0            # outward (the corners run clockwise)
        ln = math.hypot(nx, nz)
        qx, qz = mx + nx / ln * bulge[k] * 2, mz + nz / ln * bulge[k] * 2
        for i in range(40):
            t = i / 40
            x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * qx + t * t * x1
            z = (1 - t) ** 2 * z0 + 2 * (1 - t) * t * qz + t * t * z1
            pts.append((tx(cx + x), ty(cy + z)))
    fl = Image.new("L", img.size, 0)
    ImageDraw.Draw(fl).polygon(pts, fill=255)
    fl = fl.filter(ImageFilter.GaussianBlur(22)).point(lambda v: 255 if v > 128 else 0)    # round the corners
    fl = fl.filter(ImageFilter.GaussianBlur(5))
    ys, xs = np.mgrid[0:H, 0:W].astype(float)
    g = ((ys - ty(cy + 0.8)) / (ty(cy - 0.8) - ty(cy + 0.8))).clip(0, 1)[..., None]      # paler at the top
    fc = np.array((250, 218, 86), float) * (1 - g) + np.array((236, 186, 48), float) * g
    flame = Image.fromarray(fc.astype(np.uint8)).convert("RGBA")
    flame.putalpha(fl)
    img.alpha_composite(flame)

    # the match: a pale stick from the dark head (in the flame) down to the right, over the text
    hx, hy = tx(-0.98), ty(3.22)
    ex, ey = tx(1.1), ty(2.25)
    m = Image.new("RGBA", img.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(m)
    md.line((hx, hy, ex, ey), fill=(240, 214, 214, 200), width=10)
    ang = math.atan2(ey - hy, ex - hx)
    hp = []
    for i in range(40):
        a = 2 * math.pi * i / 40
        u, v = 46 * math.cos(a), 26 * math.sin(a)
        hp.append((hx + u * math.cos(ang) - v * math.sin(ang), hy + u * math.sin(ang) + v * math.cos(ang)))
    md.polygon(hp, fill=(26, 30, 60, 255))
    img.alpha_composite(m.filter(ImageFilter.GaussianBlur(4)))

    # the words: "MATCH" over "BOOK", heavy soft white-pink letters with a light pink edge, nearly the cover's width
    t = Image.new("RGBA", img.size, (0, 0, 0, 0))
    text_fit(t, "MATCH", (tx(-3.0), ty(2.45), tx(1.05), ty(1.62)), (232, 200, 210, 255), (222, 146, 160, 255), 6)
    text_fit(t, "BOOK", (tx(-2.98), ty(1.5), tx(0.98), ty(0.62)), (222, 192, 204, 255), (222, 146, 160, 255), 6)
    img.alpha_composite(t.filter(ImageFilter.GaussianBlur(8)))

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
