"""hatch.py : the Hatchery (Flash building 13) as a 3D model, in the approved Twig/Pebble/Putty family (same camera,
light, render settings and scale; no outline), matched to Flash's glossy render: polished gold, chrome, red enamel.
One body for every level, parts at fixed points on it (stack.py); each level is the level below plus upgrades.

    blender -b --factory-startup -P hatch.py -- <level> fit      work/fit-L<level>.png  quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P hatch.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P hatch.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P hatch.py -- <level> check    CHECK lines: parts whose meshes overlap; CLEAR lines:
                                                                  how near each moving part comes to anything else
    blender -b --factory-startup -P hatch.py -- <level> gap      GAP lines: parts in front of others from the camera

Level 1: the gold base on the ground (gauge, U-pipe), the purple drum, the sleeve, the funnel; a lid with a crank on a
spindle out of the sleeve. Level 2 lifts it all on three legs with cross feet, makes the funnel steel and swaps the lid
for an egg-beater drive (gantry, triangle handle, crown wheel and crank, pinion). Level 3 lifts it again on the red mixer
stand (plinth, column, head), with the crank wheel on the head, the bowl-lift arm and a cone hood with beaters in place
of the sleeve.

Animation, as Flash: the crank goes round once a loop (31 frames) at an even speed; at level 1 the lid turns with it,
at level 2 the pinion and spindle turn three times. Nothing else moves. The base picture is rendered once, each frame
renders only the moving parts with every still part as a holdout, and post.py lays that layer over the base.
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
FRAMES = S.FRAMES                    # Flash's loop: 31 frames at every level

EL = 30.0
ORIGIN = S.ORIGIN                     # Flash pixel of the world origin (the building's middle on the ground)
GROUND = S.GROUND
FRAME = (-58, -128, 156, 98)            # the canvas in Flash px (as fref.FRAME)
K = {"fit": 4}.get(MODE, int(os.environ.get("PB_K", 12)))      # render px per Flash px
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(EL)), \
    10 * math.cos(math.radians(EL))
L = LEVEL
rng = random.Random(1300)            # the same at every level: a level only adds parts


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
          streak=0.0, side=0.0, emit=0.0):
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
    out = t.grime(out, GROUND, 4.0, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rr, "metal": metal, "spec": spec})
    if emit:                       # a little glow of its own colour: a part that faces away from the light kept bright
        t.set(**{"Emission Color": out, "Emission Strength": emit})
    if coat:
        t.set(coat=coat)
        t.bsdf.inputs["Coat Roughness"].default_value = 0.12
    t.bump(t.noise(v, scale * 4, 4.0, 0.6), 0.03, 0.01)
    MATS[name] = t.m
    return t.m


def materials():
    M = {}
    M["gold"] = shiny("gold", (232, 146, 30), rough=0.3, metal=0.8, side=0.3, wear=(246, 196, 92), scale=1.5, dirt=0.35,
                      streak=0.4)
    M["golddark"] = shiny("golddark", (176, 96, 20), rough=0.34, metal=0.75, wear=(208, 136, 46), scale=1.5, dirt=0.45)
    M["drum"] = shiny("drum", (74, 60, 78), rough=0.4, metal=0.35, wear=(92, 78, 98), scale=2.0, dirt=0.25,
                      spec=0.45)
    M["drumtop"] = shiny("drumtop", (228, 180, 226), rough=0.3, metal=0.25, wear=(212, 162, 212), scale=1.2, dirt=0.15,
                         spec=0.6, side=0.55)
    M["chrome"] = shiny("chrome", (214, 220, 228), rough=0.2, metal=1.0, wear=(190, 196, 206), scale=4, dirt=0.15)
    M["steel"] = shiny("steel", (178, 184, 196), rough=0.3, metal=0.9, wear=(150, 156, 170), scale=4, dirt=0.2)
    M["sleeve"] = shiny("sleeve", (180, 180, 182), rough=0.6, metal=0.15, wear=(120, 116, 126), scale=14, dirt=0.25,
                        side=0.35)
    M["wheel"] = shiny("wheel", (238, 240, 244), rough=0.35, metal=0.12, wear=(196, 198, 208), scale=3, dirt=0.1,
                       side=0.3, emit=0.3)
    M["fchrome"] = shiny("fchrome", (172, 184, 200), rough=0.26, metal=0.75, wear=(140, 152, 170), scale=3, dirt=0.15,
                         side=0.4)
    M["brushed"] = shiny("brushed", (204, 212, 224), rough=0.42, metal=0.35, wear=(168, 178, 194), scale=3, dirt=0.1,
                         side=0.3, streak=0.5)
    M["lid"] = shiny("lid", (168, 184, 204), rough=0.28, metal=0.85, wear=(146, 160, 182), scale=3, dirt=0.1)
    M["wood"] = shiny("wood", (232, 184, 92), rough=0.45, metal=0.0, wear=(214, 160, 70), scale=3, dirt=0.1,
                      spec=0.45, coat=0.3)
    M["darkmetal"] = shiny("darkmetal", (40, 46, 58), rough=0.22, metal=0.85, wear=(62, 70, 84), scale=3, dirt=0.1)
    M["gear"] = shiny("gear", (78, 78, 84), rough=0.38, metal=0.85, wear=(98, 98, 104), scale=6, dirt=0.15)
    M["red"] = shiny("red", (214, 6, 6), rough=0.22, metal=0.6, wear=(112, 2, 4), scale=3.5, dirt=0.3,
                     spec=0.25, coat=0.1, side=0.5)
    M["redworn"] = shiny("redworn", (206, 10, 8), rough=0.34, metal=0.45, wear=(40, 2, 3), scale=5.0, dirt=0.5,
                         spec=0.25, side=0.2, emit=0.18)
    M["dial"] = shiny("dial", (236, 232, 236), rough=0.5, metal=0.0, wear=(214, 210, 218), scale=3, dirt=0.0,
                      spec=0.4)
    M["needle"] = flat("needle", (16, 16, 18), rough=0.5)
    M["redhole"] = flat("redhole", (96, 6, 8), rough=0.7)
    M["hole"] = flat("hole", (14, 10, 14), rough=1.0)
    return M


M = materials()
Z0 = S.lift(L)                 # the base's foot (the whole body stands this high)
ZD = Z0 + S.DRUM_Z1            # the drum's top
ZS = ZD + S.SLEEVE_H           # the sleeve's top (levels 1 and 2)


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


def handle(name, parent, at, axis=(0, 0, 1), size=1.0):
    """The wooden crank handle (the same at every level): a steel collar and pin, then a fat turned knob along
    local `axis` from `at`."""
    e = bpy.data.objects.new(name, None)
    link(e, parent)
    e.location = at
    track(e, axis, "Y" if abs(Vector(axis).normalized().z) < 0.9 else "X")
    hl, hr = S.HANDLE_L * size, S.HANDLE_R * size
    lathe(name + "collar", [(0.0, -0.06), (0.24, -0.06), (0.27, 0.04), (0.22, 0.2), (0.12, 0.26), (0.0, 0.26)],
          (0, 0, 0), M["chrome"], parent=e, verts=20)
    lathe(name + "knob", [(0.0, 0.2), (0.18, 0.2), (0.24, 0.32), (hr * 0.86, 0.75), (hr, hl * 0.62), (hr * 0.97, hl - 0.4),
                          (hr * 0.82, hl - 0.12), (hr * 0.5, hl - 0.01), (0.0, hl)], (0, 0, 0), M["wood"], parent=e,
          verts=24)
    return e


# ---------------------------------------------------------------------------------------------------- the body
def base():
    """The gold base: a darker foot ring, the wider body with a rounded lower edge, a seam band under the drum."""
    fr, fh, br = S.FOOT_R, S.FOOT_H, S.BODY_R
    lathe("basefoot", [(0.0, 0.0), (fr - 0.05, 0.0), (fr - 0.01, 0.04), (fr, 0.12), (fr, fh - 0.3), (fr + 0.05, fh - 0.18),
                       (fr + 0.08, fh - 0.04), (fr - 0.1, fh + 0.02)], (0, 0, Z0), M["golddark"], verts=72)
    lathe("basebody", [(fr - 0.2, fh - 0.02), (br - 0.32, fh), (br - 0.12, fh + 0.1), (br - 0.03, fh + 0.3),
                       (br, fh + 0.6), (br, S.BODY_Z1 - 0.35), (br - 0.05, S.BODY_Z1 - 0.15), (br - 0.2, S.BODY_Z1),
                       (0.0, S.BODY_Z1)], (0, 0, Z0), M["gold"], verts=72)
    # the gauge on the front: a gold bezel, the white dial, the needle (it reads higher once the legs are on)
    e = bpy.data.objects.new("gauge", None)
    link(e)
    e.location = P(S.GAUGE_TH, br - 0.12, Z0 + S.GAUGE_Z)
    track(e, P(S.GAUGE_TH, 1, 0), "Y")
    gr = S.GAUGE_R
    lathe("gaugebezel", [(0.0, -0.1), (gr + 0.12, -0.1), (gr + 0.15, 0.12), (gr + 0.12, 0.3), (gr + 0.05, 0.33),
                         (gr + 0.0, 0.28), (gr - 0.02, 0.24), (0.0, 0.24)], (0, 0, 0), M["gold"], parent=e, verts=48)
    cyl("gaugedial", gr, 0.02, (0, 0, 0.24), M["dial"], parent=e, verts=40, bevel=0.0)
    ang = math.radians(135.0 if L == 1 else -28.0)
    box("gaugeneedle", (gr * 0.78, 0.07, 0.03), (math.cos(ang) * gr * 0.36, math.sin(ang) * gr * 0.36, 0.265),
        M["needle"], rot=(0, 0, math.degrees(ang)), bevel=0.0, parent=e, origin="centre")
    cyl("gaugepin", 0.08, 0.06, (0, 0, 0.26), M["needle"], parent=e, verts=12, bevel=0.0)


def fluted(name, r, z0, z1, flutes, depth, mat):
    """An upright cylinder wall with fine vertical ribs (the drum's side), open top and bottom."""
    bm = bmesh.new()
    n = flutes * 4
    rows = []
    for z in (z0, z1):
        row = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r - depth * (0.5 - 0.5 * math.cos(2 * math.pi * i / 4))
            row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rows.append(row)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((rows[0][i], rows[0][j], rows[1][j], rows[1][i]))
    return mesh_ob(name, bm, [mat])


def drum():
    """The purple incubator drum: ribbed sides, a pink top inset a little, silver rims top and bottom."""
    r = S.DRUM_R
    zb, zt = Z0 + S.DRUM_Z0, Z0 + S.DRUM_Z1
    fluted("drumside", r - 0.02, zb + 0.06, zt - 0.06, 110, 0.035, M["drum"])
    lathe("drumbottom", [(r - 0.06, zb + 0.08), (r - 0.3, zb), (0.0, zb)], (0, 0, 0), M["drum"], verts=96)
    top = [(r - 0.08, zt - 0.02), (r - 0.18, zt + 0.02), (0.0, zt + 0.02)]
    if L >= 3:
        # the hood: a shallow cone up to the beaters' hole, a chrome collar round the hole, dark inside
        h = S.CONE_HOLE
        top = [(r - 0.08, zt - 0.02), (r - 0.2, zt + 0.03), (r - 0.9, zt + 0.25), (h + 1.0, zt + S.CONE_RISE * 0.82),
               (h + 0.18, zt + S.CONE_RISE)]
        lathe("drumhood", top, (0, 0, 0), M["drumtop"], verts=96)
        lathe("drumcollar", [(h + 0.22, zt + S.CONE_RISE - 0.04), (h + 0.18, zt + S.CONE_RISE + 0.1),
                             (h + 0.06, zt + S.CONE_RISE + 0.14), (h - 0.02, zt + S.CONE_RISE + 0.08),
                             (h - 0.02, zt + S.CONE_RISE - 0.3)], (0, 0, 0), M["chrome"], verts=48)
        lathe("drumholein", [(h - 0.02, zt + S.CONE_RISE - 0.28), (h - 0.1, zt - 0.6), (0.0, zt - 0.62)], (0, 0, 0),
              M["hole"], verts=48)
    else:
        lathe("drumtop", top, (0, 0, 0), M["drumtop"], verts=96)
    ring("drumrimtop", r - 0.02, 0.075, M["chrome"], z=zt - 0.02)
    ring("drumrimbot", r - 0.02, 0.075, M["chrome"], z=zb + 0.06)


def pipe():
    """The gold U-pipe on the drum's right: out of a boss on the drum's side, round a fat elbow and down outside the
    base, round again and into a socket in the body."""
    th, pr = S.PIPE_TH, S.PIPE_R
    zt, zb = Z0 + S.PIPE_ZTOP, Z0 + S.PIPE_ZBOT
    ro, rd, rb = S.DRUM_R - 0.25, S.PIPE_OUT, S.BODY_R - 0.25
    pts = [P(th, ro, zt)]
    e = 0.62
    for i in range(0, 9):                      # the top elbow
        a = math.pi / 2 * i / 8
        pts.append(P(th, rd - e + e * math.sin(a), zt - e + e * math.cos(a)))
    for i in range(0, 9):                      # the bottom elbow
        a = math.pi / 2 * i / 8
        pts.append(P(th, rd - e + e * math.cos(a), zb + e - e * math.sin(a)))
    pts.append(P(th, rb, zb))
    tube("pipe", pts, pr, M["gold"], verts=20)
    for nm, r_in, r_out, z in (("pipeboss", S.DRUM_R - 0.1, S.DRUM_R + 0.14, zt),
                               ("pipesocket", S.BODY_R - 0.12, S.BODY_R + 0.14, zb)):
        ob = lathe(nm, [(0.0, -0.1), (pr + 0.14, -0.1), (pr + 0.16, 0.0), (pr + 0.12, r_out - r_in),
                        (pr - 0.02, r_out - r_in + 0.02)], P(th, r_in, z), M["gold"], verts=24)
        track(ob, P(th, 1, 0))


def sleeve():
    """The grey feed sleeve standing in the drum's top (levels 1 and 2), dark inside, with the spindle's bridge
    across it just under the rim."""
    r, h = S.SLEEVE_R, S.SLEEVE_H
    lathe("sleeve", [(r - 0.02, ZD - 0.05), (r, ZD + 0.05), (r, ZS - 0.1), (r + 0.03, ZS - 0.04), (r - 0.04, ZS + 0.02),
                     (r - 0.13, ZS - 0.02)], (0, 0, 0), M["sleeve"], verts=64)
    lathe("sleevein", [(r - 0.13, ZS - 0.02), (r - 0.14, ZS - 1.5), (0.0, ZS - 1.52)], (0, 0, 0), M["hole"], verts=48)
    box("sleevebridge", (2 * r - 0.24, 0.24, 0.2), (0, 0, ZS - 0.42), M["steel"], rot=(0, 0, 135), bevel=0.04)
    cyl("sleeveboss", 0.24, 0.3, (0, 0, ZS - 0.52), M["steel"], verts=20)


def funnel(mat):
    """The funnel on its post at the drum's back left: the post on a flange on the drum top, a clamp, the cone."""
    c = P(S.FUN_TH, S.FUN_D, 0)
    z1 = Z0 + S.FUN_Z0
    lathe("funnelflange", [(0.0, 0.0), (0.72, 0.0), (0.7, 0.08), (0.6, 0.16), (0.52, 0.2), (0.0, 0.2)],
          (c.x, c.y, ZD - 0.02), M["steel"], verts=28)
    cyl("funnelpost", 0.5, z1 - ZD + 0.1, (c.x, c.y, ZD), M["steel"], verts=28, bevel=0.02)
    lathe("funnelclamp", [(0.0, -0.22), (0.6, -0.22), (0.64, -0.12), (0.64, 0.12), (0.6, 0.22), (0.0, 0.22)],
          (c.x, c.y, z1 - 0.3), M["steel"], verts=28)
    h, rr = S.FUN_Z1 - S.FUN_Z0, S.FUN_R
    prof = [(0.46, 0.0), (0.47, 0.2 * h), (0.52, 0.42 * h), (0.66, 0.62 * h), (0.92, 0.78 * h), (1.25, 0.9 * h),
            (rr - 0.06, 0.98 * h), (rr, h), (rr - 0.06, h + 0.04), (rr - 0.14, h - 0.02), (1.18, 0.9 * h),
            (0.84, 0.76 * h), (0.56, 0.6 * h), (0.0, 0.5 * h)]
    lathe("funnel", prof, (c.x, c.y, z1), mat, verts=48)


# ---------------------------------------------------------------------------------------------------- level 1
def lid_and_crank():
    """Level 1: the lid on its spindle out of the sleeve's bridge, the crank arm on top, the handle up at its end; all
    turn together once a loop, clockwise from above."""
    def parts(hub):
        t = S.LID_T
        gear("lidedge", S.LID_R, 150, t, (0, 0, t / 2), M["lid"], (0, 0, 0), tooth=0.012, parent=hub)
        lathe("lidtop", [(0.0, t), (S.LID_R - 0.12, t), (S.LID_R - 0.2, t + 0.05), (0.62, t + 0.07), (0.5, t + 0.12),
                         (0.0, t + 0.12)], (0, 0, 0), M["lid"], parent=hub, verts=64)
        ring("lidring", 0.56, 0.05, M["steel"], parent=hub, z=t + 0.1)
        tube("lidspindle", [(0, 0, ZS - 0.5 - (Z0 + S.LID_Z)), (0, 0, 0.1)], 0.12, M["steel"], parent=hub, verts=12)
        lathe("crankboss", [(0.0, t + 0.08), (0.34, t + 0.08), (0.36, t + 0.2), (0.3, t + 0.34), (0.0, t + 0.36)],
              (0, 0, 0), M["steel"], parent=hub, verts=20)
        r = S.CRANK1_R
        # the arm runs out level past the lid's edge, then cranks down to the handle (as Flash's)
        dz = -0.45
        sweep("crankarm", [(0.0, 0, t + 0.28), (S.LID_R + 0.1, 0, t + 0.3), (S.LID_R + 0.5, 0, t + 0.3 + dz * 0.6),
                           (r - 0.05, 0, t + 0.3 + dz)], (0, 0, 1), 0.46, 0.15, M["steel"], parent=hub, bevel=0.05)
        lathe("crankeye", [(0.0, t + 0.2 + dz), (0.26, t + 0.2 + dz), (0.28, t + 0.38 + dz), (0.0, t + 0.4 + dz)],
              (r, 0, 0), M["steel"], parent=hub, verts=16)
        handle("crankhandle", hub, (r, 0, t + 0.38 + dz), size=S.HANDLE1_SIZE)
    e, hub = vspin("crank1", (0, 0, Z0 + S.LID_Z), parts)
    MOVING.append(hub)


# ---------------------------------------------------------------------------------------------------- level 2
def legs():
    """Three gold legs from bosses on the base's foot ring out and down to cross feet with ball ends on the ground."""
    for i, th in enumerate(S.LEG_TH):
        a = P(th, S.FOOT_R - 0.05, Z0 + 0.55)
        f = P(th, S.FOOT_D[i], 0.0)
        ob = lathe(f"legboss{i}", [(0.0, -0.1), (0.24, -0.1), (0.26, 0.08), (0.18, 0.2), (0.0, 0.22)], a, M["gold"],
                   verts=16)
        track(ob, P(th, 1, 0))
        top = a + P(th, 0.18, 0)
        knee = f + Vector((0, 0, 0.42))
        tube(f"leg{i}", [top, top + (knee - top) * 0.5, knee], 0.19, M["gold"], verts=14)
        blob_ball(f"legball{i}", knee, 0.26)
        tube(f"legpin{i}", [knee, f + Vector((0, 0, 0.18))], 0.15, M["gold"], verts=12)
        for ax in ((1, 0), (0, 1)):
            d = Vector((ax[0], ax[1], 0)) * S.CROSS_L
            tube(f"legcross{i}{ax[0]}", [f - d + Vector((0, 0, 0.2)), f + d + Vector((0, 0, 0.2))], S.CROSS_W,
                 M["gold"], verts=12)
            for sgn in (-1, 1):
                blob_ball(f"legtoe{i}{ax[0]}{sgn}", f + d * sgn + Vector((0, 0, 0.27)), 0.27)
        blob_ball(f"legheel{i}", f + Vector((0, 0, 0.25)), 0.25)


def blob_ball(name, at, r, mat=None):
    return lathe(name, [(0.0, -r)] + [(r * math.sin(math.pi * k / 10), -r * math.cos(math.pi * k / 10))
                                       for k in range(1, 10)] + [(0.0, r)], at, mat or M["gold"], verts=16)


def U2(u, z):
    """A point in the level 2 drive's plane: u along bearing 45 from the axis, z above the sleeve's top."""
    return Vector((u * math.cos(math.radians(45)), u * math.sin(math.radians(45)), ZS + z))


def beater():
    """Level 2: the egg-beater drive on the sleeve. A gantry from a clamp on the sleeve's back rim carries the
    spindle's top bearing, the crown wheel's axle and the triangle handle; the crank turns the crown wheel once a
    loop and the wheel's face teeth turn the pinion (and the spindle) three times."""
    # the gantry: a post up from a clamp on the sleeve's back rim, over to the bearing block on the axis
    back = P(135, S.SLEEVE_R + 0.06, 0)
    lathe("gantryclamp", [(0.0, -0.3), (0.3, -0.3), (0.32, 0.12), (0.26, 0.2), (0.0, 0.2)],
          (back.x, back.y, ZS - 0.18), M["steel"], verts=16)
    zb = ZS + 2.55
    sweep("gantry", [(back.x, back.y, ZS - 0.1), (back.x, back.y, zb - 0.3), (back.x * 0.6, back.y * 0.6, zb),
                     (0, 0, zb)], P(45, 1, 0), 0.34, 0.26, M["steel"], bevel=0.05)
    lathe("gantrybearing", [(0.0, -0.32), (0.3, -0.32), (0.34, -0.2), (0.34, 0.3), (0.28, 0.38), (0.0, 0.4)],
          (0, 0, zb), M["steel"], verts=20)
    # the frame bar up from the bearing to the triangle, and the axle arm out to the crown wheel
    a0, a1, a2 = (Vector(c) for c in S.TRI)
    sweep("framebar", [U2(0.0, 2.85), U2(0.05, 3.6), U2(a1.x - 0.15, a1.y - 0.05)], P(135, 1, 0), 0.3, 0.36,
          M["fchrome"], bevel=0.05)
    # the triangle handle: Flash's broad brushed plate, a sickle with a curved outer edge, a wide solid top and left
    # band, a narrow right band and bottom bar round a small opening. Traced from Flash's level 2 picture (Flash px:
    # the plate's plane, through the axis along bearing 45, faces the camera square on)
    outer = [(-6.5, -113.3), (-4.5, -112.5), (-3, -110.5), (-2, -107), (-1, -104), (0, -101), (1, -98.5), (2, -96),
             (3, -93), (4, -90), (4.8, -87), (5.6, -84), (6.3, -81), (6.6, -77), (6.5, -72.2), (-3, -72),
             (-15, -72.5), (-22, -72.8), (-25.5, -73.3), (-27.5, -74.5), (-28.6, -76.5), (-28.8, -79), (-28.4, -82),
             (-27.8, -85), (-26.8, -88), (-25.6, -91), (-24.2, -94), (-22.6, -97), (-20.6, -100), (-18.4, -103),
             (-16.2, -106), (-13.8, -108.6), (-11.4, -111), (-9, -112.8)]
    hole = [(-4.6, -100.4), (-3.2, -100), (-2.2, -97.5), (-1.3, -94.5), (-0.4, -91.5), (0.6, -88), (1.6, -85),
            (2.5, -82), (3, -79), (2.8, -77), (1.8, -76.2), (-17, -76.2), (-18.6, -76.8), (-19, -78.5), (-18.2, -81.5),
            (-16.8, -84.5), (-15.2, -87.5), (-13.6, -90), (-11.8, -93), (-9.6, -96), (-7.2, -98.6)]

    def chaikin(pts, n=2):
        for _ in range(n):
            q = []
            for i in range(len(pts)):
                (x0_, y0_), (x1_, y1_) = pts[i], pts[(i + 1) % len(pts)]
                q += [(0.75 * x0_ + 0.25 * x1_, 0.75 * y0_ + 0.25 * y1_), (0.25 * x0_ + 0.75 * x1_, 0.25 * y0_ + 0.75 * y1_)]
            pts = q
        return pts
    bm = bmesh.new()
    edges = []
    for loop in (outer, hole):
        vs = [bm.verts.new(((fx - ORIGIN[0]) / 10.0, (ORIGIN[1] - fy) / SZ - ZS, -0.09)) for fx, fy in chaikin(loop)]
        edges += [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=True, edges=edges)
    ext = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += 0.18
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob("triangle", bm, [M["brushed"]], bevel=0.06, segs=3)
    ob.location = (0, 0, ZS)
    ob.rotation_euler = Matrix((P(45, 1, 0), (0, 0, 1), P(-45, 1, 0))).transposed().to_euler()
    # the gearbox (Flash's): a chunky rounded chrome housing low beside the triangle, a domed cap, a darker band, bolts
    # and a small gear on its front; the crank's axle comes out of its right side through a domed wheel cover. Two
    # short rods hold it on the spindle's top bearing.
    fr = P(-45, 1, 0)                       # toward the camera
    hc = U2(0.98, 2.2) + fr * 0.1          # the housing's foot
    box("gearbox", (1.2, 0.95, 3.35), hc, M["brushed"], rot=(0, 0, 45), bevel=0.45, segs=6)
    ob = lathe("gearboxcap", [(0.0, -0.3), (0.66, -0.3), (0.68, -0.12), (0.6, 0.06), (0.4, 0.2), (0.0, 0.25)],
               hc + Vector((0, 0, 3.2)), M["chrome"], verts=32)
    ob.scale = (1.0, 0.82, 1.0)
    ob.rotation_euler = (0, 0, math.radians(45))
    box("gearboxband", (1.24, 0.99, 0.14), hc + Vector((0, 0, 1.55)), M["steel"], rot=(0, 0, 45), bevel=0.4, segs=5)
    q = fr.to_track_quat("Z", "Y").to_euler()
    gc = hc + fr * 0.44 + Vector((0, 0, 0.5)) - P(45, 0.42, 0)      # a small gear peeping out at the lower left
    gear("gearboxgear", 0.38, 10, 0.16, gc, M["steel"], q, tooth=0.24)
    ob = lathe("gearboxgearhub", [(0.0, -0.05), (0.13, -0.05), (0.13, 0.1), (0.08, 0.14), (0.0, 0.15)], gc,
               M["chrome"], verts=16)
    ob.rotation_euler = q
    ob = lathe("gearboxcover", [(0.0, -0.62), (0.72, -0.62), (0.86, -0.42), (0.9, -0.12), (0.85, 0.08), (0.7, 0.22),
                                (0.4, 0.29), (0.0, 0.3)], U2(S.WHEEL2_U, S.WHEEL2_Z), M["fchrome"], verts=40)
    track(ob, P(S.WHEEL2_TH, 1, 0))

    # the crown wheel and crank, on an axle along bearing 45
    def wheel(hub):
        lathe("crownboss", [(0.0, 0.31), (0.3, 0.31), (0.33, 0.38), (0.28, 0.5), (0.0, 0.52)], (0, 0, 0),
              M["chrome"], parent=hub, verts=20)
        tube("crownaxle", [(0, 0, -0.6), (0, 0, 0.5)], 0.13, M["steel"], parent=hub, verts=12)
        r = S.CRANK2_R
        sweep("crank2arm", [(0, 0, 0.42), (0, r * 0.5, 0.42), (0, r - 0.05, 0.42)], (1, 0, 0), 0.36, 0.13, M["chrome"],
              parent=hub, bevel=0.04)
        lathe("crank2eye", [(0.0, 0.34), (0.26, 0.34), (0.28, 0.52), (0.0, 0.54)], (0, r, 0), M["chrome"], parent=hub,
              verts=16)
        handle("crank2handle", hub, (0, r, 0.52))
    e, hub = spinner("crank2", U2(S.WHEEL2_U, S.WHEEL2_Z), S.WHEEL2_TH, 0.0, wheel)
    MOVING.append(hub)

    def pin(hub):
        gear("pinion", S.PINION_R, 9, 0.36, (0, 0, 0), M["gear"], (0, 0, 0), tooth=0.3, parent=hub)
        cyl("pinionhub", 0.34, 0.6, (0, 0, -0.3), M["gear"], parent=hub, verts=16)
        tube("spindle", [(0, 0, -4.05), (0, 0, 1.05)], 0.12, M["steel"], parent=hub, verts=12)
        for k in range(3):                       # the beater blades down in the sleeve, under the bridge
            a = 2 * math.pi * k / 3
            box(f"spindleblade{k}", (0.85, 0.05, 0.7), (0.45 * math.cos(a), 0.45 * math.sin(a), -3.95), M["steel"],
                rot=(0, 0, math.degrees(a)), bevel=0.01, parent=hub)
    e, hub = vspin("pinion", (0, 0, ZS + S.PINION_Z), pin)
    MOVING.append(hub)


# ---------------------------------------------------------------------------------------------------- level 3
def lumpy(ob, strength=0.14, size=0.9):
    """Soft lumps (a worn cast part): subdivide, then push the surface in and out with a cloud noise."""
    mo = ob.modifiers.new("sub", "SUBSURF")
    mo.levels = mo.render_levels = 2
    tx = bpy.data.textures.get("lumps") or bpy.data.textures.new("lumps", "CLOUDS")
    tx.noise_scale = size
    mo = ob.modifiers.new("lumps", "DISPLACE")
    mo.texture = tx
    mo.texture_coords = "GLOBAL"
    mo.strength = strength
    mo.mid_level = 0.5


def stand():
    """Level 3: the red mixer stand. A plinth under the base with a foot out to the back right, the column up from
    it, the hinge block and the head over the drum; the beaters hang from the head into the hood's hole."""
    pr = S.PLINTH_R
    lathe("plinth", [(0.0, 0.0), (pr + 0.18, 0.0), (pr + 0.2, 0.1), (pr + 0.08, 0.3), (pr, 0.6), (pr, Z0 - 0.2),
                     (pr - 0.08, Z0 - 0.06), (pr - 0.3, Z0), (0.0, Z0)], (0, 0, 0), M["redworn"], verts=72)
    cx, cy = S.COLUMN
    dist = Vector((cx, cy)).length
    mid = Vector((cx, cy, 0)) / dist * (dist + 0.75 + pr * 0.45) / 2
    ang = math.degrees(math.atan2(cy, cx))
    box("plinthfoot", (dist + 0.75 - pr * 0.45, 2.0, 2.3), (mid.x, mid.y, 0.0), M["redworn"], rot=(0, 0, ang),
        bevel=0.6, segs=4)
    # the column's foot: a big rounded worn lump (Flash's), then the thin column up to the neck
    cr = S.COLUMN_R
    lathe("columnfoot", [(0.0, 0.0), (1.42, 0.0), (1.5, 0.2), (1.48, 0.9), (1.36, 1.6), (1.12, 2.15), (0.82, 2.5),
                         (cr + 0.08, 2.75), (cr, 3.0), (0.0, 3.0)], (cx, cy, 0.0), M["redworn"], verts=40)
    lumpy(bpy.data.objects["columnfoot"])
    lumpy(bpy.data.objects["plinthfoot"])
    lathe("column", [(0.0, 2.6), (cr, 2.6), (cr, S.HEAD_Z0 - 0.6), (cr + 0.1, S.HEAD_Z0 - 0.3), (0.0, S.HEAD_Z0 + 0.1)],
          (cx, cy, 0.0), M["red"], verts=36)
    za = S.ARM3_Z
    lathe("columncollar", [(0.0, za - 2.5), (cr + 0.06, za - 2.5), (cr + 0.13, za - 2.4), (cr + 0.13, za - 2.25),
                           (cr + 0.07, za - 2.15), (cr + 0.07, za + 0.35), (cr + 0.13, za + 0.45), (cr + 0.13, za + 0.6),
                           (cr + 0.04, za + 0.7), (0.0, za + 0.7)], (cx, cy, 0.0), M["chrome"], verts=36)
    # the neck: from the column's top forward under the head's back
    box("hinge", (1.6, cy - S.HEAD_Y[1] + 2.2, 0.95), (cx, (cy + S.HEAD_Y[1]) / 2 - 0.3, S.HEAD_Z0 - 0.55), M["red"],
        bevel=0.3)
    x0, x1 = S.HEAD_X
    y0, y1 = S.HEAD_Y
    z0, z1 = S.HEAD_Z0, S.HEAD_Z1
    # the head: a soft enamel pillow, lofted from rounded rectangles. Flash's lower part is fuller toward the front
    # and the left (bulge on the -X and -Y sides) and comes down lower, over the beaters' hub; its top is as before
    hb, ht = 1.3, 0.75                       # corner radius in plan, rounding of the top edge
    zt = z1 - ht
    prof = [(zt + ht * math.cos(math.radians(t)), max(-hb + 0.08, -ht + ht * math.sin(math.radians(t))))
            for t in range(0, 91, 15)]
    prof += [(16.4, 0.0), (15.9, 0.0), (15.4, 0.0), (14.9, 0.0), (14.4, 0.0), (14.0, 0.0), (13.7, 0.0),
             (13.5, -0.08), (13.3, -0.3), (13.1, -0.6), (12.98, -0.85), (12.9, -1.05), (12.85, -1.22)]
    bulge = {13.5: 0.6, 13.3: 0.45, 13.1: 0.3, 12.98: 0.18, 12.9: 0.08, 12.85: 0.0}
    bulge.update({z: max(0.0, min(0.7, 0.7 * (zt - z) / (zt - 14.2))) for z, _ in prof if z >= 13.7})
    def hring(d, bz, n=7):
        """The head's rounded-rectangle section: sides pushed out by bz on -X and -Y, rounding d."""
        xa, xb, ya, yb = x0 - bz + hb, x1 - hb, y0 - bz + hb, y1 - hb
        out = []
        for ccx, ccy, a0 in ((xb, yb, 0), (xa, yb, 90), (xa, ya, 180), (xb, ya, 270)):
            for i in range(n):
                a = math.radians(a0 + 90 * i / (n - 1))
                out.append((ccx + (hb + d) * math.cos(a), ccy + (hb + d) * math.sin(a)))
        return out
    bm = bmesh.new()
    rows = [[bm.verts.new((x, y, z)) for x, y in hring(d, bulge.get(z, 0.0))] for z, d in prof]
    n = len(rows[0])
    for ra, rb in zip(rows, rows[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((ra[i], rb[i], rb[j], ra[j]))
    bm.faces.new(rows[0])
    bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("head", bm, [M["red"]])
    # two thin seam rings round the fullest part
    for j, (zs, bz) in enumerate(((13.82, 0.7), (14.17, 0.7))):
        bm = bmesh.new()
        ring = hring(0.035, bz)
        lo = [bm.verts.new((x, y, zs)) for x, y in ring]
        hi = [bm.verts.new((x, y, zs + 0.11)) for x, y in ring]
        n = len(ring)
        for i in range(n):
            bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
        bm.faces.new(hi)
        bm.faces.new(list(reversed(lo)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh_ob(f"headseam{j}", bm, [M["red"]], bevel=0.03, segs=2)
    # the beaters: a chrome hub down from the head, whisk wires in the hole
    zc = ZD + S.CONE_RISE
    cyl("beaterhub", 0.24, z0 - zc + 0.1, (0, 0, zc + 0.3), M["darkmetal"], verts=24, r2=0.3)    # a thin dark shaft (Flash shows none)
    for k in range(8):
        a = 2 * math.pi * k / 8
        d = Vector((math.cos(a), math.sin(a), 0))
        tube(f"beaterwire{k}", [Vector((0, 0, zc + 0.4)) + d * 0.3, Vector((0, 0, zc - 0.1)) + d * 0.95,
                                Vector((0, 0, zc - 0.55)) + d * 0.5, Vector((0, 0, zc - 0.7))], 0.05, M["chrome"],
             verts=8, smooth=True)
    # the bowl-lift arm: a steel bar from the column round the drum's right to a clamp on its side
    # (Flash's runs level out to the right, then back down to the drum's front right, just above the gold pipe)
    pts = [Vector((cx + 0.45, cy - 0.1, za)), Vector((4.0, 4.1, za)), Vector((4.7, 3.0, za - 0.2)),
           Vector((4.6, 2.0, za - 0.7)), P(24.0, S.DRUM_R + 0.25, za - 1.2)]
    tube("bowlarm", pts, 0.3, M["fchrome"], verts=16, smooth=True)     # a round chrome bar, as Flash's
    ob = lathe("bowlclamp", [(0.0, -0.1), (0.36, -0.1), (0.4, 0.05), (0.34, 0.3), (0.0, 0.32)],
               P(24.0, S.DRUM_R - 0.05, za - 1.2), M["steel"], verts=20)
    track(ob, P(24.0, 1, 0))

    # the crank wheel on the head's right face
    def wheel(hub):
        R = S.WHEEL3_R
        lathe("wheel3", [(0.32, -0.1), (R - 0.12, -0.1), (R, -0.02), (R, 0.04), (R - 0.12, 0.12), (0.32, 0.12)],
              (0, 0, 0), M["wheel"], parent=hub, verts=72)
        # a chrome rim round the disc (Flash's wheel shows a thick bright edge)
        lathe("wheel3rim", [(R - 0.22, -0.26), (R - 0.02, -0.26), (R + 0.05, -0.18), (R + 0.05, 0.1), (R - 0.02, 0.17),
                            (R - 0.22, 0.17)], (0, 0, 0), M["chrome"], parent=hub, verts=72)
        for k in range(3):                      # three kidney slots, inlaid flush: the dark red head seen through
            a = 2 * math.pi * k / 3 + 0.4
            rm, hw, span = R * 0.56, 0.24, 0.8
            pts2 = []
            for j in range(9):                  # the outer arc
                pts2.append((rm + hw, a - span / 2 + span * j / 8))
            for j in range(1, 6):               # the far end cap
                t = math.pi * j / 6
                c = a + span / 2
                pts2.append((rm + hw * math.cos(t), c + hw * math.sin(t) / rm))
            for j in range(9):                  # the inner arc, back
                pts2.append((rm - hw, a + span / 2 - span * j / 8))
            for j in range(1, 6):               # the near end cap
                t = math.pi * j / 6
                c = a - span / 2
                pts2.append((rm - hw * math.cos(t), c - hw * math.sin(t) / rm))
            bm = bmesh.new()
            lo = [bm.verts.new((r_ * math.cos(t_), r_ * math.sin(t_), 0.1)) for r_, t_ in pts2]
            hi = [bm.verts.new((r_ * math.cos(t_), r_ * math.sin(t_), 0.128)) for r_, t_ in pts2]
            n = len(pts2)
            for i in range(n):
                bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
            bm.faces.new(hi)
            bm.faces.new(list(reversed(lo)))
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            mesh_ob(f"wheel3hole{k}", bm, [M["redhole"]], smooth=False, parent=hub)
            # a spoke of the three-armed hub behind the disc, seen across the slot (Flash's)
            d = Vector((math.cos(a), math.sin(a), 0.0))
            sweep(f"wheel3spoke{k}", [d * (rm - hw - 0.02) + Vector((0, 0, 0.12)), d * (rm + hw + 0.02) + Vector((0, 0, 0.12))],
                  (-d.y, d.x, 0.0), 0.2, 0.026, M["steel"], parent=hub, bevel=0.008)
        lathe("wheel3hub", [(0.0, -0.3), (0.42, -0.3), (0.46, 0.2), (0.36, 0.34), (0.0, 0.36)], (0, 0, 0), M["chrome"],
              parent=hub, verts=24)
        r = S.CRANK3_R
        sweep("crank3arm", [(0, 0, 0.3), (0, r * 0.5, 0.3), (0, r - 0.05, 0.3)], (1, 0, 0), 0.62, 0.13, M["wheel"],
              parent=hub, bevel=0.04)
        lathe("crank3eye", [(0.0, 0.22), (0.26, 0.22), (0.28, 0.4), (0.0, 0.42)], (0, r, 0), M["chrome"], parent=hub,
              verts=16)
        handle("crank3handle", hub, (0, r, 0.4))
    w = Vector(S.WHEEL3)
    ob = lathe("wheel3boss", [(0.0, -0.3), (0.45, -0.3), (0.5, 0.0), (0.4, 0.14), (0.0, 0.16)],
               Vector((x1, w.y, w.z)), M["chrome"], verts=20)
    track(ob, P(S.WHEEL3_TH, 1, 0))
    e, hub = spinner("crank3", w, S.WHEEL3_TH, S.WHEEL3_TILT, wheel)
    MOVING.append(hub)


def build():
    base()
    drum()
    pipe()
    funnel(M["steel"] if L == 2 else M["darkmetal"])
    if L <= 2:
        sleeve()
    if L == 1:
        lid_and_crank()
    if L >= 2:
        legs()
    if L == 2:
        beater()
    if L >= 3:
        stand()


# how far each moving part turns in a loop (degrees, about its own axle), and where it starts
TURNS = {"crank1": (-360.0, S.CRANK1_START), "crank2": (-360.0, 23.0), "pinion": (1080.0, 0.0),
         "crank3": (-360.0, 13.4)}


def turn(frame):
    """Turn the moving parts to Flash frame `frame` of FRAMES, at an even speed: each crank once round a loop (the
    level 2 pinion three times)."""
    f = frame / FRAMES
    for hub in MOVING:
        per, start = TURNS[hub.parent.name]
        hub.rotation_euler = (0, 0, math.radians(start + per * f))



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



FAMILY = (("basefoot", "base"), ("basebody", "base"), ("gauge", "gauge"), ("drum", "drum"), ("pipe", "pipe"),
          ("sleeve", "sleeve"), ("funnel", "funnel"), ("leg", "leg"), ("gantry", "frame"), ("framebar", "frame"),
          ("axle", "frame"), ("triangle", "frame"), ("gearbox", "frame"), ("plinth", "stand"), ("column", "stand"), ("hinge", "stand"),
          ("head", "stand"), ("wheel3boss", "stand"), ("beater", "beater"), ("bowl", "bowlarm"))


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
    if MODE == "track":                      # the wooden handle's screen middle (Flash px) at every second frame
        knobs = [o for o in SC.objects if o.name.endswith("handleknob")]
        for k in range(0, FRAMES, 2):
            turn(k)
            bpy.context.view_layer.update()
            pts = [scr(o.matrix_world @ Vector(c)) for o in knobs for c in o.bound_box]
            print("TRACK f%02d x %.0f y %.0f" % (k, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
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
