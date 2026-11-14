"""sulfur.py : the Inferno Sulfur Swirler in 3D, three tiers, built clean-room from the Flash pictures only
(server/public/assets/buildings/isulpherproducer). Only the generic Inferno kit is used (kit.py: camera, light, render
modes), the same kit as the 3D Bone Cruncher and Coal Extractor.

    blender -b --factory-startup -P sulfur.py -- <tier 1|2|3> <fit|check|still|anim|probe|gap> [frame]

Tier 1 = levels 1-2 (Flash look 1: cracked tank in a green tub, wooden post drive), tier 2 = levels 3-6 (Flash look 2:
bigger plated tank in an iron cradle, sprocket drive, fat pipe), tier 3 = levels 7-10 (tier 2 plus: burner under the
tank, spiked rail, gold trim, second funnel, sulfur crystals, hotter seams). One model: a tank (radius RT, centre
height CZ) with every part mounted on it by bearing and height: window, intake pipe, funnel, drive on top, pole.

World: Z up, the tank's axis on the origin, 10 Flash px a unit. The camera looks from +X -Y. P(r, f, z) is the point r
units to the screen's right of the axis, f units toward the viewer, z up: Flash px (10 r, 5 f - 8.66 z) from the origin.

What moves, as Flash's strips: the chain runs round its two wheels and turns the stirring shaft on top (tier 1: the
square wooden post), a lump of sulfur travels up the gold intake pipe, the molten sulfur swirls behind the window.
Everything is periodic in the loop (51 frames at tier 1, 45 at tiers 2 and 3, as Flash), so the last frame runs into
the first.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kit  # noqa: E402

T = kit.L
N = 51 if T == 1 else 45
kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (1.0, 27.0) if T == 1 else (-4.5, 34.0)        # Flash moves the tank between its two looks
kit.SKY_E = 0.38
kit.SUN = 5.4
kit.FRAME = (-60, -80, 60, 70)
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))      # PB_EXTRA=1 also renders frame N (= frame 0), the loop check
rnd = random.Random(31)
R2 = math.sqrt(2.0)
SR, SF, UP = Vector((1, 1, 0)) / R2, Vector((1, -1, 0)) / R2, Vector((0, 0, 1))
K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)
BIG = T >= 2

RT = 2.45 if T == 1 else 2.7                 # the tank's radius
CZ = 3.93 if T == 1 else 3.4                 # its centre's height
C = Vector((0, 0, CZ))


def grey(x):
    return (x, x, x, 1)


def P(r, f, z=0.0):
    return SR * r + SF * f + UP * z


def D(phi):
    """Unit ground vector at screen bearing phi: 0 toward the viewer, 90 to the screen's right."""
    a = math.radians(phi)
    return SF * math.cos(a) + SR * math.sin(a)


def S(phi, el, rad=None):
    """The point on the tank at bearing phi, `el` degrees above its middle."""
    e = math.radians(el)
    return C + (D(phi) * math.cos(e) + UP * math.sin(e)) * (RT if rad is None else rad)


def frame_at(p, x, z):
    """Matrix at p with local X along x and local Z along z (made square)."""
    z = Vector(z).normalized()
    x = Vector(x)
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = Vector(p)
    return M


def aim(ob, p, z, x=None):
    z = Vector(z)
    x = x or (UP if abs(z.normalized().z) < 0.9 else SR)
    ob.matrix_world = frame_at(p, x, z)
    return ob


# ------------------------------------------------------------------------------------------------------------ materials
MATS = kit.MATS
SWIRLS = []          # (mapping node, centre, radius): the window's liquid, moved round a circle in a loop


def mat(name, col, rough=0.6, metal=0.0, wear=None, wear_amt=0.6, rust=None, rust_at=0.6, dirt=0.3, scale=5.0,
        speck=0.14, bump=0.07, ao_min=0.5, streak=None, mottle=0.4, top=None):
    """Paint or metal: worn patches (`wear` shows through), rust blotches, a fine speckle, darker toward the ground and
    in creases. streak = colour of soft marks that run down the part."""
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


def glow(name, col, strength):
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    t.set(**{"Base Color": kit.srgb(*col), "rough": 0.5})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(*col)
    t.bsdf.inputs["Emission Strength"].default_value = strength
    MATS[name] = t.m
    return t.m


def m_tank():
    """The tank's shell: dull maroon plates with glowing yellow sulfur seams between them (a Voronoi's cell edges).
    Tier 1: thin cracks in a blotchy purple shell. Tier 2 up: thick seams round puffed plates."""
    if "tank" in MATS:
        return MATS["tank"]
    t = kit.NT("tank")
    v = t.coords()
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vo.inputs["Scale"].default_value = 0.86 if T == 1 else 0.82
    vo.inputs["Randomness"].default_value = 1.0 if T == 1 else 0.8
    wob = t.mix(v, t.noise(v, 1.6, 2.0, 0.5), 0.10 if T == 1 else 0.05)
    t.link(wob, vo.inputs["Vector"])
    d = vo.outputs["Distance"]
    w = 0.028 if T == 1 else 0.062
    if T == 1:
        base, pale, dark = (104, 60, 68), (150, 108, 104), (62, 34, 42)
    else:
        base, pale, dark = (128, 52, 44), (178, 96, 82), (78, 28, 26)
    col = t.mix(kit.srgb(*base), kit.srgb(*pale), t.ramp(t.noise(v, 1.5, 4.0, 0.6, 0.5), [(0.42, K0), (0.7, grey(0.8))]))
    col = t.mix(col, kit.srgb(*dark), t.ramp(t.noise(v, 2.6, 4.0, 0.65, 1.2), [(0.52, K0), (0.72, grey(0.75))]))
    col = t.mix(col, t.ramp(t.noise(v, 40, 2.0, 0.5), [(0.3, grey(0.84)), (0.62, K1)]), 1.0, "MULTIPLY")
    col = t.mix(col, t.ramp(d, [(w, grey(0.55)), (w * 3.2, K1)]), 1.0, "MULTIPLY")      # plates darken toward the seam
    col = t.grime(col, 0.0, 2.6, 0.3, 0.5)
    seam = t.ramp(d, [(w * 0.75, K1), (w, K0)])
    hot = {1: (228, 208, 40), 2: (232, 212, 28), 3: (255, 214, 30)}[T]
    core = {1: (236, 226, 90), 2: (246, 232, 70), 3: (255, 246, 170)}[T]
    scol = t.mix(kit.srgb(*hot), kit.srgb(*core), t.ramp(d, [(0.0, K1), (w * 0.6, K0)]))
    out = t.mix(col, scol, seam)
    t.set(**{"Base Color": out, "rough": 0.62, "spec": 0.35})
    t.link(scol, t.bsdf.inputs["Emission Color"])
    es = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(seam, es.inputs[0])
    es.inputs[1].default_value = {1: 0.6, 2: 0.5, 3: 1.6}[T]
    t.link(es.outputs[0], t.bsdf.inputs["Emission Strength"])
    h = t.ramp(d, [(w * 0.6, K0), (w * (2.0 if T == 1 else 4.0), K1)])
    t.bump(h, 0.25 if T == 1 else 0.7, 0.05)
    MATS["tank"] = t.m
    return t.m


def m_neck(height):
    """The neck on the tank (tier 2 up): the shell's maroon with yellow sulfur running down from its top in points."""
    if "neck" in MATS:
        return MATS["neck"]
    t = kit.NT("neck")
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Object"], sep.inputs[0])

    def m(op, a, b=None):
        node = t.n("ShaderNodeMath", operation=op)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                node.inputs[i].default_value = x
            else:
                t.link(x, node.inputs[i])
        return node.outputs[0]
    ang = m("ARCTAN2", sep.outputs["Y"], sep.outputs["X"])
    tri = m("ABSOLUTE", m("SUBTRACT", m("FRACT", m("ADD", m("MULTIPLY", ang, 7 / (2 * math.pi)), 0.5)), 0.5))   # 0..0.5
    thr = m("SUBTRACT", height - 0.04, m("MULTIPLY", m("POWER", m("MULTIPLY", tri, 2.0), 1.6), 0.36 * height))
    mask = m("GREATER_THAN", sep.outputs["Z"], thr)
    v = t.coords()
    col = t.mix(kit.srgb(128, 52, 44), kit.srgb(176, 96, 82), t.ramp(t.noise(v, 2.0, 4.0, 0.6, 0.5), [(0.42, K0), (0.7, grey(0.8))]))
    col = t.grime(col, 0.0, 2.6, 0.2, 0.5)
    y = kit.srgb(244, 222, 30)
    t.set(**{"Base Color": t.mix(col, y, mask), "rough": 0.6})
    t.bsdf.inputs["Emission Color"].default_value = y
    es = m("MULTIPLY", mask, 1.6 if T == 3 else 0.5)
    t.link(es, t.bsdf.inputs["Emission Strength"])
    MATS["neck"] = t.m
    return t.m


def m_liquid():
    """The molten sulfur behind the window: bright yellow with paler and amber swirls that drift round in a loop."""
    if "liquid" in MATS:
        return MATS["liquid"]
    t = kit.NT("liquid")
    v = t.coords()
    mp = v.node
    n = t.noise(v, 1.5, 3.0, 0.55, 2.6)
    if T == 3:
        stops = [(0.3, kit.srgb(236, 120, 16)), (0.46, kit.srgb(255, 214, 24)), (0.62, kit.srgb(255, 240, 60)), (0.78, kit.srgb(255, 252, 190))]
    else:
        stops = [(0.3, kit.srgb(226, 160, 36)), (0.44, kit.srgb(246, 222, 24)), (0.62, kit.srgb(255, 240, 44)), (0.8, kit.srgb(255, 250, 160))]
    c = t.ramp(n, stops)
    t.set(**{"Base Color": c, "rough": 0.3})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = 1.6 if T == 3 else 1.15
    SWIRLS.append((mp, (4.0, 7.0, 2.0), 0.55))
    MATS["liquid"] = t.m
    return t.m


def m_green():
    return mat("green", (50, 84, 68), rough=0.5, metal=0.35, wear=(96, 140, 112), wear_amt=0.5, rust=(30, 52, 44), rust_at=0.58,
               dirt=0.25, scale=4.0, streak=(24, 40, 34))


def m_frame():
    return mat("frame", (40, 62, 52), rough=0.5, metal=0.35, wear=(70, 100, 84), wear_amt=0.45, rust=(22, 34, 30), rust_at=0.58,
               dirt=0.2, scale=5.0)


def m_tub():
    return mat("tub", (44, 76, 58), rough=0.55, metal=0.3, wear=(74, 112, 84), wear_amt=0.45, rust=(22, 40, 32), rust_at=0.55,
               dirt=0.45, scale=3.5, streak=(18, 30, 24))


def m_iron():
    return mat("iron", (34, 36, 40), rough=0.45, metal=0.7, wear=(70, 74, 82), wear_amt=0.5, dirt=0.3, scale=5.0)


def m_steel():
    return mat("steel", (150, 154, 168), rough=0.4, metal=0.8, wear=(170, 176, 190), dirt=0.2, scale=6.0)


def m_gold():
    return mat("gold", (228, 150, 44), rough=0.42, metal=0.25, wear=(250, 204, 92), wear_amt=0.5, rust=(168, 104, 30), rust_at=0.62,
               dirt=0.3, scale=3.5, ao_min=0.6)


def m_joint():
    return mat("joint", (64, 36, 18), rough=0.6, dirt=0.2, mottle=0.2)


def m_wood():
    return mat("wood", (150, 86, 44), rough=0.75, wear=(182, 116, 62), rust=(98, 56, 30), dirt=0.15, scale=7.0, top=(232, 142, 70))


def m_red():
    return mat("red", (112, 30, 26), rough=0.5, metal=0.2, wear=(150, 52, 40), wear_amt=0.5, rust=(64, 16, 16), dirt=0.2, scale=5.0)


def m_rock():
    return mat("rock", (104, 80, 54), rough=0.9, wear=(150, 122, 82), rust=(58, 44, 30), rust_at=0.5, dirt=0.5, scale=3.0,
               streak=(60, 44, 28), bump=0.3, top=(150, 124, 86))


def m_funnel():
    if T == 1:
        return mat("funnel", (104, 98, 40), rough=0.5, metal=0.4, wear=(160, 150, 60), rust=(66, 64, 30), dirt=0.2, scale=5.0)
    return mat("funnel", (74, 116, 56), rough=0.5, metal=0.35, wear=(110, 150, 76), rust=(40, 66, 36), dirt=0.2, scale=5.0)


def m_trim():
    return mat("trim", (232, 176, 60), rough=0.3, metal=0.85, wear=(255, 222, 120), dirt=0.2, scale=6.0, mottle=0.2)


def m_crystal():
    if "crystal" in MATS:
        return MATS["crystal"]
    t = kit.NT("crystal")
    t.set(**{"Base Color": kit.srgb(244, 214, 40), "rough": 0.25, "spec": 0.6})
    t.bsdf.inputs["Emission Color"].default_value = kit.srgb(240, 200, 30)
    t.bsdf.inputs["Emission Strength"].default_value = 0.22
    MATS["crystal"] = t.m
    return t.m


# ------------------------------------------------------------------------------------------------------------ movers
BULGES = []         # (object, {vertex: (centre, offset, s)}, t0, t1, amp, width)
SPINS = []          # (hub, turns a loop about its Z)
CHAIN = []          # (links, path, length, pitch, pitches a loop)


def mover(name, at=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    e.location = at
    kit.MOVING.append(e)
    return e


def turn(k):
    f = (k % N) / N
    for ob, rest, t0, t1, amp, width in BULGES:
        me = ob.data
        u = (f - t0) / (t1 - t0)
        on = 0.0 <= u <= 1.0
        pos = 1.0 + 2.2 * width - (1.0 + 4.4 * width) * u            # from the ground end (s = 1) up to the tank
        for i, (c, off, s) in rest.items():
            g = 0.0
            if on:
                edge = min(1.0, s / (0.5 * width), (1.0 - s) / (0.5 * width))       # no swelling at the fixed ends
                g = amp * math.exp(-((s - pos) / width) ** 2) * max(0.0, edge)
            me.vertices[i].co = c + off * (1.0 + g)
        me.update()
    for hub, turns in SPINS:
        hub.rotation_euler = (0, 0, 2 * math.pi * turns * f)
    for links, path, length, pitch, shift in CHAIN:
        for i, ob in enumerate(links):
            p, tg = path((i * pitch + shift * pitch * f) % length)
            ob.location = p
            ob.rotation_euler = (0, 0, math.atan2(tg.y, tg.x))
    for mp, c, r in SWIRLS:
        a = 2 * math.pi * f
        mp.inputs["Location"].default_value = (c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2] + 0.5 * r * math.sin(2 * a))


# ============================================================================================================ the parts
def tank():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=40, radius=RT)
    ob = kit.mesh_ob("tank", bm, [m_tank()])
    ob.location = C


def tub():
    """Tier 1: the green tub the tank sits in, and the iron band with steel clasps round its rim."""
    kit.lathe("tub", [(0.0, 0.0), (2.02, 0.0), (2.1, 0.06), (2.36, 2.42), (2.2, 2.42)], (0, 0, 0), m_tub(), verts=48)
    kit.lathe("band", [(2.3, 2.36), (2.52, 2.4), (2.52, 3.32), (2.46, 3.42), (2.36, 3.42), (2.34, 3.3)], (0, 0, 0), m_iron(), verts=48)
    for i in range(8):
        phi = 12 + 45 * i
        at = D(phi) * 2.53 + UP * 2.86
        b = kit.box("clasp%d" % i, (0.2, 0.09, 1.16), at, m_steel(), bevel=0.02, origin="centre")
        aim(b, at, UP, D(phi + 90))
    for z in (2.46, 3.26):
        kit.ring("bandrim%d" % int(z * 10), 2.53, 0.045, m_steel(), z=z)


def cradle():
    """Tier 2 up: the iron cradle the tank sits in (where tier 1 has its tub): a firebox drum under the tank, a band
    round the tank's middle on six pierced legs, braces between the legs. Tier 3 lights the firebox and adds spikes."""
    zr = 3.3
    rin = math.sqrt(RT * RT - (zr + 0.3 - CZ) ** 2) - 0.03
    ro = RT + 0.2
    kit.lathe("rail", [(rin, zr - 0.3), (ro - 0.04, zr - 0.3), (ro, zr - 0.26), (ro, zr + 0.26), (ro - 0.04, zr + 0.3), (rin, zr + 0.3)],
              (0, 0, 0), m_iron(), verts=64, bevel=0.02)
    kit.ring("railrim", ro + 0.01, 0.05, m_steel(), z=zr + 0.27)
    kit.lathe("firebox", [(0.0, 0.0), (2.1, 0.0), (2.16, 0.08), (2.16, 0.95), (2.0, 1.1), (1.6, 1.22), (0.0, 1.22)], (0, 0, 0), m_iron(), verts=48, bevel=0.02)
    kit.ring("fireboxrim", 2.17, 0.05, m_steel(), z=0.95)
    phis = (20, 65, 110, 160, 222)
    feet = []
    for i, phi in enumerate(phis):
        d, sd = D(phi), D(phi + 90)
        top, foot = d * (ro - 0.02) + UP * (zr - 0.2), d * 3.3
        feet.append((top, foot))
        for j, s in enumerate((-0.42, 0.42)):
            kit.sweep("leg%d-r%d" % (i, j), [top + sd * s * 0.85, foot + sd * s + UP * 0.12], d, 0.2, 0.3, m_iron(), bevel=0.03)
        for j in range(5):
            u = (j + 0.5) / 5.0
            p = top.lerp(foot + UP * 0.12, u)
            hw = 0.42 * (0.85 + 0.15 * u)
            kit.sweep("leg%d-x%d" % (i, j), [p - sd * hw, p + sd * hw], d, 0.17, 0.26, m_steel() if j == 0 else m_iron(), bevel=0.03)
        fb = kit.box("leg%d-foot" % i, (1.2, 0.55, 0.14), foot, m_trim() if T == 3 else m_iron(), bevel=0.04)
        aim(fb, foot, UP, sd)
        if T == 3:                      # a spike on the band over each leg, and between
            for dphi in (0, 30):
                e = D(phi + dphi)
                sp = kit.cyl("spike%d-%d" % (i, dphi), 0.17, 0.9, (0, 0, 0), m_steel(), verts=8, r2=0.0, bevel=0.0)
                aim(sp, e * (ro - 0.02) + UP * zr, e * 0.9 + UP * 0.45)
    for i in range(4):                  # crossed braces between neighbouring legs (not where the pipe passes)
        (t0, f0), (t1, f1) = feet[i], feet[i + 1]
        out = (D(phis[i]) + D(phis[i + 1])).normalized()
        for j, (a, b) in enumerate(((t0.lerp(f0, 0.12), t1.lerp(f1, 0.9)), (t0.lerp(f0, 0.9), t1.lerp(f1, 0.12)))):
            kit.sweep("brace%d-%d" % (i, j), [a + out * (0.05 - 0.1 * j), b + out * (0.05 - 0.1 * j)], out, 0.07, 0.16, m_iron(), bevel=0.02)
    if T == 3:
        fire = kit.lava("fire", strength=6.0, scale=2.4)
        for i in range(10):             # glowing fire holes round the firebox
            e = D(8 + 36 * i)
            b = kit.box("vent%d" % i, (0.62, 0.08, 0.5), (0, 0, 0), fire, bevel=0.03, origin="centre")
            aim(b, e * 2.15 + UP * 0.5, UP, D(8 + 36 * i + 90))
        for i in range(3):
            ld = bpy.data.lights.new("fireglow%d" % i, "POINT")
            ld.energy = 60
            ld.color = (1.0, 0.5, 0.12)
            ld.shadow_soft_size = 0.5
            lo = bpy.data.objects.new("fireglow%d" % i, ld)
            kit.link(lo)
            lo.location = D(-20 + 70 * i) * 2.9 + UP * 0.6


def window():
    """The window on the tank's front: a green frame bent on the shell, the molten sulfur behind it (moving)."""
    phi, el = (3.0, 31.0) if T == 1 else (0.0, 41.0)
    e = math.radians(el)
    n = D(phi) * math.cos(e) + UP * math.sin(e)
    tx, ty = D(phi + 90), -D(phi) * math.sin(e) + UP * math.cos(e)
    if T == 1:
        wb, wt, h, fw, th = 0.54, 0.42, 0.3, 0.1, 0.13
    else:
        wb, wt, h, fw, th = 0.66, 0.72, 0.26, 0.125, 0.17

    def loop(grow, m=64):
        out = []
        for i in range(m):
            a = 2 * math.pi * i / m
            cs, sn = math.cos(a), math.sin(a)
            v = math.copysign(abs(sn) ** 0.45, sn)
            w = (wb + (wt - wb) * (v + 1) / 2) + grow
            out.append((w * math.copysign(abs(cs) ** 0.45, cs), (h + grow) * v))
        return out

    def pt(u, v, rad):
        return C + (n + tx * u + ty * v).normalized() * rad
    bm = bmesh.new()
    rows = []
    for (g, rad) in ((fw, RT - 0.02), (fw, RT + th), (0.0, RT + th), (0.0, RT - 0.02)):
        rows.append([bm.verts.new(pt(u, v, rad)) for u, v in loop(g)])
    m = len(rows[0])
    for a, b in zip(rows, rows[1:]):
        for i in range(m):
            j = (i + 1) % m
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("winframe", bm, [m_frame()], bevel=0.035)
    if T == 3:                               # a gold lip round the frame, three iron teeth over it
        kit.tube("wintrim", [pt(u, v, RT + th * 0.55) for u, v in loop(fw + 0.02)], 0.035, m_trim(), cyclic=True)
        for u in (-0.36, 0.0, 0.36):
            p = pt(u, h + fw * 0.6, RT + th * 0.6)
            sp = kit.cyl("brow%d" % int(u * 100 + 50), 0.1, 0.5, (0, 0, 0), m_steel(), verts=8, r2=0.0, bevel=0.0)
            aim(sp, p, (p - C).normalized() * 0.8 + UP * 0.6)
    e_ = mover("glass")
    bm = bmesh.new()
    c0 = bm.verts.new(pt(0, 0, RT + 0.05))
    rings = [[bm.verts.new(pt(u * k, v * k, RT + 0.05)) for u, v in loop(0.012)] for k in (0.34, 0.67, 1.0)]
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((c0, rings[0][i], rings[0][j]))
        for a, b in zip(rings, rings[1:]):
            bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    kit.mesh_ob("glass-pane", bm, [m_liquid()], parent=e_)


def catmull(pts, n):
    """n points evenly spaced along the smooth curve through pts."""
    pts = [Vector(p) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    fine = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for j in range(24):
            t = j / 24
            fine.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    fine.append(pts[-1])
    acc = [0.0]
    for a, b in zip(fine, fine[1:]):
        acc.append(acc[-1] + (b - a).length)
    out, j = [], 0
    for i in range(n):
        d = acc[-1] * i / (n - 1)
        while j < len(acc) - 2 and acc[j + 1] < d:
            j += 1
        u = (d - acc[j]) / max(1e-9, acc[j + 1] - acc[j])
        out.append(fine[j].lerp(fine[j + 1], u))
    return out


def pipe():
    """The gold intake pipe: from the ground at the front left up into the tank's left side, in ringed segments. One
    mesh (moving): a lump travels up it."""
    if T == 1:
        ctrl = [S(-72, -16, RT - 0.35), S(-72, -16, RT + 0.3), P(-3.02, 1.2, 2.5), P(-2.82, 1.62, 1.3), P(-2.52, 1.8, -0.1)]
        rad, segs = 0.47, 4
    else:
        ctrl = [S(-50, -5, RT - 0.4), S(-50, -5, RT + 0.42), P(-1.98, 3.3, 3.0), P(-0.98, 3.78, 1.5), P(-0.56, 3.82, -0.1)]
        rad, segs = 0.7, 5
    per = 14
    cen = catmull(ctrl, segs * per + 1)
    e_ = mover("pipe")
    bm = bmesh.new()
    nv = 24
    rest = {}
    rows = []
    prev_n = None
    for i, c in enumerate(cen):
        tg = (cen[min(i + 1, len(cen) - 1)] - cen[max(i - 1, 0)]).normalized()
        nrm = (UP - tg * UP.dot(tg)) if prev_n is None else (prev_n - tg * prev_n.dot(tg))
        nrm.normalize()
        prev_n = nrm
        bn = tg.cross(nrm)
        q = (i % per) / per
        jd = min(i % per, per - i % per)                 # rings from a joint
        r = rad * (0.9 if jd == 0 else 0.97 if jd == 1 else 1.0 + 0.045 * math.sin(math.pi * q))
        row = []
        for j in range(nv):
            a = 2 * math.pi * j / nv
            v = bm.verts.new(c + (nrm * math.cos(a) + bn * math.sin(a)) * r)
            row.append(v)
        rows.append(row)
    bm.verts.index_update()
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            rest[v.index] = (cen[i].copy(), v.co - cen[i], i / (len(cen) - 1))
    for i, (a, b) in enumerate(zip(rows, rows[1:])):
        jd = min(i % per, per - 1 - i % per)
        for j in range(nv):
            k = (j + 1) % nv
            fc = bm.faces.new((a[j], a[k], b[k], b[j]))
            fc.material_index = 1 if jd == 0 else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob("pipe-skin", bm, [m_gold(), m_joint()], parent=e_)
    BULGES.append((ob, rest, 0.08, 0.96, 0.34 if T == 1 else 0.3, 0.13))
    # the dark red hood where it enters the tank, and (tier 2 up) the collar where it enters the ground
    d0 = (ctrl[1] - ctrl[0]).normalized()
    hood = kit.lathe("hood", [(rad * 0.9, -0.1), (rad * 1.3, -0.05), (rad * 1.26, 0.14), (rad * 1.12, 0.26), (rad * 1.0, 0.28)], (0, 0, 0), m_red(), verts=32)
    aim(hood, S(-72 if T == 1 else -50, -16 if T == 1 else -5, RT - 0.04), d0)
    if BIG:
        ft = ctrl[-1]
        kit.lathe("collar", [(rad * 0.9, 0.0), (rad * 1.28, 0.0), (rad * 1.34, 0.1), (rad * 1.3, 0.34), (rad * 1.12, 0.4), (rad * 1.02, 0.4)],
                  (ft.x, ft.y, 0.0), m_red(), verts=32)
    return ctrl[-1]


def crag(name, at, h, r, lean=(0, 0, 0), mat_=None, facet=False):
    """A rock spire standing on `at`: ridged down its length like Flash's rock (smooth), or a faceted crystal."""
    bm = bmesh.new()
    sides, rings = (6, 3) if facet else (14, 8)
    rows = []
    off = rnd.uniform(0, 6.28)
    lobes = [1.0 if facet else rnd.uniform(0.7, 1.2) for _ in range(sides)]
    for i in range(rings + 1):
        u = i / rings
        if facet:
            rr = r * (1.0 if u < 0.7 else (1 - u) / 0.3) * (0.8 + 0.2 * u / 0.7 if u < 0.7 else 1.0)
        else:
            rr = r * (1 - u ** 1.5) ** 0.7 * (1.15 if i == 0 else 1.0)
        c = Vector(at) + UP * (h * u) + Vector(lean) * (u * u)
        if i == rings:
            rows.append([bm.verts.new(c)])
            continue
        tw = 0.0 if facet else 0.12 * i
        rows.append([bm.verts.new(c + Vector((math.cos(off + tw + 2 * math.pi * j / sides), math.sin(off + tw + 2 * math.pi * j / sides), 0))
                                  * rr * lobes[j] * (1.0 if facet else rnd.uniform(0.94, 1.06))) for j in range(sides)])
    for a, b in zip(rows, rows[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            if len(b) == 1:
                bm.faces.new((a[j], a[k], b[0]))
            else:
                bm.faces.new((a[j], a[k], b[k], b[j]))
    bm.faces.new(rows[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if facet:
        return kit.mesh_ob(name, bm, [mat_], smooth=False, bevel=0.015, segs=2)
    return kit.mesh_ob(name, bm, [mat_ or m_rock()], smooth=True, subsurf=1)


def rocks(foot):
    """The brown rock the pipe comes out of, piled against the building's front left."""
    if T == 1:
        spots = [(-70, 2.95, 1.6, 0.55), (-84, 3.05, 1.1, 0.5), (-46, 2.95, 2.9, 0.72), (-34, 2.95, 3.0, 0.75), (-22, 2.98, 2.6, 0.72),
                 (-40, 3.7, 1.8, 0.7), (-10, 2.95, 2.0, 0.65), (-26, 3.8, 1.5, 0.68), (-12, 3.7, 1.1, 0.55),
                 (4, 3.0, 1.2, 0.5), (-34, 4.4, 0.7, 0.45)]
    else:
        spots = [(-72, 2.7, 1.5, 0.6), (-60, 2.9, 2.0, 0.7), (-48, 3.3, 1.8, 0.7), (-38, 3.0, 1.6, 0.7), (-30, 3.6, 1.3, 0.65),
                 (-45, 3.9, 1.1, 0.6), (-24, 3.0, 1.2, 0.6), (-36, 4.3, 0.7, 0.5)]
    for i, (phi, dist, h, r) in enumerate(spots):
        at = D(phi) * dist
        if (at - Vector((foot.x, foot.y, 0))).length < (0.75 if T == 1 else 1.25):
            continue
        crag("rock%d" % i, at, h, r, lean=-D(phi) * 0.25 * h * 0.3)
    if T == 3:                          # sulfur crystals grown on the rock and at the pipe's foot
        for i, (phi, dist, h) in enumerate([(-62, 3.0, 1.0), (-50, 3.4, 0.9), (-40, 3.1, 1.0), (-30, 3.7, 0.7), (-46, 4.0, 0.6),
                                            (-70, 2.8, 0.7), (104, 3.72, 0.8), (112, 3.8, 0.55), (97, 3.85, 0.45)]):
            crag("crystal%d" % i, D(phi) * dist + UP * (0.5 if i < 6 else 0.0), h, 0.17, lean=D(phi + rnd.uniform(-60, 60)) * 0.3, mat_=m_crystal(), facet=True)


def funnel(phi, scale=1.0, tag=""):
    """The funnel on the tank's right shoulder: a stem out of the shell and an open cup on top."""
    if T == 1:
        a = S(phi, 31, RT - 0.1)
        base = a + D(phi) * 0.3 + UP * 1.0
        kit.tube("fstem" + tag, [a, a + D(phi) * 0.3 + UP * 0.35, base - UP * 0.25, base], 0.11, m_funnel(), smooth=True)
        cup = kit.lathe("fcup" + tag, [(0.0, 0.0), (0.34, 0.0), (0.46, 0.12), (0.5, 0.6), (0.63, 0.78), (0.63, 0.92), (0.48, 0.92), (0.38, 0.5), (0.0, 0.2)],
                        (0, 0, 0), m_funnel(), verts=32, bevel=0.015)
        aim(cup, base, UP * 1.0 + D(phi) * 0.1)
        for i in range(8):
            ang = 2 * math.pi * i / 8
            kit.blob("frivet%s%d" % (tag, i), (0.64 * math.cos(ang), 0.64 * math.sin(ang), 0.85), 0.06, 0.8, glow("rivet", (200, 150, 50), 0.15), parent=cup)
        return
    a = S(phi, 40, RT - 0.1)
    base = a + (D(phi) * 0.25 + UP * 1.45) * scale
    axis = UP * 1.0 + D(phi + 30) * 0.3
    kit.tube("fstem" + tag, [a, a + D(phi) * 0.3 * scale + UP * 0.25 * scale, base - axis * 0.1, base + axis * 0.1], 0.19 * scale, m_funnel(), smooth=True)
    s = scale * 0.92
    cup = kit.lathe("fcup" + tag, [(0.0, 0.0), (0.24 * s, 0.0), (0.42 * s, 0.8 * s), (0.62 * s, 1.5 * s), (0.78 * s, 1.78 * s), (0.78 * s, 1.9 * s),
                                   (0.62 * s, 1.9 * s), (0.46 * s, 1.4 * s), (0.26 * s, 0.7 * s), (0.0, 0.5 * s)], (0, 0, 0), m_funnel(), verts=32, bevel=0.015)
    aim(cup, base, axis)
    if T == 3:
        kit.ring("frim" + tag, 0.72 * s, 0.07 * s, m_trim(), parent=cup, z=1.88 * s)
    for i in range(8):
        ang = 2 * math.pi * i / 8
        kit.blob("frivet%s%d" % (tag, i), (0.66 * s * math.cos(ang), 0.66 * s * math.sin(ang), 1.56 * s), 0.06 * s, 0.8,
                 glow("rivet", (236, 120, 40), 0.5), parent=cup)


def drive():
    """The swirler's drive on top: the stirring shaft on the tank's axis, a pole behind the tank, a wheel on each and
    the chain round both. The chain and the wheels move; the shaft turns with its wheel."""
    top = CZ + RT
    if T == 1:
        teeth, r, shift, zc = 12, 0.40, 9, 8.02
        z_cap = top + 1.22
        kit.lathe("cap", [(0.0, top - 0.25), (1.02, top - 0.25), (1.06, top - 0.02), (1.0, top + 0.2), (0.62, top + 0.34), (0.56, top + 0.8),
                          (0.78, top + 0.9), (0.8, top + 1.12), (0.7, z_cap), (0.0, z_cap)], (0, 0, 0), m_green(), verts=40, bevel=0.02)
    else:
        teeth, r, shift, zc = 20, 0.85, 8, 8.8
        hn = 1.5
        zn = top - 0.12
        nk = kit.lathe("neck", [(0.8, 0.0), (0.68, 0.5), (0.54, hn), (0.46, hn + 0.04), (0.0, hn + 0.04)], (0, 0, zn), m_neck(hn), verts=40)
        z_cap = zn + hn + 0.04
        if T == 3:
            kit.ring("neckband", 0.58, 0.07, m_trim(), z=zn + hn - 0.08)
            kit.ring("neckband2", 0.84, 0.08, m_trim(), z=zn + 0.1)
    pitch = 2 * math.pi * r / teeth
    half = 12 if T == 1 else 10.5
    nlinks = teeth + int(2 * half)
    d = half * pitch
    dirv = (D(-140) if T == 1 else D(-138))            # from the axis to the pole: behind the tank, to the left
    A, B = UP * zc, dirv * d + UP * zc
    nv = UP.cross(dirv)
    length = nlinks * pitch

    def path(s):
        if s < d:
            return A + nv * r + dirv * s, dirv
        s -= d
        if s < math.pi * r:
            a = s / r
            return B + (nv * math.cos(a) + dirv * math.sin(a)) * r, -nv * math.sin(a) + dirv * math.cos(a)
        s -= math.pi * r
        if s < d:
            return B - nv * r - dirv * s, -dirv
        s -= d
        a = s / r
        return A + (-nv * math.cos(a) - dirv * math.sin(a)) * r, nv * math.sin(a) - dirv * math.cos(a)
    ce = mover("chain")
    links = []
    ml, md = mat("link", (196, 198, 206), rough=0.45, metal=0.5, dirt=0.05, mottle=0.2), m_iron()
    for i in range(nlinks):
        lk = kit.box("chain-l%d" % i, (pitch * 0.68, 0.15, 0.2), (0, 0, 0), ml, bevel=0.02, origin="centre", parent=ce)
        kit.box("chain-p%d" % i, (pitch * 0.4, 0.09, 0.12), (pitch * 0.5, 0, 0), md, bevel=0.01, origin="centre", parent=lk)
        links.append(lk)
    CHAIN.append((links, path, length, pitch, shift))
    turns = -shift / teeth
    # the shaft on the axis
    hub = mover("shaft", (0, 0, 0))
    SPINS.append((hub, turns))
    if T == 1:
        kit.box("shaft-post", (0.54, 0.54, 9.22 - z_cap + 0.1), (0, 0, z_cap - 0.1), m_wood(), bevel=0.03, parent=hub)
        for i in range(4):
            b = kit.box("shaft-brace%d" % i, (0.5, 0.1, 0.12), (0, 0, 0), mat("brace", (190, 110, 50), rough=0.6, dirt=0.1), bevel=0.02,
                        origin="centre", parent=hub)
            a = math.radians(45 + 90 * i)
            b.location = (0.46 * math.cos(a), 0.46 * math.sin(a), z_cap + 0.07)
            b.rotation_euler = (0, 0, a)
        kit.gear("shaft-wheel", r - 0.03, teeth, 0.1, (0, 0, zc), m_iron(), (0, 0, 0), tooth=0.22, parent=hub)
    else:
        kit.cyl("shaft-rod", 0.17, 9.75 - z_cap + 0.1, (0, 0, z_cap - 0.1), m_red(), verts=16, parent=hub)
        kit.box("shaft-nut", (0.3, 0.3, 0.22), (0, 0, 9.72), m_red(), bevel=0.03, parent=hub)
        wheel(hub, r, teeth, zc)
        kit.cyl("shaft-boss", 0.36, 0.3, (0, 0, z_cap), m_green(), verts=20, parent=hub)
    # the pole and its wheel
    foot_z = CZ + (1.0 if T == 1 else 1.55)
    pb = dirv * d
    if T == 1:
        kit.cyl("pole", 0.095, 8.72 - foot_z, (pb.x, pb.y, foot_z), m_wood(), verts=10, bevel=0.01)
    else:
        kit.cyl("pole", 0.14, 9.4 - foot_z, (pb.x, pb.y, foot_z), m_red(), verts=14, bevel=0.01)
    # the bracket that carries the pole on the shell
    rs = math.sqrt(RT * RT - (foot_z - CZ) ** 2)
    ln = d - rs + 0.45
    bk = kit.box("bracket", (ln, 0.5 if BIG else 0.3, 0.2), (0, 0, 0), m_green(), bevel=0.04, origin="centre")
    aim(bk, dirv * (rs - 0.2 + ln / 2) + UP * (foot_z + 0.02), UP, dirv)
    if BIG:
        kit.cyl("polefoot", 0.24, 0.3, (pb.x, pb.y, foot_z + 0.1), m_green(), verts=14)
    h2 = mover("idler", (pb.x, pb.y, 0))
    SPINS.append((h2, turns))
    if T == 1:
        kit.gear("idler-wheel", r - 0.03, teeth, 0.1, (0, 0, zc), m_iron(), (0, 0, 0), tooth=0.22, parent=h2)
    else:
        wheel(h2, r, teeth, zc)
        kit.cyl("idler-cap", 0.2, 0.25, (0, 0, 9.3), m_red(), verts=12, parent=h2)


def wheel(hub, r, teeth, zc):
    """A green chain wheel with five dark holes (so its turning shows)."""
    n = hub.name
    kit.gear(n + "-wheel", r - 0.03, teeth, 0.12, (0, 0, zc), m_green(), (0, 0, 0), tooth=0.16, parent=hub)
    kit.cyl(n + "-hubcap", 0.3, 0.2, (0, 0, zc), m_green(), verts=16, parent=hub)
    for i in range(5):
        a = 2 * math.pi * i / 5
        kit.cyl(n + "-hole%d" % i, 0.12, 0.02, (0.52 * math.cos(a), 0.45 * math.sin(a), zc + 0.055), m_red(), verts=10, bevel=0.0, parent=hub)


def build():
    tank()
    if T == 1:
        tub()
    else:
        cradle()
    window()
    foot = pipe()
    rocks(foot)
    funnel(84 if T == 1 else 60)
    drive()


_border = kit.border_of


def border_all(objs, pad=10):
    """The moving parts' render region over the whole loop."""
    bs = []
    for k in range(0, N, 3):
        turn(k)
        bpy.context.view_layer.update()
        bs.append(_border(objs, pad))
    turn(0)
    bpy.context.view_layer.update()
    return min(b[0] for b in bs), max(b[1] for b in bs), min(b[2] for b in bs), max(b[3] for b in bs)


kit.border_of = border_all
kit.run(build, turn)
