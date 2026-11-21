"""lab.py : the Infernal Monster Lab (beta 9, a new Inferno building: research for the Inferno's monsters) in 3D.
FIRST LOOKS: three level-1 design directions for the owner to pick from (21 Nov 2026). There is no Flash picture
of this building; it is the Inferno cousin of the surface Monster Lab (116: glass vessels, brew, pipes) and takes
that building's footprint and origin. The camera, light and render modes are the Inferno kit's (../kit.py),
untouched, as the Incubator's, Strongbox's and Academy's.

    LAB_DIR=a|b|c blender -b --factory-startup -P lab.py -- 1 <fit|base|check|gap>     (run.sh takes the GPU lock)

  a  "Brimstone Still": a cracked basalt hex plinth (the surface lab's hex plan), a big glass flask of green brew
     in iron claws over a lava fire bowl, a copper coil and pipe to a small side flask. Levels 2/3: more side
     flasks on the capped brass sockets, a taller coil, horns.
  b  "Tube Furnace": a riveted iron furnace with a lit firebox and three giant test tubes in a rack held by two
     tusks. Levels 2/3: more tubes in the capped sockets, a side boiler, a crown.
  c  "Specimen Tank": a tall glass tank of violet fluid with a specimen in it, held in a ribcage of bone on a
     basalt crag that bleeds lava. Levels 2/3: side tanks on the iron pads, more ribs, a horned crown.

World: Z up. The camera looks from +X -Y: +X is the front right on screen, -Y the front left, (1, 1) screen right.
Azimuths are from +X toward +Y.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import kit  # noqa: E402
import imats  # noqa: E402

DIRN = os.environ.get("LAB_DIR", "a")
kit.OUT = HERE / DIRN
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (0.0, 45.0)                 # the surface Monster Lab's origin (lab-v1/lab.py: (-0.5, 45))
kit.FRAME = (-86, -104, 126, 82)         # the surface Monster Lab's canvas (room on the right for the shadow)
kit.FRAMES = 1
kit.SUN_COL = (1.0, 0.93, 0.82)          # as the Incubator, Strongbox and Academy
rnd = random.Random(116)
GLOW = (255, 120, 24)
M = {}


# ------------------------------------------------------------------------------------------------------- helpers
def D(az, el=0.0):
    a, e = math.radians(az), math.radians(el)
    return Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)))


def P(az, r, z=0.0):
    a = math.radians(az)
    return Vector((r * math.cos(a), r * math.sin(a), z))


U = Vector((1, 1, 0)).normalized()       # screen right
V = Vector((1, -1, 0)).normalized()      # toward the camera on the ground


def aim(ob, d):
    ob.rotation_euler = Vector(d).to_track_quat("Z", "Y").to_euler()
    return ob


def ball(name, at, r, mat, squash=1.0, seg=40):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    for v in bm.verts:
        v.co.z *= squash
    ob = kit.mesh_ob(name, bm, [mat])
    ob.location = at
    return ob


def spike(name, at, d, length, r, mat, r2=0.0):
    return aim(kit.cyl(name, r, length, at, mat, verts=16, bevel=0.0, r2=r2), d)


def rod(name, a, b, r, mat, verts=16, bevel=0.02):
    a, b = Vector(a), Vector(b)
    return aim(kit.cyl(name, r, (b - a).length, a, mat, verts=verts, bevel=bevel), b - a)


def hexa(name, r, z0, z1, mat, bevel=0.08, rot=-15.0):
    """A hex prism with one face square to the camera (as the surface Monster Lab's decks)."""
    return kit.cyl(name, r, z1 - z0, (0, 0, z0), mat, rot=(0, 0, rot), verts=6, bevel=bevel)


def flask(name, at, R, neck_r, neck_h, mat, lip=0.12):
    """A round-bottomed flask: a ball of radius R centred on `at`, a straight neck up, a rolled lip."""
    prof = []
    a1 = math.asin(neck_r / R)
    n = 28
    z_n = R * math.cos(a1)
    for i in range(n + 1):
        a = math.pi - (math.pi - a1) * i / n          # polar angle from +Z: pi (bottom) .. a1 (neck)
        prof.append((max(0.0, R * math.sin(a)), R * math.cos(a)))
    prof += [(neck_r, z_n + neck_h * 0.5), (neck_r, z_n + neck_h), (neck_r + lip, z_n + neck_h + lip * 0.6),
             (neck_r + lip, z_n + neck_h + lip * 1.4), (neck_r * 0.8, z_n + neck_h + lip * 1.4)]
    ob = kit.lathe(name, prof, at, mat, verts=48)
    return ob, at[2] + z_n + neck_h + lip * 1.4


def rivets(name, pts, r=0.09, mat=None):
    for i, p in enumerate(pts):
        ball(f"{name}{i}", p, r, mat or M["brass"], squash=0.7, seg=12)


def horn(name, pts, r, mat, r_end=0.03):
    return kit.tube(name, [tuple(p) for p in pts], r, mat, verts=16, r_end=r_end, smooth=True)


def lump(name, at, size, mat, seed, squash=0.6):
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1 + rr.uniform(-0.18, 0.18)
        v.co.x *= size * k
        v.co.y *= size * k * rr.uniform(0.85, 1.15)
        v.co.z *= size * k * squash
    ob = kit.mesh_ob(name, bm, [mat])
    ob.location = at
    ob.rotation_euler = (0, 0, rr.uniform(0, 6.28))
    return ob


def foot_rocks(r, n, seed, lo=0.3, hi=0.55, skip=()):
    for k in range(n):
        th = k * 360 / n + rnd.uniform(-4, 4)
        if any(a <= th % 360 <= b for a, b in skip):
            continue
        lump("footrock", P(th, r + rnd.uniform(-0.12, 0.15), 0.05), rnd.uniform(lo, hi), M["stone"], seed=seed + k)


def socket(name, at, r=0.7):
    """A capped brass socket: where a later level's vessel is mounted."""
    kit.cyl(name + "-flange", r, 0.22, at, M["brass"], verts=24, bevel=0.04)
    kit.cyl(name + "-cap", r * 0.68, 0.2, Vector(at) + Vector((0, 0, 0.22)), M["iron"], verts=6, bevel=0.03)
    rivets(name + "-bolt", [Vector(at) + P(a, r * 0.84, 0.22) for a in range(0, 360, 60)], r=0.06, mat=M["iron"])


def bubbles(name, at, r, h, n, col, seed):
    rr = random.Random(seed)
    m = kit.flat(name + "-m", col, rough=0.2, emit=2.2)
    for i in range(n):
        a, q = rr.uniform(0, 6.28), rr.uniform(0.1, 0.7) * r
        ball(f"{name}{i}", Vector(at) + Vector((q * math.cos(a), q * math.sin(a), rr.uniform(0.15, 1.0) * h)),
             rr.uniform(0.07, 0.16), m, seg=12)


def mats():
    P_ = kit.painted
    M["basalt"] = imats.rock("lab-basalt", (34, 30, 30), (66, 60, 56), crack=GLOW, crack_scale=1.2, crack_cover=0.55,
                             glow=6.0)
    M["crag"] = imats.rock("lab-crag", (34, 30, 30), (66, 60, 56), crack=GLOW, crack_scale=0.8, crack_cover=0.4,
                           glow=6.0)
    M["stone"] = imats.rock("lab-stone", (34, 30, 30), (66, 60, 56), scale=2.5)
    M["lava"] = imats.magma("lab-lava", crust_at=0.47, strength=3.0, scale=0.9)
    M["lavahot"] = imats.magma("lab-lavahot", strength=3.2, scale=1.6)
    M["hot"] = kit.flat("lab-hot", (255, 110, 22), rough=0.4, emit=4.0)
    M["iron"] = P_("lab-iron", (62, 58, 62), rough=0.42, metal=0.85, wear=(92, 86, 84), scale=2.0, dirt=0.3, soot=0.5)
    M["plate"] = P_("lab-plate", (78, 70, 70), rough=0.46, metal=0.8, wear=(108, 98, 92), rust=(96, 54, 34), scale=2.4,
                    dirt=0.35, soot=0.55, rust_at=0.66)
    M["brass"] = P_("lab-brass", (168, 108, 46), rough=0.34, metal=0.9, wear=(116, 72, 30), scale=2.0, dirt=0.4,
                    soot=0.3)
    M["copper"] = P_("lab-copper", (196, 100, 56), rough=0.3, metal=0.92, wear=(140, 70, 40), rust=(84, 140, 112),
                     scale=3.0, dirt=0.25, rust_at=0.7)
    M["bone"] = imats.bone("lab-bone", z0=4.0, z1=14.0)      # the tusks: charred toward their tips
    M["bonelow"] = imats.bone("lab-bonelow")
    M["green"] = imats.brew("lab-green", (22, 86, 20), (70, 170, 36), (168, 240, 60), (226, 255, 150))
    M["violet"] = imats.brew("lab-violet", (62, 18, 96), (130, 44, 176), (206, 110, 240), (240, 190, 255), scale=1.6)
    M["glass"] = imats.glass("lab-glass")
    M["dark"] = kit.flat("lab-dark", (16, 12, 12), rough=0.9)


# ------------------------------------------------------------------------------------------------ a: the still
def dir_a():
    ZP, ZD = 1.25, 1.6
    pl = hexa("plinth", 5.9, 0.0, ZP, M["basalt"], bevel=0.2)
    imats.roughen(pl, strength=0.16, size=0.8, levels=4)
    hexa("deck", 5.05, ZP - 0.1, ZD, M["iron"], bevel=0.06)
    hexa("deckband", 5.16, ZP + 0.06, ZP + 0.24, M["brass"], bevel=0.04)
    foot_rocks(6.15, 16, 300, lo=0.42, hi=0.7)
    for i in range(6):                                           # a spike on a brass seat at each corner
        az = -15 + 60 * i
        kit.cyl(f"seat{i}", 0.42, 0.22, P(az, 4.45, ZD), M["brass"], verts=16)
        spike(f"spike{i}", P(az, 4.45, ZD + 0.2), D(az, 72), 1.35, 0.3, M["iron"])
    rivets("deckrivet", [P(-15 + 60 * i + s, 4.72 if s else 4.72, ZD) for i in range(6) for s in (15, 30, 45)], r=0.08)
    # the fire bowl under the flask
    kit.lathe("bowl", [(1.5, ZD), (2.35, ZD + 0.55), (2.5, ZD + 1.15), (2.25, ZD + 1.15), (2.1, ZD + 0.75),
                       (0.0, ZD + 0.7)], (0, 0, 0), M["iron"], verts=48)
    kit.ring("bowlrim", 2.4, 0.11, M["brass"], z=ZD + 1.15)
    kit.lathe("bowllava", [(0.0, ZD + 0.98), (2.2, ZD + 0.98)], (0, 0, 0), M["lava"], verts=48)
    # the flask of brew, in four iron claws
    ZC, R = 5.55, 2.6
    _, top = flask("flask", (0, 0, ZC), R, 0.78, 0.95, M["green"])
    for i, az in enumerate((20, 110, 200, 290)):
        kit.tube(f"claw{i}", [tuple(P(az, 3.5, ZD - 0.05)), tuple(P(az, 3.75, 3.2)), tuple(P(az, 3.35, 4.9)),
                              tuple(P(az, R + 0.1, ZC + 0.5)), tuple(P(az, R - 0.45, ZC + 1.55))],
                 0.3, M["iron"], verts=16, r_end=0.13, smooth=True)
        kit.cyl(f"clawfoot{i}", 0.42, 0.2, P(az, 3.5, ZD), M["brass"], verts=16)
    kit.ring("girdle", R + 0.08, 0.1, M["iron"], z=ZC + 0.45)
    # collar, stopper, horns
    zn = ZC + R * math.cos(math.asin(0.78 / R))
    kit.cyl("collar", 0.98, 0.4, (0, 0, zn + 0.2), M["brass"], verts=32, bevel=0.05)
    kit.cyl("stopper", 0.72, 0.45, (0, 0, top - 0.05), M["iron"], verts=24, bevel=0.06)
    for s in (1, -1):
        c = Vector((0, 0, zn + 0.4))
        horn(f"horn{s}", [c + U * s * 0.85, c + U * s * 1.75 + Vector((0, 0, 0.1)), c + U * s * 2.3 + Vector((0, 0, 0.8)),
                          c + U * s * 2.15 + Vector((0, 0, 1.7))], 0.27, M["bonelow"])
    # the copper coil out of the stopper and the pipe down to the side flask
    zt = top + 0.4
    SF = P(-100, 3.95, ZD + 0.5 + 1.0)                       # the side flask's middle
    pts = [(0, 0, zt - 0.1), (0, 0, zt + 0.25)]
    turns, n = 2.5, 60
    for i in range(n + 1):
        a = 2 * math.pi * turns * i / n - math.pi * 100 / 180
        rr = 0.62 * min(1.0, i / 8)
        pts.append((rr * math.cos(a), rr * math.sin(a), zt + 0.3 + 1.3 * i / n))
    sf_top = SF.z + 1.0 * math.cos(math.asin(0.36)) + 0.55 + 0.17
    h = Vector((SF.x, SF.y, 0)).normalized()
    r_sf = math.hypot(SF.x, SF.y)
    pts += [tuple(h * 1.5 + Vector((0, 0, zt + 1.75))), tuple(h * 3.1 + Vector((0, 0, zt + 1.0))),
            (SF.x, SF.y, zt - 1.2), (SF.x, SF.y, sf_top + 0.9), (SF.x, SF.y, sf_top - 0.25)]
    kit.tube("coil", pts, 0.17, M["copper"], verts=12, smooth=True)
    kit.cyl("sfstand", 0.74, 0.5, P(-100, 3.95, ZD), M["brass"], verts=24, bevel=0.05, r2=0.55)
    flask("sideflask", tuple(SF), 1.0, 0.36, 0.55, M["violet"])
    kit.cyl("sfcollar", 0.47, 0.2, (SF.x, SF.y, sf_top - 0.42), M["brass"], verts=20)
    # where levels 2 and 3 mount their flasks
    socket("mount1", P(-45, 3.9, ZD))
    socket("mount2", P(65, 3.95, ZD))


# ----------------------------------------------------------------------------------------------- b: the furnace
def tube_glass(name, at, r, h, col, fill, seed):
    """A giant test tube standing on `at`: glass with a rolled lip, glowing liquid to `fill` of its height."""
    at = Vector(at)
    liq = imats.liquid(name + "-liq", col, glow=0.85, clear=0.5)
    hf = h * fill
    kit.cyl(name + "-brew", r, hf, at, liq, verts=40, bevel=0.0)
    kit.lathe(name + "-air", [(r, hf), (r, h), (r + 0.1, h + 0.06), (r + 0.1, h + 0.16), (r - 0.06, h + 0.16),
                              (r - 0.06, hf)], at, M["glass"], verts=40)
    kit.lathe(name + "-top", [(0.0, hf + 0.01), (r - 0.02, hf + 0.01)], at, kit.flat(name + "-topm", col, rough=0.15,
                                                                                       emit=1.6), verts=40)
    bubbles(name + "-bub", at, r, hf, 9, tuple(min(255, c + 90) for c in col), seed)
    kit.cyl(name + "-cup", r + 0.2, 0.5, at - Vector((0, 0, 0.05)), M["brass"], verts=32, bevel=0.05)
    kit.ring(name + "-cupring", r + 0.22, 0.07, M["iron"], z=0.0).location = at + Vector((0, 0, 0.3))


def dir_b():
    H0, HB, S = 0.45, 3.0, 3.3
    for sx in (1, -1):
        for sy in (1, -1):
            kit.box(f"foot{sx}{sy}", (1.3, 1.3, H0 + 0.1), (sx * 2.75, sy * 2.75, 0), M["stone"], bevel=0.15)
            kit.box(f"post{sx}{sy}", (0.62, 0.62, HB + 0.2), (sx * (S - 0.12), sy * (S - 0.12), H0), M["brass"],
                    bevel=0.06)
    kit.box("body", (2 * S, 2 * S, HB), (0, 0, H0), M["plate"], bevel=0.1)
    ZT = H0 + HB
    kit.box("deck", (2 * S + 0.7, 2 * S + 0.7, 0.36), (0, 0, ZT), M["iron"], bevel=0.07)
    ZD = ZT + 0.36
    kit.box("skirt", (2 * S + 0.3, 2 * S + 0.3, 0.3), (0, 0, H0 - 0.02), M["iron"], bevel=0.06)
    # rivets along the two faces the camera sees
    for z in (H0 + 0.55, ZT - 0.25):
        rivets(f"rivx{z:.1f}", [(S + 0.02, -2.4 + 0.8 * i, z) for i in range(7)])
        rivets(f"rivy{z:.1f}", [(-2.4 + 0.8 * i, -S - 0.02, z) for i in range(7)])
    # front left face: the firebox
    kit.box("fire", (3.0, 0.1, 1.75), (0.0, -S - 0.01, H0 + 0.5), M["hot"], bevel=0.0)
    kit.box("fireglow", (2.8, 0.06, 1.55), (0.0, -S - 0.05, H0 + 0.6), M["lavahot"], bevel=0.0)
    for i in range(6):
        rod(f"bar{i}", (-1.25 + 0.5 * i, -S - 0.16, H0 + 0.45), (-1.25 + 0.5 * i, -S - 0.16, H0 + 2.3), 0.085, M["iron"])
    kit.box("lintel", (3.5, 0.34, 0.32), (0.0, -S - 0.1, H0 + 2.25), M["brass"], bevel=0.06)
    kit.box("sill", (3.5, 0.42, 0.26), (0.0, -S - 0.12, H0 + 0.26), M["brass"], bevel=0.06)
    for sx in (-1, 1):
        kit.box(f"jamb{sx}", (0.28, 0.3, 1.8), (sx * 1.62, -S - 0.08, H0 + 0.5), M["brass"], bevel=0.05)
    # front right face: a porthole on the brew and a copper feed pipe up to the rack
    c = Vector((S, 0.6, H0 + 1.55))
    aim(kit.cyl("port", 1.12, 0.26, c, M["brass"], verts=40, bevel=0.06), (1, 0, 0))
    aim(kit.cyl("portglass", 0.84, 0.3, c, M["green"], verts=40, bevel=0.04), (1, 0, 0))
    rivets("portbolt", [c + Vector((0.27, 0.98 * math.cos(a), 0.98 * math.sin(a))) for a in
                        [i * math.pi / 4 for i in range(8)]], r=0.07, mat=M["iron"])
    kit.tube("feed", [(S, -1.9, H0 + 1.0), (S + 0.75, -1.9, H0 + 1.0), (S + 0.75, -1.9, ZD + 0.9),
                      (S - 0.5, -1.9, ZD + 0.9), (S - 0.5, -1.9, ZD - 0.02)], 0.2, M["copper"], verts=16)
    aim(kit.cyl("feedflange", 0.36, 0.14, (S, -1.9, H0 + 1.0), M["brass"], verts=20), (1, 0, 0))
    kit.cyl("feedfoot", 0.36, 0.12, (S - 0.5, -1.9, ZD), M["brass"], verts=20)
    # the rack: three giant test tubes across the deck, between two tusks
    for i, (s, h, col, fill) in enumerate(((-2.45, 4.1, (126, 50, 200), 0.62), (0.0, 5.3, (96, 200, 40), 0.74),
                                           (2.45, 3.5, (235, 130, 28), 0.55))):
        tube_glass(f"tube{i}", U * s + Vector((0, 0, ZD)), 0.82, h, col, fill, 40 + i)
    ZR = ZD + 2.35
    for sv in (1, -1):
        rod(f"rail{sv}", U * -4.2 + V * sv * 0.98 + Vector((0, 0, ZR)), U * 4.2 + V * sv * 0.98 + Vector((0, 0, ZR)),
            0.13, M["brass"])
    for s in (-1, 1):
        b = U * s * 4.2
        rod(f"tie{s}", b + V * 1.05 + Vector((0, 0, ZR)), b - V * 1.05 + Vector((0, 0, ZR)), 0.13, M["brass"])
        kit.cyl(f"tuskseat{s}", 0.62, 0.3, b + Vector((0, 0, ZD)), M["iron"], verts=24, bevel=0.05)
        horn(f"tusk{s}", [b + Vector((0, 0, ZD + 0.1)), b + U * s * 0.25 + Vector((0, 0, ZR)),
                          b + U * s * 0.75 + Vector((0, 0, ZR + 1.6)), b + U * s * 0.35 + Vector((0, 0, ZR + 3.0)),
                          b - U * s * 0.5 + Vector((0, 0, ZR + 3.9))], 0.46, M["bone"], r_end=0.04)
    # where levels 2 and 3 stand their tubes
    for i, s in enumerate((-1.25, 1.25)):
        socket(f"mount{i}", U * s + V * 2.3 + Vector((0, 0, ZD)), r=0.8)
    # corner spikes on the deck's front, a slag heap and a lava dribble at the foot
    spike("spikeF", V * 4.5 + Vector((0, 0, ZD)), D(-45, 70), 1.1, 0.28, M["iron"])
    spike("spikeB", V * -4.5 + Vector((0, 0, ZD)), D(135, 70), 1.1, 0.28, M["iron"])
    kit.lathe("slag", [(0.0, 0.05), (1.25, 0.05), (1.4, -0.02)], (0.0, -S - 1.25, 0), M["lava"], verts=40)
    for k in range(9):
        lump("slagrock", Vector((0.0, -S - 1.25, 0.04)) + P(k * 40 + 10, 1.4), rnd.uniform(0.22, 0.34), M["stone"],
             seed=700 + k)


# -------------------------------------------------------------------------------------------------- c: the tank
def dir_c():
    crag = kit.lathe("crag", [(6.1, -0.1), (5.7, 0.55), (4.9, 1.3), (4.0, 2.0), (3.2, 2.5), (1.5, 2.65), (0.0, 2.7)],
                     (0, 0, 0), M["crag"], verts=40)
    imats.roughen(crag, strength=0.5, size=1.3, levels=3)
    foot_rocks(6.0, 22, 900, lo=0.3, hi=0.6, skip=())
    # a lava puddle at the front of the foot
    kit.lathe("puddle", [(0.0, 0.5), (0.9, 0.42), (1.0, 0.3)], P(-45, 4.9), M["lava"], verts=40)
    for k in range(7):
        lump("puddlerock", P(-45, 4.9, 0.42) + P(k * 40 - 165, 1.0), rnd.uniform(0.2, 0.32), M["stone"], seed=950 + k)
    # the tank: iron seat, glass, iron lid
    Z0, RT, HT = 3.3, 1.95, 5.2
    kit.lathe("seat", [(2.9, 2.1), (2.9, 2.85), (2.55, 3.15), (2.2, Z0), (0.0, Z0)], (0, 0, 0), M["iron"], verts=48)
    kit.ring("seatband", 2.93, 0.1, M["brass"], z=2.75)
    for i in range(10):
        az = 36 * i + 9
        spike(f"seatspike{i}", P(az, 2.8, 2.55), D(az, 18), 0.8, 0.2, M["iron"])
    liq = imats.liquid("tank-liq", (132, 52, 200), glow=0.8, clear=0.8)
    kit.cyl("tank", RT, HT, (0, 0, Z0), liq, verts=64, bevel=0.0)
    for z in (Z0 + 0.12, Z0 + HT - 0.12):
        kit.ring(f"tankband{z:.0f}", RT + 0.03, 0.12, M["brass"], z=z)
    ZL = Z0 + HT
    kit.lathe("lid", [(RT + 0.25, ZL - 0.1), (RT + 0.25, ZL + 0.3), (1.7, ZL + 0.85), (0.8, ZL + 1.15),
                      (0.0, ZL + 1.2)], (0, 0, 0), M["iron"], verts=48)
    kit.cyl("lidstack", 0.5, 0.6, (0, 0, ZL + 1.1), M["brass"], verts=24, bevel=0.05)
    kit.cyl("lidcap", 0.62, 0.2, (0, 0, ZL + 1.7), M["iron"], verts=6, bevel=0.04)
    rivets("lidrivet", [P(a, RT + 0.27, ZL + 0.1) for a in range(0, 360, 30)], r=0.08)
    # the specimen: a curled dark thing with one lit eye, and bubbles
    sm = kit.flat("specimen", (14, 6, 20), rough=0.7)
    c = Vector((0, 0, Z0 + 2.5)) + V * 0.55
    ball("spec-body", c, 0.95, sm, squash=1.25)
    ball("spec-head", c + Vector((0, 0, 1.15)) + V * 0.25 + U * 0.3, 0.68, sm)
    kit.tube("spec-tail", [tuple(c + Vector((0, 0, -0.9))), tuple(c + U * -0.7 + Vector((0, 0, -1.6))),
                           tuple(c + U * -1.1 + Vector((0, 0, -0.9))), tuple(c + U * -0.75 + Vector((0, 0, -0.35)))],
             0.3, sm, verts=12, r_end=0.07, smooth=True)
    for s in (-1, 1):
        kit.tube(f"spec-arm{s}", [tuple(c + U * s * 0.7 + Vector((0, 0, 0.5))), tuple(c + U * s * 1.15 + V * 0.3),
                                  tuple(c + U * s * 0.85 + V * 0.6 + Vector((0, 0, -0.45)))], 0.17, sm, verts=10,
                 r_end=0.05, smooth=True)
    ball("spec-eye", c + Vector((0, 0, 1.22)) + V * 0.86 + U * 0.36, 0.27, kit.flat("eye", (255, 226, 70), emit=8.0),
         seg=16)
    bubbles("tank-bub", (0, 0, Z0), RT - 0.2, HT, 14, (240, 190, 255), 77)
    # the ribcage: bone ribs up the two sides of the tank
    for i, az in enumerate((14, 45, 76, 194, 225, 256)):
        mid = i % 3 == 1
        zt = ZL - (0.2 if mid else 1.1)
        horn(f"rib{i}", [P(az, 4.3, 1.3), P(az, 4.75, 3.3), P(az, 4.35 if mid else 4.1, 5.6),
                         P(az, 3.2, zt - 0.6), P(az, RT + 0.2, zt)], 0.4 if mid else 0.32, M["bonelow"], r_end=0.05)
        lump(f"ribroot{i}", P(az, 4.3, 1.25), 0.62, M["stone"], seed=980 + i)
    for s_ in (1, -1):
        c2 = Vector((0, 0, ZL + 0.75))
        horn(f"lidhorn{s_}", [c2 + U * s_ * 1.5, c2 + U * s_ * 2.3 + Vector((0, 0, 0.25)),
                              c2 + U * s_ * 2.75 + Vector((0, 0, 1.0)), c2 + U * s_ * 2.5 + Vector((0, 0, 1.9))], 0.3,
             M["bonelow"])
    # where levels 2 and 3 mount their side tanks: two iron pads with capped sockets on the crag's front shoulders
    for i, az in enumerate((-2, -88)):
        pad = P(az, 4.6, 1.5)
        kit.cyl(f"pad{i}", 0.85, 0.6, pad - Vector((0, 0, 0.3)), M["iron"], verts=8, bevel=0.06)
        socket(f"mount{i}", pad + Vector((0, 0, 0.3)), r=0.58)


def grow(k):
    """Enlarge the whole model about the origin on the ground."""
    for o in kit.SC.objects:
        if o.parent is None:
            o.location = o.location * k
            o.scale = o.scale * k


def build():
    mats()
    {"a": dir_a, "b": dir_b, "c": dir_c}[DIRN]()
    grow({"a": 1.15, "b": 1.3, "c": 1.15}[DIRN])       # level 1 fills the surface lab's plot, as its neighbours do


kit.run(build, lambda k: None)
