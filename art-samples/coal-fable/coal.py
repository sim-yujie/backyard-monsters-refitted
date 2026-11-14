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
from the turret to the riser, the coal slides down the chute into the furnace's hatch, the fire flickers; at tier 3 the star turns. Everything is periodic
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
        speck=0.14, bump=0.07, ao_min=0.5, streak=None, bricks=None, coat=0.0, mottle=0.4, top=None, bands=None, hard=False, shade=None):
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
    if shade:                                      # (direction, k): faces turned toward `direction` are darkened to k
        geo = t.n("ShaderNodeNewGeometry")
        dot = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Normal"], dot.inputs[0])
        dot.inputs[1].default_value = tuple(Vector(shade[0]).normalized())
        out = t.mix(out, t.ramp(dot.outputs["Value"], [(0.15, K1), (0.6, (shade[1], shade[1] * 0.72, shade[1] * 0.4, 1))]), 1.0, "MULTIPLY")
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
    if T == 1:      # Flash look 1's drum wall: pink-brown plate (about 114, 71, 47 over all), hard rust blotches
        return mat("body", (210, 126, 80), rough=0.75, metal=0.1, wear=(246, 172, 120), rust=(78, 44, 28), rust_at=0.55, scale=3.6, hard=True,
                   wear_amt=0.9, streak=(70, 42, 28), top=(112, 70, 52), mottle=0.5, speck=0.0, bump=0.03)
    if T == 3:      # look 2's dome: blotchy brown copper, dull, not a mirror
        return mat("body", (140, 72, 28), rough=0.58, metal=0.45, wear=(206, 122, 54), rust=(62, 30, 12), rust_at=0.46, scale=3.0,
                   wear_amt=0.75, streak=(70, 36, 14), mottle=0.6, speck=0.12, bump=0.08)
    return mat("body", lerp((186, 108, 70), (128, 62, 22), SHINE), rough=0.75 - 0.43 * SHINE, metal=0.1 + 0.7 * SHINE,
               wear=lerp((236, 150, 96), (236, 142, 58), SHINE), rust=lerp((72, 42, 30), (50, 26, 12), SHINE),
               rust_at=0.5 + 0.04 * SHINE, scale=4.6 - 0.6 * SHINE, hard=T < 3, wear_amt=0.85 - 0.15 * SHINE, streak=lerp((60, 36, 24), (80, 40, 16), SHINE),
               top=lerp((104, 64, 46), (128, 62, 22), SHINE), mottle=0.5, speck=0.1 * SHINE, bump=0.03 + 0.04 * SHINE,
               bands=lerp((84, 48, 32), (70, 34, 12), SHINE) if T < 3 else None)


def m_trim():
    return mat("trim", lerp((132, 84, 58), (140, 74, 26), SHINE), rough=0.65 - 0.3 * SHINE, metal=0.2 + 0.55 * SHINE,
               wear=lerp((190, 128, 92), (214, 136, 60), SHINE), rust=lerp((70, 44, 32), (70, 36, 14), SHINE), scale=5.0)


def m_yellow():
    return mat("yellow", (250, 170, 56), rough=0.42, metal=0.2, wear=(255, 214, 104), rust=(168, 92, 26), rust_at=0.58,
               scale=3.0, streak=(140, 70, 18), dirt=0.4, mottle=0.25)


def m_orange():
    return mat("orange", (214, 120, 30), rough=0.5, metal=0.2, wear=(244, 172, 66), rust=(120, 60, 16), scale=4.0)


def m_pipe():
    return mat("pipe", lerp((244, 124, 78), (246, 130, 64), SHINE), rough=0.5 - 0.2 * SHINE, metal=0.3 + 0.3 * SHINE,
               wear=lerp((255, 152, 104), (246, 160, 90), SHINE), rust=lerp((170, 70, 44), (130, 60, 24), SHINE), scale=4.0,
               dirt=0.1, mottle=0.3)


def m_olive():
    return mat("olive", (204, 138, 48), rough=0.5, metal=0.3, wear=(236, 178, 84), rust=(112, 62, 36), rust_at=0.55, scale=4.0,
               dirt=0.3, speck=0.06, mottle=0.25, bump=0.03, hard=True)


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
        return mat("flange", lerp((184, 118, 98), (150, 120, 96), SHINE), rough=0.65, metal=0.15, wear=(222, 160, 136), rust=(104, 60, 46), rust_at=0.52, scale=6.0, hard=True)
    return mat("flange", lerp((178, 114, 98), (150, 150, 146), SHINE), rough=0.6, metal=0.2 + 0.4 * SHINE,
               wear=lerp((210, 150, 130), (196, 198, 196), SHINE), rust=(110, 70, 60), scale=6.0)


def m_brick():
    # Flash look 2's brass: gold-brown (about 182, 124, 65 where lit), its face toward the screen's right in shade
    return mat("brick", (252, 158, 64), rough=0.45, metal=0.2, dirt=0.6, wear=(255, 200, 100), rust=(120, 64, 24), scale=6.0, mottle=0.3, ao_min=0.05, top=(246, 190, 108), speck=0.1,
               streak=(110, 64, 28), shade=(SR - SF * 0.25, 0.55))


def m_pale():
    """The turret's brims at tiers 1-2: Flash's pale grey-pink metal."""
    return mat("pale", (190, 152, 136), rough=0.6, metal=0.15, wear=(226, 194, 178), rust=(112, 82, 68), rust_at=0.56, scale=6.0, dirt=0.1, hard=True, mottle=0.25)


def m_turret():
    return mat("turretwall", (176, 110, 84), rough=0.7, metal=0.1, wear=(222, 154, 122), rust=(84, 50, 36), rust_at=0.53, scale=5.0, hard=True, mottle=0.3,
               streak=(80, 48, 34))


def m_coalpale():
    return mat("coalpale", (150, 146, 140), rough=0.75, wear=(206, 202, 196), rust=(84, 80, 78), scale=9.0, speck=0.2, dirt=0.0, ao_min=0.3)


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
SLIDES = []         # (object, ride(p, t, r), lane, radius, phase, rest rotation, tumbles a loop): the coal down the chute
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
    for ob, ride, t, r, ph, rot, tumbles in SLIDES:
        ob.location = ride((2 * f + ph) % 1.0, t, r)          # two trips a loop
        ob.rotation_euler = (rot[0] + 2 * math.pi * tumbles * f, rot[1], rot[2] + 2 * math.pi * f)
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
DOME = [(0.0, 4.47), (1.0, 4.45), (1.7, 4.36), (2.08, 4.2), (RD, 4.06)]      # tiers 2-3: the drum's top, a low dome with a flat deck
INT = {1: Vector((-0.05, -4.8, 0)), 2: Vector((-0.05, -4.8, 0)), 3: Vector((0.22, -4.46, 0))}[T]     # the intake's axis
RIS = P(-2.15, 2.97)                         # the riser's axis (where the copper pipe ends), above the intake's top
FUN = P(-3.4, 2.97)                          # the funnel's axis
WIN = (-22.0, 76.0)                          # the window band's bearings
RISER_TOP = 0.0
STACK_YAW = float(os.environ.get("PB_STACK_YAW", 22.0))     # Flash shows the stack corner-on: a wide lit face, a narrower shaded one


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
        prof = [(0.0, 0.5), (1.3, 0.52), (1.85, 0.85), (2.15, 1.4), (RD, 1.95), (RD, 3.62), (RD + 0.08, 3.68), (RD + 0.08, 4.0)] + list(reversed(DOME))
    one("drum", [m_body()], lambda b: b.lathe(prof, n=72), sharp=35)
    if T >= 2:
        def rivets(b):
            for i in range(24):
                d = D(i * 15 + 4)
                M = frame_at(d * (RD + 0.08) + UP * 3.84, UP, d)
                b.lathe([(0.085, 0.0), (0.075, 0.035), (0.0, 0.05)], n=8, M=M)
        one("drumrivets", [m_dark()], rivets)
        if T == 3:      # the deck's plates: a raised seam round the flat of the deck, seams down the shoulder, rivets along them
            def dz(r):
                for (r0, z0), (r1, z1) in zip(DOME, DOME[1:]):
                    if r <= r1:
                        return z0 + (z1 - z0) * (r - r0) / (r1 - r0)
                return DOME[-1][1]
            one("deckseam", [m_trim()], lambda b: b.lathe([(1.5, dz(1.5) - 0.02), (1.53, dz(1.53) + 0.035), (1.6, dz(1.6) + 0.035), (1.63, dz(1.63) - 0.02)], n=64))

            def seams(b):
                for i in range(8):
                    d = D(i * 45 + 20)
                    b.tube([d * r + UP * (dz(r) - 0.005) for r in (1.62, 1.8, 2.0, 2.12, RD + 0.02)], 0.03, n=6, mi=1)
                    for r in (1.75, 2.0):
                        for sgn in (-1, 1):
                            q = d * r + UP.cross(d) * 0.1 * sgn
                            b.lathe([(0.05, 0.0), (0.04, 0.025), (0.0, 0.035)], n=6, M=Matrix.Translation(q + UP * dz(r)))
            one("deckplates", [m_dark(), m_trim()], seams)
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
        H = 1.75
        one("turret", [m_turret()], lambda b: b.lathe([(TR + 0.06, z), (TR + 0.06, z + 0.34), (TR, z + 0.38), (TR, z + H), (0.0, z + H)], at=c, n=40))
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
        # Flash: a flat spiked brim, a short drum, a second spiked brim, then the neck the copper pipe leaves by
        one("collar", [m_pale()], lambda b: b.lathe([(TR - 0.05, zk - 0.04), (0.9, zk + 0.02), (0.96, zk + 0.07), (0.9, zk + 0.13), (0.5, zk + 0.2), (0.0, zk + 0.2)], at=c, n=40), sharp=30)
        one("turretmid", [m_neck()], lambda b: b.lathe([(0.46, zk + 0.16), (0.46, zk + 0.8)], at=c, n=32))
        one("collar2", [m_pale()], lambda b: b.lathe([(0.46, zk + 0.74), (0.66, zk + 0.78), (0.7, zk + 0.83), (0.66, zk + 0.89), (0.38, zk + 0.95), (0.0, zk + 0.95)], at=c, n=36), sharp=30)

        def spikes(b):
            for rr_, zz, ln, off in ((0.84, zk + 0.07, 0.62, 0), (0.6, zk + 0.83, 0.55, 30)):
                for i in range(6):
                    d = D(i * 60 + off)
                    M = frame_at(c + d * rr_ + UP * zz, UP, d + UP * 0.1)
                    b.lathe([(0.1, 0.0), (0.075, 0.14), (0.0, ln)], n=10, M=M)
        one("spikes", [m_spike()], spikes)
        one("neck", [m_neck() if T == 1 else m_steel()], lambda b: b.lathe([(0.33, zk + 0.93), (0.33, zk + 1.2), (0.4, zk + 1.23), (0.4, zk + 1.42), (0.3, zk + 1.46),
                                                                             (0.3, zk + 1.6), (0.0, zk + 1.6)], at=c, n=24), sharp=30)
        return zk + 1.6
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
            r = 1.72 if i % 2 == 0 else 1.0
            pts.append((r * math.cos(a), r * math.sin(a)))
        b.prism(pts, 0.34, Matrix.Translation((0, 0, -0.1)))
        for v in b.bm.verts:                      # the points droop a little, as a shallow cone
            v.co.z -= 0.16 * (math.hypot(v.co.x, v.co.y) - 1.0)
    one("starplate", [mat("starsteel", (128, 104, 76), rough=0.5, metal=0.5, wear=(184, 160, 122), rust=(70, 52, 36), rust_at=0.58, scale=3.0, dirt=0.0)],
        star, parent=hub, smooth=False, bevel=0.05)
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
            S = 1.5
            M0 = Rz(STACK_YAW, c)
            one("stackplate", [m_plate()], lambda b: b.box((S + 0.7, S + 0.7, 0.2), M0 @ Matrix.Translation((0, 0, 0.1))), smooth=False, bevel=0.04)
            for i in range(2):
                one("stackbrick-%d" % i, [m_brick()], lambda b, i=i: b.box((S, S, 0.9), M0 @ Matrix.Translation((0, 0, 0.2 + 0.47 + 0.95 * i))), smooth=False, bevel=0.07)
            one("stackbolts", [m_dark()], lambda b: [b.lathe([(0.09, 0), (0.07, 0.05), (0, 0.06)], n=8, M=M0 @ Matrix.Translation((sx * (S / 2 + 0.2), sy * (S / 2 + 0.2), 0.2)))
                                                     for sx in (-1, 1) for sy in (-1, 1)])
        return zf + bend + RE
    S = 1.62          # corner-on it is as wide on the screen as Flash's
    M0 = Rz(STACK_YAW, c)
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
    rings = freeze(bb, bb.tube([c + UP * z for z in zs], rs, sides=4, twist=STACK_YAW - 45))
    o = bb.ob("stack-duct", [m_brick()], parent=mv, smooth=False, bevel=0.022, segs=2)
    bulging(o, rings, 0.04, 0.5, 0.2, 0.11, 0.03, 0.97)
    return zs[-1]


def cabinet():
    """The coal tray on the drum's top, left of the turret: an open tray heaped with coal (tier 3: a brass block, gold
    rim), and the chute out of its front (-Y side): a closed-sided trough sloping down across the drum's top into the
    furnace's feed hatch."""
    bx0, by0 = -2.04, -0.65
    bx1, by1 = (-0.48, 0.2) if T == 1 else (-0.3, 0.3)
    xm, ym = (bx0 + bx1) / 2, (by0 + by1) / 2
    # ---- the chute: a closed-sided trough out of the box's mouth, sloping down toward the viewer across the drum's
    # top and ending in the furnace's feed hatch, an opening in the drum's top with the fire showing in it. The coal
    # slides down the trough in a stream and drops into the hatch. One solid piece, standing in the drum's top.
    O = Vector((-1.15, by0, 0.0))                        # where the trough's middle leaves the box's front
    d = Vector((0.6, -0.8, 0.0))                         # downhill
    w = Vector((0.8, 0.6, 0.0))                          # across the trough (to the screen's right)
    hw, th = 0.42, 0.08                                  # the trough's inside half width, its walls
    s0, sl, se = -0.45, 0.72, 1.4                         # it starts inside the box; the lip; the hatch's far end
    za, zl = (TOP + 0.6, TOP + 0.27) if T == 1 else (TOP + 0.56, TOP + 0.14)      #                      # the bed at the box's front and at the lip
    hr = 0.24                                            # the walls stand this far over the bed
    zb = TOP - 0.4                                       # everything runs down into the drum's top
    trim = m_trim() if T == 1 else m_body()
    block = m_trim() if T == 1 else m_brick() if T == 3 else m_cab()
    rim_m = m_brick() if T == 3 else m_yellow()
    zr = za + hr + 0.04                                  # the tray's rim
    wt = 0.09                                            # its walls
    fx0, fx1 = O.x - hw / w.x - th, O.x + hw / w.x + th  # the chute's gap in the front wall
    one("tray", [block], lambda b: b.box((bx1 - bx0, by1 - by0, za - TOP + 0.3), Matrix.Translation((xm, ym, (za + TOP - 0.3) / 2))), smooth=False, bevel=0.04)

    def rim(b, z0=za - 0.02, z1=zr, grow=0.0):
        g = grow
        b.box((bx1 - bx0 + 2 * g, wt + 2 * g, z1 - z0), Matrix.Translation((xm, by1 - wt / 2, (z0 + z1) / 2)))
        for x in (bx0 + wt / 2, bx1 - wt / 2):
            b.box((wt + 2 * g, by1 - by0 + 2 * g, z1 - z0), Matrix.Translation((x, ym, (z0 + z1) / 2)))
        for xa, xb in ((bx0, fx0), (fx1, bx1)):
            if xb - xa > 0.04:
                b.box((xb - xa + 2 * g, wt + 2 * g, z1 - z0), Matrix.Translation(((xa + xb) / 2, by0 + wt / 2, (z0 + z1) / 2)))
    one("trayrim", [block], rim, smooth=False, bevel=0.02)
    one("traycap", [rim_m], lambda b: rim(b, zr - 0.005, zr + 0.05, 0.02), smooth=False, bevel=0.012)
    # the heap: a dark mound with lumps all over it, highest over the chute's start (the sliding coal comes out from under it)
    hx, hy = (bx1 - bx0) / 2 - wt, (by1 - by0) / 2 - wt

    def heap_z(x, y):
        u, v = (x - xm) / hx, (y - ym) / hy
        return za + 0.02 + 0.5 * max(0.0, 1 - 0.75 * u * u) * max(0.0, 1 - 0.8 * max(0.0, v) ** 2 - 0.25 * min(0.0, v) ** 2)

    def mound(b):
        m = 10
        g = [[b.bm.verts.new(Vector((xm + hx * (2 * i / m - 1), ym + hy * (2 * j / m - 1), heap_z(xm + hx * (2 * i / m - 1), ym + hy * (2 * j / m - 1)) - 0.06)))
              for j in range(m + 1)] for i in range(m + 1)]
        for i in range(m):
            for j in range(m):
                b.bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]))
        b.box((2 * hx, 2 * hy, 0.04), Matrix.Translation((xm, ym, za + 0.02)))
    one("heapmound", [m_soot()], mound)
    hr_ = random.Random(31)
    pale = {1: 0.42, 2: 0.2, 3: 0.0}[T]
    hb = bmesh.new()
    for k in range(64 if T == 1 else 80):
        r = hr_.uniform(0.11, 0.17) if T < 3 else hr_.uniform(0.13, 0.2)
        x, y = xm + hx * hr_.uniform(-1, 1) * 0.9, ym + hy * hr_.uniform(-1, 1) * 0.86
        geo = bmesh.ops.create_icosphere(hb, subdivisions=1, radius=r)
        mi = 1 if hr_.random() < pale else 0
        R3 = Matrix.Rotation(hr_.uniform(0, 6.3), 4, 'Z') @ Matrix.Rotation(hr_.uniform(0, 6.3), 4, 'X')
        at_ = Vector((x, y, heap_z(x, y) + r * 0.25))
        for v in geo["verts"]:
            v.co = at_ + R3 @ (v.co * hr_.uniform(0.72, 1.18))
            for f in v.link_faces:
                f.material_index = mi
    kit.mesh_ob("heap", hb, [m_coal(), m_coalpale()], smooth=False)

    def Mc(t=0.0):
        return frame_at(O + w * t, d, -w)                # a prism's outline as (s, z), its thickness across the trough

    def bedz(s):
        return za + (zl - za) * max(0.0, s) / sl               # level inside the box

    def at(s, t, z):
        return O + d * s + w * t + UP * z

    one("chutebody", [trim], lambda b: b.prism([(s0, za), (0, za), (sl, zl), (sl, zb), (s0, zb)], 2 * hw, Mc()), smooth=False)
    one("chutebed", [m_soot()], lambda b: b.prism([(s0, za), (0, za), (sl, zl), (sl, zl - 0.2), (sl + 0.03, zl - 0.2), (sl + 0.03, zl + 0.02), (0, za + 0.03), (s0, za + 0.03)],
                                              2 * hw, Mc()), smooth=False)
    ze = TOP + (0.2 if T == 1 else 0.14)                                      # the hatch's rim at its far end
    top = [(-wt, za + hr), (0, za + hr), (sl, zl + hr), (se + th, ze)]        # the walls' top edge
    wall = top + [(se + th, zb), (-wt, zb)]
    one("chutewalls", [trim], lambda b: ([b.prism(wall, th, Mc(t)) for t in (-hw - th / 2, hw + th / 2)],
                                         b.prism([(se, ze), (se + th, ze), (se + th, zb), (se, zb)], 2 * hw, Mc())),
        smooth=False, bevel=0.025)
    if T < 3:                                            # Flash's yellow edge along the channel
        cap = top + [(a, z + 0.035) for a, z in reversed(top)]
        one("chutecaps", [m_yellow()], lambda b: ([b.prism(cap, th + 0.03, Mc(t)) for t in (-hw - th / 2, hw + th / 2)],
                                                  b.box((th + 0.03, 2 * hw + 2 * th + 0.03, 0.035), frame_at(at(se + th / 2, 0, ze + 0.0175), d, UP))),
            smooth=False, bevel=0.01)

        def cleats(b):
            for s in (0.14, 0.34, 0.54):
                b.box((0.09, 2 * hw - 0.02, 0.045), frame_at(at(s, 0, bedz(s) + 0.04), d + UP * ((zl - za) / sl), UP))
        one("chutecleats", [mat("slat", (104, 96, 88), rough=0.45, metal=0.6, wear=(170, 164, 150), rust=(70, 52, 44), scale=7.0)], cleats, smooth=False, bevel=0.015)
    # the hatch: sooty sides, the furnace's fire below
    one("hatchsides", [m_soot()], lambda b: ([b.prism([(sl, zl + hr - 0.05), (se, ze - 0.04), (se, zb), (sl, zb)], 0.02, Mc(t)) for t in (-hw + 0.01, hw - 0.01)],
                                             b.prism([(se - 0.02, ze - 0.04), (se, ze - 0.04), (se, zb), (se - 0.02, zb)], 2 * hw, Mc())), smooth=False)
    fmv = mover("hatchfire")
    hf = fire("hatchfire", (70, 14, 4), (240, 104, 18), (255, 206, 80), strength=2.2, scale=3.2, cut=0.47, speed=1.5)

    def top_at(p):
        """The drum's top under p (the lid's cone at tier 1, the dome at tiers 2-3)."""
        r = math.hypot(p.x, p.y)
        if T == 1:
            return max(TOP + 0.02, TOP + 0.05 + 0.19 * (1.9 - r))
        prof = DOME
        for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
            if r <= r1:
                return z0 + (z1 - z0) * (r - r0) / (r1 - r0)
        return 4.06

    def flames(b):                                       # the fire lies just over the drum's top, following it
        m = 6
        g = [[None] * (m + 1) for _ in range(m + 1)]
        for i in range(m + 1):
            for j in range(m + 1):
                q = at(sl + (se - sl) * i / m, -hw + 2 * hw * j / m, 0.0)
                g[i][j] = b.bm.verts.new(q + UP * (top_at(q) + 0.035))
        for i in range(m):
            for j in range(m):
                b.bm.faces.new((g[i][j], g[i + 1][j], g[i + 1][j + 1], g[i][j + 1]))
    one("hatchfire", [hf], flames, parent=fmv)
    # the coal: a stream of lumps out of the box, down the bed, over the lip and into the fire
    mv = mover("coal")
    rr = random.Random(5 if T < 3 else 9)
    big = T == 3

    def ride(p, t, r):
        """Where a lump is, p = 0..1 of its trip: sliding (gathering speed), then falling into the hatch."""
        if p < 0.74:
            s = s0 + (sl + 0.04 - s0) * (p / 0.74) ** 1.2
            return at(s, t, bedz(min(s, sl)) + 0.8 * r + 0.03)
        v = (p - 0.74) / 0.26
        return at(sl + 0.04 + 0.3 * v, t, zl + 0.8 * r + 0.03 - 0.1 * v - 0.75 * v * v)
    n = 20 if big else 34
    for i in range(n):
        r = rr.uniform(0.15, 0.2) if big else rr.uniform(0.1, 0.145)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        for v in bm.verts:
            v.co *= rr.uniform(0.72, 1.18)
        o = kit.mesh_ob("coal-%d" % i, bm, [m_coalpale() if i % 5 < round(pale * 5) else m_coal()], smooth=False, parent=mv)
        rot = (rr.uniform(0, 6.3), rr.uniform(0, 6.3), rr.uniform(0, 6.3))
        SLIDES.append((o, ride, rr.uniform(-hw + r + 0.02, hw - r - 0.02), r, (i + rr.uniform(0, 0.6)) / n, rot, rr.choice((1, 1, 2))))
    if T == 3:
        # the dark pipework between the stack and the drum
        tx0, tx1, ry, rz = -1.35, 0.4, -2.62, TOP - 1.05
        tm = (tx0 + tx1) / 2
        yf = ry - 0.36
        one("chute", [m_soot()], lambda b: b.box((tx1 - tx0 + 0.1, 0.87, rz - 0.2), Matrix.Translation((tm, ry + 0.085, (rz + 0.2) / 2))), smooth=False)

        def works(b):
            for x, z0, z1, r in ((tx0 + 0.25, 0.3, rz - 0.3, 0.1), (tx0 + 0.62, 0.9, rz - 0.5, 0.07), (tx1 - 0.3, 0.3, 2.3, 0.09)):
                b.tube([Vector((x, yf, z0)), Vector((x, yf, z1))], r, n=10)
            b.tube([Vector((tx0 + 0.1, yf - 0.04, 1.45)), Vector((tx1 - 0.05, yf - 0.04, 1.45))], 0.08, n=10)
            b.box((0.5, 0.2, 0.62), Matrix.Translation((tm + 0.2, yf, 2.75)))
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


# ------------------------------------------------------------------------------------------------------------- damaged
# One rough pass (owner: this only roughly follows Flash): PB_STATE=damaged with mode `base`.
#   PB_STATE=damaged PB_K=6 sh run.sh <tier> base   ->  render/L<tier>-damaged-base.png, -alone.png
# Destroyed is Flash's rubble, as for every other 3D building: there is no 3D destroyed look.
STATE = kit.STATE


def scorch(amount, cut=0.5, fires=0.3):
    """Soot over every paint: patches of near black, `amount` of the colour left under them; the fires gutter."""
    for m in list(bpy.data.materials):
        nt = m.node_tree
        if nt is None:
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        es = bsdf.inputs["Emission Strength"]
        if es.default_value > 0:
            es.default_value *= fires
        inp = bsdf.inputs["Base Color"]
        if inp.is_linked:
            src = inp.links[0].from_socket
        else:
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = inp.default_value
            src = rgb.outputs[0]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.6
        nz.inputs["Detail"].default_value = 5.0
        nz.inputs["Roughness"].default_value = 0.65
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = cut - 0.1, grey(amount)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = cut + 0.12, grey(0.8)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        nt.links.new(nz.outputs[0], ramp.inputs[0])
        nt.links.new(src, mix.inputs[6])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], inp)


def about(pivot, axis, deg):
    return Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-Vector(pivot))


def knock(names, M):
    """Move the named objects (and what hangs on them) by M."""
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None:
            o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()


def wreck():
    """What the damage adds: torn holes in the drum with their plates bent out, dead window panes, parts fallen at the feet."""
    rr = random.Random(12)
    holes = [(0, 26, 2.8, 3.5, RD), (82, 108, 2.0, 3.1, RD), (28, 50, 1.4, 1.95, 2.17)]
    if T >= 2:
        holes[0] = (-4, 22, 3.0, 3.62, RD)
        holes[2] = (26, 50, 1.2, 1.7, 2.12)

    def torn(b):
        for a0, a1, z0, z1, r in holes:
            m = 6
            for i in range(m):
                u0, u1 = a0 + (a1 - a0) * i / m, a0 + (a1 - a0) * (i + 1) / m
                k = 1 - abs((i + 0.5) / m - 0.5) * 1.3
                h = (z1 - z0) * k * rr.uniform(0.7, 1.0)
                zm = (z0 + z1) / 2 + rr.uniform(-0.06, 0.06)
                b.shell(r - 0.02, r + 0.1, u0, u1, zm - h / 2, zm + h / 2, n=1)
    one("torn", [m_soot()], torn, smooth=False)

    def bent(b):
        for n, (a0, a1, z0, z1, r) in enumerate(holes):
            for a, tip, z in ((a0 + 1, 38, z1 - 0.02), (a1 - 1, -46, z0 + 0.02)):          # one plate bent up and out, one hanging down
                d = D(a + (a1 - a0) * 0.22 * (1 if tip > 0 else -1))
                t = math.radians(abs(tip))
                out = d * math.sin(t) + UP * (math.cos(t) if tip < 0 else -math.cos(t))    # along the plate, away from its hinge
                hgt = (z1 - z0) * 0.62
                b.box((0.5, hgt, 0.05), frame_at(d * (r + 0.1) + UP * z + out * (hgt / 2), UP.cross(d), out.cross(UP.cross(d))))
    one("bentplates", [m_trim() if T == 1 else m_body()], bent, smooth=False, bevel=0.015)
    # dead panes
    a0, a1 = WIN
    n = 7 if T == 1 else 6
    step = (a1 - a0) / n
    z0, z1 = (2.06, 2.68) if T == 1 else (2.08, 2.72)
    one("deadpanes", [m_soot()], lambda b: [b.shell(RD + 0.013, RD + (0.03 if T == 1 else 0.05), a0 + step * i, a0 + step * (i + 1), z0, z1, n=4) for i in ((1, 2, 4, 6) if T == 1 else (0, 2, 3, 5))])
    # at the feet: plates off the drum, a hoop's end, coal, spikes
    def plates(b):
        for phi, r, sz, tilt in ((-20, 3.5, (0.8, 0.55), 8), (22, 3.75, (0.6, 0.7), -10), (62, 3.6, (0.75, 0.5), 14), (96, 3.3, (0.5, 0.45), -6), (4, 4.5, (0.45, 0.4), 5)):
            d = D(phi)
            nrm = (UP + d * math.tan(math.radians(tilt))).normalized()
            b.box((sz[0], sz[1], 0.06), frame_at(d * r + UP * (0.07 + abs(tilt) * 0.006), D(phi + rr.uniform(20, 160)), nrm))
    one("fallenplates", [m_trim() if T == 1 else m_body()], plates, smooth=False, bevel=0.015)
    hb = bmesh.new()
    for k in range(16):
        phi, r0 = rr.uniform(-34, 30), rr.uniform(2.9, 4.4)
        r = rr.uniform(0.1, 0.17)
        geo = bmesh.ops.create_icosphere(hb, subdivisions=1, radius=r)
        at_ = D(phi) * r0 + UP * r * 0.7
        for v in geo["verts"]:
            v.co = at_ + v.co * rr.uniform(0.72, 1.18)
    kit.mesh_ob("spiltcoal", hb, [m_coal()], smooth=False)
    if T < 3:
        def fallen(b):
            for phi, r, turn_ in ((48, 3.2, 30), (78, 3.9, 200), (-2, 3.9, 120)):
                d = D(phi)
                b.lathe([(0.1, 0.0), (0.075, 0.14), (0.0, 0.62)], n=10, M=frame_at(d * r + UP * 0.1, UP, D(turn_) + UP * 0.05))
        one("fallenspikes", [m_spike()], fallen)


def build_state():
    build()
    if not STATE:
        return
    kit.MOVING.clear()                      # a state is one still: nothing is held back for a strip
    bpy.context.view_layer.update()         # so every object's matrix_world is its real place before it is knocked
    wreck()
    scorch(0.2, 0.5)
    # the intake bent away from the drum above its flange (tier 3: the stack leaning), the riser with it
    if T < 3:
        lean = about(INT + UP * 4.1, SF, 13)
        knock(["ypipe-elbow", "yrib-0", "yrib-1", "ymouth", "ythroat", "riserbox", "riserband", "riserflange", "funnelstem"], lean)
        knock(["yflange"], about(INT + UP * 4.1, SF, 6))
    else:
        lean = about(INT + UP * 0.2, SF, 7)
        knock(["stack", "riserneck", "riserbracket", "riserbolts"], lean)
    # the copper pipe torn off the turret: it hangs from the riser, swung out over the drum's front and drooping
    top = lean @ (RIS + UP * RISER_TOP)
    run = (TUR - RIS).normalized()
    knock(["cpipe"], about(top, UP.cross(run), -14) @ about(top, UP, -34) @ lean)
    # the funnel knocked off, lying at the feet
    zf = 9.4 if T < 3 else 9.3
    knock(["funnel", "funnelhole"], Matrix.Translation(P(-1.0, 4.9, 0.42 if T < 3 else 0.55) - (FUN + UP * zf)) @ about(FUN + UP * zf, SF, 96) @ about(FUN + UP * zf, UP, 30))
    # the turret's top askew
    knock(["star", "spikes", "collar", "collar2", "turretmid", "neck"], about(TUR + UP * (TOP + 1.7), SF, -13))


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
kit.run(build_state, turn)
