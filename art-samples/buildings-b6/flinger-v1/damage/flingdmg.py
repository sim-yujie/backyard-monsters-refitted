"""flingdmg.py : the Flinger's damaged looks (one per Flash look: top.1-4.damaged.png) and its one destroyed look
(top.2.destroyed.png, shared by every level) in 3D. The model (../flinger.py) is built as it is, then broken: the same
parts, at the same camera and light, knocked off, tilted, dropped and holed roughly where Flash's damaged pictures
have them (one loose pass, as the owner asked: fewer bigger holes with lighter torn rims, nothing floating); the
destroyed look is the look 4 house in one low, flat heap.

    blender -b --factory-startup -P flingdmg.py -- <look> <prev|still> <damaged|destroyed>      (or: sh run.sh ...)

Flash has no damaged or destroyed animation for the Flinger, so each is one still.
"""
import math
import random
import re
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "flinger.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
px, roof_q, LOOK = G["px"], G["roof_q"], G["LOOK"]
A, B = S.HA, S.HB
R = random.Random(5 + L)


# ------------------------------------------------------------------------------------------------------------ helpers
def named(pat):
    """Unparented objects whose name (without .001) matches the regex pat in full."""
    return [o for o in SC.objects if o.parent is None and re.fullmatch(pat, o.name.split(".")[0])]


def ob(name):
    return bpy.data.objects.get(name)


def turn(obs, pivot, axis, deg, move=(0, 0, 0)):
    """Turn obs deg degrees round the line through pivot along axis (world), then move them."""
    bpy.context.view_layer.update()
    p = Vector(pivot)
    m = Matrix.Translation(p + Vector(move)) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ \
        Matrix.Translation(-p)
    for o in obs:
        o.matrix_world = m @ o.matrix_world


def rock(name, at, r, mat, squash=0.6, seed=0):
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    for v in bm.verts:
        v.co *= 1 + rr.uniform(-0.25, 0.2)
        v.co.z *= squash
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    G["COLL"].objects.link(o)
    o.data.materials.append(mat)
    o.location = at
    return o


def hole(targets, at, r, normal, seed=0):
    """One big ragged hole through targets (boolean cut by a jagged lump flattened along the surface's normal), its
    inside black, with a torn rim of pale splinters standing out round it."""
    c = rock(f"cut{seed}", Vector((0, 0, 0)), r, inside(), squash=1.0, seed=seed)
    c.matrix_world = Matrix.Translation(Vector(at)) @ Vector(normal).to_track_quat("Z", "Y").to_matrix().to_4x4() @ \
        Matrix.Diagonal((1, 1, 0.9, 1))
    c.hide_render = True
    for t in targets:
        m = t.modifiers.new("hole", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.solver = "EXACT"
        m.object = c
    n = Vector(normal).normalized()
    u = n.cross(Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).normalized()
    v = n.cross(u)
    rr = random.Random(seed + 9)
    for k in range(9):                          # splinters bent outward round the rim: pale, freshly torn wood
        a = 2 * math.pi * k / 9 + rr.uniform(-0.2, 0.2)
        p = Vector(at) + (u * math.cos(a) + v * math.sin(a)) * r * 0.92
        d = (u * math.cos(a) + v * math.sin(a)) * 0.35 + n * rr.uniform(0.15, 0.35)
        tube(f"splinter{seed}-{k}", [p - d * 0.2, p + d], 0.07, M["tear"], r_end=0.02)
    burn(at, r + 0.5)
    return c


def lay_pulley(name, at, tilt=(0, 0, 0)):
    """Drop a pulley (its empty and parts) on the ground at `at`, lying on its side."""
    e = ob(name)
    if e is None:
        return
    e.matrix_world = Matrix.Translation(Vector((at[0], at[1], 0.0))) @ \
        Matrix.Rotation(math.radians(tilt[0]), 4, "X") @ Matrix.Rotation(math.radians(tilt[2]), 4, "Z")
    sit([e])
    bpy.context.view_layer.update()
    for k in e.children[:3]:
        print("PROBE lay", name, k.name, k.parent.name, [round(v, 2) for v in k.matrix_world.col[2][:3]],
              [round(v, 2) for v in e.matrix_world.col[2][:3]], k.type)


def tip_bucket(at, yaw, stub=True):
    """The bucket (or pot) knocked off its arm, lying on its side on the ground at `at`; the arm snapped."""
    obs = named(r"bucket|bucketwall|bucketrim|bucketin")
    bpy.context.view_layer.update()
    c = sum((o.matrix_world.translation for o in obs), Vector()) / len(obs)
    c = Vector(S.POT_C if LOOK >= 4 else S.BUCKET_C)
    turn(obs, c, (1, 0, 0), 82)
    turn(obs, c, (0, 0, 1), yaw, move=Vector((at[0], at[1], c.z)) - c)
    sit(obs)
    if stub:                                    # the arm snapped: a short stub left on the hub
        kill(named(r"barm"))
        a0 = Vector(S.HUB) + Vector((0.15, 0, S.HUB_R * 0.4))
        tube("armstub", [a0, a0 + (c - a0) * 0.35], S.POT_ARM_R if LOOK >= 4 else S.ARM_R, M["arm"], verts=16)


def drum_out(at, axle_tilt=12):
    """The drum fallen out of the -Y side onto the ground with its axle, the axle's end resting on the sill."""
    obs = named(r"drum|crank|axle")
    c = Vector(S.DRUM_C)
    turn(obs, c, (0, 1, 0), axle_tilt, move=Vector((at[0], at[1], S.DRUM_R + 0.02)) - c)
    sit(obs)


def scatter(obs, at, spread, seed):
    """Lay obs (slates, planks) flat on the ground round at."""
    r = random.Random(seed)
    for o in obs:
        bpy.context.view_layer.update()
        bb = [o.matrix_world @ Vector(cn) for cn in o.bound_box]
        c = sum(bb, Vector()) / 8
        o.matrix_world = Matrix.Translation(Vector((at[0] + r.uniform(-spread, spread),
                                                    at[1] + r.uniform(-spread, spread), 0.2))) @ \
            Matrix.Rotation(math.radians(r.uniform(0, 180)), 4, "Z") @ \
            Matrix.Rotation(math.radians(r.uniform(-12, 12)), 4, "X") @ Matrix.Translation(-c) @ o.matrix_world
        sit([o])


def roof_hole(s, u, y, r, seed):
    """A hole in roof slope s at (u down the slope, y): the slates there gone (some lie on the ground), the boards
    cut through to the dark inside."""
    p = roof_q(s, u, y, 0.0)
    gone = []
    for o in named(rf"slate{s}-\d+-\d+"):
        bpy.context.view_layer.update()
        bb = [o.matrix_world @ Vector(cn) for cn in o.bound_box]
        c = sum(bb, Vector()) / 8
        if (c - p).length < r * 1.15:
            gone.append(o)
    d, n, ln = G["slope_frame"](s)
    hole(named(rf"roofb{s}\d+"), p, r, n, seed)
    return gone


def wall_hole(pat, at, r, normal, seed):
    hole(named(pat), at, r, normal, seed)


def materials():
    M["tear"] = G["wood"]("tear", (214, 190, 140), (168, 140, 96), axis="Z", dirt=0.05, rings=3.0)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    materials()
    mats = {"plank": M["plank"], "stick": M["post"], "bracket": M["steel"]}
    # every look: the drum out on the ground at the front left, the bucket off its arm at the right, a pulley down
    drum_out((-3.7, -2.6), 10)
    tip_bucket((4.6, 0.6) if LOOK < 4 else (5.2, 0.2), 30)
    if LOOK == 1:
        # the A-frame's right leg snapped low, the cap, slates and pulley down; the left leg leans further; posts broken
        snap(ob("aleg1"), 0.3)
        lay_pulley("pul1", (0.6, -4.4))
        scatter(named(r"aslate.*|acap"), (1.4, -3.9), 0.6, 3)
        kill(named(r"belt|afork"))
        lf = Vector((S.A1_FEET[0], S.A1_Y, 0))
        turn(named(r"aleg0|waxle|wknob|coil\d"), lf, (0, 1, 0), -7)
        snap(ob("post0"), 0.62)
        snap(ob("post2"), 0.55)
        # the stool knocked over
        st = named(r"stool.*")
        turn(st, Vector((*S.STOOL_C, 0)), (1, 1, 0), 80)
        sit(st)
        debris((1.0, -3.0), 7, 1.4, seed=1, mats=mats)
    else:
        # the front pulley (look 2's only one) down at the front; the rope slack (gone)
        lay_pulley("pul2", (0.4, -4.5))
        kill(named(r"gstem2|belt"))
        # a big hole in the -Y gable's planks, torn
        wall_hole(r"gable\d+", (-0.3, -B, 6.1), 1.25, (0, -1, 0), 21)
        debris((0.6, -3.4), 8, 1.6, seed=2, mats=mats)
    if LOOK == 2:
        # the back truss broken: the left rafter down across the tie, the ridge beam fallen onto it; slates gone
        turn(named(r"rafter0"), Vector((-A + 0.35, S.TRUSS_Y, S.TRUSS_Z)), (0, 1, 0), 45)
        kill(named(r"ridge"))
        gone = roof_hole(1, 1.6, -1.3, 1.35, 31)
        scatter(gone[: len(gone) // 2], (3.6, -3.0), 0.9, 5)
        kill(gone[len(gone) // 2:])
        snap(ob("post2"), 0.7)
        kill(named(r"xbrace"))
    if LOOK >= 3:
        # one big hole high in the +X slope (look 3: near the ridge; look 4 too), slates down; the pipe leaning
        gone = roof_hole(1, 0.9, -1.4, 1.35, 41)
        scatter(gone[: len(gone) // 2], (3.8, -3.2), 1.0, 7)
        kill(gone[len(gone) // 2:])
        f = Vector(S.PIPE_FOOT)
        turn(named(r"pipe.*|spring\d"), f, (1, 0, 0), -14)
        kill(named(r"hboard"))
        # a second big hole low in the +X wall's planks
        wall_hole(r"xwall\d+", (A, 0.4, 2.7), 1.1, (1, 0, 0), 43)
    if LOOK >= 4:
        # the big wheel knocked off its stand onto the ground behind, the crank bent; a hole in the -X slope too
        lay_pulley("wheel", (5.6, 3.6), tilt=(12, 0, 0))
        kill(named(r"wcrank|wstand"))
        lay_pulley("pul1", (-4.8, -1.0))
        kill(named(r"gstem1"))


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    materials()
    mats = {"plank": M["plank"], "stick": M["post"], "bracket": M["steel"]}
    # walls down to ragged stubs, posts snapped low, the gold block, stems and the hatch gone into the heap
    for o in named(r"(ywall|gable|xwall|bwall|lwall)\d+"):
        if o.name.startswith("gable"):
            kill([o])
        else:
            snap(o, R.uniform(0.12, 0.3))
    for i in range(4):
        snap(ob(f"post{i}"), R.uniform(0.18, 0.3))
    kill(named(r"header|hframe\d|hshaft|spoon|gstem\d|wstand|wcrank|belt|rslate\d+|bed0|strap|bearing\d"))
    # the -X slope gone; the +X slope (boards and slates) lying low and nearly flat over the stubs
    kill(named(r"slate-1-\d+-\d+|roofb-1\d+"))
    roof = named(r"slate1-\d+-\d+|roofb1\d+")
    turn(roof, Vector((S.RIDGE_X, 0, S.RIDGE_Z)), (0, 1, 0), -33)
    turn(roof, Vector((S.RIDGE_X, 0, S.RIDGE_Z)), (0, 0, 1), 8, move=(-1.2, -0.3, 0))
    sit(roof)
    # the gold block on the slab; the pulleys and the wheel lying about; the pot on its side; the drum out
    blk = named(r"gblock")
    turn(blk, Vector(S.BLOCK_C), (1, 1, 0), 30, move=(0.6, -1.0, 0))
    sit(blk)
    lay_pulley("pul1", (-3.4, -2.8), tilt=(8, 0, 0))
    lay_pulley("pul2", (2.0, -4.2))
    lay_pulley("wheel", (1.0, 3.8), tilt=(14, 0, 0))
    drum_out((-3.7, -2.4), 14)
    tip_bucket((4.6, 1.4), 40, stub=False)
    kill(named(r"pipe.*|spring\d|barm|hub|hubpin"))
    # a loose length of the belt on the ground, slates and planks strewn
    pts = [Vector((-3.0 + 0.5 * k, -3.2 + 0.25 * math.sin(k * 1.3), 0.06)) for k in range(9)]
    tube("beltloose", pts, 0.07, M["belt"], smooth=True)
    for k in range(5):
        a = random.Random(70 + k)
        box(f"chipslate{k}", (0.9, 0.95, 0.12), (a.uniform(-4, 4), a.uniform(-4.5, -2.5), 0.07), M["slate"],
            rot=(a.uniform(-6, 6), a.uniform(-6, 6), a.uniform(0, 90)), bevel=0.03, origin="center")
    debris((0.5, -3.3), 10, 2.0, seed=3, mats=mats)
    debris((3.5, -1.0), 6, 1.4, seed=4, mats=mats)


D.run(damaged, destroyed)
