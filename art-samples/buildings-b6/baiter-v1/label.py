"""label.py : the spray can's paper label as a flat picture (label.png), wrapped round the can by baiter.py.

    python label.py            -> label.png (and work/label-preview.png, the front half as the camera sees it)

u runs once round the can: u = (bearing + 225) / 360, so the front (bearing -45, toward the viewer) is the middle.
v runs up the can from its foot (z 0) to the shoulder (z CAN_Z1). Flash's front reads, top to bottom: green slime
dripping from the shoulder, "...R SPRAY" in fat yellow letters with a dark rim, "...d Get it !" in black, white below
with a purple splash on the left and a little green monster on the right.
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

import stack as S

HERE = Path(__file__).resolve().parent
W, H = 2400, int(2400 * S.CAN_Z1 / (2 * math.pi * S.CAN_R))
rng = random.Random(19)


def U(bearing):
    return (bearing + 225.0) / 360.0 * W


def V(z):
    return (1.0 - z / S.CAN_Z1) * H


def font(name, size):
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size)


def blob(d, cx, cy, r, col, n=14, jit=0.35):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r * (1 + rng.uniform(-jit, jit))
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=col)


def splash(im, cx, cy, r, col, drops=9, drips=4, seed=0):
    """A soft paint splash: a lumpy middle, flung drops round it and a few drips running down."""
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    blob(d, cx, cy, r, col, 18, 0.3)
    for _ in range(drops):
        a = rng.uniform(0, 2 * math.pi)
        dist = r * rng.uniform(1.0, 1.7)
        blob(d, cx + dist * math.cos(a), cy + dist * math.sin(a) * 0.8, r * rng.uniform(0.1, 0.3), col, 8, 0.3)
    for _ in range(drips):
        x = cx + rng.uniform(-r * 0.8, r * 0.8)
        L = r * rng.uniform(0.6, 1.4)
        w = r * rng.uniform(0.08, 0.16)
        d.rounded_rectangle((x - w, cy, x + w, cy + L), radius=w, fill=col)
    lay = lay.filter(ImageFilter.GaussianBlur(1.2))
    im.alpha_composite(lay)


def make():
    im = Image.new("RGBA", (W, H), (198, 200, 198, 255))
    d = ImageDraw.Draw(im)
    # faint paper mottle
    for _ in range(900):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        g = rng.randint(-14, 6)
        d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(198 + g, 200 + g, 198 + g, 255))
    im = im.filter(ImageFilter.GaussianBlur(4))
    d = ImageDraw.Draw(im)
    # the green slime round the top, dripping down
    slime = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(slime)
    top = V(S.CAN_Z1)
    edge = V(S.CAN_Z1 - 0.5)
    sd.rectangle((0, top, W, edge), fill=(118, 186, 58, 255))
    # the shade under the crown's teeth: dark, so the pale green teeth stand out as Flash's do
    sd.rectangle((0, top, W, V(S.CROWN_Z1 - S.CROWN_H - S.TOOTH_H + 0.02)), fill=(50, 60, 48, 255))
    x = 0.0
    while x < W:
        w = rng.uniform(18, 46)
        L = rng.uniform(0.12, 0.75) * (S.CAN_Z1 / 4.3)
        if rng.random() < 0.3:
            L *= 1.8
        y1 = edge + L * H / S.CAN_Z1
        sd.rounded_rectangle((x, edge - 10, x + w, y1), radius=w / 2, fill=(118, 186, 58, 255))
        x += w * rng.uniform(0.7, 1.4)
    # darker green streaks in the slime
    for _ in range(120):
        x = rng.uniform(0, W)
        y = rng.uniform(top, edge + 30)
        sd.ellipse((x - 14, y - 6, x + 14, y + 6), fill=(70, 128, 40, 255))
    slime = slime.filter(ImageFilter.GaussianBlur(2.0))
    im.alpha_composite(slime)
    # green splats round the words
    for b in (-150, -118, -96, -60, -20, 8, 40, 75, 110):
        splash(im, U(b + rng.uniform(-6, 6)), V(rng.uniform(2.5, 3.4)), rng.uniform(14, 28), (104, 170, 52, 255),
               drops=6, drips=2)
    # the big words, fat yellow with an orange inner shade and a dark rim
    f = font("BRLNSDB.TTF", 190)

    def word(text, b0, b1, z0, z1, fill, rim, fnt, stroke):
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        bb = ld.textbbox((0, 0), text, font=fnt, stroke_width=stroke)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        tmp = Image.new("RGBA", (tw + 8, th + 8), (0, 0, 0, 0))
        td = ImageDraw.Draw(tmp)
        td.text((4 - bb[0], 4 - bb[1]), text, font=fnt, fill=fill, stroke_width=stroke, stroke_fill=rim)
        x0, x1 = U(b0), U(b1)
        y0, y1 = V(z1), V(z0)
        tmp = tmp.resize((int(x1 - x0), int(y1 - y0)), Image.LANCZOS)
        lay.alpha_composite(tmp, (int(x0), int(y0)))
        return lay

    yel = word("MONSTER", -212, -100, 2.55, 3.62, (246, 206, 40, 255), (44, 30, 8, 255), f, 12)
    im.alpha_composite(yel)
    im.alpha_composite(word("SPRAY", -92, -10, 2.52, 3.62, (246, 206, 40, 255), (44, 30, 8, 255), f, 12))
    # an orange shade low in the letters (Flash's letters are lighter on top)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((0, V(2.95), W, V(2.5)), fill=(214, 120, 20, 110))
    mask = Image.new("L", (W, H), 0)
    for lay in (yel,):
        pass
    # the small black line
    f2 = font("ariblk.ttf", 120)
    im.alpha_composite(word("Spray it and Get it !", -175, -36, 1.62, 2.36, (18, 18, 18, 255), (18, 18, 18, 255), f2, 0))
    # the purple splash low on the left, the little green monster low on the right
    splash(im, U(-100), V(0.55), 70, (128, 92, 204, 255), drops=10, drips=0)
    splash(im, U(-82), V(0.9), 34, (150, 112, 220, 255), drops=5, drips=2)
    mon = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    md = ImageDraw.Draw(mon)
    cx, cy = U(-20), V(0.62)
    blob(md, cx, cy, 78, (62, 150, 48, 255), 20, 0.12)
    md.polygon([(cx - 60, cy - 50), (cx - 40, cy - 112), (cx - 22, cy - 66)], fill=(62, 150, 48, 255))
    md.polygon([(cx + 30, cy - 66), (cx + 52, cy - 118), (cx + 66, cy - 46)], fill=(62, 150, 48, 255))
    md.ellipse((cx - 30, cy - 46, cx + 26, cy + 8), fill=(236, 240, 230, 255))
    md.ellipse((cx - 10, cy - 30, cx + 12, cy - 6), fill=(16, 20, 14, 255))
    md.arc((cx - 40, cy + 10, cx + 40, cy + 56), 10, 170, fill=(20, 60, 16, 255), width=8)
    im.alpha_composite(mon.filter(ImageFilter.GaussianBlur(1.0)))
    # the paper's printed edge: a thin grey line at the top and foot
    d = ImageDraw.Draw(im)
    d.rectangle((0, V(0.14), W, H), fill=(150, 152, 158, 255))
    return im.convert("RGB")


def preview(im):
    """The front half as the camera sees it: u squeezed by the sine of the bearing."""
    out = Image.new("RGB", (800, H), (96, 140, 60))
    src = im.load()
    for x in range(800):
        s = (x - 400) / 400.0 * 0.999
        b = -45.0 + math.degrees(math.asin(s))
        u = int(U(b)) % W
        for y in range(H):
            out.putpixel((x, y), src[u, y])
    return out


if __name__ == "__main__":
    im = make()
    im.save(HERE / "label.png")
    (HERE / "work").mkdir(exist_ok=True)
    preview(im).save(HERE / "work/label-preview.png")
    print("label", im.size)
