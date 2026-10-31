"""th.py : the Town Hall (Flash building 14) as a 3D model, in the approved Twig/Pebble/Putty/HCC family (same camera,
light, render settings and scale; no outline). Flash draws a different Town Hall at each of the 10 levels and none of
them animates, so there is one still per level. The machine grows: a ribbed tin can under a funnel at level 1, a roof
sheet at 2, a hood at 3, a riveted dome on a drum from 4, base tiers from 6, gold pipes from 7, gold frames at 9 and 10.
Parts that Flash keeps from one level to the next keep their place and size (stack.py).

    blender -b --factory-startup -P th.py -- <level> fit      work/fit-L<level>.png    quick render without the ground
    blender -b --factory-startup -P th.py -- <level> still    render/L<level>-base.png (with the ground shadow), -alone.png
    blender -b --factory-startup -P th.py -- <level> check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P th.py -- <level> gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P th.py -- <level> probe sx sy ...   what the camera sees first through Flash pixels
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
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["6", "fit"]
LEVEL = int(ARGS[0])
MODE = ARGS[1] if len(ARGS) > 1 else "fit"
sys.path.insert(0, str(HERE))
import stack as S  # noqa: E402

EL = 30.0
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the building's axis on the ground)
GROUND = S.GROUND
FRAME = (-124, -116, 190, 142)        # the canvas in Flash px (as fref.FRAME)
K = int(os.environ.get("TH_K", 3 if MODE == "fit" else 8))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1400 + L)


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


def dots_mask(t, around, pitch, rad, z0=0.0, stagger=True):
    """Holes punched in a band (object space: the band's axis is local Z): `around` holes round it, rows `pitch` apart
    (from z0), hole radius `rad` as a fraction of the spacing. 1 in a hole, 0 elsewhere."""
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Object"], sep.inputs[0])
    at2 = t.n("ShaderNodeMath", operation="ARCTAN2")
    t.link(sep.outputs["Y"], at2.inputs[0])
    t.link(sep.outputs["X"], at2.inputs[1])
    u = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(at2.outputs[0], u.inputs[0])
    u.inputs[1].default_value = around / (2 * math.pi)
    v = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")
    t.link(sep.outputs["Z"], v.inputs[0])
    v.inputs[1].default_value = 1.0 / pitch
    v.inputs[2].default_value = -z0 / pitch
    if stagger:                                  # every other row half a hole round
        fl = t.n("ShaderNodeMath", operation="FLOOR")
        t.link(v.outputs[0], fl.inputs[0])
        half = t.n("ShaderNodeMath", operation="MULTIPLY")
        t.link(fl.outputs[0], half.inputs[0])
        half.inputs[1].default_value = 0.5
        u2 = t.n("ShaderNodeMath", operation="ADD")
        t.link(u.outputs[0], u2.inputs[0])
        t.link(half.outputs[0], u2.inputs[1])
        u = u2
    comb = t.n("ShaderNodeCombineXYZ")
    for i, s in enumerate((u, v)):
        fr = t.n("ShaderNodeMath", operation="FRACT")
        t.link(s.outputs[0], fr.inputs[0])
        sub = t.n("ShaderNodeMath", operation="SUBTRACT")
        t.link(fr.outputs[0], sub.inputs[0])
        sub.inputs[1].default_value = 0.5
        t.link(sub.outputs[0], comb.inputs[i])
    ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
    t.link(comb.outputs[0], ln.inputs[0])
    mr = t.n("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = rad, rad * 0.8
    t.link(ln.outputs["Value"], mr.inputs[0])
    return mr.outputs[0]


def perforated(name, col, hole, around, pitch, rad, z0=0.0, wear=None, rust=None, rough=0.5, metal=0.35):
    """Flash's perforated steel tiers: pale worn steel with rows of small dark holes."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    out = srgb(*col)
    if wear:
        out = t.mix(out, srgb(*wear), t.ramp(t.noise(v, 2.0, 3.0, 0.5, 0.2), [(0.42, (0, 0, 0, 1)), (0.8, (0.7,) * 3 + (1,))]))
    if rust:
        out = t.mix(out, srgb(*rust), t.ramp(t.noise(v, 3.5, 5.0, 0.65, 1.0), [(0.62, (0, 0, 0, 1)), (0.75, (0.8,) * 3 + (1,))]))
    m = dots_mask(t, around, pitch, rad, z0)
    out = t.mix(out, srgb(*hole), m)
    out = t.grime(out, GROUND, 4.0, 0.3, 0.5)
    t.set(**{"Base Color": out, "rough": rough, "metal": metal, "spec": 0.4})
    t.bump(m, 0.25, 0.02)
    MATS[name] = t.m
    return t.m


def materials():
    M = {}
    # the ribbed tin: bright worn chrome with soft rust and soot smudges low down (Flash's can at levels 1-3)
    M["tin"] = painted("tin", (206, 212, 222), rough=0.24, metal=0.92, wear=(168, 174, 186), rust=(150, 96, 52),
                       scale=2.0, dirt=0.35, spec=0.5, rust_at=0.66)
    M["chrome"] = shiny("chrome", (214, 220, 228), rough=0.18, metal=1.0, wear=(186, 192, 204), scale=4, dirt=0.15)
    M["funnel"] = shiny("funnel", (200, 210, 222), rough=0.2, metal=1.0, wear=(168, 180, 196), scale=2, dirt=0.05,
                        streak=0.4)
    # the dome: dark worn brown-grey metal, a little lighter up and to the left
    M["portrim"] = shiny("portrim", (70, 84, 110), rough=0.3, metal=0.8, wear=(96, 110, 136), scale=3, dirt=0.05)
    M["brass"] = shiny("brass", (196, 150, 60), rough=0.26, metal=0.9, side=0.3, wear=(230, 196, 110), scale=2,
                       dirt=0.2, streak=0.4)
    M["dome"] = painted("dome", (84, 66, 62), rough=0.58, metal=0.3, wear=(112, 94, 88), rust=(76, 50, 38), scale=2.5,
                        dirt=0.2, spec=0.5, rust_at=0.6)
    M["gold"] = shiny("gold", (232, 160, 34), rough=0.28, metal=0.85, side=0.3, wear=(250, 204, 96), scale=1.5,
                      dirt=0.35, streak=0.4)
    M["golddark"] = shiny("golddark", (178, 108, 22), rough=0.32, metal=0.8, wear=(212, 146, 52), scale=1.5, dirt=0.45)
    M["red"] = shiny("red", (214, 22, 18), rough=0.3, metal=0.25, wear=(236, 60, 44), scale=2, dirt=0.3, coat=0.4,
                     spec=0.5)
    M["glass"] = shiny("glass", (96, 176, 232), rough=0.12, metal=0.0, wear=(150, 210, 246), scale=1.0, dirt=0.0,
                       coat=1.0, spec=0.6)
    M["rivet"] = shiny("rivet", (226, 230, 236), rough=0.3, metal=0.6, wear=(196, 200, 210), scale=6, dirt=0.05)
    M["steel"] = painted("steel", (176, 182, 192), rough=0.35, metal=0.8, wear=(140, 146, 156), rust=(130, 84, 50),
                         scale=3, dirt=0.3, rust_at=0.7)
    M["perf_lo"] = perforated("perf_lo", (168, 170, 178), (40, 34, 34), 64, 0.75, 0.15, z0=0.0, wear=(150, 150, 158),
                              rust=(150, 104, 70), rough=0.32, metal=0.75)
    # levels 6-8's tiers: Flash's grey-silver, darker than level 9's pale base
    M["perf_hi"] = perforated("perf_hi", (134, 136, 144), (40, 34, 34), 52, 0.75, 0.15, z0=0.0, wear=(116, 116, 124),
                              rust=(130, 94, 66), rough=0.4, metal=0.65)
    M["perf_t"] = perforated("perf_t", (134, 136, 144), (40, 34, 34), 64, 0.75, 0.15, z0=0.0, wear=(116, 116, 124),
                             rust=(130, 94, 66), rough=0.4, metal=0.65)
    M["core"] = painted("core", (44, 40, 44), rough=0.45, metal=0.7, wear=(78, 74, 80), rust=(70, 46, 34), scale=3,
                        dirt=0.2, rust_at=0.7)
    M["tiertop"] = painted("tiertop", (96, 94, 98), rough=0.6, metal=0.4, wear=(124, 122, 128), rust=(110, 80, 60))
    M["tindark"] = painted("tindark", (128, 138, 158), rough=0.3, metal=0.9, wear=(168, 178, 196), rust=(110, 80, 60),
                           scale=2.0, dirt=0.45, spec=0.5, rust_at=0.6)
    M["band10"] = painted("band10", (178, 174, 166), rough=0.45, metal=0.45, wear=(150, 146, 138), rust=(140, 100, 70))
    M["beige"] = painted("beige", (206, 196, 176), rough=0.55, metal=0.3, wear=(176, 166, 148), rust=(150, 104, 70),
                         scale=3, dirt=0.35, rust_at=0.68)
    M["hole"] = flat("hole", (18, 14, 14), rough=1.0)
    M["tusk"] = shiny("tusk", (246, 200, 96), rough=0.25, metal=0.8, side=0.3, wear=(255, 232, 156), scale=1.5,
                      dirt=0.2, streak=0.3)
    M["tinshade"] = painted("tinshade", (78, 82, 94), rough=0.35, metal=0.85, wear=(118, 124, 138), rust=(90, 64, 48))
    M["hood"] = painted("hood", (62, 52, 50), rough=0.55, metal=0.3, wear=(92, 80, 76), rust=(70, 46, 36), scale=2.5, dirt=0.2, spec=0.5, rust_at=0.6)
    M["palegold"] = shiny("palegold", (232, 196, 128), rough=0.35, metal=0.6, wear=(206, 160, 90), scale=2, dirt=0.3,
                          side=0.3)
    M["rustgold"] = painted("rustgold", (170, 112, 40), rough=0.5, metal=0.6, wear=(210, 150, 60), rust=(96, 56, 30),
                            scale=4, dirt=0.3, rust_at=0.55)
    M["leather"] = painted("leather", (74, 58, 54), rough=0.75, wear=(96, 80, 74), rust=(58, 44, 40), scale=3.0,
                           dirt=0.25, spec=0.3, rust_at=0.6)
    M["yellow"] = painted("yellow", (236, 168, 40), rough=0.45, metal=0.2, wear=(250, 196, 80), rust=(150, 96, 40),
                          scale=4.0, dirt=0.3, rust_at=0.72)
    M["string"] = painted("string", (120, 100, 88), rough=0.85, scale=8.0, dirt=0.2)
    M["tag"] = painted("tag", (186, 186, 190), rough=0.6, wear=(150, 150, 156), scale=6.0, dirt=0.2)
    M["handle"] = shiny("handle", (30, 30, 34), rough=0.35, metal=0.1, wear=(58, 58, 64), scale=3, dirt=0.05)
    return M


M = materials()


def P(th, r, z):
    return Vector(S.polar(th, r, z))


def track(ob, direction, up="Y"):
    ob.rotation_euler = Vector(direction).normalized().to_track_quat("Z", up).to_euler()
    return ob


def ring(name, r, wire, mat, parent=None, z=0.0, n=64):
    return tube(name, [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)],
                wire, mat, parent=parent, verts=12, cyclic=True)


def studs(name, pts, r, mat, flat_=0.6):
    """Many small round rivet heads in one mesh: pts = [(point, normal)]."""
    bm = bmesh.new()
    for p, nrm in pts:
        res = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=r)
        q = Vector(nrm).normalized().to_track_quat("Z", "Y")
        for v in res["verts"]:
            c = v.co.copy()
            c.z *= flat_
            v.co = Vector(p) + q @ c
    return mesh_ob(name, bm, [mat])


def bearing_of(v):
    return math.degrees(math.atan2(v[1], v[0]))


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



# ---------------------------------------------------------------------------------------------------- the kit
def ribbed(name, r, z0, z1, pitch=0.28, depth=0.1, mat=None, cap=True):
    """The ribbed tin: a cylinder whose wall rises and falls in rounded ribs (a food can's beads)."""
    prof = []
    n = max(2, int(round((z1 - z0) / pitch)))
    steps = n * 6
    for i in range(steps + 1):
        z = z0 + (z1 - z0) * i / steps
        ph = (i % 6) / 6.0
        prof.append((r - depth * (0.5 - 0.5 * math.cos(2 * math.pi * ph)) ** 2, z))
    ob = lathe(name, prof, (0, 0, 0), mat or M["tin"], verts=64)
    if cap:
        cyl(name + "-cap", r, 0.02, (0, 0, z1 - 0.02), mat or M["tin"], verts=64, bevel=0.0)
        cyl(name + "-bot", r, 0.02, (0, 0, z0), mat or M["tin"], verts=64, bevel=0.0)
    return ob


def funnel(z, spout_mat=None, k=1.0, extra=0.0):
    """The polished funnel, its spout standing on z (k: its size, extra: a longer spout)."""
    sr, rr, ch, sh = S.FUN_SPOUT_R * k, S.FUN_RIM_R * k, S.FUN_CONE_H * k, S.FUN_SPOUT_H * k + extra
    prof = [(sr * 0.85, z), (sr, z + 0.05), (sr, z + sh)]
    for i in range(1, 13):
        f = i / 12
        prof.append((sr + (rr - sr) * f ** 1.25, z + sh + ch * f))
    prof += [(rr + 0.06, z + sh + ch + 0.03), (rr + 0.08, z + sh + ch + 0.08), (rr - 0.04, z + sh + ch + 0.06)]
    for i in range(1, 9):          # the inside, back down the cone
        f = 1 - i / 9
        prof.append((max(0.05, sr + (rr - sr) * f ** 1.25 - 0.05), z + sh + ch * f + 0.03))
    ob = lathe("funnel", prof, (0, 0, 0), M["funnel"], verts=64)
    if spout_mat is not None:     # a brass neck over the spout
        lathe("funnel-neck", [(sr + 0.04, z), (sr + 0.06, z + 0.3), (sr + 0.03, z + sh * 0.8), (sr + 0.2, z + sh + 0.25),
                              (sr + 0.12, z + sh + 0.3)], (0, 0, 0), spout_mat, verts=48)
    return ob


def dome(name, r, zeq, flat_=1.0):
    """The riveted dome: a hemisphere (height r * flat_) with a slight lip round its foot."""
    prof = [(r + 0.08, zeq - 0.12), (r + 0.1, zeq), (r, zeq + 0.02)]
    for i in range(1, 25):
        a = math.radians(90 * i / 24)
        prof.append((max(0.001, r * math.cos(a)), zeq + r * flat_ * math.sin(a)))
    return lathe(name, prof, (0, 0, 0), M["dome"], verts=96)


def on_dome(r, zeq, th, el, flat_=1.0, out=0.0):
    """A point on the dome surface (bearing th, elevation el) and its normal."""
    a, e = math.radians(th), math.radians(el)
    n = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e) / flat_)).normalized()
    p = Vector(((r + out) * math.cos(e) * math.cos(a), (r + out) * math.cos(e) * math.sin(a), zeq + (r + out) * flat_ * math.sin(e)))
    return p, n


def porthole(name, p, n, rp, frame=0.08, mat_ring=None):
    """A round window: a chrome ring with a pale blue lens, facing n."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = p
    e.rotation_euler = Vector(n).to_track_quat("Z", "Y").to_euler()
    ring(name + "-ring", rp, frame, mat_ring or M["portrim"], parent=e, z=0.0)
    lathe(name + "-lens", [(rp * math.cos(math.radians(a)), -0.1 + rp * 0.3 * math.sin(math.radians(a)))
                           for a in range(0, 91, 10)], (0, 0, 0), M["glass"], parent=e, verts=40)
    return e


def dome_rivets(name, r, zeq, meridians, el0, el1, step, rr=0.05, double=0.0, flat_=1.0, skip=()):
    pts = []
    for th in meridians:
        el = el0
        while el <= el1 + 1e-6:
            for off in ((-double, double) if double else (0.0,)):
                t2 = th + off / max(0.2, math.cos(math.radians(el)))
                if any(abs(((t2 - s[0] + 180) % 360) - 180) < s[2] and abs(el - s[1]) < s[2] for s in skip):
                    continue
                pts.append(on_dome(r, zeq, t2, el, flat_, 0.0))
            el += step
    return studs(name, pts, rr, M["rivet"])


def ring_rivets(name, r, z, n, rr=0.05, th0=0.0, th1=360.0):
    pts = []
    for i in range(n):
        th = th0 + (th1 - th0) * i / n
        pts.append((P(th, r, z), P(th, 1, 0)))
    return studs(name, pts, rr, M["rivet"])


def strap(name, th, r, z0, z1, w=0.42, t=0.1, rivets=5, mat=None):
    """A gold strip standing up the drum at bearing th, with rivets down it."""
    c = P(th, r + t / 2, z0)
    b = box(name, (t, w, z1 - z0), c, mat or M["gold"], rot=(0, 0, th), bevel=0.02)
    pts = [(P(th, r + t + 0.01, z0 + (z1 - z0) * (i + 0.5) / rivets), P(th, 1, 0)) for i in range(rivets)]
    studs(name + "-rv", pts, 0.06, M["rivet"])
    return b


def gearfoot(name, th, d, r=1.2, teeth=12, h=0.36, mat=None):
    """A gold gear lying on the ground under a foot."""
    return gear(name, r, teeth, h, P(th, d, h / 2), mat or M["gold"], (0, 0, math.radians(th)), tooth=0.16)


def band(name, r, z0, z1, mat, thick=0.12):
    """An upright ring wall (a tier's side)."""
    return lathe(name, [(r - thick, z0), (r, z0), (r, z1), (r - thick, z1)], (0, 0, 0), mat, verts=96)


def disc(name, r0, r1, z, mat, thick=0.06):
    """A flat ring (r0 = 0: a plate)."""
    if r0 <= 0.0:
        return cyl(name, r1, thick, (0, 0, z - thick), mat, verts=96, bevel=0.02)
    return lathe(name, [(r0, z - thick), (r1, z - thick), (r1, z), (r0, z)], (0, 0, 0), mat, verts=96)


# ---------------------------------------------------------------------------------------------------- level 4-6 body
def body_dome(lv):
    """The drum, dome, portholes, rivets, straps, collar and funnel of levels 4 to 8."""
    dr, dz0, dz1 = lv["drum"]
    rr, zeq = lv["dome"]
    ribbed("drum", dr, dz0, dz1 + 0.05, pitch=0.42, depth=0.16, mat=M[lv["drum_mat"]] if "drum_mat" in lv else None)
    fl = lv.get("dome_flat", 1.0)
    dome("dome", rr, zeq, fl)
    disc("dome-floor", 0.0, rr, zeq, M["dome"], thick=0.15)
    # the portholes: a front row of five round the dome's middle, four higher up between them
    holes = lv.get("holes", [])
    skip = []
    for i, (th, el, rp) in enumerate(holes):
        small = rp < 0.5                     # level 8's little windows: a thin rim standing on the dome
        p, n = on_dome(rr, zeq, th, el, fl, 0.03 if small else -0.02)
        porthole(f"port{i}", p, n, rp, frame=0.05 if small else 0.08 + 0.04 * (rp > 1.0), mat_ring=M[lv["port_mat"]] if "port_mat" in lv else None)
        skip.append((th, el, math.degrees(rp / rr) + 3.0))
    # rivet lines: double rows down the meridians and single rings round each porthole
    mer = lv.get("meridians", [])
    if mer:
        dome_rivets("dome-rvt", rr + 0.01, zeq, mer, 5.0, 80.0, 5.5, rr=0.055, double=1.9, skip=skip, flat_=fl)
    pts = []
    for th, el, rp in holes:
        if rp < 0.5:
            continue
        p, n = on_dome(rr, zeq, th, el, fl, 0.0)
        q = Vector(n).to_track_quat("Z", "Y")
        for k in range(14):
            a = 2 * math.pi * k / 14
            pts.append((p + q @ Vector(((rp + 0.2) * math.cos(a), (rp + 0.2) * math.sin(a), 0.0)), n))
    if pts:
        studs("dome-prvt", pts, 0.045, M["rivet"])
    ring_rivets("dome-lip", rr + 0.1, zeq - 0.06, 64, rr=0.045)
    # the gold collar on the top, the funnel standing in it
    ztop = zeq + rr * fl
    lathe("collar", [(0.6, ztop - 0.4), (0.98, ztop - 0.35), (1.02, ztop - 0.1), (0.95, ztop + 0.12),
                     (0.5, ztop + 0.18), (0.33, ztop + 0.2)], (0, 0, 0), M["gold"], verts=48)
    funnel(lv["fun_z"], M["brass"] if lv.get("brass_spout") else None, k=lv.get("fun_k", 1.0))
    for i, th in enumerate(lv.get("straps", [])):
        strap(f"strap{i}", th, dr - 0.02, dz0 - 0.2, dz1, w=0.56, rivets=7)


# ---------------------------------------------------------------------------------------------------- the levels
def railbar(name, pts, r=0.2, mat=None):
    """A red enamel bar through world points (rounded bends)."""
    return tube(name, pts, r, mat or M["red"], verts=14, smooth=False)


def foot5(i, th, d, z_top, big=False):
    """A foot of levels 5 and 6: a thick gold gear on the ground under a gold vase whose cup meets the body at z_top
    (level 5: a smaller gear part way up a steel post)."""
    r0 = 1.3 if big else 1.08
    h0 = 0.7 if big else 0.34
    if big:                            # level 6: two gears on a gold post, a gap between them (Flash)
        gear(f"foot{i}-gear", 1.28, 26, 0.4, P(th, d, 0.2), M["gold"], (0, 0, math.radians(th)), tooth=0.12)
        cyl(f"foot{i}-hub", 0.48, 0.14, P(th, d, 0.4), M["gold"], verts=24)
        cyl(f"foot{i}-post", 0.2, z_top - 0.5, P(th, d, 0.5), M["gold"], verts=16)
        gear(f"foot{i}-gear2", 1.18, 24, 0.2, P(th, d, 1.0), M["gold"], (0, 0, math.radians(th + 9)), tooth=0.12)
        cyl(f"foot{i}-cup", 0.22, 0.42, P(th, d, z_top - 0.42), M["gold"], verts=24, r2=0.62)
        return
    gearfoot(f"foot{i}-gear", th, d, r=r0, teeth=14, h=h0)
    c = P(th, d, h0)
    cyl(f"foot{i}-hub", 0.42, 0.22, c, M["gold"], verts=24)
    cyl(f"foot{i}-post", 0.14, z_top - 0.5, c, M["steel"], verts=16)
    gear(f"foot{i}-gear2", 0.78, 12, 0.22, P(th, d, 1.1), M["gold"], (0, 0, math.radians(th + 7)), tooth=0.16)
    cyl(f"foot{i}-cup", 0.36, 0.3, P(th, d, 1.2), M["gold"], verts=24, r2=0.24)


def rails5(lv, tiers=None, sides=True, diag=True, front=True):
    """The red rails of levels 5 and 6: they hold the drum up on the eight feet. Front and diagonal bars run from the
    drum's foot down and out (at level 6 over the tiers' edges) and a thin rod drops from each to its foot; the side ones
    are square frames with a steel panel, a red handle above."""
    dr, dz0, _ = lv["drum"]
    z0 = dz0
    fd = lv["foot_d"]
    for i, th in enumerate(lv["feet"]):
        rel = ((th - S.FRONT + 180) % 360) - 180
        if (front and abs(rel) < 1) or (diag and abs(abs(rel) - 45) < 1):
            zs = z0 + (0.9 if abs(rel) < 1 else 0.6)
            if tiers:
                (r1, z1a, z1b), (r2, z2a, z2b) = tiers
                ze = z2a + 0.9
                pts = [P(th, dr - 0.1, zs), P(th, r1 + 0.3, z1b - 0.1), P(th, r2 + 0.3, z2b - 0.1), P(th, r2 + 0.32, ze)]
                railbar(f"rail{i}", pts, 0.3)
                cyl(f"rail{i}-tip", 0.3, 0.4, P(th, r2 + 0.32, ze - 0.4), M["red"], r2=0.3, verts=16)
                cyl(f"rail{i}-tip2", 0.04, 0.3, P(th, r2 + 0.32, ze - 0.7), M["red"], r2=0.3, verts=16)
                railbar(f"rail{i}-rod", [P(th, r2 + 0.32, ze - 0.6), P(th, r2 + 0.32, z2a + 0.1), P(th, fd + 0.1, 1.2)], 0.06)
            elif abs(rel) < 1:
                railbar(f"rail{i}", [P(th, dr - 0.1, zs), P(th, dr + 0.6, z0 + 0.3), P(th, fd, 2.1), P(th, fd, 1.3)], 0.28)
            else:
                railbar(f"rail{i}", [P(th, dr - 0.1, zs), P(th, fd + 0.3, z0 - 1.6), P(th, fd, 1.9), P(th, fd, 1.3)], 0.28)
        elif sides and abs(rel) >= 1 and abs(abs(rel) - 45) >= 1:    # the sides: a frame
            zt = z0 + 0.1
            ro = (tiers[1][0] + 0.6) if tiers else fd + 0.8
            pts = [P(th, dr - 0.1, zt), P(th, ro, zt), P(th, ro, zt - 2.2)]
            railbar(f"rail{i}", pts, 0.22)
            railbar(f"rail{i}-in", [P(th, ro - 0.9, zt), P(th, ro - 0.9, zt - 1.6 if tiers else 1.3)], 0.2)
            railbar(f"rail{i}-up", [P(th, dr + 0.2, zt), P(th, dr + 0.2, zt + 1.8), P(th, dr + 1.0, zt + 1.8),
                                    P(th, dr + 1.0, zt)], 0.15)
            box(f"rail{i}-panel", (0.06, 0.7, 1.6), P(th, ro - 0.45, zt - 2.0), M["steel"], rot=(0, 0, th + 90))
            if tiers:
                railbar(f"rail{i}-rod", [P(th, ro, zt - 2.2), P(th, fd + 0.1, 1.2)], 0.07)


def plinth5(lv):
    """Level 5's steel plinth under the drum: a low octagon."""
    dr, dz0, _ = lv["drum"]
    corners = [(4.1 * math.cos(math.radians(22.5 + 45 * k)), 4.1 * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
    pts = rounded_poly(corners, 0.4, 4)
    bm = bmesh.new()
    zb, zt = lv.get("plinth_z", dz0 - 1.5), dz0
    bot = [bm.verts.new((x, y, zb)) for x, y in pts]
    top = [bm.verts.new((x * 0.97, y * 0.97, zt)) for x, y in pts]
    n = len(pts)
    for k in range(n):
        bm.faces.new((bot[k], bot[(k + 1) % n], top[(k + 1) % n], top[k]))
    bm.faces.new(top)
    bm.faces.new(bot[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("plinth", bm, [M["steel"]], smooth=False, bevel=0.06)


def level5():
    lv = S.LV[5]
    body_dome(lv)
    plinth5(lv)
    for i, th in enumerate(lv["feet"]):
        foot5(i, th, lv["foot_d"], 1.6)
    rails5(lv)


def tiers6(lv):
    """Level 6's two perforated steel tiers: rounded bands (they bulge like tyres) with gold rims, the lower one sitting
    in a gold bowl that the feet hold up."""
    (r1, z1a, z1b), (r2, z2a, z2b) = lv["tiers"]
    def bulge(r, za, zb, out):
        return [(r - out * 0.6 - 0.12, zb), (r - out * 0.6, zb)] +             [(r - out * 0.6 + out * math.sin(math.pi * k / 12), zb - (zb - za) * k / 12) for k in range(1, 12)] +             [(r - out * 0.6, za), (r - out * 0.6 - 0.12, za)]
    lathe("tier-lo", bulge(r2, z2a, z2b, 0.16), (0, 0, 0), M["perf_t"], verts=128)
    disc("tier-lo-top", r1 - 0.3, r2 - 0.2, z2b + 0.02, M["tiertop"], thick=0.1)
    ring("tier-lo-rim2", r2 - 0.2, 0.08, M["gold"], z=z2b, n=96)
    # the gold bowl under the lower tier
    lathe("tier-bowl", [(r2 + 0.22, z2a + 0.12), (r2 + 0.3, z2a - 0.02), (r2 + 0.05, z2a - 0.35), (r2 - 0.6, z2a - 0.62),
                        (2.0, z2a - 0.75), (0.01, z2a - 0.76)], (0, 0, 0), M["gold"], verts=128)
    ring("tier-lo-rim", r2 + 0.22, 0.22, M["gold"], z=z2a + 0.12, n=128)
    lathe("tier-hi", bulge(r1, z1a, z1b, 0.14), (0, 0, 0), M["perf_hi"], verts=128)
    disc("tier-hi-top", 0.0, r1 - 0.25, z1b + 0.02, M["tiertop"], thick=0.08)
    ring("tier-hi-rim", r1 + 0.05, 0.2, M["gold"], z=z1a + 0.08, n=96)
    ring("tier-hi-rim2", r1 - 0.2, 0.06, M["gold"], z=z1b, n=96)


def level6():
    lv = S.LV[6]
    body_dome(lv)
    tiers6(lv)
    for i, th in enumerate(lv["feet"]):
        foot5(i, th, lv["foot_d"], lv["tiers"][1][1] - 0.4, big=True)
    rails5(lv, lv["tiers"])


def star(name, at, r_out, r_in, n, h, mat, rot=0.0):
    """A flat gold star (a spiky foot): n points, lying on the ground at `at`, a low dome in its middle."""
    bm = bmesh.new()
    vs = []
    for k in range(2 * n):
        a = math.radians(rot) + math.pi * k / n
        rr = r_out if k % 2 == 0 else r_in
        vs.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), 0.0)))
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += h
        v.co.x *= 0.9
        v.co.y *= 0.9
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [mat], smooth=False, bevel=0.04, segs=2)
    ob.location = at
    lathe(name + "-boss", [(r_in * 0.85, 0.0), (r_in * 0.8, h + 0.15), (r_in * 0.55, h + 0.4), (0.3, h + 0.5),
                           (0.01, h + 0.52)], at, mat, verts=32)
    return ob


def ball(name, at, r, mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=r)
    ob = mesh_ob(name, bm, [mat])
    ob.location = at
    return ob


def crown(z, h=1.6):
    """Level 7's gold crown round the funnel's spout: a gold ring on the dome's top with four clasps rising to a
    collar under the cone."""
    lathe("crown", [(1.15, z - 0.3), (1.25, z), (1.2, z + 0.3), (1.0, z + 0.4), (0.7, z + 0.42)], (0, 0, 0), M["gold"],
          verts=48)
    for k in range(4):
        th = S.FRONT + 45 + 90 * k
        tube(f"crown-clasp{k}", [P(th, 1.0, z + 0.3), P(th, 0.85, z + 0.8), P(th, 0.55, z + h - 0.2), P(th, 0.42, z + h)],
             0.14, M["gold"], smooth=True)
    lathe("crown-top", [(0.38, z + h - 0.15), (0.62, z + h - 0.05), (0.6, z + h + 0.12), (0.36, z + h + 0.18),
                        (0.24, z + h + 0.16)],
          (0, 0, 0), M["gold"], verts=32)


def bend_path(a, corner, b, rad, n=8):
    """Points from a to b turning at `corner` round a bend of radius rad (a pipe's elbow)."""
    a, c, b = Vector(a), Vector(corner), Vector(b)
    d1, d2 = (a - c).normalized(), (b - c).normalized()
    half = d1.angle(d2) / 2
    dist = min(rad / max(1e-3, math.tan(half)), (a - c).length * 0.95, (b - c).length * 0.95)
    p1, p2 = c + d1 * dist, c + d2 * dist
    out = [a]
    for k in range(n + 1):
        t = k / n
        q = (1 - t) ** 2 * p1 + 2 * (1 - t) * t * c + t * t * p2
        out.append(q)
    out.append(b)
    return out


def gold_pipe(i, th, lv, el=70.0, r_v=5.3, th_dome=None, sleeve=True, z_end=None):
    """Level 7's gold pipe: out of the crown, down the dome's surface along a meridian, an elbow (with a sleeve) out at
    the dome's foot, then straight down beside the drum onto the lower tier."""
    rr, zeq = lv["dome"]
    fl = lv.get("dome_flat", 1.0)
    rp = lv.get("pipe_r", 0.5)
    z_end = lv["tiers"][1][2] if z_end is None else z_end
    td = th if th_dome is None else th_dome      # the front pair runs down the dome's sides, as Flash draws them
    pts = [on_dome(rr, zeq, td + (th - td) * k / 8, e, fl, rp - 0.05)[0] for k, e in enumerate((el, el - 12, el - 24, el - 36, el - 46))]
    low = pts[-1]
    corner = P(th, r_v, low.z - 0.25)
    pts = pts[:-1] + bend_path(low, corner, P(th, r_v, z_end - 0.1), 1.0, n=10)
    tube(f"pipe{i}", pts, rp, M["gold"], verts=20)
    # the sleeve at the elbow, and a flange where it stands on the tier
    q = bend_path(low, corner, P(th, r_v, z_end), 1.0, n=10)[6]
    if sleeve:
        cyl(f"pipe{i}-sleeve", rp + 0.16, 0.7, q + Vector((0, 0, -0.35)), M["gold"], verts=28, bevel=0.06)
    cyl(f"pipe{i}-foot", rp + 0.22, 0.3, P(th, r_v, z_end), M["gold"], verts=24, r2=rp + 0.04)
    return q


def scroll(name, q, s, rp):
    """A gold curl on a front pipe's elbow (Flash's ram-horn scroll): it leaves the pipe's outer side, rises, rolls out
    and down and curls back in, in the plane facing the camera."""
    u = Vector(P(S.FRONT + 90, 1.0, 0.0)) * s
    w = Vector((0.0, 0.0, 1.0))
    c = q + u * (rp + 0.4) + w * 0.15
    pts = []
    for k in range(40):
        t = k / 39
        a = t * 2 * math.pi * 1.35
        rad = 0.88 * (1 - 0.68 * t)
        pts.append(c + rad * (-math.cos(a) * u + math.sin(a) * w))
    tube(name, pts, 0.3, M["gold"], verts=16, r_end=0.13, smooth=True)


def level7(eight=False):
    lv = S.LV[8 if eight else 7]
    body_dome(lv)
    tiers6(lv)
    (r1, z1a, z1b), (r2, z2a, z2b) = lv["tiers"]
    fd = lv["foot_d"]
    for i, th in enumerate(lv["feet"]):
        star(f"foot{i}-star", P(th, fd, 0.0), 1.9, 1.15, 11, 0.32, M["gold"], rot=th * 1.7)
        lathe(f"foot{i}-vase", [(0.5, 0.75), (0.24, 1.0), (0.2, z2a - 0.9), (0.45, z2a - 0.45), (0.8, z2a - 0.2),
                                (0.75, z2a - 0.1)], P(th, fd, 0.0), M["gold"], verts=32)
    fl = lv.get("dome_flat", 1.0)
    crown(lv["dome"][1] + lv["dome"][0] * fl, lv["fun_z"] - lv["dome"][1] - lv["dome"][0] * fl)
    # the front pair runs down the dome's sides; the back pair down its outline at the far sides, as Flash draws them
    elbows = []
    for k, th in enumerate(lv["pipes"]):
        if k < 2:
            elbows.append(gold_pipe(k, th, lv, th_dome=th + (25.0 if th > S.FRONT else -25.0)))
        else:
            tb = th - 35.0 if th > S.FRONT else th + 35.0
            elbows.append(gold_pipe(k, tb, lv, r_v=4.75, th_dome=tb, sleeve=False, z_end=lv["tiers"][0][2]))
    rp = lv.get("pipe_r", 0.5)
    for k, q in enumerate(elbows[:2]):         # the curls on the front pipes' elbows
        scroll(f"pipe{k}-curl", q, -1 if lv["pipes"][k] < S.FRONT else 1, rp)
    rails5(lv, lv["tiers"], sides=False, diag=False, front=False)
    # the red rails: a post with knobs at each side, a bar down the front, two curved arms to the front pipes
    dr, dz0, _ = lv["drum"]
    for k, th in enumerate((S.FRONT - 90, S.FRONT + 90)):
        ro = fd + 1.05
        railbar(f"rail{k}", [P(th, dr - 0.1, dz0 + 0.7), P(th, ro, dz0 + 0.7), P(th, ro, 0.4)], 0.25)
        ball(f"rail{k}-k1", P(th, ro, dz0 + 0.7), 0.46, M["red"])
        ball(f"rail{k}-k2", P(th, ro, z2a + 0.5), 0.42, M["red"])
        ball(f"rail{k}-k3", P(th, ro, 0.45), 0.36, M["red"])
    # Flash's thick red pipe down the front: out of the drum, over both tiers' edges, down to the front foot's star
    F = S.FRONT
    top = [P(F, dr + 0.15, dz0 + 3.0), P(F, dr + 0.3, dz0 + 0.5)] if not eight else [P(F, dr + 0.1, dz0 + 0.35)]
    railbar("rail8", top + [P(F, r1 + 0.3, z1b - 0.1), P(F, r2 + 0.35, z2b - 0.1), P(F, r2 + 0.35, 0.3)], 0.3)
    if not eight:                               # level 8 opens the drum's front, the pipe starts below the slot
        cyl("rail8-flange", 0.5, 0.3, P(F, dr + 0.05, dz0 + 2.8), M["red"], rot=(0, 90, F), verts=24)
    ball("rail8-k1", P(F, r2 + 0.35, z2b - 0.1), 0.44, M["red"])
    ball("rail8-k2", P(F, r2 + 0.35, 0.45), 0.42, M["red"])
    # two thick red pipes from the drum down and out over the tiers to a red knob on the lower tier's edge
    for k, s_ in enumerate((-1, 1)):
        a, b = F + 18 * s_, F + 33 * s_
        top = [P(a, dr + 0.1, dz0 + 2.4), P(a, dr + 0.4, dz0 + 1.4)]
        if eight:                               # level 8: they run down the drum's sides from under the dome first
            a, b = F + 32 * s_, F + 35 * s_
            top = [P(a, dr + 0.12, lv["drum"][2] - 0.1), P(a, dr + 0.14, dz0 + 1.6), P(a, dr + 0.45, dz0 + 0.8)]
        railbar(f"rail{9 + k}", top + [P((a + b) / 2, r1 + 0.25, z1b + 0.1), P(b, r2 - 0.05, z2b + 0.35)], 0.3 if eight else 0.27)
        ball(f"rail{9 + k}-k", P(b, r2 - 0.05, z2b + 0.35), 0.42, M["red"])
    for k, q in enumerate(elbows[:2]):         # red collars round the front pipes' elbows
        ring(f"rail{5 + k}-collar", rp + 0.26, 0.13, M["red"], z=0.0).location = q + Vector((0, 0, 0.1))
    # two curved red arms from the drum to the front pipes, a red collar round each pipe
    for k, tp in enumerate(lv["pipes"][:2]):
        ring(f"rail{3 + k}-collar", rp + 0.1, 0.14, M["red"], z=0.0).location = P(tp, 5.3, z1a + 0.3)
    if eight:
        # level 8: red drips from the dome's foot, the drum's front opened (a dark slot between gold edges)
        box("slot", (0.12, 1.9, lv["drum"][2] - dz0 - 0.1), P(S.FRONT, dr + 0.03, dz0), M["hole"], rot=(0, 0, S.FRONT), bevel=0.0)
        for s_ in (-1, 1):
            strap(f"slot-edge{s_ + 1}", S.FRONT + s_ * 17, dr - 0.02, dz0, lv["drum"][2], w=0.36, rivets=6)
        # a gold lip round the dome's foot, and red drips running from under it down the drum
        rr, zeq = lv["dome"]
        ring("dome-goldlip", rr + 0.1, 0.17, M["gold"], z=zeq + 0.05, n=96)
        zt = lv["drum"][2]
        for k, (th, ln) in enumerate(((-104.0, 2.8), (14.0, 2.8), (-118.0, 1.4), (28.0, 1.4))):
            tube(f"drip{k}", [P(th, dr + 0.14, zt - 0.05), P(th, dr + 0.2, zt - ln * 0.6), P(th, dr + 0.24, zt - ln)], 0.24,
                 M["red"], r_end=0.12)


def sheet(name, half, z_of, mat, n=40, rot=0.0, thick=0.05):
    """A square sheet (cloth or bent metal) of half-width `half` turned by rot degrees, its height z_of(x, y) in world."""
    bm = bmesh.new()
    a = math.radians(rot)
    grid = []
    for i in range(n + 1):
        row = []
        for j in range(n + 1):
            u, v = -half + 2 * half * i / n, -half + 2 * half * j / n
            x, y = u * math.cos(a) - v * math.sin(a), u * math.sin(a) + v * math.cos(a)
            row.append(bm.verts.new((x, y, z_of(x, y))))
        grid.append(row)
    for i in range(n):
        for j in range(n):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    ob = mesh_ob(name, bm, [mat])
    mo = ob.modifiers.new("solid", "SOLIDIFY")
    mo.thickness = thick
    mo.offset = 1.0
    return ob


def rhombus(name, hu, hv, shape, mat, thick, n=48):
    """A sheet shaped as a rhombus: corners hu out to the screen left and right (bearings FRONT -/+ 90), hv to the
    front and back. shape(u, v, q) -> (q, z) places each point (q: its spot on the ground)."""
    R, F = P(S.FRONT + 90, 1, 0), P(S.FRONT, 1, 0)
    bm = bmesh.new()
    grid = []
    for a in range(n + 1):
        row = []
        for b in range(n + 1):
            s_, t_ = -1 + 2 * a / n, -1 + 2 * b / n
            u, v = hu * (s_ + t_) / 2, hv * (s_ - t_) / 2
            q, z = shape(u, v, R * u + F * v)
            row.append(bm.verts.new((q.x, q.y, z)))
        grid.append(row)
    for a in range(n):
        for b in range(n):
            bm.faces.new((grid[a][b], grid[a + 1][b], grid[a + 1][b + 1], grid[a][b + 1]))
    ob = mesh_ob(name, bm, [mat])
    mo = ob.modifiers.new("solid", "SOLIDIFY")
    mo.thickness = thick
    mo.offset = 1.0
    return ob


def hexnut(name, at, r, h, mat, rot=0.0):
    ob = cyl(name, r, h, at, mat, verts=6, bevel=0.05, rot=(0, 0, rot))
    cyl(name + "-hole", r * 0.42, h + 0.04, Vector(at) - Vector((0, 0, 0.02)), M["hole"], verts=16, bevel=0.0)
    return ob


def bolt_leg(i, th, r_out, z_clamp, can_r, foot_d=None, foot=None):
    """Level 1's leg: a rod out of the can into a yellow clamp block, a bolt down from it to a yellow hex nut."""
    fd = foot_d or r_out
    tube(f"leg{i}-rod", [P(th, can_r - 0.1, z_clamp + 0.1), P(th, r_out + 0.75, z_clamp + 0.1)], 0.13, M["steel"], verts=12)
    box(f"leg{i}-clamp", (0.85, 0.85, 0.85), P(th, r_out, z_clamp - 0.35), M["yellow"], rot=(0, 0, th), bevel=0.08)
    tube(f"leg{i}-bolt", [P(th, r_out, z_clamp - 0.3), P(th, fd, 0.35)], 0.16, M["steel"], verts=12)
    (foot or hexnut)(f"leg{i}-nut", P(th, fd, 0.0), 0.5, 0.36, M["yellow"], rot=th + 15)


def level1():
    lv = S.LV[1]
    cr, cz0, cz1 = lv["can"]
    ribbed("can", cr, cz0, cz1, pitch=0.42, depth=0.15)
    # a bent steel strip up the right side of the can (Flash's lighter seam)
    box("can-strip", (0.12, 0.7, cz1 - cz0 - 0.4), P(10.0, cr + 0.04, cz0 + 0.1), M["steel"], rot=(0, 0, 10.0), bevel=0.03)
    for i, th in enumerate(lv["legs"]):
        bolt_leg(i, th, lv["leg_r"], lv["leg_z"], cr, lv["foot_d"])
    # the leather sheet thrown over the top, gathered round the funnel's spout and tied: a stiff sheet, its left and
    # right corners sticking out, its front and back corners hanging down over the can's rim
    zb, zr = lv["bundle_z"], cz1 + 0.05
    def drape(u, v, q):
        d = q.length
        ph = math.atan2(q.y, q.x)
        if d < 0.45:
            z = zb
        elif d < cr + 0.05:
            f = (d - 0.45) / (cr + 0.05 - 0.45)
            z = zr + (zb - zr) * (1 - f ** 2.2) ** 0.6                       # a tent spreading from the tie (Flash)
            z += 0.22 * math.sin(7 * ph + 0.6) * (1 - f) * min(1.0, 3 * f)  # the gathers under the tie
        else:
            e = d - cr - 0.05
            w = math.sin(ph - math.radians(S.FRONT)) ** 2                  # 1 toward the side corners
            dd = cr + 0.08 + e * (w + (1 - w) * 0.15)
            q = q * (dd / d)
            z = zr - 0.06 - e * ((1 - w) * 1.5 + w * 0.22)
        return q, z + 0.05 * math.sin(3.1 * q.x + 1.3) * math.sin(2.7 * q.y)
    rhombus("cloth", *lv["cloth_half"], drape, M["leather"], 0.06)
    # the gathered top: the cloth's neck flares out above the tie in crumpled folds round the spout
    bm = bmesh.new()
    rows = []
    for a in range(7):
        t = a / 6
        row = []
        for b in range(48):
            ph = 2 * math.pi * b / 48
            r = 0.5 + 0.55 * t + 0.2 * t * math.sin(6 * ph + 1.0) + 0.1 * t * math.sin(11 * ph)
            row.append(bm.verts.new((r * math.cos(ph), r * math.sin(ph), zb - 0.1 + 1.0 * t + 0.4 * t * math.sin(5 * ph + 0.4))))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        for b in range(48):
            bm.faces.new((ra[b], ra[(b + 1) % 48], rb[(b + 1) % 48], rb[b]))
    ob = mesh_ob("cloth-ruff", bm, [M["leather"]])
    mo = ob.modifiers.new("solid", "SOLIDIFY")
    mo.thickness = 0.06
    mo.offset = 1.0
    lathe("cloth-tie", [(0.52, zb - 0.25), (0.6, zb - 0.1), (0.56, zb + 0.08), (0.42, zb + 0.18)], (0, 0, 0),
          M["string"], verts=24)
    box("cloth-tag", (0.06, 0.9, 0.55), P(S.FRONT, 0.62, zb - 0.75), M["tag"], rot=(0, 8, S.FRONT), bevel=0.02)
    # dark cloth flaps sticking out of the bundle behind the funnel (Flash), their feet in the ruff
    flap = painted("flap", (46, 42, 40), rough=0.85, wear=(76, 70, 66), scale=3.0)
    for k, (th, w, h, tilt) in enumerate(((S.FRONT + 120.0, 1.1, 2.0, 32.0), (S.FRONT - 125.0, 0.9, 1.7, 26.0))):
        box(f"cloth-flap{k}", (0.06, w, h), P(th, 0.62, zb + 0.15), flap, rot=(0, tilt, th), bevel=0.02, bow=0.3)
    # Flash's darker fold down the cloth's right slope, from under the tie out to the right corner, narrowing
    bm = bmesh.new()
    rows = []
    for a in range(13):
        t = a / 12
        d = 0.75 + 3.7 * t
        half = 36.0 * (1 - 0.75 * t)
        row = []
        for b in range(7):
            ph = math.radians(S.FRONT + 84.0 + half * (b / 3 - 1) - 10.0 * t)
            q, z = drape(0, 0, Vector((d * math.cos(ph), d * math.sin(ph), 0.0)))
            row.append(bm.verts.new((q.x, q.y, z + 0.13)))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        for b in range(6):
            bm.faces.new((ra[b], ra[b + 1], rb[b + 1], rb[b]))
    ob = mesh_ob("cloth-fold", bm, [painted("fold", (36, 28, 24), rough=0.9, wear=(60, 46, 38), scale=3.0)])
    mo = ob.modifiers.new("solid", "SOLIDIFY")
    mo.thickness = 0.05
    mo.offset = 1.0
    funnel(lv["fun_z"], None, k=lv["fun_k"], extra=lv["fun_extra"])
    # paper clips on the tie, left and right
    # a chain of silver links round the neck over the tie, two binder clips with their wire handles up
    rn = 0.74
    for k in range(20):
        a = 360.0 * k / 20
        c = P(a, rn, zb + 0.22)
        t = P(a + 90, 1, 0)
        o = P(a, 1, 0) if k % 2 else Vector((0, 0, 1))
        tube(f"chain{k}", [c + t * 0.13 * math.cos(math.radians(u)) + o * 0.07 * math.sin(math.radians(u))
                           for u in range(0, 360, 30)], 0.03, M["chrome"], verts=6, cyclic=True)
    for k, th in enumerate((S.FRONT - 88, S.FRONT + 88)):
        c = P(th, 0.9, zb + 0.3)
        box(f"clip{k}", (0.3, 0.55, 0.5), c, M["core"], rot=(0, 0, th), origin="centre", bevel=0.04)
        for j, sg in enumerate((-1, 1)):
            b0 = c + P(th + 90, 0.2 * sg, 0) + Vector((0, 0, 0.22))
            o = b0 + P(th, 0.55, 0) + Vector((0, 0, 0.75))
            tube(f"clip{k}-wire{j}", [b0, o, o + P(th + 90, -0.18 * sg, 0)], 0.035, M["chrome"])
    # the magnifying glass leant against the front, lens down, handle up
    lc = P(lv["mag_th"], cr + 0.82, lv["mag_z"])
    n = (P(lv["mag_th"], 1, 0) + Vector((0, 0, 0.25))).normalized()
    porthole("mag", lc, n, lv["mag_r"], frame=0.1, mat_ring=M["chrome"])
    up = Vector((0, 0, 1)) - n * n.z
    side = n.cross(up).normalized()
    hdir = (up.normalized() * 0.9 + side * lv["mag_lean"] + n * 0.3).normalized()
    a = lc + hdir * (lv["mag_r"] + 0.05)
    tube("mag-neck", [a, a + hdir * 0.5], 0.09, M["chrome"])
    tube("mag-handle", [a + hdir * 0.45, a + hdir * lv["mag_len"]], 0.22, M["handle"], r_end=0.27)


def magnifier(name, c, n, rr, hdir, length):
    """A magnifying glass: a chrome ring and lens facing n, a neck and a black handle along hdir."""
    porthole(name, c, n, rr, frame=0.1, mat_ring=M["chrome"])
    a = c + hdir * (rr + 0.05)
    tube(name + "-neck", [a, a + hdir * 0.5], 0.09, M["chrome"])
    tube(name + "-handle", [a + hdir * 0.45, a + hdir * length], 0.22, M["handle"], r_end=0.27)


def horseshoe(name, c, th, h, rad=0.75, w=0.36):
    """A red horseshoe magnet standing against the can at bearing th, its bend at c, legs hanging h, steel tips."""
    side = P(th + 90, 1, 0)
    pts = [c + side * rad + Vector((0, 0, -h))]
    for k in range(13):
        a = math.pi * k / 12
        pts.append(c + side * (rad * math.cos(a)) + Vector((0, 0, rad * math.sin(a))))
    pts.append(c - side * rad + Vector((0, 0, -h)))
    sweep(name, pts, P(th, 1, 0), w, w * 0.9, M["red"], bevel=0.05)
    for k, sg in enumerate((1, -1)):
        box(f"{name}-tip{k}", (w * 0.95, w * 1.05, 0.4), c + side * (sg * rad) + Vector((0, 0, -h - 0.38)), M["steel"],
            rot=(0, 0, th), bevel=0.04)


def bracket_leg(i, th, d, z0, z1, can_r):
    """Level 2's leg: a steel post on a gold gear, two steel plates out from the can, a gold nut on each."""
    gear(f"leg{i}-gear", 0.95, 12, 0.3, P(th, d, 0.15), M["gold"], (0, 0, math.radians(th)), tooth=0.2)
    cyl(f"leg{i}-post", 0.16, z1 - 0.3, P(th, d, 0.3), M["steel"], verts=12)
    for k, z in enumerate((z0, z1)):
        a, b = P(th, can_r - 0.1, z), P(th, d + 0.45, z)
        box(f"leg{i}-plate{k}", ((b - a).length, 0.9, 0.1), (a + b) / 2, M["steel"], rot=(0, 0, th), bevel=0.02,
            origin="centre")
        box(f"leg{i}-flange{k}", (0.1, 0.9, 0.55), P(th, d + 0.45, z - 0.5), M["steel"], rot=(0, 0, th), bevel=0.02)
        cyl(f"leg{i}-nut{k}", 0.32, 0.18, P(th, d + 0.5, z - 0.25), M["gold"], rot=(0, 90, th), verts=6)


def binder(name, at, th, s=1.0):
    """A black binder clip with chrome wire arms (s: its size)."""
    box(name, (0.7 * s, 0.9 * s, 0.55 * s), at, M["handle"], rot=(0, 0, th), bevel=0.05)
    side = P(th + 90, 1, 0)
    for k, sg in enumerate((1, -1)):
        b = at + side * (sg * 0.3 * s) + Vector((0, 0, 0.55 * s))
        tube(f"{name}-arm{k}", [b, b + Vector((0, 0, 0.5 * s)) + P(th, 0.3 * s, 0), b + Vector((0, 0, 0.7 * s)) + P(th, 0.1 * s, 0)],
             0.035 * s, M["chrome"])


def level2():
    lv = S.LV[2]
    cr, cz0, cz1 = lv["can"]
    ribbed("can", cr, cz0, cz1, pitch=0.42, depth=0.15)
    lathe("can-pan", [(cr - 0.2, cz0 - 0.5), (cr + 0.12, cz0 - 0.45), (cr + 0.16, cz0 + 0.3), (cr + 0.05, cz0 + 0.35)],
          (0, 0, 0), M["tin"], verts=64)
    strap("can-strap", S.FRONT + 3, cr, cz0 + 0.2, cz1 - 0.6, w=0.55, rivets=3)
    for i, th in enumerate(lv["legs"]):
        bracket_leg(i, th, lv["leg_d"], cz0 + 0.6, cz1 - 0.2, cr)
    # the roof: the level 1 sheet's shape in brown sheet metal, a low pyramid, a flat top round the spout
    zt, ze = lv["roof_z"]
    hu, hv = lv["roof_half"]

    def roof_z(u, v):
        # Flash's roof is a mansard: a broad gently sloping top, then steep sides that flatten out into the hem
        m = abs(u) / hu + abs(v) / hv
        p0 = lv["roof_plateau"]
        if m < p0:
            return zt - 0.35 * m / p0 + lv.get("roof_lift", 0.0) * max(0.0, 0.25 * u / hu - v / hv) * m
        z = zt - 0.35 - (zt - 0.35 - ze) * min(1.0, (m - p0) / (1.0 - p0)) ** 0.75
        return z + lv.get("roof_lift", 0.0) * max(0.0, 0.25 * u / hu - v / hv) * min(1.0, m)   # Flash: the back right rises

    rhombus("roof", hu, hv, lambda u, v, q: (q, roof_z(u, v)), M["dome"], 0.1, n=40)
    lathe("roof-top", [(0.75, zt - 0.1), (0.75, zt + 0.25), (0.45, zt + 0.3)], (0, 0, 0), M["steel"], verts=32)
    # the porthole on the front-left face, two screws
    def roof_pt(u, v, out=0.1):
        q = P(S.FRONT + 90, u, 0) + P(S.FRONT, v, 0)
        p0 = Vector((q.x, q.y, roof_z(u, v)))
        pu = P(S.FRONT + 90, u + 0.05, 0) + P(S.FRONT, v, 0)
        pv = P(S.FRONT + 90, u, 0) + P(S.FRONT, v + 0.05, 0)
        a = Vector((pu.x, pu.y, roof_z(u + 0.05, v))) - p0
        b = Vector((pv.x, pv.y, roof_z(u, v + 0.05))) - p0
        n = a.cross(b).normalized()
        if n.z < 0:
            n = -n
        return p0 + n * out, n
    pp, nrm = roof_pt(-2.2, 1.5, 0.12)
    porthole("roof-port", pp, nrm, 1.12, frame=0.12, mat_ring=M["chrome"])
    studs("roof-screws", [roof_pt(-3.5, 0.5, 0.12), roof_pt(-0.25, 3.0, 0.12)], 0.2, M["rivet"])
    funnel(zt - 0.2, None, k=lv["fun_k"], extra=lv["fun_extra"])
    binder("clip0", P(S.FRONT - 75, 2.2, roof_z(-2.12, 0.57) - 0.05), S.FRONT - 75, s=1.6)
    binder("clip1", P(S.FRONT + 105, 2.2, roof_z(2.13, -0.57) - 0.05), S.FRONT + 105, s=1.6)
    # the magnet on the can's front left, the magnifier leant on the roof's front right, handle down
    horseshoe("magnet", P(lv["mag_th"], cr + 0.3, lv["magnet_z"]), lv["mag_th"], 2.0, rad=0.85, w=0.5)
    th = lv["glass_th"]
    c = P(th, lv["glass_d"], lv["glass_z"])
    n = (P(th, 1, 0) * math.cos(math.radians(30)) + Vector((0, 0, math.sin(math.radians(30))))).normalized()
    magnifier("glass", c, n, 1.2, (Vector((0, 0, -1)) + P(th, 0.5, 0)).normalized(), 3.0)


def hood_pt(r, zeq, th, el, flat_=1.0, drop=0.0, flare=0.0, sq=(1.0, 1.0), out=0.0):
    """A point on level 3's hood (as hood() builds it) and its outward normal."""
    def at(t, e):
        e = min(max(e, 0.0), 89.9)
        f = 1 - e / 90.0
        rel = abs(((t - S.FRONT + 180) % 360) - 180)
        dz = -drop * (1 - math.cos(math.radians(min(90.0, rel)))) * f if drop else 0.0
        rf = r * math.cos(math.radians(e)) ** sq[0] + flare * f ** 3
        return Vector((rf * math.cos(math.radians(t)), rf * math.sin(math.radians(t)),
                       zeq + dz + r * flat_ * math.sin(math.radians(e)) ** sq[1]))
    p = at(th, el)
    n = (at(th + 1.0, el) - at(th - 1.0, el)).cross(at(th, el + 1.0) - at(th, el - 1.0)).normalized()
    return p + n * out, n


def hood(name, r, zeq, cut_half, cut_el, flat_=1.0, drop=0.0, flare=0.0, sq=(1.0, 1.0)):
    """Level 3's hood: the level 2 roof bent round into a dome shell (height r * flat_ above zeq, its rim dropping
    `drop` lower at the sides), with an arched opening at the front (cut_half degrees either side, up to cut_el)."""
    bm = bmesh.new()
    nu, nv = 192, 48
    rows = []
    for j in range(nv + 1):
        e = math.radians(90.0 * j / nv)
        rf = r * max(0.0, math.cos(e)) ** sq[0] + flare * (1 - j / nv) ** 3    # a bell: the rim flares out
        row = []
        for i in range(nu):
            a = 2 * math.pi * i / nu
            rel = abs(((math.degrees(a) - S.FRONT + 180) % 360) - 180)
            dz = -drop * (1 - math.cos(math.radians(min(90.0, rel)))) * (1 - j / nv) if drop else 0.0
            row.append(bm.verts.new((rf * math.cos(a), rf * math.sin(a), zeq + dz + r * flat_ * math.sin(e) ** sq[1])))
        rows.append(row)
    for j in range(nv):
        for i in range(nu):
            a = 2 * math.pi * (i + 0.5) / nu
            rel = abs(((math.degrees(a) - S.FRONT + 180) % 360) - 180)
            el = 90.0 * (j + 0.5) / nv
            arch = cut_el * math.sqrt(max(0.0, 1 - (rel / cut_half) ** 2)) if rel < cut_half else -1
            if el < arch:
                continue
            k = (i + 1) % nu
            bm.faces.new((rows[j][i], rows[j][k], rows[j + 1][k], rows[j + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=rows[-1], dist=1e-4)
    ob = mesh_ob(name, bm, [M["hood"]])
    mo = ob.modifiers.new("solid", "SOLIDIFY")
    mo.thickness = 0.14
    mo.offset = -1.0
    return ob


def octagon_rail(name, r, z, w, h, mat, n=8, rot=22.5):
    pts = [P(rot + 360.0 * k / n, r, z) for k in range(n)]
    return sweep(name, pts, (0, 0, 1), h, w, mat, bevel=0.03, closed=True)


def level3():
    lv = S.LV[3]
    hr, hz = lv["hood"]
    # the base pan, the core, the hood over it
    pr, pz0, pz1 = lv["pan"]
    lathe("pan", [(0.01, pz0 - 0.05), (pr - 0.6, pz0 - 0.05), (pr - 0.1, pz0 + 0.2), (pr, pz0 + 0.6), (pr, pz1),
                  (pr - 0.15, pz1 + 0.05), (0.01, pz1 + 0.05)], (0, 0, 0), M["steel"], verts=96)
    ring("pan-rim", pr + 0.02, 0.1, M["gold"], z=pz1, n=96)
    ring_rivets("pan-bolts", pr + 0.01, (pz0 + pz1) / 2 + 0.2, 16, rr=0.17)
    cr = lv["core_r"]
    ribbed("core", cr, pz1, hz + 0.6, pitch=0.42, depth=0.12)
    box("core-vent", (0.4, 1.3, 1.0), P(S.FRONT, cr + 0.05, hz - 1.2), M["steel"], rot=(0, 0, S.FRONT), bevel=0.05)
    for k in range(3):
        box(f"core-vent{k}", (0.06, 1.1, 0.12), P(S.FRONT, cr + 0.26, hz - 1.05 + 0.3 * k), M["hole"],
            rot=(0, 0, S.FRONT), bevel=0.0)
    hk = dict(flat_=lv["hood_flat"], drop=lv["hood_drop"], flare=lv["hood_flare"], sq=lv.get("hood_sq", (1.0, 1.0)))
    hood("hood", hr, hz, lv["cut"][0], lv["cut"][1], **hk)
    disc("hood-floor", cr + 0.05, hr - 0.15, hz + 0.6, M["hood"], thick=0.1)
    # bolted gold corner pieces bent over the hood's rim (Flash), two bolts each
    for k, th in enumerate(lv.get("hood_corners", ())):
        rel = abs(((th - S.FRONT + 180) % 360) - 180)
        zr = hz - lv["hood_drop"] * (1 - math.cos(math.radians(min(90.0, rel))))
        ro = hr + lv["hood_flare"]
        box(f"hood-corner{k}", (0.3, 0.95, 1.0), P(th, ro - 0.1, zr - 0.15), M["gold"], rot=(0, 0, th), bevel=0.06)
        box(f"hood-corner{k}-lip", (0.6, 0.95, 0.16), P(th, ro - 0.3, zr - 0.15), M["gold"], rot=(0, 0, th), bevel=0.05)
        studs(f"hood-corner{k}-bolt", [(P(th + s_ * 6.0, ro + 0.06, zr + 0.35), Vector(P(th, 1.0, 0.0)))
                                       for s_ in (-1, 1)], 0.1, M["rivet"])
    for i, (th, el, rp) in enumerate(lv["holes"]):
        pp, n = hood_pt(hr, hz, th, el, **hk)
        porthole(f"port{i}", pp, n, rp, frame=0.12, mat_ring=M["chrome"])
    studs("hood-rvt", [hood_pt(hr, hz, th, el, out=0.02, **hk) for th, el in lv["hood_rivets"]], 0.13, M["gold"])
    ztop = hz + hr * lv["hood_flat"]
    lathe("collar", [(0.55, ztop - 0.3), (0.62, ztop + 0.05), (0.4, ztop + 0.12)], (0, 0, 0), M["dome"], verts=32)
    funnel(ztop - 0.1, None, k=lv["fun_k"], extra=lv["fun_extra"])
    # two magnets on gold brackets, either side of the opening
    for k, th in enumerate(lv["magnets"]):
        horseshoe(f"magnet{k}", P(th, cr + 1.75, lv["magnet_z"]), th, lv["magnet_z"] - pz1 - 0.75, rad=1.15, w=0.8)
        box(f"magnet{k}-shelf", (1.5, 2.6, 0.22), P(th, cr + 1.9, pz1 + 0.02), M["gold"], rot=(0, 0, th), bevel=0.04)
    # the gold rail round it all on eight legs with gear feet, struts from the pan
    rr, za, zb = lv["rail"]
    # a hexagon, a flat side to the front
    octagon_rail("rail-lo", rr, za, 0.12, 0.32, M["palegold"], n=6, rot=S.FRONT + 30)
    octagon_rail("rail-hi", rr, zb, 0.12, 0.32, M["palegold"], n=6, rot=S.FRONT + 30)
    for i in range(6):
        th = S.FRONT + 30 + 60 * i
        tube(f"rail-post{i}", [P(th, pr - 0.05, za - 0.4), P(th, rr, za - 0.4), P(th, rr, zb + 0.2)], 0.12, M["steel"],
             verts=12)
        box(f"rail-cap{i}", (0.4, 0.4, 0.3), P(th, rr, zb + 0.15), M["gold"], rot=(0, 0, th), bevel=0.05)
    for i in range(8):
        th = S.FRONT + 45 * i
        lv_d = lv["leg_d"]
        gear(f"leg{i}-gear", 0.95, 12, 0.3, P(th, lv_d, 0.15), M["rustgold"], (0, 0, math.radians(th)), tooth=0.2)
        tube(f"leg{i}-post", [P(th, lv_d, 0.3), P(th, lv_d, pz0 + 0.9), P(th, pr - 0.05, pz0 + 0.9)], 0.16,
             M["steel"], verts=12)
        cyl(f"leg{i}-knob", 0.24, 0.3, P(th, lv_d, pz0 + 0.75), M["gold"], verts=16)
    # the side frames: two pale gold uprights on the rail and a top bar leaning in to the hood's rim
    for k, th in enumerate(lv["frames"]):
        for j, dth in enumerate((-22.5, 22.5)):
            tube(f"rail-frame{k}{j}", [P(th + dth, rr, zb), P(th + dth, rr, lv["frame_z"])], 0.11, M["palegold"],
                 verts=10)
        tube(f"rail-frametop{k}", [P(th - 22.5, rr, lv["frame_z"]), P(th + 22.5, rr, lv["frame_z"])], 0.11,
             M["palegold"], verts=10)


def petal(name, rr, zeq, fl, th, out, el0=-6.0, el1=84.0, thick=0.1):
    """Level 4's raised dome plate centred on bearing th, `out` above the dome: narrow (+-23 deg) and rounded at its
    foot under the equator, widening over the top where it crosses its neighbours; a rolled rim and rivets along its
    edges."""
    def w(el):
        x = 23.0 + 0.014 * max(0.0, el - 25.0) ** 2
        if el < -2.0:
            x *= math.sqrt(max(0.0, 1.0 - ((-2.0 - el) / (-2.0 - el0 + 0.01)) ** 2)) * 0.6 + 0.4
        return x
    def fo(el):
        return 0.022 * max(0.0, 15.0 - el)
    nu, ne = 16, 40
    bm = bmesh.new()
    rows = []
    for j in range(ne + 1):
        el = el0 + (el1 - el0) * j / ne
        rows.append([bm.verts.new(on_dome(rr, zeq, th + w(el) * (-1 + 2 * i / nu), el, fl, out + fo(el))[0])
                     for i in range(nu + 1)])
    for j in range(ne):
        for i in range(nu):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [M["dome"]])
    mo = ob.modifiers.new("solid", "SOLIDIFY")
    mo.thickness = thick
    mo.offset = 0.0
    mo = ob.modifiers.new("bevel", "BEVEL")
    mo.width, mo.segments, mo.limit_method = 0.04, 2, "ANGLE"
    els = [el0 + (el1 - el0) * j / ne for j in range(ne + 1)]
    edge = ([on_dome(rr, zeq, th - w(e), e, fl, out + fo(e))[0] for e in els[::-1]] +
            [on_dome(rr, zeq, th + w(e), e, fl, out + fo(e))[0] for e in els])
    tube(name + "-rim", edge, 0.075, M["dome"], verts=8, smooth=True)
    pts = []
    for el in range(-3, 70, 9):
        for s_ in (-1, 1):
            pts.append(on_dome(rr, zeq, th + s_ * (w(el) - 4.0 / max(0.3, math.cos(math.radians(el)))), el, fl,
                               out + fo(el) + thick / 2))
    for b in range(-12, 13, 12):
        pts.append(on_dome(rr, zeq, th + b, -4.0, fl, out + fo(-4.0) + thick / 2))
    studs(name + "-rvt", pts, 0.1, M["rivet"])
    return ob


def level4():
    """The hood grown into a full dome of four riveted panels on a tall ribbed drum."""
    lv = S.LV[4]
    dr, dz0, dz1 = lv["drum"]
    rr, zeq = lv["dome"]
    fl = lv["dome_flat"]
    ribbed("drum", dr, dz0, dz1 + 0.05, pitch=0.56, depth=0.22)
    # the dome, flattened, under four raised petal plates (centred on the portholes and the back quarters) whose edges
    # arch up from the drum and cross at the top; the dome shows in the gaps at the quarters as a riveted tongue
    prof = [(rr + 0.08, zeq - 0.12), (rr + 0.1, zeq), (rr, zeq + 0.02)]
    for k in range(1, 25):
        a = math.radians(90 * k / 24)
        prof.append((max(0.001, rr * math.cos(a)), zeq + rr * fl * math.sin(a)))
    lathe("dome", prof, (0, 0, 0), M["dome"], verts=96)
    disc("dome-floor", 0.0, rr, zeq, M["dome"], thick=0.15)
    pet = lv["petals"]
    for k, (th, out) in enumerate(pet):
        petal(f"petal{k}", rr, zeq, fl, th, out)
    skip = []
    for i, (th, el, rp) in enumerate(lv["holes"]):
        out = next(o for t, o in pet if abs(((t - th + 180) % 360) - 180) < 30)
        pp, n = on_dome(rr, zeq, th, el, fl, out + 0.06)
        porthole(f"port{i}", pp, n, rp, frame=0.12, mat_ring=M["portrim"])
    pts = []
    for th in lv["seams"]:
        for s_ in (-6.0, 6.0):
            for el in range(2, 58, 10):
                pts.append(on_dome(rr + 0.04, zeq, th + s_ / math.cos(math.radians(el)), el, fl, 0.0))
    studs("dome-rvt", pts, 0.1, M["rivet"])
    ztop = zeq + rr * fl
    lathe("collar", [(0.45, ztop - 0.3), (0.95, ztop + 0.1), (1.0, ztop + 0.4), (0.7, ztop + 0.6), (0.36, ztop + 0.62)],
          (0, 0, 0), M["gold"], verts=48)
    funnel(ztop, None, k=lv["fun_k"], extra=lv["fun_extra"])
    for i, th in enumerate(lv["straps"]):
        strap(f"strap{i}", th, dr - 0.02, dz0 - 0.1, dz1, w=0.55, rivets=8)
    # the base ring under the drum, the legs on rusty gear feet
    lathe("base", [(0.01, dz0 - 0.55), (dr + 0.2, dz0 - 0.55), (dr + 0.32, dz0 - 0.3), (dr + 0.25, dz0 + 0.05),
                   (dr - 0.1, dz0 + 0.08)], (0, 0, 0), M["steel"], verts=96)
    fd = lv["foot_d"]
    for i in range(8):
        th = S.FRONT + 45 * i
        gear(f"leg{i}-gear", 1.0, 12, 0.32, P(th, fd, 0.16), M["rustgold"], (0, 0, math.radians(th)), tooth=0.2)
        tube(f"leg{i}-post", [P(th, fd, 0.3), P(th, fd, dz0 - 0.9), P(th, dr + 0.25, dz0 - 0.4)], 0.15, M["steel"],
             verts=12)
        cyl(f"leg{i}-cup", 0.42, 0.3, P(th, fd, dz0 - 1.05), M["gold"], verts=20, r2=0.25)
    # a gold lattice ring on the leg cups, V braces from the cups up to the drum (not at the front), red hook pipes from
    # the drum's foot arching out and down onto the cups, a red bar down the front
    zc = dz0 - 0.75
    for i in range(8):
        a, b = S.FRONT + 45 * i, S.FRONT + 45 * (i + 1)
        u, v = P(a, fd, zc + 0.08), P(b, fd, zc + 0.08)
        box(f"lattice{i}", ((v - u).length + 0.5, 0.58, 0.2), (u + v) / 2, M["palegold"],
            rot=(0, 0, math.degrees(math.atan2(v.y - u.y, v.x - u.x))), origin="centre", bevel=0.03)
        if i in (0, 7):
            continue
        top = P((a + b) / 2, dr - 0.05, dz0 + lv["brace_z"])
        for j, c in enumerate((a, b)):
            sweep(f"brace{i}{j}", [P(c, fd - 0.15, zc + 0.15), top], P((a + b) / 2, 1, 0), 0.56, 0.14, M["palegold"],
                  bevel=0.02)
    for i in range(1, 8):
        th = S.FRONT + 45 * i
        z0, zt = dz0 + lv["hook"][0], dz0 + lv["hook"][1]
        rel = ((th - S.FRONT + 180) % 360) - 180
        t0 = th - math.copysign(lv["hook_swirl"], rel) if abs(rel) < 170 else th
        # one round inverted U: up off the drum, over, and down onto the leg's cup (turning from t0 to the leg)
        rs = (dr - 0.1, dr + 0.6, (dr + fd) / 2 + 0.4, fd + 0.65, fd + 1.0, fd + 0.95, fd + 0.45, fd)
        zs = (z0, z0 + 0.35, zt + 0.05, zt, zt - 0.35, zc + 1.0, zc + 0.45, zc + 0.25)
        bs = [t0 + (th - t0) * min(1.0, k / 3) for k in range(8)]
        tube(f"loop{i}", [P(b, r, z) for b, r, z in zip(bs, rs, zs)], 0.34, M["red"], verts=16, smooth=True)
    railbar("redbar", [P(S.FRONT, dr + 0.05, dz0 + 1.2), P(S.FRONT, dr + 0.3, dz0 - 0.5), P(S.FRONT, fd, dz0 - 1.0)], 0.28)

# ---------------------------------------------------------------------------------------------------- levels 9 and 10
def spike(name, at, direction, r=0.16, h=0.7, mat=None):
    """A sharp cone standing on `at`, pointing along direction."""
    return track(cyl(name, r, h, at, mat or M["chrome"], r2=0.0, verts=12, bevel=0.0), direction)


def facing_ring(name, at, n, r, wire, mat):
    """A ring whose plane faces n (a boss on the dome, a loop by the spout)."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = at
    e.rotation_euler = Vector(n).to_track_quat("Z", "Y").to_euler()
    ring(name + "-r", r, wire, mat, parent=e, n=32)
    return e


def claw_foot(i, th, d, z_top, kind):
    """Levels 9 and 10: a gold claw foot. 9: a gold drum on eight curved claws; 10: a shallow gold dish on ten long
    thin claws. A post rises from its middle to z_top."""
    c = P(th, d, 0.0)
    if kind == 9:
        lathe(f"foot{i}-drum", [(1.0, 0.42), (1.22, 0.55), (1.3, 0.8), (1.3, 1.6), (1.2, 1.82), (0.75, 1.95),
                                (0.42, 2.0), (0.38, z_top)], c, M["gold"], verts=40)
        n, r0, z0, rt = 9, 1.2, 0.75, 1.65
    else:
        lathe(f"foot{i}-dish", [(0.22, 0.8), (0.8, 0.95), (1.3, 1.3), (1.34, 1.48), (1.0, 1.5), (0.5, 1.48),
                                (0.28, 1.65), (0.28, z_top)], c, M["gold"], verts=40)
        n, r0, z0, rt = 10, 1.2, 1.2, 1.85
    for k in range(n):
        a = th + 360.0 * (k + 0.5) / n
        pts = [c + Vector(S.polar(a, r0 - 0.15, z0)), c + Vector(S.polar(a, r0 + (rt - r0) * 0.55, z0 + 0.15)),
               c + Vector(S.polar(a, rt, 0.4)), c + Vector(S.polar(a, rt - 0.12, 0.03))]
        tube(f"foot{i}-claw{k}", pts, 0.15 if kind == 9 else 0.11, M["gold"], r_end=0.03, smooth=True)


def base910(lv, kind):
    """The wide base band of levels 9 and 10 under the core: 9 pale perforated steel with gold rims; 10 a beige band
    with one row of big black holes, a dark perforated step on top."""
    r, za, zb = lv["base"]
    dr = lv["drum"][0]
    mat = M["perf_lo"] if kind == 9 else M["band10"]
    lathe("base", [(r - 0.7, zb), (r - 0.12, zb), (r + 0.02, zb - 0.25), (r + 0.08, (za + zb) / 2), (r + 0.02, za + 0.25),
                   (r - 0.12, za), (r - 0.7, za)], (0, 0, 0), mat, verts=128)
    ring("base-rim-hi", r - 0.05, 0.14, M["gold"], z=zb - 0.02, n=128)
    if kind == 9:
        ring("base-rim-lo", r, 0.16, M["gold"], z=za + 0.08, n=128)
    else:                                        # level 10: a thick bronze band round the foot of the base
        lathe("base-rim-lo", [(r - 0.1, za - 0.05), (r + 0.16, za - 0.02), (r + 0.22, za + 0.25), (r + 0.18, za + 0.62),
                              (r - 0.05, za + 0.66)], (0, 0, 0), M["golddark"], verts=128)
    lathe("base-bowl", [(r - 0.1, za + 0.05), (r - 0.5, za - 0.3), (2.0, za - 0.5), (0.01, za - 0.52)], (0, 0, 0),
          M["golddark"], verts=96)
    if kind == 9:
        disc("base-top", dr - 0.1, r - 0.1, zb + 0.02, M["golddark"], thick=0.12)
        ring("base-rim-top", r - 0.1, 0.22, M["gold"], z=zb + 0.04, n=128)
        return
    rs, zs = lv["step"]                          # the dark step
    lathe("step", [(rs - 0.3, zs), (rs, zs), (rs + 0.05, zs - 0.45), (rs, zb - 0.05)], (0, 0, 0), M["hood"], verts=96)
    disc("base-top", rs - 0.05, r - 0.1, zb + 0.02, M["steel"], thick=0.12)
    disc("step-top", dr - 0.1, rs, zs + 0.02, M["hood"], thick=0.1)
    ring("step-rim", rs, 0.07, M["gold"], z=zs, n=96)
    pts = [(P(th, r + 0.09, (za + zb) / 2 + 0.1), P(th, 1, 0)) for th in (S.FRONT + 360.0 * (k + 0.5) / 26 for k in range(26))]
    studs("base-holes", pts, 0.36, M["hole"], flat_=0.15)
    pts = [(P(th, rs + 0.04, zs - 0.4), P(th, 1, 0)) for th in (S.FRONT + 360.0 * k / 34 for k in range(34))]
    studs("step-holes", pts, 0.13, M["hole"], flat_=0.15)


def is_quarter(lv, th):
    return any(abs(((th - q + 180) % 360) - 180) < 1 for q in lv["quarters"])


def claw_feet(lv, kind):
    """The eight claw feet: those under the quarter frames or columns further out than the rest."""
    for i, th in enumerate(lv["feet"]):
        claw_foot(i, th, lv["foot_dq"] if is_quarter(lv, th) else lv["foot_d"], 2.4, kind)


def foot_posts(lv):
    """The short gold posts from the claw feet between the quarters up to the base band, a bracket into its top."""
    r, za, zb = lv["base"]
    fd = lv["foot_d"]
    for i, th in enumerate(lv["feet"]):
        if is_quarter(lv, th):
            continue
        if "upipe" in lv and abs(th - S.FRONT) < 1:
            rs, zs = lv["step"]
            tube(f"post{i}-upipe", [P(th, rs - 0.2, zs - 0.2), P(th, rs + 0.5, zs + 0.15), P(th, r + 0.45, zb + 0.4),
                                    P(th, r + 0.6, zb - 0.6), P(th, fd - 0.1, za + 0.1), P(th, fd, 1.75)],
                 lv["upipe"], M["gold"], verts=20, smooth=True)
            lathe(f"post{i}-cuff", [(lv["upipe"] + 0.12, 1.6), (lv["upipe"] + 0.14, 2.0), (lv["upipe"] + 0.02, 2.1)],
                  P(th, fd, 0), M["gold"], verts=24)
            continue
        box(f"post{i}", (0.55, 0.55, zb + 0.55 - 1.8), P(th, fd, 1.8), M["gold"], rot=(0, 0, th), bevel=0.06)
        box(f"post{i}-arm", (fd - r + 0.5, 0.5, 0.45), P(th, (fd + r) / 2 - 0.15, zb - 0.1), M["gold"], rot=(0, 0, th),
            bevel=0.06)


def dome_harness(lv, rings=True):
    """Gold straps from the collar down the dome's front and sides, each ending in a gold ring (levels 9 and 10)."""
    rr, zeq = lv["dome"]
    fl = lv.get("dome_flat", 1.0)
    for k, t in enumerate((S.FRONT, S.FRONT - 48, S.FRONT + 48)):
        el1 = 52.0 if k == 0 else 44.0
        pts = [on_dome(rr, zeq, t, el, fl, 0.06)[0] for el in (84.0, 74.0, 64.0, el1 + 4)]
        tube(f"harness{k}", pts, 0.12, M["gold"], smooth=True)
        if rings:
            p, n = on_dome(rr, zeq, t, el1, fl, 0.06)
            facing_ring(f"harness{k}-ring", p, n, 0.32, 0.1, M["gold"])


def frame9(i, th, lv):
    """Level 9's gold frame at a quarter: a perforated square post up from the claw foot, a beam over to a big gold
    shoulder drum on the dome (the front two lean in toward the porthole and sit higher), a big gold tusk curving out of
    the shoulder toward the screen's edge, silver spikes."""
    d, zt = lv["frame_d"], lv["frame_top"]
    rr, zeq = lv["dome"]
    fl = lv["dome_flat"]
    zb = 2.3
    s = {S.FRONT - 45: -1, S.FRONT + 45: 1, S.FRONT - 135: 1, S.FRONT + 135: -1}[th]
    front = i < 2
    ts = th - s * lv["shoulder_turn"] if front else th          # the shoulder's bearing
    zs = zt + (lv["shoulder_rise"] if front else 0.0)           # and height
    rh = rr * math.cos(math.asin(min(1.0, (zs - zeq) / (rr * fl))))
    box(f"frame{i}", (0.75, 0.9, zt - zb + 0.4), P(th, d, zb), M["gold"], rot=(0, 0, th), bevel=0.08)
    box(f"frame{i}-cap", (1.0, 1.1, 0.5), P(th, d, zt + 0.3), M["gold"], rot=(0, 0, th), bevel=0.1)
    # the beam arches up off the post and over onto the shoulder (Flash's frame curves in at the top)
    tube(f"frame{i}-beam", [P(th, d, zt + 0.4), P(th, d - 0.2, zt + 0.85), P((th + ts) / 2, (d + rh) / 2 + 0.2, zs + 0.75),
                            P(ts, rh + 0.4, zs)], 0.5, M["gold"], verts=20, smooth=True)
    # the shoulder: a rounded gold knuckle where the beam meets the dome, its domed face outward
    track(lathe(f"frame{i}-sleeve", [(0.0, 0.0), (1.0, 0.0), (1.18, 0.25), (1.24, 0.6), (1.14, 0.98), (0.9, 1.25),
                                     (0.5, 1.42), (0.0, 1.48)], P(ts, rh - 0.6, zs), M["gold"], verts=40), P(th + s * 45, 1, 0))
    pts = []
    for k in range(7):
        z = zb + 0.6 + k * (zt - zb - 1.2) / 6
        for side in (-1, 1):
            pts.append((P(th, d, z) + P(th + 90 * side, 0.455, 0), P(th + 90 * side, 1, 0)))
        pts.append((P(th, d + 0.38, z), P(th, 1, 0)))
    studs(f"frame{i}-holes", pts, 0.12, M["hole"], flat_=0.2)
    # the tusk: out of the shoulder's foot, curving out and down toward the screen's edge, its point beside the post
    if front:      # Flash: the tusk sweeps out toward the screen's edge and down, its point turned outward
        p0 = P(ts, rh + 0.5, zs - 0.5)
        L = P(S.FRONT + math.copysign(90.0, ((th - S.FRONT + 180) % 360) - 180), 1, 0)
        C, Z = P(S.FRONT, 1, 0), Vector((0, 0, 1))
        p0 = p0 + Z * 0.4
        tube(f"frame{i}-tusk", [p0, p0 + L * 0.9 + C * 0.5 - Z * 0.2, p0 + L * 1.9 + C * 0.95 - Z * 1.6,
                                p0 + L * 2.45 + C * 1.05 - Z * 3.9], 0.8, M["tusk"], r_end=0.1, smooth=True)
    else:
        tube(f"frame{i}-tusk", [P(ts, rh + 0.5, zs - 0.5), P(th - s * 3, d - 0.9, zs - 0.7), P(th - s * 6, d - 0.55, zs - 2.5),
                                P(th - s * 13, d - 1.0, zs - 4.8)], 0.85, M["tusk"], r_end=0.1, smooth=True)
    for k, z in enumerate((zt - 1.4, zt - 3.8)):
        spike(f"frame{i}-spike{k}", P(th, d + 0.36, z), P(th, 1, 0.4))
    spike(f"frame{i}-spike2", P(th, d, zt + 0.75), Vector((0, 0, 1)) + P(th, 0.5, 0))


def tendrils(z):
    """Level 9's tendrils: thin dark and gold whiskers up out of the collar, round the outside of the cone."""
    for k, a in enumerate((S.FRONT - 100, S.FRONT - 150, S.FRONT + 170, S.FRONT + 125, S.FRONT + 80)):
        pts = [P(a, 0.8, z + 0.2), P(a, 1.5, z + 1.1), P(a, 2.1, z + 2.3), P(a + 8, 2.5, z + 3.1),
               P(a + 20, 2.2, z + 3.6)]
        tube(f"tendril{k}", pts, 0.08, M["handle"] if k % 2 else M["golddark"], r_end=0.02, smooth=True)


def core9(lv):
    """Level 9's core front: the drum opened (a dark slot with gold edges), red frames at the sides, red rods."""
    dr, dz0, dz1 = lv["drum"]
    th = S.FRONT
    box("slot", (0.12, 2.1, dz1 - dz0 - 0.1), P(th, dr + 0.03, dz0), M["hole"], rot=(0, 0, th), bevel=0.0)
    for s in (-1, 1):
        strap(f"slot-edge{s + 1}", th + s * 21, dr - 0.02, dz0, dz1, w=0.36, rivets=6)
    tube("slot-rod", [P(th, dr - 0.3, dz1 - 0.6), P(th, dr - 0.3, dz0 - 0.1)], 0.13, M["gold"])
    for k, a in enumerate((S.FRONT - 65, S.FRONT + 65)):
        ro = dr + 1.0
        railbar(f"eframe{k}", [P(a, ro, dz0 + 0.4), P(a, ro, dz0 + 2.9)], 0.16)
        for j, z in enumerate((dz0 + 0.4, dz0 + 1.65, dz0 + 2.9)):
            railbar(f"eframe{k}-p{j}", [P(a, dr - 0.1, z), P(a, ro + 0.35, z)], 0.13)
    for k, a in enumerate((S.FRONT - 26, S.FRONT + 26)):
        railbar(f"rod{k}", [P(a, dr - 0.05, dz0 + 1.3), P(a, dr + 0.35, dz0 + 0.6), P(a, dr + 0.9, lv["base"][2] + 0.05)],
                0.11)


def level9():
    lv = S.LV[9]
    body_dome(lv)
    rr, zeq = lv["dome"]
    top = zeq + rr * lv["dome_flat"]
    crown(top, 1.0)
    tendrils(top + 0.4)
    dome_harness(lv)
    base910(lv, 9)
    core9(lv)
    claw_feet(lv, 9)
    foot_posts(lv)
    for i, th in enumerate(lv["quarters"]):
        frame9(i, th, lv)


def column10(i, th, lv):
    """Level 10's gold column at a quarter: a red core between four gold bars, a gold foot and capital, standing on
    the claw foot; two blue studs on the capital."""
    d, zt = lv["foot_dq"], lv["col_top"][i]
    zb = 1.6
    c = P(th, d, 0.0)
    lathe(f"col{i}-base", [(0.86, zb), (0.9, zb + 0.25), (0.7, zb + 0.45), (0.68, zb + 0.95)], c, M["gold"], verts=32)
    cyl(f"col{i}-red", 0.46, zt - zb - 1.6, P(th, d, zb + 0.8), M["red"], verts=24)
    for k in range(4):
        a = th + 45 + 90 * k
        tube(f"col{i}-bar{k}", [c + Vector(S.polar(a, 0.48, zb + 0.8)), c + Vector(S.polar(a, 0.48, zt - 0.8))], 0.22,
             M["gold"], verts=12)
    lathe(f"col{i}-cap", [(0.66, zt - 0.95), (0.72, zt - 0.7), (0.92, zt - 0.4), (0.95, zt), (0.7, zt + 0.12),
                          (0.01, zt + 0.14)], c, M["gold"], verts=32)
    rr, zeq = lv["dome"]
    tube(f"col{i}-strut", [P(th, d - 0.45, lv["strut_z"]), on_dome(rr, zeq, th, 6.0, lv["dome_flat"], -0.15)[0]], 0.24,
         M["gold"], verts=12)
    for s in (-1, 1):
        spike(f"col{i}-stud{s + 1}", c + Vector(S.polar(th + 90 * s, 0.35, zt + 0.05)), Vector((0, 0, 1)), r=0.16,
              h=0.5, mat=M["glass"])


def arm10(i, th, lv, front):
    """Level 10's gold arm from a column's capital over into the dome: an elbow ball, a thick forearm, a shoulder
    block on the dome, blue studs along the top and a big one on the elbow."""
    d, zt = lv["foot_dq"], lv["col_top"][i]
    rr, zeq = lv["dome"]
    rel = ((th - S.FRONT + 180) % 360) - 180      # the front arms meet the dome out on its shoulders, not over the middle
    sh, n = on_dome(rr, zeq, th + math.copysign(17.0, rel) if front else th, 50.0 if front else 34.0, lv["dome_flat"], 0.45)
    el = P(th, d - 0.1, zt + 0.55)
    ball(f"arm{i}-elbow", el, 1.0, M["gold"])
    mid = (el + sh) / 2 + Vector((0, 0, 0.3))
    # Flash's arm is a thick square gold beam (a soft bevel) with a gauntlet block next to the elbow
    pts = [el * (1 - t) ** 2 + mid * 2 * t * (1 - t) + sh * t * t for t in (k / 10 for k in range(11))]
    sweep(f"arm{i}", pts, P(th + 90, 1, 0), 1.5, 1.35, M["gold"], bevel=0.6)
    for k, t in enumerate((0.38, 0.62, 0.84)):          # dark gold bands round the beam (its armour segments)
        q = el * (1 - t) ** 2 + mid * 2 * t * (1 - t) + sh * t * t
        dq = (2 * (1 - t) * (mid - el) + 2 * t * (sh - mid)).normalized()
        b = box(f"arm{i}-band{k}", (0.22, 1.66, 1.5), q, M["golddark"], origin="centre", bevel=0.5)
        b.rotation_euler = dq.to_track_quat("X", "Z").to_euler()
    g = el * 0.72 + sh * 0.28 + Vector((0, 0, 0.12))
    b = box(f"arm{i}-gauntlet", (1.3, 1.8, 1.65), g, M["gold"], origin="centre", bevel=0.38)
    b.rotation_euler = (sh - el).normalized().to_track_quat("X", "Z").to_euler()
    b = box(f"arm{i}-shoulder", (1.4, 1.6, 1.4), sh, M["gold"], origin="centre", bevel=0.14)
    b.rotation_euler = Vector(n).to_track_quat("X", "Z").to_euler()
    ball(f"arm{i}-blue", P(th, d + 0.7, zt + 0.5), 0.36, M["glass"])
    for k in range(3):
        t = 0.42 + 0.17 * k
        q = el * (1 - t) ** 2 + mid * 2 * t * (1 - t) + sh * t * t + Vector((0, 0, 0.62))
        spike(f"arm{i}-stud{k}", q, Vector((0, 0, 1)) + P(th, 0.4, 0), r=0.14, h=0.45, mat=M["glass"])


def horns(fz):
    """Level 10's gold horns out of the funnel's neck either side (fz: the funnel's foot), a gold rod up through it,
    red loops."""
    for k, a in enumerate((S.FRONT - 90, S.FRONT + 90)):
        tube(f"horn{k}", [P(a, 0.3, fz + 0.8), P(a, 1.6, fz + 1.05), P(a, 2.3, fz + 2.1), P(a, 2.3, fz + 3.1),
                          P(a, 2.95, fz + 4.0)], 0.42, M["gold"], r_end=0.05, smooth=True)
        facing_ring(f"loop{k}", P(a, 1.25, fz + 0.2), P(a + 90, 1, 0), 0.55, 0.09, M["red"])
    tube("antenna", [(0, 0, fz + 0.5), (0, 0, fz + 5.3)], 0.1, M["gold"])
    lathe("antenna-plug", [(0.01, fz + 0.35), (0.23, fz + 0.35), (0.23, fz + 0.75), (0.01, fz + 0.75)], (0, 0, 0),
          M["gold"], verts=24)
    ball("antenna-tip", (0, 0, fz + 5.3), 0.14, M["gold"])


def core10(lv):
    """Level 10's dark core: three gold hoops with red clamps, rivet rows at the sides, a red bar down the front and
    red hoses curling down from it onto the dark step."""
    dr, dz0, dz1 = lv["drum"]
    for k, z in enumerate((dz0 + 1.3, dz0 + 2.3, dz0 + 3.3)):
        ring(f"hoop{k}", dr + 0.12, 0.16, M["gold"], z=z, n=96)
        for j, a in enumerate((S.FRONT - 62, S.FRONT + 62)):
            box(f"hoop{k}-clamp{j}", (0.36, 0.5, 0.5), P(a, dr + 0.15, z), M["red"], rot=(0, 0, a), origin="centre",
                bevel=0.08)
    railbar("redbar", [P(S.FRONT, dr + 0.3, dz1 - 0.2), P(S.FRONT, dr + 0.3, dz0 + 0.2)], 0.12)
    pts = []
    for a in (S.FRONT - 75, S.FRONT + 75):
        for k in range(14):
            pts.append((P(a, dr + 0.01, dz0 + 0.4 + k * 0.29), P(a, 1, 0)))
    studs("core-rvt", pts, 0.07, M["rivet"])
    zs = lv["base"][2] + 0.9
    for k, a in enumerate((S.FRONT - 40, S.FRONT + 40, S.FRONT - 115, S.FRONT + 115)):
        s = -1 if (k % 2 == 0) else 1
        tube(f"hose{k}", [P(a, dr - 0.05, dz0 + 0.9), P(a + 8 * s, dr + 0.9, dz0 + 0.7), P(a + 20 * s, dr + 1.3, zs + 0.4),
                          P(a + 34 * s, dr + 0.7, zs + 0.3), P(a + 44 * s, dr + 0.2, zs + 0.05)], 0.25, M["red"],
             smooth=True)


def level10():
    lv = S.LV[10]
    body_dome(lv)
    rr, zeq = lv["dome"]
    crown(zeq + rr * lv["dome_flat"], 1.0)
    horns(lv["fun_z"])
    dome_harness(lv, rings=False)
    pts = [on_dome(rr, zeq, S.FRONT + a, e, lv["dome_flat"], 0.0)
           for a, e in ((0, 62), (-55, 30), (55, 30), (-100, 22), (100, 22))]
    for k, (p, n) in enumerate(pts):
        ball(f"dome-blue{k}", p, 0.24, M["glass"])
    base910(lv, 10)
    core10(lv)
    claw_feet(lv, 10)
    foot_posts(lv)
    for i, th in enumerate(lv["quarters"]):
        column10(i, th, lv)
        arm10(i, th, lv, i < 2)


def build():
    {1: level1, 2: level2, 3: level3, 4: level4, 5: level5, 6: level6, 7: level7, 8: lambda: level7(True), 9: level9, 10: level10}[L]()


def family(o):
    """A part's family for the checks: the name up to its first '-', without the number."""
    return o.name.split(".")[0].split("-")[0].rstrip("0123456789")


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
    if MODE == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"hcc-L{L}.blend"))
    print("DONE", L, MODE)


main()
