"""spurtz3d.py : the Spurtz Cannon (136, T=1) and the Black Spurtz Cannon (137, T=2) as 3D models in the game's camera
(buildings-3d-2, 28 Oct 2026). They have no painted repaint, so they are modelled on the Flash art
(server/public/assets/buildings/spurtztower/ and blackspurtztower/: normal_base.png and top-normal-anim.v2.png).

  blender -b --factory-startup -P spurtz3d.py -- T body | turret [h ...] | full H | aim | clash | save

(see ../tower-3d/square3d.py for the modes; the round foot uses the same camera, scale and canvases as the square towers,
its radius 1 = half the Flash base's 75 px). The body: a low round platform (red with white patches and big bolt heads;
the Black one a taller black bell), a corrugated hose coiled round a tall pipe, two canisters at the front, a collar on
top of the pipe. The turret: a ball with a red eye and a flared nozzle, held level (the one fixed tilt), turning on the
collar.
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
L.EL = float(os.environ.get("SPURTZ_EL", 30.0))
import square3d as Q  # noqa: E402
from look3d import add_outline, bear, lathe, mat_flat, obj_from_bm, srgb, studs, tube  # noqa: E402

L.METALS.update(
    red=((84, 8, 10), (196, 34, 30), (250, 120, 100), (1.0, 0.85, 0.8, 1)),
    olive=((26, 28, 12), (98, 100, 56), (172, 172, 112), (0.92, 0.95, 0.8, 1)),      # the hose's army green
    lilac=((40, 34, 54), (118, 108, 138), (204, 196, 220), (0.95, 0.95, 1.0, 1)),     # the pipe's purple grey
    cream=((96, 84, 62), (222, 212, 186), (255, 250, 236), (1.0, 0.98, 0.92, 1)),     # the canisters
    chrome=((30, 32, 40), (130, 134, 150), (236, 240, 250), (1.0, 1.0, 1.0, 1)),
    pblack=((8, 6, 10), (36, 32, 40), (96, 92, 112), (0.82, 0.88, 1.0, 1)),
)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
BLACK = TIER == 2
PLAT_H = 0.42 if BLACK else 0.36         # the platform's top (the pipe and canisters stand on it)
TOP = 1.96 if BLACK else 1.9            # the collar's top: the head turns on it


def mat_patches(name):
    """The Spurtz platform's paint: red with big white patches, a little worn."""
    p = L.Paint(name)
    patch = p.ramp(p.noise(3.2, 3.0, 0.55), [(0.57, (0, 0, 0, 1)), (0.59, (1, 1, 1, 1))])
    paint = p.mix(srgb(196, 30, 28), srgb(236, 226, 214), patch)
    grime = p.ramp(p.noise(3.0, 4.0), [(0.3, (0.82, 0.8, 0.8, 1)), (0.7, (1, 1, 1, 1))])
    return p.finish(p.mix(paint, grime, 1.0, 'MULTIPLY'), spec=0.45, spec_rough=0.3, shade=L.WARM_SHADE)


def materials():
    met = L.mat_metal
    k = (lambda a, b: b) if BLACK else (lambda a, b: a)
    return dict(
        plat=met("plat", "gunmetal", spec=1.0, polish=0.6) if BLACK else mat_patches("plat"),
        dish=met("dish", k("red", "pblack"), spec=0.8, polish=0.4),
        bolt=met("bolt", k("steel", "chrome"), spec=1.0, wear=0.2),
        hose=met("hose", k("olive", "pblack"), spec=0.8, polish=0.3, wear=0.2),
        pipe=met("pipe", k("lilac", "pblack"), spec=1.0),
        collar=met("collar", k("red", "pblack"), spec=1.0),
        can=met("can", k("cream", "pblack"), spec=1.0, wear=0.3),
        band=met("band", k("steel", "chrome"), spec=1.0),
        ball=met("ball", k("chrome", "pblack"), spec=1.0, polish=1.0),
        nozzle=met("nozzle", k("pblack", "chrome"), spec=1.0, polish=1.0),
        bore=mat_flat("bore", (16, 14, 18), spec=0.15),
        port=mat_flat("port", (30, 26, 30), spec=0.6),
        eye=L.mat_glass_lamp("eye", core=(255, 200, 190), mid=(250, 40, 30), rim=(150, 0, 0)),
    )


def build():
    L.clear_scene()
    M = materials()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    if BLACK:                              # black paint takes the cool line everywhere
        LN["warm"] = LN["cool"]
    body = L.empty("BODY")

    # ---- the platform: a round foot with a rolled top edge and a shallow dish (the Black: a taller bell)
    if BLACK:
        prof = [(0.97, 0.0), (0.98, 0.05), (0.96, 0.17), (0.88, 0.25), (0.86, 0.34), (0.82, PLAT_H), (0.76, PLAT_H + 0.01)]
    else:
        prof = [(0.9, 0.0), (0.93, 0.03), (0.94, 0.2), (0.91, 0.3), (0.85, PLAT_H), (0.78, PLAT_H + 0.01)]
    plat = lathe("plat", [prof, [prof[-1], (prof[-1][0] - 0.04, PLAT_H - 0.03), (0.0, PLAT_H - 0.03)]],
                 [M["plat"], M["dish"]], mat_of_seg=[0, 1], parent=body, sharp=35)
    add_outline(plat, LN["warm"])
    # the big bolt heads round the side, a slot across each
    bolts = bmesh.new()
    n = 10
    zb, rb = (0.17, 0.94) if not BLACK else (0.1, 0.975)
    for i in range(n):
        b = 360 * i / n + 8
        c = bear(b, rb, zb)
        out = bear(b)
        m = Matrix.Translation(c) @ Vector((0, 0, 1)).rotation_difference(out).to_matrix().to_4x4()
        Q.cyl(bolts, 0.12, 0.07, m, segs=20, r2=0.1)
    obj_from_bm("bolts", bolts, [M["bolt"]], parent=body)
    if BLACK:                              # a second ring of rivets up the bell
        bm = bmesh.new()
        cc, nn = L.ring_of(22, 0.875, 0.3, 0.5)
        studs(bm, cc, [v + Vector((0, 0, 0.6)) for v in nn], r=0.03)
        obj_from_bm("rivets", bm, [M["bolt"]], parent=body)

    # ---- the pipe, up the middle to the collar
    pz = PLAT_H - 0.04
    pipe = lathe("pipe", [[(0.0, pz), (0.12, pz), (0.12, TOP - 0.2), (0.14, TOP - 0.18)]], [M["pipe"]], parent=body)
    add_outline(pipe, LN["cool"])
    # ---- the hose: a corrugated tube coiled round the pipe, from the platform up most of the way
    turns, z0, z1, R, rt = 3.4, PLAT_H + 0.12, TOP - 0.55, 0.3, 0.15
    hc_ = bear(170, 0.18)                                      # the coil's middle: a little left of the pipe
    pts, radii = [], []
    steps = 360
    for i in range(steps + 1):
        t = i / steps
        a = math.radians(225) + t * turns * 2 * math.pi        # it starts at the back
        r = R * (1.12 - 0.22 * t)                               # a little narrower up top
        pts.append((hc_.x + r * math.sin(a), hc_.y + r * math.cos(a), z0 + (z1 - z0) * t))
        radii.append(rt * (0.9 + 0.1 * math.cos(i * 2 * math.pi / 4.5)))   # the ribs
    bm = bmesh.new()
    tube(bm, pts, radii, sides=14)
    # its tail down onto the platform at the back
    tail = L.bezier(pts[0], (pts[0][0] * 1.5, pts[0][1] * 1.5, z0 - 0.02), (-0.6, -0.6, PLAT_H + 0.06), (-0.66, -0.66, PLAT_H))
    tube(bm, tail, [rt * (0.9 + 0.1 * math.cos(i * 2 * math.pi / 2.2)) for i in range(len(tail))], sides=14)
    hose = obj_from_bm("hose", bm, [M["hose"]], parent=body, sharp=60)
    add_outline(hose, LN["warm"])

    # ---- the collar the head turns on
    cz = TOP - (0.3 if BLACK else 0.2)       # the Black's collar is a tall cone
    collar = lathe("collar", [[(0.14, cz), (0.17, cz), (0.3 if BLACK else 0.2, TOP - 0.02), (0.28 if BLACK else 0.18, TOP),
                               (0.0, TOP)]], [M["collar"]], parent=body, sharp=35)
    add_outline(collar, LN["warm"])

    # ---- the two canisters at the front, a dark porthole on each and a band round the foot
    cans, bands, ports = bmesh.new(), bmesh.new(), bmesh.new()
    for (b, d) in ((-32, 0.46), (24, 0.38)):
        c = bear(b, d, PLAT_H - 0.02)
        rc, hc = 0.2, 0.66
        sub = bmesh.new()
        prof = [(rc, 0.0), (rc, hc - 0.05), (rc - 0.02, hc - 0.01), (rc - 0.06, hc), (0.0, hc)]
        ring = [[sub.verts.new((r * math.cos(2 * math.pi * j / 32), r * math.sin(2 * math.pi * j / 32), z))
                 for j in range(32)] for r, z in prof]
        for i in range(len(ring) - 1):
            for j in range(32):
                sub.faces.new((ring[i][j], ring[i][(j + 1) % 32], ring[i + 1][(j + 1) % 32], ring[i + 1][j]))
        bmesh.ops.remove_doubles(sub, verts=sub.verts, dist=1e-5)
        L.add_mesh(cans, sub, Matrix.Translation(c))
        Q.cyl(bands, rc + 0.015, 0.06, Matrix.Translation(c + Vector((0, 0, 0.08))), segs=32)
        Q.cyl(bands, rc + 0.012, 0.04, Matrix.Translation(c + Vector((0, 0, hc - 0.12))), segs=32)
        out = bear(45)                      # the porthole faces the viewer
        m = Matrix.Translation(c + out * (rc - 0.005) + Vector((0, 0, 0.3))) @ \
            Vector((0, 0, 1)).rotation_difference(out).to_matrix().to_4x4()
        Q.cyl(ports, 0.07, 0.03, m, segs=20)
        Q.cyl(ports, 0.09, 0.03, Matrix.Translation(c + Vector((0, 0, hc))), segs=20)
    add_outline(obj_from_bm("cans", cans, [M["can"]], parent=body, sharp=35), LN["warm"])
    add_outline(obj_from_bm("can_bands", bands, [M["band"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    obj_from_bm("ports", ports, [M["port"]], parent=body, sharp=35)

    # ---- the turret, built facing +Y (bearing 0): the ball, its eye, the nozzle held level
    tur = L.empty("TURRET", loc=(0, 0, TOP + 0.004))
    RB = 0.24
    HZ = RB + 0.006                        # the ball sits on the collar (a socket, not sunk in it)
    bm = bmesh.new()
    Q.ball(bm, (0, 0, HZ), RB, segs=32)
    ball = obj_from_bm("ball", bm, [M["ball"]], parent=tur)
    add_outline(ball, LN["cool"])
    bm = bmesh.new()
    eye = bear(-70, 1.0) * RB * 0.93 + Vector((0, 0, HZ + 0.06))     # on its side, as in the Flash frames
    Q.ball(bm, eye, 0.05, segs=12)
    obj_from_bm("lens_eye", bm, [M["eye"]], parent=tur)
    # the nozzle: a neck out of the ball, then a flared bell; level (one fixed tilt), its mouth open
    neck0, neck1, bell1 = RB * 0.6, RB + 0.12, RB + 0.42
    prof = [(0.1, neck0), (0.1, neck1), (0.12, neck1 + 0.04), (0.15, neck1 + 0.12), (0.2, bell1 - 0.08), (0.23, bell1 - 0.02),
            (0.24, bell1)]
    inner = [(0.24, bell1), (0.205, bell1), (0.17, bell1 - 0.06), (0.1, neck1 + 0.06), (0.0, neck1 + 0.04)]
    noz = lathe("nozzle", [prof, inner], [M["nozzle"], M["bore"]], mat_of_seg=[0, 1], parent=tur, sharp=35, n=48)
    noz.matrix_basis = Matrix.Translation((0, 0, HZ)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')   # lathe z -> +Y
    add_outline(noz, LN["cool"])
    rim = lathe("nozzle_rim", [L.band(0.1, 0.13, neck1 - 0.06, neck1 + 0.01)], [M["band"]], parent=tur, sharp=35, n=48)
    rim.matrix_basis = noz.matrix_basis
    add_outline(rim, LN["cool"], L.LINE * 0.6)
    L.empty("muzzle_base", parent=tur, loc=(0, 0.0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, bell1, HZ))
    return body, tur, TOP


Q.run("spurtz", build, TIER, HERE, turret_canvas=(400, 360, 200, 200), args=ARGS[1:],
      solid=("collar", "pipe", "hose", "cans", "plat"))
