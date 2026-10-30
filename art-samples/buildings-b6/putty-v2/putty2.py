"""putty2.py : the Putty Squisher (Flash building 3) as a 3D model, built the way the approved Twig Snapper v3 and
Pebble Shiner v2 were (../twig-v3/twig2.py, ../pebble-v2/pebble2.py): one body for every level, parts at fixed points
on it, no outline, Flash's soft light.

    blender -b --factory-startup -P putty2.py -- <level> fit      work/fit-L<level>.png  quick silhouette, 4 px per Flash px
    blender -b --factory-startup -P putty2.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P putty2.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P putty2.py -- <level> check    CHECK lines: parts whose meshes overlap; CLEAR lines:
                                                                   how near each moving part comes to anything else
    blender -b --factory-startup -P putty2.py -- <level> gap      GAP lines: parts in front of others from the camera

The body is the pot (stack.py). Level 1 stands it on the ground with the press block on its rim, the hand wheel on its
side and the test tube beside it on a gold arm. Level 3 sets the same pot in the purple frame on four log stumps (which
lifts it and every part on it) and bolts two pale arches over it. Level 6 adds the hub on the arches with the flask,
the valve wheel and the arm that now holds the test tube up. Level 10 adds the cage wheel on a cranked axle out of the
hub, the coil and the basin, and springs round the stumps.

Animation, as Flash (worked out from the frames, see the report): the gold stirrer goes round three times a loop and the
putty's swirl once, clockwise from above, at an even speed; at level 10 the cage wheel turns two rungs a loop,
anticlockwise on screen (work/spin_dir.py measures Flash's and the 3D's way round). Nothing else
moves. Stillness is built in as in pebble2.py: the base picture is rendered once, each frame renders only the moving
parts with every still part as a holdout, and post.py lays that layer over the base.
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
    # the pot: Flash's sooty orange-gold, worn lighter on the bulges, soot running down, dark seams
    # every material matte (no mirror shine): Flash's surfaces are soft and dull
    # the pot: Flash's deep orange-gold, big dark soot patches (Flash (185, 114, 35), soot (44, 26, 0)), dark seams
    M["pot"] = painted("pot", (204, 124, 22), rough=0.7, metal=0.0, wear=(232, 160, 42), rust=(44, 26, 0), scale=1.6,
                       dirt=0.45, spec=0.3, rust_at=0.56, soot=0.3)
    M["potin"] = painted("potin", (112, 46, 22), rough=0.8, wear=(138, 66, 30), rust=(58, 24, 12), scale=3.5, dirt=0.2,
                         spec=0.2)
    M["seam"] = flat("seam", (70, 36, 10), rough=0.8)
    M["putty"] = painted("putty", (92, 46, 140), rough=0.55, wear=(130, 84, 182), scale=1.6, dirt=0.0, spec=0.3)
    M["gold"] = painted("gold", (214, 156, 30), rough=0.58, metal=0.25, wear=(240, 200, 96), scale=6, dirt=0.15,
                        spec=0.35)
    M["purple"] = painted("purple", (38, 15, 60), rough=0.62, wear=(62, 32, 92), scale=2.5, dirt=0.3, spec=0.3,
                          top=(92, 60, 134), ao_min=0.55)
    M["stump"] = lambda axis="Z": wood("stump", (206, 164, 142), (156, 116, 98), axis, rings=5, dirt=0.25)
    M["stumptop"] = painted("stumptop", (232, 204, 184), rough=0.8, wear=(204, 166, 144), scale=4, dirt=0.0)
    M["arch"] = painted("arch", (172, 146, 100), rough=0.8, wear=(204, 178, 132), rust=(96, 78, 46), scale=2.2,
                        dirt=0.3, spec=0.25, soot=0.45)
    # the block: a pale tan top, brown sides smudged with black soot (Flash (122, 101, 58) on top, (34, 24, 30) in the soot)
    M["block"] = painted("block", (92, 76, 54), rough=0.85, wear=(124, 104, 70), scale=2.0, dirt=0.45, spec=0.2,
                         soot=0.9, top=(158, 134, 86))
    M["hole"] = flat("hole", (22, 14, 12), rough=1.0)
    M["glass"] = painted("glass", (184, 196, 210), rough=0.45, wear=(226, 232, 242), scale=4, dirt=0.0, spec=0.4)
    M["liquid"] = painted("liquid", (124, 70, 180), rough=0.45, wear=(164, 116, 214), scale=3, dirt=0.0, spec=0.4)
    M["cap"] = painted("cap", (222, 222, 232), rough=0.6, wear=(196, 196, 210), scale=5, dirt=0.0)
    M["steel"] = painted("steel", (150, 154, 166), rough=0.55, metal=0.3, wear=(196, 200, 212), scale=8, dirt=0.1)
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


def handwheel(name, r, mat, parent, spokes=4, rim=0.07, knob=True):
    """A hand wheel in its local XY (axis local Z): a round rim, spokes, a hub and a knob on the rim."""
    obs = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=r, radius2=r, depth=0.01)
    pts = [(r * math.cos(2 * math.pi * i / 40), r * math.sin(2 * math.pi * i / 40), 0) for i in range(41)]
    bm.free()
    t = tube(name + "rim", pts, rim, mat, parent=parent, verts=10)
    obs.append(t)
    for k in range(spokes):
        a = 2 * math.pi * (k + 0.5) / spokes
        obs.append(tube(f"{name}spoke{k}", [(0, 0, 0), (r * math.cos(a), r * math.sin(a), 0)], rim * 0.7, mat,
                        parent=parent, verts=8))
    obs.append(cyl(name + "hub", rim * 2.2, rim * 3, (0, 0, -rim * 1.5), mat, parent=parent, verts=16))
    if knob:
        obs.append(cyl(name + "knob", rim * 0.9, r * 0.45, (r, 0, 0), mat, parent=parent, verts=10))
    return obs


# the pot's side: a round foot (narrow where the rails pass it), the wide belly (full to the posts, as Flash's), in to the rim
POT_PROF = [(0.0, 0.0), (1.1, 0.0), (1.24, 0.1), (1.3, 0.37), (1.66, 0.62), (1.85, 0.95), (S.POT_RMAX, 1.3), (S.POT_RMAX, 1.9),
            (1.86, 2.4), (1.78, 2.78), (1.71, S.POT_H - 0.12)]


def pot():
    """The pot: a round-bellied cauldron with a rolled rim, dark seams and rivets; rusty inside."""
    H, RM = S.POT_H, S.POT_RMAX
    prof = POT_PROF
    lathe("pot", prof, (0, 0, ZP), M["pot"], verts=64)
    # the rolled rim
    lathe("potrim", [(1.66, H - 0.14), (1.73, H - 0.15), (S.POT_R, H - 0.08), (S.POT_R, H - 0.02), (1.7, H),
                     (1.6, H - 0.02), (1.58, H - 0.1)], (0, 0, ZP), M["gold"], verts=64)
    # inside: rusty wall down to the putty
    lathe("potin", [(1.585, H - 0.1), (1.56, H - 0.6), (1.5, H - 1.1), (0.0, H - 1.1)], (0, 0, ZP), M["potin"],
          verts=64)
    # seams up the belly, with rivets
    rnd = R(21)
    for th in (-128.0, -20.0, 64.0, 150.0):
        pts = []
        for z in [0.25 + 0.1 * i for i in range(24)]:
            r = rad_at(prof, z) + 0.012
            pts.append(S.polar(th + 2.0 * math.sin(z * 2), r, ZP + z))
        tube(f"potseam{th:.0f}", pts, 0.035, M["seam"], verts=6)
        for z in (0.55, 1.15, 1.75, 2.3):
            r = rad_at(prof, z) + 0.02
            p = S.polar(th + 5.5, r, ZP + z)
            ob = cyl(f"potrivet{th:.0f}_{z}", 0.05, 0.05, p, M["gold"], verts=8, bevel=0.01)
            ob.rotation_euler = Vector((math.cos(math.radians(th)), math.sin(math.radians(th)), 0)).to_track_quat(
                "Z", "Y").to_euler()


def rad_at(prof, z):
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return prof[-1][0]


def putty_and_stirrer():
    """The moving parts in the pot: the putty's surface (it swirls round once a loop) and the gold crank stirrer
    (three times round a loop), both on the pot's axis."""
    zs = ZR - S.PUTTY_DOWN

    def putty(hub):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, segments=64, radius=1.6)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=4, use_grid_fill=True)
        for v in bm.verts:
            d = v.co.length
            a = math.atan2(v.co.y, v.co.x)
            # a soft swirl: two arms winding out from the middle, a low mound round the stirrer
            v.co.z = 0.06 * math.sin(2 * a + 5.0 * d) * min(1.0, d / 0.4) * (1 - d / 1.7) + 0.08 * max(0, 1 - d / 0.5)
        mesh_ob("puttysurf", bm, [M["putty"]], parent=hub)

    def stirrer(hub):
        # the stirrer: up out of the putty, a round bend out along the arm, a round bend down into the putty
        r, up = 0.62, 0.95
        pts = [(0, 0, -0.25), (0, 0, up - 0.2)]
        for i in range(1, 7):
            a = math.pi / 2 * i / 6
            pts.append((0.2 * (1 - math.cos(a)), 0, up - 0.2 + 0.2 * math.sin(a)))
        pts += [(r - 0.2, 0, up)]
        for i in range(1, 7):
            a = math.pi / 2 * i / 6
            pts.append((r - 0.2 + 0.2 * math.sin(a), 0, up - 0.2 * (1 - math.cos(a))))
        pts += [(r, 0, -0.25)]
        tube("stirrer", pts, 0.06, M["gold"], parent=hub, verts=10)
        # two blades under the surface show through the swirl's dips
        tube("stirblade", [(-0.5, 0, 0.02), (0, 0, 0.04), (0.5, 0, 0.02)], 0.045, M["gold"], parent=hub, verts=8)

    for name, fn in (("putty", putty), ("stir", stirrer)):
        e, hub = spinner(name, (0, 0, zs), 0.0, 90.0, fn)
        MOVING.append(hub)


def block():
    """The pale press block on the rim, sooty below, two holes in its top."""
    bx, by, bh = S.BLOCK_SIZE
    x, y = S.BLOCK
    b = box("block", (bx, by, bh), (x, y, ZR - 0.02), M["block"], bevel=0.12, jitter=0.02)
    for dx in (-0.3, 0.12):
        cyl(f"blockhole{dx}", 0.12, 0.1, (x + dx, y - 0.05, ZR - 0.02 + bh - 0.07), M["hole"], verts=12, bevel=0.0)
    return b


def wheel():
    """The gold hand wheel on its axle out of the pot's side."""
    c = Vector(S.polar(S.WHEEL_TH, S.WHEEL_D, ZP + S.WHEEL_UP))
    a = math.radians(S.WHEEL_AX)
    out = Vector((math.cos(a), math.sin(a), 0))
    inner = c - out * (c - Vector((0, 0, c.z))).length      # back along the axle to the pot's skin
    while (inner - Vector((0, 0, inner.z))).length > 1.86:
        inner += out * 0.02
    tube("wheelaxle", [inner, c + out * 0.08], 0.06, M["gold"], verts=10)
    e = bpy.data.objects.new("wheel", None)
    link(e)
    e.location = c
    e.rotation_euler = out.to_track_quat("Z", "Y").to_euler()
    handwheel("wheel", S.WHEEL_R, M["gold"], e)
    # a boss on the pot where the axle goes in
    ob = cyl("wheelboss", 0.16, 0.12, inner - out * 0.08, M["gold"], verts=16)
    ob.rotation_euler = out.to_track_quat("Z", "Y").to_euler()


def tube_and_holder(z0, z1, arm_from):
    """The test tube standing at TUBE_XY from z0 to z1 (its top), its gold holder ring and horn, and the gold arm
    from arm_from (a world point on the body) to the holder."""
    x, y = S.TUBE_XY
    r = S.TUBE_R
    ln = z1 - z0
    lathe("tubeglass", [(0.0, 0.0), (r * 0.7, 0.02), (r, 0.2), (r, ln)], (x, y, z0), M["liquid"], verts=24)
    cyl("tubetop", r * 1.02, 0.42, (x, y, z1 - 0.42), M["glass"], verts=24, bevel=0.02)
    cyl("tubecap", r * 1.12, 0.2, (x, y, z1), M["cap"], verts=24, bevel=0.05)
    # the holder: a gold collar round the tube's neck and a flared horn to the screen's right
    lathe("holder", [(r * 1.04, -0.32), (r * 1.4, -0.26), (r * 1.48, 0.0), (r * 1.4, 0.26), (r * 1.04, 0.32)], (x, y, z1 - 0.55),
          M["gold"], verts=24)
    a = math.radians(40.0)
    d = Vector((math.cos(a), math.sin(a), 0.0))
    base = Vector((x, y, z1 - 0.55)) + d * r * 1.38
    ob = lathe("holderhorn", [(0.09, 0.0), (0.1, 0.35), (0.16, 0.5), (0.3, 0.62), (0.32, 0.66), (0.0, 0.64)], base,
               M["gold"], verts=20)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    # the arm from the body to the holder
    last = arm_from[-1] if isinstance(arm_from, list) else arm_from
    p1 = Vector((x, y, z1 - 0.55)) - (Vector((x, y, 0)) - Vector((last[0], last[1], 0))).normalized() * r * 1.25
    pts = [Vector(q) for q in arm_from] if isinstance(arm_from, list) else [Vector(arm_from)]
    tube("tubearm", pts + [p1], 0.06, M["gold"], verts=10)


def frame():
    """Level 3 up: the purple frame and the stumps. A post stands on each stump; the rails join the posts, the crossed
    straps under them carry the pot's foot, and a bracket from each post's top holds the rim."""
    cs = [Vector(S.corner(i)) for i in range(4)]
    zr, t, zt = S.RAIL_Z, S.RAIL_T, S.post_top(L)
    for i in range(4):
        a, b = cs[i], cs[(i + 1) % 4]
        sweep(f"rail{i}", [(a.x, a.y, zr), (b.x, b.y, zr)], (0, 0, 1), t * 1.1, t, M["purple"], bevel=0.15)
    for i in range(2):                      # from stump to stump, set into their sides
        a, b = cs[i].normalized() * (S.STUMP_D - S.STUMP_R + 0.06), cs[i + 2].normalized() * (S.STUMP_D - S.STUMP_R + 0.06)
        sweep(f"strap{i}", [(a.x, a.y, (S.STRAP_Z + ZP) / 2), (b.x, b.y, (S.STRAP_Z + ZP) / 2)], (0, 0, 1),
              ZP - S.STRAP_Z, 0.36, M["purple"], bevel=0.06)
    for i, c in enumerate(cs):
        d = c.normalized()
        cyl(f"post{i}", S.POST_R, zt - zr, (c.x, c.y, zr), M["purple"], verts=20, bevel=0.0)
        lathe(f"postknob{i}", [(0.0, -0.05), (S.POST_R * 1.1, 0.0), (S.POST_R * 1.35, 0.14), (S.POST_R * 1.32, 0.3),
                               (S.POST_R * 1.0, 0.44), (0.0, 0.49)], (c.x, c.y, zt - 0.05), M["purple"], verts=20)
        lathe(f"postfoot{i}", [(0.0, 0.0), (S.POST_R * 1.6, 0.0), (S.POST_R * 1.4, 0.22), (S.POST_R * 0.99, 0.4),
                               (0.0, 0.32)], (c.x, c.y, zr + t / 2 - 0.04), M["purple"], verts=20)
        # the bracket from the post's top to the pot, under the rim
        zb = ZR - 0.35
        sweep(f"bracket{i}", [(d.x * 1.68, d.y * 1.68, zb), (c.x, c.y, zb)], (0, 0, 1), 0.3, 0.26, M["purple"],
              bevel=0.08)
        # a bolt through each corner
        p = c + d * (S.POST_R - 0.02)
        ob = cyl(f"bolt{i}", 0.09, 0.2, (p.x, p.y, zr), M["steel"], verts=6, bevel=0.02)
        ob.rotation_euler = Vector((d.x, d.y, 0)).to_track_quat("Z", "Y").to_euler()
        # the stump under the post
        s_ = d * S.STUMP_D
        lathe(f"stump{i}", [(0.0, 0.0), (S.STUMP_R * 1.06, 0.0), (S.STUMP_R, 0.4), (S.STUMP_R * 0.97, S.STUMP_H - 0.03)],
              (s_.x, s_.y, 0), M["stump"]("Z"), verts=24)
        cyl(f"stumptop{i}", S.STUMP_R * 0.97, 0.03, (s_.x, s_.y, S.STUMP_H - 0.03), M["stumptop"], verts=24, bevel=0.01)


def arches():
    """Level 3 up: two pale arches over the pot, from the press block to the far rim."""
    y0, y1 = S.ARCH_Y
    zl = ZR + S.BLOCK_SIZE[2] - 0.1          # the near feet on the block's top
    zf = ZR + 0.05                            # the far feet on the rim
    zc = S.z_crown(L)
    for i, x in enumerate(S.ARCH_X):
        pts = []
        for k in range(25):
            s = k / 24
            y = y0 + (y1 - y0) * s
            base = zl + (zf - zl) * s
            pts.append((x, y, base + (zc - (zl + zf) / 2) * math.sin(math.pi * s) ** 0.8))
        sweep(f"arch{i}", pts, (1, 0, 0), 0.54, 0.46, M["arch"], bevel=0.12,
              taper=lambda s: 1.15 - 0.2 * math.sin(math.pi * s))
        # the far foot's seat on the rim
        box(f"archseat{i}", (0.5, 0.4, 0.14), (x, y1 - 0.05, ZR - 0.02), M["arch"], bevel=0.05)


def helix(name, c, r, z0, z1, turns, wire, mat, axis=None, parent=None):
    """A coil of wire round centre c (world), from z0 to z1 along local Z (axis: the coil's direction, default up)."""
    n = int(turns * 24)
    pts = [(r * math.cos(2 * math.pi * turns * i / n), r * math.sin(2 * math.pi * turns * i / n),
            z0 + (z1 - z0) * i / n) for i in range(n + 1)]
    ob = tube(name, pts, wire, mat, parent=parent, verts=8)
    ob.location = c
    if axis is not None:
        ob.rotation_euler = Vector(axis).to_track_quat("Z", "Y").to_euler()
    return ob


def hub():
    """Level 6 up: the hub across the arches' crown, the flask on it with its glass loop (level 6; the coil takes its
    place at level 10), the valve wheel on its shaft out to the left and the gold arm out to the right."""
    zh = S.z_hub(L)
    x0, x1 = S.ARCH_X
    # the hub: a big round tan boss (as Flash's), fat in the middle and rounded off at the ends, a raised ring round
    # the axle hole on its end toward the viewer's right
    hr, hl = S.HUB_R, x1 + 0.18
    lathe("hub", [(0.0, -hl), (hr * 0.62, -hl), (hr * 0.88, -hl + 0.1), (hr, -hl + 0.32), (hr, hl - 0.32),
                  (hr * 0.88, hl - 0.1), (hr * 0.62, hl), (0.0, hl)], (0, 0, zh), M["arch"], rot=(0, 90, 0), verts=32)
    lathe("hubring", [(0.0, -0.05), (0.4, -0.05), (0.42, 0.06), (0.36, 0.13), (0.24, 0.13), (0.2, 0.06), (0.0, 0.06)],
          (hl - 0.02, 0, zh), M["arch"], rot=(0, 90, 0), verts=24)
    ob = cyl("hubhole", 0.19, 0.04, (hl + 0.09, 0, zh), M["hole"], verts=16, bevel=0.0)
    ob.rotation_euler = (0, math.radians(90), 0)
    # the flask: a purple bulb on a collar on the hub's top, a glass neck
    fx, fy = S.FLASK
    ztop = zh + math.sqrt(S.HUB_R ** 2 - fy ** 2)
    cyl("flaskcollar", 0.16, 0.16, (fx, fy, ztop - 0.06), M["gold"], verts=16, bevel=0.02)
    lathe("flask", [(0.0, 0.0), (0.2, 0.02), (0.36, 0.16), (0.4, 0.36), (0.33, 0.6), (0.14, 0.74), (0.11, 0.86),
                    (0.0, 0.86)], (fx, fy, ztop + 0.08), M["liquid"], verts=24)
    if L < 10:
        # the glass loop from the flask's neck up and over into the hub's top
        p0 = Vector((fx, fy, ztop + 0.84))
        p1 = Vector((0.45, 0.3, zh + math.sqrt(S.HUB_R ** 2 - 0.3 ** 2) - 0.02))
        top = max(p0.z, p1.z) + 0.85
        pts = [p0, p0 + Vector((0, 0, top - p0.z - 0.3))]
        m, h = (p0 + p1) / 2, (p1 - p0)
        for i in range(1, 8):
            a = math.pi * i / 8
            pts.append(Vector((m.x - h.x / 2 * math.cos(a), m.y - h.y / 2 * math.cos(a), top - 0.3 + 0.3 * math.sin(a))))
        pts += [Vector((p1.x, p1.y, top - 0.3)), p1]
        tube("flaskloop", pts, 0.07, M["glass"], verts=10)
        # where the loop goes into the hub: a tan knob with a dark mouth (Flash's dark hole over the hub)
        lathe("hubknob", [(0.0, -0.1), (0.22, -0.1), (0.24, 0.1), (0.19, 0.2), (0.11, 0.2), (0.11, 0.12), (0.0, 0.12)],
              (p1.x, p1.y, p1.z - 0.02), M["arch"], verts=20)
    # the valve wheel on its shaft along -Y
    zv = zh + S.VALVE_UP
    tube("valveshaft", [(0.0, -S.HUB_R + 0.1, zh), (0.0, -S.HUB_R - 0.5, zh), (0.0, S.VALVE_Y + 0.6, zv),
                        (0.0, S.VALVE_Y - 0.12, zv)], 0.065, M["gold"], verts=10)
    e = bpy.data.objects.new("valve", None)
    link(e)
    e.location = (0.0, S.VALVE_Y, zv)
    e.rotation_euler = Vector((0, -1, 0)).to_track_quat("Z", "Y").to_euler()
    handwheel("valve", S.VALVE_R, M["gold"], e, spokes=5)
    # the arm out to the right: from the hub's end to the tube's holder
    zt = S.TUBE_TOP6
    tube_and_holder(zt - S.TUBE_LEN6, zt, [(hl - 0.05, 0.0, zh + 0.3), (hl + 0.3, 0.06, zh + 0.28)])


def cage():
    """Level 10: the cage wheel on the hub's axle, out to the back right: two gold rims, rungs across, spokes to a
    hub, putty clinging to the rungs and sagging between them. It turns (two rungs a loop)."""
    zh = S.z_hub(L)
    y1 = S.CAGE_Y + S.CAGE_W / 2
    zc = zh - S.CAGE_DOWN
    tube("cageaxle", [(0.0, S.HUB_R - 0.1, zh), (0.0, S.HUB_R + 0.25, zh), (0.0, S.HUB_R + 0.55, zc),
                      (0.0, y1 + 0.2, zc)], 0.08, M["steel"], verts=10)
    rnd = R(31)

    def parts(hub):
        rr = S.CAGE_R
        for k, z in enumerate((-S.CAGE_W / 2, S.CAGE_W / 2)):
            pts = [(rr * math.cos(2 * math.pi * i / 48), rr * math.sin(2 * math.pi * i / 48), z) for i in range(49)]
            tube(f"cagerim{k}", pts, 0.07, M["gold"], parent=hub, verts=10)
            for j in range(4):
                a = 2 * math.pi * (j + 0.5) / 4
                tube(f"cagespoke{k}{j}", [(0, 0, z), (rr * math.cos(a), rr * math.sin(a), z)], 0.05, M["gold"],
                     parent=hub, verts=8)
            cyl(f"cagehub{k}", 0.16, 0.16, (0, 0, z - 0.08), M["gold"], parent=hub, verts=16)
        for j in range(S.CAGE_RUNGS):
            a = 2 * math.pi * j / S.CAGE_RUNGS
            c, sn = math.cos(a), math.sin(a)
            tube(f"cagerung{j}", [(rr * c, rr * sn, -S.CAGE_W / 2), (rr * c, rr * sn, S.CAGE_W / 2)], 0.055, M["gold"],
                 parent=hub, verts=8)
            # putty clinging to the rung: a fat lump over most of it (Flash's big purple knobs on the rim)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
            for v in bm.verts:
                v.co.x *= 0.3
                v.co.y *= 0.3
                v.co.z *= 0.42
            ob = mesh_ob(f"cageputty{j}", bm, [M["putty"]], parent=hub)
            ob.location = ((rr - 0.02) * c, (rr - 0.02) * sn, rnd.uniform(-0.06, 0.06))
            ob.rotation_euler = (0, 0, a)
            # a string sagging in toward the next rung, both sides
            b = a + math.pi / S.CAGE_RUNGS
            a2 = a + 2 * math.pi / S.CAGE_RUNGS
            for zz in (-0.36, 0.32):
                tube(f"cagestring{j}_{zz}", [((rr - 0.05) * c, (rr - 0.05) * sn, zz),
                                             ((rr - 0.45) * math.cos(b), (rr - 0.45) * math.sin(b), zz + 0.05),
                                             ((rr - 0.05) * math.cos(a2), (rr - 0.05) * math.sin(a2), zz)],
                     0.1, M["putty"], parent=hub, verts=8, r_end=0.07)
            # a thick strand from every lump in to the axle: the putty the cage winds up
            for zz in ((-0.15,) if j % 2 else (-0.36, 0.26)):
                tube(f"cagestrand{j}_{zz}", [((rr - 0.1) * c, (rr - 0.1) * sn, zz * 0.6),
                                             (0.95 * math.cos(a - 0.12), 0.95 * math.sin(a - 0.12), zz),
                                             (0.45 * math.cos(a - 0.3), 0.45 * math.sin(a - 0.3), zz * 0.8),
                                             (0.14 * math.cos(a - 0.4), 0.14 * math.sin(a - 0.4), zz * 0.8)],
                     0.13, M["putty"], parent=hub, verts=8, r_end=0.09)
        # a wad of putty wound round the axle between the two hubs
        lathe("cagewad", [(0.0, -0.44), (0.2, -0.42), (0.36, -0.28), (0.42, -0.05), (0.4, 0.15), (0.3, 0.32), (0.16, 0.42),
                          (0.0, 0.44)], (0, 0, 0), M["putty"], parent=hub, verts=20)
    e, h = spinner("cage", (0.0, S.CAGE_Y, zc), 90.0, 0.0, parts)
    MOVING.append(h)
    # the coil: from a bulb on the valve shaft, up and along +Y to the flask's neck (in place of the glass loop)
    zb = zh + S.VALVE_UP + 0.95          # the bulb clear above the valve wheel's rim
    yb = S.VALVE_Y + 0.35
    lathe("coilbulb", [(0.32 * math.sin(math.pi * i / 12), -0.3 * math.cos(math.pi * i / 12)) for i in range(13)],
          (0.0, yb, zb),
          M["liquid"], verts=20)
    cyl("coilstem", 0.06, zb - zh - S.VALVE_UP - 0.25, (0.0, yb, zh + S.VALVE_UP), M["gold"], verts=10)
    fx, fy = S.FLASK
    ztop = zh + math.sqrt(S.HUB_R ** 2 - fy ** 2)
    zc = zb + 1.05
    helix("coil", (0.0, yb + 0.45, zc), 0.36, 0.0, (fy - 0.2) - (yb + 0.45), 4.5, 0.06, M["steel"], axis=(0, 1, 0))
    tube("coillead", [(0.0, yb, zb + 0.28), (0.0, yb, zc), (0.0, yb + 0.45, zc)], 0.06, M["steel"], verts=8)
    tube("coillead2", [(0.0, fy - 0.2, zc), (fx, fy, zc), (fx, fy, ztop + 0.9)], 0.06, M["steel"], verts=8)
    # the basin under the cage's far end, on an arm from the right post
    bx, by, bz = S.BASIN
    lathe("basin", [(0.0, -0.62), (0.4, -0.58), (0.7, -0.36), (0.82, -0.08), (0.86, 0.0), (0.8, 0.0), (0.66, -0.3),
                    (0.36, -0.5), (0.0, -0.52)], (bx, by, bz), M["pot"], verts=32)
    lathe("basinputty", [(0.0, -0.2), (0.7, -0.2), (0.0, -0.18)], (bx, by, bz), M["putty"], verts=32)
    c = Vector(S.corner(1))
    d = (Vector((bx, by)) - c).normalized()
    p0 = c + d * (S.POST_R - 0.05)
    p1 = Vector((bx, by)) - d * 0.8
    tube("basinarm", [(p0.x, p0.y, S.post_top(L) - 0.3), (p1.x, p1.y, bz - 0.2)], 0.07, M["gold"], verts=10)
    # springs round the stumps
    for i in range(4):
        s_ = Vector(S.corner(i)).normalized() * S.STUMP_D
        helix(f"spring{i}", (s_.x, s_.y, 0.0), S.STUMP_R + 0.07, 0.12, S.STRAP_Z - 0.12, 3.5, 0.06, M["steel"])


def blob(name, at, r, squash=0.6, mat=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=r)
    for v in bm.verts:
        v.co.z *= squash
    ob = mesh_ob(name, bm, [mat or M["putty"]])
    ob.location = at
    return ob


def drips():
    """Level 10: putty slopped over the arches' crown and over the pot's rim, running down in drips."""
    y0, y1 = S.ARCH_Y
    zl, zf, zc = ZR + S.BLOCK_SIZE[2] - 0.1, ZR + 0.05, S.z_crown(L)
    rnd = R(41)
    for i, x in enumerate(S.ARCH_X):
        for k, s_ in enumerate((0.3, 0.42, 0.66, 0.78)):
            y = y0 + (y1 - y0) * s_
            z = zl + (zf - zl) * s_ + (zc - (zl + zf) / 2) * math.sin(math.pi * s_) ** 0.8 + 0.2
            blob(f"drip{i}{k}", (x + rnd.uniform(-0.05, 0.05), y, z), 0.3, 0.55)
            side = 1 if (k + i) % 2 else -1
            tube(f"driprun{i}{k}", [(x + side * 0.2, y, z), (x + side * 0.3, y, z - 0.3), (x + side * 0.3, y + 0.05,
                                    z - 0.3 - rnd.uniform(0.2, 0.5))], 0.09, M["putty"], verts=8, r_end=0.06)
    for k, th in enumerate((-70.0, -40.0, -12.0, 15.0)):
        p = Vector(S.polar(th, S.POT_R - 0.05, ZR + 0.02))
        blob(f"driprim{k}", p, 0.26, 0.5)
        q = Vector(S.polar(th, S.POT_R + 0.06, ZR - 0.05))
        tube(f"driprimrun{k}", [p + Vector((0, 0, 0.05)), q, Vector(S.polar(th + 2, rad_at_pot(ZR - 0.5 - ZP) + 0.05,
                                ZR - 0.5 - rnd.uniform(0.0, 0.4)))], 0.09, M["putty"], verts=8, r_end=0.06)


def rad_at_pot(z):
    return rad_at(POT_PROF, z)


def build():
    pot()
    putty_and_stirrer()
    block()
    wheel()
    x, y = S.TUBE_XY
    if L < 6:
        top = S.TUBE_TOP[0 if L < 3 else 1]
        a = math.atan2(y, x)
        tube_and_holder(0.0, top, (S.POT_R * 0.97 * math.cos(a), S.POT_R * 0.97 * math.sin(a), ZR - 0.25))
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



FAMILY = (("stir", "stirrer"), ("putty", "putty"), ("cage", "cage"), ("potrim", "rim"), ("potseam", "pot"),
          ("potrivet", "pot"), ("potin", "potin"), ("pot", "pot"), ("wheelboss", "pot"), ("wheel", "wheel"),
          ("blockhole", "block"), ("block", "block"), ("tubearm", "arm"), ("tube", "tube"), ("holder", "tube"),
          ("rail", "frame"), ("strap", "frame"), ("postknob", "frame"), ("postfoot", "frame"), ("post", "post"),
          ("bracket", "bracket"), ("bolt", "frame"), ("stumptop", "stump"), ("stump", "stump"),
          ("archseat", "arch"), ("arch", "arch"), ("hub", "hub"), ("flask", "flask"), ("valve", "valve"),
          ("hubarm", "hubarm"), ("coil", "coil"), ("basin", "basin"), ("spring", "spring"), ("drip", "drip"))


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
                cur = pairs.get(key, (9.0, 0, 0))
                pairs[key] = (min(cur[0], d), cur[1] + (d < 0.05), cur[2] + 1)
        for (f1, f2), (d, near, n) in sorted(pairs.items()):
            if True:
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
