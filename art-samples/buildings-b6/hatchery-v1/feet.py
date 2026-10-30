"""feet.py <level> [render] : the middle of each foot, Flash vs 3D (Flash px), from the outline below the body."""
import sys
import numpy as np
import fit
import fref
lv = int(sys.argv[1])
im, k, f, t = fit.masks(lv, sys.argv[2] if len(sys.argv) > 2 else f"work/fit-L{lv}.png")
x0, y0 = fref.FRAME[:2]
YA = {2: 42, 3: 48}.get(lv, 42)


def cen(m, xa, xb, ya, yb=97):
    sub = m[(ya - y0) * k:(yb - y0) * k, (xa - x0) * k:(xb - x0) * k]
    ys, xs = np.nonzero(sub)
    return (round(xs.mean() / k + xa, 1), round(ys.mean() / k + ya, 1)) if len(xs) else None


for name, (a, b, ya) in {"left": (-57, -24, YA), "front": (-12, 12, YA + 12), "right": (24, 60, YA)}.items():
    print(name, "flash", cen(f, a, b, ya), "3d", cen(t, a, b, ya))
