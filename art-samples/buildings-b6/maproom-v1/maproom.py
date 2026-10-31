"""maproom.py : the Map Room (Flash building 11) as a 3D model, in the approved Twig/Pebble/Putty/Hatchery/HCC/General
Store family (same camera, light, render settings and scale; no outline). Flash has one look for every level and no
animation, so there is one model and one still. The parts and their places are in stack.py. The shared helpers
(materials, meshes, camera, checks) are the General Store's store.py, unchanged.

    blender -b --factory-startup -P maproom.py -- 1 fit      work/fit-L1.png    quick render without the ground, 4 px per Flash px
    blender -b --factory-startup -P maproom.py -- 1 still    render/L1-raw.png (with the ground shadow), render/L1-alone.png
    blender -b --factory-startup -P maproom.py -- 1 check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P maproom.py -- 1 gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P maproom.py -- 1 probe sx sy ...   what the camera sees first through Flash pixels
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
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the stone block's middle on the ground)
GROUND = S.GROUND
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-70,-72,92,90").split(","))   # the canvas in Flash px (as fref.FRAME; wider for the damage looks)
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




def shade_along(mat, vec, lo, hi, k):
    """Multiply the base colour by 1 .. k as world position . vec runs lo .. hi (Flash's broad painted shading)."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = b.inputs["Base Color"].links[0].from_socket
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dp = nt.nodes.new("ShaderNodeVectorMath")
    dp.operation = "DOT_PRODUCT"
    nt.links.new(geo.outputs["Position"], dp.inputs[0])
    dp.inputs[1].default_value = vec
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = lo, hi
    mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0, k
    nt.links.new(dp.outputs["Value"], mr.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    nt.links.new(src, mul.inputs[6])
    nt.links.new(mr.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], b.inputs["Base Color"])


def shade_z(mat, stops):
    """Multiply the base colour by a ramp over world height: stops = [(z, factor), ...] (dark low down and in the
    deck's shadow, as Flash paints its stone)."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = b.inputs["Base Color"].links[0].from_socket
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    z0, z1 = stops[0][0], stops[-1][0]
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = z0, z1
    nt.links.new(sep.outputs["Z"], mr.inputs[0])
    rmp = nt.nodes.new("ShaderNodeValToRGB")
    el = rmp.color_ramp.elements
    for i, (z, f) in enumerate(stops):
        e = el[i] if i < 2 else el.new(0.5)
        e.position = (z - z0) / (z1 - z0)
        e.color = (f, f, f, 1)
    nt.links.new(mr.outputs[0], rmp.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    nt.links.new(src, mul.inputs[6])
    nt.links.new(rmp.outputs[0], mul.inputs[7])
    nt.links.new(mul.outputs[2], b.inputs["Base Color"])


def stain(mat, scale, amount, seed=0.0, fine=0.0):
    """Weathering: multiply the base colour by soft dark patches of world-space noise (1 - amount at the darkest),
    and with fine > 0 a speckle of small dark flecks on top (Flash's dirty, worn surfaces)."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = b.inputs["Base Color"].links[0].from_socket
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    out = src
    for sc, amt, lo, hi in ((scale, amount, 0.42, 0.66), (scale * 9, fine, 0.55, 0.7)):
        if not amt:
            continue
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = sc
        nz.inputs["Detail"].default_value = 4.0
        nz.inputs["Roughness"].default_value = 0.6
        try:
            nz.noise_dimensions = "4D"
            nz.inputs["W"].default_value = seed
        except (TypeError, KeyError):
            pass
        nt.links.new(geo.outputs["Position"], nz.inputs["Vector"])
        rmp = nt.nodes.new("ShaderNodeValToRGB")
        el = rmp.color_ramp.elements
        el[0].position, el[0].color = lo, (1 - amt, 1 - amt, 1 - amt, 1)
        el[1].position, el[1].color = hi, (1, 1, 1, 1)
        if sc != scale:                          # flecks: dark where the noise is high
            el[0].color, el[1].color = (1, 1, 1, 1), (1 - amt, 1 - amt, 1 - amt, 1)
        nt.links.new(nz.outputs["Fac"], rmp.inputs[0])
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs[0].default_value = 1.0
        nt.links.new(out, mul.inputs[6])
        nt.links.new(rmp.outputs[0], mul.inputs[7])
        out = mul.outputs[2]
    nt.links.new(out, b.inputs["Base Color"])


def smooth_loop(pts, k=4):
    """A closed path through pts, Catmull-Rom smoothed (k points per span)."""
    n = len(pts)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = (Vector(pts[(i + j) % n]) for j in (-1, 0, 1, 2))
        for j in range(k):
            t = j / k
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return out


def sphere(name, r, at, mat, n=24):
    prof = [(r * math.sin(math.pi * i / n), -r * math.cos(math.pi * i / n)) for i in range(n + 1)]
    return lathe(name, prof, at, mat, verts=2 * n)


def slab(name, p0, d, poly, thick, mat, bevel=0.03, out=None):
    """A flat piece in an upright wall plane: poly = (u, z) points (u along the ground direction d from p0), pushed
    `thick` inward from the plane (against `out`, the wall's outward unit XY)."""
    p0, d = Vector((p0[0], p0[1], 0)), Vector((d[0], d[1], 0)).normalized()
    o = Vector((out[0], out[1], 0)) if out else Vector((d.y, -d.x, 0))
    bm = bmesh.new()
    a = [bm.verts.new(p0 + d * u + Vector((0, 0, z))) for u, z in poly]
    b = [bm.verts.new(p0 + d * u + Vector((0, 0, z)) - o * thick) for u, z in poly]
    bm.faces.new(a)
    bm.faces.new(b[::-1])
    k = len(poly)
    for i in range(k):
        bm.faces.new((a[i], b[i], b[(i + 1) % k], a[(i + 1) % k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], bevel=bevel, segs=2)


def planks(name, p0, p1, z0_fn, z1_fn, mat, n, thick=0.12, gap=0.03, out=None, jit=0.015):
    """A wall of n upright planks from ground point p0 to p1, each from z0_fn(u) up to z1_fn(u) (u: 0..length along the
    wall), so the tops can follow a gable and the bottoms a roof slope."""
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    ln = d.length
    d = d.normalized()
    w = ln / n
    obs = []
    for i in range(n):
        u0, u1 = i * w + gap / 2, (i + 1) * w - gap / 2
        dz = rng.uniform(-0.03, 0.03)
        poly = [(u0, z0_fn(u0)), (u1, z0_fn(u1)), (u1, z1_fn(u1) + dz), (u0, z1_fn(u0) + dz)]
        q = p0 + Vector((out[0], out[1])) * rng.uniform(-jit, jit) if out else p0
        obs.append(slab(f"{name}{i}", q, d, poly, thick + rng.uniform(-0.01, 0.01), mat, out=out))
    return obs


# ------------------------------------------------------------------------------------------------------------ the model
def materials():
    M = {}
    # the stone: Flash's soft blue-grey block, pale on the lit left face, darker low down
    M["stone"] = painted("stone", (96, 95, 106), rough=0.9, wear=(74, 72, 86), scale=3.0, dirt=0.5, spec=0.2)
    lift(M["stone"], (84, 83, 94), 0.34)
    shade_z(M["stone"], [(0.0, 0.66), (1.2, 0.84), (2.6, 0.95), (3.5, 0.82), (4.04, 0.6)])
    # the corner footings: the same stone, pale on their rounded tops (Flash lights them from above)
    M["foot"] = painted("foot", (100, 99, 110), rough=0.9, wear=(78, 76, 90), scale=3.0, dirt=0.45, spec=0.2)
    lift(M["foot"], (88, 87, 98), 0.3)
    shade_z(M["foot"], [(0.0, 0.66), (0.7, 0.86), (1.15, 1.08), (1.5, 1.4)])
    M["door"] = flat("door", (12, 12, 16), rough=1.0)
    # pale weathered boards (deck, roofs) and darker brown planks (walls, stairs)
    M["deck"] = wood("deck", (200, 166, 106), (126, 98, 60), axis="X", dirt=0.32)
    shade_along(M["deck"], (0.707, 0.707, 0.0), 0.6, 5.0, 0.5)     # Flash's deck darkens to the right of the cabin
    M["roofx"] = wood("roof", (226, 192, 130), (142, 110, 70), axis="X", dirt=0.2)
    M["roofy"] = wood("roof", (214, 182, 124), (134, 104, 66), axis="Y", dirt=0.2)
    M["corner"] = wood("corner", (176, 150, 108), (136, 112, 76), axis="Z", dirt=0.2, rings=4.0)
    M["plank"] = wood("plank", (96, 81, 59), (84, 71, 52), axis="Z", dirt=0.35, rings=4.0)
    lift(M["plank"], (96, 80, 56), 0.08)              # Flash lights the cabin's walls almost evenly
    M["rim"] = wood("rim", (104, 82, 52), (74, 58, 36), axis="X", dirt=0.2)
    M["tplank"] = wood("tplank", (156, 126, 84), (126, 100, 64), axis="Z", dirt=0.25, rings=4.0)
    M["stair"] = wood("stair", (146, 120, 84), (88, 70, 44), axis="Z", dirt=0.3)
    M["riser"] = wood("riser", (92, 74, 46), (64, 50, 30), axis="Z", dirt=0.2)
    M["stairside"] = wood("stairside", (196, 166, 114), (150, 124, 82), axis="Z", dirt=0.2)
    lift(M["stairside"], (120, 100, 66), 0.25)
    lift(M["tplank"], (120, 96, 62), 0.15)
    M["plate"] = shiny("plate", (196, 134, 26), rough=0.32, metal=0.9, wear=(112, 66, 10), scale=1.6, dirt=0.4)
    M["tread"] = wood("stair", (146, 120, 84), (88, 70, 44), axis="Y", dirt=0.3)
    M["frame"] = wood("frame", (126, 106, 80), (96, 80, 58), axis="Z", dirt=0.1)
    M["glass"] = flat("glass", (16, 12, 8), rough=0.6)
    # weathering: soft stains and fine dirt on the stone and every wooden part (Flash's art is never clean)
    stain(M["stone"], 1.6, 0.3, 1.0, fine=0.25)
    stain(M["foot"], 1.6, 0.25, 4.0, fine=0.25)
    for k, (sc, amt) in {"deck": (0.9, 0.28), "roofx": (1.0, 0.24), "roofy": (1.0, 0.24), "corner": (1.2, 0.2), "plank": (1.1, 0.18), "tplank": (1.3, 0.16),
                         "stair": (1.0, 0.18), "riser": (1.0, 0.12), "stairside": (1.0, 0.18), "rim": (1.0, 0.15)}.items():
        stain(M[k], sc, amt, 2.0 + len(k), fine=0.1)
    # metals: Flash's old gold telescope, light steel scissors and posts, silver balls
    M["brass"] = shiny("brass", (246, 194, 50), rough=0.26, metal=0.88, wear=(138, 92, 14), scale=2.0, dirt=0.25,
                       side=0.3)
    M["bellin"] = painted("bellin", (54, 48, 22), rough=0.7, wear=(70, 34, 18), scale=2.0, dirt=0.0, spec=0.3)
    M["steel"] = shiny("steel", (176, 184, 200), rough=0.35, metal=0.75, wear=(140, 148, 166), scale=3.0, dirt=0.1)
    M["ball"] = shiny("ball", (214, 220, 232), rough=0.25, metal=0.8, wear=(170, 176, 190), scale=3.0, dirt=0.05)
    M["rope"] = painted("rope", (52, 34, 44), rough=0.9, dirt=0.0, spec=0.2)
    M["hand"] = wood("hand", (176, 150, 104), (130, 104, 70), axis="Z", dirt=0.1)
    return M


M = materials()
A = S.BASE_A
YAW_M = Matrix.Rotation(math.radians(S.YAW), 4, "Z")
_xf = S.HOUSE_C[0] + S.HOUSE_AX
SHEAR_M = Matrix(((1, 0, 0, 0), (S.HOUSE_SHEAR, 1, 0, -S.HOUSE_SHEAR * _xf), (0, 0, 1, 0), (0, 0, 0, 1)))


def base():
    box("base", (2 * A, 2 * A, S.BASE_H), (0, 0, 0), M["stone"], bevel=S.BASE_R, segs=4)
    c = A + S.FOOT_OUT - S.FOOT_S / 2
    for i, (sx, sy) in enumerate(((1, -1), (-1, -1), (1, 1), (-1, 1))):
        box(f"foot{i}", (S.FOOT_S, S.FOOT_S, S.FOOT_H), (sx * c, sy * c, 0), M["foot"], bevel=0.46, segs=5)
    y0, y1, z0, z1 = S.DOOR
    box("door", (0.06, y1 - y0, z1 - z0), (A + 0.005, (y0 + y1) / 2, z0), M["door"], bevel=0.02)


def unyaw(v):
    return YAW_M.inverted() @ Vector(v)


def cam_ray(sx, sy):
    """Two world points on the camera ray through Flash pixel (sx, sy)."""
    return px(sx, sy, Z=0.0), px(sx, sy, Z=10.0)


def hit_plane(sx, sy, p0, n):
    """Where the camera ray through Flash pixel (sx, sy) meets the plane through p0 with normal n (camera world)."""
    a, b = cam_ray(sx, sy)
    d = b - a
    t = (Vector(p0) - a).dot(n) / d.dot(n)
    return a + d * t


# the scissors' pivot and blade tips where Flash draws them (camera world, after the yaw)
SP = px(S.SCIS_PIVOT[0], S.SCIS_PIVOT[1], Y=S.SCIS_PIVOT[2])
ST = [px(x, y, Z=-0.05) for x, y in S.SCIS_TIPS]


RIM_H = 0.22


def deck():
    D = S.DECK_A
    w = 2 * D / S.DECK_N
    z0 = S.BASE_H + RIM_H
    # a dark beam round the deck's rim under the boards (Flash's deck edge is a thick dark band)
    sp = unyaw(SP)
    x0, x1 = sp.x - S.SLOT_W * 0.55, sp.x + S.SLOT_W * 0.45
    sy0, sy1 = sp.y - 0.2, sp.y - 0.2 + S.SLOT_D     # the blades lean forward through it; a thin strip stays in front
    for i, (sx, sy) in enumerate(((1, 0), (-1, 0), (0, 1))):
        size = (0.14, 2 * D - 0.08, RIM_H) if sx else (2 * D - 0.36, 0.14, RIM_H)
        box(f"deckrim{i}", size, (sx * (D - 0.11), sy * (D - 0.11), S.BASE_H), M["rim"], bevel=0.03)
    for k, (a, b) in enumerate(((-D + 0.18, x0), (x1, D - 0.18))):      # the front beam stops either side of the slot
        box(f"deckrim3{k}", (b - a, 0.14, RIM_H), ((a + b) / 2, -(D - 0.11), S.BASE_H), M["rim"], bevel=0.03)
    # the slot's dark pit behind the blades (Flash's slot is a black hole)
    box("deckpit", (x1 - x0, sy1 - (sp.y + 0.2), RIM_H + 0.25), ((x0 + x1) / 2, (sp.y + 0.2 + sy1) / 2, S.BASE_H - 0.27),
        M["door"], bevel=0.01)
    # a bed of boards on the stone under the deck boards
    box("deckbed", (2 * A - 0.1, 2 * A - 0.1, RIM_H), (0, 0, S.BASE_H), M["rim"], bevel=0.03)
    cuts = [-D] + [-D + i * w + rng.uniform(-0.12, 0.12) * w for i in range(1, S.DECK_N)] + [D]
    for i in range(S.DECK_N):
        ya, yb = cuts[i] + rng.uniform(0.01, 0.035), cuts[i + 1] - rng.uniform(0.01, 0.035)
        t = S.DECK_T - RIM_H + rng.uniform(-0.02, 0.0)
        spans = [(-D, D)]
        if ya < sy1 and yb > sy0:           # the slot cuts this board: keep the ends and the strips beside the slot
            spans = [(-D, x0), (x1, D)]
            for k, (a, b) in enumerate(((ya, sy0), (sy1, yb))):
                if b - a > 0.05:
                    box(f"deckslot{i}{k}", (x1 - x0, b - a, t), ((x0 + x1) / 2, (a + b) / 2, z0), M["deck"], bevel=0.02)
        for k, (a, b) in enumerate(spans):
            box(f"deck{i}{k}", (b - a - 0.01, yb - ya, t), ((a + b) / 2, (ya + yb) / 2, z0), M["deck"],
                bevel=0.035, jitter=0.006)


def posts():
    c = S.DECK_A - S.POST_IN
    f = -(S.DECK_A - S.POST_IN_F)
    corners = [(c, f), (c, c), (-c, c), (-c, f)]
    tops = []
    for i, (x, y) in enumerate(corners):
        cyl(f"post{i}", S.POST_R, S.POST_H, (x, y, S.DECK_Z1 - 0.05), M["steel"], verts=12, bevel=0.01)
        top = Vector((x, y, S.DECK_Z1 + S.POST_H + S.BALL_R * 0.6))
        sphere(f"ball{i}", S.BALL_R, top, M["ball"])
        tops.append(top)
    for i in range(4):
        a, b = tops[i], tops[(i + 1) % 4]
        d = (b - a).normalized()
        a2, b2 = a + d * S.BALL_R * 0.7, b - d * S.BALL_R * 0.7
        pts = []
        for k in range(13):
            f = k / 12
            p = a2.lerp(b2, f)
            p.z -= S.ROPE_SAG * math.sin(math.pi * f)
            pts.append(p)
        tube(f"rope{i}", pts, S.ROPE_R, M["rope"], verts=8, smooth=True)


TAN = math.tan(math.radians(S.ROOF_PITCH))
RT = 0.14                                   # roof board thickness


def roof_z(y):
    """The top of the cabin's roof boards at y (any x under the roof)."""
    return S.ROOF_Z - abs(y - S.HOUSE_C[1]) * TAN


def roof_under(y):
    return roof_z(y) - RT / math.cos(math.radians(S.ROOF_PITCH))


def house():
    cx, cy = S.HOUSE_C
    ax, ay = S.HOUSE_AX, S.HOUSE_AY
    z0 = S.DECK_Z1
    th = 0.13
    flatz = lambda u: z0
    # the long walls (-Y front, +Y back) reach the roof's underside; the gables (+X with the window, -X) follow it
    zf = roof_under(cy - ay) + 0.02
    planks("hwallF", (cx - ax, cy - ay), (cx + ax, cy - ay), flatz, lambda u: zf, M["plank"], 6, th, out=(0, -1))
    planks("hwallB", (cx + ax, cy + ay), (cx - ax, cy + ay), flatz, lambda u: zf, M["plank"], 6, th, out=(0, 1))
    planks("gableR", (cx + ax, cy - ay), (cx + ax, cy + ay), flatz, lambda u: roof_under(cy - ay + u) + 0.02,
           M["plank"], 6, th, out=(1, 0))
    planks("gableL", (cx - ax, cy + ay), (cx - ax, cy - ay), flatz, lambda u: roof_under(cy + ay - u) + 0.02,
           M["plank"], 6, th, out=(-1, 0))
    # the round window in the +X gable: dark panes, a wooden ring, a cross
    wy, wz = S.WIN_C
    x = cx + ax + 0.01
    cyl("windowglass", S.WIN_R, 0.03, (x, wy, wz), M["glass"], rot=(0, 90, 0), verts=40, bevel=0.0)
    ring_pts = [(x + 0.04, wy + S.WIN_R * math.cos(2 * math.pi * i / 48), wz + S.WIN_R * math.sin(2 * math.pi * i / 48))
                for i in range(48)]
    tube("windowring", ring_pts, 0.065, M["frame"], verts=10, cyclic=True)
    box("windowbarV", (0.06, 0.12, 2 * S.WIN_R), (x + 0.02, wy, wz), M["frame"], bevel=0.02, origin="center")
    box("windowbarH", (0.06, 2 * S.WIN_R, 0.12), (x + 0.02, wy, wz), M["frame"], bevel=0.02, origin="center")
    # the roof: two slopes of boards along X, from the ridge down past the eaves
    ang = math.radians(S.ROOF_PITCH)
    run = S.ROOF_RUN / math.cos(ang)
    nb = 5
    bw = run / nb
    length = 2 * (ax + S.ROOF_END)
    for side in (-1, 1):
        nrm = Vector((0, side * math.sin(ang), math.cos(ang)))
        for i in range(nb):
            s = (i + 0.5) * bw                       # along the slope from the ridge
            top = Vector((cx, cy + side * s * math.cos(ang), S.ROOF_Z - s * math.sin(ang)))
            box(f"roof{side + 1}{i}", (length + rng.uniform(-0.06, 0.06), bw - rng.uniform(0.07, 0.1), RT),
                top - nrm * RT / 2, M["roofx"], rot=(-side * S.ROOF_PITCH + rng.uniform(-1.5, 1.5), 0, 0), bevel=0.04,
                origin="center")
        # under the boards a dark sheet (the gaps show dark), and a thick dark beam along the eave
        mid = Vector((cx, cy + side * run / 2 * math.cos(ang), S.ROOF_Z - run / 2 * math.sin(ang)))
        box(f"roofsheet{side + 1}", (length - 0.1, run - 0.1, 0.06), mid - nrm * (RT + 0.03), M["rim"],
            rot=(-side * S.ROOF_PITCH, 0, 0), bevel=0.01, origin="center")
        eave = Vector((cx, cy + side * (run - 0.12) * math.cos(ang), S.ROOF_Z - (run - 0.12) * math.sin(ang)))
        box(f"roofeave{side + 1}", (length + 0.02, 0.2, 0.3), eave - nrm * (RT + 0.12), M["rim"],
            rot=(-side * S.ROOF_PITCH, 0, 0), bevel=0.04, origin="center")
    box("cornerboard", (0.16, 0.24, roof_under(cy + ay) - z0 + 0.02), (cx + ax + 0.02, cy + ay - 0.1, z0), M["corner"],
        bevel=0.03)
    box("ridge", (length + 0.04, 0.24, 0.16), (cx, cy, S.ROOF_Z + 0.02), M["roofx"], bevel=0.05, origin="center")


def tower():
    tx, ty = S.TOWER_C
    a = S.TOWER_A
    th = 0.11
    ang = math.atan(S.TROOF_DROP / S.TROOF_RUN)
    tun = lambda x: S.TROOF_Z - abs(x - tx) * math.tan(ang) - 0.12 / math.cos(ang) + 0.02
    # the walls stand on the cabin's roof (their bottoms follow its slopes) up to the roof's underside; +-Y are gables
    rz = lambda y: roof_z(y) - 0.1
    planks("twallR", (tx + a, ty - a), (tx + a, ty + a), lambda u: rz(ty - a + u), lambda u: tun(tx + a), M["tplank"],
           4, th, out=(1, 0))
    planks("twallL", (tx - a, ty + a), (tx - a, ty - a), lambda u: rz(ty + a - u), lambda u: tun(tx - a), M["tplank"],
           4, th, out=(-1, 0))
    planks("tgableF", (tx - a, ty - a), (tx + a, ty - a), lambda u: rz(ty - a), lambda u: tun(tx - a + u), M["tplank"],
           4, th, out=(0, -1))
    planks("tgableB", (tx + a, ty + a), (tx - a, ty + a), lambda u: rz(ty + a), lambda u: tun(tx + a - u), M["tplank"],
           4, th, out=(0, 1))
    # its roof: two slopes facing +-X, boards along Y
    run = S.TROOF_RUN / math.cos(ang)
    nb = 3
    bw = run / nb
    length = 2 * (a + S.TROOF_END)
    t = 0.12
    for side in (-1, 1):
        nrm = Vector((side * math.sin(ang), 0, math.cos(ang)))
        for i in range(nb):
            s = (i + 0.5) * bw
            top = Vector((tx + side * s * math.cos(ang), ty, S.TROOF_Z - s * math.sin(ang)))
            box(f"troof{side + 1}{i}", (bw - 0.03, length + rng.uniform(-0.04, 0.04), t), top - nrm * t / 2,
                M["roofy"], rot=(0, side * math.degrees(ang), 0), bevel=0.03, origin="center")
    box("troofridge", (0.2, length + 0.04, 0.14), (tx, ty, S.TROOF_Z + 0.02), M["roofy"], bevel=0.04, origin="center")


def telescope():
    """Built in the camera's world (after the yaw), where Flash draws it."""
    e = px(S.SCOPE_EYE[0], S.SCOPE_EYE[1], Y=S.SCOPE_EYE[2])
    d = Vector(S.SCOPE_DIR).normalized()
    L_ = S.SCOPE_LEN
    # (r, z) along the tube from the eyepiece: a domed cap, a round knuckle, a fat barrel with rings, the flared horn
    # Flash: a knobby joint at the eye end, a short fat barrel, a horn that flares fast to a thick rim
    prof = [(0.0, -0.06), (0.22, -0.04), (0.36, 0.04), (0.46, 0.16), (0.5, 0.3), (0.49, 0.42), (0.42, 0.52),
            (0.4, 0.58), (0.5, 0.66), (0.62, 0.8), (0.7, 1.0), (0.72, 1.25), (0.7, 1.5), (0.62, 1.7), (0.67, 1.76),
            (0.67, 1.86), (0.58, 1.92), (0.54, 2.0)]
    for k in range(1, 12):
        f = k / 11
        prof.append((0.54 + 0.42 * f ** 2.8, 2.0 + (L_ - 2.02) * f))
    prof += [(0.97, L_ - 0.02), (1.01, L_ + 0.06), (0.95, L_ + 0.11), (0.84, L_ + 0.05)]
    tb = lathe("scopetube", prof, e, M["brass"], verts=40)
    track(tb, d)
    inner = [(0.84, L_ + 0.05), (0.66, L_ - 0.3), (0.5, L_ - 0.7), (0.42, L_ - 1.1), (0.0, L_ - 1.15)]
    ib = lathe("scopein", inner, e, M["bellin"], verts=40)
    track(ib, d)
    # the gold bracket: a plate on the front roof slope, an arm up to a clamp round the barrel
    ang = math.radians(S.ROOF_PITCH)
    cx, cy = S.HOUSE_C
    q = [YAW_M @ SHEAR_M @ Vector(v) for v in ((cx, cy, S.ROOF_Z), (cx + 1, cy, S.ROOF_Z),
                                               (cx, cy - math.cos(ang), S.ROOF_Z - math.sin(ang)))]
    p0 = q[0]
    n = (q[1] - q[0]).cross(q[2] - q[0]).normalized()
    if n.z < 0:
        n = -n
    plate = hit_plane(*S.SCOPE_PLATE, p0, n)
    b = box("bracket", (1.25, 1.05, 0.12), plate + n * 0.05, M["plate"], bevel=0.035, origin="center")
    b.rotation_euler = n.to_track_quat("Z", "X").to_euler()
    ox = S.ORIGIN[0]
    t = ((S.SCOPE_ARM - ox) / SX - (e.x + e.y)) / (d.x + d.y)
    t = min(max(t, 0.9), 1.6)
    clamp = e + d * t
    low = clamp - Vector((0, 0, 0.4))
    tube("bracketarm", [plate + n * 0.05, low], 0.22, M["brass"], verts=14)
    c = cyl("bracketclamp", 0.49, 0.2, clamp - d * 0.1, M["brass"], verts=32, bevel=0.04)
    track(c, d)


def scissors():
    """Built in the camera's world (after the yaw): the plane through the pivot and the blade tips; the handle loops
    lifted into it from Flash's pixels."""
    n = (ST[0] - SP).cross(ST[1] - SP).normalized()
    if n.dot(-cam_fwd()) < 0:
        n = -n
    lift_ = lambda q, off: hit_plane(q[0], q[1], SP, n) + n * off
    # each half: a blade to one tip, a shank up from the pivot, a loop (A: teardrop with the far tip, B: D)
    halves = ((ST[1], S.SCIS_TEAR, 0.07), (ST[0], S.SCIS_D, -0.07))
    for k, (tip, loop, off) in enumerate(halves):
        b = (tip - SP).normalized()
        w = n.cross(b).normalized()
        ln = (tip - SP).length
        side = 1 if k == 0 else -1
        outline = []
        for i in range(15):
            f = i / 14
            outline.append(SP + b * ((ln + 0.3) * f - 0.25) + w * side * (0.56 * (1 - f) ** 0.85 + 0.03))
        for i in range(14, -1, -1):
            f = i / 14
            outline.append(SP + b * ((ln + 0.3) * f - 0.25) - w * side * (0.2 * (1 - f) + 0.02))
        bm = bmesh.new()
        a = [bm.verts.new(p + n * (off + 0.045)) for p in outline]
        c = [bm.verts.new(p + n * (off - 0.045)) for p in outline]
        bm.faces.new(a)
        bm.faces.new(c[::-1])
        m = len(a)
        for i in range(m):
            bm.faces.new((a[i], c[i], c[(i + 1) % m], a[(i + 1) % m]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh_ob(f"scisblade{k}", bm, [M["steel"]], bevel=0.03, segs=2)
        pts = [lift_(q, off) for q in loop]
        # Flash's handles are flat steel bands, not round wire
        sweep(f"scisloop{k}", smooth_loop(pts), n, 0.14, 0.34, M["steel"], bevel=0.05, closed=True)
        start = pts[0]
        sweep(f"scisshank{k}", [SP + n * off, SP.lerp(start, 0.5) + n * off * 0.5, start], n, 0.14, 0.34, M["steel"],
              bevel=0.05)
    c = cyl("scispivot", 0.12, 0.3, SP - n * 0.15, M["steel"], verts=16, bevel=0.03)
    track(c, n)


def stairs():
    x0, x1 = A - 0.02, S.STAIR_X1
    lz = S.LAND_Z
    # the landing: a plank box against the stone, and the steps down toward -Y
    box("stairland", (x1 - x0, S.LAND_Y1 - S.LAND_Y0, lz - 0.08), ((x0 + x1) / 2, (S.LAND_Y0 + S.LAND_Y1) / 2, 0),
        M["stair"], bevel=0.04)
    planks("stairside", (x1, S.LAND_Y0), (x1, S.LAND_Y1), lambda u: 0.02, lambda u: lz - 0.06, M["stairside"], 5, 0.08,
           out=(1, 0))
    n = S.STEP_N
    dy = (S.LAND_Y0 - S.STAIR_Y0) / n
    rise = lz / (n + 1)
    for k in range(n):
        y0 = S.STAIR_Y0 + k * dy
        zt = (k + 1) * rise
        box(f"step{k}", (x1 - x0 - 0.1, S.LAND_Y0 - y0, zt - 0.08), ((x0 + x1) / 2 - 0.04, (y0 + S.LAND_Y0) / 2, 0),
            M["riser"], bevel=0.03)
        box(f"steptread{k}", (x1 - x0 + 0.02, dy + 0.06, 0.09), ((x0 + x1) / 2, y0 + dy / 2 - 0.03, zt - 0.09),
            M["tread"], bevel=0.03)
    box("steptreadL", (x1 - x0 + 0.02, S.LAND_Y1 - S.LAND_Y0 + 0.06, 0.09),
        ((x0 + x1) / 2, (S.LAND_Y0 + S.LAND_Y1) / 2, lz - 0.09), M["tread"], bevel=0.03)
    # the outer stringer: a stepped board along the steps' +X side (Flash: paler than the dark step fronts)
    run = S.LAND_Y0 - S.STAIR_Y0
    poly = [(0.0, 0.0), (run + 0.02, 0.0), (run + 0.02, lz - 0.09)]
    for k in range(n - 1, -1, -1):
        poly += [(k * dy + dy, (k + 1) * rise - 0.09), (k * dy, (k + 1) * rise - 0.09)]
    slab("stairstring", (x1 + 0.005, S.STAIR_Y0), (0, 1), poly, 0.08, M["stairside"], bevel=0.02, out=(1, 0))
    # the handrail on the outer side: from the bottom step up to the landing, along it to a post at the back
    hx = x1 - 0.1
    hh = 1.15
    p0 = Vector((hx, S.STAIR_Y0 + 0.2, rise))
    p1 = Vector((hx, S.LAND_Y0, lz))
    p2 = Vector((hx, S.LAND_Y1 - 0.12, lz))
    for i, p in enumerate((p0, p1, p2)):
        cyl(f"handpost{i}", 0.05, hh, p - Vector((0, 0, 0.05)), M["hand"], verts=8, bevel=0.01)
    up = Vector((0, 0, hh))
    tube("handrail", [p0 + up, p1 + up, p2 + up], 0.045, M["hand"], verts=8)


def build():
    base()
    deck()
    posts()
    house()
    tower()
    stairs()
    bpy.context.view_layer.update()
    for ob in list(COLL.objects):           # the cabin and its tower are sheared (stack.HOUSE_SHEAR)
        if ob.type in ("MESH", "CURVE") and family(ob) in ("house", "window", "roof", "tower", "troof"):
            ob.data.transform(SHEAR_M @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)
    for ob in list(COLL.objects):           # the whole building turns by stack.YAW (into the mesh or curve itself)
        if ob.type in ("MESH", "CURVE") and ob.parent is None:
            ob.data.transform(YAW_M @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)
    telescope()                             # these two are placed in the camera's world, where Flash draws them
    scissors()


FAMILY = (("base", "stone"), ("foot", "stone"), ("door", "stone"), ("deck", "deck"), ("post", "rail"), ("ball", "rail"),
          ("rope", "rope"), ("hwall", "house"), ("gable", "house"), ("window", "window"), ("roof", "roof"),
          ("ridge", "roof"), ("twall", "tower"), ("tgable", "tower"), ("troof", "troof"), ("scope", "scope"),
          ("bracket", "bracket"), ("scis", "scis"), ("stair", "stair"), ("step", "stair"), ("hand", "hand"), ("corner", "house"))


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
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"maproom-L{L}.blend"))
    print("DONE", L, MODE)


main()

