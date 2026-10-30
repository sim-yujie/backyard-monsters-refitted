"""pebble2.py : the Pebble Shiner (Flash building 2) as a 3D model, second try, built the way the approved Twig Snapper
v3 was (../twig-v3/twig2.py): one body for every level, parts at fixed points on it, no outline, Flash's soft light.

    blender -b --factory-startup -P pebble2.py -- <level> fit      work/fit-L<level>.png  quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P pebble2.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P pebble2.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P pebble2.py -- <level> check    CHECK lines: parts whose meshes overlap; CLEAR lines:
                                                                    how near each moving part comes to anything else
    blender -b --factory-startup -P pebble2.py -- <level> gap      GAP lines: parts in front of others from the camera

The body is a stack of courses (stack.py): six stone piers, a fixed base course, the turning ring (a second one from
level 6), the head with the spout (level 3 up), a fixed collar, the plank roof, and at level 10 the spiked drum on the
peak and the spiked ball on its post. An added course lifts what is above it; parts stay on the course they hang on.

Camera: as twig2.py (orthographic, 30 degrees down, bearing 45; 10 Flash px per world unit across the screen).
Animation, as Flash (worked out from the frames, see the report): the stone rings grind round, starting and stopping
slowly over the loop (26 frames, 24 at level 10); at level 6 and 10 the two rings turn opposite ways; at level 10 the
drum spins and the ball rolls. Nothing else moves. Each moving part repeats itself (a ring every 2 blocks, the drum every
45 degrees, the ball every fifth of a turn), so the loop's last frame runs into its first. Stillness is built in as in
twig2.py: the base picture is rendered once, each frame renders only the moving parts with every still part as a
holdout, and post.py lays that layer over the base.
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
FRAMES = 24 if LEVEL >= 10 else 26      # Flash's loop: 26 frames (24 at level 10)

EL = 30.0
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the building's middle on the ground)
GROUND = S.GROUND
FRAME = (-44, -64, 52, 60)            # the canvas in Flash px (as fref.FRAME)
K = {"fit": 4}.get(MODE, int(os.environ.get("PB_K", 12)))      # render px per Flash px
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


# ------------------------------------------------------------------------------------------------------------ the model
def materials():
    M = {}
    M["stone"] = painted("stone", (168, 166, 180), rough=0.75, wear=(206, 206, 218), scale=2.5, dirt=0.45, spec=0.25)
    M["stonew"] = painted("stonew", (206, 206, 216), rough=0.6, wear=(232, 232, 240), scale=2.5, dirt=0.25, spec=0.3)
    M["stoneh"] = painted("stoneh", (176, 174, 188), rough=0.7, wear=(208, 208, 218), scale=2.0, dirt=0.3, spec=0.25)
    M["core"] = painted("core", (86, 82, 94), rough=0.85, wear=(110, 106, 118), scale=3, dirt=0.4, spec=0.2)
    M["coreh"] = painted("coreh", (120, 116, 130), rough=0.8, scale=3, dirt=0.3, spec=0.2)
    M["band"] = flat("band", (84, 80, 92), rough=0.85)           # the rings' turning band: plain, so a turn of one
    M["hole"] = flat("hole", (14, 12, 16), rough=1.0)              # pattern looks exactly the same
    M["roof"] = lambda axis="Z": wood("roof", (224, 180, 146), (176, 128, 98), axis, rings=7, knots=False, dirt=0.2)
    M["roofb"] = lambda axis="Z": wood("roofb", (150, 112, 84), (110, 78, 56), axis, rings=7, dirt=0.2)
    M["pipe"] = painted("pipe", (62, 70, 82), rough=0.45, metal=0.7, wear=(120, 130, 146), scale=7, dirt=0.1, soot=0.5)
    M["horn"] = painted("horn", (58, 72, 88), rough=0.42, metal=0.45, wear=(120, 136, 152), scale=6, dirt=0.05, soot=0.4)
    M["iron"] = painted("iron", (58, 62, 72), rough=0.45, metal=0.85, wear=(150, 156, 170), rust=(120, 70, 40), scale=7,
                        soot=0.75)
    M["bolt"] = painted("bolt", (150, 160, 176), rough=0.3, metal=0.9, scale=10, dirt=0.0)
    M["drum"] = lambda axis="Z": wood("drum", (124, 76, 46), (80, 46, 28), axis, rings=8, dirt=0.0)
    M["lid"] = flat("lid", (66, 40, 28), rough=0.6)
    M["hoop"] = flat("hoop", (52, 52, 58), rough=0.4, metal=0.8)
    M["spike"] = flat("spike", (226, 228, 236), rough=0.25, metal=0.85)
    M["ball"] = flat("ball", (46, 46, 54), rough=0.42, metal=0.6)
    return M


M = materials()
RR, RH = S.roof_size(L)        # the roof: level 1's is smaller, level 3 puts on the big one (as Flash)


def R(seed):
    """A random stream for one part: the same at every level, whatever else the level adds."""
    return random.Random(seed)


def seg_mesh(name, w, r0, r1, h, bulge=0.0, n=None, rnd=None, jit=0.0):
    """A stone block: the piece of a ring w degrees wide round bearing 0, radii r0..r1, heights 0..h. bulge: the outer
    face bows out at mid height. Returns a mesh object at the origin (place it with its rotation and height)."""
    n = n or max(2, int(w / 5))
    prof = [(r0, 0.0), (r1, 0.0), (r1 + bulge, h / 2), (r1, h), (r0, h)]
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        a = math.radians(-w / 2 + w * i / n)
        rows.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z in prof])
    m = len(prof)
    for a, b in zip(rows, rows[1:]):
        for j in range(m):
            k = (j + 1) % m
            bm.faces.new((a[j], b[j], b[k], a[k]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    if jit:
        for v in bm.verts:
            v.co += Vector((rnd.uniform(-jit, jit) for _ in range(3)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [M["stone"]], smooth=False, bevel=min(0.09, h / 4), segs=3)


def place(ob, bearing, z, mat=None):
    ob.location = (0, 0, z)
    ob.rotation_euler = (0, 0, math.radians(bearing))
    if mat is not None:
        ob.data.materials[0] = mat
    return ob


def course(name, z0, h, n, r0, r1, rnd, w_fill=0.86, mat=None, phase=0.0, bulge=0.0, jit=0.025, hj=0.06):
    """A fixed course of n stone blocks round the body, from z0 up h (each block a little different)."""
    obs = []
    for k in range(n):
        w = 360.0 / n * w_fill * rnd.uniform(0.92, 1.05)
        hh = h * rnd.uniform(1 - hj, 1.0)
        ob = seg_mesh(name, w, r0, r1 + rnd.uniform(-0.03, 0.03), hh, bulge, rnd=rnd, jit=jit)
        obs.append(place(ob, 360.0 * (k + phase) / n + rnd.uniform(-1.5, 1.5), z0 + (h - hh) / 2, mat))
    return obs


def pier(bearing, rnd):
    """A leg: three stones stacked from the ground to the base course, the top one wider and reaching out under the
    course (Flash's legs, open arches between them)."""
    hs = (0.56, 0.54, S.Z_PIER - 1.1)
    dims = ((1.42, 2.2, 36), (1.42, 2.14, 34), (1.42, 2.3, 38))
    z = GROUND
    for (r0, r1, w), h in zip(dims, hs):
        ob = seg_mesh("pier", w * rnd.uniform(0.95, 1.05), r0, r1 + rnd.uniform(-0.04, 0.03), h, 0.05, rnd=rnd,
                      jit=0.03)
        place(ob, bearing + rnd.uniform(-2, 2), z)
        z += h


def ring(name, z0, phase):
    """A turning ring of stone blocks on a plain band round the fixed core: big and small blocks in turn (Flash's
    checker), every block a copy of one of two stones, so a turn of whole patterns looks exactly the same."""
    e = bpy.data.objects.new(name, None)
    link(e)
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    lathe(name + "band", [(1.56, z0 + 0.04), (2.24, z0 + 0.04), (2.24, z0 + S.RING_H - 0.04), (1.56, z0 + S.RING_H - 0.04),
                          (1.56, z0 + 0.04)], (0, 0, 0), M["band"], verts=56, parent=hub)
    big = seg_mesh(name + "big", 23.0, 2.1, S.R_RING - 0.04, S.RING_H - 0.1, 0.05, n=6) if L >= 3 else None
    small = seg_mesh(name + "small", 21.0, 2.1, S.R_RING - 0.14, S.RING_H - 0.16, 0.05, n=6)
    for k in range(S.N_RING):
        src = big if k % 2 == 0 and big else small     # level 3 swaps every other stone for a bigger one
        ob = src if src.parent is None else src.copy()
        if ob is not src:
            link(ob)
        ob.parent = hub
        dz = 0.05 if src is big else 0.08
        place(ob, 360.0 * (k + phase) / S.N_RING, z0 + dz)
    MOVING.append(hub)
    return hub


def head(z0):
    """Level 3 up: the bulging stone head over the rings, two courses of big pale stones round a core, with the spout
    on the front-left and a dark slot on the right."""
    rnd = R(31)
    h = S.HEAD_H
    lathe("headcore", [(1.5, z0 + 0.04), (2.2, z0 + 0.04), (2.3, z0 + h * 0.5), (2.18, z0 + h), (1.5, z0 + h),
                       (1.5, z0 + 0.04)], (0, 0, 0), M["coreh"], verts=48)
    hc = (h - 0.04) / 2
    course("headA", z0 + 0.04, hc, 13, 2.0, S.R_HEAD - 0.08, rnd, 0.95, M["stoneh"], 0.0, 0.1, 0.03, 0.03)
    course("headB", z0 + 0.04 + hc, hc, 13, 2.0, S.R_HEAD - 0.16, rnd, 0.95, M["stoneh"], 0.5, 0.06, 0.03, 0.03)
    # the spout: a thick white stone pipe out of the head, its mouth dark (the pebbles' way out)
    a = math.radians(S.SPOUT_TH)
    d = Vector((math.cos(a), math.sin(a), -0.12)).normalized()
    base = Vector((2.0 * math.cos(a), 2.0 * math.sin(a), z0 + S.SPOUT_UP))
    sp = lathe("spout", [(0.5, 0.0), (0.52, 0.55), (0.58, 0.74), (0.6, 0.88), (0.52, 0.98), (0.36, 0.96), (0.34, 0.8)],
               base, M["stonew"], verts=32)
    sp.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    dk = cyl("spouthole", 0.35, 0.05, base + d * 0.76, M["hole"], verts=24, bevel=0.0)
    dk.rotation_euler = sp.rotation_euler
    # the slot on the right
    a = math.radians(S.SLOT_TH)
    sl = box("slot", (0.24, 0.3, 0.95), (2.27 * math.cos(a), 2.27 * math.sin(a), z0 + 0.4), M["hole"], bevel=0.02)
    sl.rotation_euler = (0, 0, a - math.pi / 2)


def shingle_mesh(name, w0, w1, ln, th, mat, tip=0.16):
    """A roof plank: tapering from w0 at its rounded bottom to w1 at the top, ln long, th thick (local: x across, y up
    the slope, z out of the roof)."""
    pts = []
    m = 8
    for i in range(m + 1):
        t = math.pi * i / m
        pts.append((-w0 / 2 * math.cos(t), tip * (1 - math.sin(t))))
    pts += [(w1 / 2, ln), (-w1 / 2, ln)]
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += th
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=0.02, segs=2)


def cone_frame(phi, s, ze, lift):
    """Where a plank sits on the roof cone: its foot at bearing phi, fraction s up the slope, lifted `lift` off it."""
    a = math.radians(phi)
    rad = Vector((math.cos(a), math.sin(a), 0))
    p = rad * (RR * (1 - s)) + Vector((0, 0, ze + RH * s))
    up = (Vector((0, 0, RH)) - rad * RR).normalized()
    t = Vector((-math.sin(a), math.cos(a), 0))
    n = t.cross(up)
    if n.dot(rad) < 0:
        n = -n
    m = Matrix((t, up, n)).transposed()
    return p + n * lift, m


def roof(ze, peak_cut=None):
    """The cone roof of pale planks, two rows round, their rounded feet making the scalloped eave (Flash's), on a
    plank deck that rests on the collar. peak_cut: the top row stops this far up (level 10's drum seat)."""
    rnd = R(57)
    c = Vector(S.ROOF_SHIFT + (0.0,))
    lathe("roofdeck", [(0.0, ze - 0.02), (RR - 0.1, ze - 0.02), (RR - 0.1, ze + 0.04),
                       (0.0, ze + RH - 0.02)], c, M["roofb"]("Z"), verts=48)
    top = peak_cut or 1.0
    rows = ((-0.03, 0.42, 17, 0.0, 0.06), (0.34, 0.72, 13, 0.5, 0.13), (0.64, top, 9, 0.25, 0.2))
    for s0, s1, n, ph, lift in rows:
        r0, r1 = RR * (1 - s0), RR * (1 - s1)
        ln = (s1 - s0) * math.hypot(RR, RH)
        for k in range(n):
            phi = 360.0 * (k + ph + rnd.uniform(-0.1, 0.1)) / n
            w0 = 2 * math.pi * r0 / n * 1.12
            w1 = max(0.04, 2 * math.pi * r1 / n * 1.1)
            ob = shingle_mesh("roofplank", w0, w1, ln * rnd.uniform(0.93, 1.0), 0.08, M["roof"]("Y"), tip=0.2)
            p, m = cone_frame(phi, s0, ze, lift + 0.025 * (k % 2))
            p += c
            tilt = Matrix.Rotation(math.radians(rnd.uniform(-4, 4)), 3, "Y") @ Matrix.Rotation(math.radians(rnd.uniform(-3, 3)), 3, "Z")
            ob.matrix_world = Matrix.Translation(p) @ (m @ tilt).to_4x4()
    if not peak_cut:                            # a peak cap closes the top
        lathe("roofpeak", [(0.0, 0.0), (0.3, 0.0), (0.26, 0.1), (0.0, 0.42)], c + Vector((0, 0, ze + RH - 0.22)),
              M["roofb"]("Z"), verts=16)
    if peak_cut:                                # the drum's seat: a wooden cap over the cut planks
        r = RR * (1 - peak_cut)
        cyl("roofcap", r + 0.12, 0.1, c + Vector((0, 0, ze + RH * peak_cut + 0.02)), M["roofb"]("Z"), verts=32,
            bevel=0.03)


def pipe(ze):
    """The pipe: out of the collar on the back left, round an elbow, up past the eave, ending in a slate horn turned
    up to the viewer's left. An iron plate where it leaves the collar, an iron band near the top."""
    a = math.radians(S.PIPE_TH)
    rad = Vector((math.cos(a), math.sin(a), 0))
    zf = ze - 0.32
    p0 = rad * (S.R_COLLAR - 0.25) + Vector((0, 0, zf))
    p1 = rad * (S.PIPE_R - 0.2) + Vector((0, 0, zf))
    p2 = rad * S.PIPE_R + Vector((0, 0, zf + 0.2))
    top = rad * S.PIPE_R + Vector((0, 0, ze + S.PIPE_UP - 0.42))
    tube("pipe", [p0, p1, p2, top], 0.17, M["pipe"])
    pl = cyl("pipeplate", 0.25, 0.06, rad * (S.R_COLLAR - 0.02) + Vector((0, 0, zf)), M["iron"], verts=16, bevel=0.02)
    pl.rotation_euler = rad.to_track_quat("Z", "Y").to_euler()
    cyl("pipeband", 0.2, 0.08, top - Vector((0, 0, 0.35)), M["iron"], verts=16, bevel=0.015)
    c = lathe("horn", [(0.15, 0.0), (0.2, 0.08), (0.62, 0.2), (0.7, 0.27), (0.62, 0.36), (0.36, 0.44), (0.0, 0.47)],
              top - Vector((0, 0, 0.05)), M["horn"], verts=40)
    c.rotation_euler = (math.radians(10), math.radians(-14), 0)
    cyl("hornneck", 0.2, 0.16, top - Vector((0, 0, 0.12)), M["iron"], verts=16, bevel=0.02)


def drum(ze, seat):
    """Level 10: the spiked wooden drum on the roof's peak, turning on an iron spindle (8 staves, 3 rows of 8 spikes:
    it looks the same every 45 degrees)."""
    z0 = ze + RH * seat + 0.16
    hgt = 0.75
    c = Vector(S.ROOF_SHIFT + (0.0,))
    cyl("drumaxle", 0.07, hgt + 0.55, c + Vector((0, 0, z0 - 0.12)), M["bolt"], verts=12, bevel=0.02)
    lathe("drumknob", [(0.0, 0.0), (0.1, 0.0), (0.12, 0.06), (0.06, 0.16), (0.0, 0.18)],
          c + Vector((0, 0, z0 + hgt + 0.4)), M["bolt"], verts=16)
    e = bpy.data.objects.new("drum", None)
    link(e)
    e.location = c
    hub = bpy.data.objects.new("drum-spin", None)
    link(hub, e)
    st = seg_mesh("drumstave", 43.0, 0.46, 0.6, hgt, 0.03, n=6)
    st.data.materials[0] = M["drum"]("Z")
    sp = cyl("drumspike", 0.055, 0.2, (0, 0, 0), M["spike"], r2=0.0, verts=10, bevel=0.0)
    for k in range(8):
        ob = st if k == 0 else st.copy()
        if k:
            link(ob)
        ob.parent = hub
        place(ob, 45.0 * k, z0)
    for j, zz in enumerate((0.16, 0.38, 0.6)):
        for k in range(8):
            a = math.radians(45.0 * k + 22.5 * (j % 2))
            ob = sp if (j, k) == (0, 0) else sp.copy()
            if (j, k) != (0, 0):
                link(ob)
            ob.parent = hub
            ob.location = (0.56 * math.cos(a), 0.56 * math.sin(a), z0 + zz)
            ob.rotation_euler = Vector((math.cos(a), math.sin(a), 0)).to_track_quat("Z", "Y").to_euler()
    for zz, r in ((0.0, 0.62), (hgt, 0.62)):
        lathe("drumhoop", [(0.58, zz - 0.04), (r, zz - 0.03), (r, zz + 0.03), (0.58, zz + 0.04), (0.58, zz - 0.04)],
              (0, 0, z0), M["hoop"], verts=48, parent=hub)
    lathe("drumlid", [(0.09, hgt), (0.58, hgt), (0.5, hgt + 0.08), (0.09, hgt + 0.1)], (0, 0, z0), M["lid"], verts=48,
          parent=hub)
    lathe("drumfloor", [(0.09, 0.0), (0.58, 0.0)], (0, 0, z0 + 0.01), M["lid"], verts=48, parent=hub)
    MOVING.append(hub)
    return hub


def ball(ze):
    """Level 10: the spiked iron ball off the collar's right side, on an iron post that bends round under it to an
    axle along its spin axis (30 spikes: icosahedron corners and face middles bar the two on the axle, so a fifth of a
    turn looks exactly the same)."""
    c = Vector(S.polar(S.BALL_TH, S.BALL_R, ze + S.BALL_UP))
    ax = Vector(S.BALL_AXIS).normalized()
    e = bpy.data.objects.new("ball", None)
    link(e)
    e.location = c
    e.rotation_euler = ax.to_track_quat("Z", "Y").to_euler()
    hub = bpy.data.objects.new("ball-spin", None)
    link(hub, e)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=0.84)
    mesh_ob("ballbody", bm, [M["ball"]], parent=hub)
    lathe("ballboss", [(0.0, -0.92), (0.16, -0.92), (0.22, -0.78), (0.24, -0.72)], (0, 0, 0), M["ball"], verts=20,
          parent=hub)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    bm.faces.ensure_lookup_table()
    dirs = [v.co.normalized() for v in bm.verts] + [f.calc_center_median().normalized() for f in bm.faces]
    bm.free()
    sp = None
    for d in dirs:
        if abs(d.z) > 0.99:
            continue
        ob = cyl("ballspike", 0.07, 0.28, (0, 0, 0), M["spike"], r2=0.0, verts=10, bevel=0.0) if sp is None \
            else sp.copy()
        if sp is None:
            sp = ob
        else:
            link(ob)
        ob.parent = hub
        ob.location = d * 0.78
        ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    MOVING.append(hub)
    # the post: out of the collar, under the eave to beyond it, up, and round under the ball to its axle
    zf = ze - 0.32
    rad = Vector(S.polar(S.BALL_TH, 1.0, 0.0))
    p0 = rad * (S.R_COLLAR - 0.25) + Vector((0, 0, zf))
    p1 = rad * (S.BALL_R - 0.15) + Vector((0, 0, zf))
    p2 = Vector((c.x, c.y, zf + 0.15))
    pts = [p0, p1, p2]
    for i in range(0, 7):
        t = i / 6
        d = (Vector((0, 0, -1)) * (1 - t) + (-ax) * t).normalized()
        pts.append(c + d * 1.32)
    tube("ballpost", pts, 0.07, M["iron"])
    ab = cyl("ballaxle", 0.06, 0.5, c - ax * 1.32, M["bolt"], verts=12, bevel=0.015)
    ab.rotation_euler = ax.to_track_quat("Z", "Y").to_euler()
    pl = cyl("ballpostplate", 0.2, 0.06, rad * (S.R_COLLAR - 0.02) + Vector((0, 0, zf)), M["iron"], verts=16, bevel=0.02)
    pl.rotation_euler = rad.to_track_quat("Z", "Y").to_euler()


def pebble(at, size, rnd, mat=None):
    """A loose pebble on the ground, a rounded white block (Flash's: the machine's output lying round its feet)."""
    ob = box("pebble", size, (at[0], at[1], GROUND - 0.02), mat or M["stoneh"], rot=(0, 0, rnd.uniform(0, 180)),
             bevel=min(size) * 0.45, jitter=0.03)
    return ob


PEBBLES = [((-2.72, -1.03), (0.72, 0.62, 0.5)), ((1.8, 2.65), (1.05, 0.8, 0.5)), ((2.12, -2.26), (1.35, 0.7, 0.26))]
PEBBLES6 = [((3.39, -0.28), (0.75, 0.5, 0.2)), ((3.89, 0.36), (0.55, 0.4, 0.18)), ((4.59, -0.49), (0.3, 0.25, 0.1))]


def build():
    ze = S.z_eave(L)
    # the legs: six piers round a dark core, the fixed base course on them
    rnd = R(11)
    lathe("legcore", [(0.0, S.Z_PIER - 0.3), (1.5, S.Z_PIER - 0.3), (1.5, S.Z_PIER), (0.0, S.Z_PIER)], (0, 0, 0), M["core"],
          verts=48)
    for k in range(6):
        pier(-56.0 + 60.0 * k, rnd)
    course("basecourse", S.Z_PIER, S.Z_BASE - S.Z_PIER - 0.02, 20, 1.6, 2.36, R(12), 0.9)
    # the fixed core the rings turn round, from the base course to the collar
    cyl("shaft", 1.5, S.z_collar(L) - S.Z_BASE + 0.1, (0, 0, S.Z_BASE - 0.05), M["core"], verts=48, bevel=0.0)
    ring("ring1", S.Z_BASE, 0.0)
    if L >= 6:
        ring("ring2", S.Z_BASE + S.RING_H, 0.5)
    if L >= 3:
        head(S.z_head(L))
    # the collar: the fixed course that carries the roof, the pipe and (level 10) the ball's post
    zc = S.z_collar(L)
    lathe("collarcore", [(1.4, zc), (2.0, zc), (2.0, ze), (1.4, ze)], (0, 0, 0), M["core"], verts=48)
    course("collar", zc + 0.02, S.COLLAR_H - 0.02, 22, 1.8, S.R_COLLAR, R(13), 0.88)
    roof(ze, peak_cut=0.72 if L >= 10 else None)
    pipe(ze)
    if L >= 10:
        drum(ze, 0.72)
        ball(ze)
    rnd = R(17)
    for at, size in PEBBLES + (PEBBLES6 if L >= 6 else []):
        pebble(at, size, rnd)


def ease(t):
    """Flash's ring and drum turns start and stop slowly: the speed rises and falls like a sine over the loop."""
    return (1 - math.cos(math.pi * t)) / 2


TURNS = {   # degrees over the loop, and the way round (+ = anticlockwise from above / round the ball's axis)
    1: {"ring1": -S.RING_TURN},
    3: {"ring1": -S.RING_TURN},
    6: {"ring1": -S.RING_TURN, "ring2": S.RING_TURN},
    10: {"ring1": S.RING_TURN, "ring2": -S.RING_TURN, "drum": 630.0, "ball": 72.0},
}


def turn(frame):
    """Turn the moving parts to Flash frame `frame` of FRAMES (eased, as Flash's)."""
    e = ease(frame / FRAMES)
    t = TURNS[10 if L >= 10 else 6 if L >= 6 else 3 if L >= 3 else 1]
    for hub in MOVING:
        hub.rotation_euler = (0, 0, math.radians(t[hub.parent.name] * e))


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



FAMILY = (("ring1", "ring1"), ("ring2", "ring2"), ("drumaxle", "axle"), ("drumknob", "axle"), ("drum", "drum"),
          ("ballaxle", "axle"), ("ballpost", "post"), ("ball", "ball"), ("roof", "roof"), ("pipe", "pipe"),
          ("horn", "pipe"), ("pebble", "pebble"), ("spout", "head"), ("slot", "head"), ("head", "head"),
          ("collar", "collar"), ("basecourse", "base"), ("pier", "legs"), ("legcore", "legs"), ("shaft", "shaft"))


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


def main():
    build()
    setup(SC)
    out = HERE / ("work" if MODE == "fit" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    moving_objs = [o for o in SC.objects if under_moving(o)]
    turn(0)
    if MODE == "check":
        # which parts touch or pass through others (evaluated meshes, BVH overlap), at three points of the turn; and
        # how close each moving part comes to anything else while it turns
        for k in (0, FRAMES // 3, 2 * FRAMES // 3):
            turn(k)
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
                print("CHECK f%02d" % k, key, sum(x[2] for x in v), v[:3])
            fams = sorted({family(o) for o, _, _ in obs if under_moving(o)})
            for fm in fams:
                best = (9.0, "")
                for o, t, vs in obs:
                    if family(o) != fm:
                        continue
                    for o2, t2, _ in obs:
                        f2 = family(o2)
                        if f2 == fm or (fm in ("ball", "drum") and f2 == "axle"):
                            continue
                        for v in vs[::2]:
                            hit = t2.find_nearest(v, best[0])
                            if hit[0] is not None and hit[3] < best[0]:
                                best = (hit[3], f2)
                print("CLEAR f%02d %s nearest other part %.3f (%s)" % (k, fm, best[0], best[1]))
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
                cur = pairs.get(key, (9.0, 0, 0))
                pairs[key] = (min(cur[0], d), cur[1] + (d < 0.05), cur[2] + 1)
        for (f1, f2), (d, near, n) in sorted(pairs.items()):
            if any(m in (f1, f2) for m in ("ring1", "ring2", "drum", "ball", "post", "pipe", "roof", "axle")):
                print("GAP %-7s in front of %-7s: least depth gap %.3f, rays under 0.05: %d of %d (%.1f px2)" %
                      (f1, f2, d, near, n, near * step * step))
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
        sc.cycles.samples = 24
        sc.cycles.use_denoising = True
        bpy.data.objects["ground"].hide_render = True
        sc.render.filepath = str(out / f"fit-L{L}.png")
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
        sc.cycles.samples = int(os.environ.get("PB_PART_SAMPLES", 256))
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
