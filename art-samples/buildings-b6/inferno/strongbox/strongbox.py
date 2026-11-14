"""strongbox.py : the Inferno Strongbox (building 8, Flash folder imonsterlab) in 3D, one look for its four levels,
built clean-room from the Flash picture put into words (14 Nov 2026). Only the generic Inferno kit is used
(../kit.py: camera, light, helpers), as the Incubator.

    blender -b --factory-startup -P strongbox.py -- 1 <fit|check|gap|full> [frame]

The building: a squat round iron bowl standing on four dark spikes. Its wall is plate: a broad door panel on the
front (a raised plate and a brass keyhole on it), and on each side a plate frame with a window of upright slats.
Brass bands tie the two front spikes to the bowl beside the door. Inside the bowl's rim is a black pit; over it, held
by two silver claws, sits a thick gold disc (the lock). On the disc stands a gold star plate with a red orb in its
middle; behind the star a silver hand turns on the star's axle, with a dark pinion and a dark gear above it; a dark
cog sits on the star's left edge; a gold latch block lies in front of the orb and a gold box with a thin lever to the
right.

World: Z up, the bowl's axis on the origin. The camera looks from +X -Y. Angles round the bowl are `phi`, degrees
from the viewer's side (0 = front, + = screen right, 180 = back).

The loop (unlocking), 30 frames (Flash's strip is 31 cells, cell 30 = cell 0): the hand swings from one o'clock
over the top to nine o'clock and back, once; its pinion turns the top gear and the side cog turns with it; the latch
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

Z0, Z1 = 0.8, 4.35                    # the bowl's bottom and rim
DISC_R, DISC_Z0, DISC_Z1 = 3.85, 5.3, 6.45
STAR_H = 1.6                          # the star's middle above the disc
FWD = 0.9                             # the star stands this far in front of the disc's middle
NAZ = -25.0                           # the way the star faces (azimuth)
PROF = [(0.8, 4.6), (1.1, 5.25), (1.6, 5.6), (2.2, 5.7), (3.0, 5.6), (3.6, 5.3), (4.35, 4.6)]
PIT = 4.12


def R(z):
    """The bowl wall's radius at height z."""
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
    """A curved plate on the bowl wall: phi p0..p1, height z0..z1, its outer face `off` outside the wall, `thick`
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
    bv.width, bv.segments, bv.limit_method = bevel, 3, "ANGLE"
    return ob


# ------------------------------------------------------------------------------------------------------- materials
def mats():
    m = {}
    m["plate"] = kit.painted("plate", (118, 108, 96), rough=0.4, metal=0.6, wear=(160, 146, 130), rust=(74, 66, 58),
                             scale=3.0, dirt=0.3, soot=0.45, rust_at=0.55, grain=0.12, spec=0.5)
    m["rim"] = kit.painted("rimplate", (172, 150, 132), rough=0.34, metal=0.6, wear=(226, 206, 190),
                           rust=(120, 100, 86), scale=3.5, dirt=0.15, soot=0.3, grain=0.1, spec=0.5)
    m["door"] = kit.painted("door", (108, 97, 86), rough=0.4, metal=0.6, wear=(136, 122, 108), rust=(80, 70, 60),
                            scale=2.6, dirt=0.25, soot=0.35, grain=0.12)
    m["slat"] = kit.painted("slat", (176, 150, 118), rough=0.6, metal=0.2, wear=(206, 180, 146), rust=(90, 66, 44),
                            scale=5.0, dirt=0.35, soot=0.5, rust_at=0.5)
    m["dark"] = kit.painted("dark", (16, 15, 14), rough=0.85, dirt=0.2)
    m["iron"] = kit.painted("iron", (50, 48, 46), rough=0.4, metal=0.6, wear=(150, 142, 132), rust=(22, 22, 22),
                            scale=6.0, dirt=0.2, spec=0.5)
    m["gear"] = kit.painted("gear", (96, 94, 90), rough=0.36, metal=0.6, wear=(196, 192, 184), rust=(40, 40, 40),
                            scale=7.0, dirt=0.1, spec=0.5)
    m["cog"] = kit.painted("cog", (36, 34, 32), rough=0.6, metal=0.3, wear=(84, 78, 72), scale=6.0, dirt=0.1)
    m["blade"] = kit.painted("blade", (226, 226, 220), rough=0.3, metal=0.25, wear=(250, 250, 246),
                             rust=(150, 150, 146), scale=5.0, dirt=0.0, spec=0.7)
    m["spike"] = kit.painted("spike", (30, 33, 34), rough=0.5, metal=0.4, wear=(64, 70, 72), scale=4.0, dirt=0.1)
    m["gold"] = kit.painted("gold", (250, 182, 40), rough=0.3, metal=0.55, wear=(255, 216, 80), rust=(118, 68, 20),
                            scale=1.1, dirt=0.12, soot=0.35, rust_at=0.45, spec=0.6, ao_min=0.4, streak=0.8)
    m["star"] = kit.painted("stargold", (240, 186, 70), rough=0.26, metal=0.75, wear=(255, 224, 120),
                            rust=(170, 120, 40), scale=3.0, dirt=0.05, rust_at=0.6, spec=0.6)
    m["brass"] = kit.painted("brass", (176, 140, 84), rough=0.35, metal=0.6, wear=(226, 190, 120), scale=5.0,
                             dirt=0.1)
    m["silver"] = kit.painted("silver", (190, 190, 186), rough=0.25, metal=0.8, wear=(232, 232, 228),
                              rust=(110, 110, 110), scale=4.0, dirt=0.1, spec=0.6)
    t = kit.NT("orb")
    t.set(**{"Base Color": kit.srgb(226, 30, 26), "rough": 0.12, "spec": 0.6, "coat": 1.0})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(226, 30, 26)
    t.bsdf.inputs["Emission Strength"].default_value = 0.25
    m["orb"] = t.m
    return m


M = {}
PART = {}


# ------------------------------------------------------------------------------------------------------- the bowl
def bowl():
    prof = [(0.01, Z0), (R(Z0) - 0.4, Z0)] + [(R(z) - 0.35, z) for z, _ in PROF[1:]]
    prof += [(PIT, Z1), (PIT, 3.8), (0.01, 3.8)]
    kit.lathe("base-drum", prof, (0, 0, 0), M["dark"], verts=72)
    kit.lathe("base-rimtop", [(PIT + 0.02, Z1 - 0.25), (PIT + 0.02, Z1 + 0.05), (R(Z1) + 0.1, Z1 + 0.05), (R(Z1) + 0.14, Z1 - 0.25),
               (PIT + 0.02, Z1 - 0.25)],
              (0, 0, 0), M["rim"], verts=72, bevel=0.04)
    kit.cyl("base-pedestal", 2.9, DISC_Z0 - 3.8 + 0.02, (0, 0, 3.8), M["dark"], verts=40)
    for s in (1, -1):
        a, b = (37, 180) if s > 0 else (-180, -37)
        hole = (49, 172, 1.7, 3.45) if s > 0 else (-172, -49, 1.7, 3.45)
        patch(f"base-shell{s}", a, b, Z0 + 0.05, Z1, 0.0, 0.16, M["plate"], hole=hole)
        patch(f"base-band{s}", a, b, 3.4, Z1, 0.1, 0.24, M["rim"], bevel=0.04)
        for i, p in enumerate(range(53, 172, 6)):
            pts = [P(s * p, 1.7 + 1.85 * j / 8, -0.24) for j in range(9)]
            kit.sweep(f"base-slat{s}-{i}", pts, D(-45 + s * p + 90), 0.15, 0.12, M["slat"], bevel=0.03)
    # the door
    lean = lambda z: 0.3 + 0.3 * max(0.0, z - 2.2)          # the door stands straighter than the wall
    patch("base-door", -27, 27, 0.95, Z1 - 0.05, lean, 0.7, M["plate"], bevel=0.06)
    patch("base-doorlip", -28, 28, Z1 - 0.3, Z1 + 0.11, lambda z: lean(z) + 0.12, 0.6, M["rim"], bevel=0.05)
    patch("base-doorplate", -15.5, 15.5, 0.85, 3.3, lambda z: lean(z) + 0.16, 0.25, M["door"], bevel=0.04)
    kn = P(21, 2.75, lean(2.75) - 0.03)
    out = D(-45 + 21)
    k = kit.cyl("base-knob", 0.2, 0.14, (0, 0, 0), M["brass"], verts=20, bevel=0.03)
    k.matrix_world = basis(out, kn)
    k = kit.cyl("base-knobeye", 0.08, 0.05, (0, 0, 0), M["dark"], verts=12, bevel=0.0)
    k.matrix_world = basis(out, kn + out * 0.12)
    # the spikes it stands on, the front two tied on with brass bands
    for i, p in enumerate((32, -32, 148, -148)):
        at = P(p, 0.0, r=5.38)
        kit.cyl(f"base-spike{i}", 0.05, 3.3, at, M["spike"], verts=20, r2=0.62, bevel=0.0)
        if abs(p) < 90:
            for j, z in enumerate((1.75, 2.75)):
                rg = kit.ring(f"base-hoop{i}-{j}", 0.05 + 0.57 * z / 3.3 + 0.05, 0.075, M["brass"], z=0.0, n=32)
                rg.location = (at.x, at.y, z)
    # the claws that hold the disc
    for i, p in enumerate((30, -30)):
        pts = [P(p, 3.6, r=5.35), P(p, 4.6, r=5.05), P(p, 5.6, r=4.75), P(p, DISC_Z1 + 0.05, r=4.25),
               P(p, DISC_Z1 + 0.12, r=3.7)]
        kit.tube(f"base-claw{i}", pts, 0.5, M["silver"], verts=16, r_end=0.16, smooth=True)


# ------------------------------------------------------------------------------------------------------- the lock
def apply_cut(ob, cutter):
    mo = ob.modifiers.new("cut", "BOOLEAN")
    mo.operation = "DIFFERENCE"
    mo.object = cutter
    mo.solver = "EXACT"
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(cutter)


def disc():
    X, Nn = D(NAZ + 90), D(NAZ)
    d = kit.lathe("base-disc", [(0.01, DISC_Z0), (DISC_R - 0.1, DISC_Z0), (DISC_R, DISC_Z0 + 0.1),
                                (DISC_R, DISC_Z1 - 0.1), (DISC_R - 0.1, DISC_Z1), (0.01, DISC_Z1)],
                  (0, 0, 0), M["gold"], verts=72)
    S0 = D(-45) * FWD
    lat = S0 + Nn * 1.5 + X * 0.3
    cut = kit.box("cutter", (1.58, 0.78, 0.7), (lat.x, lat.y, DISC_Z1 - 0.55), M["dark"], rot=(0, 0, NAZ + 90),
                  bevel=0.0)
    bpy.context.view_layer.update()
    apply_cut(d, cut)
    for i in range(18):
        a = math.radians(20 * i + 7)
        kit.blob(f"base-rivet{i}", (3.5 * math.cos(a), 3.5 * math.sin(a), DISC_Z1), 0.075, 0.6, M["star"])
    for i in range(24):
        a = math.radians(15 * i)
        kit.blob(f"base-siderivet{i}", (DISC_R * math.cos(a), DISC_R * math.sin(a), DISC_Z1 - 0.28), 0.065, 1.0,
                 M["star"])
    # seams of the disc's plates: two shallow dark lines
    for i, (az, off) in enumerate(((NAZ + 20, 2.3), (NAZ + 115, -1.4))):
        c = D(az + 90) * off
        ln = 2 * math.sqrt(max(0.1, 3.3 ** 2 - off ** 2))
        kit.box(f"base-seam{i}", (ln, 0.05, 0.012), (c.x, c.y, DISC_Z1 - 0.004), M["dark"], rot=(0, 0, az), bevel=0.0)
    # the latch, in its slot
    e = bpy.data.objects.new("latch", None)
    kit.link(e)
    e.location = (lat.x, lat.y, DISC_Z1)
    kit.MOVING.append(e)
    kit.box("latch-block", (1.5, 0.7, 0.5), (0, 0, -0.02), M["star"], rot=(0, 0, NAZ + 90), bevel=0.06, parent=e)
    PART["latch"] = e
    # the box with the lever
    bx = S0 + X * 2.1 + Nn * 0.2
    kit.box("base-box", (1.1, 1.1, 1.0), (bx.x, bx.y, DISC_Z1 - 0.02), M["star"], rot=(0, 0, NAZ + 90), bevel=0.06)
    lv = bx + X * 0.28 - Nn * 0.28
    kit.cyl("base-lever", 0.1, 1.0, (lv.x, lv.y, DISC_Z1 + 0.9), M["star"], verts=12, bevel=0.02)


def star_outline(n=128):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = 1.16 + 0.46 * (1 - abs(math.sin(4 * (a - math.radians(22.5))))) ** 1.25
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
    """Everything on the star plate, in the plate's own frame: X to the screen right, Y up, Z out of its face."""
    fr = bpy.data.objects.new("starframe", None)
    kit.link(fr)
    fr.matrix_world = Matrix((D(NAZ + 90), Vector((0, 0, 1)), D(NAZ))).transposed().to_4x4()
    fr.location = D(-45) * FWD + Vector((0, 0, DISC_Z1 + STAR_H))
    prism("base-star", star_outline(), -0.3, 0.18, M["star"], fr)
    kit.box("base-starfoot", (1.1, STAR_H - 1.0, 0.5), (0, -STAR_H - 0.02, 0), M["star"], bevel=0.05, parent=fr,
            origin="bottom").rotation_euler = (math.radians(-90), 0, 0)
    ob = kit.blob("base-orb", (0, -0.12, 0.5), 0.8, 1.0, M["orb"], parent=fr)
    ob.modifiers.new("sub", "SUBSURF").render_levels = 2
    # the hand on the star's axle, behind the plate
    h = bpy.data.objects.new("hand", None)
    kit.link(h, fr)
    kit.MOVING.append(h)
    bm = bmesh.new()
    zc = -0.7
    T, E = bm.verts.new((0, 3.7, zc)), bm.verts.new((0, 0.0, zc))
    Lv, Rv = bm.verts.new((-0.45, 1.15, zc)), bm.verts.new((0.45, 1.15, zc))
    F, B = bm.verts.new((0, 1.15, zc + 0.1)), bm.verts.new((0, 1.15, zc - 0.14))
    for f in ((T, Lv, F), (T, F, Rv), (T, Rv, B), (T, B, Lv), (E, F, Lv), (E, Rv, F), (E, B, Rv), (E, Lv, B)):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("hand-blade", bm, [M["blade"]], smooth=False, parent=h)
    kit.cyl("hand-hub", 0.28, 0.82, (0, 0, -1.16), M["iron"], verts=20, bevel=0.02, parent=h)
    kit.gear("hand-pinion", 0.6, 10, 0.16, (0, 0, -1.05), M["iron"], (0, 0, 0), tooth=0.24, parent=h)
    PART["hand"] = h
    # the top gear on its post
    gx, gy = -0.38, 1.6
    kit.box("base-gearpost", (0.24, 0.2, gy + STAR_H + 0.2), (gx, -STAR_H - 0.02, -1.42), M["iron"], bevel=0.04,
            parent=fr).rotation_euler = (math.radians(-90), 0, 0)
    kit.cyl("base-gearaxle", 0.11, 0.16, (gx, gy, -1.31), M["iron"], verts=12, bevel=0.0, parent=fr)
    g = bpy.data.objects.new("gear", None)
    kit.link(g, fr)
    g.location = (gx, gy, -1.05)
    kit.MOVING.append(g)
    kit.gear("gear-wheel", 0.95, 12, 0.16, (0, 0, 0), M["gear"], (0, 0, 0), tooth=0.2, parent=g)
    PART["gear"] = g
    # the cog on the star's left edge
    kit.box("base-cogpost", (0.24, STAR_H - 0.1, 0.34), (-1.57, -STAR_H - 0.02, 0.6), M["star"], bevel=0.04,
            parent=fr).rotation_euler = (math.radians(-90), 0, 0)
    ax = kit.cyl("base-cogaxle", 0.12, 0.1, (-1.6, -0.3, 0.6), M["iron"], verts=12, bevel=0.0, parent=fr)
    ax.rotation_euler = (0, math.radians(-90), 0)
    c = bpy.data.objects.new("cog", None)
    kit.link(c, fr)
    c.location = (-2.0, -0.3, 0.6)
    c.rotation_euler = (0, math.radians(90), 0)
    sp = bpy.data.objects.new("cog-spin", None)
    kit.link(sp, c)
    kit.MOVING.append(c)
    kit.gear("cog-wheel", 1.1, 12, 0.5, (0, 0, 0), M["cog"], (0, 0, 0), tooth=0.22, parent=sp)
    PART["cog"] = sp


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
    bowl()
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
