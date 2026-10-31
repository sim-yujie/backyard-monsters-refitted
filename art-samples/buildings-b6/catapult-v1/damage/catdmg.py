"""catdmg.py : the Catapult's damaged looks (one per Flash look: top.1-3.damaged.png) and its one destroyed look
(top.3.destroyed.png, shared by every level) in 3D. The model (../catapult.py) is built as it is, then broken: the
same parts, at the same camera and light, knocked off, tipped and holed roughly where Flash's damaged pictures have
them (one loose pass, as the owner asked); the destroyed look is the look 3 catapult fallen into one low heap.

    blender -b --factory-startup -P catdmg.py -- <look> <prev|still|check> <damaged|destroyed>      (or: sh run.sh ...)
    check: no render; FLOAT lines name every piece that neither rests on the ground nor touches a piece that does.

Flash has no damaged or destroyed animation for the Catapult, so each is one still.
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

if D.STATE == "destroyed":              # one destroyed look for every level: Flash's top.3.destroyed.png
    i = sys.argv.index("--") + 1
    sys.argv[i] = "3"
D.load(HERE.parent / "catapult.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
LOOK = G["LOOK"]
FA, FB = S.FA, S.FB
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


def points(obs):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in obs:
        for k in D.kids(o):
            if k.type in ("MESH", "CURVE"):
                ev = k.evaluated_get(dg)
                me = ev.to_mesh()
                out += [ev.matrix_world @ v.co for v in me.vertices]
                ev.to_mesh_clear()
    return out


def centre(obs):
    ps = points(obs)
    return sum(ps, Vector()) / len(ps)


def settle(obs, gap=-0.02):
    """Drop obs straight down until they rest on the ground or on another piece (rays down from their points)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mine = {k.name for o in obs for k in D.kids(o)}
    best = 1e9
    for p in points(obs):
        best = min(best, p.z - GROUND)
        q = p - Vector((0, 0, 1e-3))
        for _ in range(12):
            ok, loc, _, _, hit, _ = SC.ray_cast(dg, q, Vector((0, 0, -1)))
            if not ok or hit.name == "ground":
                break
            if hit.name not in mine:
                best = min(best, p.z - loc.z)
                break
            q = loc - Vector((0, 0, 1e-3))
    for o in obs:
        o.location.z -= best - gap
    return best


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


def hole(targets, at, r, normal, seed=0, stretch=(1.0, 1.0)):
    """One ragged hole through targets (boolean cut by a jagged lump flattened along the surface's normal), its
    inside black, with a torn rim of pale splinters standing out round it and charred wood round that."""
    c = rock(f"cut{seed}", Vector((0, 0, 0)), r, D.inside(), squash=1.0, seed=seed)
    c.matrix_world = Matrix.Translation(Vector(at)) @ Vector(normal).to_track_quat("Z", "Y").to_matrix().to_4x4() @ \
        Matrix.Diagonal((stretch[0], stretch[1], 0.9, 1))
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
    for k in range(8):                          # splinters bent outward round the rim: pale, freshly torn wood
        a = 2 * math.pi * k / 8 + rr.uniform(-0.25, 0.25)
        p = Vector(at) + (u * math.cos(a) * stretch[0] + v * math.sin(a) * stretch[1]) * r * rr.uniform(1.18, 1.3)
        d = (u * math.cos(a) + v * math.sin(a)) * rr.uniform(-0.3, -0.15) + n * rr.uniform(0.1, 0.3)
        tube(f"splinter{seed}-{k}", [p - n * 0.12, p + d], 0.055, M["tear"], r_end=0.015)
    burn(at, r * max(stretch) + 0.45)
    return c


def gear_parts(tag):
    """A gear's pieces: the toothed disc, its inner disc, ring and hub."""
    return named(rf"{re.escape(tag)}(disc|ring|hub)?")


def lay_gear(tag, at, tilt=0.0, yaw=0.0):
    """Lay gear `tag` down at (x, y): its axle (along X) turned upright, tilted by `tilt`, then dropped on whatever
    is under it."""
    obs = gear_parts(tag)
    c = centre(obs)
    turn(obs, c, (0, 1, 0), -90 + tilt, move=Vector((at[0], at[1], c.z + 1.5)) - c)
    turn(obs, Vector((at[0], at[1], c.z + 1.5)), (0, 0, 1), yaw)
    settle(obs)
    for o in obs:
        burn(Vector((0, 0, 0)), 1.2, o)            # charred metal
    return obs


def tip_bucket(deg=42, yaw=0.0, at=None):
    """The bucket knocked over to the left (-X, its rim toward the viewer's upper left, as Flash's), on the ground."""
    obs = named(r"bucket|bin|band|stud")
    c = Vector((*S.BUCKET_C, 0.0))
    turn(obs, c, (0, 1, 0), -deg, move=(0, 0, 0.6))
    turn(obs, c, (0, 0, 1), yaw, move=(Vector((at[0], at[1], 0)) - c) if at else (0, 0, 0))
    settle(obs)
    return obs


def stub_tube(name, p0, p1, keep, r, mat):
    """A round post snapped at the fraction keep: a short piece standing, with a jagged top."""
    p0, p1 = Vector(p0), Vector(p1)
    q = p0 + (p1 - p0) * keep
    t = tube(name, [p0, q], r, mat, verts=12)
    burn(q, 0.6)
    return t, q


def materials():
    M["tear"] = G["wood"]("tear", (214, 190, 140), (168, 140, 96), axis="Z", dirt=0.05, rings=3.0)


def mats():
    return {"plank": M["plankX"] if LOOK >= 2 else M["postX"], "stick": M["paleX"], "bracket": M["steel"]}


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    materials()
    if LOOK == 1:
        # the gear off its axle, lying on the ground beside the strut's foot; the strut gone; the axle's end bent
        # down; the bucket off its lever, tipped over in front; the lever snapped; the front right post broken
        kill(named(r"strut"))
        kill([o for o in named(r"bracket") if centre([o]).x > 3.0])
        lay_gear("gear", (3.3, 1.6), tilt=8, yaw=20)
        ax = named(r"axle")
        turn(ax, Vector((FA, S.AX1_Y, S.AX1_Z)), (0, 1, 0), 14)
        tip_bucket(46, -15)
        kill(named(r"arm"))                         # the snapped lever on the ground in front
        G["beam"]("arm", (-0.5, -2.1, 0.13), (0.9, -0.4, 0.13), 0.26, 0.24, M["paleY"])
        snap(ob("post1-1"), 0.55)
        kill(named(r"fbar"))
        G["box"]("fbar", (FA - 0.2, 0.22, 0.22), (-FA / 2 + 0.1, -(FB - S.POST / 2), S.BAR_Z - 0.35), M["paleX"],
                 bevel=0.04, origin="centre")
        burn((FA - 0.3, -FB + 0.3, 1.7), 0.9)
        burn((-0.6, S.AX1_Y, S.AX1_Z), 0.9)
        debris((1.2, -3.2), 7, 1.2, seed=1, mats=mats())
        return
    # looks 2, 3: the +X gear down on the ground in front at the right, its bow bent over; the bucket tipped; a big
    # hole in the front planks and one in the +X wall; the lever snapped
    lay_gear("gear1", (2.6, -3.1), tilt=6, yaw=30)
    bw = [o for o in named(r"bow|knob") if centre([o]).x > 0]
    base = Vector((S.BOW_X, S.ROD_Y, S.TOP2 + 0.6))
    turn(bw, base, (0, 0, 1), 38)
    turn(bw, base, (1, 0, 0), -18)
    tip_bucket(40, -10)
    kill(named(r"arm"))
    G["beam"]("arm", (1.25, S.ROD_Y, S.ROD_Z - 0.05), (0.9, -2.3, 2.7), 0.24, 0.22, M["paleY"])
    hole(named(r"ywall\d+"), (0.55, -FB + 0.05, 1.55), 0.85, (0, -1, 0), 21, stretch=(1.2, 0.9))
    hole(named(r"xwall1\d+"), (FA - 0.05, 0.9, 2.2), 0.7, (1, 0, 0), 22, stretch=(1.0, 1.25))
    burn((S.GEAR2_X, S.AX2_Y, S.AX2_Z), 1.0)
    burn((-S.BOW_X, S.ROD_Y, S.ROD_Z), 0.8)
    debris((1.6, -3.4), 8, 1.3, seed=2, mats=mats())
    if LOOK == 3:
        # the right post snapped low, so the drum dropped on that side onto the stub; a third hole low in the front
        kill([o for o in named(r"pole") if centre([o]).x > 0])
        (y0, z0), (y1, z1) = S.POST3_FOOT, S.POST3_TOP
        _, q = stub_tube("pole", (1.72, y0, z0 - 0.05), (1.72, y1, z1), 0.42, S.POST3_R, M["poleZ"])
        dr = named(r"drum|drod|groove")
        piv = Vector((-1.72, S.DRUM_Y, S.DRUM_Z))
        ang = math.degrees(math.atan2(S.DRUM_Z - q.z - 0.1, 3.44))
        turn(dr, piv, (0, 1, 0), ang)
        hole(named(r"ywall\d+"), (-1.2, -FB + 0.05, 2.7), 0.6, (0, -1, 0), 23)
        G["tube"]("brokenpole", [Vector((2.3, -2.2, 0.15)), Vector((3.2, -0.5, 0.3))], S.POST3_R * 0.9, M["poleZ"],
                  verts=12)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    materials()
    # the box's walls down to ragged stubs, the front posts snapped, the sloping legs and the back gone
    for o in named(r"(ywall|xwall-?1)\d+"):
        snap(o, R.uniform(0.18, 0.4))
    for o in named(r"post-?1"):
        snap(o, R.uniform(0.25, 0.35))
    kill(named(r"leg-?1|back|rivet|stand|strap|rod2?|arm"))
    for o in named(r"(ywall|xwall-?1)\d+"):          # the planks' feet went with the posts: down on the ground
        o.location.z -= S.FOOT_H
    # the deck dropped onto the stubs, tilted toward the front
    deck = named(r"deck")
    turn(deck, Vector((0, 0, S.TOP2)), (1, 0, 0), -7, move=(0, -0.2, -0.4))
    # the drum fallen back and right onto the heap; the poles broken across it
    dr = named(r"drum|drod|groove")
    turn(dr, Vector((0, S.DRUM_Y, S.DRUM_Z)), (0, 0, 1), 28, move=(0.9, 0.6, 0.0))
    kill(named(r"pole"))
    poles = [[G["tube"]("pole", [Vector(a).lerp(Vector(b), t / 6) for t in range(7)], S.POST3_R, M["poleZ"],
                        verts=12)]          # rings all along it, so settle() feels what its middle lands on
             for a, b in (((-2.0, 0.4, 9.6), (-1.3, 3.9, 8.9)), ((1.1, -1.1, 9.6), (2.7, 1.9, 7.9)))]
    # the +X gear standing in front, leaning on the box; the -X gear lying on the heap; the axle across it; one bow
    # lying across the deck, the other gone
    g1 = gear_parts("gear1")
    c = centre(g1)
    turn(g1, c, (0, 0, 1), -25, move=Vector((1.3, -2.55, 1.35)) - c)
    turn(g1, Vector((1.3, -2.55, 0)), (1, 0, 0), 9)
    D.sit(g1)
    settle(g1)
    for o in g1:
        burn(Vector((0, 0, 0)), 1.2, o)
    ax = named(r"axle|sleeve|collar")
    turn(ax, Vector((0, S.AX2_Y, S.AX2_Z)), (0, 0, 1), -20, move=(0.3, 0.6, 3.0))
    g2 = gear_parts("gear-1")
    c = centre(g2)
    turn(g2, c, (0, 1, 0), -78, move=Vector((-0.7, -0.4, 12.0)) - c)
    turn(g2, Vector((-0.7, -0.4, 12.0)), (0, 0, 1), 40)
    for o in g2:
        burn(Vector((0, 0, 0)), 1.2, o)
    kill([o for o in named(r"bow|knob") if centre([o]).x > 0])
    bw = named(r"bow|knob")
    c = centre(bw)
    turn(bw, c, (0, 1, 0), 70, move=Vector((-0.4, -1.2, 14.0)) - c)
    br = named(r"bracket")
    for k, o in enumerate(br):
        turn([o], centre([o]), (1, 1, 0), 60 + 20 * k, move=Vector((-2.0 + 5.0 * k, -2.4 + 1.2 * k, 16.0)) -
             centre([o]))
    kill(named(r"bucket|bin|band|stud"))     # gone before anything settles, so nothing lands on it
    grps = [deck, dr, ax, g2] + poles + [bw] + [[o] for o in br]
    for k, grp in enumerate(grps):      # first lift each high above the ones before it, so none lands on a later one
        for o in grp:
            o.location.z += 40.0 * (k + 1)
    for grp in grps:                    # then each comes to rest on what is below
        settle(grp)
    # the bucket smashed: its staves in pieces at the front left
    for k in range(6):
        a = random.Random(60 + k)
        p = Vector((-1.2 + a.uniform(-0.9, 0.9), -3.6 + a.uniform(-0.6, 0.6), 0.0))
        o = G["box"](f"stave{k}", (0.42, 0.12, a.uniform(0.9, 1.5)), p, M["bucket"],
                     rot=(a.uniform(70, 88), 0, a.uniform(0, 180)), bevel=0.04, origin="centre")
        D.sit([o])
    o = G["lathe"]("bucketbase", [(0, 0), (0.85, 0), (0.95, 0.35), (0.85, 0.35), (0, 0.22)], (-0.5, -3.3, 0.0),
                   M["bucket"])
    burn((-0.9, -3.4, 0.3), 1.2)
    burn((0.4, 0.4, 1.8), 1.6)
    burn((1.3, -2.5, 1.2), 1.0)
    debris((0.2, -2.8), 10, 1.5, seed=3, mats=mats())
    debris((1.6, 2.0), 6, 1.2, seed=4, mats=mats())


# ------------------------------------------------------------------------------------------------------------ the check
def float_check():
    """Every piece must rest on the ground or touch (through a chain) a piece that does."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    tr = {}
    for o in SC.objects:
        if o.type not in ("MESH", "CURVE") or o.name == "ground" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        vs = [ev.matrix_world @ v.co for v in me.vertices]
        if vs:
            tr[o.name] = (BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs)
        ev.to_mesh_clear()
    names = list(tr)
    on = {n for n in names if min(v.z for v in tr[n][1]) < GROUND + 0.03}
    todo = list(on)
    while todo:
        a = todo.pop()
        ta, va = tr[a]
        for b in names:
            if b in on:
                continue
            tb, vb = tr[b]
            touch = bool(ta.overlap(tb))
            if not touch:
                for v in vb:
                    h = ta.find_nearest(v, 0.03)
                    if h[0] is not None:
                        touch = True
                        break
            if touch:
                on.add(b)
                todo.append(b)
    for n in names:
        if n not in on:
            print("FLOAT", n, "lowest %.2f" % min(v.z for v in tr[n][1]))
    # rubble outside the building's own square (the look 2/3 box with its bucket)
    for n in names:
        xs, ys = [v.x for v in tr[n][1]], [v.y for v in tr[n][1]]
        if min(xs) < -2.8 or max(xs) > 4.6 or min(ys) < -5.0 or max(ys) > 5.0:
            print("OUTSIDE", n, "x %.1f..%.1f y %.1f..%.1f" % (min(xs), max(xs), min(ys), max(ys)))
    print("DONE check", L, D.STATE)


if D.MODE == "check":
    if D.STATE == "damaged":
        G["build"]()
        damaged()
    else:
        destroyed()
    G["setup"](SC)
    float_check()
else:
    D.run(damaged, destroyed)
