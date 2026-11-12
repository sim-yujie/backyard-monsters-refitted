"""coal.py : the Inferno Coal Extractor in 3D, three tiers, built clean-room from the Flash pictures only
(server/public/assets/buildings/icoalproducer). Only the generic Inferno kit is used (kit.py: camera, light, render
modes), the same kit as the approved 3D Bone Cruncher.

    blender -b --factory-startup -P coal.py -- <tier 1|2|3> <fit|check|still|anim|probe|gap> [frame]

Tier 1 = levels 1-2 (Flash look 1: rusty drum, yellow elbow pipe), tier 2 = levels 3-6 (in between), tier 3 = levels
7-10 (Flash look 2: polished copper, brick stack, star). Each tier is the tier below with parts added or swapped: one
drum, one layout, the same mounting points.

World: Z up, the drum's axis on the origin, 10 Flash px a unit. The camera looks from +X -Y. P(r, f, z) is the point r
units to the screen's right of the axis, f units toward the viewer, z up: Flash px (10 r, 5 f - 8.66 z) from the origin.

What moves, as Flash: a lump travels up the intake (yellow pipe / brick stack), a lump travels along the copper pipe
from the turret to the riser, the coal lumps stir, the fire flickers; at tier 3 the star turns. Everything is periodic
in the loop (47 frames at tier 1, 45 at tiers 2 and 3, as Flash's strips), so the last frame runs into the first.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kit  # noqa: E402

T = kit.L
N = 47 if T == 1 else 45
kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (5.5, 31.0)
kit.SKY_E = 0.38          # Flash's shaded faces are near black: less sky than the kit's 0.85
kit.SUN = 5.4
kit.FRAME = (-60, -70, 70, 70)
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))      # PB_EXTRA=1 also renders frame N (= frame 0), the loop check
rnd = random.Random(77)
R2 = math.sqrt(2.0)
SR, SF, UP = Vector((1, 1, 0)) / R2, Vector((1, -1, 0)) / R2, Vector((0, 0, 1))
K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)


def grey(x):
    return (x, x, x, 1)


def P(r, f, z=0.0):
    return SR * r + SF * f + UP * z


def D(phi):
    """Unit ground vector at screen bearing phi: 0 toward the viewer, 90 to the screen's right."""
    a = math.radians(phi)
    return SF * math.cos(a) + SR * math.sin(a)


def yaw(phi):
    """World angle (radians, from +X toward +Y) of D(phi)."""
    return math.radians(phi - 45.0)


def Rz(deg, at=(0, 0, 0)):
    return Matrix.Translation(Vector(at)) @ Matrix.Rotation(math.radians(deg), 4, "Z")


# ------------------------------------------------------------------------------------------------------------ materials
MATS = {}
FIRES = []          # (mapping node, centre, radius): the fire textures, moved round a circle in a loop


def _math(t, op, a, b=None):
    node = t.n("ShaderNodeMath", operation=op)
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            node.inputs[i].default_value = x
        else:
            t.link(x, node.inputs[i])
    return node.outputs[0]


def mat(name, col, rough=0.6, metal=0.0, wear=None, wear_amt=0.6, rust=None, rust_at=0.6, dirt=0.3, scale=5.0,
        speck=0.14, bump=0.07, ao_min=0.5, streak=None, bricks=None, coat=0.0, mottle=0.4, top=None, bands=None, hard=False):
    """Paint or metal: worn patches (`wear` shows through), rust blotches, a fine speckle, darker toward the ground and
    in creases. streak = colour of soft marks that run down the part. bricks = (course height, colour of the joints)."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    v = t.coords()
    out = kit.srgb(*col)
    if wear:
        out = t.mix(out, kit.srgb(*wear), t.ramp(t.noise(v, scale * 0.5, 3.0, 0.55, 0.0 if hard else 0.2), [(0.52, K0), (0.57, grey(wear_amt))] if hard else [(0.45, K0), (0.72, grey(wear_amt))]))
    if rust:
        out = t.mix(out, kit.srgb(*rust), t.ramp(t.noise(v, scale * 0.8, 5.0, 0.65, 0.0 if hard else 1.0), [(rust_at, K0), (rust_at + (0.04 if hard else 0.14), grey(0.8))]))
    if top:
        geo = t.n("ShaderNodeNewGeometry")
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sep.inputs[0])
        out = t.mix(out, kit.srgb(*top), t.ramp(sep.outputs["Z"], [(0.5, K0), (0.8, K1)]))
    if bands:
        vb = t.coords(scale=(0.12, 0.12, 2.4))
        out = t.mix(out, kit.srgb(*bands), t.ramp(t.noise(vb, scale, 3.0, 0.6, 0.0 if hard else 0.4), [(0.46, K0), (0.62, grey(0.75))]))
    if mottle:
        out = t.mix(out, t.ramp(t.noise(v, scale * 0.3, 3.0, 0.6, 0.0 if hard else 0.6), [(0.3, grey(1 - mottle)), (0.66, K1)]), 1.0, "MULTIPLY")
    if streak:
        v2 = t.coords(scale=(1.0, 1.0, 0.18))
        out = t.mix(out, kit.srgb(*streak), t.ramp(t.noise(v2, scale * 0.9, 5.0, 0.6, 0.3), [(0.5, K0), (0.72, grey(0.55))]))
    if speck:
        out = t.mix(out, t.ramp(t.noise(v, scale * 12, 2.0, 0.5), [(0.3, grey(1 - speck)), (0.62, K1)]), 1.0, "MULTIPLY")
    out = t.grime(out, 0.0, 2.6, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rough, "metal": metal, "spec": 0.4, "coat": coat})
    if bump:
        t.bump(t.noise(v, scale * 4, 4.0, 0.6), bump, 0.01)
    MATS[name] = t.m
    return t.m


def fire(name, lo, mid, hi, strength=5.0, scale=2.6, cut=0.42, speed=1.4):
    """A furnace's light behind a window: dark crust to hot yellow by a noise that drifts round a circle over the loop."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    v = t.coords()
    mp = v.node
    n = t.noise(v, scale, 4.0, 0.6, 0.6)
    c = t.ramp(n, [(cut - 0.14, kit.srgb(*lo)), (cut, kit.srgb(*mid)), (cut + 0.2, kit.srgb(*hi))])
    t.set(**{"Base Color": c, "rough": 0.8})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = strength
    FIRES.append((mp, (rnd.uniform(3, 9), rnd.uniform(3, 9), rnd.uniform(3, 9)), speed))
    MATS[name] = t.m
    return t.m


def glow(name, col, strength):
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    t.set(**{"Base Color": kit.srgb(*col), "rough": 0.5})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(*col)
    t.bsdf.inputs["Emission Strength"].default_value = strength
    MATS[name] = t.m
    return t.m


def lerp(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


# how polished the tier is: 0 = Flash look 1's rust, 1 = look 2's bright copper
SHINE = {1: 0.0, 2: 0.55, 3: 1.0}[T]


def m_body():
    return mat("body", lerp((126, 70, 40), (128, 62, 22), SHINE), rough=0.75 - 0.43 * SHINE, metal=0.1 + 0.7 * SHINE,
               wear=lerp((226, 128, 66), (236, 142, 58), SHINE), rust=lerp((44, 26, 18), (50, 26, 12), SHINE),
               rust_at=0.5 + 0.08 * SHINE, scale=4.6 - 0.6 * SHINE, hard=T < 3, wear_amt=0.85 - 0.15 * SHINE, streak=lerp((60, 36, 24), (80, 40, 16), SHINE),
               top=lerp((104, 64, 46), (128, 62, 22), SHINE), mottle=0.5, speck=0.1 * SHINE, bump=0.03 + 0.04 * SHINE,
               bands=lerp((50, 28, 18), (70, 34, 12), SHINE) if T < 3 else None)


def m_trim():
    return mat("trim", lerp((98, 60, 40), (140, 74, 26), SHINE), rough=0.65 - 0.3 * SHINE, metal=0.2 + 0.55 * SHINE,
               wear=lerp((152, 96, 66), (214, 136, 60), SHINE), rust=lerp((50, 32, 24), (70, 36, 14), SHINE), scale=5.0)


def m_yellow():
    return mat("yellow", (212, 134, 26), rough=0.42, metal=0.35, wear=(250, 198, 80), rust=(150, 80, 20), rust_at=0.58,
               scale=3.0, streak=(130, 64, 16), dirt=0.6)


def m_orange():
    return mat("orange", (190, 104, 22), rough=0.5, metal=0.3, wear=(232, 156, 54), rust=(120, 60, 16), scale=4.0)


def m_pipe():
    return mat("pipe", lerp((232, 112, 66), (204, 98, 40), SHINE), rough=0.5 - 0.2 * SHINE, metal=0.3 + 0.45 * SHINE,
               wear=lerp((255, 152, 104), (246, 160, 90), SHINE), rust=lerp((170, 70, 44), (130, 60, 24), SHINE), scale=4.0,
               dirt=0.1, mottle=0.3)


def m_olive():
    return mat("olive", (170, 118, 40), rough=0.5, metal=0.4, rust=(74, 46, 20), rust_at=0.64, scale=5.0,
               dirt=0.2, speck=0.0, mottle=0.12, bump=0.02, hard=True)


def m_neck():
    return mat("neck", (140, 128, 96), rough=0.6, metal=0.2, wear=(188, 178, 146), rust=(84, 72, 50), scale=6.0, dirt=0.1)


def m_cab():
    return mat("cab", lerp((140, 94, 40), (184, 88, 30), SHINE), rough=0.6 - 0.25 * SHINE, metal=0.2 + 0.55 * SHINE,
               wear=lerp((204, 152, 64), (220, 130, 56), SHINE), rust=lerp((80, 52, 30), (64, 34, 16), SHINE), scale=5.0, dirt=0.1)


def m_dark():
    return mat("dark", (60, 58, 52), rough=0.7, metal=0.3, wear=(92, 92, 84), scale=6.0)


def m_soot():
    return mat("soot", (26, 20, 18), rough=0.9, speck=0.0, bump=0.0)


def m_foot():
    return mat("foot", (50, 36, 30), rough=0.75, wear=(84, 60, 46), scale=6.0)


def m_spike():
    return mat("spike", (226, 220, 198), rough=0.5, wear=(250, 246, 230), rust=(170, 160, 130), scale=8.0, dirt=0.05)


def m_steel():
    return mat("steel", (116, 124, 128), rough=0.4, metal=0.7, wear=(176, 186, 190), rust=(74, 76, 76), scale=5.0, dirt=0.15)


def m_flange():
    if T < 3:
        return m_olive()
    return mat("flange", lerp((178, 114, 98), (150, 150, 146), SHINE), rough=0.6, metal=0.2 + 0.4 * SHINE,
               wear=lerp((210, 150, 130), (196, 198, 196), SHINE), rust=(110, 70, 60), scale=6.0)


def m_brick():
    return mat("brick", (206, 120, 44), rough=0.4, metal=0.45, wear=(238, 172, 86), rust=(92, 48, 18), scale=6.0, mottle=0.3, ao_min=0.05, top=(255, 196, 104), speck=0.08,
               streak=(120, 72, 30))


def m_plate():
    return mat("plate", (150, 142, 116), rough=0.6, metal=0.4, wear=(196, 190, 160), rust=(96, 86, 66), scale=6.0)


def m_coal():
    return mat("coal", (30, 26, 26), rough=0.7, wear=(78, 74, 76), rust=(10, 8, 8), scale=9.0, speck=0.3, dirt=0.0,
               ao_min=0.2)


# ------------------------------------------------------------------------------------------------------------ meshes
class B:
    """A mesh in the making, in world coordinates."""

    def __init__(self):
        self.bm = bmesh.new()

    def lathe(self, prof, at=(0, 0, 0), n=48, mi=0, M=None):
        """Spin a (r, z) profile round the upright through `at` (or round M's Z); r = 0 at an end closes it."""
        M = M or Matrix.Translation(Vector(at))
        rows = []
        for r, z in prof:
            if r <= 1e-6:
                rows.append([self.bm.verts.new(M @ Vector((0, 0, z)))])
            else:
                rows.append([self.bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z)))
                             for i in range(n)])
        for a, b in zip(rows, rows[1:]):
            for i in range(n):
                j = (i + 1) % n
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    f = self.bm.faces.new((a[0], b[j], b[i]))
                elif len(b) == 1:
                    f = self.bm.faces.new((a[i], a[j], b[0]))
                else:
                    f = self.bm.faces.new((a[i], a[j], b[j], b[i]))
                f.material_index = mi
        return rows

    def tube(self, pts, r, n=20, mi=0, caps=True, sides=None, twist=0.0):
        """A pipe through pts; r a number or one per point; sides = 4 with twist (deg) makes a square duct.
        Returns the rings [(centre, [verts])]."""
        pts = [Vector(p) for p in pts]
        m = len(pts)
        rs = r if isinstance(r, (list, tuple)) else [r] * m
        n = sides or n
        tans = [(pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(m)]
        u = tans[0].cross(Vector((1, 0, 0)))
        if u.length < 0.3:
            u = tans[0].cross(Vector((0, 1, 0)))
        u.normalize()
        rings = []
        for i in range(m):
            u = (u - tans[i] * u.dot(tans[i])).normalized()
            w = tans[i].cross(u)
            ring = []
            for j in range(n):
                a = 2 * math.pi * j / n + math.radians(twist)
                k = rs[i] * (R2 if sides == 4 else 1.0)
                ring.append(self.bm.verts.new(pts[i] + (u * math.cos(a) + w * math.sin(a)) * k))
            rings.append((pts[i], ring))
        for (_, a), (_, b) in zip(rings, rings[1:]):
            for j in range(n):
                q = (j + 1) % n
                self.bm.faces.new((a[j], a[q], b[q], b[j])).material_index = mi
        if caps:
            self.bm.faces.new(rings[0][1][::-1]).material_index = mi
            self.bm.faces.new(rings[-1][1]).material_index = mi
        return rings

    def box(self, size, M, mi=0, taper=1.0):
        """A box size (x, y, z) centred on M's origin; taper narrows its top."""
        sx, sy, sz = (s / 2 for s in size)
        vs = []
        for z in (-sz, sz):
            k = taper if z > 0 else 1.0
            for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
                vs.append(self.bm.verts.new(M @ Vector((x * k, y * k, z))))
        for q in ((3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.bm.faces.new([vs[i] for i in q]).material_index = mi
        return vs

    def shell(self, r0, r1, a0, a1, z0, z1, at=(0, 0, 0), n=12, mi=0):
        """A curved slab round the upright through at: radii r0..r1, screen bearings a0..a1 (deg), heights z0..z1."""
        at = Vector(at)
        cols = []
        for i in range(n + 1):
            d = D(a0 + (a1 - a0) * i / n)
            cols.append([self.bm.verts.new(at + d * r + UP * z) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
        for a, b in zip(cols, cols[1:]):
            for j in range(4):
                q = (j + 1) % 4
                self.bm.faces.new((a[j], a[q], b[q], b[j])).material_index = mi
        self.bm.faces.new(cols[0]).material_index = mi
        self.bm.faces.new(cols[-1][::-1]).material_index = mi

    def prism(self, poly, d, M, mi=0):
        """A flat outline poly [(x, y)] in M's XY, d thick (centred on the plane)."""
        lo = [self.bm.verts.new(M @ Vector((x, y, -d / 2))) for x, y in poly]
        hi = [self.bm.verts.new(M @ Vector((x, y, d / 2))) for x, y in poly]
        n = len(poly)
        self.bm.faces.new(lo[::-1]).material_index = mi
        self.bm.faces.new(hi).material_index = mi
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((lo[i], lo[j], hi[j], hi[i])).material_index = mi

    def ob(self, name, mats, smooth=True, bevel=0.0, parent=None, sharp=42.0, segs=2):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        o = kit.mesh_ob(name, self.bm, mats, smooth=smooth, bevel=bevel, segs=segs, parent=parent)
        if smooth and not bevel:
            try:
                o.data.set_sharp_from_angle(angle=math.radians(sharp))
            except AttributeError:
                pass
        return o


def one(name, mats, fn, parent=None, smooth=True, bevel=0.0, sharp=42.0):
    b = B()
    fn(b)
    return b.ob(name, mats, smooth=smooth, bevel=bevel, parent=parent, sharp=sharp)


def frame_at(p, x, z):
    """Matrix at p with local X along x and local Z along z (made square)."""
    z = Vector(z).normalized()
    x = Vector(x)
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = Vector(p)
    return M


def mover(name):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    kit.MOVING.append(e)
    return e


# ------------------------------------------------------------------------------------------------------------ animation
BULGES = []         # (object, rest [(centre, offset, s)], t0, t1, amp, width, reverse)
SPINS = []          # (hub, degrees a loop)
LUMPS = []          # (object, rest location, rest rotation, amplitude, turns, phase)


def freeze(bb, rings):
    """A tube's rings as (centre, [(vertex index, position)]), taken before the mesh is made."""
    bb.bm.verts.index_update()
    return [(c, [(v.index, v.co.copy()) for v in ring]) for c, ring in rings]


def bulging(ob, rings, t0, t1, amp, width, s0=0.0, s1=1.0, reverse=False):
    """Let a lump travel along a tube made by B.tube (one object, its vertices in ring order): the rings between path
    fractions s0..s1 swell by `amp` as the lump passes, between loop fractions t0..t1."""
    lens = [0.0]
    for (a, _), (b, _) in zip(rings, rings[1:]):
        lens.append(lens[-1] + (b - a).length)
    rest = {}
    for (c, ring), ln in zip(rings, lens):
        s = ln / lens[-1]
        for i, co in ring:
            rest[i] = (c.copy(), co - c, s)
    BULGES.append((ob, rest, t0, t1, amp, width, s0, s1, reverse))


def turn(k):
    f = (k % N) / N
    for ob, rest, t0, t1, amp, width, s0, s1, reverse in BULGES:
        me = ob.data
        u = (f - t0) / (t1 - t0)
        on = 0.0 <= u <= 1.0
        pos = s0 - 2.2 * width + (s1 - s0 + 4.4 * width) * u
        if reverse:
            pos = s0 + s1 - pos
        for i, (c, off, s) in rest.items():
            g = 0.0
            if on and s0 - 1e-6 <= s <= s1 + 1e-6:
                edge = min(1.0, (s - s0) / (0.6 * width), (s1 - s) / (0.6 * width))       # no swelling at the fixed ends
                g = amp * math.exp(-((s - pos) / width) ** 2) * max(0.0, edge)
            me.vertices[i].co = c + off * (1.0 + g)
        me.update()
    for hub, deg in SPINS:
        hub.rotation_euler = (0, 0, math.radians(deg * f))
    for ob, loc, rot, amp, turns, ph in LUMPS:
        a = 2 * math.pi * (f * turns[0] + ph)
        ob.location = loc + Vector((amp * 0.5 * math.sin(a + 1.3), amp * 0.5 * math.cos(a * 1.0 + 0.4), amp * math.sin(a)))
        ob.rotation_euler = (rot[0] + 2 * math.pi * f * turns[1] + 0.5 * amp * math.sin(a),
                             rot[1] + 2 * math.pi * f * turns[2], rot[2] + 0.6 * amp * math.cos(a))
    for mp, c, speed in FIRES:
        a = 2 * math.pi * f
        mp.inputs["Location"].default_value = (c[0] + speed * math.cos(a), c[1] + speed * math.sin(a), c[2] + 0.5 * speed * math.sin(2 * a))


# ============================================================================================================ the parts
TOP = {1: 4.0, 2: 4.4, 3: 4.4}[T]          # the drum's top
RD = 2.25                                    # the drum's radius
TUR = P(0.64, -0.87)                         # the turret's axis on the drum's top
TR = 0.7                                     # the turret's radius
INT = {1: Vector((-0.05, -4.8, 0)), 2: Vector((-0.05, -4.8, 0)), 3: Vector((0.22, -4.46, 0))}[T]     # the intake's axis
RIS = P(-2.15, 2.97)                         # the riser's axis (where the copper pipe ends), above the intake's top
FUN = P(-3.4, 2.97)                          # the funnel's axis
WIN = (-22.0, 76.0)                          # the window band's bearings
RISER_TOP = 0.0


def legs():
    for i in range(6):
        phi = 24 + 60 * i
        d = D(phi)
        side = UP.cross(d)
        if T < 3:
            one("leg-%d" % i, [m_dark()], lambda b, d=d, side=side: b.box((0.46, 0.4, 0.8), frame_at(d * 1.98 + UP * 0.62, side, UP + d * 0.25)), bevel=0.06)
            one("legfoot-%d" % i, [m_foot()], lambda b, d=d, side=side: b.box((0.56, 0.5, 0.26), frame_at(d * 2.12 + UP * 0.13, side, UP), taper=0.86), bevel=0.07)
        else:
            def claw(b, d=d, side=side):
                M = frame_at(d * 2.0 + UP * 0.6, d, side)          # the plate's plane holds d and up
                b.prism([(-0.25, 0.5), (0.15, 0.62), (0.62, 0.1), (0.5, -0.6), (0.3, -0.6), (0.34, -0.1), (0.1, 0.12), (-0.3, 0.2)], 0.16, M)
            one("leg-%d" % i, [m_steel()], claw, smooth=False, bevel=0.03)
            one("legfoot-%d" % i, [m_steel()], lambda b, d=d, side=side: b.box((0.34, 0.3, 0.1), frame_at(d * 2.42 + UP * 0.05, side, UP)), smooth=False, bevel=0.02)


def drum():
    if T == 1:
        prof = [(0.0, 0.5), (1.3, 0.52), (1.85, 0.85), (2.15, 1.4), (RD, 1.95), (RD, 3.42), (RD + 0.07, 3.46), (RD + 0.07, TOP - 0.06),
                (RD, TOP), (2.02, TOP), (1.96, TOP - 0.05), (1.86, TOP - 0.05), (1.8, TOP), (0.0, TOP + 0.02)]
    else:
        prof = [(0.0, 0.5), (1.3, 0.52), (1.85, 0.85), (2.15, 1.4), (RD, 1.95), (RD, 3.62), (RD + 0.08, 3.68), (RD + 0.08, 4.0),
                (RD, 4.06), (2.05, 4.2), (1.6, 4.38), (0.9, 4.5), (0.0, 4.55)]
    one("drum", [m_body()], lambda b: b.lathe(prof, n=72), sharp=35)
    if T >= 2:
        def rivets(b):
            for i in range(24):
                d = D(i * 15 + 4)
                M = frame_at(d * (RD + 0.08) + UP * 3.84, UP, d)
                b.lathe([(0.085, 0.0), (0.075, 0.035), (0.0, 0.05)], n=8, M=M)
        one("drumrivets", [m_dark()], rivets)
    else:
        one("drumring", [m_dark()], lambda b: b.lathe([(RD + 0.01, 3.3), (RD + 0.05, 3.32), (RD + 0.05, 3.4), (RD + 0.01, 3.42)], n=72))
        one("drumlid", [m_body()], lambda b: b.lathe([(1.98, TOP - 0.02), (1.9, TOP + 0.05), (0.9, TOP + 0.24), (0.0, TOP + 0.24)], n=64), sharp=30)
        one("drumhoops", [m_body()], lambda b: [b.lathe([(RD - 0.01, z), (RD + 0.06, z + 0.03), (RD + 0.06, z + 0.15), (RD - 0.01, z + 0.18)], n=72) for z in (2.95, 1.72)])


def windows():
    a0, a1 = WIN
    mv = mover("fire")
    n = 7 if T == 1 else 6
    step = (a1 - a0) / n
    lit = a0 + step * 5
    if T == 1:
        z0, z1 = 2.06, 2.68
        one("winframe", [m_trim()], lambda b: (b.shell(RD - 0.02, RD + 0.07, a0 - 3, a1 + 3, z0 - 0.12, z0, n=24),
                                               b.shell(RD - 0.02, RD + 0.07, a0 - 3, a1 + 3, z1, z1 + 0.1, n=24),
                                               b.shell(RD - 0.02, RD + 0.07, a0 - 3, a0, z0, z1, n=1),
                                               b.shell(RD - 0.02, RD + 0.07, a1, a1 + 3, z0, z1, n=1)), bevel=0.02)

        def bars(b):
            for i in range(1, n):
                a = a0 + step * i
                b.shell(RD - 0.02, RD + 0.05, a - 1.5, a + 1.5, z0, z1, n=1)
        one("winbars", [m_soot()], bars)
        gl = fire("glass", (176, 60, 8), (246, 170, 40), (255, 232, 120), strength=1.0, scale=0.7, cut=0.5, speed=0.3)
        one("glass", [gl], lambda b: b.shell(RD - 0.01, RD + 0.012, a0, lit, z0, z1, n=24), parent=mv)
        one("glassdim", [glow("glassdim", (120, 44, 10), 0.4)], lambda b: b.shell(RD - 0.01, RD + 0.012, lit, a1, z0, z1, n=8))
    else:
        z0, z1 = 2.08, 2.72

        def frame(b):
            b.shell(RD - 0.02, RD + 0.2, a0 - 6, a1 + 6, z0 - 0.38, z0, n=24)
            b.shell(RD - 0.02, RD + 0.2, a0 - 6, a1 + 6, z1, z1 + 0.36, n=24)
            b.shell(RD - 0.02, RD + 0.2, a0 - 8, a0, z0 - 0.3, z1 + 0.3, n=2)
            b.shell(RD - 0.02, RD + 0.2, a1, a1 + 8, z0 - 0.3, z1 + 0.3, n=2)
        one("winframe", [mat("wframe", lerp((150, 90, 50), (206, 112, 40), SHINE), rough=0.4, metal=0.6, wear=(250, 172, 84), rust=(110, 56, 20), scale=5.0, mottle=0.3)], frame, bevel=0.07)

        def bars(b):
            for i in range(1, n):
                a = a0 + step * i
                b.shell(RD + 0.0, RD + 0.1, a - 1.3, a + 1.3, z0, z1, n=1)
        one("winbars", [m_trim()], bars, bevel=0.015)
        gl = fire("glass", (60, 12, 4), (236, 96, 16), (255, 196, 70), strength=1.25, scale=2.4, cut=0.5, speed=1.5)
        one("glass", [gl], lambda b: b.shell(RD - 0.01, RD + 0.015, a0, a1, z0, z1, n=24), parent=mv)


def turret():
    c = TUR
    z = TOP + (0.0 if T == 1 else 0.1)
    if T == 1:
        H = 1.6
        one("turret", [m_body()], lambda b: b.lathe([(TR + 0.06, z), (TR + 0.06, z + 0.34), (TR, z + 0.38), (TR, z + H), (0.0, z + H)], at=c, n=40))
        mv = mover("slits")
        gl = glow("slit", (255, 206, 60), 1.3)

        def slits(b):
            for a in (-34, -8, 18):
                b.shell(TR + 0.055, TR + 0.075, a, a + 16, z + 0.06, z + 0.3, at=c, n=3)
        one("slits", [gl], slits, parent=mv)
        one("turretpanel", [m_trim()], lambda b: b.shell(TR - 0.01, TR + 0.045, 10, 70, z + 0.5, z + 1.35, at=c, n=8), bevel=0.02)
        one("lamp", [glow("lamp", (255, 30, 14), 2.5)], lambda b: b.lathe([(0.0, -0.02), (0.1, 0.0), (0.085, 0.06), (0.0, 0.09)], n=12,
                                                                        M=frame_at(c + D(82) * (TR + 0.03) + UP * (z + 0.72), UP, D(82))))
        zc = z + H
    else:
        H = 1.5
        one("turret", [m_trim()], lambda b: (b.lathe([(TR + 0.1, z - 0.3), (TR + 0.1, z + 0.14), (TR - 0.02, z + 0.2), (0.0, z + 0.2)], at=c, n=40),
                                             b.lathe([(TR + 0.02, z + H - 0.3), (TR + 0.1, z + H - 0.24), (TR + 0.06, z + H - 0.1),
                                                      (TR * 0.72, z + H + 0.12), (0.0, z + H + 0.2)], at=c, n=40)), sharp=30)

        def bars(b):
            for i in range(8):
                d = D(i * 45 + 12)
                b.tube([c + d * (TR - 0.05) + UP * (z + 0.15), c + d * (TR - 0.05) + UP * (z + H - 0.26)], 0.085, n=8)
        one("turretbars", [m_dark()], bars)
        mv = mover("lantern")
        gl = fire("lantern", (60, 12, 4), (236, 100, 18), (255, 200, 76), strength=1.3, scale=3.2, cut=0.42, speed=1.5)
        one("lanternfire", [gl], lambda b: b.lathe([(TR - 0.2, z + 0.18), (TR - 0.2, z + H - 0.28)], at=c, n=24), parent=mv)
        zc = z + H + 0.12
    if T < 3:
        zk = zc
        # a flat spiked brim, then the neck the copper pipe leaves by
        one("collar", [m_body()], lambda b: b.lathe([(TR - 0.05, zk - 0.04), (0.9, zk + 0.03), (0.97, zk + 0.1), (0.9, zk + 0.2), (0.5, zk + 0.3), (0.0, zk + 0.3)], at=c, n=40), sharp=30)

        def spikes(b):
            for i in range(6):
                d = D(i * 60)
                M = frame_at(c + d * 0.86 + UP * (zk + 0.12), UP, d + UP * 0.1)
                b.lathe([(0.12, 0.0), (0.09, 0.14), (0.0, 0.6)], n=10, M=M)
        one("spikes", [m_spike()], spikes)
        one("neck", [m_neck() if T == 1 else m_steel()], lambda b: b.lathe([(0.33, zk + 0.25), (0.33, zk + 0.55), (0.42, zk + 0.58), (0.42, zk + 0.85), (0.3, zk + 0.9),
                                                                             (0.3, zk + 1.15), (0.0, zk + 1.15)], at=c, n=24), sharp=30)
        return zk + 1.15
    zs = zc + 0.62
    one("neck", [m_dark()], lambda b: b.lathe([(0.34, zc - 0.05), (0.34, zs + 0.2), (0.46, zs + 0.22), (0.46, zs + 0.36), (0.0, zs + 0.36)], at=c, n=24))
    e = bpy.data.objects.new("star", None)
    kit.link(e)
    e.location = c + UP * zs
    hub = bpy.data.objects.new("star-spin", None)
    kit.link(hub, e)
    kit.MOVING.append(hub)
    SPINS.append((hub, 135.0))

    def star(b):
        pts = []
        for i in range(16):
            a = 2 * math.pi * i / 16
            r = 1.72 if i % 2 == 0 else 0.86
            pts.append((r * math.cos(a), r * math.sin(a)))
        b.prism(pts, 0.14, Matrix.Identity(4))
        for v in b.bm.verts:                      # the points droop a little, as a shallow cone
            v.co.z -= 0.16 * (math.hypot(v.co.x, v.co.y) - 0.86)
    one("starplate", [mat("starsteel", (92, 72, 52), rough=0.45, metal=0.6, wear=(156, 134, 100), rust=(50, 38, 28), scale=3.0, dirt=0.0)],
        star, parent=hub, smooth=False, bevel=0.03)
    return zs + 0.36


def resample(pts, n):
    pts = [Vector(p) for p in pts]
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + (b - a).length)
    out = []
    j = 0
    for i in range(n + 1):
        d = lens[-1] * i / n
        while j < len(pts) - 2 and lens[j + 1] < d:
            j += 1
        k = (d - lens[j]) / max(1e-9, lens[j + 1] - lens[j])
        out.append(pts[j].lerp(pts[j + 1], k))
    return out


def copper_pipe(z_tur):
    """From the turret's neck up, across and down into the riser; the lump travels from the turret to the riser."""
    a = TUR + UP * (z_tur - 0.05)
    top_a = {1: 7.78, 2: 8.5, 3: 8.5}[T]             # the run's height over the turret
    top_b = {1: 10.1, 2: 10.1, 3: 10.02}[T]             # and over the riser
    r = 0.245 if T < 3 else 0.3
    b0 = RIS + UP * RISER_TOP
    pa, pb = TUR + UP * top_a, RIS + UP * top_b
    run = (pb - pa).normalized()
    bend = 0.42
    pts = [a]
    for i in range(1, 9):
        u = i / 8
        pts.append(pa - UP * bend * (1 - math.sin(u * math.pi / 2)) + run * bend * (1 - math.cos(u * math.pi / 2)))
    end = pb - run * bend
    pts.append(end)
    for i in range(1, 9):
        u = i / 8
        pts.append(end + run * bend * math.sin(u * math.pi / 2) - UP * bend * (1 - math.cos(u * math.pi / 2)))
    pts.append(b0 - UP * 0.05)
    pts = resample(pts, 70)
    mv = mover("cpipe")
    bb = B()
    rings = freeze(bb, bb.tube(pts, r, n=16))
    o = bb.ob("cpipe-tube", [m_pipe()], parent=mv)
    if T == 1:
        bulging(o, rings, 0.06, 0.66, 0.45, 0.07)
    else:
        bulging(o, rings, 0.5, 0.84, 0.5, 0.075)


def intake():
    """Tiers 1-2: the yellow pipe from the ground and its fat elbow toward the cabinet. Tier 3: the brick stack.
    Returns the height the riser stands on."""
    c = INT
    if T < 3:
        zf = 4.2                     # the flange under the elbow
        R, RE, bend = 0.7, 0.95, 1.15
        mv = mover("ypipe")
        bb = B()
        rings = freeze(bb, bb.tube(resample([c + UP * 0.1, c + UP * (zf - 0.1)], 30), R, n=28))
        o = bb.ob("ypipe-tube", [m_yellow()], parent=mv)
        if T == 1:
            bulging(o, rings, 0.02, 0.5, 0.26, 0.1, 0.1, 0.97)
        else:
            bulging(o, rings, 0.04, 0.48, 0.26, 0.1, 0.42, 0.97)
        # the elbow: fatter than the pipe, bending to the screen's right, ribs across it
        cb = c + SR * bend + UP * zf
        pts = [c + UP * (zf - 0.05)] + [cb - SR * bend * math.cos(math.pi / 2 * i / 14) + UP * bend * math.sin(math.pi / 2 * i / 14) for i in range(15)]
        pts.append(cb + SR * 0.12 + UP * bend)
        bb2 = B()
        rings2 = freeze(bb2, bb2.tube(resample(pts, 30), RE, n=32))
        o2 = bb2.ob("ypipe-elbow", [m_yellow()], parent=mv)
        bulging(o2, rings2, 0.4, 0.72, 0.15, 0.12)
        for j, i in enumerate((5, 10)):
            p = cb - SR * bend * math.cos(math.pi / 2 * i / 14) + UP * bend * math.sin(math.pi / 2 * i / 14)
            tn = SR * math.sin(math.pi / 2 * i / 14) + UP * math.cos(math.pi / 2 * i / 14)
            one("yrib-%d" % j, [m_orange()], lambda b, p=p, tn=tn: b.lathe([(RE - 0.02, -0.05), (RE + 0.035, -0.04), (RE + 0.035, 0.04), (RE - 0.02, 0.05)], n=32, M=frame_at(p, SF, tn)))
        one("yflange", [m_yellow()], lambda b: b.lathe([(R + 0.02, zf - 0.34), (RE + 0.12, zf - 0.3), (RE + 0.12, zf - 0.04), (RE, zf)], at=c, n=36), sharp=30)
        M = frame_at(cb + SR * 0.1 + UP * bend, SF, SR)
        one("ymouth", [m_orange()], lambda b: b.lathe([(RE - 0.3, -0.12), (RE + 0.2, -0.1), (RE + 0.2, 0.1), (RE - 0.3, 0.12)], n=36, M=M), sharp=30)
        one("ythroat", [m_soot()], lambda b: b.lathe([(0.0, 0.0), (RE - 0.28, 0.0)], n=24, M=frame_at(cb + SR * 0.2 + UP * bend, SF, SR)))
        if T == 1:
            one("ycollar", [mat("ybase", (116, 46, 30), rough=0.7, wear=(160, 76, 50), rust=(60, 26, 18), scale=4.0, speck=0.0)], lambda b: b.lathe([(R + 0.14, 0.0), (R + 0.14, 0.42), (R + 0.02, 0.5)], at=c, n=36), sharp=30)
            one("yrib", [m_orange()], lambda b: b.box((0.2, 0.26, 1.5), frame_at(c + D(-80) * (R + 0.06) + UP * 0.75, D(-80), UP)), bevel=0.05)
        else:
            S = 1.72
            M0 = Rz(38, c)
            one("stackplate", [m_plate()], lambda b: b.box((S + 0.7, S + 0.7, 0.2), M0 @ Matrix.Translation((0, 0, 0.1))), smooth=False, bevel=0.04)
            for i in range(2):
                one("stackbrick-%d" % i, [m_brick()], lambda b, i=i: b.box((S, S, 0.9), M0 @ Matrix.Translation((0, 0, 0.2 + 0.47 + 0.95 * i))), smooth=False, bevel=0.07)
            one("stackbolts", [m_dark()], lambda b: [b.lathe([(0.09, 0), (0.07, 0.05), (0, 0.06)], n=8, M=M0 @ Matrix.Translation((sx * (S / 2 + 0.2), sy * (S / 2 + 0.2), 0.2)))
                                                     for sx in (-1, 1) for sy in (-1, 1)])
        return zf + bend + RE
    S = 1.86
    M0 = Rz(38, c)
    one("stackplate", [m_plate()], lambda b: b.box((S + 0.86, S + 0.86, 0.22), M0 @ Matrix.Translation((0, 0, 0.11))), smooth=False, bevel=0.04)
    one("stackbolts", [m_dark()], lambda b: [b.lathe([(0.1, 0), (0.08, 0.05), (0, 0.07)], n=8, M=M0 @ Matrix.Translation((sx * (S / 2 + 0.25), sy * (S / 2 + 0.25), 0.22)))
                                             for sx in (-1, 1) for sy in (-1, 1)])
    zs = [0.22]
    rs = [S / 2]
    course = 0.8
    for i in range(4):
        z0 = 0.22 + course * i
        for z, k in ((z0 + 0.035, 0.86), (z0 + 0.045, 1.0), (z0 + course - 0.045, 1.0), (z0 + course - 0.035, 0.86)):
            zs.append(z)
            rs.append(S / 2 * k)
    zb = 0.22 + course * 4                         # the band
    for z, k in ((zb + 0.02, 0.95), (zb + 0.06, 1.1), (zb + 0.56, 1.1), (zb + 0.6, 0.98)):
        zs.append(z)
        rs.append(S / 2 * k)
    zh = zb + 0.6
    for i in range(1, 13):                          # the head, rounding in at the top
        u = i / 12
        zs.append(zh + 2.49 * u)
        rs.append(S / 2 * (1 + 0.07 * math.sin(math.pi * min(u, 0.9) / 0.9)) * math.sqrt(max(0.1, 1 - (max(0.0, u - 0.74) / 0.26) ** 2 * 0.5)))
    mv = mover("stack")
    bb = B()
    rings = freeze(bb, bb.tube([c + UP * z for z in zs], rs, sides=4, twist=-7))
    o = bb.ob("stack-duct", [m_brick()], parent=mv, smooth=False, bevel=0.022, segs=2)
    bulging(o, rings, 0.04, 0.5, 0.2, 0.11, 0.03, 0.97)
    return zs[-1]


def cabinet():
    """The feed box on the drum's top, left of the turret, and the coal chute from its mouth (-Y side): a closed-sided
    trough sloping over the drum's rim and down into a feed hood on the drum's side."""
    bx0, by0 = -2.04, -0.65
    bx1, by1, h = (-0.48, 0.2, 0.92) if T == 1 else (-0.3, 0.3, 1.15)
    xm, ym = (bx0 + bx1) / 2, (by0 + by1) / 2
    zt = TOP + h
    one("cabinet", [m_trim() if T == 1 else m_body()], lambda b: b.box((bx1 - bx0, by1 - by0, h + 0.4), Matrix.Translation((xm, ym, TOP + h / 2 - 0.2))), smooth=False, bevel=0.05)
    one("cabinetlid", [m_trim() if T == 1 else m_body()], lambda b: b.box((bx1 - bx0 + 0.14, by1 - by0 + 0.14, 0.12), Matrix.Translation((xm, ym, zt + 0.04))), smooth=False, bevel=0.04)
    # the dark mouth in the box's front, over the coal
    one("cabinetmouth", [m_soot()], lambda b: b.box((bx1 - bx0 - 0.3, 0.04, min(h, 0.9) - 0.25), Matrix.Translation((xm, by0 - 0.01, TOP + min(h, 0.9) / 2 - 0.05))), smooth=False)
    # ---- the chute: a closed-sided trough from the box's mouth, sloping over the drum's rim and dropping down a steep
    # spout into a feed hood bolted on the drum's side wall (the furnace's coal door). One solid piece from the box to
    # the wall: the body under the bed runs back into the drum, the hood's cheeks and floor too.
    tx0, tx1 = -1.35, 0.4
    th = 0.1
    tm = (tx0 + tx1) / 2
    wi = tx1 - tx0 - th                                  # the trough's inside width
    A = (by0, TOP + 0.56)                                # the bed at the box's mouth (y, z)
    Bp = (-2.3, TOP + 0.04)                              # ... over the drum's rim
    C = (-2.5, TOP - 0.6)                                # ... the spout's end, inside the hood
    hz0, hz1 = TOP - 1.22, TOP - 0.42                     # the hood's floor and rim
    hy1 = -3.05 if T < 3 else -2.95                      # its front, at the rim and at the floor (it leans out)
    hy0 = hy1 + 0.3
    yw = -1.6                                            # well inside the drum's wall
    trim = m_trim() if T == 1 else m_body()

    def Myz(x):
        return frame_at((x, 0, 0), (0, 1, 0), (1, 0, 0))             # a prism's outline as (y, z), its thickness along x

    def bedz(y):
        if y >= Bp[0]:
            return A[1] + (Bp[1] - A[1]) * (A[0] - y) / (A[0] - Bp[0])
        return Bp[1] + (C[1] - Bp[1]) * (Bp[0] - y) / (Bp[0] - C[0])

    one("chutebody", [trim], lambda b: b.prism([A, Bp, C, (-2.2, C[1] - 0.34), (yw, C[1] - 0.34), (yw, TOP - 0.35), (A[0], TOP - 0.35)],
                                               tx1 - tx0 + th, Myz(tm)), smooth=False, bevel=0.02)
    one("chutebed", [m_soot()], lambda b: b.prism([A, Bp, C, (C[0] - 0.035, C[1] + 0.012), (Bp[0] - 0.03, Bp[1] + 0.03), (A[0], A[1] + 0.03)],
                                              wi, Myz(tm)), smooth=False)
    rail = [A, Bp, C, (C[0] - 0.3, C[1] + 0.1), (Bp[0] - 0.24, Bp[1] + 0.27), (A[0], A[1] + 0.33)]
    one("chuterails", [trim], lambda b: [b.prism(rail, th, Myz(x)) for x in (tx0, tx1)], smooth=False, bevel=0.03)
    if T < 3:                                            # Flash's yellow edge along the channel
        cap = [rail[5], rail[4], (rail[4][0] - 0.012, rail[4][1] + 0.035), (rail[5][0], rail[5][1] + 0.035)]
        one("chutecaps", [m_yellow()], lambda b: [b.prism(cap, th + 0.03, Myz(x)) for x in (tx0, tx1)], smooth=False, bevel=0.01)

    def hood(b):
        for x in (tx0 - th, tx1 + th):
            b.prism([(hy1, hz1), (yw, hz1), (yw, hz0), (hy0, hz0)], th, Myz(x))
        b.prism([(hy1, hz1), (hy1 + 0.1, hz1), (hy0 + 0.1, hz0), (hy0, hz0)], tx1 - tx0 + th, Myz(tm))
        b.prism([(hy0 + 0.05, hz0), (yw, hz0), (yw, hz0 + 0.1), (hy0 + 0.08, hz0 + 0.1)], tx1 - tx0 + th, Myz(tm))
    one("chutehood", [trim], hood, smooth=False, bevel=0.03)
    one("chutehoodlip", [m_trim() if T < 3 else m_body()], lambda b: b.box((tx1 - tx0 + 3 * th + 0.08, 0.16, 0.13), Matrix.Translation((tm, hy1 + 0.03, hz1))), smooth=False, bevel=0.03)
    one("chutehoodbolts", [m_dark()], lambda b: [b.lathe([(0.07, 0), (0.055, 0.04), (0, 0.05)], n=8, M=frame_at((tx1 + 1.5 * th, y, z), (0, 1, 0), (1, 0, 0)))
                                                 for y, z in ((hy1 + 0.22, hz1 - 0.16), (-2.38, hz1 - 0.16), (hy0 + 0.2, hz0 + 0.16), (-2.38, hz0 + 0.16))])
    # the dark inside of the hood: the way into the drum
    one("chutethroat", [m_soot()], lambda b: b.prism([(hy1 + 0.1, hz1 - 0.3), (yw, hz1 - 0.3), (yw, hz0 + 0.1), (hy0 + 0.1, hz0 + 0.1)], tx1 - tx0 + th, Myz(tm)), smooth=False)
    if T < 3:
        def cleats(b):
            for y in (-1.5, -1.78, -2.06):
                b.box((wi - 0.02, 0.1, 0.05), frame_at((tm, y, bedz(y) + 0.04), (1, 0, 0), (0, A[1] - Bp[1], A[0] - Bp[0])))
            for u in (0.3, 0.7):
                y = Bp[0] + (C[0] - Bp[0]) * u
                b.box((wi - 0.02, 0.1, 0.05), frame_at((tm, y - 0.045, bedz(y) + 0.015), (1, 0, 0), (0, C[1] - Bp[1], Bp[0] - C[0])))
        one("chutecleats", [mat("slat", (104, 96, 88), rough=0.45, metal=0.6, wear=(170, 164, 150), rust=(70, 52, 44), scale=7.0)], cleats, smooth=False, bevel=0.015)
    mv = mover("coal")
    rr = random.Random(5 if T < 3 else 9)
    amp = {1: 0.05, 2: 0.07, 3: 0.1}[T]
    big = T == 3
    for i in range(40 if not big else 24):                # the heap in the trough, thinning down the slope
        x = rr.uniform(tx0 + 0.22, tx1 - 0.22)
        y = rr.uniform(Bp[0] + 0.1, A[0] - 0.2)
        k = 0.3 + 0.7 * (y - Bp[0]) / (A[0] - Bp[0])
        r = rr.uniform(0.16, 0.25) if big else rr.uniform(0.1, 0.16)
        lump("coal-%d" % i, Vector((x, y, bedz(y) + 0.12 + rr.uniform(0, 0.5 if big else 0.32) * k)), r, mv, rr, amp)
    for i in range(7 if not big else 5):                  # sliding down the spout
        y = rr.uniform(C[0] + 0.03, Bp[0])
        r = rr.uniform(0.16, 0.22) if big else rr.uniform(0.1, 0.15)
        lump("coalr-%d" % i, Vector((rr.uniform(tx0 + 0.22, tx1 - 0.22), y - 0.13, bedz(y) + 0.06)), r, mv, rr, amp)
    for i in range(16 if not big else 10):                # heaped in the hood's mouth
        y = rr.uniform(hy1 + (0.32 if big else 0.26), C[0] - 0.06)
        r = rr.uniform(0.15, 0.2) if big else rr.uniform(0.1, 0.15)
        lump("coalc-%d" % i, Vector((rr.uniform(tx0 + (0.32 if big else 0.2), tx1 - (0.32 if big else 0.2)), y, hz1 - 0.2 + rr.uniform(0, 0.16))), r, mv, rr, amp)
    if T == 3:
        # the dark column under the hood, between the stack and the drum, and the pipes on it
        yf = hy0 - 0.06
        one("chute", [m_soot()], lambda b: b.box((tx1 - tx0 + 0.1, -2.3 - hy0, hz0 - 0.2), Matrix.Translation((tm, (hy0 - 2.3) / 2, (hz0 + 0.2) / 2))), smooth=False)

        def works(b):
            for x, z0, z1, r in ((tx0 + 0.25, 0.3, hz0 - 0.05, 0.1), (tx0 + 0.62, 0.9, hz0 - 0.25, 0.07), (tx1 - 0.3, 0.3, 2.3, 0.09)):
                b.tube([Vector((x, yf, z0)), Vector((x, yf, z1))], r, n=10)
            b.tube([Vector((tx0 + 0.1, yf - 0.04, 1.45)), Vector((tx1 - 0.05, yf - 0.04, 1.45))], 0.08, n=10)
            b.box((0.5, 0.2, 0.62), Matrix.Translation((tm + 0.2, yf, hz0 - 0.4)))
            b.box((0.7, 0.16, 0.2), Matrix.Translation((tm - 0.3, yf, 0.75)))
            for x, z in ((tx0 + 0.25, 2.1), (tx0 + 0.25, 1.0), (tx1 - 0.3, 1.9)):
                b.lathe([(0.16, -0.06), (0.16, 0.06)], n=12, M=Matrix.Translation((x, yf, z)))
        one("chuteworks", [mat("works", (96, 66, 42), rough=0.4, metal=0.7, wear=(196, 130, 70), rust=(26, 18, 14), scale=6.0)], works, bevel=0.02)


def lump(name, at, r, parent, rr, amp):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for v in bm.verts:
        v.co *= rr.uniform(0.72, 1.18)
    o = kit.mesh_ob(name, bm, [m_coal()], smooth=False, parent=parent)
    o.location = at
    rot = (rr.uniform(0, 6.3), rr.uniform(0, 6.3), rr.uniform(0, 6.3))
    o.rotation_euler = rot
    turns = (rr.choice((1, 2, 2, 3)), rr.choice((0, 0, 1, -1)) if T == 3 else 0, 0)
    LUMPS.append((o, at.copy(), rot, amp, turns, rr.random()))


def riser(z_in):
    """Stands on the intake's top; the copper pipe comes down into it; a bracket holds the funnel."""
    global RISER_TOP
    if T < 3:
        hc = P(-2.55, 2.97)                      # the housing's middle
        z0, z1 = z_in - 0.12, 7.5
        one("riserbox", [m_olive()], lambda b: b.lathe([(0.8, z0), (0.8, z1), (0.0, z1)], at=hc, n=32))
        # the band round it and the arm to the funnel
        one("riserband", [m_olive()], lambda b: (b.lathe([(0.8, z1 - 0.3), (0.87, z1 - 0.26), (0.87, z1 - 0.1), (0.8, z1 - 0.06), (0.8, z1 + 0.5), (0.6, z1 + 0.66), (0.0, z1 + 0.66)], at=hc, n=32),
                                                 b.box((1.0, 0.4, 0.34), frame_at((hc - SR * 0.6 + FUN) / 2 + UP * (z1 + 0.3), SR, UP))), sharp=30)
        zf = z1 + 0.66
        one("riserflange", [m_flange()], lambda b: b.lathe([(0.42, zf - 0.02), (0.42, zf + 0.22), (0.6, zf + 0.26), (0.6, zf + 0.52), (0.4, zf + 0.56), (0.0, zf + 0.56)], at=RIS, n=28), sharp=30)
        RISER_TOP = zf + 0.5
        zc = 9.1
        one("funnelstem", [m_olive()], lambda b: b.lathe([(0.2, z1 + 0.2), (0.2, zc), (0.0, zc)], at=FUN, n=20))
        one("funnel", [mat("cup", (168, 82, 50), rough=0.55, metal=0.3, wear=(214, 124, 84), rust=(90, 44, 30), scale=6.0)],
            lambda b: b.lathe([(0.24, zc - 0.08), (0.36, zc + 0.04), (0.4, zc + 0.5), (0.46, zc + 0.6), (0.4, zc + 0.62), (0.34, zc + 0.5)], at=FUN, n=28), sharp=30)
        one("funnelhole", [m_soot()], lambda b: b.lathe([(0.35, zc + 0.5), (0.0, zc + 0.44)], at=FUN, n=20))
        return
    nc = P(-2.4, 2.97)
    zb = 8.15
    one("riserneck", [m_pipe()], lambda b: b.lathe([(0.48, z_in - 0.5), (0.48, zb), (0.0, zb)], at=nc, n=28))
    mid = P(-2.85, 2.97)
    one("riserbracket", [m_steel()], lambda b: b.box((2.25, 1.0, 0.3), frame_at(mid + UP * (zb + 0.1), SR, UP)), smooth=False, bevel=0.05)
    one("riserbolts", [m_dark()], lambda b: [b.lathe([(0.09, 0), (0.07, 0.05), (0, 0.06)], n=8, M=Matrix.Translation(mid + SR * sx + SF * sy + UP * (zb + 0.25)))
                                             for sx in (-0.95, 0.0, 0.95) for sy in (-0.36, 0.36)])
    RISER_TOP = zb + 0.3
    zc = zb + 0.2
    one("funnel", [m_pipe()], lambda b: b.lathe([(0.3, zc), (0.32, zc + 0.6), (0.4, zc + 1.2), (0.52, zc + 1.7), (0.63, zc + 1.92), (0.57, zc + 1.92),
                                                  (0.3, zc + 1.3), (0.0, zc + 1.2)], at=FUN, n=32), sharp=30)
    one("funnelhole", [m_soot()], lambda b: b.lathe([(0.5, zc + 1.74), (0.0, zc + 1.45)], at=FUN, n=24))


# ------------------------------------------------------------------------------------------------------------ build
def build():
    legs()
    drum()
    windows()
    z_tur = turret()
    z_in = intake()
    cabinet()
    riser(z_in)
    copper_pipe(z_tur)


_border = kit.border_of


def border_all(objs, pad=10):
    """The moving parts' render region over the whole loop."""
    bs = []
    for k in range(0, N, 3):
        turn(k)
        bpy.context.view_layer.update()
        bs.append(_border(objs, pad))
    turn(0)
    bpy.context.view_layer.update()
    return min(b[0] for b in bs), max(b[1] for b in bs), min(b[2] for b in bs), max(b[3] for b in bs)


kit.border_of = border_all
kit.run(build, turn)
