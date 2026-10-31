"""rows.py : Flash and 3D silhouettes compared row by row (Flash px), to measure where a part is too wide or high.

    python rows.py <level> [render.png] [step] [y0 y1]  -> per row: Flash x-span(s) | 3D x-span(s)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import fref

HERE = Path(__file__).resolve().parent


def spans(row, x0, k):
    xs = np.nonzero(row)[0]
    if not len(xs):
        return "-"
    out, s = [], xs[0]
    for a, b in zip(xs, xs[1:]):
        if b - a > k:                       # a gap of over one Flash px
            out.append((s, a))
            s = b
    out.append((s, xs[-1]))
    return " ".join(f"{x0 + a / k:.0f}..{x0 + b / k:.0f}" for a, b in out if b - a >= k)


if __name__ == "__main__":
    lv = int(sys.argv[1])
    src = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] != "-" else HERE / f"work/fit-L{lv}.png"
    step = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    im = Image.open(src).convert("RGBA")
    k = im.width / (fref.FRAME[2] - fref.FRAME[0])
    f = np.array(fref.flash_rgba(lv).resize(im.size, Image.BILINEAR).getchannel("A")) > 128
    t = np.array(im.getchannel("A")) > 128
    ys = np.nonzero((f | t).any(1))[0]
    ya = int(sys.argv[4]) if len(sys.argv) > 5 else int(fref.FRAME[1] + ys.min() / k)
    yb = int(sys.argv[5]) if len(sys.argv) > 5 else int(fref.FRAME[1] + ys.max() / k)
    for y in range(ya - ya % step, yb + 1, step):
        r = int((y - fref.FRAME[1]) * k)
        print(f"y {y:4d}  F {spans(f[r], fref.FRAME[0], k):28s} | 3D {spans(t[r], fref.FRAME[0], k)}")
