"""rows.py : the silhouette's left and right ends per row (Flash px), Flash vs 3D, to compare widths part by part.

    python rows.py [render.png] [y0 y1 step]
"""
import sys

import numpy as np
from PIL import Image

import fref

r = Image.open(sys.argv[1] if len(sys.argv) > 1 else "work/fit-L1.png").convert("RGBA")
k = r.width // (fref.FRAME[2] - fref.FRAME[0])
f = np.array(fref.flash_rgba().getchannel("A").resize(r.size, Image.BILINEAR)) > 128
t = np.array(r.getchannel("A")) > 128
x0, y0 = fref.FRAME[:2]
a = [int(v) for v in sys.argv[2:5]] if len(sys.argv) > 4 else [-40, 60, 4]
for y in range(a[0], a[1], a[2]):
    row = (y - y0) * k + k // 2
    out = []
    for m in (f, t):
        xs = np.nonzero(m[row])[0]
        out.append("%6.1f %6.1f" % (xs.min() / k + x0, xs.max() / k + x0) if len(xs) else "     -      -")
    print("y %4d  Flash %s   3D %s" % (y, *out))
