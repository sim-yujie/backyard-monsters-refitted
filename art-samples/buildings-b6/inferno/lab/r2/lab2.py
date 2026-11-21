"""lab2.py : the Infernal Monster Lab, ROUND 2 first looks (21 Nov 2026). The owner on round 1 (lab.py: still, tube
furnace, specimen tank): "Maybe something closer to how the lab looks in overworld? But inferno themed."  So these
level-1 looks are the SURFACE Monster Lab's own model (art/buildings-3d-lab 713a8b693, lab-v1/lab.py: its plan, its
two pentagon tiers, decks, gold columns, door, side doors, glass dome, glass pipes, three bells and wires, copied here
measure for measure) rebuilt in the Inferno's materials, worn and sooty, through the Inferno kit's camera, light and
render modes (../../kit.py, untouched; the same camera as the surface Lab's: checked by overlay, see overlay.py).

    LAB_VAR=g|d|e|f blender -b --factory-startup -P lab2.py -- 1 <fit|base|check|gap>     (run.sh takes the GPU lock)

  g  the surface Lab's shapes in one flat grey: only for the outline check against the surface Lab's game picture.
  d  "Iron Lab": the close copy. Every surface part in its place: charred blue-black iron walls, rusted plate decks,
     sooty brass columns, iron bells with copper coils and wires, a dome of molten brew, lava in the glass pipes, the
     maze door's grooves glowing, iron cogs in the side doors.
  e  "Bone and Brimstone": the same shape with more Inferno parts: the lower tier cracked basalt with magma in the
     cracks, the columns stacks of bone, the wires two big horns curving from the small bells to the top, a dome of
     green brew, lava vats in place of the side cogs, iron spikes on the deck corners.
  f  "Copper Works": the same shape clad in the Inferno Academy's blackened copper, with a violet brew, spikes on the
     bells in place of the coils, and basalt rubble at its foot.

Nothing moves in these first looks. In the game the dome's brew and the side cogs (d, f) or the vats' lava (e) would
animate, as the surface Lab's dome and cogs.

World: Z up. The camera looks from +X -Y. The plan is given in screen-plan (u, v): u = X + Y across the screen, v =
X - Y toward the viewer; the building is mirror-symmetric on screen: (u, v) -> (-u, v), i.e. (X, Y) -> (-Y, -X).
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
sys.path.insert(0, str(HERE.parent.parent))
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402
import imats  # noqa: E402
from kit import box, cyl, gear, lathe, mesh_ob, tube  # noqa: E402

VAR = os.environ.get("LAB_VAR", "d")
kit.OUT = HERE / VAR
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (0.0, 45.0)                 # the surface Monster Lab's origin (lab-v1/lab.py: (-0.5, 45))
kit.FRAME = (-86, -104, 150, 96)         # the surface Monster Lab's canvas, wider and deeper for the whole shadow
kit.FRAMES = 1
kit.SUN_COL = (1.0, 0.93, 0.82)          # as the Incubator, Strongbox and Academy
M = {}

# ------------------------------------------------------------------------------------------------------------ the plan
# (the surface Lab's, unchanged)
LW_Z = 4.6                                  # the lower walls' height (the lower deck's underside)
LD_Z0, LD_Z1 = 4.6, 5.27                    # the lower deck
UD_Z0, UD_Z1 = 9.0, 9.6                     # the upper deck
LW = [(-8.9, 0.0), (-3.6, 2.8), (-3.0, 2.8), (-3.0, 1.2), (3.0, 1.2), (3.0, 2.8), (3.6, 2.8), (8.9, 0.0), (0.0, -7.0)]
LD = [(-9.35, 0.0), (-5.2, 3.75), (5.2, 3.75), (9.35, 0.0), (0.0, -7.6)]
UW = [(-5.35, 0.0), (-4.75, 1.9), (-3.5, 1.9), (-3.5, -3.3), (3.5, -3.3), (3.5, 1.9), (4.75, 1.9), (5.35, 0.0),
      (0.0, -5.2)]
UD = [(-7.5, 0.0), (-6.6, 2.3), (6.6, 2.3), (7.5, 0.0), (0.0, -5.8)]
COIL_UV = (-3.6, 3.0)                       # the left gold column (the right one mirrored)
DOOR_F, DOOR_W = 0.36, 1.5                  # the left side door: how far along the left face (from the corner), width
PL_C, PL_H, PL_Z = (-0.7, 0.7), 1.6, 9.84   # the plinth board under the big bell: middle, half side, top
DOME_UV, DOME_R = (0.3, 0.25), 2.08         # the glass dome on the lower deck, in the upper recess
PIPE_F, PIPE_Z, PIPE_OUT = 0.5, 7.7, 1.25   # the glass pipe: how far along the upper left face, height, reach
BELL_S = (-3.82, 0.6)                       # the left small bell on the upper deck (the right one mirrored)


def uv(u, v):
    return ((u + v) / 2, (u - v) / 2)


def mir(p):
    """The mirror image across the building's screen axis."""
    return (-p[1], -p[0]) + tuple(p[2:])


def xy(poly):
    return [uv(u, v) for u, v in poly]


def prism(name, pts, z0, z1, mat, bevel=0.04, side_mat=None):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z0)) for x, y in pts]
    f = bm.faces.new(vs)
    if f.normal.z > 0:
        f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z = z1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mats = [mat]
    if side_mat:                                    # the upright faces get the second material
        for fc in bm.faces:
            fc.material_index = 1 if abs(fc.normal.z) < 0.5 else 0
        mats = [mat, side_mat]
    return mesh_ob(name, bm, mats, smooth=False, bevel=bevel, segs=2)


def studs(name, pts, r, mat, squash=0.6):
    """Many rivet heads in one mesh: flattened half balls at pts, each facing its normal (pt = (pos, normal))."""
    bm = bmesh.new()
    for p, n in pts:
        m = Matrix.Translation(Vector(p)) @ Vector(n).to_track_quat("Z", "Y").to_matrix().to_4x4() @ \
            Matrix.Diagonal((r, r, r * squash, 1))
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0, matrix=m)
    return mesh_ob(name, bm, [mat], smooth=True)


def face(a, b):
    """A wall face from XY point a to b: its tangent, outward normal and turn (degrees)."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    n = Vector((t.y, -t.x))
    return a, b, t, n, math.degrees(math.atan2(t.y, t.x))


def edge_pts(a, b, n, z, out, inset=0.18):
    a, b, t, nrm, _ = face(a, b)
    pts = []
    for i in range(n):
        f = inset + (1 - 2 * inset) * (i + 0.5) / n if n > 1 else 0.5
        p = a.lerp(b, f)
        pts.append(((p.x + nrm.x * out, p.y + nrm.y * out, z), (nrm.x, nrm.y, 0)))
    return pts


def faces_of(pts):
    return list(zip(pts, pts[1:] + pts[:1]))


def widen(poly, d):
    """The outline pushed out by d (each edge moved along its normal; corners where the moved edges meet)."""
    k = len(poly)
    lines = []
    for a, b in faces_of(poly):
        a, b, t, n, _ = face(a, b)
        lines.append((a + n * d, t))
    out = []
    for i in range(k):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        if abs(den) < 1e-6:
            out.append(tuple(p2))
            continue
        s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        out.append(tuple(p1 + t1 * s))
    return out


def _on(a, b, f, z, out):
    a, b, t, n, _ = face(a, b)
    p = a.lerp(b, f) + n * out
    return ((p.x, p.y, z), (n.x, n.y, 0.0))


def lump(name, at, size, mat, seed, squash=0.6):
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1 + rr.uniform(-0.18, 0.18)
        v.co.x *= size * k
        v.co.y *= size * k * rr.uniform(0.85, 1.15)
        v.co.z *= size * k * squash
    ob = mesh_ob(name, bm, [mat])
    ob.location = at
    ob.rotation_euler = (0, 0, rr.uniform(0, 6.28))
    return ob


# ------------------------------------------------------------------------------------------------------------ materials
GLOW = (255, 120, 24)


def mats():
    P_ = kit.painted
    if VAR == "g":
        grey = kit.flat("grey", (128, 128, 128), rough=0.8)
        for k in ("wall", "uwall", "deck", "deckside", "deckedge", "frame", "plinth", "column", "band", "pilaster",
                  "bell", "coil", "rivet", "bolt", "wire", "pipe", "flange", "hole", "groove", "doorplate", "dome",
                  "cog", "domering", "sill", "strip"):
            M[k] = grey
        return
    # shared by d, e, f: the Inferno's dark, sooty metals (soot and wear as the Strongbox's and Academy's iron)
    M["iron"] = P_("l2-iron", (52, 49, 52), rough=0.5, metal=0.8, wear=(86, 80, 76), rust=(92, 50, 32), scale=2.2,
                   dirt=0.4, soot=0.65, rust_at=0.62)
    M["frame"] = P_("l2-frame", (46, 38, 34), rough=0.55, metal=0.6, wear=(84, 62, 46), rust=(88, 46, 28), scale=3.5,
                    dirt=0.4, soot=0.5)
    M["deck"] = P_("l2-deck", (86, 52, 38), rough=0.5, metal=0.5, wear=(128, 88, 58), rust=(58, 34, 26), scale=1.6,
                   dirt=0.3, soot=0.7, rust_at=0.55, streak=1.0)
    M["deckside"] = P_("l2-deckside", (62, 40, 32), rough=0.6, metal=0.45, wear=(96, 64, 46), scale=2.0, dirt=0.3,
                       soot=0.6)
    M["deckedge"] = P_("l2-deckedge", (50, 40, 36), rough=0.65, metal=0.4, wear=(82, 62, 50), scale=3.0, dirt=0.4,
                       soot=0.6, streak=1.0)
    M["band"] = P_("l2-band", (128, 84, 38), rough=0.42, metal=0.8, wear=(84, 54, 26), scale=3.0, dirt=0.4, soot=0.55)
    M["strip"] = M["band"]
    M["column"] = P_("l2-brass", (176, 116, 44), rough=0.36, metal=0.85, wear=(112, 70, 28), scale=2.0, dirt=0.5,
                     soot=0.5)
    M["rivet"] = P_("l2-rivet", (112, 104, 96), rough=0.45, metal=0.8, wear=(70, 64, 60), scale=6.0, dirt=0.2)
    M["bolt"] = P_("l2-bolt", (84, 78, 74), rough=0.45, metal=0.8, wear=(120, 112, 104), scale=6.0, dirt=0.2)
    M["bell"] = P_("l2-bell", (70, 68, 72), rough=0.4, metal=0.85, wear=(118, 112, 106), rust=(96, 54, 34), scale=3.0,
                   dirt=0.3, soot=0.6, rust_at=0.66)
    M["coil"] = P_("l2-coil", (150, 80, 42), rough=0.4, metal=0.85, wear=(96, 52, 30), scale=8.0, dirt=0.1, soot=0.3)
    M["wire"] = M["coil"]
    M["domering"] = M["iron"]
    M["flange"] = M["band"]
    M["sill"] = M["rivet"]
    M["hole"] = kit.flat("l2-hole", (10, 8, 8), rough=1.0)
    M["doorplate"] = P_("l2-doorplate", (64, 60, 60), rough=0.55, metal=0.6, wear=(100, 94, 88), rust=(92, 50, 32),
                        scale=4.0, dirt=0.35, soot=0.5)
    M["cog"] = P_("l2-cog", (56, 53, 52), rough=0.6, metal=0.7, wear=(98, 90, 82), rust=(104, 56, 32), scale=5.0,
                  dirt=0.3, soot=0.6, rust_at=0.56, grain=0.3)
    M["stone"] = imats.rock("l2-stone", (34, 30, 30), (66, 60, 56), scale=2.5)
    M["plinth"] = M["stone"]
    M["bone"] = imats.bone("l2-bone", col=(176, 158, 122), tip=(52, 42, 36), z0=11.0, z1=15.6)   # the horns: old, charred toward the tips
    # the columns' and pilasters' bone: old, yellowed and sooty (painted, so it takes the soot and the ground dirt)
    M["bonelow"] = P_("l2-bonelow", (172, 152, 114), rough=0.7, wear=(118, 100, 74), scale=3.0, dirt=0.55, soot=0.6)
    M["pilaster"] = P_("l2-pilaster", (136, 122, 94), rough=0.7, wear=(92, 80, 60), scale=3.0, dirt=0.4, soot=0.7)
    M["lava"] = imats.magma("l2-lava", crust_at=0.5, strength=2.6, scale=1.4)
    M["hot"] = kit.flat("l2-hot", (255, 110, 22), rough=0.4, emit=3.0)
    if VAR == "d":
        # the surface Lab's navy enamel, burnt nearly black, still a little blue where it is worn
        M["wall"] = P_("l2-navy", (26, 28, 40), rough=0.55, metal=0.5, wear=(54, 60, 80), rust=(92, 50, 32), scale=2.6,
                       dirt=0.45, soot=0.7, rust_at=0.6)
        M["uwall"] = M["wall"]
        M["dome"] = imats.brew("l2-magma", (96, 18, 6), (214, 70, 12), (255, 150, 40), (255, 214, 120), strength=0.8)
        M["pipe"] = imats.brew("l2-pipemagma", (70, 14, 6), (170, 54, 10), (236, 124, 34), (255, 190, 100), strength=0.45, scale=2.6)
        M["groove"] = kit.flat("l2-groovehot", (255, 96, 18), rough=0.5, emit=2.2)
    elif VAR == "e":
        M["wall"] = imats.rock("l2-basalt", (36, 32, 32), (70, 62, 58), crack=GLOW, crack_scale=0.9, crack_cover=0.5,
                               glow=5.0, scale=2.0)
        M["uwall"] = M["iron"]
        M["column"] = M["bonelow"]
        M["deck"] = P_("l2-deckiron", (58, 52, 52), rough=0.5, metal=0.7, wear=(98, 88, 80), rust=(92, 50, 32),
                       scale=1.6, dirt=0.3, soot=0.7, rust_at=0.56, streak=1.0)
        M["deckside"] = P_("l2-decksideiron", (44, 40, 40), rough=0.6, metal=0.6, wear=(78, 70, 64), scale=2.0,
                           dirt=0.3, soot=0.6)
        M["dome"] = imats.brew("l2-green", (22, 86, 20), (70, 170, 36), (168, 240, 60), (226, 255, 150), strength=0.8)
        M["pipe"] = imats.brew("l2-pipegreen", (16, 60, 14), (50, 124, 28), (128, 200, 48), (190, 236, 120), strength=0.45, scale=2.6)
        M["groove"] = kit.flat("l2-groove", (14, 12, 12), rough=0.9)
    else:
        # the Inferno Academy's copper, blackened and streaked, green where it has weathered
        M["wall"] = P_("l2-copper", (150, 80, 40), rough=0.34, metal=0.95, wear=(104, 52, 28), rust=(64, 110, 88),
                       scale=1.0, dirt=0.45, soot=0.6, rust_at=0.6, streak=1.0, grain=0.2)
        M["uwall"] = M["wall"]
        M["deck"] = P_("l2-deckiron", (58, 52, 52), rough=0.5, metal=0.7, wear=(98, 88, 80), rust=(92, 50, 32),
                       scale=1.6, dirt=0.3, soot=0.7, rust_at=0.56, streak=1.0)
        M["deckside"] = P_("l2-decksideiron", (44, 40, 40), rough=0.6, metal=0.6, wear=(78, 70, 64), scale=2.0,
                           dirt=0.3, soot=0.6)
        M["dome"] = imats.brew("l2-violet", (62, 18, 96), (130, 44, 176), (206, 110, 240), (240, 190, 255),
                               strength=0.8, scale=1.6)
        M["pipe"] = imats.brew("l2-pipeviolet", (44, 14, 70), (96, 34, 132), (160, 84, 196), (214, 160, 236), strength=0.45, scale=2.6)
        M["groove"] = kit.flat("l2-groove", (14, 12, 12), rough=0.9)
        M["bell"] = P_("l2-bellbrass", (150, 100, 44), rough=0.38, metal=0.85, wear=(96, 60, 26), scale=3.0, dirt=0.35,
                       soot=0.6)


# ------------------------------------------------------------------------------------------------------------ the body
def posts(name, poly, z0, z1, skip=(), w=0.32):
    for i, p in enumerate(poly):
        if i in skip:
            continue
        box(f"{name}{i}", (w, w, z1 - z0), (p[0], p[1], z0), M["frame"], rot=(0, 0, 45), bevel=0.04)


def lower():
    out = xy(LW)
    prism("lwall", out, 0.0, LW_Z, M["wall"], bevel=0.05)
    posts("lpost", out, 0.0, LW_Z, skip=(2, 3, 4, 5))
    sk = widen(out, 0.08)
    prism("lskirt", sk, 0.0, 0.3, M["frame"], bevel=0.03)
    prism("lband", sk, LW_Z - 0.3, LW_Z, M["band"], bevel=0.03)
    pts = []
    for a, b in faces_of(out):
        n = max(1, int((Vector(b) - Vector(a)).length / 0.75))
        pts += edge_pts(a, b, n, LW_Z - 0.15, 0.1, inset=0.06)
        pts += edge_pts(a, b, n, 0.15, 0.1, inset=0.06)
    studs("lrivet", pts, 0.07, M["rivet"])
    a, b = out[0], out[1]
    bolts = [_on(a, b, f, z, 0.03) for f, z in ((0.08, 2.9), (0.62, 3.3), (0.62, 1.9), (0.86, 2.5), (0.86, 1.1))]
    bolts += [(mir(p), mir(n)) for p, n in bolts]
    studs("lbolt", bolts, 0.19, M["bolt"], squash=0.45)
    # the ribbed columns at the front corners: a stack of sharp double cones up to the beam (in e: a spine of bone)
    for k, (u, v) in enumerate((COIL_UV, (-COIL_UV[0], COIL_UV[1]))):
        x, y = uv(u, v)
        prof = [(0.0, 0.0), (0.42, 0.0), (0.42, 0.12)]
        for j in range(7):
            z0 = 0.14 + j * 0.58
            prof += [(0.24, z0), (0.58, z0 + 0.28), (0.6, z0 + 0.29), (0.58, z0 + 0.3), (0.24, z0 + 0.58)]
        prof += [(0.42, LW_Z), (0.0, LW_Z)]
        lathe(f"coil{k}", prof, (x, y, 0.0), M["column"], verts=28)
    ca, cb = Vector(uv(*COIL_UV)), Vector(uv(-COIL_UV[0], COIL_UV[1]))
    _, _, tb, nb, angb = face(ca, cb)
    p = (ca + cb) / 2
    box("lbeam", ((cb - ca).length, 0.34, 0.42), (p.x, p.y, LW_Z - 0.42), M["column"] if VAR != "e" else M["band"],
        rot=(0, 0, angb), bevel=0.04)
    # the recess between the columns: dark panels, brass strips, the engraved door in the middle
    ra, rb = out[3], out[4]
    _, _, t, n, ang = face(ra, rb)
    mid = (Vector(ra) + Vector(rb)) / 2
    dw, dz, dh = 1.4, 0.5, 2.8
    box("ldoor", (dw, 0.12, dh), (mid.x + n.x * 0.05, mid.y + n.y * 0.05, dz), M["doorplate"], rot=(0, 0, ang),
        bevel=0.04)
    cw, rh = dw / 10, dh / 16
    maze = [(6, -0.5), (6, 3.5), (3, 3.5), (3, 7), (6, 7), (6, 10.5), (3, 10.5), (3, 14), (6, 14), (6, 15.5)]
    face_n = 0.11

    def dpt(c, r):
        p = mid + t * ((c + 0.5) * cw - dw / 2) + n * face_n
        return p, dz + dh - (r + 0.5) * rh
    for j, (a, b) in enumerate(zip(maze, maze[1:])):
        (pa, za), (pb, zb) = dpt(*a), dpt(*b)
        p = (pa + pb) / 2
        size = ((pa - pb).length + 0.15, 0.05, abs(za - zb) + 0.15)
        box(f"ldoorgroove{j}", size, (p.x, p.y, (za + zb) / 2), M["groove"], rot=(0, 0, ang), bevel=0.01,
            origin="centre")
    ex = dw / 2 - 0.08
    dark = kit.flat("l2-groovedark", (14, 12, 12), rough=0.9) if VAR != "g" else M["groove"]
    for j, (sx, sz, w, h) in enumerate(((-ex, dz + dh / 2, 0.12, dh - 0.16), (ex, dz + dh / 2, 0.12, dh - 0.16),
                                        (0.0, dz + dh - 0.08, 2 * ex, 0.12))):
        p = mid + t * sx + n * face_n
        box(f"ldoorgroove-e{j}", (w, 0.05, h), (p.x, p.y, sz), dark, rot=(0, 0, ang), bevel=0.01, origin="centre")
    p = mid + n * 0.14
    box("ldoorsill", (dw + 0.1, 0.24, 0.22), (p.x, p.y, dz - 0.2), M["sill"], rot=(0, 0, ang), bevel=0.04)
    for s in (-2.2, -1.4, 1.4, 2.2):
        p = mid + t * s + n * 0.03
        box(f"lstrip{s}", (0.12, 0.06, LW_Z - 0.6), (p.x, p.y, 0.3), M["strip"], rot=(0, 0, ang), bevel=0.02)
    # the side doors: a frame round a dark opening, a plate on the ground in front; in it a cog (d, f) or a lava vat (e)
    for k in (0, 1):
        a, b = (out[0], out[1]) if k == 0 else (out[6], out[7])
        f = DOOR_F if k == 0 else 1 - DOOR_F
        a, b, t, n, ang = face(a, b)
        c = a.lerp(b, f)
        w = DOOR_W
        box(f"sdoorhole{k}", (w, 0.1, 2.7), (c.x + n.x * 0.01, c.y + n.y * 0.01, 0.3), M["hole"], rot=(0, 0, ang),
            bevel=0.0)
        for s in (-1, 1):
            p = c + t * (s * (w / 2 + 0.12)) + n * 0.1
            box(f"sdoorjamb{k}", (0.24, 0.3, 3.15), (p.x, p.y, 0.0), M["frame"], rot=(0, 0, ang))
        p = c + n * 0.1
        box(f"sdoorlintel{k}", (w + 0.5, 0.3, 0.3), (p.x, p.y, 3.0), M["frame"], rot=(0, 0, ang))
        p = c + n * 1.3
        box(f"sdoorplate{k}", (w + 1.2, 2.5, 0.14), (p.x, p.y, 0.0), M["deckedge"], rot=(0, 0, ang), bevel=0.03)
        if VAR == "e":
            vat(k, c, t, n)
        else:
            side_cog(k, c, t, n)


SCOG_O, SCOG_Z, SCOG_R, SCOG_N, SCOG_T, SCOG_D, SCOG_A, SCOG_AX = 0.4, 0.6, 1.65, 10, 0.55, 0.24, (-0.22, -0.25), 28.0


def side_cog(k, c, t, n):
    """The surface Lab's cog standing upright in side door k (door middle c on the wall, t along the wall, n out),
    its lower part hidden by the floor and the plate, and the small knob at the foot of the jamb."""
    corner = -1 if k == 0 else 1
    at = c + n * SCOG_O + t * (corner * SCOG_A[k])
    at = Vector((at.x, at.y, SCOG_Z))
    ax = math.radians(SCOG_AX) * -corner
    a = t * math.cos(ax) + n * math.sin(ax)
    q0 = Vector((a.x, a.y, 0.0)).to_track_quat("Z", "Y")
    hd = SCOG_T + 0.08
    hub = cyl(f"scoghub{k}", 0.28 * SCOG_R, hd, at, M["cog"], verts=24, bevel=0.05)
    for v in hub.data.vertices:
        v.co.z -= hd / 2
    obs = [gear(f"scog{k}", SCOG_R, SCOG_N, SCOG_T, at, M["cog"], (0, 0, 0), tooth=SCOG_D), hub]
    ang = math.degrees(math.atan2(t.y, t.x))
    w, w2 = c - n * (3.0 - 0.07), c - n * (3.0 - 0.2)
    for cut in (box(f"scogcut{k}", (6.0, 6.0, 3.0), (at.x, at.y, 0.14 - 3.0), M["cog"], bevel=0.0),
                box(f"scogcut{k}w", (6.0, 6.0, 6.0), (w.x, w.y, -1.0), M["cog"], rot=(0, 0, ang), bevel=0.0),
                box(f"scogcut{k}s", (6.0, 6.0, 1.34), (w2.x, w2.y, -1.0), M["cog"], rot=(0, 0, ang), bevel=0.0)):
        cut.hide_render = True
        for o in obs:
            mo = o.modifiers.new("cut", "BOOLEAN")
            mo.operation, mo.object = "DIFFERENCE", cut
    p = c + n * 0.58 + t * (-corner * (DOOR_W / 2 + 0.12))
    cyl(f"scognub{k}", 0.24, 0.32, (p.x, p.y, 0.15), M["cog"], verts=16, bevel=0.12)
    for o in obs:
        o.rotation_euler = q0.to_euler()


def vat(k, c, t, n):
    """e: an iron vat of lava on the side door's plate, where the surface Lab has its cog."""
    p = c + n * 1.2
    z = 0.14
    lathe(f"vat{k}", [(0.0, 0.0), (0.72, 0.0), (1.0, 0.3), (1.08, 0.78), (0.92, 0.78), (0.86, 0.45), (0.0, 0.42)],
          (p.x, p.y, z), M["iron"], verts=32)
    lathe(f"vatlava{k}", [(0.0, 0.0), (0.9, 0.0)], (p.x, p.y, z + 0.64), M["lava"], verts=32)
    kit.ring(f"vatrim{k}", 1.0, 0.07, M["band"], z=0.0).location = (p.x, p.y, z + 0.78)


def lower_deck():
    out = xy(LD)
    prism("ldeck", out, LD_Z0, LD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
    pts = []
    for u, v in ((-7.3, -0.6), (7.3, -0.6), (-5.6, 3.1), (5.6, 3.1)):
        x, y = uv(u, v)
        pts.append(((x, y, LD_Z1 + 0.01), (0, 0, 1)))
    studs("ldeckrivet", pts, 0.19, M["rivet"], squash=0.5)


def upper():
    out = xy(UW)
    prism("uwall", out, LD_Z1, UD_Z0, M["uwall"], bevel=0.05)
    posts("upost", out, LD_Z1, UD_Z0, skip=(2, 3, 4, 5))
    for k in (2, 5):
        p = out[k]
        box(f"pilaster{k}", (0.34, 0.34, UD_Z0 - LD_Z1), (p[0], p[1], LD_Z1), M["pilaster"], rot=(0, 0, 45),
            bevel=0.04)
    ra, rb = out[3], out[4]
    _, _, t, n, ang = face(ra, rb)
    mid = (Vector(ra) + Vector(rb)) / 2
    for s in (-2.6, -1.3, 0.0, 1.3, 2.6):
        p = mid + t * s + n * 0.03
        box(f"ustrip{s}", (0.1, 0.05, UD_Z0 - LD_Z1 - 0.3), (p.x, p.y, LD_Z1 + 0.15), M["strip"], rot=(0, 0, ang),
            bevel=0.02)
    band = widen(out, 0.06)
    prism("uband", band, UD_Z0 - 0.26, UD_Z0, M["band"], bevel=0.03)
    pts = []
    for a, b in faces_of(out):
        n_ = max(1, int((Vector(b) - Vector(a)).length / 0.75))
        pts += edge_pts(a, b, n_, UD_Z0 - 0.13, 0.08, inset=0.06)
    studs("urivet", pts, 0.07, M["rivet"])
    a, b = out[0], out[1]
    bolts = [_on(a, b, f, z, 0.03) for f, z in ((0.25, 6.2), (0.18, 8.5), (0.7, 6.2), (0.82, 8.5))]
    a, b = out[1], out[2]
    bolts += [_on(a, b, f, z, 0.03) for f, z in ((0.2, 5.8), (0.2, 8.5), (0.85, 5.8), (0.85, 8.5))]
    bolts += [(mir(p), mir(n)) for p, n in bolts]
    studs("ubolt", bolts, 0.17, M["bolt"], squash=0.45)
    # the glass pipes: straight out of the upper side faces, a quarter bend down to a flange on the lower deck
    for k, (i, j) in enumerate(((0, 1), (6, 7))):
        a2, b2, t, n, _ = face(out[i], out[j])
        w = a2.lerp(b2, PIPE_F if k == 0 else 1 - PIPE_F)
        a = Vector((w.x, w.y, PIPE_Z))
        n3 = Vector((n.x, n.y, 0.0))
        r = 0.44
        drop = PIPE_Z - LD_Z1
        pts = [a, a + n3 * 0.35, a + n3 * (PIPE_OUT * 0.75) + Vector((0, 0, -0.15)),
               a + n3 * PIPE_OUT + Vector((0, 0, -drop * 0.45)), a + n3 * PIPE_OUT + Vector((0, 0, -drop + 0.12))]
        tube(f"pipe{k}", [tuple(p) for p in pts], r, M["pipe"], verts=16, smooth=True)
        c = a + n3 * PIPE_OUT
        cyl(f"pipeflange{k}", 0.7, 0.16, (c.x, c.y, LD_Z1), M["flange"], verts=28)
        ob = cyl(f"pipecollar{k}", 0.5, 0.1, tuple(a + n3 * 0.02), M["flange"], verts=24)
        ob.rotation_euler = n3.to_track_quat("Z", "Y").to_euler()


def upper_deck():
    out = xy(UD)
    prism("udeck", out, UD_Z0, UD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
    pts = []
    for u, v in ((-6.5, 0.8), (6.5, 0.8), (-2.4, 1.85), (2.4, 1.85), (-5.0, -1.3), (5.0, -1.3), (-1.8, -3.3),
                 (1.8, -3.3)):
        x, y = uv(u, v)
        pts.append(((x, y, UD_Z1 + 0.01), (0, 0, 1)))
    studs("udeckrivet", pts, 0.19, M["rivet"], squash=0.5)
    cx, cy = PL_C
    sq = [(cx - PL_H, cy - PL_H), (cx + PL_H, cy - PL_H), (cx + PL_H, cy + PL_H), (cx - PL_H, cy + PL_H)]
    prism("plinth", sq, UD_Z1, PL_Z, M["plinth"], bevel=0.05)


def bell(name, at, prof, coil_r, coil_turns, coil_h, coil=True):
    """An insulator bell (a lathe profile from its base), with a coil on top (or a bare cap: coil=False)."""
    lathe(name, prof, at, M["bell"], verts=40)
    top = prof[-1][1]
    if not coil:
        return Vector((at[0], at[1], at[2] + top))
    n = 30 * coil_turns
    pts = []
    for i in range(int(n) + 1):
        a = 2 * math.pi * coil_turns * i / n
        pts.append((at[0] + coil_r * math.cos(a), at[1] + coil_r * math.sin(a), at[2] + top - 0.05 + coil_h * i / n))
    tube(name + "coil", pts, coil_r * 0.22, M["coil"], verts=8)
    cyl(name + "post", coil_r * 0.45, coil_h + 0.1, (at[0], at[1], at[2] + top - 0.1), M["bolt"], verts=12)
    return Vector((at[0], at[1], at[2] + top + coil_h + 0.05))


BIG_BELL = [(0.0, 0.0), (1.25, 0.0), (1.28, 0.14), (1.2, 0.3), (0.98, 0.36), (0.9, 0.42), (0.84, 0.5), (0.82, 2.0),
            (0.87, 2.08), (0.84, 2.18), (0.7, 2.4), (0.5, 2.6), (0.42, 2.75), (0.44, 2.9), (0.0, 2.92)]
SMALL_BELL = [(0.0, 0.0), (1.0, 0.0), (1.04, 0.12), (0.96, 0.26), (0.8, 0.32), (0.78, 0.5), (0.8, 1.25), (0.74, 1.5),
              (0.58, 1.72), (0.36, 1.84), (0.24, 1.9), (0.26, 2.0), (0.0, 2.02)]
BIG_COIL, SMALL_COIL = 1.85, 0.6


def top():
    pc = (PL_C[0], PL_C[1], PL_Z)
    pl, pr = uv(*BELL_S) + (UD_Z1,), mir(uv(*BELL_S)) + (UD_Z1,)
    if VAR == "e":
        # the big bell keeps its coil; the small bells carry the two horns, which take the wires' sweep up to the top
        big = bell("bellC", pc, BIG_BELL, 0.42, 4.5, BIG_COIL)
        for k, at in enumerate((pl, pr)):
            p = bell("bellL" if k == 0 else "bellR", at, SMALL_BELL, 0.24, 2.5, SMALL_COIL, coil=False)
            q = big + Vector((0, 0, 0.1))
            side = p - q
            side.z = 0
            cyl(f"hornseat{k}", 0.4, 0.2, tuple(p - Vector((0, 0, 0.08))), M["band"], verts=20)
            tube(f"horn{k}", [tuple(p), tuple(p + Vector((0, 0, 1.0)) + side * 0.12),
                              tuple(q + side * 0.92 + Vector((0, 0, -1.9))), tuple(q + side * 0.6 + Vector((0, 0, -0.7))),
                              tuple(q + side * 0.3 + Vector((0, 0, 0.15)))], 0.36, M["bone"], verts=16, r_end=0.04,
                 smooth=True)
        return
    if VAR == "f":
        # spikes in place of the coils (the Inferno Academy's), the copper wires kept, to the big spike's foot
        big = bell("bellC", pc, BIG_BELL, 0.42, 4.5, BIG_COIL, coil=False)
        cyl("spikeC", 0.4, BIG_COIL + 0.1, tuple(big - Vector((0, 0, 0.1))), M["iron"], verts=16, bevel=0.0, r2=0.03)
        tops = []
        for k, at in enumerate((pl, pr)):
            p = bell("bellL" if k == 0 else "bellR", at, SMALL_BELL, 0.24, 2.5, SMALL_COIL, coil=False)
            cyl(f"spike{k}", 0.25, SMALL_COIL + 0.35, tuple(p - Vector((0, 0, 0.1))), M["iron"], verts=16, bevel=0.0,
                r2=0.02)
            tops.append(p + Vector((0, 0, 0.12)))
        big = big + Vector((0, 0, 0.45))
        wires(big, tops)
        return
    big = bell("bellC", pc, BIG_BELL, 0.42, 4.5, BIG_COIL)
    wires(big, [bell("bellL", pl, SMALL_BELL, 0.24, 2.5, SMALL_COIL), bell("bellR", pr, SMALL_BELL, 0.24, 2.5, SMALL_COIL)])


def wires(big, tops):
    """The copper wire from each small bell's top up in an arc into the big bell's top."""
    for k, p in enumerate(tops):
        q = big + Vector((0, 0, 0.1))
        side = (p - q)
        side.z = 0
        mid = q + side * 0.5 + Vector((0, 0, (p.z - q.z) * 0.5 + 0.3))
        tube(f"wire{k}", [tuple(p), tuple(p + Vector((0, 0, 0.3)) - side * 0.05), tuple(mid),
                          tuple(q + side * 0.12 + Vector((0, 0, 0.35))), tuple(q)], 0.1, M["wire"], verts=8, smooth=True)


def dome():
    cx, cy = uv(*DOME_UV)
    z0 = LD_Z1
    lathe("domering", [(0.0, 0.0), (DOME_R + 0.22, 0.0), (DOME_R + 0.26, 0.18), (DOME_R + 0.12, 0.34), (0.0, 0.34)],
          (cx, cy, z0), M["domering"], verts=48)
    prof = [(DOME_R * math.cos(math.radians(a)), 0.85 * DOME_R * math.sin(math.radians(a))) for a in range(0, 91, 6)]
    ob = lathe("dome", prof, (cx, cy, z0 + 0.3), M["dome"], verts=48)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    for k, mirrored in enumerate((False, True)):
        f = mir if mirrored else (lambda p: p)
        a = Vector(f(uv(-2.4, 1.6)) + (z0 + 0.2,))
        c = Vector(f(uv(-4.2, 3.4)) + (z0,))
        tube(f"domewire{k}", [tuple(a), tuple((a + c) / 2 + Vector((0, 0, 0.3))), tuple(c + Vector((0, 0, 0.12)))],
             0.07, M["wire"], verts=8, smooth=True)
        cyl(f"domeclamp{k}", 0.24, 0.16, tuple(c), M["flange"], verts=16)


def extras():
    """The Inferno parts on top of the surface Lab's shape (e, f)."""
    if VAR == "e":
        # an iron spike on a brass seat on each deck's side corners
        for i, (u, v, z, h) in enumerate(((-8.5, 0.0, LD_Z1, 1.25), (8.5, 0.0, LD_Z1, 1.25), (-6.75, 0.35, UD_Z1, 1.0),
                                          (6.75, 0.35, UD_Z1, 1.0))):
            x, y = uv(u, v)
            cyl(f"cornerseat{i}", 0.36, 0.16, (x, y, z), M["band"], verts=16)
            lean = Vector(uv(1 if u > 0 else -1, 0) + (0,)).normalized() * 0.28 + Vector((0, 0, 1))
            ob = cyl(f"cornerspike{i}", 0.26, h, (x, y, z + 0.12), M["iron"], verts=16, bevel=0.0, r2=0.02)
            ob.rotation_euler = lean.to_track_quat("Z", "Y").to_euler()
    if VAR in ("e", "f"):
        # basalt rubble on the ground at the two side corners and in the recess beside the door (clear of the
        # columns, the side doors and their plates)
        for i, (u, v, r) in enumerate(((-9.6, -0.25, 0.4), (-9.15, -1.0, 0.3), (9.4, 0.25, 0.4), (9.75, -0.5, 0.28),
                                       (-2.2, 2.2, 0.26), (2.05, 2.35, 0.3))):
            x, y = uv(u, v)
            lump(f"rubble{i}", (x, y, 0.06), r, M["stone"], seed=500 + i)


def build():
    mats()
    lower()
    lower_deck()
    upper()
    upper_deck()
    top()
    dome()
    if VAR != "g":
        extras()


FAMILY = (("lwall", "lwall"), ("lpost", "lwall"), ("lskirt", "lwall"), ("lband", "lwall"), ("lbeam", "coil"),
          ("lrivet", "lwall"), ("lbolt", "lwall"), ("lstrip", "lwall"), ("ldoor", "ldoor"), ("coil", "coil"),
          ("sdoor", "sdoor"), ("scog", "scog"), ("vat", "vat"), ("ldeck", "ldeck"), ("uwall", "uwall"),
          ("upost", "uwall"), ("uband", "uwall"), ("urivet", "uwall"), ("ustrip", "uwall"), ("ubolt", "uwall"),
          ("pilaster", "pilaster"), ("pipe", "pipe"), ("udeck", "udeck"), ("plinth", "plinth"), ("bellC", "bellC"),
          ("bellL", "bellL"), ("bellR", "bellR"), ("spikeC", "bellC"), ("spike0", "bellL"), ("spike1", "bellR"),
          ("hornseat0", "bellL"), ("hornseat1", "bellR"), ("horn", "horn"), ("wire", "wire"), ("domering", "dome"),
          ("domewire", "domewire"), ("domeclamp", "domewire"), ("dome", "dome"), ("cornerseat", "corner"),
          ("cornerspike", "corner"), ("rubble", "rubble"))


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


kit.run(build, lambda k: None, family=family)
