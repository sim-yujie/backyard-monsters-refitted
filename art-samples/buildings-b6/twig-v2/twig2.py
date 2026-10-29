"""twig2.py : the Twig Snapper (Flash building 1) as a 3D model, second try (owner, 30 Oct 2026: the first looked nothing
like Flash). Built from scratch against the Flash pictures in the game's own pixel frame (fref.py), not on bldg3d.py.

    blender -b --factory-startup -P twig2.py -- <level> fit            work/fit-L<level>.png   quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P twig2.py -- <level> still          render/L<level>-base.png + -parts-00.png
    blender -b --factory-startup -P twig2.py -- <level> anim [frames]  render/L<level>-parts-NN.png, one per Flash frame

Camera: orthographic, 30 degrees down, from bearing 45 (the towers' and the yard's 2:1 ground). One world unit is 10 Flash
pixels across the screen, so a Flash pixel (sx, sy) and a world point line up through px() / at(). The world origin (the
ground middle) sits on Flash pixel ORIGIN. +X runs down-right on screen (the left face looks -Y), +Y runs up-right (the
right face looks +X).

No outline pass: the look is Flash's own, soft light on worn wood, rust and paint (Cycles, fixed seed).
Animation, as Flash: the saw and the small gear turn (and the side wheel at levels 6 and 10), nothing else. Stillness is
built in: the base picture (every still part, the moving parts hidden from the camera but still casting shadow) is
rendered once; each frame renders only the moving parts with every still part as a holdout, and post.py lays that layer
over the base. Pixels outside the moving parts cannot change.
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
FRAMES = int(ARGS[2]) if MODE == "anim" and len(ARGS) > 2 else 34

EL = 30.0
ORIGIN = (2.5, 39.0)                  # Flash pixel of the world origin (the building's middle, GROUND under the ground)
GROUND = 0.35                         # the ground's height (fitted: Flash's feet stand 3 px above the first guess)
FRAME = (-44, -64, 52, 60)            # the canvas in Flash px (as fref.FRAME)
K = {"fit": 4}.get(MODE, int(os.environ.get("TW_K", 12)))      # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1000 + L)


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

    def grime(self, col, low=0.0, high=1.4, amount=0.35):
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
        aor.inputs[3].default_value, aor.inputs[4].default_value = 0.55, 1.0
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


def painted(name, col, rough=0.6, metal=0.0, wear=None, rust=None, scale=6.0, dirt=0.3, spec=0.4):
    """Paint or metal with worn patches (`wear` colour shows through) and rust blotches."""
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
        mask = t.ramp(n2, [(0.6, (0, 0, 0, 1)), (0.75, (0.7, 0.7, 0.7, 1))])
        out = t.mix(out, srgb(*rust), mask)
    out = t.grime(out, GROUND, 2.6, dirt)
    t.set(**{"Base Color": out, "rough": rough, "metal": metal, "spec": spec})
    t.bump(t.noise(v, scale * 3, 4.0, 0.6), 0.06, 0.01)
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


def saw_face():
    """The saw disc's painted face: purple with a white swirl (four curved white blades), as the Flash cell."""
    if "sawface" in MATS:
        return MATS["sawface"]
    t = NT("sawface")
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Object"], sep.inputs[0])
    # polar coords in the disc's own XY: angle + a swirl that grows with radius
    ang = t.n("ShaderNodeMath", operation="ARCTAN2")
    t.link(sep.outputs["Y"], ang.inputs[0])
    t.link(sep.outputs["X"], ang.inputs[1])
    ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
    cmb = t.n("ShaderNodeCombineXYZ")
    t.link(sep.outputs["X"], cmb.inputs[0])
    t.link(sep.outputs["Y"], cmb.inputs[1])
    t.link(cmb.outputs[0], ln.inputs[0])
    sw = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")      # angle + 2.6 * r
    t.link(ln.outputs["Value"], sw.inputs[0])
    sw.inputs[1].default_value = 2.6
    t.link(ang.outputs[0], sw.inputs[2])
    blades = t.n("ShaderNodeMath", operation="SINE")
    m4 = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(sw.outputs[0], m4.inputs[0])
    m4.inputs[1].default_value = 3.0
    t.link(m4.outputs[0], blades.inputs[0])
    half = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")
    t.link(blades.outputs[0], half.inputs[0])
    half.inputs[1].default_value = 0.5
    half.inputs[2].default_value = 0.5
    white = t.ramp(half.outputs[0], [(0.12, (0, 0, 0, 1)), (0.3, (1, 1, 1, 1))])
    # only in the band between the hub and the purple rim
    band = t.ramp(ln.outputs["Value"], [(0.0, (0, 0, 0, 1)), (0.22, (0, 0, 0, 1)), (0.25, (1, 1, 1, 1)),
                                        (0.6, (1, 1, 1, 1)), (0.64, (0, 0, 0, 1)), (1.0, (0, 0, 0, 1))])
    mm = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(white, mm.inputs[0])
    t.link(band, mm.inputs[1])
    mm = mm.outputs[0]
    col = t.mix(srgb(132, 52, 150), srgb(236, 232, 238), mm)
    # a darker purple ring line just inside the rim
    ring = t.ramp(ln.outputs["Value"], [(0.0, (0, 0, 0, 1)), (0.77, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1)),
                                        (0.84, (1, 1, 1, 1)), (0.87, (0, 0, 0, 1))])
    col = t.mix(col, srgb(96, 30, 112), ring)
    nz = t.noise(t.coords(), 9.0, 4.0, 0.6)
    scuff = t.ramp(nz, [(0.6, (0, 0, 0, 1)), (0.75, (0.45, 0.45, 0.45, 1))])
    col = t.mix(col, srgb(90, 60, 70), scuff)
    t.set(**{"Base Color": col, "rough": 0.42, "spec": 0.5})
    MATS["sawface"] = t.m
    return t.m


def bark(name, light, dark):
    """Bark shingles: ragged rows across the slope (world height bands), streaky noise down it."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords(scale=(1, 1, 1))
    geo = t.n("ShaderNodeNewGeometry")
    w = t.n("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z", wave_profile="SAW")
    w.inputs["Scale"].default_value = 1.6
    w.inputs["Distortion"].default_value = 2.5
    w.inputs["Detail"].default_value = 4.0
    t.link(geo.outputs["Position"], w.inputs["Vector"])
    streak = t.n("ShaderNodeTexNoise")
    streak.inputs["Scale"].default_value = 7.0
    streak.inputs["Detail"].default_value = 6.0
    t.link(v, streak.inputs["Vector"])
    rows = t.ramp(w.outputs["Fac"], [(0.0, srgb(*[c * 0.8 for c in light])), (0.3, srgb(*light)),
                                     (1.0, srgb(*[c * 1.08 for c in light]))])
    st = t.ramp(streak.outputs["Fac"], [(0.3, srgb(*[c * 0.7 for c in light])), (0.7, srgb(*[c * 1.25 for c in light]))])
    col = t.mix(rows, st, 0.45, "MULTIPLY")
    col = t.mix(col, rows, 0.4)
    t.set(**{"Base Color": col, "rough": 0.9, "spec": 0.2})
    h = t.n("ShaderNodeMath", operation="ADD")
    t.link(w.outputs["Fac"], h.inputs[0])
    t.link(streak.outputs["Fac"], h.inputs[1])
    t.bump(h.outputs[0], 0.2, 0.03)
    MATS[name] = t.m
    return t.m


def materials():
    M = {}
    M["wood"] = lambda axis="Z": wood("wood", (218, 150, 90), (160, 100, 56), axis, dirt=0.45)
    M["wood2"] = lambda axis="Z": wood("wood2", (200, 134, 78), (140, 86, 46), axis, rings=8)
    M["dwood"] = lambda axis="Z": wood("dwood", (110, 72, 46), (66, 40, 26), axis, rings=7, dirt=0.25)
    M["post"] = lambda axis="Z": wood("post", (220, 160, 100), (160, 104, 60), axis, rings=5, dirt=0.4)
    M["twig"] = lambda axis="Z": wood("twig", (232, 168, 108), (176, 110, 64), axis, rings=10, knots=False, dirt=0.1)
    M["roof"] = bark("roof", (88, 64, 60), (56, 40, 40))
    M["roofplank"] = lambda axis="X": wood("roofplank", (122, 92, 98), (78, 56, 64), axis, rings=9, dirt=0.1)
    M["iron"] = painted("iron", (58, 62, 72), rough=0.45, metal=0.85, wear=(150, 156, 170), rust=(120, 70, 40), scale=7)
    M["steel"] = painted("steel", (150, 160, 178), rough=0.3, metal=0.9, wear=(210, 216, 228), rust=(130, 84, 50), scale=8)
    M["horn"] = painted("horn", (58, 66, 80), rough=0.3, metal=0.9, wear=(96, 108, 126), scale=6, dirt=0.05)
    M["green"] = painted("green", (84, 98, 58), rough=0.6, metal=0.3, wear=(120, 130, 80), rust=(110, 74, 40), scale=6)
    M["dgreen"] = painted("dgreen", (40, 52, 32), rough=0.6, metal=0.3, wear=(70, 84, 50), scale=6)
    M["gold"] = painted("gold", (226, 186, 70), rough=0.32, metal=0.95, wear=(160, 120, 40), scale=9, dirt=0.15)
    M["olive"] = painted("olive", (150, 140, 50), rough=0.4, metal=0.8, wear=(90, 80, 30), scale=9, dirt=0.15)
    M["black"] = painted("black", (30, 30, 34), rough=0.35, metal=0.4, wear=(80, 84, 92), scale=8, dirt=0.05)
    M["lump"] = painted("lump", (26, 26, 30), rough=0.5, wear=(70, 72, 80), scale=12, dirt=0.0)
    M["hole"] = flat("hole", (8, 6, 6), rough=1.0)
    M["saw"] = saw_face()
    M["teeth"] = painted("teeth", (196, 200, 214), rough=0.25, metal=0.95, wear=(240, 240, 250), scale=10, dirt=0.0)
    M["hub"] = painted("hub", (96, 58, 28), rough=0.5, metal=0.4, wear=(150, 100, 50), scale=10, dirt=0.0)
    M["bolt"] = painted("bolt", (120, 150, 170), rough=0.3, metal=0.9, scale=10, dirt=0.0)
    M["bronze"] = painted("bronze", (128, 84, 16), rough=0.4, metal=0.75, wear=(190, 140, 50), rust=(86, 54, 20), scale=7)
    M["copper"] = painted("copper", (176, 100, 56), rough=0.4, metal=0.85, wear=(220, 150, 100), scale=8)
    M["chute"] = painted("chute", (214, 228, 244), rough=0.45, metal=0.15, wear=(176, 192, 210), scale=4, dirt=0.15)
    M["blade"] = painted("blade", (150, 170, 120), rough=0.3, metal=0.8, wear=(210, 220, 200), scale=6, dirt=0.05)
    M["rope"] = painted("rope", (34, 30, 30), rough=0.9, wear=(70, 60, 54), scale=20, dirt=0.0)
    return M


# ------------------------------------------------------------------------------------------------------------ meshes
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


def box(name, size, at, mat, rot=(0, 0, 0), bevel=0.05, parent=None, jitter=0.0, taper=1.0, origin="bottom"):
    """A box `size` (x, y, z) standing on `at` (origin="bottom") or centred on it, turned by rot (degrees, XYZ)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
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


def tube(name, pts, r, mat, parent=None, verts=12, r_end=None):
    """A round stick through world points pts (a curve with a round bevel)."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (q[0], q[1], q[2], 1)
    if r_end is not None:
        for i, p in enumerate(sp.points):
            p.radius = 1 + (r_end / r - 1) * i / max(1, len(pts) - 1)
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(mat)
    link(ob, parent)
    return ob


def plank_wall(name, p0, p1, z0, z1, mat_fn, n, thick=0.12, gap=0.025, out=None, jit=0.02):
    """A wall of n upright planks from ground point p0 to p1 (world XY), heights z0..z1, facing `out` (a unit XY)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    ang = math.degrees(math.atan2(d.y, d.x))
    w = length / n
    obs = []
    for i in range(n):
        c = p0 + d * ((i + 0.5) / n)
        if out is not None:
            c += Vector(out) * (-thick / 2 + rng.uniform(-jit, jit))
        top = z1 + rng.uniform(-0.04, 0.04)
        obs.append(box(f"{name}{i}", (w - gap, thick, top - z0), (c.x, c.y, z0), mat_fn("Z"),
                       rot=(rng.uniform(-1.2, 1.2), rng.uniform(-1.5, 1.5), ang), bevel=0.03))
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


def saw_teeth(name, r_in, r_out, n, depth, mat):
    """The silver toothed ring round the saw (saw-tooth profile, leaning one way: the way it turns)."""
    bm = bmesh.new()
    outer, inner = [], []
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = 2 * math.pi * (i + 0.75) / n
        outer += [(r_in * 1.02 * math.cos(a0), r_in * 1.02 * math.sin(a0)), (r_out * math.cos(a1), r_out * math.sin(a1))]
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in outer]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=0.012, segs=1)


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
M = materials()


def leg(at, top, r=0.2):
    h = top - GROUND
    lathe("leg", [(r * 1.0, h), (r * 0.92, h * 0.6), (r * 1.0, h * 0.3), (r * 1.25, h * 0.1), (r * 1.3, 0.04),
                  (r * 1.2, 0.0), (0.0, 0.0)], (at[0], at[1], GROUND), M["post"]("Z"), verts=20)


def claw(at, h, face_bearing):
    """Level 10's bird foot: a post, three toes spread toward the viewer and one back."""
    lathe("clawpost", [(0.3, h - GROUND), (0.26, (h - GROUND) * 0.6), (0.3, 0.45), (0.4, 0.25), (0.0, 0.2)],
          (at[0], at[1], GROUND), M["post"]("Z"), verts=20)
    for k, da in enumerate((-55, 0, 55, 180)):
        a = math.radians(face_bearing + da)
        ln = 0.85 if da != 180 else 0.45
        p0 = Vector((at[0], at[1], GROUND + 0.4))
        p1 = p0 + Vector((math.cos(a) * ln * 0.5, math.sin(a) * ln * 0.5, -0.2))
        p2 = p0 + Vector((math.cos(a) * ln, math.sin(a) * ln, -0.38))
        tube("toe", [p0, p1, p2], 0.21, M["post"]("X"), r_end=0.08)


def saw(center):
    """The saw: purple face, silver teeth, brown hub, on an axle into the body. Faces 15 deg from +X toward the viewer."""
    def parts(h):
        d = cyl("sawdisc", 0.88, 0.1, (0, 0, -0.04), M["saw"], verts=48, bevel=0.03, parent=h,
                mats=[M["saw"]])
        t = saw_teeth("sawteeth", 0.84, 1.0, 34, 0.3, M["teeth"])      # a thick silver rim: it shows down the side
        t.parent = h
        t.location = (0, 0, -0.13)
        cyl("sawhub", 0.2, 0.22, (0, 0, -0.04), M["hub"], verts=20, bevel=0.04, parent=h)
        for i in range(4):
            a = 2 * math.pi * i / 4 + 0.4
            cyl("sawbolt", 0.04, 0.06, (0.12 * math.cos(a), 0.12 * math.sin(a), 0.16), M["bolt"], verts=8, bevel=0.01,
                parent=h)
        return d
    e, hub = spinner("saw", center, -28, 10, parts)
    MOVING.append(hub)
    cyl("sawaxle", 0.1, 0.8, center, M["iron"], rot=(0, -90, 28), verts=12, bevel=0.02)
    return hub


def small_gear(center, r=0.33):
    def parts(h):
        gear("sgear", r, 9, 0.1, (0, 0, 0), M["copper"], (0, 0, 0), tooth=0.22, parent=h)
        cyl("sgearhub", r * 0.38, 0.16, (0, 0, -0.02), M["bolt"], verts=14, bevel=0.02, parent=h)
    e, hub = spinner("sgear", center, -10, 4, parts)
    MOVING.append(hub)
    return hub


def side_wheel(center, r=0.76):
    def parts(h):
        lathe("swheel", [(0.0, 0.07), (r * 0.8, 0.05), (r * 0.93, 0.1), (r, 0.06), (r, -0.06), (r * 0.9, -0.08),
                         (0.0, -0.07)], (0, 0, 0), M["bronze"], verts=48, parent=h)
        for i in range(6):                                 # a few dents and nicks round the edge (it turns: they move)
            a = 2 * math.pi * i / 6 + 0.3
            box("swnick", (0.08, 0.05, 0.1), (r * 0.97 * math.cos(a), r * 0.97 * math.sin(a), 0), M["copper"],
                rot=(0, 0, math.degrees(a)), bevel=0.02, parent=h, origin="center")
        cyl("swhub", 0.12, 0.2, (0, 0, -0.04), M["bolt"], verts=14, bevel=0.02, parent=h)
    e, hub = spinner("swheel", center, -38, 18, parts)
    MOVING.append(hub)
    return hub


def funnel(base, top_h, mouth_dir=(-0.75, -0.66), r_pipe=0.2, bell=0.62, bell_len=0.5, up=0.55):
    """The pipe up the body's left corner, ending in a steel horn turned toward the viewer's left."""
    b = Vector(base)
    top = Vector((b.x, b.y, top_h))
    tube("pipe", [b, top - Vector((0, 0, 0.25)), top], r_pipe, M["dgreen"])
    for z in (b.z + 0.4, top_h - 0.45):
        cyl("pipeband", r_pipe * 1.18, 0.08, (b.x, b.y, z), M["iron"], verts=16, bevel=0.015)
    d = Vector((mouth_dir[0], mouth_dir[1], up)).normalized()
    prof = [(r_pipe * 0.95, 0.0), (r_pipe * 1.05, bell_len * 0.35), (r_pipe * 1.5, bell_len * 0.7),
            (bell * 0.8, bell_len * 0.92), (bell, bell_len), (bell * 0.95, bell_len * 1.04), (bell * 0.7, bell_len * 0.98)]
    h = lathe("horn", prof, top, M["horn"], verts=36)
    h.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    so = h.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.03
    cyl("hornneck", r_pipe * 1.1, 0.2, top - Vector((0, 0, 0.1)), M["iron"], verts=16, bevel=0.02)


def tray(center, size, lumps=False, trim="olive", tilt=14.0, out_bearing=-90.0):
    """The front tray (an open wooden box on a curved scoop) the snapped twigs fall into; levels 6-10 hold black lumps."""
    root = bpy.data.objects.new("tray", None)
    link(root)
    root.location = center
    root.rotation_euler = (math.radians(tilt), 0, 0)      # the front edge down: the inside shows
    sx, sy, sz = size
    t = 0.09
    box("traybottom", (sx, sy, t), (0, 0, 0), M["wood2"]("X"), bevel=0.03, parent=root)
    box("trayfront", (sx + 0.04, t, sz), (0, -sy / 2, 0), M["wood"]("X"), bevel=0.03, parent=root)
    box("trayback", (sx, t, sz * 0.9), (0, sy / 2, 0), M["wood2"]("X"), bevel=0.03, parent=root)
    for s in (-1, 1):
        box("trayside", (t, sy, sz), (s * sx / 2, 0, 0), M["wood"]("Y"), bevel=0.03, parent=root)
    # the curved scoop underneath, down to the ground
    bm = bmesh.new()
    rows = []
    for k in range(9):
        a = math.radians(-90 + 90 * k / 8)
        y = -sy / 2 + (sy * 0.9) * (1 + math.cos(a + math.pi / 2)) * 0.5
        z = -0.55 * (1 + math.sin(a))
        rows.append([bm.verts.new((x, y * 0.95, z)) for x in (-sx / 2 + 0.05, sx / 2 - 0.05)])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
    sc = mesh_ob("scoop", bm, [M["wood2"]("X")], parent=root)
    so = sc.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.08
    corner = M["gold"] if trim == "gold" else M["olive"]
    for s in (-1, 1):
        for fy in (-1, 1):
            box("traycorner", (0.14, 0.14, sz + 0.06), (s * (sx / 2), fy * sy / 2, -0.02), corner, bevel=0.03,
                parent=root)
    box("traylip", (sx + 0.1, 0.06, 0.06), (0, -sy / 2 - 0.02, sz), corner, bevel=0.02, parent=root)
    if lumps:
        for i in range(9):
            r = rng.uniform(0.13, 0.2)
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
            for v in bm.verts:
                v.co *= rng.uniform(0.75, 1.15)
                v.co.z *= 0.8
            ob = mesh_ob("lump", bm, [M["lump"]], parent=root)
            ob.location = (rng.uniform(-sx / 2 + 0.25, sx / 2 - 0.25), rng.uniform(-sy / 2 + 0.22, sy / 2 - 0.22),
                           t + r * 0.7)
            ob.rotation_euler = (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3))
    return root


def roller(center, length, r):
    """The black crushing roller (ribbed), axle along X, brass caps."""
    bm = bmesh.new()
    n = 32
    prof = [(r * (1 if i % 4 < 2 else 0.9), 2 * math.pi * i / n) for i in range(n)]
    lo = [bm.verts.new((-length / 2, rr * math.cos(a), rr * math.sin(a))) for rr, a in prof]
    hi = [bm.verts.new((length / 2, rr * math.cos(a), rr * math.sin(a))) for rr, a in prof]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    ob = mesh_ob("roller", bm, [M["black"]], bevel=0.03, segs=2)
    ob.location = center
    for s in (-1, 1):
        cyl("rollercap", r * 0.45, 0.12, (center[0] + s * length / 2, center[1], center[2]), M["gold"],
            rot=(0, 90 * s, 0), verts=16, bevel=0.02)
    return ob


def pagoda_roof(cx, cy, hx, hy, z_eave, z_apex, lift=0.35, sticks=True, cut=None):
    """The pagoda roof: four curved slopes from the apex flaring out to the eaves, the corners turned up, bark shingles;
    light round sticks down the hips and the middle of each side, a black binding at the top with twigs out of it."""
    bm = bmesh.new()
    N, R = 64, 12

    def per(s):
        """Point on the eave rectangle at perimeter parameter s in [0,4), and how close it is to a corner (0..1)."""
        side, f = int(s) % 4, s - int(s)
        c = [(hx, -hy), (hx, hy), (-hx, hy), (-hx, -hy)]
        a, b = Vector(c[side]), Vector(c[(side + 1) % 4])
        p = a.lerp(b, f)
        return p, max(0.0, 1 - min(f, 1 - f) * 2.2) ** 2

    def surf(s, t):
        p, cor = per(s)
        z = z_apex - (z_apex - z_eave) * (1 - (1 - t) ** 1.15) + lift * cor * t ** 5
        return Vector((cx + p.x * t, cy + p.y * t, z))

    rows = []
    for j in range(R + 1):
        t = j / R
        rows.append([bm.verts.new(surf(4 * i / N, max(t, 0.02))) for i in range(N)])
    for a, b in zip(rows, rows[1:]):
        for i in range(N):
            k = (i + 1) % N
            bm.faces.new((a[i], a[k], b[k], b[i]))
    ob = mesh_ob("roof", bm, [M["roof"]])
    so = ob.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.1
    so.offset = -1
    # shingle rows: slightly darker strips across each slope give the bark look
    for j in (0.45, 0.68, 0.88):
        pts = [surf(4 * i / N, j) + Vector((0, 0, 0.03)) for i in range(N + 1)]
        tube("shingle", pts, 0.035, M["roof"])
    if sticks:
        for s in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 3.5):
            pts = [surf(s, t) + Vector((0, 0, 0.06)) for t in [i / 10 for i in range(11)]]
            ext = pts[-1] + (pts[-1] - pts[-2]) * 2.0
            tube("roofstick", pts + [ext], 0.09, M["twig"]("X"), r_end=0.06)
        knot_z = z_apex - 0.15
        cyl("knot", 0.44, 0.6, (cx, cy, knot_z - 0.3), M["rope"], r2=0.26, verts=20, bevel=0.08)
        for k in range(6):
            a = 2 * math.pi * k / 6 + 0.3
            lean = 0.28 + 0.1 * (k % 2)
            p0 = Vector((cx, cy, knot_z + 0.2))
            p1 = p0 + Vector((math.cos(a) * lean, math.sin(a) * lean, 0.85 + 0.15 * (k % 3)))
            tube("tuft", [p0, p1], 0.05, M["twig"]("Z"), r_end=0.025)
    return surf


def body(z0, z1, hx, hy, arch=True):
    """The pagoda body: corner posts, plank walls, a beam round the top and bottom, an arched opening in the left face."""
    corners = [(hx, -hy), (hx, hy), (-hx, hy), (-hx, -hy)]
    for x, y in corners:
        box("cornerpost", (0.3, 0.3, z1 - z0 + 0.1), (x, y, z0 - 0.05), M["post"]("Z"), bevel=0.06)
    # left face (looks -Y): planks from the left corner to the front corner
    plank_wall("lwall", (-hx, -hy), (hx, -hy), z0, z1, M["wood"], 4, out=(0, -1))
    # right face (looks +X)
    plank_wall("rwall", (hx, -hy), (hx, hy), z0, z1, M["wood"], 6, out=(1, 0))
    plank_wall("bwall", (hx, hy), (-hx, hy), z0, z1, M["wood2"], 9, out=(0, 1))
    plank_wall("bwall2", (-hx, hy), (-hx, -hy), z0, z1, M["wood2"], 6, out=(-1, 0))
    for z in (z0, z1 - 0.22):
        box("beamL", (2 * hx + 0.1, 0.22, 0.24), (0, -hy - 0.02, z), M["post"]("X"), bevel=0.05)
        box("beamR", (0.22, 2 * hy + 0.1, 0.24), (hx + 0.02, 0, z), M["post"]("Y"), bevel=0.05)
    box("floor", (2 * hx, 2 * hy, 0.2), (0, 0, z0 - 0.1), M["dwood"]("X"), bevel=0.03)
    box("ceiling", (2 * hx, 2 * hy, 0.2), (0, 0, z1 - 0.1), M["dwood"]("X"), bevel=0.03)


def arch_hole(cx, z_bot, z_top, w, y_face):
    """A dark arched opening in the left face, framed by a bent stick."""
    bm = bmesh.new()
    r = w / 2
    zc = z_top - r
    pts = [(cx - r, z_bot), (cx + r, z_bot)] + [(cx + r * math.cos(math.pi * i / 16), zc + r * math.sin(math.pi * i / 16))
                                                 for i in range(17)]
    vs = [bm.verts.new((x, y_face - 0.005, z)) for x, z in pts]
    bm.faces.new(vs)
    mesh_ob("hole", bm, [M["hole"]], smooth=False)
    frame = [(cx - r, y_face - 0.04, z_bot)] + [
        (cx - r * math.cos(math.pi * i / 16), y_face - 0.04, zc + r * math.sin(math.pi * i / 16)) for i in range(17)] + [
        (cx + r, y_face - 0.04, z_bot)]
    tube("archframe", frame, 0.07, M["dwood"]("Z"))


def band(hx, hy, z, h=0.5):
    """The olive metal strap round the right face, with rivets."""
    box("band", (0.08, 2 * hy + 0.06, h), (hx + 0.06, 0, z), M["green"], bevel=0.02)
    for i in range(6):
        y = -hy + (i + 0.5) * 2 * hy / 6
        for dz in (0.12, h - 0.12):
            cyl("rivet", 0.04, 0.05, (hx + 0.1, y, z + dz), M["iron"], rot=(0, 90, 0), verts=8, bevel=0.01)


def chute(at, size, twigs=False, lean=0.0):
    """The white sheet-metal hopper behind the roof (levels 6, 10), dark green side, twigs out of the top at 10."""
    sx, sy, sz = size
    root = bpy.data.objects.new("chuteroot", None)
    link(root)
    root.location = at
    root.rotation_euler = (math.radians(-lean), math.radians(lean * 0.5), 0)   # the top leans to the right
    box("chute", (sx, sy, sz), (0, 0, 0), M["chute"], bevel=0.04, parent=root)
    box("chuteside", (0.04, sy * 0.96, sz * 0.98), (sx / 2 + 0.01, 0, 0), M["dgreen"], bevel=0.015, parent=root)
    box("chutecap", (sx + 0.1, sy + 0.1, 0.1), (0, 0, sz), M["iron"], bevel=0.03, parent=root)
    at = (0, 0, 0)
    if twigs:
        for k in range(7):
            p0 = Vector((rng.uniform(-sx / 3, sx / 3), rng.uniform(-sy / 3, sy / 3), sz - 0.3))
            p1 = p0 + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.2, 0.5), rng.uniform(0.7, 1.2)))
            tube("chutetwig", [p0, p1], 0.05, M["twig"]("Z"), r_end=0.03).parent = root


def gate(x0, x1, y, z0, z1):
    """Level 10's guillotine on the roof: two posts, a top bar with a slot, a green panel and a steel blade."""
    for x in (x0, x1):
        box("gatepost", (0.42, 0.36, z1 - z0), (x, y, z0), M["wood2"]("Z"), bevel=0.07)
    box("gatetop", (x1 - x0 + 0.55, 0.46, 0.6), (0.5 * (x0 + x1), y, z1 - 0.1), M["wood2"]("X"), bevel=0.09)
    box("gateslot", (0.6, 0.44, 0.12), (0.5 * (x0 + x1) + 0.1, y, z1 + 0.2), M["hole"], bevel=0.0)
    box("gatepanel", (x1 - x0 - 0.3, 0.08, (z1 - z0) * 0.45), (0.5 * (x0 + x1), y + 0.05, z1 - (z1 - z0) * 0.5),
        M["green"], bevel=0.02)
    bl = box("gateblade", (x1 - x0 - 0.3, 0.05, 0.5), (0.5 * (x0 + x1), y - 0.03, z1 - (z1 - z0) * 0.62), M["blade"],
             rot=(0, 12, 0), bevel=0.01, origin="center")
    del bl


def level_pagoda():
    hx, hy = 1.13, 2.05
    z0, z1 = 1.25, 5.45
    body(z0, z1, hx, hy)
    # legs: front, left, right corners and one under the middle of the right face
    lh = z0 + 0.1
    if L < 10:
        for x, y in ((hx, -hy), (-hx, -hy), (hx, hy), (hx, 0.35)):
            leg((x, y), lh, 0.4)
    else:
        for x, y, b in ((hx, -hy, -45), (-hx, -hy, -100), (hx, hy, 10), (hx, 0.2, -10)):
            claw((x, y), lh, b)
    arch_hole(0.0, 1.7, 5.05, 1.25, -hy - 0.03)
    roller(px(-14.5, 18, Y=-hy - 0.55), 1.6, 0.5)
    tr = tray(px(-23.5, 28 if L >= 6 else 30, Y=-hy - 0.85) - Vector((0, 0, 0.25)), (1.6, 1.35, 0.5), lumps=L >= 6,
              trim="gold" if L >= 6 else "olive", tilt=30 if L >= 6 else 14)
    tr.rotation_euler.y = math.radians(12)
    leg(px(-18, 43, Z=GROUND).to_2d(), 1.6, 0.3)
    band(hx, hy, 3.9, 0.5)
    saw(px(12 if L >= 6 else 11, 25 if L >= 6 else 26, X=hx + 0.62))
    small_gear(px(16, 10 if L >= 6 else 12, X=hx + 0.12))
    funnel(Vector((-1.1, -hy - 0.25, 3.0)), 6.7 if L >= 6 else 6.5, mouth_dir=(-0.75, -0.66), r_pipe=0.27, bell=0.5,
           bell_len=1.3, up=0.1)
    if L >= 6:
        side_wheel(px(26, 11, X=hx + 0.6))
        if L == 6:
            chute((0.45, 2.0, 4.6), (0.85, 0.7, 2.75), lean=16)
        else:
            chute((0.1, 1.45, 5.6), (0.8, 0.65, 3.6), twigs=True, lean=14)
    if L < 10:
        pagoda_roof(0, 0.0, 1.3, 2.3, 5.35, 7.7, lift=0.45)
    else:
        roof10(hx, hy, z1, -0.6)
        g0, g1 = px(-12.5, -10, Y=-0.6).x, px(4, -10, Y=-0.6).x
        gate(g0, g1, -0.6, z1 - 0.2, 9.3)


def roof10(hx, hy, z1, yg):
    """Level 10's roof: a front sheet rising from the front eave to the guillotine (along X at Y = yg), and a back sheet
    starting low behind it and sweeping up toward the back, as the Flash picture's swoop."""
    bm = bmesh.new()
    NX, NY = 16, 28
    x0, x1, y0, y1 = -hx - 0.85, hx + 0.3, -hy - 0.4, hy + 0.35
    rows = []
    for i in range(NX + 1):
        x = x0 + (x1 - x0) * i / NX
        row = []
        for j in range(NY + 1):
            y = y0 + (y1 - y0) * j / NY
            if y < yg:
                u = (y - y0) / (yg - y0)
                z = z1 + 0.1 + 1.05 * (1 - (1 - u) ** 1.6)
            else:
                u = (y - yg) / (y1 - yg)
                z = z1 + 0.6 + 1.1 * u ** 2.2
            z += 0.3 * ((x - x0) / (x1 - x0) - 0.5) ** 2 * 4 * (0.4 if y < yg else 1.0)
            row.append(bm.verts.new((x, y, z)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for j in range(NY):
            bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    ob = mesh_ob("roof10", bm, [M["roof"]])
    so = ob.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.1
    so.offset = -1
    tube("roofstick", [(x0 - 0.15, y0 - 0.02, z1 + 0.18), (x1 + 0.1, y0 - 0.02, z1 + 0.3)], 0.07, M["twig"]("X"))
    for x in (x0 + 0.3, 0.0, x1 - 0.3):
        pts = []
        for j in range(NY + 1):
            y = y0 + (y1 - y0) * j / NY
            if y < yg - 0.25:
                u = (y - y0) / (yg - y0)
                pts.append((x, y, z1 + 0.2 + 1.05 * (1 - (1 - u) ** 1.6)))
        tube("roofstick", pts, 0.06, M["twig"]("Y"))
    pts = [(x1 - 0.05, y, z1 + 0.7 + 1.1 * ((y - yg) / (y1 - yg)) ** 2.2) for y in
           [yg + (y1 - yg) * k / 10 for k in range(11)]]
    tube("roofstick", pts, 0.06, M["twig"]("Y"))


def level1():
    """Level 1: a narrow wooden cabinet on the right, a dark press frame in front of its left face holding the roller,
    the tray at the front, a flat plank roof with loose planks, the horn pipe on the frame's back post."""
    # cabinet: X -1.1..1.0, Y 0.06..1.62, Z 0.3..4.65
    cx0, cx1, cy0, cy1, cz0, cz1 = -1.1, 1.0, 0.06, 1.62, 0.3, 4.4
    box("cab", (cx1 - cx0, cy1 - cy0, cz1 - cz0), ((cx0 + cx1) / 2, (cy0 + cy1) / 2, cz0), M["wood"]("Z"), bevel=0.06)
    plank_wall("cabL", (cx0, cy0), (cx1, cy0), cz0, cz1, M["dwood"], 5, out=(0, -1))
    for x, y in ((cx1, cy0), (cx1, cy1), (cx0, cy0)):
        box("cabpost", (0.18, 0.18, cz1 - cz0 + 0.05), (x, y, cz0 - 0.02), M["post"]("Z"), bevel=0.05)
        cyl("cableg", 0.24, cz0 + 0.05 - GROUND, (x, y, GROUND), M["dwood"]("Z"), verts=12, bevel=0.03)
    box("cabslot", (0.25, 0.04, 1.6), (0.35, cy0 - 0.12, 2.2), M["hole"], bevel=0.0)
    # press frame: plane Y = -1.73, posts at X -0.89 and 1.1
    fy = -1.73
    for x, top in ((-1.0, 4.6), (1.1, 4.3)):
        box("framepost", (0.46, 0.42, top - GROUND), (x, fy, GROUND), M["dwood"]("Z"), bevel=0.08)
    box("framebar", (2.5, 0.46, 0.46), (0.1, fy, 4.15), M["dwood"]("X"), bevel=0.08)
    box("framebar2", (2.2, 0.28, 0.24), (0.1, fy, 1.15), M["dwood"]("X"), bevel=0.05)
    for x in (-0.89, 1.1):                                # side beams back to the cabinet
        box("framejoin", (0.22, cy0 - fy, 0.24), (x, (fy + cy0) / 2, 4.3), M["dwood"]("Y"), bevel=0.04)
    for x in (-0.89, 1.1):
        for z in (1.2, 4.32):
            cyl("framebolt", 0.07, 0.06, (x, fy - 0.16, z), M["olive"], rot=(90, 0, 0), verts=10, bevel=0.015)
    roller(px(-13, 22, Y=-1.35), 1.5, 0.45)
    box("pressback", (0.12, cy0 - fy, 3.7), (-1.0, (fy + cy0) / 2, 0.6), M["dwood"]("Y"), bevel=0.03)
    box("pressfloor", (2.2, cy0 - fy, 0.14), (0.05, (fy + cy0) / 2, 0.75), M["dwood"]("X"), bevel=0.03)
    tray(px(-18, 36, Y=-2.3), (2.5, 1.1, 0.55), lumps=False, trim="olive", tilt=12)
    saw(px(8, 30, X=1.65))
    small_gear(px(14, 17, X=1.05), 0.3)
    top = px(-15, -12, Y=fy).z
    tube("pipe", [Vector((-1.0, fy, 4.5)), Vector((-1.0, fy, top))], 0.3, M["dgreen"])
    cyl("pipeband", 0.35, 0.1, (-1.0, fy, top - 0.5), M["iron"], verts=20, bevel=0.02)
    lathe("cap", [(0.3, 0.0), (0.42, 0.06), (0.78, 0.2), (0.8, 0.27), (0.6, 0.42), (0.3, 0.52), (0.0, 0.55)],
          (-1.0, fy, top - 0.05), M["horn"], verts=36)
    # flat plank roof, sloping a little toward the viewer, planks running along Y; loose light planks across
    rx0, rx1, ry0, ry1 = -1.6, 1.23, -0.17, 1.95
    n = 8
    for i in range(n):
        x = rx0 + (rx1 - rx0) * (i + 0.5) / n
        z = 4.45
        box("roofplank", ((rx1 - rx0) / n - 0.03, ry1 - ry0 + rng.uniform(-0.05, 0.15), 0.1),
            (x, (ry0 + ry1) / 2 + rng.uniform(-0.05, 0.05), z), M["roofplank"]("Y"), rot=(-4, 0, 0), bevel=0.025,
            jitter=0.01)
    for k, (x, y) in enumerate(((-0.75, 0.65), (-0.2, 0.95), (0.35, 1.2))):
        box("looseplank", (0.18, 2.5, 0.07), (x, y, 4.62 + 0.04 * k), M["twig"]("Y"), rot=(-3, 0, -45 + rng.uniform(-5, 5)),
            bevel=0.02)


# ------------------------------------------------------------------------------------------------------------ light, camera
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
    sun_d.energy = 4.2
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
    bg.inputs[1].default_value = 1.15
    # the ground: a shadow catcher
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, GROUND))
    g = bpy.context.active_object
    g.name = "ground"
    g.is_shadow_catcher = True
    return cam


def cam_fwd():
    el, az = math.radians(EL), math.radians(-45)
    return -Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))


def turn(frame):
    """Turn the moving parts to Flash frame `frame` of FRAMES: the saw one full turn clockwise as seen from its face, the
    small gear back the other way twice as fast, the side wheel one turn."""
    f = frame / FRAMES
    for hub in MOVING:
        n = hub.parent.name
        k = {"saw": -1.0, "sgear": 2.0, "swheel": -1.0}[n]
        hub.rotation_euler = (0, 0, 2 * math.pi * k * f)


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


def main():
    if L == 1:
        level1()
    else:
        level_pagoda()
    setup(SC)
    out = HERE / ("work" if MODE == "fit" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    moving_objs = [o for o in SC.objects if under_moving(o)]
    turn(0)
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
        sc.cycles.samples = 24
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        sc.render.filepath = str(out / f"fit-L{L}.png")
        bpy.ops.render.render(write_still=True)
        return
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE in ("still", "base"):
        sc.cycles.samples = int(os.environ.get("TW_SAMPLES", 384))
        for o in moving_objs:
            o.visible_camera = False
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
        sc.cycles.samples = int(os.environ.get("TW_PART_SAMPLES", 256))
        for o in all_static():
            o.is_holdout = True
        for o in moving_objs:
            o.visible_camera = True
        bpy.data.objects["ground"].hide_render = True
        bpy.context.view_layer.update()
        bx = border_of(moving_objs, pad=40)
        sc.render.use_border = True
        sc.render.use_crop_to_border = False
        sc.render.border_min_x, sc.render.border_max_x, sc.render.border_min_y, sc.render.border_max_y = bx
        for k in range(n):
            turn(k)
            bpy.context.view_layer.update()
            sc.render.filepath = str(out / f"L{L}-parts-{k:02d}.png")
            bpy.ops.render.render(write_still=True)
    print("DONE", L, MODE)


main()
