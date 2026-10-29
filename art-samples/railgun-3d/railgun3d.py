"""railgun3d.py : the Railgun, tiers 1-3, as a 3D model in the game's camera (buildings-3d, 28 Oct 2026), modelled on the
painted tiers (server/public/assets/buildings/railguntower/top.tN@2x.webp, codex-art R2-A / TALL2 / TALL3).

  blender -b --factory-startup -P railgun3d.py -- T body | turret [h ...] | full H | aim | clash | save

(see ../tower-3d/square3d.py for the modes). The body: a low square pyramid, corner at the viewer, striped (red and
white; tier 3 black and yellow), in one, two or three steps, an angle bracket up each corner of every step, a steel drum
on top with a dark turntable. The turret is the Flash Railgun's horseshoe magnet (owner, 29 Oct: the 3D one had lost
it): a thick U lying flat, its round back at the pivot, steel (tier 2 and 3 gold) pole pieces on its arms' ends, a coil
stack with a blue glass cap on each arm, a square rail out of each pole held level (the one fixed tilt: owner, 28 Oct,
the game works out the shot) with blue glowing cells along it and its stub out of the U's back, and a blue-nosed slug
in the slot between the arms. Tier 1 red and steel, tier 2 red and gold, tier 3 black and gold.
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
TOP = {1: 0.42, 2: 0.57, 3: 1.05}[TIER]     # the turntable's height (the painted turret discs sit right on the body)
DRUM_H = 0.08
DRUM_R = {1: 0.52, 2: 0.52, 3: 0.47}[TIER]
BASE = {1: 1.0, 2: 1.0, 3: 0.82}[TIER]      # the foot's half diagonal: the painted tier 3 is narrower and taller
D_TOP = {1: 0.62, 2: 0.62, 3: 0.42}[TIER]    # the pyramid's half diagonal under the drum
STEP_IN = {1: -0.05, 2: -0.05, 3: 0.05}[TIER]   # each step's foot this far in from the one below's top (< 0: out)
TURRET_SCALE = float(os.environ.get("RAILGUN_TSCALE", 1.0))


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
        magnet=met("magnet", "pblack" if black else "red", spec=0.9, polish=0.5 if black else None, wear=0.3),
        pole=met("pole", "rail" if TIER == 1 else "gold", spec=1.0, env=L.ENV_TURNED),
        trim=met("trim", "steel" if TIER == 1 else "gold", spec=1.0),
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
    drop = (BASE - D_TOP - STEP_IN * (STEPS - 1)) / STEPS   # each step narrows by this
    f0 = BASE
    for s in range(STEPS):
        z0, z1 = s * hs, (s + 1) * hs
        f1 = f0 - drop                                   # the step's top (its foot is f0)
        frustum(stripes, f0, f1, z0, z1)
        if s < STEPS - 1:                                # the ledge the next step stands on
            lip = f1 + max(0.03, 0.02 - STEP_IN)
            frustum(ledges, lip, lip, z1 - 0.02, z1 + 0.03, bevel=0.012)
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
        f0 = f1 - STEP_IN
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

    # ---- the turret, built facing +Y (bearing 0) and turned about z by -heading. The Flash Railgun's turret IS a
    # horseshoe magnet lying flat (anim.3.loaded.png): a thick red U, its round back at the pivot and its two arms
    # forward with a slot between them, steel pole pieces on the arms' ends, a coil standing on each arm, a rail run
    # forward out of each pole, the rails poking out of the back too, and a blue-tipped slug lying in the slot.
    tur = L.empty("TURRET", loc=(0, 0, TOP + 0.004))   # a hair above the turntable: no touching faces
    tur.scale = (TURRET_SCALE,) * 3
    MR, MI, MH = 0.45, 0.14, 0.31   # the U's outer and inner radius, its height
    ARM = 0.34                      # the arms' red part reaches this far forward of the pivot
    POLE = 0.15                     # the pole pieces' length
    AX = (MR + MI) / 2              # an arm's middle (the coils and rails stand on it)
    bm = bmesh.new()
    n = 24
    out = [(MR * math.cos(-math.pi * i / n), MR * math.sin(-math.pi * i / n)) for i in range(n + 1)]       # +x round the back
    inn = [(MI * math.cos(-math.pi * i / n), MI * math.sin(-math.pi * i / n)) for i in range(n + 1)][::-1]  # -x round to +x
    outline = out + [(-MR, ARM), (-MI, ARM)] + inn + [(MI, ARM), (MR, ARM)]
    face = bm.faces.new([bm.verts.new((x, y, 0.0)) for x, y in outline])
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, MH), verts=[v for v in ext["geom"] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.edges.ensure_lookup_table()
    sharp_edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle(0) > math.radians(30)]
    bmesh.ops.bevel(bm, geom=sharp_edges, offset=0.03, segments=3, affect='EDGES', profile=0.5, clamp_overlap=True)
    add_outline(obj_from_bm("magnet", bm, [M["magnet"]], parent=tur, sharp=35), LN["warm"])
    # the trim band round the U's foot
    T0, T1, TO = 0.0, 0.045, 0.014
    bm = bmesh.new()
    pts = [((MR + TO) * math.cos(-math.pi * i / n), (MR + TO) * math.sin(-math.pi * i / n)) for i in range(n + 1)]
    pts = [(MR + TO, ARM - 0.01)] + pts + [(-MR - TO, ARM - 0.01)]
    lo = [bm.verts.new((x, y, T0)) for x, y in pts]
    hi = [bm.verts.new((x, y, T1)) for x, y in pts]
    for i in range(len(pts) - 1):
        bm.faces.new((lo[i + 1], lo[i], hi[i], hi[i + 1]))
    trim = obj_from_bm("magnet_trim", bm, [M["trim"]], parent=tur, sharp=35)
    add_outline(trim, LN["warm"], L.LINE * 0.6)
    # rivets along the U's round back, and across the arms' tops
    bm = bmesh.new()
    for z in (0.08, MH - 0.07):
        k = 11
        cc = [(MR * math.cos(-math.pi * (i + 0.5) / k), MR * math.sin(-math.pi * (i + 0.5) / k), z) for i in range(k)]
        nn = [(math.cos(-math.pi * (i + 0.5) / k), math.sin(-math.pi * (i + 0.5) / k), 0) for i in range(k)]
        studs(bm, cc, nn, r=0.017)
    obj_from_bm("rivets_turret", bm, [M["rivet"]], parent=tur)
    # the pole pieces: a block over each arm's end, a little proud of the arm all round
    for sx in (-1, 1):
        bm = bmesh.new()
        rbox(bm, (MR - MI + 0.03, POLE, MH + 0.008), Matrix.Translation((sx * AX, ARM + POLE / 2 - 0.01, 0.002)), bevel=0.025)
        add_outline(obj_from_bm(f"pole_{'lr'[sx > 0]}", bm, [M["pole"]], parent=tur, sharp=35), LN["cool"])
    # the coil stacks, one on each arm
    for sx in (-1, 1):
        prof = []
        z = MH
        for i, r in enumerate((0.14, 0.13, 0.12, 0.105, 0.09)):
            prof += [(r - 0.02, z), (r, z + 0.008), (r, z + 0.035), (r - 0.02, z + 0.043)]
            z += 0.046
        coil = lathe(f"coil_{'lr'[sx > 0]}", [[(0.0, MH), (0.12, MH)], prof, [(0.06, z), (0.0, z)]], [M["coil"]],
                     parent=tur, sharp=35)
        coil.location = (sx * AX, -0.01, 0.0)
        add_outline(coil, LN["warm"], L.LINE * 0.8)
        bm = bmesh.new()
        Q.ball(bm, (0, 0, z + 0.04), 0.06, segs=16)
        lamp = obj_from_bm(f"lens_coil_{'lr'[sx > 0]}", bm, [M["glass"]], parent=tur)
        lamp.location = coil.location
        bm = bmesh.new()
        Q.ball(bm, (0, 0, z + 0.11), 0.028, segs=10)
        knob = obj_from_bm(f"knob_{'lr'[sx > 0]}", bm, [M["coil"]], parent=tur)
        knob.location = coil.location
        add_outline(knob, LN["warm"], L.LINE * 0.6)
    # the rails: a square bar out of each pole's face, along the arm's middle, high on the pole, gold bands, a blue
    # cell along the inside of each, blue tips; round stubs of them out of the U's back
    LR = 1.17                       # from the pivot to the tips
    RW = 0.13
    RZ = 0.275                      # the rails' middle height (as the old rails': the cells keep their size)
    R0 = ARM + 0.04                 # the rails' back ends, inside the poles
    for sx in (-1, 1):
        x = sx * AX
        bm = bmesh.new()
        rbox(bm, (RW, LR - R0, RW), Matrix.Translation((x, (LR + R0) / 2, RZ - RW / 2)), bevel=0.025)
        add_outline(obj_from_bm(f"rail_{'lr'[sx > 0]}", bm, [M["rail"]], parent=tur, sharp=35), LN["cool"])
        bm = bmesh.new()
        for y0, ln in ((ARM + POLE + 0.18, 0.06), (LR - 0.1, 0.08)):
            rbox(bm, (RW + 0.02, ln, RW + 0.02), Matrix.Translation((x, y0 + ln / 2, RZ - RW / 2 - 0.01)), bevel=0.015)
        add_outline(obj_from_bm(f"rail_bands_{'lr'[sx > 0]}", bm, [M["band"]], parent=tur, sharp=35), LN["warm"], L.LINE * 0.7)
        bm = bmesh.new()
        c0, c1 = ARM + POLE + 0.02, LR - 0.14
        rbox(bm, (0.03, c1 - c0, 0.06), Matrix.Translation((x - sx * (RW / 2 + 0.005), (c0 + c1) / 2, RZ - 0.03)), bevel=0.012)
        rbox(bm, (0.04, (c1 - c0) * 0.98, 0.035), Matrix.Translation((x - sx * 0.02, (c0 + c1) / 2, RZ + RW / 2 - 0.015)), bevel=0.012)
        rbox(bm, (0.09, 0.03, 0.09), Matrix.Translation((x, LR + 0.005, RZ - 0.045)), bevel=0.014)
        obj_from_bm(f"lens_cell_{'lr'[sx > 0]}", bm, [M["glass"]], parent=tur, sharp=35)
        bm = bmesh.new()
        y_back = -math.sqrt(MR * MR - x * x)
        cyl(bm, 0.05, 0.3, Matrix.Translation((x, y_back - 0.1, RZ - 0.04)) @ Matrix.Rotation(math.pi / 2, 4, 'X'), segs=16)
        add_outline(obj_from_bm(f"stub_{'lr'[sx > 0]}", bm, [M["pole"]], parent=tur, sharp=35), LN["cool"])
    # the slug lying in the slot: a steel bolt, its nose blue glass, and the charge's glow at the slot's mouth
    bm = bmesh.new()
    SZ = MH * 0.55
    cyl(bm, 0.075, 0.36, Matrix.Translation((0, 0.12, SZ)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=20)
    add_outline(obj_from_bm("slug", bm, [M["pole"]], parent=tur, sharp=35), LN["cool"], L.LINE * 0.7)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.075,
                              matrix=Matrix.Translation((0, 0.30, SZ)) @ L.diag(1, 1.9, 1))
    obj_from_bm("lens_charge", bm, [M["glass"]], parent=tur)
    bm = bmesh.new()
    Q.ball(bm, (0, ARM + 0.06, SZ), 0.12, segs=16)
    obj_from_bm("charge_glow", bm, [M["halo"]], parent=tur)
    L.empty("muzzle_base", parent=tur, loc=(0, 0.0, RZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, LR + 0.02, RZ))
    return body, tur, TOP


Q.run("railgun", build, TIER, HERE, turret_canvas=(520, 520, 260, 260), args=ARGS[1:],
      solid=("brackets", "drum", "stripes", "ledges"))
