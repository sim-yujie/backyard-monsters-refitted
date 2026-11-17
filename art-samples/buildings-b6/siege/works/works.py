"""works.py : the Siege Works (building 134, Flash folder siegelab) in 3D, one look for its ten levels, built from the
Flash picture measured on a pixel grid (17 Nov 2026). Only the generic kit is used (../../inferno/kit.py: camera,
light, render modes, helpers), as the Inferno Strongbox and Incubator.

    blender -b --factory-startup -P works.py -- 1 <fit|check|gap|probe|still|anim|base> [frame]
    PB_STATE=damaged ... -- 1 base        the rough damaged still (render/L1-damaged-base.png, -alone.png)

The building: a tall, narrow forge tent of near-black hide on a slab of cracked mossy rock. Its front-left wall
stands upright to a rail half way up and leans back above it; on the leaning part a big riveted iron frame (rail,
two legs, a pointed top) opens on the glowing forge. Below the rail: a bone post at the left corner, brown planks,
a bone post under the frame's right leg, then a tall slit of fire and the big bone corner post. In front of the
planks an orange bellows with a bone lever and a nozzle on a dark riveted foot. On the right (gable) wall: a glowing
rod hanging from the axle's end into a dark red barrel, a small window of fire and, at the foot, a dark red
machine with a cog and bone pegs. On the ridge an axle on red bearings carries the rocker: a bow-tie beam with two
fan heads, pale strips along its top edges and a gold ring on each tip; a chain runs over the left head's arc and
hangs down the front into a chain box on the rail; the right head dips into a slot in the roof.

World: Z up, 10 Flash px per unit across. The camera looks from +X -Y: the front-left wall faces -Y, the gable +X.

The loop (a weapon unlocking), 60 frames as Flash's three strips: the rocker swings once (53 degrees, measured from
the two gold rings' paths: pivot at Flash px (6.7, -59), swinging in the Y-Z plane) and the chain follows it; the
bellows' lever jumps up and its nozzle draws in by frame 12, then both sink back slowly; the cog turns once (ten
teeth, a tooth every six frames, as Flash). Idle is frame 0, as Flash holds cell 0.
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
kit.ORIGIN = (8.0, 32.0)
kit.FRAME = (-75, -95, 125, 95)
N = 60
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame 60 (= frame 0), the loop check
kit.SUN_COL = (1.0, 0.95, 0.86)
DAMAGED = kit.STATE == "damaged"
rnd = random.Random(134)

HX, HY = 3.5, 3.2                    # the body's half sizes on the ground
HXL = 3.1                            # ... its left end (Flash's front wall is a little narrower than its gable)
ZS = 0.3                             # the slab's top
ZRAIL = 4.5                          # the front wall is upright to here, then leans back
LEAN = 0.53                          # ... by this much per unit of height
GLEAN = 0.11                         # the gable leans back (toward -X) by this per unit of height
PIV = Vector((0.15, -0.33, 10.5))    # the rocker's pivot (Flash px 6.7, -59)
RAD = 3.13                           # pivot to a gold ring
TIP = 40.0                           # a ring sits this far above the beam's line, in degrees, at rest
SWING = 53.0
BW = 1.1                             # the beam's thickness along the axle
FWD = kit.cam_fwd()
M = {}
PART = {}

# the back wall's edge as Flash draws it on the gable (Flash px): steep to the step, a ledge out, then upright
BACK_PX = [(36, -47), (39, -40), (42, -30), (44, -23), (51, -21.5), (50, 0), (52, 12), (51, 30)]
RIDGE = 10.17                        # the roof's ridge: the axle lies on it


def on(sx, sy, p0, n):
    """The world point on Flash pixel (sx, sy) that lies on the plane through p0 with normal n."""
    o = kit.px(sx, sy, Z=0.0)
    return o + FWD * ((Vector(p0) - o).dot(n) / FWD.dot(n))


NU = Vector((0, -1, LEAN)).normalized()          # the leaning front wall's outward normal
PU = Vector((0, -HY, ZRAIL))
NG = Vector((1, 0, GLEAN)).normalized()          # the gable's
PG = Vector((HX, 0, 0))
NF = Vector((0, -1, 0))                          # the upright front wall's
PF = Vector((0, -HY, 0))


def U(sx, sy, off=0.0):
    return on(sx, sy, PU + NU * off, NU)


def G(sx, sy, off=0.0):
    return on(sx, sy, PG + NG * off, NG)


def F(sx, sy, off=0.0):
    return on(sx, sy, PF + NF * off, NF)


def poly(name, pts, normal, thick, mat, bevel=0.04, parent=None, smooth=False):
    """A flat plate: the outline pts (world points on one plane), `thick` thick, built outward along normal."""
    bm = bmesh.new()
    n = Vector(normal).normalized()
    vs = [bm.verts.new(Vector(p)) for p in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co += n * thick
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat], smooth=smooth, bevel=bevel, segs=2, parent=parent)


def chaikin(pts, n=2, closed=False):
    pts = [Vector(p) for p in pts]
    for _ in range(n):
        out = [] if closed else [pts[0]]
        m = len(pts)
        for i in range(m if closed else m - 1):
            a, b = pts[i], pts[(i + 1) % m]
            out += [a * 0.75 + b * 0.25, a * 0.25 + b * 0.75]
        if not closed:
            out.append(pts[-1])
        pts = out
    return pts


def bone(name, p0, p1, r, rings=(), knob=1.35, foot=1.3, parent=None, mat=None):
    """A bone post from p0 to p1: a fat foot, a knuckle on top and raised rings at the given fractions."""
    p0, p1 = Vector(p0), Vector(p1)
    ln = (p1 - p0).length
    prof = [(0.0, 0.0)]
    n = 60
    for i in range(n + 1):
        s = i / n
        k = 1.0 - 0.1 * math.sin(math.pi * s)                     # a little thinner in the middle
        k += (foot - 1.0) * max(0.0, 1.0 - s / 0.1) ** 2
        k += (knob - 1.0) * math.exp(-((s - 0.95) / 0.045) ** 2)
        for t in rings:
            k += 0.42 * math.exp(-((s - t) / 0.024) ** 2) - 0.16 * math.exp(-((s - t + 0.05) / 0.02) ** 2)
        if s > 0.975:
            k *= math.sqrt(max(0.0, 1.0 - ((s - 0.975) / 0.025) ** 2)) * 0.6 + 0.4
        prof.append((r * k, s * ln))
    prof.append((0.0, ln))
    ob = kit.lathe(name, prof, p0, mat or M["bone"], verts=20, parent=parent)
    ob.rotation_euler = (p1 - p0).to_track_quat("Z", "Y").to_euler()
    return ob


def rivets(name, pts, n, r=0.09, mat=None, parent=None):
    for i, p in enumerate(pts):
        b = kit.blob(f"{name}-{i}", Vector(p), r, squash=0.7, mat=mat or M["rivet"], parent=parent)
        b.rotation_euler = Vector(n).to_track_quat("Z", "Y").to_euler()


# ----------------------------------------------------------------------------------------------------------- materials
def glow(name, lo, hi, strength, streak=1.0, dark=(70, 16, 4), scale=2.0, up=None):
    """A plain glowing surface (the rod, the gable's window): soft streaks from `dark` through `lo` to `hi`."""
    t = kit.NT(name)
    v = t.coords(scale=(1.0, 0.05, 0.12 * streak))
    n = t.noise(v, scale, 4.0, 0.6, 0.6)
    c = t.ramp(n, [(0.3, kit.srgb(*dark)), (0.48, kit.srgb(*lo)), (0.72, kit.srgb(*hi))])
    t.set(**{"Base Color": (0, 0, 0, 1), "rough": 0.9, "spec": 0.0})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = strength
    return t.m


def flames(name, z0, z1, strength=1.05, scale=3.0, amp=0.55):
    """Painted fire, as Flash's forge: tongues of pale yellow at the foot (height z0) climbing through orange and red
    to near black at z1; a noise that changes fast across and slowly upward shapes the tongues."""
    t = kit.NT(name)
    geo = t.n("ShaderNodeNewGeometry")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(geo.outputs["Position"], sep.inputs[0])
    mr = t.n("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = z0, z1
    t.link(sep.outputs["Z"], mr.inputs[0])
    n = t.noise(t.coords(scale=(1.0, 0.05, 0.16)), scale, 3.0, 0.55, 0.5)
    nr = t.n("ShaderNodeMapRange")
    nr.inputs[3].default_value, nr.inputs[4].default_value = -amp, amp
    nr.clamp = False
    t.link(n, nr.inputs[0])
    add = t.n("ShaderNodeMath", operation="ADD")
    t.link(mr.outputs[0], add.inputs[0])
    t.link(nr.outputs[0], add.inputs[1])
    c = t.ramp(add.outputs[0], [(0.0, kit.srgb(255, 232, 110)), (0.16, kit.srgb(255, 176, 28)),
                                (0.38, kit.srgb(236, 96, 8)), (0.6, kit.srgb(160, 42, 6)),
                                (0.82, kit.srgb(56, 14, 6)), (1.0, kit.srgb(20, 7, 5))])
    fine = t.noise(t.coords(scale=(1.0, 0.05, 0.05)), scale * 5, 2.0, 0.5)
    c = t.mix(c, t.ramp(fine, [(0.35, (0.72, 0.6, 0.55, 1)), (0.6, (1, 1, 1, 1))]), 1.0, "MULTIPLY")
    t.set(**{"Base Color": (0, 0, 0, 1), "rough": 0.9, "spec": 0.0})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = strength
    return t.m


def turf():
    """The mound's dark cracked turf; it fades out toward its rim (the vertex colour `fade`), into the lawn."""
    t = kit.NT("turf")
    v = t.coords()
    n = t.noise(v, 1.3, 5.0, 0.65, 0.6)
    col = t.ramp(n, [(0.3, kit.srgb(48, 70, 40)), (0.5, kit.srgb(72, 100, 58)), (0.72, kit.srgb(102, 130, 82))])
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vo.inputs["Scale"].default_value = 0.42
    wv = t.noise(v, 2.5, 3.0, 0.6)
    wm = t.mix(v, wv, 0.12)
    t.link(wm, vo.inputs["Vector"])
    crack = t.ramp(vo.outputs["Distance"], [(0.0, (0.16, 0.18, 0.14, 1)), (0.05, (0.5, 0.52, 0.46, 1)), (0.11, (1, 1, 1, 1))])
    col = t.mix(col, crack, 1.0, "MULTIPLY")
    grain = t.ramp(t.noise(v, 22.0, 2.0, 0.5), [(0.3, (0.72, 0.72, 0.72, 1)), (0.6, (1, 1, 1, 1))])
    col = t.mix(col, grain, 1.0, "MULTIPLY")
    at = t.n("ShaderNodeAttribute", attribute_name="fade")
    al = t.ramp(at.outputs["Fac"], [(0.84, (1, 1, 1, 1)), (1.0, (0, 0, 0, 1))])
    t.set(**{"Base Color": col, "rough": 0.95, "spec": 0.05})
    t.link(al, t.bsdf.inputs["Alpha"])
    t.bump(vo.outputs["Distance"], 0.9, 0.05)
    return t.m


def worn(name, col, rough=0.5, metal=0.3, scale=3.0, blotch=0.4, edge=0.5, hi=(255, 246, 232), dirt=0.3,
         ao_min=0.4, scratch=0.15, spec=0.4, stain=None, stain_at=0.5, soot=0.4, bump=0.12, top=None, vein=1.0):
    """A worn, dirty surface as Flash paints them: hard-edged darker patches, upright scratches, soot that runs down
    the part, stains of another colour (`stain`: rust, old blood, moss), pale worn edges (`edge`, colour `hi`), dark
    creases and a darker foot. `top`: faces turned up take this colour (lit moss, a lid)."""
    t = kit.NT(name)
    v = t.coords()
    col = kit.srgb(*col)
    if top:
        geo = t.n("ShaderNodeNewGeometry")
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sep.inputs[0])
        col = t.mix(col, kit.srgb(*top), t.ramp(sep.outputs["Z"], [(0.45, (0, 0, 0, 1)), (0.85, (1, 1, 1, 1))]))
    if stain:
        n0 = t.noise(v, scale * 0.7, 5.0, 0.65, vein)
        col = t.mix(col, kit.srgb(*stain), t.ramp(n0, [(stain_at, (0, 0, 0, 1)), (stain_at + 0.12, (0.8,) * 3 + (1,))]))
    n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.4)
    k = 1.0 - blotch
    col = t.mix(col, t.ramp(n1, [(0.46, (k, k, k, 1)), (0.54, (1, 1, 1, 1))]), 1.0, "MULTIPLY")
    if scratch:
        n2 = t.noise(t.coords(scale=(1.0, 1.0, 0.08)), scale * 6, 3.0, 0.6)
        lo, up = 1.0 - scratch, 1.0 + scratch * 0.6
        col = t.mix(col, t.ramp(n2, [(0.4, (lo, lo, lo, 1)), (0.6, (up, up, up, 1))]), 1.0, "MULTIPLY")
    if soot:
        n3 = t.noise(t.coords(scale=(1.0, 1.0, 0.2)), scale * 0.45, 6.0, 0.7, 0.4)
        col = t.mix(col, kit.srgb(24, 19, 16), t.ramp(n3, [(0.42, (0, 0, 0, 1)), (0.66, (soot,) * 3 + (1,))]))
    if edge:
        ao = t.n("ShaderNodeAmbientOcclusion", samples=8, inside=True, only_local=True)
        ao.inputs["Distance"].default_value = 0.07
        col = t.mix(col, kit.srgb(*hi), t.ramp(ao.outputs["AO"], [(0.5, (edge,) * 3 + (1,)), (0.9, (0, 0, 0, 1))]))
    col = t.grime(col, kit.GROUND, 2.6, dirt, ao_min)
    t.set(**{"Base Color": col, "rough": rough, "metal": metal, "spec": spec})
    t.bump(t.noise(v, scale * 5, 4.0, 0.6), bump, 0.012)
    return t.m


def mats():
    P = kit.painted
    M["hide"] = worn("hide", (20, 14, 12), rough=0.92, metal=0.0, scale=1.4, blotch=0.5, edge=0.0, scratch=0.4,
                     spec=0.08, stain=(46, 29, 20), stain_at=0.56, soot=0.6, bump=0.35)
    M["iron"] = worn("iron", (84, 76, 70), rough=0.55, metal=0.3, scale=4.0, blotch=0.5, edge=0.5,
                     hi=(192, 184, 174), stain=(106, 60, 34), stain_at=0.5, soot=0.7, bump=0.3)
    M["darkiron"] = worn("darkiron", (44, 39, 37), rough=0.55, metal=0.3, scale=4.0, blotch=0.5, edge=0.45,
                         hi=(132, 124, 116), stain=(70, 42, 28), stain_at=0.52, soot=0.6, bump=0.3)
    M["panel"] = worn("panel", (26, 23, 22), rough=0.6, metal=0.3, scale=4.0, blotch=0.4, edge=0.3,
                      hi=(104, 98, 92), stain=(52, 32, 22), soot=0.4, bump=0.3)
    M["rivet"] = P("rivet", (214, 206, 190), rough=0.35, metal=0.3, dirt=0.0)
    M["bone"] = worn("bone", (232, 200, 120), rough=0.65, metal=0.0, scale=1.6, blotch=0.3, edge=0.0, dirt=0.55,
                     ao_min=0.2, scratch=0.2, spec=0.25, stain=(150, 100, 52), stain_at=0.5, soot=0.4, bump=0.15,
                     vein=0.25)
    M["red"] = worn("red", (150, 60, 56), rough=0.4, metal=0.45, scale=3.5, blotch=0.5, edge=0.6,
                    hi=(238, 152, 146), stain=(56, 26, 24), stain_at=0.46, soot=0.6, bump=0.3)
    M["darkred"] = worn("darkred", (66, 32, 28), rough=0.5, metal=0.35, scale=3.5, blotch=0.5, edge=0.4,
                        hi=(150, 84, 74), stain=(34, 18, 16), stain_at=0.5, soot=0.6, bump=0.3)
    M["mach"] = worn("mach", (38, 25, 23), rough=0.6, metal=0.3, scale=3.5, blotch=0.5, edge=0.3, hi=(98, 60, 54),
                     stain=(22, 14, 13), soot=0.5, bump=0.3)
    M["cog"] = worn("cogm", (54, 31, 25), rough=0.5, metal=0.35, scale=5.0, blotch=0.4, edge=0.5, hi=(140, 90, 70),
                    stain=(28, 17, 14), soot=0.3, dirt=0.0)
    M["orange"] = worn("orange", (226, 94, 8), rough=0.5, metal=0.0, scale=2.5, blotch=0.35, edge=0.5,
                       hi=(255, 204, 104), dirt=0.25, ao_min=0.4, stain=(150, 52, 6), stain_at=0.52, soot=0.35,
                       top=(255, 160, 38), bump=0.2)
    M["bellowsdark"] = P("bellowsdark", (110, 36, 6), rough=0.7, dirt=0.0)
    M["gold"] = P("gold", (246, 176, 30), rough=0.3, metal=0.5, wear=(255, 226, 110), dirt=0.0)
    M["pale"] = worn("pale", (228, 216, 186), rough=0.45, metal=0.1, scale=5.0, blotch=0.25, edge=0.0, dirt=0.0,
                     ao_min=0.4, stain=(160, 134, 96), stain_at=0.55, soot=0.35, vein=0.3)
    M["chain"] = P("chain", (140, 130, 114), rough=0.4, metal=0.5, wear=(222, 216, 200), dirt=0.0)
    M["turf"] = turf()
    M["black"] = P("black", (10, 8, 7), rough=0.9, dirt=0.0, spec=0.1)
    M["forge"] = flames("forge", 4.3, 10.4, strength=1.0, scale=2.6, amp=0.5)
    M["fire"] = flames("fire", 0.0, 5.6, strength=1.1, scale=3.6, amp=0.6)
    M["patch"] = flames("patch", 2.0, 4.6, strength=0.9, scale=5.0, amp=0.4)
    M["rod"] = glow("rod", (226, 96, 10), (255, 132, 16), 1.05, dark=(176, 62, 8), scale=1.0)
    M["window"] = glow("window", (252, 138, 14), (255, 166, 24), 1.15, streak=4.0, dark=(226, 104, 10), scale=1.0)


# ----------------------------------------------------------------------------------------------------------- the body
def gable_x(z):
    return HX - GLEAN * z


def section():
    """The body's cross-section (Y, Z), the same all along X: upright front, leaning front up to the ridge, then
    the back as Flash's outline on the gable: steep, a ledge stepping out, upright to the ground."""
    back = [G(x, y) for x, y in BACK_PX]
    return ([(-HY, 0.0), (-HY, ZRAIL), (-0.34, RIDGE - 0.42), (-0.3, RIDGE), (0.15, RIDGE), (0.75, RIDGE - 0.35)]
            + [(p.y, p.z) for p in back] + [(back[-1].y + 0.05, 0.0)])


def body():
    sec = section()
    bm = bmesh.new()
    a = [bm.verts.new((-HXL, y, z)) for y, z in sec]
    b = [bm.verts.new((gable_x(z), y, z)) for y, z in sec]
    m = len(sec)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(b)
    bm.faces.new(a[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob("body", bm, [M["hide"]], smooth=False, bevel=0.03)
    # the slot the beam swings in: over the ridge under its hub, and deep behind it where the right head dips
    for i, (size, at) in enumerate((((BW + 0.5, 5.2, 4.0), (PIV.x, 1.6, 8.75)), ((BW + 0.5, 4.0, 4.0), (PIV.x, 2.2, 6.6)))):
        cut = kit.box(f"bodycut-{i}", size, at, M["black"], bevel=0.0)
        cut.hide_render = True
        cut.display_type = "WIRE"
        bo = ob.modifiers.new(f"slot{i}", "BOOLEAN")
        bo.operation = "DIFFERENCE"
        bo.object = cut
        ob.modifiers.move(len(ob.modifiers) - 1, 0)
    # tatters: torn flaps of hide along the back edge and the gable's hem, as Flash's ragged wall
    back = [G(x, y) for x, y in BACK_PX]
    k = 0
    for p, q in zip(back, back[1:]):
        n = max(1, int((q - p).length / 0.9))
        for i in range(n):
            o = p + (q - p) * ((i + rnd.uniform(0.2, 0.8)) / n)
            w, ln = rnd.uniform(0.12, 0.34), rnd.uniform(0.15, 0.55)
            d = Vector((0, 1, rnd.uniform(-1.2, -0.2))).normalized()
            up = (q - p).normalized()
            poly(f"tatter-{k}", [o - up * w - NG * 0.02 - d * 0.1, o + up * w - NG * 0.02 - d * 0.1,
                                 o + d * ln + up * rnd.uniform(-0.2, 0.2) - NG * 0.02], NG, 0.05, M["hide"], bevel=0.0)
            k += 1
    for i in range(7):                                             # the hem
        y = -2.6 + i * 0.85 + rnd.uniform(-0.2, 0.2)
        z = rnd.uniform(0.9, 1.6)
        o = Vector((gable_x(z) + 0.04, y, z))
        poly(f"hem-{i}", [o + Vector((0, -0.45, 0)), o + Vector((0, 0.45, 0)),
                          o + Vector((0.12, rnd.uniform(-0.2, 0.2), -rnd.uniform(0.5, 0.9)))], NG, 0.05, M["hide"],
             bevel=0.0)


def slab():
    """The low mound of cracked dark turf the Works stands on: Flash's ragged outline, highest by the body, fading
    into the lawn at its rim."""
    out = [(-72, 55), (-64, 45), (-52, 38), (-30, 29), (0, 20), (30, 26), (50, 36), (64, 46), (62, 57), (50, 67),
           (32, 75), (8, 82), (-18, 81), (-42, 76), (-60, 68), (-71, 62)]
    c = kit.px(-2, 54, Z=0.0)
    ring = []
    for i, (x, y) in enumerate(out):
        p, q = kit.px(x, y, Z=0.0), kit.px(*out[(i + 1) % len(out)], Z=0.0)
        for f in (0.0, 0.25, 0.5, 0.75):
            v = p + (q - p) * f
            ring.append(c + (v - c) * rnd.uniform(0.9, 1.08))
    bm = bmesh.new()
    lay = bm.loops.layers.color.new("fade")
    R = 14
    rows = []
    fade = {}
    for r in range(1, R + 1):
        t = r / R
        row = []
        for p in ring:
            z = 0.42 * (1 - t ** 3.0) + (rnd.uniform(-0.03, 0.03) if r < R else 0.0)
            v = bm.verts.new(c + (p - c) * t + Vector((0, 0, max(0.012, z))))
            fade[v] = t
            row.append(v)
        rows.append(row)
    cv = bm.verts.new(c + Vector((0, 0, 0.42)))
    fade[cv] = 0.0
    m = len(ring)
    for i in range(m):
        bm.faces.new((cv, rows[0][i], rows[0][(i + 1) % m]))
    for a, b in zip(rows, rows[1:]):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((a[i], b[i], b[j], a[j]))
    for f in bm.faces:
        for lp in f.loops:
            lp[lay] = (fade[lp.vert],) * 3 + (1.0,)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("slab", bm, [M["turf"]], smooth=True)


def front():
    """The upright front wall under the rail: bone posts, planks, the slit of fire. All of it starts below the
    rocks' tops (they are uneven), so nothing hovers over a low rock."""
    z0 = 0.1
    # planks from the left post to the middle post
    kit.plank_wall("planks", (-2.85, -HY - 0.06), (0.75, -HY - 0.06), z0, ZRAIL - 0.15, lambda ax: kit.wood("plank", (112, 56, 20), (30, 14, 6), axis=ax, rings=5.0), 7,
                   thick=0.14, gap=0.05, jit=0.03)
    # the slit of fire, set into the wall, with a dark lintel
    poly("slit", [(1.3, -HY - 0.03, z0), (3.3, -HY - 0.03, z0), (3.3, -HY - 0.03, ZRAIL + 0.1), (1.3, -HY - 0.03, ZRAIL + 0.1)],
         (0, -1, 0), 0.02, M["fire"], bevel=0.0)
    # Flash's glowing patch on the planks: a small barred opening on the fire
    pp = [F(-25, 8.5, 0.16), F(-11, 14.5, 0.16), F(-11, 25, 0.16), F(-25, 19, 0.16)]
    poly("patch", pp, NF, 0.02, M["patch"], bevel=0.0)
    for i, f in enumerate((0.3, 0.62)):
        a, b = pp[0] + (pp[1] - pp[0]) * f, pp[3] + (pp[2] - pp[3]) * f
        kit.sweep(f"patchbar-{i}", [a + NF * 0.05, b + NF * 0.05], NF, 0.08, 0.14, M["black"], bevel=0.0)
    kit.sweep("patchsill", [pp[3] + NF * 0.05, pp[2] + NF * 0.05], NF, 0.1, 0.16, M["darkiron"], bevel=0.02)
    # bone posts: left corner, under the frame's right leg, the big corner post
    bone("postl", (-2.85, -HY - 0.3, z0), (-2.95, -HY - 0.25, ZRAIL - 0.1), 0.42, rings=(0.3, 0.78))
    bone("postm", (0.95, -HY - 0.4, z0), (1.0, -HY - 0.35, ZRAIL - 0.2), 0.47, rings=(0.2, 0.62, 0.86))
    bone("postc", (3.75, -HY + 0.2, z0), (3.45, -2.2, 6.35), 0.44, rings=(0.33,), knob=1.45)


def UX(x, z, off=0.15):
    """The point of the leaning wall at (x, z), `off` in front of it."""
    return Vector((x, -HY + LEAN * (z - ZRAIL), z)) + NU * off


def frame():
    """The iron frame on the leaning wall, the glowing forge inside it. Its pointed top stops at a block left of the
    rocker and its right leg at the bearing right of it: nothing on the wall stands in the beam's way."""
    th = 0.3
    a = U(-36, -7, 0.15)                        # the rail's left end
    b = U(-7, 7.5, 0.15)                        # ... its right end
    c = U(-21, -48, 0.15)                       # the left leg's top
    b2 = U(-4, 5.5, 0.15)
    xl, xr = PIV.x - BW / 2 - 0.5, PIV.x + BW / 2 + 0.55      # the blocks either side of the beam
    h = UX(xr, 9.75)                            # the right leg's top, at the bearing
    e = UX(xl, 9.55)                            # the top's end, at the left block
    arch = chaikin([c, UX(-2.75, 9.3), UX(-2.1, 9.9), UX(-1.4, 9.95), e], 2)
    w = 0.62
    kit.sweep("frame-rail", [a, b], NU, th, w, M["iron"], bevel=0.05)
    kit.sweep("frame-legl", [a, c], NU, th, w, M["iron"], bevel=0.05)
    kit.sweep("frame-legr", [b2, h], NU, th, w, M["iron"], bevel=0.05)
    kit.sweep("frame-arch", arch, NU, th, w * 0.9, M["iron"], bevel=0.05)
    kit.sweep("frame-foot", [b, b2], NU, th, w, M["iron"], bevel=0.05)
    # the forge: everything inside the frame, under a dark pointed hood that passes below the beam
    under = [UX(xl, 8.75, 0.0), UX(PIV.x, 8.55, 0.0), UX(xr, 8.75, 0.0)]
    inner = [a, b, b2, h] + [p + NU * 0.15 for p in under[::-1]] + [e] + arch[::-1][1:]
    poly("forge", [p - NU * 0.1 for p in inner], NU, 0.02, M["forge"], bevel=0.0)
    hood = [U(-23, -40, 0.1), U(-12, -43, 0.1), UX(xl, 8.75, 0.1), e] + arch[::-1][1:-1]
    poly("hood", hood, NU, 0.06, M["black"], bevel=0.0)
    rv = [a + (c - a) * 0.04, a + (b - a) * 0.12, a + (b - a) * 0.5, b + (a - b) * 0.08, b2 + (h - b2) * 0.1,
          a + (c - a) * 0.5, a + (c - a) * 0.96, b2 + (h - b2) * 0.5, b2 + (h - b2) * 0.88]
    rivets("rivet", [p + NU * (th / 2) for p in rv], NU)


def gable():
    """The right wall: the glowing rod, the barrel, the window of fire, the machine."""
    # rod from the axle's end into the barrel
    x, y = 2.72, -0.42
    kit.cyl("rod", 0.3, 3.0, (x + 0.08, y, 7.3), M["rod"], verts=16, bevel=0.0)
    prof = [(0.0, 0.0), (0.72, 0.0), (0.84, 0.25), (0.86, 1.0), (0.8, 1.7), (0.62, 2.05), (0.4, 2.15), (0.0, 2.15)]
    kit.lathe("barrel", prof, (x + 0.25, y, 5.25), M["darkred"], verts=24)
    # the window of fire
    win = [G(24, 10, 0.02), G(29, 6.5, 0.02), G(34, 2.5, 0.02), G(37.5, 4, 0.02), G(40.5, 9, 0.02),
           G(40.5, 20.5, 0.02), G(31, 24, 0.02), G(24, 21.5, 0.02)]
    poly("window", win, NG, 0.02, M["window"], bevel=0.0)


def machine():
    """The machine at the gable's foot: a cog whose top teeth stand against the window of fire, a red arm across
    it, a dark red casing with bone pegs. The cog turns."""
    z0 = 0.05
    cz = 2.35
    cx = gable_x(cz) + 0.22
    cy = -0.3
    kit.box("mach-plate", (0.3, 3.3, 2.2), (gable_x(1.4) + 0.02, 1.1, z0), M["hide"], bevel=0.06)
    kit.box("mach-case", (1.2, 1.9, 1.75), (cx + 0.5, 1.75, z0), M["mach"], bevel=0.12, taper=0.75)
    kit.box("mach-foot", (1.6, 3.4, 0.7), (cx + 0.35, 1.0, z0), M["mach"], bevel=0.08)
    kit.box("mach-block", (1.0, 1.3, 1.25), (cx + 0.5, 0.0, z0 + 0.3), M["mach"], bevel=0.1)
    arm = kit.box("mach-arm", (0.42, 2.5, 0.5), (cx + 0.62, 1.0, 2.0), M["red"], rot=(14, 0, 0), bevel=0.12,
                  origin="centre")
    kit.cyl("mach-armpin", 0.3, 0.3, (cx + 0.78, -0.05, 1.72), M["mach"], rot=(0, 90, 0), verts=14)
    bone("peg-a", (cx + 1.05, 0.7, 1.15), (cx + 1.25, 1.75, 0.8), 0.1, knob=1.0, foot=1.0, mat=M["pale"])
    bone("peg-b", (cx + 0.85, 2.15, 1.75), (cx + 0.85, 2.3, 2.75), 0.1, knob=1.0, foot=1.0, mat=M["pale"])
    e = bpy.data.objects.new("cog", None)
    kit.link(e)
    e.location = (cx, cy, cz)
    e.rotation_euler = Vector((1, 0, 0)).to_track_quat("Z", "Y").to_euler()
    hub = bpy.data.objects.new("cog-spin", None)
    kit.link(hub, e)
    kit.gear("cog-wheel", 1.18, 10, 0.3, (0, 0, 0.16), M["cog"], (0, 0, 0), tooth=0.3, parent=hub)
    kit.cyl("cog-boss", 0.4, 0.14, (0, 0, 0.31), M["mach"], verts=16, parent=hub)
    for i in range(5):
        an = 2 * math.pi * i / 5
        kit.cyl(f"cog-hole-{i}", 0.14, 0.03, (0.62 * math.cos(an), 0.62 * math.sin(an), 0.3), M["black"], verts=10,
                bevel=0.0, parent=hub)
    kit.cyl("cog-axle", 0.16, 0.5, (cx - 0.3, cy, cz), M["darkiron"], rot=(0, 90, 0), verts=12)
    kit.MOVING.append(hub)
    PART["cog"] = hub


def bellows():
    """The orange bellows in front of the planks, square to the camera: a wedge (broad at the nozzle's end, a point
    at the other) on a dark foot, pleats down its face; the nozzle points to the screen's left. Local x = toward
    the nozzle, y = toward the camera, z up. The bone lever along its top front edge lifts, the nozzle draws in."""
    root = bpy.data.objects.new("bellows", None)
    kit.link(root)
    o = kit.px(-29.5, 36, Z=2.25)
    e1 = Vector((-1, -1, 0)).normalized()
    e2 = Vector((1, -1, 0)).normalized()
    root.matrix_world = Matrix(((e1.x, e2.x, 0, o.x), (e1.y, e2.y, 0, o.y), (0, 0, 1, 0), (0, 0, 0, 1)))
    x0, x1, dp, zt, zb = -2.0, 1.5, 2.9, 2.25, 0.85
    top = [(x0, -0.25), (x1, 0.0), (x1, -dp), (x0 + 0.5, -0.75)]
    poly("bel-body", [Vector((x, y, zb)) for x, y in top], (0, 0, 1), zt - zb, M["orange"], bevel=0.1, parent=root)
    lid = [(x0 - 0.3, -0.15), (x1 + 0.15, 0.15), (x1 + 0.15, -dp - 0.12), (x0 + 0.35, -0.95)]
    poly("bel-lid", [Vector((x, y, zt)) for x, y in lid], (0, 0, 1), 0.24, M["orange"], bevel=0.07, parent=root)
    foot = [(x0 + 0.1, 0.2), (x1 + 0.25, 0.25), (x1 + 0.25, -dp), (x0 + 0.6, -0.9)]
    poly("bel-foot", [Vector((x, y, 0.02)) for x, y in foot], (0, 0, 1), zb - 0.02, M["darkiron"], bevel=0.07, parent=root)
    rivets("bel-rivet", [(x, 0.25, ZS + 0.3) for i, x in enumerate((-1.2, -0.2, 0.8))], (0, 1, 0), r=0.1,
           parent=root)
    for i in range(4):                                             # pleats
        x = x0 + 0.7 + i * 0.7
        kit.box(f"bel-pleat-{i}", (0.1, 0.1, zt - zb - 0.2), (x, 0.0 - 0.07 * (x1 - x) / 3.2, zb + 0.08), M["bellowsdark"],
                bevel=0.03, parent=root)
    nz = bpy.data.objects.new("nozzle", None)
    kit.link(nz, root)
    nz.location = (x1 - 0.2, -0.45, 1.15)
    nz.rotation_euler = (0, math.radians(8), 0)
    kit.cyl("nozzle-pipe", 0.38, 1.35, (-0.3, 0, 0), M["orange"], rot=(0, 90, 0), verts=16, r2=0.27, parent=nz)
    kit.cyl("nozzle-lip", 0.36, 0.2, (0.95, 0, 0), M["orange"], rot=(0, 90, 0), verts=16, parent=nz)
    kit.cyl("nozzle-bore", 0.19, 0.02, (1.15, 0, 0), M["black"], rot=(0, 90, 0), verts=12, bevel=0.0, parent=nz)
    lv = bpy.data.objects.new("lever", None)
    kit.link(lv, root)
    lv.location = (x0 + 0.75, 0.2, zt + 0.34)
    bone("lever-bone", (-0.3, 0, 0), (3.0, 0.05, -0.1), 0.15, knob=1.6, foot=1.5, parent=lv, mat=M["pale"])
    for i, (px_, py_, pz_) in enumerate(((-0.3, 0.14, 0), (-0.3, -0.14, 0), (3.0, 0.19, -0.1), (3.0, -0.09, -0.1))):
        kit.blob(f"lever-knob-{i}", (px_, py_, pz_), 0.2, squash=0.9, mat=M["pale"], parent=lv)
    kit.cyl("lever-pin", 0.1, 0.6, (x0 + 0.75, -0.3, zt + 0.3), M["pale"], rot=(-90, 0, 0), verts=10, parent=root)
    kit.MOVING.extend([nz, lv])
    PART["nozzle"], PART["lever"] = nz, lv


# ----------------------------------------------------------------------------------------------------------- the rocker
def head_outline(sign, lo):
    """One head's outline in the beam's own (y, z): hub side, top edge out to the ring, the arc down to `lo` degrees
    below the beam's line, back to the hub. sign -1 = the left head."""
    pts = [(0.0, 0.5), (sign * 0.9, 0.62)]
    a0, a1 = math.radians(TIP), math.radians(-lo)
    n = 14
    pts.append((sign * (RAD - 0.1) * math.cos(a0) * 0.82, (RAD - 0.1) * math.sin(a0) * 0.86))
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        pts.append((sign * RAD * math.cos(a), RAD * math.sin(a)))
    pts += [(sign * 0.9, -0.5), (0.0, -0.45)]
    return pts


def rocker():
    hub = bpy.data.objects.new("rocker", None)
    kit.link(hub)
    hub.location = PIV
    kit.MOVING.append(hub)
    PART["rocker"] = hub
    for name, sign, lo in (("headl", -1, 30.0), ("headr", 1, 38.0)):
        o = head_outline(sign, lo)
        if sign > 0:
            o = o[::-1]
        # the core plate, set in from the rim
        core = [Vector((-BW * 0.36, y, z)) for y, z in o]
        poly(f"{name}-core", core, (1, 0, 0), BW * 0.72, M["panel"], bevel=0.04, parent=hub)
        # the rim: a bar all round the outline, the beam's full thickness
        ring = [Vector((0, y, z)) for y, z in (o if sign < 0 else o[::-1])]
        ins = []
        m = len(ring)
        cen = sum(ring, Vector()) / m
        for p in ring:
            ins.append(p + (cen - p).normalized() * 0.14)
        kit.sweep(f"{name}-rim", ins[1:-1], (1, 0, 0), BW, 0.3, M["iron"], parent=hub, bevel=0.05)
        # pale strips along the top edge, one on each side
        oo = o if sign < 0 else o[::-1]
        top = [Vector((0, y, z + 0.02)) for y, z in oo[:3]]
        if sign < 0:
            top += [Vector((0, y - 0.02, z)) for y, z in oo[3:-2]]
        for sx in (-1, 1):
            kit.tube(f"{name}-strip{sx}", [p + Vector((sx * (BW / 2 - 0.1), 0, 0)) for p in top], 0.11, M["pale"],
                     parent=hub)
        # the gold ring on the tip
        a0 = math.radians(TIP)
        tip = Vector((0, sign * RAD * math.cos(a0), RAD * math.sin(a0)))
        r = kit.ring(f"{name}-ring", 0.3, 0.075, M["gold"], parent=hub, n=24)
        r.location = tip + Vector((0, -sign * 0.05, 0.2))
        r.rotation_euler = (math.radians(90), 0, 0)
    kit.cyl("rocker-boss", 0.62, BW + 0.16, (-(BW + 0.16) / 2, 0, 0), M["red"], rot=(0, 90, 0), verts=20, parent=hub)
    # the axle and its bearings (still)
    kit.cyl("axle", 0.33, 5.7, (-2.95, PIV.y, PIV.z), M["darkiron"], rot=(0, 90, 0), verts=16)
    for name, x0, ln, r in (("capb", -3.0, 0.75, 0.6), ("capm", PIV.x + BW / 2 + 0.25, 0.6, 0.55),
                            ("capf", 2.15, 0.75, 0.62)):
        kit.cyl(f"bearing-{name}", r, ln, (x0, PIV.y, PIV.z), M["red"], rot=(0, 90, 0), verts=20, bevel=0.07)
    kit.cyl("bearing-capl", 0.55, 0.5, (PIV.x - BW / 2 - 0.75, PIV.y, PIV.z), M["red"], rot=(0, 90, 0), verts=20,
            bevel=0.07)


CH_PITCH = 0.3
CH_N = 34
CH_R = RAD + 0.14


def chain():
    root = bpy.data.objects.new("chain", None)
    kit.link(root)
    kit.MOVING.append(root)
    PART["chain"] = []
    for i in range(CH_N):
        pts = []
        for j in range(12):
            a = 2 * math.pi * j / 12
            u, v = 0.1 * math.cos(a), 0.18 * math.sin(a)
            pts.append((u, 0, v) if i % 2 else (0, u, v))
        ob = kit.tube(f"chain-{i:02d}", pts, 0.045, M["chain"], parent=root, verts=6, cyclic=True)
        PART["chain"].append(ob)


def rocker_angle(k):
    s = (1 - math.cos(2 * math.pi * (k % N) / N)) / 2
    return math.radians(-SWING / 2 + SWING * s)


def bellows_lift(k):
    """0..1: up fast by frame 12, back slowly by the loop's end (Flash's anim1)."""
    k = k % N
    if k <= 12:
        return (1 - math.cos(math.pi * k / 12)) / 2
    return (1 + math.cos(math.pi * (k - 12) / (N - 12))) / 2


def turn(k):
    if DAMAGED:                 # a still: build() has posed frame 0 and damage() has knocked it about
        return
    pose(k)


def pose(k):
    th = rocker_angle(k)
    PART["rocker"].rotation_euler = (th, 0, 0)
    # the chain: fixed at the left ring, over the arc to its leftmost point, then straight down into the box
    tip = math.radians(180 - TIP) + th
    on_arc = CH_R * (math.pi - tip)
    for i, ob in enumerate(PART["chain"]):
        s = 0.25 + i * CH_PITCH
        if s < on_arc:
            a = tip + s / CH_R
            ob.location = PIV + Vector((0, CH_R * math.cos(a), CH_R * math.sin(a)))
            ob.rotation_euler = (a, 0, 0)
            ob.hide_render = False
        else:
            z = PIV.z - (s - on_arc)
            ob.location = Vector((PIV.x, PIV.y - CH_R, z))
            ob.rotation_euler = (0, 0, 0)
            ob.hide_render = z < ZRAIL + 0.5          # it passes behind the rail, as Flash draws it
    up = bellows_lift(k)
    PART["lever"].rotation_euler = (0, math.radians(-20 * up), 0)
    PART["nozzle"].location.x = 1.3 - 0.4 * up
    PART["cog"].rotation_euler = (0, 0, -2 * math.pi * (k % N) / N)


def build():
    mats()
    slab()
    body()
    front()
    frame()
    gable()
    machine()
    bellows()
    rocker()
    chain()
    pose(0)
    if DAMAGED:
        damage()


def damage():
    """One rough pass, as Flash's damaged picture reads: the rocker knocked off its line and its chain snapped, the
    frame's top bent, a post broken with its top on the ground, holes torn in the hide showing the fire, the forge
    half dead, soot over everything, rubble at the foot. Not polished (owner: damage only roughly follows Flash)."""
    ob = bpy.data.objects
    bpy.context.view_layer.update()
    inv = PART["rocker"].matrix_world.inverted()
    for i, c in enumerate(PART["chain"]):
        if i >= 11:
            c.hide_render = True
            c.location.z = -50
        else:                                   # what is left of the chain stays on the head
            c.parent = PART["rocker"]
            c.matrix_parent_inverse = inv
    PART["rocker"].rotation_euler = (math.radians(24), math.radians(13), math.radians(-16))
    PART["rocker"].location = PIV + Vector((0.1, -0.3, -0.3))
    # the broken chain's lower half lies over the rail and the bellows
    for i in range(7):
        pts = []
        for j in range(12):
            a = 2 * math.pi * j / 12
            pts.append((0.1 * math.cos(a), 0.18 * math.sin(a), 0))
        t = kit.tube(f"deadchain-{i}", pts, 0.045, M["chain"], verts=6, cyclic=True)
        t.location = (PIV.x - 1.2 + 0.27 * i, -HY - 1.0 - 0.05 * i, 0.3)
        t.rotation_euler = (0, 0, math.radians(20 + 25 * (i % 3)))
    # the middle post snapped: its top half lies on the slab
    ob["postm"].scale = (1, 1, 0.5)
    bone("postm-top", (-0.6, -HY - 2.6, ZS + 0.45), (1.3, -HY - 3.1, ZS + 0.5), 0.4, rings=(0.3, 0.75))
    ob["postl"].rotation_euler.rotate_axis("X", math.radians(-9))
    ob["postc"].rotation_euler.rotate_axis("Y", math.radians(8))
    # holes in the hide: fire shows through, torn dark edges
    for i, (sx, sy, r) in enumerate([(38, -30, 0.75), (44, -6, 0.6), (24, -30, 0.45)]):
        p = G(sx, sy, 0.03)
        pts, rim = [], []
        for j in range(11):
            a = 2 * math.pi * j / 11
            k = r * rnd.uniform(0.6, 1.25)
            d = Vector((0, math.cos(a), math.sin(a)))
            pts.append(p + d * k)
            rim.append(p + d * (k + 0.16) - NG * 0.01)
        poly(f"hole-rim-{i}", rim, NG, 0.02, M["black"], bevel=0.0)
        poly(f"hole-{i}", pts, NG, 0.03, M["black"], bevel=0.0)
        poly(f"hole-ember-{i}", [p + (q - p) * 0.45 for q in pts], NG, 0.04, M["fire"], bevel=0.0)
    for i, (sx, sy, r) in enumerate([(-16, -22, 1.0), (-28, -6, 0.6)]):          # dead black patches in the forge
        p = U(sx, sy, 0.1)
        pts = []
        for j in range(11):
            a = 2 * math.pi * j / 11
            k = r * rnd.uniform(0.6, 1.25)
            pts.append(p + Vector((math.cos(a), 0, 0)) * k + Vector((0, LEAN, 1)).normalized() * math.sin(a) * k * 1.5)
        poly(f"dead-{i}", pts, NU, 0.03, M["black"], bevel=0.0)
    # the frame's right leg knocked loose, the pointed top sagging
    ob["frame-legr"].rotation_euler = (0, math.radians(5), 0)
    ob["frame-legr"].location = (-0.45, -0.25, 0.1)
    ob["frame-arch"].location = (0.1, -0.2, -0.45)
    # rubble: bits of iron, hide and bone at the foot
    for i in range(16):
        a = rnd.uniform(0, 2 * math.pi)
        q = kit.px(rnd.uniform(-40, 44), rnd.uniform(50, 63), Z=0.2)
        m = rnd.choice([M["darkiron"], M["hide"], M["darkred"], M["iron"], M["bone"]])
        kit.box(f"rubble-{i}", (rnd.uniform(0.25, 0.7), rnd.uniform(0.2, 0.5), rnd.uniform(0.12, 0.3)), q, m,
                rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), math.degrees(a)), bevel=0.05, jitter=0.04)
    # soot everywhere: every painted surface darker and duller
    for m in bpy.data.materials:
        if not m.use_nodes or m.name in ("forge", "fire", "rod", "window", "patch", "turf"):
            continue
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None or not b.inputs["Base Color"].is_linked:
            continue
        src = b.inputs["Base Color"].links[0].from_socket
        t = m.node_tree
        vc = t.nodes.new("ShaderNodeTexCoord")
        nz = t.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.9
        nz.inputs["Detail"].default_value = 5.0
        t.links.new(vc.outputs["Object"], nz.inputs["Vector"])
        rp = t.nodes.new("ShaderNodeValToRGB")
        rp.color_ramp.elements[0].position, rp.color_ramp.elements[0].color = 0.4, (0.16, 0.14, 0.13, 1)
        rp.color_ramp.elements[1].position, rp.color_ramp.elements[1].color = 0.62, (0.85, 0.82, 0.8, 1)
        t.links.new(nz.outputs["Fac"], rp.inputs[0])
        mx = t.nodes.new("ShaderNodeMix")
        mx.data_type, mx.blend_type = "RGBA", "MULTIPLY"
        mx.inputs[0].default_value = 1.0
        t.links.new(src, next(i for i in mx.inputs if i.name == "A" and i.type == "RGBA"))
        t.links.new(rp.outputs[0], next(i for i in mx.inputs if i.name == "B" and i.type == "RGBA"))
        t.links.new(next(o for o in mx.outputs if o.type == "RGBA"), b.inputs["Base Color"])
    for name in ("forge", "window", "rod"):
        b = next(n for n in bpy.data.materials[name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Emission Strength"].default_value *= 0.55
    kit.MOVING.clear()                  # a still picture: nothing is a moving layer
    # the whole building slumps and leans to the left front, as Flash's damaged picture
    lean = bpy.data.objects.new("lean", None)
    kit.link(lean)
    keep = ("slab", "rubble", "deadchain", "postm-top", "lean")
    for o in list(kit.SC.objects):
        if o.parent is None and not o.name.startswith(keep):
            o.parent = lean
    lean.rotation_euler = (math.radians(4.5), math.radians(-3.5), 0)
    lean.scale = (1.03, 1.03, 0.93)
    lean.location = (0, 0, 0.1)


def family(o):
    p = o
    while p is not None:
        if p in kit.MOVING:
            return p.name.split("-")[0]
        p = p.parent
    return kit.default_family(o)


if os.environ.get("PB_FITK"):
    kit.K = int(os.environ["PB_FITK"])
kit.run(build, turn, family=family)
