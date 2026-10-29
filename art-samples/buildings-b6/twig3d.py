"""twig3d.py : the Twig Snapper (type 1) in 3D (buildings-3d-b6, 29 Oct 2026, for beta 6), after the Flash art in
server/public/assets/buildings/twigsnapper.v2/ (looks at levels 1, 3, 6 and 10).

    blender -b --factory-startup -P twig3d.py -- LEVEL still | anim [N] | save        (see bldg3d.run)

The Flash building: a plank hut with a feed roller in an arched mouth on its front-left face over a wooden tray, a saw
blade (white teeth, purple disc) on its front-right face, a steel horn on a green pipe behind on the left.
  L1   a squat hut on a sill, a lean-to plank roof, the roller and tray on the ground
  L3   taller, on four stilts, a curved pagoda roof with pale ribs and a twig finial, a green band round the middle
  L6   + a brass gear wheel on an arm at the right, a pale chimney behind, brass corners on the tray, brass stilt bands
  L10  + a guillotine frame up through the roof (its green blade chops), bird-claw feet, twigs out of the chimney
Producing (as Flash): the saw spins and the small brass cog above it turns with it; the rest stays still.
  L6/L10 trays hold black lumps on the twigs, as Flash's.
"""
import math
import sys
from pathlib import Path

import bmesh
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bldg3d as B  # noqa: E402
from bldg3d import L, W  # noqa: E402


def look_of(level):
    return 10 if level >= 10 else 6 if level >= 6 else 3 if level >= 3 else 1


L.METALS.setdefault("chrome", ((30, 32, 40), (150, 154, 168), (240, 244, 252), (1.0, 1.0, 1.0, 1)))


def materials():
    return dict(
        walls=B.mat_boards("walls", n=9.0, light=(218, 154, 86), dark=(166, 104, 54), gap=(60, 34, 18), dirt=0.5),
        post=W.mat_raw_wood("post", light=(176, 112, 62), dark=(112, 66, 34), coord="Object", stretch=(5.0, 5.0, 0.3)),
        beam=W.mat_raw_wood("beam", light=(190, 124, 70), dark=(122, 74, 40), coord="Object", stretch=(1.4, 1.4, 1.4)),
        roof=B.mat_shingles("roof", light=(116, 80, 72), dark=(70, 46, 44), dirt=0.1),
        board=B.mat_boards("board", n=6.0, light=(132, 90, 70), dark=(92, 60, 48), gap=(36, 22, 16), vertical=False,
                           edge=(170, 130, 100), dirt=0.2),
        rib=W.mat_raw_wood("rib", light=(236, 180, 112), dark=(180, 118, 66), coord="Object", stretch=(2.0, 2.0, 2.0)),
        green=B.mat_paint("green", (84, 112, 50), under=(120, 84, 52)),
        dark=L.mat_flat("dark", (24, 16, 12), spec=0.05),
        roller=W.mat_iron("roller", base=(54, 50, 52), dark=(22, 20, 22), rust_k=0.0, edge=(120, 114, 112), spec=0.3),
        iron=W.mat_iron("iron"),
        coal=W.mat_iron("coal", base=(34, 32, 36), dark=(10, 10, 12), rust_k=0.0, edge=(110, 110, 124), spec=0.5),
        steel=L.mat_metal("steel", "steel", polish=0.4),
        hornm=L.mat_metal("hornm", "steel", polish=0, spec=1.0),
        brass=L.mat_metal("brass", "brass"),
        purple=B.mat_paint("purple", (146, 66, 168), under=(236, 226, 240), chips=0.68, spec=0.5),
        white=B.mat_paint("white", (238, 234, 228), under=(150, 140, 130), chips=0.7),
        twig=W.mat_raw_wood("twig", light=(196, 136, 80), dark=(120, 74, 40)),
        chim=B.mat_paint("chim", (200, 218, 230), under=(118, 126, 136), edge=(250, 252, 255)),
        blade=L.mat_metal("blade", "chrome", spec=1.0, polish=0.5),
    )


def build(level):
    lk = look_of(level)
    L.clear_scene()
    M = materials()
    root = L.empty("ROOT")
    S = 0.36 if lk == 1 else 0.38                    # the hut's half side
    H0 = 0.07 if lk == 1 else (0.3 if lk == 10 else 0.32)   # the floor: a sill, then stilts
    WH = 0.68 if lk == 1 else 1.0                    # the walls' height
    ZT = H0 + WH                                     # the eaves
    movers = {}

    # ---- the walls, the corner posts (down to the ground as stilts), the sill and the top beam
    bm = bmesh.new()
    B.box(bm, -S, S, -S, S, H0, ZT, bevel=0.015)
    B.part("walls", bm, M["walls"], root)
    bm = bmesh.new()
    pw = 0.06 if lk == 1 else 0.075
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * S, sy * S
            if lk == 1:
                B.box(bm, x - pw, x + pw, y - pw, y + pw, 0.0, ZT + 0.02, bevel=0.02)
            else:
                B.box(bm, x - pw, x + pw, y - pw, y + pw, H0 - 0.04, ZT + 0.02, bevel=0.02)
                B.disc(bm, 0.075, H0 - 0.02, Matrix.Translation((x, y, (H0 - 0.02) / 2)), segs=12, r2=0.065)
    B.part("posts", bm, M["post"], root)
    bm = bmesh.new()
    for z0, z1 in ((H0 - 0.05, H0 + 0.04), (ZT - 0.07, ZT)):
        B.box(bm, -S - 0.025, S + 0.025, -S - 0.025, S + 0.025, z0, z1, bevel=0.015)
    B.part("beams", bm, M["beam"], root)
    if lk >= 3:                                      # bolt heads along the beams on the two faces we see
        bm = bmesh.new()
        cs, ns = [], []
        for z in (H0 - 0.005, ZT - 0.035):
            for f in (-0.75, -0.25, 0.25, 0.75):
                cs += [Vector((S + 0.025, f * S, z)), Vector((f * S, S + 0.025, z))]
                ns += [(1, 0, 0), (0, 1, 0)]
        W.bolts(bm, cs, ns, r=0.022)
        B.part("beam_bolts", bm, M["iron"], root, line="cool", k=0.5)
    if lk >= 6:                                      # iron straps round the corners, top and bottom
        bm = bmesh.new()
        for sx in (-1, 1):
            for sy in (-1, 1):
                for z in (H0 + 0.1, ZT - 0.2):
                    x, y = sx * S, sy * S
                    B.box(bm, x - 0.09, x + 0.09, y - 0.09, y + 0.09, z, z + 0.06, bevel=0.012)
        B.part("straps", bm, M["iron"], root, line="cool", k=0.6)
    if lk >= 3:                                      # the green band round the middle, bands on the stilts
        bm = bmesh.new()
        zb = H0 + WH * 0.56
        B.box(bm, -S - 0.018, S + 0.018, -S - 0.018, S + 0.018, zb, zb + 0.085, bevel=0.012)
        B.part("band", bm, M["green"], root)
        bm = bmesh.new()
        for sx in (-1, 1):
            for sy in (-1, 1):
                for zz in ((0.08, H0 - 0.1) if lk >= 6 else (H0 * 0.45,)):
                    B.disc(bm, 0.085, 0.04, Matrix.Translation((sx * S, sy * S, zz)), segs=16)
        B.part("stilt_bands", bm, M["brass" if lk >= 6 else "green"], root, line="cool", k=0.6)
    if lk == 10:                                     # bird-claw feet
        bm = bmesh.new()
        for sx in (-1, 1):
            for sy in (-1, 1):
                hd = math.degrees(math.atan2(sx, sy))
                B.claw(bm, (sx * S, sy * S, 0.07), hd, r=0.05, length=0.17, spread=42)
        B.part("claws", bm, M["post"], root)

    # ---- the arched mouth on the front-left (+X) face, its trim, the roller and the tray
    aw, ah, az = (0.4, 0.42, H0 + 0.02) if lk == 1 else (0.44, 0.62, H0 + 0.06)
    au = 0.02
    bm = bmesh.new()
    B.prism(bm, B.arch_pts(aw, ah), 0.012, B.face_m('X', S, au, az, out=-0.004))
    B.part("mouth", bm, M["dark"], root, line=None)
    bm = bmesh.new()
    pts = [B.face_m('X', S, au, az, out=0.01) @ Vector((x, 0, z)) for x, z in B.arch_pts(aw + 0.04, ah + 0.02, 16)[1:]]
    pts.append(B.face_m('X', S, au, az, out=0.01) @ Vector((-(aw + 0.04) / 2, 0, 0)))
    L.tube(bm, pts, [0.028] * len(pts), sides=8)
    B.part("mouth_trim", bm, M["rib"], root)
    rz = az + 0.15
    piv = B.mover("roller_pivot", root, (S + 0.04, au, rz), axis=(0, 1, 0))
    bm = bmesh.new()
    B.toothed(bm, 0.125, 0.15, 14, aw - 0.04, Matrix(), saw=False)
    B.part("roller", bm, M["roller"], piv, line="cool")
    bm = bmesh.new()
    B.disc(bm, 0.05, aw + 0.06, Matrix(), segs=16)
    B.part("roller_axle", bm, M["steel"], piv, line="cool", k=0.6)
    movers["roller"] = piv
    # the tray: a plank box sticking out under the mouth, full of twigs
    tx0, tx1, ty = S - 0.02, S + (0.3 if lk == 1 else 0.36), aw / 2 + 0.02
    tz0, tz1 = (0.0, 0.2) if lk == 1 else (H0 - 0.08, H0 + 0.13)
    bm = bmesh.new()
    B.box(bm, tx0, tx1, -ty + au, ty + au, tz0, tz0 + 0.04, bevel=0.01)
    B.box(bm, tx1 - 0.04, tx1, -ty + au, ty + au, tz0, tz1, bevel=0.012, taper=1.0)
    for sy in (-1, 1):
        B.box(bm, tx0, tx1, sy * ty + au - 0.02, sy * ty + au + 0.02, tz0, tz1, bevel=0.012)
    B.part("tray", bm, M["beam"], root)
    if lk > 1:                                       # a leg under the tray
        bm = bmesh.new()
        B.box(bm, tx1 - 0.08, tx1 - 0.02, au - 0.04, au + 0.04, 0.0, tz0 + 0.01, bevel=0.015)
        B.part("tray_leg", bm, M["post"], root)
    if lk >= 6:
        bm = bmesh.new()
        for sy in (-1, 1):
            B.box(bm, tx1 - 0.05, tx1 + 0.01, sy * ty + au - 0.035, sy * ty + au + 0.035, tz0 - 0.005, tz1 + 0.01,
                  bevel=0.012)
        B.part("tray_brass", bm, M["brass"], root, line="cool", k=0.7)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    import random
    rnd = random.Random(3)
    for k in range(14 if lk == 1 else 20):           # twigs lying in the tray, along it
        x = tx0 + 0.05 + (tx1 - tx0 - 0.1) * rnd.random()
        z = tz0 + 0.06 + 0.1 * rnd.random()
        a = Vector((x, au - ty + 0.03, z))
        b = Vector((x + (rnd.random() - 0.5) * 0.12, au + ty - 0.03, z + (rnd.random() - 0.5) * 0.06))
        if k % 2:
            a, b = b, a
        W.stake(bm, uv, a, b, 0.022, sides=6, twist=rnd.random(), bulge=0.0)
    B.part("tray_twigs", bm, M["twig"], root, k=0.6)
    if lk >= 6:                                      # black lumps on the twigs, as Flash's tray
        bm = bmesh.new()
        for k in range(8):
            c = Vector((tx0 + 0.07 + (tx1 - tx0 - 0.14) * rnd.random(), au + (rnd.random() - 0.5) * (2 * ty - 0.12),
                        tz0 + 0.21 + 0.03 * rnd.random()))
            sub = bmesh.new()
            bmesh.ops.create_icosphere(sub, subdivisions=1, radius=1.0)
            for v in sub.verts:
                v.co *= 1 + 0.22 * math.sin(v.co.x * 3 + k) * math.cos(v.co.y * 4 + k * 2)
            r = 0.055 + 0.025 * rnd.random()
            L.add_mesh(bm, sub, Matrix.Translation(c) @ Matrix.Rotation(rnd.random() * 3, 4, 'Z') @
                       Matrix.Diagonal((r, r * 0.9, r * 0.75, 1)))
        B.part("tray_lumps", bm, M["coal"], root, k=0.6, sharp=30)

    # ---- the saw on the front-right (+Y) face, spinning about its axle
    sr = 0.21 if lk == 1 else 0.28
    sz = H0 + (0.32 if lk == 1 else WH * 0.36)
    su = 0.05
    c = B.face_m('Y', S, su, sz, out=0.07).translation
    piv = B.mover("saw_pivot", root, c, axis=(0, 1, 0))
    bm = bmesh.new()
    B.toothed(bm, sr * 0.8, sr * 1.13, 24, 0.022, Matrix())
    B.part("saw_teeth", bm, M["blade"], piv, line="cool", k=0.6)
    bm = bmesh.new()
    B.disc(bm, sr * 0.84, 0.04, Matrix(), segs=48)
    B.part("saw_disc", bm, M["purple"], piv)
    bm = bmesh.new()                                 # a white ring painted on the disc's face
    for r0, r1 in ((sr * 0.52, sr * 0.62),):
        ring = bmesh.new()
        bmesh.ops.create_circle(ring, cap_ends=False, segments=48, radius=r1)
        verts_o = list(ring.verts)
        inner = [ring.verts.new(v.co * (r0 / r1)) for v in verts_o]
        n = len(verts_o)
        for i in range(n):
            ring.faces.new((verts_o[i], verts_o[(i + 1) % n], inner[(i + 1) % n], inner[i]))
        L.add_mesh(bm, ring, Matrix.Translation((0, 0, 0.0215)))
    B.part("saw_ring", bm, M["white"], piv, line=None)
    bm = bmesh.new()
    B.disc(bm, sr * 0.26, 0.07, Matrix.Translation((0, 0, 0.01)), segs=20)
    W.bolts(bm, [Vector((math.cos(a) * sr * 0.38, math.sin(a) * sr * 0.38, 0.022)) for a in
                 (2 * math.pi * k / 6 for k in range(6))], [(0, 0, 1)] * 6, r=0.018, washer=False)
    B.part("saw_hub", bm, M["brass"], piv, line="cool", k=0.7)
    bm = bmesh.new()                                 # the bracket holding the axle off the wall
    B.box(bm, c.x - 0.05, c.x + 0.05, S - 0.01, c.y - 0.02, c.z - 0.05, c.z + 0.05, bevel=0.012)
    B.part("saw_bracket", bm, M["steel"], root, line="cool", k=0.7)
    movers["saw"] = piv
    # the small brass cog above the saw's right (its left is behind the corner post), meshing with it (Flash turns it with the saw)
    cr = 0.085 if lk == 1 else 0.1
    cc = B.face_m('Y', S, su - sr * 1.0, sz + sr * 0.98, out=0.045).translation
    piv = B.mover("cog_pivot", root, cc, axis=(0, 1, 0))
    bm = bmesh.new()
    B.toothed(bm, cr * 0.78, cr, 10, 0.03, Matrix(), saw=False)
    B.disc(bm, cr * 0.8, 0.026, Matrix(), segs=24)
    B.part("cog", bm, M["brass"], piv, line="cool", k=0.6)
    bm = bmesh.new()
    B.disc(bm, cr * 0.3, 0.05, Matrix.Translation((0, 0, 0.01)), segs=16)
    W.bolts(bm, [Vector((cr * 0.55, 0, 0.016))], [(0, 0, 1)], r=0.012, washer=False)
    B.part("cog_hub", bm, M["steel"], piv, line="cool", k=0.5)
    bm = bmesh.new()
    B.box(bm, cc.x - 0.03, cc.x + 0.03, S - 0.01, cc.y - 0.01, cc.z - 0.03, cc.z + 0.03, bevel=0.01)
    B.part("cog_bracket", bm, M["steel"], root, line="cool", k=0.6)
    movers["cog"] = piv

    # ---- the horn: a green pipe up the back-left (-Y) face, a steel bell on top facing up and out
    hx = S * 0.55
    hz0, hz1 = H0 + 0.15, ZT + (0.38 if lk == 1 else 0.3)
    bm = bmesh.new()
    pts = L.bezier((hx, -S - 0.02, hz0), (hx, -S - 0.1, hz0 + 0.05), (hx, -S - 0.1, hz1 - 0.2), (hx, -S - 0.1, hz1), 12)
    L.tube(bm, pts, [0.055] * len(pts), sides=12)
    B.disc(bm, 0.07, 0.05, Matrix.Translation((hx, -S - 0.1, hz0 + 0.3)), segs=16)
    B.part("horn_pipe", bm, M["green"], root)
    bell = W.lathe("horn", [[(0.055, 0.0), (0.065, 0.1), (0.1, 0.2), (0.19, 0.28), (0.2, 0.3)],
                            [(0.2, 0.3), (0.17, 0.295), (0.09, 0.23), (0.0, 0.14)]],
                   [M["hornm"], M["iron"]], mat_of_seg=[0, 1], parent=root, n=40)
    bell.matrix_basis = Matrix.Translation((hx, -S - 0.1, hz1 - 0.02)) @ B.along((-0.25, -0.75, 0.75))
    L.add_outline(bell, L.line("cool"))

    # ---- the roof
    if lk == 1:                                      # a lean-to of planks, falling toward the front-right, pale ribs
        bm = bmesh.new()
        m = Matrix.Translation((0, 0.02, ZT + 0.16)) @ Matrix.Rotation(math.radians(-24), 4, 'X')
        L.rbox(bm, (2 * S + 0.14, 2 * S + 0.2, 0.05), m @ Matrix.Translation((0, 0, -0.025)), bevel=0.012, segs=2)
        B.part("roof", bm, M["board"], root)
        bm = bmesh.new()
        for k in range(5):
            x = -S - 0.04 + (2 * S + 0.08) * k / 4
            a = m @ Vector((x * 0.6, -S - 0.1, 0.035))       # fanned, as the Flash roof's ribs
            b = m @ Vector((x * 1.25, S + 0.2, 0.035))
            L.tube(bm, [a, b], [0.022, 0.02], sides=8)
        B.part("roof_ribs", bm, M["rib"], root, k=0.7)
    else:
        rz1 = ZT + (0.56 if lk == 10 else 0.66)
        bm = bmesh.new()
        rows = B.pagoda(bm, S + 0.14, 0.07, ZT - 0.02, rz1, n=12, side=8, sag=0.4, lift=0.11 if lk < 10 else 0.17)
        B.part("roof", bm, M["roof"], root)
        bm = bmesh.new()                             # ribs down the hips and the middle of each side
        for j in range(0, 32, 4):
            pts = [rows[i][j] + Vector((0, 0, 0.022)) for i in range(len(rows))]
            ext = pts[0] + (pts[0] - pts[1]).normalized() * 0.06
            L.tube(bm, [ext] + pts, [0.024] + [0.024 - 0.008 * i / len(pts) for i in range(len(pts))], sides=7)
        B.part("roof_ribs", bm, M["rib"], root, k=0.7)
        bm = bmesh.new()                             # the iron cap and the twig finial
        B.disc(bm, 0.09, 0.08, Matrix.Translation((0, 0, rz1 + 0.02)), segs=16, r2=0.06)
        B.part("roof_cap", bm, M["roller"], root, line="cool")
        if lk < 10:
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new("UVMap")
            B.twigs(bm, uv, (0, 0, rz1 + 0.05), 5, 0.028, 0.3, spread=0.45, seed=lk)
            B.part("finial", bm, M["twig"], root, k=0.7)

    # ---- the little brass lever on the front-right face (L3 up)
    if lk >= 3:
        bm = bmesh.new()
        m = B.face_m('Y', S, 0.2, ZT - 0.2, out=0.0)
        B.box(bm, -0.04, 0.04, 0.0, 0.05, -0.04, 0.04, bevel=0.01)
        L.tube(bm, [Vector((0, 0.03, 0)), Vector((0.02, 0.07, 0.14))], [0.016, 0.014], sides=8)
        bm.transform(m)
        B.disc(bm, 0.035, 0.04, m @ Matrix.Translation((0.02, 0.07, 0.15)) @ B.along((0, 1, 0)), segs=12)
        B.part("lever", bm, M["brass"], root, line="cool", k=0.7)

    # ---- the brass gear on its arm at the right (L6 up), the chimney behind
    if lk >= 6:
        gz = H0 + WH * 0.74
        gc = B.face_m('Y', S, -(S + 0.04), gz, out=0.1).translation
        bm = bmesh.new()
        L.tube(bm, [Vector((gc.x, S - 0.02, gz)), Vector((gc.x, gc.y - 0.02, gz))], [0.035, 0.035], sides=8)
        B.part("gear_arm", bm, M["steel"], root, line="cool", k=0.7)
        piv = B.mover("gear_pivot", root, gc, axis=(0, 1, 0))
        bm = bmesh.new()
        B.toothed(bm, 0.16, 0.2, 16, 0.04, Matrix(), saw=False)
        B.disc(bm, 0.165, 0.025, Matrix(), segs=32)
        B.part("gear", bm, M["brass"], piv)
        bm = bmesh.new()
        B.disc(bm, 0.04, 0.07, Matrix(), segs=14)
        for a in range(4):
            aa = math.pi / 2 * a + 0.4
            L.tube(bm, [Vector((0, 0, 0.02)), Vector((math.cos(aa) * 0.15, math.sin(aa) * 0.15, 0.02))], [0.018, 0.016],
                   sides=8)
        B.part("gear_hub", bm, M["steel"], piv, line="cool", k=0.6)
        movers["gear"] = piv
        cx0, cx1, cy0, cy1 = -S - 0.07, -S + 0.16, 0.08, 0.3
        cz0, cz1 = ZT - 0.35, ZT + (0.85 if lk == 10 else 0.7)
        bm = bmesh.new()
        B.box(bm, cx0, cx1, cy0, cy1, cz0 + 0.25, cz1, bevel=0.02, taper=0.9)
        B.part("chimney", bm, M["chim"], root, line="cool")
        bm = bmesh.new()
        B.box(bm, cx0 - 0.02, cx1 + 0.02, cy0 - 0.02, cy1 + 0.02, cz0, cz0 + 0.3, bevel=0.02)
        B.box(bm, cx0 - 0.015, cx1 + 0.015, cy0 - 0.015, cy1 + 0.015, cz1 - 0.06, cz1, bevel=0.015)
        B.part("chimney_bands", bm, M["green"], root)
        if lk == 10:
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new("UVMap")
            B.twigs(bm, uv, ((cx0 + cx1) / 2, (cy0 + cy1) / 2, cz1 - 0.05), 6, 0.026, 0.32, spread=0.5, seed=7)
            B.part("chimney_twigs", bm, M["twig"], root, k=0.7)

    # ---- the guillotine (L10): two posts up through the roof, a crossbar, the green blade between them
    if lk == 10:
        gy, gx, GO = 0.28, -0.04, 0.08
        top = ZT + 1.02
        bm = bmesh.new()
        for sy in (-1, 1):
            B.box(bm, gx - 0.06, gx + 0.06, sy * gy - 0.055 - GO, sy * gy + 0.055 - GO, ZT - 0.1, top, bevel=0.02)
        B.box(bm, gx - 0.075, gx + 0.075, -gy - 0.09 - GO, gy + 0.09 - GO, top - 0.02, top + 0.11, bevel=0.025)
        B.part("guillotine", bm, M["post"], root)
        bm = bmesh.new()
        B.box(bm, gx - 0.03, gx + 0.03, -0.12 - GO, 0.12 - GO, top + 0.11, top + 0.12, bevel=0.005)
        B.part("slot", bm, M["dark"], root, line=None)
        bm = bmesh.new()
        for sy in (-1, 1):
            for zz in (ZT + 0.5, top - 0.15):
                B.box(bm, gx - 0.07, gx + 0.07, sy * gy - 0.065 - GO, sy * gy + 0.065 - GO, zz, zz + 0.05, bevel=0.01)
        B.part("guillotine_bands", bm, M["brass"], root, line="cool", k=0.7)
        piv = L.empty("blade_pivot", parent=root, loc=(gx, -GO, ZT + 0.5))
        bm = bmesh.new()
        B.box(bm, -0.025, 0.025, -gy + 0.055, gy - 0.055, 0.0, 0.3, bevel=0.01)
        B.part("blade_panel", bm, M["green"], piv)
        bm = bmesh.new()
        B.prism(bm, [(-(gy - 0.055), 0.0), (gy - 0.055, 0.06), (gy - 0.055, 0.1), (-(gy - 0.055), 0.1)], 0.04,
                Matrix.Translation((0.02, 0, -0.06)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
        B.part("blade_edge", bm, M["blade"], piv, line="cool", k=0.7)
        movers["blade"] = piv

    def animate(phase):
        # each turn per loop is a whole number of the part's repeats (24 teeth and 6 bolts, 14 ribs, 16 teeth and
        # 4 spokes), so the loop is seamless, and small per frame against a tooth's width, so it does not strobe
        # only Flash's moving parts move: the saw and the small cog meshing with it (12 teeth a loop each); the roller,
        # the side gear and the guillotine blade stay still
        B.spin(movers["saw"], 'Z', -0.5 * phase)
        B.spin(movers["cog"], 'Z', 1.2 * phase)
    return root, animate


if __name__ == "__main__":
    B.run("twig", build, HERE)
