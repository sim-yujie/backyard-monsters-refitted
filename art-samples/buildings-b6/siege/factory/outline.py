"""outline.py : how far the 3D outline is from Flash's, in Flash px.

./py outline.py <flash-1x-canvas.png> <3d-render.png> [-o overlay.png] [--box x0,y0,x1,y1] [--thr 110]

Both pictures cover the same canvas; the 3D one may be any whole multiple of Flash's size. Alpha over --thr (of 255,
after shrinking the 3D picture to 1x) counts as solid. --box (canvas px) limits the comparison (e.g. to leave out
Flash's soft grass fringe at the foot). Prints the solid boxes, the share of pixels that differ, and the distance
from each outline pixel to the other outline (mean, 95th percentile, worst), both ways. The overlay (6x): grey =
both, red = Flash only, blue = 3D only.
"""
import sys

import numpy as np
from PIL import Image


def edge(m):
    p = np.pad(m, 1)
    inner = p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    return m & ~inner


def dists(a, b):
    pa, pb = np.argwhere(a).astype(float), np.argwhere(b).astype(float)
    d = np.sqrt(((pa[:, None, :] - pb[None, :, :]) ** 2).sum(-1)).min(1)
    return d, pa


def main():
    a = sys.argv[1:]
    out = a[a.index("-o") + 1] if "-o" in a else None
    thr = int(a[a.index("--thr") + 1]) if "--thr" in a else 110
    f = Image.open(a[0]).convert("RGBA")
    r = Image.open(a[1]).convert("RGBA").resize(f.size, Image.BOX)
    fa, ra = np.array(f)[..., 3] > thr, np.array(r)[..., 3] > thr
    if "--box" in a:
        x0, y0, x1, y1 = map(int, a[a.index("--box") + 1].split(","))
        keep = np.zeros_like(fa)
        keep[y0:y1, x0:x1] = True
        fa, ra = fa & keep, ra & keep

    def box(m):
        ys, xs = np.where(m)
        return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    bf, br = box(fa), box(ra)
    print("flash box", bf, "size", bf[2] - bf[0], bf[3] - bf[1])
    print("3d    box", br, "size", br[2] - br[0], br[3] - br[1])
    print("box delta (3d - flash) left %d top %d right %d bottom %d" % tuple(int(q - p) for p, q in zip(bf, br)))
    print("pixels: flash %d, 3d %d, flash only %d, 3d only %d, IoU %.3f" % (
        fa.sum(), ra.sum(), (fa & ~ra).sum(), (ra & ~fa).sum(), (fa & ra).sum() / (fa | ra).sum()))
    ef, er = edge(fa), edge(ra)
    for name, d in (("flash outline -> 3d outline", dists(ef, er)), ("3d outline -> flash outline", dists(er, ef))):
        d, pa = d
        print("%s: mean %.2f, 95%% %.2f, worst %.2f px; over 2 px: %.0f%%" % (
            name, d.mean(), np.percentile(d, 95), d.max(), 100 * (d > 2).mean()))
        far = np.argsort(d)[::-1][:60:6]
        print("   farthest at canvas (x,y):", " ".join("%d,%d(%.0f)" % (pa[i][1], pa[i][0], d[i]) for i in far))
    if out:
        im = np.zeros(fa.shape + (3,), np.uint8) + 255
        im[fa & ra] = (150, 150, 150)
        im[fa & ~ra] = (230, 40, 40)
        im[ra & ~fa] = (40, 80, 230)
        Image.fromarray(im).resize((f.width * 6, f.height * 6), Image.NEAREST).save(out)


main()
