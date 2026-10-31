"""puttydmg.py : the Putty Squisher's damaged and destroyed looks in 3D, as Flash's damaged pictures per level and its
one destroyed heap. The approved model (putty3.py + stack.py, art/buildings-3d-b6 0a42dfcab, copied here unchanged) is
built as it is, then broken where Flash's damaged picture has it broken; the destroyed look is the pot tipped over in
its spilt putty (Flash has one heap for every level).

    blender -b --factory-startup -P puttydmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 3

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135. Flash has no
damaged or destroyed animation for this building, so the stirrer, putty and cage stand still.
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import dmgcore as D  # noqa: E402

D.load(HERE / "putty3.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
ZP, ZR = G["ZP"], G["ZR"]


# ------------------------------------------------------------------------------------------------------------ helpers
def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def pre(*prefixes):
    """Unparented objects whose part name starts with one of prefixes."""
    return [o for o in SC.objects if o.parent is None and base(o).startswith(prefixes)]


def mid(obs):
    return sum((bbox_w(o) for o in obs), Vector()) / len(obs)


def lay(obs, at, rot, extra=0.0):
    """Move a group to lie on the ground at (x, y): turned rot (degrees XYZ) round its middle, resting on the ground."""
    c = mid(obs)
    e = hinge(obs, c, rot=rot, move=Vector((at[0], at[1], c.z)) - c)
    bpy.context.view_layer.update()
    e.location.z += GROUND + extra - lowest(obs)
    return e


def puddle(x, y, r, stretch=(1.0, 1.0), seed=0, lumps=3):
    """Spilt putty on the ground: a flat purple pool with a few rounder lumps in it."""
    rr = random.Random(seed + 10 * L)
    G["blob"]("puddle", (x, y, GROUND + 0.01), r, squash=0.07, stretch=stretch)
    for k in range(lumps):
        a = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(0.2, 0.7) * r
        G["blob"]("puddle", (x + d * math.cos(a) * stretch[0], y + d * math.sin(a) * stretch[1], GROUND + 0.01),
                  r * rr.uniform(0.3, 0.5), squash=rr.uniform(0.15, 0.3))


def char_pot(spots):
    """Flash's damaged pot is blotched black-brown: scorch spots on its belly (bearing, height above its foot, size)."""
    for th, z, rad in spots:
        a = math.radians(th)
        burn(Vector((S.POT_RMAX * math.cos(a), S.POT_RMAX * math.sin(a), ZP + z)), rad * 1.3)


def knock_stump(k, at, rot):
    """Stump k knocked out from under the frame (with its spring at level 10), lying on the ground; its post's foot
    burnt."""
    obs = objs(f"stump{k}", f"stumptop{k}") + objs(f"spring{k}")
    c = mid(obs)
    burn(Vector((c.x, c.y, S.LIFT)), 0.8)
    lay(obs, at, rot)


def tube_off(at, rot, short=0.0):
    """The test tube broken off its arm, lying on the ground; short: its glass snapped off at the foot by this much
    of its length (the holder stays up)."""
    obs = pre("tubeglass", "tubetop", "tubecap") + ([] if short else pre("holder"))
    if short:
        g = objs("tubeglass")[0]
        zs = [v.co.z for v in g.data.vertices]
        cut = min(zs) + (max(zs) - min(zs)) * short
        for v in g.data.vertices:
            if v.co.z < cut:
                v.co.z = cut - (cut - v.co.z) * 0.03 + random.uniform(-0.12, 0.12)
    lay(obs, at, rot)


CHAR = [(-60, 1.2, 1.1), (-10, 2.3, 1.0), (-120, 0.7, 1.0), (20, 1.0, 0.9), (-90, 2.4, 0.8), (-30, 0.4, 0.9),
        (-150, 2.0, 0.8)]


def frame_drips(n, seed=0):
    """Putty running off the frame's front rails and posts in long drips (Flash's damaged frame drips all over)."""
    rr = random.Random(seed + L)
    rails = [o for o in pre("rail") if bearing_of(mid([o])) < 80 and bearing_of(mid([o])) > -170]
    for k in range(n):
        c = mid([rails[k % len(rails)]])
        t = rr.uniform(-0.8, 0.8)
        d = Vector((-c.y, c.x, 0)).normalized() * t
        ln = rr.uniform(0.3, 0.6)
        G["blob"]("frdrip", (c.x * 1.06 + d.x, c.y * 1.06 + d.y, c.z - ln * 0.7), 0.16, squash=ln / 0.16)
        G["blob"]("frdrop", (c.x * 1.06 + d.x, c.y * 1.06 + d.y, c.z - ln * 1.4), 0.17, squash=1.1)


def bearing_of(p):
    return math.degrees(math.atan2(p.y, p.x))


def sag(k):
    """Stump k is knocked out: everything it held tips toward its corner, putty pouring down there to the ground."""
    c = mid(objs(f"stump{k}"))
    o = Vector((-c.x, -c.y, 0)).normalized()
    pivot = Vector((-c.x, -c.y, GROUND))
    ax = Vector((o.y, -o.x, 0))
    T = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(7), 4, ax) @ Matrix.Translation(-pivot)
    shift_all(T, keep=objs(f"stump{k}", f"stumptop{k}", f"spring{k}"))
    G["blob"]("pour", (c.x * 0.95, c.y * 0.95, S.LIFT * 0.55), 0.42, squash=2.6)
    G["blob"]("pour", (c.x * 0.97, c.y * 0.97, S.LIFT * 0.95), 0.5, squash=1.2)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    px = G["px"]
    r = random.Random(3 + L)
    for o in pre("potrivet"):
        if r.random() < 0.35:
            kill([o])
    if L == 1:
        # Flash: the pot blotched and burnt, the block tipped into it, the stirrer bent; the tube's holder fallen
        # against the pot on the right and the tube broken on the ground in front of it; the hand wheel off on the
        # ground at the left; putty spilt in front
        char_pot(CHAR)
        hinge(objs("block", "blocktop") + pre("blockhole"), Vector((0.8, -1.6, ZR)), rot=(-15, -28, 0),
              move=(-0.55, 0.35, -0.12))
        burn(Vector((-0.5, -1.0, ZR + 0.2)), 1.3)
        hinge(objs("stir"), Vector((0, 0, ZR)), rot=(22, -18, 0))
        kill(objs("tubefoot"))
        arm = objs("tubearm", "holder", "holderhorn")
        hinge(arm, Vector((S.POT_R * 0.7, S.POT_R * 0.7, ZR)), rot=(18, -12, 0), move=(0, 0, -0.2))
        tube_off((2.4, -2.0), (88, 0, 75), short=0.55)
        lay(pre("wheelrim", "wheelspoke", "wheelhub", "wheelknob") + objs("wheel"), (-2.6, -1.6), (80, 0, 30))
        kill(objs("wheelaxle", "wheelboss"))
        puddle(*px(6, 52, Z=GROUND).xy, 0.9, stretch=(1.4, 0.8), seed=1)
    elif L == 3:
        # Flash: the left stump knocked out and lying at the front left, the frame sagging over it, the right arch
        # broken; the tube fallen at the front right; putty pouring down the frame into pools
        char_pot(CHAR)
        sag(3)
        frame_drips(10, 1)
        knock_stump(3, (-1.4, -3.3), (0, 90, 30))
        hinge(objs("arch1") + pre("archknuckle1", "archseat1"), Vector((0.6, 1.66, ZR)), rot=(45, 0, 10))
        kill(objs("tubefoot"))
        tube_off((2.6, -1.8), (85, 0, 60))
        kill(objs("tubearm"))
        puddle(*px(-14, 52, Z=GROUND).xy, 1.0, stretch=(1.3, 0.9), seed=2)
        puddle(*px(22, 56, Z=GROUND).xy, 0.5, seed=3)
    elif L == 6:
        # Flash: the front stump knocked out and lying in front, the hub tipped, the flask bent off to the left, the
        # tube sticking out at a slant to the right; putty pooled under the frame
        char_pot(CHAR)
        sag(0)
        frame_drips(10, 2)
        knock_stump(0, (0.5, -3.6), (90, 0, 70))
        hinge(objs("hub", "hubband0", "hubband1", "hubring", "hubhole", "flaskcollar", "flask", "flaskneck",
                   "valveshaft") + objs("valve"), Vector((0, 0, ZR + S.ARCH_UP)), rot=(-10, -8, 0))
        hinge(objs("flaskcollar", "flask", "flaskneck"), Vector((0, 0, ZR + S.ARCH_UP + 1.2)), rot=(30, -25, 0))
        t = pre("tubeglass", "tubetop", "tubecap", "holder")
        hinge(t, mid(t), rot=(-30, 35, 20), move=(0.3, -0.2, -0.6))
        puddle(*px(4, 60, Z=GROUND).xy, 1.1, stretch=(1.3, 0.9), seed=4)
        puddle(*px(24, 66, Z=GROUND).xy, 0.6, seed=5)
    else:
        # Flash: the cage wheel knocked crooked and bent, the front stump and its spring knocked out, the valve
        # wheel lying at the front left, the tube hanging at the right; putty pooled in front
        char_pot(CHAR)
        sag(0)
        frame_drips(10, 2)
        sag(0)
        frame_drips(10, 3)
        knock_stump(0, (0.6, -3.8), (90, 0, 60))
        cg = objs("cage", "cageaxle", "cageaxlecap")
        hinge(cg, Vector((0, 1.0, ZR + S.ARCH_UP + 1.0)), rot=(-14, 18, 8))
        for n in ("cagerung1", "cageputty1", "cagerung5", "cageputty5", "cagestring2"):
            kill(objs(n, top=False))
        burn(Vector((0, 2.5, ZR + S.ARCH_UP + 2.0)), 1.0)
        lay(objs("valve"), (-2.8, -2.6), (85, 0, 40))
        kill(objs("valveshaft"))
        t = pre("tubeglass", "tubetop", "tubecap", "holder")
        hinge(t, mid(t), rot=(-20, 30, 10), move=(0.2, -0.2, -0.5))
        puddle(*px(6, 62, Z=GROUND).xy, 1.1, stretch=(1.3, 0.9), seed=6)
        puddle(*px(-16, 60, Z=GROUND).xy, 0.5, seed=7)
    # the hits charred: under the rim and round the frame's knocked corner
    burn(Vector((1.2, -1.2, ZR - 0.3)), 0.8)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    """Flash's one heap for every level: the pot tipped over on its side, its mouth to the front left, lying in a
    wide pool of spilt putty; the gold hand wheel on the ground at its right; burnt black."""
    G["build"]()
    px = G["px"]
    keep = ("pot", "potrim", "potin", "potfoot", "potband", "potrivet", "putty", "puttysurf")
    kill([o for o in SC.objects if o.parent is None and o.type in ("MESH", "CURVE", "EMPTY") and
          not base(o).startswith(keep) and base(o) not in ("wheel", "ground")])
    potp = pre("pot", "potrim", "potin", "potfoot", "potband", "potrivet") + objs("putty")
    # tip it over: its mouth to bearing -150 (front left), lying on its side
    e = hinge(potp, Vector((0, 0, ZP + S.POT_H / 2)), rot=(0, -84, 0))
    e.rotation_euler = (0, math.radians(-76), math.radians(80))          # its mouth to bearing -100, tipped up a little
    e.location = Vector((0.4, 0.5, ZP + S.POT_H / 2))
    bpy.context.view_layer.update()
    e.location.z += GROUND - 0.15 - lowest(potp)
    kill(objs("putty", top=False))                      # its putty all spilt out
    c = mid(objs("pot", top=False))                     # a torn gap in its upturned side, the rusty inside showing
    hole = c + Vector((0.5, 0.7, 1.1))
    for n in ("pot", "potin", "potband0"):
        for o in objs(n, top=False):
            o = bake(o)
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=3, use_grid_fill=True)
            bm.to_mesh(o.data)
            bm.free()
            sheet_holes(o, [(hole.x, hole.y, hole.z, 1.1)])
    burn(hole, 1.4)
    for d in ((1.0, 0.0, 0.6), (-0.8, 0.4, 0.8), (0.2, -0.9, 0.2), (0.6, 0.9, -0.3)):
        burn(c + Vector(d), 1.9)
    # the spilt putty pouring out of its mouth over the ground
    m = Vector((math.cos(math.radians(-110)), math.sin(math.radians(-110)), 0))
    for k, (d, rad, st) in enumerate(((1.2, 1.8, (1.5, 1.1)), (2.6, 1.3, (1.2, 0.9)), (0.0, 1.6, (1.3, 1.0)))):
        p = Vector((0.4, 0.5, 0)) + m * d
        puddle(p.x, p.y, rad, stretch=st, seed=10 + k, lumps=4)
    # the hand wheel on the ground at its right
    w = objs("wheel")
    if w:
        lay(w, (2.6, -0.6), (88, 0, 20))
    for p, rad in (((0.4, 0.5, 1.0), 2.2), ((-0.6, -0.2, 0.6), 1.6), ((1.4, 1.2, 1.6), 1.6), ((1.6, -0.6, 1.0), 1.4),
                   ((-0.2, 1.6, 1.8), 1.4)):
        burn(Vector(p), rad)


D.run(damaged, destroyed)
