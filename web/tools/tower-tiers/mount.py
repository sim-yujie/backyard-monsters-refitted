"""Where a painted turret heading's mount is: the round collar the turning part stands on.

The collar is round, so at every heading its front edge is the same half ellipse (twice as wide as deep, the game's
view). `collar` takes the lowest opaque pixel of every column near the bottom of the picture and finds the half ellipse
y = cy + a/2 * sqrt(1 - ((x - cx) / a)^2) that most of them lie on, with nothing standing above it inside its width
(the collar is always in front). Barrels and scopes that hang lower than the collar do not count against it.

`centres` measures every heading of one tier twice: first with the collar's half width `a` free, then with `a` fixed
at the middle value of the first pass, which steadies the headings where a barrel hides much of the collar.

Used by `export.py turrets`, which moves each heading so its collar lands where the others' do; the kit's own pivot
(the middle of the turret's outline) leans towards the barrel, so the Sniper's head slid up to 3.6 px to the side.
"""
import numpy as np

# Per tower at 2x px: the collar's half width range, and how far up the picture (a share of its height) points count.
COLLAR = {"sniper": dict(amin=14, amax=40, band=0.45),
          "laser": dict(amin=5, amax=16, band=0.25),
          "aerial": dict(amin=25, amax=50, band=0.5)}


def _bottom(alpha):
    m = alpha >= 128
    cols = np.where(m.any(0))[0]
    ys = np.array([np.where(m[:, x])[0].max() + 0.5 for x in cols], float)
    return cols.astype(float) + 0.5, ys


def collar(alpha, amin, amax, band, afix=None):
    """(cx, cy, a) of the collar in px of `alpha` (an HxW array, 0-255)."""
    xs, ys = _bottom(alpha)
    keep = ys >= ys.max() - band * (ys.max() - ys.min() + 1)
    xs, ys = xs[keep], ys[keep]
    best = None
    for a in [afix] if afix else np.arange(amin, amax + 0.01, 0.5):
        cxs = np.arange(xs.min(), xs.max() + 0.01, 0.25)
        u = (xs[None, :] - cxs[:, None]) / a
        inside = np.abs(u) < 1
        drop = a / 2 * np.sqrt(np.clip(1 - u * u, 0, 1))
        cys = ys[None, :] - drop                         # the centre each point would give, per cx
        res = ys[None, None, :] - (cys[:, :, None] + drop[:, None, :])
        ins = inside[:, None, :]
        score = ((np.abs(res) < 1.0) & ins).sum(2) - 2.0 * ((res < -1.5) & ins).sum(2)
        score = np.where(inside, score, -1e9)
        c, p = np.unravel_index(np.argmax(score), score.shape)
        if best is None or score[c, p] > best[0]:
            best = (score[c, p], cxs[c], cys[c, p], a)
    _, cx, cy, a = best
    # Least squares on the points that lie on it.
    u = np.clip((xs - cx) / a, -1, 1)
    on = (np.abs(xs - cx) < a) & (np.abs(ys - (cy + a / 2 * np.sqrt(1 - u * u))) < 1.0)
    if on.sum() >= 4:
        from scipy.optimize import least_squares
        x2, y2 = xs[on], ys[on]

        def res2(p):
            u2 = np.clip((x2 - p[0]) / a, -1, 1)
            return y2 - (p[1] + a / 2 * np.sqrt(1 - u2 * u2))
        cx, cy = least_squares(res2, (cx, cy), loss="soft_l1", f_scale=0.7).x
    return float(cx), float(cy), float(a)


def centres(tower, alphas):
    """The collar's (cx, cy) in every picture of one tier (2x alpha arrays), with its half width fixed in the second pass."""
    c = COLLAR[tower]
    afix = float(np.median([collar(al, **c)[2] for al in alphas]))
    return [collar(al, **c, afix=afix)[:2] for al in alphas]
