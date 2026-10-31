"""cols.py : the silhouette's top and bottom per column (Flash px), Flash vs 3D. python cols.py [render] [x0 x1 step]"""
import sys

import numpy as np
from PIL import Image

import fref

r = Image.open(sys.argv[1] if len(sys.argv) > 1 else "render/L1-alone.png").convert("RGBA")
k = r.width // (fref.FRAME[2] - fref.FRAME[0])
f = np.array(fref.flash_rgba().getchannel("A").resize(r.size, Image.BILINEAR)) > 128
t = np.array(r.getchannel("A")) > 128
x0, y0 = fref.FRAME[:2]
a = [int(v) for v in sys.argv[2:5]] if len(sys.argv) > 4 else [-40, 44, 4]
for x in range(a[0], a[1], a[2]):
    col = (x - x0) * k + k // 2
    out = []
    for m in (f, t):
        ys = np.nonzero(m[:, col])[0]
        # the runs of building in this column
        runs, s0 = [], None
        for i in range(len(ys)):
            if s0 is None:
                s0 = ys[i]
            if i == len(ys) - 1 or ys[i + 1] != ys[i] + 1:
                runs.append("%.1f..%.1f" % (s0 / k + y0, ys[i] / k + y0))
                s0 = None
        out.append(" ".join(runs))
    print("x %4d  Flash %-34s 3D %s" % (x, *out))
