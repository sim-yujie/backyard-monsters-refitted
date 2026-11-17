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
sys.path.insert(0, str(HERE))
import kit  # noqa: E402

kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (-6.0, 44.0)
kit.FRAME = (-84, -104, 146, 106)
N = 35
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame 35 (= frame 0), the loop check
kit.SUN_COL = (1.0, 0.94, 0.84)
kit.SUN, kit.SKY_E = 6.2, 0.3          # harder light than the overworld recipe: Flash's picture is contrasty
STATE = kit.STATE
DMG = STATE == "damaged"

H = 2.15                    # the vat's half side
ZM = 2.0                    # the mound's top
ZT = 6.5                    # the vat's rim
XM, YM = 1.75, -0.26        # the tall front post
XB = XM - 1.65              # the tall back post
XA = XM - 0.78              # the rocker arm's plane, between the posts
ZP = 14.3                   # the rocker's pivot
ZTOP = 16.25                 # the tall posts' tops
YS, ZS = -1.4, 10.6        # the shaft's line (along X), in front of the posts
XW, XW2 = -0.45, -4.1      # the big wheel and the small wheel on the shaft
REST = 6.0                  # the arm's far end hangs this much at rest (Flash's arm slopes less than the wall)
LIFT = 29.0                 # the rocker's swing, degrees
V = Vector
M = {}
PART = {}
rr = random.Random(11)


def P(sx, sy, z):
    return kit.px(sx, sy, Z=z)


# ------------------------------------------------------------------------------------------------------- materials
def lava_mat():
    """Blocky cracked plates: dark crust and hot orange plates by turns, the glow in the cracks between them."""
    t = kit.NT("lava")
    v = t.coords(scale=(1.0, 1.0, 0.7))
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vo.inputs["Scale"].default_value = 1.7
    t.link(v, vo.inputs["Vector"])
    cell = t.n("ShaderNodeTexVoronoi", feature="F1")
    cell.inputs["Scale"].default_value = 1.7
    t.link(v, cell.inputs["Vector"])
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(cell.outputs["Color"], sep.inputs[0])
    n = t.noise(v, 5.0, 4.0, 0.6, 0.5)
    big = t.noise(v, 0.75, 3.0, 0.6, 1.5)
    val = t.mix(sep.outputs["X"], big, 0.6)
    plate = t.ramp(val, [(0.36, kit.srgb(54, 30, 40)), (0.45, kit.srgb(104, 52, 44)),
                                      (0.5, kit.srgb(214, 96, 14)), (0.66, kit.srgb(250, 160, 24))])
    plate = t.mix(plate, t.ramp(n, [(0.3, (0.45, 0.45, 0.45, 1)), (0.7, (1, 1, 1, 1))]), 1.0, "MULTIPLY")
    crack = t.ramp(vo.outputs["Distance"], [(0.0, (0.75, 0.75, 0.75, 1)), (0.012, (0.75, 0.75, 0.75, 1)), (0.04, (0, 0, 0, 1))])
    c = t.mix(plate, kit.srgb(255, 196, 60), crack)
    hot = t.ramp(val, [(0.48, (0, 0, 0, 1)), (0.62, (0.55, 0.55, 0.55, 1))])
    e = t.n("ShaderNodeMath", operation="MAXIMUM")
    t.link(crack, e.inputs[0])
    t.link(hot, e.inputs[1])
    t.set(**{"Base Color": c, "rough": 0.85})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.link(e.outputs[0], t.bsdf.inputs["Emission Strength"])
    t.bump(vo.outputs["Distance"], 0.9, 0.12)
    return t.m


def mats():
    p = kit.painted
    return dict(
        lava=lava_mat(),
        root=p("root", (58, 50, 30), rough=0.8, wear=(96, 96, 52), dirt=0.2),
        vat=p("vat", (12, 10, 10), rough=0.6, wear=(104, 70, 54), rust=(64, 44, 38), scale=2.2, dirt=0.3, spec=0.3,
              rust_at=0.45, grain=0.5, soot=0.4),
        pool=kit.flat("pool", (12, 30, 36), rough=0.6),
        copper=p("copper", (222, 114, 20), rough=0.45, metal=0.25, wear=(248, 168, 44), rust=(110, 50, 16),
                 scale=6.0, dirt=0.25, rust_at=0.56, soot=0.4, grain=0.4, ao_min=0.3),
        edge=kit.flat("edge", (250, 204, 44), rough=0.4, metal=0.2),
        bone=p("bone", (226, 196, 136), rough=0.5, wear=(250, 232, 186), rust=(116, 80, 46), scale=3.4, dirt=0.6,
               rust_at=0.52, soot=0.4, spec=0.35, ao_min=0.15, grain=0.2),
        bone2=p("bone2", (92, 68, 50), rough=0.6, wear=(150, 118, 84), rust=(44, 32, 26), scale=3.0, dirt=0.5,
                rust_at=0.45, soot=0.4, spec=0.25, ao_min=0.2),
        strap=p("strap", (74, 28, 32), rough=0.34, metal=0.3, wear=(216, 122, 126), rust=(30, 14, 16), scale=9.0,
                dirt=0.2, rust_at=0.48, grain=0.5, spec=0.9, ao_min=0.25, soot=0.3),
        stone=p("stone", (128, 114, 104), rough=0.8, wear=(204, 192, 176), rust=(66, 38, 36), scale=7.0, dirt=0.3,
                rust_at=0.42, grain=0.8, top=(206, 198, 184), streak=0.5, soot=0.6, ao_min=0.25),
        pale=p("pale", (206, 196, 180), rough=0.7, wear=(232, 226, 212), scale=6.0, dirt=0.15, grain=0.35,
               top=(244, 238, 224)),
        iron=p("iron", (26, 24, 28), rough=0.4, metal=0.6, wear=(84, 80, 82), rust=(72, 40, 28), scale=5.0, dirt=0.1,
               spec=0.6, rust_at=0.62),
        head=p("head", (124, 122, 120), rough=0.5, metal=0.4, wear=(170, 168, 164), rust=(70, 60, 58), scale=8.0,
               dirt=0.1),
        gold=p("gold", (232, 160, 24), rough=0.5, metal=0.2, wear=(255, 226, 90), rust=(96, 50, 16), scale=5.0,
               dirt=0.3, rust_at=0.5, spec=0.4, soot=0.35),
        hub=p("hub", (22, 26, 36), rough=0.3, metal=0.6, wear=(60, 66, 80), dirt=0.0, spec=0.7),
        hubflat=kit.flat("hubflat", (30, 26, 26), rough=0.55, metal=0.4),
        shaftflat=kit.flat("shaftflat", (48, 48, 58), rough=0.4, metal=0.6),
        shine=kit.flat("shine", (232, 236, 244), rough=0.25, metal=0.6),
        shaft=p("shaft", (46, 46, 56), rough=0.4, metal=0.6, wear=(96, 96, 108), dirt=0.0, spec=0.6),
        cap=p("cap", (96, 94, 92), rough=0.5, metal=0.5, wear=(140, 138, 134), rust=(60, 50, 46), dirt=0.0),
        steel=p("steel", (108, 102, 94), rough=0.5, metal=0.5, wear=(150, 146, 138), rust=(70, 52, 42), scale=5.0,
                dirt=0.1, soot=0.3),
        rivet=kit.flat("rivet", (220, 220, 226), rough=0.3, metal=0.7),
        grass=p("grass", (98, 132, 66), rough=0.9, wear=(122, 152, 80), dirt=0.1),
        moss=p("moss", (34, 70, 16), rough=0.9, wear=(70, 118, 30), dirt=0.3),
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
    prof = [(0.01, 0.0), (4.3, 0.0), (4.3, 0.6), (4.1, ZM - 0.55), (3.6, ZM - 0.1), (0.01, ZM + 0.05)]
    ob = kit.lathe("mound", prof, (0, 0, 0), M["lava"], verts=64)
    tex = bpy.data.textures.new("lumps", "VORONOI")
    tex.noise_scale = 1.1
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 3
    mo = ob.modifiers.new("lumps", "DISPLACE")
    mo.texture = tex
    mo.strength = 0.5
    mo.mid_level = 0.4
    # wispy dark roots round the foot, straggling out over the ground
    n = 14
    for i in range(n):
        a = 2 * math.pi * (i + rr.uniform(-0.45, 0.45)) / n
        d = V((math.cos(a), math.sin(a), 0))
        sd = V((-d.y, d.x, 0))
        ln = rr.uniform(0.2, 0.9)
        w = rr.uniform(-0.5, 0.5)
        p0 = d * 3.95 + V((0, 0, 0.45))
        p1 = d * (4.3 + ln * 0.45) + sd * w * 0.4 + V((0, 0, 0.1 + rr.uniform(0, 0.25)))
        p2 = d * (4.3 + ln) + sd * w + V((0, 0, 0.03))
        limb(f"root{i}", [(p0, 0.13), (p1, 0.06), (p2, 0.008)], M["grass" if i % 5 == 1 else "root"], seg=6, sub=5)


# Flash's grass at the foot: a soft pale fringe of blades round the mound, fading into the lawn. Its reach from
# Flash px FRINGE_C every 15 degrees (clockwise on screen from screen-right; up and down count double), its greens
# (dark, mid, pale, crease), where it starts to fade and how solid it is.
FRINGE_C = (-5, 50)
FRINGE = [72, 72, 70, 70, 70, 72, 74, 74, 72, 74, 76, 76, 70, 60, 54, 54, 54, 54, 54, 54, 54, 54, 60, 70]
GRASS = [(84, 118, 62), (104, 138, 80), (128, 160, 104), (40, 56, 26)]
FADE0, FADE_A = 0.8, 0.88
if DMG:                                     # Flash's damaged grass is darker and thicker
    GRASS = [(34, 58, 16), (56, 92, 26), (84, 126, 40), (16, 26, 8)]
    FADE0, FADE_A = 0.75, 0.97


def fringe_mat():
    t = kit.NT("grass2")
    v = t.coords()
    at = t.n("ShaderNodeAttribute", attribute_name="fade")
    sep = t.n("ShaderNodeSeparateColor")
    t.link(at.outputs["Color"], sep.inputs[0])
    far, crease, shade = sep.outputs[0], sep.outputs[1], sep.outputs[2]
    n = t.noise(v, 1.6, 2.0, 0.5, 0.2)
    leaf = t.ramp(n, [(0.3, kit.srgb(*GRASS[0])), (0.5, kit.srgb(*GRASS[1])), (0.75, kit.srgb(*GRASS[2]))])
    sh = t.ramp(shade, [(0.0, (0.66, 0.66, 0.66, 1)), (1.0, (1.1, 1.1, 1.1, 1))])
    leaf = t.mix(leaf, sh, 1.0, "MULTIPLY")
    cr = t.ramp(crease, [(0.6, (0, 0, 0, 1)), (0.95, (0.7, 0.7, 0.7, 1))])
    col = t.mix(leaf, kit.srgb(*GRASS[3]), cr)
    al = t.ramp(far, [(FADE0, (FADE_A,) * 3 + (1,)), (1.0, (0, 0, 0, 1))])
    t.set(**{"Base Color": col, "rough": 0.95, "spec": 0.03})
    t.link(al, t.bsdf.inputs["Alpha"])
    return t.m


def blades():
    """Flash's soft grass tufts round the mound's foot: one flat sheet on the ground, its rim cut into pointed blades
    that fade out into the lawn (no cones)."""
    cx_, cy_ = FRINGE_C
    c = kit.px(cx_, cy_, Z=0.0)
    lobes, per = 26, 7
    edges = [0.0]
    for i in range(lobes):
        edges.append(edges[-1] + rr.uniform(0.6, 1.4))
    edges = [e / edges[-1] * 360.0 for e in edges]
    ring = []
    for i in range(lobes):
        lshade, llen = rr.uniform(0.0, 1.0), rr.uniform(0.74, 1.0)
        for j in range(per):
            u = j / per
            d = edges[i] + (edges[i + 1] - edges[i]) * u
            k = d / 15.0
            r0, r1 = FRINGE[int(k) % 24], FRINGE[(int(k) + 1) % 24]
            r = (r0 + (r1 - r0) * (k - int(k))) * llen * (0.74 + 0.26 * (1 - abs(2 * u - 1)) ** 0.8)
            a = math.radians(d)
            ring.append((kit.px(cx_ + r * math.cos(a), cy_ + 0.5 * r * math.sin(a), Z=0.0), abs(2 * u - 1),
                         0.65 * lshade + (0.35 if u < 0.5 else 0.0)))
    bm = bmesh.new()
    lay = bm.loops.layers.color.new("fade")
    R = 10
    rows, att = [], {}
    for r in range(1, R + 1):
        t = r / R
        row = []
        for p, cr, shd in ring:
            v = bm.verts.new(c + (p - c) * t + V((0, 0, 0.03 + 0.1 * (1 - t))))
            att[v] = (t, cr if t > 0.55 else 0.0, shd)
            row.append(v)
        rows.append(row)
    cv = bm.verts.new(c + V((0, 0, 0.13)))
    att[cv] = (0.0, 0.0, 0.5)
    m = len(ring)
    for i in range(m):
        bm.faces.new((cv, rows[0][i], rows[0][(i + 1) % m]))
    for a, b in zip(rows, rows[1:]):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((a[i], b[i], b[j], a[j]))
    for f in bm.faces:
        for lp in f.loops:
            lp[lay] = att[lp.vert] + (1.0,)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("fringe", bm, [fringe_mat()], smooth=True)


def vat():
    kit.box("vat", (2 * H, 2 * H, 1.3), (0, 0, ZT - 1.3), M["vat"], bevel=0.08)
    belly = kit.box("vat-belly", (2 * H + 0.25, 2 * H + 0.25, ZT - 0.9), (0, 0, 0.6), M["vat"], bevel=1.7)
    belly.modifiers["bevel"].segments = 8
    belly.modifiers["bevel"].limit_method = "NONE"
    lumpy(belly, 0.12)
    kit.box("vat-top", (2 * H - 0.25, 2 * H - 0.25, 1.0), (0, 0, ZT - 0.05), M["vat"], bevel=0.06)
    kit.box("vat-pool", (2 * H - 0.5, 2 * H - 0.5, 0.1), (0, 0, ZT + 0.9), M["pool"], bevel=0.0)
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


def seg_bone(name, a, b, rs, ra, rb, mat, bend=0.0, cond_a=True, cond_b=True, parent=None, vox=0.05, lumps=0.07):
    """One real long bone from a to b: a shaft that narrows to rs in the middle and bows a little (bend), flaring to
    its ends (radii ra, rb), each end a pair of rounded condyles side by side as seen from the camera (or one blunt
    knob). The pieces are fused into one skin (voxel remesh), smoothed and made uneven."""
    a, b = V(a), V(b)
    ax = b - a
    ln = ax.length
    ax.normalize()
    side = ax.cross(kit.cam_fwd()).normalized()
    if kit.scr(a + side)[0] > kit.scr(a)[0]:
        side = -side                                  # side points to screen left: bend > 0 bows the shaft left
    dep = ax.cross(side).normalized()
    if dep.dot(kit.cam_fwd()) > 0:
        dep = -dep                                    # dep points at the camera
    bm = bmesh.new()
    n, seg = 16, 14
    ph = rr.uniform(0, 6.28)
    rows = []
    for i in range(n + 1):
        t = i / n
        r = rs * (1 + 0.1 * math.sin(5 * t + ph)) + (ra * 0.8 - rs) * max(0.0, 1 - t / 0.3) ** 2 \
            + (rb * 0.8 - rs) * max(0.0, 1 - (1 - t) / 0.3) ** 2
        c = a + ax * (ln * t) + side * (bend * math.sin(math.pi * t))
        rows.append([bm.verts.new(c + (side * math.cos(2 * math.pi * k / seg) * 1.06
                                       + dep * math.sin(2 * math.pi * k / seg) * 0.94) * r) for k in range(seg)])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            bm.faces.new((r0[k], r0[j], r1[j], r1[k]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    for end, r, on, sg in ((a, ra, cond_a, 1), (b, rb, cond_b, -1)):
        if on:
            for s in (-1, 1):
                c = end + ax * (sg * r * 0.42) + side * (s * r * 0.5) + dep * (0.12 * r)
                k = rr.uniform(0.92, 1.08)
                bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=r * 0.62 * k,
                                          matrix=Matrix.Translation(c))
            # the ridge between the condyles and the shaft
            bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=r * 0.7,
                                      matrix=Matrix.Translation(end + ax * (sg * r * 0.95) - dep * (0.1 * r)))
        else:
            bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=r * 0.85,
                                      matrix=Matrix.Translation(end + ax * (sg * r * 0.5)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat], parent=parent)
    rm = ob.modifiers.new("fuse", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = vox
    rm.use_smooth_shade = True
    sm = ob.modifiers.new("soft", "SMOOTH")
    sm.factor = 0.7
    sm.iterations = 4
    lumpy(ob, lumps)
    return ob


def bones():
    b = M["bone"]
    fw = kit.cam_fwd()
    # left bone (three bones jointed end to end): foot on the mound at the vat's left corner, a joint, a second joint
    # level with the rim, then a long bone leaning in over the vat to its egg head. Traced from Flash's pixels.
    j0, j1, j2, j3 = P(-50.5, 39.5, 0.3), P(-50, 13, 3.5), P(-53.5, -16.5, 6.85), P(-33.5, -57, 10.4)
    seg_bone("boneL-a", j0, j1, 0.3, 0.46, 0.46, b, bend=-0.1)
    seg_bone("boneL-b", j1, j2, 0.32, 0.46, 0.52, b, bend=-0.1)
    seg_bone("boneL-c", j2, j3, 0.38, 0.52, 0.42, b, bend=0.2, cond_b=False)
    tooth("boneL-head", P(-30.8, -57.5, 10.4), 0.7, 2.05, b, zdir=(0.0, 0.46, 1))
    LB["L1"], LB["L0"] = P(-51, -22, 7.0) - fw * 0.55, P(-49, -1, 4.9) - fw * 0.45
    # front bone: up the vat's front corner, joints low, at mid height and at the rim, then leaning along the
    # right-hand wall to its big egg head
    f0, f1, f2, f3, f4 = P(-8, 64.5, 0.0), P(-8.3, 52.5, 1.1), P(-3.5, 30.5, 3.7), P(-3.3, 6, 6.95), P(16, -32, 9.9)
    seg_bone("boneF-a", f0, f1, 0.34, 0.4, 0.5, b, cond_a=False)
    seg_bone("boneF-b", f1, f2, 0.4, 0.5, 0.5, b, bend=0.1)
    seg_bone("boneF-c", f2, f3, 0.33, 0.5, 0.46, b, bend=0.08)
    seg_bone("boneF-d", f3, f4, 0.36, 0.46, 0.42, b, bend=0.36, cond_b=False)
    tooth("boneF-head", P(16, -33.5, 9.9), 0.7, 2.15, b, zdir=(0.0, 0.08, 1))
    LB["F1"], LB["F0"] = P(-9, -3, 7.2) - fw * 0.55, P(-11, 17, 5.35) - fw * 0.5
    # right bone: darker, at the vat's right corner, up to the pump box
    b2 = M["bone2"]
    r0, r1, r2, r3 = P(37.5, 42, 0.1), P(42.3, 16.5, 3.3), P(42.5, 5.5, 4.5), P(42, -24, 7.8)
    seg_bone("boneR-a", r0, r1, 0.34, 0.5, 0.46, b2, bend=0.08)
    seg_bone("boneR-b", r1, r2, 0.4, 0.46, 0.56, b2)
    seg_bone("boneR-c", r2, r3, 0.34, 0.56, 0.44, b2, bend=-0.05, cond_b=False)
    LB["R0"], LB["R1"] = P(42, 15.5, 3.3) - fw * 0.5, P(41.5, 8, 4.3) - fw * 0.55
    # the dark bone from the front bone's head across to the right bone's top, under the pump box
    seg_bone("boneR-d", P(22, -30, 9.3), P(42, -20, 8.0), 0.62, 0.7, 0.6, b2, bend=-0.12, cond_a=False)
    LB["F0r"] = P(4, 28, 3.9) - fw * 0.5


def straps():
    # left-hand wall, two tiers, from the left bone to the front bone
    strap("strapL1", LB["L1"], LB["F1"], (0, 0, 1), w=1.1, sag=0.1)
    strap("strapL0", LB["L0"], LB["F0"], (0, 0, 1), w=0.95, sag=0.2)
    # right-hand wall: low, from the front bone to the right bone, hanging; and a short one from the rim down to the
    # right bone's knuckle
    strap("strapR0", LB["F0r"], LB["R0"], (0, 0, 1), w=0.7, sag=0.35)
    strap("strapR1", P(24.5, -2.5, ZT - 0.9) - kit.cam_fwd() * 0.25, LB["R1"], (0, 0, 1), w=1.0, sag=0.1)


def pillars():
    post("pillarL", -1.62, -1.75, ZT - 0.05, 10.2, 0.6, M["pale"])
    post("pillarF", 1.8, YS, ZT - 0.05, 9.95, 0.56, M["pale"])
    s = 0.78
    post("postM", XM, YM, ZT - 0.05, ZTOP, s, M["stone"], bevel=0.07)
    post("postB", XB - 0.12, YM, ZT - 0.05, ZTOP, 0.95, M["stone"], bevel=0.07)
    # dark iron between the two posts (the hammer's guide), the pivot block on the front post's right-hand face, and
    # the dark machine bed the posts stand in, on the vat's back half
    kit.box("guide", (XM - XB, 0.3, ZTOP - ZT - 1.4), ((XM + XB) / 2, YM + 0.1, ZT), M["iron"], bevel=0.02)
    kit.box("pivot", (0.34, 0.7, 2.3), (XM + s / 2 + 0.12, YM, ZP - 2.05), M["iron"], bevel=0.05)
    kit.box("bed", (1.9, 2.5, 1.25), (-1.25, 0.35, ZT - 0.05), M["iron"], bevel=0.08)
    kit.box("bed2", (3.9, 1.7, 3.1), (0.0, 1.15, ZT - 0.05), M["iron"], bevel=0.25)
    # the rusty beam between their tops
    kit.box("beam", (XM - XB - 0.6, 0.6, 1.0), ((XM + XB) / 2, YM, ZTOP - 1.1), M["strap"], bevel=0.05)
    # bolts on the front post's right-hand face: the rocker's axle and one below
    for i, z in enumerate((ZP, ZP - 1.75)):
        kit.cyl(f"bolt{i}", 0.17, 0.12, (XM + s / 2 - 0.02, YM, z), M["iron"], rot=(0, 90, 0), verts=12, bevel=0.02)
        rivet(f"bolt{i}-rv", (XM + s / 2 + 0.1, YM, z), 0.08)


def pump():
    # the copper pump box on the right bone: a long riveted box along X, its near side dark steel
    x0, x1, y0, y1, z0, z1 = 0.45, 5.0, 2.15, 3.05, 9.25, 10.55
    kit.box("pump", (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, z0), M["copper"], bevel=0.05)
    kit.box("pump-side", (x1 - x0 - 0.3, 0.06, z1 - z0 - 0.32), ((x0 + x1) / 2, y0 - 0.03, z0 + 0.14), M["steel"],
            bevel=0.02)
    kit.box("pump-skirt", (x1 - x0 - 1.6, 0.5, 1.1), ((x0 + x1) / 2 - 0.5, y0 + 0.3, z0 - 1.05), M["steel"], bevel=0.05)
    for i in range(5):
        rivet(f"pump-rv{i}", (x0 + 0.75 + i * 0.85, y0 + 0.2, z1 + 0.02), 0.1)
    for i, z in enumerate((z0 + 0.3, z1 - 0.3)):
        rivet(f"pump-rve{i}", (x1 + 0.02, (y0 + y1) / 2 + 0.1, z), 0.1)


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
        # a short saw tooth across the drum's width (Flash's drum has short teeth, not long spikes)
        bm = bmesh.new()
        bt, hw = sr, w * 0.46
        base = [bm.verts.new((r - 0.04, sy_ * bt, x + sz_ * hw)) for sy_, sz_ in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        top = [bm.verts.new((r + sl, bt * 0.45, x + sz_ * hw * 0.8)) for sz_ in (-1, 1)]
        bm.faces.new(base)
        bm.faces.new((base[0], base[1], top[0]))
        bm.faces.new((base[2], base[3], top[1]))
        bm.faces.new((base[1], base[2], top[1], top[0]))
        bm.faces.new((base[3], base[0], top[0], top[1]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = kit.mesh_ob(f"{name}-spike{i}", bm, [g], smooth=False, parent=parent)
        ob.rotation_euler = (0, 0, a)
        a2 = a + math.pi / spikes
        d2 = V((math.cos(a2), math.sin(a2), 0))
        ob = kit.cyl(f"{name}-hole{i}", sr * 0.5, 0.05, d2 * (r - 0.03) + V((0, 0, x)), M["hubflat"], verts=3,
                     bevel=0.0, parent=parent)
        ob.rotation_euler = d2.to_track_quat("Z", "Y").to_euler()


def shaft():
    def parts(hub):
        kit.cyl("shaft-rod", 0.23, 3.3 - XW2 + 0.25, (0, 0, XW2 - 0.25), M["shaftflat"], verts=16, bevel=0.02,
                parent=hub)
        wheel(hub, XW, 1.2, 1.0, 16, 0.36, 0.2, "wheel", 0.5)
        wheel(hub, XW2, 0.58, 0.36, 16, 0.24, 0.1, "wheel2", 0.22)
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
    kit.cyl("rod-bar", 0.07, 3.5, (0, 0, -3.5), ir, verts=10, bevel=0.0, parent=r)
    kit.blob("rod-eye", (0, 0, 0), 0.13, squash=1.0, mat=ir, parent=r)


def build():
    M.update(mats())
    mound()
    blades()
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
    th = -math.radians(REST) - math.radians(LIFT) * lift(k)
    PART["rocker"].rotation_euler = (th, 0, 0)
    q = Matrix.Rotation(th, 3, "X") @ V((0, 2.5, -0.45))
    PART["rod"].location = V((XA, YM, ZP)) + q


# ------------------------------------------------------------------------------------------------------------ damaged
def wreck():
    """One rough pass after Flash's damaged picture: sooted, the rocker knocked askew, the big wheel off its shaft and
    lying in the vat, the left bone fallen outward, the front bone broken, the pump box hanging, moss at the foot."""
    for m in list(bpy.data.materials):
        nt = m.node_tree
        if nt is None or m.name.startswith(("lava", "moss", "pool", "bone", "grass")):
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

    def lean(names, pivot, deg, drop=0.0, zs=1.0):
        """Turn the named objects on screen (about the camera's line of sight) round a world pivot, squash them
        toward the pivot's height by zs and lower them by drop."""
        R = Matrix.Rotation(math.radians(deg), 4, kit.cam_fwd())
        Sc = Matrix.Diagonal((1, 1, zs, 1))
        T = Matrix.Translation(V(pivot) - V((0, 0, drop))) @ R @ Sc @ Matrix.Translation(-V(pivot))
        for o in ob:
            if o.parent is None and o.name.startswith(names):
                o.matrix_world = T @ o.matrix_world

    bpy.context.view_layer.update()
    # the left bone has come off its foot and stands straight, leaning out, its knobby head up at the top left
    for o in ob:
        if o.name.startswith("boneL"):
            o.hide_render = True
            o.location.z -= 60
    seg_bone("dboneL", P(-53, 14, 3.2), P(-45, -50, 10.0), 0.62, 0.8, 0.7, M["bone"], bend=0.05)
    tooth("dboneL-head", P(-44, -52, 10.2), 0.95, 2.3, M["bone"], zdir=(0.2, 0.5, 1))
    tooth("dboneL-head2", P(-36, -52, 10.2), 0.6, 1.5, M["bone"], zdir=(1, 1, 0.6))
    seg_bone("dboneL-low", P(-66, 26, 0.4), P(-56, 22, 0.5), 0.3, 0.4, 0.4, M["bone"])
    # the front bone has snapped: its upper half lies across the vat, the right bone's head stands behind it
    for o in ob:
        if o.name.startswith(("boneF-c", "boneF-d")):
            o.hide_render = True
            o.location.z -= 60
    seg_bone("dboneF-top", P(-12, -7, 8.0), P(17, -13, 8.0), 0.36, 0.5, 0.46, M["bone"], bend=0.1)
    seg_bone("dboneF-up", P(24, -18, 8.0), P(27, -37, 8.6), 0.34, 0.44, 0.4, M["bone"])
    # the left rim plate has dropped at its front end, with the upper strap flopped over it
    tip(("rimL",), V((-H, -H - 0.06, ZT - 0.6)), (0, 26, 0))
    tip(("strapL1",), LB["F1"], (0, -12, 0))
    tip(("strapL0",), LB["F0"], (0, -6, 0))
    tip(("pump",), V((2.6, 2.6, 9.0)), (0, 45, 0))      # the pump box hangs off the right bone
    tip(("strapR1",), LB["R1"], (0, 25, 0))
    tip(("rocker", "rod"), V((XA, YM, ZP)), (-30, 0, -18))
    # the tall posts are broken short (Flash's stand about 12 px lower); what hangs on them comes down with them
    lean(("postM", "postB", "guide", "pivot", "bolt"), V((XM, YM, ZT)), 0.0, zs=DMG_POST)
    lean(("beam", "rocker", "rod"), V((XM, YM, ZT)), 0.0, drop=(ZTOP - ZT) * (1 - DMG_POST))
    lean(("postB",), V((XB, YM, ZT)), DMG_POSTB)
    tip(("pillarL",), V((-1.87, -1.87, ZT)), (8, -5, 0))
    # the shaft has dropped into the vat, its far end on the back rim
    # and the big wheel lies nearly flat, a gold ring seen from above (Flash px -17, -43)
    tip(("shaft", "cap"), V((XM, YS, ZS)), (0, -68, 10))
    bpy.context.view_layer.update()
    wc = PART["shaft"].matrix_world @ V((0, 0, XW))
    mv = P(-17, -43, 12.5) - wc
    for o in ob:
        if o.parent is None and o.name.startswith(("shaft", "cap")):
            o.matrix_world = Matrix.Translation(mv) @ o.matrix_world
    # the front bone's head is knocked off and lies at the foot
    for o in ob:
        if o.name.startswith("boneF-head"):
            o.matrix_world = (Matrix.Translation(P(-34, 60, 0.75))
                              @ V((1, 0.8, 0.12)).to_track_quat("Z", "Y").to_matrix().to_4x4())
    # loose bones at the foot
    for i, (sx, sy, az) in enumerate(((-10, 66, 30), (22, 60, -50), (-58, 50, 80), (40, 46, 10))):
        c = P(sx, sy, 0.3)
        d = V((math.cos(math.radians(az)), math.sin(math.radians(az)), 0)) * 0.9
        limb(f"loose{i}", [(c - d, 0.34), (c - d * 0.7, 0.2), (c + d * 0.7, 0.2), (c + d, 0.34)], M["bone"], seg=10,
             sub=4, lumps=0.08)
    # rubble and moss round the foot
    for i in range(70):
        a = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(3.9, 5.2)
        kit.blob(f"moss{i}", (d * math.cos(a), d * math.sin(a), 0.1), rr.uniform(0.35, 0.7), squash=0.35,
                 mat=M["moss"])
    for i in range(14):
        a = rr.uniform(-2.4, 0.8)
        d = rr.uniform(4.3, 5.2)
        kit.box(f"rubble{i}", (rr.uniform(0.3, 0.6),) * 3, (d * math.cos(a), d * math.sin(a), 0.0),
                M["pale" if i % 2 else "stone"], rot=(rr.uniform(0, 40), rr.uniform(0, 40), rr.uniform(0, 90)),
                bevel=0.05)


DMG_BONEL = 19.0
DMG_POST = 0.86             # the tall posts' height against whole
DMG_POSTB = 3.0             # the back post's lean on screen


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


PROJ = float(os.environ.get("PB_PROJ", 0.72))         # how much of Flash's own picture lies on the model (0 = none)


def build_all():
    build()
    turn(0)
    bpy.context.view_layer.update()
    if kit.MODE == "sil" or DMG is None:
        return
    if PROJ > 0:
        import proj
        src = HERE / "work" / ("flash-dmg.png" if DMG else "flash0.png")
        proj.apply(src, HERE / "work" / ("proj-dmg" if DMG else "proj"), w=PROJ, emit=0.5, grit=0.1,
                   per=PER, moving=("rocker", "rod"), skip=SKIP + (DMG_SKIP if DMG else ()))


# the posts, hammer and dark iron stand behind the gold wheels: they take only Flash's grey pixels, never the gold
_grey = lambda c: (c.max(-1) - c.min(-1)) < 50
PER = dict(lava=dict(w=1.0, emit=0.92, grit=0.05, only=lambda c: (c[..., 2] < 0.6 * c[..., 0]) | (c.max(-1) < 90)), bone=dict(emit=0.25), bone2=dict(emit=0.3), strap=dict(trim=15),
           vat=dict(w=0.5, emit=0.2), steel=dict(emit=0.3),
           stone=dict(w=1.0, emit=0.8, only=_grey), head=dict(only=_grey), iron=dict(only=_grey))
# the wreck does not line up with Flash's damaged picture, so only its lava mound takes Flash's colours
DMG_SKIP = ("vat", "pool", "bone", "bone2", "stone", "pale", "iron", "head", "moss")
# the straps, rim plates and pump box keep their own crisp painted rust and modelled rivets: Flash's picture smears
# on thin parts that sit a pixel or two off
SKIP = ("gold", "hub", "hubflat", "shaftflat", "shine", "shaft", "cap", "grass", "grass2", "root", "strap", "copper",
        "edge", "steel", "rivet")

if kit.MODE == "sil":
    import proj
    build_all()
    proj.sil(HERE / "work" / "sil", 3, family)
else:
    kit.run(build_all, turn, family=family)
if kit.MODE == "where":
    print("PUMP end px %.1f %.1f" % kit.scr(V((5.0, 2.6, 10.75))))
