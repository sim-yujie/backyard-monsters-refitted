"""incubator.py : the Inferno Incubator (building 13, Flash folder ihatchery) in 3D, one look for its three levels,
built clean-room from the Flash picture put into words (14 Nov 2026). Only the generic Inferno kit is used
(../kit.py: camera, light, render modes, helpers), as the Bone Cruncher's crusher.py.

    blender -b --factory-startup -P incubator.py -- 1 <fit|check|gap|still|anim> [frame]

The building: a dark iron egg (the brood vessel) on a crown of iron roots over a bed of embers. On its front right a
round porthole full of green brood; on its left a riveted pump box with a ribbed vent pipe on top and a pale feed
hose looped round its front; on its top, to the back, a short capped stack. Round the foot: a ribbed horn (front), a
clawed arm (front left), a spike (left), a fan of fins (right), a tail (back right) and two plain roots (back).

World: Z up, the egg's axis on the origin. The camera looks from +X -Y, so +X is the front right on screen, -Y the
front left, -X the back left and +Y the back right. Directions are given as (azimuth from +X toward +Y, elevation).

The loop (hatching), 50 frames as Flash's strips: the brood in the porthole churns and the feed hose pumps, both
twice a loop (Flash's strips repeat after 25 cells); the vent's green smoke is laid on after Blender (post.py), once
a loop. Idle is frame 0 with no smoke, as Flash holds cell 0.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402

kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (6.0, 50.0)
kit.FRAME = (-80, -60, 80, 90)
N = 50
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame 50 (= frame 0), the loop check
kit.SUN_COL = (1.0, 0.93, 0.82)
rnd = random.Random(13)

A, C_, ZC = 2.9, 3.3, 3.75          # the egg: half width, half height, height of its middle
CEN = Vector((0, 0, ZC))


# ------------------------------------------------------------------------------------------------------- geometry
def D(az, el=0.0):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))


def S(d, off=0.0):
    """The point of the egg's skin along direction d from its middle, lifted off the skin by `off`."""
    d = Vector(d).normalized()
    rho = 1.0 / math.sqrt((d.x * d.x + d.y * d.y) / (A * A) + d.z * d.z / (C_ * C_))
    return CEN + d * (rho + off)


def normal(d):
    p = S(d) - CEN
    return Vector((p.x / (A * A), p.y / (A * A), p.z / (C_ * C_))).normalized()


def polar(r, az, z=0.0):
    a = math.radians(az)
    return Vector((r * math.cos(a), r * math.sin(a), z))


def basis(zdir, at=(0, 0, 0), xhint=(0, 0, 1)):
    z = Vector(zdir).normalized()
    x = Vector(xhint) - z * Vector(xhint).dot(z)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)) - z * z.x
    x.normalize()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(at)
    return m


def spline(pts, sub=8, closed=False):
    """Catmull-Rom through pts."""
    P = [Vector(p) for p in pts]
    n = len(P)
    out = []
    last = n if closed else n - 1
    for i in range(last):
        g = (lambda j: P[j % n]) if closed else (lambda j: P[max(0, min(n - 1, j))])
        p0, p1, p2, p3 = g(i - 1), g(i), g(i + 1), g(i + 2)
        for s in range(sub):
            t = s / sub
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    if not closed:
        out.append(P[-1])
    return out


def tube_coords(P, rad, seg=12, up=(0, 0, 1)):
    """Rings of `seg` points round path P; rad(s) gives the radius, or (width, thickness) for a flat blade whose
    width lies across `up`."""
    m = len(P)
    rows = []
    nrm = None
    for i, p in enumerate(P):
        t = (P[min(i + 1, m - 1)] - P[max(i - 1, 0)]).normalized()
        if nrm is None:
            nrm = Vector(up) - t * Vector(up).dot(t)
            if nrm.length < 1e-3:
                nrm = Vector((1, 0, 0)) - t * t.x
        else:
            nrm = nrm - t * nrm.dot(t)
        nrm.normalize()
        b = t.cross(nrm)
        r = rad(i / (m - 1))
        rw, rh = r if isinstance(r, tuple) else (r, r)
        rows.append([p + b * (rw * math.cos(2 * math.pi * j / seg)) + nrm * (rh * math.sin(2 * math.pi * j / seg))
                     for j in range(seg)])
    return rows


def tubemesh(name, pts, rad, mat, seg=12, up=(0, 0, 1), sub=8, parent=None, raw=False):
    P = [Vector(p) for p in pts] if raw else spline(pts, sub)
    rows = tube_coords(P, rad, seg, up)
    bm = bmesh.new()
    vr = [[bm.verts.new(c) for c in row] for row in rows]
    for a, b in zip(vr, vr[1:]):
        for j in range(seg):
            bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    bm.faces.new(vr[0][::-1])
    bm.faces.new(vr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat], parent=parent)


def ribbed(r0, r1, ribs, depth=0.16, power=1.0):
    """A tapering radius with `ribs` raised rings (sharp crests, round valleys)."""
    def f(s):
        r = r0 + (r1 - r0) * s ** power
        return r * (1.0 + depth * (1.0 - abs(math.sin(math.pi * ribs * s))) ** 1.3)
    return f


def lathe_at(name, prof, m, mat, verts=32, parent=None, bevel=0.0):
    ob = kit.lathe(name, prof, (0, 0, 0), mat, verts=verts, parent=parent, bevel=bevel)
    ob.matrix_world = m
    return ob


def balls(name, pts, r, mat, squash=1.0, parent=None):
    """Rivet heads: (point, outward normal) pairs."""
    bm = bmesh.new()
    for p, n in pts:
        m = basis(n, p) @ Matrix.Diagonal((1, 1, squash, 1))
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=r, matrix=m)
    return kit.mesh_ob(name, bm, [mat], parent=parent)


# ------------------------------------------------------------------------------------------------------ materials
SHELL = lambda: kit.painted("shell", (34, 48, 38), rough=0.2, metal=0.85, wear=(64, 80, 66), rust=(70, 56, 36),
                            rust_at=0.76, dirt=0.4, scale=3.0, spec=0.9)
PLATE = lambda: kit.painted("plate", (48, 62, 50), rough=0.17, metal=0.85, wear=(100, 116, 98), dirt=0.35,
                            scale=3.5, spec=0.9)
TRIM = lambda: kit.painted("trim", (150, 160, 138), rough=0.2, metal=0.8, wear=(86, 96, 82), dirt=0.3, scale=8.0,
                           spec=0.9)
IRON = lambda: kit.painted("iron", (44, 54, 46), rough=0.26, metal=0.8, wear=(104, 112, 98), rust=(84, 56, 34),
                           rust_at=0.7, dirt=0.4, scale=4.0, soot=0.3, spec=0.8)
ROOT = lambda: kit.painted("root", (60, 74, 58), rough=0.27, metal=0.8, wear=(140, 150, 126), rust=(110, 56, 28),
                           rust_at=0.68, dirt=0.6, scale=5.0, spec=0.8)
STACK = lambda: kit.painted("stack", (92, 100, 94), rough=0.42, metal=0.6, wear=(140, 146, 134), dirt=0.3,
                            scale=6.0, soot=0.4, spec=0.7)
DARK = lambda: kit.flat("dark", (8, 12, 8), rough=0.9)


def brood():
    """The porthole's brood: lime green with slow orange-yellow clots, lit from inside. Its noise is read on a circle
    in two spare dimensions (turn() moves along it), so the churn runs into itself."""
    t = kit.NT("brood")
    v = t.coords(scale=(1, 1, 0))
    mp = v.node
    nz = t.n("ShaderNodeTexNoise", noise_dimensions="4D")
    nz.inputs["Scale"].default_value = 1.15
    nz.inputs["Detail"].default_value = 1.5
    nz.inputs["Roughness"].default_value = 0.45
    nz.inputs["Distortion"].default_value = 0.6
    t.link(v, nz.inputs["Vector"])
    c = t.ramp(nz.outputs["Fac"], [(0.36, kit.srgb(70, 150, 6)), (0.47, kit.srgb(150, 208, 10)),
                                   (0.56, kit.srgb(196, 214, 20)), (0.61, kit.srgb(250, 176, 30)),
                                   (0.72, kit.srgb(255, 206, 70))])
    c.node.color_ramp.interpolation = "EASE"
    t.set(**{"Base Color": c, "rough": 0.08, "spec": 0.8, "coat": 1.0})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = 1.6
    BROOD.update(map=mp, noise=nz)
    return t.m


def hose_mat():
    """The feed hose: pale bone-yellow gut with brown mottling. The mottling is read from coordinates stored on the
    mesh (turn() writes them), so it travels along the hose with the swellings."""
    t = kit.NT("hose")
    at = t.n("ShaderNodeAttribute", attribute_name="hv")
    aw = t.n("ShaderNodeAttribute", attribute_name="hw")
    nz = t.n("ShaderNodeTexNoise", noise_dimensions="4D")
    nz.inputs["Scale"].default_value = 3.2
    nz.inputs["Detail"].default_value = 4.0
    nz.inputs["Roughness"].default_value = 0.6
    t.link(at.outputs["Vector"], nz.inputs["Vector"])
    t.link(aw.outputs["Fac"], nz.inputs["W"])
    c = t.ramp(nz.outputs["Fac"], [(0.36, kit.srgb(128, 96, 62)), (0.5, kit.srgb(214, 186, 128)),
                                   (0.68, kit.srgb(244, 226, 168))])
    c = t.grime(c, 0.0, 2.6, 0.2, 0.6)
    t.set(**{"Base Color": c, "rough": 0.5, "spec": 0.45})
    t.bsdf.inputs["Subsurface Weight"].default_value = 0.15
    t.bump(nz.outputs["Fac"], 0.25, 0.02)
    return t.m


BROOD = {}
HOSE = {}


# ------------------------------------------------------------------------------------------------------ the parts
def egg():
    prof = [(max(0.002, A * math.cos(math.radians(e))), C_ * math.sin(math.radians(e))) for e in range(-90, 91, 5)]
    kit.lathe("egg", prof, CEN, SHELL(), verts=72)
    # the cap seam, tilted a little toward the front, and the wavy skirt seam low down
    cap = [S(basis(D(-45, 78)).to_3x3() @ D(a, 38)) for a in range(0, 360, 5)]
    kit.tube("egg-seam-cap", cap, 0.1, TRIM(), cyclic=True)
    skirt = [S(D(a, -34 + 7 * math.sin(math.radians(5 * a + 40)))) for a in range(0, 360, 3)]
    kit.tube("egg-seam-skirt", skirt, 0.11, TRIM(), cyclic=True)
    # upright seams from cap to skirt
    for n, az in enumerate((100, 190)):
        pts = [S(D(az + 6 * math.sin(math.radians(3 * e)), e)) for e in range(-30, 49, 6)]
        kit.tube(f"egg-seam-up{n}", pts, 0.08, TRIM())


def plate(name, az, el, outline, off=0.08, rings=5, rim=0.075):
    """A raised armour plate on the egg: `outline` in tangent units round direction (az, el), east then north."""
    m = basis(D(az, el), xhint=(0, 0, 1)).to_3x3()         # local X = north, Y = west
    out = spline([Vector((v, -u, 0)) for u, v in outline], 6, closed=True)
    d0 = Vector((0, 0, 1))
    bm = bmesh.new()
    c = bm.verts.new(S(m @ d0, off))
    prev = None
    for r in range(1, rings + 2):
        k = min(1.0, r / rings)
        o = off if r <= rings else -0.02
        row = [bm.verts.new(S(m @ (d0 + p * k), o)) for p in out]
        for j in range(len(row)):
            j2 = (j + 1) % len(row)
            if prev is None:
                bm.faces.new((c, row[j], row[j2]))
            else:
                bm.faces.new((prev[j], row[j], row[j2], prev[j2]))
        prev = row
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob(name, bm, [PLATE()])
    kit.tube(name + "-rim", [S(m @ (d0 + p), off) for p in out], rim, TRIM(), cyclic=True)


def plates():
    # the brow over the porthole: a teardrop, its point up and to the back
    plate("egg-brow", -36, 33, [(-0.42, -0.1), (-0.3, 0.2), (0.02, 0.3), (0.4, 0.26), (0.54, 0.04), (0.3, -0.12),
                                (-0.1, -0.16)])
    # a long cheek plate on the front left, between the pump box and the porthole
    plate("egg-cheek", -68, 2, [(-0.2, -0.44), (-0.26, 0.0), (-0.18, 0.4), (0.1, 0.44), (0.18, 0.1), (0.14, -0.4)])
    # the back plates, seen only at the rim
    plate("egg-back", 60, 18, [(-0.4, -0.3), (-0.36, 0.3), (0.3, 0.36), (0.44, -0.1), (0.1, -0.4)])
    pts = []
    for u, v in ((-0.12, -0.3), (0.06, -0.3), (-0.12, 0.3), (0.04, 0.3), (-0.03, 0.0)):
        m = basis(D(-68, 2), xhint=(0, 0, 1)).to_3x3()
        d = m @ Vector((v, -u, 1))
        pts.append((S(d, 0.07), normal(d)))
    balls("egg-rivets", pts, 0.07, TRIM(), 0.6)


WIN_D = D(-24, -5)


def porthole():
    n = normal(WIN_D)
    m = basis(n, S(WIN_D) - n * 0.3)
    bezel = [(0.98, -0.1), (0.98, 0.34), (1.06, 0.46), (1.22, 0.5), (1.34, 0.42), (1.4, 0.24), (1.42, -0.3)]
    lathe_at("port-bezel", bezel, m, IRON(), verts=48)
    kit.ring("port-lip", 1.21, 0.07, TRIM(), n=48).matrix_world = m @ Matrix.Translation((0, 0, 0.5))
    balls("port-bolts", [(m @ Vector((1.32 * math.cos(a), 1.32 * math.sin(a), 0.4)), n)
                         for a in [math.radians(45 + 60 * i) for i in range(6)]], 0.07, TRIM(), 0.6)
    hub = bpy.data.objects.new("brood", None)
    kit.link(hub)
    hub.matrix_world = m
    kit.MOVING.append(hub)
    glass = [(0.002, 0.42), (0.3, 0.41), (0.6, 0.37), (0.85, 0.3), (1.0, 0.2)]
    ob = kit.lathe("brood-glass", glass, (0, 0, 0), brood(), verts=48, parent=hub)
    return ob


BOX_AZ = -122
BOX_R, BOX_Z0, BOX_Z1 = 3.4, 2.6, 5.2
BOX_HALF = (0.8, 0.78)                       # half its depth (along its outward direction) and half its width


def box_frame():
    out = D(BOX_AZ)
    side = Vector((-out.y, out.x, 0))        # toward the front (the camera's side of the box)
    return out, side


def pump():
    out, side = box_frame()
    m = Matrix((out, side, Vector((0, 0, 1)))).transposed().to_4x4()
    m.translation = polar(BOX_R, BOX_AZ, (BOX_Z0 + BOX_Z1) / 2)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    hz = (BOX_Z1 - BOX_Z0) / 2
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * BOX_HALF[0], v.co.y * 2 * BOX_HALF[1] * (0.86 if v.co.z > 0 else 1.0),
                       v.co.z * 2 * hz - (0.3 if v.co.z > 0 and v.co.x > 0 else 0.0)))
        v.co.x -= 0.5                         # set back into the egg
        v.co.x *= 1.3 if v.co.x < 0 else 1.0
    ob = kit.mesh_ob("pump-box", bm, [IRON()], smooth=False, bevel=0.14, segs=3)
    ob.matrix_world = m
    P = lambda x, y, z: m @ Vector((x, y, z))
    # a trim strip round the front face and rivets on it
    fy = BOX_HALF[1] + 0.005
    edge = [P(-0.95, fy, -hz + 0.2), P(0.1, fy, -hz + 0.2), P(0.1, fy * 0.9, hz - 0.45), P(-0.95, fy * 0.9, hz - 0.2)]
    kit.tube("pump-trim", edge, 0.045, TRIM(), cyclic=True)
    balls("pump-rivets", [(P(x, fy if z < 0 else fy * 0.93, z), side) for x, z in
                          ((-0.15, -0.5), (-0.15, 0.1), (-0.15, 0.7), (-0.7, -0.5), (-0.7, 0.1), (-0.7, 0.75))],
          0.085, TRIM(), 0.6)
    # the vent pipe on top: a collar, a ribbed bellows neck leaning out, a flared mouth with a green glow inside
    top = P(-0.25, 0.0, hz - 0.12)
    aim = (Vector((0, 0, 1)) + out * 0.42 + side * 0.16).normalized()
    pm = basis(aim, top)
    neck = [(0.56, 0.0), (0.56, 0.12), (0.44, 0.2)]
    for i in range(5):
        z = 0.22 + i * 0.19
        neck += [(0.34, z), (0.45, z + 0.07), (0.45, z + 0.11), (0.34, z + 0.18)]
    z = 0.22 + 5 * 0.19
    neck += [(0.36, z + 0.05), (0.5, z + 0.2), (0.6, z + 0.3), (0.62, z + 0.38), (0.54, z + 0.42), (0.44, z + 0.34),
             (0.36, z + 0.1)]
    lathe_at("vent-pipe", neck, pm, IRON(), verts=36)
    lathe_at("vent-throat", [(0.002, z + 0.1), (0.37, z + 0.1)], pm, kit.flat("vent-throat", (5, 12, 3), rough=0.9),
             verts=24)
    lathe_at("vent-glow", [(0.002, z + 0.11), (0.2, z + 0.11)], basis(aim, top + side * 0.06),
             kit.flat("vent-glow", (70, 120, 8), rough=0.6, emit=0.9), verts=16)
    kit.ring("vent-lip", 0.6, 0.045, TRIM(), n=36).matrix_world = pm @ Matrix.Translation((0, 0, z + 0.36))
    VENT["mouth"] = pm @ Vector((0, 0, z + 0.4))
    VENT["aim"] = aim
    # the hose's two sockets: on the box's outer face, high, and on the egg, low at the front of the box
    a = P(BOX_HALF[0] - 0.5, 0.05, 0.6)
    db_ = (P(-0.75, 1.25, -0.8) - CEN).normalized()
    b = S(db_)
    nb = normal(db_)
    for nm, p, d in (("a", a, out), ("b", b, nb)):
        lathe_at(f"pump-socket-{nm}", [(0.34, -0.25), (0.46, -0.2), (0.5, 0.1), (0.42, 0.2), (0.3, 0.2)],
                 basis(d, p), IRON(), verts=24)
    HOSE.update(a=a, da=out, b=b, db=nb, P_=P)


VENT = {}
HOSE_SEG, HOSE_SUB, HOSE_WAVES = 14, 10, 3.0


def hose_path():
    a, da, b, db = HOSE["a"], HOSE["da"], HOSE["b"], HOSE["db"]
    out, side = box_frame()
    P = HOSE["P_"]                             # the pump box's own frame: x out, y to the front, z up from its middle
    pts = [a - da * 0.2, a + da * 0.3, P(1.1, 0.2, 0.05), P(1.25, 0.65, -0.75), P(0.95, 1.35, -1.3), P(0.1, 1.7, -1.3),
           b + db * 0.45, b - db * 0.2]
    return spline(pts, HOSE_SUB)


def hose_rows(ph):
    """The hose's rings with its swellings moved on by `ph` wavelengths."""
    P = HOSE["P"]

    def rad(s):
        w = 0.5 - 0.5 * math.cos(2 * math.pi * (s * HOSE_WAVES - ph))
        thick = 0.24 + 0.12 * s ** 0.7                          # fuller where it sags
        return thick * (0.9 + 0.3 * w ** 1.5)
    return tube_coords(P, rad, HOSE_SEG)


def hose_tex(ph):
    """Per-vertex mottling coordinates: a circle along the hose (two wavelengths round) and a circle round it."""
    m = len(HOSE["P"])
    hv, hw = [], []
    for i in range(m):
        u = 2 * math.pi * ((i / (m - 1)) * HOSE_WAVES - ph) / 2.0
        for j in range(HOSE_SEG):
            f = 2 * math.pi * j / HOSE_SEG
            hv += [0.75 * math.cos(u), 0.75 * math.sin(u), 0.28 * math.cos(f)]
            hw.append(0.28 * math.sin(f))
    return hv, hw


def hose():
    HOSE["P"] = hose_path()
    rows = hose_rows(0.0)
    hub = bpy.data.objects.new("hose", None)
    kit.link(hub)
    kit.MOVING.append(hub)
    bm = bmesh.new()
    vr = [[bm.verts.new(c) for c in row] for row in rows]
    for r0, r1 in zip(vr, vr[1:]):
        for j in range(HOSE_SEG):
            bm.faces.new((r0[j], r0[(j + 1) % HOSE_SEG], r1[(j + 1) % HOSE_SEG], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob("hose-gut", bm, [hose_mat()], parent=hub)
    ob.data.attributes.new("hv", "FLOAT_VECTOR", "POINT")
    ob.data.attributes.new("hw", "FLOAT", "POINT")
    HOSE["ob"] = ob


def stack():
    d = D(62, 66)
    aim = (normal(d) * 0.5 + Vector((0.12, 0.1, 1))).normalized()
    m = basis(aim, S(d) - aim * 0.25)
    prof = [(0.62, 0.0), (0.62, 0.3), (0.44, 0.4), (0.4, 0.7), (0.5, 0.76), (0.52, 0.9), (0.42, 0.96), (0.42, 1.1),
            (0.52, 1.18), (0.56, 1.5), (0.5, 1.6), (0.3, 1.64), (0.002, 1.64)]
    lathe_at("stack", prof, m, STACK(), verts=32)


def foot():
    """The crown the egg sits in, and the embers under it."""
    crown = [(1.5, 0.35), (2.5, 0.5), (2.95, 0.95), (2.95, 1.4), (2.7, 1.72), (2.3, 1.85)]
    kit.lathe("crown", crown, (0, 0, 0), ROOT(), verts=48)
    kit.tube("crown-rim", [polar(2.84, a, 1.6) for a in range(0, 360, 6)], 0.09, TRIM(), cyclic=True)
    ember = [(0.002, 0.5), (2.0, 0.45), (2.4, 0.3), (2.6, 0.12), (2.7, 0.02)]
    kit.lathe("ember", ember, (0, 0, 0), kit.lava("ember", col=(190, 44, 10), hot=(246, 110, 26), strength=0.8,
                                                  scale=1.6), verts=40)


def root(name, az, reach, r0, ribs, curl=0.0, lift=0.0, tip_z=0.12, r1=0.05, mid=1.0, depth=0.16, power=0.8):
    """A ribbed root from the crown out to the ground: `curl` turns it (degrees) toward its tip, `lift` raises the
    tip."""
    pts = [polar(2.0, az, 1.3), polar(3.0, az, 1.25 * mid),
           polar(3.0 + (reach - 3.0) * 0.35, az + curl * 0.15, 0.9 * mid + lift * 0.2),
           polar(3.0 + (reach - 3.0) * 0.7, az + curl * 0.5, 0.42 * mid + lift * 0.55),
           polar(reach, az + curl, tip_z + lift)]
    return tubemesh(name, pts, ribbed(r0, r1, ribs, depth, power), ROOT(), seg=16, sub=30)


def roots():
    # the horn, front: thick, ringed like a ram's horn, its tip turned to the left
    root("horn", -70, 6.9, 1.0, 10, curl=-16, depth=0.4, power=0.9)
    # the clawed arm, front left: a ringed arm ending in three talons
    root("claw", -112, 5.2, 0.66, 7, curl=-6, r1=0.28, tip_z=0.4)
    wrist = polar(5.2, -118, 0.4)
    for i, (da, ln, dz) in enumerate(((-16, 1.5, 0.25), (2, 1.7, -0.1), (20, 1.3, 0.2))):
        d = D(-118 + da)
        pts = [wrist - d * 0.15, wrist + d * ln * 0.5 + Vector((0, 0, 0.22 + dz * 0.5)),
               wrist + d * ln + Vector((0, 0, max(-0.3, dz - 0.25)))]
        tubemesh(f"claw-talon{i}", pts, lambda s: 0.2 * (1 - s) ** 0.7 + 0.02, ROOT(), seg=10, sub=8)
    # the spike, left: a straight cone held level off the crown
    tubemesh("spike", [polar(2.2, -150, 1.3), polar(4.4, -150, 1.2), polar(6.4, -150, 1.05)],
             lambda s: 0.8 * (1 - s) + 0.015, ROOT(), seg=16, sub=6)
    kit.tube("spike-ring", [polar(3.2, -150, 1.26) + basis(D(-150)).to_3x3() @ Vector((0.7 * math.cos(a),
             0.7 * math.sin(a), 0)) for a in [math.radians(x) for x in range(0, 360, 12)]], 0.06, TRIM(), cyclic=True)
    # the fins, right: a fan of ribbed blades
    for i, (az, reach, tilt) in enumerate(((-26, 5.3, 0.3), (-10, 5.7, 0.12), (7, 5.3, 0.5), (23, 4.6, 0.9))):
        pts = [polar(2.0, az, 1.3), polar(3.1, az, 1.3), polar(3.1 + (reach - 3.1) * 0.5, az + 2, 0.85 + tilt * 0.4),
               polar(reach, az + 5, 0.1 + tilt)]

        def blade(s, k=i):
            w = 0.28 + 0.4 * math.sin(math.pi * min(1.0, s * 1.15) ** 0.8) if s > 0.25 else 0.5
            w *= 1.0 + 0.14 * (1.0 - abs(math.sin(math.pi * 9 * s))) ** 2
            return (max(0.02, w * (1.0 if s < 0.9 else (1 - s) * 10)), max(0.03, 0.26 * (1 - s * 0.8)))
        tubemesh(f"fin{i}", pts, blade, ROOT(), seg=12, sub=24)
    # the tail, back right: thin, rising in an S and reaching out level
    pts = [polar(2.0, 44, 1.3), polar(3.0, 44, 1.2), polar(3.8, 46, 1.2), polar(4.5, 50, 2.0), polar(5.3, 49, 2.1),
           polar(6.0, 45, 1.35), polar(6.9, 44, 1.2)]
    tubemesh("tail", pts, ribbed(0.55, 0.05, 14, 0.25, 0.6), ROOT(), seg=12, sub=20)
    # two plain roots at the back
    root("rootb", 105, 5.4, 0.7, 8, curl=10)
    root("rootc", 168, 5.2, 0.7, 8, curl=-12)
    # two short stubs at the front, between the horn and its neighbours
    root("rootd", -47, 4.6, 0.62, 6, curl=8, depth=0.3)
    root("roote", -92, 4.3, 0.6, 6, curl=-5, depth=0.3)


def cards():
    """Two bright cards that only shiny metal sees (no light on matt surfaces, no shadow, not in the picture): the
    hard highlights of Flash's polished iron. The sun, sky and camera stay the kit's."""
    v = -kit.cam_fwd()
    r = Vector((1, 1, 0)).normalized()
    u = v.cross(r) * -1
    u = r.cross(v) if r.cross(v).z > 0 else v.cross(r)
    for nm, n, size, col, e in (("card-key", v + u * 0.5 - r * 0.5, 7.0, (1.0, 0.95, 0.82), 30.0),
                                ("card-sky", v + u * 1.3 + r * 0.2, 16.0, (0.7, 0.8, 1.0), 2.5)):
        n = n.normalized()
        l = (2 * n.dot(v) * n - v).normalized()
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
        ob = kit.mesh_ob(nm, bm, [kit.flat(nm, tuple(int(255 * c) for c in col), emit=e)], smooth=False)
        ob.matrix_world = basis(-l, CEN + l * 22)
        ob.visible_camera = ob.visible_diffuse = ob.visible_shadow = ob.visible_transmission = False
        ob.visible_volume_scatter = False


def build():
    cards()
    egg()
    plates()
    porthole()
    pump()
    hose()
    stack()
    foot()
    roots()


def turn(k):
    f = (k % N) / N
    th = 2 * math.pi * 2 * f                         # the brood and the hose go round twice a loop
    BROOD["map"].inputs["Location"].default_value = (0.0, 0.0, 0.42 * math.cos(th))
    BROOD["noise"].inputs["W"].default_value = 0.42 * math.sin(th)
    ob = HOSE["ob"]
    rows = hose_rows(2 * f)
    co = [c for row in rows for p in row for c in p]
    ob.data.vertices.foreach_set("co", co)
    hv, hw = hose_tex(2 * f)
    ob.data.attributes["hv"].data.foreach_set("vector", hv)
    ob.data.attributes["hw"].data.foreach_set("value", hw)
    ob.data.update()


kit.run(build, turn)
if kit.MODE == "where":                              # the smoke's start for post.py
    print("VENT mouth px %.2f %.2f aim px %.3f %.3f" % (*kit.scr(VENT["mouth"]),
          *[a - b for a, b in zip(kit.scr(VENT["mouth"] + VENT["aim"]), kit.scr(VENT["mouth"]))]))
