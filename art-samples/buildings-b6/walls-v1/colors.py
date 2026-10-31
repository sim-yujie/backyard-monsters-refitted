"""colors.py : mean colour of the top, left face and right face, Flash beside 3D (whole look), in the same frame.

    python colors.py [look ...] [--src work/prev-{key}-whole.png]
Regions are fractions of Flash's own box, so both are sampled at the same pixels.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import flashwalls as F

HERE = Path(__file__).resolve().parent
FW, FH = F.FRAME[2] - F.FRAME[0], F.FRAME[3] - F.FRAME[1]
REG = {"top": (.4, .1, .6, .22), "left": (.12, .5, .35, .75), "right": (.65, .5, .88, .75)}


def means(arr, box):
    x0, y0, x1, y1 = box
    a = arr[y0:y1, x0:x1].reshape(-1, 4).astype(float)
    m = a[:, 3] > 200
    return tuple(int(c) for c in a[m][:, :3].mean(0)) if m.any() else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--src=")), "render/{key}-whole-alone.png")
    for key in args or F.LOOKS:
        fl = np.array(F.flash_rgba(key, "whole"))
        p = HERE / src.format(key=key)
        if not p.exists():
            continue
        md = np.array(Image.open(p).convert("RGBA").resize((FW, FH), Image.LANCZOS))
        ys, xs = np.nonzero(fl[..., 3] > 200)
        bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max(), ys.max()
        out = []
        for name, (a, b, c, d) in REG.items():
            box = (int(bx0 + a * (bx1 - bx0)), int(by0 + b * (by1 - by0)), int(bx0 + c * (bx1 - bx0)), int(by0 + d * (by1 - by0)))
            out.append(f"{name} {means(fl, box)} / {means(md, box)}")
        print(f"{key:9s} Flash / 3D  " + "   ".join(out))


main()
