"""pink.py <sheet>: per cell, count opaque 4x pixels close to #FF00FF (keying leftovers)."""
import sys
import numpy as np
from PIL import Image
from spec import SPECS, ASSETS
n = sys.argv[1]; s = SPECS[n]; w, h = s["w"] * 4, s["h"] * 4
a = np.asarray(Image.open(ASSETS / f"{n}-repaint@4x.png").convert("RGBA")).astype(float)
d = np.sqrt((255 - a[..., 0]) ** 2 + a[..., 1] ** 2 + (255 - a[..., 2]) ** 2)
m = (a[..., 3] > 128) & (d < 110)
bad = []
for c in range(16):
    for r in range(s["rows"]):
        k = int(m[r * h:(r + 1) * h, c * w:(c + 1) * w].sum())
        if k > 30: bad.append(f"c{c}r{r}:{k}")
print(n, "pink cells:", " ".join(bad) or "none")
