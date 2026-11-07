"""locker.py : the Monster Locker (Flash building 8) as a 3D model, in the approved Twig/Pebble/Putty/Hatchery family
(same camera, light, render settings and scale; no outline), matched to Flash's glossy render: blue chrome, polished
gold, black rubber bellows, worn wood. The parts per level are described in stack.py.

    blender -b --factory-startup -P locker.py -- <level> fit      work/fit-L<level>.png  quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P locker.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P locker.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P locker.py -- <level> check    CHECK lines: parts whose meshes overlap; CLEAR lines:
                                                                   how near each moving part comes to anything else
    blender -b --factory-startup -P locker.py -- <level> gap      GAP lines: parts in front of others from the camera

Animation, as Flash: the key turns once round its shaft a loop, and the gold barrel inside turns about its axle (from
level 2). Nothing else moves. The base picture is rendered once, each frame renders only the moving parts with every
still part as a holdout, and post.py lays that layer over the base.
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

import json  # noqa: E402
BOWS = json.loads((HERE / "bows.json").read_text())   # Flash's key bows, traced (work/bowtrace.py)
FRAMES = S.FRAMES[LEVEL]             # Flash's loop at this level

EL = 30.0
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the building's middle on the ground)
GROUND = S.GROUND
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-72,-100,170,116").split(","))   # as fref.FRAME
K = {"fit": 4}.get(MODE, int(os.environ.get("PB_K", 12)))      # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1300)            # the same at every level: a level only adds parts


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


def gear(name, r, teeth, depth, at, mat, rot, tooth=0.18, parent=None, hole=0.0, face_mat=None):
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
    if face_mat is not None:        # the two flat faces their own (dark) material; the rim and tooth tops `mat`
        for fc in bm.faces:
            if abs(fc.normal.z) > 0.9:
                fc.material_index = 1
    ob = mesh_ob(name, bm, [mat] + ([face_mat] if face_mat is not None else []), smooth=False,
                 bevel=min(0.02, depth / 4), segs=2, parent=parent)
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
          streak=0.0, side=0.0, glow=(), bump=0.03):
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
    glow_sum = None
    for k, g in enumerate(glow):
        fac = screen_spot(t, *g[:5])
        out = t.mix(out, srgb(*g[5]), fac)
        if k == 0:                 # the sheen also glows, so the metal can't swallow it
            t.set(**{"Emission Color": srgb(*g[5])})
            glow_sum = fac
        else:
            mx = t.n("ShaderNodeMath", operation="MAXIMUM")
            t.link(glow_sum, mx.inputs[0])
            t.link(fac, mx.inputs[1])
            glow_sum = mx.outputs[0]
    if glow_sum is not None:
        t.set(**{"Emission Strength": glow_sum})
    out = t.grime(out, GROUND, 4.0, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rr, "metal": metal, "spec": spec})
    if coat:
        t.set(coat=coat)
        t.bsdf.inputs["Coat Roughness"].default_value = 0.12
    if bump:
        t.bump(t.noise(v, scale * 4, 4.0, 0.6), bump, 0.01)
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


# ------------------------------------------------------------------------------------------------------------ the model
CHROME_COL = tuple(int(v) for v in os.environ.get("PB_CHROME", "222,230,250").split(","))
CHROME_WEAR = (220, 226, 234)
CHROME_ROUGH = float(os.environ.get("PB_CROUGH", 0.08))


def materials():
    M = {}
    # Flash's shell: polished pale-silver chrome (a mirror of the studio sky that only glossy rays see, set up in
    # setup(): a bright soft window up left, a grey band at the horizon, light ground below), one chrome every level
    M["chrome"] = shiny("chrome", CHROME_COL, rough=CHROME_ROUGH, metal=1.0, wear=CHROME_WEAR, scale=2.0, dirt=0.18,
                        ao_min=0.6, bump=0.0)
    M["inner"] = shiny("inner", (70, 48, 18), rough=0.35, metal=0.7, wear=(110, 74, 24), scale=3, dirt=0.2)
    # levels 3-4: the egg's inside nearly black, as Flash (a metal one mirrored the bright sky and the dome's inside wall
    # read as a pale crescent)
    M["inner34"] = shiny("inner34", (22, 16, 10), rough=0.55, metal=0.15, wear=(40, 28, 12), scale=3, dirt=0.2)
    M["steel"] = shiny("steel", (184, 192, 206), rough=0.3, metal=0.85, wear=(150, 158, 174), scale=4, dirt=0.2,
                       side=0.3)
    M["gold"] = shiny("gold", (232, 146, 30), rough=0.28, metal=0.85, side=0.3, wear=(246, 196, 92), scale=1.5,
                      dirt=0.3, streak=0.3)
    M["golddark"] = shiny("golddark", (150, 82, 16), rough=0.32, metal=0.8, wear=(196, 120, 36), scale=1.5, dirt=0.3)
    M["block"] = shiny("block", (252, 196, 56), rough=0.22, metal=0.85, wear=(255, 214, 110), scale=2.0, dirt=0.1)
    M["rubber"] = shiny("rubber", (16, 16, 20), rough=0.5, metal=0.0, wear=(30, 30, 38), scale=3, dirt=0.15,
                        side=0.2, spec=0.22)
    M["glass"] = shiny("glass", (210, 226, 236), rough=0.15, metal=0.3, wear=(180, 200, 214), scale=3, dirt=0.0,
                       coat=0.6)
    M["needle"] = shiny("needle", (150, 156, 168), rough=0.25, metal=0.9, wear=(120, 126, 138), scale=4, dirt=0.1)
    M["arm"] = shiny("arm", (96, 84, 70), rough=0.45, metal=0.5, wear=(120, 104, 84), scale=4, dirt=0.2)
    M["plate"] = shiny("plate", (176, 186, 204), rough=0.32, metal=0.3, wear=(160, 170, 190), scale=2, dirt=0.05,
                       side=0.4)
    M["nut"] = shiny("nut", (92, 98, 110), rough=0.35, metal=0.8, wear=(70, 76, 88), scale=4, dirt=0.2, side=0.3)
    M["hole"] = flat("hole", (14, 12, 16), rough=1.0)
    M["lamp"] = flat("lamp", (252, 236, 210), rough=0.4, emit=0.5)
    M["lens"] = shiny("lens", (30, 30, 20), rough=0.2, metal=0.6, wear=(52, 50, 28), scale=3, dirt=0.0)
    M["core"] = shiny("core", (52, 34, 12), rough=0.45, metal=0.6, wear=(80, 52, 18), scale=3, dirt=0.3)
    # levels 3-4: Flash's barrel reads as smaller, deeper gold blocks with black between them
    M["block34"] = shiny("block34", (214, 140, 26), rough=0.26, metal=0.85, wear=(240, 186, 70), scale=2.0, dirt=0.15)
    M["block34lo"] = shiny("block34lo", (150, 88, 14), rough=0.3, metal=0.85, wear=(196, 128, 36), scale=2.0,
                           dirt=0.2)
    # levels 3-4: the cog behind the drum, darker gold than the blocks (Flash)
    M["cog34"] = shiny("cog34", (128, 68, 12), rough=0.3, metal=0.85, wear=(214, 140, 44), scale=1.5, dirt=0.3)
    M["core34"] = shiny("core34", (46, 26, 8), rough=0.35, metal=0.75, wear=(70, 40, 12), scale=3, dirt=0.3)
    # levels 3-4: the gear wheels' flat faces, nearly black (Flash shows dark gaps between the gold rims)
    M["gearface"] = shiny("gearface", (26, 18, 8), rough=0.5, metal=0.6, wear=(44, 30, 12), scale=3, dirt=0.3)
    return M


M = materials()
A = px(*S.GC[L], Z=0.0)          # this level's axis on the ground


def cam_ray(sx, sy):
    """A point on the camera ray through Flash pixel (sx, sy), and the ray's direction (away from the camera)."""
    return px(sx, sy, Z=0.0), cam_fwd()


def on_ball(c, r, sx, sy):
    """The point of the ball (centre c, radius r) the camera sees at Flash pixel (sx, sy), and the ball's normal there."""
    p, f = cam_ray(sx, sy)
    oc = p - c
    b = oc.dot(f)
    disc = b * b - (oc.dot(oc) - r * r)
    if disc < 0:
        raise ValueError(f"({sx}, {sy}) misses the ball")
    s = -b - math.sqrt(disc)
    q = p + f * s
    return q, (q - c).normalized()


def toward(e, n, sx, sy, reach=400):
    """The point on the camera ray through (sx, sy) that lies most nearly along n from e (a part sticking out of a
    surface at e and reaching the screen point (sx, sy)); it looks reach/20 world units either side of the ground."""
    p, f = cam_ray(sx, sy)
    best = None
    for i in range(-reach, reach + 1):
        q = p + f * (i * 0.05)
        d = q - e
        if d.length < 1e-6:
            continue
        a = d.normalized().dot(n)
        if best is None or a > best[0]:
            best = (a, q)
    return best[1]


def _plane_pt(c):
    p, f = cam_ray(*c)
    # the plane through A with normal = the camera's forward direction flattened (X - Y = A.x - A.y)
    t = ((A.x - A.y) - (p.x - p.y)) / (f.x - f.y)
    return p + f * t


def frame_at(name, at, z, xhint=(0, 0, 1), parent=None):
    """An empty at `at` whose local Z is z and local X lies as near xhint as it can."""
    e = bpy.data.objects.new(name, None)
    link(e, parent)
    z = Vector(z).normalized()
    x = Vector(xhint) - z * Vector(xhint).dot(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)) - z * z.x
    x.normalize()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = at
    e.matrix_world = m
    return e


def bellows(name, z0, z1, r, ribs, mat, at=None):
    """The black rubber bellows: a stack of fat rounded rings, narrower in the grooves."""
    at = at or A
    prof = [(0.0, 0.0), (r * 0.9, 0.0)]
    n = ribs * 8
    for i in range(n + 1):
        t = i / n
        prof.append((r * (0.93 + 0.07 * abs(math.sin(math.pi * ribs * t)) ** 0.6), (z1 - z0) * t))
    prof.append((0.0, z1 - z0))
    return lathe(name, prof, (at.x, at.y, z0), mat, verts=48)


def disc(name, r, z, h, at=None, mat=None, verts=64, lumpy=0.0):
    at = at or A
    prof = [(0.0, 0.0), (r - 0.12, 0.0), (r - 0.02, 0.05), (r, h * 0.5), (r - 0.04, h - 0.03), (r - 0.14, h), (0.0, h)]
    ob = lathe(name, prof, (at.x, at.y, z), mat or wood("wood", (204, 160, 108), (132, 90, 52), axis="X"), verts=verts)
    return ob


def ball(name, c, r, mat, cut=None, inner=None, segs=64, wall=0.14):
    """A chrome ball; cut = (normal, distance): everything beyond that plane is cut away and the shell gets a wall."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=r)
    if cut:
        nrm, d = cut
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=nrm * d, plane_no=nrm, clear_outer=True)
    ob = mesh_ob(name, bm, [mat] + ([inner] if inner else []))
    ob.location = c
    if cut:
        so = ob.modifiers.new("wall", "SOLIDIFY")
        so.thickness = wall
        so.offset = -1.0
        so.material_offset = 1
        so.material_offset_rim = 0
        so.use_rim = True
    return ob


def key(name, e_at, n, ring_at, ring_r, wire, phase, bow=None, slot=True, collar=0.25, tail=0.4):
    """The wind-up key: out of a dark slot at e_at along the shaft toward ring_at, its bow (a ring, or bow(parent)
    builds it in the local XZ plane round local (0, 0, len + ...)). Turns about the shaft (local Z). slot=False: no
    slot (the shaft comes up out of the mechanism inside the shell); collar: where the collar sits along the shaft;
    tail: how far the shaft reaches below e_at."""
    d = ring_at - e_at
    ln = d.length - ring_r
    e = frame_at(name, e_at, d, xhint=(0, 0, 1))
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    MOVING.append(hub)
    KEYS[hub.name] = phase
    # the slot in the shell (still) and the shaft (turning)
    if slot:
        cyl(name + "slot", wire * 2.2, 0.06, (0, 0, -0.03), M["hole"], parent=e, verts=20, bevel=0.0)
    cyl(name + "shaft", wire, ln + tail, (0, 0, -tail), M["gold"], parent=hub, verts=16, bevel=0.0)
    lathe(name + "collar", [(0.0, 0.0), (wire * 1.9, 0.0), (wire * 2.1, 0.13), (wire * 1.9, 0.25), (0.0, 0.25)],
          (0, 0, collar), M["gold"], parent=hub, verts=20)
    if bow:
        bow(hub, ln)
    else:
        rr = ring_r - wire * 0.5
        tube(name + "ring", [(rr * math.sin(2 * math.pi * i / 48), 0, ln + ring_r + rr * -math.cos(2 * math.pi * i / 48))
                             for i in range(48)], wire * 1.15, M["gold"], parent=hub, cyclic=True)
    return e, hub


KEYS = {}
COGS = {}               # a turning cog's hub name -> (degrees at frame 0, degrees a loop)


def rivet(name, at, parent, r=0.09, mat=None):
    return lathe(name, [(0.0, -0.02), (r, -0.02), (r * 0.95, r * 0.4), (r * 0.6, r * 0.85), (0.0, r)], at,
                 mat or M["gold"], parent=parent, verts=12)


def panel(name, c, r, sx, sy, kind, size=2.3, spin=0.0, lean=0.0, thick=0.14):
    """A steel panel bolted flat on the shell at Flash pixel (sx, sy): gold brackets on two edges, gold rivets in
    the corners; kind "port": a dark round porthole in a gold ring; "box": a raised housing with a glass window."""
    try:
        q, n = on_ball(c, r, sx, sy) if c is not None else on_surface(sx, sy)
    except ValueError as err:
        print("PROBE panel", name, "error:", err)
        return None
    n = (n - cam_fwd() * lean).normalized()       # turned toward the viewer (Flash shows the faces of its panels)
    e = frame_at(name, q, n, xhint=Matrix.Rotation(math.radians(spin), 3, n) @ Vector((0, 0, 1)))
    h = size / 2
    sag = r - math.sqrt(max(0.0, r * r - 2 * h * h)) + lean * h   # how far the plate's corners stand off the ball
    box(name + "seat", (size * 0.8, size * 0.8, sag + 0.05), (0, 0, -sag - 0.05), M["steel"], parent=e, bevel=0.03)
    box(name + "plate", (size, size, thick), (0, 0, 0), M["steel"], parent=e, bevel=0.04)
    corner = kind in ("port", "vent")
    if kind in ("port", "vent"):   # the plate sits on a gold block that shows past two of its edges, as Flash
        # level 4's vents: a grey frame round the gold bars, as Flash (locker-3d-14), not gold
        trim = M["nut"] if kind == "vent" else M["gold"]
        box(name + "goldback", (size * 1.02, size * 1.02, sag + thick * 0.9), (0.3, 0.3, -sag - 0.05), trim,
            parent=e, bevel=0.06)
    if corner:               # Flash's gold corner trim: an L of gold over each corner of the plate
        arm, wd, ht = size * 0.3, 0.2, 0.09
        for i, (u, v) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            box(f"{name}cnA{i}", (arm, wd, ht), (u * (h - arm / 2 + 0.02), v * (h - wd / 2 + 0.02), thick - 0.02),
                M["steel"] if kind == "vent" else M["gold"], parent=e, bevel=0.03)
            box(f"{name}cnB{i}", (wd, arm, ht), (u * (h - wd / 2 + 0.02), v * (h - arm / 2 + 0.02), thick - 0.02),
                M["steel"] if kind == "vent" else M["gold"], parent=e, bevel=0.03)
    if kind not in ("port", "vent", "strip"):     # "strip" (level 3's left plate, Flash): plain grey, no gold
        # gold brackets: an L along the plate's left (-X) and top (+Y) edges
        box(name + "brkL", (0.3, size * 0.96, thick + 0.22), (-h + 0.2, 0, 0.0), M["gold"], parent=e, bevel=0.05)
        box(name + "brkT", (size * 0.84, 0.3, thick + 0.22), (0.05, h - 0.2, 0.0), M["gold"], parent=e, bevel=0.05)
    for i, (u, v) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        rivet(f"{name}rv{i}", (u * (h - 0.2), v * (h - 0.2), thick + (0.06 if corner else -0.01)), e, r=0.12)
    if kind == "port":
        pr = size * 0.3
        tube(name + "portring", [(pr * math.cos(2 * math.pi * i / 40) + 0.08, pr * math.sin(2 * math.pi * i / 40) + 0.04,
                                  thick + 0.0) for i in range(40)], 0.045, M["golddark"], parent=e, cyclic=True)
        cyl(name + "port", pr, 0.02, (0.08, 0.04, thick - 0.03), M["hole"], parent=e, verts=32, bevel=0.0)
        lathe(name + "lens", [(0.0, -0.05), (pr * 0.9, -0.05), (pr * 0.8, 0.03), (0.0, 0.06)], (0.08, 0.04, thick - 0.03),
              M["lens"], parent=e, verts=32)
    elif kind == "strip":
        pass
    elif kind == "vent":     # level 4: a dark recess behind upright gold bars
        box(name + "ventback", (size * 0.62, size * 0.62, 0.04), (0.1, -0.1, thick - 0.02), M["hole"], parent=e,
            bevel=0.0)
        for k in range(4):
            box(f"{name}bar{k}", (size * 0.6, 0.11, 0.12), (0.1, -0.1 + (k - 1.5) * size * 0.14, thick - 0.02),
                M["gold"], parent=e, bevel=0.03)
    else:
        # a small steel housing low left (+Y), its lit window on the face toward +Y in a gold frame
        hh = size * 0.26
        hy = size * 0.14
        box(name + "housing", (size * 0.44, size * 0.34, hh), (0.18, hy, thick - 0.07), M["steel"], parent=e,
            bevel=0.05)
        box(name + "lampframe", (size * 0.4, 0.06, hh * 0.86), (0.18, hy + size * 0.17 + 0.02, thick - 0.05),
            M["gold"], parent=e, bevel=0.02)
        box(name + "lamp", (size * 0.28, 0.05, hh * 0.6), (0.18, hy + size * 0.17 + 0.05, thick + hh * 0.08),
            M["lamp"], parent=e, bevel=0.01)
        # a round glass window up right (-Y) in a steel rim
        gr = size * 0.19
        gx, gy = -0.05, -size * 0.22
        tube(name + "glassrim", [(gx + gr * math.cos(2 * math.pi * i / 36), gy + gr * 1.15 * math.sin(2 * math.pi * i / 36),
                                  thick + 0.02) for i in range(36)], 0.05, M["steel"], parent=e, cyclic=True)
        g = cyl(name + "glass", gr, 0.06, (gx, gy, thick - 0.02), M["glass"], parent=e, verts=32, bevel=0.02)
        g.scale = (1.0, 1.15, 1.0)
    return e


# ---------------------------------------------------------------------------------------------------- level 1
def level1():
    disc("disc", S.L1_DISC_R, 0.0, S.L1_DISC_H, at=px(*S.L1_DISC_C, Z=0.0))
    c = _plane_pt(S.L1_BALL_C)
    r = S.L1_BALL_R
    zb = c.z - math.sqrt(r * r - S.L1_BELLOWS_R ** 2) + 0.15
    bellows("bellows", S.L1_DISC_H - 0.02, zb, S.L1_BELLOWS_R, S.L1_BELLOWS_RIBS, M["rubber"])
    ball("ball", c, r, M["chrome"])
    q, n = on_ball(c, r, *S.L1_KEY_AT)
    ring = toward(q, n, *S.L1_KEY_RING)
    key("key", q, n, ring, S.L1_KEY_RING_R, 0.1, S.KEY0[1])
    panel("box", c, r, *S.L1_BOX_AT, "box", size=2.4, spin=S.L1_BOX_SPIN, lean=S.L1_BOX_LEAN)


# ---------------------------------------------------------------------------------------------------- level 2
def level2():
    zd = S.L2_DISC_Z
    disc("disc", S.L2_DISC_R, zd, S.L2_DISC_H)
    c = _plane_pt(S.L2_BALL_C)
    r = S.L2_BALL_R
    zb = c.z - math.sqrt(r * r - S.L2_BELLOWS_R ** 2) + 0.2
    bellows("bellows", zd + S.L2_DISC_H - 0.02, zb, S.L2_BELLOWS_R, S.L2_BELLOWS_RIBS, M["rubber"])
    b, tilt, dist = S.L2_HOLE
    nrm = Vector((math.sin(math.radians(tilt)) * math.cos(math.radians(b)),
                  math.sin(math.radians(tilt)) * math.sin(math.radians(b)), math.cos(math.radians(tilt))))
    ball("ball", c, r, M["chrome"], cut=(nrm, dist), inner=M["inner"], wall=S.L2_WALL)
    gears2(c, r, nrm, dist)
    for i, ((sx, sy), kind) in enumerate(S.L2_PANELS):
        panel(f"panel{i}", c, r, sx, sy, kind, size=2.9 if kind == "port" else 2.6, spin=S.L2_PANEL_SPIN[i],
              lean=S.L2_PANEL_LEAN[i], thick=0.3)
    # three needle legs: an arm out of the disc's rim, a steel needle down through its end to the ground
    for i, th in enumerate(S.L2_LEGS):
        a = Vector(S.polar(th, 1.0, 0.0))
        p0 = A + a * (S.L2_DISC_R - 0.3) + Vector((0, 0, zd + 0.16))
        p1 = A + a * S.L2_LEG_D + Vector((0, 0, zd + 0.16))
        tube(f"legarm{i}", [p0, p1], 0.13, M["arm"])
        top = p1 + Vector((0, 0, 1.5))
        cyl(f"legneedle{i}", 0.08, top.z - 0.35, (p1.x, p1.y, 0.35), M["needle"], verts=12, bevel=0.0)
        cyl(f"legtip{i}", 0.08, 0.35, (p1.x, p1.y, 0.35), M["needle"], rot=(180, 0, 0), r2=0.005, verts=12, bevel=0.0)
        sphere(f"legball{i}", 0.22, top, M["needle"])
        cyl(f"legcollar{i}", 0.2, 0.3, (p1.x, p1.y, p1.z - 0.15), M["arm"], verts=16, bevel=0.04)


def under_cut(c, nrm, dist, sx, sy, below):
    """The point the camera sees at Flash px (sx, sy) that lies `below` under a shell's cut plane (normal nrm, dist
    from the shell's middle c)."""
    p, f = cam_ray(sx, sy)
    return p + f * ((dist - below - (p - c).dot(nrm)) / f.dot(nrm))


def leaning(e, sx, sy, lean):
    """The point on the camera ray through (sx, sy) such that a shaft from e to it leans `lean` degrees out of the
    screen's plane toward the camera (0: the shaft lies across the view and keeps its full length on screen)."""
    p, f = cam_ray(sx, sy)
    w = p - e
    across = (w - f * w.dot(f)).length
    return p + f * (-math.tan(math.radians(lean)) * across - w.dot(f))


def to_wall(p, d, c, r):
    """How far from p along d (inside the ball c, r) the ball's inner wall is."""
    oc = p - c
    b = oc.dot(d)
    return -b + math.sqrt(b * b - (oc.dot(oc) - r * r))


def gears2(c, r, nrm, dist):
    """Level 2's mechanism, as Flash (reviewer 7 Nov): two gear wheels on one axle inside the ball, seen nearly
    edge-on through the top hole as two leaning bands of big flat gold tooth tops with dark between (the same build
    as levels 3-4, smaller); the key's stem comes down through the hole between the two rims and its ring bow turns
    about the stem once a loop."""
    gearstack("gears", S.L2_GEARS, c, mat=M["block"])
    foot = gear_gap_point(*S.L2_KEY_FOOT, 0)
    ring = leaning(foot, *S.L2_KEY_RING, S.L2_KEY_LEAN)
    u = (ring - foot).normalized()
    cross = (dist - (foot - c).dot(nrm)) / u.dot(nrm)          # where the shaft passes the opening
    key("key", foot, u, ring, S.L2_KEY_RING_R, 0.14, S.KEY0[2], slot=False, collar=max(0.2, cross - 0.12), tail=1.0)
    print("CHECK gears2: shaft crosses the opening %.2f from the foot; foot at Flash px %.1f %.1f" % (cross, *scr(foot)))


def sphere(name, r, at, mat, n=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=n, v_segments=n // 2, radius=r)
    ob = mesh_ob(name, bm, [mat])
    ob.location = at
    return ob


def on_surface(sx, sy):
    """The first surface the camera sees at Flash pixel (sx, sy), and its normal (built parts only)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    p, f = cam_ray(sx, sy)
    o = p - f * 40
    for _ in range(12):
        ok, loc, nrm, _, ob, _ = SC.ray_cast(dg, o, f)
        if not ok:
            break
        if ob.name.startswith("ball"):
            return loc, nrm.normalized()
        o = loc + f * 1e-3
    raise ValueError(f"({sx}, {sy}) misses the shell")


def to_x(ob):
    """Lay a part built along local Z down along world X (local Z -> world +X, local X -> world +Z)."""
    ob.rotation_euler = Euler((0.0, math.radians(90.0), 0.0), "XYZ")
    return ob


BODY = {}                            # levels 3-4: the barrel's middle and axle, once shell34 has made the body


def tilted(bearing, deg):
    """The unit vector from straight up toward `bearing` by `deg` degrees."""
    v = Vector(S.polar(bearing, math.sin(math.radians(deg)), 0.0))
    v.z = math.cos(math.radians(deg))
    return v.normalized()


def softmin(a, b, k):
    """A smooth minimum of a and b (the two cut planes' distances) over about k: the rounded corner of the opening."""
    if k <= 0:
        return min(a, b)
    h = max(k - abs(a - b), 0.0) / k
    return min(a, b) - h * h * k * 0.25


def screen_axes():
    """World unit vectors along the screen's right and up, and toward the camera."""
    f = cam_fwd()
    right = Vector(S.polar(45.0, 1.0, 0.0))
    return right, right.cross(f), -f


def gear_axle(gp):
    """The gear stack's axle (world unit vector) from its screen lean psi (degrees below horizontal, to the right)
    and q (its cosine toward the camera): along +axle the wheels stand nearer the camera and to the lower right."""
    right, up, v = screen_axes()
    psi = math.radians(gp["psi"])
    m = right * math.cos(psi) - up * math.sin(psi)
    return (m * math.sqrt(1.0 - gp["q"] ** 2) + v * gp["q"]).normalized()


def gearstack(name, gp, c, mat=None):
    """Levels 3-4 (Flash, owner 7 Nov): four separate gold gear wheels on one axle, biggest at the back left, each
    a little smaller toward the front right, dark gaps between; all turn together, slowly (gp["turn"] degrees a
    loop). gp as stack.L3_GEARS; c = the egg's middle (the stack's depth is measured from it)."""
    a = gear_axle(gp)
    p0, f = cam_ray(*gp["c1"])
    c1 = p0 + f * ((c - p0).dot(f) + gp["depth"])
    e = frame_at(name, c1, a, xhint=(0, 0, 1))
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    MOVING.append(hub)
    COGS[hub.name] = (0.0, gp["turn"])
    th, pitch = gp["thick"], gp["pitch"]
    n = len(gp["radii"])
    for i, (r, teeth) in enumerate(zip(gp["radii"], gp["teeth"])):
        gear(f"{name}w{i}", r, teeth, th, (0, 0, i * pitch), mat or M["block34"], (0, 0, 0), tooth=gp["tooth"] / r,
             parent=hub, face_mat=M["gearface"])
        # a dark hub boss either side of each wheel (fills the gap between the rims, as Flash's black gaps)
        cyl(f"{name}hub{i}", min(0.9, r * 0.3), pitch, (0, 0, i * pitch - pitch / 2), M["core34"], parent=hub,
            verts=24, bevel=0.03)
    cyl(name + "axle", 0.22, (n - 1) * pitch + th + 1.2, (0, 0, -th / 2 - 0.6), M["golddark"], parent=hub, verts=16,
        bevel=0.0)
    BODY.update(ga=a, gc1=c1, gp=gp)
    for i in range(n):
        print("CHECK gear %d middle at Flash px %.1f %.1f" % (i + 1, *scr(c1 + a * i * pitch)))
    return e, hub


def gear_gap_point(sx, sy, k):
    """The world point the camera sees at Flash px (sx, sy) in the plane across the gear axle midway between wheels
    k and k+1 (where the key's stem goes down between the rims)."""
    a, c1, gp = BODY["ga"], BODY["gc1"], BODY["gp"]
    mid = c1 + a * ((k + 0.5) * gp["pitch"])
    p, f = cam_ray(sx, sy)
    return p + f * ((mid - p).dot(a) / f.dot(a))


def shell_cutter(n, d, n2, d2, fr, far=30.0, seg=24):
    """The solid taken out of the egg: {p.n > d and p.n2 > d2} (egg-local), its edge rounded to radius fr."""
    e = n.cross(n2).normalized()
    a = n.normalized()
    b = e.cross(a).normalized()
    # 2D: plane 1 is x_a = d; plane 2 is (n2.a) x_a + (n2.b) x_b = d2
    n2a, n2b = n2.dot(a), n2.dot(b)
    q = Vector((d, (d2 - n2a * d) / n2b))                # the corner, in (a, b)
    nn1, nn2 = Vector((1.0, 0.0)), Vector((n2a, n2b)).normalized()
    t1 = Vector((0.0, 1.0))                              # along line 1, into the region of plane 2
    if t1.dot(nn2) < 0:
        t1 = -t1
    t2 = Vector((-nn2.y, nn2.x))                         # along line 2, into the region of plane 1
    if t2.dot(nn1) < 0:
        t2 = -t2
    half = t1.angle(t2) / 2
    m = (t1 + t2).normalized()
    pts = [q + t1 * far]
    if fr > 0:
        ctr = q + m * (fr / math.sin(half))
        p1, p2 = q + t1 * (fr / math.tan(half)), q + t2 * (fr / math.tan(half))
        a1 = math.atan2(*(p1 - ctr).yx)
        a2 = math.atan2(*(p2 - ctr).yx)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for i in range(seg + 1):
            ang = a1 + da * i / seg
            pts.append(ctr + Vector((math.cos(ang), math.sin(ang))) * fr)
    else:
        pts.append(q)
    pts += [q + t2 * far, q + m * far * 2]
    bm = bmesh.new()
    rings = []
    for z in (-far, far):
        rings.append([bm.verts.new(a * p.x + b * p.y + e * z) for p in pts])
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[1])))
    k = len(pts)
    for i in range(k):
        bm.faces.new((rings[0][i], rings[0][(i + 1) % k], rings[1][(i + 1) % k], rings[1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_ob("shellcutter", bm, [M["chrome"]], smooth=False)


def shell34():
    """Flash's tall narrow egg (wider low down, narrowing to the top), its long axis leaning toward the back right; the
    opening cut at a slant on its upper left (a plane tilted from straight up toward the front left), the long gold
    barrel inside along the egg's axis, the cog on the barrel's top end."""
    c = _plane_pt(S.L4_EGG_C if L == 4 else S.L3_EGG_C)
    cut = S.L4_CUT if L == 4 else S.L3_CUT
    u = tilted(*S.L3_EGG_AXIS)
    n = tilted(*cut[:2])
    d = cut[2]
    rc, rt, rb = S.L4_EGG_R if L == 4 else S.L3_EGG_R
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=64, radius=1.0)
    for v in bm.verts:
        z = v.co.z
        k = rc * (1.0 + (S.L4_EGG_TAPER if L == 4 else S.L3_EGG_TAPER) * z)   # wider or narrower toward the top
        v.co = Vector((v.co.x * k, v.co.y * k, z * (rt if z > 0 else rb)))
    x = (n - u * n.dot(u)).normalized()
    rm = Matrix((x, u.cross(x), u)).transposed()
    bmesh.ops.transform(bm, matrix=rm.to_4x4(), verts=bm.verts)
    cut2 = S.L4_CUT2 if L == 4 else S.L3_CUT2
    n2 = tilted(*cut2[:2])
    d2 = cut2[2]
    BODY.update(n2=n2, d2=d2)
    # Flash's opening: the bowl cut low across the front and the high dome at the back right left whole; what lies
    # above the first plane AND in front of the second goes, with the corner between the two cuts rounded (a smooth
    # curved edge where the bowl's rim runs up into the dome, no V). The egg stays whole here; a boolean takes the
    # rounded wedge out after the wall is made (shell_cutter)
    fr = S.L4_CUT_R if L == 4 else S.L3_CUT_R
    rim = [v.co.copy() for v in bm.verts if abs(softmin(v.co.dot(n) - d, v.co.dot(n2) - d2, fr)) < 0.25]
    BODY.update(c=c, n=n, d=d)
    sh = mesh_ob("ballshell", bm, [M["chrome"], M["inner34"]])
    so = sh.modifiers.new("wall", "SOLIDIFY")
    so.thickness, so.offset, so.material_offset, so.use_rim = 0.14, -1.0, 1, True
    sh.location = c
    cu = shell_cutter(n, d, n2, d2, fr)
    cu.location = c
    bo = sh.modifiers.new("opening", "BOOLEAN")
    bo.operation, bo.solver, bo.object = "DIFFERENCE", "EXACT", cu
    bo.material_mode = "TRANSFER"
    cu.hide_render = True
    cu.hide_viewport = True
    BODY["sh"] = sh
    gp = S.L4_GEARS if L == 4 else S.L3_GEARS
    gearstack("gears", gp, c)
    # the static rounded gold boss at the back top (the axle's back bearing cap), in front of the chimney's foot
    bx, by, br, bd = S.L4_BOSS if L == 4 else S.L3_BOSS
    p0, f = cam_ray(bx, by)
    bp = p0 + f * ((c - p0).dot(f) + bd)
    boss = sphere("boss", br, bp, M["cog34"], n=32)
    boss.scale = (1.0, 0.85, 0.75)
    boss.rotation_euler = (0.2, 0.0, math.radians(30))
    lumps = random.Random(77)
    for i in range(5):
        q = bp + Vector((lumps.uniform(-0.6, 0.6), lumps.uniform(-0.6, 0.6), lumps.uniform(-0.3, 0.4))) * br
        sphere(f"bosslump{i}", br * lumps.uniform(0.35, 0.55), q, M["cog34"], n=20)
    return c, sh


def shell_bottom(sh, at, r):
    """The highest point where the shell's underside lies over a ring of radius r round `at` (where the bellows meet
    it), so the bellows reach into the shell all round."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    t = BVHTree.FromObject(sh, dg)
    inv = sh.matrix_world.inverted()
    zs = []
    for i in range(24):
        p = Vector((at.x + r * math.cos(2 * math.pi * i / 24), at.y + r * math.sin(2 * math.pi * i / 24), 0.0))
        hit = t.ray_cast(inv @ p, inv.to_3x3() @ Vector((0, 0, 1)))
        if hit[0] is not None:
            zs.append((sh.matrix_world @ hit[0]).z)
    return max(zs)


def chimney(b, cage=True, hoops=False):
    """The square chimney at the back right: four gold corner posts, dark sides, a white flange with a round hole;
    the gold cage bars down the sides and a flat grey steel bracket strip across them (Flash, levels 3-4); level 4
    adds two gold hoops over the flange."""
    first = len(SC.objects)
    top = px(*S.L3_CHIM_TOP, Y=b.y + S.L3_CHIM_Y)
    z0 = b.z + 1.0
    w = S.L3_CHIM_W
    hgt = top.z - z0
    # Flash's duct bends at the steel plate: upright above it, slanting down toward the body (-Y) below it
    zp = top.z - hgt * 0.4
    th = math.radians(S.L3_CHIM_BEND)
    hl = (zp - z0) / math.cos(th)
    for seg, base, h, tilt in (("up", Vector((top.x, top.y, zp)), top.z - zp, 0.0),
                               ("low", Vector((top.x, top.y - math.sin(th) * hl, zp - math.cos(th) * hl)), hl + 0.2,
                                th)):
        rm = Matrix.Rotation(-tilt, 3, "X")
        rot = (-math.degrees(tilt), 0, 0)
        box(f"chimduct{seg}", (w * 0.86, w * 0.86, h), base, M["hole"], rot=rot, bevel=0.04)   # black, as Flash
        for i, (u, v) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
            box(f"chimpost{seg}{i}", (0.2, 0.2, h + 0.05), base + rm @ Vector((u * w * 0.43, v * w * 0.43, 0)),
                M["gold"], rot=rot, bevel=0.04)
        if cage:             # gold bars down the sides (Flash: levels 3 and 4)
            for i, (u, v) in enumerate(((-1, 0), (0, -1), (1, 0), (0, 1))):
                box(f"chimbar{seg}{i}", (0.12 if u else 0.5, 0.5 if u else 0.12, h * 0.9),
                    base + rm @ Vector((u * w * 0.46, v * w * 0.46, h * 0.05)), M["gold"], rot=rot, bevel=0.03)
        if seg == "low":     # the thin flat grey steel bracket strip round the duct, crossing the bars (Flash)
            for i, (u, v) in enumerate(((-1, 0), (0, -1), (1, 0), (0, 1))):
                box(f"chimstrip{i}", (0.08 if u else w * 1.12, w * 1.12 if u else 0.08, 0.3),
                    base + rm @ Vector((u * w * 0.54, v * w * 0.54, h * 0.5)), M["plate"], rot=rot, bevel=0.02)
    fl = box("chimflange", (w * 1.3, w * 1.3, 0.22), (top.x, top.y, top.z), M["glass"], bevel=0.04)
    cyl("chimhole", w * 0.33, 0.04, (top.x, top.y, top.z + 0.2), M["hole"], verts=32, bevel=0.0)
    lathe("chimlip", [(w * 0.33, top.z + 0.18), (w * 0.4, top.z + 0.18), (w * 0.4, top.z + 0.3), (w * 0.33, top.z + 0.3)],
          (top.x, top.y, 0.0), M["steel"], verts=32)
    for i, (u, v) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        rivet(f"chimrv{i}", (top.x + u * w * 0.52, top.y + v * w * 0.52, top.z + 0.22), None, r=0.1)
    box("chimplate", (w * 1.4, w * 1.2, 0.1), (top.x + 0.1, top.y - 0.1, zp), M["plate"], rot=(0, -24, 0),
        bevel=0.03, origin="centre")
    if hoops:                # level 4: two gold hoops over the flange
        for k, (dx, dy) in enumerate(((1, 0), (0, 1))):
            pts = []
            for i in range(25):
                a = math.pi * i / 24
                s = math.cos(a) * w * 0.62
                pts.append((top.x + dx * s, top.y + dy * s, top.z + 0.2 + math.sin(a) * w * 0.55))
            tube(f"chimhoop{k}", pts, 0.08, M["gold"])
    # lean it as Flash does (the foot toward the front left): turn every chimney part about the foot
    e = bpy.data.objects.new("chimlean", None)
    link(e)
    e.location = (top.x, top.y, top.z)
    bpy.context.view_layer.update()
    for o in list(SC.objects)[first:]:
        if o.parent is None and o is not e:
            o.parent = e
            o.matrix_parent_inverse = e.matrix_world.inverted()
    ax = Vector(S.polar(S.L3_CHIM_LEAN[0] + 90.0, 1.0, 0.0))
    e.rotation_euler = Matrix.Rotation(math.radians(S.L3_CHIM_LEAN[1]), 3, ax).to_euler()
    return top


def bow_plane(hub, on_shaft=False):
    """Flash px -> the key's local frame: the point on the camera ray in the upright plane through the shaft that faces
    the camera, with the key turned as at frame 0 (so the bow's picture at frame 0 is Flash's exactly). on_shaft: in
    the plane through the shaft's line that faces the camera most, so the bow turns about its own middle line."""
    hub.rotation_euler = (0, 0, math.radians(KEYS[hub.name]))
    bpy.context.view_layer.update()
    mw = hub.matrix_world.copy()
    o = mw.translation
    f = cam_fwd()
    nrm = Vector((f.x, f.y, 0.0)).normalized()
    if on_shaft:
        u = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
        nrm = (f - u * f.dot(u)).normalized()
    inv = mw.inverted()

    def to_local(sx, sy):
        p = px(sx, sy, Z=0.0)
        t = (o - p).dot(nrm) / f.dot(nrm)
        return inv @ (p + f * t)
    return to_local


def bow_monster(hub, ln):
    """Level 3: the key's bow, Flash's curly gold wire monster (its centre lines traced from Flash, bows.json)."""
    to_local = bow_plane(hub, on_shaft=True)
    g = BOWS["3"]
    me = bpy.data.meshes.new("keyboww")
    me.from_pydata([tuple(to_local(*p)) for p in g["verts"]], [tuple(e) for e in g["edges"]], [])
    ob = link(bpy.data.objects.new("keyboww", me), hub)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="CURVE")
    ob = bpy.context.view_layer.objects.active
    ob.data.bevel_depth = 0.1
    ob.data.bevel_resolution = 3
    ob.data.use_fill_caps = True
    ob.data.materials.append(M["gold"])
    foot = to_local(*S.L3_BOW_FOOT)
    foot = foot + (foot - Vector((0, 0, ln + 0.3))).normalized() * 0.15   # into the wire
    tube("keybowstem", [(0, 0, ln - 0.05), (0, 0, ln + 0.3), foot], 0.1, M["gold"], parent=hub, smooth=True)


def bow_head(hub, ln):
    """Level 4: the key's bow, Flash's solid gold monster head (its outline traced from Flash, bows.json), thick,
    with soft rounded edges and an eye hole."""
    to_local = bow_plane(hub)
    sh = BOWS["4"]
    bm = bmesh.new()
    th = 0.34
    vs = [bm.verts.new(to_local(*p)) for p in sh["outer"]]
    face = bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=[face])
    n = face.normal.copy()
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=top, vec=n * th)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=-n * th / 2)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    ob = mesh_ob("keybowhead", bm, [M["block"]], parent=hub, bevel=0.1, segs=4)
    # a thick round gold rim along the outline (Flash's head reads as a heavy ring round a flatter face)
    # (the traced outline smoothed first: its pixel steps made the rim lumpy on the right)
    tube("keybowrim", [to_local(q.x, q.y) for q in smooth_loop(relax(sh["outer"], 4), k=4)], 0.27, M["gold"],
         parent=hub, cyclic=True)
    for k, hole in enumerate(sh["holes"]):
        hs = [to_local(*p) for p in hole]
        c = sum(hs, Vector()) / len(hs)
        r = sum((p - c).length for p in hs) / len(hs)
        cut = cyl(f"keybowcut{k}", r * 1.05, th + 0.6, c - n * (th / 2 + 0.3), M["hole"], parent=hub, verts=16,
                  bevel=0.0, rot=tuple(math.degrees(a) for a in n.to_track_quat("Z", "Y").to_euler()))
        cut.hide_render = True
        cut.display_type = "WIRE"
        mo = ob.modifiers.new(f"eye{k}", "BOOLEAN")
        mo.operation = "DIFFERENCE"
        mo.object = cut
        ob.modifiers.move(len(ob.modifiers) - 1, 0)
    foot = to_local(*S.L4_BOW_FOOT)
    foot = foot + (foot - Vector((0, 0, ln + 0.3))).normalized() * 0.3    # into the head
    tube("keybowstem", [(0, 0, ln - 0.05), (0, 0, ln + 0.3), foot], 0.12, M["gold"], parent=hub, smooth=True)


def bow_skull(hub, ln):
    """Level 4: the key's bow, Flash's solid gold monster skull: a round head with a heavy rim, two big eye holes and
    a small nose hole cut through, two short horns, a square jaw with teeth below it on the stem. Built in the plane
    through the shaft that faces the camera at the key's frame-0 angle (turn() shifts when it faces the camera)."""
    to_local = bow_plane(hub, on_shaft=True)     # the plane through the shaft that faces the camera most
    sk = S.L4_SKULL
    z = Vector((0, 0, 1))                        # the head stands on the shaft's line and turns about it, as Flash
    c0 = Vector((0, 0, ln))
    r = to_local(-30.0, -75.0) - to_local(-40.0, -75.0)
    r = (r - z * r.dot(z)).normalized()
    nn = r.cross(z)

    def mat(u, v, w=0.0):
        m = Matrix((r, z, nn)).transposed().to_4x4()
        m.translation = c0 + r * u + z * v + nn * w
        return m

    def plate(name, prof, th, at, mt, bevel):
        """a flat plate: the closed (u, v) outline extruded th through the bow plane."""
        bm = bmesh.new()
        vs = [bm.verts.new((u, v, -th / 2)) for u, v in prof]
        f = bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=[f])
        if f.normal.z < 0:
            f.normal_flip()
        ex = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, verts=[g for g in ex["geom"] if isinstance(g, bmesh.types.BMVert)], vec=(0, 0, th))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bmesh.ops.transform(bm, matrix=mat(*at), verts=bm.verts[:])
        return mesh_ob(name, bm, [mt], parent=hub, bevel=bevel, segs=3)

    def cutter(name, prof, at, target):
        o = plate(name, prof, 2.0, at, M["hole"], 0.0)
        o.hide_render = True
        o.display_type = "WIRE"
        b = target.modifiers.new(name, "BOOLEAN")
        b.operation, b.object, b.solver = "DIFFERENCE", o, "EXACT"
        target.modifiers.move(len(target.modifiers) - 1, 0)      # cut before the bevel rounds the edges
        return o

    def oval(rx, ry, n=28, cx=0.0, cy=0.0):
        return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]

    R, cv, jv = sk["r"], sk["head_v"], sk["jaw_v"]
    head = plate("keybowhead", oval(R, R * 0.96, 48), sk["th"], (0, cv), M["block"], 0.12)
    jw, jh = sk["jaw"]
    jaw_prof = [(u * jw / 2, v * jh / 2) for u, v in rounded_poly([(-1, -1), (1, -1), (1, 1), (-1, 1)], 0.35, 4)]
    jaw = plate("keybowjaw", jaw_prof, sk["th"] * 0.85, (0, jv), M["gold"], 0.08)
    for i, (sx, sy) in enumerate(((-1, 1), (1, 1))):
        ex, ey, erx, ery = sk["eye"]
        cutter(f"keybowcut{i}", oval(erx, ery, 24, sx * ex, ey), (0, cv), head)
    cutter("keybowcut2", [(-0.14, 0.06), (0.14, 0.06), (0.0, -0.18)], (0, cv + sk["nose"]), head)
    for i in range(4):                                   # gaps between the teeth
        u = (i - 1.5) * jw / 4.4
        cutter(f"keybowcut{3 + i}", [(u - 0.045, -jh), (u + 0.045, -jh), (u + 0.045, -jh * 0.1), (u - 0.045, -jh * 0.1)],
               (0, jv), jaw)
    # the heavy rim round the head (Flash's head reads as a thick ring round a flatter face)
    tube("keybowrim", [c0 + z * cv + r * (R * math.cos(a)) + z * (R * 0.96 * math.sin(a)) for a in
                       (2 * math.pi * i / 60 for i in range(60))], sk["rim"], M["gold"], parent=hub, cyclic=True)
    for i, sx in enumerate((-1, 1)):                     # short horns on the head's upper corners
        a = math.radians(90 - sx * sk["horn"][0])
        p0 = c0 + z * cv + (r * math.cos(a) + z * math.sin(a)) * (R * 0.92)
        d = (r * math.cos(a - sx * 0.35) + z * math.sin(a - sx * 0.35))
        tube(f"keybowhorn{i}", [p0, p0 + d * sk["horn"][1] * 0.6, p0 + d * sk["horn"][1] + r * sx * 0.08], 0.15,
             M["gold"], parent=hub, r_end=0.04, smooth=True)
    # the neck between the stem's end and the jaw
    cyl("keybowneck", 0.15, jv - jh / 2 + 0.2, c0 - z * 0.1, M["gold"], parent=hub, verts=16, bevel=0.0)
    return head, jaw


def relax(pts, n):
    """A closed 2D loop with each point moved n times halfway to its neighbours' middle."""
    pts = [Vector(p) for p in pts]
    for _ in range(n):
        m = len(pts)
        pts = [pts[i] * 0.5 + (pts[i - 1] + pts[(i + 1) % m]) * 0.25 for i in range(m)]
    return pts


def smooth_loop(pts, k=6):
    """A closed Catmull-Rom loop through 2D points."""
    out = []
    n = len(pts)
    for i in range(n):
        p0, p1, p2, p3 = (Vector(pts[(i + j) % n]) for j in (-1, 0, 1, 2))
        for s in range(k):
            t = s / k
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out


def hexnut(name, at, r, h, mat):
    return cyl(name, r, h, at, mat, verts=6, bevel=0.05)


def level34():
    lv4 = L == 4
    zb = S.L4_BASE_H if lv4 else 0.0           # level 4 stands everything on its wooden base
    if lv4:
        # Flash's base: a wooden ring under the bellows (grass shows inside it) with a round pad under each pillar
        g = A
        r0, r1 = S.L4_BASE_R - S.L4_BASE_W, S.L4_BASE_R
        h = S.L4_BASE_H
        # Flash: a tan LUMPY ring of rounded bone/sandbag lumps, not a flat turned disc
        wd = painted("sandbag", (198, 168, 118), rough=0.85, wear=(150, 118, 76), scale=3.0)
        lathe("disc", [(r0 + 0.1, 0.0), (r1 - 0.1, 0.0), (r1, 0.06), (r1, h * 0.6), (r1 - 0.12, h * 0.7),
                       (r0 + 0.12, h * 0.7), (r0, h * 0.6), (r0, 0.06)], (g.x, g.y, 0.0), wd, verts=72)
        cnt, lr, lj = S.L4_BASE_LUMPS
        lq = random.Random(4040)
        for i in range(cnt):
            th = 360.0 * (i + lq.uniform(-0.3, 0.3)) / cnt
            rr = lq.uniform(r0 + lr * 0.6, r1 - lr * 0.6)
            q = g + Vector(S.polar(th, rr, 0.0))
            lump = sphere(f"baselump{i}", lr * lq.uniform(0.8, 1.2), (q.x, q.y, h * 0.45 * lq.uniform(0.6, 1.0)), wd,
                          n=18)
            lump.scale = (lq.uniform(0.9, 1.4), lq.uniform(0.8, 1.1), lq.uniform(0.55, 0.75) * (1 + lj * lq.uniform(-1, 1)))
            lump.rotation_euler = (0, 0, math.radians(lq.uniform(0, 180)))
        for i, th in enumerate((225.0, 45.0, -45.0, 135.0)):
            q = A + Vector(S.polar(th, S.L3_FOOT_D, 0.0))
            disc(f"basepad{i}", S.L4_PAD_R, 0.0, h, at=q, mat=wd, verts=40)
    # the dark gold cog under the bellows' plate (Flash: small, shallow teeth, mostly in shadow, narrower than the
    # bellows; level 4: hung with the bellows over the ring's hole)
    gr = S.L4_GCOG_R if lv4 else S.L3_GCOG_R
    zc = zb + S.L3_BELLOWS_Z - 0.55
    gear("groundcog", gr, 20, 0.34, (A.x, A.y, zc), M["cog34"], (0, 0, 0), tooth=0.07)
    cyl("groundcoghub", gr * 0.72, S.L3_BELLOWS_Z - S.L3_GCOG_Z, (A.x, A.y, S.L3_GCOG_Z + zb), M["core34"], verts=48)
    b, sh = shell34()
    top_b = shell_bottom(sh, A, S.L3_BELLOWS_R * S.L3_BELLOWS_IN) + 0.2   # the egg sits on the bellows, as Flash
    # Flash's bellows: wide flat rings on a grey plate
    zp = zb + S.L3_BELLOWS_Z
    cyl("bellowsplate", S.L3_PLATE_R, S.L3_PLATE_H, (A.x, A.y, zp - 0.04), M["nut"], verts=64, bevel=0.06)
    bellows("bellows", zp + S.L3_PLATE_H - 0.06, top_b, S.L3_BELLOWS_R, S.L3_BELLOWS_RIBS, M["rubber"])
    # four feet: an arm out of the bellows to a threaded post with a nut on top and a nut foot on the ground
    # (level 4: steel pillars on the wooden base instead, with dark collars where the arms meet them)
    for i, th in enumerate((225.0, 45.0, -45.0, 135.0)):
        a = Vector(S.polar(th, 1.0, 0.0))
        p = A + a * S.L3_FOOT_D
        za = zb + (S.L3_ARM_Z if lv4 else S.L3_BOLT_Z)
        tube(f"legarm{i}", [A + a * (S.L3_BELLOWS_R - 0.2) + Vector((0, 0, za)),
                            p - a * (0.0 if lv4 else 0.45) + Vector((0, 0, za))], 0.2, M["rubber"])
        if lv4:
            cyl(f"legpillar{i}", S.L4_PILLAR_R, S.L4_PILLAR_TOP - zb, (p.x, p.y, zb), M["steel"], verts=28, bevel=0.06)
            cyl(f"legcollar{i}", S.L4_PILLAR_R + 0.14, 0.5, (p.x, p.y, za - 0.25), M["rubber"], verts=28, bevel=0.06)
            cyl(f"legcap{i}", S.L4_PILLAR_R + 0.05, 0.12, (p.x, p.y, S.L4_PILLAR_TOP), M["steel"], verts=28,
                bevel=0.04)
        else:
            # Flash's short bolt: a small hex nut on the ground, a short thread, the arm's black ring round the post and
            # a small round cap on top
            hexnut(f"legfoot{i}", (p.x, p.y, 0.0), S.L3_NUT_R, 0.45, M["nut"])
            cyl(f"legrod{i}", 0.24, za - 0.3, (p.x, p.y, 0.4), M["needle"], verts=14, bevel=0.0)
            for k in range(int((za - 0.75) / 0.14)):
                tube(f"legthread{i}-{k}", [(p.x + 0.26 * math.cos(2 * math.pi * j / 12), p.y + 0.26 * math.sin(
                    2 * math.pi * j / 12), 0.55 + k * 0.14) for j in range(12)], 0.03, M["needle"], cyclic=True)
            tube(f"legring{i}", [(p.x + 0.46 * math.cos(2 * math.pi * j / 24), p.y + 0.46 * math.sin(
                2 * math.pi * j / 24), za) for j in range(24)], 0.24, M["rubber"], cyclic=True)
            cyl(f"legnut{i}", 0.5, 0.75, (p.x, p.y, za + 0.12), M["nut"], verts=28, bevel=0.12)
    chimney(b, cage=True, hoops=lv4)
    # panels: on whatever shell part the camera sees at Flash's place
    for i, ((sx, sy), kind) in enumerate(S.L4_PANELS if lv4 else S.L3_PANELS):
        panel(f"panel{i}", None, S.L3_BODY_R, sx, sy, "vent" if (lv4 and kind == "port") else kind, size=2.5,
              spin=S.L3_PANEL_SPIN[i], lean=S.L3_PANEL_LEAN[i], thick=0.3)
    # the key (Flash): its stem goes straight down between the first and second gear wheels (no bearing block: it
    # disappears between the rims); the bow turns about the stem's line
    foot = gear_gap_point(*(S.L4_KEY_FOOT if lv4 else S.L3_KEY_FOOT), 0)
    if lv4:
        # level 4: the stem leans up-left ~35 degrees; the skull turns about the stem's line, one turn a loop
        # (edge-on at Flash's frame 13, lying along the line from the foot to L4_KEY_AXIS)
        far = leaning(foot, *S.L4_KEY_AXIS, S.L4_AXIS_LEAN)
        a, b, q = Vector(scr(foot)), Vector(scr(far)), Vector(S.L4_BOW_FOOT)
        tip = foot + (far - foot) * ((q - a).dot(b - a) / (b - a).length_squared)
    else:
        # level 3: Flash's key turns about the line from the foot up through its bow (edge-on, at Flash's frame 13,
        # the bow lies along it), so the bow stays over the opening all round the turn; the stem ends where that
        # line passes Flash's bow foot
        far = leaning(foot, *S.L3_KEY_AXIS, S.L3_AXIS_LEAN)
        a, b, q = Vector(scr(foot)), Vector(scr(far)), Vector(S.L3_BOW_FOOT)
        tip = foot + (far - foot) * ((q - a).dot(b - a) / (b - a).length_squared)
    u = (tip - foot).normalized()
    key("key", foot, u, tip + u * 0.3, 0.3, 0.13, S.KEY0[L], bow=bow_skull if lv4 else bow_monster, slot=False,
        collar=0.35, tail=1.2)
    print("CHECK key34: foot at Flash px %.1f %.1f, tip %.1f %.1f" % (*scr(foot), *scr(tip)))


def build():
    {1: level1, 2: level2, 3: level34, 4: level34}[L]()


def turn(frame):
    """Turn the moving parts to Flash frame `frame`: the key once round a loop, the gears a few teeth (COGS)."""
    f = frame / FRAMES
    for hub in MOVING:
        if hub.name in KEYS:              # the bow faces the camera (as built) at Flash's frame S.KEY_FACE[L]
            fk = (frame - S.KEY_FACE.get(L, 0)) / FRAMES
            hub.rotation_euler = (0, 0, math.radians(KEYS[hub.name] + S.KEY_TURN[L] * 360.0 * fk))
        elif hub.name in COGS:
            ph, rate = COGS[hub.name]
            hub.rotation_euler = (0, 0, math.radians(ph + rate * f))
        else:
            hub.rotation_euler = (0, 0, 0)


def studio(nt, bg, to_sun):
    """What the polished metals mirror (glossy rays only; the diffuse light stays the sky above): Flash's chrome is
    pale silver with a bright soft highlight up left, a grey band a little under the ball's middle (the horizon) and
    light ground below; Codex Look 3 the same with a stronger contrast."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = -1.0, 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs[0])
    rmp = nt.nodes.new("ShaderNodeValToRGB")
    el = rmp.color_ramp.elements
    stops = json.loads(os.environ.get("PB_STOPS", "null")) or [
        (0.0, (0.2, 0.21, 0.23)), (0.35, (0.28, 0.29, 0.31)), (0.44, (0.36, 0.37, 0.39)), (0.47, (0.22, 0.23, 0.25)),
        (0.485, (0.11, 0.12, 0.14)), (0.51, (0.15, 0.17, 0.21)), (0.56, (0.27, 0.3, 0.37)), (0.75, (0.43, 0.47, 0.56)),
        (1.0, (0.62, 0.66, 0.75))]
    # levels 3-4 use the same studio as levels 1-2 (locker-3d-14: the lighter L3/L4 sky read matte blue-grey; the
    # L1/L2 studio gives Flash's white highlight up left on the dome and the darker lower half)
    stops = [(p, tuple(c)) for p, c in stops]
    el[0].position, el[0].color = stops[0][0], stops[0][1] + (1,)
    el[1].position, el[1].color = stops[-1][0], stops[-1][1] + (1,)
    for pos, col in stops[1:-1]:
        e = el.new(pos)
        e.color = col + (1,)
    nt.links.new(mr.outputs[0], rmp.inputs[0])
    # the soft window toward the sun (the white highlight up left)
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(tc.outputs["Generated"], dot.inputs[0])
    dot.inputs[1].default_value = tuple(to_sun)
    win = nt.nodes.new("ShaderNodeMapRange")
    win.interpolation_type = "SMOOTHSTEP"
    # levels 3-4: a wider window, so the egg carries Flash's broad white highlight
    sw = STUDIO_WIN
    win.inputs[1].default_value, win.inputs[2].default_value = sw, 0.99
    win.inputs[3].default_value, win.inputs[4].default_value = 0.0, STUDIO_WIN_POW
    nt.links.new(dot.outputs["Value"], win.inputs[0])
    add = nt.nodes.new("ShaderNodeMix")
    add.data_type, add.blend_type = "RGBA", "ADD"
    nt.links.new(win.outputs[0], add.inputs[0])
    nt.links.new(rmp.outputs[0], add.inputs[6])
    add.inputs[7].default_value = (1.0, 1.0, 1.0, 1)
    # darker on the right (away from the sun), as Flash's metals
    d2 = nt.nodes.new("ShaderNodeVectorMath")
    d2.operation = "DOT_PRODUCT"
    nt.links.new(tc.outputs["Generated"], d2.inputs[0])
    d2.inputs[1].default_value = (-0.81, -0.59, 0.0)
    side = nt.nodes.new("ShaderNodeMapRange")
    side.inputs[1].default_value, side.inputs[2].default_value = -1.0, 1.0
    side.inputs[3].default_value, side.inputs[4].default_value = STUDIO_SIDE, 1.25
    nt.links.new(d2.outputs["Value"], side.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    nt.links.new(add.outputs[2], mul.inputs[6])
    nt.links.new(side.outputs[0], mul.inputs[7])
    # soft clouds and patches in it, so the mirror shows reflections rather than a smooth grey
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.6
    nz.inputs["Detail"].default_value = 3.0
    nz.inputs["Roughness"].default_value = 0.5
    nt.links.new(tc.outputs["Generated"], nz.inputs["Vector"])
    nzr = nt.nodes.new("ShaderNodeMapRange")
    nzr.inputs[1].default_value, nzr.inputs[2].default_value = 0.3, 0.7
    nzr.inputs[3].default_value, nzr.inputs[4].default_value = 1.0 - STUDIO_NOISE, 1.0 + STUDIO_NOISE
    nt.links.new(nz.outputs["Fac"], nzr.inputs[0])
    mul2 = nt.nodes.new("ShaderNodeMix")
    mul2.data_type, mul2.blend_type = "RGBA", "MULTIPLY"
    mul2.inputs[0].default_value = 1.0
    nt.links.new(mul.outputs[2], mul2.inputs[6])
    nt.links.new(nzr.outputs[0], mul2.inputs[7])
    bg2 = nt.nodes.new("ShaderNodeBackground")
    bg2.inputs[1].default_value = STUDIO_K
    nt.links.new(mul2.outputs[2], bg2.inputs[0])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Glossy Ray"], mix.inputs[0])
    nt.links.new(bg.outputs[0], mix.inputs[1])
    nt.links.new(bg2.outputs[0], mix.inputs[2])
    wo = next(n for n in nt.nodes if n.type == "OUTPUT_WORLD")
    nt.links.new(mix.outputs[0], wo.inputs["Surface"])


STUDIO_WIN = float(os.environ.get("PB_SWIN", 0.8))
STUDIO_WIN_POW = float(os.environ.get("PB_SWINP", 0.5))
STUDIO_SIDE = float(os.environ.get("PB_SSIDE", 0.6))
STUDIO_K = float(os.environ.get("PB_SK", 1.0))
STUDIO_NOISE = float(os.environ.get("PB_SNOISE", 0.25))
STRIP = tuple(float(v) for v in os.environ.get("PB_STRIP", "120000,80,3,0,0,-45").split(","))   # energy, length,
#                     width, bearing and height off the sun's direction (degrees), roll about its own axis (degrees)


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
    el[0].position, el[0].color = 0.42, (0.15, 0.18, 0.19, 1)
    e3 = el.new(0.49)                       # the Locker's chrome mirrors a dark olive band at the horizon, as Flash's
    e3.color = (0.07, 0.08, 0.045, 1)
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
    studio(nt, bg, to_sun)
    # a long strip window up left that only the polished metals see: Flash's white streak across the chrome
    en, ln, wd, daz, de, roll = STRIP
    if en > 0:
        st_d = bpy.data.lights.new("strip", "AREA")
        st_d.shape = "RECTANGLE"
        st_d.size, st_d.size_y = wd, ln
        st_d.energy = en
        st = bpy.data.objects.new("strip", st_d)
        link(st)
        az0 = math.degrees(math.atan2(to_sun.y, to_sun.x)) + daz
        el0 = math.degrees(math.asin(to_sun.z)) + de
        d = Vector((math.cos(math.radians(el0)) * math.cos(math.radians(az0)),
                    math.cos(math.radians(el0)) * math.sin(math.radians(az0)), math.sin(math.radians(el0))))
        st.location = A + Vector((0, 0, 5)) + d * 30
        st.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        st.rotation_euler.rotate_axis("Z", math.radians(roll))
        st.visible_diffuse = False
        st.visible_camera = False
        st.visible_transmission = False
        st.visible_volume_scatter = False
    # the ground: a shadow catcher
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, GROUND))
    g = bpy.context.active_object
    g.name = "ground"
    g.is_shadow_catcher = True
    g.data.materials.append(flat("groundref", (70, 92, 48), rough=0.9))
    if not os.environ.get("PB_GROUNDREF"):
        # (locker-3d-13) the chrome's lower half mirrored the green ground and read as tinted glass; Flash's is darker
        # grey metal there, so the chrome sees the studio's dark grey below the horizon instead (every level)
        g.visible_glossy = False
    if not os.environ.get("PB_NOBOX"):       # levels 1-2: the streak card; 3-4: the dome's soft highlight
        softbox()
    return cam


# levels 3-4: Flash px of the dome point that carries the broad white highlight, the softbox's size and brightness
# Flash px of the highlight's middle on the shell, the card's size (one number: round; (long, thin): a strip, Flash's
# sharp white streak at levels 1-2), its brightness, and (strips) the card's roll about its own normal in degrees
SOFTBOX = {1: (-8.0, -12.0, (34.0, 2.2), 6.0, 20.0), 2: (-25.0, -25.0, (30.0, 2.4), 6.0, 20.0),
           3: (6.0, -32.0, 28.0, 2.6), 4: (16.0, -24.0, 28.0, 2.6)}
if os.environ.get("PB_BOX"):
    SOFTBOX[L] = tuple(float(v) for v in os.environ["PB_BOX"].split(","))


def softbox():
    """Levels 3-4 (locker-3d-14): the big egg's dome mostly mirrors the dim sky near the horizon and read matte
    blue-grey; Flash's has a broad white highlight on the dome's upper left. A white card seen only by glossy rays,
    placed where the camera ray through that dome point bounces to, gives it (diffuse light unchanged)."""
    sx, sy, size, k, *roll = SOFTBOX[L]
    strip = isinstance(size, tuple)
    if strip:
        (size, thin), roll = size, (roll or [0.0])[0]
    p0, f = cam_ray(sx, sy)
    dg = bpy.context.evaluated_depsgraph_get()
    o = p0 - f * 80
    for _ in range(8):       # past any part in front of the egg (the drum's blocks)
        hit, loc, nrm, _i, ob, _m = bpy.context.scene.ray_cast(dg, o, f)
        if not hit or ob.name.startswith("ball"):
            break
        o = loc + f * 0.01
    if not hit or not ob.name.startswith("ball"):
        print("CHECK softbox: no shell under", sx, sy, ob.name if hit else None)
        return
    r = f - 2 * f.dot(nrm) * nrm
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc + r * 25)
    b = bpy.context.active_object
    b.name = "softbox"
    b.rotation_euler = (-r).to_track_quat("Z", "Y").to_euler()
    if strip:                # a long thin card: Flash's sharp diagonal streak across the chrome ball
        b.rotation_euler.rotate_axis("Z", math.radians(roll))
        b.scale = (1.0, thin / size, 1.0)
    m = bpy.data.materials.new("softbox")
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        if nd.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(nd)
    em = nt.nodes.new("ShaderNodeEmission")
    # a round card, bright in the middle and fading to its rim, so the highlight is soft like Flash's (a flat square
    # card read as a hard white patch)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2.0 / size, 2.0 / (thin if strip else size), 1.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    gr = nt.nodes.new("ShaderNodeTexGradient")
    gr.gradient_type = "SPHERICAL"
    nt.links.new(mp.outputs["Vector"], gr.inputs["Vector"])
    fall = nt.nodes.new("ShaderNodeMapRange")
    fall.interpolation_type = "SMOOTHSTEP"
    fall.inputs[1].default_value, fall.inputs[2].default_value = 0.0, 0.7
    fall.inputs[3].default_value, fall.inputs[4].default_value = 0.0, 1.0
    nt.links.new(gr.outputs["Fac"], fall.inputs[0])
    em.inputs["Strength"].default_value = k
    # see-through where it fades, so the sky still shows round it (an opaque card's dark rim read as a black patch)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fall.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], next(nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL").inputs["Surface"])
    b.data.materials.append(m)
    b.visible_camera = b.visible_diffuse = b.visible_shadow = b.visible_transmission = False
    b.visible_volume_scatter = False
    print("CHECK softbox at", tuple(round(v, 1) for v in b.location))


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



FAMILY = (("disc", "base"), ("bellows", "bellows"), ("ball", "shell"), ("key", "key"), ("box", "panel"),
          ("panel", "panel"), ("barrel", "barrel"), ("leg", "leg"), ("groundcog", "cog"), ("cog", "backcog"),
          ("chim", "chimney"))
MASONRY = ()            # families allowed to touch each other (none here)



def family(o):
    n = o.name.split(".")[0]
    p = o
    while p.parent is not None:                 # a moving part's pieces belong to it whatever they are called
        p = p.parent
    if p.type == "EMPTY":
        n = p.name
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


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
    turn(0)
    if MODE == "check":
        # which parts touch or pass through others (evaluated meshes, BVH overlap), at three points of the turn; and
        # how close each moving part comes to anything else while it turns
        for k in (0, FRAMES // 3, 2 * FRAMES // 3):
            turn(k)
            tr = trees()
            obs = list(tr.values())
            hits = {}
            for i, (a, ta, _) in enumerate(obs):
                for b, tb, _ in obs[i + 1:]:
                    fa, fb = family(a), family(b)
                    if fa == fb or (fa in MASONRY and fb in MASONRY):
                        continue
                    n = len(ta.overlap(tb))
                    if n:
                        hits.setdefault(tuple(sorted((fa, fb))), []).append((a.name, b.name, n))
            for key, v in sorted(hits.items()):
                print("CHECK f%02d" % k, key, sum(x[2] for x in v), v[:3])
            fams = sorted({family(o) for o, _, _ in obs if under_moving(o)})
            for fm in fams:
                best = (9.0, "", "", "")
                for o, t, vs in obs:
                    if family(o) != fm:
                        continue
                    for o2, t2, _ in obs:
                        f2 = family(o2)
                        if f2 == fm:
                            continue
                        for v in vs[::2]:
                            hit = t2.find_nearest(v, best[0])
                            if hit[0] is not None and hit[3] < best[0]:
                                best = (hit[3], f2, o.name, o2.name)
                print("CLEAR f%02d %s nearest other part %.3f (%s)" % (k, fm, best[0], " ".join(best[1:])))
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
            print("GAP %-7s in front of %-7s: least depth gap %.3f, rays under 0.05: %d of %d (%.1f px2), screen box "
                  "x %.1f..%.1f y %.1f..%.1f" % (f1, f2, d, near, n, near * step * step, *bb[0::2], *bb[1::2]))
        print("DONE gap")
        return
    if MODE == "track":                      # the wooden handle's screen middle (Flash px) at every second frame
        knobs = [o for o in SC.objects if o.name.endswith("handleknob")]
        for k in range(0, FRAMES, 2):
            turn(k)
            bpy.context.view_layer.update()
            pts = [scr(o.matrix_world @ Vector(c)) for o in knobs for c in o.bound_box]
            print("TRACK f%02d x %.0f y %.0f" % (k, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
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
        turn(int(os.environ.get("PB_FIT_FRAME", 0)))    # a quick look at another frame of the loop
        sc.cycles.samples = 24
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        sc.render.filepath = str(out / f"fit-L{L}.png")
        bpy.ops.render.render(write_still=True)
        return
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE in ("still", "base"):
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 384))
        for o in moving_objs:
            o.visible_camera = False
            o.visible_shadow = False
        sc.render.filepath = str(out / f"L{L}-base.png")
        bpy.ops.render.render(write_still=True)
        # the building alone (no ground shadow), for the outline check
        for o in moving_objs:
            o.visible_camera = True
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 32
        sc.render.filepath = str(out / f"L{L}-alone.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects["ground"].hide_render = False
        for o in moving_objs:
            o.visible_camera = False
    if MODE in ("still", "anim"):
        n = 1 if MODE == "still" else FRAMES
        sc.cycles.samples = int(os.environ.get("PB_PART_SAMPLES", 256))
        for o in all_static():
            o.is_holdout = True
        for o in moving_objs:
            o.visible_camera = True
            o.visible_shadow = True
        bpy.data.objects["ground"].hide_render = True
        bpy.context.view_layer.update()
        # The render region round the moving parts at every frame of the turn, not only at rest: one taken at rest
        # cut the crank's handle off wherever it swung past it (seen in the game, 31 Oct 2026).
        boxes = []
        for k in range(FRAMES):
            turn(k)
            bpy.context.view_layer.update()
            boxes.append(border_of(moving_objs, pad=40))
        sc.render.use_border = True
        sc.render.use_crop_to_border = False
        sc.render.border_min_x = min(b[0] for b in boxes)
        sc.render.border_max_x = max(b[1] for b in boxes)
        sc.render.border_min_y = min(b[2] for b in boxes)
        sc.render.border_max_y = max(b[3] for b in boxes)
        for k in range(n):
            turn(k)
            bpy.context.view_layer.update()
            sc.render.filepath = str(out / f"L{L}-parts-{k:02d}.png")
            bpy.ops.render.render(write_still=True)
    print("DONE", L, MODE)


main()
