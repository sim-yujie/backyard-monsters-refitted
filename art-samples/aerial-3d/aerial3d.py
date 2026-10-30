"""aerial3d.py : the Aerial Defense Tower, tiers 1-3, as a 3D model in the game's camera (buildings-3d, 28 Oct 2026),
modelled on the painted tiers (server/public/assets/buildings/flaktower/top.tN@2x.webp, codex-art R2-A / TALL2 / TALL3).

  blender -b --factory-startup -P aerial3d.py -- T body | turret [h ...] | full H | aim | clash | save

(see ../tower-3d/square3d.py for the modes). The body: a stepped square block, corner at the viewer, its sides striped
(red and white; tier 3 black and yellow) and perforated, a pale steel lid with a dark turntable, a hatch on the front-left
face, a winch on the front-right face, a battery with two cables at the back-left. The turret: an armoured faceted dome
on a ring of lugs, two long guns raised at one fixed angle (TILT; owner, 28 Oct: the game works out the shot's path).
Tier 1 steel and tan, tier 2 gold, tier 3 black and gold.
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
L.EL = float(os.environ.get("AERIAL_EL", 30.0))
import square3d as Q  # noqa: E402
from look3d import add_outline, lathe, mat_flat, obj_from_bm, rbox, srgb, studs  # noqa: E402
from square3d import ball, cyl, frustum, face_frame, holes, lean_of  # noqa: E402

L.METALS.update(
    tan=((70, 46, 22), (166, 128, 76), (222, 192, 136), (1.0, 0.93, 0.72, 1)),       # tier 1's dome (painted khaki brass)
    lid=((70, 84, 100), (170, 190, 206), (232, 242, 250), (0.95, 0.98, 1.0, 1)),      # tier 1's pale blue steel lid
    copper=((66, 26, 10), (170, 86, 42), (232, 156, 100), (1.0, 0.8, 0.6, 1)),
    brown=((34, 20, 12), (92, 62, 42), (150, 112, 82), (1.0, 0.9, 0.75, 1)),          # the dome's ring
    pblack=((8, 6, 10), (34, 30, 38), (80, 76, 96), (0.8, 0.86, 1.0, 1)),
)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
TILT = float(os.environ.get("AERIAL_TILT", 38.0))   # the guns' one raise, degrees (as painted)

# The sections from the ground up: (kind, height); kinds: plinth, stripes, ledge, perf, lid. Half diagonals narrow
# from D0 at the ground to D1 under the lid, as the painted block steps in.
SECTIONS = {1: [("plinth", 0.07), ("stripes", 0.25), ("ledge", 0.04), ("perf", 0.21), ("lid", 0.08)],
            2: [("plinth", 0.07), ("stripes", 0.21), ("ledge", 0.05), ("stripes", 0.2), ("ledge", 0.04), ("perf", 0.17),
                ("lid", 0.08)],
            3: [("plinth", 0.08), ("stripes", 0.26), ("ledge", 0.05), ("perf", 0.2), ("ledge", 0.05), ("stripes", 0.25),
                ("ledge", 0.05), ("perf", 0.2), ("lid", 0.09)]}[TIER]
D0, D1 = 0.97, {1: 0.70, 2: 0.68, 3: 0.66}[TIER]
TOP = sum(h for _, h in SECTIONS)
DISC_R = 0.44
DOME_N = 8                      # the dome's panels round
TURRET_SCALE = float(os.environ.get("AERIAL_TSCALE", 0.82))


def materials():
    met = L.mat_metal
    gold, black = TIER == 2, TIER == 3
    frame = met("frame", "gold" if gold else "black" if black else "steel", spec=1.0)
    trim = met("trim", "steel" if TIER == 1 else "gold", spec=1.0)
    return dict(
        frame=frame, trim=trim,
        perf=met("perf", "gold" if gold else "pblack" if black else "steel", spec=0.9, polish=0.4 if black else None),
        lid=met("lid", "lid" if TIER == 1 else "gold" if gold else "pblack", spec=0.9, polish=0.4 if black else None),
        stripes=Q.mat_chevrons("stripes", *(((224, 24, 26), (240, 238, 240)) if TIER < 3 else ((26, 24, 28), (246, 190, 28))), period=0.27, k=0.9),
        disc=met("disc", "gunmetal", spec=0.6, spec_rough=0.3),
        rim=met("rim", "steel" if TIER == 1 else "gold", spec=1.0),
        ball=met("ball", "gold", spec=1.0, wear=0),
        rivet=met("rivet", "steel" if TIER == 1 else "gold", spec=1.0, wear=0),
        hatch=met("hatch", "gold" if gold else "steel", spec=0.8),
        copper=met("copper", "copper", spec=0.9),
        winch=met("winch", "copper" if TIER == 1 else "gold", spec=0.9),
        dark=met("dark", "gunmetal", spec=0.4, spec_rough=0.3, polish=0),
        bore=mat_flat("bore", (24, 22, 26), spec=0.1),
        slot=mat_flat("slot", (54, 50, 58), spec=0.3, spec_rough=0.3),
        red=mat_flat("red", (214, 34, 30), spec=0.6, spec_rough=0.25),
        blue=mat_flat("blue", (40, 110, 236), spec=0.6, spec_rough=0.25),
        dome=met("dome", "tan" if TIER == 1 else "gold" if gold else "pblack", spec=1.0, polish=0.5 if black else None),
        ring=met("ring", "brown" if TIER < 3 else "gold", spec=0.8),
        lug=met("lug", "tan" if TIER == 1 else "brown" if gold else "pblack", spec=0.8),
        seam=mat_flat("seam", (52, 34, 18) if TIER < 3 else (226, 150, 20), spec=0.1),
        barrel=met("barrel", "gunmetal" if TIER < 3 else "pblack", spec=0.5, wear=0.2, polish=0, sheen=0.12),
        band=met("band", "copper" if TIER == 1 else "gold", spec=1.0),
        muzzle=met("muzzle", "gunmetal" if TIER == 1 else "gold", spec=1.0, env=L.ENV_TURNED),
        ear=met("ear", "copper" if TIER < 3 else "gold", spec=1.0),
        ear_red=mat_flat("ear_red", (196, 52, 30), spec=0.5, spec_rough=0.25),
    )


def faceted_dome(name, mats, parent, rings, n, apex):
    """An armoured dome of flat panels: rings of n points [(r, z)], each ring turned half a panel from the one below, so
    the panels interlock; a flat cap on top at height apex."""
    bm = bmesh.new()
    vs = []
    for i, (r, z) in enumerate(rings):
        ph = 0.5 * (i % 2)
        vs.append([bm.verts.new((r * math.cos(2 * math.pi * (j + ph) / n), r * math.sin(2 * math.pi * (j + ph) / n), z))
                   for j in range(n)])
    bm.faces.new(list(reversed(vs[0])))
    for i in range(len(vs) - 1):
        a, b = vs[i], vs[i + 1]
        for j in range(n):
            if i % 2 == 0:      # b[j] lies between a[j] and a[j+1]
                bm.faces.new((a[j], a[(j + 1) % n], b[j]))
                bm.faces.new((b[j], a[(j + 1) % n], b[(j + 1) % n]))
            else:               # a[j] lies between b[j-1] and b[j]
                bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n]))
                bm.faces.new((a[j], b[(j + 1) % n], b[j]))
    cap = [bm.verts.new((v.co.x * 0.0, v.co.y * 0.0, apex)) for v in vs[-1][:1]][0]
    last = vs[-1]
    for j in range(n):
        bm.faces.new((last[j], last[(j + 1) % n], cap))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm, mats, parent=parent, sharp=12)


def build():
    sc = bpy.context.scene
    L.clear_scene()
    M = materials()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = L.empty("BODY")

    # ---- the stepped block
    parts = {k: bmesh.new() for k in ("frame", "stripes", "perf", "lid", "holes", "balls", "rivets", "trim")}
    z = 0.0
    taper = TOP - SECTIONS[0][1] - SECTIONS[-1][1]
    zt0 = SECTIONS[0][1]

    def d_at(zz):
        return D0 + (D1 - D0) * min(max((zz - zt0) / taper, 0), 1)

    for kind, h in SECTIONS:
        z0, z1 = z, z + h
        if kind == "plinth":
            frustum(parts["frame"], 1.0, 1.0, z0, z1, bevel=0.02)
            frustum(parts["frame"], 1.0, 0.98, z1 - 0.01, z1 + 0.01, bevel=0.005)
        elif kind == "stripes":
            frustum(parts["stripes"], d_at(z0), d_at(z1), z0, z1)
        elif kind == "ledge":
            frustum(parts["frame"], d_at(z0) + 0.04, d_at(z1) + 0.04, z0, z1, bevel=0.015)
            if TIER > 1:     # gold balls at the ledges' corners we see, as painted
                for c in Q.corners(d_at(z0) + 0.05, (z0 + z1) / 2)[:2] + Q.corners(d_at(z0) + 0.05, (z0 + z1) / 2)[3:]:
                    ball(parts["balls"], c, 0.04)
        elif kind == "perf":
            frustum(parts["perf"], d_at(z0), d_at(z1), z0, z1, bevel=0.01)
            holes(parts["holes"], d_at(z0), d_at(z1), z0, z1, rows=2, cols=11, r=0.022)
            if TIER > 1:     # trim strips along the perforated band's top and bottom edges
                frustum(parts["trim"], d_at(z0) + 0.012, d_at(z0 + 0.025) + 0.012, z0, z0 + 0.025)
                frustum(parts["trim"], d_at(z1 - 0.025) + 0.012, d_at(z1) + 0.012, z1 - 0.025, z1)
        elif kind == "lid":
            frustum(parts["lid"], D1 + 0.04, D1 + 0.04, z0, z1, bevel=0.025)
            for c in Q.corners(D1 + 0.02, z1 + 0.01):
                ball(parts["balls"], c, 0.05)
            # the lid's rivets along the edges we see
            for nb in Q.SEEN:
                for u in (-0.3, 0.0, 0.3):
                    f = face_frame(nb, z0 + h / 2, D1 + 0.05, u=u, out=0.003)
                    studs(parts["rivets"], [f.translation], [Q.bear(nb)], r=0.018)
        z = z1

    # corner posts up the stripes on tiers 2-3 (the painted gold corner edges)
    if TIER > 1:
        post = parts["trim"]
        for kind, (z0, z1) in [(k, (sum(h for _, h in SECTIONS[:i]), sum(h for _, h in SECTIONS[:i + 1])))
                               for i, (k, _) in enumerate(SECTIONS)]:
            if kind != "stripes":
                continue
            for k in (0, 1, 3):
                a, b = Q.bear(Q.FRONT + 90 * k, d_at(z0) + 0.005, z0), Q.bear(Q.FRONT + 90 * k, d_at(z1) + 0.005, z1)
                L.tube(post, [a, b], [0.035, 0.035], sides=8)

    add_outline(obj_from_bm("frame", parts["frame"], [M["frame"]], parent=body, sharp=35), LN["cool"])
    add_outline(obj_from_bm("stripes", parts["stripes"], [M["stripes"]], parent=body, sharp=35), LN["warm"])
    add_outline(obj_from_bm("perf", parts["perf"], [M["perf"]], parent=body, sharp=35), LN["cool"])
    add_outline(obj_from_bm("lid", parts["lid"], [M["lid"]], parent=body, sharp=35), LN["cool"])
    obj_from_bm("holes", parts["holes"], [M["bore"]], parent=body)
    add_outline(obj_from_bm("balls", parts["balls"], [M["ball"]], parent=body), LN["warm"], L.LINE * 0.7)
    obj_from_bm("rivets_body", parts["rivets"], [M["rivet"]], parent=body)
    if TIER > 1:
        add_outline(obj_from_bm("trim", parts["trim"], [M["trim"]], parent=body, sharp=35), LN["warm"], L.LINE * 0.7)

    # ---- the turntable: a dark disc in a rim, a ring of rivets, a hub
    disc = lathe("turntable", [[(DISC_R + 0.03, TOP - 0.01), (DISC_R + 0.03, TOP + 0.02), (DISC_R - 0.01, TOP + 0.03),
                                (DISC_R - 0.04, TOP + 0.015)], [(DISC_R - 0.04, TOP + 0.012), (0.0, TOP + 0.012)]],
                 [M["rim"], M["disc"]], mat_of_seg=[0, 1], parent=body)
    add_outline(disc, LN["cool"], L.LINE * 0.8)
    bm = bmesh.new()
    cc, nn = L.ring_of(16, DISC_R - 0.1, TOP + 0.014, 0.5)
    studs(bm, cc, [Vector((0, 0, 1))] * 16, r=0.018)
    obj_from_bm("rivets_disc", bm, [M["rivet"]], parent=body)

    # ---- the hatch on the front-left face (a steel box standing out of the lower section, with a handle)
    zl = SECTIONS[0][1]
    hz, hh = zl, SECTIONS[1][1] + 0.02
    bm = bmesh.new()
    f = face_frame(90, hz, d_at(hz), u=-0.06, out=-0.04)
    rbox(bm, (0.36, 0.2, hh), f, bevel=0.025)
    rbox(bm, (0.28, 0.06, hh * 0.55), f @ Matrix.Translation((0, 0.11, hh * 0.25)), bevel=0.015)
    rbox(bm, (0.4, 0.24, 0.05), f @ Matrix.Translation((0, 0.0, hh - 0.01)), bevel=0.015)
    add_outline(obj_from_bm("hatch", bm, [M["hatch"]], parent=body, sharp=35), LN["cool"])
    bm = bmesh.new()
    L.tube(bm, [f @ Vector((x, 0.15, hh * 0.62)) for x in (-0.09,)] + [f @ Vector((-0.09, 0.19, hh * 0.62)),
           f @ Vector((0.09, 0.19, hh * 0.62)), f @ Vector((0.09, 0.15, hh * 0.62))], [0.016] * 4, sides=8)
    add_outline(obj_from_bm("handle", bm, [M["dark"]], parent=body), LN["cool"], L.LINE * 0.6)

    # ---- the winch on the front-right face: two toothed drums on an axle in a bracket, a crank
    bm, bm2 = bmesh.new(), bmesh.new()
    f = face_frame(0, zl + 0.02, d_at(zl), u=-0.26, out=0.06) @ Matrix.Scale(1.35, 4)
    rbox(bm2, (0.42, 0.06, 0.14), f @ Matrix.Translation((0, -0.03, 0)), bevel=0.02)
    ax = f @ Matrix.Translation((0, 0.08, 0.1)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    cyl(bm2, 0.025, 0.46, ax, segs=12)
    for x in (-0.12, 0.08):
        g = f @ Matrix.Translation((x, 0.08, 0.1)) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
        cyl(bm, 0.075, 0.07, g, segs=20)
        for t in range(10):
            rbox(bm, (0.03, 0.035, 0.07), g @ Matrix.Rotation(2 * math.pi * t / 10, 4, 'Z') @ Matrix.Translation((0, 0.08, -0.035)),
                 bevel=0.006, segs=1)
    lever = f @ Matrix.Translation((0.2, 0.1, 0.1))
    L.tube(bm2, [lever @ Vector((0, 0, 0)), lever @ Vector((0.03, 0.04, 0.16))], [0.018, 0.018], sides=8)
    ball(bm2, lever @ Vector((0.03, 0.04, 0.17)), 0.03, segs=10)
    add_outline(obj_from_bm("winch", bm, [M["winch"]], parent=body, sharp=35), LN["warm"], L.LINE * 0.8)
    add_outline(obj_from_bm("winch_frame", bm2, [M["dark"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.8)

    # ---- the battery at the back-left corner of the lid, a red and a blue cable looping over it
    bm = bmesh.new()
    bc = Q.bear(150, 0.6, TOP)
    rot = Matrix.Rotation(-math.radians(150), 4, 'Z')
    rbox(bm, (0.3, 0.2, 0.17), Matrix.Translation(bc) @ rot, bevel=0.03)
    add_outline(obj_from_bm("battery", bm, [M["copper"]], parent=body, sharp=35), LN["warm"])
    for i, (m, rr) in enumerate((("red", 0.13), ("blue", 0.17))):
        a = bc + rot @ Vector((-0.09 + 0.1 * i, 0.03, 0.17))
        e = bc + rot @ Vector((-0.05 + 0.1 * i, -0.12, 0.08))
        pts = L.bezier(a, a + Vector((0, 0, rr * 1.4)), e + rot @ Vector((0, -0.08, rr * 1.2)), e, n=16)
        bm = bmesh.new()
        L.tube(bm, pts, [0.026] * len(pts), sides=10)
        add_outline(obj_from_bm(f"cable_{m}", bm, [M[m]], parent=body), LN["cool"], L.LINE * 0.7)

    # ---- the turret, built facing +Y (bearing 0) and turned about z by -heading
    tur = L.empty("TURRET", loc=(0, 0, TOP + 0.03))
    tur.scale = (TURRET_SCALE,) * 3
    RR = 0.47                                      # the ring
    ring = lathe("ring", [[(RR, 0.0), (RR + 0.01, 0.01), (RR + 0.01, 0.07), (RR - 0.01, 0.085)], [(RR - 0.01, 0.085), (0.0, 0.085)]],
                 [M["ring"]], parent=tur)
    add_outline(ring, LN["warm"])
    bm = bmesh.new()
    for k in range(12):                            # the lugs round the ring
        rbox(bm, (0.1, 0.05, 0.07), Matrix.Rotation(2 * math.pi * (k + 0.5) / 12, 4, 'Z') @ Matrix.Translation((0, RR + 0.01, 0.008)),
             bevel=0.012, segs=2)
    add_outline(obj_from_bm("lugs", bm, [M["lug"]], parent=tur, sharp=35), LN["warm"], L.LINE * 0.7)
    prof = [(0.44, 0.075), (0.43, 0.17), (0.35, 0.27), (0.2, 0.335), (0.0, 0.35)]
    dome = lathe("dome", [prof], [M["dome"]], n=DOME_N, parent=tur, sharp=12)
    dome.rotation_euler = (0, 0, math.pi / DOME_N)
    add_outline(dome, LN["warm"])
    seams = lathe("dome_seams", [[(r * 1.006, z + 0.002) for r, z in prof]], [M["seam"]], n=DOME_N, parent=tur, sharp=12)
    seams.rotation_euler = dome.rotation_euler
    wf = seams.modifiers.new("seams", 'WIREFRAME')
    wf.thickness = 0.008
    wf.use_replace = True
    wf.use_even_offset = True
    # the ears: a round boss each side, a red bolt in it
    bm, bm2 = bmesh.new(), bmesh.new()
    for sx in (-1, 1):
        f = Matrix.Translation((sx * 0.42, -0.04, 0.15)) @ Matrix.Rotation(sx * math.pi / 2, 4, 'Y')
        cyl(bm, 0.075, 0.06, f, segs=20)
        cyl(bm2, 0.04, 0.08, f, segs=16)
    add_outline(obj_from_bm("ears", bm, [M["ear"]], parent=tur, sharp=35), LN["warm"], L.LINE * 0.7)
    obj_from_bm("ear_bolts", bm2, [M["ear_red"]], parent=tur, sharp=35)
    # the mantlet the guns come out of: a dark block in the dome's front, raised with the guns
    t = math.radians(TILT)
    gun_rot = Matrix.Rotation(-(math.pi / 2 - t), 4, 'X')
    root = Vector((0, 0.12, 0.24))
    bm = bmesh.new()
    rbox(bm, (0.38, 0.2, 0.3), Matrix.Translation(root) @ gun_rot @ Matrix.Translation((0, 0, -0.1)), bevel=0.04)
    add_outline(obj_from_bm("mantlet", bm, [M["slot"]], parent=tur, sharp=35), LN["cool"])
    # the guns: two long tubes with two bands and a flared muzzle
    LG = 1.08
    for sx in (-1, 1):
        g = lathe(f"gun_{'lr'[sx > 0]}", [
            [(0.0, 0.0), (0.05, 0.0)],
            [(0.05, 0.0), (0.05, 0.8 * LG)],
            [(0.054, 0.79 * LG), (0.07, 0.82 * LG), (0.08, 0.97 * LG), (0.076, LG)],
            [(0.076, LG), (0.052, LG), (0.046, 0.99 * LG)],
            [(0.046, 0.99 * LG), (0.042, 0.85 * LG), (0.0, 0.85 * LG)],
        ], [M["barrel"], M["muzzle"], M["bore"]], mat_of_seg=[0, 0, 1, 1, 2], parent=tur, sharp=35)
        g.matrix_basis = Matrix.Translation(root + Vector((sx * 0.105, 0, 0))) @ gun_rot
        add_outline(g, LN["cool"])
        for zb in (0.36, 0.6):
            b = lathe(f"band_{'lr'[sx > 0]}{zb}", [L.band(0.05, 0.062, zb * LG, zb * LG + 0.05)], [M["band"]], parent=tur, sharp=35)
            b.matrix_basis = g.matrix_basis.copy()
            add_outline(b, LN["warm"], L.LINE * 0.7)
    mb = L.empty("muzzle_base", parent=tur, loc=root)
    mt = L.empty("muzzle_tip", parent=tur, loc=root + gun_rot @ Vector((0, 0, LG)))
    return body, tur, TOP


Q.run("aerial", build, TIER, HERE, turret_canvas=(480, 440, 240, 300), args=ARGS[1:],
      solid=("lid", "balls", "battery", "cable_red", "cable_blue", "turntable"))
