"""spin_dir.py : which way the L10 cage turns on screen, Flash and 3D, measured the same way on both. Putty pixels
that change during the loop (the cage's, not the still drips), in a ring round the cage's middle; their screen-angle
histogram at frame k against frame 0: the best shift in degrees, + = anticlockwise on screen."""
import sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import fref, post


def putty(im):
    a = np.array(im.convert("RGBA")).astype(int)
    return (a[..., 2] > a[..., 1] + 25) & (a[..., 0] > a[..., 1] + 10) & (a[..., 3] > 100)


def hist(m, moving, c, k, ax=13, ay=15):
    ys, xs = np.nonzero(m & moving)
    dx, dy = (xs / k + fref.FRAME[0] - c[0]) / ax, (ys / k + fref.FRAME[1] - c[1]) / ay
    r = np.hypot(dx, dy)
    th = np.degrees(np.arctan2(-dy, dx))[(r > 0.4) & (r < 1.2)]
    return np.histogram(th, bins=360, range=(-180, 180))[0].astype(float)


def shift(h0, h1):
    return max(range(-40, 41), key=lambda s: float((np.roll(h0, s) * h1).sum()))


def turn(m0, m1, c, k):
    """The rotation (deg, + anticlockwise on screen) of m0 round c (Flash px) that best covers m1."""
    from PIL import Image
    a = Image.fromarray((m0 * 255).astype(np.uint8))
    cc = ((c[0] - fref.FRAME[0]) * k, (c[1] - fref.FRAME[1]) * k)
    sc = [(float(((np.array(a.rotate(t, center=cc)) > 127) & m1).sum()), t) for t in np.arange(-30, 30.5, 1.0)]
    return max(sc)[1]


if __name__ == "__main__":
    for name, get, c, k, n in (("Flash", lambda f: fref.flash_rgba(10, f), (15, -23), 1, fref.frames(10)),
                               ("3D", lambda f: post.frame3d(10, f), (17.1, -25.4), 12, 25)):
        ms = [putty(get(f)) for f in range(n)]
        moving = np.zeros_like(ms[0])
        for m in ms[1:]:
            moving |= m != ms[0]
        h0 = hist(ms[0], moving, c, k)
        print(name, "angle histogram, deg turned by frame 1, 2, 3, 4, 6:",
              [shift(h0, hist(ms[f], moving, c, k)) for f in (1, 2, 3, 4, 6)])
        print(name, "mask rotation, deg turned by frame 1, 2, 3, 4, 6:",
              [turn(ms[0] & moving, ms[f] & moving, c, k) for f in (1, 2, 3, 4, 6)])
