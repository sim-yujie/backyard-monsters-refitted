"""labdmg.py : the Monster Lab's damaged and destroyed looks in 3D, after Flash's top.1.damaged.png and
top.1.destroyed.png (one look for every level). The model (../lab.py) is built as it is, then broken: the lower walls
crushed and holed so the whole upper tier drops and leans forward, the gold columns buckled, the pipes knocked askew, the
bells tipped; the destroyed look is the same parts in one low burnt heap inside the building's square, the dome on top.

    blender -b --factory-startup -P labdmg.py -- 1 <prev|still> <damaged|destroyed>      (run.sh <prev|still> <state>)

Flash has no damaged or destroyed animation for the Lab, so each look is one still (the steam stays still too).
"""
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "lab.py")
from dmgcore import *  # noqa: E402,F401,F403
uv, mir, xy, grow, prism = G["uv"], G["mir"], G["xy"], G["grow"], G["prism"]
LW, LD, UW = G["LW"], G["LD"], G["UW"]
LW_Z, LD_Z1 = G["LW_Z"], G["LD_Z1"]
R = random.Random(5)

LOWER = ("lwall", "lpost", "lskirt", "lband", "lrivet", "lbolt", "ldoor", "lstrip", "coil", "sdoor", "steam", "inner")
UPPER = ("ldeck", "uwall", "uflank", "upost", "pilaster", "ustrip", "uband", "urivet", "ubolt", "pipe", "udeck",
         "plinth", "bell", "wire", "dome", "uinner")


def named(*prefixes):
    return [o for o in SC.objects if o.parent is None and o.name.startswith(prefixes) and o.name != "ground"]


def group(prefix):
    return [o for o in SC.objects if o.name.startswith(prefix) and o.type != "EMPTY"]


def inner(h):
    """A dark box inside the lower walls: what the holes show."""
    o = prism("inner", grow(xy(LW), -0.3), 0.05, h, D.inside(), bevel=0.0)
    return o


def ragged(o, patches, axes, seed):
    return D.fine_holes(o, patches, axes=axes, cuts=6, seed=seed)


def char(*pts):
    for p, r in pts:
        burn(p, r)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    # holes of different sizes in the lower walls (front-left, the recess, front-right) and the upper walls
    inner(LW_Z - 0.1)
    lw = named("lwall")[0]
    ragged(lw, [(0.16, 0.55, 0.1, 0.24), (0.34, 0.22, 0.05, 0.12), (0.5, 0.6, 0.13, 0.26), (0.76, 0.42, 0.09, 0.2),
                (0.92, 0.72, 0.05, 0.12)], ("x", "z"), 1)
    uw = named("uwall")[0]
    ragged(uw, [(0.18, 0.45, 0.09, 0.22), (0.84, 0.6, 0.11, 0.25)], ("y", "z"), 2)
    ud = named("udeck")[0]
    ragged(ud, [(0.55, 0.05, 0.16, 0.6), (0.1, 0.5, 0.08, 0.5)], ("x", "y"), 4)      # a bite out of its front edge
    prism("uinner", grow(xy(UW), -0.3), LD_Z1 + 0.05, G["UD_Z0"] - 0.05, D.inside(), bevel=0.0)
    # the lower walls crushed: everything above drops onto them and leans toward the viewer and to the left
    crush = 0.62
    for o in named(*LOWER):
        if o.name.startswith("coil"):
            continue
        o.scale.z *= crush
        o.location.z *= crush
    drop = LW_Z * (1 - crush)
    up = named(*UPPER)
    D.hinge(up, (0.0, 0.0, LW_Z), rot=(-5.0, -8.0, 0.0), move=(0.0, 0.0, -drop))
    # the gold columns buckle: each a little shorter and leaning outward, under the dropped deck
    for k, s in ((0, 1), (1, -1)):
        c = group(f"coil{k}")
        base = c[0].location.copy()
        for o in c:
            o.scale.z *= 0.74
        D.hinge(c, base, rot=(s * 9.0, s * -9.0, 0.0))
    # the pipes knocked askew round their wall ends; the bells tipped; the plinth slid
    for k, (rx, ry) in enumerate(((14.0, -6.0), (-6.0, 14.0))):
        p = group(f"pipe{k}") + group(f"pipeflange{k}") + group(f"pipecollar{k}")
        D.hinge(p, bpy.data.objects[f"pipecollar{k}"].matrix_world.translation.copy(), rot=(rx, ry, 0.0))
    for name, rot in (("bellL", (-16.0, 10.0, 0.0)), ("bellR", (8.0, 18.0, 0.0)), ("bellC", (-7.0, 6.0, 0.0))):
        b = group(name)
        D.hinge(b, bpy.data.objects[name].matrix_world.translation.copy(), rot=rot)
    pl = group("plinth")
    D.hinge(pl + group("bellC"), pl[0].matrix_world.translation, rot=(-5.0, 4.0, 12.0))
    # broken sticks and panels in front, smoke-blackened spots round the breaks (metal too)
    for k, (u, v) in enumerate(((-1.5, 2.6), (1.2, 2.9), (-6.2, 1.6))):
        x, y = uv(u, v)
        D.debris((x, y), n=4, spread=0.7, kinds=("plank", "stick", "bracket"), seed=k,
                 mats={"plank": M["navy"], "stick": M["brass"], "bracket": M["steel"]})
    rewire()
    char(((uv(-5.0, 1.6)) + (2.0,), 1.3), ((uv(0.0, 1.6)) + (1.4,), 1.4), ((uv(5.5, 1.4)) + (2.4,), 1.2),
         ((uv(-4.6, 1.0)) + (7.0,), 1.1), ((uv(5.0, 1.0)) + (7.6,), 1.0), ((uv(-3.6, 3.0)) + (1.0,), 0.9),
         ((uv(3.6, 3.0)) + (2.0,), 0.8), ((uv(-1.0, 0.0)) + (9.2,), 1.2))


def rewire():
    """The copper wires again, from where the tipped bells' tops are now."""
    D.kill(group("wire"))
    bpy.context.view_layer.update()
    top = {"bellC": 3.4 + 1.75 + 0.05, "bellL": 2.06 + 0.6 + 0.05, "bellR": 2.06 + 0.6 + 0.05}
    t = {k: bpy.data.objects[k].matrix_world @ Vector((0, 0, h)) for k, h in top.items()}
    q = t["bellC"] + Vector((0, 0, 0.1))
    for k, name in enumerate(("bellL", "bellR")):
        p = t[name]
        side = p - q
        side.z = 0
        mid = q + side * 0.5 + Vector((0, 0, (p.z - q.z) * 0.5 + 0.1))
        tube(f"wire{k}", [tuple(p), tuple(p + Vector((0, 0, 0.3))), tuple(mid), tuple(q + side * 0.12 +
             Vector((0, 0, 0.3))), tuple(q)], 0.1, M["copper"], verts=8, smooth=True)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    D.kill(named("steam", "uwall", "uflank", "upost", "pilaster", "ustrip", "uband", "urivet", "ubolt", "wire",
                 "lstrip", "ldoor", "lbolt", "sdoorhole", "sdoorjamb", "sdoorlintel"))
    inner(0.9)
    # the lower walls: a ragged stump about a fifth of their height
    lw = named("lwall")[0]
    ragged(lw, [(0.3, 0.95, 0.12, 0.25), (0.6, 0.9, 0.1, 0.2), (0.85, 0.95, 0.08, 0.2)], ("x", "z"), 3)
    for o in named("lwall", "lpost", "lskirt", "lband", "lrivet"):
        o.scale.z *= 0.24
        o.location.z *= 0.24
    stump = LW_Z * 0.24
    # the lower deck broken in two, its halves sagging onto the stump; the upper deck a slab leaning on the heap
    ld = named("ldeck")
    ragged(ld[0], [(0.08, 0.5, 0.1, 0.5), (0.5, 0.95, 0.2, 0.12), (0.9, 0.3, 0.12, 0.3), (0.55, 0.15, 0.1, 0.2)],
           ("x", "y"), 5)
    ld = named("ldeck")
    D.hinge(ld, (0.0, 0.0, LW_Z), rot=(4.0, -6.0, 3.0), move=(0.0, 0.0, stump - LW_Z + 0.35))
    ud = named("udeck")
    ragged(ud[0], [(0.1, 0.4, 0.15, 0.4), (0.7, 0.9, 0.2, 0.15)], ("x", "y"), 6)
    ud = named("udeck")
    D.hinge(ud, (0.0, 0.0, G["UD_Z0"]), rot=(-14.0, 10.0, -8.0), move=(0.6, 1.3, 1.6 - G["UD_Z0"]))
    # navy wall panels broken off and leaning in the heap
    for k, (u, v, yaw, tilt) in enumerate(((-6.8, 1.0, 30, 62), (5.6, 0.4, -55, 58), (-2.5, -1.5, 80, 70),
                                           (3.0, -2.8, 10, 66), (-4.6, -3.2, -30, 74))):
        x, y = uv(u, v)
        o = box(f"panel{k}", (1.9 + 0.3 * (k % 2), 0.12, 1.5), (x, y, 0.0), M["navy"], rot=(tilt, 0, yaw), bevel=0.03,
                jitter=0.03)
        D.sit([o])
    # the dome sits on top of the heap, a little tipped; the gold columns lie in front
    dm = group("dome")
    D.hinge(dm, dm[0].matrix_world.translation, rot=(8.0, -6.0, 0.0), move=(0.0, 0.0, 2.4 - LD_Z1))
    for k, (u, v, yaw) in enumerate(((-3.3, 3.0, 20.0), (4.4, 3.0, -20.0))):
        c = group(f"coil{k}")
        x, y = uv(u, v)
        e = D.hinge(c, c[0].location.copy(), rot=(90.0, 0.0, yaw), move=(x - c[0].location.x, y - c[0].location.y, 0.0))
        D.sit([e])
    # the bells: the big one on its side on the heap's left, the small ones scattered
    for name, (u, v), rot in (("bellC", (-4.2, 0.8), (0.0, 80.0, 30.0)), ("bellL", (-3.4, 1.6), (70.0, 0.0, 10.0)),
                              ("bellR", (3.9, 1.3), (0.0, -75.0, -20.0))):
        b = group(name)
        x, y = uv(u, v)
        p0 = bpy.data.objects[name].matrix_world.translation.copy()
        e = D.hinge(b, p0, rot=rot, move=(x - p0.x, y - p0.y, 0.0))
        D.sit([e], extra=0.9 if name == "bellC" else 1.15)
    # the pipes lie broken by the sides, the plinth thrown down, the flanges and plates on the ground
    for k, (u, v, yaw) in enumerate(((-5.4, 2.6, 0.0), (6.2, 2.0, 40.0))):
        p = group(f"pipe{k}") + group(f"pipecollar{k}") + group(f"pipeflange{k}")
        x, y = uv(u, v)
        p0 = bpy.data.objects[f"pipecollar{k}"].matrix_world.translation.copy()
        e = D.hinge(p, p0, rot=(0.0, 0.0, yaw), move=(x - p0.x, y - p0.y, 0.0))
        D.sit([e], extra=0.3)
    pl = group("plinth")
    p0 = pl[0].matrix_world.translation.copy()
    x, y = uv(1.8, -1.0)
    e = D.hinge(pl, p0, rot=(22.0, -10.0, 15.0), move=(x - p0.x, y - p0.y, 0.0))
    D.sit([e], extra=1.2)
    # copper wire torn loose, tangled over the heap
    for k in range(3):
        pts = [Vector(uv(R.uniform(-6, 6), R.uniform(-2, 3))).to_3d() for _ in range(4)]
        for p in pts:
            p.z = R.uniform(1.5, 2.6)
        tube(f"wireloose{k}", [tuple(p) for p in pts], 0.09, M["copper"], verts=8, smooth=True)
    for k, (u, v) in enumerate(((-2.0, 2.4), (2.4, 2.5), (-7.6, 0.9), (0.4, 3.0))):
        x, y = uv(u, v)
        D.debris((x, y), n=4, spread=0.8, kinds=("plank", "stick", "bracket"), seed=10 + k,
                 mats={"plank": M["navy"], "stick": M["copper"], "bracket": M["steel"]})
    char(((0.0, 0.0, 1.0), 2.4), (tuple(uv(-4.2, 0.8)) + (1.0,), 1.4), (tuple(uv(-3.3, 3.0)) + (0.4,), 1.2),
         (tuple(uv(3.6, 2.4)) + (0.4,), 1.2), (tuple(uv(6.6, 0.0)) + (0.6,), 1.0), (tuple(uv(-7.0, -0.6)) + (0.6,), 1.0),
         (tuple(uv(-5.4, 2.6)) + (0.6,), 1.0), (tuple(uv(6.2, 2.0)) + (0.6,), 1.0), (tuple(uv(1.0, -2.0)) + (2.0,), 1.6))


D.run(damaged, destroyed, soot_amount=(0.3, 0.5))
