"""cols.py : mean colour of the same spots (Flash px boxes) on Flash cell 0 and on render/f-00.png."""
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
import numpy as np
from PIL import Image
import post
B = {"disc top left": (-35, 0, -25, 12), "disc top right": (22, 5, 34, 15), "disc side": (-10, 25, 10, 31),
     "door": (-22, 55, -17, 72), "doorplate": (-10, 60, 10, 74), "lip": (-15, 46, 15, 48),
     "left plate": (-39, 50, -33, 64), "right plate": (33, 50, 40, 64), "left window": (-54, 40, -44, 56),
     "right window": (44, 42, 54, 56), "left rim": (-50, 20, -46, 28), "right rim": (46, 20, 50, 28),
     "left claw": (-26, 30, -22, 44), "right claw": (20, 30, 25, 44), "star left": (-9, -14, -5, -2),
     "star right": (9, -15, 12, -8), "gear": (-8, -29, 2, -24), "cog": (-22, -8, -14, 4), "pit front": (-12, 36, 12, 44),
     "orb": (-2, -8, 8, 2)}
fl = np.array(post.on(post.flash(0)).convert("RGB")).astype(float)
m = Image.open(post.D / "render" / "f-00.png").convert("RGBA")
k = m.width // post.W
mm = np.array(post.on(m).convert("RGB")).astype(float)
for n, (x0, y0, x1, y1) in B.items():
    a = fl[y0 - post.FRAME[1]:y1 - post.FRAME[1], x0 - post.FRAME[0]:x1 - post.FRAME[0]].reshape(-1, 3)
    b = mm[(y0 - post.FRAME[1]) * k:(y1 - post.FRAME[1]) * k, (x0 - post.FRAME[0]) * k:(x1 - post.FRAME[0]) * k].reshape(-1, 3)
    f = lambda v: "(%3d,%3d,%3d)" % tuple(v.mean(0))
    print("%-15s Flash %s sd %2d   3D %s sd %2d" % (n, f(a), a.std(0).mean(), f(b), b.std(0).mean()))
