"""Key structure edges of each wonder, taken from its 3D block-out (blockout.py), projected to pixels and measured
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
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "..", "decor-seat"))
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
 "fort-santiago": [
    ((-2.42, -4.85, 3.65), (3.02, -4.85, 3.65), "gate cornice (left face)"),
    ((-2.4, -4.82, 0.35), (3.0, -4.82, 0.35), "gate plinth (left face)"),
    ((3.02, -4.85, 3.65), (3.02, -2.0, 3.65), "gate cornice (right face)"),
    ((4.7, -2.7, 2.9), (4.7, 4.7, 2.9), "wall top (right face)"),
    ((4.7, -2.7, 0.0), (4.7, 4.7, 0.0), "wall foot (right face)"),
    ((-4.7, -4.4, 2.9), (-2.3, -4.4, 2.9), "wall top (left face)"),
 ],
 "paoay-church": [
    ((-4.9, -4.95, 2.25), (0.8, -4.95, 2.25), "facade band (left face)"),
    ((-4.8, -4.75, 0.0), (0.7, -4.75, 0.0), "facade foot (left face)"),
    ((0.55, -4.05, 3.0), (0.55, 3.15, 3.0), "roof eave (right)"),
    ((-2.05, -4.05, 5.0), (-2.05, 3.15, 5.0), "roof ridge"),
    ((1.75, 0.75, 2.6), (4.65, 0.75, 2.6), "tower ledge 1 (left face)"),
    ((4.65, 0.75, 2.6), (4.65, 3.65, 2.6), "tower ledge 1 (right face)"),
    ((1.87, 0.87, 4.8), (4.53, 0.87, 4.8), "tower ledge 2 (left face)"),
    ((4.53, 0.87, 4.8), (4.53, 3.53, 4.8), "tower ledge 2 (right face)"),
 ],
 "magellans-cross": [
    ((-4.3, -4.3, 0.4), (4.3, -4.3, 0.4), "lower step (left face)"),
    ((4.3, -4.3, 0.4), (4.3, 4.3, 0.4), "lower step (right face)"),
    ((-3.6, -3.6, 0.8), (3.6, -3.6, 0.8), "upper step (left face)"),
    ((3.6, -3.6, 0.8), (3.6, 3.6, 0.8), "upper step (right face)"),
    ((1.684, -4.065, 4.4), (-1.684, -4.065, 4.4), "roof eave (left side)"),
    ((4.065, -1.684, 4.4), (4.065, 1.684, 4.4), "roof eave (right side)"),
    ((1.347, -3.252, 1.1), (-1.347, -3.252, 1.1), "arcade plinth (left side)"),
    ((3.252, -1.347, 1.1), (3.252, 1.347, 1.1), "arcade plinth (right side)"),
 ],
 "pyramids": [
    ((-2.1, -1.8, 1.4375), (3.3, -1.8, 1.4375), "course 5 (left face)"),
    ((3.3, -1.8, 1.4375), (3.3, 3.6, 1.4375), "course 5 (right face)"),
    ((-0.975, -0.675, 2.875), (2.175, -0.675, 2.875), "course 10 (left face)"),
    ((2.175, -0.675, 2.875), (2.175, 2.475, 2.875), "course 10 (right face)"),
 ],
 "taj-mahal": [
    ((-4.8, -4.8, 0.9), (4.8, -4.8, 0.9), "plinth top (left face)"),
    ((4.8, -4.8, 0.9), (4.8, 4.8, 0.9), "plinth top (right face)"),
    ((-3.58, -3.58, 4.15), (3.58, -3.58, 4.15), "parapet (left face)"),
    ((3.58, -3.58, 4.15), (3.58, 3.58, 4.15), "parapet (right face)"),
    ((-2.45, -3.5, 0.9), (2.45, -3.5, 0.9), "hall foot (left face)"),
    ((3.5, -2.45, 0.9), (3.5, 2.45, 0.9), "hall foot (right face)"),
 ],
 "rizal-monument": [
    ((-4.4, -4.4, 0.45), (4.4, -4.4, 0.45), "step 1 (left face)"),
    ((4.4, -4.4, 0.45), (4.4, 4.4, 0.45), "step 1 (right face)"),
    ((-3.6, -3.6, 0.9), (3.6, -3.6, 0.9), "step 2 (left face)"),
    ((3.6, -3.6, 0.9), (3.6, 3.6, 0.9), "step 2 (right face)"),
    ((2.15, -2.15, 2.7), (2.15, 2.15, 2.7), "pedestal cap (right face)"),
    ((-0.85, -0.85, 10.6), (0.85, -0.85, 10.6), "obelisk top (left face)"),
    ((0.85, -0.85, 10.6), (0.85, 0.85, 10.6), "obelisk top (right face)"),
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
