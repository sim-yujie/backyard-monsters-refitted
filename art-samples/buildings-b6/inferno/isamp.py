"""isamp.py <dir> <look> name=x,y,w,h ... : mean colour of each area (render px) in Flash and in the 3D still."""
import sys
from pathlib import Path

import numpy as np

import ipost

ipost.D = Path(sys.argv[1]).resolve()
ipost.C = ipost.load(ipost.D)
lv = int(sys.argv[2])
m = ipost.on_ground(ipost.frame3d(lv, 0)).convert("RGB")
f = ipost.flash(lv, 0, m.size).convert("RGB")
for arg in sys.argv[3:]:
    name, b = arg.split("=")
    x, y, w, h = (int(v) for v in b.split(","))
    a = np.array(f.crop((x, y, x + w, y + h))).reshape(-1, 3).mean(0).astype(int)
    c = np.array(m.crop((x, y, x + w, y + h))).reshape(-1, 3).mean(0).astype(int)
    print(f"L{lv} {name:14s} flash {a}  3d {c}")
