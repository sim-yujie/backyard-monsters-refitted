"""baiter.py : the Wild Monster Baiter (Flash building 19) as a 3D model, in the approved Twig/Pebble/Putty/HCC family
(same camera, light, render settings and scale; no outline). Flash has one look for every level with a 41-frame strip
drawn over it, so there is one model: the spray can and boulders stand still, the rig on the can's shoulder (toothed
crown, two plates and the leaning wire bail, the nozzle cap and its purple spray) turns once round a loop, clockwise
from above, and the little cog it drives turns twice. The shared helpers come from the HCC's hcc.py.

    blender -b --factory-startup -P baiter.py -- 1 fit [k]   work/fit-L1.png    quick render without the ground (frame k)
    blender -b --factory-startup -P baiter.py -- 1 still     render/L1-base.png (still parts + ground shadow),
                                                             render/L1-alone.png (whole, frame 0), render/L1-parts-00.png
    blender -b --factory-startup -P baiter.py -- 1 anim      render/L1-parts-NN.png, the moving parts per Flash frame
    blender -b --factory-startup -P baiter.py -- 1 check     CHECK lines: parts whose meshes overlap (three frames);
                                                             CLEAR lines: how near each part comes to anything else
    blender -b --factory-startup -P baiter.py -- 1 probe sx sy ...   what the camera sees first through Flash pixels
The base picture is rendered once; each frame renders only the moving parts with every still part as a holdout, and
post.py lays that layer over the base.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "fit"]
LEVEL = int(ARGS[0])
MODE = ARGS[1] if len(ARGS) > 1 else "fit"
sys.path.insert(0, str(HERE))
import stack as S  # noqa: E402

EL = 30.0
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the can's axis on the ground)
GROUND = S.GROUND
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-50,-36,62,72").split(","))   # as fref.FRAME
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1900)


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



def label_mat(name="label"):
    """The paper label (label.png) wrapped once round the can: u from the bearing, v from the height."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Object"], sep.inputs[0])
    at = t.n("ShaderNodeMath", operation="ARCTAN2")
    t.link(sep.outputs["Y"], at.inputs[0])
    t.link(sep.outputs["X"], at.inputs[1])
    u = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")         # bearing (rad) -> (deg + 225) / 360
    t.link(at.outputs[0], u.inputs[0])
    u.inputs[1].default_value = 1.0 / (2 * math.pi)
    u.inputs[2].default_value = 225.0 / 360.0
    uf = t.n("ShaderNodeMath", operation="FRACT")
    t.link(u.outputs[0], uf.inputs[0])
    v = t.n("ShaderNodeMath", operation="DIVIDE")
    t.link(sep.outputs["Z"], v.inputs[0])
    v.inputs[1].default_value = S.CAN_Z1
    comb = t.n("ShaderNodeCombineXYZ")
    t.link(uf.outputs[0], comb.inputs[0])
    t.link(v.outputs[0], comb.inputs[1])
    img = t.n("ShaderNodeTexImage")
    img.image = bpy.data.images.load(str(HERE / "label.png"))
    img.interpolation = "Cubic"
    img.extension = "EXTEND"
    t.link(comb.outputs[0], img.inputs["Vector"])
    out = img.outputs["Color"]
    # soft wear: a faint mottle and scuffs
    vv = t.coords()
    n1 = t.noise(vv, 2.5, 3.0, 0.5, 0.2)
    out = t.mix(out, srgb(150, 150, 140), t.ramp(n1, [(0.5, (0, 0, 0, 1)), (0.8, (0.25, 0.25, 0.25, 1))]))
    # Flash's painted shading: the label darkens strongly toward the right (away from the light)
    geo = t.n("ShaderNodeNewGeometry")
    dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(geo.outputs["Normal"], dp.inputs[0])
    dp.inputs[1].default_value = (-0.5, -0.86, 0.0)
    shade = t.n("ShaderNodeMapRange")
    shade.inputs[1].default_value, shade.inputs[2].default_value = -0.7, 0.6
    shade.inputs[3].default_value, shade.inputs[4].default_value = 0.35, 1.0
    t.link(dp.outputs["Value"], shade.inputs[0])
    grey = t.n("ShaderNodeCombineColor")
    for i in range(3):
        t.link(shade.outputs[0], grey.inputs[i])
    out = t.mix(out, grey.outputs[0], 1.0, "MULTIPLY")
    out = t.grime(out, GROUND, 2.2, 0.3, 0.5)
    t.set(**{"Base Color": out, "rough": 0.5, "metal": 0.0, "spec": 0.35})
    t.bump(t.noise(vv, 22, 4.0, 0.6), 0.03, 0.01)
    MATS[name] = t.m
    return t.m


def spray_mat(name, col, alpha, emit):
    if name in MATS:
        return MATS[name]
    t = NT(name)
    t.set(**{"Base Color": srgb(*col), "rough": 0.9, "metal": 0.0, "Alpha": alpha})
    t.bsdf.inputs["Emission Color"].default_value = srgb(*col)
    t.bsdf.inputs["Emission Strength"].default_value = emit
    MATS[name] = t.m
    return t.m


def materials():
    M = {}
    M["label"] = label_mat()
    # the domed top: Flash's steel blue, a bright white sheen on the left, darker to the right
    M["dome"] = shiny("dome", (140, 156, 172), rough=0.3, metal=0.22, side=0.5, wear=(124, 138, 154), scale=2.0,
                      dirt=0.1, spec=0.5, glow=((-11.0, 9.5, 5.0, 3.5, 0.75, (238, 246, 252)),
                                                (-6.0, 12.0, 10.0, 5.0, 0.3, (190, 204, 216))))
    M["seam"] = shiny("seam", (120, 134, 148), rough=0.3, metal=0.7, wear=(98, 110, 124), scale=4, dirt=0.15)
    M["rim"] = shiny("rim", (96, 104, 112), rough=0.32, metal=0.7, wear=(150, 156, 166), scale=4, dirt=0.1)
    M["cup"] = shiny("cup", (70, 76, 84), rough=0.4, metal=0.6, wear=(96, 104, 112), scale=4, dirt=0.3)
    M["foot"] = shiny("foot", (150, 156, 160), rough=0.35, metal=0.6, wear=(120, 126, 130), scale=4, dirt=0.3)
    # the turning rig: dark green-grey steel crown and plates, a blue-grey wire, a silver cap with a near-white top
    M["crown"] = painted("crown", (70, 84, 80), rough=0.45, metal=0.45, wear=(104, 120, 122), rust=(66, 56, 40),
                         scale=4.0, dirt=0.2, spec=0.45, top=(140, 156, 160), rust_at=0.68)
    M["plate"] = painted("plate", (58, 72, 64), rough=0.5, metal=0.4, wear=(88, 104, 96), scale=5.0, dirt=0.15, spec=0.4)
    M["wire"] = shiny("wire", (126, 138, 156), rough=0.3, metal=0.7, wear=(150, 160, 176), scale=6, dirt=0.0)
    M["bolt"] = shiny("bolt", (40, 46, 46), rough=0.35, metal=0.7, wear=(80, 88, 90), scale=6, dirt=0.0)
    M["cap"] = shiny("cap", (196, 200, 206), rough=0.25, metal=0.6, side=0.5, wear=(160, 164, 172), scale=3, dirt=0.05)
    M["captop"] = shiny("captop", (238, 240, 244), rough=0.25, metal=0.3, wear=(214, 218, 224), scale=3, dirt=0.0)
    M["lever"] = shiny("lever", (104, 112, 120), rough=0.3, metal=0.7, side=0.4, wear=(150, 158, 166), scale=4, dirt=0.0)
    M["hole"] = flat("hole", (12, 10, 14), rough=1.0)
    M["spray1"] = spray_mat("spray1", (214, 60, 236), 0.85, 1.2)
    M["spray2"] = spray_mat("spray2", (200, 110, 230), 0.55, 0.8)
    M["spray3"] = spray_mat("spray3", (214, 170, 236), 0.3, 0.5)
    # the cog: dark rusty brown iron; its axle steel; the pink tag
    M["cog"] = painted("cog", (64, 54, 34), rough=0.7, metal=0.3, wear=(92, 78, 50), rust=(84, 60, 30), scale=6.0,
                       dirt=0.2, spec=0.3)
    M["axle"] = shiny("axle", (110, 116, 120), rough=0.35, metal=0.7, wear=(80, 84, 88), scale=6, dirt=0.1)
    M["tag"] = painted("tag", (150, 112, 134), rough=0.6, metal=0.0, wear=(176, 140, 160), scale=4.0, dirt=0.35,
                       spec=0.3, top=(196, 160, 184))
    # the boulders: near-black, a little brown, soft grey lights; the pale stones at their feet
    M["rock"] = painted("rock", (28, 27, 23), rough=0.8, metal=0.0, wear=(56, 54, 46), scale=3.5, dirt=0.25, spec=0.3,
                        top=(52, 50, 44))
    M["stone"] = painted("stone", (196, 198, 176), rough=0.8, metal=0.0, wear=(160, 162, 142), scale=4.0, dirt=0.1,
                         spec=0.2)
    return M


M = materials()

def vspin(name, center, parts):
    """A part turning about the vertical through center; local X = world X (bearing 0) before it turns."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = center
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    parts(hub)
    return e, hub


def P(th, r, z):
    return Vector(S.polar(th, r, z))


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


# ---------------------------------------------------------------------------------------------------- the body

# ---------------------------------------------------------------------------------------------------- the body
def lump(name, at, radii, mat, seed, rough=0.12, rot_z=0.0, subdiv=3, parent=None, grit=0.0):
    """A rounded boulder: an ellipsoid with soft lumps, resting on the ground (at = the middle of its foot)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    r = random.Random(seed)
    ph = [r.uniform(0, 6.28) for _ in range(6)]
    for v in bm.verts:
        x, y, z = v.co
        k = 1 + rough * (math.sin(3 * x + ph[0]) * math.cos(2 * y + ph[1]) + 0.6 * math.sin(4 * z + ph[2])
                         + 0.4 * math.cos(5 * x + 3 * z + ph[3]))
        if grit:
            k += grit * r.uniform(-1, 1)
        v.co = Vector((x * radii[0] * k, y * radii[1] * k, max(z * radii[2] * k, -radii[2] * 0.82)))
    for v in bm.verts:
        v.co.z += radii[2] * 0.82
    ob = mesh_ob(name, bm, [mat], subsurf=1, parent=parent)
    ob.location = at
    ob.rotation_euler = (0, 0, math.radians(rot_z))
    return ob


def can():
    R, Z1 = S.CAN_R, S.CAN_Z1
    lathe("can", [(R - 0.1, 0.0), (R - 0.02, 0.03), (R, 0.1), (R, Z1 - 0.02), (R - 0.02, Z1)], (0, 0, 0), M["label"],
          verts=128)
    ring("canfoot", R + 0.01, 0.06, M["foot"], z=0.11, n=128)
    ring("seam", R + 0.05, 0.07, M["seam"], z=S.SEAM_Z, n=128)
    # the domed top: a short wall up from the can's top, a lip out over the crown, then a round bell up to the rim
    # round the valve
    lathe("dome", [(R - 0.06, Z1 - 0.04), (R - 0.03, Z1 + 0.05), (S.FLANGE_R - 0.04, S.LIP_Z - 0.02),
                   (S.LIP_R - 0.02, S.LIP_Z - 0.01), (S.LIP_R + 0.02, S.LIP_Z + 0.03), (S.LIP_R - 0.01, S.LIP_Z + 0.08),
                   (S.LIP_R - 0.04, S.LIP_Z + 0.105), (S.LIP_R - 0.08, S.LIP_Z + 0.13), (2.5, 4.72), (2.3, 4.88), (2.06, 5.03), (1.8, 5.15), (1.54, 5.24), (1.34, 5.285),
                   (S.TOP_R + 0.12, S.TOP_Z - 0.04)],
          (0, 0, 0), M["dome"], verts=128)
    ring("toprim", S.TOP_R, S.RIM_W, M["rim"], z=S.TOP_Z, n=96)
    lathe("valvecup", [(S.TOP_R - 0.02, S.TOP_Z + 0.02), (S.TOP_R - 0.12, S.TOP_Z - 0.08), (0.8, S.TOP_Z - 0.1),
                       (0.0, S.TOP_Z - 0.08)], (0, 0, 0), M["cup"], verts=64)


def rocks():
    for i, (th, d, rr, rt, rz) in enumerate(S.ROCKS):
        lump("rock%d" % i, P(th, d, 0.0), (rr, rt, rz), M["rock"], 40 + i, rough=0.16, rot_z=th, subdiv=4, grit=0.025)
        # pale stones at its foot, toward the viewer
        for j in range(3):
            a = th + (-30 if i == 0 else 30) * (j + 0.5) / 3 - (8 if i == 0 else -8)
            big = 1.6 if (i == 0 and j == 0) else 1.0
            lump("stone%d%d" % (i, j), P(a, d + 0.1 + 0.25 * j, 0.0), ((0.2 - 0.04 * j) * big, 0.16 * big, 0.1 * big),
                 M["stone"],
                 70 + 3 * i + j, rot_z=a, subdiv=2)


def crown(parent):
    """The toothed crown ring: an upright band round the shoulder, teeth hanging from its foot, an inward flange on top
    that rests on the dome."""
    bm = bmesh.new()
    n = S.TEETH * 10
    ro, ri = S.CROWN_R, S.CROWN_R - 0.07
    z1, z0 = S.CROWN_Z1, S.CROWN_Z1 - S.CROWN_H
    zf = S.SEAM_Z + 0.07                     # the flange's underside, on the seam

    def drop(i):
        t = (i % 10) / 10.0 + 0.05
        k = max(0.0, min(1.0, (0.4 - abs(t - 0.5)) / 0.16))
        return S.TOOTH_H * k ** 0.6

    cols = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        zb = z0 - drop(i)
        cols.append([bm.verts.new((ro * c, ro * s, zb)), bm.verts.new((ro * c, ro * s, z1)),
                     bm.verts.new((S.FLANGE_R * c, S.FLANGE_R * s, z1)), bm.verts.new((S.FLANGE_R * c, S.FLANGE_R * s, zf)),
                     bm.verts.new((ri * c, ri * s, zf)), bm.verts.new((ri * c, ri * s, zb))])
    for i in range(n):
        a, b = cols[i], cols[(i + 1) % n]
        for j in range(6):
            k = (j + 1) % 6
            bm.faces.new((a[j], b[j], b[k], a[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob("crown", bm, [M["crown"]], smooth=False, bevel=0.015, segs=2, parent=parent)


def plate(name, y_sign, parent):
    """An upright tab with a round top, bolted to the crown band's outside and standing up past the dome's lip,
    facing out along local +-Y; a bolt at the pivot."""
    w, th = S.PLATE_W, 0.1
    h = S.PLATE_Z1 - S.PLATE_Z0
    pts = [(-w / 2, 0.0), (w / 2, 0.0)]
    for i in range(13):
        a = math.pi * i / 12
        pts.append((w / 2 * math.cos(a), h - w / 2 + w / 2 * math.sin(a)))
    bm = bmesh.new()
    fr = [bm.verts.new((x, -th / 2, z)) for x, z in pts]
    bk = [bm.verts.new((x, th / 2, z)) for x, z in pts]
    bm.faces.new(fr)
    bm.faces.new(bk[::-1])
    k = len(pts)
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((fr[i], fr[j], bk[j], bk[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [M["plate"]], smooth=False, bevel=0.03, segs=2, parent=parent)
    ob.location = (0, y_sign * (S.CROWN_R + th / 2 + 0.005), S.PLATE_Z0)
    # two rivets into the band, and the pivot bolt out through the plate
    for i, x in enumerate((-0.2, 0.2)):
        cyl(name + "rivet%d" % i, 0.06, 0.06, (x, y_sign * (S.CROWN_R + th + 0.0), S.PLATE_Z0 + 0.16), M["bolt"],
            rot=(-90 * y_sign, 0, 0), verts=10, bevel=0.015, parent=parent)
    b = cyl(name + "bolt", 0.13, 0.4, (0, y_sign * (S.CROWN_R - 0.16), S.PIVOT_Z), M["bolt"], rot=(-90 * y_sign, 0, 0),
            verts=16, bevel=0.03, parent=parent)
    return ob, b


def bail_pts(n=40):
    rc = S.CROWN_R - 0.04
    lean = math.radians(S.BAIL_LEAN)
    out = []
    for i in range(n + 1):
        f = math.pi * i / n
        out.append((-rc * math.sin(f) * math.sin(lean), -rc * math.cos(f), S.PIVOT_Z + rc * math.sin(f) * math.cos(lean)))
    return out


def nozzle(parent):
    z0, z1, r = S.CAP_Z0, S.CAP_Z1, S.CAP_R
    lathe("cap", [(0.0, z0), (r - 0.04, z0), (r, z0 + 0.05), (r - 0.02, z1 - 0.1), (r - 0.08, z1 - 0.02),
                  (r - 0.12, z1)], (0, 0, 0), M["cap"], verts=48, parent=parent)
    lathe("captop", [(r - 0.13, z1 - 0.01), (r - 0.2, z1 + 0.03), (0.0, z1 + 0.05)], (0, 0, 0), M["captop"], verts=48,
          parent=parent)
    # the lever: over the top, out past the cap's edge on local -X and down its side
    zt = z1 + 0.12
    sweep("lever", [(0.3, 0, zt), (-0.5, 0, zt), (-0.86, 0, zt - 0.08), (-0.94, 0, zt - 0.4), (-0.94, 0, zt - 1.25)],
          (0, 1, 0), 0.42, 0.16, M["lever"], parent=parent, bevel=0.04)
    box("leverfoot", (0.24, 0.3, 0.16), (0.34, 0, z1 + 0.02), M["lever"], bevel=0.03, parent=parent)
    # the spout on the other side, with a dark mouth
    cyl("spout", 0.12, 0.2, (r - 0.06, 0, z1 - 0.32), M["cap"], rot=(0, 90, 0), verts=16, bevel=0.02, parent=parent)
    cyl("spoutmouth", 0.07, 0.02, (r + 0.13, 0, z1 - 0.32), M["hole"], rot=(0, 90, 0), verts=16, bevel=0.0,
        parent=parent)


def spray(parent):
    """Purple mist out of the spout: dense magenta puffs at the mouth, paler and wider further out, the plume bending
    back the way the rig came from (it turns clockwise from above, so the old mist trails toward local +Y)."""
    r = random.Random(1919)
    x0, z0 = S.CAP_R + 0.2, S.CAP_Z1 - 0.32
    n = 16
    for i in range(n):
        s = i / (n - 1)
        a = math.radians(55 * s ** 1.5)
        d = 0.15 + 2.3 * s
        p = Vector((x0 + d * math.cos(a), d * math.sin(a), z0 - 0.25 * s))
        rad = 0.1 + 0.32 * s
        mat = M["spray1"] if s < 0.35 else (M["spray2"] if s < 0.7 else M["spray3"])
        for k in range(2 if s > 0.2 else 1):
            q = p + Vector((r.uniform(-0.12, 0.12), r.uniform(-0.15, 0.15), r.uniform(-0.1, 0.1))) * (0.5 + s)
            ob = lump("spray%02d%d" % (i, k), q, (rad * 1.2, rad, rad * 0.75), mat, 300 + 2 * i + k, rough=0.2,
                      subdiv=2, parent=parent)
            ob.location.z -= rad * 0.62
            ob.visible_shadow = False
    for j in range(14):                    # loose specks round the plume
        s = r.uniform(0.2, 1.0)
        a = math.radians(55 * s ** 1.5)
        d = 0.15 + 2.3 * s
        q = Vector((x0 + d * math.cos(a), d * math.sin(a), z0 - 0.25 * s)) + Vector(
            (r.uniform(-0.4, 0.4), r.uniform(-0.5, 0.5), r.uniform(-0.45, 0.2)))
        ob = lump("speck%02d" % j, q, (0.04, 0.04, 0.04), M["spray3"], 500 + j, rough=0.0, subdiv=1,
                  parent=parent)
        ob.visible_shadow = False


def rig():
    e, hub = vspin("rig", (0, 0, 0), lambda h: None)
    crown(hub)
    plate("plateA", 1, hub)
    plate("plateB", -1, hub)
    tube("bail", bail_pts(), 0.055, M["wire"], parent=hub, verts=10, smooth=True)
    nozzle(hub)
    spray(hub)
    MOVING.append(hub)
    return hub


def toothed_ring(name, ro, ri, teeth, depth, tooth, mat, parent):
    """A flat cog rim in its local XY (axis local Z): teeth round the outside, open inside (spokes are separate)."""
    bm = bmesh.new()
    n = teeth * 4
    outer, inner = [], []
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        rr = ro if (i % 4) in (0, 1) else ro * (1 - tooth)
        outer.append((rr * math.cos(a), rr * math.sin(a)))
        inner.append((ri * math.cos(a), ri * math.sin(a)))
    zs = (-depth / 2, depth / 2)
    o = [[bm.verts.new((x, y, z)) for x, y in outer] for z in zs]
    q = [[bm.verts.new((x, y, z)) for x, y in inner] for z in zs]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((o[0][i], o[0][j], o[1][j], o[1][i]))
        bm.faces.new((q[0][j], q[0][i], q[1][i], q[1][j]))
        bm.faces.new((o[1][i], o[1][j], q[1][j], q[1][i]))
        bm.faces.new((o[0][j], o[0][i], q[0][i], q[0][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=0.02, segs=2, parent=parent)


def cog():
    """The small cog on a stub axle out of the can's front-right, its top teeth in the crown's; a pink tag hangs from
    the axle's end."""
    th = S.COG_TH
    a = math.radians(th)
    out = Vector((math.cos(a), math.sin(a), 0))
    side = Vector((-math.sin(a), math.cos(a), 0))
    c = P(th, S.COG_D, S.COG_Z)

    def parts(h):
        toothed_ring("cog", S.COG_R, S.COG_R * 0.64, S.COG_TEETH, 0.22, 0.17, M["cog"], h)
        lathe("coghub", [(0.0, 0.13), (0.26, 0.13), (0.3, 0.0), (0.26, -0.13), (0.0, -0.13)], (0, 0, 0), M["cog"],
              verts=24, parent=h)
        for i in range(6):                  # six spokes between the holes
            b = math.radians(60 * i + 30)
            box("cogspoke%d" % i, (0.16, S.COG_R * 0.5, 0.12), (math.cos(b) * S.COG_R * 0.43,
                                                                  math.sin(b) * S.COG_R * 0.43, 0), M["cog"],
                rot=(0, 0, 60 * i + 30 - 90), origin="centre", bevel=0.03, parent=h)
    e, hub = spinner("cogspin", c, th, 0.0, parts)
    MOVING.append(hub)
    # the stub axle from inside the can's wall out past the cog, a nut on its end
    ax0 = P(th, S.CAN_R - 0.15, S.COG_Z)
    cyl("axle", 0.1, S.COG_D - S.CAN_R + 0.5, ax0, M["axle"], verts=16, bevel=0.02)
    track(bpy.data.objects["axle"], out)
    nut = cyl("axlenut", 0.17, 0.12, P(th, S.COG_D + 0.2, S.COG_Z), M["axle"], verts=6, bevel=0.02)
    track(nut, out)
    # the pink tag: a strip hung on the axle by a ring, swinging a little to the right
    tp = P(th, S.COG_D + 0.36, S.COG_Z)
    ring_ob = ring("tagring", 0.16, 0.035, M["axle"], n=24)
    ring_ob.location = tp + Vector((0, 0, -0.05))
    track(ring_ob, side)
    tag = box("tag", (0.07, 0.8, 1.78), tp + Vector((0, 0, -0.12)), M["tag"], bevel=0.03, origin="bottom",
              rot=(192, 0, th))
    return hub


def build():
    can()
    rocks()
    rig()
    cog()


FAMILY = (("canfoot", "can"), ("can", "can"), ("dome", "can"), ("seam", "can"), ("toprim", "can"),
          ("valvecup", "can"), ("rock", "rock"), ("stone", "stone"), ("crown", "crown"), ("plate", "plate"),
          ("bail", "bail"), ("captop", "cap"), ("cap", "cap"), ("lever", "cap"), ("spout", "cap"), ("spray", "spray"),
          ("speck", "spray"), ("cog", "cog"), ("axle", "axle"), ("tag", "tag"))
MASONRY = ()


def turn(frame):
    """Turn the moving parts to Flash frame `frame` at an even speed, as Flash's strip: frames 0 and 1 show the same
    pose (frame 0 without the spray), then 9 degrees a frame. The rig goes once round clockwise from above (bearing
    falling; at frame 0 the bail leans toward the back-left, as Flash's), the cog twice (its 12 teeth in the crown's 24),
    its top running the way the crown's front runs."""
    f = max(frame - 1, 0) / (S.FRAMES - 1)
    hub = bpy.data.objects["rig-spin"]
    hub.rotation_euler = (0, 0, -2 * math.pi * S.TURNS * f)
    cg = bpy.data.objects["cogspin-spin"]
    cg.rotation_euler = (0, 0, 2 * math.pi * S.TURNS * f * S.TEETH / S.COG_TEETH)
    for o in SC.objects:
        if o.name.startswith(("spray", "speck")):
            o.hide_render = frame == 0


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
    return [o for o in SC.objects if o.type in ("MESH", "CURVE") and not under_moving(o) and o.name != "ground"]


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
        if o.type not in ("MESH", "CURVE") or o.name == "ground":
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
    moving_objs = [o for o in SC.objects if under_moving(o)]
    turn(int(ARGS[2]) if MODE == "fit" and len(ARGS) > 2 else 0)
    if MODE == "check":
        # which parts touch or pass through others (evaluated meshes, BVH overlap), at three points of the turn
        for k in (0, S.FRAMES // 3, 2 * S.FRAMES // 3):
            turn(k)
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
                print("CHECK frame", k, key, sum(x[2] for x in v), v[:3])
        turn(0)
        tr = trees()
        obs = list(tr.values())
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
    if MODE in ("still", "base"):
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 384))
        for o in moving_objs:
            o.visible_camera = False
        sc.render.filepath = str(out / f"L{L}-base.png")
        bpy.ops.render.render(write_still=True)
        # the building alone (no ground shadow), whole, for the outline check
        for o in moving_objs:
            o.visible_camera = True
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 64
        sc.render.filepath = str(out / f"L{L}-alone.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects["ground"].hide_render = False
        for o in moving_objs:
            o.visible_camera = False
    if MODE in ("still", "anim"):
        n = 1 if MODE == "still" else S.FRAMES
        k0 = int(os.environ.get("PB_FROM", 0))
        sc.cycles.samples = int(os.environ.get("PB_PART_SAMPLES", 192))
        for o in all_static():
            o.is_holdout = True
        for o in moving_objs:
            o.visible_camera = True
        bpy.data.objects["ground"].hide_render = True
        bxs = []
        for k in range(0, S.FRAMES, 3):         # the rig's box changes as it turns: take them all
            turn(k)
            bpy.context.view_layer.update()
            bxs.append(border_of(moving_objs, pad=40))
        bx = (min(b[0] for b in bxs), max(b[1] for b in bxs), min(b[2] for b in bxs), max(b[3] for b in bxs))
        sc.render.use_border = True
        sc.render.use_crop_to_border = False
        sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = bx
        for k in range(k0, n):
            turn(k)
            bpy.context.view_layer.update()
            sc.render.filepath = str(out / f"L{L}-parts-{k:02d}.png")
            bpy.ops.render.render(write_still=True)
    if MODE == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"baiter-L{L}.blend"))
    print("DONE", L, MODE)


main()
