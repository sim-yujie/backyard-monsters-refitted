"""store.py : the General Store (Flash building 12) as a 3D model, in the approved Twig/Pebble/Putty/Hatchery/HCC family
(same camera, light, render settings and scale; no outline). Flash has one look for every level and no animation, so
there is one model and one still. The parts and their places are in stack.py; the matchbook's print is matchbook.png
(mbtex.py). The shared helpers (materials, meshes, camera, checks) are the HCC's hcc.py, unchanged.

    blender -b --factory-startup -P store.py -- 1 fit      work/fit-L1.png    quick render without the ground, 4 px per Flash px
    blender -b --factory-startup -P store.py -- 1 still    render/L1-raw.png (with the ground shadow), render/L1-alone.png
    blender -b --factory-startup -P store.py -- 1 check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P store.py -- 1 gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P store.py -- 1 probe sx sy ...   what the camera sees first through Flash pixels
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
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the die's middle on the ground)
GROUND = S.GROUND
FRAME = (-50, -44, 80, 72)            # the canvas in Flash px (as fref.FRAME)
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1200)


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


def crumple(mat, scale, strength):
    """Crumpled paper: the creases of a Voronoi pattern bump the surface (added to the bump already there)."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    vo = nt.nodes.new("ShaderNodeTexVoronoi")
    vo.feature = "DISTANCE_TO_EDGE"
    vo.inputs["Scale"].default_value = scale
    bu = nt.nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = strength
    bu.inputs["Distance"].default_value = 0.03
    nt.links.new(vo.outputs["Distance"], bu.inputs["Height"])
    old = b.inputs["Normal"].links[0].from_socket if b.inputs["Normal"].links else None
    if old is not None:
        nt.links.new(old, bu.inputs["Normal"])
    nt.links.new(bu.outputs[0], b.inputs["Normal"])


def crumple_geo(ob, size, amount, seed=0):
    """Crumple a mesh: a fine subdivision pushed along its normals by a Voronoi texture (sharp creases, flat facets)."""
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    sub.subdivision_type = "SIMPLE"
    tx = bpy.data.textures.new(f"{ob.name}-crumple", "VORONOI")
    tx.noise_scale = size
    tx.distance_metric = "DISTANCE"
    dm = ob.modifiers.new("crumple", "DISPLACE")
    dm.texture = tx
    dm.texture_coords = "GLOBAL"
    dm.strength = amount
    dm.mid_level = 1.0                    # only inward: no pushing into the parts around it
    ob.modifiers.new("smooth", "SMOOTH").factor = 0.3
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


def printed(name, path, rough=0.62, dirt=0.3):
    """Printed card: the picture `path` on the part's UV map, a fine paper grain, darker low down and in the creases."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    im = t.n("ShaderNodeTexImage")
    im.image = bpy.data.images.load(str(path))
    im.interpolation = "Cubic"
    col = t.grime(im.outputs["Color"], GROUND, 4.0, dirt, 0.6)
    t.set(**{"Base Color": col, "rough": rough, "spec": 0.3})
    t.bump(t.noise(t.coords(), 40, 3.0, 0.6), 0.04, 0.01)
    MATS[name] = t.m
    return t.m


def along(name, stops, axis="X", lo=0.0, hi=1.0, space="Generated", rough=0.55, spec=0.4, dirt=0.2, grain=0.0,
          wear=None, scale=4.0, side=0.0, rim=None, wear_amt=0.5):
    """A colour that changes along one axis (Generated: the part's own box 0..1; Object: world units lo..hi), with a
    faint mottle and, if grain, the soft streaks of pale wood along the same axis; rim (colour, strength) greys the
    faces that turn away from the top (Flash shades its sticks' rounded rims grey)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs[space], sep.inputs[0])
    mr = t.n("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = lo, hi
    t.link(sep.outputs[axis], mr.inputs[0])
    out = t.ramp(mr.outputs[0], [(p, srgb(*c)) for p, c in stops])
    v = t.coords()
    if grain:
        k = {"X": (0.6, 14, 14), "Y": (14, 0.6, 14), "Z": (14, 14, 0.6)}[axis]
        g = t.noise(t.coords(scale=k), 1.0, 6.0, 0.6, 0.5)
        out = t.mix(out, t.ramp(g, [(0.3, srgb(150, 140, 136)), (0.7, (1, 1, 1, 1))]), grain, "MULTIPLY")
    if wear:
        n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.2)
        out = t.mix(out, srgb(*wear), t.ramp(n1, [(0.45, (0, 0, 0, 1)), (0.78, (wear_amt,) * 3 + (1,))]))
    if rim:
        geo = t.n("ShaderNodeNewGeometry")
        sz = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sz.inputs[0])
        mr3 = t.n("ShaderNodeMapRange")
        mr3.inputs[1].default_value, mr3.inputs[2].default_value = 0.97, 0.3
        mr3.inputs[3].default_value, mr3.inputs[4].default_value = 0.0, rim[1]
        t.link(sz.outputs["Z"], mr3.inputs[0])
        fac = mr3.outputs[0]
        if len(rim) > 2:                          # only above height rim[2] (world z, fading in over 0.1 below it)
            sp = t.n("ShaderNodeSeparateXYZ")
            t.link(geo.outputs["Position"], sp.inputs[0])
            mr4 = t.n("ShaderNodeMapRange")
            mr4.inputs[1].default_value, mr4.inputs[2].default_value = rim[2] - 0.1, rim[2]
            t.link(sp.outputs["Z"], mr4.inputs[0])
            ml = t.n("ShaderNodeMath", operation="MULTIPLY")
            t.link(fac, ml.inputs[0])
            t.link(mr4.outputs[0], ml.inputs[1])
            fac = ml.outputs[0]
        out = t.mix(out, srgb(*rim[0]), fac)
    if side:
        geo = t.n("ShaderNodeNewGeometry")
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dp.inputs[0])
        dp.inputs[1].default_value = (-0.707, -0.707, 0.0)
        mr2 = t.n("ShaderNodeMapRange")
        mr2.inputs[1].default_value, mr2.inputs[2].default_value = -3.4, 3.4
        mr2.inputs[3].default_value, mr2.inputs[4].default_value = 1.0 - side, 1.0 + side * 0.25
        t.link(dp.outputs["Value"], mr2.inputs[0])
        grey = t.n("ShaderNodeCombineColor")
        for i in range(3):
            t.link(mr2.outputs[0], grey.inputs[i])
        out = t.mix(out, grey.outputs[0], 1.0, "MULTIPLY")
    out = t.grime(out, GROUND, 4.0, dirt, 0.6)
    t.set(**{"Base Color": out, "rough": rough, "spec": spec})
    t.bump(t.noise(v, scale * 6, 4.0, 0.6), 0.04, 0.01)
    MATS[name] = t.m
    return t.m


def lift(mat, col, strength):
    """Flash lights its painted buildings evenly: a faint glow of the part's own colour lifts the side away from the sun."""
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Color"].default_value = srgb(*col)
    b.inputs["Emission Strength"].default_value = strength


def lift_low(mat, s_low, z0, z1):
    """The lift (above) fades to s_low at height z0 (up to its full strength at z1): Flash's die darkens low down,
    and an even glow would wash the grime out."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs[0])
    mr.inputs[1].default_value, mr.inputs[2].default_value = z0, z1
    mr.inputs[3].default_value, mr.inputs[4].default_value = s_low, b.inputs["Emission Strength"].default_value
    nt.links.new(mr.outputs[0], b.inputs["Emission Strength"])


def pip_mat():
    """The pips: grey, shiny round dimples, painted as Flash shades them (dark inside the upper right rim, pale grey low
    on the left, no white), since the sun never reaches the die's right face."""
    t = NT("pip")
    dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(t.n("ShaderNodeNewGeometry").outputs["Normal"], dp.inputs[0])
    dp.inputs[1].default_value = (0.0, -0.55, -0.835)     # bright low on the left (the cut faces' normals point in)
    mr = t.n("ShaderNodeMapRange")              # -0.9..0.9 -> 0..1
    mr.inputs[1].default_value, mr.inputs[2].default_value = -0.9, 0.9
    t.link(dp.outputs["Value"], mr.inputs[0])
    col = t.ramp(mr.outputs[0], [(0.0, srgb(100, 100, 108)), (0.38, srgb(140, 140, 148)), (0.58, srgb(184, 184, 192)),
                                 (0.7, srgb(226, 226, 232)), (0.8, srgb(198, 198, 206)), (1.0, srgb(176, 176, 184))])
    # Flash's pips are mottled, worn silver, not clean
    mot = t.noise(t.coords(), 14.0, 4.0, 0.6)
    col = t.mix(col, srgb(118, 118, 126), t.ramp(mot, [(0.45, (0, 0, 0, 1)), (0.7, (0.45, 0.45, 0.45, 1))]))
    t.set(**{"Base Color": col, "rough": 0.4, "spec": 0.5, "Emission Color": col, "Emission Strength": 0.45})
    t.bump(t.noise(t.coords(), 30, 3.0, 0.6), 0.08, 0.01)
    MATS["pip"] = t.m
    return t.m


def fold_mat():
    """The cover's fold round the die's front corner (Flash: a strip of the cover's red where the print ends, then a
    near-black maroon band with darker creases running down it, browner at the top)."""
    t = NT("fold")
    uv = t.n("ShaderNodeUVMap")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(uv.outputs["UV"], sep.inputs[0])
    mr = t.n("ShaderNodeMapRange")                 # across the band: u from 1 (the crease) to FOLD_U1 (its far edge)
    mr.inputs[1].default_value, mr.inputs[2].default_value = 1.0, FOLD_U1
    t.link(sep.outputs["X"], mr.inputs[0])
    col = t.ramp(mr.outputs[0], [(0.0, srgb(198, 70, 82)), (0.18, srgb(182, 56, 68)), (0.3, srgb(96, 34, 32)),
                                 (0.55, srgb(64, 22, 22)), (0.8, srgb(80, 28, 26)), (1.0, srgb(58, 18, 18))])
    # creases: a few soft dark lines running down the band
    cr = t.noise(t.coords(scale=(4.0, 4.0, 0.25)), 2.0, 2.0, 0.4, 0.2)
    col = t.mix(col, srgb(44, 12, 16), t.ramp(cr, [(0.58, (0, 0, 0, 1)), (0.7, (0.7, 0.7, 0.7, 1))]))
    # browner at the top
    mz = t.n("ShaderNodeMapRange")
    mz.inputs[1].default_value, mz.inputs[2].default_value = 0.7, 1.0
    t.link(sep.outputs["Y"], mz.inputs[0])
    col = t.mix(col, srgb(96, 44, 22), t.ramp(mz.outputs[0], [(0.0, (0, 0, 0, 1)), (1.0, (0.7, 0.7, 0.7, 1))]))
    col = t.grime(col, GROUND, 4.0, 0.2, 0.6)
    t.set(**{"Base Color": col, "rough": 0.85, "spec": 0.25})
    t.bump(cr, 0.1, 0.02)
    MATS["fold"] = t.m
    return t.m


def materials():
    M = {}
    # the die: Flash's brick-red plastic (right face ~143,66,57), matte and a little worn, darker low down
    M["die"] = shiny("die", (178, 70, 54), rough=0.62, metal=0.0, wear=(156, 62, 50), scale=1.6, dirt=0.5, spec=0.3,
                     side=0.25)
    M["pip"] = pip_mat()
    lift(M["die"], (156, 72, 58), 0.55)
    lift_low(M["die"], 0.1, S.DIE_Z0 + 0.3, S.DIE_Z0 + 2.4)
    M["cover"] = printed("cover", HERE / "matchbook.png")
    M["coverback"] = painted("coverback", (190, 56, 66), rough=0.7, wear=(170, 48, 58), dirt=0.3)
    M["striker"] = fold_mat()
    # popsicle sticks: pale wood, white at the back, going pink toward the front and the right
    pinks = ((0.0, 0.1), (0.1, 0.4), (0.55, 0.8), (0.9, 1.0))
    for i, (p0, p1) in enumerate(pinks):
        w, p = (226, 220, 216), (236, 162, 158)
        c0 = tuple(a + (b - a) * p0 for a, b in zip(w, p))
        c1 = tuple(a + (b - a) * p1 for a, b in zip(w, p))
        M[f"stick{i}"] = along(f"stick{i}", [(0.0, c0), (0.45, c0), (1.0, c1)], axis="Y", rough=0.85, spec=0.12,
                               dirt=0.15, grain=0.3, scale=3, rim=((132, 126, 136), 0.9))
    # the strap: a dark tip, tan at its left end, white in the middle, yellow over the right edge (world X)
    # (matte card, as Flash's: a long torn tan piece at the left)
    M["strap"] = along("strap", [(0.0, (130, 80, 46)), (0.04, (184, 120, 70)), (0.2, (206, 148, 96)),
                                 (0.33, (230, 200, 168)), (0.43, (244, 240, 234)), (0.67, (242, 236, 226)),
                                 (0.76, (234, 178, 56)), (1.0, (224, 162, 40))],
                       axis="X", lo=-3.05, hi=S.DIE_A + 0.1, space="Object", rough=0.85, spec=0.15, dirt=0.1,
                       rim=((128, 84, 52), 0.7, S.ZSTICK))            # Flash's brown edges (not the bent end)
    lift(M["strap"], (120, 96, 60), 0.5)
    # Flash's paper: broken white and light pink, crumpled
    M["paper"] = along("paper", [(0.0, (240, 184, 178)), (0.5, (236, 172, 166)), (1.0, (228, 160, 156))], axis="Y",
                       rough=0.85, spec=0.15, dirt=0.05, wear=(252, 242, 240), scale=7, wear_amt=0.5)
    crumple(M["paper"], 9.0, 0.35)
    M["blob"] = flat("blob", (196, 210, 246), rough=0.55)          # the white-blue blob on the strap's left end
    # thumbtacks: Flash's bright old gold discs, dark brass pins
    M["tack"] = shiny("tack", (214, 166, 40), rough=0.3, metal=0.6, side=0.4, wear=(196, 130, 34), scale=2.0,
                      dirt=0.25, coat=0.2, spec=0.4)
    # Flash's front disc is a darker, browner old gold than the others
    M["tackdark"] = shiny("tackdark", (150, 92, 30), rough=0.35, metal=0.6, side=0.4, wear=(108, 60, 22), scale=2.0,
                          dirt=0.3, coat=0.15, spec=0.35)
    M["pin"] = shiny("pin", (176, 132, 60), rough=0.35, metal=0.8, wear=(130, 96, 44), scale=4, dirt=0.05)
    M["wire"] = shiny("wire", (196, 200, 208), rough=0.45, metal=0.4, wear=(140, 146, 156), scale=4, dirt=0.05)
    # the wires lying along the sticks: Flash draws them as dark grey lines
    M["wire2"] = shiny("wire2", (82, 84, 92), rough=0.55, metal=0.3, wear=(70, 72, 80), scale=4, dirt=0.0)
    M["hole"] = flat("hole", (24, 18, 18), rough=1.0)
    return M


def mb_path():
    """The cover's path seen from above: flat along the left face to where the die's corner starts to round, then a
    fold that wraps the corner standing off it (a dark gap between the fold and the die, as Flash's), ending at the
    corner's middle. Returns the points and the path fraction where the print ends (MB_X1) and the fold begins."""
    rc = S.DIE_R
    o = rc + S.MB_GAP
    cx, cy = A - rc, -A + rc
    path = [(S.MB_X0 + (cx - S.MB_X0) * i / 24, cy - o) for i in range(25)]
    for k in range(1, 17):
        a = math.radians(-90 + 45 * k / 16)
        r = o + 0.1 * k / 16
        path.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    ls = sum(math.dist(p, q) for p, q in zip(path, path[1:]))
    return path, (S.MB_X1 - S.MB_X0) / ls


A = S.DIE_A
# the lean: a shear, not a turn, so the die's upright edges stay upright on screen (as Flash's): z drops with y
_tn = math.tan(math.radians(S.TILT))
TILT_M = Matrix(((1, 0, 0, 0), (0, 1, 0, 0), (0, -_tn, 1, _tn * S.TILT_PIVOT[0]), (0, 0, 0, 1)))
FOLD_U1 = 1.0 / mb_path()[1]          # the fold's far edge in the cover's UV (the print fills u 0..1)
M = materials()
ZT = S.ZTOP


def bake(ob):
    """Apply ob's modifiers (a plain mesh again)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me
    return ob


def die():
    """The red die: a box with rounded edges, six pips sunk in its right (+X) face."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 2 * A
        v.co.y *= 2 * A
        v.co.z = S.DIE_Z0 + (v.co.z + 0.5) * S.DIE_H
    d = mesh_ob("die", bm, [M["die"]], bevel=S.DIE_R, segs=5)
    bake(d)
    # the pips: spheres whose caps cut PIP_R wide and PIP_DEPTH deep (the cut faces take the pip's white)
    rs = (S.PIP_R ** 2 + S.PIP_DEPTH ** 2) / (2 * S.PIP_DEPTH)
    bm = bmesh.new()
    zc = S.PIP_Z
    for y in S.PIP_Y:
        for k in (-1, 0, 1):
            bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=rs,
                                      matrix=Matrix.Translation((A + rs - S.PIP_DEPTH, y, zc + k * S.PIP_DZ)))
    cut = mesh_ob("pipcut", bm, [M["pip"]])
    mo = d.modifiers.new("pips", "BOOLEAN")
    mo.operation = "DIFFERENCE"
    mo.object = cut
    try:
        mo.solver = "EXACT"
    except TypeError:
        pass
    mo.material_mode = "TRANSFER"
    bake(d)
    bpy.data.objects.remove(cut)
    return d


def sheet(name, path, z0, z1, nz, mats, split, thick=0.05, warp=0.0, flare=0.0, crumple=0.0):
    """Thin card standing on the XY path (a list of (x, y)), from z0(s) to z1 (s = 0..1 along the path), UV over the
    whole of it; faces past path fraction `split` take the second material. warp: a gentle wave out of its plane."""
    pts = [Vector((x, y)) for x, y in path]
    ls = [0.0]
    for a, b in zip(pts, pts[1:]):
        ls.append(ls[-1] + (b - a).length)
    tot = ls[-1]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows = []
    for i, p in enumerate(pts):
        s = ls[i] / tot
        a = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        nrm = Vector((a.y, -a.x)).normalized()          # outward (the path runs counter-clockwise seen from above)
        za = z0(s)
        col = []
        for j in range(nz + 1):
            f = j / (nz - 1 + 1)
            z = za + (z1 - za) * f
            w = warp * (math.sin(7.0 * s + 2.0 * f) * 0.5 + math.sin(3.1 * f * math.pi) * 0.6) if warp else 0.0
            w += flare * (1.0 - f) ** 2 * min(1.0, max(0.0, (split + 0.06 - s) / 0.08))   # the bottom hangs away
            if s > split:                     # the fold crumples low down
                u = (s - split) / (1.0 - split)
                w += crumple * math.sin(u * 19.0 + 0.4) * max(0.0, 1.0 - f * 3.0) ** 2
            q = p + nrm * w
            col.append(bm.verts.new((q.x, q.y, z)))
        rows.append((s, col))
    for (s0, c0), (s1, c1) in zip(rows, rows[1:]):
        for j in range(nz):
            f = bm.faces.new((c0[j], c1[j], c1[j + 1], c0[j + 1]))
            f.material_index = 1 if (s0 + s1) / 2 > split else 0
            for lp in f.loops:
                vs = lp.vert
                si = s0 if vs in c0 else s1
                lp[uv].uv = (si * tot / (split * tot) if split else si,
                             (vs.co.z - z0(si)) / (z1 - z0(si)))
    ob = mesh_ob(name, bm, mats)
    mo = ob.modifiers.new("thick", "SOLIDIFY")
    mo.thickness = thick
    mo.offset = 1.0
    return ob


def matchbook():
    """The cover glued to the left (-Y) face: printed front, then the fold round the front corner."""
    path, split = mb_path()

    def z0(s):          # the bottom edge: lowest at the left, rising toward the front, highest under the fold
        z = S.MB_Z0 + S.MB_RISE * min(1.0, s / 0.68) + max(0.0, s - split + 0.04) * 1.5
        u = (s - split) / (1.0 - split)                  # across the fold: its bottom edge is crumpled, not straight
        if u > 0.0:
            z += 0.16 * math.sin(u * 17.0 + 0.6) * math.sin(u * 5.3 + 1.1) - 0.12 * math.sin(u * math.pi)
        return z

    ob = sheet("mbcover", path, z0, S.MB_Z1, 24, [M["cover"], M["striker"]], split, thick=0.05, warp=0.025,
               flare=S.MB_FLARE, crumple=0.05)
    # the print sits on the outside; the solidify's inner skin (toward the die) is the same card
    return ob


def tacks():
    prof = [(0.0, S.TACK_T + 0.05), (S.TACK_R * 0.5, S.TACK_T + 0.035), (S.TACK_R - 0.05, S.TACK_T),
            (S.TACK_R, S.TACK_T - 0.04), (S.TACK_R, 0.02), (S.TACK_R - 0.03, 0.0), (0.0, 0.0)]
    for i, ((gx, gy), top) in enumerate(S.TACKS):
        lathe(f"tack{i}", prof, (gx, gy, GROUND), M["tackdark"] if i == 0 else M["tack"], verts=48)
        lathe(f"tackboss{i}", [(0.0, 0.04), (0.05, 0.035), (0.068, 0.0)], (gx, gy, S.TACK_T + 0.02),
              M["tack"], verts=24)
        a = Vector((gx, gy, S.TACK_T + 0.03))
        b = TILT_M @ Vector(top)                       # the body leans; the pin goes up into it where it now is
        b = b + (b - a).normalized() * 0.12              # a little into the card or the die
        tube(f"tackpin{i}", [a, b], 0.042, M["pin"], verts=10)


def sticks():
    n, w, t = S.STICK_N, S.STICK_W, S.STICK_T
    gap = (S.STICK_X1 - S.STICK_X0 - n * w) / (n - 1)
    jit = ((0.0, 0.0, 0.15), (-0.06, 0.05, -0.15), (0.05, -0.04, 0.2), (0.1, 0.02, -0.3))
    for i in range(n):
        x = S.STICK_X0 + w / 2 + i * (w + gap)
        dy0, dy1, rz = jit[i]
        y0, y1 = S.STICK_Y0 + dy0, S.STICK_Y1 + dy1
        r = w / 2
        pts = []
        for k in range(17):                       # the rounded ends
            a = math.pi + math.pi * k / 16
            pts.append((r * math.cos(a), y0 + r + r * math.sin(a) * 0.9))
        for k in range(17):
            a = math.pi * k / 16
            pts.append((r * math.cos(a), y1 - r + r * math.sin(a) * 0.9))
        bm = bmesh.new()
        vs = [bm.verts.new((px_, py_, 0.0)) for px_, py_ in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
            v.co.z += t
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = mesh_ob(f"stick{i}", bm, [M[f"stick{i}"]], smooth=True, bevel=S.STICK_BEVEL, segs=5)
        ob.location = (x, 0.0, ZT + 0.006)
        ob.rotation_euler = (0.0, 0.0, math.radians(rz))


def lift(x):
    """How far the strap (and the paper under it) rides up over the paper bunched beneath its right part (Flash's
    strap and its yellow end sit high over the sticks)."""
    t = min(1.0, max(0.0, (x + 1.5) / 3.6))
    return S.STRAP_RAISE + S.STRAP_LIFT * (0.35 + 0.65 * t * t * (3 - 2 * t))


def strap():
    """Across the sticks near their back, its yellow end bent down over the die's right face, with four holes; a wire
    ring hangs from the last hole round the top-right pip."""
    zs = S.ZSTICK + 0.04 + S.STRAP_T / 2               # on the paper
    y = S.STRAP_Y
    x0 = S.STRAP_X0
    pts = [(-3.0, y - 0.05, zs - 0.07), (-2.82, y - 0.025, zs - 0.02), (-2.6, y - 0.01, zs), (-2.3, y, zs),
           (x0, y, zs)]                         # its long left end: flat, sagging a little past the sticks' back edge
    pts += [(x0 + (A - 0.05 - x0) * i / 20, y, zs) for i in range(1, 21)]
    pts = [(px_, py_, pz + lift(px_)) for px_, py_, pz in pts]       # riding up over the paper bunched under it
    lr = lift(A)
    lr0 = lr - S.STRAP_RAISE                  # its bent-down end, hole and ring stay where they were (round the pip)
    pts += [(A + 0.06, y, zs - 0.06 + lr), (A + 0.1, y, zs - 0.2 + lr), (A + 0.09, y, ZT - 0.2 + lr0),
            (A + 0.08, y, ZT - 0.62 + lr0)]
    sweep("strap", pts, (0, 1, 0), S.STRAP_W, S.STRAP_T, M["strap"], bevel=0.02)
    torn_end(pts[1], pts[0])
    # Flash's white-blue blob on the paper just behind the strap's left end
    bx = -2.55
    bl = bpy.data.meshes.new("paperblob")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    rb = random.Random(3)
    for v in bm.verts:
        v.co *= 1.0 + rb.uniform(-0.12, 0.12)
    bm.to_mesh(bl)
    bm.free()
    bl.polygons.foreach_set("use_smooth", [True] * len(bl.polygons))
    bl.materials.append(M["blob"])
    ob = bpy.data.objects.new("paperblob", bl)
    link(ob)
    ob.scale = (0.3, 0.2, 0.13)
    ob.location = (bx, y + S.STRAP_W / 2 + 0.24, zs + lift(bx) + 0.04)
    for i, hx in enumerate(S.STRAP_HOLES):
        h = cyl(f"strapholeT{i}", 0.23, 0.01, (hx, y, zs + S.STRAP_T / 2 + 0.012 + lift(hx)), M["hole"], verts=20,
                bevel=0.0)
        h.scale = (1.0, 0.8, 1.0)
    hz = ZT - 0.4 + lr0
    cyl("strapholeS", 0.15, 0.01, (A + 0.09 + S.STRAP_T / 2 - 0.004, y, hz), M["hole"], rot=(0, 90, 0), verts=20,
        bevel=0.0)
    # the ring: through that hole, lying against the face round the top-right pip
    zc = S.PIP_Z + S.PIP_DZ
    r = 0.8
    c = Vector((A + 0.1, S.STRAP_Y + 0.12, hz - r))
    pts = []
    for k in range(64):
        a = 2 * math.pi * k / 64
        lean = 0.07 * (1 - math.cos(a - math.pi / 2)) / 2           # the top lies on the strap, the bottom on the face
        pts.append((c.x + 0.02 - lean, c.y + r * math.cos(a), c.z + r * math.sin(a)))
    tube("ring", pts, 0.032, M["wire"], verts=10, cyclic=True)


def torn_end(p1, p0):
    """The strap's left end torn off: a thin flap past its last point p0 (coming from p1), its edge in uneven points."""
    t = (Vector(p0) - Vector(p1)).normalized()
    side = Vector((0, 1, 0))
    nrm = t.cross(side).normalized()
    sd = nrm.cross(t).normalized()
    w = S.STRAP_W
    teeth = (0.06, 0.22, 0.1, 0.3, 0.12, 0.18, 0.04)          # how far each point of the torn edge reaches
    edge = [(0.0, -w / 2 + 0.02)]
    for k, d in enumerate(teeth):
        edge.append((d, -w / 2 + w * (k + 0.5) / len(teeth)))
    edge.append((0.0, w / 2 - 0.02))
    poly = [(-0.12, w / 2 - 0.02)] + edge[::-1] + [(-0.12, -w / 2 + 0.02)]
    bm = bmesh.new()
    h = S.STRAP_T * 0.7
    vs = [bm.verts.new(Vector(p0) + t * u + sd * v - nrm * h / 2) for u, v in poly]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co += nrm * h
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("strapend", bm, [M["strap"]], smooth=False)


def paper():
    """A crumpled pink paper on the sticks behind the strap, its back edge torn into points and curled up."""
    nx, ny = 40, 8
    x0, x1 = -2.7, A - 0.12
    y1 = S.PAPER_Y1
    yb = S.STRAP_Y + S.STRAP_W / 2 + 0.05             # the strap's back edge
    bm = bmesh.new()
    rows = []
    rr = random.Random(77)
    # an irregular torn edge: a slow wander of broad lobes and dips, and a few narrow torn flaps of differing size
    ph = [rr.uniform(0, 6.3) for _ in range(3)]
    tips = [0.17 * math.sin(0.4 * k + ph[0]) + 0.05 * math.sin(1.1 * k + ph[1]) + 0.025 * math.sin(2.9 * k + ph[2]) +
            rr.uniform(-0.02, 0.02) for k in range(nx + 1)]
    for k, hgt in ((5, 0.06), (17, 0.07), (33, 0.05)):      # a few small torn flaps (Flash's edge is lumpy, not spiky)
        tips[k] += hgt
    for j in range(ny + 1):
        fy = j / ny
        edge = 1.0 if j == ny else (0.4 if j == ny - 1 else 0.0)     # the tear shapes the last two rows
        row = []
        for i in range(nx + 1):
            fx = i / nx
            x = x0 + (x1 - x0) * fx
            yf = S.STRAP_Y - S.STRAP_W / 2 + 0.06        # its front edge under the strap
            yy = yf + (y1 - yf) * fy + tips[i] * 0.6 * edge
            fr = max(0.0, (yy - yb) / (y1 - yb))          # flat under the strap, crumpled and curled up behind it
            fr *= 1.0 - 0.45 * min(1.0, max(0.0, (fx - 0.78) / 0.22)) ** 2     # lower toward its right end (Flash)
            z = (S.ZSTICK + 0.015 + 0.07 * math.sin(9 * fx + 3 * fy) * fr + 0.3 * fr ** 1.5 + tips[i] * 0.45 * edge +
                 rr.uniform(-0.02, 0.02) * fr) + lift(x)
            row.append(bm.verts.new((x, yy, z)))
        rows.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    ob = crumple_geo(mesh_ob("paper", bm, [M["paper"]]), 0.3, 0.06)
    mo = ob.modifiers.new("thick", "SOLIDIFY")
    mo.thickness = 0.02
    mo.offset = 1.0
    # the paper bunched up under the strap's right part: a crumpled wad from the sticks up to the sheet
    bm = bmesh.new()
    rr = random.Random(5)
    yw = S.STRAP_Y
    secs = []
    for i in range(33):            # crumpled: its front spreads and bulges unevenly on the sticks
        x = -2.7 + (A - 0.15 + 2.7) * i / 32
        top = S.ZSTICK + 0.015 + lift(x) + 0.005
        hw = 0.36 + rr.uniform(-0.03, 0.03)
        hf = 0.42 + 0.07 * math.sin(2.3 * x + 1.0) + 0.04 * math.sin(5.9 * x + 2.0)   # its front, spread on the sticks
        zb = S.ZSTICK + 0.02              # (clear of the wires under it)
        zm_ = (zb + top) / 2 + 0.03 * math.sin(4.4 * x + 0.5)
        bul = 0.04 + 0.04 * math.sin(3.7 * x + 2.6)                              # a soft uneven bulge
        secs.append([bm.verts.new(v) for v in ((x, yw - hf, zb), (x, yw + hw, zb), (x, yw + hw * 0.9, top),
                                               (x, yw - hw * 0.9, top), (x, yw - hf * 0.85 - bul, zm_))])
    for s0, s1 in zip(secs, secs[1:]):
        for a, b in ((0, 1), (1, 2), (2, 3), (3, 4), (4, 0)):
            bm.faces.new((s0[a], s0[b], s1[b], s1[a]))
    bm.faces.new(secs[0][::-1])
    bm.faces.new(secs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    crumple_geo(mesh_ob("paperwad", bm, [M["paper"]], smooth=True), 0.35, 0.08)
    return ob



def stick_end(i):
    """Stick i's middle x, the middle of its rounded front end (y) and its turn (as sticks() lays them)."""
    n, w = S.STICK_N, S.STICK_W
    gap = (S.STICK_X1 - S.STICK_X0 - n * w) / (n - 1)
    jit = ((0.0, 0.0, 0.15), (-0.06, 0.05, -0.15), (0.05, -0.04, 0.2), (0.1, 0.02, -0.3))
    return S.STICK_X0 + w / 2 + i * (w + gap), S.STICK_Y0 + jit[i][0] + w / 2, jit[i][2]


def hug(i, a0, a1, z0, z1, n=10, out=0.05):
    """Points round stick i's rounded front end, just off its rim, from angle a0 to a1 (degrees; 180 = its left side,
    270 = its tip), height going from z0 to z1: Flash's wires wrap tight round the stick ends."""
    cx, cy, rz = stick_end(i)
    r = S.STICK_W / 2
    c, s_ = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    pts = []
    for k in range(n + 1):
        t = k / n
        a = math.radians(a0 + (a1 - a0) * t)
        x, y = (r + out) * math.cos(a), cy + (r * 0.9 + out) * math.sin(a)
        pts.append((cx + x * c - y * s_, x * s_ + y * c, z0 + (z1 - z0) * t))   # turned with the stick (about x, 0)
    return pts


def wires():
    """Two thin grey wires lying in the grooves between the sticks (Flash's two dark lines), their back ends under the
    paper. The first ends in its groove short of the stick ends; the second hooks over the third stick's rounded end
    (Flash's one visible hook) and tucks under it."""
    n, w, bv = S.STICK_N, S.STICK_W, S.STICK_BEVEL
    gap = (S.STICK_X1 - S.STICK_X0 - n * w) / (n - 1)
    rw = 0.036
    top = ZT + 0.006 + S.STICK_T                  # the sticks' top
    sh = math.radians(32)                         # lying on one stick's rounded shoulder, at the groove
    lean = gap / 2 + bv - (bv + rw) * math.sin(sh)
    zg = top - bv + (bv + rw) * math.cos(sh) - 0.004
    zm = ZT + 0.006 + S.STICK_T / 2               # half way up a stick's edge
    zu = ZT - rw - 0.004                          # just under the sticks
    xa = S.STICK_X0 + w + gap / 2 + lean          # (on stick 1's rim)
    cy1 = stick_end(1)[1]
    xa0, xb0 = xa - lean, S.STICK_X0 + 2 * w + 1.5 * gap      # the grooves' middles (the wires' back ends sink in
    zd = top - 0.03                                             # them, under the paper)
    pa = [(xa0, 0.75, zd), (xa0, 0.55, zd), (xa, 0.3, zg), (xa, -1.0, zg), (xa, cy1 + 0.25, zg)]
    tube("wireA", pa, rw, M["wire2"], verts=8, smooth=True)
    xb = S.STICK_X0 + 2 * w + 1.5 * gap + lean    # (on stick 2's rim, in the groove before it)
    cx2, cy2, rz2 = stick_end(2)
    c, s_ = math.cos(math.radians(rz2)), math.sin(math.radians(rz2))

    def on2(lx, ly, z):                           # a point over stick 2's end (x from its middle), turned with it
        return (cx2 + lx * c - ly * s_, lx * s_ + ly * c, z)
    r = w / 2
    pb = [(xb0, 0.75, zd), (xb0, 0.55, zd), (xb, 0.3, zg), (xb, -1.5, zg), (xb, cy2 + 0.55, zg)]
    pb += [on2(-r * 0.62, cy2 + 0.22, top + rw + 0.004), on2(-0.05, cy2 - 0.12, top + rw + 0.004),  # across its end,
           on2(r * 0.42, cy2 - 0.36, top + rw)]
    pb += hug(2, 312, 312, top - 0.005, top - 0.005, 1, out=rw * 0.5)[:1]               # over its rounded rim
    pb += hug(2, 313, 314, top - 0.07, ZT + 0.01, 1, out=rw + 0.012)                    # down its side
    pb += hug(2, 316, 316, zu, zu, 1, out=-0.06)[:1]                                    # and tucked under it
    pb += [on2(r * 0.5, cy2 - 0.2, zu - 0.005), on2(r * 0.15, cy2 + 0.05, zu - 0.01)]
    tube("wireB", pb, rw, M["wire2"], verts=8, smooth=True)


def build():
    die()
    wires()
    matchbook()
    sticks()
    paper()
    strap()
    bpy.context.view_layer.update()
    for ob in list(COLL.objects):           # the body leans (stack.TILT); the tacks, made after, stay on the ground
        if ob.parent is None:               # (an object can't hold a shear, so it goes into the mesh or curve itself)
            ob.data.transform(TILT_M @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)
    tacks()


FAMILY = (("die", "die"), ("wire", "wire"), ("mbcover", "cover"), ("tackpin", "pin"), ("tackboss", "tack"), ("tack", "tack"),
          ("stick", "stick"), ("straphole", "strap"), ("strap", "strap"), ("ring", "ring"), ("paper", "paper"))


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


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



POLYS = {}


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
        POLYS[o.name] = [p.vertices[:] for p in me.polygons]
        out[o.name] = (o, BVHTree.FromPolygons(vs, POLYS[o.name]), vs)
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
                ov = ta.overlap(tb)
                n = len(ov)
                if n and os.environ.get("PB_WHERE") in (fa, fb):      # where: the first overlapping vertex of a
                    va, vb = obs[i][2], tr[b.name][2]
                    for ia, ib in ov[:6]:
                        c = sum((va[k] for k in POLYS[a.name][ia]), Vector()) / len(POLYS[a.name][ia])
                        d = sum((vb[k] for k in POLYS[b.name][ib]), Vector()) / len(POLYS[b.name][ib])
                        print("CHECK where", a.name, tuple(round(x, 3) for x in c), b.name, tuple(round(x, 3) for x in d))
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
        sc.render.filepath = str(out / f"L{L}-raw.png")          # post.py shade makes L1-base.png from it
        bpy.ops.render.render(write_still=True)
        # the building alone (no ground shadow), for the outline check
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 64
        sc.render.filepath = str(out / f"L{L}-alone.png")
        bpy.ops.render.render(write_still=True)
    if MODE == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"store-L{L}.blend"))
    print("DONE", L, MODE)


main()

