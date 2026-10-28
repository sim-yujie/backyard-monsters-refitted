"""railgun3d.py : the Railgun, tiers 1-3, as a 3D model in the game's camera (buildings-3d, 28 Oct 2026), modelled on the
painted tiers (server/public/assets/buildings/railguntower/top.tN@2x.webp, codex-art R2-A / TALL2 / TALL3).

  blender -b --factory-startup -P railgun3d.py -- T body | turret [h ...] | full H | aim | clash | save

(see ../tower-3d/square3d.py for the modes). The body: a low square pyramid, corner at the viewer, striped (red and
white; tier 3 black and yellow), in one, two or three steps, an angle bracket up each corner of every step, a steel drum
on top with a dark turntable. The turret: a red disc with a counterweight out of its back, two coil stacks with blue
glass caps, and two square rails held level (the one fixed tilt: owner, 28 Oct, the game works out the shot) with blue
glowing cells along them and a blue charge between them. Tier 1 steel and red, tier 2 gold and red, tier 3 black and gold.
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
L.EL = float(os.environ.get("RAILGUN_EL", 30.0))
import square3d as Q  # noqa: E402
from look3d import add_outline, lathe, mat_flat, obj_from_bm, rbox, srgb, studs  # noqa: E402
from square3d import cyl, frustum, face_frame, lean_of  # noqa: E402

L.METALS.update(
    red=((84, 6, 8), (204, 30, 28), (250, 120, 104), (1.0, 0.85, 0.8, 1)),            # the turret's painted red
    pblack=((8, 6, 10), (34, 30, 38), (80, 76, 96), (0.8, 0.86, 1.0, 1)),
    rail=((50, 54, 66), (150, 156, 172), (222, 228, 240), (0.95, 0.97, 1.0, 1)),       # the rails' bright steel
)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
STEPS = TIER                                # the pyramid's steps
TOP = {1: 0.47, 2: 0.62, 3: 1.1}[TIER]      # the turntable's height (fitted to the painted drum tops)
DRUM_H = 0.13
DRUM_R = 0.52
D_TOP = {1: 0.62, 2: 0.62, 3: 0.58}[TIER]   # the pyramid's half diagonal under the drum
TURRET_SCALE = float(os.environ.get("RAILGUN_TSCALE", 1.12))


def materials():
    met = L.mat_metal
    gold, black = TIER == 2, TIER == 3
    return dict(
        stripes=Q.mat_chevrons("stripes", *(((224, 24, 26), (240, 238, 240)) if TIER < 3 else ((26, 24, 28), (246, 190, 28))),
                               period=0.3, k=1.0),
        bracket=met("bracket", "steel" if TIER == 1 else "gold" if gold else "pblack", spec=1.0, polish=0.5 if black else None),
        ledge=met("ledge", "steel" if TIER == 1 else "gold", spec=1.0),
        drum=met("drum", "steel" if TIER == 1 else "gold", spec=1.0),
        disc=met("disc", "gunmetal", spec=0.5, spec_rough=0.3, polish=0),
        rivet=met("rivet", "steel" if TIER == 1 else "gold", spec=1.0, wear=0),
        red=met("red", "red", spec=0.9, wear=0.3),
        tdisc=met("tdisc", "red" if TIER == 1 else "gold" if gold else "pblack", spec=0.9, polish=0.5 if black else None),
        trim=met("trim", "steel" if TIER == 1 else "gold", spec=1.0),
        weight=met("weight", "steel", spec=0.9, env=L.ENV_TURNED),
        coil=met("coil", "gold", spec=1.0),
        rail=met("rail", "rail" if TIER < 3 else "pblack", spec=0.9, polish=0.5 if black else None),
        band=met("band", "gold", spec=1.0),
        glass=L.mat_glass_lamp("glass", core=(224, 252, 255), mid=(60, 200, 255), rim=(10, 90, 200)),
        halo=L.mat_halo("halo_blue", (60, 190, 255), strength=0.45),
        bore=mat_flat("bore", (24, 22, 26), spec=0.1),
    )


def build():
    L.clear_scene()
    M = materials()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = L.empty("BODY")

    # ---- the stepped pyramid: each step a striped slope from its foot to its top, a ledge between steps
    base_top = TOP - DRUM_H
    stripes, ledges, brackets, rivets = (bmesh.new() for _ in range(4))
    hs = base_top / STEPS
    drop = (1.0 - D_TOP + 0.05 * (STEPS - 1)) / STEPS   # each step narrows by this; the next stands 0.05 out on its ledge
    f0 = 1.0
    for s in range(STEPS):
        z0, z1 = s * hs, (s + 1) * hs
        f1 = f0 - drop                                   # the step's top (its foot is f0)
        frustum(stripes, f0, f1, z0, z1)
        if s < STEPS - 1:                                # the ledge the next step stands on
            frustum(ledges, f1 + 0.07, f1 + 0.07, z1 - 0.02, z1 + 0.03, bevel=0.012)
        # a bracket up each corner: a riveted wedge that wraps the corner, steeper than the slope, its top proud of it
        for k in range(4):
            b = Q.FRONT + 90 * k
            m = Matrix.Translation(Q.bear(b, 0, 0)) @ Matrix.Rotation(-math.radians(b), 4, 'Z')   # y out of the corner
            zt = z1 + 0.06
            ft = f1 + 0.06
            pts = [Vector((x, y, z)) for x in (-0.1, 0.1) for (y, z) in
                   ((f0 + 0.05, z0), (f0 - 0.3, z0), (ft - 0.14, zt), (ft + 0.02, zt - 0.03))]
            sub = bmesh.new()
            for v in pts:
                sub.verts.new(v)
            bmesh.ops.convex_hull(sub, input=sub.verts)
            bmesh.ops.bevel(sub, geom=list(sub.edges), offset=0.018, segments=2, affect='EDGES', profile=0.5,
                            clamp_overlap=True)
            L.add_mesh(brackets, sub, m)
            out = Vector((0, 1, (f0 - ft + 0.07) / (zt - z0 + 0.03))).normalized()   # roughly the wedge's outer face
            for t_ in (0.3, 0.7):
                y = f0 + 0.05 + (ft + 0.02 - f0 - 0.05) * t_
                z = z0 + (zt - 0.03 - z0) * t_
                studs(rivets, [m @ Vector((x, y + 0.012, z)) for x in (-0.05, 0.05)], [m.to_3x3() @ out] * 2, r=0.022)
        f0 = f1 + 0.05
    add_outline(obj_from_bm("stripes", stripes, [M["stripes"]], parent=body, sharp=35), LN["warm"])
    if STEPS > 1:
        add_outline(obj_from_bm("ledges", ledges, [M["ledge"]], parent=body, sharp=35), LN["warm"], L.LINE * 0.8)
    add_outline(obj_from_bm("brackets", brackets, [M["bracket"]], parent=body, sharp=35), LN["cool"])
    # ---- the drum and its turntable
    drum = lathe("drum", [[(DRUM_R, base_top - 0.02), (DRUM_R + 0.02, base_top), (DRUM_R + 0.02, TOP - 0.02), (DRUM_R, TOP)],
                          [(DRUM_R, TOP), (DRUM_R - 0.06, TOP), (DRUM_R - 0.07, TOP - 0.01)],
                          [(DRUM_R - 0.07, TOP - 0.012), (0.0, TOP - 0.012)]],
                 [M["drum"], M["disc"]], mat_of_seg=[0, 0, 1], parent=body)
    add_outline(drum, LN["cool"])
    cc, nn = L.ring_of(24, DRUM_R + 0.02, base_top + DRUM_H * 0.5, 0.5)
    studs(rivets, cc, nn, r=0.02)
    cc, nn = L.ring_of(16, DRUM_R - 0.035, TOP + 0.002, 0.5)
    studs(rivets, cc, [Vector((0, 0, 1))] * 16, r=0.018)
    obj_from_bm("rivets_body", rivets, [M["rivet"]], parent=body)

    # ---- the turret, built facing +Y (bearing 0) and turned about z by -heading
    tur = L.empty("TURRET", loc=(0, 0, TOP))
    tur.scale = (TURRET_SCALE,) * 3
    td = lathe("tdisc", [[(0.48, 0.0), (0.5, 0.015), (0.5, 0.09), (0.48, 0.105)], [(0.48, 0.105), (0.0, 0.105)]],
               [M["tdisc"]], parent=tur, sharp=35)
    add_outline(td, LN["warm"])
    bm = bmesh.new()
    cc, nn = L.ring_of(16, 0.502, 0.055, 0.5)
    studs(bm, cc, nn, r=0.018)
    obj_from_bm("rivets_turret", bm, [M["rivet"] if TIER < 3 else M["band"]], parent=tur)
    trim = lathe("tdisc_rim", [L.band(0.495, 0.51, 0.0, 0.03)], [M["trim"]], parent=tur, sharp=35)
    add_outline(trim, LN["warm"], L.LINE * 0.6)
    # the cradle: a red block on the disc the rails sit in, the counterweight out of its back
    bm = bmesh.new()
    rbox(bm, (0.44, 0.5, 0.12), Matrix.Translation((0, -0.02, 0.1)), bevel=0.04)
    add_outline(obj_from_bm("cradle", bm, [M["red"] if TIER < 3 else M["tdisc"]], parent=tur, sharp=35), LN["warm"])
    w = lathe("weight", [[(0.0, -0.75), (0.1, -0.75), (0.115, -0.73)], [(0.115, -0.73), (0.115, -0.2)]],
              [M["weight"]], parent=tur, sharp=35)
    w.matrix_basis = Matrix.Translation((0, 0, 0.17)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')   # lathe z -> +Y: out the back
    add_outline(w, LN["cool"])
    # the coil stacks, either side of the cradle
    for sx in (-1, 1):
        prof = []
        z = 0.22
        for i, r in enumerate((0.13, 0.12, 0.11, 0.1, 0.085)):
            prof += [(r - 0.02, z), (r, z + 0.008), (r, z + 0.035), (r - 0.02, z + 0.043)]
            z += 0.046
        coil = lathe(f"coil_{'lr'[sx > 0]}", [[(0.0, 0.2), (0.11, 0.2)], prof, [(0.06, z), (0.0, z)]], [M["coil"]],
                     parent=tur, sharp=35)
        coil.location = (sx * 0.27, -0.1, 0.0)
        add_outline(coil, LN["warm"], L.LINE * 0.8)
        bm = bmesh.new()
        Q.ball(bm, (0, 0, z + 0.04), 0.055, segs=16)
        lamp = obj_from_bm(f"lens_coil_{'lr'[sx > 0]}", bm, [M["glass"]], parent=tur)
        lamp.location = coil.location
        bm = bmesh.new()
        Q.ball(bm, (0, 0, z + 0.1), 0.025, segs=10)
        add_outline(obj_from_bm(f"knob_{'lr'[sx > 0]}", bm, [M["coil"]], parent=tur), LN["warm"], L.LINE * 0.6)
        bpy.data.objects[f"knob_{'lr'[sx > 0]}"].location = coil.location
        cyl_post = bmesh.new()
        cyl(cyl_post, 0.1, 0.12, Matrix.Translation((0, 0, 0.16)), segs=20)
        p = obj_from_bm(f"coil_foot_{'lr'[sx > 0]}", cyl_post, [M["red"] if TIER < 3 else M["tdisc"]], parent=tur, sharp=35)
        p.location = coil.location
        add_outline(p, LN["warm"], L.LINE * 0.7)
    # the rails: two square bars, level, gold bands, a blue cell along the top of each, blue tips
    LR = 1.0                       # from the pivot to the tips
    RZ = 0.22                        # the rails' middle height
    for sx in (-1, 1):
        bm = bmesh.new()
        rbox(bm, (0.15, LR + 0.2, 0.15), Matrix.Translation((sx * 0.14, (LR - 0.2) / 2, RZ - 0.075)), bevel=0.025)
        add_outline(obj_from_bm(f"rail_{'lr'[sx > 0]}", bm, [M["rail"]], parent=tur, sharp=35), LN["cool"])
        bm = bmesh.new()
        for y0, ln in ((0.12, 0.08), (LR - 0.1, 0.1)):
            rbox(bm, (0.17, ln, 0.17), Matrix.Translation((sx * 0.14, y0 + ln / 2, RZ - 0.085)), bevel=0.02)
        add_outline(obj_from_bm(f"rail_bands_{'lr'[sx > 0]}", bm, [M["band"]], parent=tur, sharp=35), LN["warm"], L.LINE * 0.7)
        bm = bmesh.new()
        rbox(bm, (0.07, LR - 0.36, 0.05), Matrix.Translation((sx * 0.12, 0.21 + (LR - 0.36) / 2, RZ + 0.06)), bevel=0.02)
        rbox(bm, (0.09, 0.04, 0.09), Matrix.Translation((sx * 0.14, LR + 0.0, RZ - 0.045)), bevel=0.015)
        obj_from_bm(f"lens_cell_{'lr'[sx > 0]}", bm, [M["glass"]], parent=tur, sharp=35)
    # the charge between the rails: a blue drop of light, its point forward
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.05,
                              matrix=Matrix.Translation((0, 0.42, RZ)) @ L.diag(1, 2.0, 1))
    obj_from_bm("lens_charge", bm, [M["glass"]], parent=tur)
    bm = bmesh.new()
    Q.ball(bm, (0, 0.42, RZ), 0.1, segs=16)
    obj_from_bm("charge_glow", bm, [M["halo"]], parent=tur)
    L.empty("muzzle_base", parent=tur, loc=(0, 0.0, RZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, LR + 0.02, RZ))
    return body, tur, TOP


Q.run("railgun", build, TIER, HERE, turret_canvas=(520, 520, 260, 260), args=ARGS[1:],
      solid=("brackets", "drum", "stripes", "ledges"))
