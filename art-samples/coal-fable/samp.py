"""samp.py <tier> : mean colour (and spread) of Flash and of the 3D fit render in named boxes (Flash px)."""
import sys
import numpy as np
from PIL import Image
import fref
t = int(sys.argv[1])
BOX = {1: dict(drumtop=(-2, -2, 22, 6), drumside=(0, 8, 24, 15), drumlow=(0, 24, 22, 30), elbow=(-33, 0, -24, 12), pipelow=(-34, 20, -26, 42),
               turret=(6, -18, 17, -6), cpipe=(-12, -46, 8, -41), housing=(-28, -20, -18, -8), tray=(-18, -4, -4, 10), win=(-1, 17, 20, 22),
               shadeR=(24, 8, 30, 24)),
       3: dict(dome=(2, -8, 26, 2), band=(0, 5, 26, 10), drumlow=(0, 26, 22, 32), stackhead=(-35, -6, -20, 8), bricks=(-35, 16, -20, 40),
               stackR=(-17, 0, -12, 30), cpipe=(-10, -48, 8, -43), lantern=(3, -24, 14, -14), win=(2, 16, 20, 22), star=(-4, -40, 22, -32),
               chute=(-14, -6, -6, 20), box=(-12, -22, 0, -10))}
BOX[2] = BOX[3]
fit = Image.open('work/fit-L%d.png' % t).convert('RGBA')
k = fit.width // (fref.FRAME[2] - fref.FRAME[0])
fl = fref.flash(1 if t == 1 else 2, 0, shadow=False).resize(fit.size, Image.NEAREST)
A, B = np.array(fl).astype(float), np.array(fit).astype(float)
for n, (x0, y0, x1, y1) in BOX[t].items():
    s = (slice((y0 - fref.FRAME[1]) * k, (y1 - fref.FRAME[1]) * k), slice((x0 - fref.FRAME[0]) * k, (x1 - fref.FRAME[0]) * k))
    out = []
    for im in (A, B):
        p = im[s].reshape(-1, 4); p = p[p[:, 3] > 128][:, :3]
        lum = p @ [0.3, 0.59, 0.11]
        out.append('%3d %3d %3d  sd %2d' % (*p.mean(0), lum.std()))
    print('%-10s flash %s | 3D %s' % (n, *out))
