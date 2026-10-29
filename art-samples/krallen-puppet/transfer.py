"""transfer.py : carry a finished rig over to another look's painting of the same heading and pose.

The two paintings' silhouettes are lined up by an affine fit (OpenCV ECC on the blurred alpha), and every cut
outline and bone of the rig is moved through that fit. Points the fit gets wrong can then be nudged by hand
(`nudge`: part name -> (dx, dy)). `python transfer.py` prints the fit and writes the cut overlay for a look.
"""
import copy

import cv2
import numpy as np

import puppet as P


def silhouette(look, col, row):
    c, _ = P.split_shadow(P.painted_cell(look, col, row))
    a = (c[..., 3] > 128).astype(np.float32)
    return cv2.GaussianBlur(a, (0, 0), 4)


def fit(src, dst):
    """2x3 affine taking points of the `src` painting to the same points of the `dst` painting."""
    a, b = silhouette(*src), silhouette(*dst)
    # start from the bounding boxes, then refine
    ys, xs = np.where(a > 0.5)
    yd, xd = np.where(b > 0.5)
    sx = (xd.max() - xd.min()) / (xs.max() - xs.min())
    sy = (yd.max() - yd.min()) / (ys.max() - ys.min())
    warp = np.array([[sx, 0, xd.min() - sx * xs.min()], [0, sy, yd.min() - sy * ys.min()]], np.float32)
    # ECC finds the warp that maps template (dst) coordinates into input (src) ones; invert at the end
    inv = cv2.invertAffineTransform(warp).astype(np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    _, inv = cv2.findTransformECC(b, a, inv, cv2.MOTION_AFFINE, crit, None, 5)
    return cv2.invertAffineTransform(inv)


def apply(M, pts):
    p = np.asarray(pts, np.float32)
    q = p @ M[:, :2].T + M[:, 2]
    return [tuple(round(float(v), 1) for v in r) for r in q]


def transfer(rig, look, row=None, nudge=None):
    """The rig moved onto `look`'s painting of the same column (and row, unless given)."""
    l0, col, r0 = rig["src"]
    dst = (look, col, r0 if row is None else row)
    M = fit(rig["src"], dst)
    out = copy.deepcopy(rig)
    out["src"] = dst
    out["ground"] = float(apply(M, [(0, rig["ground"])])[0][1])
    for p in out["parts"]:
        d = (nudge or {}).get(p["name"], (0, 0))
        for k in ("poly", "fill", "hole", "bones"):
            if k in p:
                p[k] = [(x + d[0], y + d[1]) for x, y in apply(M, p[k])]
    return out, M
