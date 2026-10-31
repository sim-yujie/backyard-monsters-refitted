"""acadmg.py : the Monster Academy's damaged and destroyed looks in 3D, after Flash's top.<level>.damaged.png and
top.1.destroyed.png (Flash uses one destroyed picture at every level). The model (../academy.py) is built as it is,
then broken: torn holes in the dome (a lighter torn rim with depth, the dark inside and gold blocks behind it), a dent
round each hole, the porthole plates wrenched off their seats, fins and ribs broken off and lying on the ground; the
destroyed look is the crushed dome shell lying open on the ground with its gold blocks spilled left and right.

    blender -b --factory-startup -P acadmg.py -- <level> <prev|still> <damaged|destroyed>      (or sh run.sh ...)

Flash has no damaged or destroyed animation for the Academy, so each look is one still (the blocks stand still).
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "academy.py")
from dmgcore import *  # noqa: E402,F401,F403
S, V = G["S"], G["V"]
mesh_ob, lathe_ = G["mesh_ob"], G["lathe"]
R = random.Random(26 + L)
CEN = Vector((0, 0, V.DOME_C))


# ------------------------------------------------------------------------------------------------------------ helpers
def on_dome(th, e, r=None):
    return G["ball"](th, e, r)


def spin_about(obs, pivot, axis, deg):
    """Turn obs (and their children) by deg round the line through pivot along axis (world)."""
    bpy.context.view_layer.update()
    m = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ \
        Matrix.Translation(-Vector(pivot))
    for o in obs:
        o.matrix_world = m @ o.matrix_world
    bpy.context.view_layer.update()


def dent(o, p, r, depth):
    """Push o's surface in round world point p (toward the dome's middle): a crumpled shell."""
    mw, mi = o.matrix_world, o.matrix_world.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        d = (w - p).length
        if d < r:
            f = (1 - d / r) ** 2 * (0.8 + 0.4 * R.random())
            n = (w - CEN).normalized()
            v.co = mi @ (w - n * depth * f)


def torn_holes(o, spots, depth=0.3):
    """Tear ragged holes (x, y, z, r) in the dome shell o: the torn edge turned in as a lighter bare-metal rim with
    depth (Flash's holes show a pale torn edge, not a flat black blotch), the rim jagged."""
    o = D.bake(o)
    for x, y, z, rad in spots:
        dent(o, Vector((x, y, z)), rad * 2.0, 0.35)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw, mi = o.matrix_world, o.matrix_world.inverted()
    dead = []
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        for k, (x, y, z, rad) in enumerate(spots):
            d = c - Vector((x, y, z))
            a = math.atan2(d.z, (d.x + d.y) * 0.7) + k
            if d.length < rad * (0.85 + 0.22 * math.sin(5 * a) + 0.12 * math.sin(11 * a + 1.3)):
                dead.append(f)
                break
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    near = lambda e: any((mw @ e.verts[0].co - Vector(s[:3])).length < s[3] * 1.8 for s in spots)
    bnd = [e for e in bm.edges if e.is_boundary and near(e)]
    ret = bmesh.ops.extrude_edge_only(bm, edges=bnd)
    nv = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    nf = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace)]
    for v in nv:
        w = mw @ v.co
        n = (w - CEN).normalized()
        v.co = mi @ (w - n * depth * R.uniform(0.7, 1.4) + Vector((R.uniform(-1, 1) for _ in range(3))) * 0.05)
    o.data.materials.append(M["rim"])
    for f in nf:
        f.material_index = len(o.data.materials) - 1
    bm.to_mesh(o.data)
    bm.free()
    for x, y, z, rad in spots:
        D.burn((x, y, z), rad + 0.5)
    return o


def ball_mesh(name, r, at, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=r)
    ob = mesh_ob(name, bm, [mat], smooth=True)
    ob.location = at
    return ob


def inside_behind(spots):
    """The dark inside of the dome, and a few gold blocks just inside each hole that catch the light through it."""
    ball_mesh("inner", V.DOME_R - 0.55, CEN, M["pit"])
    for x, y, z, rad in spots:
        p = Vector((x, y, z))
        n = (p - CEN).normalized()
        for i in range(3):
            q = p - n * R.uniform(0.75, 1.1) + Vector((R.uniform(-1, 1), R.uniform(-1, 1), R.uniform(-0.6, 0.2))) * rad * 0.4
            sz = R.uniform(0.45, 0.7)
            box("inblk", (sz, sz * 0.9, sz * 0.8), q, M["blockgold"], rot=(R.uniform(-20, 20), R.uniform(-20, 20),
                R.uniform(0, 90)), origin="center", bevel=0.04)


def ground_bits(at, n, kinds, seed=0, spread=1.0):
    """Bits lying on the ground round at: gold bars, steel plate shards, dark round hole collars."""
    r = random.Random(seed + 10 * L)
    for i in range(n):
        k = kinds[i % len(kinds)]
        p = Vector((at[0] + r.uniform(-spread, spread), at[1] + r.uniform(-spread, spread), GROUND))
        yaw = r.uniform(0, 180)
        if k == "bar":
            ln = r.uniform(0.9, 1.5)
            box("bit", (ln, 0.26, 0.24), p, M["gold"], rot=(0, r.uniform(-4, 4), yaw), bevel=0.05)
        elif k == "shard":
            box("bit", (r.uniform(0.7, 1.2), r.uniform(0.5, 0.9), 0.12), p, M["plate"],
                rot=(r.uniform(-8, 8), r.uniform(-8, 8), yaw), bevel=0.03, jitter=0.07)
        elif k == "disc":
            cyl("bit", r.uniform(0.45, 0.6), 0.1, p, M["seam"], verts=24)
        elif k == "chunk":
            s = r.uniform(0.9, 1.5)
            box("bit", (s, s * r.uniform(0.6, 0.9), s * r.uniform(0.5, 0.8)), p, M["rib"],
                rot=(r.uniform(-10, 10), r.uniform(-10, 10), yaw), bevel=0.06, jitter=0.08)
        elif k == "blk":
            s = r.uniform(0.6, 0.9)
            box("bit", (s, s, s * 0.8), p, M["blockgold"], rot=(r.uniform(-15, 15), r.uniform(-15, 15), yaw),
                bevel=0.05)


def wrench(port, deg, out=0.35):
    """Lever a porthole plate off its seat: turned outward round its inner edge, pulled out a little."""
    mw = port.matrix_world
    x, y, n = mw.col[0].to_3d(), mw.col[1].to_3d(), mw.col[2].to_3d()
    side = 1 if port is ports()[0] else -1
    pivot = mw.translation + x * S.PORT_HALF[0] * side
    spin_about([port], pivot, y, deg * side)
    port.location += n * out


def ports():
    return sorted(D.objs("port"), key=lambda o: o.name)


def ribs_at(th):
    """The rib, its sleeve and plinth at bearing th (each made in the order of V.RIBS)."""
    i = V.RIBS.index(th)
    pick = lambda nm: sorted([o for o in SC.objects if o.parent is None and o.name.split(".")[0] == nm],
                             key=lambda o: o.name)[i]
    return pick("rib"), pick("ribsleeve"), pick("plinth")


# ------------------------------------------------------------------------------------------------------------ the looks
def damaged():
    dome = D.objs("dome")[0]
    if not V.ribbed:
        spots = [tuple(on_dome(12.0, 22.0)) + (1.25,)]
        if L >= 2:
            spots = [tuple(on_dome(20.0, 18.0)) + (1.5,), tuple(on_dome(-150.0, 40.0)) + (1.0,)]
        torn_holes(dome, spots)
        inside_behind(spots)
        p = ports()
        wrench(p[0], 28.0)
        if L >= 2:                       # the right plate torn off, lying on the ground at the front right
            D.kill([p[1]])
            box("bit", (2.8, 2.5, 0.3), Vector((3.6, 3.2, GROUND)), M["plate"], rot=(3, -4, 20), bevel=0.05,
                jitter=0.05)
            cyl("bit", S.PORT_HOLE, 0.08, Vector((3.4, 3.1, 0.3)), M["hole"], verts=32)
            fins = sorted(D.objs("fin"), key=lambda o: o.name)
            spin_about([fins[1]], fins[1].matrix_world.translation, (1, -1, 0), -35)       # bent back
            D.kill([fins[0]])
            box("bit", (1.9, 3.2, 0.3), Vector((-3.0, -5.2, GROUND)), M["plate"], rot=(2, 3, -30), bevel=0.05)
            box("bit", (3.2, 0.28, 0.26), Vector((-2.8, -5.0, 0.3)), M["gold"], rot=(0, 0, 58), bevel=0.05)
            ground_bits((4.6, -1.6), 5, ("bar", "shard", "bar", "disc"), seed=3, spread=1.0)
        ground_bits((-3.2, -4.6), 3, ("bar", "disc", "shard"), seed=1, spread=0.7)
    else:
        spots = [tuple(on_dome(-45.0, 44.0)) + (1.15,), tuple(on_dome(45.0, 40.0)) + (1.0,)]
        torn_holes(dome, spots)
        inside_behind(spots)
        # the front-left rib wrenched outward off the dome, the front-right one broken into chunks on the ground
        rib, sl, pl = ribs_at(-90.0)
        foot = Vector((0, -(S.RIB_OUT + 0.1), S.PLINTH[2]))
        spin_about([rib, sl], foot, (1, 0, 0), 11.0)
        rib, sl, pl = ribs_at(0.0)
        D.kill([rib])
        sl.scale.z = 0.55
        ground_bits((6.3, -1.8), 4, ("chunk", "chunk", "shard", "chunk"), seed=5, spread=1.0)
        box("bit", (S.RIB_W, 0.8, 2.4), Vector((4.0, -3.4, GROUND)), M["rib"], rot=(84, 0, 30), bevel=0.06, jitter=0.06)
        if L >= 4:                       # level 4: the back-right rib snapped too, its top lying behind
            rib, sl, pl = ribs_at(90.0)
            spin_about([rib, sl], Vector((0, S.RIB_OUT + 0.1, S.PLINTH[2])), (1, 0, 0), -9.0)
            ground_bits((-5.6, 4.4), 3, ("chunk", "shard", "chunk"), seed=9, spread=1.0)
        ground_bits((-6.0, -3.4), 3, ("chunk", "bar", "shard"), seed=7, spread=0.9)
        # cracks in the glass
        for th, h in ((-30.0, 0.55), (-75.0, 0.4)):
            p0 = Vector(S.polar(th, V.TANK_R + 0.02, V.BAND_Z1 + 0.05))
            tube("crack", [p0, p0 + Vector((0.25, -0.2, h)), p0 + Vector((0.1, -0.35, h * 1.8))], 0.03, M["seam"],
                 verts=6)


def destroyed():
    """The crushed dome shell lying open and tilted on the ground, its top torn wide, gold blocks spilled to the front
    left and right; a piece of the gold band and the black foot under it. Same heap at every level (Flash's)."""
    sh = Vector((-0.85, 1.13, 0.0)) if V.ribbed else Vector()    # Flash draws levels 3+ 7 px lower: stay put on screen
    Rr = 3.9
    prof = [(Rr * math.cos(math.radians(e)), Rr * math.sin(math.radians(e))) for e in range(-8, 58, 3)]
    shell = lathe_("dome", prof, (0, 0, 0), M["dome"], verts=96)
    inner = lathe_("inner", [(x * 0.95, y * 0.95) for x, y in prof], (0, 0, 0), M["pit"], verts=96)
    for o in (shell, inner):
        o.scale = (1.0, 1.0, 0.5)
        o.rotation_euler = (math.radians(-16), math.radians(10), 0)
        o.location = Vector((0.3, 0.6, 0.55)) + sh
    bpy.context.view_layer.update()
    shell = D.bake(shell)
    inner = D.bake(inner)
    for o in (shell, inner):           # crumple: dents and a torn, jagged top edge
        for p, rad, dp in ((Vector((1.2, -3.0, 1.6)), 2.2, 0.9), (Vector((-2.8, -0.8, 1.8)), 1.8, 0.6),
                           (Vector((2.6, 1.4, 1.9)), 1.6, 0.5)):
            p = p + sh
            mw, mi = o.matrix_world, o.matrix_world.inverted()
            for v in o.data.vertices:
                w = mw @ v.co
                d = (w - p).length
                if d < rad:
                    v.co = mi @ (w - Vector((0, 0, 1)) * dp * (1 - d / rad) ** 2 - (w - p).normalized() * 0.1)
        mw, mi = o.matrix_world, o.matrix_world.inverted()
        zs = [(mw @ v.co).z for v in o.data.vertices]
        top = max(zs)
        for v, z in zip(o.data.vertices, zs):
            if z > top - 0.35:
                v.co = mi @ ((mw @ v.co) + Vector((R.uniform(-0.2, 0.2), R.uniform(-0.2, 0.2), R.uniform(-0.45, 0.1))))
    shell = torn_holes(shell, [tuple(Vector((-1.2, -3.2, 1.1)) + sh) + (1.3,)], depth=0.25)
    # the gold band's arc and the foot, crushed under the shell
    pts = [Vector(S.polar(a, 4.0, 0.25)) + sh for a in range(-170, 10, 10)]
    G["sweep"]("band", pts, (0, 0, 1), 0.5, 0.35, M["gold"])
    cyl("foot", 3.6, 0.3, sh, M["foot"], verts=64)
    # gold blocks spilled to the front left (a long slab) and the front right (a broken zigzag of slabs)
    box("bit", (3.4, 1.1, 0.45), Vector((-1.6, -5.0, GROUND)) + sh, M["blockgold"], rot=(0, 4, -12), bevel=0.06)
    box("bit", (1.6, 1.0, 0.5), Vector((-3.6, -3.9, GROUND)) + sh, M["blockgold"], rot=(6, 0, 30), bevel=0.06)
    box("bit", (2.0, 1.2, 0.55), Vector((3.4, -3.2, GROUND)) + sh, M["blockgold"], rot=(0, -8, 52), bevel=0.06)
    box("bit", (1.7, 1.1, 0.5), Vector((4.4, -1.4, GROUND)) + sh, M["blockgold"], rot=(-6, 4, 105), bevel=0.06)
    box("bit", (1.2, 1.0, 0.8), Vector((2.0, -2.6, 0.3)) + sh, M["blockgold"], rot=(18, 12, 40), bevel=0.06)
    ground_bits((0.4, -3.6) if not V.ribbed else (-0.45, -2.5), 4, ("blk", "shard", "blk", "bar"), seed=13, spread=1.6)


D.run(damaged, destroyed, soot_amount=(0.35, 0.5))
