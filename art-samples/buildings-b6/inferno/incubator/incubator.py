"""incubator.py : the Inferno Incubator (building 13, Flash folder ihatchery) in 3D, one look for its three levels,
built clean-room from the Flash picture put into words (14 Nov 2026). Only the generic Inferno kit is used
(../kit.py: camera, light, render modes, helpers), as the Bone Cruncher's crusher.py.

    blender -b --factory-startup -P incubator.py -- 1 <fit|check|gap|still|anim> [frame]

The building: a squat dark iron egg (the brood vessel) sunk into short fat legs, plain dark under it. Its armour
shell ends in a wavy hem above the lower body and carries broad embossed seams traced from Flash. On its front right
a round porthole full of green brood; on its left a riveted pump box with a fat ribbed vent pipe on top and a pale
feed hose looped round its front; on its top, to the back, a short capped stack. Round the foot: a fat ringed leg
(front), a clawed arm (front left), a ringed horn (left), a clump of claws (right) and two feelers (back right).

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

# The body, measured on Flash: 56 px wide (x -22..34), its top at y -17, widest low (y 22..25), its lower third
# behind the legs, leaning a little to the back left. A helmet: a tall dome with broad shoulders over a short fat
# bottom that only tucks in under the legs.
A, ZC = 2.8, 3.0                    # half width; height of the widest point
CT, CB = 4.25, 3.1                  # the dome's height above the widest point; the bottom's depth below it
NT_, NB = 2.35, 3.0                 # how square the dome's shoulders and the bottom are (2 = an egg)
LEAN = (-0.11, -0.03)               # the top leans this far (per unit of height) to the back left
IN = 0.13                           # the lower body lies this far inside the shell
CEN = Vector((0, 0, ZC))


# ------------------------------------------------------------------------------------------------------- geometry
def D(az, el=0.0):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))


def rho(d):
    """The body's radius along unit direction d (before the lean)."""
    c, n = (CT, NT_) if d.z >= 0 else (CB, NB)
    return ((math.hypot(d.x, d.y) / A) ** n + (abs(d.z) / c) ** n) ** (-1.0 / n)


def lean(q):
    return Vector((q.x + LEAN[0] * q.z, q.y + LEAN[1] * q.z, q.z))


def unlean(q):
    return Vector((q.x - LEAN[0] * q.z, q.y - LEAN[1] * q.z, q.z))


def S(d, off=0.0):
    """The point of the body's skin along direction d from its middle (d before the lean), lifted off the skin by
    `off` along the skin's normal."""
    d = Vector(d).normalized()
    p = CEN + lean(d * rho(d))
    return p + normal(d) * off if off else p


def normal(d):
    d = Vector(d).normalized()
    t1 = d.orthogonal().normalized()
    t2 = d.cross(t1)
    e = 2e-3
    n = (S(d + t1 * e) - S(d - t1 * e)).cross(S(d + t2 * e) - S(d - t2 * e)).normalized()
    return n if n.dot(d) > 0 else -n


def skin(p, off=0.0):
    """The skin point under (or over) world point p."""
    return S(unlean(Vector(p) - CEN), off)


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
def iron(name, col, wear, rough=(0.16, 0.5), scale=3.0, patch=0.5, rust=None, dirt=0.4, metal=0.9, spec=0.9,
         bump=0.12, shine=None):
    """Flash's worn iron: a dark colour with big blotches of a paler, worn one, fine dark pitting, and a polish that
    changes from patch to patch (so the highlights break up instead of lying as clean streaks)."""
    if name in kit.MATS:
        return kit.MATS[name]
    t = kit.NT(name)
    v = t.coords()
    big = t.noise(v, scale * 0.5, 4.0, 0.6, 0.6)
    fine = t.noise(v, scale * 3.0, 5.0, 0.65, 0.2)
    c = t.mix(kit.srgb(*col), kit.srgb(*wear),
              t.ramp(big, [(0.5 - patch * 0.2, (0, 0, 0, 1)), (0.5 + patch * 0.25, (1, 1, 1, 1))]))
    c = t.mix(c, kit.srgb(*[int(x * 0.4) for x in col]), t.ramp(fine, [(0.55, (0, 0, 0, 1)), (0.8, (0.5, 0.5, 0.5, 1))]))
    if rust:
        n2 = t.noise(v, scale * 0.8, 5.0, 0.65, 1.0)
        c = t.mix(c, kit.srgb(*rust), t.ramp(n2, [(0.66, (0, 0, 0, 1)), (0.8, (0.6, 0.6, 0.6, 1))]))
    c = t.grime(c, kit.GROUND, 2.2, dirt, 0.5)
    lo, hi = rough
    r = t.ramp(fine, [(0.36, (lo, lo, lo, 1)), (0.7, (hi, hi, hi, 1))])
    for attr, tone, a0, a1, amount, pol, *brk in shine or ():
        # a pale worn tone where the mesh's own `attr` says so: a seam's crest, the shell's broad sheen
        at = t.n("ShaderNodeAttribute", attribute_name=attr)
        f = t.ramp(at.outputs["Fac"], [(a0, (0, 0, 0, 1)), (a1, (amount, amount, amount, 1))])
        if brk:
            # only in patches (noise of this scale, this share of it): the wear catches the light in short bits
            bs, b0, b1 = brk[0]
            f = t.mix((0, 0, 0, 1), f, t.ramp(t.noise(v, bs, 3.0, 0.6, 0.3), [(b0, (0, 0, 0, 1)), (b1, (1, 1, 1, 1))]))
        c = t.mix(c, kit.srgb(*tone), f)
        r = t.mix(r, (pol, pol, pol, 1), f)
    t.set(**{"Base Color": c, "rough": r, "metal": metal, "spec": spec})
    t.bump(big, bump, 0.03)
    kit.MATS[name] = t.m
    return t.m


SHEEN = ("sheen", (84, 96, 80), 0.0, 1.0, 0.32, 0.42)
SHELL_KW = dict(rough=(0.32, 0.58), scale=2.0, patch=1.3, bump=0.04, metal=0.9, spec=0.3)
SHELL = lambda: iron("shell", (30, 40, 26), (56, 68, 44), shine=[SHEEN], **SHELL_KW)
LOWER = lambda: iron("lower", (15, 19, 16), (40, 46, 38), (0.22, 0.5), scale=3.0, rust=(70, 40, 22), metal=0.85)
# a seam is the shell's own iron (so its shoulders run into the shell unseen) worn bright along its crest
# only along a thin line on its very crest: a dim grey line there, pale in short broken bits (Flash's seams are
# thin grey lines that catch the light in places, their sides as dark as the shell)
CREST = lambda lo, hi: [("crest", lo, 0.82, 0.96, 0.8, 0.42), ("crest", hi, 0.88, 0.98, 0.85, 0.3, (2.6, 0.4, 0.62))]
RIDGE = lambda: iron("ridge", (30, 40, 26), (56, 68, 44), dirt=0.3,
                     shine=[SHEEN] + CREST((78, 90, 78), (160, 170, 156)), **SHELL_KW)
BEZEL = lambda: iron("bezel", (18, 24, 21), (58, 68, 62), (0.16, 0.4), scale=4.0, dirt=0.25, bump=0.06)
TRIM = lambda: iron("trim", (58, 72, 60), (104, 118, 104), (0.1, 0.3), scale=4.0, dirt=0.25, bump=0.06)
IRON = lambda: iron("iron", (18, 24, 20), (44, 54, 46), (0.18, 0.46), scale=4.0, rust=(84, 56, 34))
ROOT = lambda: iron("root", (54, 58, 45), (80, 84, 66), (0.3, 0.52), scale=4.0, patch=0.3, rust=(100, 52, 26),
                    dirt=0.5, metal=0.7, spec=0.5, bump=0.05)
STACK = lambda: kit.painted("stack", (64, 74, 66), rough=0.36, metal=0.7, wear=(120, 128, 116), dirt=0.3,
                            scale=6.0, soot=0.4, spec=0.7)
DARK = lambda: kit.flat("dark", (8, 12, 8), rough=0.9)


def brood():
    """The porthole's brood, in Flash's colours (measured on its strip): flat, hard-edged patches, mostly lime green,
    with yellow and orange ones toward the upper left, and a darker green edge. Lit from inside. The patches are
    cells read on a circle in two spare dimensions (turn() moves along it), so the shifting runs into itself."""
    t = kit.NT("brood")
    v = t.coords(scale=(1, 1, 0))
    mp = v.node
    vo = t.n("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature="F1")
    vo.inputs["Scale"].default_value = 2.0
    vo.inputs["Randomness"].default_value = 1.0
    t.link(v, vo.inputs["Vector"])
    tc = t.n("ShaderNodeTexCoord")
    dot = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")     # the glass's own x is up, its y the viewer's left
    t.link(tc.outputs["Object"], dot.inputs[0])
    dot.inputs[1].default_value = (0.16, 0.2, 0.0)
    grey = t.n("ShaderNodeRGBToBW")
    t.link(vo.outputs["Color"], grey.inputs[0])
    add = t.n("ShaderNodeMath", operation="ADD")                   # the cell's own random tone + its place
    t.link(dot.outputs["Value"], add.inputs[0])
    t.link(grey.outputs[0], add.inputs[1])
    c = t.ramp(add.outputs[0], [(0.0, kit.srgb(*BROOD_COLS[0]))] +
               [(q, kit.srgb(*col)) for q, col in zip((0.3, 0.46, 0.58, 0.68, 0.76, 0.87), BROOD_COLS[1:])])
    c.node.color_ramp.interpolation = "CONSTANT"
    # the darker green edge
    rad = t.n("ShaderNodeVectorMath", operation="LENGTH")
    t.link(t.coords(scale=(1, 1, 0)), rad.inputs[0])
    c = t.mix(c, kit.srgb(40, 70, 8), t.ramp(rad.outputs["Value"], [(0.74, (0, 0, 0, 1)), (1.0, (0.8, 0.8, 0.8, 1))]))
    t.set(**{"Base Color": t.mix(c, (0, 0, 0, 1), 0.6), "rough": 0.2, "spec": 0.2, "coat": 0.25})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = BROOD_E
    BROOD.update(map=mp, noise=vo)
    return t.m


# Flash's brood colours: three greens (half of the glass and more), a bright lime, an olive yellow, yellow, orange
BROOD_COLS = [(88, 134, 8), (100, 154, 6), (118, 170, 10), (142, 200, 8), (160, 146, 8), (206, 184, 20),
              (234, 168, 30)]
BROOD_E = 0.8


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
def E(sx, sy):
    """The direction (from the body's middle, before the lean) of the skin's point seen on Flash pixel (sx, sy):
    Flash's seams are traced in its own pixels and laid on the shell with this. A pixel beside the body gives the
    skin's nearest point."""
    f = kit.cam_fwd()
    o = kit.px(sx, sy, Z=ZC) - f * 14

    def depth(t):
        q = unlean(o + f * t - CEN)
        return q.length / rho(q.normalized())
    t, best = 0.0, (9.0, 0.0)
    while t < 28:
        v = depth(t)
        if v < 1:
            break
        best = min(best, (v, t))
        t += 0.04
    else:
        return unlean(o + f * best[1] - CEN).normalized()
    lo, hi = t - 0.04, t
    for _ in range(24):
        mid = (lo + hi) / 2
        lo, hi = (lo, mid) if depth(mid) < 1 else (mid, hi)
    return unlean(o + f * hi - CEN).normalized()


def P3(sx, sy, z):
    """The world point seen on Flash pixel (sx, sy) at height z: the legs are traced on Flash with this."""
    return kit.px(sx, sy, Z=z)


def azel(d):
    return math.degrees(math.atan2(d.y, d.x)), math.degrees(math.asin(max(-1, min(1, d.z))))


def ridge(name, dirs, w=0.25, h=0.065, mat=None, closed=False, sub=6, off=0.0, seg=6, ends=("fade", "fade")):
    """A broad, flat embossed seam on the body through directions `dirs`: `w` wide each side of its line, `h` proud
    at its flat crest, its soft shoulders running into the skin (every point is laid on the skin, so it follows the
    body's curve). An open one runs out to nothing at a "fade" end and widens at a "join" end, where it meets
    another seam. The crest's share (0 at the shoulders, 1 on the crest) is stored on the mesh for the worn
    highlight."""
    P = spline(dirs, sub, closed)
    n = len(P)
    bm = bmesh.new()
    rows, crest = [], []
    RIDGES.append(name)
    off += 0.005 * len(RIDGES)                               # no two seams' skins lie in one another where they meet
    for i, d in enumerate(P):
        pa = P[(i - 1) % n] if closed else P[max(i - 1, 0)]
        pb = P[(i + 1) % n] if closed else P[min(i + 1, n - 1)]
        nr = normal(d)
        t = (S(pb) - S(pa)).normalized()
        bi = t.cross(nr).normalized()
        kw = kh = 1.0
        if not closed:
            s_ = i / (n - 1)
            for e, u in zip(ends, (s_ / 0.14, (1 - s_) / 0.14)):
                if u < 1:
                    if e == "fade":
                        kw *= max(0.08, u) ** 0.6
                        kh *= max(0.0, u) ** 0.8
                    else:
                        kw *= 1.0 + 0.8 * (1 - u) ** 2
                        kh *= min(1.0, u / 0.4) ** 0.7         # and sinks into the seam it meets
        p0 = S(d)
        row = []
        for j in range(-seg, seg + 1):
            x = j / seg
            u = min(1.0, (1 - abs(x)) / 0.85)
            bell = u * u * (3 - 2 * u)                       # a low flat-topped swell with long soft shoulders
            row.append(bm.verts.new(skin(p0 + bi * (w * kw * x), off + h * kh * bell - 0.008)))
            crest.append(bell * kh)
        rows.append(row)
    pairs = list(zip(rows, rows[1:])) + ([(rows[-1], rows[0])] if closed else [])
    for r0, r1 in pairs:
        for j in range(2 * seg):
            bm.faces.new((r0[j], r0[j + 1], r1[j + 1], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat or RIDGE()])
    ob.data.attributes.new("crest", "FLOAT", "POINT").data.foreach_set("value", crest)
    return ob


RIDGES = []


# the shell's wavy lower hem, traced on Flash (px) across the front; the back keeps a plain wave
SKIRT_PX = [(-20, 29), (-16.5, 29), (-13, 29.5), (-10, 31.5), (-7, 35), (-3, 37.5), (1.5, 38), (5, 36), (9, 39),
            (15, 43.5), (22, 43.5), (28.5, 38)]
SKIRT = []


def skirt_el(az):
    """The hem's elevation at azimuth az."""
    if not SKIRT:
        pts = sorted(azel(E(*p)) for p in SKIRT_PX)
        lo, hi = pts[0][0], pts[-1][0]
        back = [(a, -15 + 5 * math.sin(math.radians(4 * a))) for a in range(int(hi) + 14, int(lo) + 360 - 13, 10)]
        pts = pts + back
        pts = pts + [(a + 360, e) for a, e in pts] + [(a - 360, e) for a, e in pts]
        pts.sort()
        raw = []
        for a in range(-180, 180):
            i = max(j for j, p in enumerate(pts) if p[0] <= a)
            (a0, e0), (a1, e1) = pts[i], pts[i + 1]
            raw.append(e0 + (e1 - e0) * (a - a0) / max(1e-6, a1 - a0))
        for _ in range(2):
            raw = [sum(raw[(i + k) % 360] for k in range(-2, 3)) / 5 for i in range(360)]
        SKIRT.extend(raw)
    a = (az + 180) % 360
    i = int(math.floor(a))
    f = a - i
    return SKIRT[i % 360] * (1 - f) + SKIRT[(i + 1) % 360] * f


def skin_grid(name, mat, off, lo_el, rows=26, cols=180, lip=None, attr=None):
    """The body's skin from elevation lo_el(az) up to the top, `off` off the skin; `lip` turns its lower edge in."""
    bm = bmesh.new()
    grid, vals = [], []
    for i in range(cols):
        az = i * 360 / cols - 180
        lo = lo_el(az)
        col = [bm.verts.new(S(D(az, lo), lip))] if lip is not None else []
        for j in range(rows):
            col.append(bm.verts.new(S(D(az, lo + (88 - lo) * (j / (rows - 1)) ** 0.9), off)))
        grid.append(col)
    top = bm.verts.new(S(D(0, 90), off))
    for i in range(cols):
        a, b = grid[i], grid[(i + 1) % cols]
        for j in range(len(a) - 1):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
        bm.faces.new((a[-1], b[-1], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if attr:
        vals = [attr(v.co) for v in bm.verts]
    ob = kit.mesh_ob(name, bm, [mat])
    if attr:
        ob.data.attributes.new("sheen", "FLOAT", "POINT").data.foreach_set("value", vals)
    return ob


SHEEN_PX = ((-9, -6, 1.6),)      # Flash's broad pale sheen, upper left of the shell: (px, px, size)


def egg():
    # the lower body: the body itself, a little inside the shell, standing in the ground
    skin_grid("egg", LOWER(), -IN, lambda az: -89.0, rows=30, cols=72)
    # the shell: the body's armour from the top down to its wavy hem, with Flash's pale sheen on its upper left
    spots = [(S(E(sx, sy)), r) for sx, sy, r in SHEEN_PX]
    sheen = lambda p: min(1.0, sum(math.exp(-((p - q).length / r) ** 2) for q, r in spots))
    SHEEN_F.append(sheen)
    skin_grid("egg-shell", SHELL(), 0.0, skirt_el, lip=-IN - 0.03, attr=sheen)
    # the hem's bright rolled rim
    ob = ridge("egg-hem", [D(a, skirt_el(a) + 1.5) for a in range(-180, 180, 3)], 0.2, 0.1, closed=True, sub=2)
    add_sheen(ob)


SHEEN_F = []


def add_sheen(ob):
    """Give a seam the shell's sheen where it crosses it."""
    f = SHEEN_F[0]
    ob.data.attributes.new("sheen", "FLOAT", "POINT").data.foreach_set("value", [f(v.co) for v in ob.data.vertices])


def seams():
    """Flash's embossed seams, traced in Flash px: the hood's arc, the tongue panel over the porthole, two slanting
    seams running down to the porthole's right, and a flap on the lower body at the front left. Broad and flat, a
    worn bright crest on each, wider where two meet."""
    px = lambda pts: [E(*p) for p in pts]
    obs = [
        ridge("egg-seam-hood", px([(-20.5, 14), (-19.5, 4), (-15.5, -4.5), (-9, -10), (0, -12.5), (9, -13.5),
                                   (16.5, -12.5), (22.5, -8), (27, 0), (30, 9)]), 0.27, 0.095),
        ridge("egg-seam-tongue", px([(-7, -1.5), (-2, -5), (5, -6.5), (10, -4), (11.5, 2), (10.5, 8.5), (7, 11.5),
                                     (3, 10), (-1, 6), (-4.5, 2)]), 0.27, 0.1, closed=True),
        ridge("egg-seam-slant0", px([(10, -5.5), (15.5, -2.5), (20, 3.5), (24, 10), (27.5, 15.5)]), 0.24, 0.09,
              ends=("join", "fade")),
        ridge("egg-seam-slant1", px([(12, 2), (17, 7), (21, 12)]), 0.21, 0.08, ends=("join", "fade")),
        ridge("egg-seam-arch", px([(-17.5, 26), (-16, 14), (-13, 5), (-8, -1)]), 0.23, 0.08, ends=("fade", "join")),
    ]
    for ob in obs:
        add_sheen(ob)
    ridge("egg-flap", px([(-19, 35), (-17, 39), (-13.5, 42.5), (-10, 43.5), (-8, 41), (-7.5, 37)]), 0.24, 0.08,
          off=-IN, mat=FLAP())
    ridge("egg-flap1", px([(22, 46), (27, 45), (31, 41)]), 0.16, 0.07, off=-IN, mat=FLAP())
    pts = []
    for p in ((2, 18), (-2, 26), (-12, 22), (-15, 12)):
        d = E(*p)
        pts.append((S(d, 0.0), normal(d)))
    balls("egg-rivets", pts, 0.13, TRIM(), 0.55)


FLAP = lambda: iron("flap", (15, 19, 16), (40, 46, 38), (0.2, 0.46), scale=3.0, metal=0.85,
                    shine=CREST((74, 84, 72), (150, 160, 146)))

WIN_PX = (19.5, 29.5)
WIN_K = 1.13
WIN_TURN, WIN_DOWN = 32, 10           # Flash's glass is 19 px wide and 23 tall: it looks this far (deg) to the right,
                                      # and a little down, as the body's skin there does (so the skin stays out of it)


def porthole():
    d = E(*WIN_PX)
    v = -kit.cam_fwd()
    right = Vector((1, 1, 0)).normalized()
    up = right.cross(v) if right.cross(v).z > 0 else v.cross(right)
    a, b = math.radians(WIN_TURN), math.radians(WIN_DOWN)
    # set in the body's right front, seen at an angle
    n = (v * math.cos(a) * math.cos(b) + right * math.sin(a) * math.cos(b) - up * math.sin(b)).normalized()
    m = basis(n, S(d)) @ Matrix.Diagonal((WIN_K, WIN_K, 1, 1))
    # a chunky dark collar: a broad rounded rim round the glass on a barrel sunk into the body
    bezel = [(0.98, -0.7), (0.98, 0.2), (1.02, 0.34), (1.1, 0.43), (1.22, 0.45), (1.32, 0.38), (1.38, 0.24),
             (1.39, -1.3)]
    lathe_at("port-bezel", bezel, m, BEZEL(), verts=56)
    balls("port-bolts", [(m @ Vector((1.2 * math.cos(q), 1.2 * math.sin(q), 0.43)), n)
                         for q in [math.radians(45 + 60 * i) for i in range(6)]], 0.055, IRON(), 0.6)
    hub = bpy.data.objects.new("brood", None)
    kit.link(hub)
    hub.matrix_world = m
    kit.MOVING.append(hub)
    glass = [(0.002, 0.36), (0.3, 0.35), (0.6, 0.31), (0.85, 0.24), (1.0, 0.14)]
    ob = kit.lathe("brood-glass", glass, (0, 0, 0), brood(), verts=48, parent=hub)
    PORT["at"] = m @ Vector((0, 0, 0.34))
    return ob


PORT = {}


BOX_AZ = -122
BOX_R, BOX_Z0, BOX_Z1 = 3.4, 3.2, 5.8
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
    balls("pump-rivets", [(P(x, fy if z < 0 else fy * 0.93, z), side) for x, z in
                          ((-0.15, -0.5), (-0.15, 0.1), (-0.15, 0.7), (-0.7, -0.5), (-0.7, 0.1), (-0.7, 0.75))],
          0.085, TRIM(), 0.6)
    # the vent pipe on top: a collar, a ribbed bellows neck leaning out, a flared mouth with a green glow inside
    top = P(-0.45, 0.0, hz - 0.12)
    aim = (Vector((0, 0, 1)) + out * 0.64 + side * 0.14).normalized()
    pm = basis(aim, top) @ Matrix.Diagonal((VENT_K, VENT_K, 1, 1))        # a fat, stubby pipe
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
    lathe_at("vent-glow", [(0.002, z + 0.11), (0.14, z + 0.11)], basis(aim, top + side * 0.06) @ Matrix.Diagonal((VENT_K, VENT_K, 1, 1)),
             kit.flat("vent-glow", (70, 120, 8), rough=0.6, emit=0.9), verts=16)
    kit.ring("vent-lip", 0.6, 0.05, IRON(), n=36).matrix_world = pm @ Matrix.Translation((0, 0, z + 0.36))
    VENT["mouth"] = pm @ Vector((0, 0, z + 0.4))
    VENT["aim"] = aim
    # the hose's two sockets: on the box's outer face, high, and on the egg, low at the front of the box
    a = P(BOX_HALF[0] - 0.5, 0.1, 0.7)
    db_ = E(-18, 23.5)
    b = S(db_)
    nb = normal(db_)
    for nm, p, d in (("a", a, out), ("b", b, nb)):
        lathe_at(f"pump-socket-{nm}", [(0.34, -0.25), (0.46, -0.2), (0.5, 0.1), (0.42, 0.2), (0.3, 0.2)],
                 basis(d, p), IRON(), verts=24)
    HOSE.update(a=a, da=out, b=b, db=nb, P_=P)


VENT = {}
VENT_K = 1.22
HOSE_SEG, HOSE_SUB, HOSE_WAVES = 14, 10, 3.0


def hose_path():
    a, da, b, db = HOSE["a"], HOSE["da"], HOSE["b"], HOSE["db"]
    out, side = box_frame()
    P = HOSE["P_"]                             # the pump box's own frame: x out, y to the front, z up from its middle
    pts = [a - da * 0.2, a + da * 0.35, P(0.95, 0.12, 0.9), P(1.42, 0.4, 0.2), P(1.25, 0.8, -0.5), P(0.6, 1.2, -0.9),
           P(0.05, 1.6, -0.7), b + db * 0.4, b - db * 0.2]
    return spline(pts, HOSE_SUB)


def hose_rows(ph):
    """The hose's rings with its swellings moved on by `ph` wavelengths."""
    P = HOSE["P"]

    def rad(s):
        w = 0.5 - 0.5 * math.cos(2 * math.pi * (s * HOSE_WAVES - ph))
        thick = 0.26 + 0.07 * s ** 0.7                          # fuller where it sags
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


STK = {}


def stack():
    d = E(*STK_PX)
    aim = (normal(d) * 0.3 + Vector((0.08, 0.06, 1))).normalized()
    m = basis(aim, S(d) - aim * 0.25)
    k = 1.12                                  # taller than wide, as Flash's
    prof = [(0.86, -0.1), (0.8, 0.2), (0.5, 0.44), (0.4, 0.7), (0.5, 0.76), (0.52, 0.9), (0.42, 0.96), (0.42, 1.1),
            (0.54, 1.18), (0.58, 1.5), (0.52, 1.6), (0.3, 1.64), (0.002, 1.64)]
    lathe_at("stack", [(r, z * k) for r, z in prof], m, STACK(), verts=32)
    STK.update(base=S(d), top=m @ Vector((0, 0, 1.64 * k)))


STK_PX = (17.5, -11.5)                # where the stack stands, in Flash px


GLOW_E = 0.0                          # no ember light under the body: Flash is plain dark there


def glow():
    """The fire under the body: a broad ring of ember light on the ground round it, brightest under the body's rim
    and fading to nothing inward and outward, so its shine on the underside of the body and of the legs is a soft
    glow with no edge. The camera does not see the ring itself."""
    t = kit.NT("glow")
    rad = t.n("ShaderNodeVectorMath", operation="LENGTH")
    t.link(t.coords(scale=(1 / 6.0, 1 / 6.0, 0)), rad.inputs[0])
    f = t.ramp(rad.outputs["Value"], [(0.14, (0, 0, 0, 1)), (0.42, (1, 1, 1, 1)), (0.56, (0.7, 0.7, 0.7, 1)),
                                      (1.0, (0, 0, 0, 1))])
    f.node.color_ramp.interpolation = "EASE"
    t.set(**{"Base Color": (0, 0, 0, 1), "rough": 1.0})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(255, 74, 12)
    em = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(f, em.inputs[0])
    em.inputs[1].default_value = GLOW_E
    t.link(em.outputs[0], t.bsdf.inputs["Emission Strength"])
    ob = kit.lathe("glow", [(0.6, 0.04), (6.0, 0.04)], (0, 0, 0), t.m, verts=48)
    ob.visible_camera = ob.visible_diffuse = ob.visible_shadow = False
    ob.visible_transmission = ob.visible_volume_scatter = False


def along(R):
    """Radius along a traced limb: R at its traced points, straight between them."""
    m = len(R) - 1

    def f(s):
        x = min(m - 1e-6, s * m)
        i = int(x)
        return R[i] + (R[i + 1] - R[i]) * (x - i)
    return f


def limb(name, pts, ribs=0, depth=0.25, seg=16, sub=10, flat=1.0, mat=None):
    """A leg traced on Flash: pts are (px, px, height, radius) along it from the body out. It starts inside the
    body. `ribs` raised rings along it; `flat` < 1 squashes it into a blade (its height against its width)."""
    W = [P3(sx, sy, z) for sx, sy, z, _ in pts]
    R = [r for *_, r in pts]
    core = Vector((LEAN[0] * (W[0].z - ZC), LEAN[1] * (W[0].z - ZC), W[0].z + 0.15))
    W = [core + (W[0] - core) * 0.5] + W
    R = [R[0]] + R
    base = along(R)

    def rad(s):
        r = base(s)
        if ribs:
            r *= 1.0 + depth * (1.0 - abs(math.sin(math.pi * ribs * s))) ** 1.3
        return (r, max(0.02, r * flat)) if flat != 1.0 else r
    return tubemesh(name, W, rad, mat or ROOT(), seg=seg, sub=sub)


def roots():
    """The short fat legs the body sits in, each traced on Flash: they start inside the lower body, hug it and
    splay flat on the ground."""
    # centre front: a fat ringed stump, flat on the ground, tapering to a tip hooked to the left
    limb("leg", [(-10.5, 47, 1.25, 0.84), (-12, 54, 0.88, 0.8), (-13, 60, 0.72, 0.7), (-14.5, 66, 0.52, 0.5),
                 (-16, 71, 0.36, 0.34), (-17.4, 75, 0.25, 0.21), (-20.5, 77.7, 0.17, 0.13), (-26.5, 79, 0.08, 0.035)],
         ribs=9, depth=0.26, seg=18)
    # left front: a fat ringed stump that drops from the body and bends out to a small two-fingered claw
    limb("claw", [(-27, 40, 1.5, 0.82), (-33, 44, 1.15, 0.76), (-37, 48.5, 0.8, 0.62), (-42, 52.5, 0.5, 0.42),
                  (-47, 55.5, 0.3, 0.26), (-50.3, 57.2, 0.2, 0.17)], ribs=6, depth=0.28)
    for i, pts in enumerate(([(-49.5, 57, 0.2, 0.15), (-53, 56.4, 0.22, 0.11), (-56, 57.6, 0.05, 0.03)],
                             [(-49.6, 57.2, 0.2, 0.15), (-47.6, 60.4, 0.2, 0.12), (-49, 62.6, 0.12, 0.09),
                              (-54, 63.2, 0.04, 0.03)])):
        tubemesh(f"claw-talon{i}", [P3(*p[:3]) for p in pts], along([p[3] for p in pts]), ROOT(), seg=10, sub=8)
    # the horn, left: a big straight spike held level, ringed
    tubemesh("horn", [polar(1.3, -150, 1.5), polar(4.0, -150, 1.35), polar(6.1, -150, 1.12)],
             lambda s: (1.4 * (1 - s) + 0.015) * (1 + 0.14 * (1 - abs(math.sin(math.pi * 9 * s))) ** 1.5),
             ROOT(), seg=16, sub=16)
    # the claws, right: a tight clump of fat dark claws from one shoulder, curling down to points on the ground
    for i, pts in enumerate((
            [(25, 49.5, 1.05, 0.46), (26.5, 56, 0.78, 0.44), (28.5, 61, 0.46, 0.34), (30.6, 65.6, 0.06, 0.03)],
            [(29, 50, 1.1, 0.5), (33, 57, 0.82, 0.48), (37.5, 64, 0.46, 0.36), (41.6, 70.6, 0.06, 0.03)],
            [(32, 49, 1.1, 0.5), (38.5, 54.5, 0.82, 0.48), (45, 59.5, 0.44, 0.34), (50.6, 62.8, 0.06, 0.03)],
            [(33, 46.5, 1.05, 0.44), (39, 49.6, 0.84, 0.4), (43.6, 53.8, 0.5, 0.3), (46.6, 58, 0.12, 0.03)])):
        limb(f"fin{i}", pts, ribs=5, depth=0.16, seg=14, sub=12, flat=0.8)
    # two thin feelers, right: one rises in a hump and reaches out along the ground, a short one under it
    limb("tail", [(33, 44, 0.5, 0.3), (38, 43, 0.5, 0.26), (43, 42, 0.6, 0.22), (46, 38, 1.05, 0.2),
                  (49, 35.2, 1.4, 0.19), (52, 34.6, 1.45, 0.19), (55, 36, 1.3, 0.18), (57.2, 39.5, 0.9, 0.17),
                  (60, 42, 0.55, 0.16), (64, 42.6, 0.35, 0.14), (68.6, 42.6, 0.2, 0.05)], ribs=14, depth=0.18,
         seg=12, sub=8)
    limb("tailb", [(31, 47, 0.42, 0.22), (36, 47, 0.26, 0.17), (41, 46.5, 0.18, 0.13), (45.6, 45.6, 0.1, 0.04)],
         ribs=6, depth=0.18, seg=12, sub=8)


def cards():
    """Two bright cards that only shiny metal sees (no light on matt surfaces, no shadow, not in the picture): the
    hard highlights of Flash's polished iron. The sun, sky and camera stay the kit's."""
    v = -kit.cam_fwd()
    r = Vector((1, 1, 0)).normalized()
    u = v.cross(r) * -1
    u = r.cross(v) if r.cross(v).z > 0 else v.cross(r)
    for nm, n, size, col, e in (("card-key", v + u * 0.5 - r * 0.5, 8.0, (1.0, 0.95, 0.82), 30.0),
                                ("card-sky", v + u * 1.3 + r * 0.2, 16.0, (0.7, 0.8, 1.0), 4.0)):
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
    seams()
    porthole()
    pump()
    hose()
    stack()
    if GLOW_E:
        glow()
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


# ------------------------------------------------------------------------------------------------------------ damaged
# One rough pass (owner: damaged looks only roughly follow Flash's top.1.damaged.v2, no polish rounds), on the
# approved model: PB_STATE=damaged with mode `base` writes <PB_SUB>/render/L1-damaged-base.png and -alone.png.
#   PB_STATE=damaged PB_SUB=damaged PB_K=6 ./run.sh base
# As Flash's: the shell dented and sooted, the feed hose torn off the pump and hanging to the ground, the porthole's
# glass cracked and the brood leaking down the front in two green runs, a few plates and stones at the feet, the vent
# dead. Destroyed is Flash's rubble, as for every other 3D building. Nothing here runs without PB_STATE.
STATE = kit.STATE


def grey(x):
    return (x, x, x, 1)


def scorch(amount, cut=0.5, skip=("brood", "goo", "card", "glow", "vent-glow", "hole")):
    """Soot over every paint: patches of near black, `amount` of the colour left under them (as the Magma Pump's)."""
    for m in list(bpy.data.materials):
        nt = m.node_tree
        if nt is None or m.name.startswith(skip):
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        inp = bsdf.inputs["Base Color"]
        if inp.is_linked:
            src = inp.links[0].from_socket
        else:
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = inp.default_value
            src = rgb.outputs[0]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.4
        nz.inputs["Detail"].default_value = 5.0
        nz.inputs["Roughness"].default_value = 0.65
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = cut - 0.1, grey(amount)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = cut + 0.12, grey(0.9)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        nt.links.new(nz.outputs[0], ramp.inputs[0])
        nt.links.new(src, mix.inputs[6])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], inp)


def dents(strength=0.3, size=0.9):
    """Knock the shell about: one lumpy displacement in world space over the body, its armour and its seams, so the
    seams stay on the shell as it dents."""
    tex = bpy.data.textures.new("dents", "CLOUDS")
    tex.noise_scale = size
    tex.noise_depth = 2
    for o in list(bpy.data.objects):
        if o.type != "MESH" or not (o.name.startswith("egg") and not o.name.startswith("egg-rivets")):
            continue
        sub = o.modifiers.new("dent-sub", "SUBSURF")
        sub.levels = sub.render_levels = 1
        mo = o.modifiers.new("dents", "DISPLACE")
        mo.texture = tex
        mo.texture_coords = "GLOBAL"
        mo.direction = "NORMAL"
        mo.mid_level = 0.55
        mo.strength = strength


def lump(name, at, size, m, jag=0.4, seed=0.0):
    """A ragged lump (a stone, a bit of plate)."""
    from mathutils import noise
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1.0 + jag * noise.noise(Vector((v.co.x * 1.7 + seed, v.co.y * 1.7, v.co.z * 1.7 + seed * 0.37)))
        v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2] * k))
    ob = kit.mesh_ob(name, bm, [m], smooth=False)
    ob.location = Vector(at)
    return ob


def goo():
    """The brood out of the cracked glass: a glossy, faintly lit green."""
    t = kit.NT("goo")
    v = t.coords()
    c = t.ramp(t.noise(v, 6.0, 3.0, 0.6, 0.3), [(0.35, kit.srgb(46, 120, 6)), (0.65, kit.srgb(120, 196, 14))])
    t.set(**{"Base Color": c, "rough": 0.12, "spec": 0.7, "coat": 0.5})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = 0.6
    return t.m


def torn_hose():
    """The feed hose torn off the pump: from its socket on the egg it hangs out to the front left onto the ground,
    its end ragged; a short torn stub is left in the pump's socket."""
    m = hose_mat()
    whole = HOSE["P"]                       # turn() still poses the hidden whole hose from its own path
    b, db = HOSE["b"], HOSE["db"]
    a, da = HOSE["a"], HOSE["da"]
    for nm, pts, ph in (
            ("hose-torn", [b - db * 0.2, b + db * 0.45, P3(-33, 30, 2.1), P3(-44, 38, 1.8), P3(-54, 47, 0.7),
                           P3(-58, 51, 0.26), P3(-63, 53, 0.24)], 0.4),
            ("hose-stub", [a - da * 0.2, a + da * 0.35, a + da * 0.62 + Vector((0, 0, -0.3)),
                           a + da * 0.7 + Vector((0, 0, -0.62))], 0.1)):
        HOSE["P"] = spline(pts, HOSE_SUB)
        rows = tube_coords(HOSE["P"], lambda s: 0.27 * (1 - 0.18 * s ** 3), HOSE_SEG)
        bm = bmesh.new()
        vr = [[bm.verts.new(c) for c in row] for row in rows]
        for r0, r1 in zip(vr, vr[1:]):
            for j in range(HOSE_SEG):
                bm.faces.new((r0[j], r0[(j + 1) % HOSE_SEG], r1[(j + 1) % HOSE_SEG], r1[j]))
        # the torn end: a dark, ragged mouth
        end = vr[-1]
        mid = bm.verts.new(sum((v.co for v in end), Vector()) / len(end))
        for j in range(HOSE_SEG):
            bm.faces.new((end[j], end[(j + 1) % HOSE_SEG], mid))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for j, v in enumerate(end):
            v.co += (v.co - mid.co) * (0.25 if j % 2 else -0.15)
        ob = kit.mesh_ob(nm, bm, [m])
        hv, hw = hose_tex(ph)
        hv += [0.0, 0.0, 0.0]
        hw += [0.0]
        ob.data.attributes.new("hv", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", hv)
        ob.data.attributes.new("hw", "FLOAT", "POINT").data.foreach_set("value", hw)
        kit.blob(nm + "-mouth", tuple(HOSE["P"][-1]), 0.2, 0.6, kit.flat("hole", (20, 12, 6), rough=0.95))
    HOSE["P"] = whole


def wreck():
    kit.MOVING.clear()                      # a state is one still: the brood and the hose go into its picture
    bpy.context.view_layer.update()
    HOSE["ob"].hide_render = True           # the whole hose is gone: torn off, below
    hole = kit.flat("hole", (20, 12, 6), rough=0.95)
    # the porthole: the glass cracked across, a hole knocked in it, the brood dull behind it
    hub = bpy.data.objects["brood"]
    mw = hub.matrix_world
    zg = lambda r: 0.36 - 0.22 * r * r + 0.03
    rr = random.Random(23)
    for i, (a0, n) in enumerate(((20, 4), (130, 3), (200, 4), (290, 3), (70, 2))):
        pts, r, a = [], 0.12, a0
        for _ in range(n):
            pts.append(mw @ Vector((r * math.cos(math.radians(a)), r * math.sin(math.radians(a)), zg(r))))
            r += 0.85 / n
            a += rr.uniform(-25, 25)
        kit.tube(f"glass-crack{i}", pts, 0.035, hole, r_end=0.015)
    kit.blob("glass-hole", tuple(mw @ Vector((-0.25, 0.2, zg(0.3)))), 0.24, 0.3, hole, stretch=(1.0, 0.8))
    bs = next(n for n in bpy.data.materials["brood"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bs.inputs["Emission Strength"].default_value = BROOD_E * 0.45
    # the vent is dead: its glow out
    vb = next(n for n in bpy.data.materials["vent-glow"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    vb.inputs["Emission Strength"].default_value = 0.0
    vb.inputs["Base Color"].default_value = kit.srgb(14, 20, 8)
    torn_hose()
    dents()
    scorch(0.35, 0.5)
    # the brood running out under the glass: two runs down the front of the body and a pool between the legs
    g = goo()
    # (the glass's own x is up, its y the viewer's left): out of the glass low on either side, over the collar's rim
    for i, (sd, x0, x1, w) in enumerate(((1, 11.5, 9.5, 0.18), (-1, 27.5, 29.5, 0.16))):
        pts = [mw @ Vector((-1.12, 0.8 * sd, 0.47)), mw @ Vector((-1.38, 0.86 * sd, 0.2))]
        pts += [S(E(x0 + (x1 - x0) * t, 41.0 + 7.0 * t), 0.08) for t in (0.0, 0.5, 1.0)]
        pts += [P3(x1, 53.0, 0.5), P3(x1 + 0.5, 57.0, 0.08)]
        kit.tube(f"goo-run{i}", pts, w, g, r_end=w * 0.8, smooth=True)
        kit.blob(f"goo-drop{i}", tuple(pts[-1]), w * 2.2, 0.35, g)
    kit.blob("goo-pool", tuple(P3(19.0, 58.5, 0.02)), 1.0, 0.05, g, stretch=(1.15, 0.7))
    # a few plates and stones knocked off, at the feet
    plate = TRIM()
    stone = ROOT()
    for i, (sx, sy, sz) in enumerate(((-30, 66, 0.42), (6, 74, 0.36), (40, 70, 0.3), (-62, 44, 0.28), (54, 52, 0.26),
                                      (-8, 82, 0.22))):
        lump(f"rubble{i}", P3(sx, sy, sz * 0.4), (sz, sz * rr.uniform(0.7, 1.0), sz * 0.65), stone, jag=0.5,
             seed=i * 1.9)
    for i, (sx, sy, sz, rz) in enumerate(((-22, 70, (0.7, 0.5), 30), (30, 76, (0.55, 0.45), -20))):
        kit.box(f"fallenplate{i}", (sz[0], sz[1], 0.07), P3(sx, sy, 0.04), plate,
                rot=(rr.uniform(-8, 8), rr.uniform(-8, 8), rz), bevel=0.015)


def build_state():
    build()
    if STATE:
        wreck()


kit.run(build_state, turn)
if kit.MODE == "where":                              # the smoke's start for post.py
    print("PORT px %.1f %.1f" % kit.scr(PORT["at"]))
    print("STACK base px %.1f %.1f top px %.1f %.1f" % (*kit.scr(STK["base"]), *kit.scr(STK["top"])))
    print("SKIRT", [(round(a), round(skirt_el(a))) for a in range(-180, 180, 15)])
    print("HOSE", ["%.0f,%.0f" % kit.scr(p) for p in HOSE["P"][::8]])
    print("VENT mouth px %.2f %.2f aim px %.3f %.3f" % (*kit.scr(VENT["mouth"]),
          *[a - b for a, b in zip(kit.scr(VENT["mouth"] + VENT["aim"]), kit.scr(VENT["mouth"]))]))
