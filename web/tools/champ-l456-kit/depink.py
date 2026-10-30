"""depink.py <sheet> : make opaque near-#FF00FF pixels (keying leftovers) in the 4x sheet transparent. Not for Fomor (own pink highlights)."""
import sys
import numpy as np
from PIL import Image
from spec import ASSETS
n = sys.argv[1]; p = ASSETS / f"{n}-repaint@4x.png"
a = np.asarray(Image.open(p).convert("RGBA")).copy(); f = a.astype(float)
d = np.sqrt((255 - f[..., 0]) ** 2 + f[..., 1] ** 2 + (255 - f[..., 2]) ** 2)
m = (a[..., 3] > 0) & (d < 110)
a[m, 3] = 0
Image.fromarray(a).save(p); print(n, "cleared", int(m.sum()), "pixels")
