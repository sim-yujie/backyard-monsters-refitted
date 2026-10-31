"""academy.py : the Monster Academy (Flash building 26) as a 3D model, in the approved buildings' family (same camera,
light, render settings and scale; no outline), matched to Flash's glossy render: steel-blue dome, polished gold trim,
black foot, glowing glass. One body for every level, parts at fixed points on it (stack.py); each level is the level
below plus upgrades (level 3 is Flash's redesign, see stack.py).

    blender -b --factory-startup -P academy.py -- <level> fit      work/fit-L<level>.png  quick render, 4 px per Flash px
    blender -b --factory-startup -P academy.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P academy.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P academy.py -- <level> check    CHECK lines: parts whose meshes overlap
    blender -b --factory-startup -P academy.py -- <level> gap      GAP lines: parts in front of others from the camera
    blender -b --factory-startup -P academy.py -- <level> probe sx sy ...   what the camera sees first through Flash px

Animation, as Flash: the gold blocks in the dome's opening turn about the upright once a loop (21 frames) at an even
speed. Nothing else moves. The base picture is rendered once (the blocks hidden from the camera); each frame renders
only the blocks with every still part as a holdout, and post.py lays that layer over the base.
The shared helpers (materials, meshes, camera, checks) come from the HCC's hcc.py (art/buildings-3d-hcc).
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

V = S.Lv(LEVEL)
FRAMES = S.FRAMES
EL = 30.0
ORIGIN = V.ORIGIN                     # Flash pixel of the world origin (the dome's axis on the ground)
GROUND = S.GROUND
FRAME = tuple(int(c) for c in os.environ["PB_FRAME"].split(",")) if os.environ.get("PB_FRAME") else \
    (-76, -44, 94, 92)                # the canvas in Flash px (as fref.FRAME)
K = int(os.environ.get("PB_K", 4 if MODE == "fit" else 12))     # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(2600)


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
          streak=0.0, side=0.0, glow=(), lit=None):
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
    if lit:                        # faces turned to the light wash out to a cream colour (Flash's bright gold faces)
        d, col2, lo, hi = lit
        geo = t.n("ShaderNodeNewGeometry")
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Normal"], dp.inputs[0])
        dp.inputs[1].default_value = Vector(d).normalized()
        mr = t.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        mr.inputs[1].default_value, mr.inputs[2].default_value = lo, hi
        t.link(dp.outputs["Value"], mr.inputs[0])
        out = t.mix(out, srgb(*col2), mr.outputs[0])
        t.set(**{"Emission Color": srgb(*col2), "Emission Strength": mr.outputs[0]})
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




def materials():
    M = {}
    # the dome: Flash's glossy steel blue, bright white sheen up on the left, darker grey-lavender on the right
    hi = (-12.0, 12.0) if not V.ribbed else (-15.0, 5.0 - (19.0 if L >= 4 else 0.0))
    M["dome"] = shiny("dome", (108, 114, 127), rough=0.42, metal=0.15, wear=(88, 93, 104), scale=4.0, dirt=0.5,
                      side=-0.8, spec=0.4, glow=((hi[0], hi[1], 11.0, 14.0, 0.26, (226, 234, 244)),))
    M["seam"] = shiny("seam", (78, 82, 92), rough=0.4, metal=0.5, scale=3, dirt=0.1)
    M["plate"] = shiny("plate", (90, 96, 106), rough=0.42, metal=0.15, wear=(78, 83, 93), scale=2.0, dirt=0.15,
                       side=-0.5)
    M["gold"] = shiny("gold", (250, 152, 18), rough=0.26, metal=0.6, side=0.3, wear=(255, 196, 70), scale=1.5,
                      dirt=0.12, streak=0.3, coat=0.15)
    M["bandgold"] = shiny("bandgold", (236, 146, 24), rough=0.35, metal=0.2, side=0.3, wear=(250, 180, 60), scale=1.5,
                          dirt=0.1, spec=0.5)
    M["golddark"] = shiny("golddark", (176, 100, 18), rough=0.3, metal=0.75, wear=(210, 140, 40), scale=1.5, dirt=0.4)
    M["blockgold"] = shiny("blockgold", (196, 128, 18), rough=0.28, metal=0.7, wear=(140, 92, 18), scale=2.0,
                           dirt=0.9, ao_min=0.02, coat=0.3, spec=0.6, lit=((-0.55, -0.8, 0.25), (255, 238, 170), 0.5, 0.82))
    M["foot"] = shiny("foot", (14, 13, 13), rough=0.6, metal=0.1, wear=(22, 21, 21), scale=3, dirt=0.0, spec=0.15)
    M["hole"] = flat("hole", (10, 8, 8), rough=1.0)
    M["pit"] = shiny("pit", (16, 11, 7), rough=0.5, metal=0.3, scale=3, dirt=0.0)
    M["rim"] = shiny("rim", (150, 158, 170), rough=0.28, metal=0.6, wear=(130, 136, 150), scale=3, dirt=0.05)
    # the opening's inner wall: dark like Flash's (a pale wall glowed cream with the blocks' light)
    M["innerwall"] = shiny("innerwall", (38, 38, 44), rough=0.45, metal=0.4, wear=(30, 30, 36), scale=3, dirt=0.3)
    M["rib"] = painted("rib", (128, 130, 144), rough=0.5, metal=0.3, wear=(108, 108, 122), scale=5.0, dirt=0.35,
                       spec=0.3)
    M["ribend"] = painted("ribend", (176, 178, 190), rough=0.4, metal=0.35, wear=(150, 150, 164), scale=5.0, dirt=0.1)
    M["glass"] = flat("glass", (150, 222, 240), rough=0.15, emit=0.9)
    M["glassframe"] = shiny("glassframe", (60, 70, 80), rough=0.35, metal=0.6, scale=3, dirt=0.1)
    return M


# ------------------------------------------------------------------------------------------------------------ helpers
def ball(th, ph, r=None):
    """World point on the ball at bearing th, elevation ph (degrees), radius r (default the ball's)."""
    r = V.DOME_R if r is None else r
    a, e = math.radians(th), math.radians(ph)
    return Vector((r * math.cos(e) * math.cos(a), r * math.cos(e) * math.sin(a), V.DOME_C + r * math.sin(e)))


def frame_at(th, ph):
    """Unit vectors on the ball at (th, ph): normal n, 'up' u (toward the top), 'across' s (bearing increasing)."""
    a, e = math.radians(th), math.radians(ph)
    n = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    s = Vector((-math.sin(a), math.cos(a), 0.0))
    u = n.cross(s).normalized() * -1
    if u.z < 0:
        u = -u
    return n, u, s


def orient(ob, n, u, s):
    """Turn ob so its local X = s, Y = u, Z = n."""
    m = Matrix((s, u, n)).transposed()
    ob.rotation_euler = m.to_euler()
    return ob


# ------------------------------------------------------------------------------------------------------------ the body
def body():
    R, C = V.DOME_R, V.DOME_C
    e_open = math.degrees(math.asin((V.OPEN_Z - C) / R))
    e_low = math.degrees(math.asin((V.BAND_Z1 - 0.05 - C) / R)) if not V.ribbed else V.WALL_E
    prof = []
    if V.ribbed:                     # a flat underside from the collar out to the wall, the wall up to the seam
        rw = R * math.cos(math.radians(V.WALL_E))
        prof += [(V.TANK_R - 0.1, V.DOME_Z0), (rw + 0.02, V.DOME_Z0), (rw + 0.06, V.DOME_Z0 + 0.06),
                 (rw + 0.03, V.DOME_Z0 + 0.3)]
    else:
        prof.append((V.FOOT_R - 0.2, V.BAND_Z1 - 0.05))
    n = 40
    for i in range(n + 1):
        e = math.radians(e_low + (e_open - e_low) * i / n)
        prof.append((R * math.cos(e), C + R * math.sin(e)))
    # the lip round the opening: rounded over, then the inner wall down into the pit
    lip = 0.22
    prof += [(V.OPEN_R - 0.04, V.OPEN_Z + 0.06), (V.OPEN_R - lip * 0.5, V.OPEN_Z + 0.07),
             (V.OPEN_R - lip, V.OPEN_Z + 0.02), (V.OPEN_R - lip, V.OPEN_Z - 0.3)]
    lathe("dome", prof, (0, 0, 0), M["dome"], verts=128)
    prof[-1] = (V.OPEN_R - lip, V.OPEN_Z - 0.3)
    lathe("domewall", [(V.OPEN_R - lip, V.OPEN_Z - 0.3), (V.OPEN_R - lip, V.OPEN_Z - 0.75)], (0, 0, 0), M["innerwall"],
          verts=64)
    lathe("domeinner", [(V.OPEN_R - lip, V.OPEN_Z - 0.75), (V.OPEN_R - lip, V.OPEN_Z - 1.9), (0.0, V.OPEN_Z - 1.9)],
          (0, 0, 0), M["pit"], verts=64)
    if not V.ribbed:
        # the black foot ring under the dome and the gold band round its middle
        lathe("foot", [(V.FOOT_R - 0.15, 0.0), (V.FOOT_R - 0.05, 0.03), (V.FOOT_R, 0.2), (V.FOOT_R, V.FOOT_Z),
                       (0.0, V.FOOT_Z)], (0, 0, 0), M["foot"], verts=96)
        # a flat upright face with rounded edges (Flash: an orange band lit all down its front)
        prof = [(R - 0.3, V.BAND_Z0), (V.BAND_R - 0.1, V.BAND_Z0), (V.BAND_R - 0.02, V.BAND_Z0 + 0.06),
                (V.BAND_R, V.BAND_Z0 + 0.16), (V.BAND_R, V.BAND_Z1 - 0.14), (V.BAND_R - 0.03, V.BAND_Z1 - 0.05),
                (V.BAND_R - 0.12, V.BAND_Z1), (R - 0.3, V.BAND_Z1 + 0.02)]
        lathe("band", prof, (0, 0, 0), M["gold"], verts=128)
    else:
        lathe("foot", [(V.FOOT_R - 0.08, 0.0), (V.FOOT_R, 0.06), (V.FOOT_R, V.FOOT_Z - 0.06),
                       (V.FOOT_R - 0.06, V.FOOT_Z), (0.0, V.FOOT_Z)], (0, 0, 0), M["foot"], verts=96)
        lathe("band", [(V.BAND_R0 - 0.1, V.BAND_Z0 - 0.02), (V.BAND_R0, V.BAND_Z0), (V.BAND_R - 0.04, V.BAND_Z1 - 0.08),
                       (V.BAND_R, V.BAND_Z1 - 0.03), (V.BAND_R - 0.06, V.BAND_Z1), (V.TANK_R - 0.2, V.BAND_Z1)],
              (0, 0, 0), M["bandgold"], verts=128)
        tank()
        ribs()
    seams()
    for th, ph, side, at in V.PORTS:
        porthole(th, ph, side, at)
    for th, ph, at in V.FINS:
        fin(th, ph, at)


def tank():
    """The glass ring (level 3) / tank (level 4): glowing cyan glass on the gold bowl, a dark collar above it up to the
    dome's lower edge (Flash: a black band under the dome)."""
    z0, z1 = V.BAND_Z1 - 0.02, V.GLASS_Z1
    cyl("tank", V.TANK_R, z1 - z0, (0, 0, z0), M["glass"], verts=96, bevel=0.0)
    cyl("tankcollar", V.TANK_R + 0.04, V.DOME_Z0 + 0.05 - z1, (0, 0, z1), M["foot"], verts=96, bevel=0.02)
    ring("tankring", V.TANK_R + 0.01, 0.05, M["glassframe"], z=z0 + 0.04, n=96)
    if False:                   # upright frame bars in the glass (Flash shows none)
        for th in range(-180, 180, 30):
            a = math.radians(th + 15)
            p0 = (V.TANK_R * math.cos(a), V.TANK_R * math.sin(a), z0 + 0.05)
            p1 = (V.TANK_R * math.cos(a), V.TANK_R * math.sin(a), z1 - 0.05)
            tube("tankbar", [p0, p1], 0.035, M["glassframe"], verts=8)


def seams():
    """Faint panel seams on the dome, where Flash draws them (levels 1-2: a ring just under the opening on the left,
    one upright at the front, a panel on the upper right; level 3 on: the plates between the ribs)."""
    R = V.DOME_R + 0.005

    def mer(th, e0, e1):
        tube("seam", [ball(th, e0 + (e1 - e0) * i / 16, R) for i in range(17)], 0.024, M["seam"], verts=6)

    def lat(e, t0, t1):
        n = max(2, int(abs(t1 - t0) / 3))
        tube("seam", [ball(t0 + (t1 - t0) * i / n, e, R) for i in range(n + 1)], 0.024, M["seam"], verts=6)

    if not V.ribbed:
        lat(50.0, -112.0, -39.0)
        mer(-39.0, 1.0, 50.0)
        mer(-22.0, 33.0, 58.0)
        lat(33.0, -22.0, 48.0)
    else:
        for th in (-45.0, 45.0, 135.0, -135.0):
            mer(th, V.WALL_E, 56.0)
            lat(V.WALL_E, th - 22.0, th + 22.0)
            rw = R * math.cos(math.radians(V.WALL_E)) + 0.035          # and on down the straight wall
            tube("seam", [P(th, rw, V.DOME_Z0 + 0.08), P(th, rw, V.DOME_C + R * math.sin(math.radians(V.WALL_E)))],
                 0.024, M["seam"], verts=6)


def on_ball(sx, sy, r):
    """The front point of the ball (radius r) on Flash pixel (sx, sy)."""
    el, az = math.radians(EL), math.radians(-45)
    fwd = -Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    o = px(sx, sy, Z=10.0) - fwd * 30
    c = Vector((0, 0, V.DOME_C))
    b = (o - c).dot(fwd)
    d = b * b - ((o - c).length ** 2 - r * r)
    return o + fwd * (-b - math.sqrt(max(0.0, d)))


def porthole(th, ph, side, at):
    """A flat square plate set into the ball's side at Flash pixel `at`, its face turned toward bearing th and up by ph
    (Flash turns it toward the viewer, so its outer edge stands out past the dome's outline); a dark round hole toward
    the outer edge, gold frame bars on the inner and top edges, gold rivets."""
    a, e = math.radians(th), math.radians(ph)
    n = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    sv = Vector((-math.sin(a), math.cos(a), 0.0))
    u = n.cross(sv).normalized()
    if u.z < 0:
        u = -u
    sv = u.cross(n).normalized()
    hw, hh = S.PORT_HALF
    T = 0.4
    c = on_ball(at[0], at[1], V.DOME_R - 0.05)
    C = Vector((0, 0, V.DOME_C))
    inner = -1 if side == "right" else 1               # local X toward the edge that goes into the ball

    grid = [(x / 4.0, y / 4.0) for x in range(-4, 5) for y in range(-4, 5)]

    def least(c):                                      # how far the face's most sunken point stands out of the ball
        return min((c + sv * (hw * x) + u * (hh * y) + n * T - C).length - V.DOME_R for x, y in grid)
    for _ in range(40):                                # slide it out until all its face shows
        d = 0.03 - least(c)
        c = c + n * d
        if abs(d) < 1e-3:
            break
    back = max((c + sv * (hw * inner) + u * y - C).length - V.DOME_R for y in (-hh, 0.0, hh))
    print("PORT inner edge back corners at most %.3f out of the ball (the backing block reaches 0.88 deeper)" % back)
    e = bpy.data.objects.new("port", None)
    link(e)
    e.location = c
    orient(e, n, u, sv)
    box("portplate", (2 * hw, 2 * hh, T), (0, 0, 0), M["plate"], parent=e, bevel=0.06)
    box("portback", (2 * hw - 0.12, 2 * hh - 0.12, 0.9), (0, 0, -0.88), M["plate"], parent=e, bevel=0.03)   # into the ball
    out = -1 if side == "left" else 1                 # local X toward the plate's outer edge
    hx = 0.28 * out
    cyl("porthole", S.PORT_HOLE, 0.2, (hx, 0.0, T - 0.15), M["hole"], parent=e, verts=32, bevel=0.0)
    lathe("portcollar", [(S.PORT_HOLE, T - 0.1), (S.PORT_HOLE + 0.03, T + 0.01), (S.PORT_HOLE + 0.1, T + 0.01),
                         (S.PORT_HOLE + 0.13, T)], (hx, 0.0, 0), M["seam"], parent=e, verts=32)
    gx = -(hw - 0.18) * out                           # the upright bar: on the inner edge
    box("portgold", (0.36, 2 * hh, 0.16), (gx, 0, T - 0.02), M["gold"], parent=e, bevel=0.05)
    box("portgold", (1.3 * hw, 0.28, 0.16), (-0.35 * hw * out, hh - 0.14, T - 0.02), M["gold"], parent=e, bevel=0.05)
    for x, y in ((-0.63, 0.8), (0.75, 0.0), (-1.05, -0.5), (0.53, -1.0)):      # x toward the inner edge
        lathe("portrivet", [(0.0, 0.18), (0.13, 0.15), (0.19, 0.0)], (x * inner, y, T - 0.02), M["gold"], parent=e,
              verts=12)


def seat(th, ph, at, hw, hh, T):
    """A flat block's frame on the ball: face turned to bearing th, up by ph, its middle on Flash pixel `at`, slid out
    until its whole face (hw x hh, thickness T) stands out of the ball. Returns (centre, n, u, s)."""
    a, e = math.radians(th), math.radians(ph)
    n = Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))
    sv = Vector((-math.sin(a), math.cos(a), 0.0))
    u = n.cross(sv).normalized()
    if u.z < 0:
        u = -u
    sv = u.cross(n).normalized()
    c = on_ball(at[0], at[1], V.DOME_R - 0.05)
    C = Vector((0, 0, V.DOME_C))
    grid = [(x / 4.0, y / 4.0) for x in range(-4, 5) for y in range(-4, 5)]
    for _ in range(40):
        d = 0.03 - min((c + sv * (hw * x) + u * (hh * y) + n * T - C).length - V.DOME_R for x, y in grid)
        c = c + n * d
        if abs(d) < 1e-3:
            break
    return c, n, u, sv


def fin(th, ph, at):
    """Level 2: a steel wing plate standing proud on each back shoulder, its sides gold (Flash shows the gold edges
    under it and its top standing up past the dome's outline); a block behind it reaches into the dome."""
    hw, hh, T = S.FIN
    c, n, u, sv = seat(th, ph, at, hw, hh, T)
    e = bpy.data.objects.new("fin", None)
    link(e)
    e.location = c
    orient(e, n, u, sv)
    box("fingold", (2 * hw, 2 * hh, T - 0.08), (0, 0, 0), M["gold"], parent=e, bevel=0.05)
    box("finplate", (2 * hw - 0.08, 2 * hh - 0.08, 0.14), (0, 0, T - 0.12), M["plate"], parent=e, bevel=0.05)
    box("finback", (2 * hw - 0.3, 2 * hh - 0.3, 1.2), (0, 0, -1.18), M["golddark"], parent=e, bevel=0.03)


def resample(pts, n):
    """n points evenly along the polyline pts (2D tuples)."""
    pts = [Vector(p) for p in pts]
    d = [0.0]
    for p, q in zip(pts, pts[1:]):
        d.append(d[-1] + (q - p).length)
    out = []
    for i in range(n):
        t = d[-1] * i / (n - 1)
        k = max(j for j in range(len(d)) if d[j] <= t + 1e-9)
        k = min(k, len(pts) - 2)
        f = (t - d[k]) / max(1e-9, d[k + 1] - d[k])
        out.append(pts[k].lerp(pts[k + 1], f))
    return out


def bez(p0, t0, p3, t3, n):
    """n points on the cubic from p0 (leaving along t0) to p3 (arriving along t3)."""
    L = (p3 - p0).length * 0.5
    p1, p2 = p0 + t0.normalized() * L, p3 - t3.normalized() * L
    return [(1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
            for t in (i / (n - 1) for i in range(n))]


def rib_profile(th):
    """The rib's side outline in its (r, z) plane, as matching outer and inner lines from its top end on the dome down
    to the plinth. Flash draws an arched strap: the outer line a quarter ellipse (flat over the shoulder, round, then
    upright at RIB_OUT), the strap thin (RIB_T at the top end, RIB_TU down the upright); near the top it rests on the
    ball, lower down it stands off the dome with a dark gap behind it."""
    R, C = V.DOME_R, V.DOME_C
    zv = S.RIB_ZV + (S.TANK_RISE if L >= 4 else 0.0)
    a, b = S.RIB_OUT - S.RIB_RC, S.RIB_B
    zb = S.PLINTH[2] - 0.05
    end = math.radians(S.RIB_ENDS[th])
    # the ellipse from upright (t = 0) to the top (t = 90), cut where it reaches the end elevation on the ball
    arc = []
    for i in range(121):
        t = math.radians(90.0 * i / 120)
        p = Vector((S.RIB_RC + a * math.cos(t), zv + b * math.sin(t)))
        if math.atan2(p.y - C, p.x) > end:
            break
        arc.append(p)
    arc.reverse()                                  # top end first
    o = arc + [Vector((S.RIB_OUT, zv + (zb - zv) * k / 8)) for k in range(1, 9)]
    o = resample(o, 48)
    inn = []
    for i, p in enumerate(o):
        q = o[min(i + 1, len(o) - 1)] - o[max(i - 1, 0)]
        nrm = Vector((-q.y, q.x)).normalized()          # toward the inside (the axis side) of the curve
        if nrm.x > 0:
            nrm = -nrm
        f = min(1.0, max(0.0, (zv + b * 0.6 - p.y) / (b * 0.6)))   # thickness: RIB_T at the top, RIB_TU upright
        w = S.RIB_T + (S.RIB_TU - S.RIB_T) * f
        c = p + nrm * w
        d = c - Vector((0.0, C))
        if d.length < R - 0.05:                     # rests on the dome: the inner face lies on the ball
            c = Vector((0.0, C)) + d.normalized() * (R - 0.05)
        g = min(1.0, i / 10.0)                       # the top end reaches down onto the dome (seated, not floating)
        g = g * g * (3 - 2 * g)
        z_seam = C + R * math.sin(math.radians(V.WALL_E))
        if p.y >= z_seam:
            seat_ = Vector((0.0, C)) + (p - Vector((0.0, C))).normalized() * (R - 0.08)
        else:                                        # below the seam the dome is the straight wall
            seat_ = Vector((R * math.cos(math.radians(V.WALL_E)) - 0.06, p.y))
        if c.x > seat_.x:
            c = seat_.lerp(c, g)
        inn.append(c)
    return o, inn


def rib_mesh(name, th, mat):
    """The rib at bearing th: the side outline extruded RIB_W across (a ribbon of quads between the two lines)."""
    o, inn = rib_profile(th)
    a = math.radians(th)
    rad, side = Vector((math.cos(a), math.sin(a), 0)), Vector((-math.sin(a), math.cos(a), 0))
    hw = S.RIB_W / 2
    bm = bmesh.new()

    def w(p, k):
        return rad * p.x + Vector((0, 0, p.y)) + side * (hw * k)
    rows = [[bm.verts.new(w(o[i], -1)), bm.verts.new(w(o[i], 1)), bm.verts.new(w(inn[i], 1)),
             bm.verts.new(w(inn[i], -1))] for i in range(len(o))]
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(4):
            bm.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=True, bevel=0.06, segs=3)


def ribs():
    """Level 3 on: four steel ribs from the ground at the four sides, over the dome's shoulders; each lies in a
    gold-edged channel on the dome and stands on a plinth."""
    R = V.DOME_R
    for th in V.RIBS:
        a = math.radians(th)
        side = (-math.sin(a), math.cos(a), 0)
        rib_mesh("rib", th, M["rib"])
        pw, pd, ph = S.PLINTH
        sl = S.RIB_TU + 0.24
        box("ribsleeve", (sl, S.RIB_W + 0.2, S.SLEEVE_Z - ph + 0.05),
            ((S.RIB_OUT + 0.12 - sl / 2) * math.cos(a), (S.RIB_OUT + 0.12 - sl / 2) * math.sin(a), ph - 0.05),
            M["rib"], rot=(0, 0, th), bevel=0.06)
        box("plinth", (pd, pw, ph), (S.PLINTH_D * math.cos(a), S.PLINTH_D * math.sin(a), 0.0), M["rib"],
            rot=(0, 0, th), bevel=0.06)
        # the gold channel edges on the dome: both sides of the rib and across over its top end
        s = Vector(side)
        e_low = V.WALL_E
        top = S.RIB_ENDS[th] + 2.5
        for k in (-1, 1):
            pts = []
            for i in range(25):
                e = top - (top - e_low) * i / 24
                p = ball(th, e) + s * k * (S.RIB_W / 2 + 0.1)
                pts.append(Vector((0, 0, V.DOME_C)) + (p - Vector((0, 0, V.DOME_C))).normalized() * (R + 0.02))
            sweep("ribgold", pts, _radial_side(pts), 0.26, 0.12, M["gold"], bevel=0.04)
            rw = R * math.cos(math.radians(V.WALL_E)) + 0.06
            q = Vector(S.polar(th + k * math.degrees(math.atan((S.RIB_W / 2 + 0.1) / rw)), rw, 0))
            sweep("ribgold", [q + Vector((0, 0, V.DOME_Z0 + 0.1)), q + Vector((0, 0, pts[-1].z + 0.05))],
                  Vector(S.polar(th + k * math.degrees(math.atan((S.RIB_W / 2 + 0.1) / rw)) + 90, 1, 0)),
                  0.26, 0.12, M["gold"], bevel=0.04)
        pts = []
        for i in range(9):
            w = -1 + 2 * i / 8
            p = ball(th, top) + s * w * (S.RIB_W / 2 + 0.1)
            pts.append(Vector((0, 0, V.DOME_C)) + (p - Vector((0, 0, V.DOME_C))).normalized() * (R + 0.02))
        sweep("ribgold", pts, _radial_side(pts), 0.26, 0.12, M["gold"], bevel=0.04)


def _radial_side(pts):
    """For a strip lying on the ball: the 'side' vector (across the strip, in the ball's surface) at its middle."""
    m = pts[len(pts) // 2]
    nrm = (m - Vector((0, 0, V.DOME_C))).normalized()
    t = (pts[-1] - pts[0]).normalized()
    return t.cross(nrm).normalized()


def blocks():
    """The gold blocks heaped in the opening, turning about the upright: a big middle block set corner-on and a ring of
    smaller blocks leaning on it at mixed heights and tilts. Flash's picture repeats every half loop, so the heap is the
    same after half a turn (each block has an identical twin opposite it)."""
    z = V.OPEN_Z

    def parts(hub):
        box("blk", (2.15, 2.15, 1.15), (0, 0, -0.85), M["blockgold"], parent=hub, bevel=0.06, rot=(6, -4, 45))
        cyl("blkaxle", 0.28, 0.55, (0, 0, -1.35), M["golddark"], parent=hub, verts=16)     # down to the pit floor
        ring_ = ((1.0, 15, 0.82, -0.5, 20, (14, -10)), (1.04, 62, 0.7, -0.75, 35, (-12, 8)),
                 (0.95, 108, 0.76, -0.4, 5, (8, 12)), (1.08, 150, 0.62, -0.85, 50, (-16, -6)))
        for r, ang, sz, dz, rot, (tx, ty) in ring_:
            for twin in (0, 180):
                aa = math.radians(ang + twin)
                sz *= 1.15
                box("blk", (sz, sz * 0.9, sz * 0.85), (r * math.cos(aa), r * math.sin(aa), dz), M["blockgold"],
                    parent=hub, bevel=0.05, rot=(tx, ty, ang + twin + rot))
        for twin in (0, 180):                       # two small blocks lying on the middle one
            aa = math.radians(70 + twin)
            box("blk", (0.5, 0.45, 0.38), (0.42 * math.cos(aa), 0.42 * math.sin(aa), 0.24), M["blockgold"],
                parent=hub, bevel=0.04, rot=(10, -6, 70 + twin + 30))
    e, hub = vspin("blocks", (0, 0, z - 0.6), parts)
    MOVING.append(hub)


def build():
    body()
    blocks()


def turn(frame):
    """The blocks at Flash frame `frame` of FRAMES: once round a loop, at an even speed."""
    for hub in MOVING:
        hub.rotation_euler = (0, 0, math.radians(360.0 * frame / FRAMES))


FAMILY = (("dome", "dome"), ("seam", "dome"), ("foot", "foot"), ("band", "band"), ("tank", "tank"),
          ("port", "port"), ("fin", "fin"), ("ribgold", "ribgold"), ("rib", "rib"), ("plinth", "rib"),
          ("blk", "blocks"))
MASONRY = ()


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


M = materials()


def vspin(name, center, parts):
    """A part turning about the vertical through center; local X = world X (bearing 0) before it turns."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = center
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    parts(hub)
    return e, hub


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
                n = len(ta.overlap(tb))
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
    moving_objs = [o for o in SC.objects if o.type in ("MESH", "CURVE") and under_moving(o)]
    if MODE in ("still", "base"):
        sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 384))
        for o in moving_objs:
            o.visible_camera = False
            o.visible_shadow = False
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
            o.visible_shadow = True
        bpy.data.objects["ground"].hide_render = True
        bpy.context.view_layer.update()
        # the render region round the blocks at every frame of the turn
        boxes = []
        for k in range(FRAMES):
            turn(k)
            bpy.context.view_layer.update()
            boxes.append(border_of(moving_objs, pad=40))
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
    if MODE == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "work" / f"academy-L{L}.blend"))
    print("DONE", L, MODE)


main()
