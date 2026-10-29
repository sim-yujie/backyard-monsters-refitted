"""inferno3d.py : the three Inferno towers as 3D models in the game's camera (buildings-3d-2, 28 Oct 2026), modelled on
the Flash art (no painted repaint exists): T=1 the Inferno Blast Tower (icannontower), T=2 the Sharpshooter (isnipertower),
T=3 the Magma Tower (imagmatower). Each is round, so only its head turns; the rest (the striped skirt and wooden drum,
the coil post, the striped column with its chain legs) is the body.

  blender -b --factory-startup -P inferno3d.py -- T body | turret [h ...] | full H | aim | clash | save

(see ../tower-3d/square3d.py for the modes; the same scale, 75 px per unit at @2x, and the same camera; the body canvas is
taller, BODY_CANVAS below, as the Sharpshooter stands about 3.3 units high.)
"""
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
L.EL = float(os.environ.get("INFERNO_EL", 30.0))
import square3d as Q  # noqa: E402
import worn3d as W  # noqa: E402
from look3d import add_outline, bear, lathe, mat_flat, obj_from_bm, rbox, srgb, studs, tube  # noqa: E402

Q.BODY_CANVAS = (640, 760, 320, 590)       # w, h, the ground middle's pixel (4x)
L.METALS.update(
    bronze=((60, 34, 16), (150, 98, 56), (226, 182, 128), (1.0, 0.9, 0.75, 1)),    # the Inferno's dull bronze
    copper=((70, 28, 12), (190, 100, 56), (250, 186, 136), (1.0, 0.88, 0.78, 1)),
    iron=((22, 18, 18), (70, 62, 60), (150, 140, 136), (0.95, 0.92, 0.9, 1)),
)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
LOOK = int(os.environ.get("INFERNO_LOOK", 1))   # the Blast Tower's level look (1-3, see blast_roles): render/t1-lookN


def mat_diag(name, a, b, n=6, lean=1.6, period=1.0):
    """Diagonal painted stripes wound round the Z axis (the Inferno's red and cream), a little chipped and grimy."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    u = p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), p.math("MULTIPLY", sep.outputs[2], lean / period))
    bnd = p.math("GREATER_THAN", p.math("FRACT", u), 0.5)
    paint = p.mix(srgb(*a), srgb(*b), bnd)
    chip = p.ramp(p.noise(7.0, 8.0, 0.62), [(0.62, (0, 0, 0, 1)), (0.645, (1, 1, 1, 1))])
    paint = p.mix(paint, srgb(120, 70, 40), chip)
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.78, 0.74, 0.72, 1)), (0.7, (1, 1, 1, 1))])
    return p.finish(p.mix(paint, grime, 1.0, 'MULTIPLY'), spec=0.3, spec_rough=0.35, shade=L.WARM_SHADE)


def mat_parchment(name):
    """The Sharpshooter's drum: cream parchment panels with dark scrawl, between dark red ones."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    panel = p.math("GREATER_THAN", p.math("FRACT", p.math("MULTIPLY", ang, 8 / (2 * math.pi))), 0.32)
    scrawl = p.ramp(p.noise(14.0, 6.0, 0.7, stretch=(1.0, 1.0, 3.0)), [(0.6, (1, 1, 1, 1)), (0.66, (0.45, 0.36, 0.3, 1))])
    cream = p.mix(srgb(238, 222, 190), scrawl, 1.0, 'MULTIPLY')
    paint = p.mix(srgb(120, 22, 24), cream, panel)
    grime = p.ramp(p.noise(2.5, 3.0), [(0.3, (0.8, 0.76, 0.72, 1)), (0.7, (1, 1, 1, 1))])
    return p.finish(p.mix(paint, grime, 1.0, 'MULTIPLY'), spec=0.25, spec_rough=0.4, shade=L.WARM_SHADE)


def common():
    met = L.mat_metal
    return dict(
        bronze=met("bronze", spec=1.0, wear=0.5),
        copper=met("copper", spec=1.0, wear=0.3),
        iron=met("iron", spec=0.8, wear=0.6, polish=0.3),
        wood=L.mat_wood("wood", light=(170, 104, 62), dark=(118, 66, 36), crack=(60, 30, 16)),
        stripes=mat_diag("stripes", (196, 30, 26), (236, 214, 178)),
        leather=L.mat_wood("leather", light=(176, 120, 76), dark=(120, 76, 44), crack=(70, 40, 20)),
        glow=L.mat_glass_lamp("glow", core=(255, 240, 170), mid=(255, 140, 30), rim=(200, 50, 0)),
        halo=L.mat_halo("halo", (255, 140, 40), strength=0.5),
        bore=mat_flat("bore", (20, 14, 12), spec=0.1),
        lens=L.mat_glass_lamp("lens", core=(220, 250, 255), mid=(80, 190, 230), rim=(20, 80, 140)),
        parch=mat_parchment("parch"),
        wire=mat_flat("wire", (230, 190, 40), spec=0.6),
        # the worn look (owner, 29 Oct: "too unrefined and lacks detail compared to the original"; see worn3d.py)
        dirt=W.mat_dirt("dirt"),
        stripes_w=W.mat_worn_diag("stripes_w", (192, 24, 18), (222, 190, 142)),
        stake=W.mat_raw_wood("stake"),
        staves=W.mat_planks("staves", n=16, light=(196, 140, 92), dark=(150, 98, 60)),
        staves_dark=W.mat_planks("staves_dark", n=14, light=(150, 96, 58), dark=(104, 62, 36), soot=0.35),
        rope=W.mat_rope("rope"),
        iron_w=W.mat_iron("iron_w"),
        iron_dirty=W.mat_iron("iron_dirty", base=(76, 60, 50), dark=(36, 28, 24), rust_k=0.8, soot=0.5, dirt=0.0),
        iron_head=W.mat_iron("iron_head"),
        panels=W.mat_worn_panels("panels", ratio=0.4),
        lamp_red=L.mat_glass_lamp("lamp_red", core=(255, 220, 180), mid=(230, 40, 30), rim=(120, 10, 10)),
        brass_w=W.mat_iron("brass_w", base=(200, 150, 60), dark=(120, 80, 24), rust=(110, 90, 40), edge=(250, 220, 150),
                           rust_k=0.4, spec=0.3),
        copper_w=W.mat_iron("copper_w", base=(214, 136, 82), dark=(140, 72, 36), rust=(110, 60, 34), edge=(250, 206, 160),
                            rust_k=0.45, dents=0.5, spec=0.3),
        steel_w=W.mat_iron("steel_w", base=(170, 166, 160), dark=(96, 92, 88), rust=(140, 84, 44), edge=(230, 226, 218),
                           rust_k=0.35, spec=0.35),
        lava=W.mat_lava("lava"),
        lava_hot=W.mat_lava("lava_hot", hot=(255, 248, 200), mid=(255, 150, 30), deep=(230, 60, 0), crust=(90, 30, 8),
                            strength=1.6),
        bronze_w=W.mat_iron("bronze_w", base=(112, 76, 48), dark=(60, 38, 24), rust=(150, 74, 30), edge=(200, 160, 116),
                            rust_k=0.6),
        bronze_head=W.mat_iron("bronze_head", base=(132, 92, 62), dark=(70, 46, 30), rust=(150, 76, 32), edge=(214, 176, 130),
                               rust_k=0.6),
        iron_hoop=W.mat_iron("iron_hoop", base=(74, 58, 48), dark=(38, 29, 25), edge=(150, 128, 108), rust_k=0.85),
        iron_sooty=W.mat_iron("iron_sooty", rust_k=0.6, soot=0.6),
        # the upper levels' looks after the Inferno's blocks (see blast_roles)
        brimstone=W.mat_brimstone("brimstone"),
        forged=W.mat_forged("forged"),
        forged_dark=W.mat_forged("forged_dark", base=(70, 64, 64), dark=(34, 31, 33), edge=(168, 162, 158), edge_k=0.55,
                                 spec=0.4),
        forged_plates=W.mat_forged("forged_plates", seams=16),
        panels_forged=W.mat_worn_panels("panels_forged", ratio=0.4, cream=(62, 56, 56), red=(150, 16, 14), scrawl=(30, 28, 28),
                                        edge=(170, 162, 158)),
        forged_plates_dark=W.mat_forged("forged_plates_dark", seams=14, base=(70, 64, 64), dark=(34, 31, 33)),
        forged_magma=W.mat_forged("forged_magma"),
        stripes_forged=W.mat_worn_diag("stripes_forged", (172, 16, 12), (56, 50, 50), under=(28, 26, 26),
                                       edge=(168, 160, 156), chips=0.72, dirt=0.3, soot=0.15, streaks=0.12),
    )


def ridged_barrel(name, tur, M, y0, y1, r, z, rings, mat="bronze", mouth=1.25):
    """A barrel along +Y at height z from y0 to y1, raised rings at the fractions in rings, a flared mouth."""
    prof = [(r, 0.0)]
    for f in rings:
        yc = (y1 - y0) * f
        prof += [(r, yc - 0.04), (r * 1.25, yc - 0.025), (r * 1.25, yc + 0.025), (r, yc + 0.04)]
    L_ = y1 - y0
    prof += [(r, L_ - 0.08), (r * mouth, L_ - 0.03), (r * mouth, L_)]
    inner = [(r * mouth, L_), (r * 0.75, L_), (r * 0.7, L_ - 0.1), (0.0, L_ - 0.12)]
    b = lathe(name, [prof, inner], [M[mat], M["bore"]], mat_of_seg=[0, 1], parent=tur, sharp=35, n=40)
    b.matrix_basis = Matrix.Translation((0, y0, z)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    return b


# ------------------------------------------------------------------------------------------------ 1: Inferno Blast Tower
def pleat(ob, n, amp, z0, z1, phase):
    """Folds in a lathe part (the skirt's canvas): n ridges round it, deepest at z0, gone by z1."""
    for v in ob.data.vertices:
        x, y, z = v.co
        r = math.hypot(x, y)
        if r < 1e-4:
            continue
        t = 1.0 - min(1.0, max(0.0, (z - z0) / (z1 - z0)))
        k = (r + amp * t * (1.0 - abs(math.sin(n / 2 * (math.atan2(y, x) - phase)))) ** 1.6) / r
        v.co.x, v.co.y = x * k, y * k
    ob.data.update()


def strap(name, M, LN, parent, r, z0, z1, n_rivets, rivet_r=0.034, phase=0.0, mat="iron_hoop"):
    """An iron hoop round a round part, riveted on."""
    mat = M[mat] if isinstance(mat, str) else mat
    hoop = W.lathe(name, [L.band(r - 0.02, r + 0.03, z0, z1, bev=0.012)], [mat], bev=0, parent=parent, sharp=35)
    add_outline(hoop, LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts, nrm = L.ring_of(n_rivets, r + 0.03, (z0 + z1) / 2, phase)
    W.rivets(bm, pts, nrm, r=rivet_r)
    W.obj(name + "_rivets", bm, [mat], parent=parent)
    return hoop


def blast_roles(M):
    """The Blast Tower's material key for each role, by LOOK (the owner, 29 Oct: a tower's levels follow its world's
    blocks, in the Inferno Brimstone and Forged Steel): 1 the approved worn tower, 2 the same with charred brimstone
    spikes and rubble glowing in their cracks, 3 forged steel (dark steel plating, head and spikes, red and steel
    stripes). Each level also stands taller than the last (see RISE in build_blast)."""
    if LOOK == 2:
        return dict(skirt="stripes_w", stake="brimstone", tip="brimstone", staves="staves", staves_dark="staves_dark",
                    hoop="iron_hoop", plate="iron_dirty", rope="rope", bolt="iron_w", collar="iron_w", cap="iron_w",
                    ball="iron_head", trim="iron_head", barrel="iron_sooty", band=None, clod="brimstone")
    if LOOK == 3:
        return dict(skirt="stripes_forged", stake="forged", tip="forged", staves="forged_plates",
                    staves_dark="forged_plates_dark", hoop="forged_dark", plate="forged_plates_dark",
                    rope="forged_dark", bolt="forged", collar="forged", cap="forged", ball="forged_dark", trim="forged",
                    barrel="forged_dark", band="forged", clod="dirt")
    return dict(skirt="stripes_w", stake="stake", tip="stake", staves="staves", staves_dark="staves_dark",
                hoop="iron_hoop", plate="iron_dirty", rope="rope", bolt="iron_w", collar="iron_w", cap="iron_w",
                ball="iron_head", trim="iron_head", barrel="iron_sooty", band=None, clod="dirt")


def barrel_bands(tur, M, LN, y0, y1, r, z, rings, mat, mouth=1.25):
    """Bands over a ridged barrel's rings and mouth (the forged steel look's)."""
    L_ = y1 - y0
    segs = [L.band(r, r * 1.25 + 0.012, L_ * f - 0.04, L_ * f + 0.04, bev=0.01) for f in rings]
    segs.append(L.band(r, r * mouth + 0.014, L_ - 0.09, L_ - 0.005, bev=0.01))
    b = W.lathe("bands", segs, [M[mat]], bev=0, parent=tur, sharp=35, n=40)
    b.matrix_basis = Matrix.Translation((0, y0, z)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    add_outline(b, LN["cool"], L.LINE * 0.6)
    return b


def build_blast(M, LN, body):
    R = {k: M[v] if v else None for k, v in blast_roles(M).items()}
    faceted = LOOK == 3       # forged steel: flat-sided tub, neck and spikes
    RISE = (0.0, 0.25, 0.5)[LOOK - 1]     # each level stands taller than the last (reads as a longer range)
    SPIKE = (1.0, 1.3, 1.6)[LOOK - 1]     # and its spikes are bigger
    # the scorched rubble round the foot
    mound = W.lathe("mound", [[(1.14, 0.0), (1.04, 0.05), (0.92, 0.1), (0.8, 0.1), (0.66, 0.06)]], [M["dirt"]], bev=0,
                    parent=body, n=128)
    W.wobble(mound, 0.07, 3.5, 1.0, zamp=0.035)
    W.finish(mound)
    add_outline(mound, LN["warm"], L.LINE * 0.7)
    cl = bmesh.new()
    W.clods(cl, [bear(360 * i / 22 + 9 * (i % 3), 0.86 + 0.2 * ((i * 0.37) % 1.0), 0.05) for i in range(22)], r=0.075)
    add_outline(W.obj("clods", cl, [R["clod"]], parent=body, sharp=60), LN["warm"], L.LINE * 0.6)
    # the skirt: a striped canvas cone in folds, worn and scorched toward the ground
    sk = W.lathe("skirt", [[(0.88, 0.0), (0.87, 0.05), (0.58, 0.8), (0.54, 0.84)]], [R["skirt"]], bev=0, parent=body,
                 sharp=50, n=160)
    pleat(sk, 10, 0.06, 0.0, 0.84, math.radians(90 - 18) + math.pi / 10)
    W.wobble(sk, 0.02, 2.0, 2.0)
    W.finish(sk)
    add_outline(sk, LN["warm"])
    # the stakes round the foot: rough wooden planks standing in the rubble, leaning out like petals
    st = bmesh.new()
    uv = st.loops.layers.uv.new("UVMap")
    ns = 12 if LOOK == 3 else 10
    for i in range(ns):
        b = 360 * i / ns + 18 + (7 if i % 2 else -5)
        lean = (0.34 + 0.14 * ((i * 0.53) % 1.0)) * (1 + 0.25 * (SPIKE - 1))
        h = (0.66 + 0.2 * ((i * 0.71) % 1.0)) * SPIKE
        W.stake(st, uv, bear(b, 0.8, 0.0), bear(b + (6 if i % 3 else -6), 0.8 + lean, h), 0.15 * (1 + 0.3 * (SPIKE - 1)),
                sides=5 if faceted else 8,
                twist=i * 0.7, tip_mat=1 if LOOK > 1 else None)
    add_outline(W.obj("stakes", st, [R["stake"], R["tip"]], parent=body, sharp=20 if faceted else 55), LN["warm"])
    # the stave neck above the skirt, an iron strap round its foot
    z1 = 1.58 + RISE
    neck = W.lathe("neck", [[(0.5, 0.78), (0.53, 0.98 + RISE / 2), (0.51, 1.17 + RISE)]], [R["staves_dark"]], bev=0,
                   wob=0.012,
                   parent=body, sharp=20 if faceted else 35, n=14 if faceted else 96)
    add_outline(neck, LN["warm"])
    strap("neckstrap", M, LN, body, 0.51, 0.84, 0.92, 12, phase=0.25, mat=R["hoop"])
    for k in range(1, LOOK):     # a strap more round the longer neck per level
        zc = 0.88 + k * (RISE + 0.24) / LOOK
        strap(f"neckstrap{k}", M, LN, body, 0.525, zc - 0.04, zc + 0.04, 12, phase=0.25 + k * 0.3, mat=R["hoop"])
    # the tub: light staves, an iron hoop, a rope laid round its rim, a recessed iron plate with bolts in it
    tub = W.lathe("drum", [[(0.5, 1.12 + RISE), (0.6, 1.16 + RISE), (0.63, 1.36 + RISE), (0.62, z1 - 0.04), (0.585, z1)],
                           [(0.585, z1), (0.53, z1), (0.52, z1 - 0.06)]],
                  [R["staves"], R["staves_dark"]], mat_of_seg=[0, 1], wob=0.012, seed=3.0, parent=body,
                  sharp=20 if faceted else 35, n=16 if faceted else 96)
    add_outline(tub, LN["warm"])
    strap("tubhoop", M, LN, body, 0.605, 1.19 + RISE, 1.27 + RISE, 14, rivet_r=0.036, mat=R["hoop"])
    W.lathe("plate", [[(0.53, z1 - 0.06), (0.0, z1 - 0.06)]], [R["plate"]], bev=0, parent=body)
    rp = bmesh.new()
    W.rope_ring(rp, 0.6, z1 + 0.01, r=0.07, pitch=0.13)
    add_outline(W.obj("rope", rp, [R["rope"]], parent=body, sharp=70), LN["warm"], L.LINE * 0.6)
    if LOOK == 3:     # a crown of short steel spikes round the rim, under the barrel's sweep
        cr = bmesh.new()
        cuv = cr.loops.layers.uv.new("UVMap")
        for i in range(10):
            b = 360 * i / 10 + 9
            W.stake(cr, cuv, bear(b, 0.6, z1 - 0.02), bear(b, 0.84, z1 + 0.24), 0.075, sides=5, twist=i * 0.5)
        add_outline(W.obj("crown", cr, [R["stake"]], parent=body, sharp=20), LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts, nrm = L.ring_of(8, 0.45, z1 - 0.06, 0.5)
    W.bolts(bm, pts, [(0, 0, 1)] * 8, r=0.04)
    add_outline(W.obj("platebolts", bm, [R["bolt"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)
    # the iron collar the head sits on, a glowing slit under its bolted cap
    col = W.lathe("collar", [[(0.3, z1 - 0.07), (0.31, z1 + 0.03), (0.27, z1 + 0.06)]], [R["collar"]], parent=body, sharp=35)
    add_outline(col, LN["cool"])
    lathe("glowring", [[(0.3, z1 + 0.04), (0.3, z1 + 0.11), (0.27, z1 + 0.12)]], [M["glow"]], parent=body)
    rim = W.lathe("glowcap", [L.band(0.0, 0.37, z1 + 0.11, z1 + 0.17)], [R["cap"]], bev=0, parent=body, sharp=35)
    add_outline(rim, LN["cool"])
    bm = bmesh.new()
    pts, nrm = L.ring_of(8, 0.345, z1 + 0.14, 0.5)
    W.bolts(bm, pts, nrm, r=0.032, washer=False)
    add_outline(W.obj("capbolts", bm, [R["bolt"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)
    top = z1 + 0.17
    # the head: a hammered iron ball with a riveted seam, a ridged barrel out of its side, level
    tur = L.empty("TURRET", loc=(0, 0, top + 0.004))
    RB, HZ = 0.3, 0.3
    bm = bmesh.new()
    Q.ball(bm, (0, 0, HZ), RB, segs=32)
    ball = W.obj("ball", bm, [R["ball"]], parent=tur)
    W.wobble(ball, 0.008, 6.0, 4.0, radial=False)
    W.finish(ball)
    add_outline(ball, LN["cool"])
    seam = W.lathe("seam", [L.band(RB - 0.02, RB + 0.02, HZ - 0.03, HZ + 0.03, bev=0.01)], [R["trim"]], bev=0,
                   parent=tur, sharp=35)
    add_outline(seam, LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts, nrm = L.ring_of(14, RB + 0.02, HZ, 0.5)
    W.rivets(bm, pts, nrm, r=0.032)
    W.obj("seamrivets", bm, [R["trim"]], parent=tur)
    bm = bmesh.new()
    Q.cyl(bm, 0.23, 0.07, Matrix.Translation((0, 0, 0.035)), segs=32)
    add_outline(W.obj("neck_h", bm, [R["trim"]], parent=tur, sharp=35), LN["cool"])
    bm = bmesh.new()
    pts, nrm = L.ring_of(6, 0.2, 0.07, 0.5)
    W.bolts(bm, pts, [(0, 0, 1)] * 6, r=0.03, washer=False)
    W.obj("neckbolts", bm, [R["bolt"]], parent=tur, sharp=35)
    bar = ridged_barrel("barrel", tur, M, RB * 0.5, RB + 0.5, 0.14, HZ, (0.35, 0.65), mat=blast_roles(M)["barrel"])
    W.finish(bar)
    add_outline(bar, LN["cool"])
    if blast_roles(M)["band"]:
        barrel_bands(tur, M, LN, RB * 0.5, RB + 0.5, 0.14, HZ, (0.35, 0.65), blast_roles(M)["band"])
    bm = bmesh.new()      # the flange where the barrel leaves the ball, bolted
    m = Matrix.Translation((0, RB * 0.86, HZ)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    Q.cyl(bm, 0.21, 0.05, m, segs=32)
    add_outline(W.obj("flange", bm, [R["trim"]], parent=tur, sharp=35), LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts = [Vector((0.175 * math.cos(2 * math.pi * (k + 0.5) / 6), RB * 0.86 + 0.026,
                   HZ + 0.175 * math.sin(2 * math.pi * (k + 0.5) / 6))) for k in range(6)]
    W.bolts(bm, pts, [(0, 1, 0)] * 6, r=0.026, washer=False)
    W.obj("flangebolts", bm, [R["bolt"]], parent=tur, sharp=35)
    L.empty("muzzle_base", parent=tur, loc=(0, 0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, RB + 0.5, HZ))
    return tur, top, ("skirt", "drum", "glowcap")


# ---------------------------------------------------------------------------------------------------- 2: Sharpshooter
def on_cone(r0, z0, r1, z1, z):
    """The radius and outward normal (as (cos, sin)-free slope) of a cone from (r0, z0) to (r1, z1) at height z."""
    t = (z - z0) / (z1 - z0)
    return r0 + (r1 - r0) * t, (z1 - z0, -(r1 - r0))


def sharp_roles():
    """The Sharpshooter's material key for each role, by LOOK (as blast_roles: 1 worn, 2 the same with brimstone spikes
    and rubble, 3 forged steel; the copper coil, red lamps and brass stay on every level)."""
    if LOOK == 3:
        return dict(panels="panels_forged", top="forged_plates_dark", strap="forged_dark", post="forged_plates_dark",
                    head="forged_dark", metal="forged", barrel="forged", spike="forged")
    return dict(panels="panels", top="iron_dirty", strap="iron_hoop", post="staves_dark", head="iron_head", metal="iron_w",
                barrel="steel_w", spike="brimstone")


def build_sharp(M, LN, body):
    SR = sharp_roles()
    R = {k: M[v] for k, v in SR.items()}
    RISE = (0.0, 0.25, 0.5)[LOOK - 1]     # each level stands taller than the last (reads as a longer range)
    z1 = 0.8
    if LOOK > 1:     # the upper levels: spikes round the foot (brimstone, then bigger forged steel), level 2's rubble
        SPIKE = (1.0, 1.3, 1.6)[LOOK - 1]
        if LOOK == 2:
            cl = bmesh.new()
            W.clods(cl, [bear(360 * i / 22 + 9 * (i % 3), 0.98 + 0.16 * ((i * 0.37) % 1.0), 0.04) for i in range(22)],
                    r=0.075)
            add_outline(W.obj("clods", cl, [M["brimstone"]], parent=body, sharp=60), LN["warm"], L.LINE * 0.6)
        st = bmesh.new()
        uv = st.loops.layers.uv.new("UVMap")
        ns = 12 if LOOK == 3 else 10
        for i in range(ns):
            b = 360 * i / ns + 18 + (7 if i % 2 else -5)
            lean = (0.3 + 0.14 * ((i * 0.53) % 1.0)) * (1 + 0.25 * (SPIKE - 1))
            h = (0.5 + 0.2 * ((i * 0.71) % 1.0)) * SPIKE
            W.stake(st, uv, bear(b, 0.86, 0.0), bear(b + (6 if i % 3 else -6), 0.86 + lean, h),
                    0.13 * (1 + 0.3 * (SPIKE - 1)), sides=5 if LOOK == 3 else 8, twist=i * 0.7, tip_mat=1)
        add_outline(W.obj("spikes", st, [R["spike"], R["spike"]], parent=body, sharp=20 if LOOK == 3 else 55), LN["warm"])
    drum = W.lathe("drum", [[(0.86, 0.0), (0.88, 0.04), (0.74, z1 - 0.04), (0.7, z1)], [(0.7, z1), (0.0, z1)]],
                   [R["panels"], R["top"]], mat_of_seg=[0, 1], wob=0.012, parent=body, sharp=35)
    add_outline(drum, LN["warm"])
    strap("trim_low", M, LN, body, 0.875, 0.0, 0.09, 20, rivet_r=0.034, mat=SR["strap"])
    strap("trim_top", M, LN, body, 0.715, z1 - 0.06, z1 + 0.01, 16, rivet_r=0.03, phase=0.5, mat=SR["strap"])
    if LOOK == 3:     # a crown of short steel spikes round the drum's rim
        cr = bmesh.new()
        cuv = cr.loops.layers.uv.new("UVMap")
        for i in range(12):
            b = 360 * i / 12 + 15
            W.stake(cr, cuv, bear(b, 0.71, z1 - 0.03), bear(b, 0.9, z1 + 0.2), 0.06, sides=5, twist=i * 0.5)
        add_outline(W.obj("crown", cr, [R["spike"]], parent=body, sharp=20), LN["cool"], L.LINE * 0.6)
    # rivets at the parchment panels' corners
    bm = bmesh.new()
    pts, nrm = [], []
    for k in range(8):
        for f in (0.0, 0.4):
            a = 2 * math.pi * (k + f) / 8 + (0.04 if f == 0 else -0.04)
            for z in (0.2, 0.6):
                r, (nr, nz) = on_cone(0.88, 0.04, 0.74, z1 - 0.04, z)
                pts.append(Vector((r * math.cos(a), r * math.sin(a), z)))
                nrm.append(Vector((nr * math.cos(a), nr * math.sin(a), nz)))
    W.rivets(bm, pts, nrm, r=0.03)
    W.obj("panelrivets", bm, [M[SR["strap"]]], parent=body)
    # the dark socket on top, bolted; posts round it with red lamps on top and a twisted wire between
    sock = W.lathe("socket", [[(0.56, z1), (0.58, z1 + 0.02), (0.58, z1 + 0.2), (0.5, z1 + 0.24), (0.36, z1 + 0.24),
                               (0.34, z1 + 0.1), (0.0, z1 + 0.1)]], [R["top"]], wob=0.008, parent=body, sharp=35)
    add_outline(sock, LN["cool"])
    bm = bmesh.new()
    pts, nrm = L.ring_of(10, 0.43, z1 + 0.24, 0.5)
    W.bolts(bm, pts, [(0, 0, 1)] * 10, r=0.035)
    add_outline(W.obj("sockbolts", bm, [R["metal"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)
    posts, knobs, rings = bmesh.new(), bmesh.new(), bmesh.new()
    tops = []
    for b in (100, 200, 330):
        c = bear(b, 0.62, z1)
        Q.cyl(posts, 0.032, 0.58, Matrix.Translation(c + Vector((0, 0, 0.29))), segs=10)
        Q.cyl(posts, 0.06, 0.05, Matrix.Translation(c + Vector((0, 0, 0.025))), segs=12)      # its foot
        Q.ball(knobs, c + Vector((0, 0, 0.64)), 0.065, segs=12)
        Q.cyl(rings, 0.075, 0.03, Matrix.Translation(c + Vector((0, 0, 0.6))), segs=16)       # the lamp's brass cup
        tops.append(c + Vector((0, 0, 0.56)))
    add_outline(W.obj("posts", posts, [R["metal"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    add_outline(W.obj("knobs", knobs, [M["lamp_red"]], parent=body), LN["warm"], L.LINE * 0.5)
    add_outline(W.obj("cups", rings, [M["brass_w"]], parent=body, sharp=35), LN["warm"], L.LINE * 0.5)
    w = bmesh.new()
    for a, b in zip(tops, tops[1:] + tops[:1]):
        mid = (a + b) / 2 - Vector((0, 0, 0.08))
        path = L.bezier(a, mid, mid, b, n=40)
        for s in (0, 1):        # two strands twisted round each other
            pts = []
            for i, p in enumerate(path):
                t = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
                side = t.cross(Vector((0, 0, 1))).normalized()
                ph = i * 0.9 + s * math.pi
                pts.append(p + (side * math.cos(ph) + Vector((0, 0, 1)) * math.sin(ph)) * 0.01)
            L.tube(w, pts, [0.011] * len(pts), sides=5)
    W.obj("wire", w, [M["brass_w"]], parent=body)
    # the coil post: stacked turned segments, a worn copper ribbon wound round it
    zc0, top = z1 + 0.1, 2.6 + RISE
    prof = [(0.2, zc0)]
    z = zc0
    for i, h in enumerate((0.26, 0.22, 0.3, 0.24, 0.28, 0.2, 0.24, 0.26, 0.22)):
        r = 0.17 + 0.03 * ((i * 0.61) % 1.0)
        prof += [(r + 0.04, z + 0.02), (r + 0.04, z + 0.06), (r, z + 0.08), (r, z + h - 0.02)]
        z += h
        if z > top - 0.15:
            break
    prof += [(0.2, top - 0.05), (0.2, top), (0.0, top)]
    post = W.lathe("post", [prof], [R["post"]], wob=0.008, parent=body, sharp=35)
    add_outline(post, LN["warm"])
    pts, radii = [], []
    n = 260
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * (3.5 + 2 * RISE) * t
        r = 0.44 - 0.1 * t
        pts.append((r * math.sin(a), r * math.cos(a), zc0 + 0.1 + (top - zc0 - 0.25) * t))
        radii.append(0.1 * (1.0 + 0.12 * math.sin(i * 0.37)))
    coil = bmesh.new()
    L.tube(coil, pts, radii, sides=12, flat=0.28)
    co = W.obj("coil", coil, [M["copper_w"]], parent=body, sharp=60)
    W.wobble(co, 0.025, 2.5, 6.0)
    W.finish(co)
    add_outline(co, LN["warm"])
    # the head: a cast iron box gun, bolted, a dial on its side, a perforated steel barrel out of its front, a lens behind
    tur = L.empty("TURRET", loc=(0, 0, top + 0.004))
    bm = bmesh.new()
    L.rbox(bm, (0.54, 0.7, 0.42), Matrix.Translation((0, -0.06, 0.05)), bevel=0.05)
    head = W.obj("head", bm, [R["head"]], parent=tur, sharp=35)
    W.wobble(head, 0.01, 4.0, 7.0, radial=False)
    W.finish(head)
    add_outline(head, LN["cool"])
    bm = bmesh.new()
    cs = [(x, y, 0.47) for x in (-0.21, 0.21) for y in (-0.35, 0.23)]
    W.bolts(bm, cs, [(0, 0, 1)] * 4, r=0.035)
    for sx in (-1, 1):       # the dials on its sides, a bolt in each
        Q.cyl(bm, 0.1, 0.04, Matrix.Translation((sx * 0.28, -0.08, 0.26)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), segs=24)
        W.bolts(bm, [(sx * 0.3, -0.08, 0.26)], [(sx, 0, 0)], r=0.035, washer=False)
    add_outline(W.obj("headbolts", bm, [R["metal"]], parent=tur, sharp=35), LN["cool"], L.LINE * 0.5)
    bm = bmesh.new()
    Q.cyl(bm, 0.12, 0.08, Matrix.Translation((0, 0, 0.045)), segs=24)
    add_outline(W.obj("neck_h", bm, [R["metal"]], parent=tur, sharp=35), LN["cool"])
    HZ = 0.27
    bar = ridged_barrel("barrel", tur, M, 0.2, 0.84, 0.1, HZ, (0.2, 0.8), mat=SR["barrel"], mouth=1.3)
    W.finish(bar)
    add_outline(bar, LN["cool"])
    bm = bmesh.new()      # the barrel's holes
    for j in range(3):
        for k in range(8):
            a = 2 * math.pi * (k + 0.5 * (j % 2)) / 8
            c = Vector((0.1 * math.cos(a), 0.42 + 0.12 * j, HZ + 0.1 * math.sin(a)))
            m = Matrix.Translation(c) @ Vector((0, 0, 1)).rotation_difference(Vector((math.cos(a), 0, math.sin(a)))).to_matrix().to_4x4()
            Q.cyl(bm, 0.022, 0.012, m, segs=8)
    L.obj_from_bm("holes", bm, [M["bore"]], parent=tur)
    bm = bmesh.new()
    m = Matrix.Translation((0, -0.42, HZ)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    Q.cyl(bm, 0.1, 0.04, m, segs=20)
    L.obj_from_bm("lens_back", bm, [M["lens"]], parent=tur)
    L.empty("muzzle_base", parent=tur, loc=(0, 0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, 0.84, HZ))
    return tur, top, ("post", "coil", "posts", "socket")


# ----------------------------------------------------------------------------------------------------- 3: Magma Tower
def magma_roles():
    """The Magma Tower's material key for each role, by LOOK (as blast_roles: 1 worn, 2 the same with brimstone spikes
    and rubble, 3 forged steel); the lava glows hotter on every level (the tower's mark at game size)."""
    if LOOK == 3:
        return dict(iron="forged", top="forged_plates_dark", hoop="forged_dark", stripes="stripes_forged",
                    bronze="forged_dark", head="forged_dark", lava="lava_hot", spike="forged")
    return dict(iron="iron_w", top="iron_dirty", hoop="iron_hoop", stripes="stripes_w", bronze="bronze_w",
                head="bronze_head", lava="lava_hot", spike="brimstone")


def build_magma(M, LN, body):
    MR = magma_roles()
    R = {k: M[v] for k, v in MR.items()}
    RISE = (0.0, 0.25, 0.5)[LOOK - 1]     # each level stands taller than the last (reads as a longer range)
    CHAINS = (125, 245, 5)
    if LOOK > 1:     # the upper levels: spikes round the foot clear of the chains (brimstone, then bigger steel)
        SPIKE = (1.0, 1.3, 1.6)[LOOK - 1]
        if LOOK == 2:
            cl = bmesh.new()
            W.clods(cl, [bear(360 * i / 22 + 9 * (i % 3), 0.74 + 0.16 * ((i * 0.37) % 1.0), 0.04) for i in range(22)],
                    r=0.07)
            add_outline(W.obj("clods", cl, [M["brimstone"]], parent=body, sharp=60), LN["warm"], L.LINE * 0.6)
        st = bmesh.new()
        uv = st.loops.layers.uv.new("UVMap")
        bs = [b for b in range(0, 360, 20) if min(abs((b - c + 180) % 360 - 180) for c in CHAINS) > 24]
        for i, b in enumerate(bs):
            lean = (0.26 + 0.12 * ((i * 0.53) % 1.0)) * (1 + 0.25 * (SPIKE - 1))
            h = (0.32 + 0.14 * ((i * 0.71) % 1.0)) * SPIKE     # out from the foot, so its lava windows show
            W.stake(st, uv, bear(b, 0.76, 0.0), bear(b + (5 if i % 3 else -5), 0.76 + lean, h),
                    0.1 * (1 + 0.3 * (SPIKE - 1)), sides=5 if LOOK == 3 else 8, twist=i * 0.7, tip_mat=1)
        add_outline(W.obj("spikes", st, [R["spike"], R["spike"]], parent=body, sharp=20 if LOOK == 3 else 55), LN["warm"])
    # the foot: a riveted iron ring with lava windows, the striped column, a lava collar in a cage, three chain legs
    foot = W.lathe("foot", [[(0.58, 0.0), (0.6, 0.03), (0.6, 0.3), (0.52, 0.34)], [(0.52, 0.34), (0.0, 0.34)]],
                   [R["iron"], R["top"]], mat_of_seg=[0, 1], wob=0.01, parent=body, sharp=35)
    add_outline(foot, LN["cool"])
    win = bmesh.new()
    for i in range(10):
        b = 360 * i / 10
        n_, t_ = bear(b), bear(b + 90)
        m = Matrix.Translation(bear(b, 0.6, 0.165)) @ Matrix((t_, Vector((0, 0, 1)), n_)).transposed().to_4x4()
        L.rbox(win, (0.27, 0.2, 0.02), m, bevel=0.01)
    L.obj_from_bm("windows_foot", win, [R["lava"]], parent=body)
    bm = bmesh.new()
    for z in (0.035, 0.295):
        pts, nrm = L.ring_of(20, 0.605, z, 0.5)
        W.rivets(bm, pts, nrm, r=0.028)
    W.obj("footrivets", bm, [R["hoop"]], parent=body)
    zc0, zc1 = 0.34, 1.25 + RISE
    col = W.lathe("column", [[(0.44, zc0), (0.44, zc1)]], [R["stripes"]], bev=0, wob=0.012, parent=body, sharp=35)
    add_outline(col, LN["warm"])
    strap("bands", M, LN, body, 0.45, zc0, zc0 + 0.07, 14, rivet_r=0.03, mat=R["hoop"])
    strap("bands2", M, LN, body, 0.45, zc1 - 0.07, zc1, 14, rivet_r=0.03, phase=0.5, mat=R["hoop"])
    for k in range(1, LOOK):     # a strap more round the taller column per level
        zc = zc0 + k * (zc1 - zc0) / LOOK
        strap(f"bands_{k}", M, LN, body, 0.45, zc - 0.035, zc + 0.035, 14, rivet_r=0.03, phase=0.25 * k, mat=R["hoop"])
    cz0, cz1 = zc1, zc1 + 0.36
    cage = W.lathe("collar", [[(0.44, cz0), (0.5, cz0 + 0.02), (0.5, cz1 - 0.02), (0.44, cz1)], [(0.44, cz1), (0.0, cz1)]],
                   [R["lava"], R["top"]], mat_of_seg=[0, 1], bev=0, parent=body)
    bars = bmesh.new()
    for i in range(10):
        L.rbox(bars, (0.06, 0.035, cz1 - cz0), Matrix.Translation(bear(36 * i, 0.515, cz0)) @ Matrix.Rotation(-math.radians(36 * i), 4, 'Z'),
               bevel=0.01)
    for z in (cz0, cz1):
        Q.cyl(bars, 0.545, 0.06, Matrix.Translation((0, 0, z)), segs=48)
    add_outline(W.obj("cagebars", bars, [R["iron"]], parent=body, sharp=35), LN["cool"])
    bm = bmesh.new()
    for z in (cz0, cz1):
        pts, nrm = L.ring_of(10, 0.548, z, 0.5)
        W.rivets(bm, pts, nrm, r=0.03)
    W.obj("cagerivets", bm, [R["hoop"]], parent=body)
    # on top: a raised boss round the neck, riveted straps out to the rim; a clasp strap down the front
    lid = W.lathe("lid", [[(0.5, cz1 + 0.03), (0.26, cz1 + 0.06), (0.22, cz1 + 0.1), (0.0, cz1 + 0.1)]], [R["hoop"]],
                  parent=body, sharp=35)
    add_outline(lid, LN["cool"], L.LINE * 0.6)
    st, rv = bmesh.new(), bmesh.new()
    for i in range(5):
        b = 72 * i + 45
        L.rbox(st, (0.07, 0.3, 0.035), Matrix.Translation(bear(b, 0.38, cz1 + 0.035)) @ Matrix.Rotation(-math.radians(b), 4, 'Z'),
               bevel=0.012)
        W.rivets(rv, [bear(b, 0.3, cz1 + 0.07), bear(b, 0.46, cz1 + 0.07)], [(0, 0, 1)] * 2, r=0.026)
    L.rbox(st, (0.14, 0.05, 0.5), Matrix.Translation(bear(45, 0.53, cz0 - 0.08)) @ Matrix.Rotation(-math.radians(45), 4, 'Z'),
           bevel=0.015)
    L.rbox(st, (0.2, 0.08, 0.12), Matrix.Translation(bear(45, 0.56, cz0 + 0.02)) @ Matrix.Rotation(-math.radians(45), 4, 'Z'),
           bevel=0.02)
    add_outline(W.obj("lidstraps", st, [R["hoop"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    W.obj("lidrivets", rv, [R["iron"]], parent=body)
    if LOOK == 3:     # a crown of short steel spikes round the lid's rim, under the barrel's sweep
        cr = bmesh.new()
        cuv = cr.loops.layers.uv.new("UVMap")
        for i in range(10):
            b = 360 * i / 10 + 18
            W.stake(cr, cuv, bear(b, 0.5, cz1), bear(b, 0.7, cz1 + 0.12), 0.05, sides=5, twist=i * 0.5)
        add_outline(W.obj("crown", cr, [R["spike"]], parent=body, sharp=20), LN["cool"], L.LINE * 0.6)
    # the chain legs: links from hubs on the column's side out and down to round bronze feet
    links, feet, hubs = bmesh.new(), bmesh.new(), bmesh.new()
    for b in CHAINS:
        a, d = bear(b, 0.5, cz0 + 0.1), bear(b, 0.95, 0.0)
        hm = Matrix.Translation(bear(b, 0.55, cz0 + 0.1)) @ Vector((0, 0, 1)).rotation_difference(bear(b)).to_matrix().to_4x4()
        Q.cyl(hubs, 0.12, 0.08, hm, segs=20)
        Q.cyl(hubs, 0.06, 0.12, hm @ Matrix.Translation((0, 0, 0.04)), segs=12)
        path = L.bezier(a, bear(b, 0.9, cz0), bear(b, 1.0, 0.5), d + Vector((0, 0, 0.14)), n=12)
        for i, p in enumerate(path[:-1]):
            q = path[i + 1]
            dv = q - p
            m = Matrix.Translation((p + q) / 2) @ Vector((0, 0, 1)).rotation_difference(dv).to_matrix().to_4x4() @ \
                Matrix.Rotation(math.pi / 2 * (i % 2), 4, 'Z')
            sub = bmesh.new()
            bmesh.ops.create_circle(sub, segments=12, radius=1.0)
            ring = [v.co.copy() for v in sub.verts]
            L.tube(links, [m @ Vector((0.05 * c.x, 0, dv.length * 0.64 * c.y)) for c in ring + ring[:1]],
                   [0.026] * (len(ring) + 1), sides=6, cap=False)
        Q.cyl(feet, 0.16, 0.12, Matrix.Translation(d + Vector((0, 0, 0.06))), segs=24, r2=0.13)
        Q.cyl(feet, 0.175, 0.03, Matrix.Translation(d + Vector((0, 0, 0.015))), segs=24)
        Q.cyl(feet, 0.05, 0.08, Matrix.Translation(d + Vector((0, 0, 0.14))), segs=12)
    add_outline(W.obj("hubs", hubs, [R["bronze"]], parent=body, sharp=35), LN["warm"])
    ch = W.obj("chains", links, [R["bronze"]], parent=body, sharp=60)
    add_outline(ch, LN["cool"], L.LINE * 0.7)
    add_outline(W.obj("feet", feet, [R["bronze"]], parent=body, sharp=35), LN["warm"])
    top = cz1 + 0.05
    # the head: a squat cast bronze nozzle on a short neck, a strap round it, its mouth forward
    tur = L.empty("TURRET", loc=(0, 0, top + 0.004))
    bm = bmesh.new()
    Q.cyl(bm, 0.14, 0.14, Matrix.Translation((0, 0, 0.07)), segs=24)
    add_outline(W.obj("neck_h", bm, [R["iron"]], parent=tur, sharp=35), LN["cool"])
    bm = bmesh.new()
    L.rbox(bm, (0.36, 0.42, 0.26), Matrix.Translation((0, -0.06, 0.12)), bevel=0.1)
    hd = W.obj("head", bm, [R["head"]], parent=tur, sharp=35)
    W.wobble(hd, 0.012, 4.0, 9.0, radial=False)
    W.finish(hd)
    add_outline(hd, LN["warm"])
    bm = bmesh.new()
    L.rbox(bm, (0.4, 0.07, 0.3), Matrix.Translation((0, -0.12, 0.1)), bevel=0.02)
    W.bolts(bm, [(sx * 0.2, -0.12, 0.25) for sx in (-1, 1)], [(sx, 0, 0) for sx in (-1, 1)], r=0.03, washer=False)
    add_outline(W.obj("headstrap", bm, [R["hoop"]], parent=tur, sharp=35), LN["cool"], L.LINE * 0.6)
    HZ = 0.25
    bar = ridged_barrel("barrel", tur, M, 0.1, 0.56, 0.1, HZ, (0.5,), mat=MR["head"], mouth=1.35)
    W.finish(bar)
    add_outline(bar, LN["warm"])
    L.empty("muzzle_base", parent=tur, loc=(0, 0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, 0.56, HZ))
    return tur, top, ("column", "collar", "cagebars")


def build():
    L.clear_scene()
    M = common()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = L.empty("BODY")
    tur, top, _ = {1: build_blast, 2: build_sharp, 3: build_magma}[TIER](M, LN, body)
    return body, tur, top


SOLID = {1: ("skirt", "drum", "glowcap", "collar", "rope", "capbolts", "crown"), 2: ("post", "coil", "posts", "socket"), 3: ("column", "collar", "cagebars", "crown")}
Q.run("inferno", build, TIER if LOOK == 1 else f"{TIER}-look{LOOK}", HERE, turret_canvas=(400, 360, 200, 200), args=ARGS[1:], solid=SOLID[TIER])
