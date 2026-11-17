"""post.py : the Inferno Academy's pictures from its renders.

python post.py fit <look>      work/cmp-fit-L<n>.png: the quick fit render with Flash's outline (red) laid over it,
                               beside Flash and a half-and-half blend
python post.py frames <look>   render/L<n>-f-kk.png: base + moving parts, every cell
python post.py sheets          sheet-*.png, crop-*.png
python post.py mp4             academy-L<n>-training.mp4 (Flash still beside the 3D loop, three times)
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FLASH = HERE.parents[3] / "server/public/assets/buildings/iacademy"
FRAME = (-80, -110, 90, 80)
POINT = {1: (-50, -55), 2: (-56, -95)}
DPOINT = {1: (-48, -21), 2: (-56, -91)}
SHADOW = {1: (-50, -30), 2: (-61, -30)}
BG = (96, 60, 52)
CELLS = {1: 44, 2: 47}


def flash_canvas(look, k, state=""):
    """Flash's picture on the render's canvas at k px per Flash px (hard pixels)."""
    name = f"top.{look}{'.' + state if state else ''}.png"
    im = Image.open(FLASH / name).convert("RGBA")
    pt = (DPOINT if state == "damaged" else POINT)[look]
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    c.alpha_composite(im, (pt[0] - FRAME[0], pt[1] - FRAME[1]))
    return c.resize((w * k, h * k), Image.NEAREST)


def outline(im, width=2):
    a = im.getchannel("A").point(lambda v: 255 if v > 100 else 0)
    edge = Image.fromarray(np.asarray(a.filter(ImageFilter.MaxFilter(2 * width + 1))) - np.asarray(a))
    red = Image.new("RGBA", im.size, (255, 30, 30, 255))
    red.putalpha(edge)
    return red


def on_bg(im):
    b = Image.new("RGBA", im.size, BG + (255,))
    b.alpha_composite(im)
    return b


def fit(look):
    r = Image.open(HERE / f"work/fit-L{look}.png").convert("RGBA")
    k = r.width // (FRAME[2] - FRAME[0])
    f = flash_canvas(look, k)
    a = on_bg(r)
    a.alpha_composite(outline(f))
    blend = Image.blend(on_bg(r), on_bg(f), 0.5)
    box = {1: (20, 45, 140, 175), 2: (15, 5, 150, 180)}[look]
    box = tuple(v * k for v in box)
    parts = [im.crop(box).resize(((box[2] - box[0]) * 2, (box[3] - box[1]) * 2), Image.NEAREST) for im in (a, blend)]
    d = ImageDraw.Draw(parts[0])
    for gx in range(0, parts[0].width, 80):          # a tick every 10 Flash px
        d.line((gx, 0, gx, 12), fill=(255, 255, 255))
        d.text((gx + 2, 12), str(FRAME[0] + (box[0] // k) + gx // 8), fill=(255, 255, 255))
    for gy in range(0, parts[0].height, 80):
        d.line((0, gy, 12, gy), fill=(255, 255, 255))
        d.text((14, gy), str(FRAME[1] + (box[1] // k) + gy // 8), fill=(255, 255, 255))
    s = Image.new("RGB", (sum(p.width for p in parts), parts[0].height))
    x = 0
    for p in parts:
        s.paste(p.convert("RGB"), (x, 0))
        x += p.width
    s.save(HERE / f"work/cmp-fit-L{look}.png")


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "fit":
        fit(int(sys.argv[2]))
