"""silodmg.py : the Storage Silo's damaged and destroyed looks in 3D, after Flash's one damaged picture and its one
destroyed heap (the silo has one look for all ten levels). The approved model (silo.py + sackpatch.png,
art/buildings-3d-silo b13254b6d, copied here unchanged) is built as it is, then broken as Flash's damaged picture: the
cage squashed so the four cables bow out, the lid sunk and tipped to the left, the hatch's cap knocked askew, the sack
burst into flaps from its neck to the floor plate with the stored goods (coloured balls) heaped on the plate and
spilling out at the front. Destroyed: the lid lying on its edge at the left, the hatch drum on its side, the torn sack
lying flat on the ground over the floor plate, two snapped cables lying across the front; burnt.

    blender -b --factory-startup -P silodmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    Every level is the same: give level 1. SILO_PLAIN=1 builds the whole model unbroken (to compare).

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135, the front
(bottom of the screen) bearing -45. The silo's whole look shows the sack at cell 0 (empty); damaged starts from it.
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

D.load(HERE / "silo.py")
from dmgcore import *  # noqa: E402,F401,F403

PLAIN = os.environ.get("SILO_PLAIN") == "1"
D.CHAR_FLOOR = 0.8                                 # burns as dark as Flash's
ROD, ROD_R, PLATE = G["ROD"], G["ROD_R"], G["PLATE"]
PZ0, PZ1, LZ0, LZ1 = G["PLATE_Z0"], G["PLATE_Z1"], G["LID_Z0"], G["LID_Z1"]
TOP = G["SACK_TOP"]
HZ = LZ1 + 0.18                                    # the hatch drum's foot (silo.build_static)
CORNERS = ((1, 1), (1, -1), (-1, -1), (-1, 1))     # cable{i} stands at (sx * ROD, sy * ROD)


def build():
    G["build_static"]()
    G["set_sack"](0)
    M["sack"].node_tree.nodes["fill"].outputs[0].default_value = 1.0     # the cloth as bright as the full sack's


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
    """Unparented objects whose part name starts with one of prefixes."""
    return [o for o in SC.objects if o.parent is None and base(o).startswith(prefixes)]


def mid(obs):
    return sum((bbox_w(o) for o in obs), Vector()) / len(obs)


def tip(obs, pivot, bearing, deg, move=(0, 0, 0)):
    """Tip obs over round world point pivot, their top going toward bearing by deg, then move them."""
    k = Vector((0, 0, 1)).cross(U(bearing)).normalized()
    e = Matrix.Rotation(math.radians(deg), 4, k).to_euler()
    return hinge(obs, Vector(pivot), rot=[math.degrees(a) for a in e], move=move)


def snip(o, z, above=True, rag=0.1, seed=0):
    """Cut mesh object o across at world height z, keeping the part above (or below) it; the cut a little ragged."""
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


def rest(e, obs, extra=0.0):
    """Drop (or lift) hinge e so the lowest point of obs (its children) rests on the ground."""
    e.location.z += GROUND + extra - lowest(obs)
    bpy.context.view_layer.update()


def dup(o):
    c = o.copy()
    c.data = o.data.copy()
    G["COLL"].objects.link(c)
    return c


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


def smooth01(s):
    s = max(0.0, min(1.0, s))
    return s * s * (3 - 2 * s)


def angd(a, b):
    """Degrees between bearings a and b (0..180)."""
    return abs((a - b + 180) % 360 - 180)


def fray_mat():
    """The torn cloth's edge: the canvas's pale cream weave, seen where it frays."""
    return G["flat"]("fray", (226, 212, 186), rough=0.9)


def cloth_ob(name, bm, thick=0.05):
    """A cloth sheet from bm (sack canvas both sides, a pale frayed rim on every torn edge), thickened inward."""
    ob = G["mesh_ob"](name, bm, [M["sack"], fray_mat()])
    sd = ob.modifiers.new("thick", "SOLIDIFY")
    sd.thickness = thick
    sd.offset = -1.0
    sd.material_offset_rim = 1
    sd.use_rim = True
    return ob


# ------------------------------------------------------------------------------------------------------------ cables
def cable_along(name, c, s0, s1, r=ROD_R, strands=3, pitch=1.3, seed=0, ends="round"):
    """Flash's twisted steel cable (silo.cable) along the centre line c(s), s from s0 to s1: three wires wound round a
    core. ends="round": the top drawn together and rounded (as standing out of the lid); "frayed": both ends snapped,
    the wires splayed apart."""
    wr = r * 0.5
    off = r - wr
    n = int((s1 - s0) / pitch * 18) + 2
    if ends == "round":
        ss = [s0 + (s1 - s0 - 0.3) * i / n for i in range(n + 1)]
        ss += [s1 - 0.3 + 0.3 * math.sin(math.pi / 2 * i / 12) for i in range(1, 13)]
    else:
        ss = [s0 + (s1 - s0) * i / n for i in range(n + 1)]
    rr = random.Random(seed)
    ph0 = rr.uniform(0, 2 * math.pi)

    def frame(s):
        t = (c(min(s1, s + 0.02)) - c(max(s0, s - 0.02))).normalized()
        ref = Vector((1, 0, 0)) if abs(t.z) > 0.7 else Vector((0, 0, 1))
        n1 = t.cross(ref).normalized()
        return n1, t.cross(n1)

    for k in range(strands):
        ph = ph0 + 2 * math.pi * k / strands
        pts, rad = [], []
        sp = [rr.uniform(1.0, 2.2) for _ in range(2)]
        for s in ss:
            a = ph + 2 * math.pi * s / pitch
            n1, n2 = frame(s)
            if ends == "round":
                u = max(0.0, (s - (s1 - 0.3)) / 0.3)
                g = off * (1 - 0.45 * u * u)
                e = max(0.0, (s - (s1 - wr)) / wr)
                rad.append(math.sqrt(max(0.0, 1 - e * e)) if e < 1 else 0.0)
            else:                                   # splayed over the last 0.5 at each snapped end
                u0, u1 = max(0.0, 1 - (s - s0) / 0.5), max(0.0, 1 - (s1 - s) / 0.5)
                g = off * (1 + sp[0] * u0 * u0 + sp[1] * u1 * u1)
                rad.append(1.0)
            pts.append(c(s) + (n1 * math.cos(a) + n2 * math.sin(a)) * g)
        G["tube"](f"{name}s{k}", pts, wr * 1.06, M["cable"], verts=10, radii=rad)
    core = [c(s0 + (s1 - s0 - (wr if ends == "round" else 0.25)) * i / 40) for i in range(41)]
    if ends != "round":
        core = core[2:]
    G["tube"](f"{name}core", core, off * 0.9, M["cable"], verts=10)


# ------------------------------------------------------------------------------------------------------------ goods
PLACED = []                                        # the goods' balls so far (centre, radius): none overlap


def free(p, r):
    return all((p - q).length > 0.9 * (r + s) for q, s in PLACED)


GOODS = ((70, 196, 38), (206, 70, 196), (150, 92, 62), (232, 230, 222), (96, 210, 60))


def goods_mats():
    return [G["flat"](f"goods{k}", c, rough=0.5) for k, c in enumerate(GOODS)]


def ball(at, r, mats, rr):
    PLACED.append((Vector(at), r))
    o = G["lathe"]("goods", [(math.sin(math.pi * i / 12) * r, -math.cos(math.pi * i / 12) * r) for i in range(13)],
                   tuple(at), rr.choice(mats), verts=20)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def heap_of_goods(c, rx, rz, n, rr, mats, z_ok=lambda p: True):
    """A mound of stored goods on c: a dark core (radii rx, rz) with balls set into its surface."""
    core = G["lathe"]("goodsheap", [(math.sin(math.pi / 2 * i / 12) * rx, math.cos(math.pi / 2 * i / 12) * rz)
                                    for i in range(13)], tuple(c), G["flat"]("goodsdark", (58, 40, 30), rough=0.9),
                      verts=32)
    out = [core]
    for _ in range(n):
        th = rr.uniform(0, 2 * math.pi)
        ph = math.acos(rr.uniform(0.0, 1.0))
        p = Vector(c) + Vector((rx * math.sin(ph) * math.cos(th), rx * math.sin(ph) * math.sin(th), rz * math.cos(ph)))
        r = rr.uniform(0.27, 0.37)
        if z_ok(p) and free(p, r):
            out.append(ball(p, r, mats, rr))
    return out


# ------------------------------------------------------------------------------------------------------------ damaged
# the lid sunk and tipped toward the screen's left; the cage between it and the floor plate squashed
LID_T = Matrix.Translation((0, 0, -0.55)) @ Matrix.Translation((0, 0, LZ0)) @ \
    Matrix.Rotation(math.radians(8), 4, Vector((0, 0, 1)).cross(U(-135)).normalized()) @ \
    Matrix.Translation((0, 0, -LZ0))
BOW = {0: (1.05, 25), 1: (0.45, -10), 2: (1.2, -20), 3: (0.8, 10)}   # cable: how far it bows out, turned degrees


def follow(p):
    """Where world point p goes as the cage is squashed: the floor plate stays, the lid moves by LID_T, between
    them a smooth blend."""
    p = Vector(p)
    w = smooth01((p.z - PZ1) / (LZ0 - PZ1))
    return p.lerp(LID_T @ p, w)


def bent_cables():
    kill(pre("cable"))
    for i, (sx, sy) in enumerate(CORNERS):
        x, y = sx * ROD, sy * ROD
        amt, turn = BOW[i]
        out = U(math.degrees(math.atan2(sy, sx)) + turn)

        def c(s, x=x, y=y, amt=amt, out=out):
            u = max(0.0, min(1.0, (s - PZ1) / (LZ0 - PZ1)))
            return follow((x, y, s)) + out * amt * math.sin(math.pi * u) ** 1.3
        cable_along(f"cable{i}", c, G["NUT_H"] - 0.2, G["CABLE_TOP"], seed=i)
        burn(c((PZ1 + LZ0) / 2), 0.9)


# the sack's tears: bearing, how far down its neck the tear starts (0..1), its half width at the bottom (degrees)
TEARS = ((-45, 0.15, 36), (-128, 0.35, 15), (28, 0.3, 17), (128, 0.42, 13))
SACK_HOLES = ((-80, 0.5, 0.34), (60, 0.62, 0.22), (95, 0.3, 0.14), (-165, 0.66, 0.18), (-12, 0.78, 0.12))   # bearing, t, size


def burst_sack(nu=360, nv=180):
    """The sack burst open: from the collar it spreads like a tent to the floor plate, split into flaps by ragged
    tears (wide at the front), the flaps flaring out and over the plate's edge; burnt round the tears."""
    zb = PZ1 + 0.03
    rr = random.Random(3)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rows = []
    for i in range(nv + 1):
        t = i / nv
        row = []
        for j in range(nu + 1):
            th = 2 * math.pi * j / nu
            b = math.degrees(th)
            r = 0.95 + 1.75 * t ** 1.6
            r *= 1 + 0.07 * t * math.sin(7 * th + 1.0) + 0.04 * t * math.sin(13 * th + 2.0)
            # flaps curl out beside each tear
            for tb, t0, hw in TEARS:
                if t > t0:
                    w = hw * ((t - t0) / (1 - t0)) ** 0.8
                    d = angd(b, tb) - w
                    if d > 0:
                        r += 0.5 * (t - t0) * max(0.0, 1 - d / 30)
            r = G["smin"](r, G["rod_limit"](th, max(zb, TOP - (TOP - zb) * t)), 0.12)
            z = max(zb, TOP - (TOP - zb) * t / 0.9)
            x, y = r * math.cos(th), r * math.sin(th)
            over = max(abs(x), abs(y)) - (PLATE - 0.05)  # beyond the plate's edge the flap hangs down over it
            if over > 0:
                z -= over * 1.6
            row.append(bm.verts.new(follow((x, y, z))))
        rows.append(row)
    dead = []
    for i in range(nv):
        for j in range(nu):
            vs = [rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]]
            f = bm.faces.new(vs)
            for lp, uv in zip(f.loops, ((j / nu, 1 - i / nv), ((j + 1) / nu, 1 - i / nv),
                                        ((j + 1) / nu, 1 - (i + 1) / nv), (j / nu, 1 - (i + 1) / nv))):
                lp[uvl].uv = uv
            t, b = (i + 0.5) / nv, 360 * (j + 0.5) / nu
            rag = 0.5 + 0.5 * math.sin(0.31 * b + 7 * t) * math.sin(0.17 * b - 5 * t + 1)
            gone = t > 0.985 - 0.07 * rag                                 # the hem torn ragged
            for tb, t0, hw in TEARS:
                if t > t0 + 0.04 * rag:
                    w = hw * ((t - t0) / (1 - t0)) ** 0.8 * (0.85 + 0.3 * rag) + 2.0
                    if angd(b, tb) < w:
                        gone = True
            for hb, ht, hs in SACK_HOLES:
                du = angd(b, hb) / 360 * 2 * math.pi * (0.95 + 1.75 * ht ** 1.6) / hs
                dv = (t - ht) * 6.3 / hs
                a = math.atan2(dv, du)
                if du * du + dv * dv < (1 + 0.3 * math.sin(5 * a + hb) + 0.15 * math.sin(11 * a)) ** 2:
                    gone = True
            if gone:
                dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for tb, t0, hw in TEARS:                                              # burnt along every tear
        for t in (t0 + 0.1, (t0 + 1) / 2, 0.92):
            z = max(zb, TOP - (TOP - zb) * t / 0.9)
            burn(follow(P(tb, 0.95 + 1.75 * t ** 1.6, z)), 0.5 + 0.5 * t)
    for hb, ht, hs in SACK_HOLES:
        burn(follow(P(hb, 0.95 + 1.75 * ht ** 1.6, TOP - (TOP - zb) * ht / 0.9)), hs * 2.2)
    return cloth_ob("sacktorn", bm)


def damaged():
    if PLAIN:
        return
    rr = random.Random(11)
    kill(objs("sack"))
    # the hatch's cap knocked askew, hinged up on its right rim: the drum open on the left, dark inside
    hatch = objs("hatch")[0]
    cut = HZ + 0.8
    cap = snip(dup(hatch), cut, above=True)
    snip(hatch, cut, above=False)
    G["cyl"]("drumdark", 1.22, 0.04, (0, 0, cut - 0.2), inside(), verts=48)
    tip([cap] + pre("handle", "latchhasp"), P(60, 1.3, cut), 60, 32, move=(0, 0, 0.12))
    top = pre("lid", "liddish", "hatch", "clamp", "latch", "handle", "collar", "drumdark", "hinge")
    for o in top:
        o.matrix_world = LID_T @ o.matrix_world
    bent_cables()
    burst_sack()
    # the stored goods heaped on the floor plate inside, spilling out at the front onto the plate and the grass
    mats = goods_mats()
    heap_of_goods((0, 0, PZ1 - 0.15), 1.8, 1.45, 400, rr, mats)
    nuts = [Vector((sx * ROD, sy * ROD, 0)) for sx, sy in CORNERS]
    for k in range(18):
        b = -45 + rr.uniform(-40, 40)
        d = rr.uniform(1.7, 2.4)
        r = rr.uniform(0.26, 0.34)
        p = P(b, d, 0)
        if max(abs(p.x), abs(p.y)) < PLATE - r and free(P(b, d, PZ1 + r), r):
            ball(P(b, d, PZ1 + r), r, mats, rr)
    for k in range(9):
        b = -45 + rr.choice((-1, 1)) * rr.uniform(14, 40)
        p = P(b, rr.uniform(3.1, 3.9), 0)
        r = rr.uniform(0.26, 0.34)
        if all((p - n).length > G["NUT_R"] + r + 0.05 for n in nuts) and max(abs(p.x), abs(p.y)) > PLATE + r and                 free(p + Vector((0, 0, r)), r):
            ball(p + Vector((0, 0, r)), r, mats, rr)
    # burns on the lid, the drum, the floor plate and the nuts
    for p_, rad in ((P(-135, 2.6, LZ0), 1.9), (P(-45, 2.4, LZ0), 1.6), (P(-90, 2.0, LZ1), 1.4), (P(20, 2.2, LZ0), 1.3),
                    (P(150, 1.6, HZ + 0.6), 1.3), (P(-60, 1.3, HZ + 0.4), 1.1), (P(-80, 2.6, PZ0), 1.8),
                    (P(-10, 2.6, PZ0), 1.4), (P(-150, 2.6, PZ0), 1.5), (P(-45, 2.7, 0.5), 1.0), (P(-135, 2.7, 0.5), 0.9)):
        burn(follow(p_), rad)


# ------------------------------------------------------------------------------------------------------------ destroyed
def cloth_sheet(name, c, size, yaw, seed, holes=(), lift=None, n=(150, 120)):
    """A torn piece of the sack lying on the ground round c: size (a, b) across, turned yaw degrees, its edge ragged,
    rumpled; lift(x, y) the height under it (the ground or what it lies over); holes (u, v, r) in -1..1."""
    rr = random.Random(seed)
    lift = lift or (lambda x, y: GROUND)
    a, b = size
    ca, sa = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    nx, ny = n
    vs = {}
    ph = [rr.uniform(0, 6.3) for _ in range(4)]
    for i in range(nx + 1):
        for j in range(ny + 1):
            u, v = 2 * i / nx - 1, 2 * j / ny - 1
            lx, ly = u * a / 2, v * b / 2
            x, y = c[0] + lx * ca - ly * sa, c[1] + lx * sa + ly * ca
            fold = 0.1 * math.sin(2.3 * lx + ph[0]) * math.sin(1.7 * ly + ph[1]) + \
                0.08 * noise.noise(Vector((x * 1.3, y * 1.3, seed)))
            vs[i, j] = bm.verts.new((x, y, lift(x, y) + 0.05 + abs(fold) + 0.04 * (1 - u * u)))
    dead = []
    for i in range(nx):
        for j in range(ny):
            f = bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, j + 1], vs[i, j + 1]))
            for lp, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uvl].uv = (0.3 + ii / nx * a / 12, 0.3 + jj / ny * b / 7)
            u, v = 2 * (i + 0.5) / nx - 1, 2 * (j + 0.5) / ny - 1
            ang = math.atan2(v, u)
            edge = 0.78 + 0.12 * math.sin(5 * ang + ph[2]) + 0.08 * math.sin(11 * ang + ph[3]) + \
                0.05 * math.sin(23 * ang)
            if u * u + v * v > edge * edge:
                dead.append(f)
                continue
            for hu, hv, hr in holes:
                du, dv = u - hu, v - hv
                aa = math.atan2(dv, du)
                if du * du + dv * dv < (hr * (1 + 0.3 * math.sin(5 * aa + hu * 7) + 0.15 * math.sin(11 * aa))) ** 2:
                    dead.append(f)
                    break
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    for hu, hv, hr in holes:
        lx, ly = hu * a / 2, hv * b / 2
        burn((c[0] + lx * ca - ly * sa, c[1] + lx * sa + ly * ca, GROUND), hr * a / 2 + 0.5)
    return cloth_ob(name, bm, thick=0.04)


def destroyed():
    """Flash's one heap: the lid on its edge at the left, the hatch drum on its side by it, the torn sack lying flat
    over the floor plate, two snapped cables across the front, a few goods spilt; burnt."""
    G["build"]()
    rr = random.Random(23)
    kill(objs("sack") + pre("cable"))
    mats = goods_mats()
    # the floor plate fallen flat on the grass at the back right, a nut under one corner so it tilts
    plate = objs("plate")[0]
    pc = Vector((0.7, 2.3, 0))
    plate.location = (pc.x, pc.y, 0.0)
    plate.rotation_euler = (0, 0, math.radians(14))
    nuts = objs("nut0", "nut1", "nut2", "nut3")
    kill(nuts[2:])
    for o, at, rot in ((nuts[0], (3.9, 0.6), (90, 0, 30)), (nuts[1], (-2.3, 1.9), (0, 0, 10))):
        o.location = (at[0], at[1], 0)
        o.rotation_euler = [math.radians(a) for a in rot]
        sit([o])
    pt = PZ1 - PZ0 + 0.04

    def over_plate(x, y):
        q = Matrix.Rotation(math.radians(-14), 2) @ Vector((x - pc.x, y - pc.y))
        d = max(abs(q.x), abs(q.y)) - PLATE
        return GROUND + pt * (1.0 if d <= 0 else max(0.0, 1 - d / 0.7) ** 2)

    # the torn sack: one big piece over the plate spreading to the right, a strip at the left behind the lid
    cloth_sheet("sackrag", (1.4, 1.7), (7.4, 6.0), 30, 5, holes=((0.3, 0.2, 0.18), (-0.35, -0.3, 0.12),
                                                                  (0.1, -0.5, 0.08)), lift=over_plate)
    cloth_sheet("sackrag", (-2.6, 0.1), (3.6, 1.6), -35, 8, holes=((0.2, 0.1, 0.15),))
    cloth_sheet("sackrag", (2.8, -1.7), (2.2, 1.4), 70, 9)
    # the lid on its edge at the left, its face to the front left, the collar still under it
    lid = pre("lid", "liddish", "collar")
    hatch = objs("hatch")[0]
    cut = HZ + 0.8
    cap = snip(dup(hatch), cut, above=True)
    drum = snip(hatch, cut, above=False)
    e = tip(lid, (0, 0, LZ0), -110, 46)
    e.location += Vector((-1.9, -0.6, 0))
    rest(e, lid)
    # the hatch drum on its side, its open end to the front right
    G["cyl"]("drumdark", 1.22, 0.04, (0, 0, HZ + 0.1), inside(), verts=48)
    dg = [drum] + pre("clamp", "latchstaple", "drumdark")
    e = tip(dg, (0, 0, HZ), -20, 90)
    e.location += Vector((0.4, 0.3, 0))
    rest(e, dg)
    # the cap and its handle lying flat behind the lid
    cg = [cap] + pre("handle", "latchhasp")
    e = tip(cg, (0, 0, cut), 160, 12)
    e.location += Vector((-2.8, 2.6, 0))
    rest(e, cg)
    # two cables snapped and lying across the front, one stub going back at the right
    for k, (a, b, bend) in enumerate((((0.05, -3.55), (2.3, 1.8), 0.25), ((2.2, 1.6), (2.4, 4.4), -0.15),
                                      ((-3.2, -1.2), (-1.4, -3.3), 0.1))):
        a, b = Vector((a[0], a[1], ROD_R)), Vector((b[0], b[1], ROD_R))
        side = (b - a).cross(Vector((0, 0, 1))).normalized()
        ln = (b - a).length

        def c(s, a=a, b=b, side=side, ln=ln, bend=bend):
            q = a.lerp(b, s / ln) + side * bend * math.sin(math.pi * s / ln)
            return q + Vector((0, 0, over_plate(q.x, q.y) + 0.04))
        cable_along(f"cablebit{k}", c, 0.0, ln, seed=10 + k, ends="frayed")
        burn(c(ln * 0.4), 0.8)
    # a few goods spilt on the rags and the grass
    for k in range(16):
        x, y = rr.uniform(-1.5, 3.5), rr.uniform(-2.5, 2.5)
        if math.hypot(x - 0.4, y - 0.3) < 1.7 or math.hypot(x + 1.9, y + 0.6) < 1.6:
            continue
        r = rr.uniform(0.2, 0.28)
        if free(Vector((x, y, over_plate(x, y) + 0.06 + r)), r):
            ball((x, y, over_plate(x, y) + 0.06 + r), r, mats, rr)
    for p_, rad in (((-1.9, -0.6, 1.5), 1.5), ((-2.4, -0.2, 2.4), 1.2), ((0.4, 0.3, 1.0), 1.4), ((1.3, 1.6, 0.6), 1.8),
                    ((2.6, 0.2, 0.3), 1.4), ((0.4, -1.6, 0.3), 1.2), ((-2.8, 2.6, 0.4), 1.2), ((3.6, -0.4, 0.4), 0.8)):
        burn(Vector(p_), rad)


D.run(damaged, destroyed, soot_amount=(0.45, 0.55))
