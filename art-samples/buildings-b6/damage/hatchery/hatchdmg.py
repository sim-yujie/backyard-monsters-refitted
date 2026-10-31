"""hatchdmg.py : the Hatchery's damaged and destroyed looks in 3D, after Flash's damaged picture per level (1, 2, 3) and
its one destroyed heap. The approved model (hatch.py + stack.py, art/buildings-3d-hatchery e74ac2e0c, copied here
unchanged) is built as it is at crank frame 0, then broken as Flash's damaged pictures: the gold base crushed and holed,
the drum dented and holed, the U-pipe snapped, small gears knocked out onto the grass; level 1 loses its lid and its
crank is bent up, the funnel knocked off; level 2's front leg buckles so the body leans, a foot and the gauge lie on the
grass, the triangle handle and the crown wheel are bent, the funnel burnt black; level 3's head is wrenched up off the
column, the bowl arm and the funnel lie on the grass, the hood is crumpled. Destroyed (Flash's one heap, built from
level 2): a strip of the drum's ribbed side bent into an arch over a pool of green goo, the black funnel lying in it,
a cross foot, the base's foot ring as a dish with a spring in it, the gantry and the crank's wooden handle sticking up.

    blender -b --factory-startup -P hatchdmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 2. HATCH_PLAIN=1 builds the whole model unbroken (to compare).

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135, the front
bearing -45. Flash has no damaged or destroyed animation for this building, so the cranks stand still.
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

D.load(HERE / "hatch.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
PLAIN = os.environ.get("HATCH_PLAIN") == "1"
D.CHAR_FLOOR = 0.8                                 # burns as dark as Flash's
Z0, ZD = G["Z0"], G["ZD"]
_build = G["build"]


def build():
    _build()
    G["turn"](0)


G["build"] = build


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


def tear(o, spots, lip=0.22, seed=0):
    """Punch ragged holes in sheet o (a fine world mesh): spots (point, radius) of different sizes; round each hole a
    torn lip of the sheet bent out (lighter where the sun catches it), the edge burnt."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = set()
    for k, (p, rad) in enumerate(spots):
        p = Vector(p)
        ph = rr.uniform(0, 6.3)
        for f in bm.faces:
            d = f.calc_center_median() - p
            if d.length > rad * 1.6:
                continue
            n = f.normal
            t1 = n.cross(Vector((0, 0, 1)))
            t1 = t1.normalized() if t1.length > 1e-4 else Vector((1, 0, 0))
            a = math.atan2(d.dot(n.cross(t1)), d.dot(t1))
            if d.length < rad * (0.78 + 0.22 * math.sin(5 * a + ph) + 0.12 * math.sin(11 * a + 2 * ph)):
                dead.add(f)
        burn(p, rad * 1.9 + 0.3)
    bmesh.ops.delete(bm, geom=list(dead), context="FACES")
    edges = [e for e in bm.edges if e.is_boundary]
    hole_edges = []
    for e in edges:
        m = (e.verts[0].co + e.verts[1].co) / 2
        if any((m - Vector(p)).length < rad * 1.4 for p, rad in spots):
            hole_edges.append(e)
    if hole_edges:
        res = bmesh.ops.extrude_edge_only(bm, edges=hole_edges)
        for v in [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]:
            p, rad = min(spots, key=lambda s: (v.co - Vector(s[0])).length)
            out = v.co - Vector(p)
            nrm = Vector((v.co.x, v.co.y, 0)).normalized()          # these sheets face out from the axis
            j = 0.5 + 0.5 * math.sin(7.3 * v.co.x + 5.1 * v.co.y + 3.7 * v.co.z + seed)
            v.co += nrm * lip * (0.4 + j) + out.normalized() * lip * 0.25 * j
    bm.to_mesh(o.data)
    bm.free()
    return o


def gearbit(at, r, seed, mat=None):
    """A small gear wheel knocked out onto the grass, lying nearly flat."""
    rr = random.Random(seed)
    g = G["gear"]("gearbit", r, int(10 + r * 14), 0.14, (at[0], at[1], 0.0), mat or M["steel"],
                  (rr.uniform(-12, 12), rr.uniform(-12, 12), rr.uniform(0, 90)), tooth=0.12, hole=r * 0.3)
    bpy.context.view_layer.update()
    g.location.z += GROUND - lowest([g])
    return g


def char_body():
    """The gold base crushed and holed, the drum dented with two holes; dark insides seen through them."""
    G["cyl"]("drumdark", S.DRUM_R - 0.2, S.DRUM_Z1 - S.DRUM_Z0 - 0.2, (0, 0, Z0 + S.DRUM_Z0 + 0.1), inside(), verts=48)
    G["cyl"]("bodydark", S.BODY_R - 0.35, S.BODY_Z1 - S.FOOT_H - 0.1, (0, 0, Z0 + S.FOOT_H), inside(), verts=48)
    ds = fine(objs("drumside")[0], vertical=26)
    tear(ds, [(P(-78, S.DRUM_R, ZD - 1.1), 1.05), (P(-8, S.DRUM_R, ZD - 1.5), 0.6), (P(-125, S.DRUM_R, ZD - 1.4),
                                                                                         0.75)], lip=0.3, seed=1)
    crumple([ds], 0.06, 1.1)
    bb = fine(objs("basebody")[0], cuts=3)
    spots = [(P(-100, S.BODY_R - 0.1, Z0 + 3.4), 0.85), (P(10, S.BODY_R - 0.15, Z0 + 3.0), 0.5)]
    if L == 2:                                     # the gauge torn out of the body's front
        spots.append((P(S.GAUGE_TH, S.BODY_R - 0.1, Z0 + S.GAUGE_Z), S.GAUGE_R * 1.1))
    tear(bb, spots, lip=0.3, seed=2)
    crumple([bb], 0.32, 0.8)
    crumple([fine(objs("basefoot")[0], cuts=2)], 0.12, 1.0)
    for p_, rad in ((P(-60, S.DRUM_R, ZD - 0.4), 1.4), (P(-150, S.DRUM_R, ZD - 1.2), 1.2), (P(30, S.DRUM_R, ZD), 1.2),
                    (P(-30, 1.8, ZD + 0.1), 1.3), (P(-40, S.BODY_R, Z0 + 2.0), 1.4), (P(-140, S.BODY_R, Z0 + 1.2), 1.2),
                    (P(20, S.BODY_R, Z0 + 1.0), 1.1)):
        burn(p_, rad)


def snap_pipe():
    """The U-pipe snapped below its elbow: the top end still out of the drum, its lower length on the grass."""
    pipe = objs("pipe")[0]
    lo = dup(pipe)
    cut(pipe, (0, 0, Z0 + 4.6), (0, 0, 1), rag=0.15)
    low = cut(lo, (0, 0, Z0 + 3.6), (0, 0, -1), rag=0.15)
    lay([low] + objs("pipesocket"), P(S.PIPE_TH + 15, S.PIPE_OUT + 1.3, 0).xy, (0, 80, 30))
    burn(P(S.PIPE_TH, S.PIPE_OUT, Z0 + 4.6), 0.7)


def dup(o):
    c = o.copy()
    c.data = o.data.copy()
    G["COLL"].objects.link(c)
    return c


def fall_funnel(at, rot):
    fun = pre("funnel")
    lay(fun, at, rot)
    for o in fun:
        burn(mid([o]), 0.9)
    return fun


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    if PLAIN:
        return
    char_body()
    if L == 1:
        # Flash: the lid torn off and the crank bent up toward the back left, the funnel knocked off at the left
        hub = bpy.data.objects["crank1-spin"]
        kill([c for c in hub.children if base(c).startswith(("lidedge", "lidtop", "lidring"))])
        tip([bpy.data.objects["crank1"]], (0, 0, G["ZS"] - 0.3), 82, 40)
        fall_funnel(P(200, 4.6, 0).xy, (85, 0, 20))
    elif L == 2:
        # Flash: the front leg buckled so the body leans forward, its foot torn off, the gauge fallen out onto the
        # grass, the triangle handle and the crown wheel bent, the funnel burnt black and crushed
        foot = pre("legcross0", "legtoe0", "legheel0")
        gauge = bpy.data.objects["gauge"]
        k = Vector((0, 0, 1)).cross(U(S.LEG_TH[0])).normalized()
        piv = P(S.LEG_TH[1], 3.5, 0)
        shift_all(Matrix.Translation(piv) @ Matrix.Rotation(math.radians(7), 4, k) @ Matrix.Translation(-piv),
                  keep=foot + [gauge])
        lay(foot, P(-75, 5.6, 0).xy, (0, 0, 25))
        gauge.matrix_world = Matrix.Translation(P(-40, 5.3, 0.12)) @ Matrix.Rotation(math.radians(-15), 4, "Z")
        for o in objs("funnel"):
            o.data.materials[0] = M["darkmetal"]
        crumple(objs("funnel"), 0.25, 0.9)
        tri = pre("triangle")
        burn(mid(tri), 1.4)
        tip(tri, mid(tri) - Vector((0, 0, 1.8)), 160, 28)
        tip(pre("crank"), mid(pre("crank")), 0, 18)
        tip(pre("gearbox"), mid(pre("gearbox")), -60, 14)
    else:
        # Flash: the head wrenched up off the column, the crank wheel with it; the hood crumpled; the bowl arm torn
        # off onto the grass at the front, the funnel off at the left
        burn(mid(objs("head")), 2.2)
        head = pre("head", "hinge", "wheel3boss", "crank3", "beater")
        tip(head, Vector((S.COLUMN[0], S.COLUMN[1], S.HEAD_Z0)), 80, 18, move=(0, 0, -0.5))
        crumple([fine(o, cuts=2) for o in objs("drumhood")], 0.16, 1.0)
        crumple([fine(o, cuts=2) for o in objs("column")], 0.1, 1.2)
        lay(pre("bowlarm", "bowlclamp"), P(-55, 5.6, 0).xy, (0, 90, -30))
        fall_funnel(P(205, 4.8, 0).xy, (85, 0, 30))
        for p_, rad in ((P(80, 4.9, 6.0), 1.4), (P(-90, 3.0, Z0 + 1.0), 1.4)):
            burn(p_, rad)
    snap_pipe()
    for k, (b, d, r) in enumerate(((-70, 5.0, 0.45), (-20, 5.6, 0.32), (-105, 5.4, 0.36))):
        gearbit(P(b, d, 0).xy, r, k)


# ------------------------------------------------------------------------------------------------------------ destroyed
def goo_pool(c, rx, ry, seed):
    """A pool of green goo on the grass: a low glossy lumpy puddle with a ragged edge."""
    m = G["shiny"]("goo", (88, 196, 40), rough=0.18, metal=0.0, wear=(60, 150, 30), scale=2, dirt=0.1, spec=0.6)
    rr = random.Random(seed)
    ph = [rr.uniform(0, 6.3) for _ in range(3)]
    bm = bmesh.new()
    n, rings = 96, 14
    ctr = bm.verts.new((c[0], c[1], GROUND + 0.22))
    prev = None
    for i in range(1, rings + 1):
        f = i / rings
        row = []
        for j in range(n):
            a = 2 * math.pi * j / n
            e = 1 + 0.16 * math.sin(5 * a + ph[0]) + 0.1 * math.sin(9 * a + ph[1]) + 0.05 * math.sin(17 * a + ph[2])
            x, y = c[0] + rx * f * e * math.cos(a), c[1] + ry * f * e * math.sin(a)
            h = 0.22 * (1 - f ** 3) + 0.08 * noise.noise(Vector((x, y, seed)))
            row.append(bm.verts.new((x, y, GROUND + 0.02 + max(0.0, h))))
        if prev is None:
            for j in range(n):
                bm.faces.new((ctr, row[j], row[(j + 1) % n]))
        else:
            for j in range(n):
                bm.faces.new((prev[j], row[j], row[(j + 1) % n], prev[(j + 1) % n]))
        prev = row
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return G["mesh_ob"]("goopool", bm, [m])


def spring(at, r, h, turns, mat):
    pts = [Vector(at) + Vector((r * math.cos(2 * math.pi * turns * i / 120), r * math.sin(2 * math.pi * turns * i / 120),
                                0.1 + h * i / 120)) for i in range(121)]
    return G["tube"]("spring", pts, 0.07, mat, verts=8)


def destroyed():
    """Flash's one heap (built at level 2), see the top of this file."""
    G["build"]()
    kill(pre("sleeve", "pinion", "framebar", "gearbox", "triangle", "drumtop", "drumrim", "drumbottom", "pipe",
             "gauge", "basebody", "funnelpost", "funnelclamp", "funnelflange", "legboss") + objs("leg0", "leg1", "leg2"))
    goo = goo_pool((0.3, 0.6), 4.6, 3.6, 3).data.materials[0]
    for k, (b, d, r) in enumerate(((20, 3.4, 0.8), (-150, 3.2, 0.7), (100, 3.6, 0.6), (-60, 3.6, 0.5))):
        G["blob_ball"]("gooblob", P(b, d, 0.05), r, goo).scale.z = 0.5
    # the drum's ribbed side: a strip of it torn off, bent into an arch standing across the heap
    ds = objs("drumside")[0]
    z0 = Z0 + S.DRUM_Z0
    ds = cut(ds, (0, 0, z0 + 1.95), (0, 0, -1), rag=0.12)
    ds = cut(ds, (0, 0, z0 + 0.15), (0, 0, 1), rag=0.12)
    ds = cut(ds, (0, 0, 0), (0, 1, 0), rag=0.15)                        # the half at +Y
    ds.data.transform(Matrix.Translation((0, 0, -(z0 + 1.05))))
    ds.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))       # the half ring stood up in the XZ plane
    ds.matrix_world = Matrix.Translation((0.2, 0.5, -0.25)) @ Matrix.Rotation(math.radians(10), 4, "Z")
    crumple([ds], 0.1, 1.0)
    # the base's foot ring cut low: a gold dish on the grass with a spring sprung out of it, at the front
    ft = objs("basefoot")[0]
    ft = cut(ft, (0, 0, Z0 + 0.75), (0, 0, -1), rag=0.1)
    ft.matrix_world = Matrix.Translation((1.4, -2.2, -Z0 * 0.55)) @ Matrix.Scale(0.55, 4)
    spring((1.4, -2.2, 0.0), 0.5, 1.6, 6, M["chrome"])
    G["cyl"]("dishdark", S.FOOT_R * 0.5, 0.05, (1.4, -2.2, 0.08), inside(), verts=32)
    # one cross foot lying at the front left, the black funnel lying in the goo at the right
    foot = pre("legcross1", "legtoe1", "legheel1", "legpin1", "legball1")
    kill(pre("legcross0", "legtoe0", "legheel0", "legpin0", "legball0", "legcross2", "legtoe2", "legheel2", "legpin2",
             "legball2"))
    lay(foot, P(-110, 3.4, 0).xy, (0, 0, 15))
    for o in pre("funnel"):
        if o.type == "MESH":
            o.data.materials[0] = M["darkmetal"]
    fun = crumple(pre("funnel"), 0.12, 1.0)
    lay(fun, P(-5, 2.2, 0).xy, (90, 0, -60))
    # the gantry standing bent at the back left; the drum's purple hood ring and the sleeve gone
    gan = pre("gantry")
    if gan:
        e = tip(gan, mid(gan), 150, 20)
        c, t = mid(gan), P(170, 3.4, 0)
        e.location += Vector((t.x - c.x, t.y - c.y, 0))
        rest(e, gan)
    # the crank's arm with its wooden handle lying at the right end of the arch, the handle sticking up
    cr = pre("crank2")
    kill([o for o in bpy.data.objects if base(o).startswith(("crownaxle", "crownboss"))])
    e = tip(cr, mid(cr), S.WHEEL2_TH, -90)
    c, t = mid(cr), P(40, 4.2, 0)
    e.location += Vector((t.x - c.x, t.y - c.y, 0))
    rest(e, cr)
    kill(pre("drumcollar", "drumhood", "drumholein"))
    for p_, rad in (((0, 0, 0.8), 1.8), ((2.5, 0.5, 0.5), 1.6), ((-2.2, -0.8, 0.5), 1.6), ((1.4, -2.2, 0.4), 1.2),
                    ((-1.0, 2.2, 0.5), 1.4), ((-3.0, 1.0, 0.5), 1.2)):
        burn(Vector(p_), rad)


D.run(damaged, destroyed, soot_amount=(0.4, 0.5))
