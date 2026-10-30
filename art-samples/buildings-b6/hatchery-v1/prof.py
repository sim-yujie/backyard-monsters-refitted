"""prof.py <level> [render] : left/right edges of Flash and 3D outlines per row, top/bottom per column (Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref
lv = int(sys.argv[1])
path = sys.argv[2] if len(sys.argv) > 2 else f"work/fit-L{lv}.png"
im = Image.open(path)
k = im.width // (fref.FRAME[2] - fref.FRAME[0])
t = np.array(im.getchannel("A").resize((im.width // k, im.height // k), Image.BILINEAR)) > 128
f = np.array(fref.flash_rgba(lv).getchannel("A")) > 128
x0, y0 = fref.FRAME[:2]
def ext(m):
    xs = np.nonzero(m)[0]
    return (xs.min(), xs.max()) if len(xs) else (None, None)
print("rows  y: flash L..R | 3d L..R")
for y in range(-128, 98, 6):
    a, b = ext(f[y - y0]), ext(t[y - y0])
    if a[0] is None and b[0] is None:
        continue
    fmt = lambda e: "   -    " if e[0] is None else f"{e[0] + x0:4d}..{e[1] + x0:<4d}"
    print(f"{y:5d}: {fmt(a)} | {fmt(b)}")
print("cols  x: flash T..B | 3d T..B")
for x in range(-56, 110, 6):
    a, b = ext(f[:, x - x0]), ext(t[:, x - x0])
    if a[0] is None and b[0] is None:
        continue
    fmt = lambda e: "   -    " if e[0] is None else f"{e[0] + y0:4d}..{e[1] + y0:<4d}"
    print(f"{x:5d}: {fmt(a)} | {fmt(b)}")
