"""colprof.py <level> <colour> [step] [render] : rows of one colour's pixels, Flash vs 3D (Flash px).
colour: red | chrome | gold | pink"""
import sys
import numpy as np
from PIL import Image
import fref
lv, col = int(sys.argv[1]), sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 4
path = sys.argv[4] if len(sys.argv) > 4 else f"work/fit-L{lv}.png"
im = Image.open(path).convert("RGBA")
k = im.width // (fref.FRAME[2] - fref.FRAME[0])
t = np.array(im.resize((im.width // k, im.height // k), Image.BOX)).astype(int)
f = np.array(fref.flash_rgba(lv)).astype(int)


def sel(a):
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3] > 128
    if col == "red":
        return al & (r > 90) & (r > 2.2 * g) & (r > 2.2 * b)
    if col == "chrome":
        return al & (abs(r - g) < 18) & (abs(g - b) < 22) & (r > 120)
    if col == "gold":
        return al & (r > 120) & (g > 70) & (b < 0.6 * g) & (r > 1.3 * g)
    if col == "pink":
        return al & (r > 170) & (b > 150) & (g < r - 20)


F, T = sel(f), sel(t)
x0, y0 = fref.FRAME[:2]


def ext(m):
    xs = np.nonzero(m)[0]
    return f"{xs.min() + x0:4d}..{xs.max() + x0:<4d}({len(xs):3d})" if len(xs) > 1 else "      -        "


for y in range(-128, 98, step):
    a, b = F[y - y0], T[y - y0]
    if a.any() or b.any():
        print(f"{y:5d}: {ext(a)} | {ext(b)}")
