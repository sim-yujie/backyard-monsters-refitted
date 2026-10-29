"""putty3d.py : the Putty Squisher (type 3) in 3D (buildings-3d-b6, 29 Oct 2026, for beta 6), after the Flash art in
server/public/assets/buildings/puttysquisher.v2/ (looks at levels 1, 3, 6 and 10).

    blender -b --factory-startup -P putty3d.py -- LEVEL still | anim [N] | save        (see bldg3d.run)

The Flash building: a sooty orange-gold pot of purple putty, a pale press block on its rim, a brass hand wheel on its
side, a brass arm out to a test tube of purple putty.
  L1   the pot on the ground, a gold crank stirrer in it, the test tube standing beside it
  L3   on a purple frame on four pale log stumps; two pale arched squisher arms over the pot; the tube hangs on the frame
  L6   + a hub on the arms with a purple flask (glass neck) and a gold valve wheel on it, a bigger gold hand wheel
  L10  + a big gold wheel with purple spokes and putty on them, behind at the right; a steel coil with a bulb at the
       left; the stumps stand in steel springs
Producing: the gold stirrer goes round in the putty (every look, as Flash), the arms squish down and lift, the hand
wheel turns, the big wheel turns.
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


def materials():
    return dict(
        pot=B.mat_paint("pot", (238, 162, 36), under=(112, 70, 28), edge=(255, 224, 136), chips=0.72, spec=0.6,
                        spec_rough=0.25, soot=0.45, dirt=0.3),
        brass=L.mat_metal("brass", "brass"),
        gold=L.mat_metal("gold", "gold", polish=0.7),
        putty=B.mat_goo("putty", col=(160, 84, 204), deep=(70, 26, 104), hi=(246, 214, 255)),
        purple=B.mat_paint("purple", (104, 54, 146), under=(60, 34, 80), edge=(170, 120, 210), chips=0.66, spec=0.5),
        bone=B.mat_paint("bone", (218, 194, 148), under=(140, 112, 80), edge=(246, 232, 200), soot=0.35, chips=0.7,
                         spec=0.2),
        dark=L.mat_flat("dark", (34, 22, 20), spec=0.05),
        stump=W.mat_raw_wood("stump", light=(252, 228, 212), dark=(216, 182, 162), coord="Object",
                             stretch=(5.0, 5.0, 0.3)),
        steel=L.mat_metal("steel", "steel", polish=0.4),
        glass=L.mat_flat("glass", (236, 228, 244), spec=0.9),
    )


def handwheel(bm, r, m, spokes=4, mat=0):
    """A hand wheel in local XY (axis z): a rim, spokes, a hub, a knob on the rim."""
    ring = bmesh.new()
    bmesh.ops.create_circle(ring, cap_ends=False, segments=24, radius=r)
    pts = [v.co.copy() for v in ring.verts]
    ring.free()
    L.tube(bm, pts + [pts[0]], [r * 0.12] * (len(pts) + 1), sides=8, cap=False, mat=mat)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        L.tube(bm, [Vector((0, 0, 0)), Vector((math.cos(a) * r, math.sin(a) * r, 0))], [r * 0.08] * 2, sides=6, mat=mat)
    B.disc(bm, r * 0.22, r * 0.3, Matrix(), segs=12, mat=mat)
    L.tube(bm, [Vector((r, 0, 0)), Vector((r, 0, r * 0.5))], [r * 0.09, r * 0.09], sides=6, mat=mat)
    bm.transform(m)
    return bm


def rounded_crank(sh, arm):
    """The stirrer's centre line: up its shaft, a round bend out along the arm, a round bend up into the handle."""
    pts = [Vector((0, 0, -0.1 + (sh + 0.1 - 0.06) * i / 8)) for i in range(9)]
    pts += [Vector((0.06 - 0.06 * math.cos(a), 0, sh - 0.06 + 0.06 * math.sin(a))) for a in
            (k * math.pi / 2 / 6 for k in range(1, 7))]
    pts += [Vector((0.06 + (arm - 0.12) * i / 4, 0, sh)) for i in range(1, 5)]
    pts += [Vector((arm - 0.06 + 0.06 * math.sin(a), 0, sh + 0.06 - 0.06 * math.cos(a))) for a in
            (k * math.pi / 2 / 6 for k in range(1, 7))]
    pts.append(Vector((arm, 0, sh + 0.1)))
    return pts


def build(level):
    lk = look_of(level)
    L.clear_scene()
    M = materials()
    root = L.empty("ROOT")
    movers = {}
    PR = 0.4 if lk == 1 else 0.44                      # the pot's radius
    PH = 0.5 if lk == 1 else 0.56                      # its height
    Z0 = 0.0 if lk == 1 else (0.36 if lk == 10 else 0.3)   # its foot
    ZR = Z0 + PH                                       # its rim

    # ---- the pot, the putty in it
    prof = [(0.0, Z0), (PR * 0.6, Z0 + 0.01), (PR * 0.92, Z0 + PH * 0.12), (PR, Z0 + PH * 0.4), (PR * 0.98, ZR - 0.06),
            (PR * 1.04, ZR - 0.03), (PR * 1.04, ZR), (PR * 0.96, ZR), (PR * 0.94, ZR - 0.08)]
    pot = W.lathe("pot", [prof], [M["pot"]], parent=root, n=64, wob=0.012, seed=lk)
    L.add_outline(pot, L.line("warm"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=24, y_segments=24, size=PR * 0.95)
    for v in list(bm.verts):
        d = v.co.length
        if d > PR * 0.95:
            v.co *= PR * 0.95 / d
        v.co.z = ZR - 0.07 + 0.025 * math.sin(v.co.x * 17) * math.cos(v.co.y * 13) + 0.02 * (1 - d / PR)
    B.part("putty", bm, M["putty"], root, line=None)

    # ---- the stirrer: a gold crank standing in the putty, going round while producing (as Flash's animation, every look)
    piv = B.mover("stir_pivot", root, L.bear(45, 0.0 if lk == 1 else 0.14, ZR - 0.06))
    sh = 0.3 if lk == 1 else 0.2                       # its shaft above the putty (lower under the arms)
    bm = bmesh.new()
    arm = 0.13
    L.tube(bm, rounded_crank(sh, arm), [0.022] * len(rounded_crank(sh, arm)), sides=10)
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.035,
                              matrix=Matrix.Translation((arm, 0.0, sh + 0.12)))
    B.disc(bm, 0.05, 0.03, Matrix.Translation((0, 0, 0.04)), segs=16)       # a collar where it meets the putty
    B.part("stirrer", bm, M["gold"], piv, line="cool", k=0.6)
    movers["stir"] = piv

    # ---- the hand wheel on the left side, turning
    hb = 120 if lk < 6 else 135
    hr = 0.11 if lk < 6 else 0.15
    out = L.bear(hb)
    hc = L.bear(hb, PR + (0.1 if lk < 6 else 0.14), Z0 + PH * (0.45 if lk == 1 else 0.62))
    bm = bmesh.new()
    L.tube(bm, [L.bear(hb, PR - 0.02, hc.z), hc], [0.025, 0.025], sides=8)
    B.part("wheel_axle", bm, M["brass"], root, line="cool", k=0.6)
    piv = B.mover("hand_pivot", root, hc, axis=out)
    bm = bmesh.new()
    handwheel(bm, hr, Matrix())
    B.part("handwheel", bm, M["gold" if lk >= 6 else "brass"], piv, line="cool", k=0.6)
    movers["hand"] = piv

    # ---- the test tube, its brass arm from the rim
    tb = 352 if lk == 1 else 0
    tc = L.bear(tb, PR + (0.28 if lk == 1 else 0.2), 0.0 if lk == 1 else Z0 - 0.02)
    tl = 0.42 if lk == 1 else 0.5
    tube = W.lathe("ttube", [[(0.0, 0.0), (0.05, 0.015), (0.065, 0.06), (0.065, tl * 0.72)],
                             [(0.065, tl * 0.72), (0.065, tl)]], [M["putty"], M["glass"]], mat_of_seg=[0, 1],
                   parent=root, n=32, bev=0)
    tube.matrix_basis = Matrix.Translation(tc)
    L.add_outline(tube, L.line("cool"))
    bm = bmesh.new()
    B.disc(bm, 0.08, 0.06, Matrix.Translation(tc + Vector((0, 0, tl + 0.02))), segs=16)
    B.disc(bm, 0.05, 0.05, Matrix.Translation(tc + Vector((0, 0, tl + 0.07))), segs=12, r2=0.035)
    a = L.bear(tb - 20, PR * 0.9, ZR + 0.02)
    b = tc + Vector((0, 0, tl + 0.08))
    L.tube(bm, L.bezier(a, a + Vector((0, 0, 0.1)), b + Vector((0, 0, 0.12)), b, 10), [0.022] * 10, sides=8)
    B.disc(bm, 0.045, 0.05, Matrix.Translation((a + b) / 2 + Vector((0, 0, 0.1))) @ B.along(b - a), segs=12)
    B.part("ttube_arm", bm, M["brass"], root, line="cool", k=0.7)

    if lk == 1:
        # ---- the press block on the left rim
        bm = bmesh.new()
        c = L.bear(150, PR * 0.7, ZR - 0.05)
        m = Matrix.Translation(c) @ Matrix.Rotation(math.radians(-150 + 90), 4, 'Z')
        L.rbox(bm, (0.32, 0.22, 0.2), m @ Matrix.Rotation(math.radians(-8), 4, 'X'), bevel=0.04, segs=2)
        B.part("press", bm, M["bone"], root)
        bm = bmesh.new()
        for u in (-0.08, 0.05):
            B.disc(bm, 0.035, 0.02, m @ Matrix.Rotation(math.radians(-8), 4, 'X') @ Matrix.Translation((u, 0.0, 0.2)),
                   segs=12)
        B.part("press_holes", bm, M["dark"], root, line=None)
    else:
        # ---- the frame: purple posts at the corners, a square round the foot and one round the rim; the log stumps
        S = PR * 0.98
        LG = Z0
        bm = bmesh.new()
        for sx in (-1, 1):
            for sy in (-1, 1):
                L.tube(bm, [Vector((sx * S, sy * S, LG - 0.04)), Vector((sx * S, sy * S, ZR + 0.06))], [0.06, 0.055],
                       sides=12)
                Q = Vector((sx * S, sy * S, ZR + 0.06))
                bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=6, radius=0.065,
                                          matrix=Matrix.Translation(Q))
        for z in (LG + 0.02, ZR - 0.12):
            cs = [Vector((S, S, z)), Vector((-S, S, z)), Vector((-S, -S, z)), Vector((S, -S, z))]
            for i in range(4):
                L.tube(bm, [cs[i], cs[(i + 1) % 4]], [0.04, 0.04], sides=10, flat=0.7)
        B.box(bm, -S, S, -S, S, LG - 0.02, LG + 0.03, bevel=0.02)
        B.part("frame", bm, M["purple"], root)
        bm = bmesh.new()
        cs, ns = [], []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for z in (LG + 0.02, ZR - 0.12):
                    cs += [Vector((sx * (S + 0.05), sy * S, z)), Vector((sx * S, sy * (S + 0.05), z))]
                    ns += [(sx, 0, 0), (0, sy, 0)]
        W.bolts(bm, cs, ns, r=0.025)
        B.part("frame_bolts", bm, M["steel"], root, line="cool", k=0.5)
        bm = bmesh.new()
        for sx in (-1, 1):
            for sy in (-1, 1):
                h = LG - (0.12 if lk == 10 else 0.0)
                B.disc(bm, 0.075, h, Matrix.Translation((sx * S * 0.92, sy * S * 0.92, h / 2)), segs=14, r2=0.07)
        B.part("stumps", bm, M["stump"], root)
        if lk == 10:                                   # steel springs between the stumps and the frame
            bm = bmesh.new()
            for sx in (-1, 1):
                for sy in (-1, 1):
                    c = Vector((sx * S * 0.92, sy * S * 0.92, 0))
                    z0, z1 = LG - 0.13, LG - 0.02
                    pts = [c + Vector((0.085 * math.cos(t), 0.085 * math.sin(t), z0 + (z1 - z0) * t / (6 * math.pi)))
                           for t in (i * 6 * math.pi / 60 for i in range(61))]
                    L.tube(bm, pts, [0.018] * len(pts), sides=6)
            B.part("springs", bm, M["steel"], root, line="cool", k=0.6)

        # ---- the squisher: a press block on the left rim, two pale arched arms hinged at the right, rocking
        pb = 135                                       # the press end (screen left)
        hb_ = 315                                      # the hinge end (screen right)
        bm = bmesh.new()
        c = L.bear(pb, PR * 0.78, ZR - 0.02)
        m = Matrix.Translation(c) @ Matrix.Rotation(math.radians(-pb), 4, 'Z')
        L.rbox(bm, (0.36, 0.2, 0.16), m, bevel=0.04, segs=2)
        B.part("press", bm, M["bone"], root)
        bm = bmesh.new()
        for u in (-0.1, 0.0, 0.1):
            B.disc(bm, 0.03, 0.02, m @ Matrix.Translation((u, 0.0, 0.16)), segs=12)
        B.part("press_holes", bm, M["dark"], root, line=None)
        hinge = L.bear(hb_, PR * 0.85, ZR + 0.1)
        side = L.bear(45)                              # the arms' axis: across, toward the viewer
        bm = bmesh.new()
        L.tube(bm, [hinge - side * 0.22, hinge + side * 0.22], [0.045, 0.045], sides=12)
        B.box(bm, hinge.x - 0.06, hinge.x + 0.06, hinge.y - 0.06, hinge.y + 0.06, ZR - 0.1, hinge.z, bevel=0.02)
        B.part("hinge", bm, M["brass"], root, line="cool", k=0.7)
        piv = B.mover("arms_pivot", root, hinge, axis=side)
        span = (L.bear(pb, PR * 0.78) - L.bear(hb_, PR * 0.85)).length
        dirv = (L.bear(pb) - L.bear(hb_)).normalized()
        # the arms, built in the pivot's frame: the pivot's z is `side`; find the in-plane way to the press end
        inv = piv.matrix_basis.to_3x3().inverted()
        dl, up = inv @ dirv, inv @ Vector((0, 0, 1))
        sl = inv @ side
        bm = bmesh.new()
        arch_h = 0.34 if lk == 3 else 0.4
        for off in (-0.1, 0.1):
            pts = []
            for i in range(17):
                t = i / 16
                pts.append(dl * span * t + up * (arch_h * math.sin(math.pi * t) - 0.12 * t) + sl * off)
            L.tube(bm, pts, [0.06 - 0.01 * math.sin(math.pi * t) for t in (i / 16 for i in range(17))], sides=10,
                   flat=0.55)
        L.rbox(bm, (0.14, 0.14, 0.1), Matrix.Translation(dl * span - up * 0.2), bevel=0.03, segs=2)   # the pad
        B.part("arms", bm, M["bone"], piv)
        if lk >= 6:                                    # the hub on the arms' crown
            bm = bmesh.new()
            B.disc(bm, 0.09, 0.3, Matrix.Translation(dl * span * 0.5 + up * arch_h), segs=20)
            B.part("arms_hub", bm, M["bone"], piv)
            bm = bmesh.new()
            B.disc(bm, 0.045, 0.32, Matrix.Translation(dl * span * 0.5 + up * arch_h), segs=14)
            B.part("arms_hub_eye", bm, M["dark"], piv, line=None)
            hc = dl * span * 0.5 + up * arch_h
            # on the hub, as Flash: a purple flask with a straight glass neck on top, a gold valve wheel on its front end
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=0.075,
                                      matrix=Matrix.Translation(hc + up * 0.15 - dl * 0.03))
            B.part("flask", bm, M["putty"], piv, line="cool", k=0.6)
            bm = bmesh.new()
            n0 = hc + up * 0.2 - dl * 0.03
            L.tube(bm, [n0, n0 + up * 0.24], [0.026, 0.026], sides=12)
            B.disc(bm, 0.034, 0.04, Matrix.Translation(n0 + up * 0.25) @ B.along(up), segs=14, mat=1)
            B.part("flask_neck", bm, [M["glass"], M["steel"]], piv, line="cool", k=0.5)
            bm = bmesh.new()
            L.tube(bm, [hc + sl * 0.14, hc + sl * 0.21], [0.02, 0.02], sides=8)
            B.part("valve_axle", bm, M["brass"], piv, line="cool", k=0.5)
            bm = bmesh.new()
            handwheel(bm, 0.13, Matrix.Translation(hc + sl * 0.21) @ B.along(sl))
            B.part("valve_wheel", bm, M["gold"], piv, line="cool", k=0.6)
        movers["arms"] = piv

        if lk == 10:
            # ---- the big gold wheel behind at the right, purple spokes with putty on them, turning
            wc = L.bear(305, PR * 0.75, ZR + 0.32)
            wax = L.bear(60)
            piv = B.mover("bigwheel_pivot", root, wc, axis=wax)
            R = 0.42
            bm = bmesh.new()
            ring = [Vector((R * math.cos(t), R * math.sin(t), 0)) for t in (i * 2 * math.pi / 40 for i in range(41))]
            L.tube(bm, ring, [0.03] * 41, sides=8, cap=False)
            ring2 = [Vector((R * 0.55 * math.cos(t), R * 0.55 * math.sin(t), 0)) for t in
                     (i * 2 * math.pi / 30 for i in range(31))]
            L.tube(bm, ring2, [0.02] * 31, sides=6, cap=False)
            B.disc(bm, 0.07, 0.12, Matrix(), segs=16)
            B.part("bigwheel", bm, M["gold"], piv, line="cool", k=0.7)
            bm = bmesh.new()
            for k in range(8):
                a = 2 * math.pi * k / 8
                L.tube(bm, [Vector((0, 0, 0)), Vector((R * math.cos(a), R * math.sin(a), 0))], [0.024, 0.02], sides=8)
            B.part("bigwheel_spokes", bm, M["purple"], piv, k=0.7)
            bm = bmesh.new()
            for k in range(8):
                a = 2 * math.pi * (k + 0.5) / 8
                c = Vector((R * 0.78 * math.cos(a), R * 0.78 * math.sin(a), 0))
                s = bmesh.new()
                bmesh.ops.create_icosphere(s, subdivisions=2, radius=1.0)
                for v in s.verts:
                    v.co *= 1 + 0.25 * math.sin(v.co.x * 4 + k) * math.cos(v.co.y * 3)
                L.add_mesh(bm, s, Matrix.Translation(c) @ Matrix.Diagonal((0.06, 0.06, 0.05, 1)))
            B.part("bigwheel_putty", bm, M["putty"], piv, line="cool", k=0.6)
            bm = bmesh.new()                           # its stand: a brass strut from the frame's back corner
            L.tube(bm, [Vector((-S, S, ZR - 0.1)), wc - wax * 0.08], [0.035, 0.03], sides=8)
            L.tube(bm, [Vector((-S, -S * 0.2, ZR - 0.1)), wc - wax * 0.08], [0.03, 0.03], sides=8)
            B.part("bigwheel_stand", bm, M["brass"], root, line="cool", k=0.7)
            movers["big"] = piv
            # ---- the steel coil and its bulb at the left
            cc = L.bear(180, PR * 0.9, ZR + 0.25)
            bm = bmesh.new()
            pts = [cc + Vector((0.09 * math.cos(t), 0.0, 0.09 * math.sin(t))) + L.bear(270, 0.05 * t / (2 * math.pi))
                   for t in (i * 6 * math.pi / 90 for i in range(91))]
            L.tube(bm, [L.bear(180, PR * 0.9, ZR - 0.1), cc - Vector((0.09, 0, 0))] + pts, [0.016] * (len(pts) + 2),
                   sides=6)
            B.part("coil", bm, M["steel"], root, line="cool", k=0.5)
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=0.075,
                                      matrix=Matrix.Translation(L.bear(150, PR * 1.05, ZR + 0.12)))
            B.part("coil_bulb", bm, M["putty"], root, line="cool", k=0.6)

    def animate(phase):
        B.spin(movers["stir"], 'Z', phase)             # one whole turn a loop
        B.spin(movers["hand"], 'Z', 0.5 * phase)       # 4 spokes and a knob: half a turn a loop shows the knob go round
        if "arms" in movers:                           # two squishes a loop: lift slowly, drop fast
            k = phase * 2 % 1.0
            h = (k / 0.7) if k < 0.7 else (1 - (k - 0.7) / 0.3)
            B.spin(movers["arms"], 'Z', -0.035 * (0.5 - 0.5 * math.cos(math.pi * h)))
        if "big" in movers:
            B.spin(movers["big"], 'Z', 0.25 * phase)   # 8 spokes: a quarter turn is seamless
    return root, animate


if __name__ == "__main__":
    B.run("putty", build, HERE)
