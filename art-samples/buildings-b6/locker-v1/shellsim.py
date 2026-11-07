"""shellsim.py : a quick look (no Blender) at the level 3-4 egg and its rounded two-plane opening as the game camera sees
it, drawn over Flash: blue = the shell's outside, dark red = the inside wall seen through the opening, yellow = Flash's
outline. For tuning stack.py's L3_EGG_* and L3_CUT* fast.

    python shellsim.py <level> out.png '<json overrides>' ['<json overrides>' ...]
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw

import fref
import stack as S

EL = 30.0
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
O = S.ORIGIN
FWD = -np.array([math.cos(math.radians(EL)) * math.cos(math.radians(-45)),
                 math.cos(math.radians(EL)) * math.sin(math.radians(-45)), math.sin(math.radians(EL))])


def px(sx, sy, z):
    a = (sx - O[0]) / SX
    d = (sy - O[1] + SZ * z) / SY
    return np.array(((a + d) / 2, (a - d) / 2, z))


def polar(th, r, z):
    a = math.radians(th)
    return np.array((r * math.cos(a), r * math.sin(a), z))


def tilted(b, deg):
    v = polar(b, math.sin(math.radians(deg)), 0.0)
    v[2] = math.cos(math.radians(deg))
    return v / np.linalg.norm(v)


def softmin(a, b, k):
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def sim(lv, P, k=3, box=(-60, -90, 60, 40)):
    g = lambda n: P.get(n, getattr(S, n))   # noqa: E731
    pre = "L4_" if lv == 4 else "L3_"
    C = g(pre + "EGG_C")
    A = px(*S.GC[lv], 0.0)
    p0 = px(*C, 3.0)
    t = ((A[0] - A[1]) - (p0[0] - p0[1])) / (FWD[0] - FWD[1])
    c = p0 + FWD * t
    rc, rt, rb = g(pre + "EGG_R")
    u = tilted(*g("L3_EGG_AXIS"))
    cut, cut2 = g(pre + "CUT"), g(pre + "CUT2")
    n, d = tilted(*cut[:2]), cut[2]
    n2, d2 = tilted(*cut2[:2]), cut2[2]
    fr = g(pre + "CUT_R")
    x = n - u * n.dot(u)
    x /= np.linalg.norm(x)
    y = np.cross(u, x)
    R = np.stack([x, y, u])                 # world -> egg local rows
    x0, y0, x1, y1 = box
    W, H = (x1 - x0) * k, (y1 - y0) * k
    sx = x0 + (np.arange(W) + 0.5) / k
    sy = y0 + (np.arange(H) + 0.5) / k
    SXg, SYg = np.meshgrid(sx, sy)
    a = (SXg - O[0]) / SX
    dd = (SYg - O[1] + SZ * 20.0) / SY
    P0 = np.stack([(a + dd) / 2, (a - dd) / 2, np.full_like(a, 20.0)], -1) - c   # rays start high above
    Pl = P0 @ R.T
    Dl = FWD @ R.T
    out = np.zeros((H, W), np.uint8)
    # two half ellipsoids (top rt, bottom rb): solve each, keep hits on its own half
    hits = []
    for rz, top in ((rt, True), (rb, False)):
        s = np.array([1 / rc, 1 / rc, 1 / rz])
        p, dv = Pl * s, Dl * s
        A2 = dv.dot(dv)
        B2 = 2 * (p * dv).sum(-1)
        C2 = (p * p).sum(-1) - 1
        disc = B2 * B2 - 4 * A2 * C2
        ok = disc > 0
        sq = np.sqrt(np.where(ok, disc, 0))
        for tt in ((-B2 - sq) / (2 * A2), (-B2 + sq) / (2 * A2)):
            q = Pl + tt[..., None] * Dl
            good = ok & ((q[..., 2] >= 0) if top else (q[..., 2] < 0))
            hits.append(np.where(good, tt, np.inf))
    T = np.stack(hits, -1)
    T.sort(-1)
    for i, colour in ((0, 1), (1, 2)):
        tt = T[..., i]
        q = P0 + np.where(np.isfinite(tt), tt, 0)[..., None] * FWD
        f = softmin(q @ n - d, q @ n2 - d2, fr)
        keep = np.isfinite(tt) & (f <= 0) & (out == 0)
        out[keep] = colour
    img = Image.new("RGB", (W, H), (96, 140, 60))
    fl = fref.flash_rgba(lv, 0)
    fc = fl.crop((x0 + 72, y0 + 100, x1 + 72, y1 + 100)).resize((W, H), Image.NEAREST)
    img.paste(fc, (0, 0), fc)
    arr = np.array(img).astype(float)
    arr[out == 1] = arr[out == 1] * 0.35 + np.array((80, 140, 255)) * 0.65
    arr[out == 2] = arr[out == 2] * 0.35 + np.array((160, 30, 30)) * 0.65
    img = Image.fromarray(arr.astype(np.uint8))
    dr = ImageDraw.Draw(img)
    for fx in range(x0 - x0 % 10, x1 + 1, 10):
        X = (fx - x0) * k
        dr.line((X, 0, X, H), fill=(255, 0, 0) if fx == 0 else (200, 200, 0))
        dr.text((X + 2, 2), str(fx), fill=(255, 255, 255))
    for fy in range(y0 - y0 % 10, y1 + 1, 10):
        Y = (fy - y0) * k
        dr.line((0, Y, W, Y), fill=(255, 0, 0) if fy == 0 else (200, 200, 0))
        dr.text((2, Y + 2), str(fy), fill=(255, 255, 255))
    return img


def main():
    lv = int(sys.argv[1])
    ims = [sim(lv, json.loads(a)) for a in sys.argv[3:]]
    for i, a in enumerate(sys.argv[3:]):
        ImageDraw.Draw(ims[i]).text((4, ims[i].height - 14), str(i), fill=(255, 255, 255))
    out = Image.new("RGB", (sum(i.width + 4 for i in ims), ims[0].height))
    x = 0
    for i in ims:
        out.paste(i, (x, 0))
        x += i.width + 4
    out.save(sys.argv[2])
    print(sys.argv[2], out.size)


if __name__ == "__main__":
    main()
