"""colcmp.py : mean colours of the same Flash-pixel boxes in Flash's picture and in the 3D frame 0 (look 1), so the
gold and the bands are matched to Flash's pixels by number.   python colcmp.py [look]"""
import sys

import numpy as np
from PIL import Image

import post

BOXES = {1: {"side highlight": (-11, -31, -5, -23), "side mid": (-11, -8, -6, 8), "face upper left": (1, -16, 9, -6),
             "face middle": (6, -2, 14, 8), "face lower right": (17, 6, 26, 16), "face band (left)": (-5, -6, -2, 12),
             "back band (top)": (-16, -36, -11, -31), "rock front": (-20, 38, 8, 50), "pillar cap": (-6, -55, 0, -51)},
         2: {"side highlight": (-10, -40, -3, -30), "side mid": (-12, -12, -6, 6), "face upper left": (2, -24, 10, -14),
             "face lower right": (20, 6, 29, 16), "face band (left)": (-6, -10, -3, 10), "rock front": (-24, 42, 8, 56)}}


def mean(im, box):
    a = np.asarray(im.convert("RGBA")).astype(float)
    x0, y0, x1, y1 = [v - post.FRAME[i % 2] for i, v in enumerate(box)]
    cut = a[y0:y1, x0:x1]
    w = cut[..., 3:] / 255
    return tuple(int(v) for v in (cut[..., :3] * w).sum((0, 1)) / max(1e-6, w.sum()))


look = int(sys.argv[1]) if len(sys.argv) > 1 else 1
flash = post.flash_canvas(look, 1)
r = post.frame(look, 0)
r = r.resize((post.FRAME[2] - post.FRAME[0], post.FRAME[3] - post.FRAME[1]), Image.BOX)
for name, box in BOXES[look].items():
    print(f"L{look} {name:18s} Flash {mean(flash, box)}  3D {mean(r, box)}")
