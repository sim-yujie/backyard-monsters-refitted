"""measure.py <level> [render] : Flash vs 3D outline numbers (Flash px): top/bottom per column, left/right per row."""
import sys
from pathlib import Path
import numpy as np
import fit, fref
lv = int(sys.argv[1])
src = Path(sys.argv[2]) if len(sys.argv) > 2 else fit.HERE / f"work/fit-L{lv}.png"
im, k, f, t = fit.masks(lv, src)
x0, y0 = fref.FRAME[:2]
def col(m, x):
    c = m[:, int((x - x0) * k + k / 2)]
    ys = np.nonzero(c)[0]
    return (ys.min() / k + y0, ys.max() / k + y0) if len(ys) else None
def row(m, y):
    r = m[int((y - y0) * k + k / 2), :]
    xs = np.nonzero(r)[0]
    return (xs.min() / k + x0, xs.max() / k + x0) if len(xs) else None
fmt = lambda p: "none" if p is None else "%6.1f %6.1f" % p
print("col   Flash top/bot   3D top/bot")
for x in (-50, -45, -40, -30, -20, -10, 0, 10, 20, 30, 40, 45, 50):
    print("%4d  %s   %s" % (x, fmt(col(f, x)), fmt(col(t, x))))
print("row   Flash l/r       3D l/r")
for y in range(-20, 85, 5):
    print("%4d  %s   %s" % (y, fmt(row(f, y)), fmt(row(t, y))))
print("IoU %.3f" % fit.iou(f, t))
