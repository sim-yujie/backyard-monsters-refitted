"""hsdmg.py : Monster Housing's damaged and destroyed looks in 3D, after Flash's one damaged picture and its one destroyed
heap (Flash has one look for all ten levels). The approved model (housing.py, art/buildings-3d-housing 3cbc7b25c, copied
here unchanged) is built whole, then broken as Flash's damaged picture: the pen's rail bent and sagging, dropping to
the grass at the front corner and snapped at the left corner, posts knocked out or leaning; the block of flats
battered: the upper floor and its deck slipped and tilted, the front cube knocked askew, big holes broken into the
walls (a light broken edge round each, dark inside), dents and char, broken bits on the grass. Destroyed (Flash's
heap): the pen is only short pieces of fence lying about; the block's lower floor has collapsed, its upper cubes sit
low on the legs, and the deck lies on the grass at the left with cubes tumbled on and beside it.

    blender -b --factory-startup -P hsdmg.py -- 1 <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    HS_PLAIN=1 builds the whole model unbroken (to compare).

housing.py's own helpers: T(s, t, z) is a point s across (screen right), t toward the camera and z up from the block's
middle; U is toward the camera, V screen right.
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

D.G["L"] = 1                                       # housing.py has no levels (one look)
D.load(HERE / "housing.py")
from dmgcore import *  # noqa: E402,F401,F403
G["build"] = G["build_static"]
PLAIN = os.environ.get("HS_PLAIN") == "1"
D.CHAR_FLOOR = 0.6
T, HU, HV, A = G["T"], G["U"], G["V"], G["A"]
M["broken"] = G["painted"]("broken", (226, 224, 230), rough=0.85, wear=(200, 198, 204), scale=6, dirt=0.25, spec=0.1)
M["innards"] = G["painted"]("innards", (22, 24, 20), rough=0.9, scale=4, dirt=0.0, spec=0.05, ao_min=0.2)


# ------------------------------------------------------------------------------------------------------------ helpers
def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def mid(obs):
    obs = [k for o in obs for k in kids(o) if k.type in ("MESH", "CURVE")]
    return sum((bbox_w(o) for o in obs), Vector()) / len(obs)


def rest(e, obs, extra=0.0):
    e.location.z += GROUND + extra - lowest(obs)
    bpy.context.view_layer.update()


def world_mesh(o):
    o = bake(o)
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    return o


def fine(o, cuts=2):
    o = world_mesh(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    bm.to_mesh(o.data)
    bm.free()
    return o


def crumple(obs, amt=0.1, scale=1.2):
    out = []
    for o in obs:
        if o.type not in ("MESH", "CURVE"):
            continue
        if o.type == "CURVE" or o.modifiers or o.parent is not None:
            o = world_mesh(o)
        for v in o.data.vertices:
            v.co += noise.noise_vector(v.co * scale) * amt
        out.append(o)
    return out


def part(*names):
    """The pieces of the named block parts: the part, its roof slab, its doorway's blob and lip."""
    out = []
    for o in list(SC.objects):
        n = base(o)
        if o.type in ("MESH", "CURVE") and any(
                n == k or n.startswith(k + "roof") or n.startswith(k + "blob") or n.startswith(k + "lip") or
                n == k + "-baked" for k in names):
            out.append(o)
    return out


def bake_doors():
    """Apply every doorway boolean, so the parts can move and break without their cutters."""
    for o in list(SC.objects):
        if o.type == "MESH" and any(m.type == "BOOLEAN" for m in o.modifiers):
            n = o.name
            b = bake(o)
            b.name = n
    kill([o for o in SC.objects if o.name.split(".")[0].endswith("-cut")])


def jag(name, p, n, r, depth, mat, seed):
    """A ragged prism (a cutter) round point p looking along n, r across, reaching depth into the face."""
    rr = random.Random(seed)
    bm = bmesh.new()
    k = 15
    ph = rr.uniform(0, 6.3)
    ring0, ring1 = [], []
    for i in range(k):
        a = 2 * math.pi * i / k
        q = r * (0.72 + 0.18 * math.sin(3 * a + ph) + 0.12 * math.sin(5 * a + 2 * ph) + rr.uniform(-0.08, 0.08))
        x, y = q * math.cos(a), q * math.sin(a)
        ring0.append(bm.verts.new((x, y, 0.3)))
        ring1.append(bm.verts.new((x, y, -depth)))
    bm.faces.new(ring0)
    bm.faces.new(list(reversed(ring1)))
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((ring0[j], ring0[i], ring1[i], ring1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    G["COLL"].objects.link(ob)
    ob.rotation_euler = Vector(n).to_track_quat("Z", "Y").to_euler()
    ob.location = p
    return ob


def punch(ob, p, n, r, seed=0, depth=0.9):
    """Break a big ragged hole into solid part ob at world point p of its face looking along n: a shallow wider cut
    leaves a light broken edge, a deep narrower one goes dark inside, so the hole shows its depth."""
    for k, (rk, dk, mat) in enumerate(((r * 1.35, 0.26, M["broken"]), (r, depth, M["innards"]))):
        c = jag("punch", Vector(p), n, rk, dk, mat, seed + 7 * k)
        mo = ob.modifiers.new("punch", "BOOLEAN")
        mo.object = c
        mo.operation = "DIFFERENCE"
        mo.solver = "EXACT"
        try:
            mo.material_mode = "TRANSFER"
        except (AttributeError, TypeError):
            pass
        nm = ob.name
        ob = bake(ob)
        ob.name = nm
        bpy.data.objects.remove(c, do_unlink=True)
    burn(p, r * 1.4)
    return ob


def chunk(name, at, size, mat, rot, seed):
    """A broken lump of wall (a crumpled small box) lying on the grass."""
    o = box(name, size, Vector(at), mat, rot=rot, bevel=0.02, origin="center", jitter=0.03)
    o = fine(o, cuts=2)
    crumple([o], 0.05, 3.0)
    return o


def densify(pts, step=0.2):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int((b - a).length / step))
        out += [a.lerp(b, i / n) for i in range(1, n + 1)]
    return out


def posts():
    return [o for o in SC.objects if o.parent is None and base(o).startswith("post")]


def lean(o, deg, bearing, sink=0.0):
    """Lean post o (standing on its base point) deg toward bearing, its foot sunk a little."""
    k = Vector((0, 0, 1)).cross(Vector((math.cos(math.radians(bearing)), math.sin(math.radians(bearing)), 0)))
    o.rotation_euler = (Matrix.Rotation(math.radians(deg), 4, k.normalized()) @
                        o.rotation_euler.to_matrix().to_4x4()).to_euler()
    o.location.z -= sink


def bearing_of(v):
    return math.degrees(math.atan2(v.y, v.x))


# ------------------------------------------------------------------------------------------------------------ looks
def bent_rail():
    """The rail round the pen bent: dropping to the grass at the front corner, sagging on the left side, snapped at the
    left corner with both ends hanging down; posts there knocked out or leaning."""
    kill(objs("rail"))
    pts = densify(G["rail_path"]())
    dips = ((Vector((A, -A, 0)), 2.6, 0.95), (Vector((-A, 1.5, 0)), 2.2, 0.45), (Vector((2.0, A, 0)), 1.8, 0.3),
            (Vector((-1.0, -A, 0)), 1.5, 0.35))
    kinks = ((Vector((-A, 1.5, 0)), 1.6, Vector((0.5, 0.0, 0))), (Vector((A, -2.0, 0)), 1.6, Vector((-0.45, 0.2, 0))),
             (Vector((-3.5, A, 0)), 1.2, Vector((0.0, -0.4, 0))))
    out = []
    for p in pts:
        q = p.copy()
        for c, r, d in dips:
            w = math.exp(-((p - c).xy.length / r) ** 2)
            q.z -= d * w
        for c, r, d in kinks:
            q += d * math.exp(-((p - c).xy.length / r) ** 2)
        q.z = max(q.z, 0.08)
        out.append(q)
    # snap it at the left corner: the two ends hang down to the grass
    brk = min(range(len(out)), key=lambda i: (out[i].xy - Vector((-A, -A))).length)
    a, b = out[:brk - 3], out[brk + 3:]
    for seq, rev in ((a, True), (b, False)):
        n = min(8, len(seq))
        for i in range(n):
            j = len(seq) - 1 - i if rev else i
            t = 1 - i / n
            seq[j] = Vector((seq[j].x, seq[j].y, max(0.08, seq[j].z - 0.95 * t * t)))
    G["tube"]("rail", a, G["RAIL_R"], M["rail"], verts=12)
    G["tube"]("rail", b, G["RAIL_R"], M["rail"], verts=12)
    # posts: by the drop at the front corner and the snap at the left corner knocked out, others leaning
    rr = random.Random(3)
    for o in posts():
        p = o.location
        near_front = (p.xy - Vector((A, -A))).length < 2.8
        near_left = (p.xy - Vector((-A, -A))).length < 2.4
        if (near_front or near_left) and rr.random() < 0.6:
            kill([o])
        elif near_front or near_left or rr.random() < 0.3:
            lean(o, rr.uniform(12, 35), rr.uniform(0, 360), 0.05)


def fence_bits():
    """Destroyed: the pen is only short pieces of fence lying about: a pair of posts and their stub of rail."""
    kill(objs("rail"))
    rr = random.Random(6)
    ps = posts()
    by_side = {}
    for o in ps:
        if not base(o).startswith("postgate"):
            by_side.setdefault(base(o)[4:6], []).append(o)
    for side, obs in by_side.items():
        obs.sort(key=lambda o: o.name)
        for i in range(0, len(obs) - 1, 2):
            p0, p1 = obs[i], obs[i + 1]
            if rr.random() < 0.12:
                kill([p0, p1])
                continue
            a, b = p0.location.copy(), p1.location.copy()
            d = (b - a).normalized()
            z = G["RAIL_Z"]
            r = G["tube"]("railbit", [a - d * 0.5 + Vector((0, 0, z)), b + d * 0.5 + Vector((0, 0, z))], G["RAIL_R"],
                          M["rail"], verts=12)
            c = (a + b) / 2
            e = hinge([p0, p1, r], c, rot=(0, 0, 0))
            # each piece knocked over or leaning, shifted and turned a little
            k = Vector((0, 0, 1)).cross(Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), 0))).normalized()
            tilt = rr.uniform(70, 86) if rr.random() < 0.25 else rr.uniform(4, 28)
            e.rotation_euler = (Matrix.Rotation(math.radians(rr.uniform(-25, 25)), 4, "Z") @
                                Matrix.Rotation(math.radians(tilt), 4, k)).to_euler()
            e.location += Vector((rr.uniform(-0.5, 0.5), rr.uniform(-0.5, 0.5), 0))
            rest(e, [p0, p1, r], -0.02)
        if len(obs) % 2:
            kill([obs[-1]])
    kill(objs("postgate0", "postgate1"))


UPPER = ("deck", "endl", "endr", "top-front", "top-back", "top-left", "top-right", "plinth-left", "plinth-right")


def damaged():
    if PLAIN:
        return
    bent_rail()
    bake_doors()
    # big holes broken into the walls, a light broken edge round each and dark inside
    bpy.context.view_layer.update()
    for nm, p, n, r, sd in (("cube-right", T(1.39, 0.26, 2.15) + HU * 0.0, None, 0.7, 1),
                            ("top-right", T(1.7, -0.1, 6.05), HU, 0.55, 2),
                            ("cube-front", T(-0.5, 2.76, 2.35), HU, 0.6, 3),
                            ("endl", T(-2.4, 1.2, 4.9), HU, 0.36, 4),
                            # corners broken off: the top left cube's upper front corner, the front cube's top right
                            ("top-left", T(-2.2, -0.1, 6.75), (HU - HV + Vector((0, 0, 1))).normalized(), 0.75, 5),
                            ("cube-front", T(0.93, 2.76, 2.9), (HU + HV + Vector((0, 0, 1.2))).normalized(), 0.7, 6)):
        obs = [o for o in part(nm) if base(o) == nm]
        if not obs:
            continue
        ob = obs[0]
        mw = ob.matrix_world if ob.parent is None else ob.matrix_world
        if n is None:                                   # the right wing: its face looking to the right
            n = Vector((1, 0, 0))
            p = T(1.39, 0.26, 2.2) + n * (G["WING"] / 2) + Vector((0, -0.45, 0))
        par = ob.parent
        ob = punch(ob, p if par is None else p, n, r, seed=sd)
        if par is not None:
            mw = ob.matrix_world.copy()
            ob.parent = par
            ob.matrix_world = mw
    # the upper floor slipped and tilted toward the front left, dropping a little at that corner
    up = part(*UPPER)
    e = hinge(up, T(2.2, -2.6, 3.9), rot=(0, 0, 0))
    k = HV.cross(Vector((0, 0, 1)))
    e.rotation_euler = (Matrix.Rotation(math.radians(-10), 4, HV) @ Matrix.Rotation(math.radians(4), 4, HU)).to_euler()
    e.location += HU * 0.25 - HV * 0.2 + Vector((0, 0, -0.12))
    # the top front cube's roof knocked loose, the left top cube shoved back
    roof = [o for o in SC.objects if base(o).startswith("top-frontroof")]
    if roof:
        e2 = hinge(roof, mid(roof), rot=(0, 0, 0))
        e2.rotation_euler = Matrix.Rotation(math.radians(24), 4, (HV + HU * 0.4).normalized()).to_euler()
        e2.location += Vector((0, 0, 0.3)) - HV * 0.25
    # the front cube knocked askew and sunk at one corner
    fr = part("cube-front")
    e3 = hinge(fr, T(0, 2.3, 1.16), rot=(0, 0, 0))
    e3.rotation_euler = (Matrix.Rotation(math.radians(11), 4, "Z") @ Matrix.Rotation(math.radians(-6), 4, HV)).to_euler()
    e3.location += Vector((0, 0, -0.1)) + HU * 0.12
    # dents and char
    for nm in ("core", "cube-left"):
        for o in [o for o in part(nm) if base(o) == nm]:
            crumple([fine(o, 2)], 0.06, 1.6)
    burn(T(0.0, 2.8, 1.6), 1.2)
    burn(T(1.8, 0.0, 5.5), 1.1)
    burn(T(-1.6, 0.5, 2.6), 1.0)
    # broken bits on the grass round the block's foot: lumps of wall, a green roof piece, a snapped post
    rr = random.Random(8)
    for i in range(6):
        at = T(rr.uniform(-2.4, 2.6), rr.uniform(2.6, 3.8), 0.08)
        chunk("chunk", at, (rr.uniform(0.25, 0.5), rr.uniform(0.2, 0.4), rr.uniform(0.12, 0.25)),
              M["wall"] if i % 3 else M["roof"], (rr.uniform(-15, 15), rr.uniform(-15, 15), rr.uniform(0, 90)), i)


def destroyed():
    G["build"]()
    fence_bits()
    bake_doors()
    kill(part("core", "ground-box", "ground-boxr", "cube-left", "endr", "plinth-right", "ladder0", "ladder1",
              "ladderrung0", "ladderrung1"))
    kill([o for o in SC.objects if base(o).startswith("ladder")])
    # the upper cubes dropped onto the legs (the lower floor crushed under them), a little tilted
    low = part("top-back", "top-right", "plinth-left", "top-left")
    e = hinge(low, T(0, -1.0, 4.4), rot=(0, 0, 0))
    e.rotation_euler = (Matrix.Rotation(math.radians(-5), 4, HV) @ Matrix.Rotation(math.radians(4), 4, HU)).to_euler()
    e.location += Vector((0, 0, -3.25)) + HU * 0.3
    # the front cube crushed down in front of them
    fr = part("cube-front")
    e = hinge(fr, T(0, 2.3, 1.16), rot=(0, 0, 0))
    e.rotation_euler = (Matrix.Rotation(math.radians(-14), 4, "Z") @ Matrix.Rotation(math.radians(9), 4, HV)).to_euler()
    e.location += Vector((0, 0, -1.0)) + HU * 0.1
    rest(e, fr, -0.25)
    # the deck slid off to the left onto the grass, tilted, the top front cube still on it; the right wing tumbled
    # beside it
    deck = part("deck", "endl", "top-front", "plinth-right")
    c = mid(part("deck"))
    e = hinge(deck, c, rot=(0, 0, 0))
    e.rotation_euler = (Matrix.Rotation(math.radians(-18), 4, "Z") @ Matrix.Rotation(math.radians(6), 4, HU)).to_euler()
    e.location = c - HV * 5.2 + HU * 1.6 - Vector((0, 0, 3.4))
    rest(e, part("deck"), -0.05)
    wing = part("cube-right")
    c = mid(wing)
    e = hinge(wing, c, rot=(0, 0, 0))
    e.rotation_euler = (Matrix.Rotation(math.radians(35), 4, "Z") @ Matrix.Rotation(math.radians(55), 4, HU)).to_euler()
    e.location = c - HV * 2.2 + HU * 3.2
    rest(e, wing, -0.1)
    # dents, char and broken bits
    for nm, p, n, r, sd in (("top-left", T(-1.55, -0.1, 6.0), HU, 0.4, 5),):
        for o in [o for o in part(nm) if base(o) == nm]:
            par = o.parent
            o = punch(o, p, n, r, seed=sd)
    burn(T(0.0, 0.0, 1.5), 2.6)
    burn(mid(part("deck")), 2.0)
    rr = random.Random(9)
    for i in range(9):
        at = T(rr.uniform(-4.5, 2.6), rr.uniform(1.5, 4.2), 0.08)
        chunk("chunk", at, (rr.uniform(0.25, 0.55), rr.uniform(0.2, 0.45), rr.uniform(0.12, 0.25)),
              M["wall"] if i % 3 else M["roof"], (rr.uniform(-15, 15), rr.uniform(-15, 15), rr.uniform(0, 90)), i)


D.run(damaged, destroyed, soot_amount=(0.25, 0.4))
