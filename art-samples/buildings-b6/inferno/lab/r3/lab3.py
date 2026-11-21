"""lab3.py : the Infernal Monster Lab, ROUND 3 (21 Nov 2026): the owner's pick, round 2's look E "Bone and Brimstone"
(../r2/lab2.py, LAB_VAR=e: the surface Monster Lab's own shape in the Inferno's materials), finished: levels 1, 2, 3,
a wear pass, moving parts, and the damaged and destroyed looks.

    ./run.sh <1|2|3> <fit|base|still|anim|check|gap>          (run.sh takes the GPU lock)
    PB_STATE=damaged   ./run.sh <1|2|3> base                   render/L<n>-damaged-base.png and -alone.png
    PB_STATE=destroyed ./run.sh 1 base                         render/L1-destroyed-base.png (one look for every level)

Levels build on each other (level n = level n-1 plus parts, fixed to the body; nothing of the level below changes):
  1  the body: basalt-block lower tier with magma in the joints and cracks, bone columns, iron decks and upper tier,
     the dome of green brew, the brew pipes, three iron bells, two horns from the small bells to the top, lava vats on
     the side-door plates, iron spikes on the deck corners.
  2  + a brew canister strapped to each front wall (a copper tube up into the deck), a copper coil round each small
     bell and a second, outward horn on each.
  3  + a brazier crown on the big bell's coil (iron bowl of green fire, three bone prongs), a brew flask on each front
     corner of the upper deck, a lava channel with basalt curbs round the front foot and a grate bridge to the door.

Moving parts (kit layers, N frames, a closed loop): the dome's brew swirls and bubbles rise on its glass; the brew in
the pipes (and the level-2 canisters, level-3 flasks and fire) drifts; the lava in the vats (and the level-3 channel)
drifts and pulses; the magma in the lower tier's joints and cracks pulses.

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
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
sys.path.insert(0, str(HERE.parent))
import kit  # noqa: E402
import imats  # noqa: E402
from imats import fmath  # noqa: E402
from kit import MATS, NT, box, cyl, lathe, mesh_ob, srgb, tube  # noqa: E402

N = 24                                   # frames in the loop
kit.OUT = HERE
kit.ORIGIN = (0.0, 45.0)                 # the surface Monster Lab's origin (as round 2)
kit.FRAME = (-86, -130, 150, 96)         # round 2's canvas, 26 Flash px taller for level 3's crown
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))
kit.SUN_COL = (1.0, 0.93, 0.82)          # as the Incubator, Strongbox and Academy
LEVEL = kit.LEVEL
STATE = kit.STATE                        # "", "damaged" or "destroyed"
DMG, DEAD = STATE == "damaged", STATE == "destroyed"
SC = kit.SC
M = {}
DRIFT = []      # (mapping node, its rest location, circle radius, phase): the texture drifts round a circle per loop
PULSE = []      # (value node, swing, phase): a glow's strength swells and fades once per loop
BUBBLES = []    # (object, azimuth, size, phase)
FLAMES = []     # (object, phase)

# ------------------------------------------------------------------------------------------------------------ the plan
# (the surface Lab's, unchanged from round 2)
LW_Z = 4.6                                  # the lower walls' height (the lower deck's underside)
LD_Z0, LD_Z1 = 4.6, 5.27                    # the lower deck
UD_Z0, UD_Z1 = 9.0, 9.6                     # the upper deck
LW = [(-8.9, 0.0), (-3.6, 2.8), (-3.0, 2.8), (-3.0, 1.2), (3.0, 1.2), (3.0, 2.8), (3.6, 2.8), (8.9, 0.0), (0.0, -7.0)]
LD = [(-9.35, 0.0), (-5.2, 3.75), (5.2, 3.75), (9.35, 0.0), (0.0, -7.6)]
UW = [(-5.35, 0.0), (-4.75, 1.9), (-3.5, 1.9), (-3.5, -3.3), (3.5, -3.3), (3.5, 1.9), (4.75, 1.9), (5.35, 0.0),
      (0.0, -5.2)]
UD = [(-7.5, 0.0), (-6.6, 2.3), (6.6, 2.3), (7.5, 0.0), (0.0, -5.8)]
COIL_UV = (-3.6, 3.0)                       # the left bone column (the right one mirrored)
DOOR_F, DOOR_W = 0.36, 1.5                  # the left side door: how far along the left face (from the corner), width
PL_C, PL_H, PL_Z = (-0.7, 0.7), 1.6, 9.84   # the plinth under the big bell: middle, half side, top
DOME_UV, DOME_R = (0.3, 0.25), 2.08         # the glass dome on the lower deck, in the upper recess
PIPE_F, PIPE_Z, PIPE_OUT = 0.5, 7.7, 1.25   # the glass pipe: how far along the upper left face, height, reach
BELL_S = (-3.82, 0.6)                       # the left small bell on the upper deck (the right one mirrored)
BLOCK_Z = [0.3, 0.9, 1.5, 2.1, 2.7, 3.3, 3.8, 4.3]      # the basalt courses (the side doors' lintels top out at 3.3)
CAN_F = 0.715                               # level 2's canister: how far along the left front face
FLASK_UV = (-5.9, 1.75)                     # level 3's flask on the upper deck (the right one mirrored)
CHANNEL = [(-4.5, 4.4), (-3.4, 5.0), (3.4, 5.0), (4.5, 4.4)]     # level 3's lava channel (its middle line)
U_DIR = Vector((1.0, 1.0, 0.0)).normalized()        # screen-plan u (across) and v (toward the viewer) in the world
V_DIR = Vector((1.0, -1.0, 0.0)).normalized()


def uv(u, v):
    return ((u + v) / 2, (u - v) / 2)


def mir(p):
    """The mirror image across the building's screen axis."""
    return (-p[1], -p[0]) + tuple(p[2:])


def xy(poly):
    return [uv(u, v) for u, v in poly]


def layer(name):
    """An empty whose children are one moving layer (none in a damaged or destroyed still: all one picture)."""
    if STATE:
        return None
    e = bpy.data.objects.new("A-" + name, None)
    kit.link(e)
    kit.MOVING.append(e)
    return e


def prism(name, pts, z0, z1, mat, bevel=0.04, side_mat=None, parent=None):
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
    return mesh_ob(name, bm, mats, smooth=False, bevel=bevel, segs=2, parent=parent)


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


def lump(name, at, size, mat, seed, squash=0.6):
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1 + rr.uniform(-0.18, 0.18)
        v.co.x *= size * k
        v.co.y *= size * k * rr.uniform(0.85, 1.15)
        v.co.z *= size * k * squash
    ob = mesh_ob(name, bm, [mat], smooth=False)
    ob.location = at
    ob.rotation_euler = (0, 0, rr.uniform(0, 6.28))
    return ob


def dent(ob, strength=0.05, size=0.5, levels=2):
    """Knock a smooth part about: its surface pushed in and out by a world-space cloud (dents and lumps)."""
    imats.roughen(ob, strength=strength, size=size, levels=levels)


def notch(ob, pts, seed):
    """Chips broken out of ob at world points pts (each (x, y, z, size)): hidden lumps cut away."""
    for i, (x, y, z, s) in enumerate(pts):
        c = lump(f"{ob.name}cut{i}", (x, y, z), s, M["hole"], seed + i, squash=0.8)
        c.hide_render = True
        mo = ob.modifiers.new(f"chip{i}", "BOOLEAN")
        mo.operation, mo.object = "DIFFERENCE", c


# ------------------------------------------------------------------------------------------------------------ materials
GLOW = (255, 120, 24)
SOOT_UP = 0.25 if STATE else 0.0            # a damaged or destroyed lab is burnt blacker
DIM = {"": 1.0, "damaged": 0.75, "destroyed": 0.5}[STATE]


def value(t, v=1.0):
    nd = t.n("ShaderNodeValue")
    nd.outputs[0].default_value = v
    return nd


def worn(name, col, rough=0.55, metal=0.7, wear=None, rust=None, scale=2.0, dirt=0.35, soot=0.6, rust_at=0.6,
         edge=None, dents=0.5, streaks=0.75, grain=0.0):
    """Hard-used metal or bone (kit.painted's recipe, pushed): worn patches and rust blotches, round soot smudges, soot
    STREAKS that run straight down the upright faces (world height, so they line up across parts), bare chipped metal
    along the edges (`edge` colour), and a bump of sparse dents and pits over the fine grain."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    out = srgb(*col)
    if wear:
        n1 = t.noise(v, scale * 0.45, 3.0, 0.5, 0.2)
        out = t.mix(out, srgb(*wear), t.ramp(n1, [(0.42, (0, 0, 0, 1)), (0.7, (0.7, 0.7, 0.7, 1))]))
    if rust:
        n2 = t.noise(v, scale * 0.7, 5.0, 0.65, 1.0)
        out = t.mix(out, srgb(*rust), t.ramp(n2, [(rust_at, (0, 0, 0, 1)), (rust_at + 0.12, (0.8, 0.8, 0.8, 1))]))
    soot = min(1.0, soot + SOOT_UP)
    n3 = t.noise(v, scale * 0.5, 6.0, 0.7, 0.4)
    out = t.mix(out, srgb(28, 23, 21), t.ramp(n3, [(0.4, (0, 0, 0, 1)), (0.6, (soot, soot, soot, 1))]))
    rr = t.ramp(n3, [(0.4, (rough,) * 3 + (1,)), (0.6, (min(1.0, rough + 0.4),) * 3 + (1,))])
    geo = t.n("ShaderNodeNewGeometry")
    if streaks:
        mp = t.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (4.5, 4.5, 0.16)
        t.link(geo.outputs["Position"], mp.inputs["Vector"])
        n4 = t.noise(mp.outputs[0], 1.0, 3.0, 0.6, 0.2)
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sep.inputs[0])
        up = fmath(t, "ABSOLUTE", sep.outputs["Z"])
        side = t.ramp(up, [(0.3, (1, 1, 1, 1)), (0.7, (0, 0, 0, 1))])
        st = fmath(t, "MULTIPLY", t.ramp(n4, [(0.5, (0, 0, 0, 1)), (0.66, (streaks,) * 3 + (1,))]), side)
        out = t.mix(out, srgb(16, 13, 12), st)
    if edge:
        bv = t.n("ShaderNodeBevel", samples=4)
        bv.inputs["Radius"].default_value = 0.08
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(bv.outputs[0], dp.inputs[0])
        t.link(geo.outputs["Normal"], dp.inputs[1])
        em = t.ramp(dp.outputs["Value"], [(0.9, (1, 1, 1, 1)), (0.995, (0, 0, 0, 1))])
        ch = t.ramp(t.noise(v, scale * 3.5, 3.0, 0.6), [(0.4, (0, 0, 0, 1)), (0.52, (1, 1, 1, 1))])
        out = t.mix(out, srgb(*edge), fmath(t, "MULTIPLY", em, ch))
    if grain:
        g = t.ramp(t.noise(v, scale * 16, 2.0, 0.5), [(0.32, srgb(*(255 * (1 - grain),) * 3)), (0.62, (1, 1, 1, 1))])
        out = t.mix(out, g, 1.0, "MULTIPLY")
    out = t.grime(out, kit.GROUND, 2.6, dirt, 0.5)
    t.set(**{"Base Color": out, "rough": rr, "metal": metal, "spec": 0.4})
    pits = t.ramp(t.noise(v, scale * 1.1, 2.0, 0.5, 0.3), [(0.3, (0, 0, 0, 1)), (0.42, (1, 1, 1, 1))])
    fine = t.noise(v, scale * 6, 4.0, 0.6)
    h = fmath(t, "ADD", fmath(t, "MULTIPLY", pits, dents), fmath(t, "MULTIPLY", fine, 0.12))
    t.bump(h, 0.6, 0.08)
    MATS[name] = t.m
    return t.m


def rock3(name, col, var, crack=None, crack_scale=1.6, crack_w=0.05, glow=7.0, scale=1.6, rough=0.9, bump=0.7,
          crack_cover=0.45, edge=(96, 88, 82), swing=0.0, phase=0.0):
    """imats.rock's basalt with a rougher face, paler chipped edges, soot running down it, and (swing) its magma
    cracks' glow on a value node that turn() swells and fades."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    n1 = t.noise(v, scale, 6.0, 0.62, 0.3)
    out = t.mix(srgb(*col), srgb(*var), t.ramp(n1, [(0.38, (0, 0, 0, 1)), (0.72, (1, 1, 1, 1))]))
    hfine = t.noise(v, scale * 5, 8.0, 0.7)
    geo = t.n("ShaderNodeNewGeometry")
    mp = t.n("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (4.0, 4.0, 0.2)
    t.link(geo.outputs["Position"], mp.inputs["Vector"])
    st = t.ramp(t.noise(mp.outputs[0], 1.0, 3.0, 0.6, 0.2), [(0.48, (0, 0, 0, 1)), (0.66, (0.75, 0.75, 0.75, 1))])
    out = t.mix(out, srgb(14, 12, 12), st)
    if edge:
        bv = t.n("ShaderNodeBevel", samples=4)
        bv.inputs["Radius"].default_value = 0.09
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(bv.outputs[0], dp.inputs[0])
        t.link(geo.outputs["Normal"], dp.inputs[1])
        em = t.ramp(dp.outputs["Value"], [(0.88, (0.8, 0.8, 0.8, 1)), (0.995, (0, 0, 0, 1))])
        ch = t.ramp(t.noise(v, scale * 3.0, 3.0, 0.6), [(0.36, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1))])
        out = t.mix(out, srgb(*edge), fmath(t, "MULTIPLY", em, ch))
    mask = None
    if crack:
        nz = t.n("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 2.5
        t.link(v, nz.inputs["Vector"])
        warp = t.n("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        t.link(nz.outputs["Color"], warp.inputs[0])
        warp.inputs[1].default_value = (0.5, 0.5, 0.5)
        t.link(v, warp.inputs[2])
        vor = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        vor.inputs["Scale"].default_value = crack_scale
        t.link(warp.outputs[0], vor.inputs["Vector"])
        edge_ = t.n("ShaderNodeMapRange")
        edge_.inputs[1].default_value, edge_.inputs[2].default_value = crack_w, 0.0
        t.link(vor.outputs["Distance"], edge_.inputs[0])
        cover = t.ramp(t.noise(v, 0.9, 2.0, 0.5), [(1 - crack_cover - 0.08, (0, 0, 0, 1)),
                                                     (1 - crack_cover + 0.08, (1, 1, 1, 1))])
        mask = fmath(t, "MULTIPLY", edge_.outputs[0], cover)
        out = t.mix(out, srgb(*crack), mask)
        pv = value(t)
        if swing:
            PULSE.append((pv, swing, phase))
        t.set(**{"Emission Color": srgb(*crack),
                 "Emission Strength": fmath(t, "MULTIPLY", fmath(t, "MULTIPLY", mask, glow * DIM), pv.outputs[0])})
        hfine = fmath(t, "SUBTRACT", hfine, fmath(t, "MULTIPLY", mask, 0.8))
    out = t.grime(out, kit.GROUND, 3.0, 0.3, 0.45)
    t.set(**{"Base Color": out, "spec": 0.3, "rough": rough})
    t.bump(hfine, bump, 0.06)
    MATS[name] = t.m
    return t.m


def magma3(name, hot=(255, 104, 16), core=(255, 196, 70), crust=(34, 22, 18), strength=9.0, crust_at=None, scale=1.2,
           swing=0.0, phase=0.0, drift=0.0):
    """imats.magma's lava with its glow on a value node (swing: it pulses) and its pattern on a mapping node (drift:
    the crust slides round a small circle, so the lava creeps)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    if drift:
        DRIFT.append((v.node, (0.0, 0.0, 0.0), drift, phase))
    n2 = t.noise(v, scale * 2.5, 4.0, 0.55, 1.5)
    heat = t.mix(srgb(*hot), srgb(*core), t.ramp(n2, [(0.45, (0, 0, 0, 1)), (0.72, (1, 1, 1, 1))]))
    strength *= DIM
    em = fmath(t, "ADD", fmath(t, "MULTIPLY", n2, strength * 0.8), strength * 0.6)
    col = heat
    if crust_at is not None:
        n1 = t.noise(v, scale, 6.0, 0.62, 0.4)
        cm = t.ramp(n1, [(crust_at - 0.04, (0, 0, 0, 1)), (crust_at + 0.04, (1, 1, 1, 1))])
        col = t.mix(heat, srgb(*crust), cm)
        em = fmath(t, "MULTIPLY", em, fmath(t, "SUBTRACT", 1.0, cm))
        t.bump(cm, 0.6, 0.06)
        t.set(rough=t.ramp(n1, [(crust_at - 0.04, (0.25, 0.25, 0.25, 1)), (crust_at + 0.04, (0.9, 0.9, 0.9, 1))]))
    else:
        t.set(rough=0.3)
    pv = value(t)
    if swing:
        PULSE.append((pv, swing, phase))
    t.set(**{"Base Color": col, "Emission Color": heat, "Emission Strength": fmath(t, "MULTIPLY", em, pv.outputs[0])})
    MATS[name] = t.m
    return t.m


def brew3(name, deep, mid, bright, rim, strength=0.9, scale=1.0, drift=0.3, phase=0.0):
    """imats.brew (the surface Lab's dome recipe: clouds of brew looked up behind the glass, a bright rim, a clear
    coat), its two cloud layers on mapping nodes that turn() slides round circles, opposite ways: the brew churns."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    tc = t.n("ShaderNodeTexCoord")
    geo = t.n("ShaderNodeNewGeometry")
    lay = []
    for j, (depth, sc) in enumerate(((0.45, 1.7), (1.3, 1.2))):
        back = t.n("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        t.link(geo.outputs["Incoming"], back.inputs[0])
        back.inputs[1].default_value = (-depth,) * 3
        t.link(tc.outputs["Object"], back.inputs[2])
        mp = t.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (sc * scale,) * 3
        t.link(back.outputs[0], mp.inputs["Vector"])
        if drift:
            DRIFT.append((mp, (0.0, 0.0, 0.0), drift * (1 if j else -0.7), phase + 2.1 * j))
        lay.append(t.noise(mp.outputs[0], 0.9, 1.5, 0.5, 2.0))
    col = t.ramp(lay[1], [(0.36, srgb(*deep)), (0.47, srgb(*mid)), (0.6, srgb(*bright)), (0.72, srgb(*rim))])
    band = t.ramp(lay[0], [(0.36, (0, 0, 0, 1)), (0.47, (0.6, 0.6, 0.6, 1)), (0.52, (0.6, 0.6, 0.6, 1)),
                           (0.63, (0, 0, 0, 1))])
    col = t.mix(col, srgb(*deep), band)
    lw = t.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.3
    col = t.mix(col, srgb(*rim), t.ramp(lw.outputs["Facing"], [(0.35, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))]))
    t.set(**{"Base Color": col, "rough": 0.08, "metal": 0.0, "spec": 0.7, "coat": 1.0})
    t.bsdf.inputs["Coat Roughness"].default_value = 0.05
    t.set(**{"Emission Color": col, "Emission Strength": strength * DIM})
    MATS[name] = t.m
    return t.m


def mats():
    W = worn
    bare = (150, 140, 128)
    M["iron"] = W("l3-iron", (52, 49, 52), rough=0.5, metal=0.8, wear=(92, 84, 78), rust=(104, 54, 32), scale=2.2,
                  dirt=0.4, soot=0.6, rust_at=0.58, edge=bare)
    M["frame"] = W("l3-frame", (46, 38, 34), rough=0.55, metal=0.6, wear=(88, 64, 46), rust=(96, 48, 28), scale=3.5,
                   dirt=0.4, soot=0.5, edge=(128, 112, 98))
    M["deck"] = W("l3-deck", (58, 52, 52), rough=0.5, metal=0.7, wear=(104, 92, 82), rust=(104, 54, 32), scale=1.6,
                  dirt=0.3, soot=0.65, rust_at=0.54, edge=bare, dents=0.8)
    M["deckside"] = W("l3-deckside", (44, 40, 40), rough=0.6, metal=0.6, wear=(84, 74, 66), rust=(100, 52, 30),
                      scale=2.0, dirt=0.3, soot=0.5, rust_at=0.6, edge=bare, streaks=0.9)
    M["deckedge"] = W("l3-deckedge", (50, 40, 36), rough=0.65, metal=0.4, wear=(88, 66, 52), rust=(96, 50, 30),
                      scale=3.0, dirt=0.4, soot=0.6, edge=(128, 112, 98), dents=0.8)
    M["band"] = W("l3-band", (128, 84, 38), rough=0.42, metal=0.8, wear=(84, 54, 26), rust=(60, 92, 74), scale=3.0,
                  dirt=0.4, soot=0.55, rust_at=0.66, edge=(196, 150, 84))
    M["rivet"] = W("l3-rivet", (112, 104, 96), rough=0.45, metal=0.8, wear=(70, 64, 60), scale=6.0, dirt=0.2, soot=0.3,
                   streaks=0.0, dents=0.0)
    M["bolt"] = W("l3-bolt", (84, 78, 74), rough=0.45, metal=0.8, wear=(120, 112, 104), scale=6.0, dirt=0.2, soot=0.3,
                  streaks=0.0, dents=0.0)
    M["bell"] = W("l3-bell", (70, 68, 72), rough=0.4, metal=0.85, wear=(122, 114, 108), rust=(108, 58, 34), scale=3.0,
                  dirt=0.3, soot=0.6, rust_at=0.6, dents=0.9, streaks=0.9)
    M["coil"] = W("l3-coil", (150, 80, 42), rough=0.4, metal=0.85, wear=(96, 52, 30), rust=(60, 104, 84), scale=8.0,
                  dirt=0.1, soot=0.35, rust_at=0.68, streaks=0.0, dents=0.0)
    M["hole"] = kit.flat("l3-hole", (10, 8, 8), rough=1.0)
    M["doorplate"] = W("l3-doorplate", (64, 60, 60), rough=0.55, metal=0.6, wear=(104, 96, 90), rust=(100, 52, 32),
                       scale=4.0, dirt=0.35, soot=0.5, edge=bare)
    M["groove"] = kit.flat("l3-groove", (14, 12, 12), rough=0.9)
    M["stone"] = rock3("l3-stone", (34, 30, 30), (66, 60, 56), scale=2.5)
    M["wall"] = rock3("l3-basalt", (36, 32, 32), (70, 62, 58), crack=GLOW, crack_scale=0.9, crack_cover=0.5, glow=5.0,
                      scale=2.0, swing=0.3)
    M["block"] = rock3("l3-block", (40, 36, 36), (76, 68, 62), crack=GLOW, crack_scale=0.9, crack_cover=0.42, glow=5.0,
                       scale=2.0, swing=0.3, phase=0.8)
    M["backing"] = magma3("l3-backing", crust_at=0.44, strength=3.2, scale=1.1, swing=0.35, phase=0.4)
    M["bone"] = imats.bone("l3-bone", col=(176, 158, 122), tip=(52, 42, 36), z0=11.0, z1=15.6)
    M["bone2"] = imats.bone("l3-bone2", col=(170, 152, 116), tip=(52, 42, 36), z0=10.4, z1=13.6)
    M["bone3"] = imats.bone("l3-bone3", col=(176, 158, 122), tip=(52, 42, 36), z0=15.4, z1=18.0)
    M["bonelow"] = W("l3-bonelow", (172, 152, 114), rough=0.7, metal=0.0, wear=(118, 100, 74), scale=3.0, dirt=0.55,
                     soot=0.6, edge=(206, 190, 150), dents=0.7, streaks=0.9)
    M["pilaster"] = W("l3-pilaster", (136, 122, 94), rough=0.7, metal=0.0, wear=(92, 80, 60), scale=3.0, dirt=0.4,
                      soot=0.7, edge=(190, 174, 138), dents=0.7)
    M["lava"] = magma3("l3-lava", crust_at=0.5, strength=2.6, scale=1.4, swing=0.3, phase=1.6, drift=0.22)
    green = ((22, 86, 20), (70, 170, 36), (168, 240, 60), (226, 255, 150))
    M["dome"] = brew3("l3-green", *green, strength=0.8 if not STATE else 0.5, drift=0.3)
    M["pipe"] = brew3("l3-pipegreen", (16, 60, 14), (50, 124, 28), (128, 200, 48), (190, 236, 120), strength=0.45,
                      scale=2.6, drift=0.16, phase=1.0)
    M["vessel"] = brew3("l3-vessel", (18, 70, 16), (60, 150, 32), (150, 224, 54), (210, 250, 140), strength=0.6,
                        scale=2.4, drift=0.14, phase=2.4)
    M["fire"] = brew3("l3-fire", (60, 170, 30), (130, 230, 50), (200, 255, 110), (240, 255, 190), strength=2.2,
                      scale=2.0, drift=0.3, phase=0.5)
    M["bubble"] = kit.flat("l3-bubble", (206, 250, 140), rough=0.15, emit=1.0 * DIM)
    M["leak"] = kit.flat("l3-leak", (120, 220, 50), rough=0.1, emit=0.9)


# ------------------------------------------------------------------------------------------------------------ the body
def posts(name, poly, z0, z1, skip=(), w=0.32):
    for i, p in enumerate(poly):
        if i in skip:
            continue
        box(f"{name}{i}", (w, w, z1 - z0), (p[0], p[1], z0), M["frame"], rot=(0, 0, 45), bevel=0.04)


def blocks(name, a, b, door, seed, parent, missing=0.0, zmax=None):
    """One front face of the lower tier clad in rough basalt blocks, in courses, all one mesh (so the stone's pattern
    and cracks run on across the joints): each block its own width and depth, a little askew, the joints open to the
    magma behind. door: (from, to, top) along the face, left clear. Returns the places of the blocks left out."""
    a, b, t, n, ang = face(a, b)
    length = (b - a).length
    rr = random.Random(seed)
    bm = bmesh.new()
    lost = []
    for ci, (c0, c1) in enumerate(zip(BLOCK_Z, BLOCK_Z[1:])):
        spans = [(0.2, length - 0.2)]
        if c0 < door[2] - 0.01:
            spans = [(0.2, door[0]), (door[1], length - 0.2)]
        for s0, s1 in spans:
            s, first = s0, True
            while s < s1 - 0.05:
                w = rr.uniform(0.7, 1.25) * (0.55 if first and ci % 2 else 1.0)
                first = False
                e = min(s1, s + w)
                if s1 - e < 0.45:
                    e = s1
                d = rr.uniform(0.12, 0.27)
                turn_ = rr.uniform(-1.6, 1.6)
                p = a + t * ((s + e) / 2) + n * (d / 2 - 0.02)
                gone = rr.random() < missing or (zmax is not None and c0 >= zmax)
                if gone:
                    lost.append((p.x, p.y, (c0 + c1) / 2, e - s))
                else:
                    m = Matrix.Translation((p.x, p.y, (c0 + c1) / 2)) @ Matrix.Rotation(math.radians(ang + turn_), 4, "Z") \
                        @ Matrix.Diagonal((e - s - 0.07, d + 0.04, c1 - c0 - 0.07, 1))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
                s = e
    ob = mesh_ob(name, bm, [M["block"]], smooth=False, bevel=0.05, segs=2, parent=parent)
    imats.roughen(ob, strength=0.075, size=0.45, levels=2)
    return lost


LOST = []       # where the damaged look's missing blocks were (rubble lies under them)


def lower():
    out = xy(LW)
    lay = layer("cracks")
    wz = LW_Z if not DEAD else 1.4
    prism("lwall", out, 0.0, wz, M["wall"], bevel=0.05, parent=lay)
    posts("lpost", out, 0.0, wz, skip=(2, 3, 4, 5))
    # the skirt stands out under the blocks; at the sharp side corners it is cut back (a mitre would stick out)
    sk = [tuple(Vector(o) + (Vector(p) - Vector(o)).normalized() * min(0.3, (Vector(p) - Vector(o)).length))
          for o, p in zip(out, widen(out, 0.2))]
    prism("lskirt", sk, 0.0, 0.3, M["frame"], bevel=0.03)
    if not DEAD:
        prism("lband", widen(out, 0.08), LW_Z - 0.3, LW_Z, M["band"], bevel=0.03)
    pts = []
    for a, b in faces_of(out):
        n = max(1, int((Vector(b) - Vector(a)).length / 0.75))
        if not DEAD:
            pts += edge_pts(a, b, n, LW_Z - 0.15, 0.1, inset=0.06)
        pts += edge_pts(a, b, n, 0.15, 0.22, inset=0.06)
    studs("lrivet", pts, 0.07, M["rivet"])
    # the two front faces: basalt blocks over a sheet of magma (the joints glow where its crust has broken)
    for k, (i, j) in enumerate(((0, 1), (6, 7))):
        a, b, t, n, ang = face(out[i], out[j])
        length = (b - a).length
        dc = length * (DOOR_F if k == 0 else 1 - DOOR_F)
        hw = DOOR_W / 2 + 0.27
        mid = (a + b) / 2 + n * 0.01
        bh = (BLOCK_Z[-1] - BLOCK_Z[0]) if not DEAD else 1.0
        box(f"backing{k}", (length - 0.3, 0.06, bh), (mid.x, mid.y, BLOCK_Z[0]), M["backing"], rot=(0, 0, ang),
            bevel=0.0, parent=lay)
        LOST.extend(blocks(f"blocks{k}", a, b, (dc - hw, dc + hw, 3.3), 300 + k, lay,
                           missing={"": 0.0, "damaged": 0.3, "destroyed": 0.35}[STATE], zmax=1.4 if DEAD else None))
    # the bone columns at the front corners: a stack of sharp double cones up to the beam
    for k, (u, v) in enumerate((COIL_UV, (-COIL_UV[0], COIL_UV[1]))):
        x, y = uv(u, v)
        prof = [(0.0, 0.0), (0.42, 0.0), (0.42, 0.12)]
        for j in range(7):
            z0 = 0.14 + j * 0.58
            prof += [(0.24, z0), (0.58, z0 + 0.28), (0.6, z0 + 0.29), (0.58, z0 + 0.3), (0.24, z0 + 0.58)]
        prof += [(0.42, LW_Z), (0.0, LW_Z)]
        lathe(f"coil{k}", prof, (x, y, 0.0), M["bonelow"], verts=28)
    ca, cb = Vector(uv(*COIL_UV)), Vector(uv(-COIL_UV[0], COIL_UV[1]))
    _, _, tb, nb, angb = face(ca, cb)
    p = (ca + cb) / 2
    box("lbeam", ((cb - ca).length, 0.34, 0.42), (p.x, p.y, LW_Z - 0.42), M["band"], rot=(0, 0, angb), bevel=0.04)
    # the recess between the columns: the engraved door in the middle, brass strips
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
    for j, (sx, sz, w, h) in enumerate(((-ex, dz + dh / 2, 0.12, dh - 0.16), (ex, dz + dh / 2, 0.12, dh - 0.16),
                                        (0.0, dz + dh - 0.08, 2 * ex, 0.12))):
        p = mid + t * sx + n * face_n
        box(f"ldoorgroove-e{j}", (w, 0.05, h), (p.x, p.y, sz), M["groove"], rot=(0, 0, ang), bevel=0.01,
            origin="centre")
    p = mid + n * 0.14
    box("ldoorsill", (dw + 0.1, 0.24, 0.22), (p.x, p.y, dz - 0.2), M["rivet"], rot=(0, 0, ang), bevel=0.04)
    if not DEAD:
        for s in (-2.2, -1.4, 1.4, 2.2):
            p = mid + t * s + n * 0.03
            box(f"lstrip{s}", (0.12, 0.06, LW_Z - 0.6), (p.x, p.y, 0.3), M["band"], rot=(0, 0, ang), bevel=0.02)
    # the side doors: a frame round a dark opening, a plate on the ground in front with a lava vat on it
    for k in (0, 1):
        a, b = (out[0], out[1]) if k == 0 else (out[6], out[7])
        f = DOOR_F if k == 0 else 1 - DOOR_F
        a, b, t, n, ang = face(a, b)
        c = a.lerp(b, f)
        w = DOOR_W
        if not DEAD:
            box(f"sdoorhole{k}", (w, 0.1, 2.7), (c.x + n.x * 0.01, c.y + n.y * 0.01, 0.3), M["hole"], rot=(0, 0, ang),
                bevel=0.0)
            for j, s in enumerate((-1, 1)):
                p = c + t * (s * (w / 2 + 0.12)) + n * 0.13
                box(f"sdoorjamb{k}{j}", (0.24, 0.36, 3.15), (p.x, p.y, 0.0), M["frame"], rot=(0, 0, ang))
            p = c + n * 0.13
            box(f"sdoorlintel{k}", (w + 0.5, 0.36, 0.3), (p.x, p.y, 3.0), M["frame"], rot=(0, 0, ang))
        p = c + n * 1.3
        box(f"sdoorplate{k}", (w + 1.2, 2.5, 0.14), (p.x, p.y, 0.0), M["deckedge"], rot=(0, 0, ang), bevel=0.03)
        vat(k, c, t, n)
        if LEVEL >= 2 and not DEAD:
            canister(k, a, b, t, n)


def vat(k, c, t, n):
    """An iron vat of lava on the side door's plate, where the surface Lab has its cog."""
    p = c + n * 1.2
    z = 0.14
    ob = lathe(f"vat{k}", [(0.0, 0.0), (0.72, 0.0), (1.0, 0.3), (1.08, 0.78), (0.92, 0.78), (0.86, 0.45), (0.0, 0.42)],
               (p.x, p.y, z), M["iron"], verts=32)
    dent(ob, 0.05, 0.45)
    lathe(f"vatlava{k}", [(0.0, 0.0), (0.9, 0.0)], (p.x, p.y, z + 0.64), M["lava"], verts=32, parent=layer(f"vat{k}"))
    kit.ring(f"vatrim{k}", 1.0, 0.07, M["band"], z=0.0).location = (p.x, p.y, z + 0.78)


def canister(k, a, b, t, n):
    """Level 2: a glass canister of brew strapped to the front wall between the side door and the column: iron caps,
    two iron straps bolted to the wall, a copper tube from its top up into the deck's band."""
    f = CAN_F if k == 0 else 1 - CAN_F
    c = a.lerp(b, f) + n * 0.74
    r, z0, z1 = 0.3, 1.55, 3.35
    lay = layer(f"canister{k}")
    cyl(f"canisterglass{k}", r, z1 - z0, (c.x, c.y, z0), M["vessel"], verts=28, bevel=0.0, parent=lay)
    lathe(f"canistercap{k}b", [(0.0, -0.28), (0.12, -0.24), (0.35, 0.0), (0.37, 0.16), (0.0, 0.16)], (c.x, c.y, z0),
          M["iron"], verts=24)
    lathe(f"canistercap{k}t", [(0.0, 0.0), (0.37, 0.0), (0.35, 0.14), (0.18, 0.3), (0.0, 0.32)], (c.x, c.y, z1 - 0.08),
          M["iron"], verts=24)
    for j, z in enumerate((z0 + 0.45, z1 - 0.5)):
        kit.ring(f"canisterstrap{k}{j}", r + 0.03, 0.055, M["frame"], z=0.0).location = (c.x, c.y, z)
        for s in (-1, 1):                     # the strap's two arms back to the wall
            p = c + t * (s * (r + 0.02)) - n * 0.3
            box(f"canisterarm{k}{j}{s}", (0.1, 0.62, 0.12), (p.x, p.y, z), M["frame"], rot=(0, 0, math.degrees(
                math.atan2(t.y, t.x))), bevel=0.02, origin="centre")
    top = Vector((c.x, c.y, z1 + 0.2))
    back = Vector((n.x, n.y, 0.0))
    tube(f"canistertube{k}", [tuple(top), tuple(top + Vector((0, 0, 0.45))), tuple(top - back * 0.2 + Vector((0, 0, 0.8))),
                              tuple(top - back * 0.46 + Vector((0, 0, 0.95)))], 0.09, M["coil"], verts=8, smooth=True)


def halves(poly, u0, seed, jag=0.5):
    """A screen-plan outline broken in two along a jagged line near u = u0 (the destroyed look's decks)."""
    rr = random.Random(seed)
    vs = [v for u, v in poly]
    v0, v1 = min(vs), max(vs)

    def cut(vv):
        """The outline's u-extent at height vv is not needed: only the cut's own points, clipped to the outline."""
        return u0
    line = []
    n = 7
    for i in range(n + 1):
        vv = v1 - (v1 - v0) * i / n
        line.append((u0 + (rr.uniform(-jag, jag) if 0 < i < n else 0.0), vv))
    # keep the cut's points that lie inside the outline (the back of a pentagon narrows to a point)
    def inside(p):
        x, y = p
        c = False
        for (x1, y1), (x2, y2) in faces_of(poly):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
        return c
    line = [line[0]] + [p for p in line[1:] if inside(p)]
    # where the back end of the cut leaves the outline: straight back from its last point
    lx, ly = line[-1]
    best = None
    for (x1, y1), (x2, y2) in faces_of(poly):
        if (x1 - lx) * (x2 - lx) <= 0 and x1 != x2:
            yy = y1 + (y2 - y1) * (lx - x1) / (x2 - x1)
            if yy < ly and (best is None or yy > best):
                best = yy
    line.append((lx, best if best is not None else v0))
    left = [p for p in poly if p[0] < u0 and p[1] > line[-1][1] - 50]
    right = [p for p in poly if p[0] >= u0]
    back = [p for p in poly if p[1] == v0]
    a = [p for p in left if p not in back] + line
    b = line[::-1] + [p for p in right if p not in back]
    for p in back:                      # the back point goes to the half it lies in
        (a if p[0] < lx else b).append(p)

    def order(pts):                     # round the middle, so the outline does not cross itself
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        return sorted(pts, key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
    return order(a), order(b)


def lower_deck():
    if DEAD:
        for nm, poly in zip("AB", halves(LD, -0.6, 11)):
            prism("ldeck" + nm, xy(poly), LD_Z0, LD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
        return
    out = xy(LD)
    ob = prism("ldeck", out, LD_Z0, LD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
    chips = []
    for u, v, s in ((-7.9, 1.3, 0.3), (-3.2, 3.75, 0.26), (2.1, 3.75, 0.34), (6.6, 2.5, 0.28), (8.6, 0.7, 0.24)):
        chips.append(uv(u, v) + (LD_Z1 + 0.05, s))
    chips += [uv(-1.0, 3.8) + (LD_Z0 - 0.02, 0.26), uv(4.4, 3.8) + (LD_Z0, 0.22)]
    notch(ob, chips, 40)
    pts = []
    for u, v in ((-7.3, -0.6), (7.3, -0.6), (-5.6, 3.1), (5.6, 3.1)):
        x, y = uv(u, v)
        pts.append(((x, y, LD_Z1 + 0.01), (0, 0, 1)))
    studs("ldeckrivet", pts, 0.19, M["rivet"], squash=0.5)


def upper():
    out = xy(UW)
    if DEAD:
        return
    prism("uwall", out, LD_Z1, UD_Z0, M["iron"], bevel=0.05)
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
        box(f"ustrip{s}", (0.1, 0.05, UD_Z0 - LD_Z1 - 0.3), (p.x, p.y, LD_Z1 + 0.15), M["band"], rot=(0, 0, ang),
            bevel=0.02)
    band = widen(out, 0.06)
    prism("uband", band, UD_Z0 - 0.26, UD_Z0, M["band"], bevel=0.03)
    pts = []
    for a, b in faces_of(out):
        n_ = max(1, int((Vector(b) - Vector(a)).length / 0.75))
        pts += edge_pts(a, b, n_, UD_Z0 - 0.13, 0.08, inset=0.06)
    studs("urivet", pts, 0.07, M["rivet"])
    a, b = out[0], out[1]

    def on(a, b, f, z, o):
        a, b, t, n, _ = face(a, b)
        p = a.lerp(b, f) + n * o
        return ((p.x, p.y, z), (n.x, n.y, 0.0))
    bolts = [on(a, b, f, z, 0.03) for f, z in ((0.25, 6.2), (0.18, 8.5), (0.7, 6.2), (0.82, 8.5))]
    a, b = out[1], out[2]
    bolts += [on(a, b, f, z, 0.03) for f, z in ((0.2, 5.8), (0.2, 8.5), (0.85, 5.8), (0.85, 8.5))]
    bolts += [(mir(p), mir(n)) for p, n in bolts]
    studs("ubolt", bolts, 0.17, M["bolt"], squash=0.45)
    # the glass pipes of brew: straight out of the upper side faces, a quarter bend down to a flange on the lower deck
    for k, (i, j) in enumerate(((0, 1), (6, 7))):
        a2, b2, t, n, _ = face(out[i], out[j])
        w = a2.lerp(b2, PIPE_F if k == 0 else 1 - PIPE_F)
        a = Vector((w.x, w.y, PIPE_Z))
        n3 = Vector((n.x, n.y, 0.0))
        drop = PIPE_Z - LD_Z1
        pts = [a, a + n3 * 0.35, a + n3 * (PIPE_OUT * 0.75) + Vector((0, 0, -0.15)),
               a + n3 * PIPE_OUT + Vector((0, 0, -drop * 0.45)), a + n3 * PIPE_OUT + Vector((0, 0, -drop + 0.12))]
        tube(f"pipe{k}", [tuple(p) for p in pts], 0.44, M["pipe"], verts=16, smooth=True, parent=layer(f"pipe{k}"))
        c = a + n3 * PIPE_OUT
        cyl(f"pipeflange{k}", 0.7, 0.16, (c.x, c.y, LD_Z1), M["band"], verts=28)
        ob = cyl(f"pipecollar{k}", 0.5, 0.1, tuple(a + n3 * 0.02), M["band"], verts=24)
        ob.rotation_euler = n3.to_track_quat("Z", "Y").to_euler()


def upper_deck():
    cx, cy = PL_C
    sq = [(cx - PL_H, cy - PL_H), (cx + PL_H, cy - PL_H), (cx + PL_H, cy + PL_H), (cx - PL_H, cy + PL_H)]
    prism("plinth", sq, UD_Z1, PL_Z, M["stone"], bevel=0.05)
    if DEAD:
        for nm, poly in zip("AB", halves(UD, 0.8, 12)):
            prism("udeck" + nm, xy(poly), UD_Z0, UD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
        return
    out = xy(UD)
    ob = prism("udeck", out, UD_Z0, UD_Z1, M["deck"], bevel=0.06, side_mat=M["deckside"])
    chips = [uv(u, v) + (UD_Z1 + 0.04, s) for u, v, s in ((-4.6, 2.3, 0.3), (0.9, 2.3, 0.24), (4.7, 2.3, 0.2),
                                                           (-7.1, 0.9, 0.22))]
    chips += [uv(-2.0, 2.35) + (UD_Z0 - 0.02, 0.22), uv(3.3, 2.35) + (UD_Z0, 0.26)]
    notch(ob, chips, 60)
    pts = []
    for u, v in ((-6.5, 0.8), (6.5, 0.8), (-2.4, 1.85), (2.4, 1.85), (-5.0, -1.3), (5.0, -1.3), (-1.8, -3.3),
                 (1.8, -3.3)):
        x, y = uv(u, v)
        pts.append(((x, y, UD_Z1 + 0.01), (0, 0, 1)))
    studs("udeckrivet", pts, 0.19, M["rivet"], squash=0.5)


BIG_BELL = [(0.0, 0.0), (1.25, 0.0), (1.28, 0.14), (1.2, 0.3), (0.98, 0.36), (0.9, 0.42), (0.84, 0.5), (0.82, 2.0),
            (0.87, 2.08), (0.84, 2.18), (0.7, 2.4), (0.5, 2.6), (0.42, 2.75), (0.44, 2.9), (0.0, 2.92)]
SMALL_BELL = [(0.0, 0.0), (1.0, 0.0), (1.04, 0.12), (0.96, 0.26), (0.8, 0.32), (0.78, 0.5), (0.8, 1.25), (0.74, 1.5),
              (0.58, 1.72), (0.36, 1.84), (0.24, 1.9), (0.26, 2.0), (0.0, 2.02)]
BIG_COIL = 1.85


def top():
    pc = (PL_C[0], PL_C[1], PL_Z)
    pl, pr = uv(*BELL_S) + (UD_Z1,), mir(uv(*BELL_S)) + (UD_Z1,)
    # the big bell and its copper coil
    ob = lathe("bellC", BIG_BELL, pc, M["bell"], verts=40)
    dent(ob, 0.05, 0.6)
    tz = pc[2] + BIG_BELL[-1][1]
    turns, r = 4.5, 0.42
    n = int(30 * turns)
    pts = [(pc[0] + r * math.cos(2 * math.pi * turns * i / n), pc[1] + r * math.sin(2 * math.pi * turns * i / n),
            tz - 0.05 + BIG_COIL * i / n) for i in range(n + 1)]
    tube("bellCcoil", pts, r * 0.22, M["coil"], verts=8)
    cyl("bellCpost", r * 0.45, BIG_COIL + 0.1, (pc[0], pc[1], tz - 0.1), M["bolt"], verts=12)
    big = Vector((pc[0], pc[1], tz + BIG_COIL + 0.05))
    q = big + Vector((0, 0, 0.1))
    for k, at in enumerate((pl, pr)):
        ob = lathe("bellL" if k == 0 else "bellR", SMALL_BELL, at, M["bell"], verts=40)
        dent(ob, 0.045, 0.55)
        p = Vector((at[0], at[1], at[2] + SMALL_BELL[-1][1]))
        side = q - p
        side.z = 0
        reach = side.length
        inw = side.normalized()                 # from the small bell toward the middle
        # the horn stands in a brass socket on the bell's cap, swells outward, then sweeps in over the big bell: one
        # even curve (round 2's doubled back on itself just above the bell: the kink)
        lathe(f"hornseat{k}", [(0.0, -0.1), (0.36, -0.1), (0.46, 0.02), (0.47, 0.3), (0.4, 0.34), (0.0, 0.34)],
              tuple(p), M["band"], verts=24)
        path = [(0.0, 0.0), (-0.24, 0.8), (-0.12, 1.65), (0.72, 2.5), (reach - 0.95, 3.35)]
        tube(f"horn{k}", [tuple(p + inw * d + Vector((0, 0, h))) for d, h in path], 0.37, M["bone"], verts=16,
             r_end=0.04, smooth=True)
        if LEVEL >= 2:
            # level 2: a copper coil wound round the bell, and a second, shorter horn curving out from its shoulder
            turns, r = 3.0, 0.86
            n = int(30 * turns)
            tube(f"bcoil{k}", [(at[0] + r * math.cos(2 * math.pi * turns * i / n),
                                at[1] + r * math.sin(2 * math.pi * turns * i / n), at[2] + 0.5 + 0.75 * i / n)
                               for i in range(n + 1)], 0.07, M["coil"], verts=8)
            root = Vector(at) - inw * 0.66 + Vector((0, 0, 1.5))
            dirn = (-inw + Vector((0, 0, 0.75))).normalized()
            ob = lathe(f"horn2seat{k}", [(0.0, -0.3), (0.3, -0.3), (0.34, -0.05), (0.35, 0.16), (0.28, 0.2), (0.0, 0.2)],
                       tuple(root), M["band"], verts=20)
            ob.rotation_euler = dirn.to_track_quat("Z", "Y").to_euler()
            path = [(0.66, 1.5), (1.02, 1.82), (1.5, 2.3), (1.86, 3.0), (1.92, 3.7)]
            tube(f"horn2{k}", [tuple(Vector(at) - inw * d + Vector((0, 0, h))) for d, h in path], 0.25, M["bone2"],
                 verts=14, r_end=0.03, smooth=True)
    if LEVEL >= 3:
        crown(big)


def crown(big):
    """Level 3: the big bell's coil carries a brazier: a brass collar on the coil's post, an iron stem and bowl of
    green fire, three bone prongs rising from the bowl's rim round the fire."""
    x, y, z = big
    cyl("crowncollar", 0.3, 0.22, (x, y, z - 0.22), M["band"], verts=20)
    cyl("crownstem", 0.21, 0.75, (x, y, z - 0.05), M["iron"], verts=14)
    bz = z + 0.6
    ob = lathe("crownbowl", [(0.0, 0.0), (0.3, 0.0), (0.78, 0.3), (0.92, 0.72), (0.78, 0.72), (0.68, 0.42), (0.0, 0.38)],
               (x, y, bz), M["iron"], verts=28)
    dent(ob, 0.035, 0.4)
    kit.ring("crownrim", 0.85, 0.07, M["band"], z=0.0).location = (x, y, bz + 0.72)
    lay = layer("crown")
    fl = lathe("crownfire", [(0.0, 0.0), (0.52, 0.06), (0.64, 0.4), (0.5, 0.95), (0.24, 1.45), (0.0, 1.85)],
               (x, y, bz + 0.46), M["fire"], verts=24, parent=lay)
    sub = fl.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    FLAMES.append((fl, 0.0))
    for j in range(3):
        a = math.radians(-45 + 120 * j + 60)
        d = Vector((math.cos(a), math.sin(a), 0.0))
        c = Vector((x, y, bz))
        tube(f"crownprong{j}", [tuple(c + d * 0.78 + Vector((0, 0, 0.55))), tuple(c + d * 1.18 + Vector((0, 0, 1.15))),
                                tuple(c + d * 1.1 + Vector((0, 0, 1.9))), tuple(c + d * 0.62 + Vector((0, 0, 2.6)))],
             0.19, M["bone3"], verts=12, r_end=0.025, smooth=True)


def dome():
    cx, cy = uv(*DOME_UV)
    z0 = LD_Z1
    lathe("domering", [(0.0, 0.0), (DOME_R + 0.22, 0.0), (DOME_R + 0.26, 0.18), (DOME_R + 0.12, 0.34), (0.0, 0.34)],
          (cx, cy, z0), M["iron"], verts=48)
    lay = layer("dome")
    prof = [(DOME_R * math.cos(math.radians(a)), 0.85 * DOME_R * math.sin(math.radians(a))) for a in range(0, 91, 6)]
    ob = lathe("dome", prof, (cx, cy, z0 + 0.3), M["dome"], verts=48, parent=lay)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    if not STATE:
        rr = random.Random(77)
        for i in range(9):                  # bubbles rising up the inside of the glass, on the side we see
            b = kit.blob(f"bubble{i}", (cx, cy, z0 + 0.3), 1.0, squash=1.0, mat=M["bubble"], parent=lay)
            BUBBLES.append((b, math.radians(-45 + rr.uniform(-75, 75)), rr.uniform(0.09, 0.17), i / 9 + rr.uniform(0, 0.08)))
    for k, mirrored in enumerate((False, True)):
        f = mir if mirrored else (lambda p: p)
        a = Vector(f(uv(-2.4, 1.6)) + (z0 + 0.2,))
        c = Vector(f(uv(-4.2, 3.4)) + (z0,))
        tube(f"domewire{k}", [tuple(a), tuple((a + c) / 2 + Vector((0, 0, 0.3))), tuple(c + Vector((0, 0, 0.12)))],
             0.07, M["coil"], verts=8, smooth=True)
        cyl(f"domeclamp{k}", 0.24, 0.16, tuple(c), M["band"], verts=16)


def extras():
    # an iron spike on a brass seat on each deck's side corners
    for i, (u, v, z, h) in enumerate(((-8.5, 0.0, LD_Z1, 1.25), (8.5, 0.0, LD_Z1, 1.25), (-6.75, 0.35, UD_Z1, 1.0),
                                      (6.75, 0.35, UD_Z1, 1.0))):
        x, y = uv(u, v)
        nm = "lcorner" if i < 2 else "ucorner"
        cyl(f"{nm}seat{i}", 0.36, 0.16, (x, y, z), M["band"], verts=16)
        lean = Vector(uv(1 if u > 0 else -1, 0) + (0,)).normalized() * 0.28 + Vector((0, 0, 1))
        ob = cyl(f"{nm}spike{i}", 0.26, h, (x, y, z + 0.12), M["iron"], verts=16, bevel=0.0, r2=0.02)
        ob.rotation_euler = lean.to_track_quat("Z", "Y").to_euler()
    # basalt rubble on the ground at the two side corners and in the recess beside the door
    for i, (u, v, r) in enumerate(((-9.6, -0.25, 0.4), (-9.15, -1.0, 0.3), (9.4, 0.25, 0.4), (9.75, -0.5, 0.28),
                                   (-2.2, 2.2, 0.26), (2.05, 2.35, 0.3))):
        x, y = uv(u, v)
        lump(f"rubble{i}", (x, y, 0.06), r, M["stone"], seed=500 + i)
    if LEVEL >= 3 and not DEAD:
        flasks()
        channel()


def flasks():
    """Level 3: a round flask of brew on an iron foot at each front corner of the upper deck."""
    for k in (0, 1):
        x, y = uv(*FLASK_UV) if k == 0 else mir(uv(*FLASK_UV))
        z = UD_Z1
        cyl(f"flaskfoot{k}", 0.34, 0.14, (x, y, z), M["iron"], verts=20)
        lay = layer(f"flask{k}")
        kit.blob(f"flaskglass{k}", (x, y, z + 0.5), 0.43, squash=0.92, mat=M["vessel"], parent=lay)
        cyl(f"flaskneck{k}", 0.14, 0.4, (x, y, z + 0.82), M["vessel"], verts=16, bevel=0.0, parent=lay)
        cyl(f"flasklip{k}", 0.19, 0.1, (x, y, z + 1.18), M["band"], verts=16)


def channel():
    """Level 3: a channel of lava round the front foot, from column to column: the lava on the ground between two
    curbs of rough basalt blocks, an iron grate across it in front of the door."""
    pts = [Vector(uv(u, v)) for u, v in CHANNEL]
    dense = []
    for a, b in zip(pts, pts[1:]):
        k = max(1, int((b - a).length / 0.42))
        dense += [a.lerp(b, i / k) for i in range(k)]
    dense.append(pts[-1])
    bm = bmesh.new()
    rows = []
    for i, p in enumerate(dense):
        t = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        s = Vector((t.y, -t.x))
        rows.append((bm.verts.new((p.x + s.x * 0.25, p.y + s.y * 0.25, 0.1)),
                     bm.verts.new((p.x - s.x * 0.25, p.y - s.y * 0.25, 0.1))))
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, b0, b1, a1))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob("channellava", bm, [M["lava"]], smooth=False, parent=layer("channel"))
    for f in ob.data.polygons:
        if f.normal.z < 0:
            f.flip()
    rr = random.Random(90)
    bm = bmesh.new()
    for i, p in enumerate(dense):
        t = (dense[min(i + 1, len(dense) - 1)] - dense[max(i - 1, 0)]).normalized()
        s = Vector((t.y, -t.x))
        ang = math.atan2(t.y, t.x)
        for side in (-1, 1):
            c = p + s * (side * 0.36)
            h = rr.uniform(0.16, 0.22)
            m = Matrix.Translation((c.x, c.y, h / 2)) @ Matrix.Rotation(ang + rr.uniform(-0.15, 0.15), 4, "Z") @ \
                Matrix.Diagonal((rr.uniform(0.36, 0.44), rr.uniform(0.2, 0.26), h, 1))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        if i in (0, len(dense) - 1):                    # a block across each end
            m = Matrix.Translation((p.x, p.y, 0.1)) @ Matrix.Rotation(ang, 4, "Z") @ Matrix.Diagonal((0.24, 0.6, 0.2, 1))
            bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    ob = mesh_ob("channelcurb", bm, [M["stone"]], smooth=False, bevel=0.04, segs=2)
    imats.roughen(ob, strength=0.06, size=0.4, levels=2)
    g = Vector(uv(0.0, 5.0))
    box("channelgrate", (1.7, 1.1, 0.06), (g.x, g.y, 0.21), M["deckedge"], rot=(0, 0, 45), bevel=0.02)
    for s in (-0.6, -0.2, 0.2, 0.6):
        c = g + U_DIR.to_2d() * s
        box(f"channelgratebar{s}", (0.09, 1.14, 0.05), (c.x, c.y, 0.26), M["frame"], rot=(0, 0, 45), bevel=0.02)


# ------------------------------------------------------------------------------------------------- damaged, destroyed
def named(*pre):
    """The parts whose names start with any of pre (each by its topmost parent)."""
    out = []
    for o in SC.objects:
        if o.name == "ground" or o.type not in ("MESH", "CURVE") or not o.name.startswith(pre):
            continue
        while o.parent is not None:
            o = o.parent
        if o not in out:
            out.append(o)
    return out


def move(obs, pivot, axis=None, deg=0.0, to=None, shift=None, scale=None):
    """Turn obs deg degrees round the world line through pivot along axis, and carry the pivot to `to` (or by
    `shift`): an empty takes them as children."""
    bpy.context.view_layer.update()
    e = bpy.data.objects.new("fold", None)
    kit.link(e)
    e.location = pivot
    bpy.context.view_layer.update()
    for o in obs:
        o.parent = e
        o.matrix_parent_inverse = e.matrix_world.inverted()
    if axis is not None:
        e.rotation_mode = "QUATERNION"
        e.rotation_quaternion = Quaternion(Vector(axis).normalized(), math.radians(deg))
    if to is not None:
        e.location = to
    if shift is not None:
        e.location = Vector(pivot) + Vector(shift)
    if scale is not None:
        e.scale = scale
    bpy.context.view_layer.update()
    return e


def toward(d):
    """The axis to turn about so that an upright part tips toward ground direction d."""
    return Vector((0, 0, 1)).cross(Vector((d[0], d[1], 0.0)).normalized())


def P(u, v, z):
    return Vector(uv(u, v) + (z,))


def remove(*pre):
    for o in [o for o in SC.objects if o.name.startswith(pre) and o.name != "ground"]:
        bpy.data.objects.remove(o, do_unlink=True)


def dome_cracks():
    """Dark cracks over the dome's glass (thin jagged lines on its surface)."""
    cx, cy = uv(*DOME_UV)
    c = Vector((cx, cy, LD_Z1 + 0.3))
    rr = random.Random(9)
    for i, az in enumerate((-80, -42, -8, 20)):
        pts = []
        a = math.radians(az)
        for j in range(7):
            el = math.radians(8 + j * 12)
            a += math.radians(rr.uniform(-9, 9))
            r = DOME_R * 1.005
            pts.append(tuple(c + Vector((r * math.cos(el) * math.cos(a), r * math.cos(el) * math.sin(a),
                                         0.85 * r * math.sin(el)))))
            if rr.random() < 0.3 and j > 1:
                break
        tube(f"domecrack{i}", pts, 0.035, M["groove"], verts=6)


def spill(name, at, r, mat, seed):
    ob = lump(name, at, r, mat, seed, squash=0.07)
    return ob


def wreck_damaged():
    """One rough pass: the upper tier knocked askew and sunk into the deck, one horn snapped and hanging out, the coil
    bent, the dome cracked and leaking, blocks fallen out of the walls (magma showing) with rubble under them, the
    right column leaning, the left vat tipped and spilt, level 2's and 3's parts knocked about."""
    rnd = random.Random(31)
    for (x, y, z, w) in LOST:
        d = Vector((x, y, 0.0)).normalized()
        p = Vector((x, y, 0.0)) + d * rnd.uniform(0.5, 1.3)
        o = box(f"fallen{len(bpy.data.objects)}", (w * 0.8, 0.5, 0.3), (p.x, p.y, 0.02), M["stone"],
                rot=(rnd.uniform(-14, 14), rnd.uniform(-10, 10), rnd.uniform(0, 180)), bevel=0.05)
        imats.roughen(o, strength=0.07, size=0.45, levels=2)
    dome_cracks()
    cx, cy = uv(*DOME_UV)
    for j, (u, w, drop) in enumerate(((0.9, 0.2, 0.75), (1.25, 0.11, 0.4))):      # brew running over the deck's edge
        e = P(u, 3.79, 0.0)
        box(f"leak{j}", (w, 0.05, drop + 0.05), (e.x, e.y, LD_Z1 - drop), M["pipe"], rot=(0, 0, 45), bevel=0.02)
        e = P(u, 3.55, 0.0)
        box(f"leaktop{j}", (w, 0.36, 0.04), (e.x, e.y, LD_Z1), M["pipe"], rot=(0, 0, 45), bevel=0.015)
    # the snapped horn and the bent coil
    for k, deg in ((1, 58),):
        o = bpy.data.objects[f"horn{k}"]
        base = bpy.data.objects["bellR"].location + Vector((0, 0, SMALL_BELL[-1][1] + 0.2))
        d = bpy.data.objects["bellR"].location - bpy.data.objects["bellC"].location
        move([o], base, toward((d.x, d.y)), deg, shift=(0, 0, -0.1))
    tz = PL_Z + BIG_BELL[-1][1]
    move(named("bellCcoil", "bellCpost", "crown"), (PL_C[0], PL_C[1], tz), toward(tuple(-U_DIR + V_DIR * 0.4)[:2]), 24)
    if LEVEL >= 3:
        fl = named("flask")
        left = [o for o in fl if "1" in o.name or any("1" in c.name for c in o.children)]
        if left:
            x, y = mir(uv(*FLASK_UV))
            move(left, (x, y, UD_Z1), toward(tuple(V_DIR + U_DIR * 0.5)[:2]), 84, shift=(0, 0, 0.3))
    # the whole upper tier: sunk a little into the lower deck, leaning toward the viewer's left
    up = named("uwall", "upost", "pilaster", "ustrip", "uband", "urivet", "ubolt", "pipe", "udeck", "plinth", "bell",
               "horn", "ucorner", "flask", "crown", "bcoil", "fold")
    up = [o for o in up if not o.name.startswith("fold") or any(
        c.name.startswith(("horn", "bellC", "crown", "flask")) for c in o.children)]
    move(up, (0, 0, LD_Z1), (U_DIR * 0.55 + V_DIR).normalized(), 6.5, shift=(0, 0, -0.28))
    # the right column leans out, the left vat lies tipped toward the viewer, its lava on the plate
    x, y = uv(-COIL_UV[0], COIL_UV[1])
    move(named("coil1"), (x, y, 0.0), toward(tuple(U_DIR * 0.6 + V_DIR)[:2]), 9)
    v = bpy.data.objects["vat0"]
    at = v.location.copy()
    move(named("vat0", "vatrim0", "vatlava0"), at, toward(tuple(V_DIR - U_DIR * 0.3)[:2]), 22, shift=(0, 0, 0.12))
    sp = at + (V_DIR - U_DIR * 0.3).normalized() * 1.25
    spill("spill0", (sp.x, sp.y, 0.13), 0.75, M["lava"], 5)
    if LEVEL >= 2:
        c = named("canisterglass1", "canistercap1", "canisterstrap11")
        if c:
            p = c[0].location.copy() if c[0].type != "EMPTY" else Vector((0, 0, 0))
            g = bpy.data.objects["canisterglass1"]
            move(c, (g.location.x, g.location.y, 3.2), V_DIR, 22)
    for i in range(7):
        u, v_ = rnd.uniform(-7.5, 7.5), rnd.uniform(3.2, 5.2)
        if abs(u) + abs(v_) > 9.4:
            continue
        x, y = uv(u, v_)
        lump(f"debris{i}", (x, y, 0.08), rnd.uniform(0.16, 0.34), M["stone"], seed=700 + i)


def wreck_destroyed():
    """One rough pass, one look for every level: the lower tier down to stumps of wall round a pool of magma, the decks
    broken in two and fallen askew on it, the cracked dome sunk in the middle, the bells, horns, pipes and a column
    lying on and round the heap, rubble inside the building's square."""
    rnd = random.Random(47)
    remove("lcornerseat", "lcornerspike", "ucornerseat", "ucornerspike", "domewire", "domeclamp", "vatrim1")
    # the pool of magma inside the stumps
    lathe("pool", [(0.0, 0.0), (3.6, 0.0)], (0.0, 0.3, 1.42), M["lava"], verts=40)
    # the lower deck's halves, fallen onto the stumps
    move(named("ldeckA"), P(-4.6, 0.6, LD_Z0), (V_DIR + U_DIR * 0.45).normalized(), 13, to=P(-4.9, 0.9, 1.75))
    move(named("ldeckB"), P(4.2, 0.6, LD_Z0), (-V_DIR + U_DIR * 0.9).normalized(), 12, to=P(4.9, 1.0, 1.6))
    # the dome, cracked, sunk between them
    dome_cracks()
    cx, cy = uv(*DOME_UV)
    move(named("dome"), (cx, cy, LD_Z1), toward(tuple(U_DIR + V_DIR * 0.6)[:2]), 16, to=P(-0.3, 0.9, 1.5))
    # the upper deck's halves on top, one leaning on the heap, one slid off to the right
    move(named("udeckA", "plinth"), P(-3.0, -0.6, UD_Z0), (V_DIR + U_DIR * 0.9).normalized(), 21, to=P(-3.6, -1.6, 2.7))
    move(named("udeckB"), P(4.2, 0.0, UD_Z0), (-V_DIR * 1.0 + U_DIR * 0.5).normalized(), 27, to=P(5.6, 2.2, 2.0))
    # the bells
    for nm, deg, d, to in (("bellC", 68, -U_DIR + V_DIR * 0.5, P(-2.6, -0.4, 3.2)),
                           ("bellL", 96, V_DIR - U_DIR * 0.2, P(-3.1, 3.7, 0.55)),
                           ("bellR", 74, U_DIR + V_DIR * 0.4, P(4.6, 0.6, 2.9))):
        o = bpy.data.objects[nm]
        move(named(nm), o.location.copy(), toward(tuple(d)[:2]), deg, to=to)
    # the horns, lying across the heap
    for k, deg, d, to in ((0, 80, U_DIR + V_DIR * 0.3, P(-4.4, 2.3, 2.1)), (1, 86, -U_DIR + V_DIR * 0.6, P(5.2, 3.3, 0.9))):
        s = bpy.data.objects[f"hornseat{k}"]
        move(named(f"horn{k}", f"hornseat{k}"), s.location.copy(), toward(tuple(d)[:2]), deg, to=to)
    # the columns: one fallen across the door, one a leaning stump; the beam and the door plate down
    x, y = uv(*COIL_UV)
    move(named("coil0"), (x, y, 0.0), toward(tuple(U_DIR + V_DIR * 0.12)[:2]), 84, to=P(-3.9, 3.5, 0.5))
    x, y = uv(-COIL_UV[0], COIL_UV[1])
    move(named("coil1"), (x, y, 0.0), toward(tuple(U_DIR + V_DIR)[:2]), 14, scale=(1, 1, 0.42))
    b = bpy.data.objects["lbeam"]
    move([b], b.location.copy(), U_DIR, 80, to=P(1.6, 4.3, 0.25))
    d = bpy.data.objects["ldoor"]
    move(named("ldoor"), d.location.copy(), toward(tuple(V_DIR)[:2]), 62, shift=(0, 0, -0.2))
    # the right vat tipped and spilt
    v = bpy.data.objects["vat1"]
    at = v.location.copy()
    move(named("vat1", "vatlava1"), at, toward(tuple(V_DIR + U_DIR * 0.4)[:2]), 44, shift=(0, 0, 0.3))
    sp = at + (V_DIR + U_DIR * 0.4).normalized() * 1.2
    spill("spill1", (sp.x, sp.y, 0.13), 0.8, M["lava"], 6)
    # rubble: fallen blocks and lumps on the heap and round its foot, inside the building's square
    for i in range(26):
        u, v_ = rnd.uniform(-8.6, 8.6), rnd.uniform(-1.5, 5.6)
        if abs(u) + abs(v_) > 9.5:
            continue
        x, y = uv(u, v_)
        inside = abs(u) < 7.5 - 1.6 * max(0.0, v_) and v_ < 2.6
        z = (1.5 + rnd.uniform(0.0, 0.5)) if inside else 0.04
        if i % 2:
            o = box(f"fallen{i}", (rnd.uniform(0.5, 1.0), rnd.uniform(0.4, 0.6), rnd.uniform(0.25, 0.5)), (x, y, z),
                    M["block" if i % 4 == 1 else "stone"], rot=(rnd.uniform(-25, 25), rnd.uniform(-25, 25),
                                                               rnd.uniform(0, 180)), bevel=0.05)
            imats.roughen(o, strength=0.07, size=0.45, levels=2)
        else:
            lump(f"debris{i}", (x, y, z), rnd.uniform(0.2, 0.5), M["stone"], seed=800 + i)
    for i in range(5):                                  # torn deck plate
        u, v_ = rnd.uniform(-6.0, 6.0), rnd.uniform(2.6, 5.0)
        x, y = uv(u, v_)
        box(f"scrap{i}", (rnd.uniform(0.6, 1.2), rnd.uniform(0.4, 0.8), 0.08), (x, y, rnd.uniform(0.1, 0.3)), M["deck"],
            rot=(rnd.uniform(-30, 30), rnd.uniform(-30, 30), rnd.uniform(0, 180)), bevel=0.02)


def build():
    mats()
    lower()
    lower_deck()
    upper()
    upper_deck()
    top()
    dome()
    extras()
    if DMG:
        wreck_damaged()
    if DEAD:
        wreck_destroyed()


def turn(k):
    a = 2 * math.pi * (k % N) / N
    for mp, rest, r, ph in DRIFT:
        mp.inputs["Location"].default_value = (rest[0] + r * math.cos(a + ph), rest[1] + r * math.sin(a + ph),
                                               rest[2] + 0.6 * r * math.sin(a + ph + 1.3))
    for nd, swing, ph in PULSE:
        nd.outputs[0].default_value = 1.0 + swing * math.sin(a + ph)
    for ob, az, size, ph in BUBBLES:
        f = ((k % N) / N + ph) % 1.0
        el = math.radians(10 + 68 * f)
        r = DOME_R * 0.99
        ob.location = ob.parent.matrix_world.inverted() @ Vector((0, 0, 0)) if False else ob.location
        cx, cy = uv(*DOME_UV)
        ob.location = (cx + r * math.cos(el) * math.cos(az), cy + r * math.cos(el) * math.sin(az),
                       LD_Z1 + 0.3 + 0.85 * r * math.sin(el))
        grow = min(1.0, f / 0.2)
        pop = 1.0 if f < 0.86 else max(0.0, (1.0 - f) / 0.14) * 1.35
        s = max(1e-4, size * grow * pop)
        ob.scale = (s, s, s)
    for ob, ph in FLAMES:
        ob.scale = (1 + 0.07 * math.sin(2 * a + ph + 1.0), 1 + 0.07 * math.sin(2 * a + ph + 2.2),
                    1 + 0.14 * math.sin(2 * a + ph))
        ob.rotation_euler = (0, 0, a)


FAMILY = (("lwall", "lwall"), ("lpost", "lwall"), ("lskirt", "lwall"), ("lband", "lwall"), ("lbeam", "coil"),
          ("lrivet", "lwall"), ("lstrip", "lwall"), ("blocks", "lwall"), ("backing", "lwall"), ("ldoor", "ldoor"),
          ("coil", "coil"), ("sdoor", "sdoor"), ("vat", "vat"), ("ldeck", "ldeck"), ("uwall", "uwall"),
          ("upost", "uwall"), ("uband", "uwall"), ("urivet", "uwall"), ("ustrip", "uwall"), ("ubolt", "uwall"),
          ("pilaster", "pilaster"), ("pipe", "pipe"), ("udeck", "udeck"), ("plinth", "plinth"), ("bellC", "bellC"),
          ("bellL", "bellL"), ("bellR", "bellR"), ("bcoil0", "bellL"), ("bcoil1", "bellR"), ("hornseat0", "bellL"),
          ("hornseat1", "bellR"), ("horn2seat0", "bellL"), ("horn2seat1", "bellR"), ("horn2", "horn2"),
          ("horn", "horn"), ("domering", "dome"), ("domewire", "domewire"), ("domeclamp", "domewire"),
          ("dome", "dome"), ("bubble", "dome"), ("lcorner", "lcorner"), ("ucorner", "ucorner"), ("rubble", "rubble"),
          ("canister", "canister"), ("crown", "crown"), ("flask", "flask"), ("channel", "channel"))


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


kit.run(build, turn, family=family)
