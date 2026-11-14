"""magma.py : the Inferno Magma Pump in 3D, three tiers, built clean-room from the Flash pictures only
(server/public/assets/buildings/imagmaproducer). Only the generic Inferno kit is used (kit.py: camera, light, render
modes), the same kit as the 3D Bone Cruncher and Coal Extractor.

    blender -b --factory-startup -P magma.py -- <tier 1|2|3> <fit|check|still|anim|probe|gap> [frame]

Tier 1 = levels 1-2: Flash's one look in play (top.1.v2): a navy box with a pale steel lid, brass corner posts, a
glowing vent on the left face, a flanged yellow elbow pipe from a well in the ground on the right face, a flared
smoke pot on the lid. Flash has no higher look in play, so tiers 2 (levels 3-6) and 3 (levels 7-10) are upgrades on
the same machine, led by Flash's unused top.2 (wide brass frame, steel grille over the vent, stubby dark feet):
  tier 2 = tier 1 + iron feet, full brass frame (wider posts, a post on the left corner, base rails), a taller vent
           behind a steel grille, a magma sight tank on the right face piped to the lid, a brass crown on the pot.
  tier 3 = tier 2 + iron horns on the posts, a spiked crown and brimming magma in the pot, a riveted iron belt with
           glowing slots under the lid, a taller domed tank, an iron curb and magma ring round the well.
One body, the same mounting points at every tier (tiers 2 and 3 stand LIFT higher on their feet).

World: Z up, the body's centre on the origin, its faces square to X and Y, 10 Flash px a unit. The camera looks from
+X -Y, so the left face seen is Y = -HY and the right face seen is X = +HX.

What moves, as Flash's three strips (49 frames, every motion periodic so the last frame runs into the first):
  anim.3  the pot: the ribs light up yellow, a brown-orange smoke puff rises out of the mouth and thins away, then the
          mouth glows orange and dies down.
  anim.1  the elbow pipe: a swelling travels up the pipe from the well to the flange.
  anim.2  the vent: its glow swells and sinks (orange to yellow and back).
Tiers 2 and 3 add only the tank's glow (and tier 3's belt slots and well ring) breathing with the vent.
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
sys.path.insert(0, str(HERE))
import kit  # noqa: E402

T = kit.L
N = 49
kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (-1.0, 29.0)
kit.SKY_E = 0.38
kit.SUN = 5.4
kit.FRAME = (-60, -80, 60, 60)
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))      # PB_EXTRA=1 also renders frame N (= frame 0), the loop check
rnd = random.Random(41)
K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
MATS = kit.MATS

HX, HY, BH = 1.85, 2.4, 4.0               # the body: half sizes and height
LIFT = 0.0 if T == 1 else 0.45            # tiers 2 and 3 stand on feet
Z0, TOP = LIFT, LIFT + BH
POT_H = 1.5 if T == 1 else 1.75
POT = Vector((0.0, 0.0, 0.0))
SK_R, SK_H, NECK = 1.72, 0.6, 0.9           # the skirt under the pot (radius, height) and the height of the pot's foot
FL = Vector((HX, 0.0, Z0 + 1.68))        # the flange's centre on the right face
WELL = Vector((HX + 2.05, -0.12, 0.0))     # the well in the ground


def grey(x):
    return (x, x, x, 1)


def mat(name, col, rough=0.6, metal=0.0, wear=None, wear_amt=0.6, rust=None, rust_at=0.6, dirt=0.3, scale=5.0,
        speck=0.12, bump=0.06, ao_min=0.5, streak=None, mottle=0.35, top=None):
    """Paint or metal: worn patches, rust blotches, a fine speckle, darker toward the ground and in creases."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    v = t.coords()
    out = kit.srgb(*col)
    if wear:
        out = t.mix(out, kit.srgb(*wear), t.ramp(t.noise(v, scale * 0.5, 3.0, 0.55, 0.2), [(0.45, K0), (0.72, grey(wear_amt))]))
    if rust:
        out = t.mix(out, kit.srgb(*rust), t.ramp(t.noise(v, scale * 0.8, 5.0, 0.65, 1.0), [(rust_at, K0), (rust_at + 0.14, grey(0.8))]))
    if top:
        geo = t.n("ShaderNodeNewGeometry")
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sep.inputs[0])
        out = t.mix(out, kit.srgb(*top), t.ramp(sep.outputs["Z"], [(0.5, K0), (0.8, K1)]))
    if mottle:
        out = t.mix(out, t.ramp(t.noise(v, scale * 0.3, 3.0, 0.6, 0.6), [(0.3, grey(1 - mottle)), (0.66, K1)]), 1.0, "MULTIPLY")
    if streak:
        v2 = t.coords(scale=(1.0, 1.0, 0.18))
        out = t.mix(out, kit.srgb(*streak), t.ramp(t.noise(v2, scale * 0.9, 5.0, 0.6, 0.3), [(0.5, K0), (0.72, grey(0.55))]))
    if speck:
        out = t.mix(out, t.ramp(t.noise(v, scale * 12, 2.0, 0.5), [(0.3, grey(1 - speck)), (0.62, K1)]), 1.0, "MULTIPLY")
    out = t.grime(out, 0.0, 2.6, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rough, "metal": metal, "spec": 0.4})
    if bump:
        t.bump(t.noise(v, scale * 4, 4.0, 0.6), bump, 0.01)
    MATS[name] = t.m
    return t.m


GLOW = {}        # name -> (bsdf, rest strength): lights whose strength turn() sets


def glow(name, lo, mid, hi, strength, scale=3.0, cut=0.45):
    """Molten light: dark crust to hot yellow by a noise."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    n = t.noise(t.coords(), scale, 4.0, 0.6, 0.5)
    c = t.ramp(n, [(cut - 0.2, kit.srgb(*lo)), (cut, kit.srgb(*mid)), (cut + 0.22, kit.srgb(*hi))])
    t.set(**{"Base Color": c, "rough": 0.7})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = strength
    GLOW[name] = (t.bsdf, strength)
    MATS[name] = t.m
    return t.m


def smoke_mat(name):
    """A soft puff: see-through toward its rim, its strength set by turn()."""
    t = kit.NT(name)
    col = kit.srgb(206, 124, 62)
    t.set(**{"Base Color": col, "rough": 1.0, "spec": 0.0})
    t.bsdf.inputs["Emission Color"].default_value = col
    t.bsdf.inputs["Emission Strength"].default_value = 0.55
    lw = t.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    inv = t.n("ShaderNodeMath", operation="SUBTRACT")
    inv.inputs[0].default_value = 1.0
    t.link(lw.outputs["Facing"], inv.inputs[1])
    pw = t.n("ShaderNodeMath", operation="POWER")
    t.link(inv.outputs[0], pw.inputs[0])
    pw.inputs[1].default_value = 1.2
    mul = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(pw.outputs[0], mul.inputs[0])
    mul.inputs[1].default_value = 0.0
    t.link(mul.outputs[0], t.bsdf.inputs["Alpha"])
    return t.m, mul


def m_body():
    return mat("body", (60, 68, 90), rough=0.5, metal=0.35, wear=(100, 110, 138), rust=(30, 32, 44), scale=3.5, dirt=0.45,
               streak=(26, 26, 34))


def m_lid():
    return mat("lid", (172, 168, 164), rough=0.45, metal=0.5, wear=(190, 184, 176), rust=(86, 80, 82), scale=3.0, dirt=0.2,
               top=(210, 204, 196), streak=(120, 112, 110))


def m_brass():
    return mat("brass", (196, 112, 10), rough=0.36, metal=0.15, wear=(240, 170, 30), rust=(140, 74, 12), rust_at=0.66, mottle=0.12, wear_amt=0.4,
               scale=3.2, dirt=0.5, streak=(140, 74, 12), top=(255, 204, 60))


def m_yellow():
    return mat("yellow", (246, 164, 18), rough=0.32, metal=0.15, wear=(255, 206, 60), rust=(226, 120, 12), rust_at=0.62,
               scale=2.6, dirt=0.05, mottle=0.15, ao_min=0.7)


def m_gold():
    return mat("gold", (226, 170, 60), rough=0.3, metal=0.5, wear=(255, 232, 130), scale=4.0, dirt=0.0, mottle=0.1, ao_min=0.8)


def m_bronze():
    return mat("bronze", (118, 98, 82), rough=0.5, metal=0.5, wear=(176, 154, 128), rust=(66, 50, 40), scale=4.0, dirt=0.15)


def m_rim():
    return mat("rim", (140, 148, 176), rough=0.4, metal=0.6, wear=(196, 202, 222), rust=(36, 40, 56), scale=5.0, dirt=0.0)


def m_iron():
    return mat("iron", (40, 38, 44), rough=0.55, metal=0.6, wear=(86, 84, 94), rust=(20, 18, 20), scale=5.0, dirt=0.2)


def m_steel():
    return mat("steel", (120, 120, 128), rough=0.35, metal=0.7, wear=(200, 200, 210), rust=(50, 48, 52), scale=5.0, dirt=0.1)


def m_brown():
    return mat("brown", (132, 86, 50), rough=0.5, metal=0.3, wear=(180, 126, 76), rust=(48, 30, 20), scale=5.0)


def m_well():
    return mat("well", (122, 66, 52), rough=0.9, wear=(166, 118, 100), rust=(62, 32, 26), scale=6.0, dirt=0.2, bump=0.2)


def m_vent():
    return glow("vent", (196, 40, 8), (250, 104, 12), (255, 190, 40), 1.5, scale=2.2, cut=0.45)


def m_ray():
    return glow("ray", (120, 30, 8), (214, 70, 12), (240, 110, 20), 0.55, scale=3.0, cut=0.4)


def m_rib():
    return glow("rib", (170, 50, 8), (240, 110, 14), (255, 200, 50), 0.22, scale=2.0, cut=0.4)


def m_mouth():
    return glow("mouth", (40, 10, 4), (200, 70, 12), (255, 170, 40), 0.06, scale=2.4, cut=0.45)


def m_tank():
    return glow("tank", (200, 60, 10), (255, 130, 20), (255, 226, 90), 3.0, scale=3.4, cut=0.4)


# ------------------------------------------------------------------------------------------------------------ helpers
def mover(name):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    kit.MOVING.append(e)
    return e


def plate(name, pts, o, u, v, n, t, m, bevel=0.03, parent=None, sink=0.03):
    """A flat plate: the outline pts (a, b) in the plane through o spanned by u and v, t thick toward n."""
    bm = bmesh.new()
    o, u, v, n = Vector(o), Vector(u), Vector(v), Vector(n)
    fr = [bm.verts.new(o + u * a + v * b + n * t) for a, b in pts]
    bk = [bm.verts.new(o + u * a + v * b - n * sink) for a, b in pts]
    bm.faces.new(fr)
    bm.faces.new(bk[::-1])
    k = len(pts)
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((fr[i], bk[i], bk[j], fr[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [m], smooth=False, bevel=bevel, segs=2, parent=parent)


def rod(name, a, b, r, m, parent=None, res=5):
    ob = kit.tube(name, [Vector(a), Vector(b)], r, m, parent=parent)
    ob.data.bevel_resolution = res
    return ob


def ball(name, at, r, m, parent=None, squash=1.0):
    return kit.blob(name, Vector(at), r, squash=squash, mat=m, parent=parent)


def LF(x, z, out=0.0):
    """A point on the left face seen (Y = -HY)."""
    return Vector((x, -HY - out, z))


def RF(y, z, out=0.0):
    """A point on the right face seen (X = +HX)."""
    return Vector((HX + out, y, z))


def spline(pts, n=40):
    """A smooth path through pts (Catmull-Rom), n points."""
    pts = [Vector(p) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    segs = len(pts) - 1
    for i in range(n):
        s = i / (n - 1) * segs
        j = min(int(s), segs - 1)
        u = s - j
        p0, p1, p2, p3 = ext[j:j + 4]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


# ------------------------------------------------------------------------------------------------------------ animation
SMOKE = []       # (object, alpha node, start, life, drift)
LUMP = []        # (object, path)


def sstep(a, b, x):
    u = min(1.0, max(0.0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)


def win(f, a, b, soft):
    return sstep(a, a + soft, f) * (1.0 - sstep(b - soft, b, f))


def turn(k):
    f = (k % N) / N
    w = 2 * math.pi * f
    breathe = 1.0 + 0.32 * math.sin(w - 0.6) + 0.08 * math.sin(3 * w)
    lv = {"vent": breathe, "tank": 1.0 + 0.3 * math.sin(w + 1.0), "slot": breathe, "pool": 1.0 + 0.3 * math.sin(w + 2.4),
          "rib": 1.0 + 22.0 * win(f, 0.03, 0.62, 0.09),
          "mouth": (1.0 + 40.0 * win(f, 0.5, 0.99, 0.13)) if T < 3 else (1.0 + 0.5 * win(f, 0.5, 0.99, 0.13))}
    for name, (bsdf, rest) in GLOW.items():
        bsdf.inputs["Emission Strength"].default_value = rest * lv.get(name, 1.0)
    for ob, node, t0, life, drift in SMOKE:
        u = (f - t0) / life
        if 0.0 < u < 1.0:
            r = 0.42 + 0.75 * u
            ob.scale = (r, r, r * 1.15)
            ob.location = ob["rest"][:]
            ob.location += Vector((drift[0] * u, drift[1] * u, 3.3 * u ** 0.8))
            node.inputs[1].default_value = 0.55 * min(1.0, u * 5.0) * (1.0 - u) ** 1.2
        else:
            ob.scale = (0.001, 0.001, 0.001)
            ob.location = ob["rest"][:]
            node.inputs[1].default_value = 0.0
    for ob, path in LUMP:
        s = (0.04 + 0.92 * f) * (len(path) - 1)
        j = min(int(s), len(path) - 2)
        ob.location = path[j].lerp(path[j + 1], s - j)          # the path runs from the well up to the flange
        g = math.sin(math.pi * f) ** 0.5
        ob.scale = (g, g, g)


# ============================================================================================================ the parts
def body():
    kit.box("body", (2 * HX, 2 * HY, BH - 0.4), (0, 0, Z0), m_body(), bevel=0.06)
    kit.box("lid", (2 * HX + 0.14, 2 * HY + 0.14, 0.85), (0, 0, TOP - 0.85), m_lid(), bevel=0.3)
    if T >= 2:
        for i, (sx, sy) in enumerate(((1, -1), (1, 1), (-1, -1), (-1, 1))):
            kit.lathe("foot-%d" % i, [(0.0, 0.0), (0.52, 0.0), (0.56, 0.1), (0.5, 0.2), (0.44, 0.24), (0.5, 0.3), (0.46, LIFT + 0.05), (0.0, LIFT + 0.05)],
                      (sx * (HX - 0.5), sy * (HY - 0.5), 0), m_iron(), verts=20)
        # base rails on the two faces seen
        plate("rail-l", [(-HX, 0), (HX, 0), (HX, 0.42), (-HX, 0.42)], LF(0, Z0), X, Z, -Y, 0.1, m_brass())
        plate("rail-r", [(-HY, 0), (HY, 0), (HY, 0.42), (-HY, 0.42)], RF(0, Z0), Y, Z, X, 0.1, m_brass())


def posts():
    """Brass angle posts on the corners seen; the front one flares into a chevron under the lid."""
    w = 0.6 if T == 1 else 0.74
    W = 1.2 if T == 1 else 1.32
    t = 0.14
    h = BH + 0.06
    chev = [(-t, 0), (W, 0), (W, -0.35), (w, -0.35 - (W - w) * 1.5), (w, -h), (-t, -h)]
    plate("post-f-l", chev, LF(HX, Z0 + h), -X, Z, -Y, t, m_brass())
    plate("post-f-r", [(0.031, 0)] + chev[1:5] + [(0.031, -h)], RF(-HY, Z0 + h), Y, Z, X, t, m_brass())
    bar = [(-t, 0), (w, 0), (w, -h), (-t, -h)]
    plate("post-r-r", bar, RF(HY, Z0 + h), -Y, Z, X, t, m_brass())
    plate("post-r-b", [(0.031, 0)] + bar[1:3] + [(0.031, -h)], Vector((HX, HY, Z0 + h)), -X, Z, Y, t, m_brass())
    if T == 1:           # a short brass bracket on the left corner
        kit.box("post-l", (0.95, 0.95, 1.1), (-HX + 0.2, -HY + 0.2, Z0 + 2.2), m_brass(), bevel=0.07)
    else:
        plate("post-l-l", bar, LF(-HX, Z0 + h), X, Z, -Y, t, m_brass())
        plate("post-l-b", [(0.031, 0)] + bar[1:3] + [(0.031, -h)], Vector((-HX, -HY, Z0 + h)), Y, Z, -X, t, m_brass())
    if T == 3:           # iron horns on the posts
        for i, (x, y) in enumerate(((HX, -HY), (HX, HY), (-HX, -HY))):
            kit.cyl("horn-sock-%d" % i, 0.26, 0.16, (x * 0.93, y * 0.945, Z0 + h - 0.02), m_brass(), verts=14, bevel=0.02)
            kit.cyl("horn-%d" % i, 0.2, 0.85, (x * 0.93, y * 0.945, Z0 + h + 0.1), m_iron(), verts=14, r2=0.015, bevel=0.0)


def vent():
    """The glowing vent on the left face, fed by a thin yellow pipe from the lid."""
    x0, x1 = -1.3, 0.8
    z0, z1 = Z0 + 0.7, Z0 + (2.3 if T == 1 else 2.6)
    plate("vent-frame", [(x0 - 0.1, z0 - 0.1), (x1 + 0.1, z0 - 0.1), (x1 + 0.1, z1 + 0.1), (x0 - 0.1, z1 + 0.1)], LF(0, 0), X, Z, -Y, 0.2, mat("ventframe", (120, 40, 20), rough=0.6, metal=0.3, wear=(190, 80, 30), rust=(60, 20, 12)), bevel=0.04)
    mv = mover("vent-glow")
    plate("vent-lava", [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], LF(0, 0, 0.2), X, Z, -Y, 0.04, m_vent(), bevel=0.0, parent=mv, sink=0.0)
    dark = mat("ventbar", (150, 52, 14), rough=0.6, metal=0.2, wear=(206, 96, 24), mottle=0.0, dirt=0.0)
    nb = 5
    for i in range(1, nb):
        x = x0 + (x1 - x0) * i / nb
        plate("vent-bar-%d" % i, [(x - 0.055, z0), (x + 0.055, z0), (x + 0.055, z1), (x - 0.055, z1)], LF(0, 0, 0.24), X, Z, -Y, 0.03, dark, bevel=0.0, sink=0.0)
    # the thin yellow pipe: up the left face from the vent, over the lid's edge, a loop on the lid, back down to the left corner
    r = 0.11
    yo, zt = -HY - 0.07 - r, TOP + r - 0.01
    pts = [(-0.35, yo, z1 + 0.1), (-0.35, yo, TOP - 0.22), (-0.35, -HY + 0.12, zt), (-0.35, -1.62, zt), (-1.35, -1.62, zt), (-1.35, -HY + 0.12, zt), (-1.35, yo, TOP - 0.22),
           (-1.35, yo, Z0 + (3.25 if T == 1 else 3.0))]
    kit.tube("feed", [Vector(p) for p in pts], r, m_yellow())
    if T >= 2:           # a steel grille over the vent
        g0, g1 = z0 - 0.22, z1 + 0.22
        out = 0.42
        for i in range(5):
            x = x0 - 0.12 + (x1 - x0 + 0.24) * i / 4
            rod("grille-bar-%d" % i, LF(x, g0, out), LF(x, g1, out), 0.07, m_steel())
        for i, z in enumerate((g0, g1)):
            rod("grille-rail-%d" % i, LF(x0 - 0.3, z, out), LF(x1 + 0.3, z, out), 0.09, m_steel())
            for j, x in enumerate((x0 - 0.3, x1 + 0.3)):
                rod("grille-stay-%d%d" % (i, j), LF(x, z, out), LF(x, z, -0.02), 0.09, m_steel())


def pipe():
    """The flange on the right face, the yellow elbow pipe down to the well in the ground, and the swelling in it."""
    c = FL
    rod("flange", c - X * 0.02, c + X * 0.14, 0.86, m_brown(), res=8)
    for i in range(6):
        a = math.radians(30 + 60 * i)
        p = c + Y * (1.12 * math.cos(a)) + Z * (1.12 * math.sin(a))
        rod("flange-arm-%d" % i, c + X * 0.12, p + X * 0.12, 0.13, m_brown())
        rod("flange-stud-%d" % i, p - X * 0.02, p + X * 0.2, 0.12, m_gold())
        ball("flange-nut-%d" % i, p + X * 0.24, 0.2, m_gold())
    rod("stub", c + X * 0.1, c + X * 0.78, 0.56, m_brown(), res=8)
    rod("collar", c + X * 0.72, c + X * 1.0, 0.6, mat("collar", (150, 120, 100), rough=0.45, metal=0.5, wear=(200, 176, 150), rust=(80, 60, 50)), res=8)
    dx = WELL.x - c.x
    dy = WELL.y - c.y
    path = spline([c + X * 0.9, c + X * (dx - 0.5) + Y * dy * 0.5 + Z * -0.2, c + X * (dx - 0.12) + Y * dy + Z * -0.75, Vector((WELL.x, WELL.y, 0.3))], 48)
    ob = kit.tube("elbow", path, 0.5, m_yellow())
    ob.data.bevel_resolution = 6
    mv = mover("lump")
    lump = ball("lump-ball", path[0], 0.66, m_yellow(), parent=mv)
    LUMP.append((lump, path[::-1]))
    # the well
    w = WELL
    kit.lathe("well", [(0.0, 0.0), (1.0, 0.0), (1.05, 0.1), (0.98, 0.3), (0.8, 0.4), (0.56, 0.4), (0.56, 0.2), (0.0, 0.2)], w, m_well(), verts=28)
    kit.cyl("well-neck", 0.62, 0.5, w, mat("neck", (128, 122, 122), rough=0.5, metal=0.5, wear=(180, 176, 176), rust=(70, 60, 60)), verts=24, bevel=0.03)
    for i in range(10):
        a = math.radians(18 + 36 * i)
        ball("well-rivet-%d" % i, w + Vector((1.02 * math.cos(a), 1.02 * math.sin(a), 0.17)), 0.1, mat("rivet", (70, 30, 24), rough=0.6, metal=0.3, wear=(120, 60, 44)))
    if T == 3:           # an iron curb and a ring of magma round the well
        mp = mover("pool")
        kit.lathe("pool-ring", [(1.05, 0.0), (1.27, 0.0), (1.27, 0.07), (1.05, 0.07)], w, glow("pool", (150, 36, 8), (240, 100, 16), (255, 200, 60), 2.2, scale=4.0), verts=28, parent=mp)
        kit.lathe("well-curb", [(1.25, 0.0), (1.41, 0.0), (1.39, 0.14), (1.27, 0.16), (1.25, 0.0)], w, m_iron(), verts=28)


def pot():
    """The smoke pot on the lid: a riveted band, a flared cone with glowing ribs, a notched steel rim; the sunburst
    of glowing slots round its foot; the smoke."""
    base = POT + Z * TOP
    c = base + Z * NECK
    H = POT_H
    r0, r1 = 1.25, 1.52
    zb = 0.8                      # the band's top
    kit.lathe("skirt", [(SK_R, -0.05), (SK_R, 0.04), (1.0, SK_H), (0.0, SK_H)], base, m_lid(), verts=40)
    kit.lathe("pot-foot", [(0.98, SK_H - 0.14), (0.92, NECK + 0.08), (0.0, NECK + 0.08)], base, glow("neck", (170, 40, 8), (240, 96, 14), (255, 160, 30), 1.3, scale=3.0, cut=0.4), verts=32)
    prof = [(0.5, 0.0), (r0 - 0.06, 0.0), (r0, 0.08), (r0 + 0.02, zb - 0.06), (r0 - 0.02, zb), (r1 - 0.06, H - 0.24), (r1, H - 0.2), (r1, H), (r1 - 0.2, H),
            (r1 - 0.24, H - 0.24), (r0 - 0.22, zb + 0.06), (r0 - 0.26, 0.3), (0.0, 0.3)]
    ob = kit.lathe("pot", prof, c, m_bronze(), verts=10)          # ten flat sides, as Flash's faceted pot
    ob.data.polygons.foreach_set("use_smooth", [False] * len(ob.data.polygons))
    # the rim: steel blocks with gaps (Flash's notched ring)
    nb = 10
    for i in range(nb):
        a0, a1 = 2 * math.pi * (i + 0.06) / nb, 2 * math.pi * (i + 0.94) / nb
        pts = []
        for rr in (r1 + 0.02, r1 - 0.24):
            seq = [a0, a1]
            if rr < r1:
                seq = seq[::-1]
            pts += [(rr * math.cos(a), rr * math.sin(a)) for a in seq]
        plate("rim-%d" % i, pts, c + Z * (H - 0.04), X, Y, Z, 0.15, m_rim(), bevel=0.03)
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        d = Vector((math.cos(a), math.sin(a), 0))
        ball("pot-rivet-%d" % i, c + d * (r0 + 0.04) + Z * 0.32, 0.1, m_gold())
    mr = mover("ribs")
    for i in range(10):
        a = 2 * math.pi * i / 10
        d = Vector((math.cos(a), math.sin(a), 0))
        rod("rib-%d" % i, c + d * (r0 + 0.02) + Z * (zb + 0.03), c + d * (r1 - 0.04) + Z * (H - 0.26), 0.05, m_rib(), parent=mr)
    mm = mover("mouth")
    kit.cyl("mouth-lava", r0 - 0.2, 0.06, c + Z * (0.34 if T < 3 else zb + 0.45), m_mouth() if T < 3 else glow("mouth", (190, 50, 8), (250, 120, 18), (255, 210, 70), 1.6, scale=2.4, cut=0.45),
            verts=28, bevel=0.0, parent=mm, r2=(r0 - 0.2) if T < 3 else r0 + 0.02)
    # the sunburst: glowing slots in the lid round the pot's foot
    nr = 12
    for i in range(nr):
        a = 2 * math.pi * (i + 0.5) / nr
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        u = (d * (SK_R - 1.02) - Z * (SK_H - 0.06)).normalized()          # down the skirt's slope
        n = side.cross(u)
        n = n if n.z > 0 else -n
        ln = (Vector((SK_R - 1.02, 0, SK_H - 0.06))).length
        plate("ray-%d" % i, [(0.0, -0.1), (ln * 0.92, -0.012), (ln * 0.92, 0.012), (0.0, 0.1)], base + d * 1.02 + Z * (SK_H - 0.04), u, side, n, 0.02, m_ray(), bevel=0.0, sink=0.02)
    if T >= 2:           # a brass crown ring under the rim
        kit.ring("pot-crown", r1 + 0.03, 0.09, m_brass(), z=0.0).location = c + Z * (H - 0.26)
        kit.ring("pot-belt", r0 + 0.05, 0.07, m_brass(), z=0.0).location = c + Z * 0.06
    if T == 3:           # iron spikes on the rim
        for i in range(nb):
            a = 2 * math.pi * (i + 0.5) / nb
            d = Vector((math.cos(a), math.sin(a), 0))
            kit.cyl("pot-spike-%d" % i, 0.11, 0.6, c + d * (r1 - 0.1) + Z * (H + 0.12), m_iron(), verts=10, r2=0.01, bevel=0.0,
                    rot=(math.degrees(-0.35 * d.y), math.degrees(0.35 * d.x), 0))
    # the smoke
    ms = mover("smoke")
    nsm = 16 if T < 3 else 20
    for i in range(nsm):
        m, node = smoke_mat("smoke-%d" % i)
        at = c + Vector((rnd.uniform(-0.45, 0.45), rnd.uniform(-0.45, 0.45), H - 0.3))
        ob = kit.blob("puff-%d" % i, at, 1.0, squash=1.0, mat=m, parent=ms)
        ob["rest"] = at[:]
        SMOKE.append((ob, node, 0.035 + 0.44 * i / nsm, 0.46, (rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7))))


def tank():
    """Tier 2 on: a magma sight tank on the right face's far post, piped up to the lid."""
    y = 2.1
    h = 1.35 if T == 2 else 1.9
    z = Z0 + 1.0
    o = RF(y, z, 0.56)
    rod("tank-arm-a", RF(y, z + 0.1, 0.1), o + Z * 0.1, 0.1, m_brass())
    rod("tank-arm-b", RF(y, z + h - 0.1, 0.1), o + Z * (h - 0.1), 0.1, m_brass())
    kit.cyl("tank-base", 0.44, 0.2, o, m_brass(), verts=20, bevel=0.03)
    mt = mover("tank-glow")
    kit.cyl("tank-glass", 0.36, h - 0.3, o + Z * 0.18, m_tank(), verts=20, bevel=0.0, parent=mt)
    kit.cyl("tank-cap", 0.44, 0.2, o + Z * (h - 0.16), m_brass(), verts=20, bevel=0.03)
    for i in range(3):
        a = math.radians(-100 + 100 * i)
        d = Vector((math.cos(a), math.sin(a), 0))
        rod("tank-stay-%d" % i, o + d * 0.4 + Z * 0.15, o + d * 0.4 + Z * (h - 0.1), 0.04, m_brass())
    top = o + Z * (h + 0.04)
    if T == 3:
        ball("tank-dome", top - Z * 0.02, 0.36, m_iron(), squash=0.7)
        kit.cyl("tank-spike", 0.09, 0.4, top + Z * 0.18, m_iron(), verts=10, r2=0.01, bevel=0.0)
    r = 0.075
    zt = TOP + r - 0.01
    side = Vector((HX + 0.06 + r, y - 0.62, 0))
    pts = [top - Z * 0.05 - Y * 0.3, Vector((top.x, side.y, top.z + 0.12)), Vector((side.x, side.y, top.z + 0.12)), Vector((side.x, side.y, TOP - 0.22)),
           Vector((HX - 0.12, side.y, zt)), Vector((1.25, side.y, zt)), Vector((0.95, 0.85, zt + 0.2))]
    kit.tube("tank-feed", pts, r, m_yellow())


def belt():
    """Tier 3: a riveted iron belt under the lid on both faces seen, with glowing slots."""
    z0, z1 = Z0 + 2.72, Z0 + 3.36
    ms = mover("slots")
    slot = glow("slot", (200, 54, 8), (255, 126, 18), (255, 224, 80), 3.0, scale=3.0, cut=0.4)
    # left face: between the left post and the front chevron
    a0, a1 = -HX + 0.7, HX - 1.3
    plate("belt-l", [(a0, z0), (a1, z0), (a1, z1), (a0, z1)], LF(0, 0), X, Z, -Y, 0.1, m_iron(), bevel=0.03)
    b0, b1 = -HY + 1.3, HY - 0.7
    plate("belt-r", [(b0, z0 + 0.5), (b1, z0 + 0.5), (b1, z1 + 0.28), (b0, z1 + 0.28)], RF(0, 0), Y, Z, X, 0.1, m_iron(), bevel=0.03)
    for i in range(5):
        x = a0 + 0.3 + (a1 - a0 - 0.6) * i / 4
        if abs(x + 0.35) < 0.2 or abs(x + 1.35) < 0.2:
            continue
        plate("slot-l-%d" % i, [(x - 0.07, z0 + 0.14), (x + 0.07, z0 + 0.14), (x + 0.07, z1 - 0.14), (x - 0.07, z1 - 0.14)], LF(0, 0, 0.1), X, Z, -Y, 0.012, slot, bevel=0.0, parent=ms, sink=0.0)
    for i in range(7):
        yy = b0 + 0.25 + (b1 - b0 - 0.5) * i / 6
        if abs(yy - 1.24) < 0.2:
            continue
        plate("slot-r-%d" % i, [(yy - 0.07, z0 + 0.62), (yy + 0.07, z0 + 0.62), (yy + 0.07, z1 + 0.16), (yy - 0.07, z1 + 0.16)], RF(0, 0, 0.1), Y, Z, X, 0.012, slot, bevel=0.0, parent=ms, sink=0.0)
    for i, x in enumerate((a0 + 0.1, a1 - 0.1)):
        for j, z in enumerate((z0 + 0.1, z1 - 0.1)):
            ball("belt-rivet-l%d%d" % (i, j), LF(x, z, 0.1), 0.06, m_brass())
    for i, yy in enumerate((b0 + 0.1, b1 - 0.1)):
        for j, z in enumerate((z0 + 0.6, z1 + 0.18)):
            ball("belt-rivet-r%d%d" % (i, j), RF(yy, z, 0.1), 0.06, m_brass())


def build():
    body()
    posts()
    vent()
    pipe()
    pot()
    if T >= 2:
        tank()
    if T == 3:
        belt()


_border = kit.border_of


def border_all(objs, pad=10):
    """The moving parts' render region over the whole loop."""
    bs = []
    for k in range(0, N, 2):
        turn(k)
        bpy.context.view_layer.update()
        bs.append(_border(objs, pad))
    turn(0)
    bpy.context.view_layer.update()
    return min(b[0] for b in bs), max(b[1] for b in bs), min(b[2] for b in bs), max(b[3] for b in bs)


kit.border_of = border_all
kit.run(build, turn)
