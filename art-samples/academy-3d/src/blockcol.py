"""blockcol.py : the gold blocks' colours in the opening, Flash vs 3D (frame 0), by brightness tier.

    python blockcol.py <level> [render dir]
    python blockcol.py <level> <fit png> x0,y0,x1,y1     a quick fit render of PB_FRAME x0,y0,x1,y1 (any PB_K)
Prints, for the warm pixels inside the opening (red well above blue), the mean colour of the darkest, middle and
brightest thirds, and the mean saturation; Flash's blocks are bright saturated gold, cream lit faces, black gaps.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import fref
import post

LV = int(sys.argv[1])
R = Path(sys.argv[2]) if len(sys.argv) == 3 else post.R
BOX = {1: (-14, -12, 16, 4), 2: (-14, -12, 16, 4), 3: (-16, -16, 16, 0), 4: (-16, -35, 16, -19)}[LV]


def tiers(a, name, fr=fref.FRAME):
    x0, y0 = fr[:2]
    r = a[BOX[1] - y0:BOX[3] - y0, BOX[0] - x0:BOX[2] - x0].reshape(-1, 4)
    r = r[r[:, 3] > 250][:, :3]
    warm = r[(r[:, 0] - r[:, 2] > 50)]
    lum = warm.mean(1)
    o = np.argsort(lum)
    n = len(o)
    mx, mn = warm.max(1), warm.min(1)
    sat = ((mx - mn) / np.maximum(mx, 1)).mean()
    dark = (r.mean(1) < 50).mean()
    out = [f"{name}: warm px {n} / {len(r)}  sat {sat:.2f}  near-black {dark:.0%}"]
    for k, lab in enumerate(("dark", "mid", "bright")):
        s = o[k * n // 3:(k + 1) * n // 3]
        out.append(f"   {lab:6s} {warm[s].mean(0).round().astype(int)}")
    print("\n".join(out))


f = np.array(fref.flash_rgba(LV)).astype(float)
tiers(f, "Flash")
if len(sys.argv) > 3:
    fr = tuple(int(c) for c in sys.argv[3].split(","))
    t = Image.open(sys.argv[2]).convert("RGBA")
    t = np.array(t.resize((fr[2] - fr[0], fr[3] - fr[1]), Image.BOX)).astype(float)
    tiers(t, "3D   ", fr)
else:
    t = post.frame3d(LV, 0, R)
    t = np.array(t.resize(fref.flash_rgba(LV).size, Image.BOX)).astype(float)
    tiers(t, "3D   ")
