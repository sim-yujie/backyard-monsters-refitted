"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref

AREAS = {"dome left": (-18, 6, -10, 12), "dome right": (8, 10, 18, 16), "crown": (-22, 18, -14, 22),
         "label left": (-20, 40, -10, 48), "label low": (-6, 46, 2, 52), "rock L": (-34, 34, -28, 44),
         "rock R": (30, 30, 34, 42), "cog": (12, 32, 18, 38), "tag": (21, 38, 24, 46), "cap": (-2, -10, 4, -4)}


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
