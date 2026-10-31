"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref

LV = int(sys.argv[2]) if len(sys.argv) > 2 else 1
AREAS = {"dome left": (-34, 8, -26, 14), "dome hi": (-14, 8, -6, 18), "dome front": (-4, 26, 4, 36),
         "dome right": (24, 26, 34, 36), "dome low": (-8, 38, 4, 44), "dome top R": (14, 0, 24, 8),
         "band": (-8, 48, 8, 51), "foot": (-8, 55, 8, 59), "plate": (-38, 20, -34, 26), "gold bar": (-20, 28, -18, 38)}
if LV >= 3:
    d = -19 if LV >= 4 else 0
    AREAS = {"dome hi": (-16, 2 + d, -8, 10 + d), "dome front": (-6, 30 + d, 6, 40 + d), "dome R": (8, 8 + d, 16, 16 + d),
             "glass": (-6, 48 if LV == 3 else 34, 6, 52 if LV == 3 else 44), "band": (-6, 57, 6, 60),
             "pier light": (-44, 40, -38, 56), "pier dark": (-30, 40, -25, 56), "pier R": (30, 40, 40, 56),
             "back pier": (-50, 0 + d, -46, 20 + d), "plinth": (-44, 68, -36, 72)}


def load(path):
    im = Image.open(path).convert("RGBA")
    f = fref.flash_rgba(LV)
    return np.array(im.resize(f.size, Image.BOX)).astype(float)


def stats(a, box):
    x0, y0 = fref.FRAME[:2]
    r = a[box[1] - y0:box[3] - y0, box[0] - x0:box[2] - x0]
    r = r[r[..., 3] > 250][:, :3]
    if not len(r):
        return "-"
    return "%s %s" % (r.mean(0).round().astype(int), np.percentile(r.mean(1), [10, 50, 90]).round().astype(int))


f = np.array(fref.flash_rgba(LV)).astype(float)
t = load(sys.argv[1] if len(sys.argv) > 1 else "work/fit-L1.png")
for k, b in AREAS.items():
    print("%-14s F %-30s 3D %s" % (k, stats(f, b), stats(t, b)))
