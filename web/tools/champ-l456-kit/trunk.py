"""trunk.py <sheet> [row] : per column, trunk-centre x (thick body part) of old vs new for one row (1x px), and the difference."""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from spec import SPECS, ASSETS
n = sys.argv[1]; r = int(sys.argv[2]) if len(sys.argv) > 2 else 0; s = SPECS[n]; w, h = s["w"], s["h"]
old = np.asarray(Image.open(ASSETS / f"{n}.png").convert("RGBA"))[..., 3]
new = np.asarray(Image.open(ASSETS / f"{n}-repaint.png").convert("RGBA"))[..., 3]
def tx(a, c, t):
    m = a[r * h:(r + 1) * h, c * w:(c + 1) * w] >= t
    ys, xs = np.where(m); core = ndi.binary_erosion(m, iterations=max(1, round(0.12 * (ys.max() - ys.min()))))
    return np.where(core if core.sum() > 20 else m)[1].mean()
d = [tx(new, c, 128) - tx(old, c, 200) for c in range(16)]
print(n, "row", r, "new-old trunk x:", " ".join(f"{c}:{v:+.1f}" for c, v in enumerate(d)))
