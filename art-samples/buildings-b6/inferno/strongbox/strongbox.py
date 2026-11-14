"""strongbox.py : the Inferno Strongbox (building 8, Flash folder imonsterlab) in 3D, one look for its four levels,
built clean-room from the Flash picture put into words (14 Nov 2026). Only the generic Inferno kit is used
(../kit.py: camera, light, helpers), as the Incubator.

    blender -b --factory-startup -P strongbox.py -- 1 <fit|check|gap|full> [frame]

The building: an upright round iron cage standing on four dark spikes, widest low down and leaning in a little to
its rim. Its wall is mostly window: on each side one long dark window of tall upright slats under a narrow pale rim
band, with a plate beside the door (cool dark steel on the viewer's left, warm tan on the right, as Flash paints
it). The door is a flat slab on the front with a pale lip, a riveted plate and a brass lock ring. Each front spike is
tied on with two brass hoops and carries a broad silver claw that hooks over the rim and the pit onto the disc.
Inside the rim is a dark pit with machinery (a toothed ring, struts, floor teeth); over it sits a thick gold disc
(the lock) floored with separate plates of uneven height and colour. On the disc stands a gold star plate, leaning
back, with a red orb half sunk in it. Behind the star, in one tight cluster: the top gear (only its upper teeth show
over the star's top left), a dark cog hugging the star's left side, and behind both the long white hand on its own
axle. A gold latch block lies in front of the star and a small gold block with a thin rod to the right.

World: Z up, the bowl's axis on the origin. The camera looks from +X -Y. Angles round the bowl are `phi`, degrees
from the viewer's side (0 = front, + = screen right, 180 = back).

The loop (unlocking), 30 frames (Flash's strip is 31 cells, cell 30 = cell 0): the hand swings from one o'clock
over the top to nine o'clock and back, once; the top gear and the left cog turn with it; the latch
drops into the disc while the hand is over (cells 9-20) and comes back. Idle is frame 0, as Flash holds cell 0.
`full` renders whole frames (the hand's shadow moves on the disc, so there is no still base layer; Flash's strip is
nearly the whole building too).
"""
import math
import os
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
kit.ORIGIN = (0.0, 61.0)
kit.FRAME = (-70, -52, 90, 98)
N = 30
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame 30 (= frame 0), the loop check
kit.SUN_COL = (1.0, 0.93, 0.82)

Z0, ZW, Z1 = 0.75, 1.45, 4.5           # the cage's dark foot, the bottom of its plates, its rim
DISC_R, DISC_Z0, DISC_Z1 = 3.85, 5.3, 6.45
STAR_H = 1.7                         # the star's middle above the disc
FWD = 0.9                             # the star stands this far in front of the disc's middle
NAZ = -38.0                           # the way the star faces (azimuth)
LEAN = 7.0                           # the star leans back by this
PROF = [(0.75, 4.6), (1.45, 5.45), (2.1, 5.65), (4.5, 5.12)]      # (z, radius): widest low, leaning in to the rim
PIT = 4.93
SPK = 30.0                            # the front spikes and claws stand at +-SPK


def R(z):
    """The cage wall's radius at height z."""
    if z <= PROF[0][0]:
        return PROF[0][1]
    for (za, ra), (zb, rb) in zip(PROF, PROF[1:]):
        if z <= zb:
            t = (z - za) / (zb - za)
            return ra + (rb - ra) * t
    return PROF[-1][1]


def D(az):
    a = math.radians(az)
    return Vector((math.cos(a), math.sin(a), 0.0))


def P(phi, z, off=0.0, r=None):
    return D(-45 + phi) * ((R(z) if r is None else r) + off) + Vector((0, 0, z))


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


def steps(a, b, d, extra=()):
    n = max(1, round((b - a) / d))
    vals = {round(a + (b - a) * i / n, 4) for i in range(n + 1)}
    vals |= {round(e, 4) for e in extra if a < e < b}
    return sorted(vals)


def patch(name, p0, p1, z0, z1, off, thick, mat, hole=None, bevel=0.05):
    """A curved plate on the cage wall: phi p0..p1, height z0..z1, its outer face `off` outside the wall, `thick`
    deep; hole = (p0, p1, z0, z1) is a window cut through it."""
    ph = steps(p0, p1, 3.0, hole[:2] if hole else ())
    zs = steps(z0, z1, 0.25, tuple(hole[2:]) + tuple(z for z, _ in PROF) if hole else tuple(z for z, _ in PROF))
    bm = bmesh.new()
    fo = off if callable(off) else (lambda z: off)
    vs = [[bm.verts.new(P(p, z, fo(z))) for z in zs] for p in ph]
    for i in range(len(ph) - 1):
        for j in range(len(zs) - 1):
            pc, zc = (ph[i] + ph[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if hole and hole[0] < pc < hole[1] and hole[2] < zc < hole[3]:
                continue
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    ob = kit.mesh_ob(name, bm, [mat])
    so = ob.modifiers.new("solid", "SOLIDIFY")
    so.thickness = thick
    so.offset = -1.0
    bv = ob.modifiers.new("bevel", "BEVEL")
    bv.width, bv.segments, bv.limit_method = bevel, 2, "ANGLE"
    return ob


def chaikin(pts, n=2):
    """A bent path through fewer corners, its ends kept."""
    pts = [Vector(p) for p in pts]
    for _ in range(n):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [a * 0.75 + b * 0.25, a * 0.25 + b * 0.75]
        pts = out + [pts[-1]]
    return pts


def add_bevel(ob, w, segs=2):
    mo = ob.modifiers.new("bevel", "BEVEL")
    mo.width, mo.segments, mo.limit_method = w, segs, "ANGLE"
    return ob


# ------------------------------------------------------------------------------------------------------- materials
def worn(name, left, right=None, rough=0.34, metal=0.7, scale=3.0, blotch=0.4, edge=0.5, dirt=0.25, ao_min=0.5,
         span=4.6, hi=(255, 246, 232), scratch=0.08, spec=0.5, patch_col=None):
    """Hard, worn metal, as Flash's: `left` on the viewer's left running to `right` on the right (Flash paints the
    cage cool dark steel on the left and warm bright tan on the right), hard-edged darker patches (or patches of
    patch_col), upright scratches and bright worn edges."""
    t = kit.NT(name)
    v = t.coords()
    if right:
        geo = t.n("ShaderNodeNewGeometry")
        dot = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dot.inputs[0])
        dot.inputs[1].default_value = (0.7071, 0.7071, 0.0)
        mr = t.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = -span, span
        t.link(dot.outputs["Value"], mr.inputs[0])
        col = t.mix(kit.srgb(*left), kit.srgb(*right), mr.outputs[0])
    else:
        col = kit.srgb(*left)
    n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.4)
    if patch_col:
        col = t.mix(col, kit.srgb(*patch_col), t.ramp(n1, [(0.5, (0, 0, 0, 1)), (0.54, (blotch,) * 3 + (1,))]))
        n0 = t.noise(v, scale * 0.6, 4.0, 0.6, 0.8)
        col = t.mix(col, t.ramp(n0, [(0.44, (1, 1, 1, 1)), (0.58, (0.56, 0.42, 0.26, 1))]), 1.0, "MULTIPLY")
    else:
        k = 1.0 - blotch
        col = t.mix(col, t.ramp(n1, [(0.47, (k, k, k, 1)), (0.53, (1, 1, 1, 1))]), 1.0, "MULTIPLY")
    if scratch:
        n2 = t.noise(t.coords(scale=(1.0, 1.0, 0.08)), scale * 6, 3.0, 0.6)
        lo, up = 1.0 - scratch, 1.0 + scratch * 0.6
        col = t.mix(col, t.ramp(n2, [(0.4, (lo, lo, lo, 1)), (0.6, (up, up, up, 1))]), 1.0, "MULTIPLY")
    if edge:
        ao = t.n("ShaderNodeAmbientOcclusion", samples=8, inside=True, only_local=True)
        ao.inputs["Distance"].default_value = 0.07
        col = t.mix(col, kit.srgb(*hi), t.ramp(ao.outputs["AO"], [(0.5, (edge,) * 3 + (1,)), (0.9, (0, 0, 0, 1))]))
    col = t.grime(col, kit.GROUND, 2.6, dirt, ao_min)
    t.set(**{"Base Color": col, "rough": rough, "metal": metal, "spec": spec})
    t.bump(t.noise(v, scale * 5, 4.0, 0.6), 0.1, 0.01)
    return t.m


def mats():
    m = {}
    m["plate"] = worn("plate", (70, 79, 74), (226, 176, 124), blotch=0.3, scale=2.2)
    m["rim"] = worn("rimplate", (100, 112, 118), (238, 200, 160), blotch=0.3, edge=0.6, rough=0.3)
    m["door"] = worn("door", (92, 84, 74), blotch=0.2, scale=2.4, edge=0.35, metal=0.5)
    m["doorplate"] = worn("doorplate", (83, 74, 65), blotch=0.15, scale=2.0, edge=0.45, metal=0.5)
    m["lip"] = worn("doorlip", (158, 140, 126), blotch=0.2, edge=0.6, rough=0.28)
    m["slat"] = worn("slat", (60, 65, 63), (156, 124, 86), blotch=0.3, metal=0.4, edge=0.35)
    m["dark"] = kit.painted("dark", (14, 13, 12), rough=0.85, dirt=0.2)
    m["pit"] = worn("pitiron", (36, 34, 32), blotch=0.3, edge=0.5, hi=(96, 92, 86), rough=0.4, dirt=0.0, ao_min=0.6,
                    scratch=0.0)
    m["iron"] = worn("iron", (40, 42, 44), blotch=0.3, edge=0.7, hi=(190, 192, 196), rough=0.36, dirt=0.0, scale=6.0)
    m["gear"] = worn("gear", (92, 96, 102), blotch=0.35, edge=0.9, hi=(226, 228, 232), rough=0.3, dirt=0.0, scale=6.0)
    m["cog"] = worn("cog", (30, 31, 32), blotch=0.3, edge=0.55, hi=(150, 152, 156), rough=0.4, dirt=0.0, scale=6.0)
    m["spike"] = kit.painted("spike", (28, 31, 32), rough=0.5, metal=0.4, wear=(62, 68, 70), scale=4.0, dirt=0.1)
    m["gold"] = worn("gold", (226, 128, 28), patch_col=(250, 180, 46), blotch=0.85, hi=(255, 236, 130), edge=0.6,
                     scale=1.0, rough=0.34, metal=0.55, dirt=0.0, ao_min=0.45, scratch=0.12)
    m["goldy"] = worn("goldy", (255, 200, 44), patch_col=(248, 156, 36), blotch=0.7, hi=(255, 246, 150), edge=0.7,
                      scale=1.1, rough=0.3, metal=0.55, dirt=0.0, ao_min=0.45, scratch=0.12)
    m["goldb"] = worn("goldb", (170, 104, 30), patch_col=(232, 150, 40), blotch=0.8, hi=(250, 210, 110), edge=0.5,
                      scale=1.0, rough=0.4, metal=0.5, dirt=0.0, ao_min=0.45, scratch=0.12)
    m["golds"] = worn("golds", (250, 186, 66), patch_col=(255, 214, 90), blotch=0.7, hi=(255, 232, 120), edge=0.6,
                      scale=1.2, rough=0.34, metal=0.55, dirt=0.0, ao_min=0.45, scratch=0.15)
    m["bed"] = kit.painted("bed", (70, 44, 14), rough=0.7, dirt=0.0)
    m["star"] = worn("stargold", (250, 180, 62), patch_col=(224, 146, 44), blotch=0.5, hi=(255, 232, 140), edge=0.8,
                     scale=3.0, rough=0.26, metal=0.75, dirt=0.0, scratch=0.1)
    m["brass"] = kit.painted("brass", (190, 150, 84), rough=0.3, metal=0.7, wear=(244, 214, 130), scale=5.0,
                             dirt=0.1)
    m["silver"] = worn("silver", (128, 134, 138), (255, 252, 244), blotch=0.1, edge=0.8, rough=0.2, metal=0.6,
                       hi=(255, 255, 255), dirt=0.05, span=3.5, scale=4.0)
    t = kit.NT("blade")                      # the hand: Flash's is the brightest thing in the picture, near white
    t.set(**{"Base Color": kit.srgb(236, 238, 240), "rough": 0.3, "metal": 0.2, "spec": 0.6})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(255, 255, 255)
    t.bsdf.inputs["Emission Strength"].default_value = 0.5
    m["blade"] = t.m
    t = kit.NT("orb")
    t.set(**{"Base Color": kit.srgb(226, 30, 26), "rough": 0.12, "spec": 0.6, "coat": 1.0})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(226, 30, 26)
    t.bsdf.inputs["Emission Strength"].default_value = 0.25
    m["orb"] = t.m
    return m


M = {}
PART = {}


# ------------------------------------------------------------------------------------------------------- the cage
def cage():
    F, T = D(-45), D(45)                    # toward the viewer, and to the screen right
    # the dark drum inside the plates, its foot tucked in below them, and the pit in its top
    prof = [(0.01, Z0), (4.6, Z0), (R(ZW) - 0.3, ZW), (R(2.1) - 0.3, 2.1), (R(Z1) - 0.3, Z1), (PIT, Z1), (PIT, 3.6),
            (0.01, 3.6)]
    kit.lathe("base-drum", prof, (0, 0, 0), M["dark"], verts=72)
    kit.lathe("base-rimtop", [(PIT - 0.02, Z1 - 0.3), (PIT - 0.02, Z1 + 0.06), (R(Z1) + 0.1, Z1 + 0.06),
                              (R(Z1) + 0.12, Z1 - 0.3), (PIT - 0.02, Z1 - 0.3)], (0, 0, 0), M["rim"], verts=72,
              bevel=0.04)
    # the pit's machinery: the post the disc stands on, a toothed ring round it, struts out to the rim, a ring of
    # teeth on the floor
    kit.cyl("base-pedestal", 2.9, DISC_Z0 - 3.6 + 0.02, (0, 0, 3.6), M["pit"], verts=40)
    kit.lathe("base-pitring", [(2.9, 4.5), (3.45, 4.5), (3.45, 4.95), (2.9, 4.95)], (0, 0, 0), M["pit"], verts=48,
              bevel=0.03)
    for i in range(28):
        a = 360 / 28 * i + 4
        kit.box(f"base-pittooth{i}", (0.34, 0.36, 0.4), tuple(D(a) * 3.55)[:2] + (4.52,), M["pit"], rot=(0, 0, a),
                bevel=0.04)
    for i in range(8):
        a = 45 * i
        kit.box(f"base-strut{i}", (PIT - 2.8, 0.36, 0.3), tuple(D(a - 45) * ((PIT + 2.8) / 2))[:2] + (3.95,),
                M["pit"], rot=(0, 0, a - 45), bevel=0.05)
    for i in range(40):
        a = 9 * i + 2
        kit.box(f"base-floortooth{i}", (0.5, 0.3, 0.32), tuple(D(a) * 4.35)[:2] + (3.6,), M["pit"], rot=(0, 0, a),
                bevel=0.04)
    # the plates: on each side a plate beside the door, then one long window of upright slats up to the rim band
    for s in (1, -1):
        a, b = (SPK + 4.5, 180) if s > 0 else (-180, -SPK - 4.5)
        hole = (48, 173, 1.85, 4.1) if s > 0 else (-173, -48, 1.85, 4.1)
        patch(f"base-shell{s}", a, b, ZW, Z1, 0.0, 0.16, M["plate"], hole=hole)
        patch(f"base-band{s}", a, b, 4.22, Z1, 0.06, 0.22, M["rim"], bevel=0.04)
        for i, p in enumerate(range(52, 173, 6)):
            pts = [P(s * p, 1.82 + 2.3 * j / 6, -0.1) for j in range(7)]
            kit.sweep(f"base-slat{s}-{i}", pts, D(-45 + s * p + 90), 0.19, 0.14, M["slat"], bevel=0.03)
    # the door: a flat slab with a pale lip along its top, a riveted plate on its face and a brass lock ring
    kit.box("base-door", (4.6, 0.5, Z1 - 1.3), tuple(F * 5.05)[:2] + (1.15,), M["door"], rot=(0, 0, 45), bevel=0.06)
    kit.box("base-doorlip", (4.8, 0.62, 0.3), tuple(F * 5.06)[:2] + (Z1 - 0.32,), M["lip"], rot=(0, 0, 45), bevel=0.05)
    kit.box("base-doorplate", (3.1, 0.14, 2.3), tuple(F * 5.32)[:2] + (1.05,), M["doorplate"], rot=(0, 0, 45),
            bevel=0.03)
    for i, (x, z) in enumerate(((-1.38, 1.22), (1.38, 1.22), (-1.38, 3.18), (1.38, 3.18), (0, 1.22), (0, 3.18))):
        c = F * 5.39 + T * x
        kit.blob(f"base-doorrivet{i}", (c.x, c.y, z), 0.07, 0.7, M["lip"]).matrix_world = basis(F, (c.x, c.y, z))
    kn = F * 5.3 + T * 1.98 + Vector((0, 0, 2.72))
    k = kit.cyl("base-lock", 0.22, 0.14, (0, 0, 0), M["brass"], verts=20, bevel=0.04)
    k.matrix_world = basis(F, kn)
    k = kit.cyl("base-lockeye", 0.1, 0.05, (0, 0, 0), M["dark"], verts=12, bevel=0.0)
    k.matrix_world = basis(F, kn + F * 0.12)
    # the spikes it stands on; the front two tied on with brass hoops, each with a broad silver claw on top that
    # hooks over the rim and the pit onto the disc
    for i, p in enumerate((SPK, -SPK, 147, -147)):
        at = P(p, 0.0, r=5.4)
        kit.cyl(f"base-spike{i}", 0.05, 3.75, at, M["spike"], verts=20, r2=0.4, bevel=0.0)
        if abs(p) > 90:
            continue
        for j, z in enumerate((2.18, 3.66)):
            rg = kit.ring(f"base-hoop{i}-{j}", 0.05 + 0.35 * z / 3.75 + 0.06, 0.08, M["brass"], z=0.0, n=32)
            rg.location = (at.x, at.y, z)
        path = [(3.55, DISC_Z1 + 0.14), (3.95, DISC_Z1 + 0.16), (4.35, DISC_Z1 - 0.25), (4.85, 5.55), (5.25, 4.85),
                (5.46, 4.2), (5.42, 3.7)]
        pts = chaikin([P(p, z, r=r) for r, z in path], 2)
        kit.sweep(f"base-claw{i}", pts, D(-45 + p + 90), 0.82, 0.3, M["silver"], bevel=0.12,
                  taper=lambda s: 0.5 + 0.5 * min(1.0, s / 0.55))


# ------------------------------------------------------------------------------------------------------- the lock
def cut_slot(ob, at, rot):
    cutter = kit.box("cutter", (1.58, 0.78, 0.7), (at.x, at.y, DISC_Z1 - 0.55), M["dark"], rot=(0, 0, rot),
                     bevel=0.0)
    bpy.context.view_layer.update()
    mo = ob.modifiers.new("cut", "BOOLEAN")
    mo.operation = "DIFFERENCE"
    mo.object = cutter
    mo.solver = "EXACT"
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="cut")
    ob.select_set(False)
    bpy.data.objects.remove(cutter)


def sector(name, a0, a1, r0, r1, z0, z1, mat):
    n = max(2, int((a1 - a0) / 5))
    arc = [a0 + (a1 - a0) * i / n for i in range(n + 1)]
    pts = [tuple(D(a) * r1)[:2] for a in arc] + [tuple(D(a) * r0)[:2] for a in reversed(arc)]
    return prism(name, pts, z0, z1, mat, None, bevel=0.0)


def disc():
    X, Nn = D(NAZ + 90), D(NAZ)
    S0 = D(-45) * FWD
    lat = S0 + Nn * 1.5 + X * 0.3
    bed = DISC_Z1 - 0.2
    # the body with a lip round its top, then a floor of separate plates of uneven height and colour with dark seams between
    body = kit.lathe("base-disc", [(0.01, DISC_Z0), (DISC_R - 0.1, DISC_Z0), (DISC_R, DISC_Z0 + 0.1),
                                   (DISC_R, bed - 0.14), (DISC_R + 0.05, bed - 0.1), (DISC_R + 0.05, bed - 0.03),
                                   (DISC_R - 0.04, bed), (0.01, bed)],
                     (0, 0, 0), M["golds"], verts=72)
    floor = kit.cyl("base-discbed", DISC_R - 0.26, 0.02, (0, 0, bed - 0.005), M["bed"], verts=48, bevel=0.0)
    plates = [body, floor]
    edges = [(-8, 72, 0.21, "goldy"), (72, 128, 0.12, "gold"), (128, 196, 0.17, "goldb"), (196, 262, 0.1, "gold"),
             (262, 300, 0.19, "goldb"), (300, 352, 0.14, "gold")]
    for i, (a0, a1, h, mat) in enumerate(edges):
        plates.append(sector(f"base-plate{i}", a0 + 1.0, a1 - 1.0, 1.91, DISC_R - 0.3, bed, bed + h, M[mat]))
    hub = [tuple(D(22.5 * i) * 1.86)[:2] for i in range(16)]
    plates.append(prism("base-hubplate", hub, bed, DISC_Z1, M["gold"], None, bevel=0.0))
    for ob in plates:
        cut_slot(ob, lat, NAZ + 90)
    for ob in plates[2:]:
        add_bevel(ob, 0.035)
    # raised parts on the plates
    for i, (a, r, rad, h, mat) in enumerate(((150, 2.75, 0.26, 0.26, "gold"), (232, 2.8, 0.2, 0.22, "goldb"),
                                             (40, 3.0, 0.2, 0.34, "gold"), (284, 3.05, 0.2, 0.24, "goldy"))):
        c = D(a) * r
        kit.cyl(f"base-boss{i}", rad, h, (c.x, c.y, bed + 0.05), M[mat], verts=16, bevel=0.03)
    for i, (a, r, ln, rot) in enumerate(((100, 2.8, 1.3, 10), (282, 2.75, 0.9, 12))):
        c = D(a) * r
        kit.box(f"base-bar{i}", (ln, 0.26, 0.3), (c.x, c.y, bed + 0.03), M["goldy"], rot=(0, 0, a + 90 + rot),
                bevel=0.04)
    # the latch, in its slot
    e = bpy.data.objects.new("latch", None)
    kit.link(e)
    e.location = (lat.x, lat.y, DISC_Z1)
    kit.MOVING.append(e)
    kit.box("latch-block", (1.5, 0.7, 0.5), (0, 0, -0.02), M["star"], rot=(0, 0, NAZ + 90), bevel=0.06, parent=e)
    PART["latch"] = e
    # the small block with the thin rod
    bx = S0 + X * 2.3 - Nn * 0.7
    kit.box("base-box", (0.8, 0.8, 0.62), (bx.x, bx.y, DISC_Z1 - 0.1), M["star"], rot=(0, 0, NAZ + 90), bevel=0.05)
    lv = bx + X * 0.12
    kit.cyl("base-lever", 0.065, 1.3, (lv.x, lv.y, DISC_Z1 + 0.5), M["star"], verts=12, bevel=0.02)


def star_outline(n=128):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 1.28 + 0.4 * (1 - abs(math.sin(4 * a))) ** 1.25
        pts.append((r * math.sin(a), r * math.cos(a)))
    return pts


def prism(name, pts, z0, z1, mat, parent, bevel=0.04):
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x, y, z0)) for x, y in pts])
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += z1 - z0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat], smooth=False, bevel=bevel, segs=2, parent=parent)


def star():
    """Everything on the star plate, in the plate's own frame: X to the screen right, Y up the plate, Z out of its
    face. The plate leans back. Behind it, in layers: the top gear and the left cog (on iron straps fixed to the
    plate's back), then the hand on the plate's own axle, then the hand's pinion."""
    fr = bpy.data.objects.new("starframe", None)
    kit.link(fr)
    t = math.radians(LEAN)
    up, N0 = Vector((0, 0, 1)), D(NAZ)
    fr.matrix_world = Matrix((D(NAZ + 90), up * math.cos(t) - N0 * math.sin(t),
                              N0 * math.cos(t) + up * math.sin(t))).transposed().to_4x4()
    S0 = D(-45) * FWD
    fr.location = S0 + Vector((0, 0, DISC_Z1 + STAR_H))
    prism("base-star", star_outline(), -0.3, 0.18, M["star"], fr)
    ft = S0 + N0 * 0.1
    kit.box("base-starfoot", (1.3, 0.7, 0.5), (ft.x, ft.y, DISC_Z1 - 0.05), M["star"], rot=(0, 0, NAZ + 90),
            bevel=0.05)
    # the orb, half sunk in its socket
    kit.cyl("base-socket", 0.85, 0.05, (0.2, -0.15, 0.15), M["dark"], verts=32, bevel=0.0, parent=fr)
    ob = kit.blob("base-orb", (0.2, -0.15, 0.24), 0.8, 1.0, M["orb"], parent=fr)
    ob.modifiers.new("sub", "SUBSURF").render_levels = 2
    # the hand on the star's axle, behind the plate and the gears
    h = bpy.data.objects.new("hand", None)
    kit.link(h, fr)
    h.location = (-0.3, -0.6, 0.0)          # Flash's hand turns about a point low and left of the star's middle
    kit.MOVING.append(h)
    bm = bmesh.new()
    zc = -1.05
    T, E = bm.verts.new((0, 3.95, zc)), bm.verts.new((0, -0.2, zc))
    Lv, Rv = bm.verts.new((-0.52, 1.3, zc)), bm.verts.new((0.52, 1.3, zc))
    F, B = bm.verts.new((0, 1.3, zc + 0.1)), bm.verts.new((0, 1.3, zc - 0.12))
    for f in ((T, Lv, F), (T, F, Rv), (T, Rv, B), (T, B, Lv), (E, F, Lv), (E, Rv, F), (E, B, Rv), (E, Lv, B)):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("hand-blade", bm, [M["blade"]], smooth=False, parent=h)
    kit.cyl("hand-hub", 0.26, 0.9, (0, 0, -1.45), M["iron"], verts=20, bevel=0.02, parent=h)
    kit.cyl("base-handaxle", 0.2, 0.235, (-0.3, -0.6, -0.535), M["iron"], verts=16, bevel=0.0, parent=fr)
    kit.gear("hand-pinion", 0.5, 10, 0.16, (0, 0, -1.3), M["iron"], (0, 0, 0), tooth=0.24, parent=h)
    PART["hand"] = h
    # the top gear, tucked behind the star's top left: only its upper teeth show
    gx, gy = -0.3, 1.35
    kit.box("base-gearstrap", (0.36, 0.9, 0.165), (gx * 0.6, gy * 0.62, -0.385), M["iron"],
            rot=(0, 0, math.degrees(math.atan2(-gx, gy))), bevel=0.03, parent=fr, origin="centre")
    g = bpy.data.objects.new("gear", None)
    kit.link(g, fr)
    g.location = (gx, gy, -0.58)
    kit.MOVING.append(g)
    kit.gear("gear-wheel", 0.95, 12, 0.2, (0, 0, 0), M["gear"], (0, 0, 0), tooth=0.22, parent=g)
    PART["gear"] = g
    # the dark cog hugging the star's left side, most of it behind the plate
    cx, cy = -1.55, -0.25
    kit.box("base-cogstrap", (1.1, 0.36, 0.165), (cx * 0.62, cy * 0.8, -0.385), M["iron"], bevel=0.03, parent=fr,
            origin="centre")
    c = bpy.data.objects.new("cog", None)
    kit.link(c, fr)
    c.location = (cx, cy, -0.63)
    kit.MOVING.append(c)
    kit.gear("cog-wheel", 0.9, 10, 0.3, (0, 0, 0), M["cog"], (0, 0, 0), tooth=0.24, parent=c)
    PART["cog"] = c


def cards():
    """Two bright cards that only shiny metal sees (no light on matt surfaces, no shadow, not in the picture): the
    hard highlights of Flash's polished metal, as the Incubator. The sun, sky and camera stay the kit's."""
    v = -kit.cam_fwd()
    r = Vector((1, 1, 0)).normalized()
    u = r.cross(v) if r.cross(v).z > 0 else v.cross(r)
    cen = Vector((0, 0, 4.0))
    for nm, n, size, col, e in (("card-key", v + u * 0.5 - r * 0.5, 7.0, (1.0, 0.95, 0.82), 30.0),
                                ("card-sky", v + u * 1.3 + r * 0.2, 16.0, (0.7, 0.8, 1.0), 2.5),
                                ("card-star", D(NAZ) + Vector((0, 0, 0.15)), 7.0, (1.0, 0.93, 0.8), 14.0)):
        n = n.normalized()
        l = (2 * n.dot(v) * n - v).normalized()
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
        ob = kit.mesh_ob(nm, bm, [kit.flat(nm, tuple(int(255 * c) for c in col), emit=e)], smooth=False)
        ob.matrix_world = basis(-l, cen + l * 22)
        ob.visible_camera = ob.visible_diffuse = ob.visible_shadow = ob.visible_transmission = False
        ob.visible_volume_scatter = False


def build():
    M.update(mats())
    cards()
    cage()
    disc()
    star()


def hand_angle(k):
    s = (1 - math.cos(2 * math.pi * (k % N) / N)) / 2
    return math.radians(-25 + 122 * s)              # from up, toward the screen left


def turn(k):
    k = k % N
    th = hand_angle(k)
    PART["hand"].rotation_euler = (0, 0, th)
    PART["gear"].rotation_euler = (0, 0, -th * 0.5 + 0.12)
    PART["cog"].rotation_euler = (0, 0, th * 1.5)
    down = 1.0 if 9 <= k <= 20 else 0.5 if k in (8, 21) else 0.0
    PART["latch"].location.z = DISC_Z1 - 0.47 * down


def family(o):
    p = o
    while p is not None:
        if p in kit.MOVING:
            return p.name
        p = p.parent
    return "base"


kit.run(build, turn, family=family)
if kit.MODE == "full":
    sc = kit.SC
    sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 256))
    out = kit.OUT / "render"
    out.mkdir(exist_ok=True)
    only = [int(a) for a in kit.ARGS[2:]]
    for k in only or range(int(os.environ.get("PB_FIRST", 0)), kit.FRAMES):
        turn(k)
        bpy.context.view_layer.update()
        sc.render.filepath = str(out / f"f-{k:02d}.png")
        bpy.ops.render.render(write_still=True)
    print("DONE full")
