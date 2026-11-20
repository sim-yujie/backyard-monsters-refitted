"""angle.py <png/webp files...> : the camera of a building picture, read from its base.

For each picture (2 px a world px when the name has @2x): the front corner (the lowest opaque point), and the slopes
of the base's left and right bottom edges (a line fitted to the lowest opaque pixel of each column over the middle 70%
of each side). The game's isometric camera draws ground lines at a slope of 0.5 (2:1, `YardGrid.toIso`), and a
building turned like the others has its front corner in the middle (left and right walls equally wide).
Prints: left wall share of the width, left/right base slopes.
"""
import sys

import numpy as np
from PIL import Image

for f in sys.argv[1:]:
    a = np.asarray(Image.open(f).convert("RGBA"))[..., 3] > 128
    cols = np.where(a.any(0))[0]
    low = np.array([np.where(a[:, c])[0].max() for c in cols])
    fx = cols[np.argmax(low)]
    l, r = cols.min(), cols.max()

    def slope(lo, hi):
        sel = (cols >= lo) & (cols <= hi)
        if sel.sum() < 3:
            return float("nan")
        return np.polyfit(cols[sel], low[sel], 1)[0]

    ls = slope(l + 0.15 * (fx - l), fx - 0.15 * (fx - l))
    rs = slope(fx + 0.15 * (r - fx), r - 0.15 * (r - fx))
    print(f"{f.split('/')[-1]:32s} left wall {100 * (fx - l) / (r - l):4.0f}% of width   base slopes {ls:+.2f} / {rs:+.2f}")
