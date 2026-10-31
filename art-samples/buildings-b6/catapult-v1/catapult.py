"""catapult.py : the Catapult (Flash building 51) as a 3D model, in the approved Twig/Pebble/Putty/Hatchery/HCC/General
Store/Map Room/Flinger family (same camera, light, render settings and scale; no outline). Flash has three looks (art
levels 1-3; level 4 shows look 3) and no animation, so there is one still per look. One body grows through the looks;
the parts and their places are in stack.py. The shared helpers (materials, meshes, camera, checks) are the Flinger's.

    blender -b --factory-startup -P catapult.py -- <level> fit      work/fit-L<level>.png  quick, no ground, 4 px a Flash px
    blender -b --factory-startup -P catapult.py -- <level> still    render/L<level>-raw.png (ground shadow), L<level>-alone.png
    blender -b --factory-startup -P catapult.py -- <level> check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P catapult.py -- <level> gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P catapult.py -- <level> probe sx sy ...   what the camera sees first through Flash px
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
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the look 1 frame's middle on the ground)
CAM_ORIGIN = (S.ORIGIN[0], S.ORIGIN[1] + S.LOOK_DY.get(min(int(ARGS[0]), 3), 0.0))   # where the camera puts it
GROUND = S.GROUND
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-64,-40,80,84").split(","))   # the canvas in Flash px (as fref.FRAME)
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(500)


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
def slate(name, cols, rough=0.42, rows=True):
    """Flash's slate tiles: each tile its own blue-grey or lavender (Object Info random picks from cols), with Flash's
    strong contrast: a pale lit rim along its rounded lower end and a dark shadow line where the next row up lies over
    it (both from the tile's UV: 0 at the lower end). rows=False: no UV (the ridge slates), a plain mottle only."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    oi = t.n("ShaderNodeObjectInfo")
    stops = []
    for i, c in enumerate(cols):
        stops.append((i / len(cols) + 0.001, srgb(*c)))
    r = t.n("ShaderNodeValToRGB")
    r.color_ramp.interpolation = "CONSTANT"
    el = r.color_ramp.elements
    el[0].position, el[0].color = 0.0, srgb(*cols[0])
    el[1].position, el[1].color = stops[-1]
    for pos, col in stops[1:-1]:
        el.new(pos).color = col
    t.link(oi.outputs["Random"], r.inputs[0])
    col = r.outputs[0]
    n1 = t.noise(v, 9.0, 3.0, 0.5)
    col = t.mix(col, t.ramp(n1, [(0.3, srgb(104, 110, 160)), (0.7, srgb(214, 214, 242))]), 0.2, "MIX")
    if rows:
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(t.n("ShaderNodeUVMap").outputs["UV"], sep.inputs[0])
        u = sep.outputs["X"]
        # the lit rim along the lower end
        rim = t.ramp(u, [(0.0, (1, 1, 1, 1)), (0.1, (0.55, 0.55, 0.55, 1)), (0.26, (0, 0, 0, 1))])
        col = t.mix(col, srgb(226, 228, 252), t.mix(rim, (0, 0, 0, 1), 0.35), "MIX")
        # the shadow line under the next row's lower end (it lies over this tile from about u = 0.78)
        sh = t.ramp(u, [(0.5, (1, 1, 1, 1)), (0.66, (0.62, 0.62, 0.7, 1)), (0.76, (0.2, 0.2, 0.3, 1)),
                        (0.9, (0.16, 0.16, 0.24, 1))])
        col = t.mix(col, sh, 1.0, "MULTIPLY")
    col = t.grime(col, GROUND, 3.0, 0.15, 0.45)
    t.set(**{"Base Color": col, "rough": rough, "spec": 0.55})
    t.bump(t.noise(v, 14, 4.0, 0.6), 0.06, 0.01)
    MATS[name] = t.m
    return t.m


def dimpled(name, col, dim):
    """The golf ball: glossy white with soft round dimples (a Voronoi cell pattern pressed in and a touch darker)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    vo = t.n("ShaderNodeTexVoronoi")
    vo.feature = "F1"
    vo.inputs["Scale"].default_value = 5.5
    t.link(v, vo.inputs["Vector"])
    pit = t.ramp(vo.outputs["Distance"], [(0.0, (1, 1, 1, 1)), (0.34, (0, 0, 0, 1))])
    col = t.mix(srgb(*col), srgb(*dim), pit, "MIX")
    col = t.grime(col, GROUND, 1.6, 0.12, 0.55)
    t.set(**{"Base Color": col, "rough": 0.38, "spec": 0.5})
    b = t.n("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.55
    b.inputs["Distance"].default_value = 0.04
    b.invert = True
    t.link(pit, b.inputs["Height"])
    t.link(b.outputs[0], t.bsdf.inputs["Normal"])
    MATS[name] = t.m
    return t.m


LOOK = min(L, 3)                      # level 4 shows look 3


def materials():
    M = {}
    # Flash's timber: dark brown square posts and beams, pale tan sticks (the lever and look 1's cross bars)
    for ax in ("X", "Y", "Z"):
        if LOOK == 3:                   # look 3's whole box: paler, yellower wood (Flash)
            M["post" + ax] = wood("post3", (156, 132, 92), (100, 84, 56), axis=ax, dirt=0.25, rings=4.0)
        else:
            M["post" + ax] = wood("post", (94, 72, 54), (52, 40, 30), axis=ax, dirt=0.25, rings=4.0)
        M["pale" + ax] = wood("pale", (204, 172, 138), (156, 124, 96), axis=ax, dirt=0.1, rings=3.0, knots=False)
        if LOOK == 2:                   # look 2's box: dark chocolate planks
            M["plank" + ax] = wood("plank2", (100, 80, 58), (56, 44, 34), axis=ax, dirt=0.3, rings=4.0)
        else:                           # look 3's: paler, yellower
            M["plank" + ax] = wood("plank3", (166, 142, 92), (108, 90, 56), axis=ax, dirt=0.3, rings=4.0)
        M["pole" + ax] = wood("pole", (150, 122, 84), (98, 78, 52), axis=ax, dirt=0.1, rings=3.0)
    for k in ("postX", "postY", "postZ", "plankX", "plankY", "plankZ"):
        stain(M[k], 1.1, 0.22, 2.0 + len(k), fine=0.1)
    M["inside"] = flat("inside", (20, 15, 11), rough=1.0)
    # the box's inside (the floor, the -X planks' inner face): the same wood in shadow
    M["dim"] = wood("dim", (70, 56, 38), (40, 32, 22), axis="X", dirt=0.3, rings=4.0) if LOOK == 3 else         wood("dim", (50, 38, 28), (28, 21, 16), axis="X", dirt=0.3, rings=4.0)
    # metals: Flash's pale blue-grey polished steel (the axles, bows, brackets), darker grey gears, near-black feet
    M["steel"] = shiny("steel", (176, 186, 202), rough=0.3, metal=0.8, wear=(128, 138, 156), scale=3.0, dirt=0.15)
    M["gear"] = shiny("gear", (160, 160, 168), rough=0.4, metal=0.75, wear=(116, 116, 126), scale=3.0, dirt=0.2)
    M["gdark"] = painted("gdark", (108, 110, 120), rough=0.5, metal=0.4, dirt=0.0, spec=0.4)
    M["foot"] = painted("foot", (50, 50, 58), rough=0.45, metal=0.5, wear=(70, 70, 80), scale=4.0, dirt=0.2, spec=0.5)
    M["rivet"] = shiny("rivet", (220, 210, 186), rough=0.35, metal=0.5, dirt=0.0)
    # the bucket: pale tan wood, a dark brown inside, a dark band round the rim with studs
    M["bucket"] = wood("bucket", (180, 150, 114), (132, 106, 80), axis="Z", dirt=0.25, rings=3.0, knots=False)
    M["bin"] = painted("bin", (74, 58, 44), rough=0.8, wear=(58, 44, 34), scale=3.0, dirt=0.0, spec=0.2)
    M["band"] = painted("band", (96, 74, 54), rough=0.6, dirt=0.0, spec=0.3)
    M["stud"] = shiny("stud", (212, 220, 232) if LOOK >= 2 else (150, 154, 166), rough=0.35, metal=0.4, dirt=0.0)
    # look 3's rope drum: pale cream
    M["drum"] = painted("drum", (214, 184, 152), rough=0.75, wear=(184, 150, 120), scale=9.0, dirt=0.25, spec=0.15)
    M["groove"] = painted("groove", (182, 148, 116), rough=0.8, dirt=0.0, spec=0.1)
    return M


M = materials()
FA, FB = S.FA, S.FB
P = S.POST
YAW_M = Matrix.Rotation(math.radians(S.YAW), 4, "Z")
CX, CY = FA - P / 2, FB - P / 2       # the posts' middles


def beam(name, p0, p1, w, h, mat, bevel=0.04):
    """A square beam w x h from p0 to p1 (world), its h side kept as upright as it can be."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    return sweep(name, [p0, p1], side, w, h, mat, bevel=bevel)


def rod(name, x0, x1, y, z, r, mat, verts=24):
    """A round steel rod along X."""
    return cyl(name, r, x1 - x0, (x0, y, z), mat, rot=(0, 90, 0), verts=verts, bevel=0.02)


def wheel_gear(name, x, y, z, r, mat):
    """Flash's toothed gear in an upright plane (axle along X): the light grey toothed disc, a mid-grey inner disc
    flush with its face, a thin pale ring on it, a short hub."""
    obs = [gear(name, r, 14, 0.24, (x, y, z), mat, (0, math.radians(90), 0), tooth=0.17)]
    obs.append(cyl(name + "disc", r * 0.64, 0.25, (x - 0.125, y, z), M["gdark"], rot=(0, 90, 0), verts=32))
    t = ring(name + "ring", r * 0.46, 0.04, M["steel"])         # Flash's thin pale ring inside the teeth
    t.location = (x + 0.13, y, z)
    t.rotation_euler = (0, math.radians(90), 0)
    obs.append(t)
    obs.append(cyl(name + "hub", r * 0.2, 0.3, (x - 0.15, y, z), M["steel"], rot=(0, 90, 0), verts=24))
    return obs


# ------------------------------------------------------------------------------------------------------------ look 1
def frame1():
    for sx in (-1, 1):
        for sy in (-1, 1):
            if sx > 0 and sy > 0:       # the back right corner: a raked leg down to the ground behind
                fx, fy = S.STRUT_FOOT
                beam("leg11", (CX, CY, S.TOP1 - S.BEAM - 0.05), (fx, fy, 0.05), P - 0.08, P - 0.1, M["postY"])
                continue
            box(f"post{sx}{sy}", (P, P, S.TOP1), (sx * CX, sy * CY, 0), M["postZ"], bevel=0.04, jitter=0.01)
        # the side beams along Y on the posts' tops
        box(f"sbeam{sx}", (S.BEAM, 2 * FB + 0.1, S.BEAM), (sx * (FA - S.BEAM / 2), 0, S.TOP1 - S.BEAM + 0.02),
            M["postY"], bevel=0.04)
    # the pale cross bars along X, between the posts, carrying the lever
    for sy, nm in ((-1, "fbar"), (1, "bbar")):
        y = sy * CY
        z = arm_z(y) - 0.12 - 0.11                                # their tops under the lever
        box(nm, (2 * FA - 0.1, 0.22, 0.22), (0, y, z), M["paleX"], bevel=0.04, origin="centre")


def arm_z(y):
    (y0, z0), (y1, z1) = S.ARM_P0, S.ARM_P1
    return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


def lever1():
    (y0, z0), (y1, z1) = S.ARM_P0, S.ARM_P1
    beam("arm", (S.ARM_X, y0, z0), (S.ARM_X, y1, z1), 0.26, 0.24, M["paleY"])


def axle1():
    y, z = S.AX1_Y, S.AX1_Z
    x0, x1 = S.AX1_X
    rod("axle", -1.9, x1, y, z, 0.17, M["steel"])
    rod("sleeve", -1.55, 0.55, y, z, 0.27, M["steel"], verts=32)
    xb = FA - S.BEAM / 2
    box("bracket", (0.46, 0.5, 0.75), (xb, y, S.TOP1 + 0.02), M["steel"], bevel=0.06)     # on the +X side beam
    # the -X end (Flash): a low dark saddle on the side beam, and the axle bent at a steel elbow out past the beam
    # and down toward the front, like a crank
    box("bracket", (0.42, 0.48, 0.42), (-xb, y, S.TOP1 + 0.0), M["gdark"], bevel=0.05)
    # Flash's elbow is blocky: square steel arms meeting in a cube, a square cap on the end
    xe = -2.12
    beam("elbow", (-1.75, y, z), (xe, y, z), 0.42, 0.42, M["steel"], bevel=0.06)
    box("elbow", (0.56, 0.56, 0.56), (xe, y - 0.04, z - 0.28), M["steel"], bevel=0.08)
    beam("elbow", (xe, y - 0.2, z - 0.08), (xe, y - 0.72, z - 0.31), 0.38, 0.38, M["steel"], bevel=0.06)
    box("elbow", (0.48, 0.24, 0.48), (xe, y - 0.78, z - 0.55), M["steel"], bevel=0.06)
    wheel_gear("gear", S.GEAR1_X, y, z, S.GEAR_R, M["gear"])


def bucket(look):
    bx, by = S.BUCKET_C
    z0, z1 = S.BUCKET1 if look == 1 else S.BUCKET2
    R = S.BUCKET_R
    h = z1 - z0
    rb = R * 0.84                       # a round, barely tapered basket, as Flash's
    prof = [(0.0, 0.0), (rb * 0.7, 0.0), (rb, 0.06), (R * 0.97, h * 0.45), (R * 1.0, h * 0.82), (R, h),
            (R - 0.1, h), (R - 0.13, h * 0.9), (rb - 0.13, 0.22), (0.0, 0.22)]
    o = lathe("bucket", prof, (bx, by, z0), M["bucket"], verts=40)
    o.data.polygons.foreach_set("material_index", [0] * len(o.data.polygons))
    # the inside: a dark lining just inside the walls
    lathe("bin", [(0.0, 0.25), (rb - 0.16, 0.25), (R - 0.15, h * 0.9), (R - 0.12, h - 0.02)], (bx, by, z0), M["bin"],
          verts=40)
    # the dark band round the rim and the studs on it
    ring("band", R + 0.005, 0.07, M["band"], z=z0 + h - 0.1).location.xy = (bx, by)
    if look >= 2:               # looks 2, 3: Flash's pale bluish clamps set over the rim all round
        n = 11
        for i in range(n):
            a = 2 * math.pi * (i + 0.5) / n
            box("stud", (0.36, 0.26, 0.36), (bx + (R - 0.07) * math.cos(a), by + (R - 0.07) * math.sin(a), z0 + h - 0.26),
                M["stud"], rot=(0, 0, math.degrees(a)), bevel=0.04)
        return
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        sphere("stud", 0.08, (bx + (R + 0.03) * math.cos(a), by + (R + 0.03) * math.sin(a), z0 + h - 0.08), M["stud"],
               n=10)


# ------------------------------------------------------------------------------------------------------------ looks 2, 3
def back_top():
    """The box top's back edge (y), where its back starts sloping down."""
    return FB - 0.1


def box2():
    """Looks 2, 3: look 1's frame grown into a low, open box (Flash). The front and left corner posts rise above it to
    carry the steel bracket blocks; side rails along Y lie on the posts at look 1's beam height; planks low on the -Y
    front and the -X back, up to the rail on the +X side, whose back slopes down to a foot far behind. No lid: the
    steel works sit down inside it."""
    fh, top, rail, by = S.FOOT_H, S.TOP2, S.RAIL, S.BACK_Y
    yb = back_top()
    yf = by - 0.45                      # the sloping legs' feet
    # steel feet: under the front corners and the back slope's foot
    for sx in (-1, 1):
        for y in (-CY, yf):
            box("foot", (0.95, 0.95, fh), (sx * (CX - 0.05), y, 0), M["foot"], bevel=0.06)
    # the tall corner posts at the front, the sloping legs from the rails' backs down to the feet behind
    for sx in (-1, 1):
        box(f"post{sx}", (P + 0.06, P + 0.06, top - fh), (sx * CX, -CY, fh), M["postZ"], bevel=0.04, jitter=0.01)
        beam(f"leg{sx}", (sx * CX, yb - 0.2, rail - 0.05), (sx * CX, yf, fh), P + 0.04, P, M["postY"])
        # rivets down the front corner post's -Y face
        for k in range(7):
            z = fh + 0.35 + k * (top - fh - 0.6) / 6
            sphere("rivet", 0.06, (sx * CX + 0.12 * sx, -FB - 0.035, z), M["rivet"], n=8)
        # the side rail along Y on the posts (look 1's side beam); the -X one sticks out past the front (Flash)
        y0 = -FB - (0.55 if sx < 0 else 0.0)
        box(f"sbeam{sx}", (S.BEAM, yb - y0, S.BEAM), (sx * (FA - S.BEAM / 2), (y0 + yb) / 2, rail - S.BEAM),
            M["postY"], bevel=0.04)

    # the side walls: upright planks, the tops under the rail (+X) or low (-X), then following the slope
    def side_top(u, flat):
        y = -FB + u
        slope = rail - 0.05 + (y - (yb - 0.2)) * (fh - rail + 0.05) / (yf - (yb - 0.2))
        return min(flat, slope)
    for sx, flat in ((1, rail - S.BEAM + 0.02), (-1, S.WALL_B)):
        planks(f"xwall{sx}", (sx * (FA - 0.04), -FB + P), (sx * (FA - 0.04), by - 0.75), lambda u: fh,
               lambda u, f=flat: side_top(u + P, f), M["plankZ"], 7, thick=0.12, gap=0.035, out=(sx, 0))
    # the -Y front between the posts: low planks under a top rail, the box open above them
    planks("ywall", (-FA + P, -FB + 0.04), (FA - P, -FB + 0.04), lambda u: fh, lambda u: S.WALL_F - 0.24,
           M["plankZ"], 6, thick=0.12, gap=0.035, out=(0, -1))
    box("frail", (2 * FA - 2 * P + 0.12, 0.34, 0.26), (0, -FB + 0.13, S.WALL_F - 0.26), M["postX"], bevel=0.04)
    # the floor, low inside, and the sloping back
    box("deck", (2 * FA - 0.3, yb + FB - 0.3, 0.12), (0, (yb - FB) / 2, fh), M["dim"], bevel=0.03)
    # the inside of the -X planks in shadow (Flash's box is dark inside)
    box("deck", (0.03, by - 0.75 + FB - P, S.WALL_B - fh - 0.1), (-(FA - 0.2), (by - 0.75 - FB + P) / 2, fh + 0.1),
        M["dim"], bevel=0.0)
    d = Vector((0, yf - (yb - 0.2), fh - rail))
    n = d.normalized()
    q = Vector((0, yb - 0.2, rail - 0.1)) + d / 2
    o = box("back", (2 * FA - 0.3, d.length, 0.12), q, M["plankY"], bevel=0.03, origin="centre")
    o.rotation_euler = (math.atan2(n.z, n.y), 0, 0)


def axle2():
    y, z = S.AX2_Y, S.AX2_Z
    rod("axle", -S.GEAR2_X - 0.15, S.GEAR2_X + 0.15, y, z, 0.17, M["steel"])
    rod("sleeve", -1.3, 1.3, y, z, 0.26, M["steel"], verts=32)
    for sx in (-1, 1):
        # dark steel stands on the side rails, just inside the gears, carry it
        box("stand", (0.16, 0.36, z - S.RAIL + 0.1), (sx * 2.0, y, S.RAIL - 0.02), M["gdark"], bevel=0.04)
        wheel_gear(f"gear{sx}", sx * S.GEAR2_X, y, z, 1.5 if sx > 0 else 1.3, M["gear"])
    # the lower rod on the bracket blocks on top of the front corner posts
    for sx in (-1, 1):
        box("bracket", (0.56, 0.6, 0.72), (sx * S.BOW_X, S.ROD_Y, S.TOP2 - 0.02), M["steel"], bevel=0.06)
    rod("rod", -S.BOW_X, S.BOW_X, S.ROD_Y, S.ROD_Z, 0.15, M["steel"])
    # Flash's busier steel down in the box: a second rod across the side rails through the stands, out past the +X
    # side to a round end cap; collars on the axle inside the gears; flat straps from each stand to its bracket block
    y2, z2 = 0.66, S.RAIL + 0.13
    rod("rod2", -2.3, 2.42, y2, z2, 0.13, M["steel"])
    rod("cap", 2.4, 2.62, y2, z2, 0.3, M["steel"], verts=32)
    # a small pinion on it under the +X gear, meshing with it (Flash's steel bits under that gear)
    gear("gearpin", 0.55, 10, 0.2, (S.GEAR2_X, y2, z2), M["gear"], (0, math.radians(90), 0), tooth=0.13)
    for sx in (-1, 1):
        rod("collar", sx * 1.95 - (0.3 if sx > 0 else 0.0), sx * 1.95 + (0.0 if sx > 0 else 0.3), y, z, 0.24,
            M["steel"], verts=24)
        box("strap", (0.14, (y - 0.1) - S.ROD_Y, 0.16), (sx * 1.98, (y - 0.1 + S.ROD_Y) / 2, S.TOP2 + 0.28),
            M["steel"], bevel=0.03)


def bows():
    for sx in (-1, 1):
        x = sx * S.BOW_X
        pts = [(x, y, z) for y, z in S.BOW]
        pts[0] = (x, S.BOW[0][0], S.TOP2 + 0.6)
        tube("bow", pts, 0.1, M["steel"], smooth=True)
        y1, z1 = S.BOW[-1]
        y0, z0 = S.BOW[-2]
        d = Vector((0, y1 - y0, z1 - z0)).normalized()
        k = cyl("knob", 0.16, 0.36, (x, y1, z1), M["steel"], verts=16)
        k.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def lever2():
    """Looks 2, 3: the lever runs from the bucket's back rim up to the lower rod."""
    bx, by = S.BUCKET_C
    z1 = S.BUCKET2[1]
    beam("arm", (0.35, by + S.BUCKET_R - 0.05, z1 + 0.1), (1.25, S.ROD_Y - 0.05, S.ROD_Z - 0.2), 0.24, 0.22,
         M["paleY"])


def back_posts():
    """The back posts (Flash). Look 2: on each side a dark beam sloping up and back from the cross beam to a short post
    on the sloping leg. Look 3 adds a tall forked post on a back cross beam: two square arms leaning apart (from the
    front Flash's two leaning posts, a V) with a small rope spool on a rod between them, behind the axle."""
    fx, fy, fz = S.AF_FRONT
    box("xbeam", (2 * (FA - S.BEAM) + 0.1, S.BEAM, S.BEAM), (0, S.XBEAM_Y, S.RAIL - S.BEAM), M["postX"], bevel=0.04)
    for sx in (-1, 1):
        f = Vector((sx * fx, fy, fz - 0.02))
        t = Vector((sx * S.APEX2[0], *S.APEX2[1:]))
        beam("bpost", f, t + (t - f).normalized() * 0.2, 0.42, 0.42, M["postZ"])
        # the short post under its top, standing on the sloping leg
        y = t.y
        z0 = S.RAIL - 0.05 + (y - (back_top() - 0.2)) * (S.FOOT_H - S.RAIL + 0.05) /             (S.BACK_Y - 0.45 - (back_top() - 0.2)) + 0.2
        box("bpost", (0.42, 0.42, t.z - z0 + 0.1), (sx * S.APEX2[0], y, z0), M["postZ"], bevel=0.04)
    if LOOK == 2:
        return
    # the back cross beam between the sloping legs, the fork's stem on it and its two arms
    by = S.BXBEAM_Y
    zl = S.RAIL - 0.05 + (by - (back_top() - 0.2)) * (S.FOOT_H - S.RAIL + 0.05) / (S.BACK_Y - 0.45 - (back_top() - 0.2))
    box("bxbeam", (2 * CX + 0.2, 0.5, 0.5), (0, by, zl - 0.2), M["postX"], bevel=0.04)
    bx, _, bz = S.FORK_BASE
    box("pole", (2 * bx + 0.2, 0.58, bz + 0.3 - (zl + 0.3)), (0, by, zl + 0.28), M["poleZ"], bevel=0.06)
    for sx in (-1, 1):
        f = Vector((sx * bx, by, bz))
        t = Vector((sx * S.APEX3[0], *S.APEX3[1:]))
        beam("pole", f, t, S.POST3_W, S.POST3_W, M["poleZ"], bevel=0.07)
    # the spool's rod, from arm to arm
    u = (S.DRUM_Z - bz) / (S.APEX3[2] - bz)
    xr = bx + (S.APEX3[0] - bx) * u
    rod("drod", -xr, xr, S.DRUM_Y, S.DRUM_Z, 0.12, M["steel"])
    r, ln = S.DRUM_R, S.DRUM_L
    h = ln / 2
    # a soft ball of rope: rounded all the way from end to end, its ends small (Flash)
    rad = lambda u: r * math.sqrt(1 - 0.64 * u * u)
    prof = [(0.0, -h)] + [(rad(u), u * h) for u in [k / 8 - 1 for k in range(17)]] + [(0.0, h)]
    lathe("drum", prof, (S.DRUM_X, S.DRUM_Y, S.DRUM_Z), M["drum"], rot=(0, 90, 0), verts=48)
    # the turns of the rope, close together, sunk a little into it
    for k in range(6):
        u = (k - 2.5) / 3.2
        t = ring("groove", rad(u) - 0.02, 0.028, M["groove"], n=64)
        t.location = (S.DRUM_X + u * h, S.DRUM_Y, S.DRUM_Z)
        t.rotation_euler = (0, math.radians(90), 0)


def build():
    if LOOK == 1:
        frame1()
        lever1()
        axle1()
    else:
        box2()
        axle2()
        bows()
        lever2()
        back_posts()
    bucket(LOOK)
    bpy.context.view_layer.update()


FAMILY = (("post", "post"), ("frail", "post"), ("xbeam", "post"), ("bxbeam", "post"), ("bpost", "pole"), ("elbow", "axle"), ("cap", "rod"), ("sbeam", "post"), ("leg", "post"), ("fbar", "bar"), ("bbar", "bar"), ("arm", "arm"),
          ("axle", "axle"), ("sleeve", "axle"), ("bracket", "bracket"), ("gear", "gear"), ("strut", "strut"),
          ("bucket", "bucket"), ("bin", "bucket"), ("band", "bucket"), ("stud", "bucket"), ("foot", "foot"),
          ("rivet", "post"), ("xwall", "wall"), ("ywall", "wall"), ("deck", "wall"), ("back", "wall"),
          ("stand", "bracket"), ("strap", "bracket"), ("collar", "axle"), ("rod", "rod"), ("bow", "bow"), ("knob", "bow"), ("pole", "pole"), ("drod", "drum"),
          ("drum", "drum"), ("groove", "drum"))


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


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
    cam.location += -right * (CAM_ORIGIN[0] - cxp) / 10.0 + up * (CAM_ORIGIN[1] - cyp) / 10.0
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
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"catapult-L{L}.blend"))
    print("DONE", L, MODE)


main()

