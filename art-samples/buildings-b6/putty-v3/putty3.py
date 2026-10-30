"""putty3.py : the Putty Squisher (Flash building 3) as a 3D model, v3: our own take. Same parts and colours as Flash and
v2 (../putty-v2/putty2.py), in chunkier, simpler shapes that read at game size, with the approved Twig and Pebble's
matte painted finish. One body for every level, parts at fixed points on it (stack.py), no outline.

    blender -b --factory-startup -P putty3.py -- <level> fit      work/fit-L<level>.png  quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P putty3.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P putty3.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P putty3.py -- <level> check    CHECK lines: parts whose meshes overlap; CLEAR lines:
                                                                   how near each moving part comes to anything else
    blender -b --factory-startup -P putty3.py -- <level> gap      GAP lines: parts in front of others from the camera

Level 1: the banded tub pot on the ground, the press block on its rim, the hand wheel on its upper band, the test tube in
a gold foot beside it on an arm from the rim. Level 3 sets the same pot in the purple goo frame on four log stumps (which
lifts it and every part on it) and bolts two bone arches over it. Level 6 adds the drum hub on the arches with the
flask, the valve wheel and the arm that now holds the test tube up. Level 10 adds the cage wheel on an axle out of the
hub's back, the coil, springs round the stumps and putty slopped over the rim and arches.

Animation, as Flash: the gold stirrer goes round three times a loop and the putty's swirl once, clockwise from above, at
an even speed; at level 10 the cage wheel turns two rungs a loop, anticlockwise on screen. Nothing else moves. The base
picture is rendered once, each frame renders only the moving parts with every still part as a holdout, and post.py lays
that layer over the base.
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
FRAMES = 25 if LEVEL >= 10 else 26      # Flash's loop: 26 frames (25 at level 10)

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
def materials():
    M = {}
    # every material matte, painted: Flash's soft dull surfaces, the approved Twig and Pebble's finish
    # the pot: a warm orange-gold, worn paler on the bulges, soot low down and in patches
    M["pot"] = painted("pot", (230, 148, 26), rough=0.66, wear=(250, 190, 76), rust=(62, 34, 6), scale=1.3,
                       dirt=0.5, spec=0.32, rust_at=0.6)
    M["band"] = painted("band", (178, 104, 20), rough=0.6, metal=0.2, wear=(222, 152, 52), rust=(70, 38, 8), scale=3.0,
                        dirt=0.3, spec=0.3, rust_at=0.66)
    M["potin"] = painted("potin", (104, 48, 22), rough=0.85, wear=(132, 66, 30), rust=(56, 24, 12), scale=3.5,
                         dirt=0.2, spec=0.2)
    M["putty"] = painted("putty", (104, 50, 156), rough=0.5, wear=(146, 94, 198), scale=1.4, dirt=0.0, spec=0.35)
    M["gold"] = painted("gold", (222, 164, 36), rough=0.55, metal=0.25, wear=(246, 210, 108), scale=6, dirt=0.15,
                        spec=0.35)
    M["purple"] = painted("purple", (62, 28, 96), rough=0.58, wear=(88, 48, 128), scale=2.2, dirt=0.3, spec=0.3,
                          top=(118, 78, 166), ao_min=0.6)
    M["stump"] = lambda axis="Z": wood("stump", (204, 160, 132), (150, 110, 88), axis, rings=5, dirt=0.3)
    M["stumptop"] = painted("stumptop", (236, 210, 184), rough=0.8, wear=(206, 168, 140), scale=4, dirt=0.0)
    M["bone"] = painted("bone", (132, 108, 74), rough=0.82, wear=(166, 142, 102), rust=(62, 46, 26), scale=2.2,
                        dirt=0.45, spec=0.22, soot=0.75, top=(160, 138, 98), ao_min=0.5, rust_at=0.5)
    M["block"] = lambda axis="Z": wood("block", (150, 118, 76), (104, 78, 48), axis, rings=4, dirt=0.5)
    M["blocktop"] = painted("blocktop", (176, 148, 100), rough=0.85, wear=(150, 122, 80), scale=3.0, dirt=0.0,
                            soot=0.5)
    M["hole"] = flat("hole", (24, 14, 12), rough=1.0)
    M["glass"] = painted("glass", (196, 210, 222), rough=0.42, wear=(232, 238, 246), scale=4, dirt=0.0, spec=0.4)
    M["liquid"] = painted("liquid", (132, 74, 190), rough=0.42, wear=(172, 122, 222), scale=3, dirt=0.0, spec=0.4)
    M["cap"] = painted("cap", (226, 226, 234), rough=0.6, wear=(198, 198, 210), scale=5, dirt=0.0)
    M["steel"] = painted("steel", (150, 156, 168), rough=0.55, metal=0.3, wear=(200, 204, 214), scale=8, dirt=0.1)
    return M


M = materials()


def R(seed):
    """A random stream for one part: the same at every level, whatever else the level adds."""
    return random.Random(seed)


ZP, ZR = S.z_pot(L), S.z_rim(L)


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
    return tube(name, [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n + 1)],
                wire, mat, parent=parent, verts=12)


def handwheel(name, r, mat, parent, spokes=4, rim=0.1, knob=True):
    """A chunky hand wheel in its local XY (axis local Z): a fat round rim, thick spokes, a domed hub, a knob."""
    obs = [ring(name + "rim", r, rim, mat, parent)]
    for k in range(spokes):
        a = 2 * math.pi * (k + 0.5) / spokes
        obs.append(tube(f"{name}spoke{k}", [(0, 0, 0), (r * math.cos(a), r * math.sin(a), 0)], rim * 0.72, mat,
                        parent=parent, verts=10))
    obs.append(lathe(name + "hub", [(0.0, -rim * 1.6), (rim * 2.0, -rim * 1.6), (rim * 2.3, -rim * 0.6),
                                    (rim * 2.1, rim * 0.9), (rim * 1.2, rim * 1.6), (0.0, rim * 1.7)], (0, 0, 0), mat,
                     parent=parent, verts=20))
    if knob:
        obs.append(lathe(name + "knob", [(0.0, 0.0), (rim * 0.9, 0.0), (rim * 0.9, r * 0.32), (rim * 1.3, r * 0.4),
                                         (rim * 1.25, r * 0.55), (0.0, r * 0.6)], (r, 0, 0), mat, parent=parent,
                         verts=12))
    return obs


# the pot's side: a round foot, out to the full belly and nearly straight up (a tub, as Flash's upright pot), the rim
POT_PROF = [(0.0, 0.0), (1.34, 0.0), (1.48, 0.05), (1.62, 0.2), (1.76, 0.5), (1.85, 0.95), (S.POT_RMAX, 1.4),
            (1.86, 1.85), (1.8, 2.25), (1.74, 2.6), (1.76, 2.8), (1.8, S.POT_H - 0.1)]


def rad_at(prof, z):
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return prof[-1][0]


def rad_at_pot(z):
    return rad_at(POT_PROF, z)


def pot():
    """The pot: an upright tub with two riveted bands and a fat rolled gold rim; rusty brown inside."""
    H = S.POT_H
    lathe("pot", POT_PROF, (0, 0, ZP), M["pot"], verts=64)
    lathe("potrim", [(1.72, H - 0.16), (1.86, H - 0.2), (1.95, H - 0.12), (S.POT_R, H - 0.02), (1.94, H + 0.07),
                     (1.84, H + 0.1), (1.74, H + 0.05), (1.7, H - 0.04), (1.69, H - 0.14)], (0, 0, ZP), M["gold"],
          verts=64)
    lathe("potin", [(1.7, H - 0.1), (1.68, H - 0.5), (1.64, H - 0.9), (0.0, H - 0.9)], (0, 0, ZP), M["potin"], verts=64)
    lathe("potfoot", [(1.2, 0.0), (1.4, -0.0), (1.47, 0.04), (1.52, 0.12), (1.5, 0.2), (1.42, 0.24)], (0, 0, ZP),
          M["band"], verts=64)
    for k, zb in enumerate(S.BANDS[1:]):
        r = rad_at_pot(zb)
        lathe(f"potband{k}", [(r - 0.02, zb - 0.16), (r + 0.05, zb - 0.15), (r + 0.075, zb - 0.1), (r + 0.075, zb + 0.1),
                              (r + 0.05, zb + 0.15), (r - 0.02, zb + 0.16)], (0, 0, ZP), M["band"], verts=64)
        for j in range(14):
            th = 360.0 * (j + 0.5 * k) / 14
            p = Vector(S.polar(th, r + 0.07, ZP + zb))
            ob = lathe(f"potrivet{k}_{j}", [(0.0, -0.01), (0.065, -0.01), (0.06, 0.03), (0.035, 0.055), (0.0, 0.06)],
                       p, M["gold"], verts=10)
            ob.rotation_euler = Vector((math.cos(math.radians(th)), math.sin(math.radians(th)), 0)).to_track_quat(
                "Z", "Y").to_euler()


def putty_and_stirrer():
    """The moving parts in the pot: the putty (a soft dome with a swirl, round once a loop) and the chunky gold crank
    stirrer (three times round a loop), both on the pot's axis."""
    zs = ZR - S.PUTTY_DOWN

    def putty(hub):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, segments=72, radius=1.66)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=5, use_grid_fill=True)
        for v in bm.verts:
            d = v.co.length
            a = math.atan2(v.co.y, v.co.x)
            # a soft dome with two fat swirl arms winding in to a mound round the stirrer
            v.co.z = (0.16 * (1 - (d / 1.66) ** 2) + 0.07 * math.sin(2 * a + 4.2 * d) * min(1.0, d / 0.35)
                      * (1 - d / 1.75) + 0.08 * max(0, 1 - d / 0.45))
        ob = mesh_ob("puttysurf", bm, [M["putty"]], parent=hub)
        ob.modifiers.new("smooth", "SUBSURF").levels = 1

    def stirrer(hub):
        # the crank: a fat gold rod up out of the putty, round a bend, out along the arm, round and down into the putty
        r, up, b = 0.66, 0.9, 0.24
        pts = [(0, 0, -0.2), (0, 0, up - b)]
        for i in range(1, 7):
            a = math.pi / 2 * i / 6
            pts.append((b * (1 - math.cos(a)), 0, up - b + b * math.sin(a)))
        pts += [(r - b, 0, up)]
        for i in range(1, 7):
            a = math.pi / 2 * i / 6
            pts.append((r - b + b * math.sin(a), 0, up - b * (1 - math.cos(a))))
        pts += [(r, 0, -0.2)]
        tube("stirrer", pts, 0.085, M["gold"], parent=hub, verts=12)
        lathe("stirknob", [(0.0, -0.13), (0.1, -0.12), (0.14, -0.02), (0.12, 0.09), (0.0, 0.13)], (0, 0, up + 0.02),
              M["gold"], parent=hub, verts=16)
        # the collar where the rod goes into the putty
        lathe("stircollar", [(0.0, -0.05), (0.16, -0.05), (0.18, 0.04), (0.12, 0.12), (0.0, 0.12)], (0, 0, 0.18),
              M["gold"], parent=hub, verts=16)

    for name, fn in (("putty", putty), ("stir", stirrer)):
        e, hub = spinner(name, (0, 0, zs), 0.0, 90.0, fn)
        MOVING.append(hub)


def block():
    """The press block on the rim: a chunky worn wooden block with a pale scuffed top and two dark holes."""
    bx, by, bh = S.BLOCK_SIZE
    x, y = S.BLOCK
    b = box("block", (bx, by, bh - 0.08), (x, y, ZR - 0.02), M["block"]("X"), bevel=0.14, jitter=0.015)
    box("blocktop", (bx - 0.06, by - 0.06, 0.12), (x, y, ZR + bh - 0.16), M["blocktop"], bevel=0.05)
    for dx in (-0.36, 0.2):
        cyl(f"blockhole{dx}", 0.15, 0.06, (x + dx, y - 0.04, ZR + bh - 0.06), M["hole"], verts=16, bevel=0.0)
    return b


def wheel():
    """The gold hand wheel on a short axle out of a boss on the pot's upper band."""
    zb = ZP + S.BANDS[1]
    a = math.radians(S.WHEEL_AX)
    out = Vector((math.cos(a), math.sin(a), 0))
    base = Vector(S.polar(S.WHEEL_TH, rad_at_pot(S.BANDS[1]) + 0.04, zb))
    c = base + out * (S.WHEEL_D - S.POT_RMAX)
    ob = lathe("wheelboss", [(0.0, -0.1), (0.24, -0.1), (0.26, 0.04), (0.2, 0.14), (0.0, 0.14)], base, M["band"],
               verts=20)
    ob.rotation_euler = out.to_track_quat("Z", "Y").to_euler()
    tube("wheelaxle", [base, c + out * 0.06], 0.08, M["gold"], verts=12)
    e = bpy.data.objects.new("wheel", None)
    link(e)
    e.location = c
    e.rotation_euler = out.to_track_quat("Z", "Y").to_euler()
    handwheel("wheel", S.WHEEL_R, M["gold"], e)


def tube_and_holder(z0, z1, arm_from, foot=False, xy=S.TUBE_XY):
    """The test tube at TUBE_XY from z0 to z1 (its top): purple in glass, a white cap, a gold collar with a flared horn,
    the gold arm from arm_from (world points on the body) to the collar; with foot, a gold cup on the ground under it."""
    x, y = xy
    r = S.TUBE_R
    ln = z1 - z0
    lathe("tubeglass", [(0.0, 0.0), (r * 0.6, 0.02), (r * 0.92, 0.14), (r, 0.3), (r, ln)], (x, y, z0), M["liquid"],
          verts=28)
    cyl("tubetop", r * 1.02, 0.46, (x, y, z1 - 0.46), M["glass"], verts=28, bevel=0.02)
    lathe("tubecap", [(0.0, 0.0), (r * 1.1, 0.0), (r * 1.14, 0.07), (r * 1.08, 0.17), (r * 0.8, 0.21), (0.0, 0.22)],
          (x, y, z1 - 0.02), M["cap"], verts=28)
    zc = z1 - 0.62
    lathe("holder", [(r * 1.0, -0.3), (r * 1.42, -0.26), (r * 1.55, -0.1), (r * 1.55, 0.1), (r * 1.42, 0.26),
                     (r * 1.0, 0.3)], (x, y, zc), M["gold"], verts=28)
    a = math.radians(40.0)
    d = Vector((math.cos(a), math.sin(a), 0.0))
    base = Vector((x, y, zc)) + d * r * 1.45
    ob = lathe("holderhorn", [(0.1, 0.0), (0.11, 0.25), (0.16, 0.4), (0.3, 0.52), (0.33, 0.57), (0.0, 0.55)], base,
               M["gold"], verts=20)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    last = arm_from[-1]
    p1 = Vector((x, y, zc)) - (Vector((x, y, 0)) - Vector((last[0], last[1], 0))).normalized() * r * 1.45
    tube("tubearm", [Vector(q) for q in arm_from] + [p1], 0.085, M["gold"], verts=12)
    if foot:
        lathe("tubefoot", [(0.0, 0.0), (r * 1.7, 0.0), (r * 1.75, 0.06), (r * 1.45, 0.14), (r * 1.15, 0.36),
                           (r * 1.12, 0.42), (r * 0.9, 0.42), (r * 0.9, 0.2), (0.0, 0.2)], (x, y, 0.0), M["gold"],
              verts=28)


def blob(name, at, r, squash=0.6, mat=None, parent=None, stretch=(1.0, 1.0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=12, radius=r)
    for v in bm.verts:
        v.co.x *= stretch[0]
        v.co.y *= stretch[1]
        v.co.z *= squash
    ob = mesh_ob(name, bm, [mat or M["putty"]], parent=parent)
    ob.location = at
    return ob


def frame():
    """Level 3 up: the purple goo frame on four log stumps. A fat ball on each stump, round rails between the balls,
    two crossed straps under the pot's foot, a post up from each ball to a goo knob beside the rim, and a bracket from
    each post that clamps the pot's upper band."""
    cs = [Vector(S.corner(i)) for i in range(4)]
    zr = S.RAIL_Z
    zt = S.post_top(L)
    for i in range(4):
        a, b = cs[i], cs[(i + 1) % 4]
        tube(f"rail{i}", [(a.x, a.y, zr), (b.x, b.y, zr)], S.RAIL_R, M["purple"], verts=16)
    for i in range(2):
        a, b = cs[i], cs[i + 2]
        sweep(f"strap{i}", [(a.x, a.y, S.LIFT - 0.16), (b.x, b.y, S.LIFT - 0.16)], (0, 0, 1), 0.34, 0.32, M["purple"],
              bevel=0.1)
    zb = ZP + S.BANDS[1]
    for i, c in enumerate(cs):
        d = c.normalized()
        blob(f"postball{i}", (c.x, c.y, zr + 0.02), S.CORNER_R, 0.9, M["purple"])
        lathe(f"post{i}", [(0.0, 0.0), (S.POST_R * 1.18, 0.0), (S.POST_R, 0.4), (S.POST_R * 0.96, zt - zr - 0.5),
                           (S.POST_R * 1.05, zt - zr), (0.0, zt - zr)], (c.x, c.y, zr), M["purple"], verts=24)
        blob(f"postknob{i}", (c.x, c.y, zt + 0.14), S.KNOB_R, 0.82, M["purple"])
        # the bracket from the post in to the band (a fat goo bar with a pad on the band)
        p0 = Vector((c.x, c.y, zb))
        p1 = d * (rad_at_pot(S.BANDS[1]) + 0.07)
        sweep(f"bracket{i}", [p0, (p1.x, p1.y, zb)], (0, 0, 1), 0.3, 0.26, M["purple"], bevel=0.1)
        ob = cyl(f"bracketpad{i}", 0.2, 0.08, (p1.x, p1.y, zb), M["purple"], verts=16, bevel=0.03)
        ob.rotation_euler = Vector((d.x, d.y, 0)).to_track_quat("Z", "Y").to_euler()
        # a steel bolt in each corner ball, facing out
        p = c + d * (S.CORNER_R - 0.04)
        ob = cyl(f"bolt{i}", 0.12, 0.14, (p.x, p.y, zr + 0.02), M["steel"], verts=6, bevel=0.03)
        ob.rotation_euler = Vector((d.x, d.y, 0)).to_track_quat("Z", "Y").to_euler()
        # the log stump under the ball
        lathe(f"stump{i}", [(0.0, 0.0), (S.STUMP_R * 1.1, 0.0), (S.STUMP_R * 1.02, 0.18), (S.STUMP_R, 0.5),
                            (S.STUMP_R * 0.98, S.STUMP_H - 0.04)], (c.x, c.y, 0), M["stump"]("Z"), verts=28)
        cyl(f"stumptop{i}", S.STUMP_R * 0.98, 0.04, (c.x, c.y, S.STUMP_H - 0.04), M["stumptop"], verts=28, bevel=0.015)


def arch_pts(x):
    """The centre line of the arch in plane x: from the block's top (near foot) over to the far rim."""
    y0, y1 = S.ARCH_Y
    zl = ZR + S.BLOCK_SIZE[2] + S.ARCH_T / 2 - 0.12
    zf = ZR + 0.1 + S.ARCH_T / 2
    zc = S.z_crown(L)
    pts = []
    for k in range(29):
        s = k / 28
        y = y0 + (y1 - y0) * s
        base = zl + (zf - zl) * s
        pts.append((x, y, base + (zc - (zl + zf) / 2) * math.sin(math.pi * s) ** 0.75))
    return pts


def arches():
    """Level 3 up: two chunky bone arches over the pot, from the press block to the far rim, with knuckles at the
    feet and a seat on the far rim."""
    for i, x in enumerate(S.ARCH_X):
        pts = arch_pts(x)
        sweep(f"arch{i}", pts, (1, 0, 0), S.ARCH_W, S.ARCH_T, M["bone"], bevel=0.1,
              taper=lambda s: 1.2 - 0.26 * math.sin(math.pi * s))
        for k, p in ((0, pts[1]), (1, pts[-2])):
            blob(f"archknuckle{i}{k}", p, 0.34, 0.85, M["bone"])
        y1 = S.ARCH_Y[1]
        box(f"archseat{i}", (0.56, 0.4, 0.14), (x, y1 + 0.02, ZR + 0.02), M["bone"], bevel=0.05)


def helix(name, c, r, z0, z1, turns, wire, mat, axis=None, parent=None):
    """A coil of wire round centre c (world), from z0 to z1 along local Z (axis: the coil's direction, default up)."""
    n = int(turns * 24)
    pts = [(r * math.cos(2 * math.pi * turns * i / n), r * math.sin(2 * math.pi * turns * i / n),
            z0 + (z1 - z0) * i / n) for i in range(n + 1)]
    ob = tube(name, pts, wire, mat, parent=parent, verts=10)
    ob.location = c
    if axis is not None:
        ob.rotation_euler = Vector(axis).to_track_quat("Z", "Y").to_euler()
    return ob


def hub_top(y=0.0):
    return S.z_hub(L) + math.sqrt(max(0.0, S.HUB_R ** 2 - y ** 2))


def hub():
    """Level 6 up: a round drum hub across the arches' crown (rounded ends, a raised ring round a dark axle hole on its
    right end), the flask on its top with a glass loop (level 6; the coil takes its place at level 10), the valve wheel
    on a shaft out to the front left and the gold arm out to the right that holds the test tube."""
    zh = S.z_hub(L)
    hr, hl = S.HUB_R, S.HUB_L
    lathe("hub", [(0.0, -hl), (hr * 0.6, -hl), (hr * 0.86, -hl + 0.08), (hr * 0.98, -hl + 0.24), (hr, -hl + 0.4),
                  (hr, hl - 0.4), (hr * 0.98, hl - 0.24), (hr * 0.86, hl - 0.08), (hr * 0.6, hl), (0.0, hl)],
          (0, 0, zh), M["bone"], rot=(0, 90, 0), verts=40)
    for k, xx in enumerate((-hl + 0.42, hl - 0.42)):
        lathe(f"hubband{k}", [(hr - 0.02, -0.1), (hr + 0.05, -0.09), (hr + 0.06, 0.0), (hr + 0.05, 0.09),
                              (hr - 0.02, 0.1)], (xx, 0, zh), M["band"], rot=(0, 90, 0), verts=40)
    lathe("hubring", [(0.0, -0.05), (0.42, -0.05), (0.45, 0.06), (0.38, 0.14), (0.26, 0.14), (0.22, 0.06), (0.0, 0.06)],
          (hl - 0.03, 0, zh), M["band"], rot=(0, 90, 0), verts=28)
    ob = cyl("hubhole", 0.21, 0.04, (hl + 0.1, 0, zh), M["hole"], verts=20, bevel=0.0)
    ob.rotation_euler = (0, math.radians(90), 0)
    # the flask on a gold collar on the hub's top, in the middle
    ztop = hub_top()
    lathe("flaskcollar", [(0.0, -0.08), (0.24, -0.08), (0.26, 0.04), (0.2, 0.12), (0.0, 0.12)], (0, 0, ztop),
          M["gold"], verts=20)
    lathe("flask", [(0.0, 0.0), (0.18, 0.0), (0.38, 0.12), (0.46, 0.34), (0.42, 0.56), (0.26, 0.72), (0.14, 0.8),
                    (0.13, 0.96), (0.0, 0.96)], (0, 0, ztop + 0.08), M["liquid"], verts=28)
    lathe("flaskneck", [(0.0, 0.0), (0.15, 0.0), (0.16, 0.18), (0.19, 0.22), (0.0, 0.24)], (0, 0, ztop + 0.92),
          M["glass"], verts=20)
    if L < 10:
        # the glass loop from the flask's neck up, over and down into a knob on the hub's right shoulder
        p0 = Vector((0.0, 0.0, ztop + 1.1))
        p1 = Vector((0.62, 0.0, hub_top() - 0.02))
        top = p0.z + 0.55
        pts = [p0, Vector((0, 0, top - 0.26))]
        for i in range(1, 9):
            a = math.pi * i / 9
            pts.append(Vector((p1.x / 2 - p1.x / 2 * math.cos(a), 0.0, top - 0.26 + 0.26 * math.sin(a))))
        pts += [Vector((p1.x, 0.0, top - 0.26)), p1 + Vector((0, 0, 0.18))]
        tube("flaskloop", pts, 0.075, M["glass"], verts=12)
        lathe("hubknob", [(0.0, -0.12), (0.2, -0.12), (0.22, 0.06), (0.17, 0.16), (0.11, 0.16), (0.11, 0.1), (0.0, 0.1)],
              p1, M["band"], verts=20)
    # the valve wheel on its shaft along -Y, rising a little
    zv = zh + S.VALVE_UP
    tube("valveshaft", [(0.0, -hr + 0.1, zh), (0.0, -hr - 0.45, zh), (0.0, S.VALVE_Y + 0.55, zv),
                        (0.0, S.VALVE_Y - 0.14, zv)], 0.08, M["gold"], verts=12)
    e = bpy.data.objects.new("valve", None)
    link(e)
    e.location = (0.0, S.VALVE_Y, zv)
    e.rotation_euler = Vector((0, -1, 0)).to_track_quat("Z", "Y").to_euler()
    handwheel("valve", S.VALVE_R, M["gold"], e, spokes=5)
    # the arm out of the hub's right ring to the tube's collar
    zt = S.TUBE_TOP6
    tube_and_holder(zt - S.TUBE_LEN6, zt, [(hl - 0.05, 0.12, zh + 0.12), (hl + 0.35, 0.2, zh + 0.1)], xy=S.TUBE_XY6)


def cage():
    """Level 10: the cage wheel on an axle out of the hub's back: two fat gold rims with four spokes, eight rungs, a
    lump of putty on every rung and a strand sagging between every other pair. It turns (two rungs a loop)."""
    zh = S.z_hub(L)
    y0, y1 = S.CAGE_Y - S.CAGE_W / 2, S.CAGE_Y + S.CAGE_W / 2
    zc = zh + S.CAGE_UP
    tube("cageaxle", [(0.0, S.HUB_R - 0.12, zh), (0.0, S.HUB_R + 0.2, zh), (0.0, S.HUB_R + 0.45, zc), (0.0, y1 + 0.18, zc)],
         0.1, M["steel"], verts=12)
    lathe("cageaxlecap", [(0.0, 0.0), (0.16, 0.0), (0.17, 0.08), (0.1, 0.14), (0.0, 0.14)], (0.0, y1 + 0.16, zc),
          M["steel"], rot=(-90, 0, 0), verts=16)
    rnd = R(31)

    def parts(hub):
        rr = S.CAGE_R
        for k, z in enumerate((-S.CAGE_W / 2, S.CAGE_W / 2)):
            ring(f"cagerim{k}", rr, 0.095, M["gold"], hub, z=z)
            for j in range(4):
                a = 2 * math.pi * (j + 0.5) / 4
                tube(f"cagespoke{k}{j}", [(0, 0, z), (rr * math.cos(a), rr * math.sin(a), z)], 0.065, M["gold"],
                     parent=hub, verts=10)
            lathe(f"cagehub{k}", [(0.0, -0.1), (0.2, -0.1), (0.22, 0.0), (0.2, 0.1), (0.0, 0.1)], (0, 0, z),
                  M["gold"], parent=hub, verts=20)
        for j in range(S.CAGE_RUNGS):
            a = 2 * math.pi * j / S.CAGE_RUNGS
            c, sn = math.cos(a), math.sin(a)
            tube(f"cagerung{j}", [(rr * c, rr * sn, -S.CAGE_W / 2), (rr * c, rr * sn, S.CAGE_W / 2)], 0.07, M["gold"],
                 parent=hub, verts=10)
            # a fat lump of putty on the rung, longer along it
            ob = blob(f"cageputty{j}", ((rr - 0.02) * c, (rr - 0.02) * sn, rnd.uniform(-0.1, 0.1)), 0.25, 1.6,
                      M["putty"], parent=hub)
            ob.rotation_euler = (0, 0, a)
            if j % 2 == 0:
                b = a + math.pi / S.CAGE_RUNGS
                a2 = a + 2 * math.pi / S.CAGE_RUNGS
                tube(f"cagestring{j}", [((rr - 0.08) * c, (rr - 0.08) * sn, 0.05),
                                        ((rr - 0.42) * math.cos(b), (rr - 0.42) * math.sin(b), 0.0),
                                        ((rr - 0.08) * math.cos(a2), (rr - 0.08) * math.sin(a2), -0.05)],
                     0.11, M["putty"], parent=hub, verts=10, r_end=0.08)
    e, h = spinner("cage", (0.0, S.CAGE_Y, zc), 90.0, 0.0, parts)
    MOVING.append(h)
    # the coil: from the flask's neck out over the valve shaft to a purple bulb on a stem from the shaft
    ztop = hub_top()
    zc = ztop + 1.45
    yb = S.VALVE_Y + 0.45
    zb = zh + S.VALVE_UP + 0.9
    cyl("coilstem", 0.07, zb - (zh + S.VALVE_UP) - 0.26, (0.0, yb, zh + S.VALVE_UP), M["gold"], verts=12)
    lathe("coilbulb", [(0.36 * math.sin(math.pi * i / 14), -0.33 * math.cos(math.pi * i / 14)) for i in range(15)],
          (0.0, yb, zb), M["liquid"], verts=24)
    tube("coillead", [(0.0, 0.0, ztop + 1.1), (0.0, 0.0, zc - 0.2), (0.0, -0.2, zc), (0.0, -0.62, zc)], 0.07,
         M["steel"], verts=10)
    helix("coil", (0.0, -0.62, zc), 0.34, 0.0, -0.62 - (yb + 0.4), 3.5, 0.07, M["steel"], axis=(0, -1, 0))
    tube("coillead2", [(0.0, yb + 0.4, zc), (0.0, yb, zc), (0.0, yb, zb + 0.3)], 0.07, M["steel"], verts=10)
    # springs round the stumps
    for i in range(4):
        s_ = Vector(S.corner(i))
        helix(f"spring{i}", (s_.x, s_.y, 0.0), S.STUMP_R + 0.08, 0.12, S.STUMP_H - 0.28, 3.0, 0.07, M["steel"])


def drips():
    """Level 10: putty slopped over the arches' backs and over the front of the pot's rim, running down in fat drips
    that end in a drop."""
    rnd = R(41)
    for i, x in enumerate(S.ARCH_X):
        pts = arch_pts(x)
        j = 5 if i == 0 else 21      # clear of the hub and, on screen, of the tube arm
        p = Vector(pts[j])
        top = p.z + S.ARCH_T / 2 * 0.98
        blob(f"drip{i}", (x, p.y, top), 0.3, 0.42, stretch=(1.0, 1.25))
        side = -1 if i == 0 else 1
        w = S.ARCH_W / 2 + 0.04
        z1 = top - 0.55 - rnd.uniform(0.0, 0.2)
        end = Vector((x + side * w, p.y + 0.05, z1))
        tube(f"driprun{i}", [(x + side * 0.12, p.y, top + 0.04), (x + side * w * 0.9, p.y, top - 0.06),
                             (x + side * w, p.y + 0.02, top - 0.3), end], 0.15, M["putty"], verts=12, r_end=0.09)
        blob(f"dripdrop{i}", end + Vector((0, 0, -0.04)), 0.12, 1.25)
    for k, th in enumerate((-39.0, -15.0, 9.0, 62.0)):     # clear of the block, the brackets and the post knobs
        z1 = ZR - 0.45 - rnd.uniform(0.0, 0.6)
        pts = [S.polar(th, S.POT_R - 0.3, ZR + 0.1), S.polar(th, S.POT_R - 0.04, ZR + 0.14),
               S.polar(th, S.POT_R + 0.07, ZR - 0.04), S.polar(th + 1.0, rad_at_pot(ZR - 0.35 - ZP) + 0.11, ZR - 0.35),
               S.polar(th + 2.0, rad_at_pot(z1 - ZP) + 0.1, z1)]
        tube(f"driprim{k}", pts, 0.18, M["putty"], verts=12, r_end=0.09)
        blob(f"driprimdrop{k}", Vector(pts[-1]) + Vector((0, 0, -0.05)), 0.12, 1.25)


def build():
    pot()
    putty_and_stirrer()
    block()
    wheel()
    x, y = S.TUBE_XY
    if L < 6:
        top = S.TUBE_TOP[0 if L < 3 else 1]
        a = math.atan2(y, x)
        zc = top - 0.62
        tube_and_holder(0.0, top, [(S.POT_R * 0.95 * math.cos(a), S.POT_R * 0.95 * math.sin(a), ZR + 0.02),
                                   ((S.POT_R + 0.3) * math.cos(a), (S.POT_R + 0.3) * math.sin(a), ZR + 0.02),
                                   ((S.POT_R + 0.6) * math.cos(a), (S.POT_R + 0.6) * math.sin(a), zc)], foot=True)
    if L >= 3:
        frame()
        arches()
    if L >= 6:
        hub()
    if L >= 10:
        cage()
        drips()


def turn(frame):
    """Turn the moving parts to Flash frame `frame` of FRAMES, at an even speed (as Flash's): the stirrer three times
    round and the putty once (clockwise from above), at level 10 the cage two rungs (anticlockwise on screen)."""
    f = frame / FRAMES
    for hub in MOVING:
        hub.rotation_euler = (0, 0, math.radians(TURNS[hub.parent.name] * f))


TURNS = {"stir": -S.STIR_TURN, "putty": -S.PUTTY_TURN, "cage": -S.CAGE_TURN}


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



FAMILY = (("stir", "stirrer"), ("putty", "putty"), ("cage", "cage"), ("potrim", "rim"), ("potband", "pot"), ("potfoot", "pot"),
          ("potrivet", "pot"), ("potin", "potin"), ("pot", "pot"), ("wheelboss", "pot"), ("wheel", "wheel"),
          ("blockhole", "block"), ("block", "block"), ("tubearm", "arm"), ("tube", "tube"), ("holder", "tube"),
          ("rail", "frame"), ("strap", "frame"), ("postball", "frame"), ("postknob", "frame"), ("post", "post"),
          ("bracket", "bracket"), ("bolt", "frame"), ("stumptop", "stump"), ("stump", "stump"),
          ("archseat", "arch"), ("arch", "arch"), ("hub", "hub"), ("flask", "flask"), ("valve", "valve"),
          ("coil", "coil"), ("spring", "spring"), ("drip", "drip"))


MASONRY = ()


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
                    if fa == fb or (fa in MASONRY and fb in MASONRY):
                        continue
                    n = len(ta.overlap(tb))
                    if n:
                        hits.setdefault(tuple(sorted((fa, fb))), []).append((a.name, b.name, n))
            for key, v in sorted(hits.items()):
                print("CHECK f%02d" % k, key, sum(x[2] for x in v), v[:3])
            fams = sorted({family(o) for o, _, _ in obs if under_moving(o)})
            for fm in fams:
                best = (9.0, "", "", "")
                for o, t, vs in obs:
                    if family(o) != fm:
                        continue
                    for o2, t2, _ in obs:
                        f2 = family(o2)
                        if f2 == fm:
                            continue
                        for v in vs[::2]:
                            hit = t2.find_nearest(v, best[0])
                            if hit[0] is not None and hit[3] < best[0]:
                                best = (hit[3], f2, o.name, o2.name)
                print("CLEAR f%02d %s nearest other part %.3f (%s)" % (k, fm, best[0], " ".join(best[1:])))
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
            print("GAP %-7s in front of %-7s: least depth gap %.3f, rays under 0.05: %d of %d (%.1f px2), screen box "
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
