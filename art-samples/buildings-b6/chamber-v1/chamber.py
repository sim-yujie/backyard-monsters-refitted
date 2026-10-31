"""chamber.py : the Champion Chamber (Flash building 119) as a 3D model, in the approved Twig/Pebble/Putty/Hatchery/HCC/
General Store/Map Room family (same camera, light, render settings and scale; no outline). Flash has one look for every
level and no animation, so there is one model and one still. The parts and their places are in stack.py. The shared
helpers (materials, meshes, camera, checks) are the Map Room's maproom.py, unchanged.

    blender -b --factory-startup -P chamber.py -- 1 fit      work/fit-L1.png    quick render without the ground, 4 px per Flash px
    blender -b --factory-startup -P chamber.py -- 1 still    render/L1-raw.png (with the ground shadow), render/L1-alone.png
    blender -b --factory-startup -P chamber.py -- 1 check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P chamber.py -- 1 gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P chamber.py -- 1 probe sx sy ...   what the camera sees first through Flash pixels
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
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the box's middle on the ground)
GROUND = S.GROUND
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-78,-66,130,88").split(","))   # the canvas in Flash px (as fref.FRAME; wider for the damage looks)
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1190)


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
    # the box: Flash's icy blue-grey freezer walls, frosted paler toward the top, darker low down
    M["wall"] = painted("wall", (68, 84, 87), rough=0.7, metal=0.05, wear=(112, 126, 128), rust=(34, 42, 44),
                        scale=6.0, dirt=0.5, spec=0.22, top=(82, 104, 106), rust_at=0.5)
    lift(M["wall"], (52, 70, 74), 0.12)
    shade_z(M["wall"], [(0.0, 0.62), (1.6, 0.86), (4.8, 1.0), (6.0, 1.12), (6.5, 1.2)])
    # the frame bars: rounded brown-grey metal, worn
    M["bar"] = painted("bar", (102, 97, 94), rough=0.72, metal=0.1, wear=(128, 120, 112), rust=(54, 50, 48), scale=7.0,
                       dirt=0.35, spec=0.25)
    lift(M["bar"], (100, 90, 86), 0.12)
    M["arm"] = painted("arm", (96, 100, 104), rough=0.65, metal=0.15, wear=(128, 134, 138), rust=(58, 62, 66),
                       scale=6.0, dirt=0.25, spec=0.28)
    lift(M["arm"], (88, 92, 96), 0.12)
    M["lid"] = painted("lid", (60, 94, 98), rough=0.65, metal=0.05, wear=(92, 126, 130), rust=(36, 52, 56), scale=5.0,
                       dirt=0.2, spec=0.25, top=(66, 104, 108), rust_at=0.55)
    lift(M["lid"], (54, 84, 88), 0.14)
    M["frost"] = painted("frost", (198, 214, 216), rough=0.35, wear=(150, 174, 182), scale=3.0, dirt=0.25, spec=0.6,
                         top=(222, 232, 234))
    lift(M["frost"], (170, 190, 196), 0.25)
    M["ice"] = shiny("ice", (196, 222, 230), rough=0.15, metal=0.0, wear=(150, 190, 204), scale=3.0, dirt=0.1, spec=0.8)
    M["dark"] = flat("dark", (14, 18, 20), rough=0.9)
    M["core"] = painted("core", (40, 56, 62), rough=0.6, wear=(60, 80, 86), scale=4.0, dirt=0.2)
    M["grate"] = painted("grate", (46, 52, 56), rough=0.6, metal=0.4, wear=(70, 78, 82), scale=4.0, dirt=0.2)
    M["sill"] = painted("sill", (150, 156, 156), rough=0.8, wear=(110, 116, 118), scale=3.0, dirt=0.3, spec=0.3)
    M["foot"] = painted("foot", (46, 48, 52), rough=0.9, wear=(150, 152, 156), scale=42.0, dirt=0.4, spec=0.2,
                        top=(118, 120, 126))
    M["brass"] = shiny("brass", (218, 204, 162), rough=0.45, metal=0.3, wear=(160, 140, 100), scale=2.0, dirt=0.3,
                       side=0.3)
    M["hornin"] = painted("hornin", (72, 56, 26), rough=0.8, wear=(110, 88, 44), scale=3.0, dirt=0.0, spec=0.3)
    M["coil"] = shiny("coil", (178, 136, 54), rough=0.35, metal=0.8, wear=(112, 82, 30), scale=3.0, dirt=0.2)
    M["panel"] = painted("panel", (34, 36, 34), rough=0.8, wear=(50, 52, 48), scale=4.0, dirt=0.1)
    M["fin"] = shiny("fin", (226, 230, 232), rough=0.25, metal=0.25, wear=(176, 184, 190), scale=3.0, dirt=0.15)
    M["tank"] = painted("tank", (168, 178, 180), rough=0.35, metal=0.3, wear=(212, 222, 224), scale=3.0, dirt=0.3,
                        spec=0.6, top=(222, 230, 232))
    M["glass"] = shiny("glass", (66, 98, 106), rough=0.12, metal=0.15, wear=(104, 138, 146), scale=2.0, dirt=0.1,
                       spec=0.8)
    M["pane"] = shiny("pane", (78, 128, 134), rough=0.2, metal=0.1, wear=(150, 200, 204), scale=2.0, dirt=0.1,
                      spec=0.6)
    lift(M["pane"], (90, 150, 156), 0.15)
    M["glow"] = flat("glow", (120, 232, 240), rough=0.3, emit=2.0)
    M["gback"] = flat("gback", (20, 40, 46), rough=0.6)
    M["steel"] = shiny("steel", (184, 192, 200), rough=0.3, metal=0.8, wear=(140, 148, 160), scale=3.0, dirt=0.1)
    M["pipe"] = painted("pipe", (34, 36, 40), rough=0.5, metal=0.4, wear=(60, 64, 70), scale=4.0, dirt=0.0)
    for k, (sc, amt) in {"wall": (1.4, 0.4), "bar": (1.6, 0.3), "arm": (1.6, 0.28), "lid": (1.4, 0.3),
                         "foot": (1.6, 0.3), "frost": (1.6, 0.1), "tank": (1.6, 0.12), "sill": (1.6, 0.2)}.items():
        stain(M[k], sc, amt, 2.0 + len(k), fine=0.6 if k in ("foot", "bar", "wall", "lid", "arm") else 0.35)
    return M


M = materials()
YAW_M = Matrix.Rotation(math.radians(S.YAW), 4, "Z")
SHEAR_M = Matrix(((1, 0, 0, 0), (S.SHEAR, 1, 0, -S.SHEAR * S.AX), (0, 0, 1, 0), (0, 0, 0, 1)))
ROUND = ("horn", "hornin", "tank", "icicle", "icicled", "tankice", "tankshaft")    # moved by the shear, not bent by it
AX, AY, H, B = S.AX, S.AY, S.H, S.BAR
ACROSS = Vector((1, 1, 0)).normalized()      # across the view on the ground (screen right)
ALONG = Vector((1, -1, 0)).normalized()      # along the view on the ground (toward the viewer)


def body():
    box("body", (2 * AX, 2 * AY, H), (0, 0, 0), M["wall"], bevel=0.1, segs=3)
    zc = H - 0.1 - B / 2
    for i, (sz, at) in enumerate((((2 * AX + B, B, B), (0, -AY, zc)), ((2 * AX + B, B, B), (0, AY, zc)),
                                  ((B, 2 * AY + B, B), (AX, 0, zc)), ((B, 2 * AY + B, B), (-AX, 0, zc)))):
        box(f"bar{i}", sz, at, M["bar"], bevel=S.BAR_R, segs=4)
    box("barpost", (B, B, zc + 0.05), (AX, -AY, 0), M["bar"], bevel=S.BAR_R, segs=4)
    for i, (x, y, sx, sy, h) in enumerate(S.FOOTS):
        box(f"foot{i}", (sx, sy, h), (x, y, 0), M["foot"], bevel=0.14, segs=3, jitter=0.03)


def snow(name, at, r, squash=(1.0, 0.6, 0.85), jag=0.28):
    """A ragged lump of snow (a jittered ball, flattened toward the wall)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    for v in bm.verts:
        v.co *= 1 + rng.uniform(-jag, jag * 0.7)
        v.co.x, v.co.y, v.co.z = v.co.x * squash[0], v.co.y * squash[1], v.co.z * squash[2]
        v.co += Vector(at)
    return mesh_ob(name, bm, [M["frost"]], smooth=True)


def doorway():
    x0, x1, z0, z1 = S.DOOR
    y = -AY
    o = S.JAMB_OUT
    box("door", (x1 - x0, 0.06, z1 - z0), ((x0 + x1) / 2, y - 0.01, z0), M["dark"], bevel=0.0)
    # the grate inside: bars and a cross rail, a little in front of the dark
    for i in range(7):
        x = x0 + 0.35 + i * (x1 - x0 - 0.7) / 6
        box(f"grate{i}", (0.09, 0.09, z1 - z0 - 0.4), (x, y - 0.12, z0 + 0.1), M["grate"], bevel=0.02)
    for z in (z0 + 1.3, z0 + 2.9):
        box(f"grater{z:.0f}", (x1 - x0 - 0.4, 0.1, 0.12), ((x0 + x1) / 2, y - 0.2, z), M["grate"], bevel=0.02)
    # the jambs and the frosted lintel, standing out of the face
    for i, x in enumerate((x0 - S.JAMB / 2, x1 + S.JAMB / 2)):
        box(f"jamb{i}", (S.JAMB, o, z1), (x, y - o / 2, 0), M["wall"], bevel=0.08)
    lz = z1
    xm, hw = (x0 + x1) / 2, (x1 - x0) / 2 + S.JAMB * 0.5
    za, zt = z1 - 1.5, z1 + 0.35                 # the arch springs from the jambs at za, its crown at zt

    def arch_z(x):
        c = max(-1.0, min(1.0, (x - xm) / hw))
        return za + (zt - za) * math.sqrt(1 - c * c)
    for i in range(26):                        # snow lumps along the arch, overlapping, of all sizes
        a = math.pi * (i + rng.uniform(-0.3, 0.3)) / 25
        x = xm - hw * math.cos(a)
        snow(f"lintel{i}", (x, y - o + 0.12 - rng.uniform(0, 0.2), za + (zt - za) * math.sin(a) + rng.uniform(-0.15, 0.1)),
             rng.uniform(0.22, 0.48), squash=(1.0, 0.55, 0.75))
    for i, (x, z, r) in enumerate(((x0 + 0.15, z1 - 0.2, 0.55), (x1 - 0.15, z1 - 0.2, 0.55), (x0 + 0.75, z1 + 0.1, 0.5),
                                   (x1 - 0.75, z1 + 0.1, 0.5), (xm, z1 + 0.5, 0.5))):
        snow(f"lintel{30 + i}", (x, y - o + 0.2, z), r, squash=(1.1, 0.55, 0.8))     # the arch's corners filled: the opening reads round
    for i, x in enumerate((x0 - S.JAMB / 2, x1 + S.JAMB / 2)):   # frost running down the jambs
        for k in range(3):
            snow(f"frostj{i}{k}", (x + rng.uniform(-0.08, 0.08), y - o + 0.05, za - 0.4 - k * 0.55),
                 0.3 - k * 0.05, squash=(0.9, 0.55, 1.3))
    # frost down the box's left corner and along the top of the -Y face, under the bar
    fc = box("frostc", (0.36, 0.36, H - 1.6), (-AX - 0.02, -AY - 0.02, 1.25), M["frost"], bevel=0.12, jitter=0.03)
    crumple_geo(fc, 0.4, 0.1)
    for i in range(11):                        # the corner's frost lumpy and ragged, thicker high up
        z = 1.4 + i * (H - 2.0) / 10
        snow(f"frostjc{i}", (-AX + rng.uniform(-0.1, 0.05), -AY + rng.uniform(-0.1, 0.05), z),
             0.2 + 0.2 * i / 10 + rng.uniform(0, 0.08), squash=(0.9, 0.9, 1.2))
    ft = box("frostt", (2 * AX - 0.6, 0.3, 0.42), (0, -AY - 0.08, H - 0.95), M["frost"], bevel=0.12, jitter=0.03)
    crumple_geo(ft, 0.4, 0.1)
    # icicles under the lintel's front edge, and a few frozen drips down the jambs
    for i in range(14):                        # icicles hanging from the snow arch
        x = x0 - 0.1 + (x1 - x0 + 0.2) * (i + rng.uniform(0.1, 0.9)) / 14
        ln = rng.uniform(0.3, 0.9) * (1.5 if i % 5 == 2 else 1.0)
        cyl(f"icicle{i}", rng.uniform(0.07, 0.13), ln, (x, y - o - 0.02 - rng.uniform(0, 0.12), arch_z(x) - 0.25),
            M["ice"], rot=(180, 0, 0), verts=8, r2=0.01, bevel=0.0)
    for i, x in enumerate((x0 - S.JAMB / 2, x1 + S.JAMB / 2)):
        cyl(f"icicled{i}", 0.1, 1.3, (x, y - o - 0.03, za - 0.1), M["ice"], rot=(180, 0, 0), verts=8, r2=0.02,
            bevel=0.0)
    box("sill", (x1 - x0 + 2 * S.JAMB, o + 0.35, 0.3), ((x0 + x1) / 2, y - (o + 0.35) / 2, 0), M["sill"], bevel=0.06)
    # the door leaf, standing open toward the viewer's left, on the left jamb
    leaf = box("leaf", (1.15, 0.1, z1 - z0 - 0.3), (0, 0, 0), M["grate"], bevel=0.03)
    leaf.data.transform(Matrix.Translation((-0.575, 0, 0)))
    leaf.location = (x0 - S.JAMB - 0.02, y - o - 0.06, z0)
    leaf.rotation_euler = (0, 0, math.radians(-78))


def compressor():
    x1, y0, y1, h = S.COMP
    box("comp", (x1 - AX + 0.1, y1 - y0, h), ((AX + x1) / 2 - 0.05, (y0 + y1) / 2, 0), M["wall"], bevel=0.12)
    cy0, cy1, cz0, cz1, n = S.COIL
    box("coilpanel", (0.06, cy1 - cy0 + 0.3, cz1 - cz0 + 0.3), (x1 + 0.02, (cy0 + cy1) / 2, cz0 - 0.15), M["panel"],
        bevel=0.02)
    pts = []
    w = (cy1 - cy0) / (2 * n)
    for i in range(n):
        ya, yb = cy0 + 2 * i * w + w * 0.25, cy0 + (2 * i + 1) * w + w * 0.75
        pts += [(x1 + 0.14, ya, cz0), (x1 + 0.14, ya, cz1 - w), (x1 + 0.14, (ya + yb) / 2, cz1),
                (x1 + 0.14, yb, cz1 - w), (x1 + 0.14, yb, cz0)]
    tube("coil", pts, 0.085, M["coil"], smooth=True)
    for i, yf in enumerate(S.FINS_Y):
        poly = []
        for k in range(9):
            t = math.radians(90 * k / 8)
            poly.append((1.8 * math.sin(t), h + 1.5 * math.cos(t)))
        for k in range(8, -1, -1):
            t = math.radians(90 * k / 8)
            poly.append((1.05 * math.sin(t), h + 0.8 * math.cos(t)))
        slab(f"fin{i}", (AX + 0.15, yf), (1, 0), poly, 0.26, M["fin"], bevel=0.07, out=(0, -1))
    # the tanks on their plinth, and the pipe that curls down to them from the top
    tx, ty, tr, zs = S.TANK
    box("plinth", (2 * tr + 0.2, 2 * tr + 0.2, 0.42), (tx, ty, 0), M["grate"], bevel=0.06)
    for i, (za, zb) in enumerate(zs):
        lathe(f"tank{i}", [(0.0, za), (tr * 0.82, za), (tr, za + 0.18), (tr * 1.02, (za + zb) / 2), (tr, zb - 0.18),
                           (tr * 0.82, zb), (0.0, zb)], (tx, ty, 0), M["tank"], verts=32)
        for k in range(7):
            a = math.radians(-160 + k * 26 + rng.uniform(-6, 6))
            cyl(f"tankice{i}{k}", rng.uniform(0.06, 0.1), rng.uniform(0.25, 0.6),
                (tx + tr * 0.99 * math.cos(a), ty + tr * 0.99 * math.sin(a), za + 0.12), M["ice"], rot=(180, 0, 0),
                verts=8, r2=0.01, bevel=0.0)
    for i, (za, zb) in enumerate(zs):
        for k in range(9):
            a = math.radians(-170 + k * 24 + rng.uniform(-8, 8))
            snow(f"frostjt{i}{k}", (tx + tr * 0.86 * math.cos(a), ty + tr * 0.86 * math.sin(a), zb - 0.08),
                 rng.uniform(0.2, 0.32), squash=(1.0, 1.0, 0.6))
    cyl("tankshaft", 0.4, zs[1][0] - zs[0][1] + 0.2, (tx, ty, zs[0][1] - 0.1), M["grate"], verts=16)
    tube("pipe", [(2.5, -2.9, H + 0.02), (2.85, -2.85, H + 0.75), (3.5, -2.8, H + 0.85), (3.95, -2.7, H + 0.2),
                  (4.1, -2.5, zs[1][1] + 0.9), (tx - 0.2, ty - 0.1, zs[1][1] - 0.02)], 0.09, M["pipe"], smooth=True)


def horns():
    for i, (x, y, z0, zc, mr) in enumerate(S.HORNS):
        h = zc - z0
        hr = S.HORN_R
        prof = [(hr * 1.25, 0.0), (hr * 1.25, 0.25), (hr, 0.32), (hr, h - 1.15), (hr * 1.12, h - 0.75),
                (mr * 0.62, h - 0.32), (mr * 0.9, h - 0.08), (mr, h), (mr - 0.14, h + 0.02)]
        lathe(f"horn{i}", prof, (x, y, z0), M["brass"], verts=32)
        lathe(f"hornin{i}", [(mr - 0.15, h + 0.01), (mr * 0.55, h - 0.3), (hr * 0.7, h - 0.9), (0.0, h - 1.0)],
              (x, y, z0), M["hornin"], verts=32)


def top():
    # the glass hatch: an octagon facing the viewer, tipped a little toward them, on a low frame
    cx, cy, ra, rb, tilt = S.HATCH
    c = Vector((cx, cy, H + 0.32))
    tt = math.tan(math.radians(tilt))
    oct_ = [(ra * math.cos(math.radians(22.5 + 45 * k)) / math.cos(math.radians(22.5)),
             rb * math.sin(math.radians(22.5 + 45 * k)) / math.cos(math.radians(22.5))) for k in range(8)]

    def at(u, v, dz=0.0):
        return c + ACROSS * u + ALONG * v + Vector((0, 0, -v * tt + dz))
    bm = bmesh.new()
    top_ = [bm.verts.new(at(u, v)) for u, v in oct_]
    bot = [bm.verts.new(at(u, v) * 1.0 - Vector((0, 0, at(u, v).z - H + 0.02))) for u, v in oct_]
    bm.faces.new(top_)
    bm.faces.new(bot[::-1])
    for k in range(8):
        bm.faces.new((top_[k], bot[k], bot[(k + 1) % 8], top_[(k + 1) % 8]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("hatchbase", bm, [M["arm"]], smooth=False, bevel=0.06, segs=2)
    inner = [(u * 0.82, v * 0.84) for u, v in oct_]
    bm = bmesh.new()
    vs = [bm.verts.new(at(u, v, 0.04)) for u, v in inner]
    bm.faces.new(vs)
    mesh_ob("hatchglass", bm, [M["glass"]], smooth=False)
    tube("hatchrim", [tuple(at(u * 0.86, v * 0.88, 0.05)) for u, v in oct_], 0.11, M["steel"], cyclic=True)
    lz0 = S.LID[3]
    for k in range(4):                          # the glass stack: panes, each a little smaller, up to the lid
        f = 0.98 - 0.07 * k
        z0 = 0.12 + k * (lz0 - H - 0.3) / 4
        bm = bmesh.new()
        lo = [bm.verts.new(at(u * f, v * f, z0)) for u, v in oct_]
        hi = [bm.verts.new(at(u * f, v * f, z0 + 0.2)) for u, v in oct_]
        bm.faces.new(lo[::-1])
        bm.faces.new(hi)
        for j in range(8):
            bm.faces.new((lo[j], lo[(j + 1) % 8], hi[(j + 1) % 8], hi[j]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh_ob(f"hatchpane{k}", bm, [M["pane"]], smooth=False, bevel=0.08, segs=2)
    # the lid and its glowing grille
    lx, ly, la, lz, lt = S.LID
    # the lid: a thick square slab, its front corner cut away along the arms (the hatch shows under the cut)
    corners = [(lx - la, ly - la), S.LID_CUT[0], S.LID_CUT[1], (lx + la, ly + la), (lx - la, ly + la)]
    bm = bmesh.new()
    loop = rounded_poly(corners, 0.35, 5)
    lo = [bm.verts.new((x, y, lz)) for x, y in loop]
    hi = [bm.verts.new((x, y, lz + lt)) for x, y in loop]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    for k in range(len(loop)):
        bm.faces.new((lo[k], lo[(k + 1) % len(loop)], hi[(k + 1) % len(loop)], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("lid", bm, [M["lid"]], smooth=False, bevel=0.16, segs=4)
    x0, y0, x1, y1 = S.CORE
    box("core", (x1 - x0, y1 - y0, lz - H + 0.05), ((x0 + x1) / 2, (y0 + y1) / 2, H - 0.05), M["core"], bevel=0.1)
    (ax_, ay_), (bx_, by_) = S.LID_CUT
    k = 0
    for (pa, pb) in (((lx - la, ly - la), (ax_, ay_)), ((ax_, ay_), (bx_, by_)), ((bx_, by_), (lx + la, ly + la))):
        n = max(2, int(math.dist(pa, pb) / 0.55))
        ex, ey = pb[1] - pa[1], -(pb[0] - pa[0])            # outward (the lid's front edges run clockwise)
        el = math.hypot(ex, ey)
        ex, ey = ex / el, ey / el
        for i in range(n + 1):                  # frost along the lid's front top edges, ragged, overhanging
            t = (i + rng.uniform(-0.3, 0.3)) / n
            if rng.random() < 0.2:
                continue
            q = (pa[0] + (pb[0] - pa[0]) * t + ex * 0.1, pa[1] + (pb[1] - pa[1]) * t + ey * 0.1)
            snow(f"frostl{k}", (q[0], q[1], lz + lt - 0.05), rng.uniform(0.14, 0.28), squash=(1.5, 1.5, 0.4))
            if rng.random() < 0.6:
                cyl(f"icicle{60 + k}", rng.uniform(0.06, 0.1), rng.uniform(0.25, 0.7), (q[0] + ex * 0.12, q[1] + ey * 0.12,
                    lz + 0.05), M["ice"], rot=(180, 0, 0), verts=8, r2=0.01, bevel=0.0)
            k += 1
    for i in range(9):                      # icicles under the cut edge's left half
        t = 0.04 + 0.42 * (i + rng.uniform(0.1, 0.9)) / 9
        cyl(f"icicle{40 + i}", rng.uniform(0.07, 0.12), rng.uniform(0.3, 0.75) * (1.0 - t),
            (ax_ + (bx_ - ax_) * t + 0.12, ay_ + (by_ - ay_) * t - 0.12, lz + 0.05), M["ice"], rot=(180, 0, 0), verts=8,
            r2=0.01, bevel=0.0)
    gx, gy, gax, gay = S.GRILLE
    zt = lz + lt
    box("grilleback", (2 * gax, 2 * gay, 0.04), (gx, gy, zt - 0.02), M["gback"], bevel=0.0)
    ring = [(gx + p[0], gy + p[1], zt + 0.06) for p in rounded_poly([(-gax, -gay), (gax, -gay), (gax, gay), (-gax, gay)],
                                                                      0.4, 6)]
    tube("grillerim", ring, 0.13, M["arm"], cyclic=True)
    for i in range(5):
        x = gx - gax + 0.4 + i * (2 * gax - 0.8) / 4
        box(f"grillebar{i}", (0.16, 2 * gay - 0.3, 0.07), (x, gy, zt), M["glow"], bevel=0.02)


def arms():
    """The two heavy arms under the lid, placed in the camera's world where Flash draws them."""
    for nm, pts in (("arml", S.ARM_L), ("armr", S.ARM_R)):
        wp = [px(sx, sy, Z=z) for sx, sy, z in pts]
        sm = smooth_loop(wp, 4)
        # an open curve: Catmull-Rom without wrapping (drop the closing spans)
        sm = sm[:4 * (len(wp) - 1) + 1]
        sweep(nm, sm, ACROSS, S.ARM_W, S.ARM_T, M["arm"], bevel=0.22)
        r = tube(nm + "bolt", [(0.26 * math.cos(2 * math.pi * k / 16), 0.26 * math.sin(2 * math.pi * k / 16), 0)
                               for k in range(16)], 0.07, M["steel"], cyclic=True)
        r.location = wp[1] + Vector((0, 0, S.ARM_T / 2 + 0.03))
        r.rotation_euler = (0, 0, 0)


def build():
    body()
    doorway()
    compressor()
    horns()
    top()
    bpy.context.view_layer.update()
    for ob in list(COLL.objects):           # the shear (stack.SHEAR), then the yaw, into the mesh or curve itself
        if ob.type not in ("MESH", "CURVE") or ob.parent is not None:
            continue
        if ob.name.split(".")[0].rstrip("0123456789") in ROUND:
            ob.location = YAW_M @ SHEAR_M @ ob.location
            ob.rotation_euler.z += math.radians(S.YAW)
            continue
        ob.data.transform(YAW_M @ SHEAR_M @ ob.matrix_world)
        ob.matrix_world = Matrix.Identity(4)
    arms()                                  # placed in the camera's world, where Flash draws them


FAMILY = (("body", "body"), ("door", "door"), ("grate", "door"), ("leaf", "leaf"), ("jamb", "body"), ("lintel", "frost"), ("frostc", "frost"), ("frostt", "frost"), ("frostj", "frost"), ("frostl", "frost"),
          ("icicle", "frost"), ("sill", "sill"), ("barpost", "bar"), ("bar", "bar"), ("foot", "foot"),
          ("comp", "comp"), ("coilpanel", "comp"), ("coil", "coil"), ("fin", "fin"), ("plinth", "tank"),
          ("tank", "tank"), ("pipe", "pipe"), ("hornin", "horn"), ("horn", "horn"), ("hatch", "hatch"),
          ("lid", "lid"), ("grille", "lid"), ("core", "lid"), ("arm", "arm"))


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
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"chamber-L{L}.blend"))
    print("DONE", L, MODE)


main()

