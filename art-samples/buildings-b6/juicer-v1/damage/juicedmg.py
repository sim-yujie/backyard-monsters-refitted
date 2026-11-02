"""juicedmg.py : the Monster Juicer's damaged and destroyed looks in 3D, as Flash's top.2.damaged.png and
top.2.destroyed.png (one look for every level). The model (../juicer.py) is built as it is, then broken: the same parts,
at the same camera and light. In Flash the juice of a broken Juicer is green goo, not red.

    damaged   the stone holed and bitten at its step edges, black holes in the front wings; one roller stands on end
              in the pit (rubble fills it up to near the rim), the other stands on end in the front inside corner;
              an end wheel lies on the ground at the right, the gold bar fallen against the left wing, a gold bar
              across the right wing's steps, a brown rod from the pit down the right wing; green goo puddles on the
              ground and the steps; stone chunks round the base
    destroyed a heap of long stone slabs (one stands up at the back left) on a low rubble mound, a big green goo pool,
              a broken roller stub at the left, an end wheel on the ground in front, chunks round it

    PB_FRAME=-64,-14,68,78 blender -b --factory-startup -P juicedmg.py -- 1 <prev|still|check> <damaged|destroyed>
    (run.sh sets the frame: Flash's damaged and destroyed pictures reach past the whole look's frame)
    check: the floating check (every piece rests on the ground or on a piece that does) and the rubble-in-the-square
    check, no render.

Flash has no damaged or destroyed animation for the Juicer, so each look is one still.
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

D.load(HERE.parent / "juicer.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
px, scr, shiny, flat, srgb = G["px"], G["scr"], G["shiny"], G["flat"], G["srgb"]
A, H, DS, DZ, N = S.TOWER_A, S.TOWER_H, S.STEP_D, S.STEP_DZ, S.STEP_N
OUT = A + N * DS                     # the building's square: |x|, |y| up to this
R = random.Random(23)
GOO = []                             # goo blobs: their material is set after the soot (goo stays clean and bright)


# ------------------------------------------------------------------------------------------------------------ helpers
def tread(s):
    """The top of a wing at distance s out from the axis."""
    return G["step_top"](s)


def rock(name, at, r, mat, squash=0.6, seed=0, stretch=1.0):
    """A broken lump of stone: a jagged icosphere (stretch: longer along its local X)."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for v in bm.verts:
        v.co *= 1 + rr.uniform(-0.3, 0.25)
        v.co.z *= squash
        v.co.x *= stretch
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    G["COLL"].objects.link(o)
    o.data.materials.append(mat)
    o.location = at
    o.rotation_euler = (0, 0, rr.uniform(0, 6.3))
    return o


def cutter(name, at, r, mat, seed, squash=1.0, stretch=1.0):
    c = rock(name, at, r, mat, squash=squash, seed=seed, stretch=stretch)
    c.display_type = "WIRE"
    c.hide_render = True
    return c


def cut(target, cutters):
    """Knock all cutters out of target at once (exact boolean; the cut faces take the cutter's material)."""
    col = bpy.data.collections.new("cutters")
    for c in cutters:
        col.objects.link(c)
    m = target.modifiers.new("holes", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.operand_type = "COLLECTION"
    m.collection = col
    m.material_mode = "TRANSFER"


def goo_blob(name, center, r, z, n=28, seed=0, lift=0.03, squash=1.0, rot=0.0):
    """A flat puddle of green goo: a ragged rounded blob lying at height z, a thin domed slab."""
    rr = random.Random(seed)
    ph = [rr.uniform(0, 6.3) for _ in range(3)]
    bm = bmesh.new()
    top, bot = [], []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + 0.22 * math.sin(3 * a + ph[0]) + 0.12 * math.sin(5 * a + ph[1]) + 0.07 * math.sin(9 * a + ph[2])
        x, y = r * k * math.cos(a), r * k * math.sin(a) * squash
        c, s = math.cos(rot), math.sin(rot)
        x, y = c * x - s * y, s * x + c * y
        bot.append(bm.verts.new((x, y, 0.0)))
        top.append(bm.verts.new((x, y, lift)))
    mid = bm.verts.new((0, 0, lift * 1.8))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
        bm.faces.new((top[i], top[j], mid))
    bm.faces.new(list(reversed(bot)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    o = bpy.data.objects.new(name, me)
    G["COLL"].objects.link(o)
    o.data.materials.append(inside())        # (the goo material goes on after the soot)
    o.location = (center[0], center[1], z + 0.004)
    m = o.modifiers.new("sub", "SUBSURF")
    m.levels = m.render_levels = 2
    GOO.append(o)
    return o


def goo_mat():
    return shiny("goo", (96, 214, 52), rough=0.18, metal=0.0, wear=(150, 236, 104), scale=2.5, dirt=0.0, coat=0.7,
                 spec=0.6, ao_min=0.85)


def chunk(name, at, size, mat, seed, rot_z=None):
    """A broken stone block lying on the ground (a jittered bevelled box)."""
    rr = random.Random(seed)
    o = box(name, size, at, mat, rot=(rr.uniform(-6, 6), rr.uniform(-6, 6),
                                      rr.uniform(0, 180) if rot_z is None else rot_z), bevel=0.04, jitter=0.05)
    return o


def world_verts(o):
    """o's evaluated mesh's vertices in the world (empties: none)."""
    if o.type not in ("MESH", "CURVE"):
        return []
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    vs = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return vs


def detach(o):
    bpy.context.view_layer.update()
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw


def stand_roller(e, base, tilt=(0.0, 0.0), turn=0.0):
    """Stand roller empty e on end: its axis (local Z) up, its lower end wheel's face on `base` (a world point), then
    tilted tilt (degrees round world X, Y) about that base."""
    detach(e)
    half = S.ROLL_X + S.FLANGE_T                  # (the axle's stub sinks into what it stands on)
    rot = Matrix.Rotation(math.radians(tilt[1]), 4, "Y") @ Matrix.Rotation(math.radians(tilt[0]), 4, "X") @ \
        Matrix.Rotation(math.radians(turn), 4, "Z")
    e.matrix_world = Matrix.Translation(Vector(base)) @ rot @ Matrix.Translation((0, 0, half))
    return e


def lay_wheel(name, at, tilt=(0.0, 0.0), spin=0.0):
    """A loose end wheel (white, purple ring) lying face up at `at` (its bottom face's centre)."""
    gear_, ring = G["gear"], G["ring"]
    e = G["empty"](name, at, None, rot=(tilt[0], tilt[1], spin))
    ft = S.FLANGE_T
    gear_(name + "fl", S.FLANGE_R, 18, ft, (0, 0, ft / 2), M["flange"], (0, 0, 0), tooth=0.06, parent=e)
    ring(name + "ring", S.FLANGE_R * 0.7, 0.05, M["purple"], parent=e, z=ft - 0.03, n=48)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        box(name + "spoke", (0.34, 0.07, 0.02), (0.3 * math.cos(a), 0.3 * math.sin(a), ft), M["spoke"],
            rot=(0, 0, math.degrees(a)), bevel=0.0, origin="center", parent=e)
    return e


def scr_world(sx, sy, z):
    return px(sx, sy, Z=z)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    kill([bpy.data.objects["juice"]])
    body = bpy.data.objects["body"]
    raw = flat("rawstone", (112, 110, 116), rough=0.9)        # freshly broken stone: duller, darker
    hole = inside()
    cs = []
    # black holes knocked into the front wings' risers (Flash: the front-left wing is holed low down, two big holes)
    for k, (x, y, z, r, sq) in enumerate((
            (-0.9, -3.2, 1.05, 0.95, 0.85), (0.9, -2.65, 2.0, 0.72, 0.9), (-1.4, -3.8, 0.35, 0.7, 0.8),
            (3.2, 1.1, 1.0, 0.8, 0.85), (2.75, -1.2, 2.0, 0.6, 0.9), (1.2, -3.7, 0.5, 0.55, 0.8),
            (3.6, -0.9, 0.5, 0.5, 0.8), (-0.6, -2.55, 2.55, 0.5, 0.9))):
        cs.append(cutter(f"holecut{k}", (x, y, z), r, hole, 300 + k, squash=sq))
        burn((x, y, z), r + 0.7)
    # bites out of the step edges and the rim: broken corners, raw stone inside
    for k, (x, y, z, r) in enumerate((
            (-2.0, -2.25, 3.1, 0.8), (2.1, -1.95, 3.0, 0.7), (-2.2, 1.0, 3.9, 0.6), (1.95, 1.95, 3.9, 0.6),
            (-1.9, -4.1, 0.75, 0.8), (1.7, -4.1, 0.6, 0.6), (4.1, -1.8, 0.7, 0.7), (4.1, 1.6, 0.75, 0.55),
            (-0.4, -2.55, 3.2, 0.5), (3.0, 1.9, 2.4, 0.55), (-2.0, 2.1, 3.2, 0.6), (2.1, -2.0, 1.4, 0.75),
            (-4.1, -1.2, 0.7, 0.6), (-1.4, -2.0, 3.9, 0.55), (-2.0, -3.3, 1.6, 0.7), (-1.9, -2.7, 2.4, 0.6),
            (0.3, -4.1, 0.9, 0.5), (2.0, 0.2, 3.9, 0.45))):
        cs.append(cutter(f"bitecut{k}", (x, y, z), r, raw, 400 + k, squash=0.8, stretch=1.3))
        burn((x, y, z), r + 0.3)
    cut(body, cs)
    # the pit filled with rubble up to 1.9 below the rim (the crusher fell in; the floor broke)
    pf = H - 1.9
    box("pitfill", (2 * S.PIT_B - 0.02, 2 * S.PIT_B - 0.02, pf - S.PIT_FLOOR), (0, 0, S.PIT_FLOOR), M["pit"],
        bevel=0.0)
    for k in range(7):
        a = 2 * math.pi * k / 7
        rock(f"pitlump{k}", (1.0 * math.cos(a), 1.0 * math.sin(a), pf + 0.05), R.uniform(0.3, 0.42), M["pit"],
             squash=0.6, seed=500 + k)
    # the crusher broken up: the bracket gone, both rollers off their axles
    crusher = bpy.data.objects["crusher"]
    r0, r1 = bpy.data.objects["r0"], bpy.data.objects["r1"]
    detach(r0)
    detach(r1)
    kill([crusher])
    # the back roller stands on end in the pit, leaning back left, its top wheel just over the rim (Flash: pink disc
    # in the pit's mouth)
    stand_roller(r1, (-0.2, -0.15, pf), tilt=(-7, -9), turn=20)
    burn((0.0, 0.0, H + 0.3), 0.9)
    # the front roller stands on end in the front inside corner, leaning back against the two front wings
    stand_roller(r0, (2.85, -2.85, 0.0), tilt=(-6, -6), turn=-15)
    burn((2.7, -2.7, 1.2), 1.0)
    burn((2.6, -2.6, 2.3), 0.7)
    # a gold bar in the pit at the right, standing up beside the roller (Flash: gold block right of the pink disc)
    along("goldpit", (0.9, 0.85, pf + 0.1), (0.85, 0.95, H + 0.5), (0.0, 0.55, 0.42), M["gold"], roll=45)
    # the brown rod from the pit's back right corner down over the right wing's steps
    rod = flat("rod", (112, 64, 40), rough=0.6)
    # (it lies on the stair nosings: they run down at DZ / DS; its top end sticks out over the pit)
    k = DZ / DS
    a1 = Vector((A + N * DS - 0.53, 1.45, H - (N * DS - 0.53) * k + 0.09))
    a0 = Vector((A - 0.4, 1.4, H + 0.4 * k + 0.09))
    tube("rodbar", [a0, a1], 0.08, rod, verts=10)
    # the gold bar lying across the right wing (along Y on its second tread) and one fallen against the left wing
    s2 = A + 1.6 * DS
    along("goldright", (s2, -0.9, tread(s2) + 0.12), (s2 + 0.05, 1.85, tread(s2) + 0.12), (0, 0.34, 0.24), M["gold"],
          roll=8)
    along("goldleft", (0.85, -(OUT + 0.08), 0.11), (0.5, -3.62, 1.95), (0, 0.32, 0.22), M["gold"], roll=-20)
    burn((0.6, -3.6, 0.9), 0.8)
    # an end wheel on the ground at the right, lying nearly flat, and a broken flange piece
    lay_wheel("wheelR", (3.4, 3.15, 0.0), tilt=(4, -3), spin=20)
    burn((3.7, 3.0, 0.1), 0.5)
    # green goo: on the ground at the left, the front and the back right, and on the steps
    g = 0.0
    goo_blob("gooL", (-3.1, -3.0), 0.95, g, seed=1, squash=0.7, rot=0.5)
    goo_blob("gooR", (3.0, 2.7), 0.7, g, seed=2, squash=0.7, rot=1.3)
    goo_blob("gooBR", (-0.6, 3.85), 0.55, tread(3.9), seed=4, squash=0.4)
    goo_blob("gooStepL", (-0.7, -(A + 0.6 * DS)), 0.55, tread(A + 0.6 * DS), seed=5, squash=0.45, rot=0.0)
    goo_blob("gooStepL2", (-1.4, -(A + 2.5 * DS)), 0.35, tread(A + 2.5 * DS), seed=6, squash=0.5)
    goo_blob("gooStepR", (A + 0.5 * DS, 1.3), 0.35, tread(A + 0.5 * DS), seed=7, squash=0.45, rot=1.57)
    goo_blob("gooPit", (-0.5, -0.4), 0.9, pf + 0.06, seed=8)
    goo_blob("gooCorner", (3.1, -3.15), 0.95, g, seed=9, squash=0.8)
    # stone chunks round the base (inside the building's square) and on the steps
    st = M["stone"]
    for k, (x, y, sz) in enumerate((
            (-3.6, -2.4, (0.55, 0.4, 0.3)), (-2.6, -3.7, (0.7, 0.35, 0.26)), (3.7, -3.4, (0.5, 0.36, 0.28)),
            (2.4, -3.8, (0.4, 0.3, 0.22)), (3.7, 2.4, (0.55, 0.4, 0.3)), (-3.4, 3.4, (0.6, 0.4, 0.3)),
            (4.0, -2.2, (0.38, 0.3, 0.2)), (-3.9, -3.6, (0.36, 0.28, 0.2)))):
        chunk(f"chunk{k}", (x, y, 0.0), sz, st, 600 + k)
    for k, (x, y) in enumerate(((-1.0, -(A + 3.3 * DS)), (1.6, -(A + 1.3 * DS)), (A + 3.4 * DS, -0.5),
                                (A + 2.4 * DS, 0.6))):
        s = max(abs(x), abs(y))
        chunk(f"stepchunk{k}", (x, y, tread(s)), (0.36, 0.28, 0.2), st, 700 + k)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    kill([bpy.data.objects["juice"]])
    crusher = bpy.data.objects["crusher"]
    r0 = bpy.data.objects["r0"]
    detach(r0)
    kill([crusher, bpy.data.objects["body"]])
    st = M["stone"]
    raw = flat("rawstone", (112, 110, 116), rough=0.9)
    # a low rubble mound under the heap
    for k, (x, y, r) in enumerate(((0.3, 0.8, 1.3), (-0.9, 1.6, 1.0), (1.4, 1.9, 1.0), (0.9, -0.6, 1.0),
                                   (-0.5, -0.4, 0.9), (2.0, 0.4, 0.9), (-1.5, 0.2, 0.8))):
        rock(f"mound{k}", (x, y, 0.0), r, raw, squash=0.45, seed=800 + k)
    # long stone slabs heaped on it (the tower's walls and the steps, broken into lengths)
    slabs = (
        # (x, y, z, length, width, thick, yaw, pitch, roll)
        (-0.2, -1.2, 0.35, 3.6, 0.75, 0.55, 15, 4, 6),       # front, lying, along the front left
        (1.6, -0.5, 0.45, 3.4, 0.7, 0.6, 85, 10, -5),
        (0.9, 1.2, 0.9, 3.8, 0.8, 0.6, 30, -14, 8),
        (-0.6, 0.9, 0.85, 3.2, 0.7, 0.55, -40, 12, -10),
        (2.3, 2.0, 0.6, 3.0, 0.75, 0.55, -5, 18, 4),
        (0.6, 2.6, 1.3, 3.0, 0.7, 0.5, 60, -22, 12),
        (0.2, 0.2, 1.15, 2.6, 0.65, 0.5, -70, 25, 0),
        (-2.0, -0.8, 0.25, 2.4, 0.6, 0.5, 70, 3, 4),
        (3.1, -1.3, 0.25, 2.0, 0.6, 0.45, 20, 5, -3),
    )
    for k, (x, y, z, ln, w, t, yaw, pitch, roll) in enumerate(slabs):
        box(f"slab{k}", (ln, w, t), (x, y, z), st, rot=(roll, pitch, yaw), bevel=0.05, jitter=0.04,
            origin="center")
        burn((x, y, z + 0.3), R.uniform(0.6, 1.0))
    # one slab standing up at the back left, propped in the heap
    box("slabup", (0.7, 0.55, 3.0), (-1.9, 0.9, 0.0), st, rot=(4, -6, 40), bevel=0.05, jitter=0.03)
    # green goo: a big pool spreading out to the left and front, more under the heap's right
    goo_blob("gooPool", (-2.6, -1.1), 1.45, 0.0, seed=11, squash=0.75, rot=-0.4)
    goo_blob("gooFront", (2.4, -2.4), 1.05, 0.0, seed=12, squash=0.6, rot=0.8)
    goo_blob("gooRight", (3.2, 1.6), 0.8, 0.0, seed=13, squash=0.7)
    # a broken roller stub at the left: half a drum, its studs, lying tilted in the goo
    bpy.context.view_layer.update()
    inv = r0.matrix_world.inverted()
    for o in kids(r0)[1:]:                    # keep the drum's -Z half, its studs and the -Z end wheel
        vs = world_verts(o)
        if vs and "drum" not in o.name and (inv @ (sum(vs, Vector()) / len(vs))).z > 0.1:
            bpy.data.objects.remove(o, do_unlink=True)
    drum = next(o for o in kids(r0) if "drum" in o.name)
    drum.scale.z = (S.ROLL_X + 0.1) / (2 * S.ROLL_X)
    r0.matrix_world = Matrix.Translation((-2.85, 0.6, 1.0)) @ Matrix.Rotation(math.radians(-60), 4, "X") @         Matrix.Rotation(math.radians(35), 4, "Y") @ Matrix.Rotation(math.radians(80), 4, "Z")
    bpy.context.view_layer.update()
    r0.location.z -= min(v.z for o in kids(r0) for v in world_verts(o)) - GROUND + 0.02
    burn((-2.85, 0.6, 0.8), 1.0)
    burn((-2.85, 0.6, 1.2), 0.6)
    # an end wheel on the ground at the front left
    lay_wheel("wheelF", (-0.6, -3.6, 0.0), tilt=(3, -2), spin=10)
    burn((-0.9, -3.4, 0.1), 0.5)
    # chunks and broken bits round the heap
    for k, (x, y, sz) in enumerate((
            (2.0, -3.6, (0.6, 0.35, 0.26)), (3.6, -2.6, (0.5, 0.3, 0.24)), (0.6, -3.9, (0.45, 0.3, 0.2)),
            (3.8, 0.0, (0.55, 0.36, 0.26)), (-3.6, -3.2, (0.4, 0.3, 0.2)), (-3.7, 2.8, (0.5, 0.36, 0.26)),
            (2.8, 3.5, (0.42, 0.3, 0.2)), (-1.6, -3.3, (0.35, 0.28, 0.2)))):
        chunk(f"chunk{k}", (x, y, 0.0), sz, st, 900 + k)


# ------------------------------------------------------------------------------------------------------------ checks
def float_check():
    """Every top-level piece (with its children) must rest on the ground or on a piece that does; rubble must stay
    inside the building's square. Prints FLOAT / OUTSIDE lines and a summary."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    groups = {}
    for o in SC.objects:
        if o.type not in ("MESH", "CURVE") or o.name == "ground" or o.hide_render:
            continue
        top = o
        while top.parent is not None:
            top = top.parent
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        vs = [mw @ v.co for v in me.vertices]
        polys = [p.vertices[:] for p in me.polygons]
        ev.to_mesh_clear()
        if not vs:
            continue
        g = groups.setdefault(top.name, {"vs": [], "polys": []})
        off = len(g["vs"])
        g["vs"] += vs
        g["polys"] += [tuple(i + off for i in p) for p in polys]
    trees = {n: BVHTree.FromPolygons(g["vs"], g["polys"]) for n, g in groups.items()}
    low = {n: min(v.z for v in g["vs"]) for n, g in groups.items()}
    held = {n for n in groups if low[n] <= GROUND + 0.04}
    # touching: overlapping triangles, or a vertex within 0.03 of the other's surface
    names = list(groups)
    touch = {n: set() for n in names}
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            ok = bool(trees[a].overlap(trees[b]))
            if not ok:
                ga, gb = groups[a], groups[b]
                for v in ga["vs"][::2]:
                    h = trees[b].find_nearest(v, 0.03)
                    if h[0] is not None:
                        ok = True
                        break
                if not ok:
                    for v in gb["vs"][::2]:
                        h = trees[a].find_nearest(v, 0.03)
                        if h[0] is not None:
                            ok = True
                            break
            if ok:
                touch[a].add(b)
                touch[b].add(a)
    changed = True
    while changed:
        changed = False
        for n in names:
            if n not in held and touch[n] & held:
                held.add(n)
                changed = True
    for n in names:
        if n not in held:
            print("FLOAT", n, "lowest %.3f" % low[n], "touches", sorted(touch[n]))
        mx = max(max(abs(v.x), abs(v.y)) for v in groups[n]["vs"] if v.z < 0.6) if any(
            v.z < 0.6 for v in groups[n]["vs"]) else 0
        if mx > OUT + 0.25:
            print("OUTSIDE", n, "reaches %.2f (square %.2f)" % (mx, OUT))
    print("CHECK pieces %d, floating %d" % (len(names), len(names) - len(held)))


# ------------------------------------------------------------------------------------------------------------ run
_setup = G["setup"]


def setup_goo(sc):
    """(after the soot and the char) the goo gets its own clean glossy green; the stone a little paler, as Flash's
    broken stone."""
    m = goo_mat()
    for o in GOO:
        o.data.materials.clear()
        o.data.materials.append(m)
    return _setup(sc)


G["setup"] = setup_goo

if D.MODE == "check":
    if D.STATE == "damaged":
        G["build"]()
        damaged()
    else:
        destroyed()
    float_check()
    print("DONE check", D.STATE)
else:
    D.run(damaged, destroyed)
