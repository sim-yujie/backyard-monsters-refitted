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
Level 1: a rust band under the lip; two bone posts on the rim carry a bar with the tipping bucket of bones; a square
front roller with neat rows of blunt pale bone pyramids and a grey back roller with dark round sockets; a small cog on
the plate. Level 3 (Flash redraws the crusher here): a band round the bowl, a few big grey cones with pale tips on dark
rollers sunk below the rim, a steel column whose low arm carries the hopper, a big pale cog, and a bigger hood leaning
back against the bowl. The hopper: a long rust bin tipped steeply toward the bowl under a thick rust cover with lit
edges, a wall hanging straight down from the cover's near edge, and Flash's plank tray hung from that wall's foot and
running steeply down over the rollers; its axle is at the tray's lower right, in the arm's bearing.

Animation, as Flash (47 frames at level 1, 50 at level 3): level 1, the bucket turns once round the bar, tipping its
bones onto the rollers; level 3, the hopper swings back about its axle to fill, then tips forward and its bones slide off the tray's foot.
At both the rollers turn and the cog turns (and the level 1 chain sways); the falling bones and the dust are the moving
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
ROLL_Y, ROLL_Z = (-1.0, 0.55), (3.05 if L < 3 else 2.4)    # Flash's two rollers (front, back); L3's lower: spikes in
ROLL_R = (0.42, 0.5)                  # their cores; level 1's front one carries bone teeth, the back one sockets
ROLL_X = 2.2                          # the rollers' toothed length ends here; bare axles run on to the wall
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
    m["lip"] = painted("lip", (88, 148, 130), rough=0.46, metal=0.3, wear=(188, 218, 204), rust=(60, 40, 26), scale=6,
                       dirt=0.25, spec=0.38, soot=0.35, rust_at=0.66, grain=0.2)
    m["inside"] = painted("inside", (16, 28, 26), rough=0.85, wear=(32, 52, 48), scale=3, dirt=0.4, spec=0.12)
    m["rust"] = painted("rust", (124, 48, 16), rough=0.62, metal=0.15, wear=(210, 108, 44), rust=(52, 22, 10),
                        scale=6.0, dirt=0.4, spec=0.32, soot=0.6, rust_at=0.52, grain=0.4)
    m["copper"] = painted("copper", (184, 78, 24), rough=0.55, metal=0.2, wear=(240, 146, 68), rust=(84, 32, 12),
                          scale=5.0, dirt=0.4, spec=0.4, soot=0.45, rust_at=0.58, grain=0.3)
    m["bone"] = painted("bone", (184, 164, 126), rough=0.75, wear=(230, 214, 178), rust=(96, 74, 46), scale=6,
                        dirt=0.45, spec=0.25, soot=0.5, rust_at=0.58, grain=0.3)
    m["hornbone"] = painted("hornbone", (136, 134, 128), rough=0.6, wear=(214, 212, 204), rust=(112, 74, 44),
                            scale=14, dirt=0.35, spec=0.35, soot=0.5, rust_at=0.62, grain=0.3)
    m["groove"] = painted("groove", (86, 48, 24), rough=0.85, wear=(122, 72, 38), scale=10, dirt=0.3, spec=0.15)
    m["bonegap"] = painted("bonegap", (40, 32, 24), rough=0.85, wear=(70, 58, 42), scale=6, dirt=0.3, spec=0.15)
    m["bonedark"] = painted("bonedark", (84, 70, 52), rough=0.8, wear=(128, 110, 82), scale=5, dirt=0.3, spec=0.2)
    m["spike"] = painted("spike", (132, 120, 104), rough=0.5, metal=0.35, wear=(196, 184, 162), rust=(70, 44, 26),
                         scale=8, dirt=0.3, spec=0.4, soot=0.4, rust_at=0.6, grain=0.3)     # L3: grey-brown cones
    m["core"] = painted("core", (14, 14, 13), rough=0.9, metal=0.1, wear=(34, 32, 30), scale=6, dirt=0.3, spec=0.12)
    m["roller"] = painted("roller", (124, 118, 104), rough=0.72, metal=0.15, wear=(196, 186, 160), rust=(84, 60, 40),
                          scale=9, dirt=0.6, spec=0.25, soot=0.6, rust_at=0.55, grain=0.55)  # L1: the rough grey slab
    m["drum"] = painted("drum", (172, 74, 30), rough=0.5, metal=0.3, wear=(248, 162, 96), rust=(72, 24, 12),
                        scale=3.0, dirt=0.6, spec=0.45, soot=0.65, rust_at=0.55, grain=0.35, streak=1.0)  # worn copper
    m["hoprust"] = painted("hoprust", (122, 48, 16), rough=0.66, metal=0.15, wear=(204, 104, 42), rust=(38, 15, 8),
                           scale=2.5, dirt=0.65, spec=0.28, soot=0.85, rust_at=0.45, grain=0.6, streak=1.0)  # grimy
    m["hopside"] = painted("hopside", (52, 20, 9), rough=0.75, metal=0.15, wear=(96, 44, 18), rust=(26, 12, 7),
                           scale=2.5, dirt=0.8, spec=0.2, soot=0.8, rust_at=0.45, grain=0.6, streak=1.0)  # in shade
    m["darkrust"] = painted("darkrust", (40, 16, 9), rough=0.7, metal=0.25, wear=(88, 44, 24), scale=5, dirt=0.5,
                            spec=0.3, soot=0.5, grain=0.4)   # L3: the dark arm
    m["spiketip"] = painted("spiketip", (196, 186, 166), rough=0.5, metal=0.3, wear=(230, 224, 208), scale=8,
                            dirt=0.2, spec=0.4)
    m["planks"] = kit.wood("planks", (206, 104, 40), (128, 54, 18), axis="Y", rings=4, dirt=0.4)    # orange boards
    m["pale"] = painted("pale", (150, 152, 144), rough=0.5, metal=0.4, wear=(206, 206, 196), rust=(80, 60, 44),
                        scale=6, dirt=0.3, spec=0.4, rust_at=0.66)
    m["paleband"] = painted("paleband", (84, 96, 90), rough=0.55, metal=0.35, wear=(158, 170, 160), rust=(62, 44, 30),
                            scale=7, dirt=0.5, spec=0.3, soot=0.5, rust_at=0.6, grain=0.35)    # the foot's pale band
    m["steel"] = painted("steel", (78, 80, 82), rough=0.48, metal=0.5, wear=(164, 164, 158), rust=(62, 42, 30),
                         scale=6, dirt=0.4, spec=0.4, soot=0.55, rust_at=0.6, grain=0.25)
    m["cogsteel"] = painted("cogsteel", (138, 140, 138), rough=0.45, metal=0.5, wear=(214, 214, 208), rust=(84, 64, 46),
                            scale=7, dirt=0.35, spec=0.4, soot=0.35, rust_at=0.66, grain=0.2)   # L3: Flash's pale cog
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
    if L >= 3:                                 # level 3: a riveted band round the bowl's belly
        lathe("bowlband", [(3.24, 2.1), (3.44, 2.18), (3.5, 2.45), (3.44, 2.72), (3.2, 2.8)], (0, 0, 0), M["band"],
              verts=72)
        for i in range(18):
            a = 2 * math.pi * (i + 0.5) / 18
            kit.blob(f"bowlrivet{i}", (3.47 * math.cos(a), 3.47 * math.sin(a), 2.45), 0.07, 0.9, M["iron"])


# ------------------------------------------------------------------------------------------------ the rollers
def rollers():
    """Flash's two rollers along X, their bare axles into the inside wall. Level 1: a square front block with neat rows
    of low blunt bone pyramids (Flash's comb) and a grey back roller with rows of dark round sockets; level 3 (Flash
    redraws them): dark cores sunk below the rim, a few big grey-brown cones with pale tips. They turn (moving layer)."""
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
        core = M["coredark"] if L >= 3 else (M["bonegap"] if i == 0 else M["roller"])
        if L < 3 and i == 0:                    # Flash's front roller: a square bone block, shorter than the back one
            blk = cyl(f"roll{i}core", 0.5, FRONT_X[1] - FRONT_X[0], (0, 0, FRONT_X[0]), core, parent=hub, verts=4,
                      bevel=0.04)
            v0 = blk.data.vertices[0].co
            a0 = math.atan2(v0.y, v0.x)
            rf = 0.5 * math.cos(math.pi / 4)                 # the flat faces' distance from the axis
        elif L < 3 and i == 1:                    # Flash's back roller: a flat-faced grey slab, a six-sided beam
            slab = cyl(f"roll{i}core", r + 0.14, 2 * ROLL_X + 0.2, (0, 0, -ROLL_X - 0.1), core, parent=hub, verts=6,
                       bevel=0.05)
            v0 = slab.data.vertices[0].co
            a0 = math.atan2(v0.y, v0.x) + math.pi / 6        # the first flat face's middle
        else:
            cyl(f"roll{i}core", r, 2 * ROLL_X + 0.2, (0, 0, -ROLL_X - 0.1), core, parent=hub, verts=28)
        cyl(f"roll{i}axle", 0.12, 2 * half, (0, 0, -half), M["steel"], parent=hub, verts=12)
        if L >= 3:                  # Flash: a few rows of moderate grey-brown cones with pale tips, dark roller between
            for k in range(4):
                z = -1.55 + 0.5 * i + k * 1.0
                if abs(z) > ROLL_X - 0.15:
                    continue
                for j in range(3):
                    a = 2 * math.pi * (j + 0.5 * (k % 2) + 0.25 * i) / 3
                    d = Vector((math.cos(a), math.sin(a), 0))
                    q = d.to_track_quat("Z", "Y").to_euler()
                    sp = cyl(f"roll{i}spike{k}-{j}", 0.25, 0.48, (d.x * (r - 0.03), d.y * (r - 0.03), z), M["spike"],
                             r2=0.07, verts=10, parent=hub, bevel=0.0)
                    sp.rotation_euler = q
                    tp = cyl(f"roll{i}spiketip{k}-{j}", 0.07, 0.13, (d.x * (r + 0.45), d.y * (r + 0.45), z),
                             M["spiketip"], r2=0.008, verts=10, parent=hub, bevel=0.0)
                    tp.rotation_euler = q
            continue
        if i == 0:                  # front: Flash's square bone block, tidy rows of low blunt pale pyramids (a waffle)
            from mathutils import Matrix
            for j in range(4):
                a = a0 + math.pi / 4 + j * math.pi / 2           # each flat face's middle
                d = Vector((math.cos(a), math.sin(a), 0))
                t = Vector((-d.y, d.x, 0))
                rot = (Matrix((t, Vector((0, 0, 1)), d)).transposed() @ Matrix.Rotation(math.pi / 4, 3, "Z")).to_euler()
                for k in range(8):
                    z = FRONT_X[0] + 0.26 + k * 0.44
                    if z > FRONT_X[1] - 0.15:
                        break
                    for c in (-0.175, 0.175):
                        g = 1.0 + rng.uniform(-0.06, 0.06)
                        tooth = cyl(f"roll{i}tooth{k}-{j}{c}", 0.2 * g, 0.19 * g, d * (rf - 0.01) + t * c +
                                    Vector((0, 0, z)), M["bone"], r2=0.075, verts=4, parent=hub, bevel=0.025)
                        tooth.rotation_euler = rot
            continue
        # back: Flash's slab face, a row of dark round sockets on each flat face with pale worn bosses between
        rr = (r + 0.14) * math.cos(math.pi / 6)              # the flat faces' distance from the axis
        for j in range(6):
            a = a0 + 2 * math.pi * j / 6
            d = Vector((math.cos(a), math.sin(a), 0))
            for k in range(8):
                z = -ROLL_X + 0.3 + k * 0.55 + rng.uniform(-0.05, 0.05)
                if z > ROLL_X - 0.2:
                    break
                h = cyl(f"roll{i}hole{j}-{k}", 0.13 * rng.uniform(0.8, 1.15), 0.04, (d.x * (rr - 0.02), d.y * (rr - 0.02), z),
                        M["hole"], verts=10, parent=hub, bevel=0.0)
                h.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
                if k < 7:
                    kit.blob(f"roll{i}boss{j}-{k}", (d.x * rr, d.y * rr, z + 0.27), 0.09 * rng.uniform(0.8, 1.2), 0.8,
                             M["bone"] if rng.random() < 0.7 else M["pale"], parent=hub)


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
    cyl("drumseam", r + 0.014, 0.13, c - u * (ln / 2) + u * (ln * 0.47), M["bonegap"], rot=rot, verts=48)   # the dark
    cyl("drumline", r + 0.008, 0.05, c - u * (ln / 2) + u * (ln * 0.86), M["groove"], rot=rot, verts=48)  # seam band
    for s_ in (-1, 1):                          # rolled rims at both ends, the near cap a dark rust boss
        cyl(f"drumrim{s_}", r + 0.02, 0.1, c + u * (s_ * ln / 2 - (0.12 if s_ > 0 else -0.02)), M["rust"], rot=rot,
            verts=48, bevel=0.03)
    cyl("drumcap", r - 0.2, 0.05, c + u * (ln / 2 - 0.01), M["rust"], rot=rot, verts=40, r2=r - 0.3)
    for k in range(2):                          # two chocks behind it keep it from rolling
        p = c + u * (ln * (0.3 if k else -0.3)) - Vector((0, 0, r))
        box(f"drumchock{k}", (0.3, 0.5, 0.2), (p.x, p.y + r * 0.62, 0.0), M["rust"],
            rot=(0, 0, math.degrees(math.atan2(u.y, u.x))), bevel=0.03)
    return e


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
        th, face, r0 = math.radians(SH3_TH), math.radians(-4), 3.82     # flat on the bowl's front right, as Flash
        wt, wb, z0, z1, lean = 3.25, 2.9, 2.0, 3.8, 0.0
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
    kit.mesh_ob("shield", bm, [M["rust"] if L < 3 else M["core"]], smooth=False, bevel=0.04, segs=2)
    if L < 3:                                   # the pale lines: a triangle from the top corners down to the point
        fr = [(-0.8, 0.9), (0.8, 0.9), (0.0, 0.16)]
        for k in range(3):
            sweep(f"shieldframe{k}", [at(*fr[k], 0.04), at(*fr[(k + 1) % 3], 0.04)], side, 0.07, 0.07, M["bone"],
                  bevel=0.02)
    else:                                       # the thick rust frame (proud of the panel), a pale line inside it
        fr = [(-1.0, 0.0), (1.0, 0.0), (1.0, 1.0), (-1.0, 1.0)]
        for k in range(4):                      # Flash: a thick orange-lit top and left edge, thinner right and foot
            a_, b_ = fr[k], fr[(k + 1) % 4]
            big = k in (2, 3)
            sweep(f"shieldframe{k}", [at(*a_, 0.06), at(*b_, 0.06)], out, 0.42 if big else 0.26, 0.4 if big else 0.3,
                  M["copper"] if big else M["rust"], bevel=0.06)
        fr = [(-0.7, 0.14), (0.7, 0.14), (0.72, 0.86), (-0.72, 0.86)]
        for k in range(4):
            sweep(f"shieldline{k}", [at(*fr[k], 0.03), at(*fr[(k + 1) % 4], 0.03)], out, 0.05, 0.06, M["bone"],
                  bevel=0.015)
        gear("shieldgear", 0.36, 9, 0.08, at(-0.38, 0.68, 0.06), M["copper"], out.to_track_quat("Z", "Y").to_euler(),
             tooth=0.24)
        kit.blob("shieldgearhub", at(-0.38, 0.68, 0.11), 0.1, 0.6, M["rust"])
    for u in (-0.85, 0.85):                     # brackets into the wall, bolts on the face
        for v in ((0.5, 0.88) if L < 3 else (0.2, 0.8)):
            p = at(u * 0.7, v, -0.22)
            q = Vector((p.x, p.y, 0)).normalized() * (wall_r(p.z) - 0.08) + Vector((0, 0, p.z))
            sweep(f"shieldbracket{u}{v}", [q, p], (0, 0, 1), 0.14, 0.12, M["rust"], bevel=0.02)
            kit.blob(f"shieldbolt{u}{v}", at(u * (0.9 if L < 3 else 1.0), v, 0.06 if L < 3 else 0.2), 0.07, 0.7,
                     M["bone"])
    if L >= 3:
        return
    # the rod from the point down to the plate
    top = at(0.0, 0.03, -0.11)
    sweep("shieldrod", [top, Vector((top.x, top.y, 0.12))], side, 0.12, 0.12, M["steel"], bevel=0.02)
    # the chain hanging from the right edge, from an eye under it; it sways a little (moving layer)
    top = at(0.98, 0.5, -0.11) - Vector((0, 0, 0.05))
    e = kit.bpy.data.objects.new("chain", None)
    link(e)
    e.location = top
    hub = kit.bpy.data.objects.new("chain-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    kit.blob("chaineye", top + Vector((0, 0, 0.03)), 0.08, 0.8, M["steel"])
    n = 7
    step = (top.z - 0.3) / n
    for k in range(n):
        lk = kit.bpy.data.objects.new(f"chainlink{k}", None)
        link(lk, hub)
        lk.location = (0, 0, -step * (k + 0.5))
        lk.rotation_euler = (0, 0, face + math.radians(90 * (k % 2)))
        tube(f"chainring{k}", [(0.06 * math.cos(2 * math.pi * j / 10), 0, step * 0.62 * math.sin(2 * math.pi * j / 10))
                               for j in range(10)], 0.025, M["pale"], parent=lk, verts=6, cyclic=True)


def plate():
    """The steel plate on the ground: a dark top inset in a pale bevelled rim, as Flash."""
    x, y = PLATE
    w = 1.9 if L < 3 else 2.4
    if L >= 3:                                  # under the hood's foot, reaching to the column
        x, y = x - 0.15, y - 0.6
    box("plate", (w, w * 0.9, 0.09), (x, y, 0), M["pale"], rot=(0, 0, 40), bevel=0.04)
    box("platetop", (w - 0.22, w * 0.9 - 0.22, 0.12), (x, y, 0), M["plate"], rot=(0, 0, 40), bevel=0.03)


def cog():
    """The cog, upright; it turns (moving layer). Level 1: small, on the plate, facing the camera's side, its axle in a
    block bolted to the plate. Level 3: big with a hub and holes, in front of the hood's foot, its axle into the hood."""
    r = 0.42 if L < 3 else 1.1
    zc = 0.12 + r + 0.08 if L < 3 else 2.0
    if L < 3:                                   # beside the shield's rod, under its point
        p = STATE["shield_at"](0.42, 0.0, 0.32)
        x, y = p.x, p.y
        face = Vector((1, -1, 0)).normalized()
    else:
        face = Vector((math.cos(math.radians(-4)), math.sin(math.radians(-4)), 0))
        x, y = 4.4, -0.57                       # Flash's place, in front of the plate's lower edge
    e = kit.bpy.data.objects.new("cog", None)
    link(e)
    e.location = (x, y, zc)
    e.rotation_euler = face.to_track_quat("Z", "Y").to_euler()
    hub = kit.bpy.data.objects.new("cog-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    cm = M["steel"] if L < 3 else M["cogsteel"]
    gear("cogwheel", r, 10 if L < 3 else 14, 0.16 if L < 3 else 0.22, (0, 0, 0), cm, (0, 0, 0), tooth=0.2,
         parent=hub)
    cyl("coghub", r * 0.32, 0.36, (0, 0, -0.18), cm, parent=hub, verts=16)
    rot = tuple(math.degrees(a) for a in face.to_track_quat("Z", "Y").to_euler())
    if L >= 3:
        for k in range(5):
            a = 2 * math.pi * k / 5
            kit.blob(f"coghole{k}", (r * 0.55 * math.cos(a), r * 0.55 * math.sin(a), 0.11), r * 0.13, 0.25, M["dark"],
                     parent=hub)
        cyl("cogaxle", 0.11, 0.5, (x - face.x * 0.38, y - face.y * 0.38, zc), M["steel"], rot=rot, verts=10)
        b = Vector((x, y, 0)) - face * 0.33     # its stand: a flat steel post on the ground plate up to a bearing,
        box("cogstand", (0.14, 0.42, zc - 0.05), (b.x, b.y, 0.1), M["steel"], rot=(0, 0, -4), bevel=0.03)   # clear
        cyl("cogbearing", 0.24, 0.12, (b.x - face.x * 0.06, b.y - face.y * 0.06, zc), M["steel"], rot=rot, verts=16,
            bevel=0.02)                         # of the plate's frame behind it
        return
    # the axle block behind it, on the plate
    b = Vector((x, y, 0)) - face * 0.35
    box("cogblock", (0.5, 0.36, zc + 0.2), (b.x, b.y, 0.1), M["rust"], rot=(0, 0, -45), bevel=0.04)
    cyl("cogaxle", 0.09, 0.5, (x - face.x * 0.4, y - face.y * 0.4, zc), M["steel"], rot=rot, verts=10)


# ------------------------------------------------------------------------------------------------ level 1: bucket
def bones_heap(name, parent, centre, w, d, n, seed, mat=None):
    r = kit.random.Random(seed)
    for i in range(n):
        p = Vector((centre[0] + r.uniform(-w, w), centre[1] + r.uniform(-d, d), centre[2] + r.uniform(0, 0.12)))
        ln = r.uniform(0.28, 0.45)
        a = r.uniform(0, math.pi)
        q = Vector((math.cos(a), math.sin(a), r.uniform(-0.3, 0.3))).normalized() * ln / 2
        tube(f"{name}{i}", [p - q, p + q], 0.045, mat or M["bone"], parent=parent, verts=8)
        for s in (-1, 1):
            kit.blob(f"{name}{i}k{s}", p + q * s * 1.05, 0.07, 0.8, mat or M["bone"], parent=parent)


def bucket_frame():
    """Two bone posts carry the bar: the left one on the back-left rim, the right one on a shoe bolted inside the
    rim; a dark iron paddle hangs from the left post down into the bowl (Flash's dark plate at the back left)."""
    for i, x in enumerate(POST_X):
        z0 = RIM_Z - 0.1 if i == 0 else RIM_Z - 0.35
        box(f"post{i}", (0.22, 0.26, BAR_Z + 0.2 - z0), (x, 0, z0), M["bone"], bevel=0.04)
    box("postshoe0", (0.44, 0.44, 0.16), (POST_X[0], 0, RIM_Z - 0.16), M["rust"], bevel=0.03)
    box("postshoe1", (0.62, 0.36, 0.2), (POST_X[1] + 0.12, 0, RIM_Z - 0.45), M["rust"], bevel=0.03)
    tube("bar", [(POST_X[0] - 0.1, 0, BAR_Z), (POST_X[1] + 0.1, 0, BAR_Z)], 0.07, M["bone"], verts=12)
    tube("poststrut", [(POST_X[0] + 0.05, 0.0, BAR_Z - 0.4), (-2.3, 2.2, RIM_Z - 0.04)], 0.06, M["bone"], verts=10)
    # the paddle: a dark iron blade on the left post's inner side, from under the bar down to the rollers
    box("paddle", (0.9, 0.12, 2.3), (POST_X[0] + 0.62, -0.25, ROLL_Z + 0.75), M["core"], rot=(0, 8, 0), bevel=0.05)
    box("paddlearm", (0.6, 0.1, 0.14), (POST_X[0] + 0.3, -0.2, BAR_Z - 0.75), M["rust"], bevel=0.02)


def bucket():
    e = kit.bpy.data.objects.new("bucket", None)
    link(e)
    e.location = (BUCKET_X, 0, BAR_Z)
    hub = kit.bpy.data.objects.new("bucket-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    W, D, H = 1.85, 1.65, 1.2
    zb = -1.0                                   # its floor below the bar (the bar runs through its sides)
    t = 0.08
    box("bucketfloor", (W, D, t), (0, 0, zb), M["rust"], parent=hub, bevel=0.025)
    for s in (-1, 1):
        box(f"bucketside{s}", (t, D, H), (s * (W - t) / 2, 0, zb), M["rust"], parent=hub, bevel=0.025)
        box(f"bucketend{s}", (W - 2 * t, t, H), (0, s * (D - t) / 2, zb), M["rust"], parent=hub, bevel=0.025)
        box(f"bucketlip{s}", (W + 0.06, 0.1, 0.1), (0, s * (D - 0.02) / 2, zb + H - 0.08), M["copper"], parent=hub,
            bevel=0.02)
    fill = kit.bpy.data.objects.new("bucketfill", None)
    link(fill, hub)
    box("bucketfillbed", (W - 0.2, D - 0.2, 0.7), (0, 0, zb + 0.05), M["bonedark"], parent=fill, bevel=0.05)
    bones_heap("bucketbone", fill, (0, 0, zb + 0.75), 0.6, 0.5, 9, 11)
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
HOP_C = Vector((-1.161, 2.01, 7.25))
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
    qb("hopperback", (0.0, 0.0, 0.24), W, t, D - 0.24, M["hopside"])
    qb("hopperend0", (0.0, 0.0, 0.24), t, Lc, D - 0.24, M["hopside"])
    qb("hopperend1", (W - t, 0.0, 0.24), t, Lc, D - 0.24, M["hopside"])
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
    n = 6
    for k in range(n):
        quad_box(f"hopperboard{k}", o + w * ((k + 0.03) / n), w * (0.94 / n), ln * (1.0 - kit.rng.uniform(0.0, 0.05)),
                 -up * 0.1, M["planks"], parent=hub, bevel=0.02)
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
        if n.startswith("roll"):
            hub.rotation_euler = (0, 0, math.radians(-2 * 360.0 * f / (1 if L < 3 else 1)))
        elif n == "cog":
            hub.rotation_euler = (0, 0, math.radians(360.0 * f))
        elif n == "chain":
            hub.rotation_euler = (math.radians(3.0 * math.sin(2 * math.pi * f)), 0, 0)
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
