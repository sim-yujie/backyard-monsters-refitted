"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref

AREAS = {"die hi": (5, 0, 10, 6), "die mid": (18, 4, 26, 12), "die low": (18, 20, 24, 26), "die right": (33, 0, 37, 10),
         "pip": (28, -2, 32, 1), "pip2": (11, 14, 15, 18), "cover top": (-34, -6, -24, 0), "cover mid": (-30, 4, -24, 10),
         "cover low": (-26, 26, -20, 30), "flame": (-22, 6, -16, 9), "striker": (-1, 5, 2, 30),
         "stick back": (-20, -20, -5, -14), "stick front": (-4, -6, 6, -3), "stick ends": (-37, -14, -30, -11),
         "strap white": (8, -23, 14, -20), "strap yellow": (28, -17, 34, -14), "paper": (18, -26, 30, -22),
         "tack L": (-37, 34, -28, 38)}


def load(path):
    im = Image.open(path).convert("RGBA")
    f = fref.flash_rgba()
    return np.array(im.resize(f.size, Image.BOX)).astype(float)


def stats(a, box):
    x0, y0 = fref.FRAME[:2]
    r = a[box[1] - y0:box[3] - y0, box[0] - x0:box[2] - x0]
    r = r[r[..., 3] > 250][:, :3]
    if not len(r):
        return "-"
    return "%s %s" % (r.mean(0).round().astype(int), np.percentile(r.mean(1), [10, 50, 90]).round().astype(int))


f = np.array(fref.flash_rgba()).astype(float)
t = load(sys.argv[1] if len(sys.argv) > 1 else "work/fit-L1.png")
for k, b in AREAS.items():
    print("%-14s F %-30s 3D %s" % (k, stats(f, b), stats(t, b)))
