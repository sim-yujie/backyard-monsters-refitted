"""goo2.py : the Goo Factory (Flash building 4) as a 3D model, v2. Flash's parts, proportions and colours in the approved
Twig, Pebble and Putty family's matte painted finish: one body for every level, parts at fixed points on it (stack.py),
no outline.

    blender -b --factory-startup -P goo2.py -- <level> fit      work/fit-L<level>.png  quick picture, 4 px per Flash px
    blender -b --factory-startup -P goo2.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P goo2.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P goo2.py -- <level> check    CHECK lines: parts whose meshes overlap; CLEAR lines:
                                                                 how near each pump pipe comes to anything else
    blender -b --factory-startup -P goo2.py -- <level> gap      GAP lines: parts in front of others from the camera

Level 1: the riveted copper vat on its plate and four dark stumps, goo heaped in the rim round the neck and slopping
over, the steel collar and the slate funnel on the neck, the pump pipe out of the right side into the ground. Level 3
keeps all of it and builds the six-post pencil frame round the vat (two plank rings, the peach side plate, brackets to
the vat); the goo is heaped into a dome held by six steel straps, two grey vanes on the neck. Level 6 adds steel clamps
and iron feet on the posts, the second pump pipe at the front left, the return loop at the back right and the side loop
at the left. Level 10 adds the tower with its goo cap and arc, two loops stepping up at the back, the right side pipe
and the low pipe across the front.

Animation, as Flash: a glob of goo swells each pump pipe's foot, climbs the pipe, rounds the bend and is gone into the
vat; then the pipe rests. Nothing else moves. The base picture is rendered once, each frame renders only the pump
pipes with every still part as a holdout, and post.py lays that layer over the base.
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
FRAMES = 26                           # Flash's loop: 26 frames at every level

EL = 30.0
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the building's middle on the ground)
GROUND = S.GROUND
FRAME = (-44, -64, 52, 60)            # the canvas in Flash px (as fref.FRAME)
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))      # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1000)            # the same at every level: a level only adds parts


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
MOVING = []            # the pump pipes (hidden from the base picture's camera, alone in the frame layers)


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


def funnel_mat(name, col, wear, shine=(236, 240, 246)):
    """The funnel's matte dark slate, with Flash's one bright highlight on the screen-right of its rim (placed in the
    funnel's own box, Generated 0..1)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])
    u = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")
    t.link(sep.outputs["X"], u.inputs[0])
    u.inputs[1].default_value = 0.5
    half_y = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(sep.outputs["Y"], half_y.inputs[0])
    half_y.inputs[1].default_value = 0.5
    t.link(half_y.outputs[0], u.inputs[2])
    k0, k1 = (0, 0, 0, 1), (1, 1, 1, 1)
    rim = t.mix(t.ramp(u.outputs[0], [(0.72, k0), (0.9, k1)]),
                t.ramp(sep.outputs["Z"], [(0.6, k0), (0.76, k1), (0.9, k1), (0.98, k0)]), 1.0, "MULTIPLY")
    n1 = t.noise(v, 2.7, 3.0, 0.5, 0.2)
    out = t.mix(srgb(*col), srgb(*wear), t.ramp(n1, [(0.45, k0), (0.75, (0.6, 0.6, 0.6, 1))]))
    out = t.mix(out, srgb(*shine), rim)
    t.set(**{"Base Color": out, "rough": 0.62, "metal": 0.05, "spec": 0.3})
    t.bump(t.noise(v, 18, 4.0, 0.6), 0.05, 0.01)
    MATS[name] = t.m
    return t.m


def goo_mat(name, dark, mid, light, rough=0.36, scale=2.6, bump=0.25, ao_min=0.2, spec=0.5):
    """Wet goo as Flash paints it: mottled dark and mid green with pale yellow-green glints, near black in the hollows
    between the lumps."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    n1 = t.noise(v, scale, 5.0, 0.6, 0.4)
    col = t.ramp(n1, [(0.36, srgb(*dark)), (0.55, srgb(*mid)), (0.72, srgb(*light))])
    col = t.grime(col, GROUND, 2.6, 0.15, ao_min)
    t.set(**{"Base Color": col, "rough": rough, "spec": spec})
    t.bump(t.noise(v, scale * 3.0, 4.0, 0.6), bump, 0.03)
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
def materials():
    M = {}
    # every material matte and painted (the approved Twig, Pebble and Putty finish): worn, sooty, soft
    M["vat"] = painted("vat", (216, 136, 40), rough=0.58, metal=0.2, wear=(240, 178, 86), rust=(112, 62, 18), scale=1.6,
                       dirt=0.45, spec=0.32, soot=0.0, rust_at=0.7)
    M["seam"] = painted("seam", (176, 104, 30), rough=0.55, metal=0.25, wear=(214, 144, 56), scale=4.0, dirt=0.3,
                        spec=0.3)
    M["hoop"] = painted("hoop", (124, 72, 24), rough=0.55, metal=0.3, wear=(176, 110, 40), rust=(60, 32, 10), scale=3.0,
                        dirt=0.3, spec=0.3)
    M["pipe"] = painted("pipe", (192, 122, 34), rough=0.48, metal=0.3, wear=(238, 184, 86), rust=(84, 48, 14), scale=2.4,
                        dirt=0.4, spec=0.38, soot=0.35, rust_at=0.66)
    M["pipedark"] = painted("pipedark", (150, 90, 26), rough=0.52, metal=0.3, wear=(204, 146, 62), rust=(70, 40, 12),
                            scale=2.4, dirt=0.4, spec=0.34, soot=0.45, rust_at=0.62)
    M["goo"] = goo_mat("goo", (14, 44, 4), (40, 104, 10), (96, 160, 22), rough=0.5, spec=0.25)
    M["goodome"] = goo_mat("goodome", (12, 36, 4), (34, 90, 10), (84, 150, 22), rough=0.55, spec=0.12, scale=4.0,
                           bump=0.3, ao_min=0.12)
    M["neck"] = goo_mat("neck", (6, 20, 3), (16, 46, 6), (44, 90, 14), rough=0.45, spec=0.3, scale=3.0, bump=0.1)
    M["goodark"] = painted("goodark", (8, 16, 3), rough=0.85, wear=(16, 30, 6), scale=2.0, dirt=0.0, spec=0.05,
                           ao_min=0.2)
    M["slate"] = funnel_mat("slate", (42, 48, 64), (58, 66, 84))
    M["slatein"] = painted("slatein", (40, 46, 60), rough=0.7, wear=(60, 68, 84), scale=3, dirt=0.0, spec=0.25)
    M["steel"] = painted("steel", (122, 130, 140), rough=0.5, metal=0.35, wear=(200, 208, 204), rust=(110, 96, 78),
                         scale=6, dirt=0.15, rust_at=0.7)
    M["vane"] = painted("vane", (150, 154, 144), rough=0.62, metal=0.2, wear=(188, 192, 182), rust=(98, 86, 66), scale=3,
                        dirt=0.1, spec=0.3, rust_at=0.66)
    M["stump"] = lambda axis="Z": wood("stump", (98, 66, 42), (58, 38, 24), axis, rings=5, dirt=0.4)
    M["table"] = lambda axis="X": wood("table", (128, 88, 58), (88, 58, 38), axis, rings=5, dirt=0.3)
    M["stumptop"] = painted("stumptop", (150, 112, 78), rough=0.85, wear=(120, 86, 58), scale=4, dirt=0.0)
    M["plate"] = painted("plate", (236, 160, 102), rough=0.75, wear=(214, 134, 84), rust=(150, 92, 56), scale=3,
                         dirt=0.35, soot=0.35, rust_at=0.66)
    M["pencil"] = painted("pencil", (214, 196, 28), rough=0.55, wear=(238, 226, 96), rust=(150, 128, 18), scale=4,
                          dirt=0.4, spec=0.35, rust_at=0.7)
    M["pencilwood"] = painted("pencilwood", (226, 186, 132), rough=0.8, wear=(200, 160, 110), scale=5, dirt=0.2)
    M["lead"] = painted("lead", (46, 46, 50), rough=0.45, metal=0.2, wear=(80, 80, 86), scale=5, dirt=0.0)
    M["eraser"] = painted("eraser", (214, 118, 196), rough=0.75, wear=(238, 162, 222), scale=4, dirt=0.0)
    M["ring"] = lambda axis="Z": wood("ring", (140, 106, 74), (98, 72, 48), axis, rings=5, dirt=0.35)
    M["iron"] = painted("iron", (60, 52, 48), rough=0.6, metal=0.3, wear=(98, 88, 80), rust=(92, 54, 26), scale=4,
                        dirt=0.2, spec=0.3, rust_at=0.64)
    return M


M = materials()


def R(seed):
    """A random stream for one part: the same at every level, whatever else the level adds."""
    return random.Random(seed)


def sweep(name, pts, side, w, h, mat, parent=None, bevel=0.08, taper=None):
    """A bar of w x h cross-section along world points pts; `side` is the bar's width direction (kept square to the
    path). taper(s) scales the section along the path (s 0..1)."""
    bm = bmesh.new()
    side = Vector(side).normalized()
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        t = (Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        nrm = t.cross(side).normalized()
        sd = nrm.cross(t).normalized()
        k = taper(i / (n - 1)) if taper else 1.0
        a, b = sd * (w / 2 * k), nrm * (h / 2 * k)
        rows.append([bm.verts.new(p + a + b), bm.verts.new(p - a + b), bm.verts.new(p - a - b), bm.verts.new(p + a - b)])
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(4):
            bm.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], bevel=bevel, segs=3, parent=parent)


def ring(name, r, wire, mat, parent=None, z=0.0, n=48):
    return tube(name, [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)],
                wire, mat, parent=parent, verts=12, cyclic=True)



def U(bearing):
    a = math.radians(bearing)
    return Vector((math.cos(a), math.sin(a), 0.0))


def P(bearing, d, z):
    return U(bearing) * d + Vector((0, 0, z))


def to_mesh(name, src, mat, parent=None):
    """An evaluated object (a metaball) as a plain mesh object; the source is removed."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(src.evaluated_get(dg))
    bpy.data.objects.remove(src)
    me.materials.clear()
    me.materials.append(mat)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    link(ob, parent)
    return ob


def meta(name, balls, mat, res=0.06, thresh=0.6):
    """Soft goo: metaball elements (co, radius[, (sx, sy, sz)]) melted together, as a mesh."""
    mb = bpy.data.metaballs.new(name + "-mb")
    mb.resolution = mb.render_resolution = res
    mb.threshold = thresh
    for b in balls:
        e = mb.elements.new(type="ELLIPSOID" if len(b) > 2 else "BALL")
        e.co = b[0]
        e.radius = b[1]
        if len(b) > 2:
            e.size_x, e.size_y, e.size_z = b[2]
        if len(b) > 3:
            e.rotation = b[3]
        e.stiffness = 2.0
    ob = bpy.data.objects.new(name + "-mbo", mb)
    link(ob)
    return to_mesh(name, ob, mat)


def along(name, axis_from, axis_to, r, depth, at, mat, **kw):
    """A cylinder from `at` along the world direction `axis_to` (unit)."""
    ob = cyl(name, r, depth, (0, 0, 0), mat, **kw)
    ob.rotation_euler = Vector(axis_to).to_track_quat("Z", "Y").to_euler()
    ob.location = at
    return ob


# ------------------------------------------------------------------------------------------------------------ the vat
VAT_PROF = [(0.0, 0.0), (1.48, 0.0), (1.6, 0.04), (1.67, 0.13), (S.VAT_R, 0.3), (S.VAT_R, 2.95), (1.74, 3.02),
            (1.79, 3.1), (1.79, 3.18), (1.74, 3.22), (1.62, 3.2), (1.56, 3.1), (0.0, 3.1)]


def vat():
    z0 = S.VAT_Z0
    lathe("vat", VAT_PROF, (0, 0, z0), M["vat"], verts=48)
    ring("hoop0", S.VAT_R + 0.01, 0.07, M["hoop"], z=z0 + 0.34, n=64)
    rr = R(11)
    for k in range(6):                      # upright seams with rivets, as the plates of a riveted tank
        b = 15 + 60 * k
        box(f"hoopseam{k}", (0.08, 0.04, 2.55), P(b, S.VAT_R + 0.0, z0 + 0.45), M["seam"], rot=(0, 0, b + 90),
            bevel=0.015)
        for j in range(5):
            z = z0 + 0.6 + j * 0.5 + rr.uniform(-0.02, 0.02)
            ob = cyl(f"hooprivet{k}-{j}", 0.04, 0.05, P(b, S.VAT_R + 0.015, z), M["seam"], verts=8, bevel=0.015)
            ob.rotation_euler = U(b).to_track_quat("Z", "Y").to_euler()
    # the plate it stands on, and four short dark stumps under it
    cyl("plate", S.TABLE_R, S.TABLE_T, (0, 0, z0 - S.TABLE_T), M["table"]("X"), verts=40, bevel=0.05)
    rr = R(12)
    for k, b in enumerate((-45, 45, 135, -135) if L < 3 else ()):     # level 3 up the frame's lower ring holds it
        c = P(b + rr.uniform(-6, 6), S.STUMP_D, 0.0)
        h = z0 - S.TABLE_T
        cyl(f"stump{k}", S.STUMP_R * rr.uniform(0.95, 1.08), h + 0.02, (c.x, c.y, -0.02), M["stump"]("Z"), verts=14,
            r2=S.STUMP_R * 0.9, bevel=0.03)


# ------------------------------------------------------------------------------------------------------------ the neck
FUNNEL_PROF = [(S.NECK_R - 0.02, 0.0), (0.37, 0.14), (0.47, 0.33), (0.66, 0.53), (0.88, 0.7), (S.FUNNEL_R - 0.03, 0.79),
               (S.FUNNEL_R, 0.86), (S.FUNNEL_R - 0.03, 0.93), (0.86, 0.98), (0.55, 1.01), (0.0, 1.02)]


def neck(z_from):
    cyl("neck", S.NECK_R, S.FUNNEL_Z0 - z_from + 0.05, (0, 0, z_from), M["neck"], verts=24, bevel=0.0)
    lathe("collar", [(S.NECK_R - 0.02, -0.17), (S.COLLAR_R - 0.04, -0.17), (S.COLLAR_R, -0.12), (S.COLLAR_R, 0.12),
                     (S.COLLAR_R - 0.04, 0.17), (S.NECK_R - 0.02, 0.17)], (0, 0, S.COLLAR_Z), M["steel"], verts=32)
    for k in range(8):
        a = 2 * math.pi * k / 8
        cyl(f"collarbolt{k}", 0.05, 0.05, (S.COLLAR_R * math.cos(a), S.COLLAR_R * math.sin(a), S.COLLAR_Z - 0.025),
            M["steel"], rot=(0, 90, math.degrees(a)), verts=8, bevel=0.01)
    lathe("funnel", FUNNEL_PROF, (0, 0, S.FUNNEL_Z0), M["slate"], verts=48)


# ------------------------------------------------------------------------------------------------------------ the goo
def sheet(balls, rr, b, ln, wd, fingers=3, z_top=None, r=None):
    """A broad sheet of goo running down the vat's side from the rim at bearing b: a few fingers side by side that
    merge at the top, each ending in a drop at its own length (a ragged lower edge)."""
    z_top = S.VAT_Z1 - 0.05 if z_top is None else z_top
    r = S.VAT_R + 0.02 if r is None else r
    span = math.degrees(wd / r)
    for i in range(fingers):
        bb = b + (span * (i / (fingers - 1) - 0.5) if fingers > 1 else 0.0)
        lf = ln * (rr.uniform(0.7, 1.0) if i != fingers // 2 else 1.0)
        m = max(2, int(lf / 0.12))
        for j in range(m + 1):
            f = j / m
            t, rad = U(bb + 90), U(bb)
            q = Matrix((t, rad, Vector((0, 0, 1)))).transposed().to_quaternion()
            w = (span / fingers / 57.3 * r * 1.15 + 0.12) * (1.0 - 0.3 * f)
            balls.append((P(bb, r + 0.1, z_top - lf * f), 0.34, (w / 0.34 * 1.5, 0.62, 0.8), q))
        balls.append((P(bb, r + 0.1, z_top - lf - 0.04), 0.24))


def goo_l1():
    """Level 1: a lumpy lip of goo on the rim, goo heaped lower inside round the neck (dark where the lip shades it),
    slopping over the rim in broad sheets with ragged ends, and spilt on the table."""
    rr = R(21)
    z1 = S.VAT_Z1
    balls = []
    n = 40
    for k in range(n):                                     # the crown: a lumpy lip on the rim, heaped at the front
        b = 360.0 * k / n
        front = math.cos(math.radians(b + 45))
        balls.append((P(b + rr.uniform(-3, 3), S.VAT_R - 0.12 + rr.uniform(-0.05, 0.05),
                        z1 + 0.02 + rr.uniform(-0.08, 0.08)), 0.36 + 0.05 * (1 - front) + rr.uniform(-0.06, 0.06)))
    for k in range(34):                                    # smaller lumps on it, so it is never a smooth tube
        b = rr.uniform(0, 360)
        front = math.cos(math.radians(b + 45))
        balls.append((P(b, S.VAT_R - 0.1 + rr.uniform(-0.12, 0.12), z1 + 0.1 + rr.uniform(-0.08, 0.08)),
                      rr.uniform(0.18, 0.26)))
    for k in range(36):                                    # inside: lumps heaped lower, a mound round the neck
        a, d = rr.uniform(0, 360), 1.5 * math.sqrt(rr.random())
        balls.append((P(a, d, z1 - 0.12 + 0.12 * (1 - d / 1.35) + rr.uniform(-0.05, 0.05)), rr.uniform(0.3, 0.42)))
    # the broad sheet hangs front right, ending well above the foot (as Flash), so the copper shows at the right
    for b, ln, wd, nf in ((-12, 1.9, 1.45, 5), (-125, 1.3, 0.7, 3), (-155, 0.9, 0.5, 2), (45, 0.8, 0.45, 2)):
        sheet(balls, rr, b, ln, wd, nf, r=S.VAT_R - 0.08)
    # spilt on the table at the left, and over its front edge
    balls.append((P(-128, S.VAT_R + 0.12, S.VAT_Z0 + 0.02), 0.4, (1.6, 1.0, 0.4)))
    balls.append((P(-150, S.TABLE_R - 0.05, S.VAT_Z0 - 0.02), 0.32, (1.2, 1.0, 0.45)))
    balls.append((P(-62, S.VAT_R + 0.1, S.VAT_Z0 + 0.02), 0.4, (1.4, 1.0, 0.4)))
    for j in range(5):
        balls.append((P(-58, S.TABLE_R + 0.02, S.VAT_Z0 - 0.08 - 0.14 * j), 0.24 - 0.02 * j))
    goo = meta("goo", balls, M["goo"], res=0.04)
    # the pool inside the crown, low and dark round the neck
    meta("goopool", [((0, 0, z1 - 0.12), 2.3, (1.0, 1.0, 0.16))], M["goodark"], res=0.05)
    return goo


DOME_PROF = [(2.0, 4.86), (2.16, 5.1), (2.14, 5.42), (1.94, 5.75), (1.56, 6.04), (1.05, 6.25), (0.6, 6.42),
             (0.42, 6.52)]


def goo_dome():
    """Level 3 up: the goo heaped into a dome of fat bulbs over the vat, resting on the top ring, up to the collar."""
    rr = R(31)
    balls = [((0, 0, 5.25), 2.5, (1.0, 1.0, 0.45)), ((0, 0, 5.75), 1.9, (1.0, 1.0, 0.5))]
    # lumps of many sizes scattered over the dome (no rows, so it never reads as a ribbed pumpkin): a few big ones and
    # many small, each pushed out to the dome's skin
    prof = DOME_PROF
    for k in range(150):
        t = rr.random() ** 0.8
        f = t * (len(prof) - 2)
        i = int(f)
        r = prof[i][0] + (prof[i + 1][0] - prof[i][0]) * (f - i)
        z = prof[i][1] + (prof[i + 1][1] - prof[i][1]) * (f - i)
        rad = rr.choice((0.3, 0.34, 0.38, 0.42, 0.5, 0.58))
        q = P(rr.uniform(0, 360), r - rad * 0.55 + rr.uniform(-0.06, 0.06), z + rr.uniform(-0.08, 0.08))
        if min((q.xy - P(pb, S.POST_R, 0).xy).length for pb in S.POST_BEARINGS) - 0.7 * rad < 0.32:
            continue                                        # keep clear of the post tops
        balls.append((q, rad))
    return meta("goodome", balls, M["goodome"], res=0.04)


def dome_hit(org, d, trees_):
    best = None
    for t in trees_:
        h = t.ray_cast(org, d)
        if h[0] is not None and (best is None or h[3] < best):
            best = h[3]
    return best


def straps_and_vanes(dome):
    """Silver straps from the collar down over the dome to each post top; two grey vanes on rods out of the collar."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    me = dome.data
    t = BVHTree.FromPolygons([dome.matrix_world @ v.co for v in me.vertices], [p.vertices[:] for p in me.polygons])
    vo = bpy.data.objects["vat"]                    # where the goo leaves the vat's lip bare, the strap rides over it
    tv = BVHTree.FromPolygons([vo.matrix_world @ v.co for v in vo.data.vertices], [p.vertices[:] for p in vo.data.polygons])
    c = Vector((0, 0, 4.9))
    paths = {}
    for k, b in enumerate(S.POST_BEARINGS):
        u = U(b)
        pts = []
        for i in range(0, 41):
            phi = math.radians(8 + 84 * i / 40)
            d = (u * math.sin(phi) + Vector((0, 0, math.cos(phi)))).normalized()
            hit = dome_hit(c + d * 6, -d, [t, tv])
            if hit is not None:
                pts.append((phi, 6 - hit + 0.04))
        # never dip into a hollow between bulbs: a smooth band over the tops
        out = []
        for i, (phi, dist) in enumerate(pts):
            dd = max(p[1] for p in pts[max(0, i - 3):i + 4])
            d = (u * math.sin(phi) + Vector((0, 0, math.cos(phi)))).normalized()
            out.append(c + d * dd)
        top = Vector((0, 0, S.COLLAR_Z)) + u * (S.COLLAR_R - 0.02)
        foot = P(b, S.POST_R - 0.02, S.POST_TOP + 0.08)
        path = [top] + [p for p in out if (p - c).dot(u) > 0.5 and p.z > S.POST_TOP + 0.12] + [foot]
        path = [p for i, p in enumerate(path) if i == 0 or (p - path[i - 1]).length > 0.06]
        sweep(f"strap{k}", path, U(b + 90), 0.11, 0.045, M["steel"], bevel=0.012)
        paths[b] = path
    # the vanes: flat grey blades on rods out of the collar between the straps, square to the camera at the right and
    # the left as Flash's; none at the front, and none at the back (where the level 6 and 10 loops stand). As Flash's:
    # the left one short and nearly level, the right one longer and drooping to the right. Each clear of the straps
    # and the goo under its whole width, and narrow enough to pass the level 6 loop's outer leg
    strap_pts = [p for path in paths.values() for p in path]
    for k, (b, r1, droop) in enumerate(((45.0, 2.3, 0.8), (-135.0, 1.75, 0.25))):
        u, w = U(b), U(b + 90)
        r0, hw = 0.62, 0.25

        def floor(r):
            zs = [p.z + 0.035 for p in strap_pts if abs(p.dot(u) - r) < 0.1 and abs(p.dot(w)) < hw + 0.09 and p.dot(u) > 0]
            for s in (-hw, 0.0, hw):
                o = u * r + w * s + Vector((0, 0, 9))
                h = dome_hit(o, Vector((0, 0, -1)), [t])
                if h is not None:
                    zs.append(9 - h + 0.01)
            return max(zs) if zs else 4.8
        rs = [r0 + (r1 - r0) * i / 12 for i in range(13)]
        fl = [floor(r) for r in rs]
        z_in, z_out = 0.0, -droop
        lift = max(f - (z_in + (z_out - z_in) * i / 12) for i, f in enumerate(fl))
        z_in, z_out = z_in + lift + 0.07, z_out + lift + 0.07       # half the blade, and a gap over the lumps
        a, e = P(b, r0, z_in), P(b, r1, z_out)
        tilt = math.degrees(math.atan2(z_in - z_out, r1 - r0))
        box(f"vane{k}", ((e - a).length, 2 * hw, 0.06), (a + e) / 2, M["vane"], rot=(0, tilt, b), bevel=0.02,
            origin="centre")
        tube(f"vanerod{k}", [P(b, S.NECK_R - 0.05, z_in + 0.02), P(b, r0 + 0.08, z_in + 0.02)], 0.05, M["steel"])
        print("PROBE vane %d at %.0f: z %.2f .. %.2f" % (k, b, z_in, z_out))


# ------------------------------------------------------------------------------------------------------------ the frame
def frame():
    """Six yellow pencil posts round the vat, two rings of planks between them, the peach side plate, brackets to the
    vat."""
    rr = R(41)
    corners = [P(b, S.POST_R, 0) for b in S.POST_BEARINGS]
    for k, (b, c) in enumerate(zip(S.POST_BEARINGS, corners)):
        cyl(f"post{k}", S.POST_RAD, S.POST_TOP - 0.5, (c.x, c.y, 0.5), M["pencil"], verts=6, bevel=0.012,
            rot=(0, 0, rr.uniform(0, 60)))
        cyl(f"postwood{k}", 0.1, 0.3, (c.x, c.y, 0.2), M["pencilwood"], verts=6, r2=S.POST_RAD * 0.97, bevel=0.0)
        cyl(f"postlead{k}", 0.01, 0.2, (c.x, c.y, 0.0), M["lead"], verts=8, r2=0.1, bevel=0.0)
        cyl(f"postferrule{k}", S.POST_RAD + 0.02, 0.18, (c.x, c.y, S.POST_TOP - 0.02), M["steel"], verts=16,
            bevel=0.02)
        lathe(f"posteraser{k}", [(0.0, 0.0), (S.POST_RAD + 0.03, 0.0), (S.POST_RAD + 0.04, 0.16),
                                 (S.POST_RAD - 0.02, 0.27), (0.0, 0.3)], (c.x, c.y, S.POST_TOP + 0.15), M["eraser"],
              verts=16)
    for lvl, (za, zb) in enumerate((S.RING_LO, S.RING_HI)):
        for k in range(6):
            b0, b1 = S.POST_BEARINGS[k], S.POST_BEARINGS[(k + 1) % 6]
            mid = (b0 + b1) / 2 if b1 > b0 else (b0 + b1 + 360) / 2
            ap = S.POST_R * math.cos(math.radians(30)) - S.RING_IN
            half = ap * math.tan(math.radians(30)) + 0.06
            box(f"ring{lvl}-{k}", (2 * half, 0.15, zb - za), P(mid, ap, za), M["ring"]("X"), rot=(0, 0, mid + 90),
                bevel=0.03, jitter=0.01)
    # the peach plate on the left, between the rings
    b0, b1 = S.POST_BEARINGS[4], S.POST_BEARINGS[5]
    mid = (b0 + b1) / 2
    ap = S.POST_R * math.cos(math.radians(30)) - S.RING_IN
    half = ap * math.tan(math.radians(30)) - 0.2
    box("plateside", (2 * half, 0.07, S.RING_HI[0] - S.RING_LO[1] + 0.06), P(mid, ap + 0.02, S.RING_LO[1] - 0.03),
        M["plate"], rot=(0, 0, mid + 90), bevel=0.02)
    # iron brackets from the top ring to the vat's upper hoop, between the posts
    for k in range(6):
        b = S.POST_BEARINGS[k] + 30
        z = S.VAT_Z0 + 2.78
        ap = S.POST_R * math.cos(math.radians(30)) - S.RING_IN - 0.08
        box(f"bracket{k}", (ap - S.VAT_R + 0.04, 0.12, 0.1), P(b, (ap + S.VAT_R) / 2, z), M["iron"], rot=(0, 0, b),
            origin="centre", bevel=0.02)
        box(f"bracketup{k}", (0.12, 0.12, S.RING_HI[0] - z + 0.1), P(b, ap - 0.02, z - 0.04), M["iron"],
            rot=(0, 0, b), bevel=0.02)


def frame_l6():
    """Level 6: steel clamps on every post at the rings and between them, iron feet over the pencil tips."""
    for k, b in enumerate(S.POST_BEARINGS):
        c = P(b, S.POST_R, 0)
        for j, z in enumerate((S.RING_LO[0] + 0.2, (S.RING_LO[1] + S.RING_HI[0]) / 2, S.RING_HI[0] + 0.22)):
            lathe(f"clamp{k}-{j}", [(S.POST_RAD - 0.02, -0.12), (S.POST_RAD + 0.06, -0.12), (S.POST_RAD + 0.08, -0.08),
                                   (S.POST_RAD + 0.08, 0.08), (S.POST_RAD + 0.06, 0.12), (S.POST_RAD - 0.02, 0.12)],
                  (c.x, c.y, z), M["steel"], verts=16)
        lathe(f"foot{k}", [(0.0, 0.0), (0.22, 0.0), (0.27, 0.06), (0.27, 0.22), (0.23, 0.36), (S.POST_RAD - 0.02, 0.5),
                           (0.0, 0.5)], (c.x, c.y, 0.0), M["iron"], verts=16)


# ------------------------------------------------------------------------------------------------------------ the pumps
BEND = 0.9


def pump_path(key):
    """The pump pipe's centre line from its foot in the ground, up, round the bend and in through the vat's wall, with
    the arc length of each point. Returns (points, lengths, s_wall)."""
    b, zj, d = S.PUMPS[key]
    u = U(b)
    pts = []
    zb = zj - BEND
    n1 = max(4, int(zb / 0.05))
    for i in range(n1 + 1):
        pts.append(u * d + Vector((0, 0, zb * i / n1)))
    c = u * (d - BEND) + Vector((0, 0, zb))
    for i in range(1, 25):
        a = (math.pi / 2) * i / 24
        pts.append(c + u * (BEND * math.cos(a)) + Vector((0, 0, BEND * math.sin(a))))
    x0, x1 = d - BEND, S.VAT_R - 0.35
    n3 = max(3, int((x0 - x1) / 0.05))
    for i in range(1, n3 + 1):
        pts.append(u * (x0 + (x1 - x0) * i / n3) + Vector((0, 0, zj)))
    ls = [0.0]
    for a, b2 in zip(pts, pts[1:]):
        ls.append(ls[-1] + (b2 - a).length)
    s_wall = ls[-1] - 0.35
    return pts, ls, s_wall


def smooth_bump(x, w):
    return math.exp(-(x / w) ** 2)


def pump_radius(s, s_wall, c, amp):
    r = S.PIPE_R
    # bands: a fat ring at the foot, joints up the pipe, a ring before the bend and one at the wall
    for sj, k in ((0.1, 0.13), (1.05, 0.09), (s_wall - 1.45, 0.09), (s_wall - 0.25, 0.1)):
        r *= 1.0 + k * smooth_bump(s - sj, 0.06)
    if amp:
        r *= 1.0 + amp * smooth_bump(s - c, 0.42)
    return r


def pump_mesh(key, c, amp, me=None):
    pts, ls, s_wall = pump_path(key)
    b = S.PUMPS[key][0]
    w = Vector((0, 0, 1)).cross(U(b)).normalized()
    bm = bmesh.new()
    nv = 24
    rows = []
    for i, (p, s) in enumerate(zip(pts, ls)):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = w.cross(t).normalized()
        r = pump_radius(s, s_wall, c, amp)
        row = []
        for j in range(nv):
            a = 2 * math.pi * j / nv
            v = p + (n * math.cos(a) + w * math.sin(a)) * r
            if i == 0:
                v.z = 0.0
            row.append(bm.verts.new(v))
        rows.append(row)
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(nv):
            bm.faces.new((r0[j], r0[(j + 1) % nv], r1[(j + 1) % nv], r1[j]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if me is None:
        me = bpy.data.meshes.new(key)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    return me, s_wall


def pump_state(frame, s_wall):
    """Flash's pump: a glob swells the pipe's foot (frames 1-5), climbs the pipe and round the bend (5-20) and is gone
    into the vat (20-24); then the pipe rests. Returns (centre arc length, amplitude factor 0..1)."""
    f = frame % FRAMES
    end = s_wall - 0.7
    if f == 0 or f >= 24:
        return -2.0, 0.0
    if f <= 5:
        x = f / 5.0
        return -0.45 + 0.65 * x, 0.35 + 0.65 * x
    if f <= 20:
        x = (f - 5) / 15.0
        x = x * x * (3 - 2 * x)
        return 0.2 + (end - 0.2) * x, 1.0
    x = (f - 20) / 4.0
    return end + 0.45 * x, 1.0 - x


PUMP_AMP = 0.24 if L < 3 else 0.6


def pumps():
    for key in S.pumps(L):
        me, s_wall = pump_mesh(key, -2.0, 0.0)
        mat = M["pipe"]
        me.materials.append(mat)
        ob = bpy.data.objects.new(key, me)
        link(ob)
        MOVING.append(ob)
        PUMP_WALL[key] = s_wall
        b, zj, d = S.PUMPS[key]
        # the flange on the vat's wall the pipe comes out of
        along(f"flange{key}", None, U(b), S.PIPE_R + 0.17, 0.16, P(b, S.VAT_R - 0.04, zj), M["hoop"], verts=28,
              bevel=0.03)
        for k in range(8):
            a = 2 * math.pi * (k + 0.5) / 8
            w = Vector((0, 0, 1)).cross(U(b)).normalized()
            q = P(b, S.VAT_R + 0.12, zj) + (w * math.cos(a) + Vector((0, 0, math.sin(a)))) * (S.PIPE_R + 0.09)
            along(f"flangebolt{key}{k}", None, U(b), 0.045, 0.06, q, M["steel"], verts=8, bevel=0.01)


PUMP_WALL = {}


# ------------------------------------------------------------------------------------------------------------ the loops
def fillet(pts, rad, n=8):
    """The polyline pts with each inner corner rounded off to radius rad (a pipe's bends)."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        u, v = (a - b).normalized(), (c - b).normalized()
        ang = u.angle(v)
        if ang > math.pi - 1e-3:
            out.append(b)
            continue
        t = min(rad / math.tan(ang / 2), (a - b).length * 0.5, (c - b).length * 0.5)
        p0, p1 = b + u * t, b + v * t
        for i in range(n + 1):
            s = i / n
            out.append(p0 * (1 - s) ** 2 + b * (2 * s * (1 - s)) + p1 * (s * s))
    out.append(pts[-1])
    return out


def pipe(name, pts, r, mat=None, bend=0.35):
    return tube(name, fillet(pts, bend), r, mat or M["pipe"], verts=16)


def lerp(a, b, f):
    return Vector(a) + (Vector(b) - Vector(a)) * f


LOOP_R_IN, LOOP_R_OUT, LOOP_R_TOP = P(72, 1.42, 0), P(60, 2.1, 0), 7.62


def loops_l6():
    """Level 6: the return loop at the back right (up out of the dome beside the funnel, over and down into the dome's
    right shoulder) and the side loop at the left (out of the vat through the peach plate, up, in to the dome's
    shoulder)."""
    r = S.LOOP_R
    zt = Vector((0, 0, LOOP_R_TOP))
    pipe("loopR", [LOOP_R_IN + Vector((0, 0, 5.85)), LOOP_R_IN + zt, LOOP_R_OUT + zt,
                   LOOP_R_OUT + Vector((0, 0, 5.6))], r, bend=0.4)
    b = -128.0
    pipe("loopL", [P(b, S.VAT_R - 0.2, 3.1), P(b, 2.55, 3.1), P(b, 2.55, 6.05), P(b, 1.9, 6.05), P(b, 1.9, 5.4)], r,
         bend=0.4)
    along("loopLflange", None, U(b), r + 0.12, 0.14, P(b, S.VAT_R - 0.03, 3.1), M["hoop"], verts=20, bevel=0.03)
    ap = (S.POST_R * math.cos(math.radians(30)) - S.RING_IN + 0.02) / math.cos(math.radians(b + 123))
    along("loopLcollar", None, U(b), r + 0.09, 0.2, P(b, ap - 0.1, 3.1), M["hoop"], verts=20, bevel=0.03)


def loops_l10():
    """Level 10: the tower at the back left with its goo cap, its branch into the dome and its arc round the left to
    the ground; two more loops stepping up behind the level 6 loop, each standing on the one below; the right side
    pipe out of the dome, down to the ground and in to the vat; the low pipe across the front."""
    r = 0.34
    b = 180.0
    base = P(b, 3.05, 0.0)
    cyl("towerfoot", r + 0.14, 0.2, base, M["hoop"], verts=24, bevel=0.03)
    cyl("tower", r, 8.6, base, M["pipedark"], verts=24, bevel=0.02)
    for j, z in enumerate((1.4, 3.9, 6.4)):
        cyl(f"towerband{j}", r + 0.06, 0.16, base + Vector((0, 0, z)), M["hoop"], verts=24, bevel=0.03)
    top = base + Vector((0, 0, 8.6))
    lathe("towercap", [(0.0, 0.0), (r + 0.1, 0.0), (r + 0.12, 0.12), (r + 0.06, 0.2), (0.0, 0.2)], top, M["hoop"],
          verts=24)
    meta("towergoo", [(top + Vector((0, 0, 0.22)), 0.5, (1.0, 1.0, 0.45))] +
         [(top + U(a) * 0.3 + Vector((0, 0, 0.16)), 0.22) for a in range(0, 360, 60)], M["goo"], res=0.04)
    # its branch into the dome, over the top ring between the back posts
    pipe("towerpipe", [P(b, 2.9, 5.1), P(174, 2.4, 5.1), P(162, 1.9, 5.1)], 0.2, bend=0.5)
    # the arc from the tower's top round the far left to the ground at the front left
    pts = [P(-178, 3.1, 8.0), P(-165, 3.45, 8.0), P(-148, 3.55, 6.6), P(-133, 3.4, 3.8), P(-120, 3.25, 1.4),
           P(-113, 3.18, 0.0)]
    tube("towerarc", pts, 0.2, M["pipe"], verts=14, smooth=True)
    cyl("towerarcfoot", 0.32, 0.16, P(-113, 3.18, 0.0), M["hoop"], verts=20, bevel=0.03)
    # Flash's short pipe low at the left: out of the arc, in behind the front left post through the peach plate (with
    # a collar there, as the level 6 loop) to the vat's foot
    a, e = P(-125.5, 3.3, 2.45), P(-108, S.VAT_R - 0.1, 2.65)
    pipe("towerleg", [a, e], 0.16)
    along("towerlegflange", None, U(-108), 0.27, 0.12, P(-108, S.VAT_R - 0.03, 2.65), M["hoop"], verts=20, bevel=0.03)
    n = U(-123.0)                                   # the plate's outward normal (between posts 4 and 5)
    ap = S.POST_R * math.cos(math.radians(30)) - S.RING_IN + 0.02
    t = (a.dot(n) - ap) / (a.dot(n) - e.dot(n))
    dr = (e - a).normalized()
    along("towerlegcollar", None, dr, 0.25, 0.2, a.lerp(e, t) - dr * 0.1, M["hoop"], verts=20, bevel=0.03)
    # two loops stepping up behind the level 6 loop: each rises out of the dome behind the funnel and comes down onto
    # the top of the loop below it
    zt = Vector((0, 0, LOOP_R_TOP))
    q1 = lerp(LOOP_R_IN, LOOP_R_OUT, 0.65)
    in1, z1 = P(103, 1.4, 0), 8.1
    pipe("loopB0", [in1 + Vector((0, 0, 5.8)), in1 + Vector((0, 0, z1)), q1 + Vector((0, 0, z1)), q1 + zt], 0.22,
         bend=0.3)
    q2 = lerp(in1, q1, 0.6)
    in2, z2 = P(125, 1.38, 0), 8.95
    pipe("loopB1", [in2 + Vector((0, 0, 5.85)), in2 + Vector((0, 0, z2)), q2 + Vector((0, 0, z2)), q2 + Vector((0, 0, z1))],
         0.22, bend=0.3)
    # the right side pipe: out of the dome's right side, out past the posts, down to the ground; a branch in to the vat
    b = 52.0
    pipe("loopS", [P(b, 1.95, 5.1), P(b, 3.0, 5.1), P(b, 3.0, 0.0)], 0.22, bend=0.4)
    pipe("loopSin", [P(b, 3.0, 3.0), P(b, S.VAT_R - 0.2, 3.0)], 0.2)
    along("loopSflange", None, U(b), 0.32, 0.14, P(b, S.VAT_R - 0.03, 3.0), M["hoop"], verts=20, bevel=0.03)
    cyl("loopSfoot", 0.34, 0.16, P(b, 3.0, 0.0), M["hoop"], verts=20, bevel=0.03)
    # the low pipe across the front: out of the side pipe near the ground, under the frame, down into the ground
    a, e = P(b, 3.0, 0.35), Vector((-0.39, -1.24, 0.35))
    pipe("loopF", [a, e, e - Vector((0, 0, 0.35))], 0.16, bend=0.25)
    cyl("loopFfoot", 0.26, 0.14, e - Vector((0, 0, 0.35)), M["hoop"], verts=20, bevel=0.03)


# ------------------------------------------------------------------------------------------------------------ build
def build():
    vat()
    pumps()
    if L < 3:
        goo_l1()
        neck(S.VAT_Z1)
    else:
        dome = goo_dome()
        neck(5.6)
        frame()
        straps_and_vanes(dome)
    if L >= 6:
        frame_l6()
        loops_l6()
    if L >= 10:
        loops_l10()


def turn(frame):
    for ob in MOVING:
        c, a = pump_state(frame, PUMP_WALL[ob.name])
        pump_mesh(ob.name, c, PUMP_AMP * a, ob.data)

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
    # the ground: a shadow catcher
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, GROUND))
    g = bpy.context.active_object
    g.name = "ground"
    g.is_shadow_catcher = True
    return cam


def cam_fwd():
    el, az = math.radians(EL), math.radians(-45)
    return -Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def all_static():
    return [o for o in SC.objects if o.type in ("MESH", "CURVE") and not under_moving(o) and o.name != "ground"]



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


FAMILY = (("pump", "pump"), ("flange", "flange"), ("vat", "vat"), ("hoop", "vat"), ("plate", "plate"),
          ("stump", "stump"), ("goodome", "goo"), ("goo", "goo"), ("neck", "neck"), ("collar", "collar"),
          ("funnel", "funnel"), ("strap", "strap"), ("vanerod", "vane"), ("vane", "vane"), ("postwood", "post"),
          ("postlead", "post"), ("postferrule", "post"), ("posteraser", "post"), ("post", "post"), ("ring", "ring"),
          ("bracket", "bracket"), ("clamp", "clamp"), ("foot", "foot"), ("loopRfoot", "loopR"), ("loopR", "loopR"),
          ("loopL", "loopL"), ("loopB", "loopR"), ("loopS", "loopS"), ("loopF", "loopS"),
          ("tower", "tower"))
MASONRY = ()


def under_moving(o):
    while o is not None:
        if o in MOVING:
            return True
        o = o.parent
    return False


def main():
    build()
    setup(SC)
    out = HERE / ("work" if MODE == "fit" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    moving_objs = [o for o in SC.objects if under_moving(o)]
    turn(0)
    if MODE == "check":
        # which parts touch or pass through others (evaluated meshes, BVH overlap), at three points of the pump's
        # stroke; and how close each moving part comes to anything else
        for k in (0, 4, 9, 14, 19, 22):
            turn(k)
            tr = trees()
            obs = list(tr.values())
            hits = {}
            for i, (a, ta, _) in enumerate(obs):
                for b, tb, _ in obs[i + 1:]:
                    fa, fb = family(a), family(b)
                    if fa == fb or (k and not (under_moving(a) or under_moving(b))):   # still pairs: frame 0 only
                        continue
                    n = len(ta.overlap(tb))
                    if n:
                        hits.setdefault(tuple(sorted((fa, fb))), []).append((a.name, b.name, n))
            for key, v in sorted(hits.items()):
                print("CHECK f%02d" % k, key, sum(x[2] for x in v), v[:3])
            for o in moving_objs:
                best = (9.0, "")
                _, t, vs = tr[o.name]
                for o2, t2, _ in obs:
                    if under_moving(o2) or o2.name.startswith("flange" + o.name):
                        continue
                    for v in vs[::3]:
                        hit = t2.find_nearest(v, best[0])
                        if hit[0] is not None and hit[3] < best[0]:
                            best = (hit[3], o2.name)
                print("CLEAR f%02d %s nearest other part %.3f (%s)" % (k, o.name, best[0], best[1]))
        print("DONE check")
        return
    if MODE == "gap":
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        fwd = cam_fwd()
        step = 0.25
        pairs = {}
        for k in ([0, 4, 9, 14, 19] if os.environ.get("GAP_FRAMES") else [0]):
            turn(k)
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
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
    if MODE == "probe":
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
        sc.cycles.samples = 24
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        fr = int(os.environ.get("FIT_FRAME", 0))
        turn(fr)
        sc.render.filepath = str(out / (f"fit-L{L}.png" if not fr else f"fit-L{L}-f{fr:02d}.png"))
        bpy.ops.render.render(write_still=True)
        return
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE in ("still", "base"):
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 384))
        for o in moving_objs:
            o.visible_camera = False
        sc.render.filepath = str(out / f"L{L}-base.png")
        bpy.ops.render.render(write_still=True)
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
        bpy.data.objects["ground"].hide_render = True
        bpy.context.view_layer.update()
        boxes = []
        for k in range(FRAMES):
            turn(k)
            bpy.context.view_layer.update()
            boxes.append(border_of(moving_objs, pad=30))
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
