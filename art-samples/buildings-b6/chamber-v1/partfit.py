"""partfit.py : the outlines of each part, Flash over 3D (not only the whole building's outline).

    python partfit.py [render.png] [zoom]   -> work/partfit.png
Colour edges (where the colour changes sharply: part against part, part against grass) of Flash in red and of the 3D in
cyan, both on a pale copy of the 3D picture, at `zoom` px per Flash px. Where the red and cyan lines lie on each other the
part sits and is sized as in Flash.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

import fref

HERE = Path(__file__).resolve().parent
GRASS = (96, 140, 60)


def on_grass(im):
    bg = Image.new("RGBA", im.size, GRASS + (255,))
    bg.alpha_composite(im)
    return bg.convert("RGB")


def edges(rgb, q=94):
    a = np.array(rgb.filter(ImageFilter.GaussianBlur(1.0))).astype(float)
    gx = np.abs(np.diff(a, axis=1, append=a[:, -1:])).sum(2)
    gy = np.abs(np.diff(a, axis=0, append=a[-1:])).sum(2)
    g = np.hypot(gx, gy)
    return g > np.percentile(g, q)


def main(path, z):
    r = Image.open(path).convert("RGBA")
    w = (fref.FRAME[2] - fref.FRAME[0]) * z
    h = (fref.FRAME[3] - fref.FRAME[1]) * z
    t = on_grass(r.resize((w, h), Image.LANCZOS))
    f = on_grass(fref.flash_rgba().resize((w, h), Image.BICUBIC))
    ef, et = edges(f), edges(t)
    base = np.array(t).astype(float) * 0.45 + 140
    base[et] = (40, 230, 255)
    base[ef] = (255, 40, 40)
    base[ef & et] = (255, 255, 255)
    out = Image.fromarray(base.clip(0, 255).astype(np.uint8))
    a = np.array(r.resize((w, h)).getchannel("A")) > 8
    ys, xs = np.nonzero(a)
    p = 3 * z
    out = out.crop((max(0, xs.min() - p), max(0, ys.min() - p), min(w, xs.max() + p), min(h, ys.max() + p)))
    out.save(HERE / "work/partfit.png")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else HERE / "render/L1-base.png", int(sys.argv[2]) if len(sys.argv) > 2 else 8)


def area(path, x0, y0, x1, y1, z=16, name="area"):
    """One area (Flash px around the origin) of the part outlines, at z px per Flash px -> work/partfit-<name>.png."""
    r = Image.open(path).convert("RGBA")
    w = (fref.FRAME[2] - fref.FRAME[0]) * z
    h = (fref.FRAME[3] - fref.FRAME[1]) * z
    t = on_grass(r.resize((w, h), Image.LANCZOS))
    f = on_grass(fref.flash_rgba().resize((w, h), Image.BICUBIC))
    ef, et = edges(f), edges(t)
    base = np.array(t).astype(float) * 0.45 + 140
    base[et] = (40, 230, 255)
    base[ef] = (255, 40, 40)
    base[ef & et] = (255, 255, 255)
    fx, fy = fref.FRAME[:2]
    box = ((x0 - fx) * z, (y0 - fy) * z, (x1 - fx) * z, (y1 - fy) * z)
    Image.fromarray(base.clip(0, 255).astype(np.uint8)).crop(box).save(HERE / f"work/partfit-{name}.png")
