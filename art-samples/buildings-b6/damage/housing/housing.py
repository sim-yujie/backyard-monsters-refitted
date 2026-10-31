"""housing.py : Monster Housing (Flash building 15) as a 3D model, v1. Built against the Flash picture in the game's own
pixel frame (fref.py), on the approved buildings' scene (the Storage Silo v1 / Putty Squisher v3 / Twig Snapper v3): the
same camera, sun, scale (10 Flash px a world unit) and matte painted Cycles finish, no outline.

    blender -b --factory-startup -P housing.py -- fit            work/fit.png      quick silhouette, 4 px a Flash px
    blender -b --factory-startup -P housing.py -- look           work/look.png     quick whole-scene look (HO_K, HO_SAMPLES)
    blender -b --factory-startup -P housing.py -- base           render/base.png (with the ground shadow), alone.png
    blender -b --factory-startup -P housing.py -- check          CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P housing.py -- gap            GAP lines: parts in front of others from the camera

Housing has one look for all ten levels (Flash has one picture set, top.3.v2.png) and does not animate, so there is one
still and no loop.

The model: a square pen of round green rails on pale posts (pairs of posts, a gate gap on the front-left side, the rail
ends bent down into the gate posts), and in its right corner the monsters' block of flats, turned 45 degrees so its
cubes face the camera: on short dark legs, a front cube, a core and a cube either side (ground-floor boxes under them),
a wooden deck with a raised rim on top of those, and on the deck a front cube, a tall middle block and a low cube
either side. Every cube is pale grey with a green roof and a round dark-green doorway; a little ladder on the left.
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
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["fit"]
MODE = ARGS[0]

EL = 30.0
ORIGIN = (0.0, 83.0)                  # Flash pixel of the world origin (the middle of the pen on the ground)
GROUND = 0.0
FRAME = (-122, 0, 158, 156)           # the canvas in Flash px (as fref.FRAME)
K = {"fit": 4}.get(MODE, int(os.environ.get("HO_K", 12)))      # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
rng = random.Random(1500)
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

    def grime(self, col, low=0.0, high=1.4, amount=0.35, ao_min=0.55, ao_dist=0.35):
        """Darker toward the ground (world height), and in the creases (ambient occlusion): Flash's soft dirt."""
        geo = self.n("ShaderNodeNewGeometry")
        sep = self.n("ShaderNodeSeparateXYZ")
        self.link(geo.outputs["Position"], sep.inputs[0])
        mr = self.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = low, high
        mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0 - amount, 1.0
        self.link(sep.outputs["Z"], mr.inputs[0])
        ao = self.n("ShaderNodeAmbientOcclusion", samples=8)
        ao.inputs["Distance"].default_value = ao_dist
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
            ao_min=0.55, rust_at=0.6, smudge=0.0, ao_dist=0.35, fade=0.0):
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
    if smudge:                                  # a soft dark smudge round the middle (Flash's floor plate, under the sack)
        geo = t.n("ShaderNodeNewGeometry")
        flat = t.n("ShaderNodeVectorMath", operation="MULTIPLY")
        t.link(geo.outputs["Position"], flat.inputs[0])
        flat.inputs[1].default_value = (1.0, 1.0, 0.0)
        ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
        t.link(flat.outputs[0], ln.inputs[0])
        wob = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")
        t.link(t.noise(v, 1.6, 3.0, 0.6), wob.inputs[0])
        wob.inputs[1].default_value = 0.9
        t.link(ln.outputs["Value"], wob.inputs[2])
        sc = t.n("ShaderNodeMath", operation="DIVIDE")
        t.link(wob.outputs[0], sc.inputs[0])
        sc.inputs[1].default_value = 2.5
        dark = srgb(*(int(255 - smudge * 190),) * 3)
        out = t.mix(out, t.ramp(sc.outputs[0], [(0.36, dark), (0.84, (1, 1, 1, 1))]), 1.0, "MULTIPLY")
    if fade:                                    # each part darker toward its own foot (Flash's shaded cube walls)
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(t.n("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])
        out = t.mix(out, t.ramp(sep.outputs["Z"], [(0.0, srgb(*(int(255 * (1 - fade)),) * 3)), (0.7, (1, 1, 1, 1))]),
                    1.0, "MULTIPLY")
    out = t.grime(out, GROUND, 2.6, dirt, ao_min, ao_dist)
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


def box(name, size, at, mat, rot=(0, 0, 0), bevel=0.05, parent=None, jitter=0.0, taper=1.0, origin="bottom", bow=0.0):
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
    ob = mesh_ob(name, bm, [mat], bevel=bevel, parent=parent)
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


def tube(name, pts, r, mat, parent=None, verts=12, r_end=None, cyclic=False, smooth=False, radii=None):
    """A round stick through world points pts (a curve with a round bevel); cyclic closes it into a seamless loop,
    smooth bends it softly through the points (a Bezier curve) instead of at sharp corners; radii scales r per point."""
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
    if radii is not None:
        for p, k in zip(cps, radii):
            p.radius = k
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(mat)
    link(ob, parent)
    return ob




# ------------------------------------------------------------------------------------------------------------ materials
def gloss_roof(name, col, shine):
    """Flash's top roofs: green, with a broad soft white shine across their left third (a glossy painted top)."""
    t = NT(name)
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])
    v = t.coords()
    k0, k1 = (0, 0, 0, 1), (1, 1, 1, 1)
    band = t.ramp(sep.outputs["X"], [(0.08, (0.55, 0.55, 0.55, 1)), (0.22, k1), (0.36, (0.8, 0.8, 0.8, 1)), (0.58, k0)])
    col_ = t.mix(srgb(*col), srgb(*shine), band)
    col_ = t.mix(col_, srgb(*[int(c * 0.85) for c in col]), t.ramp(t.noise(v, 3.0, 2.0, 0.5), [(0.45, k0), (0.7, (0.35, 0.35, 0.35, 1))]))
    t.set(**{"Base Color": col_, "rough": 0.35, "spec": 0.5})
    t.bump(t.noise(v, 18, 4.0, 0.6), 0.04, 0.01)
    return t.m


def materials():
    M = {}
    # Flash's pale grey-lavender cube walls, green roofs and rails, dark-green doorways, brown deck
    M["wall"] = painted("wall", (204, 201, 209), rough=0.75, wear=(190, 187, 195), rust=(166, 163, 171), scale=3,
                        dirt=0.32, spec=0.25, soot=0.22, rust_at=0.68, ao_min=0.4, ao_dist=0.8, fade=0.4)
    # the same paint, dirtier and darker: the walls Flash keeps in shade under the deck
    M["wallshade"] = painted("wallshade", (152, 149, 157), rough=0.78, wear=(140, 137, 145), rust=(124, 121, 129),
                             scale=3, dirt=0.34, spec=0.2, soot=0.22, rust_at=0.68, ao_min=0.4, ao_dist=0.8, fade=0.4)
    M["wallblack"] = painted("wallblack", (70, 72, 68), rough=0.8, wear=(90, 92, 88), scale=3, dirt=0.4, spec=0.2,
                             soot=0.4)
    M["roof"] = painted("roof", (28, 50, 28), rough=0.6, wear=(60, 88, 56), rust=(30, 48, 28), scale=3,
                        dirt=0.2, spec=0.25, soot=0.15, rust_at=0.7)
    M["rooflit"] = gloss_roof("rooflit", (74, 108, 72), (178, 204, 174))
    M["holedark"] = painted("holedark", (16, 16, 14), rough=0.9, scale=4, dirt=0.0, spec=0.1, ao_min=0.2)
    M["holein"] = painted("holein", (20, 40, 20), rough=0.55, scale=4, dirt=0.0, spec=0.35, ao_min=0.05, ao_dist=0.7)
    M["plinth"] = wood("plinth", (88, 68, 44), (58, 44, 28), axis="X")
    M["slab"] = wood("slab", (134, 113, 84), (104, 88, 64), axis="X", knots=False)
    # Flash's bright glossy green blob in the back of a doorway
    M["blob"] = painted("blob", (48, 118, 42), rough=0.2, scale=4, dirt=0.0, spec=0.8, ao_min=0.6)
    M["blobdark"] = painted("blobdark", (26, 58, 24), rough=0.3, scale=4, dirt=0.0, spec=0.5, ao_min=0.6)
    M["frame"] = painted("frame", (124, 126, 136), rough=0.5, metal=0.3, wear=(150, 152, 160), scale=10, dirt=0.1,
                         spec=0.35)
    # Flash's rail: pale grey-green where lit, dark green in shade (paler and greyer than a painted green)
    M["rail"] = painted("rail", (90, 114, 86), rough=0.35, metal=0.5, wear=(170, 184, 168), scale=10, dirt=0.15,
                        spec=0.5)
    M["post"] = painted("post", (222, 218, 226), rough=0.45, metal=0.3, wear=(222, 220, 232), scale=10, dirt=0.08,
                        spec=0.4)
    M["leg"] = painted("leg", (58, 52, 62), rough=0.5, metal=0.4, wear=(96, 88, 100), scale=8, dirt=0.2, spec=0.35)
    return M


M = materials()


# ------------------------------------------------------------------------------------------------------------ the model
A = 7.6                    # the pen's half side (Flash: corners at x -108 / +108 and y 19.5 / 126.5 on the rail)
RAIL_Z, RAIL_R = 1.0, 0.08  # the rail's height (Flash posts stand 8-9 px under it) and radius (1.6 px)
POST_R = 0.09
GATE = (-2.73, 1.66)       # the gate gap on the front-left side (Y = -A), between these X (Flash x -74 and -42)
# Flash x of the posts on each side (pairs about 11.5 px apart), from the picture
POSTS = {"TL": (-97.0, -85.5, -61.0, -49.0, -30.0, -18.5), "TR": (7.0, 18.5, 37.5, 49.0, 73.5),
         "BL": (-97.5, -86.0, -24.5, -14.0), "BR": (11.0, 23.0, 47.5, 59.0, 82.0, 93.5)}
C = Vector((5.67, 5.67, 0.0)) - Vector((1, -1, 0)).normalized() * 0.26               # the block of flats' middle on the ground (Flash x 79, the pen's right corner)
U = Vector((1, -1, 0)).normalized()        # toward the camera
V = Vector((1, 1, 0)).normalized()         # screen right


def T(s, t, z):
    """The world point s across (screen right), t toward the camera and z up from the block's middle."""
    return C + V * s + U * t + Vector((0, 0, z))


def tbox(name, s0, s1, t0, t1, z0, z1, mat, bevel=0.05):
    """A box square to the block (its faces look at the camera, left and right)."""
    return box(name, (s1 - s0, t1 - t0, z1 - z0), T((s0 + s1) / 2, (t0 + t1) / 2, z0), mat, rot=(0, 0, 45),
               bevel=bevel)


WING = 1.75                 # the side wings' side
WING_L, WING_R = (-1.43, 0.26), (1.39, 0.26)      # their middles (s, t): left corner at Flash x 52.5, right at 105.5


def lip(name, p, n, r):
    """A thin rounded ring on a face round a doorway of radius r at world point p, the face looking along n."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.03
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(47)
    for i, q in enumerate(sp.points):
        a = 2 * math.pi * i / 48
        q.co = ((r + 0.02) * math.cos(a), (r + 0.02) * math.sin(a), 0.0, 1)
    sp.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(M["wallshade"])
    link(ob)
    ob.rotation_euler = n.to_track_quat("Z", "Y").to_euler()
    ob.location = p + n * 0.01
    return ob


def blob(name, p, n, r, depth):
    """Flash's glossy green blob sitting in the back of a doorway (world point p on the face, looking along n): bright
    in the top block's doorways, dark in the lower ones (Flash's are mostly in shadow there)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r * 0.8)
    ob = mesh_ob(name, bm, [M["blob" if name.startswith("top-") else "blobdark"]])
    ob.location = p - n * (depth * 0.95)
    return ob


def door_at(ob, p, n, r=0.36, depth=0.45):
    """A round doorway into ob's face through world point p, looking along n."""
    blob(ob.name + "blob", p, n, r, depth)
    cut = cyl(ob.name + "-cut", r, depth + 0.2, (0, 0, 0), M["holein"], verts=40, bevel=0.0)
    cut.rotation_euler = n.to_track_quat("Z", "Y").to_euler()
    cut.location = p - n * depth
    cut.hide_render = True
    cut.hide_viewport = True
    mo = ob.modifiers.new("door", "BOOLEAN")
    mo.object = cut
    mo.operation = "DIFFERENCE"
    mo.solver = "EXACT"
    try:
        mo.material_mode = "TRANSFER"
    except (AttributeError, TypeError):
        pass
    return ob


def door(ob, s, t, z, r=0.36, depth=0.45, rim=False, oval=(1.0, 1.0)):
    """A round doorway into the face at t (toward the camera), its walls and floor dark green."""
    if rim:
        lip(ob.name + "lip", T(s, t, z), U, r)
    blob(ob.name + "blob", T(s, t, z), U, r * min(oval), depth)
    cut = cyl(ob.name + "-cut", r, depth + 0.2, T(s, t - depth, z), M["holein"], rot=(90, 0, 45), verts=40, bevel=0.0)
    cut.scale = (oval[0], oval[1], 1.0)                 # across, up
    cut.hide_render = True
    cut.hide_viewport = True
    mo = ob.modifiers.new("door", "BOOLEAN")
    mo.object = cut
    mo.operation = "DIFFERENCE"
    mo.solver = "EXACT"
    try:
        mo.material_mode = "TRANSFER"
    except (AttributeError, TypeError):
        pass
    return ob


def alcove(ob, s0, s1, t, z0, z1, depth=0.5):
    """A square dark alcove into the face at t (Flash's black face on the top block)."""
    cut = tbox(ob.name + "-cut", s0, s1, t - depth, t + 0.2, z0, z1, M["holedark"], bevel=0.0)
    cut.hide_render = True
    cut.hide_viewport = True
    mo = ob.modifiers.new("alcove", "BOOLEAN")
    mo.object = cut
    mo.operation = "DIFFERENCE"
    mo.solver = "EXACT"
    try:
        mo.material_mode = "TRANSFER"
    except (AttributeError, TypeError):
        pass
    return ob


def cube(name, s0, s1, t0, t1, z0, z1, hole=None, roof=0.12, wall="wall", top="roof"):
    """A pale cube with a green roof slab flush on top and (hole = (s, z[, r])) a round doorway in its camera face."""
    ob = tbox(name, s0, s1, t0, t1, z0, z1 - roof, M[wall])
    if roof:
        tbox(name + "roof", s0, s1, t0, t1, z1 - roof, z1, M[top], bevel=0.04 if top == "roof" else 0.09)
    if hole:
        door(ob, hole[0], t1, hole[1], *hole[2:])
    return ob


def bend(c, p_in, p_out, rc, n=6):
    """Points rounding the corner c between the straight runs from p_in and to p_out."""
    d0, d1 = (c - p_in).normalized(), (p_out - c).normalized()
    p0, p1 = c - d0 * rc, c + d1 * rc
    return [p0.lerp(c, i / n).lerp(c.lerp(p1, i / n), i / n) for i in range(n + 1)]


def rail_path():
    """The rail round the pen, from the gate's right post round to its left one: up out of the post, round the four
    corners, down into the other post."""
    rc = 0.5
    z = RAIL_Z
    path = [Vector((GATE[1], -A, 0.15)), Vector((GATE[1], -A, z)), Vector((A, -A, z)), Vector((A, A, z)),
            Vector((-A, A, z)), Vector((-A, -A, z)), Vector((GATE[0], -A, z)), Vector((GATE[0], -A, 0.15))]
    pts = [path[0]]
    for i in range(1, len(path) - 1):
        pts += bend(path[i], path[i - 1], path[i + 1], rc if i in (2, 3, 4, 5) else 0.35)
    pts.append(path[-1])
    return pts


def post_xy(side, x):
    """The ground point of a post at Flash x on a side of the pen."""
    if side == "TL":
        return (-A, x / SX + A)
    if side == "TR":
        return (x / SX - A, A)
    if side == "BL":
        return (x / SX + A, -A)
    return (A, x / SX - A)


def build_fence():
    tube("rail", rail_path(), RAIL_R, M["rail"], verts=12)
    for side, xs in POSTS.items():
        for i, x in enumerate(xs):
            px_, py_ = post_xy(side, x)
            mat = M["leg"] if side == "BR" and x > 80 else M["post"]      # in the block's shade: Flash's are dark
            cyl(f"post{side}{i}", POST_R, RAIL_Z, (px_, py_, 0.0), mat, verts=12, bevel=0.0)
    for i, gx in enumerate(GATE):                                    # Flash's pale gate posts the rail bends into
        cyl(f"postgate{i}", RAIL_R * 1.15, 0.72, (gx, -A, 0.0), M["post"], verts=12, bevel=0.0)   # pale up to the bend


def build_flats():
    w = M["wall"]
    # ground floor and legs
    # the side wings stand square to the pen (45 degrees to the rest), so we see them corner on, their doorways in the
    # faces looking out to the left and right (Flash's tall, narrow doorway ellipses there)
    # under the left wing a short box hangs down to the railing's lower bar (Flash shows grass below it, not a block
    # to the ground)
    box("ground-box", (1.0, 1.0, 1.25), T(-1.7, 0.26, 0.7), M["wallshade"])
    box("ground-boxr", (0.9, 0.9, 1.9), T(1.55, 0.0, 0.0), M["wallblack"])
    for i, (s, t) in enumerate(((-0.6, 1.98), (0.6, 1.98), (-0.6, 2.6), (-0.75, 0.75), (0.75, 0.75),
                                (1.1, 0.75), (1.75, 0.75))):
        z1 = 1.16 if abs(s) < 1 else 1.9
        cyl(f"leg{i}", 0.075, z1 + 0.05, T(s, t, 0.0), M["leg"], verts=10, bevel=0.0)
    # first floor: the front cube, the core and a cube either side, under the deck
    cube("cube-front", -0.93, 0.93, 1.86, 2.76, 1.16, 2.9, hole=(0.0, 2.03, 0.44))
    tbox("core", -0.9, 0.9, -0.9, 0.9, 1.16, 3.9, w)
    for nm, (ws, wt), n in (("cube-left", WING_L, Vector((0, -1, 0))), ("cube-right", WING_R, Vector((1, 0, 0)))):
        ob = box(nm, (WING, WING, 2.0), T(ws, wt, 1.9), M["wall"])
        door_at(ob, T(ws, wt, 2.9) + n * (WING / 2), n, r=0.44)
    # the deck: a thick plank floor on the first floor, white end boards
    tbox("deck", -2.2, 2.2, -2.6, 1.2, 3.9, 4.4, M["slab"], bevel=0.04)
    tbox("endl", -2.6, -2.2, 0.0, 1.2, 3.9, 5.5, w, bevel=0.14)
    tbox("endr", 2.2, 2.6, 0.0, 1.2, 3.9, 5.5, w, bevel=0.14)
    # second floor on the deck: the front cube on its front edge, the tall back block, and either side a cube on a
    # dark wooden plinth (Flash's dark brown faces under the side cubes, the deck's lit top in front of them)
    top = cube("top-front", -0.88, 0.88, -0.4, 0.9, 4.4, 6.2, top="rooflit", roof=0.2)    # a strip of deck before it
    door(top, 0.0, 0.9, 5.25, 0.47, oval=(1.0, 1.12))                # Flash's big round doorway up here
    back = cube("top-back", -0.88, 0.88, -2.2, -0.9, 4.4, 6.95, top="rooflit", roof=0.2)
    alcove(back, -0.8, 0.8, -0.9, 5.0, 6.68)
    door(back, 0.0, -1.4, 6.0, 0.42, 0.3, rim=False)
    for side, (s0, s1) in (("left", (-2.2, -0.9)), ("right", (0.9, 2.2))):
        tbox(f"plinth-{side}", s0, s1, -2.4, -0.1, 4.4, 5.4, M["plinth"], bevel=0.04)
        cube(f"top-{side}", s0, s1, -1.3, -0.1, 5.4, 6.75, roof=0.25)
    # Flash's little grey railing at the left wing's foot: a tall post and a short one on the ground, a top bar from
    # the tall post back into the wing and a lower bar between the posts (Flash px: posts at x 50 and 64, bars at y 72
    # and 77.5, feet at y 85)
    # (set 0.45 toward the camera so it stands clear in front of the ground box, the posts a little taller to keep the
    # bars on Flash's rows; the top bar runs level to the wing's underside)
    f0, f1 = px(50, 85, Z=0.0) + U * 0.45, px(64, 85.6, Z=0.0) + U * 0.45
    zt, zl = 1.89, 1.13
    tube("ladder0", [f0, f0 + Vector((0, 0, zt))], 0.045, M["frame"], verts=8)
    tube("ladder1", [f1, f1 + Vector((0, 0, zl))], 0.045, M["frame"], verts=8)
    tube("ladderrung0", [f0 + Vector((0, 0, zl)), f1 + Vector((0, 0, zl))], 0.04, M["frame"], verts=8)
    tube("ladderrung1", [f0 + Vector((0, 0, zt)), f0 + V * 1.42 + Vector((0, 0, zt))], 0.04, M["frame"], verts=8)


def build_static():
    build_fence()
    build_flats()
def setup(sc):
    """The approved buildings' camera, sun and sky (putty3.py / twig2.py), unchanged."""
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
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, GROUND))
    g = bpy.context.active_object
    g.name = "ground"
    g.is_shadow_catcher = True
    return cam


def cam_fwd():
    el, az = math.radians(EL), math.radians(-45)
    return -Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))




FAMILY = (("rail", "rail"), ("postgate", "post"), ("post", "post"), ("leg", "leg"), ("ladder", "ladder"),
          ("deck", "deck"), ("plinth-left", "top-left"), ("plinth-right", "top-right"), ("end", "end"), ("cube-front", "cube-front"), ("cube-left", "cube-left"),
          ("cube-right", "cube-right"), ("top-front", "top-front"), ("top-back", "top-back"),
          ("top-left", "top-left"), ("top-right", "top-right"), ("core", "core"), ("ground-box", "ground-box"))
FAMILY = tuple((k + "lip", f) for k, f in FAMILY) + FAMILY       # a doorway's lip belongs to its cube


def family(o):
    n = o.name.split(".")[0]
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
        if o.type not in ("MESH", "CURVE") or o.name == "ground" or o.name.endswith("-cut"):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        if me is None:
            continue
        mw = ev.matrix_world
        vs = [mw @ v.co for v in me.vertices]
        out[o.name] = (o, BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs)
        ev.to_mesh_clear()
    return out


def main():
    build_static()
    setup(SC)
    out = HERE / ("work" if MODE in ("fit", "look") else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    if MODE == "check":
        obs = list(trees().values())
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
            print("CHECK", key, sum(x[2] for x in v), v[:4])
        print("DONE check")
        return
    if MODE == "gap":
        # as the game camera sees it: wherever one part lies in front of another along a camera ray, how far behind
        # the other one is (small = looks as if they touch or pass into each other)
        fwd = cam_fwd()
        step = 0.25
        dg = bpy.context.evaluated_depsgraph_get()
        pairs = {}
        for ix in range(int(FRAME[0] / step), int(FRAME[2] / step)):
            for iy in range(int(FRAME[1] / step), int(FRAME[3] / step)):
                o = px(ix * step, iy * step, Z=4.0) - fwd * 40
                ok, loc, nrm, idx, ob, mat = SC.ray_cast(dg, o, fwd)
                if not ok or ob.name == "ground":
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
            print("GAP %-11s in front of %-11s: least depth gap %.3f, rays under 0.05: %d of %d, screen box "
                  "x %.1f..%.1f y %.1f..%.1f" % (f1, f2, d, near, n, *bb[0::2], *bb[1::2]))
        print("DONE gap")
        return
    if MODE == "fit":
        sc.cycles.samples = 24
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        sc.render.filepath = str(out / "fit.png")
        bpy.ops.render.render(write_still=True)
        print("DONE fit")
        return
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE == "look":
        sc.cycles.samples = int(os.environ.get("HO_SAMPLES", 64))
        if os.environ.get("HO_BOX"):              # only this Flash px box: x0,y0,x1,y1
            x0, y0, x1, y1 = map(float, os.environ["HO_BOX"].split(","))
            w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
            sc.render.use_border = True
            sc.render.use_crop_to_border = True
            sc.render.border_min_x, sc.render.border_max_x = (x0 - FRAME[0]) / w, (x1 - FRAME[0]) / w
            sc.render.border_min_y, sc.render.border_max_y = 1 - (y1 - FRAME[1]) / h, 1 - (y0 - FRAME[1]) / h
        sc.render.filepath = str(out / "look.png")
        bpy.ops.render.render(write_still=True)
    if MODE == "base":
        # the whole housing with its ground shadow, and the building alone (no shadow)
        sc.cycles.samples = int(os.environ.get("HO_SAMPLES", 384))
        sc.render.filepath = str(out / "base.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 32
        sc.render.filepath = str(out / "alone.png")
        bpy.ops.render.render(write_still=True)
    if MODE == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / "housing.blend"))
    print("DONE", MODE)


main()
