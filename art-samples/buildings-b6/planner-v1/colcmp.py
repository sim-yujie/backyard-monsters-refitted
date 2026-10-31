"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref

AREAS = {"stone L": (-44, 24, -40, 30), "stone mid": (-20, 36, -12, 44), "stone low": (-18, 50, -12, 54),
         "stone R": (2, 32, 8, 40), "foot F": (-4, 58, 4, 64), "foot L": (-46, 38, -42, 44),
         "deck L": (-48, 6, -42, 10), "deck F": (-16, 22, -8, 27), "deck R": (28, 6, 36, 10),
         "house L": (-16, 4, -10, 10), "house R": (16, -4, 20, 4), "roof": (-20, -16, -12, -12),
         "tower L": (-3, -46, 1, -40), "troof": (8, -60, 14, -54), "scope": (-12, -40, -6, -36),
         "stair side": (40, 38, 48, 48), "stair step": (14, 56, 20, 60), "ball": (-7, 15, -5, 17)}


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
