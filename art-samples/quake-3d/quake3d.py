"""quake3d.py : the Quake Tower (building 129, Flash INFERNOQUAKETOWER.as), levels in three looks, as a 3D model in the
game's camera (helper quake-3d, 2 Nov 2026), modelled on the Flash tower (server/public/assets/buildings/iquaketower/
anim.1.png, 33 cells) in the worn look of the approved 3D towers (../tower-3d/worn3d.py), no outline.

    blender -b --factory-startup -P quake3d.py -- T MODE [args]

T is the look: 1 (levels 1-2, worn, Flash's tower), 2 (levels 3-4, Brimstone), 3 (levels 5-6, Forged Steel); each look is
the one below plus upgrades and stands taller (the Inferno's rule, owner 29 Oct 2026: height shows range). Modes:
  cell F [F ...]     render/tT/cell-FF.png      the tower at Flash cell F (0-32) of its strike
  cells              render/tT/cell-00..32.png  all 33 cells
  QUAKE_STATE=damaged ... the same as dmg-FF.png: the damaged tower (one loose pass after Flash's damaged strip)
  destroyed          render/tT/destroyed.png    the wreck (one loose pass after Flash's top.1.destroyed.png)
  save               quake-tT.blend
render/tT/camera.json records the ground middle (the footprint's middle) on the 4x canvas (150 px a unit).

The tower (as Flash's): a round iron drum with a red and grey band, a pit in its top ringed by a black rubber ring, two
brass clamps on its rim; a long iron foot plate under it along the gantry; two tall iron uprights standing on the drum,
each a plate narrow at the head and stepping out toward the front below a curved fillet; a round crossbar through their
heads; on each end of the bar a gold chain coiled round it and running in a loop down to a winch wheel on the foot plate;
a third chain coiled round the bar's middle lowering a pulley block and a copper claw; and the weight, a riveted brown
drum with a red and white band, a domed iron cap and a ring on top, standing in the pit.

The strike (Flash's 33 cells, measured): the claw comes down (cells 1-10), hooks the ring (10-13), hauls the weight up
17 px (14-28), lets go: the claw flies back up and the weight drops back into the pit (29-32). The side chains run with
the winch. Cell 0 is the tower at rest.
"""
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault("LOOK3D_NO_LINE", "1")      # owner, 30 Oct 2026: no outline on the 3D towers

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
L.EL = 30.0                                        # the game's 2:1 ground (Flash's pit ellipse reads 0.52)
import square3d as Q  # noqa: E402
import worn3d as W  # noqa: E402
from look3d import bear, srgb  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "cell", "0"]
TIER = int(ARGS[0])
STATE = os.environ.get("QUAKE_STATE", "")          # "" or "damaged"
DMG = STATE == "damaged"
RISE = (0.0, 0.3, 0.6)[TIER - 1]                    # how much taller each look's gantry stands

# ---- the measurements (units: 37.5 game px; the world's origin is the footprint's middle on the ground)
DRUM_R, DRUM_H = 0.70, 0.26
PIT_R = 0.43
WT_R = 0.39                                         # the weight's radius (fix 3 Nov: Flash's fills the gap)
WT_Z0 = 0.27                                        # its foot at rest
WT_BODY = 1.19                                      # its plated body's top (Flash's band is twice as deep)
WT_BAND = 1.33                                      # its red and white shoulder's top
UP_T = 0.15                                         # the uprights' thickness
UPY = {-1: 0.74, 1: 0.66}                           # their middles (3 Nov: wider apart, as Flash; the +y one steps out back)
BAR_Z = 2.74 + RISE                                 # the crossbar's axis
BAR_R = 0.09
BAR_Y = (-1.105, 0.96)
SIDEY = {-1: 0.915, 1: 0.84}                        # the side chains' loops, just outside the uprights
WHEEL_Z, WHEEL_R = 0.43, 0.2                        # the winch wheels' axles and radius
WHEEL_X = {-1: 0.18, 1: 0.0}                        # their axles' x (Flash: the -y one stands further forward)
WHEEL_ZS = {-1: 0.54, 1: WHEEL_Z}                   # and height (the -y one higher)
COIL_R = 0.14                                       # chain wound round the bar: its centre line's radius
HANG = 0.66                                         # the claw's tip at rest, below the bar's axis
LUG_Z = WT_BAND + 0.23                              # the ring on the weight's cap, its middle at rest
SPIN = float(os.environ.get("QUAKE_SPIN", "-35"))     # the claw's turn at rest (its bow to the left, Flash)
LINK = 0.056                                        # chain pitch
HX = -0.10                                          # the claw's stem, behind the ring (it curls through it to +x)
GY = -0.015                                         # the gantry stands this far toward -y of the drum (Flash)

# Flash's strike, per cell: the weight's lift in screen px (1x) and the claw's drop (0-1 of the way to the ring)
LIFT_PX = [0] * 14 + [1, 2, 4, 6, 7, 8, 10, 11, 12, 13, 15, 15, 16, 17, 17, 15, 11, 5, 0]
DOWN = [0, 0.04, 0.12, 0.24, 0.38, 0.52, 0.66, 0.78, 0.88, 0.96, 1.0, 1.0, 1.0, 1.0] + [1.0] * 15 + [0, 0, 0, 0]
PX = 37.5 * math.cos(math.radians(L.EL))           # screen px (1x) per unit of height


# --------------------------------------------------------------------------------------------------------- materials
WARM_SHADE = [(0.0, (0.30, 0.25, 0.20, 1)), (0.18, (0.44, 0.37, 0.30, 1)), (0.5, (0.80, 0.72, 0.62, 1)),
              (1.0, (1.0, 0.95, 0.86, 1))]


def rusty(name, base=(86, 70, 60), dark=(42, 33, 29), rust=(150, 76, 36), edge=(170, 148, 120), rust_k=0.85,
          soot=0.3, dents=1.0, dirt=0.45, spec=0.1, spec_col=(1.0, 0.86, 0.7, 1), cover=0.46, seams=0):
    """worn3d.mat_iron made rustier and warmer for the Quake Tower (lead's check 3 Nov: Flash is rusty brown with soot,
    the 3D was clean grey-purple): more rust (cover: the noise level where rust starts), soot, a warm shade ramp."""
    p = L.Paint(name)
    col = p.ramp(p.noise(2.5, 4.0, 0.6), [(0.3, srgb(*dark)), (0.7, srgb(*base))])
    if seams:
        idx, f, _ = W._stave(p, seams, wob=0.0)
        col = p.mix(col, p.ramp(W._white(p, idx), [(0.0, W._grey(0.8)), (1.0, W._grey(1.12))]), 1.0, 'MULTIPLY')
        d = p.math("MINIMUM", f, p.math("SUBTRACT", 1.0, f))
        col = p.mix(col, srgb(*[int(c * 0.35) for c in dark]), p.ramp(d, [(0.02, W.WHITE), (0.045, W.BLACK)]))
    convex, concave = W._attr(p)
    rn = p.math("ADD", p.noise(4.0, 8.0, 0.66), p.math("MULTIPLY", concave, 0.35))
    rm = p.ramp(rn, [(cover, W.BLACK), (cover + 0.1, W._grey(rust_k))])
    rcol = p.ramp(p.noise(11.0, 4.0), [(0.35, srgb(*[int(c * 0.55) for c in rust])), (0.65, srgb(*rust))])
    col = p.mix(col, rcol, rm)
    pit = p.ramp(p.noise(18.0, 3.0), [(0.62, W.BLACK), (0.68, W.WHITE)])
    col = p.mix(col, srgb(*[int(c * 0.4) for c in dark]), p.math("MULTIPLY", W._bw(p, pit), 0.75))
    dent = W._voronoi(p, 9.0)
    col = p.mix(col, p.ramp(dent, [(0.05, W._grey(0.78)), (0.4, W._grey(1.06))]), 1.0, 'MULTIPLY')
    col = W.weather(p, col, edge=edge, edge_k=0.6, cavity=0.7, dirt=dirt, soot=soot, streaks=0.3)
    h = p.math("MULTIPLY", p.math("ADD", p.math("MULTIPLY", dent, dents), p.math("MULTIPLY", W._bw(p, pit), -0.15)), 2.5)
    return p.finish(col, spec=spec, spec_rough=0.5, spec_col=spec_col, metal=True, bump=(h, 0.8), shade=WARM_SHADE,
                    edge_dark=0.45, sheen=0.04)


def materials():
    iron = rusty
    soot = 0.25 if DMG else 0.0
    M = dict(
        upright=iron("upright", base=(90, 78, 64), dark=(38, 32, 26), rust=(132, 66, 34), edge=(172, 150, 122),
                     rust_k=0.65 + (0.2 if DMG else 0), soot=0.45 + soot, dents=0.8, cover=0.5),
        frame=iron("frame", base=(84, 72, 58), dark=(34, 28, 23), rust=(128, 64, 32), edge=(160, 140, 114), rust_k=0.7,
                   soot=0.4 + soot, cover=0.5),
        bar=iron("bar", base=(92, 82, 66), dark=(38, 33, 27), rust=(130, 66, 34), edge=(184, 164, 132), rust_k=0.55,
                 soot=0.35 + soot, cover=0.52),
        cap=iron("cap", base=(122, 106, 92), dark=(56, 46, 40), rust=(150, 80, 44), edge=(214, 196, 176), rust_k=0.6,
                 dents=1.4, soot=0.5 + soot, cover=0.5),
        rim=iron("rim", base=(132, 110, 92), dark=(66, 52, 42), rust=(146, 74, 40), edge=(208, 186, 160), rust_k=0.7,
                 soot=0.4 + soot, cover=0.5),
        band=W.mat_worn_diag("band", (158, 28, 20), (96, 76, 64), n=8, lean=0.0, under=(60, 40, 32),
                             edge=(196, 170, 150), soot=0.65 + soot, dirt=0.8),
        check=W.mat_worn_diag("check", (180, 30, 22), (190, 174, 162), n=6, lean=0.0, under=(110, 76, 62),
                              edge=(210, 116, 100), soot=0.55 + soot, dirt=0.6, dirt_top=0.35, chips=0.7),
        body=iron("body", base=(98, 58, 44), dark=(56, 32, 24), rust=(124, 60, 32), edge=(196, 150, 128), rust_k=0.5,
                  dents=0.7, seams=6, soot=0.3 + soot, cover=0.5),
        strap=iron("strap", base=(160, 38, 26), dark=(90, 22, 16), rust=(120, 56, 30), edge=(212, 140, 118), rust_k=0.5,
                   dents=0.6, soot=0.3 + soot, cover=0.5),
        rubber=L.mat_flat("rubber", (40, 32, 28), spec=0.2),
        pit=L.mat_flat("pit", (14, 10, 9), spec=0.0),
        # the chains: Flash's are dull dark brass-brown (mean (81, 69, 34) on the sheet), not bright gold
        gold=iron("gold", base=(112, 90, 42), dark=(52, 40, 16), rust=(96, 62, 28), edge=(176, 148, 86), rust_k=0.35,
                  dents=0.3, spec=0.18, spec_col=(0.9, 0.78, 0.5, 1), soot=0.25, dirt=0.4, cover=0.55),
        brass=iron("brass", base=(196, 150, 50), dark=(118, 84, 20), rust=(110, 84, 36), edge=(240, 216, 140),
                   rust_k=0.3, dents=0.4, spec=0.4, spec_col=(1.0, 0.9, 0.6, 1), soot=0.25, cover=0.55),
        claw=iron("claw", base=(214, 128, 64), dark=(140, 70, 30), rust=(120, 60, 30), edge=(250, 204, 150), rust_k=0.3,
                  dents=0.4, spec=0.35, soot=0.1, cover=0.6),
        block=iron("block", base=(132, 118, 106), dark=(70, 58, 50), rust=(140, 74, 44), edge=(212, 196, 180),
                   rust_k=0.6, soot=0.35 + soot, cover=0.5),
        rivet=iron("rivet", base=(66, 50, 42), dark=(32, 25, 20), rust=(120, 62, 34), edge=(160, 140, 122), rust_k=0.5),
    )
    if TIER >= 2:
        M.update(brimstone=W.mat_brimstone("brimstone"), lava=W.mat_lava("lava"))
    if TIER == 3:
        M.update(upright=W.mat_forged("upright_forged", soot=soot), forged=W.mat_forged("forged"),
                 frame=W.mat_forged("frame_forged", base=(70, 64, 64), dark=(34, 31, 33), edge=(168, 162, 158), soot=soot))
    return M


# ------------------------------------------------------------------------------------------------------------- meshes
def ob(name, bm, mats, parent, sharp=35):
    return W.obj(name, bm, mats, parent=parent, sharp=sharp)


def rot_x90():
    """Turns a part built round Z to lie round Y (its axis along the bar)."""
    return Matrix.Rotation(math.radians(-90), 4, 'X')


def upright_xs(z, s=-1):
    """The upright's back and front edge (x) at height z: narrow at the head, stepping out toward the front below a
    concave fillet, a round head about the bar."""
    z1, z2, hr = 1.75, 2.2, 0.13           # 3 Nov: narrower, as Flash's (head 0.26, foot 0.42 across)
    if z > BAR_Z:
        h = max(0.0, hr * hr - (z - BAR_Z) ** 2) ** 0.5
        return -h, h
    if z <= z1:
        front = 0.29
    elif z <= z2:
        t = (z - z1) / (z2 - z1)
        front = hr + (0.29 - hr) * (1 - t) ** 2
    else:
        front = hr
    return (-hr, front) if s < 0 else (-front, hr)   # the +y one mirrored: steps out toward the back (Flash)


def upright(bm, yc, s, jag=0.0, seed=0.0):
    """One upright: the profile lofted up z as a closed section (the two faces and the edges), so its faces are a quad grid."""
    y0, y1 = yc - UP_T / 2, yc + UP_T / 2
    zs = [0.08 + (BAR_Z - 0.08) * i / 44 for i in range(45)]
    zs += [BAR_Z + 0.15 * math.sin(math.radians(a)) for a in (12, 25, 38, 50, 61, 71, 79, 85, 88.5)]
    cols = 6
    rings = []
    for z in zs:
        bx, fx = upright_xs(z, s)
        if jag:      # the damaged look: torn, dented edges
            fx += jag * noise.noise(Vector((z * 6.0, seed, 0.3)))
            bx += jag * noise.noise(Vector((z * 6.0, seed + 4.0, 1.7)))
        xs = [bx + (fx - bx) * i / cols for i in range(cols + 1)]
        ring = [bm.verts.new((x, y0, z)) for x in xs] + [bm.verts.new((x, y1, z)) for x in reversed(xs)]
        rings.append(ring)
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


def chain_link(bm, c, d, nrm, mat, ln=0.066, wd=0.042, r=0.0115):
    """One oval link at c, long along d, lying in the plane of d and nrm."""
    d = d.normalized()
    s = nrm - d * nrm.dot(d)
    s = s.normalized()
    pts = []
    straight = ln - wd
    for k in range(18):
        a = 2 * math.pi * k / 18
        u = math.cos(a) * wd / 2 + math.copysign(straight / 2, math.cos(a))
        v = math.sin(a) * wd / 2
        pts.append(c + d * u + s * v)
    pts.append(pts[0])
    L.tube(bm, pts, [r] * len(pts), sides=6, cap=False, mat=mat)


def chain_on(bm, path, phase, mat, closed=False, pitch=LINK, side=Vector((0, 0, 1))):
    """Links along a polyline (closed: a loop), the first `phase` model units along it, one every pitch, each turned a
    quarter from the last."""
    pts = [Vector(p) for p in path] + ([Vector(path[0])] if closed else [])
    seg = [(a, b, (b - a).length) for a, b in zip(pts, pts[1:])]
    total = sum(s[2] for s in seg)
    s = phase % pitch if closed else 0.0
    k = int(math.floor(phase / pitch)) if closed else 0
    while s < total - (0 if closed else pitch * 0.4):
        acc = 0.0
        for a, b, ln in seg:
            if acc + ln >= s:
                t = (s - acc) / ln if ln else 0.0
                c = a.lerp(b, t)
                d = (b - a)
                break
            acc += ln
        base = side.cross(d)
        if base.length < 1e-4:
            base = Vector((1, 0, 0)).cross(d)
        nrm = base if k % 2 == 0 else base.cross(d)
        chain_link(bm, c, d, nrm.normalized(), mat)
        s += pitch
        k += 1


def coil(bm, yc, turns, length, phase, mat):
    """Chain wound round the bar about yc: a helix of links. phase turns it about the bar (model units along it)."""
    pts = []
    n = int(turns * 24)
    for i in range(n + 1):
        th = 2 * math.pi * turns * i / n + phase / COIL_R
        y = yc - length / 2 + length * i / n
        pts.append((COIL_R * math.cos(th), y, BAR_Z + COIL_R * math.sin(th)))
    chain_on(bm, pts, 0.0, mat, side=Vector((0, 1, 0)))


def side_loop(yc, xw=0.0, zw=WHEEL_Z):
    """The side chain's loop: over the top of the bar (round its coil) and down both sides to under the winch wheel."""
    pts = []
    for i in range(13):                      # over the bar, front (+x) to back
        a = math.pi * i / 12
        pts.append((COIL_R * math.cos(a), yc, BAR_Z + COIL_R * math.sin(a)))
    for i in range(13):                      # under the wheel, back to front
        a = math.pi + math.pi * i / 12
        pts.append((xw + WHEEL_R * math.cos(a), yc, zw + WHEEL_R * math.sin(a)))
    return pts


# -------------------------------------------------------------------------------------------------------------- build
def build_static(M, root):
    """Everything that never moves."""
    # the foot plate along the gantry, and a square foot at each end
    bm = bmesh.new()
    L.rbox(bm, (0.62, 2.1, 0.1), Matrix.Translation((0, 0, 0)), bevel=0.025, segs=2)
    for s in (-1, 1):
        L.rbox(bm, (0.66, 0.36, 0.13), Matrix.Translation((0, s * 0.98, 0)), bevel=0.03, segs=2)
        L.rbox(bm, (0.5, 0.26, 0.06), Matrix.Translation((0, s * 0.98, 0.13)), bevel=0.02, segs=2)
    W.bolts(bm, [(x, s * y, 0.13) for s in (-1, 1) for x in (-0.25, 0.25) for y in (0.86, 1.1)], [(0, 0, 1)] * 8, r=0.03)
    ob("plate", bm, [M["frame"]], root)

    # the drum: a foot ring, the banded side, the rim, the black rubber ring round the pit, the pit
    W.lathe("drum_foot", [[(DRUM_R + 0.03, 0.0), (DRUM_R + 0.03, 0.05), (DRUM_R, 0.06)]], [M["rim"]], parent=root)
    W.lathe("drum", [[(DRUM_R, 0.06), (DRUM_R, DRUM_H - 0.04)]], [M["band"]], bev=0, parent=root)
    W.lathe("drum_rim", [[(DRUM_R, DRUM_H - 0.04), (DRUM_R + 0.012, DRUM_H - 0.02), (DRUM_R, DRUM_H),
                          (0.66, DRUM_H + 0.005), (0.56, DRUM_H)]], [M["rim"]], parent=root)
    W.lathe("rubber", [[(0.57, DRUM_H), (0.57, DRUM_H + 0.025), (0.545, DRUM_H + 0.05), (0.48, DRUM_H + 0.045),
                        (PIT_R + 0.01, DRUM_H + 0.02), (PIT_R, DRUM_H - 0.02)]], [M["rubber"]], bev=0.012, parent=root)
    pit_floor = M["lava"] if TIER >= 2 else M["pit"]
    W.lathe("pit", [[(PIT_R, DRUM_H - 0.02), (PIT_R, 0.12)], [(PIT_R, 0.12), (0.0, 0.12)]], [M["pit"], pit_floor],
            bev=0, parent=root, mat_of_seg=[0, 1])
    # brass clamps on the rim (Flash: one front-left, one at the front)
    bm = bmesh.new()
    for b in (50, 128):
        n = bear(b)
        m = Matrix.Translation(bear(b, DRUM_R - 0.03, DRUM_H - 0.13)) @ Matrix.Rotation(math.radians(-b), 4, 'Z')
        L.rbox(bm, (0.16, 0.1, 0.17), m, bevel=0.02, segs=2)
        W.bolts(bm, [bear(b, DRUM_R + 0.07, DRUM_H - 0.05)], [n], r=0.022)
    ob("clamps", bm, [M["brass"]], root)

    # the gantry (uprights, bar, winches, chains, hook) on its own empty, a little toward -y as Flash's
    g = L.empty("GANTRY", root, loc=(0, GY, 0))
    # the uprights, a boss round the bar on each face, rivets down their edges
    bm = bmesh.new()
    for s in (-1, 1):
        upright(bm, s * UPY[s], s, jag=0.05 if DMG else 0.0, seed=3.0 * s)
    up = ob("uprights", bm, [M["upright"]], g, sharp=30)
    bm = bmesh.new()
    cen, nor = [], []
    for s in (-1, 1):
        for z in [0.45 + 0.3 * i for i in range(int((BAR_Z - 0.6) / 0.3))]:
            bx, fx = upright_xs(z, s)
            for x in (bx + 0.05, fx - 0.05):
                cen.append((x, s * (UPY[s] + UP_T / 2), z))
                nor.append((0, s, 0))
    W.rivets(bm, cen, nor, r=0.022)
    ob("up_rivets", bm, [M["rivet"]], g)
    bm = bmesh.new()
    for s in (-1, 1):
        for face in (-1, 1):
            y = s * UPY[s] + face * (UP_T / 2 + 0.015)
            sub = bmesh.new()
            bmesh.ops.create_cone(sub, cap_ends=True, segments=20, radius1=0.15, radius2=0.13, depth=0.03)
            L.add_mesh(bm, sub, Matrix.Translation((0, y, BAR_Z)) @ Matrix.Rotation(math.radians(90 * face), 4, 'X'))
    ob("bosses", bm, [M["frame"]], g)

    # the crossbar with its end caps
    bm = bmesh.new()
    L.tube(bm, [(0, BAR_Y[0] + (BAR_Y[1] - BAR_Y[0]) * i / 20, BAR_Z) for i in range(21)], [BAR_R] * 21, sides=24)
    for y in BAR_Y:
        sub = bmesh.new()
        bmesh.ops.create_cone(sub, cap_ends=True, segments=24, radius1=0.115, radius2=0.105, depth=0.07)
        L.add_mesh(bm, sub, Matrix.Translation((0, y, BAR_Z)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    ob("bar", bm, [M["bar"]], g)

    # the winch wheels on brackets off the feet
    bm = bmesh.new()
    for s in (-1, 1):
        y = s * SIDEY[s]
        rim = bmesh.new()
        bmesh.ops.create_cone(rim, cap_ends=True, segments=28, radius1=WHEEL_R + 0.04, radius2=WHEEL_R + 0.04, depth=0.035)
        for dy in (-0.04, 0.04):
            L.add_mesh(bm, rim.copy(), Matrix.Translation((WHEEL_X[s], y + dy, WHEEL_ZS[s])) @ Matrix.Rotation(math.radians(90), 4, 'X'))
        rim.free()
        hub = bmesh.new()
        bmesh.ops.create_cone(hub, cap_ends=True, segments=20, radius1=WHEEL_R - 0.02, radius2=WHEEL_R - 0.02, depth=0.05)
        L.add_mesh(bm, hub, Matrix.Translation((WHEEL_X[s], y, WHEEL_ZS[s])) @ Matrix.Rotation(math.radians(90), 4, 'X'))
        ax = bmesh.new()
        bmesh.ops.create_cone(ax, cap_ends=True, segments=16, radius1=0.05, radius2=0.05, depth=abs(y) - UPY[s] + 0.12)
        L.add_mesh(bm, ax, Matrix.Translation((WHEEL_X[s], s * (UPY[s] + (abs(y) - UPY[s] + 0.12) / 2), WHEEL_ZS[s]))
                   @ Matrix.Rotation(math.radians(90), 4, 'X'))
        L.rbox(bm, (0.16, 0.07, WHEEL_ZS[s] - 0.09), Matrix.Translation((WHEEL_X[s], y + s * 0.1, 0.12)), bevel=0.02, segs=2)
        W.bolts(bm, [(WHEEL_X[s] + r * math.cos(a), y + s * 0.065, WHEEL_ZS[s] + r * math.sin(a)) for r in (0.1,)
                     for a in [2 * math.pi * k / 6 for k in range(6)]], [(0, s, 0)] * 6, r=0.018)
    ob("wheels", bm, [M["frame"]], g)

    # the upper looks' upgrades
    if TIER >= 2:
        spikes(M, root)
    if TIER == 3:
        bm = bmesh.new()     # forged steel straps across the uprights, riveted
        for s in (-1, 1):
            for z in (0.7, 1.6, BAR_Z - 0.45):
                bx, fx = upright_xs(z, s)
                L.rbox(bm, (fx - bx + 0.04, UP_T + 0.04, 0.09), Matrix.Translation(((bx + fx) / 2, s * UPY[s], z)),
                       bevel=0.015, segs=2)
                W.rivets(bm, [(x, s * (UPY[s] + UP_T / 2 + 0.02), z + 0.045) for x in (bx + 0.06, fx - 0.06)],
                         [(0, s, 0)] * 2, r=0.02)
        ob("straps", bm, [M["forged"]], g)


def spikes(M, root):
    """Look 2: brimstone spikes and rubble round the drum's foot; look 3: bigger forged steel spikes. Clear of the feet."""
    big = 1.0 if TIER == 2 else 1.3
    mat = M["brimstone"] if TIER == 2 else M["forged"]
    if TIER == 2:
        cl = bmesh.new()
        W.clods(cl, [bear(360 * i / 20 + 7 * (i % 3), DRUM_R + 0.02 + 0.1 * ((i * 0.37) % 1.0), 0.03) for i in range(20)
                     if min(abs((360 * i / 20) % 180), 180 - abs((360 * i / 20) % 180)) > 40], r=0.06)
        ob("clods", cl, [M["brimstone"]], root, sharp=60)
    st = bmesh.new()
    uv = st.loops.layers.uv.new("UVMap")
    bs = [b for b in range(10, 360, 20) if min(b % 180, 180 - b % 180) > 45 and not 250 < b < 330]   # clear of the feet, chains, wheel
    for i, b in enumerate(bs):
        lean = (0.18 + 0.1 * ((i * 0.53) % 1.0)) * big
        h = (0.26 + 0.12 * ((i * 0.71) % 1.0)) * big
        W.stake(st, uv, bear(b, DRUM_R - 0.02, 0.0), bear(b + (5 if i % 3 else -5), DRUM_R + lean, h),
                0.08 * big, sides=5 if TIER == 3 else 8, twist=i * 0.7, tip_mat=1)
    ob("spikes", st, [mat, mat], root, sharp=20 if TIER == 3 else 55)


def build_weight(M, root):
    """The weight on its own empty (it rises and falls): plated body, red straps, riveted, a red and white band, the
    domed cap and its ring."""
    w = L.empty("WEIGHT", root)
    seg_body = [(WT_R - 0.02, WT_Z0), (WT_R, WT_Z0 + 0.03), (WT_R, WT_BODY)]
    W.lathe("wt_body", [seg_body], [M["body"]], parent=w, wob=0.006 if not DMG else 0.03, seed=1.0)
    W.lathe("wt_bottom", [[(WT_R - 0.02, WT_Z0), (0.0, WT_Z0)]], [M["rim"]], bev=0, parent=w)
    W.lathe("wt_foot", [L.band(WT_R, WT_R + 0.014, WT_Z0 + 0.02, WT_Z0 + 0.11, 0.008)], [M["rim"]], parent=w)   # Flash: a pale foot hoop
    W.lathe("wt_band", [[(WT_R, WT_BODY), (WT_R + 0.016, WT_BODY + 0.02), (WT_R + 0.017, WT_BODY + 0.05),
                         (WT_R + 0.002, WT_BAND - 0.012), (WT_R - 0.04, WT_BAND)]], [M["check"]], bev=0, parent=w,
            wob=0.004 if not DMG else 0.025, seed=2.0)
    W.lathe("wt_cap", [[(WT_R - 0.04, WT_BAND), (0.27, WT_BAND + 0.06), (0.19, WT_BAND + 0.12),
                        (0.10, WT_BAND + 0.155), (0.0, WT_BAND + 0.165)]], [M["cap"]], parent=w,
            wob=0.008 if not DMG else 0.02, seed=3.0)
    bm = bmesh.new()       # the ring on top, its face toward the bar's ends (the claw comes in from above)
    sub = bmesh.new()
    bmesh.ops.create_circle(sub, segments=20, radius=1.0)
    ring_pts = [Vector((0, 0.062 * math.cos(2 * math.pi * k / 20), LUG_Z + 0.062 * math.sin(2 * math.pi * k / 20)))
                for k in range(21)]
    sub.free()
    L.tube(bm, ring_pts, [0.024] * 21, sides=8, cap=False)
    L.rbox(bm, (0.07, 0.1, 0.05), Matrix.Translation((0, 0, WT_BAND + 0.145)), bevel=0.02, segs=2, taper=0.7)
    ob("wt_ring", bm, [M["frame"]], w)
    # red straps at the body's sides (Flash: red down both silhouette edges) and rivet columns
    bm = bmesh.new()
    for b in (135, 315):
        q = Matrix.Rotation(math.radians(-b), 4, 'Z')
        L.rbox(bm, (0.035, 0.06, WT_BODY - WT_Z0 - 0.04), Matrix.Translation(bear(b, WT_R + 0.002, WT_Z0 + 0.02)) @ q,
               bevel=0.012, segs=2)
    ob("wt_straps", bm, [M["strap"]], w)
    bm = bmesh.new()
    cen, nor = [], []
    for b in (100, 160, 225, 290, 350, 40):
        for k in range(9):
            z = WT_Z0 + 0.1 + (WT_BODY - WT_Z0 - 0.18) * k / 8
            cen.append(bear(b, WT_R + 0.004, z))
            nor.append(bear(b))
    W.rivets(bm, cen, nor, r=0.016)
    ob("wt_rivets", bm, [M["rivet"]], w)
    if TIER == 3:          # forged steel hoops round the weight
        W.lathe("wt_hoops", [L.band(WT_R, WT_R + 0.02, WT_Z0 + 0.05, WT_Z0 + 0.13, 0.012),
                             L.band(WT_R, WT_R + 0.02, WT_BODY - 0.1, WT_BODY - 0.02, 0.012)], [M["forged"]], parent=w)
    return w


def build_hook(M, root):
    """The pulley block and claw on their own empty, pivoting on the claw's stem (they come down spinning, haul and fly
    back up). The claw is a short copper J: its stem drops from the block, its bow (centred on the weight's axis when
    turned to 0) catches the weight's ring, its point curls back up."""
    h = L.empty("HOOK", bpy.data.objects["GANTRY"], loc=(HX, -GY, 0))
    low = BAR_Z - HANG                                # the bow's lowest point (its tube's middle) at rest
    blk = BAR_Z - COIL_R - 0.19                       # the block's middle: it hangs right under the coil (Flash)
    rc = -HX                                          # the bow's radius: its middle sits on the weight's axis
    bm = bmesh.new()
    L.rbox(bm, (0.3, 0.25, 0.24), Matrix.Translation((0, 0, blk)), bevel=0.045, segs=2, taper=0.8)
    sub = bmesh.new()
    bmesh.ops.create_cone(sub, cap_ends=True, segments=16, radius1=0.075, radius2=0.075, depth=0.27)
    L.add_mesh(bm, sub, Matrix.Translation((0, 0, blk + 0.03)) @ Matrix.Rotation(math.radians(90), 4, 'X'))
    ob("block", bm, [M["frame"]], h)
    bm = bmesh.new()
    pts = [Vector((0, 0, blk - 0.1 - (blk - 0.1 - (low + rc)) * k / 6)) for k in range(7)]
    for k in range(1, 13):                            # the bow, half a turn under its middle
        a = math.pi + math.pi * k / 12
        pts.append(Vector((rc + rc * math.cos(a), 0, low + rc + rc * math.sin(a))))
    pts += [Vector((2 * rc + 0.004, 0, low + rc + 0.06)), Vector((2 * rc + 0.0, 0, low + rc + 0.12)),
            Vector((2 * rc - 0.03, 0, low + rc + 0.17))]
    n = len(pts)
    rad = [0.08 * (1 - 0.78 * (i / (n - 1)) ** 1.3) for i in range(n)]
    L.tube(bm, pts, rad, sides=12, flat=0.7)
    ob("claw", bm, [M["claw"]], h)
    return h


def pose(M, root, cell):
    """Sets the strike's cell: the weight's lift, the claw's drop, the chains (rebuilt, so they run with the winch)."""
    lift = LIFT_PX[cell] / PX
    drop_full = (BAR_Z - HANG) - (LUG_Z + 0.062 - 0.024 - 0.022)   # the bow sits in the ring's top
    drop = DOWN[cell] * drop_full - (lift if 14 <= cell <= 28 else 0.0)
    w, h = bpy.data.objects["WEIGHT"], bpy.data.objects["HOOK"]
    w.location.z = lift
    h.location.z = -drop
    h.rotation_euler.z = math.radians(SPIN) * (1.0 - DOWN[cell])   # it spins round as it comes down (Flash)
    for name in ("hook_chain", "coils", "side_chains"):
        old = bpy.data.objects.get(name)
        if old:
            bpy.data.objects.remove(old)
    turn = drop                                        # chain paid out off the bar's middle coil
    bm = bmesh.new()
    top = BAR_Z - COIL_R
    bottom = BAR_Z - COIL_R - 0.19 + 0.12 - drop
    if bottom < top - 0.02:
        chain_on(bm, [(HX, -GY, top), (HX, -GY, bottom)], 0.0, 0)
    g = bpy.data.objects["GANTRY"]
    ob("hook_chain", bm, [M["gold"]], g)
    bm = bmesh.new()
    coil(bm, -GY, 3.0, 0.2, turn, 0)
    for s in (-1, 1):
        coil(bm, s * SIDEY[s], 2.0, 0.09, -turn, 0)
    ob("coils", bm, [M["gold"]], g)
    bm = bmesh.new()
    for s in (-1, 1):
        chain_on(bm, side_loop(s * SIDEY[s], WHEEL_X[s], WHEEL_ZS[s]), turn * 1.6, 0, closed=True, side=Vector((0, 1, 0)))
    ob("side_chains", bm, [M["gold"]], g)
    bpy.context.view_layer.update()


def build_destroyed(M, root):
    """The wreck, loosely after Flash's: the gantry fallen over the drum toward the front-right, the weight on its side,
    chain and rubble strewn about."""
    build_static_base = [o for o in bpy.data.objects]
    gantry = bpy.data.objects["GANTRY"]
    for o in list(bpy.data.objects):
        if o.name in ("uprights", "up_rivets", "bosses", "bar", "straps"):
            o.parent = gantry
    # the gantry buckled and slumped back to the right, crushed to half its height (Flash's wreck stays low)
    gantry.scale = (1.0, 1.0, 0.5)
    gantry.rotation_euler = (math.radians(14), math.radians(-70), math.radians(24))
    gantry.location = (-0.2, 0.1, 0.05)
    w, h = bpy.data.objects["WEIGHT"], bpy.data.objects["HOOK"]
    # the weight toppled onto the drum, lying across the pit with its cap toward the viewer's left (Flash)
    ax = Vector((math.cos(math.radians(12)), math.sin(math.radians(12)), -0.17)).normalized()
    w.rotation_euler = (0, math.radians(80), math.radians(12))
    w.location = Vector((0, 0, DRUM_H + WT_R * 0.45)) - ax * 0.8
    h.parent = gantry
    bm = bmesh.new()
    W.clods(bm, [bear(30 * i + 11, 0.55 + 0.35 * ((i * 0.61) % 1.0), 0.04) for i in range(12)], r=0.07, seed=1.0)
    ob("rubble", bm, [M["frame"]], root, sharp=60)
    bm = bmesh.new()
    for k, (a, b) in enumerate([((0.6, 0.4, 0.05), (0.95, -0.2, 0.05)), ((-0.3, 0.9, 0.05), (0.5, 0.95, 0.12)),
                                ((0.4, -0.6, 0.3), (0.8, -0.9, 0.05))]):
        chain_on(bm, L.bezier(a, (a[0], a[1], 0.4), (b[0], b[1], 0.35), b, 10), 0.0, 0)
    ob("strewn", bm, [M["gold"]], root)
    return build_static_base


def build():
    L.clear_scene()
    M = materials()
    root = L.empty("QUAKE")
    build_static(M, root)
    build_weight(M, root)
    build_hook(M, root)
    if DMG:
        bm = bmesh.new()       # rubble on the foot plate and the drum's rim
        W.clods(bm, [bear(40 * i + 20, 0.62 + 0.12 * ((i * 0.37) % 1.0), DRUM_H if i % 2 else 0.08) for i in range(9)],
                r=0.05, seed=2.0)
        ob("rubble", bm, [M["frame"]], root, sharp=60)
    return M, root


# --------------------------------------------------------------------------------------------------------------- run
CANVAS = (480, 760, 240, 640)          # 4x canvas: w, h, the ground middle's pixel


def main():
    out = HERE / "render" / f"t{TIER}"
    out.mkdir(parents=True, exist_ok=True)
    L.OUT = out
    M, root = build()
    cam = L.setup_render()
    w, h, gx, gy = CANVAS
    info = dict(tier=TIER, elevation=L.EL, px_per_unit_4x=Q.PPU, canvas_4x=[w, h])
    info["ground_4x"] = Q.frame(cam, w, h, gx, gy, (0, 0, 0))
    what = ARGS[1] if len(ARGS) > 1 else "cell"
    prefix = "dmg" if DMG else "cell"
    if what == "save":
        pose(M, root, 0)
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / f"quake-t{TIER}.blend"))
        return
    if what in ("cell", "cells"):
        cells = range(33) if what == "cells" else [int(a) for a in ARGS[2:]] or [0]
        for c in cells:
            pose(M, root, c)
            for name in filter(None, os.environ.get("QUAKE_HIDE", "").split(",")):   # debugging: leave parts out
                if bpy.data.objects.get(name):
                    bpy.data.objects.remove(bpy.data.objects[name])
            L.shot(out / f"{prefix}-{c:02d}.png", L.objs_under(root))
            print("CELL", c, flush=True)
    elif what == "destroyed":
        pose(M, root, 0)
        for name in ("hook_chain", "coils", "side_chains"):
            o = bpy.data.objects.get(name)
            if o:
                bpy.data.objects.remove(o)
        build_destroyed(M, root)
        bpy.context.view_layer.update()
        L.shot(out / "destroyed.png", L.objs_under(root))
    cf = out / "camera.json"
    old = json.loads(cf.read_text()) if cf.exists() else {}
    old.update(info)
    cf.write_text(json.dumps(old, indent=1))
    print("DONE quake", TIER, what, info)


main()
