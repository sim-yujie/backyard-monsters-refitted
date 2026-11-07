"""keywidth.py : the key bow's width (Flash px) per frame, Flash vs the 3D moving-parts renders, to match the turn.

    python keywidth.py <level> [x0 y0 x1 y1]
Flash: gold-ish pixels in the box; 3D: render/L<level>-parts-NN.png alpha in the box (K px per Flash px).
Prints both rows and the frame shift that best lines them up (3D shifted by +s frames matches Flash).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import fref
import stack as S

HERE = Path(__file__).resolve().parent
BOX = {2: (-42, -92, -12, -62), 3: (-47, -92, -14, -60), 4: (-47, -92, -26, -62)}


def gold(rgb):
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    return (r > 90) & (r > b + 40) & (g > b)


def widths(lv, box):
    n = S.FRAMES[lv]
    x0, y0, x1, y1 = box
    fx0, fy0 = fref.FRAME[:2]
    fl, td = [], []
    for k in range(n):
        im = np.array(fref.flash_rgba(lv, k))[y0 - fy0:y1 - fy0, x0 - fx0:x1 - fx0]
        m = gold(im[..., :3]) & (im[..., 3] > 128)
        cols = np.where(m.any(0))[0]
        fl.append(np.ptp(cols) + 1 if len(cols) else 0)
        p = HERE / "render" / f"L{lv}-parts-{k:02d}.png"
        if p.exists():
            r = Image.open(p)
            K = r.width // (fref.FRAME[2] - fref.FRAME[0])
            a = np.array(r.getchannel("A"))[(y0 - fy0) * K:(y1 - fy0) * K, (x0 - fx0) * K:(x1 - fx0) * K] > 128
            cols = np.where(a.any(0))[0]
            td.append((np.ptp(cols) + 1) / K if len(cols) else 0)
    return np.array(fl, float), np.array(td, float)


def main():
    lv = int(sys.argv[1])
    box = tuple(int(v) for v in sys.argv[2:6]) if len(sys.argv) > 5 else BOX[lv]
    fl, td = widths(lv, box)
    print("flash", " ".join(f"{v:4.0f}" for v in fl))
    if len(td) == len(fl):
        print("3d   ", " ".join(f"{v:4.1f}" for v in td))
        n = len(fl)
        errs = [(np.abs(np.roll(td, s) - fl).mean(), s) for s in range(-n // 2, n // 2 + 1)]
        e, s = min(errs)
        print("best shift (3D frames later +):", s, "mean err %.2f" % e, " no shift err %.2f" % np.abs(td - fl).mean())


if __name__ == "__main__":
    main()
