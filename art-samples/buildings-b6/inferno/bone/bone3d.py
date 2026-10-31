"""bone3d.py : the Inferno Bone Cruncher (Inferno type 1) as a 3D model, on the approved Twig / Putty recipe (../kit.py):
Flash's shapes and colours at full size, matte painted finish, no outline, one body for both looks.

    blender -b --factory-startup -P bone3d.py -- <level> fit [frame]   work/fit-L<level>.png  quick silhouette, 4 px/px
    blender -b --factory-startup -P bone3d.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P bone3d.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P bone3d.py -- <level> check    CHECK / CLEAR lines (parts that overlap)
    blender -b --factory-startup -P bone3d.py -- <level> gap      GAP lines (parts that look as if they touch)

Flash has two looks: level 1 (levels 1-2) and level 3 (levels 3-10). The body at both: the verdigris iron crusher bowl
with its thick rolled lip on its foot, two crusher rollers filling it to the rim, the ribbed bone horn on the bowl's
left, the orange metal drum lying at the front left with its far end in a bolted collar on the base, the shield on the
bowl's front right and the steel plate on the ground under it. A second, orange sun lights only the copper, rust and
wood (light linking), with an orange glow from below on the boards and copper: Flash's warm Inferno highlights.
Level 1: a rust band under the lip; two bone posts on the rim carry a bar with the tipping bucket heaped with bones and
a black spade paddle beside it; a cog roller of pointed bone sprocket discs in front of a pale perforated drum; on the
shield a belt round two pulleys at its top corners runs down past its point to the cog on the plate. Level 3 (Flash redraws the crusher here): a band round the bowl, rows of tall grey spikes on dark rollers filling
the bowl to the rim, a steel column whose low arm carries the hopper, a big pale cog, and a bigger hood leaning
back against the bowl. The hopper: a long rust bin tipped steeply toward the bowl under a thick rust cover with lit
edges, a wall hanging straight down from the cover's near edge, and Flash's plank tray hung from that wall's foot and
running steeply down over the rollers; its axle is at the tray's lower right, in the arm's bearing.

Animation, as Flash (47 frames at level 1, 50 at level 3): level 1, the bucket turns once round the bar, tipping its
bones onto the rollers; level 3, the hopper swings back about its axle to fill, then tips forward and its bones slide off the tray's foot.
At both the rollers turn against each other and the cog turns (level 1: the belt runs and its pulleys turn); the falling bones and the dust are the moving
layer. Nothing else moves.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402
from kit import Vector, Euler, box, cyl, lathe, tube, ring, sweep, gear, blob, painted, flat, link, srgb  # noqa: E402

L = kit.L
kit.OUT = HERE
kit.ORIGIN = (-2.0, 31.5) if L < 3 else (2.0, 38.0)   # Flash pixel of the bowl axis on the ground: Flash draws level 3 4 px right, 6.5 lower
kit.FRAME = (-56, -48, 56, 68)
kit.FRAMES = 47 if L < 3 else 50
kit.SUN, kit.SUN_COL = 5.2, (1.0, 0.9, 0.78)      # Flash's Inferno light: warm, a darker fill
kit.SKY, kit.SKY_E = (0.7, 0.6, 0.55), 0.32
FR = kit.FRAMES
rng = kit.rng

# ------------------------------------------------------------------------------------------------ the body's sizes
FOOT = [(3.0, 0.0), (3.03, 0.05), (3.0, 0.24)]                                # Flash's dark pedestal on the ground,
PALE = [(3.0, 0.24), (2.92, 0.3), (2.66, 0.56), (2.6, 0.62)]                  # its sloped top lit pale,
BOWL = [(2.6, 0.62), (2.55, 0.8), (2.62, 0.92), (2.86, 1.02), (3.08, 1.2), (3.22, 1.45), (3.28, 1.8), (3.27, 2.2),
        (3.24, 2.7), (3.2, 3.25)]     # a dark waist, then the round belly bulging below the rim: a squat cauldron
RIM_R, RIM_Z = 3.24, 3.42             # the rolled lip; the belly bulges below it, a squat cauldron as Flash
IN_R, FLOOR_Z = 3.0, 1.55             # inside wall and floor
ROLL_Y, ROLL_Z = (-1.0, 0.55), (3.45 if L < 3 else 2.72)    # Flash's two rollers (front, back); L3's lower: spikes in
ROLL_R = (0.42, 0.5) if L < 3 else (0.32, 0.36)   # their cores (level 3: thin, so its long spikes clear the other)
SPIKE_BACK = (0.3, 0.38, 0.55, 0.72, 0.62)  # level 3: the back roller's spike lengths, row by row (the tray)
ROLL_X = 2.2                          # the rollers' toothed length ends here; bare axles run on to the wall
BACK_X0 = -1.4                        # level 1: the perforated drum's left end
FRONT_X = (-2.05, 1.62)               # level 1: Flash's front roller block is shorter, its right end well in
POST_X, BAR_Z = (-3.2, 2.75), 6.05     # level 1: the posts on the rim (Y 0) and the bar along X
HORN = (-2.66, -2.5)                 # the horn's axis (X, Y), on the bowl's left
DRUM = (-0.04, -3.8, 0.75, 2.7)      # the drum: middle X, Y, radius, length (axis DRUM_U)
DRUM_U = (0.985, 0.17)              # Flash: lying along the bowl's front left, its long side to us, the near end lower right
PLATE = (3.5, 0.3)                  # the steel plate's middle on the ground
COLUMN = (3.05, 2.1)                   # level 3: the steel column
SH3_TH = -9.0                         # level 3: where the hood stands round the bowl (deg)


def mats():
    """Flash's Inferno finish: dark, grimy and worn, strong wear on the edges; verdigris iron, rust, copper, old bone."""
    m = {}
    m["iron"] = painted("iron", (15, 38, 33), rough=0.66, metal=0.25, wear=(40, 80, 70), rust=(54, 32, 20),
                        scale=4.0, dirt=0.8, spec=0.26, soot=0.9, rust_at=0.46, grain=0.5, streak=0.5)
    m["ironrust"] = painted("ironrust", (64, 30, 18), rough=0.7, metal=0.2, wear=(116, 60, 34), rust=(22, 32, 28),
                            scale=4.0, dirt=0.65, spec=0.24, soot=0.8, rust_at=0.6, grain=0.5, streak=0.5)  # L1: under the lip
    m["band"] = painted("band", (26, 68, 60), rough=0.58, metal=0.3, wear=(64, 128, 112), rust=(52, 32, 20), scale=16,
                        dirt=0.45, spec=0.32, soot=0.55, rust_at=0.6, grain=0.35)
    m["lip"] = painted("lip", (80, 138, 120), rough=0.5, metal=0.3, wear=(170, 204, 188), rust=(60, 40, 26), scale=6,
                       dirt=0.4, spec=0.34, soot=0.5, rust_at=0.62, grain=0.3)
    m["inside"] = painted("inside", (10, 26, 24), rough=0.85, wear=(22, 50, 45), scale=3, dirt=0.6, spec=0.1,
                          soot=0.7)                    # Flash: a dark teal, near black low down
    m["rust"] = painted("rust", (124, 48, 16), rough=0.62, metal=0.15, wear=(210, 108, 44), rust=(52, 22, 10),
                        scale=6.0, dirt=0.4, spec=0.32, soot=0.6, rust_at=0.52, grain=0.4)
    m["copper"] = painted("copper", (184, 78, 24), rough=0.55, metal=0.2, wear=(240, 146, 68), rust=(84, 32, 12),
                          scale=5.0, dirt=0.4, spec=0.4, soot=0.45, rust_at=0.58, grain=0.3)
    m["bone"] = painted("bone", (168, 150, 116), rough=0.78, wear=(216, 200, 166), rust=(96, 74, 46), scale=6,
                        dirt=0.6, spec=0.22, soot=0.65, rust_at=0.55, grain=0.4)
    m["hornbone"] = painted("hornbone", (136, 134, 128), rough=0.6, wear=(214, 212, 204), rust=(112, 74, 44),
                            scale=14, dirt=0.35, spec=0.35, soot=0.5, rust_at=0.62, grain=0.3)
    m["groove"] = painted("groove", (86, 48, 24), rough=0.85, wear=(122, 72, 38), scale=10, dirt=0.3, spec=0.15)
    m["bonegap"] = painted("bonegap", (40, 32, 24), rough=0.85, wear=(70, 58, 42), scale=6, dirt=0.3, spec=0.15)
    m["bonedark"] = painted("bonedark", (84, 70, 52), rough=0.8, wear=(128, 110, 82), scale=5, dirt=0.3, spec=0.2)
    m["spike"] = painted("spike", (108, 102, 94), rough=0.55, metal=0.3, wear=(172, 160, 138), rust=(62, 44, 30),
                         scale=8, dirt=0.55, spec=0.38, soot=0.6, rust_at=0.62, grain=0.4)  # L3: Flash's dark grey steel
    m["toothbone"] = painted("toothbone", (150, 144, 128), rough=0.8, wear=(200, 194, 176), rust=(74, 58, 40), scale=7,
                             dirt=0.75, spec=0.2, soot=0.8, rust_at=0.5, grain=0.55)   # L1: grimy grey bone teeth
    m["drumbone"] = painted("drumbone", (150, 138, 112), rough=0.8, wear=(200, 188, 156), rust=(80, 62, 42), scale=5,
                            dirt=0.7, spec=0.2, soot=0.75, rust_at=0.52, grain=0.5)    # L1: the perforated drum
    m["comb"] = painted("comb", (70, 70, 68), rough=0.55, metal=0.4, wear=(132, 128, 118), rust=(60, 42, 28), scale=8,
                        dirt=0.5, spec=0.35, soot=0.6, rust_at=0.6, grain=0.35)       # L1: the dark spikes between
    m["core"] = painted("core", (14, 14, 13), rough=0.9, metal=0.1, wear=(34, 32, 30), scale=6, dirt=0.3, spec=0.12)
    m["roller"] = painted("roller", (124, 118, 104), rough=0.72, metal=0.15, wear=(196, 186, 160), rust=(84, 60, 40),
                          scale=9, dirt=0.6, spec=0.25, soot=0.6, rust_at=0.55, grain=0.55)  # L1: the rough grey slab
    m["drum"] = painted("drum", (166, 72, 26), rough=0.85, wear=(208, 116, 52), rust=(72, 26, 10), scale=3.0,
                        dirt=0.6, spec=0.15, soot=0.6, rust_at=0.55, grain=0.6, streak=0.12)  # Flash's matte leather
    m["drumband"] = painted("drumband", (34, 18, 10), rough=0.85, wear=(70, 36, 18), scale=8, dirt=0.4, spec=0.12)
    # drum (grain along its length), dark bands round it
    m["hoprust"] = painted("hoprust", (122, 48, 16), rough=0.66, metal=0.15, wear=(204, 104, 42), rust=(38, 15, 8),
                           scale=2.5, dirt=0.65, spec=0.28, soot=0.85, rust_at=0.45, grain=0.6, streak=1.0)  # grimy
    m["hopside"] = painted("hopside", (52, 20, 9), rough=0.75, metal=0.15, wear=(96, 44, 18), rust=(26, 12, 7),
                           scale=2.5, dirt=0.8, spec=0.2, soot=0.8, rust_at=0.45, grain=0.6, streak=1.0)  # in shade
    m["darkrust"] = painted("darkrust", (40, 16, 9), rough=0.7, metal=0.25, wear=(88, 44, 24), scale=5, dirt=0.5,
                            spec=0.3, soot=0.5, grain=0.4)   # L3: the dark arm
    m["spiketip"] = painted("spiketip", (196, 186, 166), rough=0.5, metal=0.3, wear=(230, 224, 208), scale=8,
                            dirt=0.2, spec=0.4)
    m["boxrust"] = painted("boxrust", (84, 32, 16), rough=0.68, metal=0.2, wear=(150, 70, 34), rust=(36, 14, 8),
                           scale=4.0, dirt=0.6, spec=0.28, soot=0.7, rust_at=0.5, grain=0.5, streak=0.8)  # L1 bucket
    m["beltmark"] = painted("beltmark", (128, 110, 84), rough=0.8, wear=(170, 150, 116), scale=8, dirt=0.3)
    m["burnt"] = painted("burnt", (118, 50, 20), rough=0.62, metal=0.2, wear=(206, 112, 58), rust=(40, 16, 8),
                         scale=4.0, dirt=0.6, spec=0.3, soot=0.8, rust_at=0.5, grain=0.5, streak=0.8)  # L3 frame
    m["belt"] = painted("belt", (184, 170, 138), rough=0.7, metal=0.1, wear=(226, 214, 184), rust=(70, 52, 36),
                        scale=10, dirt=0.4, spec=0.25, soot=0.4, rust_at=0.6, grain=0.4)   # L1: Flash's pale belt
    m["planks"] = kit.wood("planks", (140, 60, 20), (64, 26, 9), axis="X", rings=4, dirt=0.75)    # orange boards
    m["pale"] = painted("pale", (150, 152, 144), rough=0.5, metal=0.4, wear=(206, 206, 196), rust=(80, 60, 44),
                        scale=6, dirt=0.3, spec=0.4, rust_at=0.66)
    m["paleband"] = painted("paleband", (84, 96, 90), rough=0.55, metal=0.35, wear=(158, 170, 160), rust=(62, 44, 30),
                            scale=7, dirt=0.5, spec=0.3, soot=0.5, rust_at=0.6, grain=0.35)    # the foot's pale band
    m["steel"] = painted("steel", (78, 80, 82), rough=0.48, metal=0.5, wear=(164, 164, 158), rust=(62, 42, 30),
                         scale=6, dirt=0.4, spec=0.4, soot=0.55, rust_at=0.6, grain=0.25)
    m["cogsteel"] = painted("cogsteel", (108, 110, 108), rough=0.5, metal=0.5, wear=(180, 180, 172), rust=(76, 58, 42),
                            scale=7, dirt=0.5, spec=0.35, soot=0.5, rust_at=0.62, grain=0.3)   # L3: Flash's grey cog
    m["plate"] = painted("plate", (36, 46, 44), rough=0.6, metal=0.3, wear=(120, 132, 124), rust=(58, 40, 28),
                         scale=5, dirt=0.0, spec=0.3, top=(64, 76, 72), grain=0.3)
    m["dark"] = flat("dark", (12, 10, 9), rough=0.9)
    m["hole"] = flat("hole", (5, 4, 4), rough=1.0)
    m["coredark"] = flat("coredark", (16, 15, 13), rough=1.0)        # L3: the cores, lost in the bowl's shadow
    next(n for n in m["coredark"].node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Specular IOR Level"].default_value = 0
    next(n for n in m["hole"].node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Specular IOR Level"].default_value = 0
    m["dust"] = flat("dust", (186, 168, 140), rough=1.0)
    next(n for n in m["dust"].node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Alpha"].default_value = 0.6
    return m


M = mats()


def cog_ring(name, r, root, teeth, depth, mat, parent=None, r_in=0.0, tip=0.25, at=(0, 0, 0), rot=(0, 0, 0),
             bevel=0.015, phase=0.0):
    """A toothed wheel in its local XY (axis local Z): pointed teeth from `root` out to `r` (tip = the flat tip's share
    of a tooth's pitch), an open middle of radius r_in (0: solid). Flash's cogs, sprockets and the crusher discs."""
    import bmesh
    bm = bmesh.new()
    pts = []
    for i in range(teeth):
        a = 2 * math.pi * (i + phase) / teeth
        p = 2 * math.pi / teeth
        for da, rr in ((-0.5, root), (-0.5 * tip, r), (0.5 * tip, r)):
            pts.append((rr * math.cos(a + da * p), rr * math.sin(a + da * p)))
    n = len(pts)
    lo = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    hi = [bm.verts.new((x, y, depth / 2)) for x, y in pts]
    for j in range(n):
        bm.faces.new((lo[j], lo[(j + 1) % n], hi[(j + 1) % n], hi[j]))
    if r_in > 0:
        ilo = [bm.verts.new((r_in * math.cos(math.atan2(y, x)), r_in * math.sin(math.atan2(y, x)), -depth / 2))
               for x, y in pts]
        ihi = [bm.verts.new((v.co.x, v.co.y, depth / 2)) for v in ilo]
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((hi[j], hi[k], ihi[k], ihi[j]))
            bm.faces.new((lo[k], lo[j], ilo[j], ilo[k]))
            bm.faces.new((ilo[k], ilo[j], ihi[j], ihi[k]))
    else:
        bm.faces.new(hi)
        bm.faces.new(lo[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat], smooth=False, bevel=bevel, segs=2, parent=parent)
    ob.location = at
    ob.rotation_euler = rot
    return ob


def prism(name, pts, eu, ev, en, depth, mat, origin, parent=None, bevel=0.03):
    """A flat plate: the 2D outline pts (u, v) in the plane eu, ev at origin, `depth` thick along en."""
    import bmesh
    bm = bmesh.new()
    o, eu, ev, en = (Vector(v) for v in (origin, eu, ev, en))
    lo = [bm.verts.new(o + eu * u + ev * v) for u, v in pts]
    hi = [bm.verts.new(o + eu * u + ev * v + en * depth) for u, v in pts]
    n = len(pts)
    bm.faces.new(hi)
    bm.faces.new(lo[::-1])
    for j in range(n):
        bm.faces.new((lo[j], lo[(j + 1) % n], hi[(j + 1) % n], hi[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat], smooth=False, bevel=bevel, segs=2, parent=parent)


def belt_path(circles, n=240):
    """The loop a belt makes round pulleys: the convex hull of the circles (centre (u, v), radius) in their plane,
    resampled evenly; returns [(u, v)] and the loop's length."""
    pts = []
    for (cu, cv), r in circles:
        pts += [(cu + r * math.cos(2 * math.pi * k / 180), cv + r * math.sin(2 * math.pi * k / 180)) for k in range(180)]
    pts = sorted(set(pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    seg = [math.dist(hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull))]
    total = sum(seg)
    out, acc, i = [], 0.0, 0
    for k in range(n):
        s = total * k / n
        while acc + seg[i] < s:
            acc += seg[i]
            i += 1
        t = (s - acc) / seg[i]
        a, b = hull[i], hull[(i + 1) % len(hull)]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, total


def belt_band(name, loop, to3, axis, w, h, mat, parent=None):
    """A closed band (w across along `axis`, h thick) through the 3D points of the loop."""
    import bmesh
    bm = bmesh.new()
    P = [to3(*p) for p in loop]
    axis = Vector(axis).normalized()
    n = len(P)
    rows = []
    for i, p in enumerate(P):
        t = (P[(i + 1) % n] - P[i - 1]).normalized()
        nrm = t.cross(axis).normalized()
        a, b = axis * (w / 2), nrm * (h / 2)
        rows.append([bm.verts.new(p + a + b), bm.verts.new(p - a + b), bm.verts.new(p - a - b), bm.verts.new(p + a - b)])
    for i in range(n):
        r0, r1 = rows[i], rows[(i + 1) % n]
        for j in range(4):
            bm.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat], smooth=True, bevel=0.0, parent=parent)


def at_r(prof, z):
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return prof[-1][0]


def wall_r(z):
    return at_r(FOOT + PALE[1:] + BOWL[1:], z)


# ------------------------------------------------------------------------------------------------ the bowl
def bowl():
    lathe("bowlfoot", [(0.0, 0.0)] + FOOT + [(0.0, 0.24)], (0, 0, 0), M["steel"], verts=64)   # the pedestal
    lathe("bowlpale", [(0.0, 0.24)] + PALE + [(0.0, 0.62)], (0, 0, 0), M["paleband"], verts=64)    # its pale top
    lo = [p for p in BOWL if p[1] <= 2.55]
    hi = [p for p in BOWL if p[1] >= 2.55]
    lathe("bowl", lo + [(at_r(BOWL, 2.55), 2.55)], (0, 0, 0), M["iron"], verts=72)
    prof = [(at_r(BOWL, 2.55), 2.55)] + hi + [(RIM_R - 0.06, 3.3), (RIM_R, RIM_Z - 0.06), (RIM_R - 0.08, RIM_Z + 0.02),
                                              (IN_R + 0.04, RIM_Z), (IN_R, 3.2)]
    lathe("bowltop", prof, (0, 0, 0), M["ironrust"] if L < 3 else M["iron"], verts=72)   # L1: stained under the lip
    lathe("bowlin", [(IN_R, 3.22), (IN_R - 0.08, 2.4), (IN_R - 0.4, 1.8), (2.0, FLOOR_Z), (0.0, FLOOR_Z)],
          (0, 0, 0), M["inside"], verts=72)
    ring("bowllip", RIM_R - 0.05, 0.11, M["lip"], z=RIM_Z - 0.02, n=72)    # Flash's rolled lip, a thin bright line
    for i in range(28):                        # a row of rivets under the lip, and a seam band lower down
        a = 2 * math.pi * (i + 0.5) / 28
        rr = at_r(BOWL, 3.05) + 0.01
        kit.blob(f"bowllipriv{i}", (rr * math.cos(a), rr * math.sin(a), 3.05), 0.055, 0.7, M["steel"])
    if L < 3:
        lathe("bowlseam", [(at_r(BOWL, 1.62), 1.56), (at_r(BOWL, 1.62) + 0.06, 1.6), (at_r(BOWL, 1.74) + 0.06, 1.76),
                           (at_r(BOWL, 1.8), 1.8)], (0, 0, 0), M["band"], verts=72)
    if L >= 3:                                 # level 3: a riveted band round the bowl's belly
        lathe("bowlband", [(3.24, 2.1), (3.44, 2.18), (3.5, 2.45), (3.44, 2.72), (3.2, 2.8)], (0, 0, 0), M["band"],
              verts=72)
        for i in range(18):
            a = 2 * math.pi * (i + 0.5) / 18
            kit.blob(f"bowlrivet{i}", (3.47 * math.cos(a), 3.47 * math.sin(a), 2.45), 0.07, 0.9, M["iron"])


# ------------------------------------------------------------------------------------------------ the rollers
def rollers():
    """Flash's two rollers along X, their bare axles into the inside wall; they turn against each other (moving
    layer). Level 1: the front one a cog roller, a row of pale bone sprocket discs with pointed teeth on a dark core,
    the back one a pale perforated drum, rows of dark round holes in raised collars, iron bands at its ends. Level 3
    (Flash redraws them): dark cores filling the bowl to the rim, packed rows of tall sharp grey steel spikes."""
    for i, y in enumerate(ROLL_Y):
        r = ROLL_R[i]
        half = math.sqrt(IN_R ** 2 - y ** 2) - 0.08
        e = kit.bpy.data.objects.new(f"roll{i}", None)
        link(e)
        e.location = (0, y, ROLL_Z)
        e.rotation_euler = (0, math.radians(90), 0)          # local Z along world X
        hub = kit.bpy.data.objects.new(f"roll{i}-spin", None)
        link(hub, e)
        kit.MOVING.append(hub)
        cyl(f"roll{i}axle", 0.12, 2 * half, (0, 0, -half), M["steel"], parent=hub, verts=12)
        for s_ in (-1, 1):                                    # a bolted collar where the axle leaves the roller
            x_ = (FRONT_X[1] + 0.12 if s_ > 0 else FRONT_X[0] - 0.12) if (L < 3 and i == 0) else s_ * (ROLL_X + 0.15)
            if L < 3 and i == 1 and s_ < 0:
                x_ = BACK_X0 - 0.15
            cyl(f"roll{i}collar{s_}", 0.22, 0.14, (0, 0, x_ - 0.07), M["steel"], parent=hub, verts=12, bevel=0.02)
        if L >= 3:                  # Flash: tall sharp grey spikes packed in rows, the rows of the two rollers between
            cyl(f"roll{i}core", r, 2 * ROLL_X + 0.2, (0, 0, -ROLL_X - 0.1), M["coredark"], parent=hub, verts=28)
            for k in range(5):                  # Flash: packed rows, the rollers barely showing between the spikes;
                z = -1.85 + 0.425 * i + k * 0.85  # the two rollers' rows interleave, so the spikes always clear
                if abs(z) > ROLL_X - 0.2:
                    continue
                for j in range(4):
                    a = 2 * math.pi * (j + 0.5 * (k % 2) + 0.25 * i) / 4
                    d = Vector((math.cos(a), math.sin(a), 0))
                    q = d.to_track_quat("Z", "Y").to_euler()
                    h_ = 0.8 if i == 0 else SPIKE_BACK[k]   # (back: shorter where the
                    # hopper's tray swings down close over it)
                    sp = cyl(f"roll{i}spike{k}-{j}", 0.25, h_, (d.x * (r - 0.06), d.y * (r - 0.06), z), M["spike"],
                             r2=0.01, verts=12, parent=hub, bevel=0.0)
                    sp.rotation_euler = q
                    ft = cyl(f"roll{i}spikefoot{k}-{j}", 0.28, 0.08, (d.x * (r - 0.05), d.y * (r - 0.05), z),
                             M["core"], verts=12, parent=hub, bevel=0.015)
                    ft.rotation_euler = q
            continue
        if i == 0:                  # front: Flash's cog roller, bone sprocket discs with pointed teeth on a dark core
            ln = FRONT_X[1] - FRONT_X[0]
            cyl(f"roll{i}core", 0.36, ln, (0, 0, FRONT_X[0]), M["core"], parent=hub, verts=16)
            n = 14
            pitch = ln / n
            for k in range(n):
                z = FRONT_X[0] + pitch * (k + 0.5)
                cog_ring(f"roll{i}disc{k}", 0.68, 0.5, 11, pitch * 0.62, M["toothbone"], parent=hub, r_in=0.3,
                         tip=0.42, at=(0, 0, z), bevel=0.02, phase=0.5 * (k % 2))   # Flash: rows of small grimy bone
                cyl(f"roll{i}spacer{k}", 0.46, pitch * 0.42, (0, 0, z + pitch * 0.29), M["bonegap"], parent=hub,
                    verts=20, bevel=0.0)                # teeth, staggered, dark gaps between them
            continue
        # back: Flash's perforated drum, pale, rows of dark round holes, iron bands at the ends
        rb, x0 = 0.62, BACK_X0      # (Flash: it starts right of the front one; the paddle stands at its left end)
        cyl(f"roll{i}core", rb, ROLL_X - x0, (0, 0, x0), M["drumbone"], parent=hub, verts=36, bevel=0.03)
        for s_, z_ in ((-1, x0), (1, ROLL_X - 0.16)):
            cyl(f"roll{i}end{s_}", rb + 0.04, 0.16, (0, 0, z_), M["steel"], parent=hub, verts=36, bevel=0.02)
        for j in range(10):
            a = 2 * math.pi * j / 10
            for k in range(6):
                z = x0 + 0.5 + k * 0.56 + (0.28 if j % 2 else 0.0)
                if z > ROLL_X - 0.35:
                    continue
                aa = a + rng.uniform(-0.03, 0.03)
                d = Vector((math.cos(aa), math.sin(aa), 0))
                q = d.to_track_quat("Z", "Y").to_euler()
                h = cyl(f"roll{i}hole{j}-{k}", 0.12, 0.03, (d.x * (rb - 0.005), d.y * (rb - 0.005), z), M["hole"],
                        verts=12, parent=hub, bevel=0.0)
                h.rotation_euler = q
                c_ = kit.blob(f"roll{i}lip{j}-{k}", (d.x * (rb - 0.03), d.y * (rb - 0.03), z), 0.165, 0.3,
                              M["bonedark"], parent=hub)
                c_.rotation_euler = q


    if L < 3:                   # Flash's dark grey spikes between the rollers: a fixed comb along the gap
        box("comb", (4.5, 0.14, 0.1), (0.35, -0.2, 3.73), M["comb"], bevel=0.02)
        for k in range(12):
            x_ = -1.55 + k * 0.27
            sp = cyl(f"combspike{k}", 0.075, 0.4, (x_, -0.2, 3.8), M["comb"], r2=0.008, verts=10, bevel=0.0)
            sp.rotation_euler = (math.radians(-22), math.radians(-10), 0)


# ------------------------------------------------------------------------------------------------ the horn
def horn():
    """The ribbed bone horn on the bowl's left: a cup of stacked rings, wide at the top, on a bracket from the wall."""
    x, y = HORN
    z0, z1 = (3.55, 5.7) if L < 3 else (2.95, 6.15)
    prof = [(0.0, z0 - 0.15), (0.4, z0 - 0.15)]
    n = 8
    first = 0
    if L >= 3:                                  # level 3: a short cup of the top rings, low on a bracket off the rim
        first = 4
        zc = z0 + (z1 - z0) * first / n
        prof = [(0.0, zc - 0.2), (0.5, zc - 0.2)]
    for i in range(first, n):                          # stacked rings, each a fat band with a groove under the next
        f0, f1 = i / n, (i + 1) / n
        za, zb = z0 + (z1 - z0) * f0, z0 + (z1 - z0) * f1
        r = 0.42 + 0.44 * f1 ** 1.6 if L >= 3 else 0.52 + 0.42 * f1 ** 0.5
        prof += [(r - 0.09, za + 0.02), (r - 0.01, za + 0.08), (r, (za + zb) / 2), (r - 0.02, zb - 0.06),
                 (r - 0.1, zb - 0.01)]
        if i < n - 1:                           # Flash's warm brown in the groove under each rib
            ring(f"horngroove{i}", r - 0.095, 0.045, M["groove"], z=zb).location = (x, y, 0)
    dz = 0.9 if L < 3 else 0.4                  # the inner wall stays inside the (tapered) rings
    prof += [(0.86, z1 + 0.02), (0.88, z1 + 0.1), (0.8, z1 + 0.14), (0.7, z1 + 0.06), (0.6, z1 - dz),
             (0.0, z1 - dz - 0.1)]
    lathe("horn", prof, (x, y, 0), M["hornbone"], verts=40)
    lathe("hornhole", [(0.0, z1 - dz + 0.1), (0.55, z1 - dz + 0.1), (0.64, z1 + 0.03)], (x, y, 0.0), M["hole"],
          verts=32)
    ring("hornlip", 0.84, 0.05, M["bone"], z=z1 + 0.1).location = (x, y, 0)    # Flash's pale worn lip
    a = math.atan2(y, x)
    if L >= 3:                                  # the bracket: a rust knee from the lip up under the cup, and a collar
        u = Vector((math.cos(a), math.sin(a), 0))
        lip = Vector((0, 0, RIM_Z - 0.05)) + u * (RIM_R - 0.12)
        knee = Vector((x, y, RIM_Z + 0.25)) - u * 0.25
        sweep("hornbracket", [lip, knee, Vector((x, y, zc - 0.25))], (-u.y, u.x, 0), 0.46, 0.2, M["rust"],
              bevel=0.03)
        cyl("horncollar", 0.42, 0.16, (x, y, zc - 0.32), M["rust"], verts=24, bevel=0.03)
        kit.blob("hornbolt", lip + Vector((0, 0, 0.1)), 0.08, 0.7, M["bone"])
        return
    for z in (3.75, 4.6):                       # two straps from the bowl's wall
        rw = wall_r(z) if z < 3.25 else RIM_R
        p0 = Vector((rw * math.cos(a), rw * math.sin(a), z))
        p1 = Vector((x, y, z)) - Vector((math.cos(a), math.sin(a), 0)) * 0.42
        sweep(f"hornstrap{z:.0f}", [p0 - Vector((math.cos(a), math.sin(a), 0)) * 0.1, p1], (0, 0, 1), 0.3, 0.1,
              M["rust"], bevel=0.03)


# ------------------------------------------------------------------------------------------------ the drum
def drum():
    """Flash's worn copper drum: a plain long cylinder lying on the ground along the bowl's front left, tucked in under
    the belly, its long side to us: bright orange on top, dark red below, sooty, a dark seam band round its middle and
    its near end (lower right) in shade."""
    x, y, r, ln = DRUM
    u = Vector(DRUM_U + (0,)).normalized()
    c = Vector((x, y, r))
    rot = tuple(math.degrees(a) for a in u.to_track_quat("Z", "Y").to_euler())
    e = cyl("drum", r, ln, c - u * (ln / 2), M["drum"], rot=rot, verts=48, bevel=0.1)
    for k, (f_, w_) in enumerate(((0.36, 0.16), (0.42, 0.05), (0.7, 0.12), (0.88, 0.05))):    # Flash's dark bands
        cyl(f"drumband{k}", r + 0.014, w_, c - u * (ln / 2) + u * (ln * f_), M["drumband"], rot=rot, verts=48)
    up = Vector((0, 0, 1))
    fr = u.cross(up).normalized()               # toward us
    for k, (f0, f1, th) in enumerate(((0.14, 0.36, 38), (0.42, 0.58, 46))):     # and the split along it, broken by
        pts = []                                # the band, as Flash
        for j in range(5):
            f_ = f0 + (f1 - f0) * j / 4
            t_ = math.radians(th + (1.5 if j % 2 else -1.0))
            pts.append(c - u * (ln / 2) + u * (ln * f_) + (up * math.cos(t_) + fr * math.sin(t_)) * (r + 0.005))
        tube(f"drumsplit{k}", pts, 0.028, M["drumband"], verts=6)
    for s_ in (-1, 1):                          # rolled rims at both ends, the near cap a dark rust boss
        cyl(f"drumrim{s_}", r + 0.02, 0.1, c + u * (s_ * ln / 2 - (0.12 if s_ > 0 else -0.02)), M["rust"], rot=rot,
            verts=48, bevel=0.03)
    cyl("drumcap", r - 0.2, 0.05, c + u * (ln / 2 - 0.01), M["rust"], rot=rot, verts=40, r2=r - 0.3)
    for k in range(2):                          # two chocks behind it keep it from rolling
        p = c + u * (ln * (0.3 if k else -0.3)) - Vector((0, 0, r))
        box(f"drumchock{k}", (0.3, 0.5, 0.2), (p.x, p.y + r * 0.62, 0.0), M["rust"],
            rot=(0, 0, math.degrees(math.atan2(u.y, u.x))), bevel=0.03)
    return e


def panel_glow(centre):
    """Level 3: the hood's dark panel with Flash's faint orange glow from inside, brightest round the small gear."""
    m = kit.bpy.data.materials.new("panelglow")
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = srgb(14, 13, 12)
    b.inputs["Roughness"].default_value = 0.9
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sub = nt.nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = tuple(centre)
    nt.links.new(tc.outputs["Object"], sub.inputs[0])
    ln = nt.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    nt.links.new(sub.outputs[0], ln.inputs[0])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    mx = nt.nodes.new("ShaderNodeMath")
    mx.operation = "MULTIPLY_ADD"               # the distance, wobbled by the noise: a smudgy glow, not a disc
    nt.links.new(nz.outputs["Fac"], mx.inputs[0])
    mx.inputs[1].default_value = 0.6
    nt.links.new(ln.outputs["Value"], mx.inputs[2])
    rp = nt.nodes.new("ShaderNodeValToRGB")
    el = rp.color_ramp.elements
    el[0].position, el[0].color = 0.4, srgb(128, 50, 12)
    el[1].position, el[1].color = 1.0, (0, 0, 0, 1)
    nt.links.new(mx.outputs[0], rp.inputs["Fac"])
    nt.links.new(rp.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.0
    return m


# ------------------------------------------------------------------------------------------------ shield, plate, cog
def shield():
    """The rust shield on the bowl's front right, standing off the wall on brackets. Level 1: Flash's pointed shield,
    thick, leaning out, a pale triangle of lines down to its point; a steel rod from the point down to the plate, a
    chain hanging from its right edge, the cog beside the rod. Level 3 (Flash redraws it): a wider plate fixed flat on
    brackets against the bowl's front right, its top above the rim; a thick rust frame round a dark panel with a pale
    inner line and a small copper gear. The big cog stands below it on the ground plate."""
    if L < 3:
        th, face, r0 = math.radians(-8), math.radians(-6), 3.4
        wt, wb, z0, z1, lean = 3.0, 3.0, 0.95, 4.1, 0.5
        shape = [(-1, 0.5), (0, 0), (1, 0.5), (1, 1), (-1, 1)]
    else:
        th, face, r0 = math.radians(SH3_TH), math.radians(-4), 4.1      # on the bowl's front right, as Flash,
        wt, wb, z0, z1, lean = 3.25, 2.9, 2.0, 3.8, -0.55               # leaning back along the bowl's side
        shape = [(-1, 0), (1, 0), (1, 1), (-1, 1)]
    c = Vector((r0 * math.cos(th), r0 * math.sin(th), 0))
    out = Vector((math.cos(face), math.sin(face), 0))
    side = Vector((-math.sin(face), math.cos(face), 0))

    def at(u, v, d=0.0):                        # u across (-1..1), v up (0..1), d out of the front face
        w = wb + (wt - wb) * v
        return c + side * (u * w / 2) + out * (lean * v + d) + Vector((0, 0, z0 + (z1 - z0) * v))

    STATE["shield_at"] = at
    import bmesh
    bm = bmesh.new()
    n = len(shape)
    vs = [[bm.verts.new(at(u, v, d)) for u, v in shape] for d in (-0.22, 0.0)]
    bm.faces.new(vs[1])
    bm.faces.new(vs[0][::-1])
    for j in range(n):
        bm.faces.new((vs[0][j], vs[0][(j + 1) % n], vs[1][(j + 1) % n], vs[1][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("shield", bm, [M["boxrust"] if L < 3 else M["core"]], smooth=False, bevel=0.04, segs=2)
    if L < 3:                                   # Flash's copper rim round the dark face, bolts at its corners
        n_ = len(shape)
        for k in range(n_):
            sweep(f"shieldframe{k}", [at(*shape[k], 0.03), at(*shape[(k + 1) % n_], 0.03)], out, 0.16, 0.1,
                  M["copper"], bevel=0.03)
            if shape[k][1] > 0:                 # (not at the point, where the belt runs down to the cog)
                kit.blob(f"shieldcornerbolt{k}", at(shape[k][0] * 0.9, shape[k][1] * 0.94 + 0.03, 0.09), 0.06, 0.6,
                     M["pale"])
    else:                                       # the thick rust frame (proud of the panel), a pale line inside it
        fr = [(-1.0, 0.0), (1.0, 0.0), (1.0, 1.0), (-1.0, 1.0)]
        for k in range(4):                      # Flash: a thick orange-lit top and left edge, thinner right and foot
            a_, b_ = fr[k], fr[(k + 1) % 4]
            big = k in (2, 3)
            sweep(f"shieldframe{k}", [at(*a_, 0.06), at(*b_, 0.06)], out, 0.42 if big else 0.26, 0.4 if big else 0.3,
                  M["burnt"] if big else M["boxrust"], bevel=0.06)
        fr = [(-0.7, 0.14), (0.7, 0.14), (0.72, 0.86), (-0.72, 0.86)]
        for k in range(4):
            sweep(f"shieldline{k}", [at(*fr[k], 0.03), at(*fr[(k + 1) % 4], 0.03)], out, 0.05, 0.06, M["bone"],
                  bevel=0.015)
        gear("shieldgear", 0.36, 9, 0.08, at(-0.38, 0.68, 0.06), M["copper"], out.to_track_quat("Z", "Y").to_euler(),
             tooth=0.24)
        kit.blob("shieldgearhub", at(-0.38, 0.68, 0.11), 0.1, 0.6, M["rust"])
        kit.bpy.data.objects["shield"].data.materials[0] = panel_glow(at(-0.3, 0.62))
    for u in (-0.85, 0.85):                     # brackets into the wall, bolts on the face
        for v in ((0.5, 0.88) if L < 3 else (0.2, 0.8)):
            p = at(u * 0.7, v, -0.22)
            q = Vector((p.x, p.y, 0)).normalized() * (wall_r(p.z) - 0.08) + Vector((0, 0, p.z))
            sweep(f"shieldbracket{u}{v}", [q, p], (0, 0, 1), 0.14, 0.12, M["rust"], bevel=0.02)
            kit.blob(f"shieldbolt{u}{v}", at(u * (0.9 if L < 3 else 1.0), v, 0.06 if L < 3 else 0.2), 0.07, 0.7,
                     M["bone"])
    if L >= 3:
        return
    # Flash's drive: a belt round two pulleys at the shield's top corners and down past its point to a pulley on the
    # cog on the plate; the cog and pulleys turn and the belt runs (moving layer)
    O = at(0.0, 0.0, 0.0)
    eu = side
    ev = (at(0.0, 1.0) - at(0.0, 0.0)).normalized()
    en = eu.cross(ev).normalized()
    if en.dot(out) < 0:
        en = -en
    DB = 0.27                                    # the belt's plane, out of the face
    BH, BW = 0.05, 0.11                          # its thickness and width

    def pl(a, b, d=DB):                          # a point in the belt's plane: a across, b up the face (metres)
        return O + eu * a + ev * b + en * d
    rot = en.to_track_quat("Z", "Y").to_euler()
    rotd = tuple(math.degrees(a_) for a_ in rot)
    zc = 0.17 + 0.52
    bg = (zc - pl(0, 0, 0.1).z) / ev.z           # the cog's centre on the face's line, its teeth just over the plate
    tops = [((-0.95, 2.5), 0.3), ((0.95, 2.5), 0.3)]
    low = ((0.0, bg), 0.2)
    loop, total = belt_path([(c, r + BH / 2) for c, r in tops + [low]])
    belt_band("belt", loop, lambda a, b: pl(a, b), en, BW, BH, M["belt"])
    STATE["belt"] = (loop, total, pl, en, tops, low)
    for k, ((a, b), r) in enumerate(tops):      # the top pulleys: a grooved rim on spokes, on a stub axle
        cyl(f"pulleyaxle{k}", 0.07, DB + 0.08, pl(a, b, 0.0), M["steel"], rot=rotd, verts=10)
        kit.blob(f"pulleyboss{k}", pl(a, b, -0.02), 0.13, 0.5, M["darkrust"])
        e_ = kit.bpy.data.objects.new(f"pulley{k}", None)
        link(e_)
        e_.location = pl(a, b)
        e_.rotation_euler = rot
        h_ = kit.bpy.data.objects.new(f"pulley{k}-spin", None)
        link(h_, e_)
        kit.MOVING.append(h_)
        cyl(f"pulleyrim{k}", r, BW + 0.06, (0, 0, -(BW + 0.06) / 2), M["pale"], parent=h_, verts=28, bevel=0.01)
        for s_ in (-1, 1):
            cyl(f"pulleyflange{k}{s_}", r + 0.06, 0.03, (0, 0, s_ * (BW / 2 + 0.03) - 0.015), M["pale"], parent=h_,
                verts=28, bevel=0.008)
        cyl(f"pulleyhub{k}", 0.09, BW + 0.14, (0, 0, -(BW + 0.14) / 2), M["darkrust"], parent=h_, verts=12)
        for j in range(5):
            a_ = 2 * math.pi * j / 5
            kit.blob(f"pulleyspoke{k}{j}", (r * 0.5 * math.cos(a_), r * 0.5 * math.sin(a_), BW / 2 + 0.035), 0.06,
                     0.5, M["darkrust"], parent=h_, stretch=(1.0 + 1.4 * abs(math.cos(a_)), 1.0 + 1.4 * abs(math.sin(a_))))
    # the cog on the plate: its own pulley in the belt's plane, the toothed wheel behind it, its axle in an iron
    # block bolted to the plate under the shield's point
    e_ = kit.bpy.data.objects.new("cog", None)
    link(e_)
    e_.location = pl(*low[0])
    e_.rotation_euler = rot
    h_ = kit.bpy.data.objects.new("cog-spin", None)
    link(h_, e_)
    kit.MOVING.append(h_)
    cyl("cogpulley", low[1], BW + 0.06, (0, 0, -(BW + 0.06) / 2), M["steel"], parent=h_, verts=24, bevel=0.01)
    cyl("cogflange", low[1] + 0.06, 0.03, (0, 0, BW / 2 + 0.03 - 0.015), M["steel"], parent=h_, verts=24, bevel=0.008)
    cog_ring("cogwheel", 0.52, 0.41, 12, 0.12, M["cogsteel"], parent=h_, r_in=0.24, tip=0.3, at=(0, 0, -0.08))
    for j in range(4):
        a_ = 2 * math.pi * j / 4
        kit.blob(f"cogspoke{j}", (0.3 * math.cos(a_), 0.3 * math.sin(a_), -0.08), 0.07, 0.6, M["cogsteel"],
                 parent=h_, stretch=(1.0 + 1.3 * abs(math.cos(a_)), 1.0 + 1.3 * abs(math.sin(a_))))
    cyl("coghub", 0.12, DB, (0, 0, -DB + 0.1), M["darkrust"], parent=h_, verts=14)
    g = pl(*low[0], 0.0) - en * 0.12
    box("cogblock", (0.42, 0.34, zc + 0.16 - 0.12), (g.x, g.y, 0.12), M["rust"],
        rot=(0, 0, math.degrees(math.atan2(eu.y, eu.x))), bevel=0.04)
    cyl("cogaxle", 0.08, 0.3, g - en * 0.05 + Vector((0, 0, zc - g.z)), M["steel"], rot=rotd, verts=10)
    for s_ in (-1, 1):
        kit.blob(f"cogblockbolt{s_}", Vector((g.x, g.y, 0.2)) + eu * (s_ * 0.27), 0.05, 0.6, M["steel"])
    # the belt's cleats: they run round the loop (moving layer), so the belt is seen to move as Flash's
    e_ = kit.bpy.data.objects.new("belt", None)
    link(e_)
    h_ = kit.bpy.data.objects.new("belt-spin", None)
    link(h_, e_)
    kit.MOVING.append(h_)
    n = max(8, round(total / 0.26))
    STATE["cleats"] = [box(f"beltcleat{k}", (0.045, BW + 0.01, 0.02), (0, 0, 0), M["beltmark"], parent=h_,
                           bevel=0.01, origin="centre") for k in range(n)]
    # Flash's steel stay: a plain rod from under the shield's right edge straight down to the plate
    top = at(0.98, 0.5, -0.11) - Vector((0, 0, 0.05))
    kit.blob("stayeye", top + Vector((0, 0, 0.03)), 0.08, 0.8, M["steel"])
    sweep("stay", [top, Vector((top.x, top.y, 0.12))], side, 0.09, 0.09, M["pale"], bevel=0.02)
    kit.blob("stayfoot", Vector((top.x, top.y, 0.14)), 0.12, 0.45, M["steel"])


def plate():
    """The steel plate on the ground: a dark top inset in a pale bevelled rim, as Flash."""
    x, y = PLATE
    w = 1.9 if L < 3 else 2.4
    if L >= 3:                                  # under the hood's foot, reaching to the column
        x, y = x - 0.15, y - 0.6
    box("plate", (w, w * 0.9, 0.09), (x, y, 0), M["pale"], rot=(0, 0, 40), bevel=0.04)
    box("platetop", (w - 0.22, w * 0.9 - 0.22, 0.12), (x, y, 0), M["plate"], rot=(0, 0, 40), bevel=0.03)


def cog():
    """Level 3's big cog, upright in front of the hood's foot; it turns (moving layer). Flash: a grey toothed ring on
    spokes round a bossed hub. (Level 1's cog is part of the shield's belt drive.)"""
    if L < 3:                                   # level 1: the cog is part of the shield's belt drive
        return
    r, zc = 1.1, 2.0
    face = Vector((math.cos(math.radians(-4)), math.sin(math.radians(-4)), 0))
    x, y = 4.68, -0.59                          # Flash's place, in front of the plate's lower edge
    e = kit.bpy.data.objects.new("cog", None)
    link(e)
    e.location = (x, y, zc)
    e.rotation_euler = face.to_track_quat("Z", "Y").to_euler()
    hub = kit.bpy.data.objects.new("cog-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    cm = M["cogsteel"]
    cog_ring("cogwheel", r, r * 0.8, 14, 0.22, cm, parent=hub, r_in=r * 0.6, tip=0.3)    # Flash: a toothed ring,
    for k in range(6):                          # six spokes to a bossed hub, the dark showing between them
        a = 2 * math.pi * (k + 0.5) / 6
        sweep(f"cogspoke{k}", [(0.2 * math.cos(a), 0.2 * math.sin(a), 0), (r * 0.64 * math.cos(a), r * 0.64 * math.sin(a), 0)],
              (0, 0, 1), 0.12, 0.13, cm, parent=hub, bevel=0.02)
    cyl("coghub", 0.26, 0.34, (0, 0, -0.17), cm, parent=hub, verts=20, bevel=0.03)
    cyl("coghubface", 0.15, 0.36, (0, 0, -0.18), M["steel"], parent=hub, verts=16, bevel=0.02)
    for k in range(14):                         # rivets round the ring's face
        a = 2 * math.pi * (k + 0.5) / 14
        kit.blob(f"cogrivet{k}", (r * 0.7 * math.cos(a), r * 0.7 * math.sin(a), 0.11), 0.04, 0.6, M["steel"], parent=hub)
    rot = tuple(math.degrees(a) for a in face.to_track_quat("Z", "Y").to_euler())
    cyl("cogaxle", 0.11, 0.5, (x - face.x * 0.38, y - face.y * 0.38, zc), M["steel"], rot=rot, verts=10)
    b = Vector((x, y, 0)) - face * 0.33         # its stand: a flat steel post on the ground plate up to a bearing,
    box("cogstand", (0.14, 0.42, zc - 0.05), (b.x, b.y, 0.1), M["steel"], rot=(0, 0, -4), bevel=0.03)   # clear of
    cyl("cogbearing", 0.24, 0.12, (b.x - face.x * 0.06, b.y - face.y * 0.06, zc), M["steel"], rot=rot, verts=16,
        bevel=0.02)                             # the plate's frame behind it


# ------------------------------------------------------------------------------------------------ level 1: bucket
def bones_heap(name, parent, centre, w, d, n, seed, mat=None, mound=0.0, clear=None):
    """A heap of bones: n bones (a shaft with knobbed ends) lying every way; `mound` piles them up in the middle.
    clear(p) says whether a bone may lie at p (kept clear of the bucket's bar)."""
    r = kit.random.Random(seed)
    for i in range(n):
        u, v = r.uniform(-1, 1), r.uniform(-1, 1)
        p = Vector((centre[0] + u * w, centre[1] + v * d,
                    centre[2] + r.uniform(0, 0.12) + mound * max(0.0, 1 - 0.7 * (u * u + v * v))))
        ln = r.uniform(0.3, 0.5)
        a = r.uniform(0, math.pi)
        q = Vector((math.cos(a), math.sin(a), r.uniform(-0.45, 0.45))).normalized() * ln / 2
        if clear and not all(clear(p + q * t_) for t_ in (-1.15, -0.5, 0.0, 0.5, 1.15)):
            continue
        m_ = mat or (M["bone"] if r.random() < 0.8 else M["hornbone"])
        tube(f"{name}{i}", [p - q, p + q], 0.045, m_, parent=parent, verts=8)
        for s in (-1, 1):
            kit.blob(f"{name}{i}k{s}", p + q * s * 1.05, 0.075, 0.8, m_, parent=parent)
        if i % 7 == 3 and (not clear or clear(p + Vector((0.12, -0.1, 0.06)))):   # a knuckle or skull-cap
            kit.blob(f"{name}{i}nub", p + Vector((0.12, -0.1, 0.06)), 0.13, 0.75, M["bone"], parent=parent)


def bucket_frame():
    """Two bone posts carry the bar: the left one on the back-left rim, the right one on a shoe bolted inside the
    rim; Flash's dark iron paddle, a spade-shaped blade, hangs from the left post beside the bucket."""
    for i, x in enumerate(POST_X):
        z0 = RIM_Z - 0.1 if i == 0 else RIM_Z - 0.35
        box(f"post{i}", (0.22, 0.26, BAR_Z + 0.2 - z0), (x, 0, z0), M["bone"], bevel=0.04)
        for k, z in enumerate((z0 + 0.45, BAR_Z - 0.35)):      # iron straps round the posts
            box(f"poststrap{i}{k}", (0.28, 0.32, 0.1), (x, 0, z), M["darkrust"], bevel=0.02)
        cyl(f"postcap{i}", 0.13, 0.1, (x, 0, BAR_Z + 0.2), M["steel"], verts=12, bevel=0.02)
    box("postshoe0", (0.44, 0.44, 0.16), (POST_X[0], 0, RIM_Z - 0.16), M["rust"], bevel=0.03)
    box("postshoe1", (0.62, 0.36, 0.2), (POST_X[1] + 0.12, 0, RIM_Z - 0.45), M["rust"], bevel=0.03)
    for i, x in enumerate(POST_X):
        kit.blob(f"postbolt{i}", (x, -0.23, RIM_Z - (0.08 if i == 0 else 0.35)), 0.055, 0.7, M["steel"])
    tube("bar", [(POST_X[0] - 0.1, 0, BAR_Z), (POST_X[1] + 0.1, 0, BAR_Z)], 0.07, M["bone"], verts=12)
    tube("poststrut", [(POST_X[0] + 0.05, 0.0, BAR_Z - 0.4), (-2.3, 2.2, RIM_Z - 0.04)], 0.06, M["bone"], verts=10)
    # the paddle: Flash's big dark iron spade at the bowl's back left, behind the front roller, turned to face us and
    # nearly as tall as the post: its foot dips into the bowl, the broad blade stands over the left rim, its shoulders
    # narrow to a shaft that leans back to the post's head; a raised rim round the blade and rivets
    eu = Vector((0.863, 0.505, 0))              # across the blade: square to our view
    en = Vector((0.505, -0.863, 0))             # out of its face, toward us
    ev = Vector((0, 0, 1))
    o = Vector((-2.52, -0.64, 2.95))
    blade = [(-0.3, 0.78), (0.45, 0.2), (0.45, 1.25), (0.64, 1.45), (0.62, 1.95), (0.34, 2.35), (0.1, 2.55),
             (-0.1, 2.55), (-0.36, 2.2), (-0.52, 1.7), (-0.56, 0.95)]    # a spade: broad foot, tapering top
    prism("paddle", blade, eu, ev, en, 0.1, M["core"], o, bevel=0.03)
    f_ = en * 0.12
    for k in range(len(blade)):
        a_, b_ = blade[k], blade[(k + 1) % len(blade)]
        sweep(f"paddlerim{k}", [o + eu * a_[0] + ev * a_[1] + f_, o + eu * b_[0] + ev * b_[1] + f_], en, 0.06, 0.08,
              M["core"], bevel=0.015)
    head = Vector((POST_X[0] + 0.2, -0.2, BAR_Z - 0.3))
    sweep("paddleshaft", [o + ev * 2.45 + en * 0.05, head], en, 0.1, 0.2, M["core"], bevel=0.02)
    for k, (u_, v_) in enumerate(((-0.38, 1.1), (0.3, 1.1), (-0.36, 1.7), (0.45, 1.7), (0.0, 2.3))):
        kit.blob(f"paddlerivet{k}", o + eu * u_ + ev * v_ + en * 0.15, 0.055, 0.6, M["steel"])
    sweep("paddlearm", [head + Vector((0, 0.06, 0)), Vector((POST_X[0], 0, head.z))], (0, 0, 1), 0.36, 0.12,
          M["darkrust"], bevel=0.02)            # an iron strap round the post holds the shaft's head


def bucket():
    """Flash's bucket: a deep dark rust box hung on the bar through its ends, heaped with bones; its walls framed with
    iron corner straps and riveted rims, its bottom bright copper (seen as it turns over)."""
    e = kit.bpy.data.objects.new("bucket", None)
    link(e)
    e.location = (BUCKET_X, 0, BAR_Z)
    hub = kit.bpy.data.objects.new("bucket-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    W, D, H = 1.8, 1.6, 1.12
    zb = -0.92                                  # its floor below the bar (the bar runs through its sides)
    t = 0.08
    box("bucketfloor", (W, D, t), (0, 0, zb), M["copper"], parent=hub, bevel=0.025)
    for s in (-1, 1):
        box(f"bucketside{s}", (t, D, H), (s * (W - t) / 2, 0, zb), M["boxrust"], parent=hub, bevel=0.025)
        box(f"bucketend{s}", (W - 2 * t, t, H), (0, s * (D - t) / 2, zb), M["boxrust"], parent=hub, bevel=0.025)
        box(f"bucketlip{s}", (W + 0.08, 0.12, 0.1), (0, s * (D - 0.02) / 2, zb + H - 0.08), M["steel"], parent=hub,
            bevel=0.02)
        box(f"bucketlipx{s}", (0.12, D + 0.08, 0.1), (s * (W - 0.02) / 2, 0, zb + H - 0.08), M["steel"], parent=hub,
            bevel=0.02)
        box(f"bucketfoot{s}", (W + 0.04, 0.1, 0.12), (0, s * (D - 0.02) / 2, zb - 0.02), M["darkrust"], parent=hub,
            bevel=0.02)
        for s2 in (-1, 1):                      # iron angles up the four corners, three rivets each face
            box(f"bucketcorner{s}{s2}", (0.14, 0.14, H + 0.04), (s * (W / 2 - 0.04), s2 * (D / 2 - 0.04), zb - 0.02),
                M["darkrust"], parent=hub, bevel=0.02)
            for k in range(3):
                z = zb + 0.2 + k * 0.36
                kit.blob(f"bucketrivet{s}{s2}{k}", (s * (W / 2 - 0.1), s2 * (D / 2 + 0.02), z), 0.035, 0.6,
                         M["pale"], parent=hub)
                kit.blob(f"bucketrivetx{s}{s2}{k}", (s * (W / 2 + 0.02), s2 * (D / 2 - 0.1), z), 0.035, 0.6,
                         M["pale"], parent=hub)
        cyl(f"bucketboss{s}", 0.17, 0.08, (s * (W / 2 + 0.04), 0, 0), M["steel"], rot=(0, 90, 0), parent=hub,
            verts=16, bevel=0.02)               # where the bar runs through the ends
    fill = kit.bpy.data.objects.new("bucketfill", None)
    link(fill, hub)
    box("bucketfillbed", (W - 0.2, D - 0.2, 0.8), (0, 0, zb + 0.05), M["bonedark"], parent=fill, bevel=0.05)
    bones_heap("bucketbone", fill, (0, 0, zb + 0.82), 0.68, 0.58, 44, 11, mound=0.3,
               clear=lambda p: math.hypot(p.y, p.z) > 0.26)       # the bar runs through above the heap's middle
    return hub, fill


FALL = []


def falling():
    """Bone bits falling from the bucket / hopper onto the rollers: each one keyed per frame in turn()."""
    e = kit.bpy.data.objects.new("fall", None)
    link(e)
    hub = kit.bpy.data.objects.new("fall-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    r = kit.random.Random(5)
    for i in range(14):
        b = kit.bpy.data.objects.new(f"fallbit{i}", None)
        link(b, hub)
        ln = r.uniform(0.2, 0.34)
        tube(f"fallbitbone{i}", [(-ln / 2, 0, 0), (ln / 2, 0, 0)], 0.045, M["bone"], parent=b, verts=8)
        for s in (-1, 1):
            kit.blob(f"fallbitknob{i}{s}", (s * ln / 2, 0, 0), 0.065, 0.8, M["bone"], parent=b)
        FALL.append((b, r.uniform(-0.6, 0.6), r.uniform(-0.45, 0.45), r.uniform(0, 1), r.uniform(0, 6.28)))
    return hub


# ------------------------------------------------------------------------------------------------ level 3: hopper
def column():
    """Level 3: the steel column on the ground behind the plate; its head carries the hopper's arm under a stack of
    grey collars (Flash's bolted head)."""
    x, y = COLUMN
    cyl("column", 0.17, COL_Z + 0.4, (x, y, 0.12), M["steel"], verts=20, bevel=0.03)
    for z in (0.12, 1.55, 4.4):
        cyl(f"columncollar{z}", 0.27, 0.22, (x, y, z), M["steel"], verts=20, bevel=0.04)
    cyl("columnfoot", 0.42, 0.18, (x, y, 0.12), M["rust"], verts=20, bevel=0.04)
    cyl("columnhead", 0.32, 0.62, (x, y, COL_Z - 0.31), M["steel"], verts=20, bevel=0.04)
    for k, z in enumerate((COL_Z - 0.62, COL_Z - 0.86, COL_Z - 1.1)):
        cyl(f"columnstack{k}", 0.36 - 0.03 * k, 0.2, (x, y, z), M["steel"], verts=20, bevel=0.05)
    cyl("columncap", 0.22, 0.2, (x, y, COL_Z + 0.31), M["steel"], r2=0.1, verts=16, bevel=0.03)


BUCKET_X = -0.5
COL_Z = 6.55                          # level 3: the column's head (Flash's grey collars)
# Level 3: Flash's hopper at rest, read off its frame 0 and lifted with the game camera (work/v5/hopgeo.py). Its frame:
# HOP_C is the cover's far-left top corner, HOP_U runs along the cover (to the right), HOP_V up its slope (to the back),
# HOP_N out of it. The cover is tipped steeply toward the bowl; the plank tray lies parallel to it, lower, running out of
# the hopper's mouth on the left and down over the rollers.
HOP_C = Vector((-1.161, 2.01, 7.25)) + Vector((-0.05, 0.0, -0.45))   # v6: down-left onto Flash's outline
HOP_U, HOP_V, HOP_N = Vector((0.999, -0.043, 0.0)), Vector((0.033, 0.758, 0.651)), Vector((-0.028, -0.651, 0.759))
HOP_W, HOP_L, HOP_D = 3.26, 1.34, 1.25      # the cover's length and width, and the tray's depth below the cover's top
TRAY = (0.95, 0.3, 0.94, 1.55)              # the front wall's depth at the left and right ends, the tray's share of
TRAY_DIR = Vector((0.0, -0.387, -0.922))    # its width, and the tray's length down TRAY_DIR (steep, as Flash's chute)
Z_ = Vector((0.0, 0.0, 1.0))


def hp(u_, v_, n_):
    """A point in the hopper's frame (v_ counts down the slope, n_ down from the cover's top) -> world, at rest."""
    return HOP_C + HOP_U * u_ - HOP_V * v_ - HOP_N * n_


def tray_frame():
    """The tray in the world, at rest: the front wall's foot f0 (left) .. f1, the tray's width w, its length ln (down
    the chute) and `up` out of its face."""
    W, Lc = HOP_W, HOP_L
    f0, f1 = hp(0.0, Lc, 0.24) - Z_ * TRAY[0], hp(W, Lc, 0.24) - Z_ * TRAY[1]
    w = (f1 - f0) * TRAY[2]
    ln = TRAY_DIR.normalized() * TRAY[3]
    up = ln.cross(w).normalized()
    return f0, f1, w, ln, (up if up.z > 0 else -up)


def quad_box(name, o, ax, ay, az, mat, parent=None, bevel=0.03):
    """A slanted box: corner o and its three edges ax, ay, az (any directions)."""
    import bmesh
    bm = bmesh.new()
    o, ax, ay, az = (Vector(v) for v in (o, ax, ay, az))
    vs = [bm.verts.new(o + ax * i + ay * j + az * k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat], smooth=False, bevel=bevel, segs=2, parent=parent)


def hopper():
    """Level 3's hopper, as Flash: a long rust bin tipped steeply toward the bowl, under a thick rust cover with a raised
    edge lit orange; a wall hangs straight down from the cover's near edge (deep at the left, where Flash's left side
    drops straight down) and the plank tray hangs from its foot, steeply down over the rollers. The axle sits at the
    tray's lower right in the bearing of the column's low arm. The hopper swings back about it to fill and forward to
    pour, and the bones slide off the tray's foot."""
    f0, f1, w, ln, up = tray_frame()
    j = f0 + w + ln * 0.9 + HOP_U * 0.16 - up * 0.05     # the axle: at the tray's lower right, as Flash's low arm
    e = kit.bpy.data.objects.new("hopper", None)
    link(e)
    e.location = j
    hub = kit.bpy.data.objects.new("hopper-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)

    def qb(name, at, du, dv, dn, mat, bevel=0.03, parent=hub):   # a box in the hopper's frame (sizes along u, -v, -n)
        return quad_box(name, hp(*at) - j, HOP_U * du, -HOP_V * dv, -HOP_N * dn, mat, parent=parent, bevel=bevel)

    t = 0.12
    W, Lc, D = HOP_W, HOP_L, HOP_D
    # the cover, and its thick raised edge (copper, lit orange as Flash's)
    qb("hoppercover", (-0.05, -0.05, 0.0), W + 0.1, Lc + 0.1, 0.24, M["hoprust"], bevel=0.04)
    for k, (at, du, dv) in enumerate((((-0.05, -0.05, -0.16), W + 0.1, 0.2), (((-0.05, Lc - 0.15, -0.16)), W + 0.1, 0.2),
                                      ((-0.05, 0.15, -0.16), 0.2, Lc - 0.3), ((W - 0.15, 0.15, -0.16), 0.2, Lc - 0.3))):
        qb(f"hopperedge{k}", at, du, dv, 0.18, M["copper" if k in (0, 2) else "hoprust"], bevel=0.05)
    # the bin under it: back wall, end walls and floor square to the cover
    qb("hopperback", (0.0, 0.0, 0.24), W, t, D - 0.24, M["hoprust"])
    qb("hopperend0", (0.0, 0.0, 0.24), t, Lc, D - 0.24, M["hoprust"])
    qb("hopperend1", (W - t, 0.0, 0.24), t, Lc, D - 0.24, M["hoprust"])
    for k in range(4):                          # Flash's planked lid inside the raised rim
        qb(f"hopperlidboard{k}", (0.17, 0.17 + k * (Lc - 0.34) / 4 + 0.012, -0.07), W - 0.34, (Lc - 0.34) / 4 - 0.024,
           0.07, M["planks"], bevel=0.015)
    for s_ in (0.0, 1.0):                       # iron straps round the box's ends, a rivet row on each
        qb(f"hopperstrap{s_}", (0.25 + s_ * (W - 0.62), -0.07, -0.02), 0.12, Lc + 0.14, D - 0.02, M["darkrust"],
           bevel=0.02)
    qb("hopperfloor", (0.0, 0.0, D), W, Lc, t, M["hopside"])
    # Flash's front: a wall hanging straight down from the cover's near edge, deep at the left (the bin's floor runs
    # down to its mouth there) and shallow at the right; its foot is the tray's top edge, level on screen as Flash's
    import bmesh
    top0, top1 = hp(0.0, Lc, 0.24), hp(W, Lc, 0.24)
    bm = bmesh.new()
    q = [bm.verts.new(p_ - j + HOP_V * dv) for dv in (0.0, t) for p_ in (top0, top1, f1, f0)]
    bm.faces.new(q[:4]); bm.faces.new(q[4:][::-1])
    for a_ in range(4):
        bm.faces.new((q[a_], q[(a_ + 1) % 4], q[4 + (a_ + 1) % 4], q[4 + a_]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("hopperfront", bm, [M["hopside"]], smooth=False, bevel=0.03, segs=2, parent=hub)
    # the plank tray, hung from the wall's foot and running steeply down toward the rollers: boards along the chute,
    # rust rails along its sides, a batten near its foot
    o = f0 - j + HOP_V * 0.02
    n = 7                                       # Flash's slats run across the chute, one below the other
    for k in range(n):
        quad_box(f"hopperboard{k}", o + ln * ((k + 0.04) / n) + w * kit.rng.uniform(0.0, 0.02),
                 w * (1.0 - kit.rng.uniform(0.0, 0.04)), ln * (0.86 / n), -up * 0.1, M["planks"], parent=hub,
                 bevel=0.02)
    quad_box("hoppertraybed", o - up * 0.1, w, ln, -up * 0.05, M["hopside"], parent=hub, bevel=0.01)
    for k, s_ in enumerate((0.0, 1.0)):
        quad_box(f"hoppertrayrail{k}", o + w * s_ - w.normalized() * 0.07 - up * 0.1, w.normalized() * 0.12,
                 ln * 1.02, up * 0.24, M["hoprust"], parent=hub, bevel=0.03)
    # the bones at the mouth, on the tray's top
    fill = kit.bpy.data.objects.new("hopperfill", None)
    link(fill, hub)
    bones_heap("hopperbone", fill, o + w * 0.3 + ln * 0.22 + up * 0.12, 0.45, 0.2, 9, 12)
    # the axle's boss on the right end, the arm from the column's bearing to it (still), and the column's bearing
    x, y = COLUMN
    cyl("hopperboss", 0.26, 0.24, HOP_U * 0.02, M["steel"], rot=(0, 90, 0), parent=hub, verts=16,
        bevel=0.03)
    lu = ln.normalized()
    quad_box("hopperlug", -HOP_U * 0.1 - lu * 0.55 - up * 0.25, HOP_U * 0.1, lu * 0.8, up * 0.5, M["hopside"],
             parent=hub)
    for k, dl in enumerate((-0.38, -0.1)):
        kit.blob(f"hopperbolt{k}", lu * dl + up * 0.12 + HOP_U * 0.02, 0.06, 0.7, M["bone"], parent=hub)
    back = (Vector((x, y, j.z)) - j - Vector((0.3, 0, 0))).normalized() * 0.45     # Flash's arm runs on past the column
    sweep("arm", [j + Vector((0.3, 0, 0)), Vector((x, y, j.z)) + back], (0, 0, 1), 0.34, 0.4, M["hoprust"], bevel=0.04)
    cyl("armbearing", 0.26, 0.3, j + Vector((0.3, 0, 0)), M["hoprust"], rot=(0, 90, 0), verts=16, bevel=0.03)
    box("armclamp", (0.8, 0.8, 0.62), (x, y, j.z), M["hoprust"], bevel=0.06, origin="centre")
    STATE["mouth"] = lambda: hub.matrix_world @ (o + w * 0.3 + ln * 1.08 + up * 0.25 + Z_ * 0.2)    # bones slide off the foot
    STATE["tray_foot"] = lambda: hub.matrix_world @ (o + w * 0.5 + ln)
    return hub, fill


DUST = []


def dust():
    """The dust puff where the bones land on the rollers: soft pale clouds that swell and thin (moving layer)."""
    e = kit.bpy.data.objects.new("dust", None)
    link(e)
    hub = kit.bpy.data.objects.new("dust-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    r = kit.random.Random(9)
    for i in range(6):
        b = kit.blob(f"dustpuff{i}", (0, 0, 0), r.uniform(0.35, 0.55), 0.75, M["dust"], parent=hub)
        DUST.append((b, r.uniform(-0.9, 0.9), r.uniform(-0.5, 0.5), r.uniform(0, 0.35)))
    return hub


# ------------------------------------------------------------------------------------------------ build / animate
STATE = {}


def build():
    bowl()
    rollers()
    horn()
    drum()
    plate()
    shield()
    cog()
    if L < 3:
        bucket_frame()
        STATE["tip"], STATE["fill"] = bucket()
    else:
        column()
        STATE["tip"], STATE["fill"] = hopper()
    STATE["fall"] = falling()
    STATE["dust"] = dust()
    glow()


def glow():
    """Flash's warm orange highlights on the copper, rust and wood (the Inferno's lava light), from the upper left: a
    second sun that lights only those parts (light linking), so the teal bowl and the ground keep their colour."""
    warm = {M["copper"].name, M["rust"].name, M["planks"].name, M["drum"].name, M["hoprust"].name}
    coll = kit.bpy.data.collections.new("glowlit")
    for o in list(kit.bpy.data.objects):
        if o.type in ("MESH", "CURVE") and any(s_.material and s_.material.name in warm for s_ in o.material_slots):
            coll.objects.link(o)
    d = kit.bpy.data.lights.new("glow", "SUN")
    d.energy = GLOW
    d.color = (1.0, 0.5, 0.18)
    d.angle = math.radians(20)
    sun = kit.bpy.data.objects.new("glow", d)
    link(sun)
    to = Vector((-1.0, -0.15, 0.9)).normalized()
    sun.rotation_euler = (-to).to_track_quat("-Z", "Y").to_euler()
    sun.light_linking.receiver_collection = coll
    sun.light_linking.blocker_collection = coll
    under = kit.bpy.data.collections.new("underlit")      # Flash's lit underside of the boards and the copper
    for o in coll.objects:
        if any(s_.material and s_.material.name in {M["planks"].name, M["copper"].name} for s_ in o.material_slots):
            under.objects.link(o)
    d = kit.bpy.data.lights.new("underglow", "SUN")
    d.energy = GLOW * 0.8
    d.color = (1.0, 0.45, 0.12)
    d.angle = math.radians(30)
    sun = kit.bpy.data.objects.new("underglow", d)
    link(sun)
    to = Vector((-0.4, -0.85, -0.35)).normalized()
    sun.rotation_euler = (-to).to_track_quat("-Z", "Y").to_euler()
    sun.light_linking.receiver_collection = under
    sun.light_linking.blocker_collection = under


GLOW = 2.4


BACK, POUR = 20.0, 5.0                 # level 3: how far the hopper swings back to fill, and forward to pour (deg)


def tip_angle(f):
    """Level 1: the bucket's turn about the bar (deg, toward the front), once round in the loop. Level 3: the hopper's
    swing (toward its back > 0): back to fill, then forward to pour, then back to rest, as Flash."""
    if L < 3:
        return 360.0 * f
    keys = [(0.0, 0.0), (0.1, BACK), (0.3, BACK + 3.0), (0.42, 0.0), (0.5, -POUR), (0.8, -POUR - 2.0), (0.9, 0.0),
            (1.0, 0.0)]
    for (f0, a0), (f1, a1) in zip(keys, keys[1:]):
        if f0 <= f <= f1:
            s = (f - f0) / (f1 - f0)
            s = s * s * (3 - 2 * s)
            return a0 + (a1 - a0) * s
    return 0.0


def turn(frame):
    f = (frame % FR) / FR
    for hub in kit.MOVING:
        n = hub.parent.name
        if n.startswith("roll"):                # the two turn against each other, drawing the bones down between
            hub.rotation_euler = (0, 0, math.radians((-1 if n == "roll0" else 1) * 2 * 360.0 * f))
        elif n == "cog":
            hub.rotation_euler = (0, 0, math.radians(360.0 * f))
    if L < 3:                                   # the belt runs round once as the cog turns once; the pulleys follow
        loop, total, pl, en, tops, low = STATE["belt"]
        cl = STATE["cleats"]
        step = total / len(cl)
        shift = step * max(1, round(2 * math.pi * low[1] / step))
        for hub in kit.MOVING:
            if hub.parent.name.startswith("pulley"):
                k = int(hub.parent.name[6:])
                turns = round(shift / tops[k][1] / (2 * math.pi / 5)) * (2 * math.pi / 5)
                hub.rotation_euler = (0, 0, turns * f)
        m = len(loop)
        for k, c_ in enumerate(cl):
            t = ((k * step + shift * f) / total % 1.0) * m
            i0 = int(t) % m
            a, b = loop[i0], loop[(i0 + 1) % m]
            w_ = t - int(t)
            p = pl(a[0] + (b[0] - a[0]) * w_, a[1] + (b[1] - a[1]) * w_)
            tg = (pl(*b) - pl(*a)).normalized()
            nr = tg.cross(en).normalized()       # out of the loop (the loop runs anticlockwise round en)
            c_.location = p + nr * 0.022
            from mathutils import Matrix
            c_.rotation_euler = Matrix((tg, en, nr)).transposed().to_euler()
    tip = STATE["tip"]
    a = tip_angle(f)
    if L < 3:
        tip.rotation_euler = (math.radians(a), 0, 0)
        pouring = 0.22 <= f <= 0.5
        empty = 0.28 <= f <= 0.88
        src = Vector((0, -0.5, BAR_Z - 0.4))
    else:
        tip.rotation_euler = (math.radians(-a), 0, 0)     # about +X a turn back lifts the cover's near edge
        pouring = 0.52 <= f <= 0.84
        empty = f >= 0.62 or f < 0.06
        kit.bpy.context.view_layer.update()
        src = STATE["mouth"]()
    STATE["fill"].hide_render = empty
    for o in STATE["fill"].children_recursive:
        o.hide_render = empty
    for b, dx, dy, ph, spin in FALL:
        t0 = 0.22 if L < 3 else 0.52
        span = 0.28 if L < 3 else 0.3
        u = (f - t0) / span - ph * 0.6
        show = pouring and 0.0 <= u <= 0.4
        z = src.z - 9.0 * u * u * 1.6
        if z < ROLL_Z + (0.35 if L < 3 else 0.85):        # gone into the rollers (L3: past the spikes)
            show = False
        b.location = (src.x + dx, src.y + (dy if L < 3 else -abs(dy) - 1.3 * max(0.0, u)), z)
        b.rotation_euler = (spin + 6 * u, spin * 0.5, spin)
        if not show:                            # parked out of sight (and out of the clipping check)
            b.location = (0, 0, -50 - 2 * dx)
        b.hide_render = not show
        for o in b.children:
            o.hide_render = not show
    land = Vector((-0.6, -0.4, ROLL_Z + 0.75)) if L >= 3 else Vector((0.0, -0.6, ROLL_Z + 0.9))
    d0, d1 = (0.5, 0.88) if L >= 3 else (0.3, 0.64)
    for b, dx, dy, ph in DUST:                  # each puff swells and rises, then is gone
        u = (f - d0 - ph * (d1 - d0) * 0.5) / ((d1 - d0) * 0.6)
        show = 0.0 <= u <= 1.0
        k = 0.4 + 0.9 * max(0.0, u)
        b.location = land + Vector((dx * (0.6 + 0.6 * u), dy, 0.9 * u))
        b.scale = (k, k, k)
        if not show:
            b.location = (dx * 3, 0, -60)
        b.hide_render = not show


if __name__ == "__main__":
    kit.run(build, turn)
