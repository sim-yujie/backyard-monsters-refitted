"""hccdmg.py : the Hatchery Control Center's damaged and destroyed looks in 3D, after Flash's one damaged picture and its
one destroyed heap (Flash has one look for every level). The approved model (hcc.py + stack.py,
art/buildings-3d-hcc 953f15b80, copied here unchanged) is built whole, then broken as Flash's damaged picture: the dish
folded in on itself and wrenched up to the right, the pedestal crushed down round the yoke, a big torn hole in the pink
top at the front with its flap bent up, a snapped wire, a brown pipe broken out of the band at the front left, a torn
hole in the band at the right, a big hole low in the gold bowl's front with the bars inside showing, bits on the grass.
Destroyed (Flash's heap): the legs and bowl gone from under the drum, which lies tilted on the grass; the dish lies on
it face up; a piece of the gold bowl shell stands at the front left, a foot and the brown pipe lie by it.

    blender -b --factory-startup -P hccdmg.py -- 1 <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    HCC_PLAIN=1 builds the whole model unbroken (to compare).

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135, the front
bearing -45.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import dmgcore as D  # noqa: E402

D.load(HERE / "hcc.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
PLAIN = os.environ.get("HCC_PLAIN") == "1"
D.CHAR_FLOOR = 0.6
ZB, ZT = S.DRUM_Z0, S.DRUM_Z1
M["pipe"] = G["shiny"]("pipe", (92, 52, 34), rough=0.45, metal=0.3, wear=(120, 74, 46), scale=3, dirt=0.3)
M["innards"] = G["shiny"]("innards", (46, 38, 44), rough=0.6, metal=0.4, wear=(30, 24, 30), scale=3, dirt=0.4)
M["bare"] = G["shiny"]("bare", (226, 222, 214), rough=0.35, metal=0.7, wear=(196, 190, 180), scale=4, dirt=0.2)


# ------------------------------------------------------------------------------------------------------------ helpers
def U(b):
    return Vector((math.cos(math.radians(b)), math.sin(math.radians(b)), 0))


def P(b, d, z):
    return U(b) * d + Vector((0, 0, z))


def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def pre(*prefixes):
    """Unparented objects (not the dmgcore hinges) whose part name starts with one of prefixes."""
    return [o for o in SC.objects if o.parent is None and base(o).startswith(prefixes) and
            not (o.type == "EMPTY" and base(o) == "hinge")]


def mid(obs):
    obs = [k for o in obs for k in kids(o) if k.type in ("MESH", "CURVE")]
    return sum((bbox_w(o) for o in obs), Vector()) / len(obs)


def tip(obs, pivot, bearing, deg, move=(0, 0, 0)):
    """Tip obs over round world point pivot, their top going toward bearing by deg, then move them."""
    k = Vector((0, 0, 1)).cross(U(bearing)).normalized()
    e = Matrix.Rotation(math.radians(deg), 4, k).to_euler()
    return hinge(obs, Vector(pivot), rot=[math.degrees(a) for a in e], move=move)


def rest(e, obs, extra=0.0):
    """Drop (or lift) hinge e so the lowest point of obs (its children) rests on the ground."""
    e.location.z += GROUND + extra - lowest(obs)
    bpy.context.view_layer.update()


def lay(obs, at, rot, extra=0.0):
    """Move a group to lie on the ground at (x, y): turned rot (degrees XYZ) round its middle, resting on it."""
    c = mid(obs)
    e = hinge(obs, c, rot=rot, move=Vector((at[0], at[1], c.z)) - c)
    rest(e, obs, extra)
    return e


def world_mesh(o):
    """Bake o and move its mesh into world space (identity matrix)."""
    o = bake(o)
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    return o


def cut(o, co, no, rag=0.1, seed=0):
    """Cut mesh object o by the plane (co, no), keeping the side no points to; the cut a little ragged."""
    o = world_mesh(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    no = Vector(no).normalized()
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-4,
                                 plane_co=Vector(co), plane_no=no, clear_inner=True)
    for v in res["geom_cut"]:
        if isinstance(v, bmesh.types.BMVert):
            q = v.co
            v.co = q + no * rag * (0.5 + 0.5 * math.sin(4.1 * q.x + 3.3 * q.y + 2.7 * q.z + seed))
    bm.to_mesh(o.data)
    bm.free()
    return o


def fine(o, cuts=2, vertical=0):
    """o baked to world space and cut finer (all edges cuts times; vertical > 0: only the upright edges, that many)."""
    o = world_mesh(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    if vertical:
        es = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.3]
        bmesh.ops.subdivide_edges(bm, edges=es, cuts=vertical)
    else:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    bm.to_mesh(o.data)
    bm.free()
    return o


def crumple(obs, amt=0.1, scale=1.2):
    """Dent obs (already fine world meshes, or baked here) with smooth noise."""
    out = []
    for o in obs:
        if o.type not in ("MESH", "CURVE"):
            continue
        if o.type == "CURVE" or o.modifiers or o.parent is not None:
            o = world_mesh(o)
        mw = o.matrix_world
        iw = mw.inverted().to_3x3()
        for v in o.data.vertices:
            w = mw @ v.co
            v.co += iw @ (noise.noise_vector(w * scale) * amt)
        out.append(o)
    return out


def dent(o, p, r, depth, nrm=None):
    """Push sheet o (a fine world mesh) in round point p: a smooth bowl-shaped dent r across, depth deep, inward
    (toward the axis, or against nrm)."""
    p = Vector(p)
    for v in o.data.vertices:
        d = (v.co - p).length
        if d < r:
            n = Vector(nrm) if nrm is not None else Vector((v.co.x, v.co.y, 0)).normalized()
            v.co -= n * depth * (0.5 + 0.5 * math.cos(math.pi * d / r))


def tear(o, spots, bend=0.4, seed=0, up=False, wall=0.12):
    """Punch a few big ragged holes in sheet o (a fine world mesh): spots (point, radius). The sheet round each hole is
    bent smoothly (bend > 0 out of the sheet, < 0 into the hole, so the hole shows depth) in a few broad petals, and
    the sheet is given a wall so its torn edge shows a thin light bare-metal thickness; a little char at the edge."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = set()
    spots = [(Vector(q[0]), q[1], q[2] if len(q) > 2 else bend) for q in spots]
    for k, (p, rad, bnd) in enumerate(spots):
        ph = rr.uniform(0, 6.3)
        nrm = Vector((0, 0, 1)) if up else Vector((p.x, p.y, 0)).normalized()
        t1 = nrm.cross(Vector((0, 0, 1)))
        t1 = t1.normalized() if t1.length > 1e-4 else Vector((1, 0, 0))
        t2 = nrm.cross(t1)

        def edge(a):
            return rad * (0.82 + 0.16 * math.sin(3 * a + ph) + 0.1 * math.sin(5 * a + 2 * ph) +
                          0.05 * math.sin(11 * a + ph))
        for f in bm.faces:
            d = f.calc_center_median() - p
            if d.length < rad * 1.3 and d.length < edge(math.atan2(d.dot(t2), d.dot(t1))):
                dead.add(f)
        # bend the sheet round the hole: most at the torn edge, easing out to nothing at 2 radii
        for v in bm.verts:
            d = v.co - p
            dp = d - nrm * d.dot(nrm)
            if dp.length > rad * 2.1:
                continue
            a = math.atan2(dp.dot(t2), dp.dot(t1))
            t = max(0.0, min(1.0, (rad * 2.1 - dp.length) / (rad * 2.1 - edge(a))))
            petal = 0.35 + 0.65 * max(0.0, math.sin(2 * a + ph + 1.3))
            v.co += nrm * bnd * petal * t * t + dp.normalized() * abs(bnd) * 0.25 * petal * t * t
        burn(p, rad * 1.15)
    bmesh.ops.delete(bm, geom=list(dead), context="FACES")
    if wall:
        # the sheet's torn edge: a strip turned straight in from the hole's edge, bare light metal
        o.data.materials.append(M["bare"])
        mi = len(o.data.materials) - 1
        edges = [e for e in bm.edges if e.is_boundary and
                 any(((e.verts[0].co + e.verts[1].co) / 2 - p).length < rad * 1.6 for p, rad, _ in spots)]
        if edges:
            res = bmesh.ops.extrude_edge_only(bm, edges=edges)
            for v in [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]:
                nrm = Vector((0, 0, 1)) if up else Vector((v.co.x, v.co.y, 0)).normalized()
                v.co -= nrm * wall
            for f in [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]:
                f.material_index = mi
    bm.to_mesh(o.data)
    bm.free()
    return o



def gearbit(at, r, seed, mat=None):
    """A small gear wheel knocked out onto the grass, lying nearly flat."""
    rr = random.Random(seed)
    g = G["gear"]("gearbit", r, int(10 + r * 14), 0.14, (at[0], at[1], 0.0), mat or M["gold"],
                  [math.radians(a) for a in (rr.uniform(-12, 12), rr.uniform(-12, 12), rr.uniform(0, 90))],
                  tooth=0.16, hole=r * 0.3)
    bpy.context.view_layer.update()
    g.location.z += GROUND - lowest([g])
    return g


def dup(o):
    c = o.copy()
    c.data = o.data.copy()
    G["COLL"].objects.link(c)
    return c


def angd(a, b):
    return abs((a - b + 180) % 360 - 180)


def surf(o, b, z):
    """The point of mesh o (a fine world mesh) on bearing b nearest height z, farthest out from the axis."""
    best, out = None, -1.0
    for v in o.data.vertices:
        c = v.co
        if abs(c.z - z) < 0.25 and angd(math.degrees(math.atan2(c.y, c.x)), b) < 6:
            r = c.xy.length
            if r > out:
                best, out = c.copy(), r
    return best if best is not None else P(b, 3.0, z)


def at_r(o, b, r):
    """The point of mesh o nearest (in plan) to bearing b, distance r from the axis (for the top)."""
    q = P(b, r, 0).xy
    return min((v.co for v in o.data.vertices), key=lambda c: (c.xy - q).length).copy()


def descend(e):
    return [k for k in kids(e) if k.type in ("MESH", "CURVE")]


def fold(obs, c, axis, deg, side, soft=0.6):
    """Bend world meshes obs along the line through c (direction axis): vertices on side of it turn deg degrees
    (eased in over soft)."""
    for o in obs:
        for v in o.data.vertices:
            d = (v.co - c).dot(side)
            if d > 0:
                t = min(1.0, d / soft)
                R = Matrix.Translation(c) @ Matrix.Rotation(math.radians(deg * t), 4, Vector(axis).normalized()) @ \
                    Matrix.Translation(-Vector(c))
                v.co = R @ v.co


def wreck_dish(deg=70, amt=0.18):
    """The dish (and its clamps, hub, rod) baked to world meshes, folded in on itself across the middle (its far half
    bent over toward the face) and dented."""
    e = objs("dish")[0]
    parts = [world_mesh(o) for o in descend(e)]
    kill([e])
    for o in parts:
        o.data.update()
    bowlp = [o for o in parts if base(o).split("-")[0] == "dishbowl"][0]
    c = mid([bowlp])
    # the dish's face direction: from the deepest point to the rim's middle
    n = G["_dish_n"]
    # fold line: across the dish, level with the ground (screen horizontal-ish); the top half folds forward
    up_on_dish = (Vector((0, 0, 1)) - n * n.z).normalized()
    axis = n.cross(up_on_dish).normalized()
    fold(parts, c + up_on_dish * 0.3, axis, -deg * float(os.environ.get("HCC_FS", "1")), up_on_dish)
    crumple(parts, amt, 0.8)
    for o in parts:
        for i, m in enumerate(o.data.materials):
            if m and m.name.startswith("dishback"):
                o.data.materials[i] = M["chrome"]
    return parts


def insides():
    """Dark cores well inside the drum and bowl, so a hole shows the inner wall of the sheet before the black."""
    G["cyl"]("drumdark", S.DRUM_R - 1.1, ZT - ZB - 0.9, (0, 0, ZB + 0.1), M["innards"], verts=48)
    G["lathe"]("bowldark", [(S.BOWL_R - 1.5, ZB), (S.BOWL_R - 1.8, ZB - 1.3), (1.2, ZB - S.BOWL_DEPTH + 0.9),
                            (0.0, ZB - S.BOWL_DEPTH + 0.85)], (0, 0, 0), inside(), verts=48)


def shard(name, at, size, mat, rot, seed):
    """A bent scrap of sheet metal (a crumpled thin box) lying on the grass."""
    o = box(name, size, Vector(at), mat, rot=rot, bevel=0.0, origin="center")
    o = fine(o, cuts=3)
    crumple([o], 0.08, 2.0)
    return o


# ------------------------------------------------------------------------------------------------------------ looks
def dish_normal():
    e = objs("dish")[0]
    bpy.context.view_layer.update()
    return (e.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()


def damaged():
    if PLAIN:
        return
    G["_dish_n"] = dish_normal()
    insides()
    # the pink top: a big hole at the front left with its flap bent up, a smaller one at the right, dents
    top = fine(objs("drumtop")[0], cuts=3)
    dent(top, at_r(top, -150, 2.6), 1.3, 0.35, nrm=(0, 0, 1))
    dent(top, at_r(top, 20, 2.8), 1.0, 0.25, nrm=(0, 0, 1))
    tear(top, [(at_r(top, -78, 1.95), 0.95, -0.85), (at_r(top, 2, 2.2), 0.62, 0.5)], up=True, seed=1, wall=0.1)
    # the band: dented in, a torn hole at the right with its petals out, the brown pipe broken out at the front left
    band = fine(fine(objs("drumband")[0], vertical=12), cuts=1)
    dent(band, surf(band, 18, 4.6), 1.3, 0.3)
    dent(band, surf(band, -125, 4.4), 1.0, 0.22)
    crumple([band], 0.05, 1.2)
    tear(band, [(surf(band, 12, 4.7), 0.8)], bend=0.4, seed=2, wall=0.12)
    for o in objs("drumrimtop", "drumrimbot"):
        crumple([o], 0.06, 1.5)
    h = surf(band, -118, 4.5)
    d = (U(-128) * 2.2 + Vector((0, 0, -0.45))).normalized()
    tube("brokenpipe", [h - d * 0.8, h + d * 1.5], 0.33, M["pipe"], verts=18)
    cyl("brokenpipecap", 0.37, 0.24, h + d * 1.6, M["chrome"],
        rot=(0, math.degrees(math.acos(max(-1, min(1, d.z)))), math.degrees(math.atan2(d.y, d.x))), verts=20)
    burn(h, 0.8)
    # works inside, lit through the top hole: a gear and pipes on the dark core
    hc = at_r(top, -78, 1.9)
    G["gear"]("innergear", 0.75, 16, 0.18, (hc.x, hc.y, ZT - 0.95), M["golddark"], (math.radians(8), 0, 0.3),
              tooth=0.16, hole=0.2)
    tube("innerpipe", [P(-115, 2.1, ZT - 0.75), P(-45, 2.0, ZT - 0.9)], 0.16, M["rod"], verts=12)
    tube("innerpipe", [P(-90, 1.2, ZT - 1.2), P(-70, 2.6, ZT - 0.45)], 0.12, M["golddark"], verts=10)
    # the snapped wire out of the top hole, curling out to the left
    wp = at_r(top, -95, 1.7) + Vector((0, 0, 0.1))
    tube("snapwire", [wp, wp + Vector((-0.6, -0.5, 0.6)), wp + Vector((-1.6, -0.9, 0.9)),
                      wp + Vector((-2.4, -1.0, 0.75))], 0.045, M["wire"], verts=8, smooth=True)
    # the gold bowl: crumpled, a big hole low at the front with the bars inside showing
    bowl = fine(objs("bowl")[0], cuts=4)
    crumple([bowl], 0.12, 0.9)
    hp = surf(bowl, -40, 2.0)
    dent(bowl, hp, 1.6, 0.3)
    tear(bowl, [(hp, 1.15)], bend=-0.35, seed=3, wall=0.12)
    for k in range(4):
        z = hp.z - 0.6 + k * 0.4
        a, b = P(-80, 2.2, z), P(0, 2.2, z)
        tube("innerbar", [a, b], 0.06, M["golddark"], verts=8)
    for k in range(3):
        th = -60 + k * 20
        tube("innerbar", [P(th, 2.3, hp.z - 1.0), P(th, 2.5, hp.z + 0.8)], 0.06, M["golddark"], verts=8)
    # the pedestal crushed down round the yoke, the post bent
    ped = [fine(o, cuts=2) for o in pre("pedestal")]
    for o in ped:
        for v in o.data.vertices:
            v.co.z = ZT + (v.co.z - ZT) * 0.7
    crumple(ped, 0.14, 1.3)
    tear([o for o in ped if base(o).split("-")[0] == "pedestal"][0],
         [(Vector((S.PED_X + 0.5, S.PED_Y - 0.7, ZT + S.PED_H * 0.55)), 0.8)], bend=-0.3, up=True, seed=5, wall=0.08)
    crumple([fine(o, cuts=1) for o in pre("post", "yoke")], 0.08, 1.4)
    G["gear"]("pedgear", 0.38, 12, 0.12, (S.PED_X + 0.45, S.PED_Y - 0.65, ZT + 0.3), M["gold"],
              (math.radians(25), math.radians(-10), 0.4), tooth=0.18, hole=0.1)
    burn(Vector((S.PED_X, S.PED_Y, ZT + 0.6)), 1.0)
    # the dish folded and wrenched up to the right
    parts = wreck_dish(135, 0.14) + [world_mesh(o) for o in objs("disharm")]
    tip(parts, Vector((S.PED_X, S.PED_Y, ZT + S.PED_H)), 30, 10, move=U(-135) * 0.6 + Vector((0, 0, 0.75)))
    # bits on the grass at the front: a gold gear, a brown plank, gold shards
    gearbit(P(-78, 3.6, 0).xy, 0.62, 1)
    gearbit(P(-8, 3.9, 0).xy, 0.42, 2)
    shard("plankbit", P(-40, 4.0, 0.1), (1.5, 0.8, 0.1), M["pipe"], (4, -3, 22), 3)
    shard("goldbit", P(-95, 4.2, 0.06), (0.7, 0.5, 0.06), M["gold"], (-6, 5, 50), 4)
    shard("goldbit", P(-55, 3.4, 0.06), (0.5, 0.35, 0.06), M["gold"], (3, 8, -30), 5)


def destroyed():
    G["build"]()
    G["_dish_n"] = dish_normal()
    kill(pre("pedestal", "post", "yoke", "disharm", "legstrut2", "leggusset2", "leg2"))
    insides()
    kill(objs("bowldark"))
    dish = wreck_dish(10, 0.3)
    # the bowl smashed: its front left quarter stands on the grass at the front left, the rest is gone
    bowl = objs("bowl")[0]
    shell = cut(dup(bowl), P(-110, 0.5, 0), U(-110), rag=0.35, seed=2)
    shell = cut(shell, (0, 0, ZB - 0.25), Vector((0, 0, -1)), rag=0.2, seed=4)
    kill([bowl])
    crumple([shell], 0.16, 1.0)
    burn(mid([shell]), 1.2)
    c = mid([shell])
    e = tip([shell], c, 102, 40, move=P(-92, 4.3, c.z) - c)
    rest(e, [shell], -0.15)
    # the front legs snapped off and lying flat, one at the left, one at the right
    for k, (at, b) in enumerate(((P(-140, 4.3, 0), -160), (P(25, 4.6, 0), 40))):
        kill(pre("leggusset%d" % k, "legstrut%d" % k))
        obs = pre("leg%d" % k)
        c = mid(obs)
        e = tip(obs, Vector((c.x, c.y, 0)), b, 84, move=Vector((at.x, at.y, 0)) - Vector((c.x, c.y, 0)))
        rest(e, obs)
    # the drum down on the grass with its top tipped toward the viewer, its front edge sunk; dented
    for o in objs("drumband"):
        band = fine(fine(o, vertical=8), cuts=1)
        crumple([band], 0.05, 0.8)
        dent(band, surf(band, -20, 4.6), 1.4, 0.4)
        tear(band, [(surf(band, -8, 4.5), 0.7, -0.35), (surf(band, -100, 4.2), 0.55, 0.3)], seed=11, wall=0.12)
    for o in objs("drumtop"):
        top = fine(o, cuts=3)
        tear(top, [(at_r(top, 60, 1.6), 0.8, -0.6)], up=True, seed=12, wall=0.1)
    for o in objs("drumrimtop", "drumrimbot"):
        crumple([o], 0.08, 1.5)
    body = pre("drum", "port", "nubpin")
    e = tip(body, Vector((0, 0, ZB)), -135, 9)
    rest(e, body, -0.5)
    # the dish lies on the drum face up, tipped a little toward the viewer
    bpy.context.view_layer.update()
    n = G["_dish_n"]
    fwd = G["cam_fwd"]()
    want = (Vector((0, 0, 1)) * math.cos(math.radians(22)) -
            Vector((fwd.x, fwd.y, 0)).normalized() * math.sin(math.radians(22))).normalized()
    c = mid(dish)
    e = hinge(dish, c, rot=[math.degrees(a) for a in n.rotation_difference(want).to_euler()],
              move=Vector((-0.6, -0.2, 0)) - Vector((c.x, c.y, 0)))
    bpy.context.view_layer.update()
    e.location.z += top_z_at(body) + 1.35 - mid(dish).z
    # the brown pipe and bits on the grass
    tube("brokenpipe", [P(-82, 4.3, 0.3), P(-92, 6.0, 0.3)], 0.32, M["pipe"], verts=18)
    cyl("brokenpipecap", 0.36, 0.24, P(-92, 6.0, 0.3), M["chrome"], rot=(90, 0, -2), verts=20)
    gearbit(P(-50, 5.2, 0).xy, 0.45, 7)
    shard("goldbit", P(-20, 5.0, 0.06), (0.7, 0.45, 0.06), M["gold"], (-4, 6, 20), 8)
    shard("goldbit", P(55, 4.8, 0.06), (0.5, 0.35, 0.06), M["golddark"], (5, -4, -40), 9)
    shard("plankbit", P(-170, 4.6, 0.1), (1.2, 0.6, 0.1), M["pipe"], (4, -3, 60), 10)
    burn(Vector((0, 0, 1.0)), 2.5)


def top_z_at(obs):
    """The height of the highest point of obs (the tipped drum's top) near the axis."""
    bpy.context.view_layer.update()
    z = -1e9
    for o in obs:
        for k in kids(o):
            if k.type == "MESH" and base(k).startswith("drumtop"):
                for v in k.data.vertices:
                    w = k.matrix_world @ v.co
                    if w.xy.length < 1.5:
                        z = max(z, w.z)
    return z if z > -1e9 else 3.0


D.run(damaged, destroyed, soot_amount=(0.3, 0.45))
