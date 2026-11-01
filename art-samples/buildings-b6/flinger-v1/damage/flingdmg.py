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


def flat_wheel(name, at, r, spokes=8, wide=0.22):
    """A new gold wheel lying flat on the ground at `at` (built in a level plane, so nothing of the old upright
    wheel's turn is left in it)."""
    keep = G["pul_plane"]
    G["pul_plane"] = lambda: (Vector(), Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0)))
    e = G["pulley"](name, Vector((at[0], at[1], 1.0)), r, M["dgold"], spokes=spokes, wide=wide)
    G["pul_plane"] = keep
    rest(e)
    return e


def points(obs):
    """The world points of obs and their children (curves evaluated with their bevel)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in obs:
        for k in D.kids(o):
            if k.type in ("MESH", "CURVE"):
                ev = k.evaluated_get(dg)
                out += [k.matrix_world @ v.co for v in ev.to_mesh().vertices]
                ev.to_mesh_clear()
    return out


def rest(e):
    """Set a wheel (an empty with its parts) on the ground by its real points: sit() reads the bevelled rings' and
    spokes' boxes too low, which left the look 4 damaged wheel floating 0.7 up."""
    e.location.z += GROUND - min(p.z for p in points([e]))


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
        # the A-frame still stands, as in Flash (its coil is cut where the right leg hides it, so the frame can't move
        # without showing the cut), but its cap, slates and pulley are down and the posts broken
        lay_pulley("pul1", (0.6, -4.4))
        scatter(named(r"aslate.*|acap"), (1.4, -3.9), 0.6, 3)
        kill(named(r"belt|afork"))
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
        if LOOK >= 3:
            wall_hole(r"gable\d+", (-0.3, -B, 6.1), 1.25, (0, -1, 0), 21)
        debris((0.6, -3.4), 8, 1.6, seed=2, mats=mats)
    if LOOK == 2:
        # half collapsed, as Flash: the +X side gave way, so the roof slid down off it (resting on the -X wall top and
        # the +X stubs), the front gable's +X half gone; the back triangle fallen apart onto the ground
        snap(ob("post0"), 0.32)
        snap(ob("post2"), 0.42)
        kill([o for o in named(r"gable\d+|header") if (o.matrix_world @ Vector(o.bound_box[0])).x > -0.2])
        roof = named(r"slate-?\d+-\d+-\d+|roofb-?\d+|rslate\d+|gblock|grod|grodknob")
        eave = Vector((S.RIDGE_X - S.SLOPE[-1][0], 0, S.RIDGE_Z - S.SLOPE[-1][1]))
        turn(roof, eave, (0, 1, 0), 27, move=(-0.35, -0.15, -0.35))
        kill(named(r"ridge|rafterk"))
        ax, az = S.TRUSS_APEX
        r1 = named(r"rafter1")
        turn(r1, Vector((ax, S.TRUSS_Y, az)), (1, 0.3, 0), 70, move=(1.8, 0.8, 0))
        sit(r1)
        # the back post under the seat snapped, so the seat, the tie and the left rafter fell flat behind
        snap(ob("post3"), 0.75)
        scatter(named(r"seat|tie|rafter0"), (3.4, 2.6), 1.0, 13)
        xr = named(r"xrail\d+")
        scatter(xr[:1], (4.3, 1.8), 0.6, 11)
        turn(xr[1:], Vector((2.4, -2.0, S.XRAILS[1])), (1, 0, 0), -20)
        sit(xr[1:])
        debris((3.4, 0.8), 6, 1.4, seed=12, mats=mats)
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
        kill(named(r"wheel|wcrank|wstand"))
        flat_wheel("wheelflat", (5.5, 3.6), S.WHEEL_R)
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
    # the -X slope gone; the +X slope (boards and slates) dropped low, still tilted toward the camera as in Flash: its
    # eave on the ground at the front right, its ridge edge up on a heap of broken planks at the back left
    kill(named(r"slate-1-\d+-\d+|roofb-1\d+"))
    roof = named(r"slate1-\d+-\d+|roofb1\d+")
    turn(roof, Vector((S.RIDGE_X, 0, S.RIDGE_Z)), (0, 1, 0), -16)
    turn(roof, Vector((S.RIDGE_X, 0, S.RIDGE_Z)), (0, 0, 1), 10, move=(-0.8, -0.5, 0))
    sit(roof)
    pts = points(roof)
    x0 = min(p.x for p in pts)
    high = [p for p in pts if p.x < x0 + 0.8]
    zh = min(p.z for p in high)
    y0, y1 = min(p.y for p in high), max(p.y for p in high)
    n = max(2, round(zh / 0.4))
    for k in range(n):                          # the planks the ridge edge rests on, crossed in a heap
        a = random.Random(90 + k)
        box(f"propplank{k}", (0.45, (y1 - y0) * a.uniform(0.6, 0.85), zh / n + 0.02),
            (x0 + 0.45 + a.uniform(-0.15, 0.15), (y0 + y1) / 2 + a.uniform(-0.3, 0.3), k * zh / n), M["plank"],
            rot=(0, 0, a.uniform(-25, 25)), bevel=0.04)
    # wall and post stubs that would poke up through the fallen roof are flattened under it
    cell = {}
    for p in pts:
        k = (round(p.x / 0.5), round(p.y / 0.5))
        cell[k] = min(cell.get(k, 1e9), p.z)
    for o in named(r"(ywall|xwall|bwall|lwall)\d+|post\d"):
        if any(q.z > cell.get((round(q.x / 0.5), round(q.y / 0.5)), 1e9) - 0.05 for q in points([o])):
            kill([o])
    # the gold block on the slab; the pulleys lying about; the big wheel still standing at the back; the drum out;
    # the pot gone (smashed)
    blk = named(r"gblock")
    turn(blk, Vector(S.BLOCK_C), (1, 1, 0), 30, move=(0.6, -1.0, 0))
    sit(blk)
    lay_pulley("pul1", (-3.4, -2.8), tilt=(8, 0, 0))
    lay_pulley("pul2", (2.0, -4.2))
    w = ob("wheel")
    bpy.context.view_layer.update()
    w.matrix_world.translation = Vector((-1.0, 4.8, w.matrix_world.translation.z))   # behind the heap, clear of it
    rest(w)
    drum_out((-3.7, -2.4), 14)
    kill(named(r"bucket|bucketwall|bucketrim|bucketin"))
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
