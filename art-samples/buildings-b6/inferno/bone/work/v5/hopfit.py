"""hopfit.py : fit a tipped box (slab on top, plank mouth on its low end) to Flash's level 3 hopper at rest: the
slab's corners and the mouth's corners read off Flash frame 0 (anchor px). Prints the box's frame in world units."""
import math
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation as Rot
O = (2.0, 38.0)
SX, SY, SZ = 7.0711, 3.5355, 8.6603
P = np.array([(6, -36), (33, -24), (22, -14), (0, -23)], float)          # slab: far-left, far-right, near-right, near-left
Q = np.array([(2, -16), (16, -17), (23, -5), (5, 1)], float)             # mouth: top-left, top-right, bottom-right, bottom-left


def scr(v):
    return np.stack([O[0] + SX * (v[..., 0] + v[..., 1]), O[1] + SY * (v[..., 0] - v[..., 1]) - SZ * v[..., 2]], -1)


def model(p):
    R = Rot.from_rotvec(p[:3]).as_matrix()
    u, v, n = R[:, 0], R[:, 1], R[:, 2]          # width, along the chute (toward the mouth), slab normal
    c = p[3:6]
    W, Ln, D, a, w0, w1 = p[6:12]
    slab = np.array([c, c + W * u, c + W * u + Ln * v, c + Ln * v])
    m0 = c + Ln * v - a * n
    mouth = np.array([m0 + w0 * u, m0 + w1 * u, m0 + w1 * u - D * n, m0 + w0 * u - D * n])
    return slab, mouth


def res(p):
    s, m = model(p)
    R = Rot.from_rotvec(p[:3]).as_matrix()
    cam = np.array([0.612, -0.612, 0.5])
    pen = [3 * max(0, 0.45 - R[:, 2] @ cam), 3 * max(0, 0.3 - R[:, 1] @ cam), 3 * max(0, 0.6 - R[2, 2]),
           0.6 * max(0, np.linalg.norm((s[1] - np.array([3.05, 2.1, 7.0]))[:2]) - 1.2),
           0.6 * max(0, np.hypot(*m[3][:2]) - 2.4), 0.6 * max(0, 4.3 - m[3][2])]
    return np.concatenate([(scr(s) - P).ravel(), (scr(m) - Q).ravel(), np.array(pen) * 10])


best = None
for seed in range(40):
    r = np.random.default_rng(seed)
    p0 = np.concatenate([r.normal(0, 1.2, 3), [0, 1.5, 7], [3, 2, 2, 0.4, 0.2, 2.8]])
    out = least_squares(res, p0, bounds=([-7] * 3 + [-5, -5, 0] + [0.5, 0.5, 0.5, 0, -1, 0.5],
                                         [7] * 3 + [5, 5, 12] + [6, 6, 5, 1.5, 3, 6]))
    s, m = model(out.x)
    R = Rot.from_rotvec(out.x[:3]).as_matrix()
    if R[2, 2] < 0.2:                         # the slab must face up
        continue
    if best is None or out.cost < best.cost:
        best = out
p = best.x
R = Rot.from_rotvec(p[:3]).as_matrix()
print("rms px", math.sqrt(2 * best.cost / 16))
print("u (width)", R[:, 0].round(3), "v (chute)", R[:, 1].round(3), "n (normal)", R[:, 2].round(3))
print("corner c", p[3:6].round(2), "W L D a w0 w1", p[6:12].round(2))
s, m = model(p)
print("slab px", scr(s).round(1).tolist())
print("mouth px", scr(m).round(1).tolist())
print("slab world", s.round(2).tolist())
print("mouth world", m.round(2).tolist())
