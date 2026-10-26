"""jitter.py <sheet> <col>... [rows=a-b]: per frame, upper-half centroid x / top y / bottom y of old vs new (1x px)."""
import sys, os
import numpy as np
from PIL import Image
from spec import SPECS, ASSETS
n = sys.argv[1]; s = SPECS[n]; w, h = s["w"], s["h"]
r0, r1 = map(int, os.environ.get("ROWS", f"0-{s['rows'] - 1}").split("-"))
old = np.asarray(Image.open(ASSETS / f"{n}.png").convert("RGBA"))[..., 3]
new = np.asarray(Image.open(ASSETS / f"{n}-repaint.png").convert("RGBA"))[..., 3]
def m(a, c, r, t):
    x = a[r * h:(r + 1) * h, c * w:(c + 1) * w] >= t
    ys, xs = np.where(x); top, bot = ys.min(), ys.max()
    up = ys < (top + bot) / 2
    return xs[up].mean(), top, bot + 1
for c in map(int, sys.argv[2].split(",")):
    o = [m(old, c, r, 200) for r in range(r0, r1 + 1)]; nw = [m(new, c, r, 128) for r in range(r0, r1 + 1)]
    print(f"col {c} old  x " + " ".join(f"{a[0]:5.1f}" for a in o) + "   bot " + " ".join(f"{a[2]}" for a in o))
    print(f"col {c} new  x " + " ".join(f"{a[0]:5.1f}" for a in nw) + "   bot " + " ".join(f"{a[2]}" for a in nw))
