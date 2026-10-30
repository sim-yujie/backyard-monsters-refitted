"""dishfit.py : the dish's outline as an ellipse (centre, semi-axes, angle), Flash vs 3D (work/fit-L1.png), from the
pixels above y=-13 (only the dish is there)."""
import numpy as np
from PIL import Image
import fref


def ell(a):
    x0, y0 = fref.FRAME[:2]
    ys, xs = np.nonzero(a)
    ys = ys + y0
    xs = xs + x0
    m = ys < -13
    xs, ys = xs[m].astype(float), ys[m].astype(float)
    c = np.array([xs.mean(), ys.mean()])
    cov = np.cov(np.stack([xs - c[0], ys - c[1]]))
    w, v = np.linalg.eigh(cov)
    ang = np.degrees(np.arctan2(v[1, 1], v[0, 1]))
    return c.round(1), (2 * np.sqrt(w[::-1])).round(1), round(float(ang), 1), (xs.min(), xs.max(), ys.min())


f = np.array(fref.flash_rgba().getchannel("A")) > 128
t = np.array(Image.open("work/fit-L1.png").getchannel("A").resize((f.shape[1], f.shape[0]), Image.BILINEAR)) > 128
print("Flash centre, semi-axes (major, minor), major angle, x/y extents", *ell(f))
print("3D    centre, semi-axes (major, minor), major angle, x/y extents", *ell(t))
