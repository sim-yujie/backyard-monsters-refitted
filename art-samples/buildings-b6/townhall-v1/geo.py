"""geo.py : Flash pixel <-> world helpers for measuring (no Blender). Same camera as th.py.

    python geo.py dome r zeq sx sy ...     bearing and elevation of the dome point seen at each Flash pixel
    python geo.py cyl r sx sy ...          bearing and height of the point on an upright cylinder (front side)
    python geo.py ground z sx sy ...       world X, Y (and bearing, distance) of the point at height z
    python geo.py scr x y z                Flash pixel of a world point
"""
import math
import sys

import stack as S

EL = 30.0
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
O = S.ORIGIN


def scr(x, y, z):
    return (O[0] + SX * (x + y), O[1] + SY * (x - y) - SZ * z)


def at_z(sx, sy, z):
    a = (sx - O[0]) / SX
    d = (sy - O[1] + SZ * z) / SY
    return (a + d) / 2, (a - d) / 2


def fwd():
    el, az = math.radians(EL), math.radians(-45)
    return (-math.cos(el) * math.cos(az), -math.cos(el) * math.sin(az), -math.sin(el))


def ray(sx, sy):
    x, y = at_z(sx, sy, 0.0)
    f = fwd()
    return (x - f[0] * 50, y - f[1] * 50, -f[2] * 50), f


def hit_sphere(sx, sy, r, zc):
    (ox, oy, oz), f = ray(sx, sy)
    oc = (ox, oy, oz - zc)
    b = sum(a * c for a, c in zip(oc, f))
    c = sum(a * a for a in oc) - r * r
    disc = b * b - c
    if disc < 0:
        return None
    t = -b - math.sqrt(disc)
    return ox + f[0] * t, oy + f[1] * t, oz + f[2] * t


def hit_cyl(sx, sy, r):
    (ox, oy, oz), f = ray(sx, sy)
    a = f[0] ** 2 + f[1] ** 2
    b = 2 * (ox * f[0] + oy * f[1])
    c = ox * ox + oy * oy - r * r
    disc = b * b - 4 * a * c
    if disc < 0:
        return None
    t = (-b - math.sqrt(disc)) / (2 * a)
    return ox + f[0] * t, oy + f[1] * t, oz + f[2] * t


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "dome":
        r, zeq = float(a[1]), float(a[2])
        for sx, sy in zip(a[3::2], a[4::2]):
            p = hit_sphere(float(sx), float(sy), r, zeq)
            if p is None:
                print(sx, sy, "miss")
                continue
            th = math.degrees(math.atan2(p[1], p[0]))
            el = math.degrees(math.asin(max(-1, min(1, (p[2] - zeq) / r))))
            print(f"{sx},{sy}: bearing {th:.1f} elevation {el:.1f}")
    elif a[0] == "cyl":
        r = float(a[1])
        for sx, sy in zip(a[2::2], a[3::2]):
            p = hit_cyl(float(sx), float(sy), r)
            print(f"{sx},{sy}: " + ("miss" if p is None else f"bearing {math.degrees(math.atan2(p[1], p[0])):.1f} z {p[2]:.2f}"))
    elif a[0] == "ground":
        z = float(a[1])
        for sx, sy in zip(a[2::2], a[3::2]):
            x, y = at_z(float(sx), float(sy), z)
            print(f"{sx},{sy}: X {x:.2f} Y {y:.2f} bearing {math.degrees(math.atan2(y, x)):.1f} dist {math.hypot(x, y):.2f}")
    elif a[0] == "scr":
        print("%.1f %.1f" % scr(*map(float, a[1:4])))
