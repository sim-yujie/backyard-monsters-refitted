"""colcmp.py : mean colour (and 10/50/90% brightness) of named areas, Flash vs 3D (render at K px per Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref

AREAS = {"post L face": (74, 50, 79, 62), "post R face": (82, 48, 88, 62), "cornice": (73, 44, 80, 47),
         "post top": (78, 39, 84, 43), "collar": (76, 35, 86, 37), "spike": (79, 28, 82, 34), "stud": (76, 48, 79, 51),
         "rail front-left": (-100, 78, -80, 92), "rail back": (-60, 30, -50, 40), "picket front-left": (-82, 86, -79, 104),
         "bottom post L": (-7, 130, -1, 146), "bottom post R": (1, 130, 7, 146)}


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
