"""twig2.py : the Twig Snapper (Flash building 1) as a 3D model, second try (owner, 30 Oct 2026: the first looked nothing
like Flash). Built from scratch against the Flash pictures in the game's own pixel frame (fref.py), not on bldg3d.py.

    blender -b --factory-startup -P twig2.py -- <level> fit            work/fit-L<level>.png   quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P twig2.py -- <level> still          render/L<level>-base.png + -parts-00.png
    blender -b --factory-startup -P twig2.py -- <level> anim [frames]  render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P twig2.py -- <level> check          prints CHECK lines: parts whose meshes overlap

One machine at every level: the body and every part's mounting point are fixed (see build()); a level is the level below
plus upgrades.

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


def painted(name, col, rough=0.6, metal=0.0, wear=None, rust=None, scale=6.0, dirt=0.3, spec=0.4, soot=0.0):
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
        mask = t.ramp(n2, [(0.6, (0, 0, 0, 1)), (0.75, (0.7, 0.7, 0.7, 1))])
        out = t.mix(out, srgb(*rust), mask)
    rough_in = rough
    if soot:
        v2 = t.coords(scale=(1.0, 1.0, 0.25))                  # stretched upright: streaks run down
        n3 = t.noise(v2, scale * 0.5, 6.0, 0.7, 0.4)
        sm = t.ramp(n3, [(0.38, (0, 0, 0, 1)), (0.62, (soot, soot, soot, 1))])
        out = t.mix(out, srgb(30, 25, 22), sm)
        rr = t.ramp(n3, [(0.38, (rough,) * 3 + (1,)), (0.62, (min(1.0, rough + 0.4),) * 3 + (1,))])
        rough_in = rr
    out = t.grime(out, GROUND, 2.6, dirt)
    t.set(**{"Base Color": out, "rough": rough_in, "metal": metal, "spec": spec})
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
    """The saw disc's painted face as the Flash cell: white, a purple rim band with white flecks, a broad purple bar
    across the middle with a white blotch near one end. Nothing on it is symmetric, so every frame of the turn shows."""
    if "sawface" in MATS:
        return MATS["sawface"]
    t = NT("sawface")
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Object"], sep.inputs[0])
    ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
    cmb = t.n("ShaderNodeCombineXYZ")
    t.link(sep.outputs["X"], cmb.inputs[0])
    t.link(sep.outputs["Y"], cmb.inputs[1])
    t.link(cmb.outputs[0], ln.inputs[0])
    ang = t.n("ShaderNodeMath", operation="ARCTAN2")
    t.link(sep.outputs["Y"], ang.inputs[0])
    t.link(sep.outputs["X"], ang.inputs[1])
    ay = t.n("ShaderNodeMath", operation="ABSOLUTE")
    t.link(sep.outputs["Y"], ay.inputs[0])
    purple, dark, white = srgb(142, 60, 160), srgb(82, 26, 98), srgb(240, 238, 244)
    bar = t.ramp(ay.outputs[0], [(0.0, (1, 1, 1, 1)), (0.22, (1, 1, 1, 1)), (0.25, (0, 0, 0, 1)), (1.0, (0, 0, 0, 1))])
    edge = t.ramp(ay.outputs[0], [(0.0, (0, 0, 0, 1)), (0.21, (0, 0, 0, 1)), (0.235, (1, 1, 1, 1)), (0.26, (0, 0, 0, 1)),
                                  (1.0, (0, 0, 0, 1))])
    rim = t.ramp(ln.outputs["Value"], [(0.0, (0, 0, 0, 1)), (0.7, (0, 0, 0, 1)), (0.72, (1, 1, 1, 1)), (1.0, (1, 1, 1, 1))])
    line = t.ramp(ln.outputs["Value"], [(0.0, (0, 0, 0, 1)), (0.69, (0, 0, 0, 1)), (0.71, (1, 1, 1, 1)),
                                         (0.735, (0, 0, 0, 1)), (1.0, (0, 0, 0, 1))])
    col = t.mix(white, purple, bar)
    col = t.mix(col, dark, edge)
    col = t.mix(col, purple, rim)
    col = t.mix(col, dark, line)
    # white flecks round the rim band: 7 short dashes (sine of the angle), only in the band
    sn = t.n("ShaderNodeMath", operation="SINE")
    m7 = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(ang.outputs[0], m7.inputs[0])
    m7.inputs[1].default_value = 7.0
    t.link(m7.outputs[0], sn.inputs[0])
    dash = t.ramp(sn.outputs[0], [(0.0, (0, 0, 0, 1)), (0.86, (0, 0, 0, 1)), (0.93, (1, 1, 1, 1)), (1.0, (1, 1, 1, 1))])
    band = t.ramp(ln.outputs["Value"], [(0.0, (0, 0, 0, 1)), (0.76, (0, 0, 0, 1)), (0.78, (1, 1, 1, 1)),
                                         (0.83, (1, 1, 1, 1)), (0.85, (0, 0, 0, 1)), (1.0, (0, 0, 0, 1))])
    fm = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(dash, fm.inputs[0])
    t.link(band, fm.inputs[1])
    col = t.mix(col, white, fm.outputs[0])
    # a white blotch on the bar near its +X end (the asymmetric mark that makes the turn read)
    off = t.n("ShaderNodeVectorMath", operation="DISTANCE")
    t.link(cmb.outputs[0], off.inputs[0])
    off.inputs[1].default_value = (0.5, 0.02, 0.0)
    blot = t.ramp(off.outputs["Value"], [(0.0, (1, 1, 1, 1)), (0.12, (1, 1, 1, 1)), (0.15, (0, 0, 0, 1)),
                                          (1.0, (0, 0, 0, 1))])
    col = t.mix(col, white, blot)
    nz = t.noise(t.coords(), 9.0, 4.0, 0.6)
    scuff = t.ramp(nz, [(0.55, (0, 0, 0, 1)), (0.75, (0.5, 0.5, 0.5, 1))])
    col = t.mix(col, srgb(96, 74, 78), scuff)
    t.set(**{"Base Color": col, "rough": 0.5, "spec": 0.45})
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
    M["pwood"] = lambda axis="Z": wood("pwood", (104, 64, 38), (56, 33, 21), axis, rings=7, dirt=0.2)   # L1 press, L10 gate
    M["post"] = lambda axis="Z": wood("post", (220, 160, 100), (160, 104, 60), axis, rings=5, dirt=0.4)
    M["twig"] = lambda axis="Z": wood("twig", (232, 168, 108), (176, 110, 64), axis, rings=10, knots=False, dirt=0.1)
    M["roof"] = bark("roof", (88, 64, 60), (56, 40, 40))
    M["roofplank"] = lambda axis="X": wood("roofplank", (122, 92, 98), (78, 56, 64), axis, rings=9, dirt=0.1)
    M["iron"] = painted("iron", (58, 62, 72), rough=0.45, metal=0.85, wear=(150, 156, 170), rust=(120, 70, 40), scale=7, soot=0.75)
    M["steel"] = painted("steel", (150, 160, 178), rough=0.3, metal=0.9, wear=(210, 216, 228), rust=(130, 84, 50), scale=8, soot=0.6)
    M["horn"] = painted("horn", (128, 138, 154), rough=0.35, metal=0.6, wear=(170, 178, 190), scale=6, dirt=0.05, soot=0.8)
    M["green"] = painted("green", (84, 98, 58), rough=0.6, metal=0.3, wear=(120, 130, 80), rust=(110, 74, 40), scale=6, soot=0.6)
    M["dgreen"] = painted("dgreen", (40, 52, 32), rough=0.6, metal=0.3, wear=(70, 84, 50), scale=6, soot=0.7)
    M["gold"] = painted("gold", (226, 186, 70), rough=0.32, metal=0.95, wear=(160, 120, 40), scale=9, dirt=0.15, soot=0.45)
    M["olive"] = painted("olive", (150, 140, 50), rough=0.4, metal=0.8, wear=(90, 80, 30), scale=9, dirt=0.15, soot=0.5)
    M["black"] = painted("black", (30, 30, 34), rough=0.35, metal=0.4, wear=(80, 84, 92), scale=8, dirt=0.05, soot=0.5)
    M["lump"] = painted("lump", (26, 26, 30), rough=0.5, wear=(70, 72, 80), scale=12, dirt=0.0)
    M["hole"] = flat("hole", (8, 6, 6), rough=1.0)
    M["saw"] = saw_face()
    M["teeth"] = painted("teeth", (196, 200, 214), rough=0.25, metal=0.95, wear=(240, 240, 250), scale=10, dirt=0.0, soot=0.45)
    M["hub"] = painted("hub", (96, 58, 28), rough=0.5, metal=0.4, wear=(150, 100, 50), scale=10, dirt=0.0)
    M["bolt"] = painted("bolt", (120, 150, 170), rough=0.3, metal=0.9, scale=10, dirt=0.0)
    M["bronze"] = painted("bronze", (128, 84, 16), rough=0.4, metal=0.75, wear=(190, 140, 50), rust=(86, 54, 20), scale=7, soot=0.5)
    M["copper"] = painted("copper", (176, 100, 56), rough=0.4, metal=0.85, wear=(220, 150, 100), scale=8)
    M["chute"] = painted("chute", (214, 228, 244), rough=0.45, metal=0.15, wear=(176, 192, 210), scale=4, dirt=0.15, soot=0.55)
    M["blade"] = painted("blade", (150, 170, 120), rough=0.3, metal=0.8, wear=(210, 220, 200), scale=6, dirt=0.05, soot=0.6)
    M["rope2"] = painted("rope2", (200, 166, 112), rough=0.9, wear=(150, 116, 76), scale=30, dirt=0.0)
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


def saw_teeth(name, r_in, r_out, n, depth, mat):
    """The silver blade behind the face, its edge in rounded scallops with sharp notches between (Flash's bottle-cap
    rim): a plate of radius r_out, the notches reaching in to r_in."""
    bm = bmesh.new()
    pts = []
    m = 10
    for i in range(n * m):
        a = 2 * math.pi * i / (n * m)
        r = r_in + (r_out - r_in) * abs(math.cos(n * a / 2)) ** 0.45
        pts.append((r * math.cos(a), r * math.sin(a)))
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=0.02, segs=2)


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


def leg(at, top, r=0.2, splay=(0.0, 0.0)):
    """A round stump leg from the ground up to `top` under `at`; splay moves its foot outward (it leans in to the post)."""
    foot = Vector((at[0] + splay[0], at[1] + splay[1], GROUND))
    d = Vector((at[0], at[1], top)) - foot
    h = d.length
    ob = lathe("leg", [(r * 1.0, h), (r * 0.92, h * 0.6), (r * 1.0, h * 0.3), (r * 1.25, h * 0.1), (r * 1.3, 0.04),
                       (r * 1.2, 0.0), (0.0, 0.0)], foot, M["post"]("Z"), verts=20)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


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


def axis_of(bearing, tilt):
    """The unit axle direction of a spinner (as spinner() builds it): bearing on the ground from +X, tilted up."""
    a, t = math.radians(bearing), math.radians(tilt)
    return Vector((math.cos(a) * math.cos(t), math.sin(a) * math.cos(t), math.sin(t)))


def axle(center, bearing, tilt, length, r=0.08):
    """A short iron axle from a wheel's centre back along its axis into the wall, with a round plate where it meets the
    wall: what holds the wheel on (it stays still; only the wheel turns)."""
    n = axis_of(bearing, tilt)
    q = (-n).to_track_quat("Z", "Y").to_euler()
    ob = cyl("axle", r, length, center, M["iron"], verts=12, bevel=0.02)
    ob.rotation_euler = q
    pl = cyl("axleplate", r * 2.8, 0.06, Vector(center) - n * (length - 0.12), M["iron"], verts=16, bevel=0.02)
    pl.rotation_euler = q
    return ob


def saw(center):
    """The saw: purple face, silver teeth, brown hub, on an axle into the body. Faces 15 deg from +X toward the viewer."""
    def parts(h):
        d = cyl("sawdisc", 0.88, 0.1, (0, 0, -0.04), M["saw"], verts=48, bevel=0.03, parent=h,
                mats=[M["saw"]])
        t = saw_teeth("sawteeth", 0.9, 1.06, 18, 0.26, M["teeth"])     # a thick silver rim: it shows down the side
        t.parent = h
        t.location = (0, 0, -0.13)
        cyl("sawhub", 0.28, 0.22, (0, 0, -0.04), M["hub"], verts=20, bevel=0.04, parent=h)
        box("sawhubmark", (0.2, 0.1, 0.06), (0.16, 0.0, 0.17), M["dwood"]("X"), bevel=0.02, parent=h, origin="center")
        for i in range(4):
            a = 2 * math.pi * i / 4 + 0.4
            cyl("sawbolt", 0.04, 0.06, (0.12 * math.cos(a), 0.12 * math.sin(a), 0.16), M["bolt"], verts=8, bevel=0.01,
                parent=h)
        return d
    e, hub = spinner("saw", center, SAW_AXIS[0], SAW_AXIS[1], parts)   # nearly along the right wall: Flash's ellipse
    MOVING.append(hub)
    return hub


SAW_AXIS, SGEAR_AXIS, WHEEL_AXIS = (-12, 8), (-10, 4), (-14, 6)     # (bearing, tilt) of each spinner's axle


def small_gear(center, r=0.33):
    def parts(h):
        gear("sgear", r, 9, 0.1, (0, 0, 0), M["copper"], (0, 0, 0), tooth=0.22, parent=h)
        cyl("sgearhub", r * 0.38, 0.16, (0, 0, -0.02), M["bolt"], verts=14, bevel=0.02, parent=h)
    e, hub = spinner("sgear", center, SGEAR_AXIS[0], SGEAR_AXIS[1], parts)
    MOVING.append(hub)
    return hub


def side_wheel(center, r=0.68):
    """Levels 6 and 10: the bronze cog on the right wall, as Flash's: fine teeth round a bright rim, a dark brown face,
    a blue-grey hub."""
    def parts(h):
        gear("swheel", r, 30, 0.12, (0, 0, 0), M["bronze"], (0, 0, 0), tooth=0.1, parent=h)
        cyl("swface", r * 0.8, 0.05, (0, 0, 0.04), M["hub"], verts=40, bevel=0.015, parent=h)
        cyl("swhub", 0.13, 0.12, (0, 0, 0.05), M["bolt"], verts=14, bevel=0.02, parent=h)
        for i in range(4):                                 # four rivets on the face (they turn with it)
            a = 2 * math.pi * i / 4 + 0.5
            cyl("swrivet", 0.035, 0.04, (r * 0.55 * math.cos(a), r * 0.55 * math.sin(a), 0.08), M["bronze"], verts=8,
                bevel=0.01, parent=h)
    e, hub = spinner("swheel", center, WHEEL_AXIS[0], WHEEL_AXIS[1], parts)
    MOVING.append(hub)
    return hub


def funnel(base, top_h, mouth_dir=(-0.75, -0.66), r_pipe=0.2, bell=0.62, bell_len=0.5, up=0.55, route=(), cap=False):
    """The pipe up the body's left corner, ending in a steel horn turned toward the viewer's left. route: points the pipe
    comes along before it rises from base (out of the wall, round an elbow); a plate where it leaves the wall. cap: a
    steel dome on the top instead of the horn (level 1, as Flash's)."""
    b = Vector(base)
    top = Vector((b.x, b.y, top_h))
    pts = [Vector(p) for p in route]
    tube("pipe", pts + [b, top - Vector((0, 0, 0.25)), top], r_pipe, M["dgreen"])
    if pts:
        d = (pts[1] - pts[0]).normalized()
        pl = cyl("pipeplate", r_pipe * 1.35, 0.06, pts[0] + d * 0.04, M["iron"], verts=16, bevel=0.02)
        pl.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    for z in (b.z + 0.4, top_h - 0.45):
        cyl("pipeband", r_pipe * 1.18, 0.08, (b.x, b.y, z), M["iron"], verts=16, bevel=0.015)
    if cap:                                    # a mushroom dome over the open pipe end
        c = lathe("cap", [(r_pipe * 0.95, 0.0), (r_pipe * 1.3, 0.08), (0.72, 0.24), (0.76, 0.32), (0.58, 0.48),
                          (0.3, 0.58), (0.0, 0.61)], top - Vector((0, 0, 0.1)), M["horn"], verts=36)
        c.rotation_euler = (math.radians(6), math.radians(-10), 0)      # tipped a little toward the viewer's left
        cyl("hornneck", r_pipe * 1.1, 0.2, top - Vector((0, 0, 0.3)), M["iron"], verts=16, bevel=0.02)
        return
    d = Vector((mouth_dir[0], mouth_dir[1], up)).normalized()
    prof = [(r_pipe * 0.95, 0.0), (r_pipe * 1.05, bell_len * 0.35), (r_pipe * 1.5, bell_len * 0.7),
            (bell * 0.8, bell_len * 0.92), (bell, bell_len), (bell * 0.95, bell_len * 1.04), (bell * 0.7, bell_len * 0.98)]
    h = lathe("horn", prof, top, M["horn"], verts=36)
    h.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    so = h.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.03
    cyl("hornneck", r_pipe * 1.1, 0.2, top - Vector((0, 0, 0.1)), M["iron"], verts=16, bevel=0.02)


def tray(center, size, lumps=False, trim="olive", tilt=14.0, roll=0.0):
    """The front tray the snapped twigs fall into, as Flash draws it: a low open box whose bottom is a deep boat hull
    curving down along its length (a sled runner seen from the side), metal caps on the four top corners, metal bands
    round the hull near each end, a rim along the top; levels 6-10 hold black lumps. Returns the root and back_rim(u):
    the local point on top of the back rim (the body side) at u = 2x/sx, where the hangers take hold."""
    root = bpy.data.objects.new("tray", None)
    link(root)
    root.location = center
    root.rotation_euler = (math.radians(tilt), math.radians(roll), 0)      # the front edge down: the inside shows
    sx, sy, sz = size
    D = sz + 0.6                                         # the hull's depth below the rim in the middle
    corner = M["gold"] if trim == "gold" else M["olive"]

    def section(u):
        """The hull's cross-section (across Y) at u = 2x/sx in [-1, 1]: rim, down the side, round the bottom, up the
        other side. It is shallowest and a little narrower at the ends, where the hull sweeps up."""
        x = u * sx / 2
        w = sy / 2 * (0.86 + 0.14 * (1 - u * u))
        zb = sz - max(0.16, D * (1 - u * u) ** 0.55)
        rc = min(w * 0.75, (sz - zb) * 0.6)
        pts = [(x, -w, sz), (x, -w * 0.98, zb + rc)]
        for k in range(1, 8):
            a = math.pi * k / 8
            pts.append((x, -w * 0.98 * math.cos(a), zb + rc - rc * math.sin(a)))      # the round bottom
        pts += [(x, w * 0.98, zb + rc), (x, w, sz)]
        return [Vector(p) for p in pts]

    us = [-0.985 + 1.97 * k / 24 for k in range(25)]
    secs = [section(u) for u in us]
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in sec] for sec in secs]
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(len(r0) - 1):
            bm.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
    for r in (rows[0], rows[-1]):                        # close the two ends (small: the hull has swept up there)
        bm.faces.new(r)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob("hull", bm, [M["wood2"]("X")], parent=root)
    so = ob.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.08

    def on_hull(u, j, off):
        """A point on section u at profile index j (fractional), pushed off the surface by `off`."""
        sec = section(u)
        j0 = min(int(j), len(sec) - 2)
        p = sec[j0].lerp(sec[j0 + 1], j - j0)
        mid = Vector((p.x, 0, (sec[0].z + min(q.z for q in sec)) / 2))
        n = p - mid
        n.x = 0
        return p + n.normalized() * off
    nsec = len(secs[0]) - 1
    for j in (1.6, 3.2, nsec - 3.2, nsec - 1.6):          # stave seams along the hull
        tube("stave", [on_hull(u, j, 0.025) for u in us[2:-2]], 0.018, M["dwood"]("X"), verts=6, parent=root)
    for u in (-0.72, 0.72):                              # metal bands round the hull near each end
        tube("hoop", [on_hull(u, j, 0.05) for j in [k * nsec / 16 for k in range(17)]], 0.05, corner, verts=8,
             parent=root)
    for fy in (-1, 1):                                   # rims along the top edges, bending down at the ends
        tube("trayrim", [on_hull(u, 0 if fy < 0 else nsec, 0.04) + Vector((0, 0, 0.03)) for u in us], 0.055, corner,
             verts=10, parent=root)
    for ux in (-1, 1):                                   # the corner caps: bent plates over each top corner
        for fy in (-1, 1):
            p = on_hull(ux * 0.93, 0 if fy < 0 else nsec, 0.05)
            box("traycorner", (0.24, 0.12, 0.34), (p.x, p.y, sz - 0.25), corner, bevel=0.04, parent=root)
            cyl("trayrivet", 0.04, 0.04, (p.x, p.y + fy * 0.07, sz - 0.1), M["iron"], rot=(-90 * fy, 0, 0), verts=8,
                bevel=0.01, parent=root)
    if lumps:
        for i in range(10):
            r = rng.uniform(0.13, 0.2)
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
            for v in bm.verts:
                v.co *= rng.uniform(0.75, 1.15)
                v.co.z *= 0.8
            ob = mesh_ob("lump", bm, [M["lump"]], parent=root)
            ob.location = (rng.uniform(-sx / 2 + 0.35, sx / 2 - 0.35), rng.uniform(-sy / 2 + 0.25, sy / 2 - 0.25),
                           sz - 0.2 + rng.uniform(0, 0.12))
            ob.rotation_euler = (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3))
    return root, lambda u: on_hull(u, nsec, 0.04) + Vector((0, 0, 0.03 + 0.055))


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
        z = z_apex - (z_apex - z_eave) * (1 - (1 - t) ** 2.1) + lift * cor * t ** 5      # concave: a pagoda, not a tent
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
        for s in (0.0, 0.5, 1.0, 3.0, 3.5):           # the hips and middles you can see
            pts = [surf(s, t) + Vector((0, 0, 0.06)) for t in [i / 10 for i in range(11)]]
            ext = pts[-1] + (pts[-1] - pts[-2]) * 0.3       # just past the eave, as Flash
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


def body(z0, z1, hx, hy, left=True):
    """The body: corner posts, plank walls, a beam round the top and bottom; the left wall (with its arched mouth,
    arch_hole) from level 3."""
    corners = [(hx, -hy), (hx, hy), (-hx, hy), (-hx, -hy)]
    for x, y in corners:                       # round posts, a little thicker at the foot
        if not left and y < 0:                 # level 1: the open front's two posts are the press frame's (build())
            continue
        cyl("cornerpost", 0.24, z1 - z0 + 0.1, (x, y, z0 - 0.05), M["post"]("Z"), r2=0.2, verts=18, bevel=0.04)
    # left face (looks -Y): planks from the left corner to the front corner; both seen faces belly out softly
    if left:
        plank_wall("lwall", (-hx, -hy), (hx, -hy), z0, z1, M["wood"], 4, out=(0, -1), bulge=0.12)
    # right face (looks +X)
    plank_wall("rwall", (hx, -hy), (hx, hy), z0, z1, M["wood"], 6, out=(1, 0), bulge=0.3)
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


def band(hx, hy, z, h=0.5, out=0.0):
    """The olive metal strap round the right face, with rivets; out(f) = how far the wall bellies out at fraction f
    along it, so the strap lies on the planks."""
    n = 10
    for i in range(n):
        f0, f1 = i / n, (i + 1) / n
        y0, y1 = -hy + 2 * hy * f0, -hy + 2 * hy * f1
        x0, x1 = hx + 0.06 + out(f0), hx + 0.06 + out(f1)
        ang = math.degrees(math.atan2(x1 - x0, y1 - y0))
        box("band", (0.08, math.hypot(x1 - x0, y1 - y0) + 0.03, h), ((x0 + x1) / 2, (y0 + y1) / 2, z), M["green"],
            rot=(0, 0, -ang), bevel=0.02)
    for i in range(6):
        f = (i + 0.5) / 6
        y = -hy + f * 2 * hy
        for dz in (0.12, h - 0.12):
            cyl("rivet", 0.04, 0.05, (hx + 0.1 + out(f), y, z + dz), M["iron"], rot=(0, 90, 0), verts=8, bevel=0.01)


def chute(at, size, twigs=False, lean=0.0, collar=False):
    """The white sheet-metal hopper behind the roof (levels 6, 10), dark green side, twigs out of the top at 10."""
    sx, sy, sz = size
    root = bpy.data.objects.new("chuteroot", None)
    link(root)
    root.location = at
    root.rotation_euler = (math.radians(-lean), math.radians(lean * 0.5), 0)   # the top leans to the right
    box("chute", (sx, sy, sz), (0, 0, 0), M["chute"], bevel=0.04, parent=root)
    box("chuteside", (0.04, sy * 0.96, sz * 0.98), (sx / 2 + 0.01, 0, 0), M["dgreen"], bevel=0.015, parent=root)
    box("chutecap", (sx + 0.1, sy + 0.1, 0.1), (0, 0, sz), M["iron"], bevel=0.03, parent=root)
    if collar:
        box("chutecollar", (sx + 0.22, sy + 0.22, 0.3), (0, 0, -0.05), M["iron"], bevel=0.04, parent=root)
    at = (0, 0, 0)
    if twigs:
        for k in range(7):
            p0 = Vector((rng.uniform(-sx / 3, sx / 3), rng.uniform(-sy / 3, sy / 3), sz - 0.3))
            p1 = p0 + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.2, 0.5), rng.uniform(0.7, 1.2)))
            tube("chutetwig", [p0, p1], 0.05, M["twig"]("Z"), r_end=0.03).parent = root


def gate(x0, x1, y, z0, z1, z0_left=None):
    """Level 10's guillotine on the roof: two posts, a top bar with a slot, a green panel and a steel blade. The left
    post can start lower (z0_left): it stands against the outside of the back-left wall, bolted to it."""
    for x, zb in ((x0, z0 if z0_left is None else z0_left), (x1, z0)):
        box("gatepost", (0.42, 0.36, z1 - zb), (x, y, zb), M["pwood"]("Z"), bevel=0.07)
    box("gatetop", (x1 - x0 + 0.55, 0.46, 0.6), (0.5 * (x0 + x1), y, z1 - 0.1), M["pwood"]("X"), bevel=0.09)
    box("gateslot", (0.6, 0.44, 0.12), (0.5 * (x0 + x1) + 0.1, y, z1 + 0.2), M["hole"], bevel=0.0)
    box("gatepanel", (x1 - x0 - 0.3, 0.08, (z1 - z0) * 0.45), (0.5 * (x0 + x1), y + 0.05, z1 - (z1 - z0) * 0.5),
        M["green"], bevel=0.02)
    bl = box("gateblade", (x1 - x0 - 0.3, 0.05, 0.5), (0.5 * (x0 + x1), y - 0.03, z1 - (z1 - z0) * 0.62), M["blade"],
             rot=(0, 12, 0), bevel=0.01, origin="center")
    del bl


def curl(p0, ang0, ang1, length, n=26, power=3.0):
    """A sheet's side profile in (y, z): from p0 heading ang0 (deg, 0 = +Y, 90 = up), the heading turning to ang1 toward
    the end (power > 1: the turn is kept for the end, so the edge rolls like curled bark)."""
    p, pts = Vector(p0), []
    for k in range(n + 1):
        pts.append(p.copy())
        a = math.radians(ang0 + (ang1 - ang0) * (k / n) ** power)
        p = p + Vector((math.cos(a), math.sin(a))) * length / n
    return pts


def roof10(hx, hy, z1, yg):
    """Level 10's roof: two curled bark sheets meeting at the guillotine (along X at Y = yg), sitting low round it. The
    front one slopes down to the front eave and rolls up a little at its edge; the back one climbs behind the gate and
    rolls over toward the front at its top. A light rope is draped from the gate over the front sheet."""
    x0, x1 = -hx - 0.3, hx + 0.25
    front = curl((yg - 0.05, z1 + 0.85), 206, 170, 2.6)
    back = curl((yg - 0.1, z1 + 0.25), 80, -120, 4.6, power=1.2)    # a roll: up behind the gate, over, down the back
    NX = 16
    for name, prof, dish in (("roofF", front, 0.25), ("roofB", back, 0.4)):
        bm = bmesh.new()
        rows = []
        for i in range(NX + 1):
            x = x0 + (x1 - x0) * i / NX
            u = (2 * (x - x0) / (x1 - x0) - 1) ** 2            # 0 in the middle, 1 at the side edges: they curl up
            rows.append([bm.verts.new((x, y, z + dish * u * (k / len(prof)) ** 0.5)) for k, (y, z) in enumerate(prof)])
        for r0, r1 in zip(rows, rows[1:]):
            for j in range(len(prof) - 1):
                bm.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
        ob = mesh_ob(name, bm, [M["roof"]])
        so = ob.modifiers.new("solid", "SOLIDIFY")
        so.thickness = 0.1
        so.offset = -1
    def lift(x, k, prof, dish):
        """How far the sheet's side edge curls up at x, profile point k (as the mesh above)."""
        return dish * (2 * (x - x0) / (x1 - x0) - 1) ** 2 * (k / len(prof)) ** 0.5
    ye, ze = front[-1]
    tube("roofstick", [(x0 - 0.35, ye + 0.05, ze + 0.02), (x1 + 0.1, ye + 0.05, ze + 0.06)], 0.07, M["twig"]("X"))
    for x in (x0 + 0.35, x1 - 0.3):
        tube("roofstick", [(x, y, z + 0.07 + lift(x, k + 1, front, 0.25)) for k, (y, z) in enumerate(front[1:-2])],
             0.055, M["twig"]("Y"))

    def front_z(y, x):
        for k, ((ya, za), (yb, zb)) in enumerate(zip(front, front[1:])):
            if yb <= y <= ya:
                f = (ya - y) / max(1e-6, ya - yb)
                return za + (zb - za) * f + lift(x, k + f, front, 0.25)
        return front[-1][1] + lift(x, len(front) - 1, front, 0.25)
    # the rope: tied round the right gate post, draped over the front sheet, its end hanging off the front eave
    xa = px(4, -10, Y=yg).x
    A = Vector((xa, yg - 0.25, z1 + 1.9))
    B = Vector((x1 - 0.15, ye - 0.12, ze + 0.17))      # over the eave stick, in front of it
    pts = []
    for k in range(13):
        t = k / 12
        q = A.lerp(B, t)
        q.z = max(q.z - 0.5 * math.sin(math.pi * t), front_z(q.y, q.x) + 0.19)     # over the sticks too
        pts.append(q)
    pts += [B + Vector((0.02, -0.03, -0.3)), B + Vector((0.05, -0.05, -0.65))]
    tube("rope", pts, 0.055, M["rope2"], r_end=0.04)
    pts = []                                             # the second rope lies over the back roll, off its face
    for k in range(2, len(back) - 1):
        (ya, za), (yb, zb) = back[k - 1], back[k + 1]
        d = Vector((yb - ya, zb - za)).normalized()
        y, z = back[k] - Vector((-d.y, d.x)) * 0.11           # off the sheet's top face (right of the heading)
        x = x1 - 0.15 - 0.1 * k / len(back)
        pts.append((x, y, z + lift(x, k, back, 0.4)))
    tube("rope", pts, 0.05, M["rope2"],
         r_end=0.04)
    cyl("ropetie", 0.27, 0.16, (xa, yg, z1 + 1.82), M["rope2"], verts=16, bevel=0.04)


# ------------------------------------------------------------------------------------------------------------ the levels
# One machine at every level (owner, 30 Oct 2026: a level is the level below plus upgrades). The body's footprint, its
# height and every part's mounting point are fixed in world coordinates here, fitted once to Flash level 3; a level
# only adds or swaps parts:
#   L1   (all of it 0.5 lower, on short dark feet) the body with an open press front (no left wall: the roller works in the open frame), a narrow cabinet at the
#        back, a lean-to plank roof
#   L3   = L1 + stump legs that lift the machine, the left wall with its arched mouth, the strap round the right face, the pagoda roof
#   L6   = L3 + the side cog, the chute through the roof, gold trim and lumps in the tray
#   L10  = L6 + bird-claw feet, a taller chute with twigs, the curled bark roof and the gate on it
HX, HY, Z0, Z1 = 1.05, 1.72, 1.25, 5.1          # the body: half width (X), half depth (Y), floor, top
ROLLER = Vector((0.05, -2.67, 3.42))            # the roller's middle, in front of the arch, held by arms to the posts
ROLLER_LEN, ROLLER_R = 1.9, 0.62
TRAY = Vector((-0.1, -2.72, 1.9))               # the tray under the roller's mouth, hung from the front corner posts
TRAY_SIZE, TRAY_TILT, TRAY_ROLL = (2.55, 1.15, 0.45), 22.0, -8.0
SAW = Vector((1.95, -0.67, 2.62))               # the turning parts, each on its own short axle into the right wall
SGEAR = Vector((1.67, 0.24, 3.82))
SWHEEL = Vector((1.54, 1.78, 3.13))
PIPE = [(-0.98, -1.1, 3.6), (-1.45, -1.1, 3.6), (-1.78, -1.1, 3.72)]     # out of the back-left wall, round an elbow
PIPE_FOOT, PIPE_TOP = Vector((-1.9, -1.1, 4.0)), 6.6                    # then up outside the roof's eave
CHUTE = Vector((0.05, 1.7, 5.45))
L1_DROP = 0.5                                   # level 1 stands this much lower, on short feet (4 Flash px)                 # the chute's foot, through the roof (levels 6, 10)


def wall_r(y, z):
    """How far out the right face is at (y, z): the bulging planks, and the strap where it runs (level 3 up)."""
    f = min(1.0, max(0.0, (y + HY) / (2 * HY)))
    zz = min(1.0, max(0.0, (z - Z0) / (Z1 - Z0)))
    strap = 0.12 if L >= 3 and 3.3 < z < 5.0 else 0.0
    return HX + 0.15 * math.sin(math.pi * f) + 0.15 * math.sin(math.pi * zz) + strap


def mount(make, center, axis):
    """A turning part at its fixed centre, on an iron axle back along its axis into the right wall."""
    c = Vector(center)
    axle(c, axis[0], axis[1], (c.x - wall_r(c.y, c.z)) / max(0.3, axis_of(*axis).x) + 0.15)
    return make(c)


def build():
    hx, hy, z0, z1 = HX, HY, Z0, Z1
    body(z0, z1, hx, hy, left=L >= 3)
    if L == 1:                                  # the cabinet's own left wall, set back behind the open press
        plank_wall("cabL", (-hx, 0.06), (hx, 0.06), z0, z1, M["dwood"], 5, out=(0, -1))
        box("cabslot", (0.25, 0.04, 1.6), (0.35, -0.02, 2.6), M["hole"], bevel=0.0)
        # the press frame round the open front, as Flash's: heavy dark square posts on the front corners (the left one
        # taller), a dark crossbar over the roller, olive plates bolted over the joints
        for x, top in ((-hx, z1 + 0.45), (hx, z1 + 0.15)):
            box("framepost", (0.48, 0.44, top - z0 + 0.05), (x, -hy, z0 - 0.05), M["pwood"]("Z"), bevel=0.12, taper=0.94)
        box("framebar", (2 * hx + 0.5, 0.46, 0.46), (0.0, -hy, 4.15), M["pwood"]("X"), bevel=0.12)
        for x in (-hx, hx):
            for z in (z0 + 0.45, 4.38):
                box("framebracket", (0.56, 0.05, 0.56), (x, -hy - 0.24, z), M["olive"], bevel=0.02, origin="center")
                for dx, dz in ((-0.17, -0.17), (0.17, -0.17), (-0.17, 0.17), (0.17, 0.17)):
                    cyl("framebolt", 0.05, 0.06, (x + dx, -hy - 0.27, z + dz), M["iron"], rot=(90, 0, 0), verts=10,
                        bevel=0.015)
    else:
        arch_hole(0.0, 1.7, z1 - 0.3, 1.25, -hy - 0.15)
        zf = math.sin(math.pi * (4.15 - z0) / (z1 - z0))
        band(hx, hy, 3.9, 0.5, out=lambda f: 0.15 * math.sin(math.pi * f) + 0.15 * zf)
    # feet: stumps at the front, left and right corners and under the middle of the right face; claws at level 10
    lh = z0 + 0.1
    if L == 1:
        pass                                    # short feet, after the drop at the end
    elif L < 10:
        for x, y, sp in ((hx, -hy, (0.16, -0.16)), (-hx, -hy, (-0.16, -0.16)), (hx, hy, (0.16, 0.16)), (hx, 0.35, (0.22, 0))):
            leg((x, y), lh, 0.4, sp)
    else:
        for x, y, b in ((hx + 0.15, -hy - 0.15, -45), (-hx - 0.15, -hy - 0.15, -100), (hx + 0.15, hy + 0.15, 10),
                        (hx + 0.2, 0.2, -10)):
            claw((x, y), lh, b)
    # the roller, on two iron arms from its ends back to the front corner posts
    roller(ROLLER, ROLLER_LEN, ROLLER_R)
    for s in (-1, 1):                           # each arm stops against the roller's end cap
        x = ROLLER.x + s * (ROLLER_LEN / 2 + 0.12)
        box("rollerarm", (0.12, ROLLER.y - 0.15 + hy, 0.22), (x, (ROLLER.y - 0.15 - hy) / 2, ROLLER.z), M["iron"],
            bevel=0.03, origin="center")
    # the tray, right under the roller's mouth; two iron hangers from the front corner posts over its back rim
    tr, back_rim = tray(TRAY, TRAY_SIZE, lumps=L >= 6, trim="gold" if L >= 6 else "olive", tilt=TRAY_TILT,
                        roll=TRAY_ROLL)
    bpy.context.view_layer.update()
    mw = tr.matrix_world
    for s in (-1, 1):
        u = (s * hx - TRAY.x) / (TRAY_SIZE[0] / 2)
        p = mw @ back_rim(u)
        a = Vector((s * hx, -hy - 0.12, p.z + 0.1))
        tube("traymount", [a, Vector((p.x, p.y + 0.12, p.z + 0.1)), p + Vector((0, 0, 0.02))], 0.05, M["iron"])
        cyl("traymountbolt", 0.08, 0.08, (s * hx, -hy - 0.22, p.z + 0.1), M["bolt"], rot=(90, 0, 0), verts=10,
            bevel=0.02)
    # the turning parts
    mount(saw, SAW, SAW_AXIS)
    mount(small_gear, SGEAR, SGEAR_AXIS)
    if L >= 6:
        mount(side_wheel, SWHEEL, WHEEL_AXIS)
    # the pipe and horn, the same at every level, with a stay back to the wall
    funnel(PIPE_FOOT, PIPE_TOP, mouth_dir=(-0.6, -0.8), r_pipe=0.27, bell=0.5, bell_len=1.3, up=0.1, route=PIPE,
           cap=L == 1)
    tube("pipestay", [(-hx + 0.02, PIPE_FOOT.y, PIPE_FOOT.z + 0.75), (PIPE_FOOT.x + 0.2, PIPE_FOOT.y, PIPE_FOOT.z + 0.75)],
         0.045, M["iron"])
    if L >= 6:
        if L == 6:
            chute(CHUTE, (0.85, 0.7, 2.2), lean=15, collar=True)
        else:
            chute(CHUTE, (0.85, 0.7, 3.4), twigs=True, lean=15, collar=True)
    if L == 1:
        lean_to(hx, hy, z0, z1)
    elif L < 10:
        pagoda_roof(0, 0.0, 1.55, 2.45, 5.2, 7.3, lift=0.6)
    else:
        roof10(hx, hy, z1, -0.6)
        g0, g1 = -hx - 0.27, px(4, -10, Y=-0.6).x       # the left post against the back-left wall's outside
        gate(g0, g1, -0.6, z1 - 0.2, 9.3, z0_left=z1 - 0.9)
        for z in (z1 - 0.65, z1 - 0.25):
            cyl("gatebolt", 0.06, 0.08, (g0 - 0.22, -0.6, z), M["bolt"], rot=(0, 90, 0), verts=10, bevel=0.02)
    if L == 1:                                  # level 1 sits low on short dark feet: the whole machine, every part
        for o in list(SC.objects):              # fixed to it, drops by L1_DROP; level 3's stump legs lift it
            if o.parent is None:
                o.location.z -= L1_DROP
        for x, y in ((hx, -hy), (-hx, -hy), (hx, hy), (-hx, hy)):
            box("foot", (0.46, 0.46, z0 - L1_DROP - GROUND + 0.1), (x, y, GROUND), M["pwood"]("Z"), bevel=0.08,
                taper=0.85)


def lean_to(hx, hy, z0, z1):
    """Level 1's roof, as Flash's: a lean-to over the cabinet at the back, high along the back-left edge (-X), sloping
    down to the front-right eave (+X); boards running down the slope, light trim on the high edge and the front rake,
    the gable over the cabinet's wall boarded, three loose light planks lying across it."""
    rx0, rx1, ry0, ry1 = -1.6, 1.3, -0.25, 1.95
    zh, zl = z1 + 0.77, z1 + 0.06                    # the boards rest on the ceiling's top (z1 + 0.1) at the right wall

    def rz(x):
        return zh - (x - rx0) * (zh - zl) / (rx1 - rx0)
    slope = math.degrees(math.atan2(zh - zl, rx1 - rx0))
    run = math.hypot(rx1 - rx0, zh - zl)
    n = 9
    for i in range(n):
        y = ry0 + (ry1 - ry0) * (i + 0.5) / n
        box("roofplank", (run + rng.uniform(-0.06, 0.1), (ry1 - ry0) / n - 0.03, 0.1),
            ((rx0 + rx1) / 2 + rng.uniform(-0.05, 0.05), y, (zl + zh) / 2 + 0.05), M["roofplank"]("X"),
            rot=(rng.uniform(-1.5, 1.5), slope + rng.uniform(-0.8, 0.8), 0), bevel=0.025, origin="center",
            jitter=0.01)
    tube("roofridge", [(rx0 + 0.04, ry0 + 0.02, zh + 0.06), (rx0 + 0.04, ry1 - 0.02, zh + 0.06)], 0.07, M["twig"]("Y"))
    tube("roofrake", [(rx0, ry0 - 0.03, zh + 0.12), (rx1 + 0.05, ry0 - 0.03, zl + 0.08)], 0.07, M["twig"]("X"))
    for k in range(5):                                   # the gable boards over the cabinet's left wall, up to the roof
        x = -hx + 2 * hx * (k + 0.5) / 5
        top = rz(x + hx / 5) - 0.02
        box("gable", (2 * hx / 5 - 0.03, 0.1, top - z1 + 0.05), (x, 0.0, z1 - 0.05), M["dwood"]("Z"),
            rot=(0, 0, rng.uniform(-1, 1)), bevel=0.025)
    box("gableback", (0.12, hy - 0.06, zh - z1 - 0.15), (-hx, (hy + 0.06) / 2, z1 - 0.05), M["dwood"]("Y"), bevel=0.02)
    # the loose planks lie flat on the boards (board top = rz + 0.1), pointing down the slope and a little toward the
    # back, as thick as the boards, their low ends running on past the eave
    for k, (ay, deg, x1) in enumerate(((0.15, 18, 1.55), (0.55, 17, 1.7), (1.05, 13, 1.5))):
        d = Vector((math.cos(math.radians(deg)), math.sin(math.radians(deg)), 0))
        a = Vector((-1.35 + 0.08 * k, ay, 0))
        b = a + d * ((x1 - a.x) / d.x)
        a.z, b.z = rz(a.x) + 0.2, rz(b.x) + 0.2          # just above the boards' jitter
        ob = box("looseplank", ((b - a).length, 0.22, 0.1), (a + b) / 2, M["twig"]("X"), bevel=0.025, origin="center")
        ob.rotation_euler = (b - a).to_track_quat("X", "Z").to_euler()


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
    build()
    setup(SC)
    out = HERE / ("work" if MODE == "fit" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    moving_objs = [o for o in SC.objects if under_moving(o)]
    turn(0)
    if MODE == "check":                      # which parts touch or pass through others (evaluated meshes, BVH overlap)
        from mathutils.bvhtree import BVHTree
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        fam = {"saw": "saw", "sgear": "sgear", "swheel": "swheel", "swface": "swheel", "swhub": "swheel",
               "swrivet": "swheel", "hull": "tray", "trayend": "tray", "stave": "tray", "hoop": "tray",
               "trayrim": "tray", "traycorner": "tray", "trayrivet": "tray", "lump": "tray", "traymount": "tray",
               "pipe": "pipe", "horn": "pipe", "roller": "roller", "chute": "chute", "roofstick": "roof",
               "roof": "roof", "rope": "rope", "axle": "axle", "looseplank": "lplank", "gear": "gear"}

        def family(o):
            n = o.name.split(".")[0]
            for k in sorted(fam, key=len, reverse=True):
                if n.startswith(k):
                    return fam[k]
            return "body:" + n
        obs = [o for o in SC.objects if o.type in ("MESH", "CURVE")]
        trees = {}
        for o in obs:
            ev = o.evaluated_get(dg)
            try:
                me = ev.to_mesh()
            except RuntimeError:
                continue
            if me is None:
                continue
            mw = ev.matrix_world
            trees[o.name] = BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [p.vertices[:] for p in me.polygons])
            ev.to_mesh_clear()
        hits = {}
        for i, a in enumerate(obs):
            for b in obs[i + 1:]:
                fa, fb = family(a), family(b)
                if fa == fb or (fa.startswith("body:") and fb.startswith("body:")):
                    continue
                ta, tb = trees.get(a.name), trees.get(b.name)
                if ta and tb:
                    n = len(ta.overlap(tb))
                    if n:
                        key = tuple(sorted((fa, fb)))
                        hits.setdefault(key, []).append((a.name, b.name, n))
        for k, v in sorted(hits.items()):
            print("CHECK", k, sum(x[2] for x in v), v[:4])
        print("DONE check")
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
