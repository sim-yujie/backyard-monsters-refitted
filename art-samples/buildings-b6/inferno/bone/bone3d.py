"""bone3d.py : the Inferno Bone Cruncher (Inferno type 1) as a 3D model, on the approved Twig / Putty recipe (../kit.py):
Flash's shapes and colours at full size, matte painted finish, no outline, one body for both looks.

    blender -b --factory-startup -P bone3d.py -- <level> fit [frame]   work/fit-L<level>.png  quick silhouette, 4 px/px
    blender -b --factory-startup -P bone3d.py -- <level> still    render/L<level>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P bone3d.py -- <level> anim     render/L<level>-parts-NN.png, one per Flash frame
    blender -b --factory-startup -P bone3d.py -- <level> check    CHECK / CLEAR lines (parts that overlap)
    blender -b --factory-startup -P bone3d.py -- <level> gap      GAP lines (parts that look as if they touch)

Flash has two looks: level 1 (levels 1-2) and level 3 (levels 3-10). The body at both: the verdigris iron crusher bowl
on its foot, three crusher rollers inside, the ribbed bone horn on the bowl's left, the rusty copper drum on the ground
at the front, the rust shield bolted to the bowl's front right and the steel plate on the ground under it.
Level 1: two bone posts on the rim carry a bar with the tipping bucket of bones; the rollers carry square bone teeth; a
small cog on the plate. Level 3 (Flash redraws the crusher here): a band round the bowl, the rollers carry iron spikes,
a steel column on the plate swings a big rust hopper on an arm, a big cog on the plate, a bigger shield.

Animation, as Flash (47 frames at level 1, 50 at level 3): level 1, the bucket turns once round the bar, tipping its
bones onto the rollers; level 3, the hopper swings up and back, then tips forward and pours its bones. At both the
rollers turn and the cog turns; the falling bones and the dust are the moving layer. Nothing else moves.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402
from kit import Vector, box, cyl, lathe, tube, ring, sweep, gear, blob, painted, flat, link, srgb  # noqa: E402

L = kit.L
kit.OUT = HERE
kit.ORIGIN = (-2.0, 31.5) if L < 3 else (2.0, 39.0)   # Flash pixel of the bowl axis on the ground: Flash draws level 3 4 px right, 7.5 lower
kit.FRAME = (-56, -48, 56, 68)
kit.FRAMES = 47 if L < 3 else 50
kit.SUN, kit.SUN_COL = 5.2, (1.0, 0.9, 0.78)      # Flash's Inferno light: warm, a darker fill
kit.SKY, kit.SKY_E = (0.7, 0.6, 0.55), 0.32
FR = kit.FRAMES
rng = kit.rng

# ------------------------------------------------------------------------------------------------ the body's sizes
FOOT = [(3.0, 0.0), (3.03, 0.06), (3.0, 0.22), (2.88, 0.26), (2.88, 0.42), (2.72, 0.46), (2.62, 0.62)]   # two low steps
BOWL = [(2.62, 0.62), (2.72, 0.72), (2.86, 0.86), (2.98, 1.1), (3.06, 1.5), (3.12, 2.1), (3.16, 2.7), (3.2, 3.25)]
RIM_Z, RIM_R = 3.42, 3.24             # the rolled lip
IN_R, FLOOR_Z = 3.0, 1.55             # inside wall and floor
ROLL_Y, ROLL_Z, ROLL_R = (-1.15, 0.0, 1.15), 2.82, 0.36
POST_X, BAR_Z = (-3.2, 2.75), 6.05     # level 1: the posts on the rim (Y 0) and the bar along X
HORN = (-2.66, -2.5)                 # the horn's axis (X, Y), on the bowl's left
DRUM = (-0.1, -3.78, 0.8, 2.7)      # the drum: middle X, Y, radius, length (along X)
PLATE = (3.5, 0.3)                  # the steel plate's middle on the ground
COLUMN = (3.05, 2.1)                   # level 3: the steel column
SH3_TH = -14.0                        # level 3: where the hood stands round the bowl (deg)


def mats():
    """Flash's Inferno finish: dark, grimy and worn, strong wear on the edges; verdigris iron, rust, copper, old bone."""
    m = {}
    m["iron"] = painted("iron", (15, 32, 28), rough=0.66, metal=0.25, wear=(40, 74, 64), rust=(50, 30, 18),
                        scale=5.0, dirt=0.75, spec=0.28, soot=0.85, rust_at=0.5, grain=0.35)
    m["band"] = painted("band", (20, 52, 46), rough=0.62, metal=0.3, wear=(36, 82, 72), rust=(52, 32, 20), scale=16,
                        dirt=0.55, spec=0.3, soot=0.7, rust_at=0.58, grain=0.35)
    m["lip"] = painted("lip", (30, 82, 70), rough=0.5, metal=0.3, wear=(90, 160, 138), rust=(56, 36, 22), scale=6,
                       dirt=0.35, spec=0.35, soot=0.5, rust_at=0.6, grain=0.25)
    m["inside"] = painted("inside", (16, 18, 16), rough=0.9, wear=(34, 32, 28), scale=3, dirt=0.0, spec=0.1)
    m["rust"] = painted("rust", (104, 38, 14), rough=0.66, metal=0.15, wear=(190, 92, 38), rust=(44, 18, 8),
                        scale=6.0, dirt=0.45, spec=0.3, soot=0.75, rust_at=0.5, grain=0.4)
    m["copper"] = painted("copper", (150, 58, 20), rough=0.6, metal=0.2, wear=(210, 110, 48), rust=(66, 26, 10),
                          scale=5.0, dirt=0.5, spec=0.35, soot=0.6, rust_at=0.55, grain=0.35)
    m["bone"] = painted("bone", (176, 154, 116), rough=0.75, wear=(222, 204, 166), rust=(92, 72, 46), scale=6,
                        dirt=0.45, spec=0.25, soot=0.55, rust_at=0.55, grain=0.3)
    m["hornbone"] = painted("hornbone", (116, 104, 88), rough=0.72, wear=(150, 138, 116), rust=(96, 58, 30), scale=14,
                            dirt=0.4, spec=0.25, soot=0.65, rust_at=0.6, grain=0.35)
    m["bonedark"] = painted("bonedark", (84, 70, 52), rough=0.8, wear=(128, 110, 82), scale=5, dirt=0.3, spec=0.2)
    m["spike"] = painted("spike", (92, 90, 88), rough=0.42, metal=0.55, wear=(196, 192, 182), rust=(70, 46, 30),
                         scale=8, dirt=0.25, spec=0.5, soot=0.4, rust_at=0.62, grain=0.2)
    m["core"] = painted("core", (9, 8, 8), rough=0.95, metal=0.1, wear=(26, 24, 22), scale=6, dirt=0.3, spec=0.12)
    m["planks"] = kit.wood("planks", (118, 46, 18), (80, 30, 12), axis="Y", rings=4, dirt=0.6)    # dark rusty boards
    m["pale"] = painted("pale", (150, 152, 144), rough=0.5, metal=0.4, wear=(206, 206, 196), rust=(80, 60, 44),
                        scale=6, dirt=0.3, spec=0.4, rust_at=0.66)
    m["steel"] = painted("steel", (74, 76, 78), rough=0.48, metal=0.5, wear=(160, 160, 154), rust=(62, 42, 30),
                         scale=6, dirt=0.4, spec=0.4, soot=0.6, rust_at=0.6, grain=0.25)
    m["plate"] = painted("plate", (36, 46, 44), rough=0.6, metal=0.3, wear=(120, 132, 124), rust=(58, 40, 28),
                         scale=5, dirt=0.0, spec=0.3, top=(64, 76, 72), grain=0.3)
    m["dark"] = flat("dark", (12, 10, 9), rough=0.9)
    m["hole"] = flat("hole", (5, 4, 4), rough=1.0)
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
    return at_r(FOOT + BOWL, z)


# ------------------------------------------------------------------------------------------------ the bowl
def bowl():
    lathe("bowlfoot", [(0.0, 0.0)] + FOOT[:6] + [(0.0, 0.46)], (0, 0, 0), M["steel"], verts=64)   # the grey steps
    lathe("bowlneck", [(0.0, 0.46)] + FOOT[5:] + [(0.0, 1.0)], (0, 0, 0), M["iron"], verts=64)
    prof = BOWL + [(RIM_R - 0.06, 3.3), (RIM_R, RIM_Z - 0.06), (RIM_R - 0.08, RIM_Z + 0.02), (IN_R + 0.04, RIM_Z),
                   (IN_R, 3.2)]
    lathe("bowl", prof, (0, 0, 0), M["iron"], verts=72)
    lathe("bowlin", [(IN_R, 3.22), (IN_R - 0.08, 2.4), (IN_R - 0.4, 1.8), (2.0, FLOOR_Z), (0.0, FLOOR_Z)],
          (0, 0, 0), M["inside"], verts=72)
    ring("bowllip", RIM_R - 0.02, 0.09, M["lip"], z=RIM_Z - 0.06, n=72)
    if L >= 3:                                 # level 3: a riveted band round the bowl's belly
        lathe("bowlband", [(3.1, 2.1), (3.36, 2.18), (3.44, 2.45), (3.36, 2.72), (3.12, 2.8)], (0, 0, 0), M["band"],
              verts=72)
        for i in range(18):
            a = 2 * math.pi * (i + 0.5) / 18
            kit.blob(f"bowlrivet{i}", (3.38 * math.cos(a), 3.38 * math.sin(a), 2.45), 0.07, 0.9, M["iron"])


# ------------------------------------------------------------------------------------------------ the rollers
def rollers():
    """Three rollers along X, their axles into the inside wall. Level 1: square bone teeth in rings; level 3: iron
    spikes. They turn (the moving layer)."""
    for i, y in enumerate(ROLL_Y):
        half = math.sqrt(IN_R ** 2 - y ** 2) - 0.12
        e = kit.bpy.data.objects.new(f"roll{i}", None)
        link(e)
        e.location = (0, y, ROLL_Z)
        e.rotation_euler = (0, math.radians(90), 0)          # local Z along world X
        hub = kit.bpy.data.objects.new(f"roll{i}-spin", None)
        link(hub, e)
        kit.MOVING.append(hub)
        cyl(f"roll{i}core", ROLL_R, 2 * half, (0, 0, -half), M["core"], parent=hub, verts=20)
        n_rings = 3 if L >= 3 else int((2 * half - 0.5) / 0.42) + 1
        for k in range(n_rings):
            if L >= 3:                           # spikes kept clear of the wall, staggered between the rollers
                z = -1.45 + 0.6 * (i % 2) + k * 1.2
            else:                                # rings half a step apart on neighbouring rollers
                z = -half + 0.45 + 0.21 * (i % 2) + k * 0.42
                if z > half - 0.45:
                    continue
            nj = 4 if L >= 3 else 8
            for j in range(nj):
                a = 2 * math.pi * (j + (0.5 * (k % 2) + 0.3 * i if L >= 3 else 0.5 * (i % 2))) / nj
                d = Vector((math.cos(a), math.sin(a), 0))
                if L >= 3:
                    sp = cyl(f"roll{i}spike{k}-{j}", 0.27, 0.7, (d.x * (ROLL_R - 0.03), d.y * (ROLL_R - 0.03), z),
                             M["spike"], r2=0.015, verts=8, parent=hub, bevel=0.0)
                    sp.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
                elif (j + k) % 2 == 0:                   # level 1: a checker of flat bone teeth and steel spikes
                    t = box(f"roll{i}tooth{k}-{j}", (0.2, 0.28, 0.3), (0, 0, 0), M["bone"], parent=hub, bevel=0.025,
                            origin="centre")
                    t.location = (d.x * (ROLL_R + 0.04), d.y * (ROLL_R + 0.04), z)
                    t.rotation_euler = (0, 0, a)
                else:
                    sp = cyl(f"roll{i}spike{k}-{j}", 0.15, 0.27, (d.x * (ROLL_R - 0.02), d.y * (ROLL_R - 0.02), z),
                             M["pale"], r2=0.01, verts=4, parent=hub, bevel=0.0)
                    sp.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


# ------------------------------------------------------------------------------------------------ the horn
def horn():
    """The ribbed bone horn on the bowl's left: a cup of stacked rings, wide at the top, on a bracket from the wall."""
    x, y = HORN
    z0, z1 = (3.55, 6.15) if L < 3 else (2.95, 6.15)
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
    x, y, r, ln = DRUM
    e = cyl("drum", r, ln, (x - ln / 2, y, r), M["copper"], rot=(0, 90, 0), verts=40, bevel=0.06)
    for f in (0.14, 0.86):                      # rolled hoops
        c = x - ln / 2 + ln * f
        cyl(f"drumhoop{f}", r + 0.05, 0.14, (c - 0.07, y, r), M["rust"], rot=(0, 90, 0), verts=40, bevel=0.03)
    for side in (-1, 1):                        # domed end caps, proud of the ends
        cyl(f"drumcap{side}", r - 0.1, 0.06, (x + side * ln / 2 - (0.0 if side > 0 else 0.06), y, r),
            M["rust"], rot=(0, 90, 0), verts=32, r2=r - 0.22 if side > 0 else None)
    if L >= 3:                                  # level 3: riveted plates
        for k in range(10):
            a = 2 * math.pi * k / 10
            for f in (0.12, 0.88):
                c = x - ln / 2 + ln * f
                kit.blob(f"drumrivet{k}{f}", (c, y + (r + 0.09) * math.cos(a), r + (r + 0.09) * math.sin(a)), 0.05,
                         0.9, M["rust"])
    return e


# ------------------------------------------------------------------------------------------------ shield, plate, cog
def shield():
    """The rust shield on the bowl's front right, standing off the wall on brackets. Level 1: Flash's pointed shield,
    thick, leaning out, a pale triangle of lines down to its point; a steel rod from the point down to the plate, a
    chain hanging from its right edge, the cog beside the rod. Level 3 (Flash redraws it): a bigger hood, its foot low
    by the bowl's foot and its top leaning out over the band; a thick rust frame round a dark panel with a pale inner
    line and a small copper gear."""
    if L < 3:
        th, face, r0 = math.radians(-8), math.radians(-6), 3.4
        wt, wb, z0, z1, lean = 3.0, 3.0, 0.95, 4.1, 0.5
        shape = [(-1, 0.5), (0, 0), (1, 0.5), (1, 1), (-1, 1)]
    else:
        th, face, r0 = math.radians(SH3_TH), math.radians(-6), 3.36
        wt, wb, z0, z1, lean = 2.7, 2.4, 0.75, 3.7, 0.85
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
    kit.mesh_ob("shield", bm, [M["rust"] if L < 3 else M["iron"]], smooth=False, bevel=0.04, segs=2)
    if L < 3:                                   # the pale lines: a triangle from the top corners down to the point
        fr = [(-0.8, 0.9), (0.8, 0.9), (0.0, 0.16)]
        for k in range(3):
            sweep(f"shieldframe{k}", [at(*fr[k], 0.04), at(*fr[(k + 1) % 3], 0.04)], side, 0.07, 0.07, M["bone"],
                  bevel=0.02)
    else:                                       # the thick rust frame (proud of the panel), a pale line inside it
        fr = [(-1.0, 0.0), (1.0, 0.0), (1.0, 1.0), (-1.0, 1.0)]
        for k in range(4):
            a_, b_ = fr[k], fr[(k + 1) % 4]
            sweep(f"shieldframe{k}", [at(*a_, 0.06), at(*b_, 0.06)], out, 0.24, 0.34, M["rust"], bevel=0.05)
        fr = [(-0.7, 0.14), (0.7, 0.14), (0.72, 0.86), (-0.72, 0.86)]
        for k in range(4):
            sweep(f"shieldline{k}", [at(*fr[k], 0.03), at(*fr[(k + 1) % 4], 0.03)], out, 0.05, 0.06, M["bone"],
                  bevel=0.015)
        gear("shieldgear", 0.36, 9, 0.08, at(-0.38, 0.68, 0.06), M["copper"], out.to_track_quat("Z", "Y").to_euler(),
             tooth=0.24)
        kit.blob("shieldgearhub", at(-0.38, 0.68, 0.11), 0.1, 0.6, M["rust"])
    for u in (-0.85, 0.85):                     # brackets into the wall, bolts on the face
        for v in ((0.5, 0.88) if L < 3 else (0.55, 0.9)):
            p = at(u * 0.7, v, -0.22)
            q = Vector((p.x, p.y, 0)).normalized() * (wall_r(p.z) - 0.08) + Vector((0, 0, p.z))
            sweep(f"shieldbracket{u}{v}", [q, p], (0, 0, 1), 0.14, 0.12, M["rust"], bevel=0.02)
            kit.blob(f"shieldbolt{u}{v}", at(u * (0.9 if L < 3 else 1.0), v, 0.06 if L < 3 else 0.2), 0.07, 0.7,
                     M["bone"])
    if L >= 3:                                  # its foot stands on the plate on two shoes
        for u in (-0.75, 0.75):
            f = at(u, 0.0, -0.07)
            box(f"shieldshoe{u}", (0.36, 0.3, max(0.05, f.z - 0.1)), (f.x, f.y, 0.1), M["rust"], rot=(0, 0, -10),
                bevel=0.03)
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
    w = 1.9 if L < 3 else 2.8
    if L >= 3:                                  # under the hood's foot, reaching to the column
        x, y = x - 0.15, y - 0.6
    box("plate", (w, w * 0.9, 0.09), (x, y, 0), M["pale"], rot=(0, 0, 40), bevel=0.04)
    box("platetop", (w - 0.22, w * 0.9 - 0.22, 0.12), (x, y, 0), M["plate"], rot=(0, 0, 40), bevel=0.03)


def cog():
    """The cog, upright; it turns (moving layer). Level 1: small, on the plate, facing the camera's side, its axle in a
    block bolted to the plate. Level 3: big with a hub and holes, in front of the hood's foot, its axle into the hood."""
    r = 0.42 if L < 3 else 0.86
    zc = 0.12 + r + 0.08
    if L < 3:                                   # beside the shield's rod, under its point
        p = STATE["shield_at"](0.42, 0.0, 0.32)
        x, y = p.x, p.y
        face = Vector((1, -1, 0)).normalized()
    else:
        at = STATE["shield_at"]
        face = Vector((math.cos(math.radians(-16)), math.sin(math.radians(-16)), 0))
        p = at(0.3, (zc - 0.75) / (3.7 - 0.75), 0.0) + face * 0.45
        x, y = p.x, p.y
    e = kit.bpy.data.objects.new("cog", None)
    link(e)
    e.location = (x, y, zc)
    e.rotation_euler = face.to_track_quat("Z", "Y").to_euler()
    hub = kit.bpy.data.objects.new("cog-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    gear("cogwheel", r, 10 if L < 3 else 14, 0.16 if L < 3 else 0.22, (0, 0, 0), M["steel"], (0, 0, 0), tooth=0.2,
         parent=hub)
    cyl("coghub", r * 0.32, 0.36, (0, 0, -0.18), M["steel"], parent=hub, verts=16)
    rot = tuple(math.degrees(a) for a in face.to_track_quat("Z", "Y").to_euler())
    if L >= 3:
        for k in range(5):
            a = 2 * math.pi * k / 5
            kit.blob(f"coghole{k}", (r * 0.55 * math.cos(a), r * 0.55 * math.sin(a), 0.11), r * 0.13, 0.25, M["dark"],
                     parent=hub)
        cyl("cogaxle", 0.11, 0.5, (x - face.x * 0.45, y - face.y * 0.45, zc), M["steel"], rot=rot, verts=10)
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
    box("paddle", (0.9, 0.12, 2.3), (POST_X[0] + 0.62, -0.25, ROLL_Z + 0.75), M["iron"], rot=(0, 8, 0), bevel=0.05)
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
    cyl("column", 0.17, PIV_Z + 0.4, (x, y, 0.12), M["steel"], verts=20, bevel=0.03)
    for z in (0.12, 1.55, 4.4):
        cyl(f"columncollar{z}", 0.27, 0.22, (x, y, z), M["steel"], verts=20, bevel=0.04)
    cyl("columnfoot", 0.42, 0.18, (x, y, 0.12), M["rust"], verts=20, bevel=0.04)
    cyl("columnhead", 0.32, 0.62, (x, y, PIV_Z - 0.31), M["steel"], verts=20, bevel=0.04)
    for k, z in enumerate((PIV_Z - 0.62, PIV_Z - 0.86, PIV_Z - 1.1)):
        cyl(f"columnstack{k}", 0.36 - 0.03 * k, 0.2, (x, y, z), M["steel"], verts=20, bevel=0.05)
    cyl("columncap", 0.22, 0.2, (x, y, PIV_Z + 0.31), M["steel"], r2=0.1, verts=16, bevel=0.03)


BUCKET_X = -0.5
PIV_Z = 7.0
AXLE = (1.45, 7.0)                    # level 3: the hopper's axle (Y, Z), along X
HOP_X, HOP_W, HOP_D, SLOT = (-1.45, 2.4), 2.25, 1.6, 0.6       # the hopper's length (from the axle), width, depth


def hopper():
    """Level 3's bucket: a closed plank box along X, open on one long side (its mouth), hung on an axle along the
    back top edge of its lid. At rest it hangs tipped toward the camera: the lid's broad back is its top and the mouth,
    with the plank floor inside, faces the camera. It swings up and back to fill, then tips forward and pours its bones
    onto the rollers. Its right end is held by an arm from the column's head. Local X = world X; local Z up when the
    mouth faces up (angle 0)."""
    x, y = COLUMN
    ya, za = AXLE
    e = kit.bpy.data.objects.new("hopper", None)
    link(e)
    e.location = (0, ya, za)
    hub = kit.bpy.data.objects.new("hopper-spin", None)
    link(hub, e)
    kit.MOVING.append(hub)
    t = 0.1
    x0, x1 = HOP_X
    xm, ln = (x0 + x1) / 2, x1 - x0
    yb, yf = 0.15, 0.15 - HOP_W                 # the box's lid (back) and its floor's far edge (local Y)
    ym = (yb + yf) / 2
    zf = -HOP_D + 0.15                          # its bottom
    box("hopperfloor", (ln, HOP_W, t), (xm, ym, zf), M["planks"], parent=hub, bevel=0.03)
    for s, x_ in ((-1, x0), (1, x1)):
        box(f"hopperend{s}", (t, HOP_W, HOP_D), (x_ - s * t / 2, ym, zf), M["rust"], parent=hub, bevel=0.03)
    box("hopperlid", (ln, t, HOP_D), (xm, yb - t / 2, zf), M["rust"], parent=hub, bevel=0.03)
    box("hopperfront", (ln, t, HOP_D * 0.55), (xm, yf + t / 2, zf), M["rust"], parent=hub, bevel=0.03)
    cw = HOP_W - SLOT                           # the plank cover over the mouth, open in a slot along its far edge
    box("hoppercover", (ln - 2 * t, cw, t), (xm, yb - cw / 2, zf + HOP_D - t), M["rust"], parent=hub, bevel=0.03)
    for f in (0.1, 0.5, 0.9):                   # copper straps round it
        xx = x0 + ln * f
        box(f"hopperribb{f}", (0.14, 0.06, HOP_D), (xx, yb + 0.03, zf), M["copper"], parent=hub, bevel=0.02)
        box(f"hopperribf{f}", (0.14, 0.06, HOP_D * 0.55), (xx, yf - 0.03, zf), M["copper"], parent=hub, bevel=0.02)
        box(f"hopperribu{f}", (0.14, HOP_W + 0.12, 0.06), (xx, ym, zf - 0.06), M["copper"], parent=hub, bevel=0.02)
    box("hopperlip", (ln + 0.1, 0.16, 0.12), (xm, yb - cw, zf + HOP_D - 0.12), M["copper"], parent=hub,
        bevel=0.03)
    box("hopperflip", (ln + 0.1, 0.16, 0.12), (xm, yf - 0.02, zf + HOP_D * 0.55 - 0.06), M["copper"], parent=hub,
        bevel=0.03)
    for s, x_ in ((-1, x0), (1, x1)):          # axle stubs out of both ends
        cyl(f"hopperstub{s}", 0.11, 0.34, (x_ + (0.0 if s > 0 else -0.34), 0, 0), M["steel"], rot=(0, 90, 0),
            parent=hub, verts=12)
    fill = kit.bpy.data.objects.new("hopperfill", None)
    link(fill, hub)
    box("hopperfillbed", (ln - 0.25, HOP_W - 0.25, 0.6), (xm, ym, zf + 0.05), M["bonedark"], parent=fill, bevel=0.05)
    bones_heap("hopperbone", fill, (xm, ym, zf + 0.68), ln / 2 - 0.3, HOP_W / 2 - 0.3, 12, 12)
    # the arm from the column's head to the right stub
    sweep("arm", [Vector((x, y, za)), Vector((x1 + 0.36, ya, za))], (0, 0, 1), 0.22, 0.28, M["rust"], bevel=0.04)
    cyl("armboss", 0.21, 0.36, (x1 + 0.32, ya, za), M["steel"], rot=(0, 90, 0), verts=16)
    STATE["mouth"] = lambda: hub.matrix_world @ Vector((xm, yf + SLOT / 2, zf + HOP_D))
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


def tip_angle(f):
    """Level 1: the bucket's turn about the bar (deg, toward the front), once round in the loop. Level 3: the hopper's
    swing about its axle: up and back, then forward to pour, then back to rest."""
    if L < 3:
        return 360.0 * f
    keys = [(0.0, 55.0), (0.1, 12.0), (0.3, 8.0), (0.45, 78.0), (0.75, 86.0), (0.9, 55.0), (1.0, 55.0)]
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
        tip.rotation_euler = (math.radians(a), 0, 0)
        pouring = 0.42 <= f <= 0.75
        empty = f >= 0.62 or f < 0.06
        kit.bpy.context.view_layer.update()
        src = STATE["mouth"]()
    STATE["fill"].hide_render = empty
    for o in STATE["fill"].children_recursive:
        o.hide_render = empty
    for b, dx, dy, ph, spin in FALL:
        t0 = 0.22 if L < 3 else 0.42
        span = 0.28 if L < 3 else 0.33
        u = (f - t0) / span - ph * 0.6
        show = pouring and 0.0 <= u <= 0.4
        z = src.z - 9.0 * u * u * 1.6
        if z < ROLL_Z + 0.35:
            show = False
        b.location = (src.x + dx, src.y + dy - (1.3 * max(0.0, u) if L >= 3 else 0.0), z)
        b.rotation_euler = (spin + 6 * u, spin * 0.5, spin)
        if not show:                            # parked out of sight (and out of the clipping check)
            b.location = (0, 0, -50 - 2 * dx)
        b.hide_render = not show
        for o in b.children:
            o.hide_render = not show
    land = Vector((0.35, 1.0, ROLL_Z + 0.9)) if L >= 3 else Vector((0.0, -0.6, ROLL_Z + 0.9))
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
