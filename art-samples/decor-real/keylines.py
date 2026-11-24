"""(decor-real copy: the new block-outs' edges; the windpump is mapped by windpump.py, not by its slab.)
Key structure edges of each wonder, taken from its 3D block-out (blockout.py), projected to pixels and measured
with snap.py on any picture of it: the block-out render itself (exact), the Codex paint, or the game's @2x file.

    python keylines.py <wonder> <picture> [<picture> ...] [--sheet out.png]

The 3D edge is projected with the render's camera (bo/<wonder>.json, the slab corners in the 1024 render), then
moved into the target picture by matching the slab: the target's lowest alpha point = slab front corner, its
left-most alpha column = slab left corner (measure.py), so it works on cut and re-sized files too.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "decor-angle")); sys.path.insert(0, os.path.join(HERE, "..", "decor-seat"))
from snap import run as snap_run          # noqa: E402
from measure import measure                # noqa: E402

R2 = math.sqrt(0.5)
RIGHT = (R2, R2, 0.0)
UP = (-0.5 * R2, 0.5 * R2, math.sqrt(3) / 2)
SLAB_T = 0.45


def dot(a, b): return sum(x * y for x, y in zip(a, b))


# 3D key edges (x, y, z) -> (x, y, z), name. Only edges that run along the grid (should read 0.50) or that
# test a round part's ellipse; inset a little from the ends so ornaments at the corners do not pull the fit.
def inset(a, b, f=0.12):
    return tuple(a[i] + (b[i] - a[i]) * f for i in range(3)), tuple(b[i] + (a[i] - b[i]) * f for i in range(3))


KEY = {
 "paoay-church": [
    ((-5, -5, 0), (5, -5, 0), "slab top (left face)"),
    ((5, -5, 0), (5, 5, 0), "slab top (right face)"),
    ((-1.05, -3.45, 0.0), (3.45, -3.45, 0.0), "facade foot (left face)"),
    ((-1.13, -3.65, 3.6), (3.53, -3.65, 3.6), "facade cornice (left face)"),
    ((1.2, -2.55, 4.65), (1.2, 4.95, 4.65), "roof ridge"),
    ((-4.85, -4.85, 3.6), (-2.85, -4.85, 3.6), "tower ledge 1 (left face)"),
    ((-2.85, -4.85, 3.6), (-2.85, -2.85, 3.6), "tower ledge 1 (right face)"),
 ],
 "fort-santiago": [
    ((-5, -5, 0), (5, -5, 0), "slab top (left face)"),
    ((5, -5, 0), (5, 5, 0), "slab top (right face)"),
    ((-3.5, -2.9, 4.0), (3.5, -2.9, 4.0), "lower cornice (left face)"),
    ((-1.9, -2.8, 6.7), (1.9, -2.8, 6.7), "upper cornice (left face)"),
    ((3.5, -2.9, 4.0), (3.5, -0.55, 4.0), "lower cornice (right face)"),
    ((4.85, -1.85, 2.7), (4.85, 0.7, 2.7), "right stub top (right face)"),
 ],
 "magellans-cross": [
    ((-5, -5, 0), (5, -5, 0), "slab top (left face)"),
    ((5, -5, 0), (5, 5, 0), "slab top (right face)"),
    ((-1.76, -4.25, 0.3), (1.76, -4.25, 0.3), "step (left side)"),
    ((4.25, -1.76, 0.3), (4.25, 1.76, 0.3), "step (right side)"),
    ((-1.66, -4.0, 0.65), (1.66, -4.0, 0.65), "wall plinth (left side)"),
    ((4.0, -1.66, 0.65), (4.0, 1.66, 0.65), "wall plinth (right side)"),
    ((-1.856, -4.48, 4.5), (1.856, -4.48, 4.5), "roof eave (left side)"),
    ((4.48, -1.856, 4.5), (4.48, 1.856, 4.5), "roof eave (right side)"),
 ],
 "rizal-monument": [
    ((-4.5, -4.5, 0.3), (4.5, -4.5, 0.3), "step 1 (left face)"),
    ((4.5, -4.5, 0.3), (4.5, 4.5, 0.3), "step 1 (right face)"),
    ((-3.5, -3.5, 0.9), (3.5, -3.5, 0.9), "step 3 (left face)"),
    ((3.5, -3.5, 0.9), (3.5, 3.5, 0.9), "step 3 (right face)"),
    ((2.12, -2.12, 4.96), (2.12, 2.12, 4.96), "pedestal cap (right face)"),
    ((-0.55, -0.55, 18.16), (0.55, -0.55, 18.16), "obelisk top (left face)"),
    ((0.55, -0.55, 18.16), (0.55, 0.55, 18.16), "obelisk top (right face)"),
 ],
 "windpump": [
    ((-0.8, -0.8, 4.0), (0.8, -0.8, 4.0), "platform top (left face)"),
    ((0.8, -0.8, 4.0), (0.8, 0.8, 4.0), "platform top (right face)"),
    ((-0.8, -0.8, 3.8), (0.8, -0.8, 3.8), "platform foot (left face)"),
    ((0.8, -0.8, 3.8), (0.8, 0.8, 3.8), "platform foot (right face)"),
 ],
}


def load_cam(name):
    c = json.load(open(os.path.join(HERE, "bo", f"{name}.json")))
    f, l = c["front"], c["left"]
    k = (f[0] - l[0]) / (10 * R2)
    fr = (5, -5, -SLAB_T)
    return lambda p: (f[0] + (dot(p, RIGHT) - dot(fr, RIGHT)) * k, f[1] - (dot(p, UP) - dot(fr, UP)) * k), c


def to_target(name, pic):
    proj, c = load_cam(name)
    m = measure(pic)
    s = (m["bx"] - min_x(pic)) / (c["front"][0] - c["left"][0])
    def f(p):
        x, y = proj(p)
        return (m["bx"] + (x - c["front"][0]) * s, m["by"] + (y - c["front"][1]) * s)
    return f


def min_x(pic):
    from PIL import Image
    a = Image.open(pic).convert("RGBA").getchannel("A")
    bb = a.point(lambda v: 255 if v > 128 else 0).getbbox()
    return bb[0]


def spec_for(name, pic, label=None):
    f = to_target(name, pic)
    cj = json.load(open(os.path.join(HERE, "bo", f"{name}.json"))); zs, z0 = cj.get("zs", 1.0), cj.get("z0", 0.0)
    up = lambda z: z if z <= z0 else z0 + (z - z0) * zs
    lines = []
    for a, b, nm in KEY[name]:
        a, b = inset(a, b)
        a, b = (a[0], a[1], up(a[2])), (b[0], b[1], up(b[2]))
        (x0, y0), (x1, y1) = f(a), f(b)
        lines.append([x0, y0, x1, y1, nm])
    return {label or os.path.basename(pic): {"pic": pic, "lines": lines}}


if __name__ == "__main__":
    args = sys.argv[1:]; out = None
    if "--sheet" in args:
        i = args.index("--sheet"); out = args[i + 1]; del args[i:i + 2]
    name, pics = args[0], args[1:]
    spec = {}
    for p in pics: spec.update(spec_for(name, p, p.split("/")[-2] + "/" + p.split("/")[-1]))
    snap_run(spec, out, 1.0 if "1024" in "".join(pics) else 2.0)
