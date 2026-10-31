"""flinger.py : the Flinger (Flash building 5) as a 3D model, in the approved Twig/Pebble/Putty/Hatchery/HCC/General
Store/Map Room family (same camera, light, render settings and scale; no outline). Flash has four looks (art levels
1-4; level 5 shows look 4) and no animation, so there is one still per look. One body grows through the looks; the
parts and their places are in stack.py. The shared helpers (materials, meshes, camera, checks) are the Map Room's.

    blender -b --factory-startup -P flinger.py -- <look> fit      work/fit-L<look>.png  quick, no ground, 4 px a Flash px
    blender -b --factory-startup -P flinger.py -- <look> still    render/L<look>-raw.png (ground shadow), L<look>-alone.png
    blender -b --factory-startup -P flinger.py -- <look> check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P flinger.py -- <look> gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P flinger.py -- <look> probe sx sy ...   what the camera sees first through Flash px
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
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the house's middle on the ground)
CAM_ORIGIN = (S.ORIGIN[0], S.ORIGIN[1] + S.LOOK_DY.get(min(int(ARGS[0]), 4), 0.0))   # where the camera puts it
GROUND = S.GROUND
FRAME = tuple(int(v) for v in os.environ.get("PB_FRAME", "-80,-72,104,82").split(","))   # the canvas in Flash px (as fref.FRAME)
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


def materials():
    M = {}
    # Flash's weathered timber: grey-brown posts, darker wall planks, paler beams and the drum
    M["post"] = wood("post", (150, 126, 88), (96, 82, 54), axis="Z", dirt=0.3, rings=4.0)
    M["postx"] = wood("post", (130, 110, 78), (84, 72, 46), axis="X", dirt=0.3, rings=4.0)
    M["posty"] = wood("post", (130, 110, 78), (84, 72, 46), axis="Y", dirt=0.3, rings=4.0)
    M["plank"] = wood("plank", (112, 94, 64), (70, 58, 36), axis="Z", dirt=0.35, rings=4.0)
    M["gplank"] = wood("gplank", (104, 88, 62), (66, 54, 34), axis="Z", dirt=0.2, rings=4.0)
    M["drum"] = wood("drum", (176, 150, 104), (112, 92, 60), axis="X", dirt=0.15, rings=3.0)
    M["arm"] = wood("arm", (172, 142, 96), (110, 90, 58), axis="Y", dirt=0.15, rings=3.0)
    M["hub"] = wood("hub", (150, 128, 92), (100, 84, 56), axis="X", dirt=0.15, rings=3.0)
    M["inside"] = flat("inside", (16, 12, 9), rough=1.0)
    cols = [(104, 122, 182), (128, 136, 196), (164, 154, 214), (110, 130, 190), (178, 170, 224), (92, 108, 166),
            (142, 156, 210), (122, 116, 178)]
    M["slate"] = slate("slate", cols, rough=0.34)
    M["rslate"] = slate("rslate", cols, rough=0.34, rows=False)
    M["sillx"] = wood("sill", (170, 144, 100), (112, 94, 62), axis="X", dirt=0.2, rings=4.0)
    M["silly"] = wood("sill", (170, 144, 100), (112, 94, 62), axis="Y", dirt=0.2, rings=4.0)
    M["traywood"] = wood("traywood", (182, 154, 108), (120, 100, 66), axis="X", dirt=0.15, rings=3.0)
    M["tray"] = shiny("tray", (150, 154, 162), rough=0.55, metal=0.35, wear=(104, 108, 118), scale=7.0, dirt=0.35)
    M["frame"] = wood("frame", (124, 100, 66), (82, 66, 42), axis="Y", dirt=0.2, rings=3.0)
    M["shaft"] = wood("shaft", (58, 50, 42), (30, 26, 22), axis="Z", dirt=0.0, rings=3.0)
    for k, (sc, amt) in {"post": (1.0, 0.25), "postx": (1.0, 0.25), "posty": (1.0, 0.25), "plank": (1.1, 0.22),
                         "gplank": (1.1, 0.2), "drum": (1.3, 0.12), "arm": (1.3, 0.12), "hub": (1.3, 0.12)}.items():
        stain(M[k], sc, amt, 2.0 + len(k), fine=0.12)
    # metals: Flash's old gold pulleys, the blue-grey steel pipe and axle, dark springs
    M["gold"] = shiny("gold", (238, 176, 42), rough=0.28, metal=0.88, wear=(128, 76, 12), scale=2.0, dirt=0.25, side=0.3)
    M["dgold"] = shiny("dgold", (176, 118, 24), rough=0.34, metal=0.85, wear=(104, 56, 10), scale=2.0, dirt=0.3, side=0.3)
    M["groove"] = painted("groove", (46, 30, 26), rough=0.6, dirt=0.0, spec=0.3)
    M["steel"] = shiny("steel", (150, 160, 178), rough=0.35, metal=0.75, wear=(110, 118, 134), scale=3.0, dirt=0.15)
    M["pipe"] = painted("pipe", (88, 104, 118), rough=0.45, metal=0.5, wear=(70, 84, 96), scale=3.0, dirt=0.3, spec=0.5)
    M["spring"] = shiny("spring", (60, 66, 74), rough=0.38, metal=0.8, wear=(36, 40, 46), scale=3.0, dirt=0.1)
    M["belt"] = painted("belt", (66, 44, 50), rough=0.55, dirt=0.0, spec=0.35)
    M["ball"] = dimpled("ball", (206, 204, 216), (150, 148, 166))
    M["pot"] = painted("pot", (66, 44, 42), rough=0.4, wear=(54, 36, 34), scale=3.0, dirt=0.2, spec=0.5)
    M["potin"] = flat("potin", (12, 5, 5), rough=0.8)
    M["rope"] = painted("rope", (66, 46, 50), rough=0.8, dirt=0.0, spec=0.25)
    return M


M = materials()
A, B = S.HA, S.HB
YAW_M = Matrix.Rotation(math.radians(S.YAW), 4, "Z")
LOOK = min(L, 4)                      # level 5 shows look 4


def roof_z(x):
    """The roof's top at x (its two slopes from the ridge to the eaves)."""
    a, b = S.SLOPE[1 if x >= S.RIDGE_X else -1]
    return S.RIDGE_Z - b * abs(x - S.RIDGE_X) / a


def corner_posts():
    c = (A - S.POST_IN, B - S.POST_IN)
    hs = {1: S.POST1_H}.get(LOOK, None)
    for i, (sx, sy) in enumerate(((1, -1), (-1, -1), (1, 1), (-1, 1))):
        h = hs[i] if hs else roof_z(sx * c[0]) - 0.1
        if LOOK == 2 and sy > 0:
            h = S.BACK2_H[0 if sx < 0 else 1]
        box(f"post{i}", (S.POST, S.POST, h), (sx * c[0], sy * c[1], 0), M["post"], bevel=0.06,
            rot=(0, 0, rng.uniform(-1, 1)))


def sills():
    """The ground frame: a chunky beam along each side, between the posts (Flash's are pale, lit on top)."""
    w, h = S.SILL_W, S.SILL_H
    ax, by = A - S.POST, B - S.POST
    box("sill0", (2 * ax, w, h), (0, -B + w / 2 + 0.06, 0), M["sillx"], bevel=0.07)
    box("sill1", (2 * ax, w, h), (0, B - w / 2 - 0.06, 0), M["sillx"], bevel=0.07)
    box("sill2", (w, 2 * by, h), (A - w / 2 - 0.06, 0, 0), M["silly"], bevel=0.07)
    box("sill3", (w, 2 * by, h), (-A + w / 2 + 0.06, 0, 0), M["silly"], bevel=0.07)


def walls():
    """Plank walls between the posts: the -Y gable round the drum's opening, the +X side, and the hidden two."""
    ax, by = A - S.POST, B - S.POST
    t = S.PLANK_T
    x0, x1, z0, z1 = S.OPEN
    # -Y: under the opening, the header over it, the gable above (its planks reach the roof's underside)
    if z0 > S.SILL_H + 0.1:
        planks("ywall", (-ax, -B + 0.06), (ax, -B + 0.06), lambda u: S.SILL_H, lambda u: z0, M["plank"], 6, thick=t,
               out=(0, -1))
    box("header", (2 * ax + 0.1, 0.2, 0.22), (0, -B + 0.16, z1), M["postx"], bevel=0.04)
    gz = lambda u: roof_z(-ax + u) - S.ROOF_T - 0.02
    planks("gable", (-ax, -B + 0.1), (ax, -B + 0.1), lambda u: z1 + 0.3, gz, M["gplank"], 7, thick=t, out=(0, -1))
    if LOOK == 2:
        planks("lwall", (-A + 0.06, S.ROOF2_Y1), (-A + 0.06, -by), lambda u: S.SILL_H,
               lambda u: roof_z(-A) - S.ROOF_T - 0.04, M["plank"], 4, thick=t, out=(-1, 0))
        box("inside", (2 * ax, 2 * by, 0.05), (0, 0, S.SILL_H - 0.04), M["inside"], bevel=0.0)
        return
    # +X
    planks("xwall", (A - 0.06, -by), (A - 0.06, by), lambda u: S.SILL_H, lambda u: roof_z(A) - S.ROOF_T - 0.04, M["plank"], 7,
           thick=t, out=(1, 0))
    # +Y (with its gable) and -X: hidden from the camera, but they keep the inside dark
    planks("bwall", (ax, B - 0.06), (-ax, B - 0.06), lambda u: S.SILL_H, lambda u: roof_z(ax - u) - S.ROOF_T - 0.02,
           M["plank"], 6, thick=t, out=(0, 1))
    planks("lwall", (-A + 0.06, by), (-A + 0.06, -by), lambda u: S.SILL_H, lambda u: roof_z(-A) - S.ROOF_T - 0.04, M["plank"], 6,
           thick=t, out=(-1, 0))
    # the inside: a dark floor, so the opening shows Flash's deep shadow
    box("inside", (2 * ax, 2 * by, 0.05), (0, 0, S.SILL_H - 0.04), M["inside"], bevel=0.0)


def slope_frame(s):
    """The +X (s = 1) or -X (s = -1) roof slope: ridge point maker, down-slope unit d, outward normal n, length."""
    a, b = S.SLOPE[s]
    ln = math.hypot(a, b)
    d = Vector((s * a, 0, -b)) / ln
    n = Vector((s * b, 0, a)) / ln
    return d, n, ln


def roof_q(s, u, y, h=0.0):
    d, n, _ = slope_frame(s)
    return Vector((S.RIDGE_X, y, S.RIDGE_Z)) + d * u + n * h


def tile(name, s, u, y, tl, tw, tt, mat, tilt):
    """One slate on slope s, its middle at u down the slope and y along it, its lower end lifted by tilt (deg). Its
    lower corners are rounded as Flash's; its UV runs 0 at the lower end to 1 at the top (the slate shader's rim and
    the shadow line under the next row)."""
    d, n, _ = slope_frame(s)
    yv = Vector((0, 1, 0))
    a = math.radians(tilt)
    d2 = d * math.cos(a) + n * math.sin(a)
    n2 = n * math.cos(a) - d * math.sin(a)
    c = roof_q(s, u, y, tt * 0.5 + tl * 0.5 * math.sin(a))
    hx, hy = tl / 2, tw / 2
    r = min(0.2, tw * 0.22)
    out = [(hx, -hy), (hx, hy)]
    for cx, cy, a0 in ((-hx + r, hy - r, 90.0), (-hx + r, -hy + r, 180.0)):
        for k in range(7):
            t = math.radians(a0 + 90.0 * k / 6)
            out.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    loc = {}
    rows = []
    for lz in (tt / 2, -tt / 2):
        row = []
        for lx, ly in out:
            v = bm.verts.new(c - d2 * lx + yv * ly + n2 * lz)      # local +X up the slope
            loc[v] = (lx / tl + 0.5, ly / tw + 0.5)
            row.append(v)
        rows.append(row)
    top, bot = rows
    bm.faces.new(top)
    bm.faces.new(bot[::-1])
    m = len(out)
    for k in range(m):
        bm.faces.new((top[k], bot[k], bot[(k + 1) % m], top[(k + 1) % m]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = loc[lp.vert]
    return mesh_ob(name, bm, [mat], bevel=0.07, segs=3)


def roof(y0, y1):
    """Both slopes from y0 to y1: a board under rows of slates, and a row of ridge slates."""
    for s in (1, -1):
        d, n, ln = slope_frame(s)
        hole = S.HATCH if (s == 1 and LOOK >= 3) else None
        # the board (split round the hatch)
        pieces = [(0.0, ln, y0, y1)]
        if hole:
            u0, u1, hy0, hy1 = hole
            pieces = [(0.0, u0, y0, y1), (u1, ln, y0, y1), (u0, u1, y0, hy0), (u0, u1, hy1, y1)]
        for k, (a0, a1, b0, b1) in enumerate(pieces):
            bm = bmesh.new()
            top = [roof_q(s, a0, b0), roof_q(s, a1, b0), roof_q(s, a1, b1), roof_q(s, a0, b1)]
            vs = [bm.verts.new(p) for p in top] + [bm.verts.new(p - n * S.ROOF_T) for p in top]
            for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
                bm.faces.new([vs[i] for i in f])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            mesh_ob(f"roofb{s}{k}", bm, [M["rslate"]], smooth=False, bevel=0.03, segs=2)
        # the slates, from the eave up (each row lies over the top of the one below)
        tl, tw, tt, step = S.TILE
        rows = int(math.ceil((ln - 0.1) / step))
        for i in range(rows):
            uc = ln - tl / 2 - i * step + 0.12
            if uc < tl / 2 - 0.1:
                uc = tl / 2 - 0.05
            off = (i % 2) * tw / 2
            yy = y0 - off + tw / 2
            j = 0
            while yy - tw / 2 < y1 - 0.02:
                w = min(tw, y1 + 0.04 - (yy - tw / 2))
                yc = yy - tw / 2 + w / 2
                if yy - tw / 2 < y0:
                    w = yy + tw / 2 - y0
                    yc = y0 + w / 2
                if hole and hole[0] - 0.3 < uc < hole[1] + 0.25 and hole[2] - 0.2 < yc < hole[3] + 0.2:
                    yy += tw
                    continue
                tile(f"slate{s}-{i}-{j}", s, uc + rng.uniform(-0.03, 0.03), yc + rng.uniform(-0.02, 0.02),
                     tl + rng.uniform(-0.04, 0.04), w - 0.04, tt, M["slate"], S.TILE_TILT + rng.uniform(-2, 2))
                yy += tw
                j += 1
    # the ridge: a row of small slates bent over it
    tl, tw, tt, step = S.TILE
    yy, j = y0, 0
    while yy < y1 - 0.05:
        w = min(tw, y1 - yy)
        c = Vector((S.RIDGE_X, yy + w / 2, S.RIDGE_Z + 0.08))
        box(f"rslate{j}", (0.7, w - 0.04, 0.16), c, M["rslate"], rot=(0, 0, 0), bevel=0.05, origin="center")
        yy += w
        j += 1


def slope_box(name, s, a0, a1, b0, b1, h0, h1, mat, bevel=0.03):
    """A block on slope s: a0..a1 down the slope, b0..b1 along the ridge, h0..h1 off the roof board's top."""
    bm = bmesh.new()
    lo = [roof_q(s, a0, b0, h0), roof_q(s, a1, b0, h0), roof_q(s, a1, b1, h0), roof_q(s, a0, b1, h0)]
    hi = [roof_q(s, a0, b0, h1), roof_q(s, a1, b0, h1), roof_q(s, a1, b1, h1), roof_q(s, a0, b1, h1)]
    vs = [bm.verts.new(p) for p in hi + lo]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=bevel, segs=2)


def hatch():
    """The hatch in the +X slope (looks 3 and 4): as Flash, a plain black hole in the slates (no frame), its plank lid
    lying open on the slates below it in look 3, the throwing spoon's curved tip in it in look 4."""
    u0, u1, y0, y1 = S.HATCH
    d, n, ln = slope_frame(1)
    h1 = 0.36                       # the slates' top (the lid lies on them)
    # the shaft: black walls from the hole down into the house
    hs = [roof_q(1, u0, y0, -0.3), roof_q(1, u1, y0, -0.3), roof_q(1, u1, y1, -0.3), roof_q(1, u0, y1, -0.3)]
    low = [p - n * 1.4 for p in hs]
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in hs + low]
    for f in ((7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("hshaft", bm, [M["inside"]], smooth=False)
    if LOOK == 3:
        # the lid: planks lying flat on the slates just below the hole
        slope_box("hboard", 1, u1 + 0.05, u1 + 1.05, y0 - 0.1, y1 + 0.15, h1, h1 + 0.14, M["arm"], bevel=0.04)
    if LOOK >= 4:
        # the spoon's tip: a curved wooden bar arching over the lower sill, its far end bent down onto the slates
        pts = []
        for i in range(13):
            t = i / 12
            pts.append(roof_q(1, u1 - 0.05 + 0.25 * t, y0 - 0.15 + (y1 - y0 + 0.75) * t,
                              h1 + 0.1 + 0.55 * math.sin(math.pi * min(1.0, t * 1.15))))
        sweep("spoon", pts, n, 0.26, 0.2, M["arm"], bevel=0.05)


def drum():
    """The wooden drum on its steel axle (axis along X) behind the -Y opening, its crank stick, the bed below."""
    c = Vector(S.DRUM_C)
    cyl("drum", S.DRUM_R, S.DRUM_L, c - Vector((S.DRUM_L / 2, 0, 0)), M["drum"], rot=(0, 90, 0), verts=32, bevel=0.06)
    cyl("axle", S.AXLE_R, 2 * A - 0.2, Vector((-A + 0.1, c.y, c.z)), M["steel"], rot=(0, 90, 0), verts=16, bevel=0.02)
    for i, sx in enumerate((-1, 1)):
        box(f"bearing{i}", (0.5, 0.4, 0.5), (sx * (A - S.POST_IN), c.y - 0.04, c.z), M["steel"], bevel=0.05,
            origin="center")
    # the crank stick out of the drum's side, down and toward the viewer's left
    a = c + Vector((-S.DRUM_L / 2 + 0.25, -S.DRUM_R + 0.05, -0.1))
    tube("crank", [a, a + Vector((-0.3, -0.75, -0.7))], 0.07, M["arm"])
    tray()


def tray():
    """The tray under the drum, between the left and front posts: a curved sheet from just under the drum down onto the
    -Y sill, its lip over the sill's front (look 1: a pale wooden board; from look 2 Flash's light-grey steel)."""
    x0, x1 = -(A - S.POST) + 0.06, (A - S.POST) - 0.06
    pts = S.TRAY if LOOK > 1 else S.TRAY[:4]          # look 1's board stops on the sill
    prof = smooth_open([Vector((0, y, z)) for y, z in pts], k=3)
    t = 0.12 if LOOK > 1 else 0.16
    bm = bmesh.new()
    rows = []
    for p in prof:
        rows.append([bm.verts.new((x, p.y, p.z + dz)) for x in (x0, x1) for dz in (0.0, -t)])
    for a, b in zip(rows, rows[1:]):
        for i, j in ((0, 1), (1, 3), (3, 2), (2, 0)):
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new((rows[0][0], rows[0][1], rows[0][3], rows[0][2]))
    bm.faces.new((rows[-1][0], rows[-1][2], rows[-1][3], rows[-1][1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mat = M["traywood"] if LOOK == 1 else M["tray"]
    mesh_ob("tray", bm, [mat], smooth=True, bevel=0.03, segs=2)
    if LOOK > 1:                                        # its rolled lip on the ground
        e = prof[-1]
        cyl("traylip", 0.09, x1 - x0, Vector((x0, e.y, e.z)), mat, rot=(0, 90, 0), verts=12, bevel=0.0)


def ball():
    c = px(*S.BALL_SCR, Z=S.BALL_R)
    sphere("ball", S.BALL_R, c, M["ball"], n=32)
    return c


def pul_plane():
    """The pulleys' plane: a point on it (the block's top), its normal, and two unit directions in it (e1 level,
    toward the back; e2 up)."""
    a, t = math.radians(S.PUL_N[0]), math.radians(S.PUL_N[1])
    n = Vector((math.cos(a) * math.cos(t), math.sin(a) * math.cos(t), math.sin(t)))
    e1 = Vector((0, 0, 1)).cross(n).normalized()
    e2 = n.cross(e1).normalized()
    p0 = Vector(S.BLOCK_C) + Vector((0, 0, S.BLOCK_S[2] / 2))
    return p0, n, e1, e2


def hit_plane(sx, sy, p0, n):
    """Where the camera ray through Flash pixel (sx, sy) meets the plane through p0 with normal n."""
    a, b = px(sx, sy, Z=0.0), px(sx, sy, Z=10.0)
    d = b - a
    t = (Vector(p0) - a).dot(n) / d.dot(n)
    return a + d * t


def on_plane(sx, sy):
    p0, n, _, _ = pul_plane()
    return hit_plane(sx, sy, p0, n)


def pulley(name, c, r, mat_rim, spokes=5, wide=0.32, knobs=True):
    """A gold pulley in the pulleys' plane: a grooved rim the belt runs in, spokes, a hub and the axle's two gold
    knobs."""
    _, n, _, _ = pul_plane()
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = c
    e.rotation_euler = n.to_track_quat("Z", "Y").to_euler()          # local Z = the axle
    for side in (-1, 1):
        ring(f"{name}rim{side}", r, S.RIM_W * (1.3 if r > 1 else 1.0), mat_rim, parent=e, z=side * wide / 2)
    lathe(f"{name}groove", [(r - 0.02, -wide / 2), (r - 0.09, -wide / 4), (r - 0.1, wide / 4), (r - 0.02, wide / 2)],
          (0, 0, 0), M["groove"], parent=e)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes + 0.3
        p = (math.cos(a) * (r - 0.06), math.sin(a) * (r - 0.06), 0)
        tube(f"{name}spoke{k}", [(0, 0, 0), p], S.SPOKE_W * (1.3 if r > 1 else 1.0), M["gold"], parent=e)
    cyl(f"{name}hub", 0.17 if r < 1 else 0.24, wide + 0.06, (0, 0, -wide / 2 - 0.03), M["gold"], parent=e, verts=16)
    if knobs:
        for side in (-1, 1):
            sphere(f"{name}knob{side}", 0.1, (0, 0, side * (wide / 2 + 0.12) - 0.1), M["gold"], n=12).parent = e
    return e


def gold_parts():
    """The gold block on the gable's peak, its stems, the pulleys and (look 4) the big wheel on its stand."""
    blk = Vector(S.BLOCK_C)
    box("gblock", S.BLOCK_S, blk, M["gold"], bevel=0.06, origin="center")
    _, n, e1, e2 = pul_plane()
    p2 = on_plane(*S.PUL2_SCR)
    pulley("pul2", p2, S.PUL_R, M["dgold"])
    top = blk + Vector((0, 0, S.BLOCK_S[2] / 2))
    tube("gstem2", [top + Vector((0, 0.1, -0.05)), p2 - e2 * 0.12], 0.07, M["gold"])
    p1 = on_plane(*S.PUL1_SCR)
    if LOOK >= 3:
        pulley("pul1", p1, S.PUL_R, M["dgold"])
        tube("gstem1", [top + Vector((0, -0.2, -0.05)), p1 - e2 * 0.12], 0.07, M["gold"])
    else:
        # look 2: a gold rod out toward the viewer's left with a knob, where look 3's pulley will sit
        tube("grod", [top + Vector((0, -0.2, -0.05)), p1], 0.07, M["gold"])
        sphere("grodknob", 0.14, p1 - Vector((0, 0, 0.14)), M["gold"], n=12)
    if LOOK >= 4:
        w = on_plane(*S.WHEEL_SCR)
        pulley("wheel", w, S.WHEEL_R, M["dgold"], spokes=8, wide=0.22)
        # its crank: a bent gold handle on the hub
        tube("wcrank", [w + n * 0.15, w + n * 0.3 - e1 * 0.35 - e2 * 0.15, w + n * 0.35 - e1 * 0.3 - e2 * 0.7,
                        w + n * 0.35 + e1 * 0.05 - e2 * 0.85, w + n * 0.35 + e1 * 0.3 - e2 * 0.5],
             0.085, M["gold"], smooth=True)
        # its stand: a gold post up from the ridge's back end to the hub's back
        rb = Vector((S.RIDGE_X, S.ROOF_Y1 - 0.2, S.RIDGE_Z + 0.1))
        tube("wstand", [rb, rb + Vector((0, 0.2, 0.5)), w - n * 0.25], 0.07, M["gold"], smooth=True)
        print("PROBE wheel", tuple(round(v, 2) for v in w), "block", tuple(round(v, 2) for v in blk))
    return p1, p2


def belt(p1, p2, b):
    """The dark belt: down to the ball, up over the pulleys (and look 4's wheel), and away behind the roof."""
    r, t = S.PUL_R, S.BELT_T
    _, n, e1, e2 = pul_plane()

    def arc(c, rr, a0, a1, k=10):
        return [c + e1 * (rr * math.cos(math.radians(a0 + (a1 - a0) * i / k)))
                + e2 * (rr * math.sin(math.radians(a0 + (a1 - a0) * i / k))) for i in range(k + 1)]
    bt = b + Vector((0, 0, S.BALL_R - 0.15))
    pts = [bt, p1 - e1 * (r + 0.04) - e2 * 1.5]
    pts += arc(p1, r + 0.03, 180, 80, 8)
    pts.append((p1 + p2) / 2 - e2 * 0.55)
    pts += arc(p2, r + 0.03, 110, -10, 8)
    if LOOK >= 4:
        w = on_plane(*S.WHEEL_SCR)
        pts.append(p2 + e1 * 0.9 - e2 * 0.55)
        pts += arc(w, S.WHEEL_R + 0.22, 205, -25, 16)
        pts.append(w + e1 * 0.85 - e2 * 2.5)
        pts.append(w + e1 * 0.25 - e2 * 4.1)
    else:
        pts.append(p2 + e1 * (r + 0.3) - e2 * 1.2)
        pts.append(p2 + e1 * (r + 0.35) - e2 * 2.2)
    sweep("belt", smooth_open(pts), n, 0.3, t, M["belt"], bevel=0.02)


def smooth_open(pts, k=3):
    """An open path through pts, Catmull-Rom smoothed (k points per span)."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = (Vector(pts[max(0, min(n - 1, i + j))]) for j in (-1, 0, 1, 2))
        for j in range(k):
            t = j / k
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(Vector(pts[-1]))
    return out


def bucket_arm():
    """The bucket on its arm: a wooden hub on the front post's +X face, the arm up to the bucket (look 4: a thick
    round arm and a big pot), the springs under the arm, and (looks 3, 4) the steel pipe they stand on."""
    hub = Vector(S.HUB)
    cyl("hub", S.HUB_R, 0.5, hub - Vector((0.1, 0, 0)), M["hub"], rot=(0, 90, 0), verts=24, bevel=0.06)
    cyl("hubpin", 0.07, 0.15, hub + Vector((0.4, 0, 0)), M["steel"], rot=(0, 90, 0), verts=12)
    big = LOOK >= 4
    bc = Vector(S.POT_C if big else S.BUCKET_C)
    br = S.POT_R if big else S.BUCKET_R
    bh = S.POT_H if big else S.BUCKET_H
    # the bucket: a tapered dark pot with a gold rim and a black inside
    lathe("bucket", [(br * 0.8, -bh), (br * 0.94, -bh * 0.75), (br * 0.99, -bh * 0.4), (br, -0.02)], bc, M["pot"],
          verts=48)
    lathe("bucketwall", [(br * 0.95, -0.02), (br * 0.93, -bh * 0.6)], bc, M["potin"], verts=48)
    ring("bucketrim", br, 0.07, M["gold"], z=0.0).location = bc
    cyl("bucketin", br * 0.92, 0.02, bc - Vector((0, 0, bh * 0.6)), M["potin"], verts=40, bevel=0.0)
    if big:                 # Flash's pot is tipped toward the viewer (its mouth shows rounder than the bucket's)
        bpy.context.view_layer.update()
        rot = Matrix.Translation(bc) @ Matrix.Rotation(math.radians(S.POT_TIP), 4, Vector((1, 1, 0)).normalized())             @ Matrix.Translation(-bc)
        for nm in ("bucket", "bucketwall", "bucketrim", "bucketin"):
            ob = bpy.data.objects[nm]
            ob.matrix_world = rot @ ob.matrix_world
    # the arm from the hub's rim to the bucket's side
    a0 = hub + Vector((0.15, 0, S.HUB_R * 0.4))
    a1 = bc + (Vector((hub.x, hub.y, bc.z)) - bc).normalized() * (br * 0.97) - Vector((0, 0, S.ARM_DROP))
    tube("barm", [a0, a1], S.POT_ARM_R if big else S.ARM_R, M["arm"], verts=16)
    # the springs: coils from a base up to the arm
    s0 = Vector(S.SPRING_C)
    nspr = S.SPRINGS
    if LOOK <= 2:
        s0.z = S.SPRING_BLOCK_H
        s0.y = S.SPRING12_Y
        s0.x = S.SPRING12_X
        nspr = 2
        off = Vector(S.SPRING_OFF)
        box("sblock", (0.9, 0.9 + abs(off.y), S.SPRING_BLOCK_H), (s0.x, s0.y + off.y / 2, 0), M["posty"], bevel=0.06)
    dxy = Vector((a1.x - a0.x, a1.y - a0.y, 0))
    for k in range(nspr):
        off = Vector(S.SPRING_OFF) * k
        b0 = s0 + off
        f = max(0.0, min(1.0, Vector((b0.x - a0.x, b0.y - a0.y, 0)).dot(dxy) / dxy.length_squared))
        top = a0 + (a1 - a0) * f          # the arm right above this spring's foot
        h = top.z - S.ARM_R - b0.z
        rs = 0.3 if LOOK >= 3 else 0.22
        pts = [b0 + Vector((rs * math.cos(i * 0.4), rs * math.sin(i * 0.4), h * i / 110)) for i in range(111)]
        tube(f"spring{k}", pts, 0.06, M["spring"], verts=8)
    if LOOK >= 3:
        # the steel pipe: from a flanged foot on the ground, leaning up to under the springs
        f = Vector(S.PIPE_FOOT)
        cyl("pipeflange", 1.0, 0.2, f, M["pipe"], verts=40, bevel=0.05)
        tube("pipe", [f + Vector((0, 0, 0.1)), s0 - Vector((0, 0, 0.1))], 0.6, M["pipe"], verts=32)
        cyl("pipecap", 0.66, 0.14, s0 - Vector((0, 0, 0.1)), M["pipe"], verts=32, bevel=0.04)


def beam(name, p0, p1, w, h, mat, bevel=0.04):
    """A squared timber from p0 to p1 (w x h across)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = box(name, (w, h, d.length), p0, mat, bevel=bevel)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def aframe():
    """Look 1: the A-frame over the open frame: two legs to an apex with a steel cap, a little slate roof and the gold
    pulley on top; between the legs a windlass with the rope coil; the rope from the ball over the pulley onto it."""
    y = S.A1_Y
    apex = Vector((S.A1_APEX[0], y, S.A1_APEX[1]))
    w = S.A1_W
    legs = []
    for i, fx in enumerate(S.A1_FEET):
        f = Vector((fx, y, 0.0))
        beam(f"aleg{i}", f, apex + (apex - f).normalized() * 0.2, w, w, M["post"])
        legs.append((f, apex - f))
    box("acap", (0.95, 0.95, 0.5), apex + Vector((0, 0, -0.05)), M["steel"], bevel=0.06)
    # the slate roof over the cap: two slates each side of a ridge along Y
    for sd in (-1, 1):
        for j, yy in enumerate((0.35,)):
            ob = box(f"aslate{sd}{j}", (1.15, 1.0, 0.13), apex + Vector((0.3 + sd * 0.5, yy, 0.36)), M["rslate"],
                     bevel=0.03, origin="center")
            ob.rotation_euler = (0, math.radians(sd * 32 + rng.uniform(-3, 3)), math.radians(rng.uniform(-4, 4)))
    # the pulley on a gold bracket out of the cap's front, so the rope runs clear in front of the cap and legs
    _, n, e1, e2 = pul_plane()
    pc = apex + Vector(S.A1_PUL)
    pulley("pul1", pc, S.PUL_R, M["dgold"])
    tube("afork", [apex + Vector((0, -0.4, 0.2)), apex + Vector((0, -0.65, 0.7)), pc + n * 0.2], 0.08, M["gold"],
         smooth=True)
    # the windlass: a round wooden axle along X through both legs, a knob past the left leg, the coil on it
    z = S.WINDLASS_Z
    xl = [f.x + d.x * (z / d.z) for f, d in legs]
    cyl("waxle", S.AXLE1_R, xl[1] - xl[0] + 1.1, Vector((xl[0] - 0.8, y, z)), M["drum"], rot=(0, 90, 0), verts=16)
    sphere("wknob", 0.26, Vector((xl[0] - 0.88, y, z)), M["drum"], n=16)
    cr = S.COIL
    tans = [abs(d.x / d.z) for f, d in legs]
    for k, rr in enumerate((cr, cr - 0.25, cr - 0.48)):
        tr = 0.16 if k == 0 else 0.14
        # each layer stops short of the slanting legs at its own top (wider legs there): the coil is a barrel
        c0, c1 = (xl[i] + (1 - 2 * i) * (w / 2 * math.hypot(1, tans[i]) + rr * tans[i] + tr + 0.03) for i in (0, 1))
        turns = (c1 - c0) / 0.3
        m = int(turns * 24)
        pts = [Vector((c0 + (c1 - c0) * i / m, y + rr * math.cos(i * 2 * math.pi * turns / m + k),
                       z + rr * math.sin(i * 2 * math.pi * turns / m + k))) for i in range(m + 1)]
        tube(f"coil{k}", pts, tr, M["rope"], verts=10)
    c0, c1 = (xl[0] + xl[1]) / 2 - 0.5, (xl[0] + xl[1]) / 2 + 0.5
    return pc, Vector(((c0 + c1) / 2, y, z)), cr


def belt1(pc, cc, cr, b):
    """Look 1's rope: from the ball up over the pulley and down onto the coil's front."""
    r = S.PUL_R
    _, n, e1, e2 = pul_plane()

    def arc(c, rr, a0, a1, k=10):
        return [c + e1 * (rr * math.cos(math.radians(a0 + (a1 - a0) * i / k)))
                + e2 * (rr * math.sin(math.radians(a0 + (a1 - a0) * i / k))) for i in range(k + 1)]
    bt = b + Vector((0, 0, S.BALL_R - 0.15))
    pts = [bt, pc - e1 * (r + 0.04) - e2 * 2.5]
    pts += arc(pc, r + 0.03, 180, -30, 10)
    end = cc + Vector((0.3, -cr - 0.12, 0.1))         # onto the coil's front, toward the camera
    pts.append((pts[-1] + end) / 2 + e1 * 0.15)
    pts.append(end)
    sweep("belt", smooth_open(pts), n, 0.3, S.BELT_T, M["belt"], bevel=0.02)


def stool():
    """Look 1: a little wooden step stool beside the bucket."""
    c = Vector((*S.STOOL_C, 0.0))
    h, sz = S.STOOL_H, S.STOOL_S
    box("stoolseat", (sz, sz, 0.16), c + Vector((0, 0, h - 0.16)), M["arm"], bevel=0.04)
    t, bt = sz / 2 - 0.14, sz / 2 + 0.12
    for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        beam(f"stoolleg{i}", c + Vector((sx * bt, sy * bt, 0)), c + Vector((sx * t, sy * t, h - 0.16)), 0.17, 0.17,
             M["post"], bevel=0.03)
    k = 0.42                                            # the rails at this fraction of the height, the step in front
    q = bt + (t - bt) * k
    box("stoolstep", (2 * q + 0.1, 0.4, 0.1), c + Vector((0, -q + 0.08, h * k)), M["arm"], bevel=0.03)
    box("stoolrail0", (0.1, 2 * q, 0.14), c + Vector((q, 0, h * k)), M["post"], bevel=0.02)
    box("stoolrail1", (0.1, 2 * q, 0.14), c + Vector((-q, 0, h * k)), M["post"], bevel=0.02)
    box("stoolrail2", (2 * q, 0.1, 0.14), c + Vector((0, q, h * k)), M["post"], bevel=0.02)


def back_frame():
    """Look 2: the open back half as Flash draws it: a big open timber triangle (a tie beam lying on the left back post
    and on a plank seat on the right back post, two rafters meeting at the apex under a block, the ridge beam back to
    the roof) and two rails along the open +X side."""
    y = S.TRUSS_Y
    sx, sy, wx, wy, st = S.SEAT
    zs = S.BACK2_H[1]
    box("seat", (wx, wy, st), (sx, sy, zs), M["arm"], bevel=0.05)
    zt = zs + st                                       # the tie beam's underside (on the seat and the left post)
    x0, x1 = S.TIE_X
    beam("tie", (x0, y, zt + S.TIE_H / 2), (x1, y, zt + S.TIE_H / 2), S.TIE_H, 0.4, M["postx"])
    ax, az = S.TRUSS_APEX
    top = Vector((ax, y, az))
    for k, fx in enumerate(S.TRUSS_FEET):
        f = Vector((fx, y, zt + S.TIE_H - 0.05))
        beam(f"rafter{k}", f, top + (top - f).normalized() * 0.22, 0.36, 0.36, M["post"])
    box("rafterk", (0.56, 0.46, 0.5), top + Vector((0, 0, 0.02)), M["post"], bevel=0.06, origin="center")
    beam("ridge", (S.RIDGE_X, S.ROOF2_Y1 - 0.6, S.RIDGE_Z - 0.42), (S.RIDGE_X, y - 0.18, S.RIDGE_Z - 0.42), 0.34, 0.34,
         M["posty"])
    xr = A - S.POST_IN
    for k, z in enumerate(S.XRAILS):
        box(f"xrail{k}", (0.36, 2 * (B - S.POST) + 0.1, 0.38), (xr, 0, z - 0.19), M["posty"], bevel=0.05)


def build():
    corner_posts()
    sills()
    if LOOK >= 2:
        walls()
        roof(S.ROOF_Y0, S.ROOF_Y1 if LOOK >= 3 else S.ROOF2_Y1)
    if LOOK >= 3:
        hatch()
    drum()
    b = ball()
    bucket_arm()
    if LOOK >= 2:
        p1, p2 = gold_parts()
        belt(p1, p2, b)
    if LOOK == 2:
        back_frame()
    if LOOK == 1:
        belt1(*aframe(), b)
        stool()
    bpy.context.view_layer.update()
    for ob in list(COLL.objects):           # the whole building turns by stack.YAW (into the mesh or curve itself)
        if ob.type in ("MESH", "CURVE") and ob.parent is None:
            ob.data.transform(YAW_M @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)


FAMILY = (("post", "post"), ("sill", "post"), ("ywall", "wall"), ("gable", "wall"), ("xwall", "wall"),
          ("bwall", "wall"), ("lwall", "wall"), ("header", "wall"), ("inside", "wall"), ("roof", "roof"),
          ("slate", "roof"), ("rslate", "roof"), ("hframe", "hatch"), ("hshaft", "hatch"), ("hboard", "board"),
          ("spoon", "spoon"), ("drum", "drum"), ("axle", "axle"), ("crank", "drum"), ("tray", "tray"),
          ("ball", "ball"), ("gblock", "gold"), ("gstem", "gold"), ("grod", "gold"), ("pul", "pulley"),
          ("wheel", "wheel"), ("wcrank", "wheel"), ("wstand", "gold"), ("belt", "belt"), ("hub", "hub"),
          ("bucket", "bucket"), ("barm", "arm"), ("spring", "spring"), ("pipe", "pipe"),
          ("bearing", "axle"), ("sblock", "post"), ("aleg", "post"), ("acap", "gold"), ("aslate", "roof"),
          ("afork", "gold"), ("coil", "coil"), ("waxle", "coil"), ("wknob", "coil"), ("stool", "stool"), ("tie", "post"), ("seat", "post"),
          ("rafter", "post"), ("ridge", "post"), ("xrail", "post"), ("xbrace", "post"))


def family(o):
    n = o.name.split(".")[0]
    p = o.parent
    while p is not None:                    # a pulley's parts belong to their pulley
        n = p.name.split(".")[0]
        p = p.parent
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
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"flinger-L{L}.blend"))
    print("DONE", L, MODE)


main()

