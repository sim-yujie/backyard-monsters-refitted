"""silo.py : the Storage Silo (Flash building 6) as a 3D model, v1. Built against the Flash pictures in the game's own
pixel frame (fref.py), on the approved Putty Squisher v3 / Twig Snapper v3 scene: the same camera, sun, scale (10 Flash
px a world unit) and matte painted Cycles finish, no outline.

    blender -b --factory-startup -P silo.py -- fit [cell]        work/fit-c<cell>.png  quick silhouette, 4 px a Flash px
    blender -b --factory-startup -P silo.py -- base              render/base.png (cell 0, ground shadow), alone.png
    blender -b --factory-startup -P silo.py -- fill [cells|all]  render/c<NN>-full.png (the cage's inside, whole scene)
                                                                 and c<NN>-sack.png (the sack alone, the rest held out)
    blender -b --factory-startup -P silo.py -- check             CHECK lines: parts whose meshes overlap (cells 0, 12,
                                                                 25); CLEAR lines: how near the sack comes to the rest
    blender -b --factory-startup -P silo.py -- gap               GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P silo.py -- look [cells]      work/look-c<NN>.png  quick whole-scene looks (SI_K,
                                                                 SI_SAMPLES) while tuning

The silo has one look for all ten levels (Flash has one picture set). Its 26 animation cells are not a loop: the game
shows the cell for how full the yard's storage is (BUILDING6.as:44), so cell 0 is a slim, empty sack hanging from the
lid and cell 25 a fat sack sitting on the floor plate. Only the sack changes; post.py keeps every other pixel from
base.png, so nothing else can move.

The model, bottom up: four steel hex nuts on the ground; a thick gold floor plate on twisted steel cables that run
through it into the nuts; the four cables up through the arms of a gold cross-shaped lid plate with a round middle,
standing out of them with rounded ends; on the lid a raised round dish, the tall ribbed hatch drum with a flat strap
handle and a latch; under the lid a gold collar that holds the sack's gathered neck. The sack's patchwork is patch.py's
picture.
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
CELLS = 26

EL = 30.0
ORIGIN = (-0.8, 48.5)                 # Flash pixel of the world origin (the building's middle on the ground)
GROUND = 0.0
FRAME = (-44, -60, 72, 78)            # the canvas in Flash px (as fref.FRAME)
K = {"fit": 4}.get(MODE, int(os.environ.get("SI_K", 12)))      # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = 1
rng = random.Random(1000)

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
            ao_min=0.55, rust_at=0.6, smudge=0.0, ao_dist=0.35):
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





# ------------------------------------------------------------------------------------------------------------ materials
SACK_DIM = (0.42, 0.46)          # the cloth's brightness, empty and full (Flash's cells: mean 112 grey at 0, 135 at 25)
SACK_TINT = (1.0, 0.95, 0.8)     # warmed, so the sky's blue does not grey it
SACK_CONTRAST = 0.3              # the patch picture's contrast: near-white beside deep red
SACK_COAT = 0.28                 # a glossy coat on the taut, full sack
SACK_SHINE = (0.15, 0.45)        # Flash's painted shine on the upper left, empty and full
SACK_GLOSS = 0.36                # its roughness when full (0.8 empty)


def sack_cloth():
    """The sack's patchwork canvas, as Flash's: cream cloth sewn from patches of near-white, cream, tan, rust, deep red
    and pinkish grey, of many sizes and overlapping (patch.py's picture). It sits in the sack's own UV (round the sack, down its length), so the patches stay on the
    cloth and stretch with it as it fills."""
    if "sack" in MATS:
        return MATS["sack"]
    t = NT("sack")
    tc = t.n("ShaderNodeTexCoord")
    # the patchwork picture (patch.py): patches of many sizes, overlapping, a little skew, none in rows
    img = t.n("ShaderNodeTexImage", interpolation="Cubic")
    img.image = bpy.data.images.load(str(HERE / "sackpatch.png"))
    img.image.colorspace_settings.name = "sRGB"
    t.link(tc.outputs["UV"], img.inputs["Vector"])
    bc = t.n("ShaderNodeBrightContrast")                       # Flash's patches: near-white beside deep red
    bc.inputs["Contrast"].default_value = SACK_CONTRAST
    t.link(img.outputs["Color"], bc.inputs["Color"])
    col = bc.outputs["Color"]
    # the cloth's own mottling: soft lighter and darker clouds across every patch
    v3 = t.coords()
    mot = t.ramp(t.noise(v3, 4.0, 4.0, 0.6), [(0.3, srgb(204, 196, 188)), (0.7, (1, 1, 1, 1))])
    col = t.mix(col, mot, 1.0, "MULTIPLY")
    # Flash's canvas is a dull, dirty cloth, shaded darker toward the sack's sides. Slack (cell 0) it is darker still,
    # crumpled and in the lid's shade; full it is taut and a little glossy. The "fill" value is the cell's fill, 0..1
    # (set_sack sets it).
    fill = t.n("ShaderNodeValue")
    fill.name = "fill"
    fill.outputs[0].default_value = 0.0
    dim = t.n("ShaderNodeMapRange")
    dim.inputs[3].default_value, dim.inputs[4].default_value = SACK_DIM
    t.link(fill.outputs[0], dim.inputs[0])
    grey = t.n("ShaderNodeCombineColor")
    for i, k in enumerate(SACK_TINT):                         # warm: the sky's blue would grey the cloth
        mk = t.n("ShaderNodeMath", operation="MULTIPLY")
        t.link(dim.outputs[0], mk.inputs[0])
        mk.inputs[1].default_value = k
        t.link(mk.outputs[0], grey.inputs[i])
    col = t.mix(col, grey.outputs[0], 1.0, "MULTIPLY")
    lw = t.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    col = t.mix(col, t.ramp(lw.outputs["Facing"], [(0.45, (1, 1, 1, 1)), (0.95, srgb(170, 160, 154))]), 1.0,
                "MULTIPLY")
    # Flash's painted shine: the cloth turned toward the sun and the eye (upper left) goes near-white, more so full
    geo = t.n("ShaderNodeNewGeometry")
    dot = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(geo.outputs["Normal"], dot.inputs[0])
    dot.inputs[1].default_value = Vector((0.1, -0.57, 0.81)).normalized()
    shine = t.n("ShaderNodeMapRange")
    shine.inputs[1].default_value, shine.inputs[2].default_value = 0.7, 0.97
    t.link(dot.outputs["Value"], shine.inputs[0])
    sf = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(shine.outputs[0], sf.inputs[0])
    sfill = t.n("ShaderNodeMapRange")
    sfill.inputs[3].default_value, sfill.inputs[4].default_value = SACK_SHINE
    t.link(fill.outputs[0], sfill.inputs[0])
    t.link(sfill.outputs[0], sf.inputs[1])
    col = t.mix(col, t.mix(col, srgb(255, 244, 222), 1.0, "SCREEN"), sf.outputs[0])
    col = t.grime(col, GROUND, 2.6, 0.12, 0.3)
    rough = t.n("ShaderNodeMapRange")
    rough.inputs[3].default_value, rough.inputs[4].default_value = 0.8, SACK_GLOSS
    t.link(fill.outputs[0], rough.inputs[0])
    coat = t.n("ShaderNodeMapRange")
    coat.inputs[3].default_value, coat.inputs[4].default_value = 0.0, SACK_COAT
    t.link(fill.outputs[0], coat.inputs[0])
    t.set(**{"Base Color": col, "rough": rough.outputs[0], "spec": 0.55, "coat": coat.outputs[0],
             "Coat Roughness": 0.28, "Coat Tint": srgb(255, 236, 205)})
    # canvas weave and soft creases as bump
    weave = t.noise(v3, 60.0, 2.0, 0.5)
    crease = t.noise(t.coords(scale=(1.0, 1.0, 0.35)), 3.0, 3.0, 0.5, 0.6)
    h = t.n("ShaderNodeMath", operation="ADD")
    t.link(crease, h.inputs[0])
    hw = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(weave, hw.inputs[0])
    hw.inputs[1].default_value = 0.25
    t.link(hw.outputs[0], h.inputs[1])
    t.bump(h.outputs[0], 0.18, 0.03)
    MATS["sack"] = t.m
    return t.m


def materials():
    M = {}
    # matte painted metals, the approved Putty Squisher's finish: Flash's orange gold, worn paler on the edges, sooty
    # low down; the steel blue-grey
    M["gold"] = painted("gold", (186, 136, 22), rough=0.32, metal=0.7, wear=(214, 168, 50), rust=(120, 80, 18),
                        scale=2, dirt=0.4, spec=0.5, soot=0.3, rust_at=0.72)
    M["plate"] = painted("plate", (186, 136, 22), rough=0.32, metal=0.7, wear=(214, 168, 50), rust=(120, 80, 18),
                         scale=2, dirt=0.4, spec=0.5, soot=0.3, rust_at=0.72, smudge=0.75, ao_min=0.1, ao_dist=0.7)
    M["goldd"] = painted("goldd", (180, 128, 28), rough=0.4, metal=0.55, wear=(214, 168, 64), rust=(100, 64, 14),
                         scale=4, dirt=0.25, spec=0.4, soot=0.35, rust_at=0.68)
    M["cable"] = painted("cable", (138, 148, 166), rough=0.28, metal=0.85, wear=(206, 216, 232), scale=12,
                         dirt=0.2, spec=0.5, soot=0.3)
    M["nut"] = painted("nut", (92, 94, 100), rough=0.5, metal=0.45, wear=(122, 124, 132), scale=5, dirt=0.3,
                       spec=0.35)
    M["sack"] = sack_cloth()
    return M


M = materials()


def R(seed):
    """A random stream for one part: the same in every cell."""
    return random.Random(seed)


# ------------------------------------------------------------------------------------------------------------ the model
ROD = 1.92                 # the four cables stand at (+-ROD, +-ROD): the corners as Flash draws them
ROD_R = 0.28               # a cable's radius (Flash: 5-6 px wide)
NUT_R, NUT_H = 0.84, 0.8  # the hex nuts the silo stands on
PLATE = 2.37               # the floor plate's half side
PLATE_Z0, PLATE_Z1 = 1.24, 1.98
LID_Z0, LID_Z1 = 8.42, 8.97      # the lid plate (round middle and four arms out to the cables)
LID_R, ARM_W, ARM_L = 2.2, 1.0, 3.15
CABLE_TOP = 9.8                  # the cables stand up out of the lid's arms, ends rounded (Flash)


def star_plate(name, r, arm_w, arm_l, z0, z1, mat, n=720):
    """A flat plate: a disc of radius r and four arms (width arm_w, reaching arm_l from the middle) along the diagonals,
    from z0 to z1, softly bevelled."""
    bm = bmesh.new()
    ring = []
    for i in range(n):
        th = 2 * math.pi * i / n
        best = r
        for k in range(4):
            d = th - math.radians(45 + 90 * k)
            c, s = math.cos(d), abs(math.sin(d))
            if c > 1e-6:
                best = max(best, min(arm_l / c, (arm_w / 2) / s if s > 1e-9 else 1e9))
        ring.append((best * math.cos(th), best * math.sin(th)))
    bot = [bm.verts.new((x, y, z0)) for x, y in ring]
    top = [bm.verts.new((x, y, z1)) for x, y in ring]
    cb, ct = bm.verts.new((0, 0, z0)), bm.verts.new((0, 0, z1))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
        bm.faces.new((top[i], top[j], ct))
        bm.faces.new((bot[j], bot[i], cb))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=0.07, segs=3)


def hexnut(name, at, r, h, mat, chamfer=0.08):
    """A hex nut standing on `at`: six flats, its top and bottom edges chamfered."""
    prof = [(0.0, 0.0), (r - chamfer, 0.0), (r, chamfer), (r, h - chamfer), (r - chamfer, h), (0.0, h)]
    ob = lathe(name, prof, at, mat, verts=6)
    ob.rotation_euler = (0, 0, math.radians(15))
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def cable(name, x, y, z0, z1, r=ROD_R, strands=3, pitch=1.3, seed=0):
    """A twisted steel cable: `strands` round wires wound round each other (Flash's diagonal striped rods). At the top
    the wires draw together and end rounded, as Flash's cable ends standing up out of the lid's arms."""
    wr = r * 0.5
    off = r - wr
    n = int((z1 - z0) / pitch * 18) + 2
    zs = [z0 + (z1 - z0 - 0.3) * i / n for i in range(n + 1)]
    zs += [z1 - 0.3 + 0.3 * math.sin(math.pi / 2 * i / 12) for i in range(1, 13)]
    ph0 = R(seed).uniform(0, 2 * math.pi)
    for s in range(strands):
        ph = ph0 + 2 * math.pi * s / strands
        pts, rad = [], []
        for z in zs:
            a = ph + 2 * math.pi * z / pitch
            u = max(0.0, (z - (z1 - 0.3)) / 0.3)
            g = off * (1 - 0.45 * u * u)                          # the wires gather toward the end
            pts.append((x + g * math.cos(a), y + g * math.sin(a), z))
            e = max(0.0, (z - (z1 - wr)) / wr)                    # and round off over their last radius
            rad.append(math.sqrt(max(0.0, 1 - e * e)) if e < 1 else 0.0)
        tube(f"{name}s{s}", pts, wr * 1.06, M["cable"], verts=10, radii=rad)
    cyl(f"{name}core", off * 0.9, z1 - z0 - wr, (x, y, z0), M["cable"], verts=10, bevel=0.0)


def strap(name, c, aw, al, w, ln, band, thick, mat, rc=0.16):
    """A flat strap bent into a rounded rectangle (w across aw, ln along al, centred on c), its broad face in that
    plane: Flash's flat gold bail and hasp."""
    aw, al = aw.normalized(), al.normalized()
    nrm = aw.cross(al).normalized()

    def ring(hw, hl, r):
        pts = []
        for cx, cy, a0 in ((hw - r, hl - r, 0), (-hw + r, hl - r, 90), (-hw + r, -hl + r, 180), (hw - r, -hl + r, 270)):
            for i in range(7):
                a = math.radians(a0 + 90 * i / 6)
                pts.append(c + aw * (cx + r * math.cos(a)) + al * (cy + r * math.sin(a)))
        return pts
    o, n = ring(w / 2, ln / 2, rc), ring(w / 2 - band, ln / 2 - band, max(0.02, rc - band))
    bm = bmesh.new()
    lay = [[bm.verts.new(p + nrm * d) for p in pts] for pts in (o, n) for d in (-thick / 2, thick / 2)]
    ob_, ot, ib, it = lay
    m = len(o)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((ot[i], ot[j], it[j], it[i]))
        bm.faces.new((ob_[j], ob_[i], ib[i], ib[j]))
        bm.faces.new((ob_[i], ob_[j], ot[j], ot[i]))
        bm.faces.new((ib[j], ib[i], it[i], it[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=0.012, segs=2)


def handle(name, z, mat):
    """The hatch's bail handle, as Flash's: a flat, squarish gold strap loop hinged in two eyes on the front left of
    the hatch's top, folded back toward the back corner and lying tilted on the hatch."""
    d = Vector((0, 1, 0))                                     # the hinge line
    back = Vector((-1, 0, 0))                                 # folded toward the upper left of the screen
    u = (back * math.cos(math.radians(HANDLE_TILT)) + Vector((0, 0, 1)) * math.sin(math.radians(HANDLE_TILT)))
    h0 = Vector((-0.25, 0.02, z))
    w, ln = 1.08, 1.15
    strap(name, h0 + Vector((0, 0, 0.08)) + u * (ln / 2 - 0.08), d, u, w, ln, 0.2, 0.05, mat, rc=0.34)
    for k, s in enumerate((h0 - d * (w / 2 - 0.08), h0 + d * (w / 2 - 0.08))):
        lathe(f"{name}eye{k}", [(0.0, 0.0), (0.13, 0.0), (0.13, 0.07), (0.09, 0.14), (0.0, 0.16)],
              (s.x, s.y, z - 0.1), mat, verts=16)


HANDLE_TILT = 30


# the sack: radius at these heights for the key fill cells (fitted to Flash's cells 0, 4, 8, 12, 17, 25), its bottom's
# height, how tall its rounded bottom is and how wide its flat underside
SACK_Z = [8.3, 7.6, 6.6, 5.6, 4.6, 3.6, 2.8]
SACK_KEYS = {
    0: ([0.95, 1.17, 1.27, 1.36, 1.40, 1.36, 1.10], 2.85, 0.95, 0.0),
    4: ([0.95, 1.30, 1.50, 1.60, 1.62, 1.56, 1.30], 2.70, 0.95, 0.0),
    8: ([0.95, 1.62, 1.95, 2.05, 2.08, 2.00, 1.70], 2.55, 0.90, 0.0),
    12: ([0.95, 1.85, 2.2, 2.33, 2.38, 2.34, 2.15], 2.35, 0.80, 0.3),
    17: ([0.95, 1.8, 2.2, 2.4, 2.5, 2.46, 2.2], 2.15, 0.7, 0.9),
    25: ([0.95, 1.7, 2.12, 2.4, 2.62, 2.74, 2.76], 2.0, 0.36, 2.25),
}
SACK_TOP = 8.3


def sack_key(c):
    ks = sorted(SACK_KEYS)
    for a, b in zip(ks, ks[1:]):
        if a <= c <= b:
            f = (c - a) / (b - a)
            A, B = SACK_KEYS[a], SACK_KEYS[b]
            return ([x + (y - x) * f for x, y in zip(A[0], B[0])],) + tuple(x + (y - x) * f for x, y in zip(A[1:], B[1:]))
    return SACK_KEYS[ks[-1]]


def _cr(z, zs, rs):
    """Catmull-Rom through (zs, rs) (zs falling), at z."""
    n = len(zs)
    for i in range(n - 1):
        if zs[i] >= z >= zs[i + 1]:
            p0, p1, p2, p3 = rs[max(i - 1, 0)], rs[i], rs[i + 1], rs[min(i + 2, n - 1)]
            t = (zs[i] - z) / (zs[i] - zs[i + 1])
            return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
                          (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    return rs[-1]


def sack_profile(c, nv=72):
    """(r, z) rows down the sack at cell c, from the neck to the middle of its underside, evenly spaced along it."""
    rs, zb, cap, flat = sack_key(c)
    zc = zb + cap
    pts = []
    m = 60
    for i in range(m + 1):
        z = SACK_TOP + (zc - SACK_TOP) * i / m
        pts.append((_cr(z, SACK_Z, rs), z))
    r0 = pts[-1][0]
    for i in range(1, 25):
        a = math.pi / 2 * i / 24
        pts.append((flat + (r0 - flat) * math.cos(a), zb + cap * (1 - math.sin(a))))
    for i in range(1, 9):
        pts.append((flat * (1 - i / 8), zb))
    pts = [p for k, p in enumerate(pts) if k == 0 or math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 1e-6]
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + math.hypot(a[0] - b[0], a[1] - b[1]))
    out = []
    j = 0
    for i in range(nv + 1):
        s = acc[-1] * i / nv
        while j < len(acc) - 2 and acc[j + 1] < s:
            j += 1
        f = min(1.0, (s - acc[j]) / max(1e-9, acc[j + 1] - acc[j]))
        out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f))
    return out


def smin(a, b, k):
    h = max(k - abs(a - b), 0.0) / k
    return min(a, b) - h * h * k * 0.25


def rod_limit(th, z=99.0):
    """How far out the sack may reach at bearing th (and height z) before it meets a cable (with a small gap): the
    sack presses round the cables, never into them, and low down round the bosses where they pass the floor plate."""
    lim = 9.0
    D = ROD * math.sqrt(2)
    rr = ROD_R + 0.06
    rr += max(0.0, 0.52 - rr) * min(1.0, max(0.0, (PLATE_Z1 + 0.35 - z) / 0.25))
    for k in range(4):
        d = th - math.radians(45 + 90 * k)
        s, c = D * math.sin(d), math.cos(d)
        if c > 0 and abs(s) < rr:
            lim = min(lim, D * c - math.sqrt(rr * rr - s * s))
    return lim


def sack(c, nu=96, nv=72):
    """The sack at fill cell c: a soft lathe of sack_profile, gathered into folds at the neck, lumpy when slack and
    taut when full, pressed round the cables; patches in its own UV so they stay on the cloth."""
    prof = sack_profile(c, nv)
    zb = sack_key(c)[1]
    f = c / (CELLS - 1)
    lump = 0.045 * (1 - f) + 0.012
    rnd = R(77)
    waves = [(rnd.randint(2, 5), rnd.uniform(0, 6.3), rnd.uniform(1.2, 2.6), rnd.uniform(0, 6.3)) for _ in range(4)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rows = []
    for i, (r, z) in enumerate(prof):
        t = i / nv
        if r < 1e-4:
            rows.append([bm.verts.new((0, 0, z))] * nu)
            continue
        row = []
        for j in range(nu):
            th = 2 * math.pi * j / nu
            k = 1.0
            neck = max(0.0, 1 - (SACK_TOP - z) / 0.9)                          # gathered folds under the collar
            k += 0.07 * neck * math.sin(14 * th + 0.4)
            body = math.sin(math.pi * min(1.0, t * 1.25))
            for n, ph, zf, zph in waves:
                k += lump / len(waves) * 2 * body * math.sin(n * th + ph) * math.sin(zf * z + zph)
            # full, the sack pillows out between the cables (and is held in where they are)
            w = ((1 + math.cos(4 * (th - math.pi / 4))) / 2) ** 2
            k += 0.05 * f * (1 - w) * math.sin(math.pi * min(1.0, max(0.0, (z - zb) / (SACK_TOP - zb) * 1.6)))
            rr = r * k
            rr = smin(rr, rod_limit(th, z), 0.12)
            row.append(bm.verts.new((rr * math.cos(th), rr * math.sin(th), z)))
        rows.append(row)
    for i in range(nv):
        a, b = rows[i], rows[i + 1]
        for j in range(nu):
            jj = (j + 1) % nu
            vs = [a[j], a[jj], b[jj], b[j]]
            uvs = [(j / nu, 1 - i / nv), ((j + 1) / nu, 1 - i / nv), ((j + 1) / nu, 1 - (i + 1) / nv),
                   (j / nu, 1 - (i + 1) / nv)]
            keep = [k for k in range(4) if vs[k] not in vs[:k]]
            if len(keep) < 3:
                continue
            fc = bm.faces.new([vs[k] for k in keep])
            for lp, k in zip(fc.loops, keep):
                lp[uvl].uv = uvs[k]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob("sack", bm, [M["sack"]])


def build_static():
    g, gd, nut = M["gold"], M["goldd"], M["nut"]
    for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, -1), (-1, 1))):
        x, y = sx * ROD, sy * ROD
        hexnut(f"nut{i}", (x, y, GROUND), NUT_R, NUT_H, nut)
        cable(f"cable{i}", x, y, NUT_H - 0.2, CABLE_TOP, seed=i)
    box("plate", (2 * PLATE, 2 * PLATE, PLATE_Z1 - PLATE_Z0), (0, 0, PLATE_Z0), M["plate"], bevel=0.12)
    star_plate("lid", LID_R, ARM_W, ARM_L, LID_Z0, LID_Z1, g)
    # the raised round dish on the lid, sloping up to the hatch: a tall round drum with vertical ribs, a beaded rim and
    # a low domed top (Flash)
    lathe("liddish", [(0.0, 0.0), (2.14, 0.0), (2.1, 0.08), (1.9, 0.2), (1.6, 0.3), (1.36, 0.33), (0.0, 0.33)],
          (0, 0, LID_Z1 - 0.02), g, verts=64)
    hz = LID_Z1 + 0.18
    lathe("hatch", [(0.0, 0.0), (1.28, 0.0), (1.28, 0.84), (1.36, 0.85), (1.39, 0.92), (1.35, 0.98), (1.15, 1.0),
                    (0.65, 1.04), (0.0, 1.05)], (0, 0, hz), g, verts=64)
    for k in range(6):                         # ribs round the drum
        a = math.radians(15 + 60 * k)
        box(f"clamp{k}", (0.2, 0.14, 0.8), (1.3 * math.cos(a), 1.3 * math.sin(a), hz + 0.05), gd,
            rot=(0, 0, math.degrees(a)), bevel=0.035)
    # Flash's latch on the right of the hatch: a flat hasp hinged on the rim, folded down over a staple on the drum
    a = math.radians(2)
    rd, tg = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
    box("latchstaple", (0.52, 0.18, 0.22), tuple(rd * 1.46 + Vector((0, 0, hz + 0.5))), g, rot=(0, 0, 2),
        bevel=0.04)
    hl = (rd * 0.42 + Vector((0, 0, -1))).normalized()
    strap("latchhasp", rd * 1.56 + Vector((0, 0, hz + 0.64)), tg, hl, 0.78, 0.8, 0.15, 0.05, g, rc=0.16)
    handle("handle", hz + 1.03, g)
    # the collar under the lid that the sack's neck is tied into
    lathe("collar", [(0.0, 0.0), (1.04, 0.0), (1.1, -0.06), (1.13, -0.3), (1.08, -0.42), (0.98, -0.46),
                     (0.9, -0.42), (0.9, 0.0)], (0, 0, LID_Z0 + 0.01), gd, verts=48)


# ------------------------------------------------------------------------------------------------------------ render
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


FAMILY = (("sack", "sack"), ("collar", "collar"), ("nut", "nut"), ("platewasher", "nut"), ("plateboss", "plate"),
          ("plate", "plate"), ("cable", "cable"), ("cap", "cap"), ("lid", "lid"), ("hatch", "lid"),
          ("clampbolt", "lid"), ("clamp", "lid"), ("latch", "lid"), ("handle", "handle"))


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
        if o.type not in ("MESH", "CURVE") or o.name == "ground":
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


def set_sack(c):
    old = bpy.data.objects.get("sack")
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)
    ob = sack(c)
    M["sack"].node_tree.nodes["fill"].outputs[0].default_value = c / (CELLS - 1)
    bpy.context.view_layer.update()
    return ob


def cells_arg():
    a = ARGS[1:]
    if not a or a[0] == "all":
        return list(range(CELLS))
    return [int(x) for x in a]


def region(pad=3.0):
    """The render region (fractions of the frame) that holds everything a full sack can change: the cage's inside and
    the floor plate, in Flash px x -37..37, y -24..56."""
    x0, y0, x1, y1 = -37 - pad, -24 - pad, 37 + pad, 56 + pad
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    return ((x0 - FRAME[0]) / w, (x1 - FRAME[0]) / w, 1 - (y1 - FRAME[1]) / h, 1 - (y0 - FRAME[1]) / h)


def main():
    build_static()
    set_sack(int(ARGS[1]) if MODE == "fit" and len(ARGS) > 1 else 0)
    setup(SC)
    out = HERE / ("work" if MODE == "fit" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    if MODE == "check":
        for c in (0, 12, 17, 25):
            set_sack(c)
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
                print("CHECK c%02d" % c, key, sum(x[2] for x in v), v[:3])
            so, st, svs = tr["sack"]
            near = {}
            for o2, t2, _ in obs:
                f2 = family(o2)
                if f2 in ("sack", "collar"):
                    continue
                for v in svs[::3]:
                    hit = t2.find_nearest(v, 1.0)
                    if hit[0] is not None and hit[3] < near.get(f2, (9.0,))[0]:
                        near[f2] = (hit[3], o2.name)
            for f2, (d, nm) in sorted(near.items()):
                print("CLEAR c%02d sack to %-6s %.3f (%s)" % (c, f2, d, nm))
        print("DONE check")
        return
    if MODE == "gap":
        # as the game camera sees it: wherever one part lies in front of another along a camera ray, how far behind
        # the other one is (small = looks as if they touch or pass into each other)
        fwd = cam_fwd()
        step = 0.25
        for c in (0, 12, 25):
            set_sack(c)
            dg = bpy.context.evaluated_depsgraph_get()
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
                print("GAP c%02d %-6s in front of %-6s: least depth gap %.3f, rays under 0.05: %d of %d, screen box "
                      "x %.1f..%.1f y %.1f..%.1f" % (c, f1, f2, d, near, n, *bb[0::2], *bb[1::2]))
        print("DONE gap")
        return
    if MODE == "look":
        # quick whole-scene looks while tuning: work/look-c<NN>.png for each cell asked (SI_K, SI_SAMPLES)
        sc.cycles.use_denoising = True
        sc.cycles.samples = int(os.environ.get("SI_SAMPLES", 64))
        for c in cells_arg():
            set_sack(c)
            sc.render.filepath = str(HERE / "work" / f"look-c{c:02d}.png")
            bpy.ops.render.render(write_still=True)
            print("CELL", c)
        print("DONE look")
        return
    if MODE == "fit":
        sc.cycles.samples = 24
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        c = int(ARGS[1]) if len(ARGS) > 1 else 0
        sc.render.filepath = str(out / f"fit-c{c:02d}.png")
        bpy.ops.render.render(write_still=True)
        return
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE == "base":
        # the whole silo at cell 0 with its ground shadow: every pixel outside the sack comes from here in every cell
        sc.cycles.samples = int(os.environ.get("SI_SAMPLES", 384))
        sc.render.filepath = str(out / "base.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 32
        sc.render.filepath = str(out / "alone.png")
        bpy.ops.render.render(write_still=True)
    if MODE == "fill":
        statics = [o for o in SC.objects if o.type in ("MESH", "CURVE") and o.name not in ("ground", "sack")]
        x0, x1, y0, y1 = region()
        for c in cells_arg():
            s = set_sack(c)
            # the cage's inside with the whole scene (the sack's light and shadow on the plate and cables)
            for o in statics:
                o.is_holdout = False
            bpy.data.objects["ground"].hide_render = False
            sc.cycles.samples = int(os.environ.get("SI_SAMPLES", 384))
            sc.render.use_border = True
            sc.render.use_crop_to_border = False
            sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = \
                x0, x1, y0, y1
            sc.render.filepath = str(out / f"c{c:02d}-full.png")
            bpy.ops.render.render(write_still=True)
            # the sack alone, everything in front of it held out: where the sack shows
            for o in statics:
                o.is_holdout = True
            bpy.data.objects["ground"].hide_render = True
            sc.cycles.samples = 16
            sc.render.filepath = str(out / f"c{c:02d}-sack.png")
            bpy.ops.render.render(write_still=True)
            print("CELL", c)
    print("DONE", MODE)


main()
