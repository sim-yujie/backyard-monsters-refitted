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
PIT_R = 0.41
WT_R = 0.375                                        # the weight's radius
WT_Z0 = 0.27                                        # its foot at rest
WT_BODY = 1.25                                      # its plated body's top
WT_BAND = 1.33                                      # its red and white shoulder's top
UP_Y, UP_T = 0.55, 0.12                             # the uprights' middles (+-y) and thickness
BAR_Z = 2.84 + RISE                                 # the crossbar's axis
BAR_R = 0.09
BAR_Y = (-1.17, 1.03)
SIDE_Y = 0.86                                       # the side chains' loops (+-y)
WHEEL_Z, WHEEL_R = 0.43, 0.2                        # the winch wheels' axles and radius
WHEEL_X = {-1: 0.18, 1: 0.0}                        # their axles' x (Flash: the -y one stands further forward)
WHEEL_ZS = {-1: 0.54, 1: WHEEL_Z}                   # and height (the -y one higher)
COIL_R = 0.14                                       # chain wound round the bar: its centre line's radius
HANG = 0.66                                         # the claw's tip at rest, below the bar's axis
LUG_Z = WT_BAND + 0.23                              # the ring on the weight's cap, its middle at rest
SPIN = float(os.environ.get("QUAKE_SPIN", "-35"))     # the claw's turn at rest (its bow to the left, Flash)
LINK = 0.062                                        # chain pitch
HX = -0.10                                          # the claw's stem, behind the ring (it curls through it to +x)
GY = -0.07                                          # the gantry stands this far toward -y of the drum (Flash)

# Flash's strike, per cell: the weight's lift in screen px (1x) and the claw's drop (0-1 of the way to the ring)
LIFT_PX = [0] * 14 + [1, 2, 4, 6, 7, 8, 10, 11, 12, 13, 15, 15, 16, 17, 17, 15, 11, 5, 0]
DOWN = [0, 0.04, 0.12, 0.24, 0.38, 0.52, 0.66, 0.78, 0.88, 0.96, 1.0, 1.0, 1.0, 1.0] + [1.0] * 15 + [0, 0, 0, 0]
PX = 37.5 * math.cos(math.radians(L.EL))           # screen px (1x) per unit of height


# --------------------------------------------------------------------------------------------------------- materials
def materials():
    iron = W.mat_iron
    soot = 0.45 if DMG else 0.0
    M = dict(
        upright=iron("upright", base=(110, 94, 94), dark=(52, 44, 46), rust=(132, 72, 50), edge=(206, 186, 180),
                     rust_k=0.55 + (0.25 if DMG else 0), soot=soot, dents=0.8),
        frame=iron("frame", base=(92, 80, 78), dark=(46, 38, 38), rust=(130, 70, 44), edge=(184, 166, 160), rust_k=0.6,
                   soot=soot),
        bar=iron("bar", base=(110, 96, 94), dark=(54, 44, 44), rust=(130, 70, 44), edge=(210, 196, 190), rust_k=0.45,
                 soot=soot),
        cap=iron("cap", base=(132, 122, 122), dark=(64, 56, 58), rust=(150, 84, 52), edge=(232, 224, 220), rust_k=0.45,
                 dents=1.4, soot=0.35 + soot),
        rim=iron("rim", base=(150, 128, 124), dark=(80, 66, 64), rust=(140, 76, 48), edge=(226, 210, 204), rust_k=0.5,
                 soot=soot),
        band=W.mat_worn_diag("band", (178, 30, 24), (112, 92, 88), n=8, lean=0.0, under=(70, 50, 44),
                             edge=(220, 200, 190), soot=0.4 + soot, dirt=0.6),
        check=W.mat_worn_diag("check", (186, 30, 24), (198, 184, 178), n=6, lean=0.0, under=(120, 84, 74),
                              edge=(214, 120, 108), soot=0.45 + soot, dirt=0.5, dirt_top=0.3, chips=0.6),
        body=iron("body", base=(106, 64, 54), dark=(66, 38, 32), rust=(124, 62, 38), edge=(206, 160, 144), rust_k=0.4,
                  dents=0.7, seams=6, soot=soot),
        strap=iron("strap", base=(170, 40, 30), dark=(96, 22, 18), rust=(120, 60, 34), edge=(220, 150, 130), rust_k=0.4,
                   dents=0.6, soot=soot),
        rubber=L.mat_flat("rubber", (44, 36, 34), spec=0.2),
        pit=L.mat_flat("pit", (14, 10, 9), spec=0.0),
        gold=iron("gold", base=(178, 136, 50), dark=(92, 64, 20), rust=(110, 90, 40), edge=(250, 226, 150), rust_k=0.25,
                  dents=0.3, spec=0.45, spec_col=(1.0, 0.9, 0.6, 1)),
        brass=iron("brass", base=(214, 166, 52), dark=(130, 92, 20), rust=(110, 90, 40), edge=(252, 232, 150),
                   rust_k=0.2, dents=0.4, spec=0.5, spec_col=(1.0, 0.9, 0.6, 1)),
        claw=iron("claw", base=(228, 140, 72), dark=(150, 78, 34), rust=(120, 60, 30), edge=(255, 214, 160), rust_k=0.3,
                  dents=0.4, spec=0.4),
        block=iron("block", base=(150, 140, 140), dark=(80, 72, 74), rust=(130, 76, 50), edge=(228, 220, 216),
                   rust_k=0.4, soot=soot),
        rivet=iron("rivet", base=(70, 54, 48), dark=(36, 28, 24), rust=(120, 64, 36), edge=(170, 150, 136), rust_k=0.5),
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


def upright_xs(z):
    """The upright's back and front edge (x) at height z: narrow at the head, stepping out toward the front below a
    concave fillet, a round head about the bar."""
    z1, z2, hr = 1.55, 2.05, 0.15
    if z > BAR_Z:
        h = max(0.0, hr * hr - (z - BAR_Z) ** 2) ** 0.5
        return -h, h
    if z <= z1:
        front = 0.36
    elif z <= z2:
        s = (z - z1) / (z2 - z1)
        front = 0.15 + 0.21 * (1 - s) ** 2
    else:
        front = 0.15
    return -0.15, front


def upright(bm, yc, jag=0.0, seed=0.0):
    """One upright: the profile lofted up z as a closed section (the two faces and the edges), so its faces are a quad grid."""
    y0, y1 = yc - UP_T / 2, yc + UP_T / 2
    zs = [0.08 + (BAR_Z - 0.08) * i / 44 for i in range(45)]
    zs += [BAR_Z + 0.15 * math.sin(math.radians(a)) for a in (12, 25, 38, 50, 61, 71, 79, 85, 88.5)]
    cols = 6
    rings = []
    for z in zs:
        bx, fx = upright_xs(z)
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


def chain_link(bm, c, d, nrm, mat, ln=0.074, wd=0.05, r=0.0155):
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
                          (0.64, DRUM_H + 0.005), (0.54, DRUM_H)]], [M["rim"]], parent=root)
    W.lathe("rubber", [[(0.55, DRUM_H), (0.55, DRUM_H + 0.035), (0.52, DRUM_H + 0.07), (0.46, DRUM_H + 0.065),
                        (PIT_R + 0.01, DRUM_H + 0.03), (PIT_R, DRUM_H - 0.02)]], [M["rubber"]], bev=0.012, parent=root)
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
        upright(bm, s * UP_Y, jag=0.05 if DMG else 0.0, seed=3.0 * s)
    up = ob("uprights", bm, [M["upright"]], g, sharp=30)
    bm = bmesh.new()
    cen, nor = [], []
    for s in (-1, 1):
        for z in [0.45 + 0.3 * i for i in range(int((BAR_Z - 0.6) / 0.3))]:
            bx, fx = upright_xs(z)
            for x in (bx + 0.05, fx - 0.05):
                cen.append((x, s * (UP_Y + UP_T / 2), z))
                nor.append((0, s, 0))
    W.rivets(bm, cen, nor, r=0.022)
    ob("up_rivets", bm, [M["rivet"]], g)
    bm = bmesh.new()
    for s in (-1, 1):
        for face in (-1, 1):
            y = s * UP_Y + face * (UP_T / 2 + 0.02)
            sub = bmesh.new()
            bmesh.ops.create_cone(sub, cap_ends=True, segments=20, radius1=0.15, radius2=0.13, depth=0.04)
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
        y = s * SIDE_Y
        rim = bmesh.new()
        bmesh.ops.create_cone(rim, cap_ends=True, segments=28, radius1=WHEEL_R + 0.04, radius2=WHEEL_R + 0.04, depth=0.035)
        for dy in (-0.04, 0.04):
            L.add_mesh(bm, rim.copy(), Matrix.Translation((WHEEL_X[s], y + dy, WHEEL_ZS[s])) @ Matrix.Rotation(math.radians(90), 4, 'X'))
        rim.free()
        hub = bmesh.new()
        bmesh.ops.create_cone(hub, cap_ends=True, segments=20, radius1=WHEEL_R - 0.02, radius2=WHEEL_R - 0.02, depth=0.05)
        L.add_mesh(bm, hub, Matrix.Translation((WHEEL_X[s], y, WHEEL_ZS[s])) @ Matrix.Rotation(math.radians(90), 4, 'X'))
        ax = bmesh.new()
        bmesh.ops.create_cone(ax, cap_ends=True, segments=16, radius1=0.05, radius2=0.05, depth=abs(y) - UP_Y + 0.12)
        L.add_mesh(bm, ax, Matrix.Translation((WHEEL_X[s], s * (UP_Y + (abs(y) - UP_Y + 0.12) / 2), WHEEL_ZS[s]))
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
                bx, fx = upright_xs(z)
                L.rbox(bm, (fx - bx + 0.04, UP_T + 0.04, 0.09), Matrix.Translation(((bx + fx) / 2, s * UP_Y, z)),
                       bevel=0.015, segs=2)
                W.rivets(bm, [(x, s * (UP_Y + UP_T / 2 + 0.02), z + 0.045) for x in (bx + 0.06, fx - 0.06)],
                         [(0, s, 0)] * 2, r=0.02)
        ob("straps", bm, [M["forged"]], g)


def spikes(M, root):
    """Look 2: brimstone spikes and rubble round the drum's foot; look 3: bigger forged steel spikes. Clear of the feet."""
    big = 1.0 if TIER == 2 else 1.3
    mat = M["brimstone"] if TIER == 2 else M["forged"]
    if TIER == 2:
        cl = bmesh.new()
        W.clods(cl, [bear(360 * i / 20 + 7 * (i % 3), DRUM_R + 0.02 + 0.1 * ((i * 0.37) % 1.0), 0.03) for i in range(20)
                     if min(abs((360 * i / 20) % 180), 180 - abs((360 * i / 20) % 180)) > 22], r=0.06)
        ob("clods", cl, [M["brimstone"]], root, sharp=60)
    st = bmesh.new()
    uv = st.loops.layers.uv.new("UVMap")
    bs = [b for b in range(10, 360, 20) if min(b % 180, 180 - b % 180) > 28]
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
        coil(bm, s * SIDE_Y, 2.0, 0.14, -turn, 0)
    ob("coils", bm, [M["gold"]], g)
    bm = bmesh.new()
    for s in (-1, 1):
        chain_on(bm, side_loop(s * SIDE_Y, WHEEL_X[s], WHEEL_ZS[s]), turn * 1.6, 0, closed=True, side=Vector((0, 1, 0)))
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
