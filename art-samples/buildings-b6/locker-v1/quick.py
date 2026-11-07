"""quick.py : Flash | Codex | the quick fit render (work/fit-L<n>.png), one level, on grass, for fast iteration.

    python quick.py <level> [out.png] [scale]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import fref
import sheet3
from post import GRASS, flash, on_grass

HERE = Path(__file__).resolve().parent


def main():
    lv = int(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else str(HERE / "work" / f"quick-L{lv}.png")
    k = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    t = Image.open(HERE / "work" / f"fit-L{lv}.png").convert("RGBA")
    size = t.size
    f = flash(lv, 0, size)
    a = np.array(fref.flash_rgba(lv).resize(size).getchannel("A")) > 8
    a |= np.array(t.getchannel("A")) > 40
    ys, xs = np.nonzero(a)
    pad = 12
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(size[0], xs.max() + pad), min(size[1], ys.max() + pad))
    f = f.crop(box)
    tt = on_grass(t).crop(box)
    left, right = sheet3.panels(lv)
    s = sheet3.codex_scale(lv, left)
    kk = size[0] / (fref.FRAME[2] - fref.FRAME[0])
    c = right.resize((round(right.width * kk / s), round(right.height * kk / s)), Image.LANCZOS)
    if c.height > f.height:
        y = (c.height - f.height) // 2
        c = c.crop((0, y, c.width, y + f.height))
    w = f.width + c.width + tt.width + 8
    im = Image.new("RGB", (w, max(f.height, c.height, tt.height)), (20, 20, 20))
    x = 0
    for p in (f, c, tt):
        im.paste(p.convert("RGB"), (x, 0))
        x += p.width + 4
    if k != 1.0:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    im.save(out)
    print(out, im.size)


if __name__ == "__main__":
    main()
