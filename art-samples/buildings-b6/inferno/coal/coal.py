"""coal.py : the Inferno Coal Extractor (Inferno type 2) in 3D, three tiers, on the approved Bone Cruncher recipe
(../kit.py camera, light and render modes; cbits.py = the Bone Cruncher's own material and geometry helpers).

    blender -b --factory-startup -P coal.py -- <level> <fit|check|gap|probe|still|anim>

The level picks the tier, as the Bone Cruncher's: tier 1 = levels 1-2 (Flash look 1), tier 2 = levels 3-6 (Flash look
3), tier 3 = levels 7-10 (tier 2 with more upgrades). Renders are named by the level (render/L1-*, L3-*, L10-*).
World: Z up, the tank's axis on the origin. The camera looks from +X -Y: +X is the front right on screen, -Y the front
left. Each tier is the tier below with parts added or swapped (Flash swaps the brass elbow pipe for the square brass
column at look 3, and the spiked turret for the lantern with its star wheel); the tank, legs, window band, coal bin,
stack and copper arch are the same code at every tier and sit in the same place.

What moves, as Flash: a bulge runs along the copper arch (and along the brass elbow pipe at tier 1), lumps of coal
drop through the bin behind its grille, the fire in the windows flickers; from tier 2 the star wheel turns, the lantern
flickers and the column swells as it pumps; tier 3 adds a little smoke from the stack. Nothing else moves.
Loops: everything moves by whole cycles in one loop (36 frames), so the last frame runs into the first.

Vet against Flash (7 Nov, coal-levels.png and crop-*.png at full size): no black iron anywhere (rim, bands, frames,
feet and fixings are dark rust-copper), heavy mottled rust on the tank, orange fire in the windows, rust-brass hopper
heaped with coal, pale rusty spike collar. Tier 2 follows Flash's redesigns: a thick riveted belt the windows sit in,
a slimmer lantern, the column with a pillow top, strap and four slats. Still off: the tier 1 stack is a tall pipe
(Flash: short funnel on a bracketed drum), the column is matte where Flash's is glossy, Flash's look 3 claws are
bigger, the hopper is a box where Flash's is a lower trough.
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
sys.path.insert(0, str(HERE))
import kit  # noqa: E402
from cbits import (Acc, K0, K1, Tm, aim, basis, bar, grey, mat, one, polar, rivets, rod)  # noqa: E402,F401

LV = kit.L
T = 1 if LV <= 2 else (2 if LV <= 6 else 3)
kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (7.0, 31.0)
kit.FRAME = (-56, -72, 64, 84)
N = 36
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))
rnd = random.Random(52)

# ------------------------------------------------------------------------------------------------------------ sizes
R = 2.1                          # the tank
TZ0, TZ1 = 0.95, 4.1             # its bottom and top
PIPE = Vector((0.15, -5.1, 0))   # the brass pipe (tier 1) / column (tiers 2-3) on the ground, front left
STK = Vector((0.15, -5.0, 0))    # the stack above it
COL = Vector((0.15, -3.6, 0))    # the collar the copper arch rises from
TUR = Vector((0.08, 0.9, 0))     # the turret / lantern on the tank top, back right
BX, BY, BZ = (-0.85, 0.75), (-3.0, -1.4), (2.5, 5.1)      # the coal bin on the tank's front left side
PORT_Z = 4.6                     # the port in the bin's front wall where the coal comes in
LEGS = (-150, -72, -26, 38, 112)
WIN = (-68, -50, -32, -14, 4)    # the window band's posts (degrees)
WZ = (1.52, 1.72, 2.62, 2.82)    # rail bottom, pane bottom, pane top, rail top


# ------------------------------------------------------------------------------------------------------------ materials
def TANK():
    return mat("tank", (128, 74, 48), rough=0.78, metal=0.2, wear=(178, 128, 96), wear_amt=0.55, rust=(78, 38, 22),
               rust_at=0.46, dirt=0.65, scale=4.2, speck=0.32, bump=0.16)


def RIM():
    """Dark rust-copper for the tank's rim and bands, the window frames, the feet (Flash has no black iron)."""
    return mat("rim", (98, 54, 36), rough=0.72, metal=0.35, wear=(146, 92, 60), wear_amt=0.45, rust=(70, 36, 22),
               rust_at=0.55, dirt=0.45, speck=0.25)


def PALE():
    """The turret's spike collar and cap: pale worn iron, as Flash's grey-tan collar."""
    return mat("pale", (146, 116, 96), rough=0.7, metal=0.3, wear=(176, 150, 128), wear_amt=0.5, rust=(116, 60, 38),
               rust_at=0.5, dirt=0.5, scale=7.0, speck=0.35, bump=0.12)


def CBRASS():
    """The square column (Flash look 3): coppery brass, more orange than the tier 1 elbow."""
    return mat("cbrass", (190, 112, 50), rough=0.36, metal=0.8, wear=(120, 70, 36), wear_amt=0.6, rust=(96, 52, 30),
               rust_at=0.6, dirt=0.6, speck=0.28, bump=0.12)


def BRASS():
    return mat("brass", (206, 138, 50), rough=0.4, metal=0.75, wear=(150, 96, 38), wear_amt=0.5, rust=(112, 70, 32),
               rust_at=0.7, dirt=0.35)


def BRASS2():
    return mat("brass2", (160, 100, 46), rough=0.6, metal=0.5, wear=(128, 76, 36), wear_amt=0.55, rust=(104, 60, 30),
               rust_at=0.66, dirt=0.45)


def OLIVE():
    return mat("olive", (150, 122, 60), rough=0.55, metal=0.55, wear=(100, 80, 42), rust=(112, 66, 36), rust_at=0.66,
               dirt=0.4)


def COPPER():
    return mat("copper", (198, 112, 78), rough=0.45, metal=0.6, wear=(140, 76, 50), wear_amt=0.45, rust=(120, 66, 40),
               rust_at=0.72, dirt=0.3)


def RUSTY():
    return mat("rusty", (124, 60, 38), rough=0.72, metal=0.3, wear=(84, 42, 28), rust=(156, 84, 46), dirt=0.4)


def DARK():
    return mat("dark", (54, 48, 46), rough=0.7, metal=0.45, wear=(94, 86, 78), wear_amt=0.35, rust=(98, 56, 34),
               rust_at=0.7, dirt=0.3)


def TURRET():
    return mat("turret", (114, 80, 64), rough=0.7, metal=0.3, wear=(78, 54, 44), rust=(142, 78, 46), dirt=0.45)


def SPIKE():
    return mat("spike", (218, 204, 180), rough=0.5, metal=0.35, wear=(160, 140, 116), dirt=0.25)


def STEEL(fold=None):
    return mat("steel" + ("-f%d" % fold if fold else ""), (138, 136, 132), rough=0.42, metal=0.75, wear=(86, 82, 78),
               wear_amt=0.45, dirt=0.25, fold=fold)


def COAL():
    return mat("coal", (44, 42, 42), rough=0.36, metal=0.2, wear=(104, 100, 96), wear_amt=0.45, dirt=0.1, speck=0.3,
               bump=0.2)


def INSIDE():
    return mat("inside", (30, 22, 20), rough=0.9, dirt=0.15, speck=0.05)


def glow_mat(name, col, hot, strength, scale=4.0):
    """Fire behind glass: emission from orange to hot yellow by a noise; its strength = the object's colour (red) x
    strength, so turn() can make each pane flicker on its own."""
    if name in kit.MATS:
        return kit.MATS[name]
    t = kit.NT(name)
    v = t.coords()
    n = t.noise(v, scale, 4.0, 0.6, 0.3)
    c = t.ramp(n, [(0.3, kit.srgb(*col)), (0.72, kit.srgb(*hot))])
    t.set(**{"Base Color": c, "rough": 0.35})
    t.link(c, t.bsdf.inputs["Emission Color"])
    oi = t.n("ShaderNodeObjectInfo")
    sep = t.n("ShaderNodeSeparateColor")
    t.link(oi.outputs["Color"], sep.inputs[0])
    m = t.n("ShaderNodeMath", operation="MULTIPLY")
    m.inputs[1].default_value = strength
    t.link(sep.outputs[0], m.inputs[0])
    t.link(m.outputs[0], t.bsdf.inputs["Emission Strength"])
    kit.MATS[name] = t.m
    return t.m


# ------------------------------------------------------------------------------------------------------------ geometry
def arc_box(a, r0, r1, z0, z1, th0, th1, mi=0, seg=None):
    """A curved slab round the Z axis: radius r0..r1, height z0..z1, angle th0..th1 (degrees)."""
    seg = seg or max(2, int(abs(th1 - th0) / 3))
    rows = []
    for i in range(seg + 1):
        th = math.radians(th0 + (th1 - th0) * i / seg)
        c, s = math.cos(th), math.sin(th)
        rows.append([a.bm.verts.new((r * c, r * s, z)) for r, z in ((r0, z0), (r1, z0), (r1, z1), (r0, z1))])
    fs = []
    for p, q in zip(rows, rows[1:]):
        for j in range(4):
            k = (j + 1) % 4
            fs.append(a.bm.faces.new((p[j], p[k], q[k], q[j])))
    fs.append(a.bm.faces.new(rows[0][::-1]))
    fs.append(a.bm.faces.new(rows[-1]))
    for f in fs:
        f.material_index = mi


def box(a, c, size, mi=0, M=None):
    a.cube((M or Matrix()) @ Tm(c), size, mi)


def fillet_path(corners, rad, step=0.06):
    """Points every `step` along a polyline whose inner corners are rounded (quadratic Bezier, cut `rad` each side),
    with their arc length from the start."""
    P = [Vector(p) for p in corners]
    dense = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        r1 = min(rad, (b - a).length * 0.45)
        r2 = min(rad, (c - b).length * 0.45)
        p0 = b + (a - b).normalized() * r1
        p2 = b + (c - b).normalized() * r2
        dense.append(p0)
        for k in range(1, 12):
            u = k / 12
            dense.append((1 - u) ** 2 * p0 + 2 * u * (1 - u) * b + u * u * p2)
        dense.append(p2)
    dense.append(P[-1])
    out, s = [dense[0]], [0.0]
    acc = 0.0
    for p, q in zip(dense, dense[1:]):
        d = (q - p).length
        if d < 1e-6:
            continue
        n = max(1, int(round(d / step)))
        for k in range(1, n + 1):
            out.append(p + (q - p) * (k / n))
            acc += d / n
            s.append(acc)
    return out, s


def pipe(name, corners, r, m, rad, parent=None):
    """A round pipe (a curve with a round bevel) along a rounded polyline; returns (object, points, arc lengths)."""
    pts, s = fillet_path(corners, rad)
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    cu.resolution_u = 2
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts):
        p.co = (q.x, q.y, q.z, 1.0)
    cu.materials.append(m)
    ob = bpy.data.objects.new(name, cu)
    kit.link(ob, parent)
    return ob, sp, s


def lump(a, at, rad, rr):
    """An irregular lump of coal: a squashed, dented low ball with flat facets."""
    r = bmesh.ops.create_icosphere(a.bm, subdivisions=1, radius=rad, matrix=Tm(at))
    for v in r["verts"]:
        d = v.co - Vector(at)
        v.co = Vector(at) + Vector((d.x * rr.uniform(0.8, 1.25), d.y * rr.uniform(0.8, 1.2),
                                    d.z * rr.uniform(0.65, 1.0))) * rr.uniform(0.85, 1.12)
    a._tag(r["verts"], 0)


# ------------------------------------------------------------------------------------------------------------ moving
HUBS = {}
EXTRA = []          # functions of the loop fraction f


def hub(name, at=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    e.location = at
    kit.MOVING.append(e)
    HUBS[name] = e
    return e


def turn(k):
    f = (k % N) / N
    for fn in EXTRA:
        fn(f)


def wave(f, terms):
    """1 + a sum of sines with whole cycles per loop: (amplitude, cycles, phase)."""
    return 1.0 + sum(a * math.sin(2 * math.pi * (c * f + p)) for a, c, p in terms)


def bulger(sp, s, r_base, amp, width, lead=0.6, tail=0.4, phase=0.0):
    """A bulge that runs once along the pipe per loop: it enters from beyond the start and leaves past the end, faded
    to nothing near both ends, so frame 0 and the last frame both show the plain pipe."""
    L = s[-1]

    def fn(f):
        pos = -1.2 * width + ((f + phase) % 1.0) * (L + 2.4 * width)
        for p, si in zip(sp.points, s):
            fade = min(1.0, max(0.0, (si - lead) / 0.6), max(0.0, (L - tail - si) / 0.6))
            p.radius = 1.0 + amp * fade * math.exp(-((si - pos) / width) ** 2)
    EXTRA.append(fn)
    fn(0.0)


# ============================================================================================================ the parts
def tank():
    tm, dark = TANK(), RIM()
    prof = [(0.02, TZ0), (1.85, TZ0), (2.0, 1.0), (2.07, 1.1), (R, 1.28), (R, 3.72), (2.08, 3.86), (2.01, 3.97),
            (1.82, 4.04), (1.0, 4.085), (0.02, TZ1)]
    one("tank-body", [tm], lambda a: a.lathe(Matrix(), prof, 0, 96))

    def bands(a):
        a.lathe(Matrix(), [(R - 0.02, 1.1), (R + 0.035, 1.13), (R + 0.035, 1.24), (R - 0.02, 1.28)], 0, 96)   # foot band
        a.lathe(Matrix(), [(2.0, 3.88), (2.1, 3.9), (2.12, 3.98), (2.04, 4.04), (1.9, 4.04)], 0, 96)        # rim
        a.lathe(Matrix(), [(R - 0.02, 3.36), (R + 0.025, 3.38), (R + 0.025, 3.44), (R - 0.02, 3.46)], 0, 96)  # a thin ridge
        rivets(a, [(polar(R + 0.025, 6 + 12 * i, 3.41), polar(1, 6 + 12 * i, 0)) for i in range(30)], 0.035)
        rivets(a, [(polar(2.12, 12 * i, 3.94), polar(1, 12 * i, 0.6).normalized()) for i in range(30)], 0.04)
    one("tank-bands", [dark], bands, bevel=0.008)

    # the window band: rails and posts proud of the skin, the glass behind them (moving: it flickers)
    def frame(a):
        arc_box(a, R - 0.02, R + 0.14, WZ[0], WZ[1], WIN[0] - 3, WIN[-1] + 3, 0)
        arc_box(a, R - 0.02, R + 0.14, WZ[2], WZ[3], WIN[0] - 3, WIN[-1] + 3, 0)
        for th in WIN:
            arc_box(a, R - 0.02, R + 0.15, WZ[1], WZ[2], th - 2.2, th + 2.2, 0, 2)
        if T >= 2:                                              # Flash look 3: a bar across each window
            for th0, th1 in zip(WIN, WIN[1:]):
                arc_box(a, R + 0.02, R + 0.06, WZ[1], WZ[2], (th0 + th1) / 2 - 0.9, (th0 + th1) / 2 + 0.9, 0, 1)
        pts = []
        for th in WIN:
            for z in ((WZ[0] + WZ[1]) / 2, (WZ[2] + WZ[3]) / 2):
                pts.append((polar(R + 0.14, th, z), polar(1, th, 0)))
        rivets(a, pts, 0.04)
    one("win-frame", [dark], frame, bevel=0.012)
    if T >= 2:                                                  # Flash look 3: a thick riveted belt the windows sit in
        def belt(a):
            ro, zb, zt = R + 0.5, 1.2, 3.15
            arc_box(a, R - 0.02, ro, zb, zt, WIN[-1] + 2.2, 248, 0)      # it stops at the coal bin's sides
            arc_box(a, R - 0.02, ro, zb, zt, 284, WIN[0] + 360 - 2.2, 0)
            arc_box(a, R - 0.02, ro, zb, WZ[1] - 0.02, WIN[0] - 2.2, WIN[-1] + 2.2, 0)
            arc_box(a, R - 0.02, ro, WZ[2] + 0.02, zt, WIN[0] - 2.2, WIN[-1] + 2.2, 0)
            for th in WIN[1:-1]:
                arc_box(a, R - 0.02, ro, WZ[1] - 0.03, WZ[2] + 0.03, th - 2.2, th + 2.2, 0, 2)
            for t0, t1 in ((-76, 248), (284, 289.8)):           # lips top and bottom, rivets
                arc_box(a, ro - 0.02, ro + 0.04, zt - 0.02, zt + 0.06, t0, t1, 0)
                arc_box(a, ro - 0.02, ro + 0.04, zb - 0.06, zb + 0.02, t0, t1, 0)
            ths = [th for th in (7.5 * i for i in range(48)) if not 244 < th < 288]
            rivets(a, [(polar(ro + 0.04, th, zt - 0.12), polar(1, th, 0)) for th in ths] +
                   [(polar(ro + 0.04, th + 3.75, zb + 0.12), polar(1, th + 3.75, 0)) for th in ths], 0.04)
        one("tank-belt", [RIM()], belt, bevel=0.015)
    g = hub("glow")
    fire = glow_mat("fire", (200, 62, 12), (255, 146, 44), 2.0 if T < 3 else 2.8)
    panes = []
    for i, (th0, th1) in enumerate(zip(WIN, WIN[1:])):
        panes.append(one("pane-%d" % i, [fire], lambda a, th0=th0, th1=th1: arc_box(
            a, R - 0.01, R + 0.012, WZ[1] - 0.02, WZ[2] + 0.02, th0 + 1.5, th1 - 1.5, 0), parent=g))
    def flick(f):
        for i, p in enumerate(panes):
            s = wave(f, [(0.16, 3, 0.13 * i), (0.09, 7, 0.31 * i + 0.2), (0.05, 11, 0.07 * i)])
            p.color = (s, s, s, 1)
    EXTRA.append(flick)

    if T >= 3:                                                  # tier 3: riveted iron straps and studs on the rim
        def straps(a):
            a.lathe(Matrix(), [(R - 0.02, 3.56), (R + 0.06, 3.59), (R + 0.06, 3.71), (R - 0.02, 3.74)], 0, 96)
            pts = [(polar(R + 0.06, 7.5 + 15 * i, 3.65), polar(1, 7.5 + 15 * i, 0)) for i in range(24)]
            rivets(a, pts, 0.045)
            for i in range(12):                                 # short studs round the rim
                th = 15 + 30 * i
                a.cone(Tm(polar(1.98, th, 4.02)), 0.11, 0.0, 0.28, 0, 4)
        one("tank-straps", [dark], straps, bevel=0.01)


def legs():
    dark, steel = RIM(), STEEL()

    def fn(a):
        for th in LEGS:
            u = polar(1, th)
            M = basis(u, Vector((0, 0, 1)).cross(u), (0, 0, 1))
            a.cube(M @ Tm((1.8, 0, 1.0)), (0.42, 0.34, 0.18), 0)                       # the plate under the tank
            bar(a, polar(1.8, th, 0.98), polar(2.15, th, 0.45), 0.24, 0.2, 0)             # the strut
            a.cube(M @ Tm((2.2, 0, 0.23)), (0.46, 0.44, 0.46), 0)                         # the foot
            a.cube(M @ Tm((2.2, 0, 0.48)), (0.5, 0.48, 0.06), 0)                          # its cap
            if T >= 2:                                                                    # Flash look 3: a claw
                a.cone(aim(polar(1, th, -0.55), polar(2.42, th, 0.26)), 0.1, 0.015, 0.4, 1, 6)
    one("legs", [dark, steel], fn, bevel=0.03)


def bin_():
    dark = mat("binwall", (124, 84, 44), rough=0.62, metal=0.45, wear=(170, 116, 56), wear_amt=0.45, rust=(92, 50, 28),
               rust_at=0.52, dirt=0.55, speck=0.3)                # rust-brass walls, as Flash's dark hopper
    brass, inside = BRASS(), INSIDE()
    (x0, x1), (y0, y1), (z0, z1) = BX, BY, BZ
    w = 0.1
    py0, pz0, pz1, px0, px1 = y0, PORT_Z - 0.5, PORT_Z + 0.5, PIPE.x - 0.6, PIPE.x + 0.6

    def fn(a):
        # the front (-Y) wall: a solid foot, the grille, the port with the wall round it
        box(a, ((x0 + x1) / 2, y0 + w / 2, z0 + 0.13), (x1 - x0, w, 0.26))
        box(a, ((x0 + x1) / 2, y0 + w / 2, (3.5 + pz0) / 2), (x1 - x0, w, pz0 - 3.5))
        if z1 - pz1 > 0.02:
            box(a, ((x0 + x1) / 2, y0 + w / 2, (pz1 + z1) / 2), (x1 - x0, w, z1 - pz1))
        box(a, ((x0 + px0) / 2, y0 + w / 2, (pz0 + pz1) / 2), (px0 - x0, w, pz1 - pz0))
        if x1 - px1 > 0.02:
            box(a, ((px1 + x1) / 2, y0 + w / 2, (pz0 + pz1) / 2), (x1 - px1, w, pz1 - pz0))
        for x in (x0 + w / 2, x1 - w / 2):                       # the grille's side posts
            box(a, (x, y0 + w / 2, 3.13), (w, w, 0.75))
        # the side walls and the back wall above the tank top, the floor
        for x in (x0 + w / 2, x1 - w / 2):
            box(a, (x, (y0 + y1) / 2, (z0 + z1) / 2), (w, y1 - y0, z1 - z0))
        box(a, ((x0 + x1) / 2, y1 - w / 2, (3.9 + z1) / 2), (x1 - x0, w, z1 - 3.9))
        box(a, ((x0 + x1) / 2, (y0 - 1.9) / 2, z0 + 0.05), (x1 - x0, -1.9 - y0, 0.1))
        # the inside of the front wall's foot and the floor, dark
        box(a, ((x0 + x1) / 2, (y0 - 1.9) / 2 + 0.02, z0 + 0.11), (x1 - x0 - 2 * w, -1.9 - y0 - 0.1, 0.02), 2)
    one("bin-box", [dark, brass, inside], fn, bevel=0.02)

    def rim(a):
        for y in (y0, y1):                                      # the brass edging round the top
            box(a, ((x0 + x1) / 2, y + (w / 2 if y == y0 else -w / 2), z1 + 0.04), (x1 - x0 + 0.08, 0.16, 0.1))
        for x in (x0, x1):
            box(a, (x, (y0 + y1) / 2, z1 + 0.04), (0.16, y1 - y0 + 0.08, 0.1))
        for x in (x0, x1):                                      # brass corner straps down the front
            box(a, (x, y0 - 0.01, (z0 + z1) / 2), (0.16, 0.12, z1 - z0))
        pts = [(Vector((x, y0 - 0.075, z)), Vector((0, -1, 0))) for x in (x0, x1) for z in (2.8, 3.45, 4.1, 4.6)]
        rivets(a, pts, 0.035)
    one("bin-rim", [brass], rim, bevel=0.015)

    def grille(a):
        for x in (-0.6, -0.33, -0.06, 0.21, 0.48):
            rod(a, (x, y0 - 0.02, 2.74), (x, y0 - 0.02, 3.52), 0.035, 0, 8)
        for z in (3.13,):
            rod(a, (x0 + 0.05, y0 - 0.06, z), (x1 - 0.05, y0 - 0.06, z), 0.03, 0, 8)
    one("bin-grille", [DARK()], grille)

    def mouth(a):                                               # a dark hole in the tank skin where the coal goes in
        a.cone(aim((0, 1, 0), (-0.1, -2.12, 2.95)), 0.62, 0.62, 0.05, 0, 24)
    one("bin-hole", [inside], mouth)

    def heap(a):                                                # Flash: the hopper is heaped with coal (still)
        hr = random.Random(7)
        box(a, ((x0 + x1) / 2, (y0 + y1) / 2, 4.74), (x1 - x0 - 2 * w, y1 - y0 - 2 * w, 0.06), 1)
        for i in range(6):
            for j in range(6):
                x = x0 + w + 0.14 + i * (x1 - x0 - 2 * w - 0.28) / 5 + hr.uniform(-0.06, 0.06)
                y = y0 + w + 0.14 + j * (y1 - y0 - 2 * w - 0.28) / 5 + hr.uniform(-0.06, 0.06)
                lump(a, (x, y, 4.8 + 0.1 * hr.random()), 0.15 + 0.06 * hr.random(), hr)
    one("bin-heap", [COAL(), inside], heap, smooth=False)

    if T >= 2:                                                  # Flash look 3: a brass hood over the bin's back half
        def hood(a):
            hb = (y0 + y1) / 2 + 0.15
            box(a, ((x0 + x1) / 2, (hb + y1) / 2 + 0.02, z1 + 0.18), (x1 - x0 + 0.16, y1 - hb + 0.1, 0.16))
            box(a, ((x0 + x1) / 2, hb, z1 + 0.32), (x1 - x0 + 0.16, 0.14, 0.18))
            rivets(a, [(Vector((x, hb - 0.075, z1 + 0.32)), Vector((0, -1, 0))) for x in (-0.65, -0.2, 0.25, 0.6)],
                   0.035)
        one("bin-hood", [BRASS()], hood, bevel=0.03)


def elbow():
    """Tier 1: the fat brass pipe out of the ground, bent over into the bin's port (Flash look 1). A bulge runs up it."""
    brass, rusty, dark = BRASS(), RUSTY(), RIM()
    h = hub("elbow")
    corners = [(PIPE.x, PIPE.y, -0.3), (PIPE.x, PIPE.y, PORT_Z), (PIPE.x, BY[0] - 0.02, PORT_Z)]
    ob, sp, s = pipe("elbow-pipe", corners, 0.8, brass, 1.35, h)
    bulger(sp, s, 0.78, 0.15, 0.5, lead=0.9, tail=0.5)

    def fn(a):
        a.cone(Tm((PIPE.x, PIPE.y, 0.0)), 1.04, 0.98, 0.16, 0, 32)                     # the ground ring
        a.cone(Tm((PIPE.x, PIPE.y, 0.0)), 0.9, 0.9, 0.5, 1, 32)                     # the rusty collar
        a.cone(aim((0, 1, 0), (PIPE.x, BY[0] - 0.14, PORT_Z)), 0.96, 0.96, 0.12, 1, 32)  # the flange on the bin
        pts = [(Vector((PIPE.x, BY[0] - 0.15, PORT_Z)) + Vector((0.86 * math.cos(t), 0, 0.86 * math.sin(t))),
                Vector((0, -1, 0))) for t in [i * math.pi / 3 + 0.5 for i in range(6)]]
        rivets(a, pts, 0.045, 0)
    one("elbow-fix", [dark, rusty], fn, bevel=0.015)


def column():
    """Tiers 2-3: the square brass column in the elbow's place (Flash look 3): plinth, slatted foot, a strap, and the
    upper body that swells as it pumps; a short iron chute carries the coal from it into the same port."""
    brass, brass2, dark = BRASS2(), CBRASS(), RIM()
    c = PIPE
    hs = 0.88
    zs = 2.38                                                   # the strap's bottom: 4 slats below it, as Flash

    def foot(a):
        box(a, (c.x, c.y, 0.15), (2.55, 2.55, 0.3), 0)
        for sx in (-1, 1):
            for sy in (-1, 1):
                a.cone(Tm((c.x + sx * 1.13, c.y + sy * 1.13, 0.28)), 0.07, 0.06, 0.06, 0, 6)
        for i in range(4):                                                   # the slats
            z = 0.3 + i * 0.52
            box(a, (c.x, c.y, z + 0.25), (2 * hs - 0.04 * (i % 2), 2 * hs - 0.04 * (i % 2), 0.48), 1)
        box(a, (c.x, c.y, zs + 0.31), (2 * hs + 0.16, 2 * hs + 0.16, 0.62), 2)     # the strap
        rivets(a, [(Vector((c.x + hs + 0.08, c.y + d, zs + 0.31)), Vector((1, 0, 0))) for d in (-0.5, 0.0, 0.5)] +
               [(Vector((c.x + d, c.y - hs - 0.08, zs + 0.31)), Vector((0, -1, 0))) for d in (-0.5, 0.0, 0.5)], 0.045, 0)
        if T >= 3:                                                            # tier 3: iron corner guards
            for sx in (-1, 1):
                for sy in (-1, 1):
                    box(a, (c.x + sx * (hs + 0.02), c.y + sy * (hs + 0.02), 1.34), (0.2, 0.2, 2.08), 0)
            rivets(a, [(Vector((c.x + hs + 0.12, c.y + sy * (hs - 0.02), z)), Vector((1, 0, 0)))
                       for sy in (-1, 1) for z in (0.7, 1.4, 2.1)] +
                   [(Vector((c.x + sx * (hs - 0.02), c.y - hs - 0.12, z)), Vector((0, -1, 0)))
                    for sx in (-1, 1) for z in (0.7, 1.4, 2.1)], 0.04, 0)
    one("col-foot", [dark, brass2, brass], foot, bevel=0.03)

    h = hub("colpump", (c.x, c.y, zs + 0.62))
    hu = hs + 0.05                                              # the upper body, a little wider than the slats

    def upper(a):
        box(a, (0, 0, 1.3), (2 * hu, 2 * hu, 2.6), 0)
        a.cube(Tm((0, 0, 2.62)) @ Matrix.Diagonal((1, 1, 0.5, 1)), (2 * hu - 0.12, 2 * hu - 0.12, 1.0), 0)   # the pillow top
    up = one("col-body", [brass2], upper, parent=h, bevel=0.36)
    up.modifiers["bevel"].segments = 5

    def pump(f):
        p = 0.5 - 0.5 * math.cos(2 * math.pi * 2 * f)
        h.scale = (1 + 0.035 * p, 1 + 0.035 * p, 1 + 0.015 * p)
    EXTRA.append(pump)

    def chute(a):
        y0, y1 = c.y + hs - 0.1, BY[0] - 0.02
        box(a, (PIPE.x, (y0 + y1) / 2, PORT_Z), (1.16, y1 - y0, 1.08), 0)
        a.cube(Tm((PIPE.x, BY[0] - 0.1, PORT_Z)), (1.34, 0.12, 1.26), 0)
        rivets(a, [(Vector((PIPE.x + 0.58, (y0 + y1) / 2 + d, PORT_Z + e)), Vector((1, 0, 0)))
                   for d in (-0.25, 0.25) for e in (-0.38, 0.38)], 0.04, 0)
    one("col-chute", [RIM()], chute, bevel=0.03)


def stack():
    olive, rusty, inside = OLIVE(), RUSTY(), INSIDE()
    z_lo = 3.9 if T == 1 else 5.8
    top = 9.75

    def fn(a):
        rod(a, (STK.x, STK.y, z_lo), (STK.x, STK.y, top), 0.34, 0, 24)
        for z in (top - 0.06,):
            a.cone(Tm((STK.x, STK.y, z)), 0.36, 0.36, 0.12, 0, 24)
        box(a, (STK.x, STK.y, 7.45), (1.0, 1.0, 0.95), 0)                       # the bracket box
        box(a, (STK.x, STK.y, 7.45), (1.08, 1.08, 0.14), 0)
        rod(a, (STK.x, STK.y, 8.1), (COL.x, COL.y - 0.3, 8.1), 0.24, 0, 20)     # the stub to the collar
        rivets(a, [(Vector((STK.x + 0.5, STK.y + d, 7.45 + e)), Vector((1, 0, 0))) for d in (-0.25, 0.25)
                   for e in (-0.3, 0.3)], 0.04, 0)
    one("stack", [olive], fn, bevel=0.02)

    def cup(a):
        a.lathe(Tm((STK.x, STK.y, top + 0.04)), [(0.26, 0.0), (0.34, 0.0), (0.5, 0.38), (0.6, 0.62), (0.6, 0.72),
                                                 (0.5, 0.72), (0.44, 0.55), (0.3, 0.3), (0.2, 0.3)], 0, 32)
        a.cone(Tm((STK.x, STK.y, top + 0.3)), 0.3, 0.3, 0.02, 1, 24)
        a.cone(Tm((COL.x, COL.y, 7.72)), 0.42, 0.42, 0.85, 0, 24)                # the collar
        a.cone(Tm((COL.x, COL.y, 8.55)), 0.47, 0.47, 0.1, 0, 24)
        a.cone(Tm((COL.x, COL.y, 7.66)), 0.47, 0.47, 0.1, 0, 24)
    one("cup", [rusty, inside], cup, bevel=0.01)

    if T >= 2:                                                  # Flash look 3: a steel clamp band on the stack
        def clamp(a):
            a.cone(Tm((STK.x, STK.y, 8.55)), 0.38, 0.38, 0.4, 0, 24)
            box(a, (STK.x + 0.42, STK.y, 8.75), (0.18, 0.16, 0.36), 0)
        one("clamp", [STEEL()], clamp, bevel=0.015)

    if T >= 3:                                                  # tier 3: a little smoke from the stack
        smoke_m = mat("smoke", (92, 86, 84), rough=1.0, dirt=0.0, speck=0.0, bump=0.0, alpha=True)
        se = hub("smoke")
        n = 9
        puffs = [kit.blob("smoke-%d" % i, (0, 0, 0), 0.28, 0.85, smoke_m, se, stretch=(1.0 + 0.2 * (i % 3), 1.0))
                 for i in range(n)]
        for p in puffs:
            p.modifiers.new("s", "SUBSURF").render_levels = 2

        def move(f):
            for i, p in enumerate(puffs):
                ph = (f + i / n) % 1.0
                p.location = (STK.x + 0.4 * ph + 0.06 * math.sin(7 * i), STK.y + 0.35 * ph, top + 0.75 + 1.8 * ph)
                s = 0.5 + 1.4 * ph
                p.scale = (s, s, s)
                p.rotation_euler = (0, 0, 2.3 * i)
                p.color = (1, 1, 1, 0.5 * math.sin(math.pi * ph) ** 1.5)
        EXTRA.append(move)


def arch():
    """The copper pipe from the collar over to the turret; a bulge runs along it every loop."""
    copper, dark = COPPER(), RIM()
    h = hub("arch")
    corners = [(COL.x, COL.y, 8.5), (COL.x, COL.y, 9.85), (TUR.x, TUR.y, 8.0), (TUR.x, TUR.y, 7.25)]
    ob, sp, s = pipe("arch-pipe", corners, 0.34, copper, 0.6, h)
    bulger(sp, s, 0.34, 0.2, 0.45, lead=0.3, tail=0.3, phase=0.35)

    def fn(a):
        a.cone(Tm((TUR.x, TUR.y, 7.18)), 0.44, 0.44, 0.12, 0, 24)
    one("arch-fix", [dark], fn, bevel=0.01)


def turret():
    tur, dark, spike = TURRET(), RIM(), SPIKE()
    c = TUR
    rb = 1.0 if T == 1 else 0.76                                # Flash look 3's lantern is slimmer than the turret

    def body(a):
        a.cone(Tm((c.x, c.y, 3.98)), rb, rb, 1.52, 0, 48)
        a.cone(Tm((c.x, c.y, 3.98)), rb + 0.06, rb + 0.06, 0.16, 1, 48)
        a.cone(Tm((c.x, c.y, 5.38)), rb + 0.05, rb + 0.05, 0.12, 1, 48)
        for i in range(8):                                                     # panel seams
            th = 22.5 + 45 * i
            p0 = c + polar(rb + 0.01, th, 4.14)
            bar(a, p0, p0 + Vector((0, 0, 1.24)), 0.06, 0.05, 1)
    one("tur-body", [tur, dark], body, bevel=0.012)

    if T == 1:
        def collar(a):
            a.cone(Tm((c.x, c.y, 5.5)), 1.08, 1.04, 0.36, 1, 48)
            for i in range(8):                                                 # the spikes, out flat
                th = 22.5 + 45 * i
                a.cone(aim(polar(1, th), c + polar(1.0, th, 5.68)), 0.13, 0.0, 0.58, 0, 8)
            a.cone(Tm((c.x, c.y, 5.86)), 0.62, 0.58, 0.4, 2, 32)               # the cap
            a.cone(Tm((c.x, c.y, 6.26)), 0.66, 0.66, 0.1, 1, 32)
            a.cone(Tm((c.x, c.y, 6.36)), 0.3, 0.3, 0.85, 1, 20)                # the post up to the arch
        one("tur-top", [spike, PALE(), tur], collar, bevel=0.012)
        lamp = glow_mat("lamp", (230, 30, 10), (255, 90, 40), 6.0, 8.0)
        one("tur-lamp", [lamp], lambda a: a.sphere(Tm(c + polar(rb + 0.02, 15, 4.95)), 0.1, 0, 10, 7))
        slit = glow_mat("slit", (226, 104, 24), (255, 186, 80), 3.2)
        sl = Acc()
        for th in (-150, -115, -80, -45, -10, 25):
            arc_box(sl, rb - 0.01, rb + 0.015, 4.2, 4.58, th - 4, th + 4, 0, 2)
        o = sl.obj("tur-slits", [slit])
        o.location = (c.x, c.y, 0)
        return

    # tiers 2-3: the lantern (Flash look 3): windows of fire in the body, a roof, the star wheel on a post
    def roof(a):
        a.cone(Tm((c.x, c.y, 5.48)), rb + 0.12, 0.36, 0.5, 0, 48)
        a.cone(Tm((c.x, c.y, 6.1)), 0.3, 0.3, 1.15, 0, 20)                     # the post up to the arch
        a.cone(Tm((c.x, c.y, 6.48)), 0.38, 0.38, 0.08, 0, 20)                  # the star's seat
    one("tur-roof", [TURRET()], roof, bevel=0.012)
    wins = (-140, -95, -50, -5, 40)

    def mull(a):
        for th in wins:
            for d in (-15, 15):
                arc_box(a, rb - 0.02, rb + 0.07, 4.25, 5.3, th + d - 2.5, th + d + 2.5, 0, 1)
            arc_box(a, rb - 0.02, rb + 0.07, 4.18, 4.3, th - 17, th + 17, 0)
            arc_box(a, rb - 0.02, rb + 0.07, 5.25, 5.36, th - 17, th + 17, 0)
            arc_box(a, rb + 0.01, rb + 0.05, 4.25, 5.3, th - 1.0, th + 1.0, 0, 1)
    sl = Acc()
    mull(sl)
    o = sl.obj("tur-mull", [dark], bevel=0.01)
    o.location = (c.x, c.y, 0)
    g = HUBS["glow"]
    lf = glow_mat("lantern", (200, 62, 12), (255, 146, 44), 2.2 if T < 3 else 3.0, 5.0)
    lps = []
    for i, th in enumerate(wins):
        a = Acc()
        arc_box(a, rb - 0.005, rb + 0.012, 4.28, 5.28, th - 13, th + 13, 0)
        o = a.obj("lpane-%d" % i, [lf], g)
        o.location = (c.x, c.y, 0)
        lps.append(o)

    def flick(f):
        for i, p in enumerate(lps):
            s = wave(f, [(0.2, 4, 0.17 * i), (0.1, 9, 0.23 * i + 0.1)])
            p.color = (s, s, s, 1)
    EXTRA.append(flick)

    # the star wheel: eight pointed blades round a hub, turning about the post
    sh = hub("star", (c.x, c.y, 6.56))
    st = mat("star-f8", (104, 96, 88), rough=0.55, metal=0.65, wear=(146, 136, 124), wear_amt=0.4, rust=(108, 64, 40),
             rust_at=0.55, dirt=0.35, fold=8)                    # darker, rust-flecked steel, as Flash's star

    def star(a):
        a.lathe(Matrix(), [(0.32, -0.02), (0.5, -0.02), (0.5, 0.2), (0.32, 0.2), (0.32, -0.02)], 0, 32)
        for i in range(8):
            ang = 2 * math.pi * i / 8
            M = Matrix.Rotation(ang, 4, "Z")
            out = [(0.42, -0.24), (0.95, -0.4), (1.7, 0.0), (0.95, 0.4), (0.42, 0.24)]
            a.prism(M @ Matrix.Rotation(math.radians(-4), 4, "Y"), out, 0.02, 0.1, 0)
        if T >= 3:
            for i in range(8):
                ang = 2 * math.pi * (i + 0.5) / 8
                a.cone(Matrix.Rotation(ang, 4, "Z") @ Tm((0.42, 0, 0.05)) @ Matrix.Rotation(math.pi / 2, 4, "Y"),
                       0.06, 0.0, 0.3, 0, 6)
    one("star", [st], star, parent=sh, bevel=0.012)

    def spin(f):
        sh.rotation_euler = (0, 0, math.radians(-90 * f))
    EXTRA.append(spin)


def coal():
    """Lumps of coal come out of the port (from inside the pipe or chute), drop into one of three lanes and sink
    through the bin behind the grille, then go into the hole in the tank. Each lump runs once per loop."""
    cm = COAL()
    h = hub("coal")
    lanes = (-0.5, -0.07, 0.36)
    obs = []
    for i in range(9):
        a = Acc()
        rad = 0.17 + 0.05 * rnd.random()
        lump(a, (0, 0, 0), rad, rnd)
        o = a.obj("lump-%d" % i, [cm], h, smooth=False)
        lx, ly = lanes[i % 3], (-2.6, -2.3)[(i // 3) % 2]
        obs.append((o, i / 9.0, lx, ly, rad, rnd.uniform(0, 6.28)))

    def path(u, lx, ly, rad):
        m0 = Vector((PIPE.x, BY[0] - 0.55, PORT_Z))
        m1 = Vector((PIPE.x, BY[0] + 0.32, PORT_Z - 0.12))
        top = Vector((lx, ly, 3.95))
        bot = Vector((lx, ly, BZ[0] + 0.2 + rad))
        out = Vector((lx, -1.6, bot.z))
        if u < 0.06:
            return m0.lerp(m1, u / 0.06)
        if u < 0.14:
            v = (u - 0.06) / 0.08
            p = m1.lerp(top, v)
            p.z += 0.25 * math.sin(math.pi * v)
            return p
        if u < 0.86:
            return top.lerp(bot, (u - 0.14) / 0.72)
        return bot.lerp(out, (u - 0.86) / 0.14)

    def move(f):
        for o, ph, lx, ly, rad, r0 in obs:
            u = (f + ph) % 1.0
            o.location = path(u, lx, ly, rad)
            o.rotation_euler = (r0 + 2 * math.pi * u, 0.7 * r0, r0 + 2 * math.pi * u)
    EXTRA.append(move)


# ------------------------------------------------------------------------------------------------------------ build
def build():
    tank()
    legs()
    bin_()
    if T == 1:
        elbow()
    else:
        column()
    stack()
    arch()
    turret()
    coal()


_border = kit.border_of


def border_all(objs, pad=10):
    """The moving parts' render region over the whole loop (smoke rises, lumps travel)."""
    bs = []
    for k in range(0, N, 3):
        turn(k)
        bpy.context.view_layer.update()
        bs.append(_border(objs, pad))
    turn(0)
    bpy.context.view_layer.update()
    return min(b[0] for b in bs), max(b[1] for b in bs), min(b[2] for b in bs), max(b[3] for b in bs)


kit.border_of = border_all
kit.run(build, turn)
