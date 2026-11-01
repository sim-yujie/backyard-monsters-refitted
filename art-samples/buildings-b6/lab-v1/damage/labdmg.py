"""labdmg.py : the Monster Lab's damaged and destroyed looks in 3D, after Flash's top.1.damaged.png and
top.1.destroyed.png (one look for every level). The model (../lab.py) is built as it is, then broken: the lower walls
crushed and holed so the whole upper tier drops and leans forward, the gold cogs pressed down, the pipes knocked askew, the
bells tipped; the destroyed look is the same parts in one low burnt heap inside the building's square, the dome on top.

    blender -b --factory-startup -P labdmg.py -- 1 <prev|still> <damaged|destroyed>      (run.sh <prev|still> <state>)

Flash has no damaged or destroyed animation for the Lab, so each look is one still (the steam stays still too).
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Quaternion, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "lab.py")
from dmgcore import *  # noqa: E402,F401,F403
uv, mir, xy, grow, prism = G["uv"], G["mir"], G["xy"], G["grow"], G["prism"]
LW, LD, UW = G["LW"], G["LD"], G["UW"]
LW_Z, LD_Z1 = G["LW_Z"], G["LD_Z1"]
R = random.Random(5)

LOWER = ("lwall", "lpost", "lskirt", "lband", "lbeam", "lrivet", "lbolt", "ldoor", "lstrip", "coil", "sdoor", "steam", "inner")
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


U_DIR = Vector((1.0, 1.0, 0.0)).normalized()     # screen-plan u (across) and v (toward the viewer) as world directions
V_DIR = Vector((1.0, -1.0, 0.0)).normalized()


def crack(o, normal, d, jag=0.22, seed=0, cap=True, cuts=14):
    """Break o in two along the world plane normal . p = d, the crack line jagged (the same zigzag on both halves);
    returns (back, front), front on the side the normal points to. Each half is closed over its broken face."""
    o = D.bake(o)
    normal = Vector(normal).normalized()
    tan = normal.cross(Vector((0, 0, 1))).normalized()

    def off(w):
        t = w.dot(tan)
        return jag * (0.6 * math.sin(2.3 * t + seed) + 0.4 * math.sin(5.9 * t + 2.1 * seed))
    out = []
    for front in (False, True):
        c = o.copy()
        c.data = o.data.copy()
        G["COLL"].objects.link(c)
        mw = c.matrix_world.copy()
        inv = mw.inverted()
        bm = bmesh.new()
        bm.from_mesh(c.data)
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-4,
                                     plane_co=inv @ (normal * d),
                                     plane_no=(mw.to_3x3().transposed() @ normal).normalized(),
                                     clear_outer=not front, clear_inner=front)
        cut = [g for g in res["geom_cut"] if isinstance(g, bmesh.types.BMEdge)]
        if cap and cut:
            bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        if jag and cut:
            bmesh.ops.subdivide_edges(bm, edges=cut, cuts=cuts)
            for v in bm.verts:
                w = mw @ v.co
                if abs(w.dot(normal) - d) < 1e-3:
                    v.co = inv @ (w + normal * off(w))
        bm.normal_update()
        bm.to_mesh(c.data)
        bm.free()
        c.name = o.name.split("-")[0] + ("-front" if front else "-back")
        out.append(c)
    bpy.data.objects.remove(o, do_unlink=True)
    return out


def fold(obs, pivot, axis, deg):
    """Turn obs deg degrees round the world line through pivot along axis (an empty takes them as children)."""
    bpy.context.view_layer.update()
    e = bpy.data.objects.new("fold", None)
    G["COLL"].objects.link(e)
    e.location = pivot
    bpy.context.view_layer.update()
    for o in obs:
        mw = o.matrix_world.copy()
        o.parent = e
        o.matrix_world = mw
    e.rotation_mode = "QUATERNION"
    e.rotation_quaternion = Quaternion(Vector(axis).normalized(), math.radians(deg))
    bpy.context.view_layer.update()
    return e


def bounds(obs):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in obs:
        for k in D.kids(o):
            if k.type in ("MESH", "CURVE"):
                ev = k.evaluated_get(dg)
                for c in ev.bound_box:
                    w = k.matrix_world @ Vector(c)
                    lo = Vector(map(min, lo, w))
                    hi = Vector(map(max, hi, w))
    return lo, hi


def crack_line(o, normal, d):
    """The middle of o's points on its crack (the plane normal . p = d, give or take the zigzag), at their lowest."""
    mw = o.matrix_world
    ps = [mw @ v.co for v in o.data.vertices]
    ps = [p for p in ps if abs(p.dot(normal) - d) < 0.4]
    m = sum(ps, Vector()) / len(ps)
    m.z = min(p.z for p in ps)
    return m


def heap_z(x, y, skip=()):
    """The heap's top under world (x, y): a ray straight down, the objects in skip hidden."""
    for o in skip:                         # out of the way while the ray looks (hiding them does not)
        o.location.z += 1000.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    hit, loc, *_ = SC.ray_cast(dg, Vector((x, y, 40.0)), Vector((0, 0, -1)))
    for o in skip:
        o.location.z -= 1000.0
    bpy.context.view_layer.update()
    return max(GROUND, loc.z) if hit else GROUND


def rest(obs, sink=0.12):
    """Drop obs straight down until they first touch the heap (or the ground), then sink them a little into it: a ray
    down through each of their lower points finds the heap under it, and they fall by the smallest gap."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in obs:
        for k in D.kids(o):
            if k.type == "MESH":
                me = k.evaluated_get(dg).to_mesh()
                pts += [k.matrix_world @ v.co for v in me.vertices]
                k.evaluated_get(dg).to_mesh_clear()
    pts.sort(key=lambda p: p.z)
    lo = pts[0].z
    pts = [p for p in pts if p.z < lo + 1.5][::max(1, len(pts) // 400)]
    for o in obs:
        o.location.z += 1000.0
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    gap = 1e9
    for p in pts:
        hit, loc, *_ = SC.ray_cast(dg, Vector((p.x, p.y, 60.0)), Vector((0, 0, -1)))   # parked parts are higher
        gap = min(gap, p.z - (max(GROUND, loc.z) if hit else GROUND))
    for o in obs:
        o.location.z -= 1000.0 + gap + sink
    if os.environ.get("PB_DBG"):
        print("DBG rest %s gap %.2f lowest now %.2f" % (D.kids(obs[0])[-1].name, gap, D.lowest(obs)))


def place(obs, u, v, rot, sink=0.12):
    """Turn obs (degrees XYZ) round their middle, move them over plan point (u, v) and rest them on the heap."""
    lo, hi = bounds(obs)
    c = (lo + hi) / 2
    x, y = uv(u, v)
    e = D.hinge(obs, c, rot=rot, move=(x - c.x, y - c.y, 0.0))
    rest([e], sink)
    return e


def floatcheck():
    """Every part must rest on the ground or touch a part that does (touch: meshes overlap or come within 3 cm)."""
    tr = G["trees"]()
    obs = [(o, t, vs) for o, t, vs in tr.values() if vs]
    box_ = {}
    for o, t, vs in obs:
        box_[o.name] = (Vector(map(min, *vs)) if len(vs) > 1 else vs[0], Vector(map(max, *vs)) if len(vs) > 1 else vs[0])
    on = {o.name for o, t, vs in obs if min(v.z for v in vs) < GROUND + 0.05}
    adj = {o.name: set() for o, _, _ in obs}
    for i, (a, ta, va) in enumerate(obs):
        la, ha = box_[a.name]
        for b, tb, vb in obs[i + 1:]:
            lb, hb = box_[b.name]
            if any(la[k] > hb[k] + 0.03 or lb[k] > ha[k] + 0.03 for k in range(3)):
                continue
            touch = bool(ta.overlap(tb))
            if not touch:
                for v in vb[::2]:
                    if ta.find_nearest(v, 0.03)[0] is not None:
                        touch = True
                        break
            if touch:
                adj[a.name].add(b.name)
                adj[b.name].add(a.name)
    seen, todo = set(on), list(on)
    while todo:
        n = todo.pop()
        for m in adj[n] - seen:
            seen.add(m)
            todo.append(m)
    fl = sorted(set(adj) - seen)
    print("FLOAT %d parts not resting on anything: %s" % (len(fl), " ".join(fl[:40])))


def lower_holes():
    """Big ragged holes in the lower walls, clear of the side doors: the front-left and middle faces (along world x),
    the front-right face (along world y)."""
    lw = named("lwall")[0]
    lw = ragged(lw, [(0.3, 0.5, 0.075, 0.36), (0.05, 0.62, 0.035, 0.2), (0.62, 0.42, 0.06, 0.3),
                     (0.42, 0.75, 0.04, 0.16)], ("x", "z"), 1)
    ragged(lw, [(0.67, 0.48, 0.075, 0.36), (0.955, 0.6, 0.035, 0.22), (0.76, 0.85, 0.03, 0.12)], ("y", "z"), 7)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    inner(LW_Z - 0.1)
    lower_holes()
    uw = named("uwall")[0]
    ragged(uw, [(0.16, 0.45, 0.12, 0.34), (0.86, 0.55, 0.12, 0.34), (0.5, 0.3, 0.05, 0.2)], ("y", "z"), 2)
    D.kill([o for o in SC.objects if o.name.startswith(("ustrip-2.6", "ustrip2.6"))])     # blown off over the holes
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
    # the upper deck cracked across its front: the front strip breaks off, its left half folds well down onto the
    # walls and the right half sags (the rivets go with their pieces)
    dv, du = 0.1 / math.sqrt(2), -0.4 / math.sqrt(2)
    deck = next(o for o in SC.objects if o.name.startswith("udeck") and "rivet" not in o.name)
    back, front = crack(deck, V_DIR, dv, seed=1)
    fl, fr = crack(front, U_DIR, du, jag=0.3, seed=2)
    rb, rf = crack(next(o for o in SC.objects if o.name.startswith("udeckrivet")), V_DIR, dv, jag=0, cap=False)
    rl, rr = crack(rf, U_DIR, du, jag=0, cap=False)
    for piece, riv, bell, deg in ((fl, rl, "bellL", 26.0), (fr, rr, "bellR", 14.0)):   # each small bell rides its piece
        fold([piece, riv] + group(bell), crack_line(piece, V_DIR, dv), U_DIR, deg)
    burn(crack_line(fl, V_DIR, dv) + Vector((0, 0, 0.3)), 1.4)
    burn(crack_line(fr, U_DIR, du) + Vector((0, 0, 0.3)), 1.0)
    # the gold cogs pressed down into the ground under the dropped deck (Flash draws them shorter), leaning outward
    for k, s in ((0, 1), (1, -1)):
        c = group(f"coil{k}")
        base = c[0].location.copy()
        base.z = 0.0
        D.hinge(c, base, rot=(s * 9.0, s * -9.0, 0.0), move=(0.0, 0.0, -1.55))
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
    for k, (u, v) in enumerate(((-1.5, 2.6), (1.2, 2.9), (-6.2, 1.6), (6.4, 1.4))):
        x, y = uv(u, v)
        D.debris((x, y), n=5, spread=0.7, kinds=("plank", "stick", "bracket"), seed=k,
                 mats={"plank": M["navy"], "stick": M["brass"], "bracket": M["steel"]})
    rewire()
    char(((uv(-5.0, 1.6)) + (2.0,), 1.3), ((uv(0.0, 1.6)) + (1.4,), 1.4), ((uv(5.5, 1.4)) + (2.4,), 1.2),
         ((uv(-4.6, 1.0)) + (7.0,), 1.1), ((uv(5.0, 1.0)) + (7.6,), 1.0), ((uv(-3.6, 3.0)) + (1.0,), 0.9),
         ((uv(3.6, 3.0)) + (2.0,), 0.8), ((uv(-1.0, 0.0)) + (9.2,), 1.2), ((uv(-3.8, 0.6)) + (10.6,), 0.9),
         ((uv(3.8, 0.6)) + (10.2,), 0.7), ((uv(-0.7, -1.4)) + (12.0,), 0.8))


def rewire():
    """The copper wires again, from where the tipped bells' tops are now."""
    D.kill(group("wire"))
    bpy.context.view_layer.update()
    big, small = G["BIG_BELL"][-1][1] + G["BIG_COIL"] + 0.05, G["SMALL_BELL"][-1][1] + G["SMALL_COIL"] + 0.05
    top = {"bellC": big, "bellL": small, "bellR": small}
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
    """Flash's heap: a low pile in the building's own square of broken deck pieces, navy and steel panels sticking up,
    the dome in the middle, the three bells, both glass pipes, copper wire loops, the gold cogs fallen over in front."""
    G["build"]()
    D.kill(named("steam", "uwall", "uflank", "upost", "pilaster", "ustrip", "uband", "urivet", "ubolt", "wire",
                 "lstrip", "ldoor", "lbolt", "sdoorhole", "sdoorjamb", "sdoorlintel", "udeckrivet", "ldeckrivet", "lbeam"))
    inner(0.9)
    # the lower walls: a ragged stump about a fifth of their height
    lw = named("lwall")[0]
    ragged(lw, [(0.3, 0.95, 0.12, 0.25), (0.6, 0.9, 0.1, 0.2), (0.85, 0.95, 0.08, 0.2)], ("x", "z"), 3)
    for o in named("lwall", "lpost", "lskirt", "lband", "lrivet"):
        o.scale.z *= 0.24
        o.location.z *= 0.24
    # both decks broken into pieces: the lower deck's three sag on the stump, the upper deck's lean in the heap
    s2 = math.sqrt(2)
    ld = next(o for o in SC.objects if o.name == "ldeck")
    ld = ragged(ld, [(0.5, 0.95, 0.2, 0.12), (0.9, 0.3, 0.12, 0.3)], ("x", "y"), 5)
    la, rest_ = crack(ld, U_DIR, -2.8 / s2, seed=3)
    lm, lr = crack(rest_, U_DIR, 3.2 / s2, seed=4)
    lmb, lmf = crack(lm, V_DIR, 0.4 / s2, seed=8)                     # the middle caved in, in a V
    ud = next(o for o in SC.objects if o.name == "udeck")
    ud = ragged(ud, [(0.1, 0.4, 0.15, 0.4)], ("x", "y"), 6)
    ub, uf = crack(ud, V_DIR, -1.6 / s2, seed=5)
    ubl, ubr = crack(ub, U_DIR, 0.4 / s2, seed=6)
    ufl, ufr = crack(uf, U_DIR, -1.0 / s2, seed=7)
    # everything still to be placed is parked high up first, so the heap is built from the ground up (place() and
    # rest() only look at what is already down)
    loose = [lmb, lmf, la, lr, ubl, ubr, ufl, ufr] + [o for n in ("dome", "bellC", "bellL", "bellR", "pipe", "plinth", "coil")
                                                  for o in group(n) if o.parent is None]
    for o in loose:
        o.location.z += 1000.0
    # built from the bottom up: the lower deck's pieces on the stump, the gold cogs lying in front, the dome in the
    # middle, the upper deck's pieces tipped round it, the bells, the pipes, the plinth, the panels
    for o, u, v, rot in ((lmb, 0.0, -2.2, (11.0, 11.0, 2.0)), (lmf, 0.2, 2.0, (-12.0, -12.0, -3.0)),
                         (la, -5.4, 0.2, (16.0, -20.0, 8.0)), (lr, 5.6, 0.0, (-18.0, 16.0, -5.0))):
        place([o], u, v, rot, sink=0.05)
    for k, (u, v, yaw) in enumerate(((-3.0, 3.3, 20.0), (4.0, 3.3, -20.0))):
        c = group(f"coil{k}")                          # each cog fallen over, nearly flat, its teeth up
        a = c[0].matrix_world.col[2].xyz.normalized()
        q = Quaternion((0.0, 0.0, 1.0), math.radians(yaw)) @ Quaternion(Vector((0.0, 0.0, 1.0)).cross(a), math.radians(-76.0))
        place(c, u, v, [math.degrees(x) for x in q.to_euler("XYZ")], sink=0.1)
    place(group("dome"), 0.4, 0.4, (8.0, -6.0, 0.0), sink=0.5)           # the dome low in the middle of the heap
    for o, u, v, rot in ((ubl, -3.8, -3.6, (24.0, 6.0, 15.0)), (ubr, 3.8, -3.8, (-6.0, -26.0, -12.0)),
                         (ufl, -5.4, 0.0, (-16.0, 14.0, 25.0)), (ufr, 4.4, 0.4, (14.0, 18.0, -15.0))):
        place([o], u, v, rot, sink=0.3)
    # the bells: the big one on its side on the heap's left, the small ones tipped over in front and on the right
    for name, (u, v), rot in (("bellC", (-4.0, -0.6), (0.0, 80.0, 30.0)), ("bellL", (-2.6, 2.4), (62.0, 10.0, 0.0)),
                              ("bellR", (3.6, -0.2), (0.0, -70.0, -20.0))):
        place(group(name), u, v, rot, sink=0.35)
    # the glass pipes broken loose on the heap's sides, the plinth thrown down
    for k, (u, v, rot) in enumerate(((-6.2, 1.4, (80.0, 10.0, 10.0)), (5.8, 1.4, (-75.0, 20.0, 40.0)))):
        place(group(f"pipe{k}") + group(f"pipecollar{k}") + group(f"pipeflange{k}"), u, v, rot, sink=0.25)
    place(group("plinth"), 1.8, -1.4, (18.0, -8.0, 15.0), sink=0.2)
    # navy wall panels and grey steel plates broken off, sticking up out of the heap at all angles
    for k, (u, v, yaw, tilt, mat) in enumerate((
            (-7.0, 0.4, 30, 52, "navy"), (6.6, -0.4, -55, 48, "navy"), (-2.0, -2.6, 80, 58, "navy"),
            (2.4, -3.2, 10, 54, "navy"), (-5.2, -2.8, -30, 60, "navy"), (-7.6, 1.4, 65, 42, "steel"),
            (1.4, -2.6, -40, 48, "steel"), (7.4, 1.0, -10, 50, "navy"))):
        x, y = uv(u, v)
        o = box(f"panel{k}", (1.7 + 0.3 * (k % 2), 0.12, 1.4), (x, y, 0.0), M[mat], rot=(tilt, 0, yaw), bevel=0.03,
                jitter=0.03)
        rest([o], 0.35)
    # copper wire torn loose, looping over the heap (every point laid on the heap's top)
    for k in range(3):
        pts = []
        cu, cv = R.uniform(-5.0, 5.0), R.uniform(-1.5, 2.2)               # a short tangled loop round one spot
        for j in range(5):
            a = 2.4 * j + k
            x, y = uv(cu + 1.3 * math.cos(a), cv + 0.9 * math.sin(a))
            pts.append(Vector((x, y, heap_z(x, y) + (0.0 if j in (0, 4) else R.uniform(0.15, 0.5)))))
        tube(f"wireloose{k}", [tuple(p) for p in pts], 0.06, M["copper"], verts=8, smooth=True)
    for k, (u, v) in enumerate(((-2.0, 2.8), (2.4, 2.9), (-7.6, 0.9), (0.4, 3.2), (7.4, 0.4))):
        x, y = uv(u, v)
        D.debris((x, y), n=4, spread=0.7, kinds=("plank", "stick", "bracket"), seed=10 + k,
                 mats={"plank": M["navy"], "stick": M["copper"], "bracket": M["steel"]})
    # charred all over: the deck pieces, the panels, and the metal (bells, columns, pipes) too
    char(((0.0, 0.0, 1.0), 2.4), (tuple(uv(-3.2, 1.2)) + (1.0,), 1.4), (tuple(uv(-3.3, 3.0)) + (0.4,), 1.2),
         (tuple(uv(4.4, 3.0)) + (0.4,), 1.2), (tuple(uv(6.6, 0.0)) + (0.6,), 1.0), (tuple(uv(-7.0, -0.6)) + (0.6,), 1.0),
         (tuple(uv(-6.4, 1.8)) + (0.6,), 1.0), (tuple(uv(5.6, 1.9)) + (0.6,), 1.0), (tuple(uv(1.0, -2.0)) + (2.0,), 1.6),
         (tuple(uv(3.4, 1.6)) + (1.0,), 1.0), (tuple(uv(-3.6, -3.4)) + (1.5,), 1.4), (tuple(uv(3.8, -3.8)) + (1.5,), 1.4))


if D.MODE == "float":                       # build and break, then the floating check instead of a render
    if D.STATE == "damaged":
        G["build"]()
        damaged()
    else:
        destroyed()
    if os.environ.get("PB_DBG"):
        for o in SC.objects:
            if o.type == "MESH" and o.parent is None or o.name.startswith(("ldeck", "panel0", "lwall", "dome")):
                lo, hi = bounds([o])
                print("DBG %s z %.2f..%.2f" % (o.name, lo.z, hi.z))
    floatcheck()
    print("DONE float", D.STATE)
else:
    D.run(damaged, destroyed, soot_amount=(0.3, 0.5))
