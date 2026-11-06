"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px).

    python colcmp.py [render.png] [frame]
"""
import sys
import numpy as np
from PIL import Image
import fref

AREAS = {"rim left": (-24, 3, -18, 7), "rim right": (16, 3, 24, 7), "riser L": (-30, 29, -24, 33),
         "tread L": (-22, 30, -18, 32), "riser R": (24, 28, 30, 33), "tread R": (19, 31, 22, 33),
         "inner L": (-8, 40, -4, 50), "inner R": (4, 40, 8, 50), "tower L": (-14, 14, -8, 18),
         "copper": (-14, -6, -8, -2), "flange": (4, 0, 8, 4), "gold": (12, 4, 16, 8)}


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


if __name__ == "__main__":
    fr = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    f = np.array(fref.flash_rgba(1, fr)).astype(float)
    t = load(sys.argv[1] if len(sys.argv) > 1 else "work/fit-L1.png")
    for k, b in AREAS.items():
        print("%-10s F %-30s 3D %s" % (k, stats(f, b), stats(t, b)))
