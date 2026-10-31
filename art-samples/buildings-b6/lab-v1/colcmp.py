"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref

AREAS = {"top left": (-30, 0, -14, 8), "top right": (14, 4, 30, 14), "top back": (-24, -6, -16, -2),
         "band": (-20, 28, -8, 38), "band right": (12, 26, 20, 36), "bowl": (-12, 48, 8, 56), "bowl left": (-26, 44, -18, 50),
         "foot L": (-38, 62, -33, 70), "dish face": (-8, -45, 8, -36), "dish right": (20, -30, 32, -22),
         "pedestal top": (-10, -3, 0, 2), "pedestal side": (-10, 6, 0, 9), "port front": (-4, 32, 4, 40)}


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
