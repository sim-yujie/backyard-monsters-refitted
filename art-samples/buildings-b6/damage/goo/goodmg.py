"""goodmg.py : the Goo Factory's damaged and destroyed looks in 3D, as Flash's damaged pictures per level and its one
destroyed heap. The approved model (goo2.py + stack.py + goocol.py, art/buildings-3d-b6 5428446fe, copied here
unchanged) is built as it is, then broken where Flash's damaged picture has it broken; the destroyed look is the
frame fallen flat in a ring round the burst vat, the funnel lying in it (Flash has one heap for every level).

    blender -b --factory-startup -P goodmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 3. GOO_PLAIN=1 builds the whole model unbroken (to compare).

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135. Flash has no
damaged or destroyed animation for this building, so the pumps stand still.
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

D.load(HERE / "goo2.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
P, U = G["P"], G["U"]
PLAIN = os.environ.get("GOO_PLAIN") == "1"
D.CHAR_FLOOR = 0.8                                 # burns as dark as Flash's


# ------------------------------------------------------------------------------------------------------------ helpers
def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def pre(*prefixes):
    """Unparented objects whose part name starts with one of prefixes."""
    return [o for o in SC.objects if o.parent is None and base(o).startswith(prefixes)]


def mid(obs):
    return sum((bbox_w(o) for o in obs), Vector()) / len(obs)


def lay(obs, at, rot, extra=0.0):
    """Move a group to lie on the ground at (x, y): turned rot (degrees XYZ) round its middle, resting on the ground."""
    c = mid(obs)
    e = hinge(obs, c, rot=rot, move=Vector((at[0], at[1], c.z)) - c)
    bpy.context.view_layer.update()
    e.location.z += GROUND + extra - lowest(obs)
    return e


def splat(x, y, r, seed=0, lumps=3):
    """Spilt goo on the ground: a flat green pool with a few rounder lumps in it."""
    rr = random.Random(seed + 10 * L)
    balls = [((x, y, GROUND + 0.02), r, (1.0, 0.8, 0.12))]
    for k in range(lumps):
        a = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(0.3, 0.8) * r
        balls.append(((x + d * math.cos(a), y + d * math.sin(a), GROUND + 0.02), r * rr.uniform(0.35, 0.55),
                      (1.0, 1.0, 0.3)))
    G["meta"]("splat", balls, M["goo"], res=0.05)


def tip(obs, pivot, bearing, deg, move=(0, 0, 0)):
    """Tip obs over round world point pivot, their top going toward bearing by deg, then move them."""
    k = Vector((0, 0, 1)).cross(U(bearing)).normalized()
    e = Matrix.Rotation(math.radians(deg), 4, k).to_euler()
    return hinge(obs, Vector(pivot), rot=[math.degrees(a) for a in e], move=move)


def bearing_of(p):
    return math.degrees(math.atan2(p.y, p.x))


def snip(o, z, above=True, rag=0.14, seed=0):
    """Break mesh object o across at world height z, keeping the part above (or below) it; the break ragged."""
    o = bake(o)
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    n = Vector((0, 0, 1 if above else -1))
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-4,
                                 plane_co=Vector((0, 0, z)), plane_no=n, clear_inner=True)
    for v in res["geom_cut"]:
        if isinstance(v, bmesh.types.BMVert):
            q = v.co
            v.co = q + n * rag * (0.5 + 0.5 * math.sin(4.1 * q.x + 3.3 * q.y + seed))
    bm.to_mesh(o.data)
    bm.free()
    return o


def crumple(obs, amt=0.08, scale=2.0):
    """Dent obs (baked into world space) with smooth noise."""
    out = []
    for o in obs:
        if o.type not in ("MESH", "CURVE"):
            continue
        o = bake(o)
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            v.co += o.matrix_world.inverted().to_3x3() @ (noise.noise_vector(w * scale) * amt)
        out.append(o)
    return out


def pipebit(at, bearing, length, r=None):
    """A broken length of pump pipe lying on the ground at (x, y), along bearing."""
    ob = G["cyl"]("pipebit", r or S.PIPE_R, length, (0, 0, 0), M["pipe"], rot=(90, 0, bearing + 90), verts=20)
    lay([ob], at, (0, 0, 0))
    return ob


def post(k):
    return objs(f"post{k}", f"postwood{k}", f"postlead{k}", f"postferrule{k}", f"posteraser{k}") + \
        pre(f"clamp{k}", f"foot{k}")


def nearest(prefix, b):
    """The object named prefix... whose middle is at the bearing nearest b."""
    return min(pre(prefix), key=lambda o: abs((bearing_of(mid([o])) - b + 180) % 360 - 180))


def bend_vanes(r, kill_one=True):
    """The grey vanes round the neck bent up and askew, one torn off."""
    vs = sorted(pre("vane"), key=lambda o: base(o))
    ks = sorted({base(o)[len("vanerod"):] if base(o).startswith("vanerod") else base(o)[len("vane"):] for o in vs})
    for j, k in enumerate(ks):
        g = objs(f"vane{k}", f"vanerod{k}")
        if not g:
            continue
        if kill_one and j == 0:
            kill(g)
            continue
        c = mid(g)
        b = bearing_of(c)
        tip(g, P(b, S.NECK_R, c.z), b + 180, r.uniform(35, 60), move=(0, 0, r.uniform(-0.1, 0.1)))


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    if PLAIN:
        return
    r = random.Random(5 + L)
    z1 = S.VAT_Z1
    for b, z, rad in ((-60, 3.0, 2.0), (-100, 4.6, 1.8), (-20, 2.4, 1.8), (-140, 2.6, 1.7), (10, 4.4, 1.6),
                      (-45, 4.8, 1.5), (-75, 2.1, 1.5)):
        burn(P(b, G["vat_r"](z), z), rad)
    if L == 1:
        # Flash: the funnel knocked off over the rim at the left, the left stump knocked out from under the plate so
        # the vat leans that way, the pump pipe snapped and its lower length lying at the front right; goo spilt
        burn(Vector((0, 0, S.FUNNEL_Z0 + 0.4)), 1.2)
        tip(pre("funnel", "collar", "neck"), (0, 0, z1), -135, 58, move=tuple(U(45) * 0.5 + Vector((0, 0, -0.3))))
        st = [o for o in pre("stump") if abs((bearing_of(mid([o])) + 135 + 180) % 360 - 180) < 30]
        k = Vector((0, 0, 1)).cross(U(-135)).normalized()
        piv = P(-135, 1.6, 0)
        shift_all(Matrix.Translation(piv) @ Matrix.Rotation(math.radians(10), 4, k) @ Matrix.Translation(-piv), keep=st)
        lay(st, P(-150, 2.9, 0).xy, (90, 0, 30))
        snip(objs("pumpR")[0], 1.7)
        G["meta"]("goofill", [((0, 0, z1 - 0.1), 1.6, (1.0, 1.0, 0.35))], M["goo"])
        pipebit(P(-12, 3.9, 0).xy, 45, 1.4)
        splat(*P(-150, 2.4, 0).xy, 0.6, seed=1)
        splat(*P(-40, 2.6, 0).xy, 0.45, seed=2)
        return
    # level 3 up
    burn(P(-120, 1.5, 6.0), 1.4)
    fun = pre("funnel", "collar", "neck")
    burn(Vector((0, 0, S.FUNNEL_Z0 + 0.4)), 1.8)
    p0 = post(0)
    burn(mid(p0), 1.0)
    lay(p0, P(-48, 3.7, 0).xy, (90, 0, 15))
    pl = nearest("ring0-", -40)
    lay([pl], P(-20, 3.3, 0).xy, (0, 8, 35))
    if L == 3:
        # Flash: the funnel bent askew and charred, the vanes bent up, the front pencil knocked out and lying in
        # front with a plank of the lower ring; goo splashed at the left
        bend_vanes(r)
        tip(crumple(fun, 0.12), (0, 0, S.COLLAR_Z - 0.2), -120, 40)
        splat(*P(-135, 3.3, 0).xy, 0.55, seed=3)
        return
    # level 6 up: the dome burst, the goo slumped into the vat; the funnel fallen over on it with its vanes
    kill(pre("goodome", "goobulb", "goodark", "strap"))
    G["goo_l1"]()
    kill(pre("vane")[2:])                           # most vanes torn off, the rest bent and charred
    bend_vanes(r, kill_one=False)
    tip(crumple(fun + pre("vane"), 0.07), (0, 0, z1 + 0.3), -100, 52, move=(0, 0, -0.5))
    # the left loop bent out, the back return loop snapped to a stub, the front left pump snapped off
    tip(pre("loopL"), P(-128, G["vat_r"](3.1), 3.1), -128, 24)
    for o in pre("loopR"):
        snip(o, 6.35, above=False)
    snip(objs("pumpL")[0], 1.8)
    pipebit(P(-75, 3.9, 0).xy, -20, 1.6)
    splat(*P(-135, 3.3, 0).xy, 0.55, seed=4)
    splat(*P(-60, 3.0, 0).xy, 0.4, seed=5)
    if L >= 10:
        # Flash: the tower snapped open below its cap, its arc bent up; the back loops snapped
        for o in pre("tower"):
            if mid([o]).z > 7.0 and not base(o).startswith("towerarc"):
                kill([o])
        for o in [o for o in pre("tower") if base(o) == "tower"]:
            snip(o, 7.0, above=False)
        for o in pre("loopB"):
            snip(o, 6.6, above=False)
        pipebit(P(-100, 4.0, 0).xy, 30, 1.2, r=0.18)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    """Flash's one heap for every level (built at level 3): the pencil frame fallen flat, its two wooden rings and
    yellow pencils lying in a ring on the ground, the vat burst down to a low ragged tub full of goo, the crumpled
    funnel and its vanes lying tipped in it, the right pump pipe still standing at the right; burnt."""
    G["build"]()
    r = random.Random(17)
    kill(pre("goodome", "goobulb", "goodark", "strap", "goospill", "bracket", "plateside"))
    # the vat burst low: everything of it above BURST gone, the rest sunk to the ground with the plate
    BURST, DROP = 3.0, S.VAT_Z0 - 0.35
    for o in pre("vat", "hoop"):
        if mid([o]).z > BURST + 0.3 and base(o).startswith("hoop"):
            kill([o])
    for o in pre("vat"):
        snip(o, BURST, above=False, rag=0.5)
    sink = pre("vat", "hoop", "plate", "flange")
    for o in sink:
        o.location.z -= DROP
    G["meta"]("goofill", [((0, 0, BURST - DROP - 0.2), 1.5, (1.0, 1.0, 0.4)),
                          ((0.5, -0.4, BURST - DROP), 0.8, (1.0, 1.0, 0.6))], M["goo"])
    # the pump pipe out of its right side: snapped where it left the vat, standing on its own
    pr = objs("pumpR")[0]
    snip(pr, 2.7, above=False)
    # the rings fallen flat round it
    for o in pre("ring"):
        c = mid([o])
        lo = S.RING_LO[0] if base(o).startswith("ring0") else S.RING_HI[0]
        o.location.z -= lo - 0.02
        o.location.x += c.x * r.uniform(0.0, 0.15)
        o.location.y += c.y * r.uniform(0.0, 0.15)
    # the pencils lying round the ring, snapped
    for k, b in enumerate(S.POST_BEARINGS):
        g = post(k)
        if g:
            lay(g, P(b + r.uniform(-12, 12), S.POST_R - r.uniform(0.1, 0.4), 0).xy, (90, 0, b + r.uniform(-15, 15)))
    # the funnel and its vanes crumpled, lying tipped in the tub
    fun = crumple(pre("funnel", "collar", "neck", "vane"), 0.14)
    tip(fun, (0, 0, S.COLLAR_Z), -110, 42, move=(0.3, -0.2, -(S.COLLAR_Z - 2.7)))
    for o in fun:
        burn(mid([o]), 1.1)
    for p_, rad in (((0, 0, 1.0), 2.2), ((1.6, -1.2, 0.4), 1.6), ((-1.6, -0.6, 0.4), 1.6), ((0.8, 1.6, 0.4), 1.5),
                    ((-0.6, 0.4, 2.2), 1.6)):
        burn(Vector(p_), rad)
    for k, b in enumerate((-160, -70, 20, 120)):
        splat(*P(b, 2.6 + 0.4 * (k % 2), 0).xy, 0.45, seed=20 + k)


D.run(damaged, destroyed, soot_amount=(0.45, 0.55))

