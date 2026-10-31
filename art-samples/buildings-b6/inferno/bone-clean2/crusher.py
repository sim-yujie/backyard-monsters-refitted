"""crusher.py : the Inferno Bone Cruncher in 3D, three tiers, built clean-room from the written description only
(bone-clean-v2, 31 Oct 2026). Only the generic Inferno kit is used (../kit.py: camera, light, render modes, helpers).

    blender -b --factory-startup -P crusher.py -- <tier 1|2|3> <fit|check|still|anim|probe|gap>

Tier 1 = levels 1-2 (wooden feeder), tier 2 = levels 3-6 (chute, spiked rollers), tier 3 = levels 7-10 (furnace).
World: Z up, the bowl's axis on the origin. The camera looks from +X -Y, so +X is the front right on screen, -Y the
front left, -X the back left and +Y the back right. Each tier is the tier below with parts added or swapped: the bowl,
base, cup, drum and panel are the same code at every tier.

Loops: every turning part turns by a whole multiple of its own symmetry in one loop, and the textures of turning parts
are folded round their axle by the same symmetry, so the last frame runs into the first with no jump.
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
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402

T = kit.L                                   # the tier
kit.OUT = HERE / os.environ.get("PB_SUB", ".")       # anim renders go to anim/render (a smaller K than the stills)
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (0.0, 35.0)
kit.FRAME = (-60, -70, 60, 70)
N = 36                                                  # frames in one loop
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame 36 (= frame 0) for the loop check
rnd = random.Random(31)

K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)


def grey(x):
    return (x, x, x, 1)


# ------------------------------------------------------------------------------------------------------------ sizes
OUTER = [(2.15, 0.42), (2.40, 0.55), (2.55, 0.80), (2.64, 1.20), (2.70, 1.60), (2.74, 2.08)]
INNER = [(2.62, 2.08), (2.58, 1.60), (2.52, 1.20), (2.42, 0.80), (2.25, 0.62), (0.02, 0.58)]
LIP_R, LIP_Z, LIP_W = 2.68, 2.12, (0.14 if T < 3 else 0.18)
ZR, YR, HL = 1.85, 0.78, 1.70               # roller axle height, half the axle spacing, half the roller length
PX, PF = 3.0, 3.15                          # the side panel's back and front faces (it faces +X)
PY, PZ = (-1.3, 1.3), (0.35, 2.25)


def r_at(prof, z):
    pts = sorted(prof, key=lambda p: p[1])
    for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return pts[0][0] if z < pts[0][1] else pts[-1][0]


def r_out(z):
    return r_at(OUTER, z)


def r_in(z):
    return r_at(INNER[:-1], z)


def polar(r, deg, z=0.0):
    a = math.radians(deg)
    return Vector((r * math.cos(a), r * math.sin(a), z))


# ------------------------------------------------------------------------------------------------------------ matrices
def Tm(p):
    return Matrix.Translation(Vector(p))


def basis(x, y, z, p=(0, 0, 0)):
    m = Matrix((Vector(x).normalized(), Vector(y).normalized(), Vector(z).normalized())).transposed().to_4x4()
    m.translation = Vector(p)
    return m


def aim(z_dir, p=(0, 0, 0)):
    """Local Z along z_dir, at p."""
    z = Vector(z_dir).normalized()
    up = Vector((0, 0, 1)) if abs(z.z) < 0.95 else Vector((1, 0, 0))
    x = up.cross(z).normalized()
    return basis(x, z.cross(x), z, p)


AXIS_X = ((0, 1, 0), (0, 0, 1), (1, 0, 0))  # local X = world Y, local Y = world Z, local Z (the axle) = world X


# ------------------------------------------------------------------------------------------------------------ materials
MATS = {}


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


def folded(t, v, n):
    """Object coordinates folded round local Z into one 1/n sector, mirrored so the sectors meet without a seam: the
    texture repeats every 360/n degrees round the axle, so a part turned by that much looks exactly the same."""
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(v, sep.inputs[0])
    X, Y = sep.outputs["X"], sep.outputs["Y"]
    P = 2 * math.pi / n
    a = _math(t, "FLOORED_MODULO", _math(t, "ARCTAN2", Y, X), P)
    a = _math(t, "SUBTRACT", P / 2, _math(t, "ABSOLUTE", _math(t, "SUBTRACT", a, P / 2)))
    r = _math(t, "SQRT", _math(t, "ADD", _math(t, "MULTIPLY", X, X), _math(t, "MULTIPLY", Y, Y)))
    c = t.n("ShaderNodeCombineXYZ")
    t.link(_math(t, "MULTIPLY", r, _math(t, "COSINE", a)), c.inputs[0])
    t.link(_math(t, "MULTIPLY", r, _math(t, "SINE", a)), c.inputs[1])
    t.link(sep.outputs["Z"], c.inputs[2])
    return c.outputs[0]


def mat(name, col, rough=0.65, metal=0.0, wear=None, wear_amt=0.6, rust=None, rust_at=0.62, dirt=0.35, scale=5.0,
        fold=None, speck=0.18, bump=0.08, glow=None, heat=None, alpha=False, ao_min=0.55):
    """Paint or metal: worn patches (`wear` shows through), rust blotches, a fine speckle, darker toward the ground and
    in creases. glow = (colour, strength, scale): hot seams that give light. heat = colour toward the mesh's 'heat'
    attribute (1 at a spike's tip). fold = n: the texture repeats every 360/n degrees round local Z (turning parts)."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    v = t.coords()
    if fold:
        v = folded(t, v, fold)
    out = kit.srgb(*col)
    if wear:
        out = t.mix(out, kit.srgb(*wear), t.ramp(t.noise(v, scale * 0.5, 3.0, 0.55, 0.2), [(0.48, K0), (0.74, grey(wear_amt))]))
    if rust:
        out = t.mix(out, kit.srgb(*rust), t.ramp(t.noise(v, scale * 0.8, 5.0, 0.65, 1.0), [(rust_at, K0), (rust_at + 0.14, grey(0.75))]))
    if speck:
        out = t.mix(out, t.ramp(t.noise(v, scale * 12, 2.0, 0.5), [(0.3, grey(1 - speck)), (0.62, K1)]), 1.0, "MULTIPLY")
    if heat:
        at = t.n("ShaderNodeAttribute", attribute_name="heat")
        hf = _math(t, "POWER", at.outputs["Fac"], 1.6)
        out = t.mix(out, kit.srgb(*heat[0]), hf)
        t.bsdf.inputs["Emission Color"].default_value = kit.srgb(*heat[0])
        t.link(_math(t, "MULTIPLY", hf, heat[1]), t.bsdf.inputs["Emission Strength"])
    out = t.grime(out, 0.0, 2.6, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rough, "metal": metal, "spec": 0.4})
    if glow:
        gcol, gk, gs = glow
        if gk > 1:                                              # bright, through the grille
            mask = t.ramp(t.noise(v, gs, 6.0, 0.62, 0.5), [(0.42, K0), (0.5, K1)])
        else:                                                   # a faint, even warmth with softer and brighter patches
            mask = t.ramp(t.noise(v, gs * 0.35, 2.0, 0.5, 0.2), [(0.3, grey(0.25)), (0.7, K1)])
        g = t.mix(kit.srgb(60, 10, 2), kit.srgb(*gcol), mask)
        t.link(g, t.bsdf.inputs["Emission Color"])
        t.link(_math(t, "MULTIPLY", mask, gk), t.bsdf.inputs["Emission Strength"])
    if alpha:
        oi = t.n("ShaderNodeObjectInfo")
        lw = t.n("ShaderNodeLayerWeight")
        lw.inputs[0].default_value = 0.5
        soft = _math(t, "POWER", _math(t, "SUBTRACT", 1.0, lw.outputs["Facing"]), 2.5)
        t.link(_math(t, "MULTIPLY", oi.outputs["Alpha"], soft), t.bsdf.inputs["Alpha"])
    if bump:
        t.bump(t.noise(v, scale * 4, 4.0, 0.6), bump, 0.01)
    MATS[name] = t.m
    return t.m


def wood(name, light, dark, axis):
    return kit.wood(name, light, dark, axis=axis)


TEAL = lambda: mat("teal", (64, 116, 106), rough=0.72, metal=0.1, wear=(42, 60, 56), rust=(110, 64, 38), rust_at=0.66,
                   dirt=0.5)
TEAL_RIV = lambda: mat("teal-rivet", (98, 150, 138), rough=0.6, metal=0.2, wear=(60, 74, 70), dirt=0.45)
INSIDE = lambda: mat("inside", (18, 36, 34), rough=0.85, wear=(26, 30, 28), dirt=0.2, speck=0.1)
LIP = lambda: mat("lip", (142, 192, 180), rough=0.6, metal=0.1, wear=(92, 120, 112), rust=(120, 80, 50), rust_at=0.72,
                  dirt=0.3)
BAND = lambda: mat("band", (112, 60, 34), rough=0.75, metal=0.2, wear=(70, 40, 26), rust=(140, 78, 40), dirt=0.4)
IRON = lambda: mat("iron", (74, 78, 80), rough=0.62, metal=0.5, wear=(110, 106, 98), wear_amt=0.4, rust=(110, 62, 36),
                   rust_at=0.68, dirt=0.4)
DARK = lambda: mat("dark-iron", (48, 52, 54), rough=0.7, metal=0.4, wear=(84, 82, 78), wear_amt=0.35, dirt=0.3)
STEEL = lambda: mat("steel", (150, 154, 156), rough=0.45, metal=0.75, wear=(108, 110, 110), dirt=0.25)
COPPER = lambda: mat("copper", (186, 106, 58), rough=0.45, metal=0.7, wear=(120, 70, 40), wear_amt=0.5, dirt=0.25)
BONE = lambda: mat("bone", (234, 224, 198), rough=0.7, wear=(196, 182, 150), dirt=0.25, speck=0.12)
WOOD = lambda ax: wood("wood", (190, 98, 58), (118, 50, 28), ax)
WOOD2 = lambda ax: wood("wood2", (174, 84, 48), (104, 44, 24), ax)


# ------------------------------------------------------------------------------------------------------------ geometry
class Acc:
    """Many small solids gathered into one mesh (in one frame: world, or a moving part's own)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.heat = self.bm.verts.layers.float.new("heat")

    def _tag(self, verts, mi, heat=None):
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = mi
        if heat is not None:
            for v in verts:
                v[self.heat] = heat(v.co)
        return verts

    def cube(self, M, size, mi=0):
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M @ Matrix.Diagonal((size[0], size[1], size[2], 1.0)))
        return self._tag(r["verts"], mi)

    def cone(self, M, r1, r2, depth, mi=0, seg=16, heat=None):
        """Along local Z from M's origin up `depth`."""
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=depth,
                                  matrix=M @ Tm((0, 0, depth / 2)))
        return self._tag(r["verts"], mi, heat)

    def sphere(self, M, rad, mi=0, u=10, v=7):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=rad, matrix=M)
        return self._tag(r["verts"], mi)

    def lathe(self, M, prof, mi=0, seg=48, mis=None):
        rows = []
        for r, z in prof:
            rows.append([self.bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * i / seg),
                                                        r * math.sin(2 * math.pi * i / seg), z))) for i in range(seg)])
        for j, (a, b) in enumerate(zip(rows, rows[1:])):
            for i in range(seg):
                k = (i + 1) % seg
                f = self.bm.faces.new((a[i], a[k], b[k], b[i]))
                f.material_index = mis[j] if mis else mi

    def prism(self, M, outline, z0, z1, mi=0):
        """A flat shape (outline in local XY, counter-clockwise) from z0 to z1."""
        bot = [self.bm.verts.new(M @ Vector((x, y, z0))) for x, y in outline]
        top = [self.bm.verts.new(M @ Vector((x, y, z1))) for x, y in outline]
        fs = [self.bm.faces.new(bot[::-1]), self.bm.faces.new(top)]
        n = len(outline)
        for i in range(n):
            k = (i + 1) % n
            fs.append(self.bm.faces.new((bot[i], bot[k], top[k], top[i])))
        for f in fs:
            f.material_index = mi

    def ring_solid(self, M, outer, inner, z0, z1, mi=0):
        """A flat ring between two closed outlines with the same number of points (local XY), z0..z1."""
        n = len(outer)
        ob = [self.bm.verts.new(M @ Vector((x, y, z0))) for x, y in outer]
        of = [self.bm.verts.new(M @ Vector((x, y, z1))) for x, y in outer]
        ib = [self.bm.verts.new(M @ Vector((x, y, z0))) for x, y in inner]
        iff = [self.bm.verts.new(M @ Vector((x, y, z1))) for x, y in inner]
        for i in range(n):
            k = (i + 1) % n
            for quad in ((of[i], of[k], iff[k], iff[i]), (ob[k], ob[i], ib[i], ib[k]), (ob[i], ob[k], of[k], of[i]),
                         (ib[k], ib[i], iff[i], iff[k])):
                self.bm.faces.new(quad).material_index = mi

    def obj(self, name, mats, parent=None, smooth=True, bevel=0.0):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        return kit.mesh_ob(name, self.bm, mats, smooth=smooth, bevel=bevel, segs=2, parent=parent)


def one(name, mats, fn, parent=None, smooth=True, bevel=0.0):
    a = Acc()
    fn(a)
    return a.obj(name, mats, parent, smooth, bevel)


def bar(a, p0, p1, w, h, mi=0, up=(0, 0, 1)):
    """A square bar from p0 to p1, w wide and h tall (h along `up` as far as it can be)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    y = d.normalized()
    x = y.cross(Vector(up))
    if x.length < 1e-4:
        x = y.cross(Vector((1, 0, 0)))
    x.normalize()
    z = x.cross(y)
    a.cube(basis(x, y, z, (p0 + p1) / 2), (w, d.length, h), mi)


def rod(a, p0, p1, r, mi=0, seg=12):
    p0, p1 = Vector(p0), Vector(p1)
    a.cone(aim(p1 - p0, p0), r, r, (p1 - p0).length, mi, seg)


def rivets(a, pts_normals, rad=0.032, mi=0):
    for p, n in pts_normals:
        a.sphere(aim(n, p) @ Matrix.Diagonal((1, 1, 0.55, 1)), rad, mi, 8, 5)


def gear_outline(rp, n, phase=0.0, add=0.9, ded=1.15):
    """A cog's toothed edge, 5 points a tooth: a tooth centred on phase + k * 360/n (radians in)."""
    m = 2 * rp / n
    rt, rr = rp + add * m, rp - ded * m
    P = 2 * math.pi / n
    pts = []
    for k in range(n):
        for u, r in ((-0.27, rr), (-0.12, rt), (0.12, rt), (0.27, rr), (0.5, rr)):
            a = phase + (k + u) * P
            pts.append((r * math.cos(a), r * math.sin(a)))
    return pts, rt, rr


def add_gear(a, rp, n, z0, z1, phase=0.0, spokes=4, mi=0, hub_r=0.1, M=Matrix()):
    pts, rt, rr = gear_outline(rp, n, phase)
    rim = rr - max(0.07, 0.16 * rp) if spokes else hub_r * 0.9
    inner = [(rim * x / math.hypot(x, y), rim * y / math.hypot(x, y)) for x, y in pts]
    a.ring_solid(M, pts, inner, z0, z1, mi)
    a.cone(M @ Tm((0, 0, z0 - 0.03)), hub_r, hub_r, z1 - z0 + 0.06, mi, 20)
    for i in range(spokes):
        ang = 2 * math.pi * (i + 0.5) / spokes
        a.cube(M @ Matrix.Rotation(ang, 4, "Z") @ Tm(((hub_r + rim) / 2, 0, (z0 + z1) / 2)),
               (rim - hub_r + 0.06, 0.07, (z1 - z0) * 0.7), mi)
    return rt


def add_pulley(a, r, z0, z1, spokes, mi=0, hub_r=0.12):
    f, rin = 0.035, r * 0.7
    prof = [(rin, z0), (r + f, z0), (r + f, z0 + 0.025), (r, z0 + 0.045), (r, z1 - 0.045), (r + f, z1 - 0.025),
            (r + f, z1), (rin, z1), (rin, z0)]
    a.lathe(Matrix(), prof, mi, 40)
    a.cone(Tm((0, 0, z0 - 0.02)), hub_r, hub_r, z1 - z0 + 0.04, mi, 16)
    for i in range(spokes):
        ang = 2 * math.pi * (i + 0.5) / spokes
        a.cube(Matrix.Rotation(ang, 4, "Z") @ Tm(((hub_r + rin) / 2, 0, (z0 + z1) / 2)),
               (rin - hub_r + 0.04, 0.055, (z1 - z0) * 0.55), mi)


# ------------------------------------------------------------------------------------------------------------ moving
SPINS = []        # (hub, degrees turned in one loop)
ROCKS = []        # (hub, amplitude degrees, swings per loop)
EXTRA = []        # functions of the loop fraction f (belt cleats, smoke)


def spin(name, center, axes, per_loop):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    e.matrix_world = basis(*axes, center)
    hub = bpy.data.objects.new(name + "-spin", None)
    kit.link(hub, e)
    kit.MOVING.append(hub)
    SPINS.append((hub, per_loop))
    return hub


def rocker(name, M, amp, swings):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    e.matrix_world = M
    hub = bpy.data.objects.new(name + "-spin", None)
    kit.link(hub, e)
    kit.MOVING.append(hub)
    ROCKS.append((hub, amp, swings))
    return hub


def turn(k):
    f = k / N
    for hub, deg in SPINS:
        hub.rotation_euler = (0, 0, math.radians(deg * f))
    for hub, amp, swings in ROCKS:
        hub.rotation_euler = (math.radians(amp * math.sin(2 * math.pi * swings * f)), 0, 0)
    for fn in EXTRA:
        fn(f)


# ============================================================================================================ the parts
def base():
    iron = IRON()

    def fn(a):
        a.lathe(Matrix(), [(0.02, 0.0), (2.25, 0.0), (2.25, 0.08), (2.1, 0.16), (2.03, 0.3), (2.0, 0.44), (0.02, 0.44)],
                0, 64)
        a.cube(Tm((2.85, 0.0, 0.05)), (1.9, 3.0, 0.1), 0)                  # the plate out at the front right
        for x in (2.12, 3.6):                                                # its bolts
            for y in (-1.3, 1.3):
                a.cone(Tm((x, y, 0.09)), 0.06, 0.05, 0.05, 0, 6)
        for i in range(12):                                                  # bolts round the foot
            p = polar(2.17, 15 + 30 * i, 0.07)
            a.cone(aim(Vector((p.x, p.y, 0.3)).normalized(), p), 0.05, 0.045, 0.06, 0, 6)
    one("base-foot", [iron], fn, bevel=0.02)


def bowl():
    teal, inside, lip, band, riv = TEAL(), INSIDE(), LIP(), BAND(), TEAL_RIV()
    iron = IRON()

    def shell(a):
        prof = OUTER + INNER
        mis = [0] * (len(OUTER) - 1) + [0] + [1] * (len(INNER) - 1)
        a.lathe(Matrix(), prof, 0, 72, mis)

    one("bowl-shell", [teal, inside], shell)

    def lipf(a):
        a.lathe(Matrix(), [(LIP_R + LIP_W * math.cos(2 * math.pi * i / 16), LIP_Z + LIP_W * math.sin(2 * math.pi * i / 16))
                           for i in range(17)], 0, 72)
    one("bowl-lip", [lip], lipf)

    def bandf(a, z0, z1, d=0.035):
        a.lathe(Matrix(), [(r_out(z0) - 0.01, z0), (r_out(z0) + d, z0), (r_out(z1) + d, z1), (r_out(z1) - 0.01, z1)],
                0, 72)
    one("bowl-band", [band], lambda a: bandf(a, 1.08, 1.32))
    if T >= 3:
        one("bowl-band2", [iron], lambda a: bandf(a, 0.68, 0.9, 0.04))

    def rv(a):
        pts = []
        for s in range(10):                                                   # vertical seams
            deg = 18 + 36 * s
            for z in (0.7, 0.86, 1.0, 1.45, 1.62, 1.8, 1.96):
                if T >= 3 and z < 0.92:
                    continue
                pts.append((polar(r_out(z) + 0.004, deg, z), polar(1, deg, 0.08)))
        for i in range(36):                                                   # on the middle band
            deg = 10 * i
            pts.append((polar(r_out(1.2) + 0.038, deg, 1.2), polar(1, deg, 0.06)))
            if T >= 3:
                pts.append((polar(r_out(0.79) + 0.043, deg + 5, 0.79), polar(1, deg + 5, 0.1)))
        keep = [polar(2.7, b, 1.8) for b in (188, 55)] + [polar(2.6, b, z) for b in (205, 68, 95, 160) for z in (0.7, 1.45, 1.7, 1.86)]
        keep += [Vector((sx * 2.6, sy * YR, ZR)) for sx in (-1, 1) for sy in (-1, 1)]
        pts = [(p, n) for p, n in pts if min((p - k).length for k in keep) > 0.22]
        rivets(a, pts, 0.032)
    one("bowl-rivets", [riv], rv)

    def brg(a):                                                               # the roller bearings on the inner wall
        for sx in (-1, 1):
            for sy in (-1, 1):
                x = sx * 2.32
                a.cube(Tm((x, sy * YR, ZR)), (0.32, 0.34, 0.36), 0)
                a.cone(aim((sx, 0, 0), (x, sy * YR, ZR)), 0.15, 0.15, 0.2, 0, 20)
                for dy in (-0.12, 0.12):
                    a.cone(Tm((x, sy * YR + dy, ZR + 0.18)), 0.04, 0.04, 0.05, 0, 6)
    one("bowl-brg", [iron], brg, bevel=0.02)

    if T >= 3:                                                                # the fire deep in the bowl
        hot = kit.lava("fire", (255, 110, 24), (255, 200, 90), 5.0, 2.2)
        one("glow-bed", [hot], lambda a: a.lathe(Matrix(), [(0.02, 0.66), (1.4, 0.66), (2.2, 0.64), (2.3, 0.61),
                                                            (0.02, 0.6)], 0, 48))
        ld = bpy.data.lights.new("glow", "POINT")
        ld.energy = 140.0
        ld.color = (1.0, 0.45, 0.12)
        ld.shadow_soft_size = 0.8
        lo = bpy.data.objects.new("glow-light", ld)
        kit.link(lo)
        lo.location = (0, 0, 0.95)


def panel():
    iron, dark, copper = IRON(), DARK(), COPPER()

    def fn(a):
        zm = (PZ[0] + PZ[1]) / 2
        a.cube(Tm(((PX + PF) / 2, 0, zm)), (PF - PX, PY[1] - PY[0], PZ[1] - PZ[0]), 0)
        fx = PF + 0.03
        for z in (PZ[0] + 0.06, PZ[1] - 0.06):                               # the orange-copper frame
            a.cube(Tm((fx, 0, z)), (0.07, PY[1] - PY[0] + 0.02, 0.12), 1)
        for y in (PY[0] + 0.05, PY[1] - 0.05):
            a.cube(Tm((fx, y, zm)), (0.07, 0.12, PZ[1] - PZ[0]), 1)
        for y in (PY[0] + 0.05, PY[1] - 0.05):                               # frame bolts
            for z in (PZ[0] + 0.05, PZ[1] - 0.05, (PZ[0] + PZ[1]) / 2):
                a.cone(aim((1, 0, 0), (PF + 0.06, y, z)), 0.035, 0.03, 0.035, 1, 6)
        for y in (-1.12, 1.12):                                               # legs onto the base plate
            a.cube(Tm(((PX + PF) / 2, y, (0.1 + PZ[0] + 0.02) / 2)), (PF - PX, 0.16, PZ[0] + 0.02 - 0.1), 0)
        for y in (-0.98, 0.98):                                               # struts back to the bowl
            for z in (1.0, 1.8):
                x0 = math.sqrt(r_out(z) ** 2 - y * y) - 0.04
                a.cube(Tm(((x0 + PX) / 2 + 0.01, y, z - 0.05)), (PX - x0 + 0.02, 0.1, 0.1), 0)
    one("panel-plate", [dark, copper], fn, bevel=0.015)

    if T >= 2:                                                                # the hot plate (tier 2), behind a grille (3)
        hot = mat("hot%d" % T, (40, 36, 34) if T >= 3 else (50, 36, 30), rough=0.7, metal=0.3, wear=(70, 60, 54), dirt=0.2,
                  glow=((255, 120, 30), 0.8 if T == 2 else 3.0, 7.0 if T == 2 else 5.0), bump=0.1)
        one("panel-hot", [hot], lambda a: a.cube(Tm((PF + 0.02, 0, 1.31)), (0.04, 2.3, 1.62), 0), bevel=0.01)
        if T >= 3:
            def gr(a):
                for z in [0.52 + 0.13 * i for i in range(13)]:
                    a.cube(Tm((PF + 0.065, 0, z)), (0.05, 2.3, 0.065), 0)
                for y in (-1.15, -0.4, 0.4, 1.15):
                    a.cube(Tm((PF + 0.06, y, 1.31)), (0.04, 0.06, 1.62), 0)
            one("panel-grille", [dark], gr, bevel=0.01)


def cup():
    pale = mat("cup", (196, 198, 194), rough=0.55, metal=0.3, wear=(150, 150, 144), dirt=0.3, speck=0.12)
    iron = IRON()
    meal = mat("meal", (214, 196, 160), rough=0.95, wear=(184, 164, 128), dirt=0.15, speck=0.25, bump=0.3)
    deg = 205
    c = polar(3.62, deg)

    def fn(a):
        prof, r, z = [(0.02, 0.27)], 0.2, 0.27
        for i in range(5):                                                    # a stack of rings, wider at the top
            prof += [(r, z), (r + 0.05, z + 0.11), (r + 0.085, z + 0.125), (r + 0.06, z + 0.15)]
            r, z = r + 0.06, z + 0.15
        top = z
        prof += [(r + 0.02, top + 0.02), (r - 0.03, top + 0.02), (0.18, 0.33), (0.02, 0.33)]
        a.lathe(Tm(c), prof, 0, 40)
        a.lathe(Tm(c), [(0.02, top - 0.04), (r - 0.06, top - 0.07), (r - 0.04, top - 0.12), (0.02, top - 0.12)], 2, 32)
        a.cone(Tm(c + Vector((0, 0, top - 0.05))), 0.22, 0.02, 0.12, 2, 20)     # a little heap of meal
        p0, p1 = polar(2.0, deg, 0.16), polar(3.62, deg, 0.16)                  # the short arm off the foot
        bar(a, p0, p1, 0.16, 0.14, 1)
        a.lathe(Tm(c), [(0.17, 0.2), (0.27, 0.2), (0.27, 0.3), (0.17, 0.3), (0.17, 0.2)], 1, 32)   # its collar
        a.cone(Tm(polar(2.75, deg, 0.23)), 0.05, 0.05, 0.05, 1, 6)
        rod(a, polar(2.5, deg, 1.48), polar(3.5, deg, 1.14), 0.085, 1, 14)   # the spout the meal runs down
        a.lathe(aim(polar(1, deg, -0.34), polar(2.64, deg, 1.44)), [(0.08, 0), (0.15, 0), (0.15, 0.06), (0.08, 0.06)],
                1, 16)
    one("cup", [pale, iron, meal], fn, bevel=0.01)


DRUM_C = polar(3.62, 255)
DRUM_AX = polar(1, 10)


def drum_r(u):
    return 0.46 + 0.06 * (1 - (u / 0.52) ** 2)


def drum():
    leather = mat("leather", (176, 86, 42), rough=0.82, wear=(120, 54, 28), wear_amt=0.85, dirt=0.4, speck=0.25,
                  bump=0.35, scale=9.0)
    dark = mat("drum-band", (40, 34, 30), rough=0.6, metal=0.4, wear=(72, 60, 52), dirt=0.2)
    gap = mat("split", (22, 12, 8), rough=0.9, dirt=0.0, speck=0.0, bump=0.0)
    zc = 0.545
    M = aim(DRUM_AX, DRUM_C + Vector((0, 0, zc)))

    def fn(a):
        us = [-0.52 + 1.04 * i / 12 for i in range(13)]
        a.lathe(M, [(0.02, -0.52)] + [(drum_r(u), u) for u in us] + [(0.02, 0.52)], 0, 40)
        for u in (-0.4, 0.0, 0.4):                                            # dark bands round it
            r = drum_r(u)
            a.lathe(M, [(r - 0.01, u - 0.045), (r + 0.02, u - 0.04), (r + 0.025, u), (r + 0.02, u + 0.04),
                        (r - 0.01, u + 0.045)], 1, 40)
        for u in (-0.53, 0.53):                                               # rims at the ends
            a.lathe(M, [(0.38, u - 0.03), (0.45, u - 0.03), (0.45, u + 0.03), (0.38, u + 0.03), (0.38, u - 0.03)], 1, 40)
        # the split: a dark cut along the side facing up and out, with its edges a little lifted
        ang = math.radians(115)
        for s, w, h, mi in ((0.0, 0.07, 0.06, 2), (-0.05, 0.035, 0.04, 0), (0.05, 0.035, 0.04, 0)):
            u0 = 0.2
            r = drum_r(u0) - 0.01
            ca = ang + s / r
            p = Vector((r * math.cos(ca), r * math.sin(ca), u0))
            nrm = Vector((math.cos(ca), math.sin(ca), 0))
            a.cube(M @ basis(nrm.cross(Vector((0, 0, 1))), Vector((0, 0, 1)), nrm, p + nrm * (0.012 if mi == 0 else 0)),
                   (w, 0.34, h), mi)
    one("drum", [leather, dark, gap], fn)

    if T >= 3:                                                                # a wooden wedge so it cannot roll
        out = Vector((DRUM_AX.y, -DRUM_AX.x, 0))                             # the side toward the viewer
        u_ax = 0.2
        rho = drum_r(u_ax) - 0.004
        u1, h = 0.95, 0.42
        lo, hi = 0.0, u1 - 0.05
        for _ in range(50):                                                   # slide the thin edge in until it touches
            u0 = (lo + hi) / 2
            d = ((u1 - u0) * zc + h * u0) / math.hypot(u1 - u0, h)
            if d > rho:
                hi = u0
            else:
                lo = u0
        Mw = basis(out, DRUM_AX, Vector((0, 0, 1)), DRUM_C + DRUM_AX * (u_ax - 0.15))
        one("wedge", [WOOD("Y")], lambda a: a.prism(Mw @ Matrix.Rotation(math.radians(90), 4, "X"),
                                                   [(u0, 0), (u1, 0), (u1, h)], -0.3, 0.0, 0), bevel=0.012)


# ------------------------------------------------------------------------------------------------------------ rollers
def rollers():
    if T == 1:
        per = 60.0
        teeth_core = mat("rollA-core", (72, 64, 56), rough=0.7, metal=0.3, wear=(100, 90, 78), dirt=0.25, fold=12)
        tooth = mat("rollA-tooth", (226, 214, 188), rough=0.65, wear=(176, 162, 134), dirt=0.25, fold=12)
        iron = mat("roll-iron", (80, 84, 86), rough=0.55, metal=0.6, wear=(120, 116, 110), dirt=0.2, fold=12)
        pulley_m = mat("pulley", (96, 100, 104), rough=0.5, metal=0.65, wear=(140, 136, 128), dirt=0.2, fold=6)
        hubA = spin("rollA", (0, -YR, ZR), AXIS_X, -per)

        def ra(a):
            a.cone(Tm((0, 0, -HL)), 0.6, 0.6, 2 * HL, 0, 40)
            for z in (-HL - 0.06, HL):
                a.cone(Tm((0, 0, z)), 0.64, 0.64, 0.06, 2, 40)
            sp = 2 * HL / 6
            for j in range(6):                                                # square bone teeth in a neat grid
                zc = -HL + sp * (j + 0.5)
                for i in range(12):
                    ang = 2 * math.pi * (i + 0.5) / 12
                    a.cube(Matrix.Rotation(ang, 4, "Z") @ Tm((0.675, 0, zc)), (0.19, 0.26, 0.4), 1)
            a.cone(Tm((0, 0, -2.42)), 0.09, 0.09, 2.42 + PF + 0.3, 2, 16)     # the axle, out through the panel
            a.cone(Tm((0, 0, PF + 0.28)), 0.11, 0.08, 0.06, 2, 6)
        one("rollA-body", [teeth_core, tooth, iron], ra, hubA, bevel=0.02)
        one("rollA-pulley", [pulley_m], lambda a: add_pulley(a, 0.34, PF + 0.08, PF + 0.26, 6), hubA)

        holey = mat("rollB-skin", (214, 206, 186), rough=0.6, wear=(170, 158, 130), dirt=0.25, fold=12)
        hole = mat("rollB-hole", (30, 24, 20), rough=0.9, dirt=0.0, speck=0.0, bump=0.0)
        hubB = spin("rollB", (0, YR, ZR), AXIS_X, per)
        b = Acc()
        b.cone(Tm((0, 0, -HL)), 0.74, 0.74, 2 * HL, 0, 64)
        body = b.obj("rollB-body", [holey, hole], hubB, smooth=True)
        c = Acc()
        sp = 2 * HL / 5
        for j in range(5):                                                    # round holes in neat rows
            zc = -HL + sp * (j + 0.5)
            for i in range(12):
                ang = 2 * math.pi * (i + 0.5 * (j % 2)) / 12
                c.cone(Matrix.Rotation(ang, 4, "Z") @ Tm((0.6, 0, zc)) @ Matrix.Rotation(math.pi / 2, 4, "Y"),
                       0.1, 0.1, 0.18, 0, 16)
        cut = c.obj("cutter", [hole], hubB, smooth=False)
        mo = body.modifiers.new("holes", "BOOLEAN")
        mo.object, mo.operation, mo.solver, mo.material_mode = cut, "DIFFERENCE", "EXACT", "TRANSFER"
        bpy.context.view_layer.update()
        me = bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        body.modifiers.clear()
        old = body.data
        body.data = me
        bpy.data.meshes.remove(old)
        bpy.data.objects.remove(cut)
        hm = [i for i, m in enumerate(me.materials) if m and m.name.startswith("rollB-hole")]
        for p in me.polygons:
            p.use_smooth = p.material_index not in hm and abs(p.normal.z) < 0.5

        def rb(a):
            for z in (-HL - 0.06, HL):
                a.cone(Tm((0, 0, z)), 0.77, 0.77, 0.06, 0, 48)
            a.cone(Tm((0, 0, -2.42)), 0.09, 0.09, 4.84, 0, 16)
        one("rollB-ends", [iron], rb, hubB, bevel=0.01)

        def comb(a):                                                          # a row of short dark spikes on the gap
            zc = ZR + 0.62
            a.cone(aim((1, 0, 0), (-2.62, 0, zc)), 0.06, 0.06, 5.24, 0, 12)
            for i in range(15):
                x = -1.6 + 3.2 * i / 14
                a.cone(Tm((x, 0, zc + 0.04)), 0.05, 0.0, 0.2, 0, 10)
            for x in (-2.55, 2.55):
                a.cube(Tm((x, 0, zc - 0.12)), (0.14, 0.18, 0.2), 0)
        one("comb", [DARK()], comb)
        return

    # tiers 2 and 3: black iron rollers packed with cone spikes, the two rollers' rows passing between each other
    rows = 5 if T == 2 else 6
    core = 0.55 if T == 2 else 0.5
    L = 0.34 if T == 2 else 0.45
    rb = 0.15 if T == 2 else 0.14
    per = 30.0
    black = mat("roll-black", (34, 35, 37), rough=0.6, metal=0.5, wear=(66, 64, 62), wear_amt=0.45, dirt=0.15, fold=12)
    spike = mat("spike%d" % T, (82, 84, 88), rough=0.5 if T == 2 else 0.75, metal=0.6, wear=(120, 120, 118),
                wear_amt=0.35, dirt=0.15, fold=12, heat=((128, 36, 20), 0.9) if T == 3 else None)
    collar = mat("collar", (30, 30, 32), rough=0.55, metal=0.5, dirt=0.1, fold=12)
    sp = 2 * HL / rows
    for name, y, sgn, off in (("rollA", -YR, -1, 0.25), ("rollB", YR, 1, 0.75)):
        hub = spin(name, (0, y, ZR), AXIS_X, sgn * per)

        def body(a):
            a.cone(Tm((0, 0, -HL)), core, core, 2 * HL, 0, 40)
            for z in (-HL - 0.07, HL):
                a.cone(Tm((0, 0, z)), core + 0.06, core + 0.06, 0.07, 0, 40)
            a.cone(Tm((0, 0, -2.42)), 0.09, 0.09, 2.42 + (PF + 0.12 if name == "rollA" else 2.42), 0, 16)
            if name == "rollA":
                a.cone(Tm((0, 0, PF + 0.1)), 0.12, 0.09, 0.06, 0, 6)
        one(name + "-body", [black], body, hub, bevel=0.015)

        def spikes(a):
            for j in range(rows):
                zc = -HL + sp * (j + off)
                for i in range(12):
                    ang = 2 * math.pi * (i + 0.5 * (j % 2)) / 12
                    R = Matrix.Rotation(ang, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "Y")   # local Z -> radial
                    M = Tm((0, 0, zc)) @ R @ Tm((0, 0, core - 0.03))
                    a.cone(M, rb, 0.006, L + 0.03, 0, 12,
                           heat=lambda co, M=M: max(0.0, min(1.0, (M.inverted() @ co).z / (L + 0.03))))
                    a.cone(M @ Tm((0, 0, 0.0)), rb * 1.3, rb * 1.22, 0.09, 1, 12,
                           heat=lambda co: 0.0)
        one(name + "-spikes", [spike, collar], spikes, hub, smooth=True)


# ------------------------------------------------------------------------------------------------------------ the drive
def belt_path(circles):
    """The closed path of a belt run clockwise (seen from +X: y right, z up) round the outside of the circles, in
    travel order. Returns [(point, outward normal)] and its length."""
    def tangent(c1, r1, c2, r2):
        d = c2 - c1
        Ld = d.length
        u = d / Ld
        v = Vector((-u.y, u.x))
        ca = (r1 - r2) / Ld
        sa = math.sqrt(1 - ca * ca)
        for s in (1, -1):
            n = u * ca + v * (s * sa)
            p1, p2 = c1 + n * r1, c2 + n * r2
            if (p2 - p1).dot(Vector((n.y, -n.x))) > 0:
                return n
        raise ValueError("no tangent")

    k = len(circles)
    tn = [tangent(*circles[i], *circles[(i + 1) % k]) for i in range(k)]
    pts = []
    for j in range(k):
        c, r = circles[j]
        a0 = math.atan2(tn[j - 1].y, tn[j - 1].x)
        a1 = math.atan2(tn[j].y, tn[j].x)
        while a1 > a0:
            a1 -= 2 * math.pi
        steps = max(3, int((a0 - a1) * r / 0.025))
        for i in range(steps + 1):
            a = a0 + (a1 - a0) * i / steps
            n = Vector((math.cos(a), math.sin(a)))
            pts.append((c + n * r, n))
        p_end = c + tn[j] * r
        cn, rn = circles[(j + 1) % k]
        q = cn + tn[j] * rn
        steps = max(1, int((q - p_end).length / 0.05))
        for i in range(1, steps):
            pts.append((p_end + (q - p_end) * (i / steps), tn[j]))
    acc = [0.0]
    for (p, _), (q, _) in zip(pts, pts[1:] + pts[:1]):
        acc.append(acc[-1] + (q - p).length)
    return pts, acc


def drive():
    steel = STEEL()
    dark = DARK()
    if T == 1:
        # belt: round the pulley on roller A's axle, an idler at the top right and a small toothed gear lower down;
        # roller B is turned the other way by a pair of gears inside the panel (not seen)
        rA, D = 0.34, 0.34 * math.radians(60)
        rI = D / math.radians(72)                      # 5 spokes: 72 degrees a loop
        rG = D / math.radians(108)                     # 10 teeth: 108 degrees (3 teeth) a loop, the belt on the tips
        rpG = rG / (1 + 0.9 * 2 / 10)
        cA, cI, cG = Vector((-YR, ZR)), Vector((0.85, 1.9)), Vector((0.05, 0.8))
        degG = 108.0
        pul = mat("pulley", (96, 100, 104), rough=0.5, metal=0.65, wear=(140, 136, 128), dirt=0.2, fold=6)
        hubI = spin("idler", (PF, cI.x, cI.y), AXIS_X, -72.0)

        def idl(a):
            add_pulley(a, rI, 0.08, 0.26, 5)
            a.cone(Tm((0, 0, -0.1)), 0.055, 0.055, 0.4, 0, 12)
        one("idler-wheel", [mat("idler", (96, 100, 104), rough=0.5, metal=0.65, wear=(140, 136, 128), dirt=0.2,
                                fold=5)], idl, hubI)
        hubG = spin("gearG", (PF, cG.x, cG.y), AXIS_X, -degG)

        def gg(a):
            add_gear(a, rpG, 10, 0.095, 0.245, spokes=0, hub_r=0.06)
            for z in (0.065, 0.245):
                a.cone(Tm((0, 0, z)), rG + 0.035, rG + 0.035, 0.03, 0, 32)
            a.cone(Tm((0, 0, -0.1)), 0.055, 0.055, 0.4, 0, 12)
        one("gearG-wheel", [mat("gearG", (150, 154, 156), rough=0.45, metal=0.75, wear=(108, 110, 110), dirt=0.2,
                                fold=10)], gg, hubG, bevel=0.006)

        def bosses(a):
            for c in (cI, cG):
                a.lathe(Tm((PF, c.x, c.y)) @ basis(*AXIS_X), [(0.06, 0), (0.13, 0), (0.13, 0.05), (0.06, 0.05),
                                                               (0.06, 0)], 0, 20)
            a.lathe(Tm((PF, cA.x, cA.y)) @ basis(*AXIS_X), [(0.1, 0), (0.17, 0), (0.17, 0.05), (0.1, 0.05), (0.1, 0)],
                    0, 20)
        one("panel-boss", [dark], bosses)

        pts, acc = belt_path([(cA, rA), (cI, rI), (cG, rG)])
        Lb = acc[-1]
        xb, w, th = PF + 0.17, 0.09, 0.035
        leather = mat("belt", (62, 40, 28), rough=0.7, wear=(92, 64, 44), dirt=0.1, speck=0.1)
        bm = bmesh.new()
        rows = []
        for p, n in pts:
            c = p + n * (th / 2 - 0.004)
            rows.append([bm.verts.new((xb + dx, c.x + n.x * dn, c.y + n.y * dn))
                         for dx, dn in ((-w / 2, -th / 2), (w / 2, -th / 2), (w / 2, th / 2), (-w / 2, th / 2))])
        for i in range(len(rows)):
            r0, r1 = rows[i], rows[(i + 1) % len(rows)]
            for j in range(4):
                bm.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        kit.mesh_ob("belt", bm, [leather], smooth=True)

        # the belt's lacing clips run with it: spaced so the loop moves them a whole number of spaces
        nk = max(4, round(Lb / (D / 2)))
        spc = Lb / nk
        shift = 2 * spc
        clip_m = mat("clip", (150, 150, 146), rough=0.4, metal=0.8, dirt=0.0, speck=0.0, bump=0.0)
        ce = bpy.data.objects.new("clips", None)
        kit.link(ce)
        kit.MOVING.append(ce)
        clips = [one("clips-%02d" % i, [clip_m], lambda a: a.cube(Matrix(), (w * 0.8, 0.05, 0.018)), ce, bevel=0.004)
                 for i in range(nk)]

        def at(s):
            s %= Lb
            lo, hi = 0, len(acc) - 1
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if acc[mid] <= s:
                    lo = mid
                else:
                    hi = mid
            p0, n0 = pts[lo % len(pts)]
            p1, n1 = pts[(lo + 1) % len(pts)]
            t = (s - acc[lo]) / max(1e-9, acc[lo + 1] - acc[lo])
            n = (n0 * (1 - t) + n1 * t).normalized()
            p = p0 * (1 - t) + p1 * t + n * (th - 0.004 + 0.006)
            return p, n

        def move(f):
            for i, ob in enumerate(clips):
                p, n = at(i * spc + shift * f)
                tg = Vector((n.y, -n.x))
                ob.matrix_world = basis((1, 0, 0), (0, tg.x, tg.y), (0, n.x, n.y), (xb, p.x, p.y))
        EXTRA.append(move)
        return

    # tiers 2 and 3: cogs in front of the hot plate
    if T == 2:
        rp1, c1 = 0.5, Vector((-0.5, 1.0))
        rp2 = rp1 * 8 / 12
        ang = math.radians(40)
        c2 = c1 + Vector((math.cos(ang), math.sin(ang))) * (rp1 + rp2)
        cogs = [("cogA", c1, rp1, 12, 4, ang, 90.0), ("cogB", c2, rp2, 8, 0, ang + math.pi - math.pi / 8, -135.0)]
    else:
        rp1, c1 = 0.5, Vector((-0.55, 1.0))
        c2 = c1 + Vector((2 * rp1, 0))
        cogs = [("cogA", c1, rp1, 12, 4, 0.0, 90.0), ("cogB", c2, rp1, 12, 4, math.pi - math.pi / 12, -90.0)]
    for name, c, rp, n, spokes, phase, per in cogs:
        hub = spin(name, (PF, c.x, c.y), AXIS_X, per)

        def g(a, rp=rp, n=n, spokes=spokes, phase=phase):
            add_gear(a, rp, n, 0.15, 0.27, phase, spokes, 0, hub_r=0.1)
            a.cone(Tm((0, 0, -0.08)), 0.06, 0.06, 0.42, 0, 12)
            a.cone(Tm((0, 0, 0.3)), 0.09, 0.07, 0.05, 0, 6)
        one(name + "-wheel", [mat(name + "-m", (150, 154, 156), rough=0.45, metal=0.75, wear=(108, 110, 110),
                                  dirt=0.2, fold=4 if spokes else n)], g, hub, bevel=0.008)

    def bosses(a):
        for _, c, *_ in cogs:
            a.lathe(Tm((PF, c.x, c.y)) @ basis(*AXIS_X), [(0.06, 0), (0.14, 0), (0.14, 0.1), (0.06, 0.1), (0.06, 0)], 0,
                    20)
        a.lathe(Tm((PF, -YR, ZR)) @ basis(*AXIS_X), [(0.1, 0), (0.17, 0), (0.17, 0.1), (0.1, 0.1), (0.1, 0)], 0, 20)
    one("panel-boss", [dark], bosses)


# ------------------------------------------------------------------------------------------------------------ feeders
POST_A, POST_B = polar(3.1, 188), polar(3.1, 55)


def bones_in(a, M, sx, sy, z, n, mi):
    """n little bones heaped in a box sx by sy (local XY, centred) at height z."""
    for i in range(n):
        p = Vector((rnd.uniform(-sx / 2 + 0.12, sx / 2 - 0.12), rnd.uniform(-sy / 2 + 0.1, sy / 2 - 0.1),
                    z + rnd.uniform(0.0, 0.12)))
        yaw, tilt = rnd.uniform(0, math.pi), rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(yaw), math.sin(yaw), tilt)).normalized()
        ln = rnd.uniform(0.22, 0.34)
        B = M @ Tm(p) @ aim(d)
        a.cone(B @ Tm((0, 0, -ln / 2)), 0.032, 0.032, ln, mi, 8)
        side = Vector((1, 0, 0))
        for e in (-ln / 2, ln / 2):
            for s in (-1, 1):
                a.sphere(B @ Tm(side * (0.035 * s) + Vector((0, 0, e))), 0.045, mi, 8, 6)


def feeder1():
    """Two wooden posts at the back, a cross bar, and a small open box of bones hanging from it on short ropes."""
    iron = IRON()
    bdir = (POST_B - POST_A).normalized()
    ang = math.degrees(math.atan2(bdir.y, bdir.x))
    mid = (POST_A + POST_B) / 2

    def fn(a):
        for p in (POST_A, POST_B):
            a.cube(Tm((p.x, p.y, 2.375)) @ Matrix.Rotation(math.radians(ang), 4, "Z"), (0.24, 0.24, 4.75), 0)
        a.cube(Tm((mid.x, mid.y, 4.6)) @ Matrix.Rotation(math.radians(ang), 4, "Z"),
               ((POST_B - POST_A).length + 0.54, 0.22, 0.22), 1)
    one("feed-wood", [WOOD("Z"), WOOD2("X")], fn, bevel=0.025)

    def irons(a):
        for p in (POST_A, POST_B):
            out = Vector((p.x, p.y, 0)).normalized()
            a.cube(Tm((p.x, p.y, 0.03)), (0.42, 0.42, 0.06), 0)                     # iron shoes
            r0 = math.sqrt(r_out(1.8) ** 2) - 0.03
            bar(a, out * r0 + Vector((0, 0, 1.8)), out * (p.length + 0.14) + Vector((0, 0, 1.8)), 0.08, 0.1, 0)
            a.cube(Tm((p.x, p.y, 1.75)) @ Matrix.Rotation(math.radians(ang), 4, "Z"), (0.3, 0.3, 0.1), 0)  # its collar
            a.cube(Tm((p.x, p.y, 4.38)) @ Matrix.Rotation(math.radians(ang), 4, "Z"), (0.3, 0.3, 0.08), 0)
    one("feed-iron", [iron], irons, bevel=0.01)

    across = Vector((-bdir.y, bdir.x, 0))
    hub = rocker("box", basis(bdir, across, (0, 0, 1), (mid.x, mid.y, 4.6)), 2.2, 1)
    W, Dp, H, zb = 1.3, 0.85, 0.5, -1.6

    def box(a):
        t = 0.07
        a.cube(Tm((0, 0, zb + t / 2)), (W, Dp, t), 0)
        for s in (-1, 1):
            for k in range(2):
                zk = zb + t + 0.1075 + k * 0.215
                a.cube(Tm((0, s * (Dp / 2 - t / 2), zk)), (W, t, 0.21), 0)
                a.cube(Tm((s * (W / 2 - t / 2), 0, zk)), (t, Dp - 2 * t, 0.21), 0)
        for sx in (-1, 1):                                                    # iron corner straps
            for sy in (-1, 1):
                a.cube(Tm((sx * (W / 2 + 0.008), sy * (Dp / 2 - 0.08), zb + H / 2)), (0.02, 0.16, H), 1)
                a.cube(Tm((sx * (W / 2 - 0.08), sy * (Dp / 2 + 0.008), zb + H / 2)), (0.16, 0.02, H), 1)
        bones_in(a, Matrix(), W, Dp, zb + 0.36, 20, 2)
    one("box-body", [WOOD("X"), iron, BONE()], box, hub, bevel=0.012)

    rope = mat("rope", (176, 150, 104), rough=0.9, dirt=0.15, speck=0.2, bump=0.2)

    def ropes(a):
        for sx in (-1, 1):
            top = Vector((sx * 0.4, 0, -0.09))
            for sy in (-1, 1):
                rod(a, Vector((sx * (W / 2 - 0.1), sy * (Dp / 2 - 0.06), zb + H - 0.02)), top, 0.022, 0, 8)
            a.cone(Tm((sx * 0.4, 0, 0.0)) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ Tm((0, 0, -0.03)), 0.13, 0.13,
                   0.06, 0, 16)                                               # the rope's turns round the bar
    one("box-ropes", [rope], ropes, hub)


def paddle():
    """The big black paddle at the back left, clamped to the bowl."""
    deg = 160
    c = polar(2.97, deg)
    black = mat("paddle", (26, 27, 29), rough=0.45, metal=0.3, wear=(58, 58, 60), wear_amt=0.4, dirt=0.1)
    iron = IRON()
    face = polar(1, -45)                                                    # the blade faces the viewer
    along = polar(1, 45)

    def fn(a):
        a.cone(Tm((c.x, c.y, 1.5)), 0.07, 0.07, 1.6, 0, 14)
        outline = []
        for i in range(9):                                                    # spade blade: square shoulders, round top
            t = math.pi * i / 8
            outline.append((0.55 * math.cos(t), 1.3 + 0.28 * math.sin(t)))
        outline = [(0.0, -0.14), (0.55, 0.14)] + outline + [(-0.55, 0.14)]
        M = basis(along, (0, 0, 1), face, (c.x, c.y, 3.0))
        a.prism(M, [(x, y) for x, y in outline[1:]] + [outline[0]], -0.03, 0.03, 0)
        a.cube(Tm((c.x, c.y, 2.95)) @ Matrix.Rotation(math.radians(45), 4, "Z"), (0.22, 0.12, 0.25), 1)  # socket

    one("paddle", [black, iron], fn, bevel=0.01)

    def clamp(a):
        out = polar(1, deg)
        for z in (1.62, 1.86):
            bar(a, out * (r_out(z) - 0.03) + Vector((0, 0, z)), out * 3.06 + Vector((0, 0, z)), 0.1, 0.08, 0)
            a.lathe(Tm((c.x, c.y, z - 0.05)), [(0.07, 0), (0.11, 0), (0.11, 0.1), (0.07, 0.1), (0.07, 0)], 0, 16)
    one("paddle-clamp", [iron], clamp, bevel=0.008)


POST2 = polar(3.36, 95)
PIN_Z = 5.2


def chute():
    """A big plank chute on a crank arm at the top of an iron post at the back right, tipped down over the rollers."""
    steel = mat("post", (122, 126, 130), rough=0.5, metal=0.6, wear=(90, 92, 94), rust=(110, 66, 40), rust_at=0.72,
                dirt=0.35)
    iron = IRON()
    h = (-POST2).normalized()
    h.z = 0
    h.normalize()
    ax = Vector((-h.y, h.x, 0))
    if ax.x < 0:
        ax = -ax
    tilt = math.radians(22)

    def post(a):
        a.cone(Tm((POST2.x, POST2.y, 0)), 0.26, 0.26, 0.08, 0, 24)              # its foot
        a.cone(Tm((POST2.x, POST2.y, 0)), 0.15, 0.14, 4.78, 0, 24)
        a.cone(Tm((POST2.x, POST2.y, 4.72)), 0.2, 0.2, 0.08, 0, 24)             # cap
        for s in (-1, 1):                                                       # the fork holding the pin
            a.cube(basis(ax, h, (0, 0, 1), (POST2.x, POST2.y, 4.8)) @ Tm((s * 0.13, 0, 0.22)), (0.05, 0.24, 0.48), 0)
        a.cone(aim(ax, Vector((POST2.x, POST2.y, PIN_Z)) - ax * 0.22), 0.055, 0.055, 0.44, 0, 12)
        for i in range(8):
            p = polar(0.21, 22.5 + 45 * i, 0.06) + Vector((POST2.x, POST2.y, 0))
            a.cone(Tm(p), 0.035, 0.03, 0.04, 0, 6)
        out = Vector((POST2.x, POST2.y, 0)).normalized()                       # a stay back to the bowl
        bar(a, out * (r_out(1.7) - 0.04) + Vector((0, 0, 1.7)), out * 3.24 + Vector((0, 0, 2.3)), 0.09, 0.07, 0)
        a.cube(Tm((POST2.x, POST2.y, 2.25)), (0.36, 0.36, 0.12), 0)
    one("post", [steel], post, bevel=0.01)

    d = h * math.cos(tilt) - Vector((0, 0, math.sin(tilt)))
    u = h * math.sin(tilt) + Vector((0, 0, math.cos(tilt)))
    hub = rocker("chute", basis(ax, d, u, (POST2.x, POST2.y, PIN_Z)), 1.8, 2)
    d0, d1, w, ub, ut = 0.7, 3.3, 0.62, -1.0, -0.32
    planks = WOOD("Y")
    planks2 = WOOD2("Y")

    def body(a):
        t = 0.08
        for i in range(5):                                                    # the floor
            y = -w + 0.248 * (i + 0.5)
            a.cube(Tm((y, (d0 + d1) / 2, ub + t / 2)), (0.24, d1 - d0, t), i % 2)
        for s in (-1, 1):                                                     # the side walls
            for k in range(3):
                a.cube(Tm((s * (w - t / 2), (d0 + d1) / 2, ub + t + 0.1 + 0.2 * k)), (t, d1 - d0, 0.195), (k + 1) % 2)
        for k in range(3):                                                    # the back wall
            a.cube(Tm((0, d0 + t / 2, ub + t + 0.1 + 0.2 * k)), (2 * w - 2 * t, t, 0.195), k % 2)
        for i in range(5):                                                    # the closed lid
            a.cube(Tm((-w - 0.02 + 0.2528 * (i + 0.5), (d0 + 2.05) / 2, ut + 0.035)), (0.25, 2.05 - d0, 0.07), (i + 1) % 2)
        # a few bones at the mouth
        for i in range(7):
            p = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(d1 - 0.75, d1 - 0.15), ub + 0.1))
            B = Tm(p) @ aim(Vector((math.cos(i * 1.7), math.sin(i * 1.7), 0.15)))
            a.cone(B @ Tm((0, 0, -0.14)), 0.03, 0.03, 0.28, 3, 8)
            for e in (-0.14, 0.14):
                for s in (-1, 1):
                    a.sphere(B @ Tm((0.03 * s, 0, e)), 0.042, 3, 8, 6)

    one("chute-body", [planks, planks2, iron, BONE()], body, hub, bevel=0.012)

    heavy = T >= 3

    def irons(a):
        t = 0.025
        straps = [d0 + 0.18, d1 - 0.18] + ([(d0 + d1) / 2 + 0.25] if heavy else [])
        for y in straps:                                                      # iron straps round the corners
            a.cube(Tm((0, y, ub - t / 2 + 0.002)), (2 * w + 2 * t, 0.12, t), 0)
            for s in (-1, 1):
                a.cube(Tm((s * (w + t / 2), y, (ub + ut - t) / 2)), (t, 0.12, ut - ub + t), 0)
        for s in (-1, 1):                                                     # corner angles at the mouth
            for z in (ub - t, ut - 0.1):
                a.cube(Tm((s * (w + t / 2 - 0.01), d1 - 0.06, z)), (t + 0.02, 0.14, 0.12), 0)
        if heavy:                                                             # iron plates on the front half
            for s in (-1, 1):
                a.cube(Tm((s * (w + 0.012), d1 - 0.55, (ub + ut) / 2)), (0.02, 1.0, ut - ub - 0.04), 1)
            a.cube(Tm((0, d1 - 0.55, ub - 0.035)), (2 * w + 0.02, 1.0, 0.02), 1)
            for s in (-1, 1):
                for yy in (d1 - 0.95, d1 - 0.15):
                    for zz in (ub + 0.12, ut - 0.12):
                        a.cone(Tm((s * (w + 0.022), yy, zz)) @ aim((s, 0, 0)), 0.025, 0.02, 0.02, 1, 6)
        hr = 0.07 if heavy else 0.045                                         # the lid's hinges
        for x in ((-0.3, 0.0, 0.3) if heavy else (-0.3, 0.3)):
            a.cone(Tm((x - 0.09, d0 - 0.02, ut + 0.02)) @ aim((1, 0, 0)), hr, hr, 0.18, 0, 12)
            a.cube(Tm((x, d0 + 0.25, ut + 0.08)), (0.1 if not heavy else 0.14, 0.5 if not heavy else 0.7, 0.02), 0)
            a.cube(Tm((x, d0 - 0.025, ut - 0.32)), (0.1 if not heavy else 0.14, 0.02, 0.32), 0)
        # the crank arm, from the pin down to the back wall
        a.cone(Tm((-0.06, 0, 0)) @ aim((1, 0, 0)), 0.12, 0.12, 0.12, 0, 20)
        bar(a, (0, 0.0, 0.0), (0, d0 - 0.06, -0.55), 0.1, 0.12, 0)
        a.cube(Tm((0, d0 - 0.03, -0.7)), (0.3, 0.05, 0.3), 0)
    plate = mat("chute-plate", (86, 84, 82), rough=0.55, metal=0.6, wear=(130, 120, 110), rust=(120, 62, 34),
                rust_at=0.6, dirt=0.3)
    one("chute-iron", [iron, plate], irons, hub, bevel=0.006)


def chimney():
    """A short iron pipe at the back right, next to the post, from the fire under the bowl; a little smoke."""
    sooty = mat("chimney", (58, 58, 60), rough=0.75, metal=0.4, wear=(96, 80, 66), rust=(118, 62, 34), rust_at=0.6,
                dirt=0.5)
    c = polar(3.3, 68)
    top = 3.7

    def fn(a):
        a.cone(Tm((c.x, c.y, 0)), 0.32, 0.3, 0.1, 0, 24)
        a.cone(Tm((c.x, c.y, 0)), 0.2, 0.2, top, 0, 24)
        for z in (0.95, 2.1, 3.1):
            a.cone(Tm((c.x, c.y, z)), 0.235, 0.235, 0.09, 0, 24)
        a.lathe(Tm((c.x, c.y, top - 0.12)), [(0.15, 0), (0.27, 0.0), (0.27, 0.16), (0.15, 0.16), (0.15, 0)], 0, 24)
        out = Vector((c.x, c.y, 0)).normalized()
        rod(a, out * (r_out(0.7) - 0.06) + Vector((0, 0, 0.7)), Vector((c.x, c.y, 0.7)), 0.14, 0, 20)
        a.lathe(aim(-out, out * (r_out(0.7) + 0.02) + Vector((0, 0, 0.7))),
                [(0.14, 0), (0.22, 0), (0.22, 0.06), (0.14, 0.06), (0.14, 0)], 0, 20)
    one("chim", [sooty], fn, bevel=0.01)

    smoke_m = mat("smoke", (118, 112, 108), rough=1.0, dirt=0.0, speck=0.0, bump=0.0, alpha=True)
    se = bpy.data.objects.new("smoke", None)
    kit.link(se)
    kit.MOVING.append(se)
    n = 9
    puffs = [kit.blob("smoke-%d" % i, (0, 0, 0), 0.3, 0.85, smoke_m, se, stretch=(1.0 + 0.2 * (i % 3), 1.0)) for i in range(n)]
    for p in puffs:
        p.modifiers.new("s", "SUBSURF").render_levels = 2

    def move(f):
        for i, p in enumerate(puffs):
            ph = (f + i / n) % 1.0
            p.location = (c.x + 0.45 * ph + 0.06 * math.sin(7 * i), c.y + 0.3 * ph, top + 0.12 + 1.9 * ph)
            s = 0.5 + 1.5 * ph
            p.scale = (s, s, s)
            p.rotation_euler = (0, 0, 2.3 * i)
            p.color = (1, 1, 1, 0.5 * math.sin(math.pi * ph) ** 1.5)
    EXTRA.append(move)


# ------------------------------------------------------------------------------------------------------------ build
def build():
    base()
    bowl()
    panel()
    cup()
    drum()
    rollers()
    drive()
    if T == 1:
        feeder1()
        paddle()
    else:
        chute()
    if T >= 3:
        chimney()


kit.run(build, turn)
