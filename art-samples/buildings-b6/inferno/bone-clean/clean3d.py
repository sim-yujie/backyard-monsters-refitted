"""clean3d.py : the Inferno Bone Cruncher in 3D as three tiers, built "clean room" from the written description only.

    blender -b --factory-startup -P clean3d.py -- <tier> fit [frame]   work/fit-L<tier>.png  quick look, 4 px/px
    blender -b --factory-startup -P clean3d.py -- <tier> still        render/L<tier>-base.png, -alone.png, -parts-00.png
    blender -b --factory-startup -P clean3d.py -- <tier> anim         render/L<tier>-parts-NN.png, one per frame
    blender -b --factory-startup -P clean3d.py -- <tier> check        CHECK / CLEAR lines (parts that overlap)

Tier 1 (levels 1-2) is the owner-approved look, unchanged: ../bone/bone3d.py built at its look 1 (only its shared and
look-1 builders are called). Tiers 2 (levels 3-6) and 3 (levels 7-10) keep Tier 1's bowl, foot, plate, cup, drum and the
side panel's frame, and add new parts made here from the description:

Tier 2: a big plank chute with iron corner straps and a hinged plank lid, hung from a grey iron post at the back right
by a short crank arm, tipped down and forward so its mouth sits over the rollers (it rocks a little in the loop); two
black iron rollers with five even rows of short collared cone spikes whose rows pass between each other; on the side
panel a dark plate with a faint hot glow, a large 12-tooth 4-spoke grey cog at its foot and a small 8-tooth cog meshing
with it behind.
Tier 3: Tier 2 heavier and hotter: a second riveted band round the bowl and a thicker lip, an orange glow deep in the
bowl, longer spikes in six rows with dull heated tips, an iron front plate, a middle strap and heavier hinges on the
chute, two big meshing cogs and a slotted grille over a stronger panel glow, a short iron chimney beside the post that
smokes, and a wooden wedge under the drum.
"""
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "bone"))
import kit  # noqa: E402

TIER = kit.L
kit.L = 1                      # Tier 1's model is built at its look 1 for every tier
import bone3d as b  # noqa: E402
kit.L = TIER
kit.OUT = HERE
if TIER > 1:
    kit.FRAMES = 48
from kit import Vector, Matrix, Euler, box, cyl, tube, painted, flat, link, srgb  # noqa: E402
import bmesh  # noqa: E402
import bpy  # noqa: E402

FR = kit.FRAMES
M = b.M
rng = kit.rng


# ------------------------------------------------------------------------------------------------ materials (new)
def mats():
    m = {}
    m["roller"] = painted("c-roller", (20, 20, 21), rough=0.6, metal=0.45, wear=(58, 58, 56), rust=(48, 30, 20),
                          scale=7, dirt=0.4, spec=0.35)
    m["spike"] = painted("c-spike", (70, 72, 74), rough=0.5, metal=0.55, wear=(120, 122, 120), rust=(56, 40, 30),
                         scale=12, dirt=0.3, spec=0.4)
    m["collar"] = painted("c-collar", (26, 24, 23), rough=0.65, metal=0.4, wear=(60, 56, 52), scale=10, dirt=0.3)
    m["hottip"] = painted("c-hottip", (64, 30, 24), rough=0.75, metal=0.3, wear=(96, 40, 28), rust=(40, 20, 16),
                          scale=14, dirt=0.2, spec=0.2)
    m["planks"] = kit.wood("c-planks", (158, 58, 26), (74, 24, 10), axis="X", rings=4, dirt=0.6)   # orange-red boards
    m["strap"] = painted("c-strap", (46, 46, 46), rough=0.55, metal=0.5, wear=(100, 98, 94), rust=(70, 40, 22),
                         scale=9, dirt=0.35, rust_at=0.55)
    m["post"] = painted("c-post", (108, 110, 110), rough=0.5, metal=0.45, wear=(168, 168, 162), rust=(80, 56, 38),
                        scale=6, dirt=0.4, rust_at=0.65)
    m["cog"] = painted("c-cog", (126, 128, 126), rough=0.5, metal=0.3, wear=(184, 184, 178), rust=(84, 58, 40),
                       scale=8, dirt=0.35, rust_at=0.68)
    m["hub"] = painted("c-hub", (56, 56, 56), rough=0.55, metal=0.5, wear=(110, 108, 104), scale=8, dirt=0.3)
    m["ironplate"] = painted("c-ironplate", (58, 60, 60), rough=0.6, metal=0.45, wear=(112, 112, 108),
                             rust=(92, 50, 26), scale=5, dirt=0.4, rust_at=0.58)
    m["wedge"] = kit.wood("c-wedge", (128, 82, 44), (64, 38, 18), axis="X", rings=3, dirt=0.5)
    m["chimney"] = painted("c-chimney", (40, 40, 40), rough=0.7, metal=0.35, wear=(84, 82, 78), rust=(86, 44, 22),
                           scale=6, dirt=0.5, soot=0.7, rust_at=0.55)
    return m


C = mats() if TIER > 1 else {}


def hotplate(name, strength, scale=4.0):
    """The panel's dark plate: near-black iron with a soft orange glow coming through, as if hot inside."""
    t = kit.NT(name)
    v = t.coords()
    n = t.noise(v, scale, 4.0, 0.55, 0.3)
    col = t.ramp(n, [(0.3, srgb(12, 10, 9)), (0.7, srgb(24, 18, 15))])
    t.set(**{"Base Color": col, "rough": 0.75, "metal": 0.3})
    # the glow is strongest in the plate's middle and fades to its edges, broken up by the noise
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])
    fall = []
    for ax in ("X", "Y"):
        d = t.n("ShaderNodeMath", operation="PINGPONG")
        t.link(sep.outputs[ax], d.inputs[0])
        d.inputs[1].default_value = 0.5                  # 0 at the edges, 0.5 in the middle
        fall.append(d.outputs[0])
    mul = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(fall[0], mul.inputs[0])
    t.link(fall[1], mul.inputs[1])
    mid = t.ramp(mul.outputs[0], [(0.04, (0, 0, 0, 1)), (0.22, (1, 1, 1, 1))])
    glow = t.ramp(n, [(0.4, srgb(20, 4, 1)), (0.72, srgb(255, 104, 24))])
    glow = t.mix(glow, mid, 1.0, "MULTIPLY")
    t.link(glow, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = strength
    return t.m


def smoke_mat():
    """Soft grey smoke whose opacity is each puff's object colour alpha (so the puffs can fade in and out)."""
    t = kit.NT("c-smoke")
    info = t.n("ShaderNodeObjectInfo")
    mul = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(info.outputs["Alpha"], mul.inputs[0])
    mul.inputs[1].default_value = 0.55
    lw = t.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    soft = t.n("ShaderNodeMath", operation="SUBTRACT")
    soft.inputs[0].default_value = 1.0
    t.link(lw.outputs["Facing"], soft.inputs[1])
    sq = t.n("ShaderNodeMath", operation="POWER")
    t.link(soft.outputs[0], sq.inputs[0])
    sq.inputs[1].default_value = 2.0
    mul2 = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(mul.outputs[0], mul2.inputs[0])
    t.link(sq.outputs[0], mul2.inputs[1])
    t.set(**{"Base Color": srgb(92, 86, 82), "rough": 1.0, "spec": 0.0})
    t.link(mul2.outputs[0], t.bsdf.inputs["Alpha"])
    return t.m


# ------------------------------------------------------------------------------------------------ mesh helpers
def frame_mat(o, x, y):
    """A 4x4 matrix whose columns are x, y, x cross y, placed at o."""
    x, y = Vector(x).normalized(), Vector(y).normalized()
    z = x.cross(y).normalized()
    y = z.cross(x)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = o
    return m


def along(d):
    """A rotation turning local Z onto d."""
    return Vector(d).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()


def cone_into(bm, mat_i, r1, r2, depth, m, segs=16):
    """A cone (or cylinder) along local Z from 0 to depth, transformed by m, into bm with material index mat_i."""
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=depth,
                              matrix=m @ Matrix.Translation((0, 0, depth / 2)))
    vs = set(g["verts"])
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mat_i
        f.smooth = True


def new_ob(name, bm, mats, parent=None, bevel=0.0):
    return kit.mesh_ob(name, bm, mats, smooth=True, bevel=bevel, segs=2, parent=parent)


def empty(name, at=(0, 0, 0), parent=None, moving=False):
    e = bpy.data.objects.new(name, None)
    link(e, parent)
    e.location = at
    if moving:
        kit.MOVING.append(e)
    return e


def cog_mesh(name, teeth, r_pitch, module, depth, mat, parent=None, spokes=4, r_hub=None, rim=None):
    """A spur gear in its local XY (axle local Z, faces at z 0 and depth): even trapezoid teeth on a rim, `spokes`
    straight spokes and a round hub. Tooth 0 is centred on local +X."""
    r_tip, r_root = r_pitch + module, r_pitch - 1.25 * module
    rim = rim or 1.6 * module
    r_in = r_root - rim
    r_hub = r_hub or max(0.09, 0.22 * r_pitch)
    bm = bmesh.new()
    P = 2 * math.pi / teeth
    prof = []
    for i in range(teeth):
        a = i * P
        for da, r in ((-0.27, r_root), (-0.15, r_tip), (0.15, r_tip), (0.27, r_root)):
            prof.append((a + da * P, r))
    n = len(prof)
    top_o = [bm.verts.new((r * math.cos(a), r * math.sin(a), depth)) for a, r in prof]
    bot_o = [bm.verts.new((r * math.cos(a), r * math.sin(a), 0.0)) for a, r in prof]
    top_i = [bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), depth)) for a, _ in prof]
    bot_i = [bm.verts.new((r_in * math.cos(a), r_in * math.sin(a), 0.0)) for a, _ in prof]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top_o[i], top_o[j], top_i[j], top_i[i]))
        bm.faces.new((bot_o[j], bot_o[i], bot_i[i], bot_i[j]))
        bm.faces.new((bot_o[i], bot_o[j], top_o[j], top_o[i]))
        bm.faces.new((top_i[i], top_i[j], bot_i[j], bot_i[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = False
    # the hub and the spokes, a little thinner than the rim
    inset = depth * 0.15
    cone_into(bm, 0, r_hub, r_hub, depth + 0.03, Matrix.Identity(4), segs=20)
    for k in range(spokes):
        a = 2 * math.pi * (k + 0.5) / spokes
        d = Vector((math.cos(a), math.sin(a), 0))
        s = Vector((-d.y, d.x, 0))
        mid = d * ((r_hub + r_in) / 2)
        g = bmesh.ops.create_cube(bm, size=1.0)
        L_ = r_in - r_hub + 0.04
        for v in g["verts"]:
            c = v.co.copy()
            v.co = mid + d * (c.x * L_) + s * (c.y * module * 1.5) + Vector((0, 0, depth / 2 + c.z * (depth - 2 * inset)))
    ob = kit.mesh_ob(name, bm, [mat], smooth=False, bevel=0.012, segs=2, parent=parent)
    return ob


# ------------------------------------------------------------------------------------------------ Tier 1's body
DROP_T1 = ("belt", "pulley", "cog")          # Tier 1's drive on the side panel (belt, pulleys, small gear and block)


def body():
    """Tier 1's shared body: bowl and foot, cup, drum, plate and the side panel with its copper frame."""
    b.bowl()
    b.horn()
    b.drum()
    b.plate()
    before = set(bpy.data.objects.keys())
    b.shield()
    for n in sorted(set(bpy.data.objects.keys()) - before):
        if n.startswith(DROP_T1):
            bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)


# ------------------------------------------------------------------------------------------------ the side panel
# The panel's face, read off Tier 1's corner bolts (bottom left, top left, top right, bottom right of its square top
# part); its point hangs below the middle of the bottom edge.
P_BL, P_TL = Vector((3.56, -1.85, 2.525)), Vector((3.80, -1.88, 4.005))
P_BR = Vector((3.85, 0.83, 2.525))
PU = (P_BR - P_BL).normalized()                       # along the panel, to the right (toward +Y)
PV = (P_TL - P_BL - PU * (P_TL - P_BL).dot(PU)).normalized()     # up the panel
PN = PU.cross(PV).normalized()                         # out of the panel, toward the viewer's right


def panel_surface(u, v):
    """The world point on the panel's front face at (u along PU, v along PV) from the bottom-left bolt, by ray."""
    p = P_BL + PU * u + PV * v
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ok, loc, _, _, ob, _ = kit.SC.ray_cast(dg, p + PN * 2.0, -PN)
    return loc if ok else p


def panel():
    """Tier 2/3's panel: the dark hot plate in the frame's square, the cogs at its foot (Tier 3 adds the grille)."""
    face = panel_surface(1.35, 0.75)
    depth_face = (face - P_BL).dot(PN)                  # the panel's face, out from the bolts' plane
    PLATE_UV = (0.42, 2.32, 0.16, 1.32)                  # u0, u1, v0, v1 inside the frame, clear of its bolts
    u0, u1, v0, v1 = PLATE_UV
    th = 0.06
    mid = P_BL + PU * ((u0 + u1) / 2) + PV * ((v0 + v1) / 2) + PN * (depth_face + th / 2)
    strength = 0.16 if TIER == 2 else 1.6
    hp = box("hotplate", (u1 - u0, v1 - v0, th), (0, 0, 0), hotplate("c-hotplate", strength), bevel=0.015,
             origin="centre")
    hp.matrix_world = frame_mat(mid, PU, PV)
    out = depth_face + th
    # bolts at the plate's corners (not under a cog's boss)
    for i, (u, v) in enumerate(((u0 + 0.1, v0 + 0.1), (u1 - 0.1, v0 + 0.1), (u0 + 0.1, v1 - 0.1), (u1 - 0.1, v1 - 0.1))):
        if TIER == 3 or any((Vector((u, v)) - c).length < 0.3 for c, _, _ in cog_layout()):
            continue                                     # (Tier 3: the grille's sides are bolted instead)
        o = cyl(f"hotplatebolt{i}", 0.05, 0.05, (0, 0, 0), M["steel"], verts=10, bevel=0.012)
        o.matrix_world = frame_mat(P_BL + PU * u + PV * v + PN * out, PU, PV)
    if TIER == 3:                                        # a slotted grille over the stronger glow
        gth = 0.05
        for k in range(7):
            v = v0 + 0.14 + k * (v1 - v0 - 0.28) / 6
            bar = box(f"hotplategrille{k}", (u1 - u0 - 0.32, 0.07, gth), (0, 0, 0), C["strap"], bevel=0.012,
                      origin="centre")
            bar.matrix_world = frame_mat(P_BL + PU * ((u0 + u1) / 2) + PV * v + PN * (out + gth / 2), PU, PV)
        for k, u in enumerate((u0 + 0.12, u1 - 0.12)):
            st = box(f"hotplategrille-side{k}", (0.1, v1 - v0 - 0.12, gth + 0.01), (0, 0, 0), C["strap"],
                     bevel=0.012, origin="centre")
            st.matrix_world = frame_mat(P_BL + PU * u + PV * ((v0 + v1) / 2) + PN * (out + gth / 2 + 0.005), PU, PV)
            for j, v in enumerate((v0 + 0.1, v1 - 0.1)):
                o = cyl(f"hotplategrille-bolt{k}{j}", 0.04, 0.04, (0, 0, 0), M["steel"], verts=10, bevel=0.01)
                o.matrix_world = frame_mat(P_BL + PU * u + PV * v + PN * (out + gth + 0.01), PU, PV)
        out += gth + 0.01
    return out


COG_A = (1.32, -0.55)          # (u, v): the big cog at the panel's foot, in front of the point
COG_M = 0.12                   # the module: tooth size shared by meshing cogs
COGS = []                      # (spin empty, teeth, sign, phase)


def cog_layout():
    """(centre (u, v), teeth, pitch radius) of the two cogs: the big 12-tooth cog low on the panel and the one it
    drives, Tier 2 a small 8-tooth cog up and behind it (toward the back), Tier 3 a second big 10-tooth cog."""
    na = 12
    nb = 8 if TIER == 2 else 10
    ra, rb = COG_M * na / 2, COG_M * nb / 2
    ca = Vector(COG_A)
    cb = ca + Vector((math.cos(COG_ANG), math.sin(COG_ANG))) * (ra + rb + 0.015)    # a little play between the teeth
    return [(ca, na, ra), (cb, nb, rb)]


COG_ANG = math.radians(44 if TIER == 2 else 58)


def cogs(face_out):
    """The two cogs, each turning on an axle in a boss on the panel."""
    (ca, na, ra), (cb, nb, rb) = cog_layout()
    ang = COG_ANG
    plane = face_out + 0.16                              # the cogs' back face, clear of the frame and the plate
    for name, c, n, r, sign, phase in (("coga", ca, na, ra, 1, ang),
                                       ("cogb", cb, nb, rb, -1, ang + math.pi + math.pi / nb)):
        base = P_BL + PU * c.x + PV * c.y
        surf = panel_surface(c.x, c.y)
        d0 = (surf - P_BL).dot(PN)
        o = base + PN * d0
        # boss on the panel and the axle through it
        bo = cyl(f"{name}boss", 0.17 if n > 9 else 0.13, plane - d0 - 0.01, (0, 0, 0), C["hub"], verts=20, bevel=0.02)
        bo.matrix_world = frame_mat(o, PU, PV)
        ax = cyl(f"{name}axle", 0.07, plane - d0 + COG_M * 1.6 + 0.08, (0, 0, 0), M["steel"], verts=14, bevel=0.015)
        ax.matrix_world = frame_mat(o, PU, PV)
        e = empty(name, parent=None, moving=True)
        e.matrix_world = frame_mat(base + PN * plane, PU, PV)
        spin = empty(name + "-spin", parent=e)
        cog_mesh(f"{name}wheel", n, r, COG_M, COG_M * 1.4, C["cog"], parent=spin,
                 r_hub=0.15 if n > 9 else 0.11)
        nut = cyl(f"{name}nut", 0.1, 0.07, (0, 0, COG_M * 1.4 + 0.03), C["hub"], verts=6, bevel=0.01, parent=spin)
        COGS.append((spin, n, sign, phase))


# ------------------------------------------------------------------------------------------------ rollers
ROLL_Y = (-1.0, 0.55)                 # Tier 1's two roller axes (front, back)
ROLL_Z = 3.0                          # lower than Tier 1's, so the spikes fill the bowl to just over the rim
ROWS = 5 if TIER == 2 else 6
SPIKE = (0.5, 0.15) if TIER == 2 else (0.62, 0.15)    # length, base radius
CORE_R = 0.42 if TIER == 2 else 0.38
PITCH = 0.4                           # spike spacing along a row; the two rollers are offset by half of it
ROLLS = []


def roller(i):
    y = ROLL_Y[i]
    wall_x = math.sqrt(b.IN_R ** 2 - y ** 2)
    xs = [-2.0 + PITCH * k for k in range(11)] if i == 0 else [-2.2 + PITCH * k for k in range(12)]
    e = empty(f"rol{i}", (0, y, ROLL_Z), moving=True)
    spin = empty(f"rol{i}-spin", parent=e)
    bm = bmesh.new()
    rx = Matrix.Rotation(math.radians(90), 4, "Y")          # local Z onto X
    x0, x1 = xs[0] - 0.3, xs[-1] + 0.3
    cone_into(bm, 0, CORE_R, CORE_R, x1 - x0, Matrix.Translation((x0, 0, 0)) @ rx, segs=32)
    for s in (-1, 1):                                       # end rings on the core
        xe = x0 if s < 0 else x1 - 0.1
        cone_into(bm, 2, CORE_R + 0.05, CORE_R + 0.05, 0.1, Matrix.Translation((xe, 0, 0)) @ rx, segs=32)
    L_, rb = SPIKE
    phase = (math.pi / ROWS) if i else 0.0
    for j in range(ROWS):
        a = 2 * math.pi * j / ROWS + phase
        d = Vector((0, math.cos(a), math.sin(a)))
        rot = along(d)
        for x in xs:
            base = Vector((x, 0, 0)) + d * (CORE_R - 0.03)
            m = Matrix.Translation(base) @ rot
            cone_into(bm, 2, rb + 0.045, rb + 0.035, 0.09, m, segs=14)          # the dark collar
            if TIER == 2:
                cone_into(bm, 1, rb, 0.004, L_ + 0.03, m, segs=14)
            else:                                                               # dull heated tips
                k = 0.62
                cone_into(bm, 1, rb, rb * (1 - k), (L_ + 0.03) * k, m, segs=14)
                cone_into(bm, 3, rb * (1 - k), 0.004, (L_ + 0.03) * (1 - k),
                          m @ Matrix.Translation((0, 0, (L_ + 0.03) * k)), segs=14)
    mats_ = [C["roller"], C["spike"], C["collar"], C["hottip"]]
    new_ob(f"rol{i}body", bm, mats_, parent=spin)
    # the bare axle out to the wall, in a bearing boss on the wall at each end
    ax0, ax1 = -wall_x + 0.08, wall_x - 0.08
    cyl(f"rol{i}axle", 0.14, ax1 - ax0, (ax0, 0, 0), M["steel"], rot=(0, 90, 0), verts=18, bevel=0.02, parent=spin)
    for s in (-1, 1):
        xb = s * (wall_x - 0.02)
        bo = cyl(f"bowl-bearing{i}{'ab'[s > 0]}", 0.26, 0.22, (xb, y, ROLL_Z), C["hub"],
                 rot=(0, -90 * s, 0), verts=22, bevel=0.03)
        cyl(f"bowl-bearingcap{i}{'ab'[s > 0]}", 0.2, 0.06, (xb - s * 0.22, y, ROLL_Z), M["steel"],
            rot=(0, -90 * s, 0), verts=22, bevel=0.015)
    ROLLS.append((spin, 1 if i else -1))


# ------------------------------------------------------------------------------------------------ the chute
POST = (62.0, 3.6)                    # the post: bearing round the bowl (deg) and distance from its axis
PIVOT_Z = 6.7
TILT = 20.0                           # the chute tips down and forward by this
CH_W, CH_H = 1.15, 0.72               # inside width and height
CH_X = (0.75, 4.15)                   # its back end and its mouth, along it from the pivot
CH_Z = -0.95                          # its floor, below the pivot
CHUTE = {}


def chute_frame():
    a = math.radians(POST[0])
    base = Vector((math.cos(a), math.sin(a), 0.0)) * POST[1]
    h = -Vector((math.cos(a), math.sin(a), 0.0))      # toward the bowl's axis
    t = math.radians(TILT)
    u = (h * math.cos(t) + Vector((0, 0, -math.sin(t)))).normalized()
    w = Vector((0, 0, 1)).cross(h).normalized()        # across: toward the viewer on the camera side
    if w.dot(Vector((1, -1, 0))) < 0:
        w = -w
    return base, u, w


def post_and_chute():
    base, u, w = chute_frame()
    pivot = base + Vector((0, 0, PIVOT_Z))
    # the grey iron post: a foot plate bolted to the ground, the column, a fork head with the bearing
    pm = C["post"]
    box("postfoot", (0.72, 0.72, 0.1), base, C["ironplate"], rot=(0, 0, math.degrees(math.atan2(u.y, u.x))), bevel=0.02)
    for k in range(4):
        a = math.radians(45 + 90 * k + math.degrees(math.atan2(u.y, u.x)))
        cyl(f"postfootbolt{k}", 0.05, 0.06, base + Vector((math.cos(a), math.sin(a), 0)) * 0.36 + Vector((0, 0, 0.1)),
            M["steel"], verts=8, bevel=0.01)
    hd = math.degrees(math.atan2(u.y, u.x))
    cyl("postcol", 0.17, PIVOT_Z - 0.5, base + Vector((0, 0, 0.1)), pm, verts=24, bevel=0.03, r2=0.15)
    cyl("postcollar", 0.22, 0.14, base + Vector((0, 0, 0.1)), pm, verts=24, bevel=0.03)
    cyl("postcollar2", 0.19, 0.12, pivot - Vector((0, 0, 0.62)), pm, verts=24, bevel=0.03)
    # the fork head: a block on the column and two cheeks holding the bearing, the arm's eye between them
    box("posthead", (0.26, 0.54, 0.22), pivot - Vector((0, 0, 0.48)), pm, rot=(0, 0, hd), bevel=0.035)
    for s in (-1, 1):
        box(f"postcheek{'ab'[s > 0]}", (0.3, 0.08, 0.5), pivot - Vector((0, 0, 0.27)) + w * (s * 0.23), pm,
            rot=(0, 0, hd), bevel=0.025)
    # the bearing axle across the chute's direction (along w), out of both sides of the head
    cyl("postaxle", 0.08, 0.78, pivot - w * 0.39, M["steel"], verts=16, bevel=0.015)
    kit.bpy.context.view_layer.update()
    bpy.data.objects["postaxle"].rotation_euler = w.to_track_quat("Z", "Y").to_euler()
    for s in (-1, 1):
        cyl(f"postcap{'ab'[s > 0]}", 0.12, 0.06, pivot + w * (s * 0.26) - w * 0.03, C["hub"], verts=6, bevel=0.01)
        bpy.data.objects[f"postcap{'ab'[s > 0]}"].rotation_euler = w.to_track_quat("Z", "Y").to_euler()
    # the chute, in its own frame at the pivot: x along it to the mouth, y across, z up out of its floor
    e = empty("chute", moving=True)
    e.matrix_world = frame_mat(pivot, u, w)
    rock = empty("chute-rock", parent=e)
    CHUTE["rock"] = rock
    build_chute(rock)


def build_chute(p):
    x0, x1 = CH_X
    L_ = x1 - x0
    W, H = CH_W, CH_H
    zf = CH_Z
    pl = C["planks"]
    th = 0.1
    # floor: planks along the chute
    n = 5
    for k in range(n):
        yy = -W / 2 + W * (k + 0.5) / n
        box(f"chutefloor{k}", (L_, W / n - 0.02, th), (x0 + L_ / 2, yy, zf), pl, bevel=0.025, parent=p,
            jitter=0.005)
    # side walls: three planks high, along the chute
    for s in (-1, 1):
        for k in range(3):
            zz = zf + (H + th) * k / 3
            box(f"chuteside{'ab'[s > 0]}{k}", (L_, th, (H + th) / 3 - 0.02), (x0 + L_ / 2, s * (W / 2 + th / 2), zz), pl,
                bevel=0.025, parent=p, jitter=0.005)
    # back end wall: upright boards across
    for k in range(4):
        yy = -W / 2 - th + (W + 2 * th) * (k + 0.5) / 4
        box(f"chuteend{k}", (th, (W + 2 * th) / 4 - 0.02, H + th), (x0 - th / 2, yy, zf), pl, bevel=0.025, parent=p)
    # the closed lid: boards across the chute, on two battens, hinged at the back end
    zt = zf + th + H
    lid_x0, lid_x1 = x0 - th, x1 - 0.6                 # the lid stops short of the open mouth
    nb, lw = 5, W + 2 * th + 0.08
    for k in range(nb):                                  # long boards along the chute
        yy = -lw / 2 + lw * (k + 0.5) / nb
        box(f"chutelid{k}", (lid_x1 - lid_x0 + rng.uniform(-0.03, 0.03), lw / nb - 0.025, th * 0.8),
            (lid_x0 + (lid_x1 - lid_x0) / 2, yy, zt + 0.005), C["planks"], bevel=0.022, parent=p, jitter=0.004)
    for k, xx in enumerate((x0 + 1.45, lid_x1 - 0.3)):  # two cross battens on top
        box(f"chutebatten{k}", (0.16, lw - 0.06, 0.06), (xx, 0, zt + 0.085), C["planks"], bevel=0.015, parent=p)
    # hinges at the back end: strap leaves on the lid, a knuckle on the back wall's top
    hinge_r = 0.06 if TIER == 2 else 0.085
    leaf = (0.85, 0.12, 0.025) if TIER == 2 else (1.15, 0.17, 0.035)
    for s in (-1, 1):
        yy = s * W * 0.3
        box(f"chutehinge{'ab'[s > 0]}", leaf, (lid_x0 + leaf[0] / 2 + 0.05, yy, zt + 0.085), C["strap"],
            bevel=0.008, parent=p)
        cyl(f"chutehingepin{'ab'[s > 0]}", hinge_r, 0.24 if TIER == 2 else 0.32,
            (lid_x0 - 0.02, yy - (0.12 if TIER == 2 else 0.16), zt + 0.06), C["strap"], rot=(-90, 0, 0), verts=14,
            bevel=0.01, parent=p)
        for k in range(2 if TIER == 2 else 3):
            cyl(f"chutehingebolt{'ab'[s > 0]}{k}", 0.03, 0.03, (lid_x0 + 0.3 + 0.28 * k, yy, zt + 0.085 + leaf[2]),
                M["steel"], verts=8, bevel=0.006, parent=p)
    # bones in the trough, showing in the open mouth
    b.bones_heap("chutebones", p, (x1 - 0.32, 0.0, zf + th + 0.02), 0.22, 0.42, 16, 77, mound=0.12)
    # iron straps wrapped round the corners at both ends (Tier 3: one more round the middle)
    ends = [x0 + 0.12, x1 - 0.12] + ([x0 + L_ * 0.52] if TIER == 3 else [])
    sw, st = 0.16, 0.035
    plate_t = 0.04 if TIER == 3 else 0.0
    for k, xx in enumerate(ends):
        y_out = W / 2 + th + st / 2
        for s in (-1, 1):
            yo = y_out + (plate_t if s > 0 else 0.0)
            box(f"chutestrap{k}{'ab'[s > 0]}", (sw, st, H + th + st), (xx, s * yo, zf - st), C["strap"],
                bevel=0.008, parent=p)
        box(f"chutestrap{k}b", (sw, W + 2 * th + 2 * st + plate_t, st), (xx, plate_t / 2, zf - st), C["strap"],
            bevel=0.008, parent=p)
        for s in (-1, 1):
            for zz in (zf + 0.15, zf + th + H - 0.1):
                yo = y_out + st / 2 + (plate_t if s > 0 else 0.0)
                cyl(f"chutestrapbolt{k}{'ab'[s > 0]}{abs(int(zz * 100))}", 0.03, 0.03, (xx, s * yo, zz),
                    M["steel"], rot=(-90 * s, 0, 0), verts=8, bevel=0.006, parent=p)
    # angle irons on the mouth's corners
    for s in (-1, 1):
        box(f"chutecorner{'ab'[s > 0]}", (0.06, 0.18, H + th + 0.06), (x1 - 0.02, s * (W / 2 + th - 0.05), zf - 0.03),
            C["strap"], bevel=0.008, parent=p)
    box("chutecornerlip", (0.06, W + 2 * th, 0.06), (x1 - 0.02, 0, zf - 0.03), C["strap"], bevel=0.008, parent=p)
    if TIER == 3:                                   # the front side (the one facing us) plated in iron, riveted
        box("chuteplate", (L_ - 0.1, 0.04, H + th - 0.04), (x0 + L_ / 2, W / 2 + th + 0.02, zf + 0.02),
            C["ironplate"], bevel=0.01, parent=p)
        for k in range(9):
            for zz in (zf + 0.12, zf + th + H - 0.12):
                xx = x0 + 0.42 + k * (L_ - 0.84) / 8
                cyl(f"chuteplaterivet{k}{abs(int(zz * 100))}", 0.025, 0.025, (xx, W / 2 + th + 0.04, zz), M["steel"],
                    rot=(-90, 0, 0), verts=8, bevel=0.006, parent=p)
    # the short crank arm: from the pivot down to a bracket on the back wall, bolted through
    arm_end = Vector((x0 - th - 0.03, 0, zf + th + H - 0.12))
    tube("chutearm", [Vector((0, 0, 0)), arm_end], 0.09, C["post"], parent=p, verts=14)
    box("chutearmplate", (0.04, 0.5, 0.46), (x0 - th - 0.02, 0, zf + th + H * 0.2), C["strap"], bevel=0.01, parent=p)
    cyl("chutearmeye", 0.13, 0.3, (0, -0.15, 0), C["post"], rot=(-90, 0, 0), verts=18, bevel=0.02, parent=p)


# ------------------------------------------------------------------------------------------------ Tier 3 extras
def bowl_heavy():
    """A second riveted iron band round the bowl and a thicker rolled lip."""
    z0, z1 = 2.55, 2.85
    rr = b.wall_r((z0 + z1) / 2) + 0.03
    o = kit.lathe("bowl-band2", [(rr - 0.02, z0), (rr + 0.04, z0 + 0.03), (rr + 0.04, z1 - 0.03), (rr - 0.02, z1)],
                  (0, 0, 0), M["band"], verts=64)
    for k in range(32):
        a = 2 * math.pi * k / 32
        d = Vector((math.cos(a), math.sin(a), 0))
        c = kit.blob(f"bowl-band2rivet{k}", d * (rr + 0.045) + Vector((0, 0, (z0 + z1) / 2)), 0.045, squash=1.0,
                     mat=M["steel"])
    kit.ring("bowl-lip2", b.RIM_R + 0.04, 0.13, M["lip"], z=b.RIM_Z - 0.12, n=64)


def bowl_glow():
    """A soft orange glow deep in the bowl, between the spikes: hot coals on its floor and a warm light."""
    o = cyl("bowl-coals", b.IN_R - 0.05, 0.08, (0, 0, b.FLOOR_Z + 0.01), kit.lava("c-coals", col=(220, 80, 14), hot=(255, 140, 40), strength=1.0, scale=2.5),
            verts=48, bevel=0.0)
    d = bpy.data.lights.new("bowlglow", "POINT")
    d.energy = 80.0
    d.color = (1.0, 0.42, 0.12)
    d.shadow_soft_size = 1.2
    lt = bpy.data.objects.new("bowlglow", d)
    link(lt)
    lt.location = (0, -0.2, b.FLOOR_Z + 0.35)


CHIMNEY = (48.0, 4.0)                 # bearing round the bowl and distance from its axis
SMOKE = []


def chimney():
    a = math.radians(CHIMNEY[0])
    d = Vector((math.cos(a), math.sin(a), 0))
    top = 4.6
    z_out = 1.35
    r_bowl = b.wall_r(z_out)
    p0 = d * (r_bowl - 0.1) + Vector((0, 0, z_out))
    p1 = d * (CHIMNEY[1] - 0.25) + Vector((0, 0, z_out))
    p2 = d * CHIMNEY[1] + Vector((0, 0, z_out + 0.3))
    p3 = d * CHIMNEY[1] + Vector((0, 0, top))
    tube("chimney", [p0, p1, p2, p3], 0.24, C["chimney"], verts=20, smooth=True)
    cyl("chimneyflange", 0.36, 0.08, p0 + d * 0.12, C["chimney"], verts=20, bevel=0.02)
    bpy.data.objects["chimneyflange"].rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    for zz in (2.5, 3.7):
        cyl(f"chimneyband{int(zz * 10)}", 0.275, 0.1, d * CHIMNEY[1] + Vector((0, 0, zz)), C["strap"], verts=20,
            bevel=0.015)
    kit.lathe("chimneytop", [(0.2, top + 0.1), (0.2, top - 0.04), (0.31, top - 0.04), (0.31, top + 0.12),
                             (0.27, top + 0.16), (0.2, top + 0.12)], (0, 0, 0), C["chimney"], verts=24)
    bpy.data.objects["chimneytop"].location = d * CHIMNEY[1]
    cyl("chimneysoot", 0.205, 0.02, d * CHIMNEY[1] + Vector((0, 0, top + 0.06)), M["dark"], verts=20, bevel=0.0)
    # a stay from the chimney to the post's collar, so the pipe is held at the top
    base, u, w = chute_frame()
    tube("chimneystay", [d * CHIMNEY[1] + Vector((0, 0, 3.7)), base + Vector((0, 0, 3.7))], 0.04, C["strap"], verts=8)
    # smoke: puffs rising and fading, each on its own phase so the loop has no jump
    sm = smoke_mat()
    e = empty("smoke", moving=True)
    for k in range(8):
        o = kit.blob(f"smokepuff{k}", (0, 0, 0), 0.32, squash=0.85, mat=sm, parent=e)
        o.visible_shadow = False
        SMOKE.append((o, k / 8))
    CHUTE["smoke_at"] = p3 + Vector((0, 0, 0.4))


WEDGE_A = 30.0


def wedge():
    """A wooden wedge on the ground at the drum's front, its slope touching the drum so it cannot roll forward."""
    cx, cy, r, length = b.DRUM
    ax = Vector((b.DRUM_U[0], b.DRUM_U[1], 0)).normalized()
    out = Vector((ax.y, -ax.x, 0))                      # across the drum, toward us
    if out.dot(Vector((1, -1, 0))) < 0:
        out = -out
    ta = math.tan(math.radians(WEDGE_A))
    p0 = r * (1 - 1 / math.cos(math.radians(WEDGE_A))) / ta     # where the slope meets the ground (toward us: +)
    p0 = -p0
    back = p0 + 0.6
    pts = [(p0, 0.0), (back, 0.0), (back, (back - p0) * ta)]
    bm = bmesh.new()
    wl, at = 0.32, 0.16                                 # between the drum's middle bands
    rows = []
    for s in (at - wl / 2, at + wl / 2):
        rows.append([bm.verts.new(Vector((cx, cy, 0)) + ax * s + out * p + Vector((0, 0, z))) for p, z in pts])
    bm.faces.new(rows[0])
    bm.faces.new(rows[1][::-1])
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((rows[0][i], rows[1][i], rows[1][j], rows[0][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("wedge", bm, [C["wedge"]], smooth=False, bevel=0.02, segs=2)


# ------------------------------------------------------------------------------------------------ build / animate
def warm(names):
    """Add parts with these materials to Tier 1's warm Inferno light (its second sun lights only copper, rust, wood)."""
    coll = bpy.data.collections.get("glowlit")
    if coll is None:
        return
    for o in bpy.data.objects:
        if o.type in ("MESH", "CURVE") and any(s.material and s.material.name in names for s in o.material_slots):
            if o.name not in coll.objects:
                coll.objects.link(o)


def build():
    if TIER == 1:
        b.build()
        return
    body()
    face_out = panel()
    cogs(face_out)
    roller(0)
    roller(1)
    post_and_chute()
    if TIER == 3:
        bowl_heavy()
        bowl_glow()
        chimney()
        wedge()
    b.glow()
    warm({C["planks"].name, C["wedge"].name})


ROCK = 1.5                             # the chute's rock (deg), twice a loop


def turn(f):
    if TIER == 1:
        b.turn(f)
        return
    t = f / FR
    for spin, sign in ROLLS:            # the rollers turn toward each other, one row in a loop
        spin.rotation_euler = Euler((sign * 2 * math.pi / ROWS * t, 0, 0))
    for spin, n, sign, phase in COGS:   # the big cog turns one tooth in a loop, the other with it
        spin.rotation_euler = Euler((0, 0, phase + sign * 2 * math.pi / 12 * t * 12 / n))
    CHUTE["rock"].rotation_euler = Euler((0, math.radians(ROCK) * math.sin(4 * math.pi * t), 0))
    if SMOKE:
        at = CHUTE["smoke_at"]
        for o, ph in SMOKE:
            p = (t + ph) % 1.0
            o.location = at + Vector((0.5 * p + 0.1 * math.sin(6.3 * p), -0.25 * p, 2.6 * p))
            s = 0.45 + 1.3 * p
            o.scale = (s, s, s)
            o.color = (1, 1, 1, 0.8 * math.sin(math.pi * p) ** 1.5)


if __name__ == "__main__":
    kit.run(build, turn)
