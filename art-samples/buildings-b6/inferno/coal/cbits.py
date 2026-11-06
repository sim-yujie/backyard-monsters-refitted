"""cbits.py : the generic geometry and material helpers of the approved Bone Cruncher (../bone-clean2/crusher.py,
lines 75-333, copied unchanged: matrices, the worn-paint material, the folded texture for turning parts, the solid
accumulator, bars, rods, rivets, cogs), so the Coal Extractor is built the same way."""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import kit

K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)


def grey(x):
    return (x, x, x, 1)


def polar(r, deg, z=0.0):
    a = math.radians(deg)
    return Vector((r * math.cos(a), r * math.sin(a), z))


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
