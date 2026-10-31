"""hopgeo.py : the level 3 hopper at rest, read off Flash frame 0 (anchor px, see the character map in the v5 notes) and
lifted to 3D with the game camera. Flash draws a rust cover (slab) tipped steeply toward the bowl and, parallel to it
and lower, the plank tray that runs out of the hopper's mouth on its left: a parallel face can only sit lower along the
cover's normal, so one offset d fits it. Prints the cover's corners, the frame (u along the cover, v down its slope,
n its normal) and the tray's corners in that frame."""
import numpy as np
O = (2.0, 38.0)
SX, SY, SZ = 7.0711, 3.5355, 8.6603
VD = np.array([1.0, -1.0, 2 * SY / SZ])                  # the view line: moves nothing on screen


def lift(e, z=0.0):
    a, b = e[0] / SX, (e[1] + SZ * z) / SY
    return np.array([(a + b) / 2, (a - b) / 2, z])


def point(p, z):
    return lift((p[0] - O[0], p[1] - O[1]), z)


def scr(v):
    return np.array((O[0] + SX * (v[0] + v[1]), O[1] + SY * (v[0] - v[1]) - SZ * v[2]))


P1, P2, P3, P4 = (8, -36), (30, -24), (22, -14), (1, -24)          # cover: far-left, far-right, near-right, near-left
T1, T2, B2, B1 = (6, -12.5), (19.5, -9), (9, 3.5), (-1.5, -1.5)    # tray: top-left, top-right, foot-right, foot-left
E1 = lift(np.subtract(P2, P1))
e2 = (lift(np.subtract(P4, P1)) + lift(np.subtract(P3, P2))) / 2
E2 = e2 - (E1 @ e2) / (E1 @ VD) * VD
C2 = point(P2, 7.25)
C1 = C2 - E1
u, v = E1 / np.linalg.norm(E1), E2 / np.linalg.norm(E2)
n = np.cross(u, v)
n = n if n[2] > 0 else -n
v = np.cross(n, u)                                    # square it up


def on_plane(p, d):
    """The world point on Flash pixel p that lies d below the cover's top plane."""
    q = point(p, 0.0)
    k = ((C1 - d * n - q) @ n) / (VD @ n)
    return q + k * VD


def frame(w):
    r = w - C1
    return np.array((r @ u, r @ v, r @ n))


np.set_printoptions(precision=3, suppress=True)
print("C1", C1, "u", u, "v", v, "n", n, "W", np.linalg.norm(E1), "Lv", E2 @ v)
for d in (1.2, 1.5, 1.75, 2.0):
    t = [frame(on_plane(p, d)) for p in (T1, T2, B2, B1)]
    w = [on_plane(p, d) for p in (T1, T2, B2, B1)]
    print("d", d, "tray (u, v):", [tuple(x[:2].round(2)) for x in t], "world z of the feet", w[2][2].round(2), w[3][2].round(2),
          "r", np.hypot(*w[3][:2]).round(2), np.hypot(*w[2][:2]).round(2))
