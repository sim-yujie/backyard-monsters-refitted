"""factory.py : the Siege Factory (building 133, Flash folder siegefactory) in 3D, one look, as Flash's.
Uses the generic Inferno kit (../../inferno/kit.py: the game camera, light, helpers, the fit / check / gap / base /
anim modes).

    blender -b --factory-startup -P factory.py -- 1 <fit|check|gap|base|still|anim> [frame]

The building, as Flash paints it: a round mound of glowing cracked lava with dark roots round its foot; on it a tall
black square vat seen corner-on, its rim clad in riveted copper plates (the right one runs on past the corner), a
dark pool in its top. Three big bones stand at the vat's corners and lean in to pointed heads (left, front/right; the
right-hand one dark, carrying the copper pump box); rusty iron straps tie the bones together in two tiers. In the
vat stand two short pale stone posts and the drop hammer: two tall stone posts with a rusty beam between their tops,
a dark iron rocker arm between them (hammer head on the viewer's end, a thin rod on the far end down into the copper
pump box), and in front of the posts a dark shaft with a big gold spiked wheel and, on its far left end, a small one.

World: Z up, the mound's middle on the origin, the vat's walls along X and Y. The camera looks from +X -Y, so screen
right is +X+Y; the vat's +X wall is its right-hand face, its -Y wall the left-hand one.

The loop (a siege weapon being made), 35 frames as Flash's strip: the shaft and both wheels creep round by two
spike pitches (a quarter turn; every part of them repeats each 45 degrees, so the loop closes); the rocker
lifts the hammer and drops it twice (Flash: up over 5 cells, held 3, down in 3, at rest 6); the rod follows the arm.
Idle is frame 0 (hammer down), as Flash holds cell 0. The pump box's yellow smoke is laid on by post.py.
PB_STATE=damaged: one rough damaged still (mode base).
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "inferno"))
import kit  # noqa: E402

kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (-6.0, 44.0)
kit.FRAME = (-84, -104, 146, 106)
N = 35
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame 35 (= frame 0), the loop check
kit.SUN_COL = (1.0, 0.94, 0.84)
kit.SUN, kit.SKY_E = 5.6, 0.45         # harder light than the overworld recipe: Flash's picture is contrasty
STATE = kit.STATE
DMG = STATE == "damaged"

H = 2.15                    # the vat's half side
ZM = 1.6                    # the mound's top
ZT = 6.5                    # the vat's rim
XM, YM = 1.75, -0.26        # the tall front post
XB = XM - 1.65              # the tall back post
XA = XM - 0.78              # the rocker arm's plane, between the posts
ZP = 14.3                   # the rocker's pivot
ZTOP = 16.25                 # the tall posts' tops
YS, ZS = -1.4, 10.6        # the shaft's line (along X), in front of the posts
XW, XW2 = -0.95, -4.5      # the big wheel and the small wheel on the shaft
LIFT = 29.0                 # the rocker's swing, degrees
V = Vector
M = {}
PART = {}
rr = random.Random(11)


def P(sx, sy, z):
    return kit.px(sx, sy, Z=z)


# ------------------------------------------------------------------------------------------------------- materials
def lava_mat():
    t = kit.NT("lava")
    v = t.coords(scale=(1.0, 1.0, 0.5))
    n = t.noise(v, 1.35, 3.0, 0.55, 2.2)
    c = t.ramp(n, [(0.41, kit.srgb(58, 30, 40)), (0.46, kit.srgb(112, 52, 44)), (0.5, kit.srgb(226, 104, 12)),
                   (0.6, kit.srgb(250, 150, 16)), (0.7, kit.srgb(255, 204, 50))])
    e = t.ramp(n, [(0.46, (0, 0, 0, 1)), (0.56, (0.8, 0.8, 0.8, 1))])
    t.set(**{"Base Color": c, "rough": 0.85})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.link(e, t.bsdf.inputs["Emission Strength"])
    t.bump(n, 0.5, 0.05)
    return t.m


def mats():
    p = kit.painted
    return dict(
        lava=lava_mat(),
        root=p("root", (58, 50, 30), rough=0.8, wear=(96, 96, 52), dirt=0.2),
        vat=p("vat", (20, 18, 22), rough=0.5, wear=(78, 56, 50), scale=3.0, dirt=0.15, spec=0.3),
        pool=kit.flat("pool", (12, 30, 36), rough=0.6),
        copper=p("copper", (226, 124, 26), rough=0.42, metal=0.25, wear=(250, 176, 52), rust=(150, 72, 22),
                 scale=5.0, dirt=0.1, rust_at=0.62, soot=0.25),
        edge=kit.flat("edge", (250, 204, 44), rough=0.4, metal=0.2),
        bone=p("bone", (240, 216, 164), rough=0.5, wear=(255, 244, 212), rust=(150, 106, 66), scale=3.4, dirt=0.45,
               rust_at=0.6, soot=0.18, spec=0.35, ao_min=0.3, grain=0.12),
        bone2=p("bone2", (112, 86, 64), rough=0.6, wear=(160, 130, 96), rust=(60, 44, 36), scale=3.0, dirt=0.4,
                rust_at=0.5, soot=0.3, spec=0.25),
        strap=p("strap", (96, 40, 44), rough=0.48, metal=0.35, wear=(196, 112, 116), rust=(40, 20, 22), scale=5.0,
                dirt=0.15, rust_at=0.5, grain=0.5, spec=0.6, ao_min=0.35),
        stone=p("stone", (172, 162, 150), rough=0.8, wear=(212, 204, 190), rust=(92, 54, 50), scale=7.0, dirt=0.2,
                rust_at=0.5, grain=0.8, top=(206, 198, 184), streak=0.6, soot=0.45, ao_min=0.35),
        pale=p("pale", (206, 196, 180), rough=0.7, wear=(232, 226, 212), scale=6.0, dirt=0.15, grain=0.35,
               top=(244, 238, 224)),
        iron=p("iron", (40, 38, 42), rough=0.42, metal=0.6, wear=(92, 90, 94), scale=5.0, dirt=0.1, spec=0.6),
        head=p("head", (124, 122, 120), rough=0.5, metal=0.4, wear=(170, 168, 164), rust=(70, 60, 58), scale=8.0,
               dirt=0.1),
        gold=p("gold", (240, 172, 26), rough=0.36, metal=0.3, wear=(255, 222, 90), rust=(176, 96, 20), scale=6.0,
               dirt=0.05, rust_at=0.6, spec=0.6),
        hub=p("hub", (22, 26, 36), rough=0.3, metal=0.6, wear=(60, 66, 80), dirt=0.0, spec=0.7),
        hubflat=kit.flat("hubflat", (24, 28, 38), rough=0.3, metal=0.6),
        shaftflat=kit.flat("shaftflat", (48, 48, 58), rough=0.4, metal=0.6),
        shine=kit.flat("shine", (232, 236, 244), rough=0.25, metal=0.6),
        shaft=p("shaft", (46, 46, 56), rough=0.4, metal=0.6, wear=(96, 96, 108), dirt=0.0, spec=0.6),
        cap=p("cap", (96, 94, 92), rough=0.5, metal=0.5, wear=(140, 138, 134), rust=(60, 50, 46), dirt=0.0),
        steel=p("steel", (108, 102, 94), rough=0.5, metal=0.5, wear=(150, 146, 138), rust=(70, 52, 42), scale=5.0,
                dirt=0.1, soot=0.3),
        rivet=kit.flat("rivet", (220, 220, 226), rough=0.3, metal=0.7),
        grass=p("grass", (132, 156, 92), rough=0.8, wear=(168, 186, 120), dirt=0.1),
        moss=p("moss", (60, 110, 40), rough=0.9, wear=(100, 150, 50), dirt=0.2),
    )


# ---------------------------------------------------------------------------------------------------------- helpers
def spline(pts, sub=8):
    """Catmull-Rom through pts: a list of (point, value) pairs -> finer list of (point, value)."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = (pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n - 1)])
        for j in range(sub):
            t = j / sub
            def cr(a, b, c, d):
                return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                              + (-a + 3 * b - 3 * c + d) * t ** 3)
            out.append((cr(V(p0[0]), V(p1[0]), V(p2[0]), V(p3[0])), cr(p0[1], p1[1], p2[1], p3[1])))
    out.append((V(pts[-1][0]), pts[-1][1]))
    return out


def limb(name, pts, mat, seg=16, sub=8, parent=None, lumps=0.0):
    """A round bone through (point, radius) pairs, its ends rounded off."""
    sp = spline(pts, sub)
    bm = bmesh.new()
    rows = []
    up = V((0.3, 0.2, 1)).normalized()
    path = []
    first_t = (sp[1][0] - sp[0][0]).normalized()
    last_t = (sp[-1][0] - sp[-2][0]).normalized()
    path.append((sp[0][0] - first_t * sp[0][1] * 0.66, sp[0][1] * 0.05))
    path.append((sp[0][0] - first_t * sp[0][1] * 0.55, sp[0][1] * 0.45))
    path.append((sp[0][0] - first_t * sp[0][1] * 0.3, sp[0][1] * 0.82))
    path += sp
    path.append((sp[-1][0] + last_t * sp[-1][1] * 0.3, sp[-1][1] * 0.82))
    path.append((sp[-1][0] + last_t * sp[-1][1] * 0.55, sp[-1][1] * 0.45))
    path.append((sp[-1][0] + last_t * sp[-1][1] * 0.66, sp[-1][1] * 0.05))
    for i, (p, r) in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)][0] - path[max(i - 1, 0)][0]).normalized()
        a = t.cross(up)
        if a.length < 1e-3:
            a = t.cross(V((1, 0, 0)))
        a.normalize()
        b = t.cross(a).normalized()
        rows.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / seg) + b * math.sin(2 * math.pi * k / seg)) * r)
                     for k in range(seg)])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat], parent=parent)
    if lumps:
        lumpy(ob, lumps)
    return ob


def lumpy(ob, strength, size=0.55):
    if "bonelumps" not in bpy.data.textures:
        tex = bpy.data.textures.new("bonelumps", "CLOUDS")
        tex.noise_scale = size
        tex.noise_depth = 2
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    mo = ob.modifiers.new("lumps", "DISPLACE")
    mo.texture = bpy.data.textures["bonelumps"]
    mo.texture_coords = "GLOBAL"
    mo.strength = strength
    mo.mid_level = 0.5


def tooth(name, at, r, h, mat, zdir=(0, 0, 1), parent=None, verts=28):
    """A bone's head: an egg, fat low and a little narrower to its blunt top, standing on `at` along zdir."""
    prof = []
    for i in range(25):
        t = i / 24
        rad = r * (math.sin(math.pi * t) ** 0.55) * (1.0 - 0.3 * t ** 1.5)
        prof.append((max(rad, 0.001), h * t))
    ob = kit.lathe(name, prof, at, mat, verts=verts, parent=parent)
    ob.rotation_euler = V(zdir).normalized().to_track_quat("Z", "Y").to_euler()
    lumpy(ob, 0.1)
    return ob


def rivet(name, at, r=0.085, parent=None):
    return kit.blob(name, at, r, squash=0.8, mat=M["rivet"], parent=parent)


def strap(name, p0, p1, side, w=1.1, th=0.16, sag=0.0, mat=None, rivets=True, parent=None, n=10):
    p0, p1 = V(p0), V(p1)
    pts = [p0.lerp(p1, i / n) - V((0, 0, sag * math.sin(math.pi * i / n))) for i in range(n + 1)]
    ob = kit.sweep(name, pts, side, w, th, mat or M["strap"], parent=parent, bevel=0.03)
    if rivets:
        d = (p1 - p0).normalized()
        nrm = d.cross(V(side)).normalized()
        if nrm.dot(-kit.cam_fwd()) < 0:
            nrm = -nrm
        for i, q in enumerate((p0 + d * 0.3, p1 - d * 0.3)):
            rivet(f"{name}-rv{i}", q + nrm * th * 0.5, 0.11, parent=parent)
    return ob


def post(name, x, y, z0, z1, s, mat, parent=None, bevel=0.06):
    return kit.box(name, (s, s, z1 - z0), (x, y, z0), mat, bevel=bevel, parent=parent)


# ------------------------------------------------------------------------------------------------------------ parts
def mound():
    prof = [(0.01, 0.0), (4.15, 0.0), (4.1, 0.6), (3.85, ZM - 0.5), (3.45, ZM), (0.01, ZM + 0.05)]
    ob = kit.lathe("mound", prof, (0, 0, 0), M["lava"], verts=64)
    tex = bpy.data.textures.new("lumps", "CLOUDS")
    tex.noise_scale = 0.9
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    mo = ob.modifiers.new("lumps", "DISPLACE")
    mo.texture = tex
    mo.strength = 0.5
    mo.mid_level = 0.5
    # dark roots round the foot, lying out over the ground
    n = 26
    for i in range(n):
        a = 2 * math.pi * (i + rr.uniform(-0.3, 0.3)) / n
        d = V((math.cos(a), math.sin(a), 0))
        ln = rr.uniform(0.3, 1.5)
        p0 = d * 3.9 + V((0, 0, 0.5))
        p1 = d * (4.25 + ln * 0.5) + V((0, 0, 0.14))
        p2 = d * (4.25 + ln) + V((0, 0, 0.03)) + V((-d.y, d.x, 0)) * rr.uniform(-0.35, 0.35)
        limb(f"root{i}", [(p0, 0.17), (p1, 0.09), (p2, 0.012)], M["grass" if i % 4 == 1 else "root"], seg=8, sub=5)


def vat():
    kit.box("vat", (2 * H, 2 * H, ZT - 0.6), (0, 0, 0.6), M["vat"], bevel=0.08)
    kit.box("vat-pool", (2 * H - 0.3, 2 * H - 0.3, 0.1), (0, 0, ZT - 0.08), M["pool"], bevel=0.0)
    # the rim plates: the right-hand one (+X wall) runs on past the back corner; the left-hand one (-Y wall) carries
    # the yellow edge
    z0, z1 = ZT - 1.25, ZT + 0.12
    kit.box("rimR", (0.16, 2 * H + 1.55, z1 - z0), (H + 0.1, 0.7, z0), M["copper"], bevel=0.03)
    for i in range(6):
        y = -H + 0.45 + i * 1.02
        rivet(f"rimR-rv{i}", (H + 0.19, y, z0 + 0.45), 0.11)
    kit.box("rimL", (2 * H + 0.2, 0.16, z1 - z0 - 0.5), (0.0, -H - 0.06, z0 + 0.5), M["copper"], bevel=0.03)
    kit.box("rimL-edge", (2 * H + 0.24, 0.24, 0.16), (0.0, -H - 0.07, z0 + 0.36), M["edge"], bevel=0.03)
    for i in range(5):
        rivet(f"rimL-rv{i}", (-H + 0.4 + i * 0.9, -H - 0.15, z0 + 0.86), 0.1)
    # back rims (hardly seen)
    kit.box("rimB", (0.16, 2 * H, z1 - z0), (-H - 0.06, 0, z0), M["copper"], bevel=0.03)
    kit.box("rimB2", (2 * H, 0.16, z1 - z0), (0, H + 0.06, z0), M["copper"], bevel=0.03)


LB = {}          # the bones' strap points


def bones():
    b = M["bone"]
    # left bone: a foot on the mound at the vat's left corner, a knuckle, then a long bow out and up along the vat's
    # back-left wall to its pointed head
    pts = [(P(-46, 38, 0.7), 0.42), (P(-47, 26, 2.2), 0.4), (P(-48, 12, 3.7), 0.48), (P(-48.5, 9, 4.0), 0.66),
           (P(-49.5, 5, 4.4), 0.5), (P(-54, -6, 5.8), 0.46), (V((-3.8, -3.25, 6.7)), 0.64),
           (V((-3.9, -2.2, 8.4)), 0.42), (V((-3.6, -1.0, 9.7)), 0.46), (V((-3.5, -0.3, 10.4)), 0.54)]
    limb("boneL", pts, b, lumps=0.14)
    LB["L1"], LB["L0"] = V((-3.85, -3.2, 7.75)), P(-49, 8, 4.1) + V((0, 0, 0.9))
    tooth("boneL-head", V((-3.5, -0.3, 10.3)), 0.84, 2.3, b, zdir=(0.0, 0.6, 1))
    kit.ring("boneL-band", 0.5, 0.08, M["bone2"]).location = P(-48.5, 9, 4.0)
    # front bone: straight up the vat's front corner with two knuckles, then leaning along the right-hand wall to
    # its head
    x = H + 0.6
    pts = [(V((x, -x + 0.1, 0.25)), 0.55), (V((x, -x + 0.1, 1.2)), 0.46), (V((x, -x + 0.1, 1.55)), 0.8),
           (V((x, -x + 0.1, 1.9)), 0.46), (V((x, -x + 0.1, 3.3)), 0.46), (V((x, -x + 0.1, 3.65)), 0.8),
           (V((x, -x + 0.1, 4.0)), 0.46), (V((x, -x + 0.1, 6.6)), 0.47), (V((x + 0.05, -x + 0.5, 7.8)), 0.5),
           (V((x + 0.2, -1.1, 8.8)), 0.52), (V((x + 0.25, -0.3, 9.5)), 0.6)]
    limb("boneF", pts, b, lumps=0.14)
    LB["F1"], LB["F0"] = V((x, -x + 0.1, 8.0)), V((x, -x + 0.1, 4.4))
    tooth("boneF-head", V((x + 0.25, -0.3, 9.3)), 0.92, 2.6, b, zdir=(0.0, 0.3, 1))
    for i, z in enumerate((1.55, 3.65)):
        kit.ring(f"boneF-band{i}", 0.6, 0.08, M["bone2"], z=0).location = (x, -x + 0.1, z)
    kit.blob("boneF-foot", (x, -x + 0.1, 0.3), 0.7, squash=0.6, mat=b)
    # right bone: darker, at the vat's right corner, up to the pump box
    b2 = M["bone2"]
    pts = [(V((3.1, 3.1, 0.6)), 0.50), (V((3.25, 3.25, 2.6)), 0.41), (V((3.3, 3.3, 4.2)), 0.50),
           (V((3.3, 3.3, 4.6)), 0.66), (V((3.3, 3.3, 5.0)), 0.47), (V((3.25, 3.2, 6.8)), 0.47),
           (V((2.9, 2.75, 8.2)), 0.52), (V((2.6, 2.6, 9.0)), 0.58)]
    limb("boneR", pts, b2, lumps=0.2)
    LB["R0"], LB["R1"] = V((3.3, 3.3, 3.4)), V((3.3, 3.3, 4.6))
    kit.ring("boneR-band", 0.5, 0.09, M["strap"]).location = (3.3, 3.3, 4.6)


def straps():
    out = H + 0.5
    # left-hand wall, two tiers, from the left bone to the front bone
    strap("strapL1", LB["L1"] + V((0.25, -0.1, 0)), LB["F1"] + V((-0.2, -0.3, 0)), (0, 0, 1), sag=0.25)
    strap("strapL0", LB["L0"] + V((0.2, -0.25, 0)), LB["F0"] + V((-0.2, -0.3, 0)), (0, 0, 1), sag=0.3)
    # right-hand wall: low, from the front bone to the right bone, hanging; and a short one from the rim down to the
    # right bone's knuckle
    strap("strapR0", LB["F0"] + V((0.3, 0.2, -0.4)), LB["R0"] + V((0.3, -0.25, 0)), (0, 0, 1), sag=0.55)
    strap("strapR1", V((H + 0.15, H + 1.1, ZT - 0.5)), LB["R1"] + V((0.1, -0.3, 0.1)), (0, 0, 1), w=0.7, sag=0.1)


def pillars():
    post("pillarL", -1.87, -1.87, ZT - 0.05, 10.2, 0.42, M["pale"])
    post("pillarF", 1.8, YS, ZT - 0.05, 9.6, 0.52, M["pale"])
    s = 0.78
    post("postM", XM, YM, ZT - 0.05, ZTOP, s, M["stone"], bevel=0.07)
    post("postB", XB, YM, ZT - 0.05, ZTOP, 0.72, M["stone"], bevel=0.07)
    # the rusty beam between their tops
    kit.box("beam", (XM - XB - 0.6, 0.6, 1.0), ((XM + XB) / 2, YM, ZTOP - 1.1), M["strap"], bevel=0.05)
    # bolts on the front post's right-hand face: the rocker's axle and one below
    for i, z in enumerate((ZP, ZP - 1.75)):
        kit.cyl(f"bolt{i}", 0.17, 0.12, (XM + s / 2 - 0.02, YM, z), M["iron"], rot=(0, 90, 0), verts=12, bevel=0.02)
        rivet(f"bolt{i}-rv", (XM + s / 2 + 0.1, YM, z), 0.08)
    # the shaft's bearing: a dark block on the front post's near face, and a saddle on the front pillar
    kit.box("bearing", (0.5, YM - s / 2 - YS + 0.2, 0.6), (XM, (YM - s / 2 + YS - 0.2) / 2 + 0.02, ZS - 0.3), M["iron"], bevel=0.05)
    kit.box("saddle", (0.3, 0.34, ZS - 0.2 - 9.6), (1.8, YS, 9.59), M["iron"], bevel=0.03)


def pump():
    # the copper pump box on the right bone: a long riveted box along X, its near side dark steel
    x0, x1, y0, y1, z0, z1 = 0.45, 5.0, 2.15, 3.05, 9.3, 10.4
    kit.box("pump", (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, z0), M["copper"], bevel=0.05)
    kit.box("pump-side", (x1 - x0 - 0.3, 0.06, z1 - z0 - 0.32), ((x0 + x1) / 2, y0 - 0.03, z0 + 0.14), M["steel"],
            bevel=0.02)
    for i in range(5):
        rivet(f"pump-rv{i}", (x0 + 0.75 + i * 0.85, y0 + 0.2, z1 + 0.02), 0.1)
    for i, z in enumerate((z0 + 0.3, z1 - 0.3)):
        rivet(f"pump-rve{i}", (x1 + 0.02, (y0 + y1) / 2 + 0.1, z), 0.1)
    # the rod's sleeve
    kit.cyl("pump-sleeve", 0.17, 0.6, (XA, YM + 2.5, z1 - 0.02), M["iron"], verts=14, bevel=0.02)


def wedge(name, r, w, z, mat, parent, turn, n=5):
    """One eighth of a wheel's rim drum (a pie slice round local Z). The eight are separate, identical objects, so the
    wheel's worn paint repeats every 45 degrees and the loop can close after a quarter turn."""
    bm = bmesh.new()
    a1 = math.pi / 4
    c0, c1 = bm.verts.new((0, 0, z - w / 2)), bm.verts.new((0, 0, z + w / 2))
    lo = [bm.verts.new((r * math.cos(a1 * i / n), r * math.sin(a1 * i / n), z - w / 2)) for i in range(n + 1)]
    hi = [bm.verts.new((r * math.cos(a1 * i / n), r * math.sin(a1 * i / n), z + w / 2)) for i in range(n + 1)]
    for i in range(n):
        bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
        bm.faces.new((c0, lo[i + 1], lo[i]))
        bm.faces.new((c1, hi[i], hi[i + 1]))
    bm.faces.new((c0, lo[0], hi[0], c1))
    bm.faces.new((c0, c1, hi[n], lo[n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat], parent=parent)
    ob.rotation_euler = (0, 0, turn)
    mo = ob.modifiers.new("split", "EDGE_SPLIT")
    mo.split_angle = math.radians(40)
    return ob


def wheel(parent, x, r, w, spikes, sl, sr, name, hub_r):
    """A gold spiked wheel on the shaft (in the spinner's frame: local Z is the shaft, +Z toward +X). Everything on
    it repeats every 45 degrees."""
    g = M["gold"]
    for i in range(8):
        wedge(f"{name}-rim{i}", r, w, x, g, parent, i * math.pi / 4)
    kit.cyl(f"{name}-well", r * 0.68, 0.04, (0, 0, x + w / 2 - 0.01), M["hubflat"], verts=40, bevel=0.0, parent=parent)
    kit.cyl(f"{name}-hub", hub_r, w / 2 + 0.34, (0, 0, x), M["hubflat"], verts=32, bevel=0.05, parent=parent)
    kit.ring(f"{name}-shine", hub_r * 0.98, 0.035, M["shine"], parent=parent, z=x + w / 2 + 0.3)
    for i in range(spikes):
        a = 2 * math.pi * i / spikes
        d = V((math.cos(a), math.sin(a), 0))
        ob = kit.cyl(f"{name}-spike{i}", sr, sl, d * (r - 0.06) + V((0, 0, x)), g, verts=10, bevel=0.0, r2=0.02,
                     parent=parent)
        ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        a2 = a + math.pi / spikes
        d2 = V((math.cos(a2), math.sin(a2), 0))
        ob = kit.cyl(f"{name}-hole{i}", sr * 0.5, 0.05, d2 * (r - 0.03) + V((0, 0, x)), M["hubflat"], verts=3,
                     bevel=0.0, parent=parent)
        ob.rotation_euler = d2.to_track_quat("Z", "Y").to_euler()


def shaft():
    def parts(hub):
        kit.cyl("shaft-rod", 0.23, 3.3 - XW2 + 0.25, (0, 0, XW2 - 0.25), M["shaftflat"], verts=16, bevel=0.02,
                parent=hub)
        wheel(hub, XW, 1.3, 1.3, 8, 0.85, 0.27, "wheel", 0.55)
        wheel(hub, XW2, 0.58, 0.34, 8, 0.42, 0.14, "wheel2", 0.26)
    e, hub = kit.spinner("shaft", (0, YS, ZS), 0.0, 0.0, parts)
    if not DMG:
        kit.MOVING.append(e)
    PART["shaft"] = hub
    # the end cap with its two bolts: a still bearing cup over the shaft's end (it does not turn in Flash)
    kit.cyl("cap", 0.42, 0.75, (3.25, YS, ZS), M["cap"], rot=(0, 90, 0), verts=24, bevel=0.05)
    for i in (-1, 1):
        rivet(f"cap-rv{i}", (4.02, YS + 0.2 * i, ZS + 0.08 * i), 0.08)


def rocker():
    e = bpy.data.objects.new("rocker", None)
    kit.link(e)
    e.location = (XA, YM, ZP)
    if not DMG:
        kit.MOVING.append(e)
    PART["rocker"] = e
    ir = M["iron"]
    # the arm: Y from the hammer end (-) to the rod end (+)
    kit.box("rocker-arm", (0.46, 6.3, 1.05), (0, 0.75, 0), ir, bevel=0.06, parent=e, origin="centre")
    for i, y in enumerate((2.7, 3.2)):
        rivet(f"rocker-rv{i}", (0.25, y, 0.0), 0.08, parent=e)
    rivet("rocker-rv9", (0.25, -1.9, 0.1), 0.1, parent=e)
    # the hammer: a bigger block on the near end, the grey fluted head under it
    kit.box("rocker-block", (0.62, 1.25, 1.3), (0, -2.0, -0.3), ir, bevel=0.07, parent=e, origin="centre")
    kit.box("rocker-head", (0.56, 0.95, 1.0), (0, -2.05, -1.35), M["head"], bevel=0.05, parent=e, origin="centre")
    for i in range(3):
        kit.box(f"rocker-head-rib{i}", (0.62, 0.14, 1.0), (0.0, -2.36 + i * 0.31, -1.35), M["head"], bevel=0.04,
                parent=e, origin="centre")
    # the rod: its own empty, kept upright under the arm's far end
    r = bpy.data.objects.new("rod", None)
    kit.link(r)
    if not DMG:
        kit.MOVING.append(r)
    PART["rod"] = r
    kit.cyl("rod-bar", 0.07, 3.3, (0, 0, -3.3), ir, verts=10, bevel=0.0, parent=r)
    kit.blob("rod-eye", (0, 0, 0), 0.13, squash=1.0, mat=ir, parent=r)


def build():
    M.update(mats())
    mound()
    vat()
    bones()
    straps()
    pillars()
    pump()
    shaft()
    rocker()
    if DMG:
        wreck()


def lift(k):
    """How far the hammer is lifted (0..1) at frame k: two strokes a loop, as Flash's (17 cells each: up over 5,
    held 3, down in 3, at rest 6)."""
    u = ((k % N) / N * 2.0) % 1.0 * 17.0
    if u < 5.0:
        return 0.5 - 0.5 * math.cos(math.pi * u / 5.0)
    if u < 8.0:
        return 1.0
    if u < 11.0:
        return 1.0 - ((u - 8.0) / 3.0) ** 2
    return 0.0


def turn(k):
    k = 0 if DMG else k % N
    PART["shaft"].rotation_euler = (0, 0, 0.3 + (math.pi / 2) * k / N)      # two spike pitches a loop, as Flash
    th = -math.radians(LIFT) * lift(k)
    PART["rocker"].rotation_euler = (th, 0, 0)
    q = Matrix.Rotation(th, 3, "X") @ V((0, 2.5, -0.45))
    PART["rod"].location = V((XA, YM, ZP)) + q


# ------------------------------------------------------------------------------------------------------------ damaged
def wreck():
    """One rough pass after Flash's damaged picture: sooted, the rocker knocked askew, the big wheel off its shaft and
    lying in the vat, the left bone fallen outward, the front bone broken, the pump box hanging, moss at the foot."""
    for m in list(bpy.data.materials):
        nt = m.node_tree
        if nt is None or m.name.startswith(("lava", "moss", "pool")):
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        inp = bsdf.inputs["Base Color"] if bsdf else None
        if inp is None:
            continue
        if inp.is_linked:
            src = inp.links[0].from_socket
        else:
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = inp.default_value
            src = rgb.outputs[0]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.2
        nz.inputs["Detail"].default_value = 5.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.4, (0.3, 0.3, 0.3, 1)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.62, (0.9, 0.9, 0.9, 1)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        nt.links.new(nz.outputs[0], ramp.inputs[0])
        nt.links.new(src, mix.inputs[6])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], inp)
    ob = bpy.data.objects

    def tip(names, pivot, rot):
        """Turn the named objects (prefix match) about a world pivot by rot (degrees XYZ)."""
        R = Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4()
        T = Matrix.Translation(pivot) @ R @ Matrix.Translation(-V(pivot))
        for o in ob:
            if o.parent is None and o.name.startswith(names):
                o.matrix_world = T @ o.matrix_world

    bpy.context.view_layer.update()
    tip(("boneL",), P(-49, 8, 5.0), (15, -9, 0))        # the left bone, loose from its upper strap, leans out
    tip(("strapL1",), LB["F1"], (0, -30, 0))
    tip(("pump",), V((2.6, 2.6, 9.0)), (0, 32, 0))
    tip(("rocker", "rod"), V((XA, YM, ZP)), (-24, 0, -16))
    tip(("postB", "beam"), V((XB, YM, ZT)), (0, -9, 0))
    tip(("strapR1",), LB["R1"], (0, 25, 0))
    # the shaft has dropped at its far end onto the vat's back rim
    tip(("shaft", "cap"), V((XM, YS, ZS)), (0, -40, 10))
    tip(("beam",), V((XB, YM, ZT)), (0, 9, 0))          # the beam stays on the front post
    # the front bone's head is knocked off and lies at the foot
    for o in ob:
        if o.name.startswith("boneF-head"):
            o.matrix_world = (Matrix.Translation(P(-34, 60, 0.75))
                              @ V((1, 0.8, 0.12)).to_track_quat("Z", "Y").to_matrix().to_4x4())
    # rubble and moss round the foot
    for i in range(16):
        a = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(3.9, 5.2)
        kit.blob(f"moss{i}", (d * math.cos(a), d * math.sin(a), 0.1), rr.uniform(0.35, 0.7), squash=0.35,
                 mat=M["moss"])
    for i in range(7):
        a = rr.uniform(-2.4, 0.8)
        d = rr.uniform(4.3, 5.2)
        kit.box(f"rubble{i}", (rr.uniform(0.3, 0.6),) * 3, (d * math.cos(a), d * math.sin(a), 0.0),
                M["pale" if i % 2 else "stone"], rot=(rr.uniform(0, 40), rr.uniform(0, 40), rr.uniform(0, 90)),
                bevel=0.05)


def family(o):
    p = o
    while p is not None:
        if p in kit.MOVING:
            return p.name
        p = p.parent
    n = o.name.split(".")[0]
    for cut in ("-",):
        n = n.split(cut)[0]
    return n.rstrip("0123456789")


kit.run(build, turn, family=family)
if kit.MODE == "where":
    print("PUMP end px %.1f %.1f" % kit.scr(V((5.0, 2.6, 10.75))))
