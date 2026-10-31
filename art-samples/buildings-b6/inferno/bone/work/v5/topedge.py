"""topedge.py : the hopper's outline, Flash vs 3D (frame 0, level 3), in Flash px: the top edge's height per column and
the left edge's x per row, so the slab can be laid over Flash's by numbers as well as by eye."""
import sys; from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0, '.')
import ipost, iref
ipost.D = Path('bone').resolve(); ipost.C = ipost.load(ipost.D)
m = ipost.frame3d(3, 0)
fa = np.asarray(iref.flash_rgba(1, 3, 0, ipost.C.FRAME).resize(m.size, Image.BICUBIC).getchannel('A')) > 128
ma = np.asarray(m.getchannel('A')) > 128
K = 12
X0, Y0 = ipost.C.FRAME[:2]
print("top edge y (Flash px) at x:   x   flash   3d")
for x in range(-2, 36, 2):
    c = int((x - X0) * K)
    f = np.nonzero(fa[:, c])[0]; g = np.nonzero(ma[:, c])[0]
    print("%5d %7.1f %6.1f" % (x, f[0] / K + Y0 if len(f) else 99, g[0] / K + Y0 if len(g) else 99))
print("left edge x at y:   y   flash   3d  (x > -10 only, the hopper)")
for y in range(-36, 6, 2):
    r = int((y - Y0) * K)
    lo = int((-10 - X0) * K)
    f = np.nonzero(fa[r, lo:])[0]; g = np.nonzero(ma[r, lo:])[0]
    print("%5d %7.1f %6.1f" % (y, (f[0] + lo) / K + X0 if len(f) else 99, (g[0] + lo) / K + X0 if len(g) else 99))
