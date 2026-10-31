"""pebbledmg.py : the Pebble Shiner's damaged and destroyed looks in 3D, as Flash's top.<n>.damaged.png and
top.destroyed.png. The approved model (pebble2.py + stack.py, art/buildings-3d-b6 7a9f41361, copied here unchanged)
is built as it is, then broken where Flash's damaged picture has it broken; the destroyed look is its parts in one heap
(Flash has one heap for every level).

    blender -b --factory-startup -P pebbledmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 3

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135. Flash has no
damaged or destroyed animation for this building, so the rings, drum and ball stand still.
"""
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import dmgcore as D  # noqa: E402

D.load(HERE / "pebble2.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
MATS = {"plank": M["roof"]("Y"), "stick": M["roofb"]("Z"), "bracket": M["iron"]}


# ------------------------------------------------------------------------------------------------------------ helpers
def bearing(o):
    """A block's bearing round the tower (degrees, -180..180), from its world middle."""
    c = bbox_w(o)
    return math.degrees(math.atan2(c.y, c.x))


def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def blocks(*names):
    """Every stone block of these courses, rings' blocks too (they hang under the ring's hub)."""
    return [o for o in SC.objects if o.type == "MESH" and base(o) in names]


def facing(obs, lo, hi):
    return [o for o in obs if lo <= bearing(o) <= hi]


def knock_out(obs, picks, push=0.0, drop=False, r=None):
    """Blocks by index in obs: knocked out of their course (gone, the dark core behind shows), or with push pushed
    out of the wall and tipped (hanging half out). Each break is scorched."""
    r = r or random.Random(L)
    for i in picks:
        if i >= len(obs):
            continue
        o = obs[i]
        c = bbox_w(o)
        burn(c, 0.9)
        if push <= 0:
            kill([o])
            continue
        out = Vector((c.x, c.y, 0)).normalized()
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = Matrix.Translation(out * push + Vector((0, 0, -0.1 if drop else 0))) @ \
            Matrix.Translation(c) @ Matrix.Rotation(math.radians(r.uniform(14, 28)), 4, Vector((-out.y, out.x, 0))) @ \
            Matrix.Translation(-c) @ mw


def stones(spots, seed=0, mat=None):
    """Fallen stone blocks on the ground: spots (x, y, size)."""
    r = random.Random(seed + 10 * L)
    for x, y, s in spots:
        size = (1.1 * s * r.uniform(0.85, 1.15), 0.75 * s * r.uniform(0.85, 1.15), 0.55 * s)
        box("rubblestone", size, (x, y, GROUND - 0.03), mat or M["stone"],
            rot=(r.uniform(-8, 8), r.uniform(-8, 8), r.uniform(0, 180)), bevel=0.12 * s, jitter=0.04)


def boards(spots, seed=0):
    """Roof planks knocked off, lying on the ground: spots (x, y, yaw)."""
    r = random.Random(seed + 10 * L)
    for x, y, yaw in spots:
        ob = G["shingle_mesh"]("fallenplank", 0.5, 0.36, r.uniform(0.9, 1.3), 0.08, M["roof"]("Y"), tip=0.18)
        ob.matrix_world = Matrix.Translation((x, y, GROUND + 0.06)) @ \
            Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(r.uniform(-8, 8)), 4, "Y")


ROOF = ("roofdeck", "roofplank", "roofpeak", "roofcap")
PIPE = ("pipearm", "pipeplate", "pipesocket", "pipe", "pipeband", "hornneck", "horn")


def polar(th, r, z):
    return Vector(S.polar(th, r, z))


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    ze = S.z_eave(L)
    r = random.Random(5 + L)
    head = blocks("headA", "headB")
    collar = blocks("collar")
    rings = blocks("ring1big", "ring1small", "ring2big", "ring2small")
    base = blocks("basecourse")
    def front(obs):                                    # the blocks the camera sees, left to right
        return sorted(facing(obs, -150, 60), key=bearing)
    head, collar, rings, base = front(head), front(collar), front(rings), front(base)
    if L == 1:
        # Flash: the roof slipped a little to the right, the pipe bent out to the left, gaps in the ring and base
        hinge(objs(*ROOF), polar(45, S.ROOF_R1, ze), rot=(-7, 9, 0), move=(0.12, 0.12, -0.32))   # sunk in
        hinge(objs(*PIPE), polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(6, -24, 0))
        knock_out(rings, (1, 4))
        knock_out(base, (3, 8))
        knock_out(collar, (2, 9, 12))
        knock_out(rings, (6,), push=0.35)
    elif L == 3:
        # Flash: the whole tower leans hard to the left; the roof slid down off it to the right; the horn snapped
        keep = objs("pebble")
        T = tilt_mat((-1.5, -1.5, GROUND), (11, -11, 0))                   # top toward bearing -135: screen left
        shift_all(T, keep=keep)
        hinge(objs(*ROOF), T @ polar(45, S.ROOF_R, ze), rot=(-22, 22, 0), move=(0.5, 0.5, -0.45))
        hinge(objs(*PIPE), T @ polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(18, -10, 30))
        knock_out(head, (2, 5, 7))
        knock_out(head, (3, 9), push=0.45, drop=True)
        knock_out(rings, (2,))
        knock_out(collar, (1, 6, 10))
    elif L == 6:
        # Flash: the pipe bent far out to the left, the roof tipped a little to the right with a plank sticking out,
        # a block gone from the top of the head
        hinge(objs(*ROOF), polar(45, S.ROOF_R, ze), rot=(-3, 6, 0), move=(0.05, 0.05, -0.06))
        hinge(objs(*PIPE), polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(22, -40, 0))
        knock_out(head, (4, 10))
        knock_out(collar, (3, 8, 11))
        knock_out(rings, (3, 9))
        knock_out(rings, (7,), push=0.3)
        pl = sorted(objs("roofplank"), key=lambda o: -bbox_w(o).x - bbox_w(o).y)[:1]   # one on the right, wrenched
        for o in pl:
            c = bbox_w(o)
            hinge([o], c, rot=(0, 0, 0), move=(0.35, 0.25, -0.1))
    else:
        # Flash: the roof and its drum tipped, the spiked ball fallen off its post onto the head's top on the right,
        # blocks knocked out of the head
        hinge(objs(*ROOF) + objs("drum", "drumaxle", "drumknob"), polar(45, S.ROOF_R, ze), rot=(-5, 8, 0),
              move=(0.08, 0.08, -0.1))
        kill(objs("ballpost", "ballaxle", "ballpostplate"))
        b = objs("ball")[0]
        b.matrix_world = Matrix.Translation(polar(25, 2.6, S.z_collar(L) - 0.45)) @ b.matrix_world.to_3x3().to_4x4()
        burn(polar(25, 2.2, S.z_collar(L)), 1.2)
        hinge(objs(*PIPE), polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(4, -12, 0))
        knock_out(head, (1, 4, 8))
        knock_out(head, (6,), push=0.4)
        knock_out(collar, (2, 7))
        knock_out(rings, (4, 11))
    # stones and roof planks on the ground round the foot, where Flash has them
    px = G["px"]
    sp = {1: [(-16, 50, 0.7), (-10, 56, 0.6), (-6, 62, 0.75), (20, 44, 0.8), (2, 58, 0.5)],
          3: [(-22, 44, 0.7), (8, 58, 0.7), (20, 46, 0.75), (-4, 60, 0.5)],
          6: [(-26, 42, 0.6), (16, 46, 0.6), (20, 54, 0.5), (-6, 62, 0.75), (24, 60, 0.4)],
          10: [(-26, 42, 0.6), (18, 46, 0.6), (22, 52, 0.5), (-10, 58, 0.5), (-2, 62, 0.8), (26, 58, 0.4)]}[L]
    stones([(px(x, y, Z=GROUND).x, px(x, y, Z=GROUND).y, s) for x, y, s in sp], seed=3)
    bd = {1: [(-12, 48, 30)], 3: [(-14, 54, 20), (-6, 58, -30), (6, 56, 60)], 6: [(-16, 50, 40), (8, 58, -20)],
          10: [(-16, 50, 20), (6, 58, 70), (14, 50, -30)]}[L]
    boards([(px(x, y, Z=GROUND).x, px(x, y, Z=GROUND).y, yaw) for x, y, yaw in bd], seed=4)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    """Flash's one heap for every level (top.destroyed.png): a low mound of grey blocks, the roof cone lying tipped on
    top of it, the horn and pipe lying out to the left, the spout's dark mouth at the front-left, planks through it."""
    G["build"]()
    px = G["px"]
    g = GROUND
    r = random.Random(21)
    allb = blocks("headA", "headB", "collar", "basecourse", "ring1big", "ring1small", "pier")
    kill(objs("ring1band", top=False) + objs("shaft", "legcore", "headcore", "collarcore", "pebble", "slot"))
    # the blocks tumbled into a mound: high in the middle, spilling out to the front and right
    for k, o in enumerate(allb):
        if k % 4 == 1:
            kill([o])
            continue
        mw, b0 = o.matrix_world.copy(), bbox_w(o)
        sx, sy = r.uniform(-26, 32), r.uniform(24, 50)
        mid = max(0.0, 1 - abs(sx - 2) / 30) * max(0.0, 1 - abs(sy - 36) / 14)
        c = px(sx, sy, Z=g + 0.2 + 1.5 * mid * r.uniform(0.5, 1.0))
        o.parent = None
        o.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(math.radians(r.uniform(0, 360)), 4, "Z") @ \
            Matrix.Rotation(math.radians(r.uniform(-35, 35)), 4, "X") @ Matrix.Translation(-b0) @ mw
    # the roof cone lying tipped on top, toward the back
    c = px(6, 28, Z=g + 0.9)                           # sunk in the middle, its top tipped away to the back
    hinge(objs(*ROOF), Vector((0, 0, S.z_eave(3))), rot=(-30, -18, 8), move=c - Vector((0, 0, S.z_eave(3))))
    pl = objs("roofplank", top=False)                  # the roof broken up: planks torn off it, the deck showing
    kill([o for k, o in enumerate(pl) if r.random() < 0.35])
    # the pipe and horn lying out to the left
    foot = polar(S.PIPE_TH, S.PIPE_R, S.z_eave(3) - 0.2)
    hinge(objs(*PIPE), foot, rot=(0, -80, 25), move=px(-12, 36, Z=g + 0.5) - foot)
    # the spout's dark mouth at the front-left, tipped up
    sp = objs("spout") + objs("spouthole")
    a = math.radians(S.SPOUT_TH)
    d0 = Vector((math.cos(a), math.sin(a), -0.12)).normalized()           # its mouth turned up toward the camera
    q = d0.rotation_difference(Vector((0.55, -0.6, 0.6)).normalized())
    e = hinge(sp, bbox_w(sp[0]), move=px(-17, 47, Z=g + 0.75) - bbox_w(sp[0]))
    e.rotation_euler = q.to_euler()
    # planks through it
    boards([(px(x, y, Z=g).x, px(x, y, Z=g).y, yaw) for x, y, yaw in ((18, 42, 30), (24, 36, -40), (-4, 50, 70), (28, 46, 10), (10, 48, -60),
                                                          (-20, 46, 40))],
           seed=8)
    burn(px(2, 36, Z=g + 0.8), 2.4)
    burn(px(-12, 42, Z=g + 0.4), 1.4)


D.run(damaged, destroyed)
