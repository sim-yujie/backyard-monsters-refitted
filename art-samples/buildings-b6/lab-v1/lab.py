"""lab.py : the Monster Lab (Flash building 116) as a 3D model, in the approved 3D buildings' family (the HCC/Hatchery
camera, light, render settings and scale; no outline). Flash has one look for every level (1-4), animated: the glass
dome's swirling brew (32 frames) and the grey cogs turning in the two side doors (5 frames). One model, one still.
The shared helpers (materials, meshes, camera, checks) come from the HCC's hcc.py (art/buildings-3d-hcc).

    blender -b --factory-startup -P lab.py -- 1 fit      work/fit-L1.png    quick render without the ground, 4 px per Flash px
    blender -b --factory-startup -P lab.py -- 1 still    render/L1-base.png (with the ground shadow), render/L1-alone.png
    blender -b --factory-startup -P lab.py -- 1 anim     render/anim/dome-NN.png (32), doorL-NN.png, doorR-NN.png (5 each):
                                                         the whole scene rendered only in the moving part's box
    blender -b --factory-startup -P lab.py -- 1 check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P lab.py -- 1 gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P lab.py -- 1 probe sx sy ...   what the camera sees first through Flash pixels
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "fit"]
LEVEL = int(ARGS[0])
MODE = ARGS[1] if len(ARGS) > 1 else "fit"

EL = 30.0
ORIGIN = (-0.5, 45.0)                # Flash pixel of the world origin (the plan's middle on the ground)
GROUND = 0.0
FRAME = (-86, -104, 126, 82)         # the canvas in Flash px (as fref.FRAME)
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL


def _envf(k, d):
    return float(os.environ.get(k, d))


rng = random.Random(1600)


def px(sx, sy, X=None, Y=None, Z=None):
    """The world point on Flash pixel (sx, sy) with one of X, Y, Z given."""
    a = (sx - ORIGIN[0]) / SX                  # X + Y
    if Z is not None:
        d = (sy - ORIGIN[1] + SZ * Z) / SY     # X - Y
        return Vector(((a + d) / 2, (a - d) / 2, Z))
    if Y is not None:
        X = a - Y
    else:
        Y = a - X
    return Vector((X, Y, (SY * (X - Y) + ORIGIN[1] - sy) / SZ))


def scr(v):
    """Flash pixel of world point v."""
    return (ORIGIN[0] + SX * (v[0] + v[1]), ORIGIN[1] + SY * (v[0] - v[1]) - SZ * v[2])


# ------------------------------------------------------------------------------------------------------------ scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == kind]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == kind
                sc.cycles.device = "GPU"
                break
        except TypeError:
            continue
    return sc


SC = reset()
COLL = SC.collection
MOVING = []            # objects that turn (hidden from the base picture's camera, alone in the frame layers)


# ------------------------------------------------------------------------------------------------------------ materials
def srgb(r, g, b, a=1.0):
    def f(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), a)


class NT:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.t = self.m.node_tree
        self.t.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial")
        self.bsdf = self.n("ShaderNodeBsdfPrincipled")
        self.link(self.bsdf.outputs[0], self.out.inputs["Surface"])

    def n(self, kind, **props):
        node = self.t.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.t.links.new(a, b)

    def sock(self, node, name, kind=None, out=False):
        for s in (node.outputs if out else node.inputs):
            if s.name == name and (kind is None or s.type == kind):
                return s
        raise KeyError(name)

    def coords(self, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        tc = self.n("ShaderNodeTexCoord")
        mp = self.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = scale
        mp.inputs["Location"].default_value = loc
        mp.inputs["Rotation"].default_value = rot
        self.link(tc.outputs["Object"], mp.inputs["Vector"])
        return mp.outputs[0]

    def ramp(self, fac, stops):
        r = self.n("ShaderNodeValToRGB")
        el = r.color_ramp.elements
        el[0].position, el[0].color = stops[0]
        el[1].position, el[1].color = stops[-1]
        for pos, col in stops[1:-1]:
            e = el.new(pos)
            e.color = col
        self.link(fac, r.inputs[0])
        return r.outputs[0]

    def mix(self, a, b, fac, blend="MIX"):
        m = self.n("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        for sname, v in (("A", a), ("B", b)):
            s = self.sock(m, sname, "RGBA")
            if isinstance(v, tuple):
                s.default_value = v
            else:
                self.link(v, s)
        if isinstance(fac, (int, float)):
            m.inputs[0].default_value = fac
        else:
            self.link(fac, m.inputs[0])
        return self.sock(m, "Result", "RGBA", out=True)

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0):
        nz = self.n("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = detail
        nz.inputs["Roughness"].default_value = rough
        nz.inputs["Distortion"].default_value = dist
        self.link(vec, nz.inputs["Vector"])
        return nz.outputs["Fac"]

    def grime(self, col, low=0.0, high=1.4, amount=0.35, ao_min=0.55):
        """Darker toward the ground (world height), and in the creases (ambient occlusion): Flash's soft dirt."""
        geo = self.n("ShaderNodeNewGeometry")
        sep = self.n("ShaderNodeSeparateXYZ")
        self.link(geo.outputs["Position"], sep.inputs[0])
        mr = self.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = low, high
        mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0 - amount, 1.0
        self.link(sep.outputs["Z"], mr.inputs[0])
        ao = self.n("ShaderNodeAmbientOcclusion", samples=8)
        ao.inputs["Distance"].default_value = 0.35
        aor = self.n("ShaderNodeMapRange")
        aor.inputs[3].default_value, aor.inputs[4].default_value = ao_min, 1.0
        self.link(ao.outputs["AO"], aor.inputs[0])
        mul = self.n("ShaderNodeMath", operation="MULTIPLY")
        self.link(mr.outputs[0], mul.inputs[0])
        self.link(aor.outputs[0], mul.inputs[1])
        grey = self.n("ShaderNodeCombineColor")
        for i in range(3):
            self.link(mul.outputs[0], grey.inputs[i])
        m = self.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        m.inputs[0].default_value = 1.0
        if isinstance(col, tuple):
            self.sock(m, "A", "RGBA").default_value = col
        else:
            self.link(col, self.sock(m, "A", "RGBA"))
        self.link(grey.outputs[0], self.sock(m, "B", "RGBA"))
        return self.sock(m, "Result", "RGBA", out=True)

    def bump(self, h, strength=0.2, dist=0.02):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = dist
        self.link(h, b.inputs["Height"])
        self.link(b.outputs[0], self.bsdf.inputs["Normal"])

    def set(self, **kw):
        names = dict(rough="Roughness", metal="Metallic", spec="Specular IOR Level", coat="Coat Weight")
        for k, v in kw.items():
            s = self.bsdf.inputs[names.get(k, k)]
            if isinstance(v, (int, float, tuple)):
                s.default_value = v
            else:
                self.link(v, s)


MATS = {}


def wood(name, light, dark, axis="Z", rings=6.0, hue_jit=0.0, rough=0.78, dirt=0.35, knots=True):
    """Worn wood: soft long streaks along `axis` (object space, noise stretched along the grain), a fine grain on top,
    a few darker blotches, darker toward the ground and in the creases. Low contrast, as Flash's painted wood."""
    key = (name, axis)
    if key in MATS:
        return MATS[key]
    t = NT(f"{name}-{axis}")
    k = rings / 6.0
    sc = {"X": (0.5 * k, 9 * k, 9 * k), "Y": (9 * k, 0.5 * k, 9 * k), "Z": (9 * k, 9 * k, 0.5 * k)}[axis]
    v = t.coords(scale=sc, loc=(rng.uniform(3, 9), rng.uniform(3, 9), rng.uniform(3, 9)))
    w = t.n("ShaderNodeTexNoise")
    w.inputs["Scale"].default_value = 1.0
    w.inputs["Detail"].default_value = 6.0
    w.inputs["Roughness"].default_value = 0.62
    w.inputs["Distortion"].default_value = 0.6
    t.link(v, w.inputs["Vector"])
    grain = t.ramp(w.outputs["Fac"], [(0.3, srgb(*dark)), (0.58, srgb(*light)), (0.75, srgb(*[c * 1.05 for c in light]))])
    blot = t.noise(v, 2.2, 3.0, 0.5)
    blot_r = t.ramp(blot, [(0.35, (1, 1, 1, 1)), (0.75, srgb(*[c * 0.62 for c in light]))])
    col = t.mix(grain, blot_r, 0.55 if knots else 0.25, "MULTIPLY")
    col = t.grime(col, GROUND, 2.6, dirt)
    t.set(**{"Base Color": col, "rough": rough, "spec": 0.25})
    t.bump(w.outputs["Fac"], 0.08, 0.01)
    MATS[key] = t.m
    return t.m


def painted(name, col, rough=0.6, metal=0.0, wear=None, rust=None, scale=6.0, dirt=0.3, spec=0.4, soot=0.0, top=None,
            ao_min=0.55, rust_at=0.6):
    """Paint or metal with worn patches (`wear` colour shows through), rust blotches and soot (dark, dull smudges that
    run down the part, as Flash's dirty metals)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    c = srgb(*col)
    out = c
    if wear:
        n1 = t.noise(v, scale * 0.45, 3.0, 0.5, 0.2)
        mask = t.ramp(n1, [(0.45, (0, 0, 0, 1)), (0.75, (0.6, 0.6, 0.6, 1))])
        out = t.mix(c, srgb(*wear), mask)
    if rust:
        n2 = t.noise(v, scale * 0.7, 5.0, 0.65, 1.0)
        mask = t.ramp(n2, [(rust_at, (0, 0, 0, 1)), (rust_at + 0.15, (0.7, 0.7, 0.7, 1))])
        out = t.mix(out, srgb(*rust), mask)
    rough_in = rough
    if soot:
        v2 = t.coords(scale=(1.0, 1.0, 0.25))                  # stretched upright: streaks run down
        n3 = t.noise(v2, scale * 0.5, 6.0, 0.7, 0.4)
        sm = t.ramp(n3, [(0.38, (0, 0, 0, 1)), (0.62, (soot, soot, soot, 1))])
        out = t.mix(out, srgb(30, 25, 22), sm)
        rr = t.ramp(n3, [(0.38, (rough,) * 3 + (1,)), (0.62, (min(1.0, rough + 0.4),) * 3 + (1,))])
        rough_in = rr
    if top:                                     # faces turned up are paler (Flash's near-white block tops)
        geo = t.n("ShaderNodeNewGeometry")
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sep.inputs[0])
        up = t.n("ShaderNodeMath", operation="ABSOLUTE")         # a box's faces may wind either way
        t.link(sep.outputs["Z"], up.inputs[0])
        out = t.mix(out, srgb(*top), t.ramp(up.outputs[0], [(0.3, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))]))
    out = t.grime(out, GROUND, 2.6, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rough_in, "metal": metal, "spec": spec})
    t.bump(t.noise(v, scale * 3, 4.0, 0.6), 0.06, 0.01)
    MATS[name] = t.m
    return t.m


def slate_cap(name, col, wear, shine=(214, 222, 232)):
    """The horn cap's matte dark slate (stone or worn metal, no mirror shine), with Flash's soft white highlights
    scattered over the right of its top and the right of its rim. Placed in the cap's own box (Generated 0..1), so the
    smaller level 1 cap gets them in the same places."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])
    u = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")         # (X + Y) / 2: 0.5 the middle, 0.85 the screen-right rim
    t.link(sep.outputs["X"], u.inputs[0])
    u.inputs[1].default_value = 0.5
    half_y = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(sep.outputs["Y"], half_y.inputs[0])
    half_y.inputs[1].default_value = 0.5
    t.link(half_y.outputs[0], u.inputs[2])
    k0, k1 = (0, 0, 0, 1), (1, 1, 1, 1)
    top = t.mix(t.ramp(u.outputs[0], [(0.46, k0), (0.58, k1), (0.64, k1), (0.76, k0)]), t.ramp(sep.outputs["Z"], [(0.5, k0), (0.78, k1)]),
                1.0, "MULTIPLY")
    rim = t.mix(t.ramp(u.outputs[0], [(0.62, k0), (0.82, k1)]),
                t.ramp(sep.outputs["Z"], [(0.36, k0), (0.48, k1), (0.6, k1), (0.72, k0)]), 1.0, "MULTIPLY")
    specks = t.ramp(t.noise(v, 3.2, 2.0, 0.45), [(0.45, k0), (0.68, (0.8, 0.8, 0.8, 1))])   # broken into soft patches
    hi = t.mix(t.mix(top, rim, 1.0, "LIGHTEN"), specks, 1.0, "MULTIPLY")
    n1 = t.noise(v, 2.7, 3.0, 0.5, 0.2)
    out = t.mix(srgb(*col), srgb(*wear), t.ramp(n1, [(0.45, k0), (0.75, (0.6, 0.6, 0.6, 1))]))
    out = t.mix(out, srgb(*shine), hi)
    t.set(**{"Base Color": out, "rough": 0.65, "metal": 0.05, "spec": 0.3})
    t.bump(t.noise(v, 18, 4.0, 0.6), 0.05, 0.01)
    MATS[name] = t.m
    return t.m


def flat(name, col, rough=0.5, metal=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    t = NT(name)
    t.set(**{"Base Color": srgb(*col), "rough": rough, "metal": metal})
    if emit:
        t.bsdf.inputs["Emission Color"].default_value = srgb(*col)
        t.bsdf.inputs["Emission Strength"].default_value = emit
    MATS[name] = t.m
    return t.m



def link(ob, parent=None):
    COLL.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def mesh_ob(name, bm, mats, smooth=True, bevel=0.0, segs=3, parent=None, subsurf=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    link(ob, parent)
    if bevel:
        mo = ob.modifiers.new("bevel", "BEVEL")
        mo.width = bevel
        mo.segments = segs
        mo.limit_method = "ANGLE"
        mo.harden_normals = smooth
    if subsurf:
        mo = ob.modifiers.new("sub", "SUBSURF")
        mo.levels = mo.render_levels = subsurf
    return ob


def box(name, size, at, mat, rot=(0, 0, 0), bevel=0.05, parent=None, jitter=0.0, taper=1.0, origin="bottom", bow=0.0,
        segs=3):
    """A box `size` (x, y, z) standing on `at` (origin="bottom") or centred on it, turned by rot (degrees, XYZ).
    bow: the middle of its height pushed toward local -Y by that much (a plank that bulges out of a wall)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if bow:
        bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6],
                                  cuts=8)
    for v in bm.verts:
        if bow:
            v.co.y -= bow / size[1] * math.sin(math.pi * (v.co.z + 0.5))
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        if origin == "bottom":
            v.co.z += size[2] / 2
        if taper != 1.0 and v.co.z > (size[2] / 2 if origin == "bottom" else 0):
            v.co.x *= taper
            v.co.y *= taper
        if jitter:
            v.co += Vector((rng.uniform(-jitter, jitter) for _ in range(3)))
    ob = mesh_ob(name, bm, [mat], bevel=bevel, segs=segs, parent=parent)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def cyl(name, r, depth, at, mat, rot=(0, 0, 0), verts=24, bevel=0.03, parent=None, r2=None, mats=None, caps=True):
    """A cylinder along its local Z, from at (base) up `depth`; r2 = top radius (a cone)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    for v in bm.verts:
        v.co.z += depth / 2
    ob = mesh_ob(name, bm, mats or [mat], bevel=bevel, parent=parent)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def lathe(name, prof, at, mat, rot=(0, 0, 0), verts=32, parent=None, bevel=0.0):
    """Spin a (r, z) profile round local Z."""
    bm = bmesh.new()
    rows = []
    for r, z in prof:
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * i / verts), r * math.sin(2 * math.pi * i / verts), z))
                     for i in range(verts)])
    for a, b in zip(rows, rows[1:]):
        for i in range(verts):
            j = (i + 1) % verts
            bm.faces.new((a[i], a[j], b[j], b[i]))
    ob = mesh_ob(name, bm, [mat], bevel=bevel, parent=parent)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def tube(name, pts, r, mat, parent=None, verts=12, r_end=None, cyclic=False, smooth=False):
    """A round stick through world points pts (a curve with a round bevel); cyclic closes it into a seamless loop,
    smooth bends it softly through the points (a Bezier curve) instead of at sharp corners."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    if smooth:
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        cps = sp.bezier_points
        for p, q in zip(cps, pts):
            p.co = q
            p.handle_left_type = p.handle_right_type = "AUTO"
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        cps = sp.points
        for p, q in zip(cps, pts):
            p.co = (q[0], q[1], q[2], 1)
    sp.use_cyclic_u = cyclic
    if r_end is not None:
        for i, p in enumerate(cps):
            p.radius = 1 + (r_end / r - 1) * i / max(1, len(pts) - 1)
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(mat)
    link(ob, parent)
    return ob


def plank_wall(name, p0, p1, z0, z1, mat_fn, n, thick=0.12, gap=0.025, out=None, jit=0.02, bulge=0.0):
    """A wall of n upright planks from ground point p0 to p1 (world XY), heights z0..z1, facing `out` (a unit XY).
    bulge: the wall bellies out by that much in the middle, across and up (the planks run counter-clockwise seen from
    above, so local -Y is outward)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    ang = math.degrees(math.atan2(d.y, d.x))
    w = length / n
    obs = []
    for i in range(n):
        c = p0 + d * ((i + 0.5) / n)
        f = (i + 0.5) / n
        turn = 0.0
        if out is not None:
            c += Vector(out) * (-thick / 2 + rng.uniform(-jit, jit) + 0.5 * bulge * math.sin(math.pi * f))
            turn = -math.degrees(math.atan(0.5 * bulge * math.pi * math.cos(math.pi * f) / length))
        top = z1 + rng.uniform(-0.04, 0.04)
        obs.append(box(f"{name}{i}", (w - gap, thick, top - z0), (c.x, c.y, z0), mat_fn("Z"),
                       rot=(rng.uniform(-1.2, 1.2), rng.uniform(-1.5, 1.5), ang + turn), bevel=0.03,
                       bow=0.5 * bulge))
    return obs


def gear(name, r, teeth, depth, at, mat, rot, tooth=0.18, parent=None, hole=0.0):
    """A flat toothed wheel in its local XY (axis local Z), centred on at."""
    bm = bmesh.new()
    pts = []
    for i in range(teeth * 4):
        a = 2 * math.pi * i / (teeth * 4)
        rr = r if (i % 4) in (0, 1) else r * (1 - tooth)
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [mat], smooth=False, bevel=min(0.02, depth / 4), segs=2, parent=parent)
    ob.location = at
    ob.rotation_euler = rot
    return ob




def spinner(name, center, normal_bearing, tilt, parts):
    """An empty at center whose local Z is the axle: normal_bearing (deg, ground bearing from +X toward +Y) and tilted up
    by `tilt`. parts(parent) builds the wheel in local coords (XY = the disc's plane)."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = center
    a = math.radians(normal_bearing)
    n = Vector((math.cos(a), math.sin(a), 0))
    n = (n * math.cos(math.radians(tilt)) + Vector((0, 0, math.sin(math.radians(tilt))))).normalized()
    e.rotation_euler = n.to_track_quat("Z", "Y").to_euler()
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    parts(hub)
    return e, hub



# ------------------------------------------------------------------------------------------------------------ the model
def shiny(name, col, rough=0.3, metal=0.85, wear=None, scale=5.0, dirt=0.25, spec=0.5, coat=0.0, ao_min=0.5,
          streak=0.0, side=0.0, glow=()):
    """Flash's Hatchery is a glossy render: polished gold, chrome, red enamel. Soft, broad reflections, a faint
    mottle (`wear` colour in soft patches), darker in the creases and low down, and faint vertical polish streaks."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    out = srgb(*col)
    if wear:
        n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.2)
        out = t.mix(out, srgb(*wear), t.ramp(n1, [(0.42, (0, 0, 0, 1)), (0.78, (0.55, 0.55, 0.55, 1))]))
    rr = rough
    if streak:
        v2 = t.coords(scale=(6.0, 6.0, 0.4))
        n2 = t.noise(v2, 3.0, 4.0, 0.6)
        rr = t.ramp(n2, [(0.3, (rough * (1 - streak),) * 3 + (1,)), (0.7, (min(1.0, rough * (1 + streak)),) * 3 + (1,))])
    if side:                       # painted soft shading: lighter on the left (toward the light), darker on the right
        geo = t.n("ShaderNodeNewGeometry")
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dp.inputs[0])
        dp.inputs[1].default_value = (-0.707, -0.707, 0.0)
        mr = t.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = -3.4, 3.4
        mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0 - side, 1.0 + side * 0.25
        t.link(dp.outputs["Value"], mr.inputs[0])
        grey = t.n("ShaderNodeCombineColor")
        for i in range(3):
            t.link(mr.outputs[0], grey.inputs[i])
        out = t.mix(out, grey.outputs[0], 1.0, "MULTIPLY")
    for k, g in enumerate(glow):
        fac = screen_spot(t, *g[:5])
        out = t.mix(out, srgb(*g[5]), fac)
        if k == 0:                 # the main sheen also glows a little, so the metal can't swallow it
            t.set(**{"Emission Color": srgb(*g[5]), "Emission Strength": fac})
    out = t.grime(out, GROUND, 4.0, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rr, "metal": metal, "spec": spec})
    if coat:
        t.set(coat=coat)
        t.bsdf.inputs["Coat Roughness"].default_value = 0.12
    t.bump(t.noise(v, scale * 4, 4.0, 0.6), 0.03, 0.01)
    MATS[name] = t.m
    return t.m



def screen_spot(t, cx, cy, ax, ay, amount):
    """A soft oval at Flash pixel (cx, cy) with half-axes (ax, ay) px, as seen through the camera (which covers FRAME):
    for a painted highlight that must sit where Flash draws it, e.g. the white sheen across the dish."""
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Window"], sep.inputs[0])
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    comb = t.n("ShaderNodeCombineXYZ")
    for i, (scale, off) in enumerate(((w / ax, (FRAME[0] - cx) / ax), (-h / ay, (FRAME[3] - cy) / ay))):
        m = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")
        t.link(sep.outputs[i], m.inputs[0])
        m.inputs[1].default_value, m.inputs[2].default_value = scale, off
        t.link(m.outputs[0], comb.inputs[i])
    ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
    t.link(comb.outputs[0], ln.inputs[0])
    mr = t.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    mr.inputs[1].default_value, mr.inputs[2].default_value = 1.0, 0.0
    mr.inputs[3].default_value, mr.inputs[4].default_value = 0.0, amount
    t.link(ln.outputs["Value"], mr.inputs[0])
    return mr.outputs[0]



def vspin(name, center, parts):
    """A part turning about the vertical through center; local X = world X (bearing 0) before it turns."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = center
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    parts(hub)
def P(th, r, z):
    a = math.radians(th)
    return Vector((r * math.cos(a), r * math.sin(a), z))


def track(ob, direction, up="Y"):
    ob.rotation_euler = Vector(direction).normalized().to_track_quat("Z", up).to_euler()
    return ob


def ring(name, r, wire, mat, parent=None, z=0.0, n=64):
    return tube(name, [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)],
                wire, mat, parent=parent, verts=12, cyclic=True)


def sweep(name, pts, side, w, h, mat, parent=None, bevel=0.06, closed=False):
    """A bar of w (along `side`) x h cross-section along points pts (local to parent)."""
    bm = bmesh.new()
    side = Vector(side).normalized()
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        if closed:
            t = (Vector(pts[(i + 1) % n]) - Vector(pts[i - 1])).normalized()
        else:
            t = (Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        nrm = t.cross(side).normalized()
        sd = nrm.cross(t).normalized()
        a, b = sd * (w / 2), nrm * (h / 2)
        rows.append([bm.verts.new(p + a + b), bm.verts.new(p - a + b), bm.verts.new(p - a - b), bm.verts.new(p + a - b)])
    pairs = list(zip(rows, rows[1:])) + ([(rows[-1], rows[0])] if closed else [])
    for r0, r1 in pairs:
        for j in range(4):
            bm.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
    if not closed:
        bm.faces.new(rows[0][::-1])
        bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], bevel=bevel, segs=3, parent=parent)


def rounded_poly(corners, rad, n=8):
    """A closed path round the polygon `corners` (2D), each corner rounded with radius rad."""
    out = []
    k = len(corners)
    for i in range(k):
        a, b, c = Vector(corners[i - 1]), Vector(corners[i]), Vector(corners[(i + 1) % k])
        d1, d2 = (a - b).normalized(), (c - b).normalized()
        half = d1.angle(d2) / 2
        dist = rad / math.tan(half)
        p1, p2 = b + d1 * dist, b + d2 * dist
        bis = (d1 + d2).normalized()
        cen = b + bis * (rad / math.sin(half))
        a1 = math.atan2(*(p1 - cen).yx)
        a2 = math.atan2(*(p2 - cen).yx)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for j in range(n + 1):
            ang = a1 + da * j / n
            out.append((cen.x + rad * math.cos(ang), cen.y + rad * math.sin(ang)))
    return out



# ------------------------------------------------------------------------------------------------------------ the plan
# Flash draws the Lab as two stacked tiers, each a wide pentagon seen corner-on: a left and a right corner, a long flat
# front edge facing the viewer, a back corner. The outlines are given in screen-plan coordinates (u, v): u = X + Y runs
# across the screen (7.07 px a unit, + right), v = X - Y toward the viewer (3.54 px a unit, + down the screen). The
# building is mirror-symmetric on screen: (u, v) -> (-u, v), i.e. (X, Y) -> (-Y, -X).
LW_Z = 4.6                                  # the lower walls' height (the lower deck's underside)
LD_Z0, LD_Z1 = 4.6, 5.27                    # the lower deck
UD_Z0, UD_Z1 = 9.0, 9.6                     # the upper deck
LW = [(-8.9, 0.0), (-3.6, 2.8), (-3.0, 2.8), (-3.0, 1.2), (3.0, 1.2), (3.0, 2.8), (3.6, 2.8), (8.9, 0.0), (0.0, -7.0)]
LD = [(-9.35, 0.0), (-5.2, 3.75), (5.2, 3.75), (9.35, 0.0), (0.0, -7.6)]
UW = [(-5.35, 0.0), (-4.75, 1.9), (-3.5, 1.9), (-3.5, -3.3), (3.5, -3.3), (3.5, 1.9), (4.75, 1.9), (5.35, 0.0),
      (0.0, -5.2)]
UD = [(-7.5, 0.0), (-6.6, 2.3), (6.6, 2.3), (7.5, 0.0), (0.0, -5.8)]
COIL_UV = (-3.6, 3.0)                       # the left gold column (the right one mirrored)
DOOR_F, DOOR_W = 0.36, 1.5                  # the left side door: how far along the left face (from the corner), width
PL_C, PL_H, PL_Z = (-0.7, 0.7), 1.6, 9.84   # the plinth board under the big bell: middle, half side, top
DOME_UV, DOME_R = (0.3, 0.25), 2.08         # the glass dome on the lower deck, in the upper recess
PIPE_F, PIPE_Z, PIPE_OUT = 0.5, 7.7, 1.25    # the glass pipe: how far along the upper left face, height, reach
BELL_S = (-3.82, 0.6)                       # the left small bell on the upper deck (the right one mirrored)


def uv(u, v):
    return ((u + v) / 2, (u - v) / 2)


def mir(p):
    """The mirror image across the building's screen axis."""
    return (-p[1], -p[0]) + tuple(p[2:])


def xy(poly):
    return [uv(u, v) for u, v in poly]


def prism(name, pts, z0, z1, mat, bevel=0.04, parent=None, mats=None, side_mat=None):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    if f.normal.z > 0:
        f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if side_mat:                                    # the upright faces get the second material
        for fc in bm.faces:
            fc.material_index = 1 if abs(fc.normal.z) < 0.5 else 0
        mats = [mat, side_mat]
    return mesh_ob(name, bm, mats or [mat], smooth=False, bevel=bevel, segs=2, parent=parent)


def studs(name, pts, r, mat, squash=0.6):
    """Many rivet heads in one mesh: flattened half balls at pts, each facing its normal (pt = (pos, normal))."""
    bm = bmesh.new()
    for p, n in pts:
        m = Matrix.Translation(Vector(p)) @ Vector(n).to_track_quat("Z", "Y").to_matrix().to_4x4() @ \
            Matrix.Diagonal((r, r, r * squash, 1))
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0, matrix=m)
    return mesh_ob(name, bm, [mat], smooth=True)


def face(a, b):
    """A wall face from XY point a to b (counter-clockwise outline): its tangent, outward normal and turn (degrees,
    for a box whose local X runs along the face and local -Y points out)."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    n = Vector((t.y, -t.x))
    return a, b, t, n, math.degrees(math.atan2(t.y, t.x))


def edge_pts(a, b, n, z, out, inset=0.18):
    """n points along the wall from a to b at height z, pushed out by `out` along the face normal."""
    a, b, t, nrm, _ = face(a, b)
    pts = []
    for i in range(n):
        f = inset + (1 - 2 * inset) * (i + 0.5) / n if n > 1 else 0.5
        p = a.lerp(b, f)
        pts.append(((p.x + nrm.x * out, p.y + nrm.y * out, z), (nrm.x, nrm.y, 0)))
    return pts


def faces_of(pts):
    return list(zip(pts, pts[1:] + pts[:1]))


def grow(poly, d):
    """The outline pushed out by d (each edge moved along its normal; corners where the moved edges meet)."""
    k = len(poly)
    lines = []
    for a, b in faces_of(poly):
        a, b, t, n, _ = face(a, b)
        lines.append((a + n * d, t))
    out = []
    for i in range(k):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        if abs(den) < 1e-6:
            out.append(tuple(p2))
            continue
        s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        out.append(tuple(p1 + t1 * s))
    return out


# ------------------------------------------------------------------------------------------------------------ materials
def materials():
    M = {}
    # dark navy enamel panels, worn bluer at the edges, a little rust and soot (Flash ~22,28,52 with blue lights)
    M["navy"] = painted("navy", (26, 34, 62), rough=0.45, metal=0.25, wear=(50, 66, 104), rust=(66, 48, 40), scale=3.0,
                        dirt=0.35, spec=0.5, soot=0.3, rust_at=0.66)
    M["navydark"] = painted("navydark", (14, 18, 34), rough=0.6, metal=0.1, wear=(30, 38, 62), scale=3.0, dirt=0.4)
    # the decks: brown riveted metal plate with soft glossy streaks (Flash ~93,67,56 with pale 164,125,71 glints)
    M["deck"] = shiny("deck", (118, 68, 44), rough=0.28, metal=0.3, wear=(190, 136, 78), scale=1.5, dirt=0.2,
                      streak=0.6, side=0.3, spec=0.6, coat=0.5,
                      glow=((-34, 8, 16, 4, 0.55, (196, 150, 92)), (34, 7, 14, 4, 0.35, (186, 140, 86)),
                            (-28, -40, 16, 4, 0.4, (196, 150, 96))))
    # the decks' edge band: the same plate a shade darker, so the lit top reads as a broad separate face (Flash)
    M["deckside"] = shiny("deckside", (94, 58, 40), rough=0.5, metal=0.25, wear=(116, 80, 54), scale=1.5, dirt=0.25,
                          streak=0.15, side=0.2, spec=0.35)
    M["deckedge"] = painted("deckedge", (82, 58, 44), rough=0.55, metal=0.25, wear=(114, 84, 60), scale=3.0, dirt=0.3)
    M["frame"] = painted("frame", (98, 66, 46), rough=0.5, metal=0.35, wear=(136, 96, 62), rust=(70, 44, 30),
                         scale=4.0, dirt=0.3)
    M["plinth"] = wood("plinth", (130, 86, 50), (106, 70, 40), rings=3.0, dirt=0.3, knots=False)
    M["gold"] = shiny("gold", (232, 162, 46), rough=0.3, metal=0.75, side=0.45, wear=(240, 186, 80), scale=1.5,
                      dirt=0.45, streak=0.3)
    M["brass"] = shiny("brass", (150, 104, 46), rough=0.35, metal=0.7, wear=(190, 140, 66), scale=2.0, dirt=0.3)
    M["pilaster"] = shiny("pilaster", (196, 204, 150), rough=0.4, metal=0.3, wear=(166, 172, 120), scale=2.0, dirt=0.2)
    # Flash's chrome is mottled: blue-grey with darker patches and white glints, not a clean mirror
    M["chrome"] = shiny("chrome", (176, 190, 196), rough=0.26, metal=0.85, wear=(104, 118, 132), scale=7, dirt=0.2,
                        side=0.5, streak=0.4)
    M["steel"] = shiny("steel", (120, 128, 132), rough=0.3, metal=0.8, wear=(150, 156, 160), scale=6, dirt=0.1)
    M["rivet"] = shiny("rivet", (170, 172, 170), rough=0.3, metal=0.8, wear=(120, 124, 128), scale=6, dirt=0.05)
    M["copper"] = shiny("copper", (178, 92, 40), rough=0.4, metal=0.6, wear=(120, 62, 30), scale=14, dirt=0.0)
    M["glass"] = glass_mat()
    M["flange"] = shiny("flange", (44, 110, 180), rough=0.3, metal=0.4, wear=(80, 150, 210), scale=3, dirt=0.1)
    M["grate"] = painted("grate", (100, 98, 94), rough=0.6, metal=0.4, wear=(136, 134, 128), scale=4.0, dirt=0.2)
    M["hole"] = flat("hole", (12, 12, 18), rough=1.0)
    M["groove"] = flat("groove", (20, 20, 24), rough=0.85)
    M["doorplate"] = painted("doorplate", (98, 95, 90), rough=0.55, metal=0.3, wear=(146, 142, 136), scale=4.0,
                             dirt=0.3)
    M["dome"] = dome_mat()
    # the side cogs: the left one in the sun, grey with its teeth white where they face the light; the right one in
    # the building's shade, darker, its teeth only a lighter grey (as Flash draws them)
    M["cogsteel"] = matte_grey("cogsteel", (72, 74, 78), (240, 242, 244), lit=(-0.85, -0.62, 1.55),
                               band=(_envf("SCOG_B0", 0.75), _envf("SCOG_B1", 0.9)))
    M["cogshade"] = matte_grey("cogshade", (72, 74, 78), (100, 102, 106), lit=(0.62, 0.85, 1.55),
                               band=(_envf("SCOG_B0", 0.75), _envf("SCOG_B1", 0.9)))
    return M


def glass_mat():
    """The pipes' clear cyan glass: the wall shows dark through the middle, the edges glow bright cyan (Flash)."""
    t = NT("glass")
    rim = t.n("ShaderNodeLayerWeight")
    rim.inputs["Blend"].default_value = 0.4
    edge = t.ramp(rim.outputs["Facing"], [(0.25, (0, 0, 0, 1)), (0.85, (1, 1, 1, 1))])
    col = t.mix(srgb(70, 190, 186), srgb(150, 250, 240), edge)
    t.set(**{"Base Color": col, "rough": 0.12, "metal": 0.0, "spec": 0.6, "Transmission Weight": 0.65, "IOR": 1.15})
    t.set(**{"Emission Color": srgb(110, 236, 226)})
    em = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(edge, em.inputs[0])
    em.inputs[1].default_value = 0.6
    t.set(**{"Emission Strength": em.outputs[0]})
    return t.m


DOME_MAP = []          # the dome brew's mapping node: its location turns round a circle over one loop


def dome_mat():
    """Flash's dome is glowing glass: bright saturated cyan, brightest round the rim, with darker green-teal swirls of
    the brew seen inside it and white glints at the top left. The swirls are two noise layers looked up behind the
    surface (along the view ray), so they read as inside the glass; they drift round in a loop."""
    t = NT("dome")
    tc = t.n("ShaderNodeTexCoord")
    geo = t.n("ShaderNodeNewGeometry")
    lay = []
    for depth, scale in ((0.45, 1.7), (1.3, 1.2)):
        back = t.n("ShaderNodeVectorMath", operation="MULTIPLY_ADD")      # the point `depth` behind the surface
        t.link(geo.outputs["Incoming"], back.inputs[0])
        back.inputs[1].default_value = (-depth,) * 3
        t.link(tc.outputs["Object"], back.inputs[2])
        mp = t.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale,) * 3
        t.link(back.outputs[0], mp.inputs["Vector"])
        DOME_MAP.append(mp)
        lay.append(t.noise(mp.outputs[0], 0.9, 1.5, 0.5, 2.0))
    # the deep brew: dark green-teal clouds in bright cyan
    col = t.ramp(lay[1], [(0.36, srgb(34, 100, 80)), (0.47, srgb(80, 172, 152)), (0.58, srgb(140, 236, 222)),
                          (0.7, srgb(186, 252, 242))])
    # the near swirls: darker teal streaks curling over it
    band = t.ramp(lay[0], [(0.36, (0, 0, 0, 1)), (0.47, (0.6, 0.6, 0.6, 1)), (0.52, (0.6, 0.6, 0.6, 1)),
                           (0.63, (0, 0, 0, 1))])
    col = t.mix(col, srgb(36, 104, 84), band)
    # the glass glows brightest round its rim (Flash's bright cyan edge)
    rim = t.n("ShaderNodeLayerWeight")
    rim.inputs["Blend"].default_value = 0.3
    col = t.mix(col, srgb(150, 255, 250), t.ramp(rim.outputs["Facing"], [(0.35, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))]))
    hi = screen_spot(t, -9.0, -8.0, 10.0, 4.5, 0.95)
    col = t.mix(col, srgb(240, 255, 255), hi)
    glint = screen_spot(t, -15.0, -2.0, 2.0, 4.0, 0.7)               # a small glint low on the left
    col = t.mix(col, srgb(220, 255, 255), glint)
    t.set(**{"Base Color": col, "rough": 0.08, "metal": 0.0, "spec": 0.7, "coat": 1.0})
    t.bsdf.inputs["Coat Roughness"].default_value = 0.05
    t.set(**{"Emission Color": col, "Emission Strength": 0.6})
    return t.m


def matte_grey(name, side, top, lit=(0.0, 0.0, 1.0), band=(0.62, 0.9)):
    """Flash's side cogs: matte grey, lit evenly (a little glow keeps the shadowed faces grey, not rock), the faces
    turned toward `lit` near white (`top`; band: from where to where along that), so each tooth lights up as it turns
    past the light."""
    t = NT(name)
    v = t.coords()
    n = t.noise(v, 2.4, 2.0, 0.5)
    col = t.ramp(n, [(0.36, srgb(*(int(c * 0.86) for c in side))), (0.64, srgb(*side))])
    geo = t.n("ShaderNodeNewGeometry")
    dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(geo.outputs["Normal"], dp.inputs[0])
    dp.inputs[1].default_value = Vector(lit).normalized()
    col = t.mix(col, srgb(*top), t.ramp(dp.outputs["Value"], [(band[0], (0, 0, 0, 1)), (band[1], (1, 1, 1, 1))]))
    t.set(**{"Base Color": col, "rough": 1.0, "spec": 0.0})
    t.set(**{"Emission Color": col, "Emission Strength": 0.12})
    return t.m


M = materials()


def set_phase(dome_t=None, cog_t=None):
    """The moving parts at a moment of their loops (0..1): the brew's swirl and the side doors' cogs."""
    if dome_t is not None:
        a = 2 * math.pi * dome_t
        for mp in DOME_MAP:
            mp.inputs["Location"].default_value = (0.55 * math.cos(a), 0.55 * math.sin(a), 0.3 * math.sin(a))
    if cog_t is not None:
        for side, puffs in SIDECOGS.items():
            for ob, path in puffs:
                p, sc, rot = path(cog_t)
                ob.location = p
                ob.scale = sc
                ob.rotation_euler = rot


# ------------------------------------------------------------------------------------------------------------ the body
def posts(name, poly, z0, z1, skip=(), w=0.32):
    for i, p in enumerate(poly):
        if i in skip:
            continue
        box(f"{name}{i}", (w, w, z1 - z0), (p[0], p[1], z0), M["frame"], rot=(0, 0, 45), bevel=0.04)


def lower():
    out = xy(LW)
    prism("lwall", out, 0.0, LW_Z, M["navy"], bevel=0.05)
    posts("lpost", out, 0.0, LW_Z, skip=(2, 3, 4, 5))
    sk = grow(out, 0.08)
    prism("lskirt", sk, 0.0, 0.3, M["frame"], bevel=0.03)
    prism("lband", sk, LW_Z - 0.3, LW_Z, M["brass"], bevel=0.03)
    pts = []
    for a, b in faces_of(out):
        n = max(1, int((Vector(b) - Vector(a)).length / 0.75))
        pts += edge_pts(a, b, n, LW_Z - 0.15, 0.1, inset=0.06)
        pts += edge_pts(a, b, n, 0.15, 0.1, inset=0.06)
    studs("lrivet", pts, 0.07, M["rivet"])
    # round bolts on the side panels, left of and above the door
    a, b = out[0], out[1]
    bolts = [_on(a, b, f, z, 0.03) for f, z in ((0.08, 2.9), (0.62, 3.3), (0.62, 1.9), (0.86, 2.5), (0.86, 1.1))]
    bolts += [(mir(p), mir(n)) for p, n in bolts]
    studs("lbolt", bolts, 0.19, M["steel"], squash=0.45)
    # the gold ribbed columns at the front corners
    for k, (u, v) in enumerate((COIL_UV, (-COIL_UV[0], COIL_UV[1]))):
        x, y = uv(u, v)
        prof = [(0.0, 0.0), (0.42, 0.0), (0.42, 0.12)]
        for j in range(7):                          # Flash's columns: a stack of sharp double cones up to the beam
            z0 = 0.14 + j * 0.58
            prof += [(0.24, z0), (0.58, z0 + 0.28), (0.6, z0 + 0.29), (0.58, z0 + 0.3), (0.24, z0 + 0.58)]
        prof += [(0.42, LW_Z), (0.0, LW_Z)]
        lathe(f"coil{k}", prof, (x, y, 0.0), M["gold"], verts=28)
    # a gold beam under the deck's front edge from column to column
    ca, cb = Vector(uv(*COIL_UV)), Vector(uv(-COIL_UV[0], COIL_UV[1]))
    _, _, tb, nb, angb = face(ca, cb)
    p = (ca + cb) / 2
    box("lbeam", ((cb - ca).length, 0.34, 0.42), (p.x, p.y, LW_Z - 0.42), M["gold"], rot=(0, 0, angb), bevel=0.04)
    # the recess between the columns: dark panels, brass strips, the grey door in the middle
    ra, rb = out[3], out[4]                        # its back face, left to right
    _, _, t, n, ang = face(ra, rb)
    mid = (Vector(ra) + Vector(rb)) / 2
    dw, dz, dh = 1.4, 0.5, 2.8                      # the door: width, bottom, height (Flash: 10 x 19 px, sill included)
    box("ldoor", (dw, 0.12, dh), (mid.x + n.x * 0.05, mid.y + n.y * 0.05, dz), M["doorplate"], rot=(0, 0, ang),
        bevel=0.04)
    # Flash's door is engraved with a maze: a groove meandering down it (Flash's door is 10 x 16 px; the path is
    # given in those pixel columns and rows), a dark groove round its edge and a pale sill at the foot
    cw, rh = dw / 10, dh / 16
    maze = [(6, -0.5), (6, 3.5), (3, 3.5), (3, 7), (6, 7), (6, 10.5), (3, 10.5), (3, 14), (6, 14), (6, 15.5)]
    face_n = 0.11                                   # the door's front face, out from its middle

    def dpt(c, r):
        p = mid + t * ((c + 0.5) * cw - dw / 2) + n * face_n
        return p, dz + dh - (r + 0.5) * rh
    for j, (a, b) in enumerate(zip(maze, maze[1:])):
        (pa, za), (pb, zb) = dpt(*a), dpt(*b)
        p = (pa + pb) / 2
        size = ((pa - pb).length + 0.15, 0.05, abs(za - zb) + 0.15)
        box(f"ldoorgroove{j}", size, (p.x, p.y, (za + zb) / 2), M["groove"], rot=(0, 0, ang), bevel=0.01,
            origin="centre")
    ex = dw / 2 - 0.08
    for j, (sx, sz, w, h) in enumerate(((-ex, dz + dh / 2, 0.12, dh - 0.16), (ex, dz + dh / 2, 0.12, dh - 0.16),
                                        (0.0, dz + dh - 0.08, 2 * ex, 0.12))):
        p = mid + t * sx + n * face_n
        box(f"ldoorgroove-e{j}", (w, 0.05, h), (p.x, p.y, sz), M["groove"], rot=(0, 0, ang), bevel=0.01,
            origin="centre")
    p = mid + n * 0.14
    box("ldoorsill", (dw + 0.1, 0.24, 0.22), (p.x, p.y, dz - 0.2), M["rivet"], rot=(0, 0, ang), bevel=0.04)
    for s in (-2.2, -1.4, 1.4, 2.2):
        p = mid + t * s + n * 0.03
        box(f"lstrip{s}", (0.12, 0.06, LW_Z - 0.6), (p.x, p.y, 0.3), M["brass"], rot=(0, 0, ang), bevel=0.02)
    # the side doors with the grey cogs: a brown frame round a dark opening, a brown plate on the ground in front
    for k in (0, 1):
        a, b = (out[0], out[1]) if k == 0 else (out[6], out[7])
        f = DOOR_F if k == 0 else 1 - DOOR_F
        a, b, t, n, ang = face(a, b)
        c = a.lerp(b, f)
        w = DOOR_W
        box(f"sdoorhole{k}", (w, 0.1, 2.7), (c.x + n.x * 0.01, c.y + n.y * 0.01, 0.3), M["hole"], rot=(0, 0, ang),
            bevel=0.0)
        for s in (-1, 1):
            p = c + t * (s * (w / 2 + 0.12)) + n * 0.1
            box(f"sdoorjamb{k}", (0.24, 0.3, 3.15), (p.x, p.y, 0.0), M["frame"], rot=(0, 0, ang))
        p = c + n * 0.1
        box(f"sdoorlintel{k}", (w + 0.5, 0.3, 0.3), (p.x, p.y, 3.0), M["frame"], rot=(0, 0, ang))
        p = c + n * 1.3
        box(f"sdoorplate{k}", (w + 1.2, 2.5, 0.14), (p.x, p.y, 0.0), M["deckedge"], rot=(0, 0, ang), bevel=0.03)
        side_cog(k, c, t, n)


def _on(a, b, f, z, out):
    a, b, t, n, _ = face(a, b)
    p = a.lerp(b, f) + n * out
    return ((p.x, p.y, z), (n.x, n.y, 0.0))


SIDECOGS = {}
# Flash's side doors each hold a grey metal cog wheel standing upright in the doorway, its axle along the wall, its
# lower part hidden by the floor and the plate, turning so its teeth roll up out of the door and over the top (their
# tops catch the light white). Its middle out from the door and up, tip radius, teeth, thickness along the axle, tooth
# depth (a share of the radius).
SCOG_O, SCOG_Z = _envf("SCOG_O", 0.4), _envf("SCOG_Z", 0.6)
SCOG_R, SCOG_N, SCOG_T, SCOG_D = _envf("SCOG_R", 1.8), int(_envf("SCOG_N", 10)), _envf("SCOG_T", 0.9), _envf("SCOG_D", 0.24)


def side_cog(k, c, t, n):
    """The cog in side door k (door middle c on the wall, t along the wall, n out), a hub on each face, and a small
    grey nub at the door's other foot. set_phase turns the wheel one tooth per 5-frame loop, so the loop has no seam
    (the top goes out, away from the door)."""
    corner = -1 if k == 0 else 1                         # toward the face's outer corner, along t
    at = c + n * SCOG_O + t * (corner * 0.08)
    at = Vector((at.x, at.y, SCOG_Z))
    q0 = Vector((t.x, t.y, 0.0)).to_track_quat("Z", "Y")   # local Z the axle (along the wall)
    hd = SCOG_T + 0.14
    mat = M["cogsteel" if k == 0 else "cogshade"]
    hub = cyl(f"scoghub{k}", 0.34 * SCOG_R, hd, at, mat, verts=24, bevel=0.05)
    for v in hub.data.vertices:                          # centred on the axle, not standing on it
        v.co.z -= hd / 2
    obs = [gear(f"scog{k}", SCOG_R, SCOG_N, SCOG_T, at, mat, (0, 0, 0), tooth=SCOG_D), hub]
    cut = box(f"scogcut{k}", (6.0, 6.0, 3.0), (at.x, at.y, 0.14 - 3.0), M["cogsteel"], bevel=0.0)
    cut.hide_render = True                               # what lies under the plate is cut away, whatever the turn
    for o in obs:
        mo = o.modifiers.new("cut", "BOOLEAN")
        mo.operation, mo.object = "DIFFERENCE", cut
    p = c + n * 0.7 + t * (-corner * 0.62)
    box(f"scognub{k}", (0.5, 0.45, 0.42), (p.x, p.y, 0.15), mat, rot=(0, 0, 25), bevel=0.12)
    pitch = 2 * math.pi / SCOG_N
    for o in obs:
        o.rotation_euler = q0.to_euler()
    SIDECOGS[k] = [(o, lambda s: (at, (1.0, 1.0, 1.0), (q0 @ Quaternion((0.0, 0.0, 1.0), pitch * s)).to_euler()))
                   for o in obs]


def lower_deck():
    out = xy(LD)
    prism("ldeck", out, LD_Z0, LD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
    # Flash's deck edges are a plain band; a few big round bolts sit on the top instead
    pts = []
    for u, v in ((-7.3, -0.6), (7.3, -0.6), (-5.6, 3.1), (5.6, 3.1)):
        x, y = uv(u, v)
        pts.append(((x, y, LD_Z1 + 0.01), (0, 0, 1)))
    studs("ldeckrivet", pts, 0.19, M["rivet"], squash=0.5)


def upper():
    out = xy(UW)
    prism("uwall", out, LD_Z1, UD_Z0, M["navy"], bevel=0.05)
    posts("upost", out, LD_Z1, UD_Z0, skip=(2, 3, 4, 5))
    # the pale pilasters at the recess's mouth, dark panels and brass strips inside it
    for k in (2, 5):
        p = out[k]
        box(f"pilaster{k}", (0.34, 0.34, UD_Z0 - LD_Z1), (p[0], p[1], LD_Z1), M["pilaster"], rot=(0, 0, 45),
            bevel=0.04)
    ra, rb = out[3], out[4]
    _, _, t, n, ang = face(ra, rb)
    mid = (Vector(ra) + Vector(rb)) / 2
    for s in (-2.6, -1.3, 0.0, 1.3, 2.6):
        p = mid + t * s + n * 0.03
        box(f"ustrip{s}", (0.1, 0.05, UD_Z0 - LD_Z1 - 0.3), (p.x, p.y, LD_Z1 + 0.15), M["brass"], rot=(0, 0, ang),
            bevel=0.02)
    band = grow(out, 0.06)
    prism("uband", band, UD_Z0 - 0.26, UD_Z0, M["brass"], bevel=0.03)
    pts = []
    for a, b in faces_of(out):
        n_ = max(1, int((Vector(b) - Vector(a)).length / 0.75))
        pts += edge_pts(a, b, n_, UD_Z0 - 0.13, 0.08, inset=0.06)
    studs("urivet", pts, 0.07, M["rivet"])
    a, b = out[0], out[1]
    bolts = [_on(a, b, f, z, 0.03) for f, z in ((0.25, 6.2), (0.18, 8.5), (0.7, 6.2), (0.82, 8.5))]   # clear of the pipe
    a, b = out[1], out[2]
    bolts += [_on(a, b, f, z, 0.03) for f, z in ((0.2, 5.8), (0.2, 8.5), (0.85, 5.8), (0.85, 8.5))]
    bolts += [(mir(p), mir(n)) for p, n in bolts]
    studs("ubolt", bolts, 0.17, M["steel"], squash=0.45)
    # the glass pipes: straight out of the upper side faces, a quarter bend down to a blue flange on the lower deck
    for k, (i, j) in enumerate(((0, 1), (6, 7))):
        a2, b2, t, n, _ = face(out[i], out[j])
        w = a2.lerp(b2, PIPE_F if k == 0 else 1 - PIPE_F)
        a = Vector((w.x, w.y, PIPE_Z))
        n3 = Vector((n.x, n.y, 0.0))
        r = 0.44
        drop = PIPE_Z - LD_Z1
        pts = [a, a + n3 * 0.35, a + n3 * (PIPE_OUT * 0.75) + Vector((0, 0, -0.15)),
               a + n3 * PIPE_OUT + Vector((0, 0, -drop * 0.45)), a + n3 * PIPE_OUT + Vector((0, 0, -drop + 0.12))]
        tube(f"pipe{k}", [tuple(p) for p in pts], r, M["glass"], verts=16, smooth=True)
        c = a + n3 * PIPE_OUT
        cyl(f"pipeflange{k}", 0.7, 0.16, (c.x, c.y, LD_Z1), M["flange"], verts=28)
        ob = cyl(f"pipecollar{k}", 0.5, 0.1, tuple(a + n3 * 0.02), M["flange"], verts=24)
        ob.rotation_euler = n3.to_track_quat("Z", "Y").to_euler()


def upper_deck():
    out = xy(UD)
    prism("udeck", out, UD_Z0, UD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
    pts = []                                        # a plain edge band; a few big round bolts on the top (Flash)
    for u, v in ((-6.5, 0.8), (6.5, 0.8), (-2.4, 1.85), (2.4, 1.85), (-5.0, -1.3), (5.0, -1.3), (-1.8, -3.3),
                 (1.8, -3.3)):
        x, y = uv(u, v)
        pts.append(((x, y, UD_Z1 + 0.01), (0, 0, 1)))
    studs("udeckrivet", pts, 0.19, M["rivet"], squash=0.5)
    cx, cy = PL_C
    sq = [(cx - PL_H, cy - PL_H), (cx + PL_H, cy - PL_H), (cx + PL_H, cy + PL_H), (cx - PL_H, cy + PL_H)]
    prism("plinth", sq, UD_Z1, PL_Z, M["plinth"], bevel=0.05)


def bell(name, at, prof, coil_r, coil_turns, coil_h):
    """A chrome insulator bell (a lathe profile from its base) with a steel coil on top."""
    lathe(name, prof, at, M["chrome"], verts=40)
    top = prof[-1][1]
    n = 30 * coil_turns
    pts = []
    for i in range(int(n) + 1):
        a = 2 * math.pi * coil_turns * i / n
        pts.append((at[0] + coil_r * math.cos(a), at[1] + coil_r * math.sin(a), at[2] + top - 0.05 + coil_h * i / n))
    tube(name + "coil", pts, coil_r * 0.22, M["steel"], verts=8)
    cyl(name + "post", coil_r * 0.45, coil_h + 0.1, (at[0], at[1], at[2] + top - 0.1), M["steel"], verts=12)
    return Vector((at[0], at[1], at[2] + top + coil_h + 0.05))


BIG_BELL = [(0.0, 0.0), (1.25, 0.0), (1.28, 0.14), (1.2, 0.3), (0.98, 0.36), (0.9, 0.42), (0.84, 0.5), (0.82, 2.0),
            (0.87, 2.08), (0.84, 2.18), (0.7, 2.4), (0.5, 2.6), (0.42, 2.75), (0.44, 2.9), (0.0, 2.92)]
SMALL_BELL = [(0.0, 0.0), (1.0, 0.0), (1.04, 0.12), (0.96, 0.26), (0.8, 0.32), (0.78, 0.5), (0.8, 1.25), (0.74, 1.5),
              (0.58, 1.72), (0.36, 1.84), (0.24, 1.9), (0.26, 2.0), (0.0, 2.02)]
BIG_COIL, SMALL_COIL = 1.85, 0.6            # the coils' heights on top of the bells


def top():
    big = bell("bellC", (PL_C[0], PL_C[1], PL_Z), BIG_BELL, 0.42, 4.5, BIG_COIL)
    l_top = bell("bellL", uv(*BELL_S) + (UD_Z1,), SMALL_BELL, 0.24, 2.5, SMALL_COIL)
    r_top = bell("bellR", mir(uv(*BELL_S)) + (UD_Z1,), SMALL_BELL, 0.24, 2.5, SMALL_COIL)
    # the copper wire: from each small bell's top up in an arc into the big coil's top
    for k, p in enumerate((l_top, r_top)):
        q = big + Vector((0, 0, 0.1))
        side = (p - q)
        side.z = 0
        mid = q + side * 0.5 + Vector((0, 0, (p.z - q.z) * 0.5 + 0.3))
        tube(f"wire{k}", [tuple(p), tuple(p + Vector((0, 0, 0.3)) - side * 0.05), tuple(mid),
                          tuple(q + side * 0.12 + Vector((0, 0, 0.35))), tuple(q)], 0.1, M["copper"], verts=8,
             smooth=True)


def dome():
    cx, cy = uv(*DOME_UV)
    z0 = LD_Z1
    lathe("domering", [(0.0, 0.0), (DOME_R + 0.22, 0.0), (DOME_R + 0.26, 0.18), (DOME_R + 0.12, 0.34), (0.0, 0.34)],
          (cx, cy, z0), M["steel"], verts=48)
    prof = [(DOME_R * math.cos(math.radians(a)), 0.85 * DOME_R * math.sin(math.radians(a))) for a in range(0, 91, 6)]
    ob = lathe("dome", prof, (cx, cy, z0 + 0.3), M["dome"], verts=48)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    # orange wires from the ring's sides to small blue clamps on the deck's front corners
    for k, mirrored in enumerate((False, True)):
        f = mir if mirrored else (lambda p: p)
        a = Vector(f(uv(-2.4, 1.6)) + (z0 + 0.2,))
        c = Vector(f(uv(-4.2, 3.4)) + (z0,))
        tube(f"domewire{k}", [tuple(a), tuple((a + c) / 2 + Vector((0, 0, 0.3))), tuple(c + Vector((0, 0, 0.12)))],
             0.07, M["copper"], verts=8, smooth=True)
        cyl(f"domeclamp{k}", 0.24, 0.16, tuple(c), M["flange"], verts=16)


def build():
    lower()
    lower_deck()
    upper()
    upper_deck()
    top()
    dome()
    set_phase(0.0, 0.0)


FAMILY = (("lwall", "lwall"), ("lpost", "lwall"), ("lskirt", "lwall"), ("lband", "lwall"), ("lbeam", "coil"), ("lrivet", "lwall"),
          ("lbolt", "lwall"), ("lstrip", "lwall"), ("ldoor", "ldoor"), ("coil", "coil"), ("sdoor", "sdoor"),
          ("scog", "scog"), ("ldeck", "ldeck"), ("uwall", "uwall"), ("uflank", "uwall"), ("upost", "uwall"),
          ("uband", "uwall"), ("urivet", "uwall"), ("ustrip", "uwall"), ("ubolt", "uwall"), ("pilaster", "pilaster"), ("pipe", "pipe"),
          ("udeck", "udeck"), ("plinth", "plinth"), ("bellC", "bellC"), ("bellL", "bellL"), ("bellR", "bellR"),
          ("wire", "wire"), ("domering", "dome"), ("domewire", "domewire"), ("domeclamp", "domewire"),
          ("dome", "dome"))
MASONRY = ()


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


def setup(sc):
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.sensor_fit = "HORIZONTAL"
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    cam_d.ortho_scale = w / 10.0
    cam = bpy.data.objects.new("cam", cam_d)
    link(cam)
    el, az = math.radians(EL), math.radians(-45)       # the camera sits toward +X -Y
    fwd = -Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    cam.rotation_euler = fwd.to_track_quat("-Z", "Y").to_euler()
    cam.location = -fwd * 40
    sc.camera = cam
    bpy.context.view_layer.update()
    right = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
    up = cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
    cxp, cyp = (FRAME[0] + FRAME[2]) / 2, (FRAME[1] + FRAME[3]) / 2
    # move the camera so the world origin lands on ORIGIN: origin is (ORIGIN - centre) px right/down of the centre
    cam.location += -right * (ORIGIN[0] - cxp) / 10.0 + up * (ORIGIN[1] - cyp) / 10.0
    sc.render.resolution_x = w * K
    sc.render.resolution_y = h * K
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.cycles.seed = 7
    sc.cycles.use_animated_seed = False
    sc.cycles.max_bounces = 6
    sc.cycles.sample_clamp_indirect = 4.0
    # the sun: from the viewer's left and a little behind, high (the Flash ground shadow falls right, a little down)
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 4.8
    sun_d.angle = math.radians(14)
    sun_d.color = (1.0, 0.95, 0.86)
    sun = bpy.data.objects.new("sun", sun_d)
    link(sun)
    to_sun = Vector((-0.85, -0.62, 1.55)).normalized()
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.62, 0.68, 0.78, 1)
    bg.inputs[1].default_value = 0.85
    # the same sky, but darker below the horizon and brighter overhead, so the polished metals have something to
    # reflect (Flash's chrome and gold show a dark band and a bright top); on average about as bright as before
    nt = world.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    rmp = nt.nodes.new("ShaderNodeValToRGB")
    el = rmp.color_ramp.elements
    el[0].position, el[0].color = 0.42, (0.16, 0.15, 0.15, 1)
    el[1].position, el[1].color = 0.9, (0.9, 0.95, 1.05, 1)
    e2 = el.new(0.52)
    e2.color = (0.55, 0.6, 0.68, 1)
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = -1.0, 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs[0])
    nt.links.new(mr.outputs[0], rmp.inputs[0])
    # and brighter on the sun's side, darker away from it (Flash's metals are bright on the left, dark on the right)
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(tc.outputs["Generated"], dot.inputs[0])
    dot.inputs[1].default_value = (-0.81, -0.59, 0.0)
    side = nt.nodes.new("ShaderNodeMapRange")
    side.inputs[1].default_value, side.inputs[2].default_value = -1.0, 1.0
    side.inputs[3].default_value, side.inputs[4].default_value = 0.3, 1.6
    nt.links.new(dot.outputs["Value"], side.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    nt.links.new(rmp.outputs[0], mul.inputs[6])
    nt.links.new(side.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], bg.inputs[0])
    # the ground: a shadow catcher
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, GROUND))
    g = bpy.context.active_object
    g.name = "ground"
    g.is_shadow_catcher = True
    g.visible_glossy = False         # the gold and chrome low down reflect the dark world, not a white floor (Flash's
    g.visible_diffuse = False        # bowl and legs are dark underneath); the ground still catches the shadow
    return cam


def cam_fwd():
    el, az = math.radians(EL), math.radians(-45)
    return -Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def all_static():
    return [o for o in SC.objects if o.type in ("MESH", "CURVE") and not under_moving(o) and o.name != "ground" and not o.hide_render]


def under_moving(o):
    p = o.parent
    while p:
        if p in MOVING:
            return True
        p = p.parent
    return False


def border_of(objs, pad=10):
    """The render region (fractions) round objs' bounding boxes, padded by pad px."""
    xs, ys = [], []
    for o in objs:
        for c in o.bound_box:
            v = o.matrix_world @ Vector(c)
            sx, sy = scr(v)
            xs.append(sx)
            ys.append(sy)
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    x0 = max(0.0, (min(xs) - FRAME[0] - pad / K) / w)
    x1 = min(1.0, (max(xs) - FRAME[0] + pad / K) / w)
    y0 = max(0.0, (max(ys) - FRAME[1] + pad / K) / h)
    y1 = min(1.0, (min(ys) - FRAME[1] - pad / K) / h)
    return x0, x1, 1 - y0, 1 - y1



def trees():
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for o in SC.objects:
        if o.type not in ("MESH", "CURVE") or o.name == "ground" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        if me is None:
            continue
        mw = ev.matrix_world
        vs = [mw @ v.co for v in me.vertices]
        out[o.name] = (o, BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs)
        ev.to_mesh_clear()
    return out


def main():
    build()
    setup(SC)
    out = HERE / ("work" if MODE == "fit" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    if MODE == "check":
        # which parts touch or pass through others (evaluated meshes, BVH overlap)
        tr = trees()
        obs = list(tr.values())
        hits = {}
        for i, (a, ta, _) in enumerate(obs):
            for b, tb, _ in obs[i + 1:]:
                fa, fb = family(a), family(b)
                if fa == fb:
                    continue
                n = len(ta.overlap(tb))
                if n:
                    hits.setdefault(tuple(sorted((fa, fb))), []).append((a.name, b.name, n))
        for key, v in sorted(hits.items()):
            print("CHECK", key, sum(x[2] for x in v), v[:3])
        # parts that touch nothing at all (floating)
        fams = sorted({family(o) for o, _, _ in obs})
        for fm in fams:
            best = (9.0, "", "", "")
            for o, t, vs in obs:
                if family(o) != fm:
                    continue
                for o2, t2, _ in obs:
                    if family(o2) == fm:
                        continue
                    for v in vs[::3]:
                        hit = t2.find_nearest(v, best[0])
                        if hit[0] is not None and hit[3] < best[0]:
                            best = (hit[3], family(o2), o.name, o2.name)
            print("CLEAR %s nearest other part %.3f (%s)" % (fm, best[0], " ".join(best[1:])))
        print("DONE check")
        return
    if MODE == "gap":
        # as the game camera sees it: wherever one part lies in front of another along a camera ray, how far behind
        # the other one is (small = looks as if they touch or pass into each other)
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        fwd = cam_fwd()
        step = 0.25
        pairs = {}
        for ix in range(int(FRAME[0] / step), int(FRAME[2] / step)):
            for iy in range(int(FRAME[1] / step), int(FRAME[3] / step)):
                o = px(ix * step, iy * step, Z=4.0) - fwd * 40
                ok, loc, nrm, idx, ob, mat = SC.ray_cast(dg, o, fwd)
                if not ok:
                    continue
                f1 = family(ob)
                ok2, loc2, _, _, ob2, _ = SC.ray_cast(dg, loc + fwd * 1e-3, fwd)
                while ok2 and family(ob2) == f1:
                    ok2, loc2, _, _, ob2, _ = SC.ray_cast(dg, loc2 + fwd * 1e-3, fwd)
                if not ok2 or ob2.name == "ground":
                    continue
                f2 = family(ob2)
                d = (loc2 - loc).length
                key = (f1, f2)
                cur = pairs.get(key, (9.0, 0, 0, (1e9, 1e9, -1e9, -1e9)))
                bb = cur[3]
                sx, sy = ix * step, iy * step
                pairs[key] = (min(cur[0], d), cur[1] + (d < 0.05), cur[2] + 1,
                              (min(bb[0], sx), min(bb[1], sy), max(bb[2], sx), max(bb[3], sy)))
        for (f1, f2), (d, near, n, bb) in sorted(pairs.items()):
            print("GAP %-8s in front of %-8s: least depth gap %.3f, rays under 0.05: %d of %d (%.1f px2), screen box "
                  "x %.1f..%.1f y %.1f..%.1f" % (f1, f2, d, near, n, near * step * step, *bb[0::2], *bb[1::2]))
        print("DONE gap")
        return
    if MODE == "probe":                      # probe sx sy ...: what the camera sees first through Flash pixels
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        fwd = cam_fwd()
        a = ARGS[2:]
        for sx, sy in zip(a[0::2], a[1::2]):
            p = px(float(sx), float(sy), Z=3.0) - fwd * 30
            hits, o = [], p
            for _ in range(4):
                ok, loc, nrm, idx, ob, mat = SC.ray_cast(dg, o, fwd)
                if not ok:
                    break
                hits.append(ob.name)
                o = loc + fwd * 1e-3
            print("PROBE", sx, sy, hits)
        return
    if MODE == "fit":
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 24))
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        sc.render.filepath = str(out / f"fit-L{L}.png")
        bpy.ops.render.render(write_still=True)
        print("DONE", L, MODE)
        return
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE == "still":
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 384))
        sc.render.filepath = str(out / f"L{L}-base.png")
        bpy.ops.render.render(write_still=True)
        # the building alone (no ground shadow), for the outline check
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 64
        sc.render.filepath = str(out / f"L{L}-alone.png")
        bpy.ops.render.render(write_still=True)
    if MODE == "anim":
        # the moving parts' boxes only (the rest of the canvas stays empty): post.py lays them on the still
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 384))
        sc.render.use_border = True
        sc.render.use_crop_to_border = False
        an = out / "anim"
        an.mkdir(exist_ok=True)

        def border(objs):
            x0, x1, y0, y1 = border_of(objs, pad=24)
            sc.render.border_min_x, sc.render.border_max_x = x0, x1
            sc.render.border_min_y, sc.render.border_max_y = min(y0, y1), max(y0, y1)
        which = ARGS[2] if len(ARGS) > 2 else "all"
        if which in ("all", "dome"):
            border([bpy.data.objects["dome"]])
            for k in range(32):
                set_phase(dome_t=k / 32, cog_t=0.0)
                sc.render.filepath = str(an / f"dome-{k:02d}.png")
                bpy.ops.render.render(write_still=True)
        set_phase(0.0, 0.0)
        for side in (0, 1):
            if which not in ("all", "door"):
                break
            boxes = []
            for k in range(5):
                set_phase(cog_t=k / 5)
                bpy.context.view_layer.update()
                boxes.append(border_of([o for o, _ in SIDECOGS[side]], pad=24))
            border_of_all = (min(b[0] for b in boxes), max(b[1] for b in boxes), min(min(b[2:]) for b in boxes),
                             max(max(b[2:]) for b in boxes))
            sc.render.border_min_x, sc.render.border_max_x = border_of_all[:2]
            sc.render.border_min_y, sc.render.border_max_y = border_of_all[2:]
            for k in range(5):
                set_phase(cog_t=k / 5)
                sc.render.filepath = str(an / f"door{'LR'[side]}-{k:02d}.png")
                bpy.ops.render.render(write_still=True)
    if MODE == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"lab-L{L}.blend"))
    print("DONE", L, MODE)


main()

