"""sulfur.py : the Inferno Sulfur Swirler in 3D, three tiers, built clean-room from the Flash pictures only
(server/public/assets/buildings/isulpherproducer). Only the generic Inferno kit is used (kit.py: camera, light, render
modes), the same kit as the 3D Bone Cruncher and Coal Extractor.

    blender -b --factory-startup -P sulfur.py -- <tier 1|2|3> <fit|check|still|anim|probe|gap> [frame]

Tier 1 = levels 1-2 (Flash look 1: cracked tank in a green tub, wooden post drive), tier 2 = levels 3-6 (Flash look 2:
bigger plated tank in an iron strap cradle with a hanging chain, sprocket drive, fat pipe), tier 3 = levels 7-10 (tier 2
plus: lit firebox, big spikes on the band, a side boiler, a big gear under the chain wheel, a larger gold-rimmed
funnel, gold trim, sulfur crystals on the rock, hotter seams). One model: a tank (radius RT, centre
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
from mathutils import Matrix, Vector, noise

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
    """The tank's shell: puffed, blotchy maroon plates with yellow sulfur cracks between them (a Voronoi's cell edges).
    The cracks' width wanders (a noise divides the distance to the edge), every plate has its own tone, and big soft
    blotches of paler and darker maroon lie over them. Tier 1: thin cracks in a dull purple-brown shell."""
    if "tank" in MATS:
        return MATS["tank"]
    t = kit.NT("tank")
    v = t.coords()
    wob = t.mix(v, t.noise(v, 1.6, 2.0, 0.5), 0.10 if T == 1 else 0.06)
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    cell = t.n("ShaderNodeTexVoronoi", feature="F1")
    for nd in (vo, cell):
        nd.inputs["Scale"].default_value = 0.86 if T == 1 else 0.82
        nd.inputs["Randomness"].default_value = 1.0 if T == 1 else 0.8
        t.link(wob, nd.inputs["Vector"])
    # the crack's width: thin for most of its run, swelling in places (Flash: irregular, pooled at some corners)
    wide = t.ramp(t.noise(v, 1.9, 3.0, 0.6, 0.8), [(0.3, grey(0.3)), (0.5, grey(0.62)), (0.72, K1)])
    dv = t.n("ShaderNodeMath", operation="DIVIDE")
    t.link(vo.outputs["Distance"], dv.inputs[0])
    t.link(wide, dv.inputs[1])
    d = dv.outputs[0]
    w = 0.026 if T == 1 else 0.07
    if T == 1:
        base, pale, dark = (92, 52, 60), (134, 100, 100), (50, 28, 36)
    else:
        base, pale, dark = (122, 48, 40), (176, 100, 84), (66, 24, 24)
    col = t.mix(kit.srgb(*base), kit.srgb(*pale), t.ramp(t.noise(v, 1.3, 4.0, 0.65, 0.8), [(0.4, K0), (0.66, grey(0.9))]))
    col = t.mix(col, kit.srgb(*dark), t.ramp(t.noise(v, 2.3, 5.0, 0.7, 1.4), [(0.47, K0), (0.68, grey(0.85))]))
    sepc = t.n("ShaderNodeSeparateColor")                    # each plate its own tone
    t.link(cell.outputs["Color"], sepc.inputs[0])
    col = t.mix(col, t.ramp(sepc.outputs[0], [(0.0, grey(0.66)), (1.0, K1)]), 1.0, "MULTIPLY")
    col = t.mix(col, t.ramp(t.noise(v, 9.0, 4.0, 0.7, 0.5), [(0.3, grey(0.72)), (0.65, K1)]), 1.0, "MULTIPLY")     # stains
    col = t.mix(col, t.ramp(t.noise(v, 40, 2.0, 0.5), [(0.3, grey(0.84)), (0.62, K1)]), 1.0, "MULTIPLY")
    col = t.mix(col, t.ramp(d, [(w, grey(0.42)), (w * 4.5, K1)]), 1.0, "MULTIPLY")      # plates darken toward the crack
    col = t.grime(col, 0.0, 2.6, 0.3, 0.5)
    seam = t.ramp(d, [(w * 0.7, K1), (w, K0)])
    hot = {1: (190, 172, 34), 2: (214, 194, 26), 3: (255, 214, 30)}[T]
    core = {1: (214, 200, 60), 2: (236, 220, 52), 3: (255, 246, 170)}[T]
    scol = t.mix(kit.srgb(*hot), kit.srgb(*core), t.ramp(d, [(0.0, K1), (w * 0.6, K0)]))
    out = t.mix(col, scol, seam)
    t.set(**{"Base Color": out, "rough": 0.66, "spec": 0.3})
    t.link(scol, t.bsdf.inputs["Emission Color"])
    es = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(seam, es.inputs[0])
    es.inputs[1].default_value = {1: 0.22, 2: 0.3, 3: 1.5}[T]
    t.link(es.outputs[0], t.bsdf.inputs["Emission Strength"])
    # puffed plates: each rises like a cushion from its cracks, with a lumpy skin
    h = t.ramp(d, [(w * 0.5, K0), (w * 2.5, grey(0.6)), (w * (5.0 if T == 1 else 7.0), K1)])
    h = t.mix(h, t.noise(v, 6.0, 3.0, 0.6), 0.16)
    t.bump(h, 0.6 if T == 1 else 1.0, 0.09)
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


def m_lattice():
    """The cradle's black iron: its edges worn to bright silver (where a bevelled normal leaves the face's own), a
    few rubbed patches on the faces."""
    if "lattice" in MATS:
        return MATS["lattice"]
    t = kit.NT("lattice")
    v = t.coords()
    col = t.mix(kit.srgb(13, 14, 16), kit.srgb(44, 47, 54), t.ramp(t.noise(v, 3.0, 3.0, 0.6, 0.4), [(0.5, K0), (0.75, grey(0.6))]))
    bv = t.n("ShaderNodeBevel", samples=6)
    bv.inputs["Radius"].default_value = 0.035
    geo = t.n("ShaderNodeNewGeometry")
    dot = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(bv.outputs[0], dot.inputs[0])
    t.link(geo.outputs["Normal"], dot.inputs[1])
    edge = t.ramp(dot.outputs["Value"], [(0.8, K1), (0.975, K0)])
    brk = t.ramp(t.noise(v, 7.0, 3.0, 0.6), [(0.3, grey(0.35)), (0.6, K1)])
    em = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(edge, em.inputs[0])
    t.link(brk, em.inputs[1])
    col = t.mix(col, kit.srgb(228, 234, 246), em.outputs[0])
    col = t.grime(col, 0.0, 2.6, 0.25, 0.55)
    t.set(**{"Base Color": col, "rough": 0.5, "metal": 0.25, "spec": 0.4})
    t.bump(t.noise(v, 22, 3.0, 0.6), 0.06, 0.01)
    MATS["lattice"] = t.m
    return t.m


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
    """The brown rock: tan on its ridges, dark in its crevices (the mesh's `crev` colour: 0 on a rib's crest, 1 in
    the furrow between two), grain running down it, gritty."""
    if "rock" in MATS:
        return MATS["rock"]
    t = kit.NT("rock")
    v = t.coords()
    at = t.n("ShaderNodeAttribute", attribute_name="crev")
    sp = t.n("ShaderNodeSeparateColor")
    t.link(at.outputs["Color"], sp.inputs[0])
    cr = sp.outputs[0]
    col = t.ramp(cr, [(0.0, kit.srgb(200, 162, 108)), (0.13, kit.srgb(124, 90, 58)), (0.5, kit.srgb(66, 46, 30)), (1.0, kit.srgb(20, 13, 9))])
    col = t.mix(col, kit.srgb(70, 46, 28), t.ramp(t.noise(v, 2.2, 4.0, 0.65, 0.8), [(0.45, K0), (0.7, grey(0.6))]))
    col = t.mix(col, kit.srgb(176, 132, 78), t.ramp(t.noise(v, 3.4, 4.0, 0.65, 0.4), [(0.55, K0), (0.75, grey(0.5))]))
    v2 = t.coords(scale=(1.0, 1.0, 0.15))
    col = t.mix(col, t.ramp(t.noise(v2, 9.0, 4.0, 0.65, 0.4), [(0.3, grey(0.6)), (0.65, K1)]), 1.0, "MULTIPLY")     # grain
    col = t.mix(col, t.ramp(t.noise(v, 44, 2.0, 0.5), [(0.3, grey(0.8)), (0.62, K1)]), 1.0, "MULTIPLY")
    col = t.grime(col, 0.0, 2.2, 0.4, 0.4)
    t.set(**{"Base Color": col, "rough": 0.92, "spec": 0.2})
    t.bump(t.mix(t.noise(v2, 9.0, 4.0, 0.65, 0.4), t.noise(v, 14, 4.0, 0.65), 0.5), 0.5, 0.03)
    MATS["rock"] = t.m
    return t.m


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


STRAPS = [5 + 30 * i for i in range(8)]                     # the cradle's straps (bearings): the front, right and back;
#                                                             the front left is open (the pipe and the rock are there)
CHAIN_PHI = 50                                              # the hanging chain, in the gap between two straps
BOILER_PHI = 100                                            # tier 3's side boiler


def strap_pts(phi, ro, zr):
    d = D(phi)
    return [d * (ro - 0.02) + UP * (zr - 0.2), d * (ro + 0.03) + UP * 2.0, d * (ro + 0.06) + UP * 1.0, d * (ro + 0.1) + UP * 0.1]


def along(pts, u):
    """The point a fraction u down a strap's line."""
    ls = [(b - a).length for a, b in zip(pts, pts[1:])]
    x = u * sum(ls)
    for (a, b), ln in zip(zip(pts, pts[1:]), ls):
        if x <= ln:
            return a.lerp(b, x / ln)
        x -= ln
    return pts[-1].copy()


def arc_lathe(name, prof, a0, a1, mat_, n=72, bevel=0.0):
    """A closed (r, z) profile swept round the axis from bearing a0 to a1 only, capped at both ends."""
    bm = bmesh.new()
    rows = [[bm.verts.new(D(a0 + (a1 - a0) * i / n) * r + UP * z) for r, z in prof] for i in range(n + 1)]
    m = len(prof)
    for a, b in zip(rows, rows[1:]):
        for j in range(m):
            k = (j + 1) % m
            bm.faces.new((a[j], a[k], b[k], b[j]))
    bm.faces.new(rows[0])
    bm.faces.new(rows[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [mat_], bevel=bevel)


RAIL = (0, 224)         # the band's arc: from the front (its end under the first strap) round the right to behind the tank


def cradle():
    """Tier 2 up: the iron cradle the tank sits in (where tier 1 has its tub): a firebox drum under the tank, a band
    round the tank's middle, and under the band, round the front, right and back, a tight basket of pierced iron
    straps that drop almost straight to the ground, a dark fire wall behind them, two hoops and crossed braces between
    them, a heavy chain hanging from the band on the right. All black iron with its edges worn bright. Tier 3 lights
    the firebox and adds spikes to the band."""
    zr = 3.3
    rin = math.sqrt(RT * RT - (zr + 0.3 - CZ) ** 2) - 0.03
    ro = RT + 0.15
    lat = m_lattice()
    arc_lathe("rail", [(rin, zr - 0.3), (ro - 0.04, zr - 0.3), (ro, zr - 0.26), (ro, zr + 0.26), (ro - 0.04, zr + 0.3), (rin, zr + 0.3)],
              RAIL[0], RAIL[1], lat, bevel=0.02)
    ra = [RAIL[0] + (RAIL[1] - RAIL[0]) * i / 72 for i in range(73)]
    kit.tube("railrim", [D(a) * (ro + 0.01) + UP * (zr + 0.27) for a in ra], 0.05, m_steel())
    kit.tube("railrim2", [D(a) * (ro + 0.01) + UP * (zr - 0.27) for a in ra], 0.04, m_steel())
    kit.lathe("firebox", [(0.0, 0.0), (2.1, 0.0), (2.16, 0.08), (2.16, 0.95), (2.0, 1.1), (1.6, 1.22), (0.0, 1.22)], (0, 0, 0), m_iron(), verts=48, bevel=0.02)
    kit.ring("fireboxrim", 2.17, 0.05, m_steel(), z=0.95)
    lines = {}
    for phi in STRAPS:
        d, sd = D(phi), D(phi + 90)
        pts = strap_pts(phi, ro, zr)
        lines[phi] = pts
        hw = 0.3
        for j, sg in enumerate((-1, 1)):
            kit.sweep("leg%d-r%d" % (phi, j), [q + sd * sg * hw for q in pts], d, 0.14, 0.17, lat, bevel=0.025)
        for j in range(8):                                   # the rungs: a pierced strap
            q = along(pts, (j + 0.45) / 8.0)
            kit.sweep("leg%d-x%d" % (phi, j), [q - sd * hw, q + sd * hw], d, 0.12, 0.15, lat, bevel=0.02)
        foot = pts[-1] - UP * 0.1
        fb = kit.box("leg%d-foot" % phi, (0.8, 0.36, 0.14), foot + d * 0.05, m_trim() if T == 3 else lat, bevel=0.04)
        aim(fb, foot + d * 0.05, UP, sd)
    arc = [STRAPS[0] - 5 + (STRAPS[-1] - STRAPS[0] + 10) * i / 72 for i in range(73)]
    for z, r in ((2.0, ro + 0.03), (1.0, ro + 0.06)):        # two hoops through the straps
        kit.tube("hoop%d" % int(z * 10), [D(a) * r + UP * z for a in arc], 0.075, lat)
    bm = bmesh.new()                                         # the fire wall behind the straps: the basket reads dark
    rw = ro - 0.14
    rows = [(bm.verts.new(D(a) * rw), bm.verts.new(D(a) * rw + UP * (zr - 0.28))) for a in arc]
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, b0, b1, a1))
    kit.mesh_ob("firewall", bm, [mat("wall", (14, 11, 11), rough=0.8, wear=(44, 22, 18), wear_amt=0.5, dirt=0.5, scale=4.0)])
    for a, b in zip(STRAPS, STRAPS[1:]):                     # crossed braces in every gap
        pa, pb = lines[a], lines[b]
        out = D(a + 15)
        sa, sb = D(a + 90) * 0.3, D(b + 90) * 0.3
        for k, (u0, u1) in enumerate(((0.06, 0.5), (0.5, 0.06), (0.52, 0.96), (0.96, 0.52))):
            off = out * (0.02 - 0.07 * (k % 2))
            kit.sweep("brace%d-%d" % (a, k), [along(pa, u0) + sa + off, along(pb, u1) - sb + off], out, 0.05, 0.11, lat, bevel=0.015)
    hang_chain(ro, zr)
    if T == 3:
        for phi in (20, 78, 125, 155, 185, 215):    # big spikes on the band
            e = D(phi)
            sp = kit.cyl("spike%d" % phi, 0.25, 1.35, (0, 0, 0), m_steel(), verts=8, r2=0.0, bevel=0.0)
            aim(sp, e * (ro - 0.06) + UP * zr, e * 0.9 + UP * 0.4)
            sp.name = "spike%d" % (phi + 100)
            kit.ring("spikering%d" % phi, 0.27, 0.05, m_trim(), parent=sp, z=0.1, n=16)
        fire = kit.lava("fire", strength=6.0, scale=2.4)
        for i in range(10):             # glowing fire holes round the firebox
            e = D(8 + 36 * i)
            b = kit.box("vent%d" % i, (0.62, 0.08, 0.5), (0, 0, 0), fire, bevel=0.03, origin="centre")
            aim(b, e * 2.15 + UP * 0.5, UP, D(8 + 36 * i + 90))
        for i, phi in enumerate(STRAPS[:-1]):     # and in the fire wall, one in every gap of the basket
            b = kit.box("wvent%d" % i, (0.5, 0.06, 0.62), (0, 0, 0), fire, bevel=0.03, origin="centre")
            aim(b, D(phi + 15) * (ro - 0.13) + UP * 1.5, UP, D(phi + 105))
        for i in range(3):
            ld = bpy.data.lights.new("fireglow%d" % i, "POINT")
            ld.energy = 60
            ld.color = (1.0, 0.5, 0.12)
            ld.shadow_soft_size = 0.5
            lo = bpy.data.objects.new("fireglow%d" % i, ld)
            kit.link(lo)
            lo.location = D(-20 + 70 * i) * 2.9 + UP * 0.6
        boiler(ro, zr)


def hang_chain(ro, zr):
    """The heavy chain that hangs from the band on the right down to a stake in the ground (Flash look 2). It does not
    move."""
    d, sd = D(CHAIN_PHI), D(CHAIN_PHI + 90)
    top = d * (ro + 0.2) + UP * (zr - 0.3)
    bot = d * (ro + 0.66) + UP * 0.3
    mid = (top + bot) / 2 + d * 0.28
    ml = mat("hlink", (196, 200, 212), rough=0.4, metal=0.2, wear=(236, 240, 250), wear_amt=0.8, dirt=0.2, scale=9.0, mottle=0.35)
    kit.tube("hangeye", [d * (ro - 0.05) + UP * (zr - 0.06), d * (ro + 0.22) + UP * (zr - 0.06), top + UP * 0.12], 0.08, m_lattice())
    n, hl, hw, wire = 8, 0.33, 0.2, 0.08
    for i in range(n):
        u = (i + 0.5) / n
        c = top * (1 - u) ** 2 + mid * 2 * u * (1 - u) + bot * u * u
        tg = ((mid - top) * (1 - u) + (bot - mid) * u).normalized()
        side = sd if i % 2 == 0 else tg.cross(sd).normalized()
        pts = []
        for k in range(16):
            a = 2 * math.pi * k / 16
            cs, sn = math.cos(a), math.sin(a)
            pts.append(c + tg * hl * math.copysign(abs(sn) ** 0.7, sn) + side * hw * math.copysign(abs(cs) ** 0.7, cs))
        kit.tube("hang%d" % i, pts, wire, ml, cyclic=True, verts=8)
    base = d * (ro + 0.66)
    kit.cyl("hangstake", 0.16, 0.34, (base.x, base.y, 0.0), m_lattice(), verts=10, bevel=0.03)
    fb = kit.box("hangfoot", (0.62, 0.5, 0.1), base, m_lattice(), bevel=0.03)
    aim(fb, base, UP, sd)


def boiler(ro, zr):
    """Tier 3: a small side boiler on a shelf on the band's right, piped into the tank, with a valve on top."""
    d, sd = D(BOILER_PHI), D(BOILER_PHI + 90)
    c = d * (RT + 0.8)
    z0 = zr + 0.36
    sh = kit.box("boilershelf", (1.4, 1.0, 0.12), (0, 0, 0), m_lattice(), bevel=0.03, origin="centre")
    aim(sh, d * (ro + 0.42) + UP * (zr + 0.3), UP, d)
    for sg in (-1, 1):
        kit.sweep("boilerstrut%d" % (sg + 1), [d * (ro + 0.02) + sd * sg * 0.36 + UP * (zr - 0.5), c + d * 0.4 + sd * sg * 0.36 + UP * (zr + 0.26)],
                  sd, 0.1, 0.12, m_lattice(), bevel=0.02)
    mb = mat("boiler", (104, 40, 34), rough=0.55, metal=0.3, wear=(160, 84, 66), wear_amt=0.6, rust=(54, 20, 20), rust_at=0.52, dirt=0.3,
             scale=3.0, streak=(44, 18, 16), bump=0.2)
    kit.lathe("boilerbody", [(0.0, 0.0), (0.46, 0.0), (0.57, 0.06), (0.62, 0.22), (0.62, 1.12), (0.55, 1.36), (0.37, 1.52), (0.16, 1.58), (0.0, 1.58)],
              (c.x, c.y, z0), mb, verts=32)
    for z, r in ((0.2, 0.63), (1.14, 0.63)):
        kit.ring("boilerband%d" % int(z * 10), r, 0.055, m_trim(), z=z0 + z, n=32).location = (c.x, c.y, 0)
    for i in range(10):
        a = 2 * math.pi * i / 10
        kit.blob("boilerrivet%d" % i, (c.x + 0.63 * math.cos(a), c.y + 0.63 * math.sin(a), z0 + 0.66), 0.05, 0.9, m_trim())
    # the fire door, toward the viewer
    e = D(40)
    door = kit.cyl("boilerdoor", 0.26, 0.08, (0, 0, 0), m_lattice(), verts=20, bevel=0.02)
    aim(door, c + e * 0.6 + UP * (z0 + 0.66), e)
    eye = kit.cyl("boilerglow", 0.16, 0.03, (0, 0, 0), kit.lava("fire2", strength=5.0, scale=5.0), verts=16, bevel=0.0)
    aim(eye, c + e * 0.68 + UP * (z0 + 0.66), e)
    # the valve on top: a short neck, a gold cap, a red handwheel
    kit.cyl("boilerneck", 0.15, 0.5, (c.x, c.y, z0 + 1.5), m_lattice(), verts=14)
    kit.lathe("boilercap", [(0.0, 0.0), (0.26, 0.0), (0.3, 0.08), (0.22, 0.2), (0.0, 0.26)], (c.x, c.y, z0 + 1.98), m_trim(), verts=20)
    # the gold feed pipe into the tank's side
    into = S(BOILER_PHI, 24, RT - 0.1)
    kit.tube("boilerfeed", [c + UP * (z0 + 1.3) - d * 0.5, c + UP * (z0 + 1.62) - d * 0.75, into + (into - C).normalized() * 0.3, into], 0.15, m_gold(), smooth=True)
    hd = kit.lathe("boilerhood", [(0.14, -0.05), (0.27, -0.03), (0.27, 0.1), (0.18, 0.16)], (0, 0, 0), m_red(), verts=20)
    aim(hd, S(BOILER_PHI, 24, RT - 0.03), (into - C).normalized())


def window():
    """The window on the tank's front: a green frame bent on the shell, the molten sulfur behind it (moving)."""
    phi, el = (3.0, 31.0) if T == 1 else (0.0, 41.0)
    e = math.radians(el)
    n = D(phi) * math.cos(e) + UP * math.sin(e)
    tx, ty = D(phi + 90), -D(phi) * math.sin(e) + UP * math.cos(e)
    if T == 1:
        wb, wt, h, fw, th = 0.6, 0.4, 0.3, 0.1, 0.13
    else:
        wb, wt, h, fw, th = 0.66, 0.72, 0.26, 0.125, 0.17

    ex = 0.2 if T == 1 else 0.45         # tier 1: Flash's trapezoid, wider at the bottom, its corners barely rounded

    def loop(grow, m=64):
        out = []
        for i in range(m):
            a = 2 * math.pi * i / m
            cs, sn = math.cos(a), math.sin(a)
            v = math.copysign(abs(sn) ** ex, sn)
            w = (wb + (wt - wb) * (v + 1) / 2) + grow
            out.append((w * math.copysign(abs(cs) ** ex, cs), (h + grow) * v))
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


PIPE_PHI = -78          # tier 1: where the pipe enters the shell


def pipe():
    """The gold intake pipe: from the ground at the front left up into the tank's left side, in ringed segments. One
    mesh (moving): a lump travels up it."""
    if T == 1:
        ctrl = [S(PIPE_PHI, -16, RT - 0.35), S(PIPE_PHI, -16, RT + 0.3), P(-3.12, 1.2, 2.5), P(-3.04, 1.62, 1.3), P(-2.84, 1.9, -0.1)]
        rad, segs = 0.47, 4
    else:
        ctrl = [S(-50, -5, RT - 0.4), S(-50, -5, RT + 0.42), P(-2.3, 3.05, 3.0), P(-1.5, 3.62, 1.5), P(-0.56, 3.82, -0.1)]
        rad, segs = 0.66, 5
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
    aim(hood, S(PIPE_PHI if T == 1 else -50, -16 if T == 1 else -5, RT - 0.04), d0)
    if BIG:
        ft = ctrl[-1]
        # the collar closes onto the pipe (its lip is inside the pipe's skin): no dark slot between the two
        co = kit.lathe("collar", [(rad * 0.8, 0.0), (rad * 1.2, 0.0), (rad * 1.27, 0.1), (rad * 1.25, 0.34), (rad * 1.14, 0.46), (rad * 0.6, 0.5)],
                       (0, 0, 0), m_red(), verts=32)
        up = (cen[-4] - cen[-1]).normalized()
        aim(co, cen[-1] - up * 0.05, up)
    return cen, rad


def crystal(name, at, h, r, lean=(0, 0, 0)):
    """A faceted sulfur crystal standing on `at`."""
    bm = bmesh.new()
    sides, rings = 6, 3
    rows = []
    off = rnd.uniform(0, 6.28)
    for i in range(rings + 1):
        u = i / rings
        rr = r * (1.0 if u < 0.7 else (1 - u) / 0.3) * (0.8 + 0.2 * u / 0.7 if u < 0.7 else 1.0)
        c = Vector(at) + UP * (h * u) + Vector(lean) * (u * u)
        if i == rings:
            rows.append([bm.verts.new(c)])
            continue
        rows.append([bm.verts.new(c + Vector((math.cos(off + 2 * math.pi * j / sides), math.sin(off + 2 * math.pi * j / sides), 0)) * rr)
                     for j in range(sides)])
    for a, b in zip(rows, rows[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            if len(b) == 1:
                bm.faces.new((a[j], a[k], b[0]))
            else:
                bm.faces.new((a[j], a[k], b[k], b[j]))
    bm.faces.new(rows[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [m_crystal()], smooth=False, bevel=0.015, segs=2)


def rock_mass(fans, cen, rad):
    """The rock as ONE mesh: a height over the ground, the highest of several `fans`. A fan is a crag that stands
    against the building at bearing phi, r from the axis, H tall, and runs out R over the ground; sharp ribs run down
    it from its top like roots (a furrow between each two), every rib its own height, their lines wandering. The rock
    is cut back round and under the pipe (centre line cen, radius rad), so the pipe comes out of it.
    Returns height(x, y)."""
    rr = random.Random(7 + T // 2)
    spec = []
    for phi, r, H, R, nrib in fans:
        d = D(phi)
        spec.append((d.x * r, d.y * r, H, R, math.atan2(d.y, d.x), nrib, rr.uniform(0, 1), rr.uniform(0, 50)))
    low = [c for c in cen if c.z < 3.4]

    def height(x, y):
        best, crev = 0.0, 0.0
        for ax, ay, H, R, th0, nrib, ph, seed in spec:
            vx, vy = x - ax, y - ay
            rho = math.hypot(vx, vy)
            th = math.atan2(vy, vx)
            dth = (th - th0 + math.pi) % (2 * math.pi) - math.pi
            reach = R * (0.3 + 0.7 * max(0.0, math.cos(dth)) ** 0.6)
            u = rho / reach
            if u >= 1.0:
                continue
            t = dth * nrib / (2 * math.pi) + ph + 0.75 * noise.noise(Vector((rho * 1.0, seed, dth * 0.7)))
            k = round(t)
            tri = abs(t - k) * 2.0
            hk = 0.58 + 0.42 * (math.sin(k * 12.9898 + seed) * 43758.5453 % 1.0)
            hk = 1.0 + (hk - 1.0) * min(1.0, u * 2.5)
            u = max(0.0, u - 0.12) / 0.88
            depth = min(1.0, 0.35 + 0.9 * u)
            h = H * hk * (1 - u ** 1.5) ** 0.9 * (1 - 0.55 * depth * tri ** 0.7)
            if h > best:
                best, crev = h, tri * (0.45 + 0.55 * depth)
        if best <= 0.0:
            return 0.0, 0.0
        best *= 1.0 + 0.26 * noise.noise(Vector((x * 2.0, y * 2.0, 3.1)))
        best += 0.05 * noise.noise(Vector((x * 9.0, y * 9.0, 1.7)))
        for c in low:                                   # the pipe's tunnel
            lim = c.z - rad + 6.0 * max(0.0, math.hypot(x - c.x, y - c.y) - rad * 0.7)
            if lim < best:
                best, crev = lim, max(crev, 0.75)
        return best, crev

    st = 0.045
    xs = [a[0] for a in spec]
    ys = [a[1] for a in spec]
    R = max(a[3] for a in spec) + 0.2
    x0, y0 = min(xs) - R, min(ys) - R
    nx, ny = int((max(xs) + R - x0) / st) + 1, int((max(ys) + R - y0) / st) + 1
    grid = [[height(x0 + i * st, y0 + j * st) for j in range(ny)] for i in range(nx)]
    bm = bmesh.new()
    vert, cv = {}, []

    def vtx(i, j):
        if (i, j) not in vert:
            h, c = grid[i][j]
            x, y = x0 + i * st, y0 + j * st
            z = max(h, -0.04)
            # a little overhang: the rock's skin shifts sideways with height
            x += 0.05 * z * noise.noise(Vector((x * 1.7, y * 1.7, 7.0)))
            y += 0.05 * z * noise.noise(Vector((x * 1.7, y * 1.7, 9.0)))
            vert[(i, j)] = bm.verts.new((x, y, z))
            cv.append(c if h > 0 else 0.9)
        return vert[(i, j)]
    for i in range(nx - 1):
        for j in range(ny - 1):
            if max(grid[i][j][0], grid[i + 1][j][0], grid[i + 1][j + 1][0], grid[i][j + 1][0]) > 0.02 \
                    and math.hypot(x0 + i * st, y0 + j * st) > 1.9:
                bm.faces.new((vtx(i, j), vtx(i + 1, j), vtx(i + 1, j + 1), vtx(i, j + 1)))
    bm.verts.index_update()
    order = sorted(vert.values(), key=lambda v: v.index)
    assert [v.index for v in order] == list(range(len(cv)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob("rockmass", bm, [m_rock()], smooth=True)
    attr = ob.data.color_attributes.new("crev", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(cv):
        attr.data[i].color = (c, c, c, 1.0)
    return lambda x, y: height(x, y)[0]


def stone(name, at, r):
    """A loose stone: a lumpy faceted ball half sunk in the ground."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    sd = rnd.uniform(0, 40)
    for v in bm.verts:
        k = 1.0 + 0.35 * noise.noise(Vector((v.co.x * 2.2 / r * 0.5, v.co.y * 2.2 / r * 0.5, v.co.z * 2.2 / r * 0.5 + sd)))
        v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * 0.72))
    ob = kit.mesh_ob(name, bm, [m_rock()], smooth=False, bevel=0.012, segs=2)
    ob.location = (at.x, at.y, r * 0.22)
    ob.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
    return ob


def rocks(cen, rad):
    """The brown rock the pipe comes out of: one tall ridged crag that leans on the building's front left and wraps the
    pipe's foot (Flash's footprint), a few loose stones round it. Tier 3 grows sulfur crystals on it."""
    if T == 1:
        fans = [(-66, 2.9, 3.5, 0.95, 11), (-50, 2.7, 3.9, 1.7, 13), (-34, 2.7, 3.6, 1.9, 13), (-19, 2.65, 2.9, 1.8, 12),
                (-5, 2.6, 2.0, 1.3, 10), (6, 2.5, 1.1, 0.9, 8), (-48, 3.8, 0.8, 0.7, 8)]
        loose = [(-56, 4.0, 0.2), (-12, 4.25, 0.17), (4, 3.6, 0.2), (-36, 4.95, 0.15), (-24, 4.85, 0.12)]
    else:
        fans = [(-52, 2.9, 2.4, 0.75, 9), (-42, 2.95, 2.9, 1.25, 13), (-26, 2.95, 2.7, 1.4, 12),
                (-10, 3.0, 2.0, 1.2, 11), (-30, 4.0, 0.8, 0.8, 8)]
        loose = [(-50, 3.75, 0.2), (-40, 4.35, 0.17), (-30, 4.95, 0.13), (8, 4.6, 0.16), (-22, 4.8, 0.12)]
    hf = rock_mass(fans, cen, rad)
    if os.environ.get("PB_DEBUG"):
        for phi, r, H, R, nrib in fans:
            print("PROBE fan", phi, r, H, [round(hf(*(D(phi) * (r + k)).xy), 2) for k in (-0.2, 0.0, 0.1, 0.2, 0.4, 0.8)])
    for i, (phi, dist, r) in enumerate(loose):
        stone("rock-s%d" % i, D(phi) * dist, r)
    if T == 3:                          # sulfur crystals grown in clumps on the rock
        for i, (phi, dist, h) in enumerate([(-58, 3.3, 1.0), (-54, 3.5, 0.7), (-62, 3.45, 0.6), (-66, 3.2, 0.8), (-48, 3.55, 0.55),
                                            (-40, 4.45, 0.7), (-36, 4.6, 0.45), (-44, 4.6, 0.4)]):
            at = D(phi) * dist
            crystal("crystal%d" % i, at + UP * (max(0.0, hf(at.x, at.y)) - 0.12), h, 0.17, lean=D(phi + rnd.uniform(-60, 60)) * 0.3)


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
    # tier 2 up: a short stubby trumpet with a wide mouth on the back of the right shoulder, leaning to the right
    a = S(phi, 42, RT - 0.1)
    nrm = (a - C).normalized()
    axis = (UP * 1.0 + SR * 0.16).normalized()
    s = scale
    base = a + nrm * 0.2 * s + UP * 0.62 * s
    kit.tube("fstem" + tag, [a, a + nrm * 0.3 * s + UP * 0.2 * s, base - axis * 0.1, base + axis * 0.15], 0.25 * s, m_funnel(), smooth=True)
    cup = kit.lathe("fcup" + tag, [(0.0, 0.0), (0.25 * s, 0.0), (0.3 * s, 0.4 * s), (0.4 * s, 0.82 * s), (0.54 * s, 1.14 * s), (0.69 * s, 1.3 * s),
                                   (0.73 * s, 1.4 * s), (0.71 * s, 1.5 * s), (0.6 * s, 1.5 * s), (0.5 * s, 1.26 * s), (0.3 * s, 0.86 * s), (0.0, 0.66 * s)],
                    (0, 0, 0), m_funnel(), verts=32, bevel=0.015)
    aim(cup, base, axis)
    if T == 3:
        kit.ring("frim" + tag, 0.69 * s, 0.085 * s, m_trim(), parent=cup, z=1.47 * s)
        kit.ring("fband" + tag, 0.3 * s, 0.05 * s, m_trim(), parent=cup, z=0.58 * s)
    for i in range(8):
        ang = 2 * math.pi * i / 8
        kit.blob("frivet%s%d" % (tag, i), (0.6 * s * math.cos(ang), 0.6 * s * math.sin(ang), 1.2 * s), 0.06 * s, 0.8,
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
        if T == 3:              # a big iron gear under the chain wheel, turning with the shaft (25 teeth: 10 a loop)
            kit.gear("shaft-biggear", 1.26, 25, 0.2, (0, 0, zc - 0.5), m_iron(), (0, 0, 0), tooth=0.13, parent=hub)
            kit.ring("shaft-gearrim", 0.98, 0.06, m_trim(), parent=hub, z=zc - 0.38, n=40)
            kit.cyl("shaft-gearhub", 0.42, 0.3, (0, 0, zc - 0.62), m_trim(), verts=20, parent=hub)
            for i in range(5):
                a = 2 * math.pi * i / 5
                kit.cyl("shaft-gearhole%d" % i, 0.15, 0.02, (0.7 * math.cos(a), 0.7 * math.sin(a), zc - 0.4), m_red(), verts=10, bevel=0.0, parent=hub)
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
    cen, rad = pipe()
    build.cen = cen
    rocks(cen, rad)
    funnel(84 if T == 1 else 112, 1.22 if T == 3 else 1.0)
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


# ------------------------------------------------------------------------------------------------------------- damaged
# One rough pass (owner: this only roughly follows Flash): PB_STATE=damaged with mode `base`.
#   PB_STATE=damaged PB_K=6 sh run.sh <tier> base   ->  render/L<tier>-damaged-base.png, -alone.png
# Destroyed is Flash's rubble, as for every other 3D building: there is no 3D destroyed look.
# Nothing here runs without PB_STATE: the whole model and its renders are as they were.
STATE = kit.STATE


def scorch(amount, cut=0.5, fires=0.3):
    """Soot over every paint: patches of near black, `amount` of the colour left under them; the glows gutter."""
    for m in list(bpy.data.materials):
        nt = m.node_tree
        if nt is None:
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        es = bsdf.inputs["Emission Strength"]
        if es.is_linked:
            src = es.links[0].from_socket
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            mul.inputs[1].default_value = fires
            nt.links.new(src, mul.inputs[0])
            nt.links.new(mul.outputs[0], es)
        elif es.default_value > 0:
            es.default_value *= fires
        inp = bsdf.inputs["Base Color"]
        if inp.is_linked:
            src = inp.links[0].from_socket
        else:
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = inp.default_value
            src = rgb.outputs[0]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.6
        nz.inputs["Detail"].default_value = 5.0
        nz.inputs["Roughness"].default_value = 0.65
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = cut - 0.1, grey(amount)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = cut + 0.12, grey(0.85)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        nt.links.new(nz.outputs[0], ramp.inputs[0])
        nt.links.new(src, mix.inputs[6])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], inp)


def about(pivot, axis, deg):
    return Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-Vector(pivot))


def away(pivot, axis, deg, probe):
    """`about`, turned the way that takes `probe` farther from the tank's axis."""
    a, b = about(pivot, axis, deg), about(pivot, axis, -deg)
    return a if (a @ Vector(probe)).xy.length >= (b @ Vector(probe)).xy.length else b


def knock(names, M):
    """Move the named objects (and what hangs on them) by M: they are hung on a new empty, so that `turn` (which sets
    the hubs' own turning) leaves the knock alone."""
    e = bpy.data.objects.new("knock-" + names[0], None)
    kit.link(e)
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None and o.parent is None:
            o.parent = e
    e.matrix_world = M


def on_tank(name, phi, el, a, b, m, lift=0.03, thick=0.05, jag=0.35, seed=0.0):
    """A ragged flat patch lying on the tank's shell at bearing phi, `el` degrees above its middle: a x b units."""
    c = S(phi, el)
    n = (c - C).normalized()
    tx = D(phi + 90)
    ty = n.cross(tx)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1.0 + jag * noise.noise(Vector((v.co.x * 1.7 + seed, v.co.y * 1.7, seed * 0.37)))
        p = c + tx * (v.co.x * a * k) + ty * (v.co.y * b * k)
        v.co = C + (p - C).normalized() * (RT + lift + v.co.z * thick)
    return kit.mesh_ob(name, bm, [m], smooth=False)


def wreck(leak):
    """What the damage adds: holes broken in the shell with their plates bent out and sulfur running from them, a
    cracked window, plates, stones and sulfur at the feet. `leak` False: all but the sulfur (made after the soot)."""
    rr = random.Random(12)
    # (bearing, elevation, half width, half height) of the holes in the shell
    holes = [(68, 20, 0.7, 0.6), (-42, 2, 0.55, 0.62), (50, 64, 0.6, 0.48)] if T == 1 else \
            [(70, 27, 0.78, 0.62), (-36, 60, 0.6, 0.5), (54, 70, 0.62, 0.5)]
    if not leak:
        soot = mat("hole", (10, 8, 8), rough=0.95, dirt=0.0, mottle=0.0, speck=0.0, bump=0.0)
        plate = mat("plate", (96, 66, 70) if T == 1 else (118, 52, 42), rough=0.7, wear=(150, 96, 70), dirt=0.2, scale=4.0)
        for i, (phi, el, a, b) in enumerate(holes):
            on_tank("hole%d" % i, phi, el, a, b, soot, lift=0.035, seed=3.1 * i)
            c = S(phi, el)
            n = (c - C).normalized()
            tx = D(phi + 90)
            ty = n.cross(tx)
            for j in range(6):                                  # the broken plates round it, bent out
                ang = 2 * math.pi * (j + rr.uniform(-0.2, 0.2)) / 6
                rad_ = tx * math.cos(ang) + ty * math.sin(ang)
                p = c + tx * (math.cos(ang) * a * 1.05) + ty * (math.sin(ang) * b * 1.05)
                p = C + (p - C).normalized() * (RT + 0.12)
                tip = math.radians(rr.uniform(35, 65))
                sh = kit.box("shard%d-%d" % (i, j), (rr.uniform(0.3, 0.46), rr.uniform(0.26, 0.4), 0.05), (0, 0, 0), plate, bevel=0.012, origin="centre")
                sh.matrix_world = frame_at(p, n.cross(rad_), n * math.cos(tip) - rad_ * math.sin(tip))
        # the window: dark cracks and dead corners over the glass
        phi, el = (3.0, 31.0) if T == 1 else (0.0, 41.0)
        for i, (du, dv, a, b) in enumerate([(-9, 3, 0.3, 0.22), (8, -3, 0.34, 0.2), (1, 5, 0.14, 0.26)] if T == 1 else
                                           [(-12, 2, 0.36, 0.24), (10, -2, 0.4, 0.2), (0, 4, 0.16, 0.24)]):
            on_tank("deadpane%d" % i, phi + du, el + dv, a, b, soot, lift=0.07 if T == 1 else 0.075, thick=0.02, jag=0.6, seed=7.7 + i)
        # at the feet: plates off the shell and stones
        for i, (phi, r, sz, tilt) in enumerate([(24, 3.7, (0.8, 0.55), 9), (58, 4.0, (0.6, 0.66), -11), (84, 3.75, (0.7, 0.5), 14),
                                                (104, 4.35, (0.5, 0.45), -7), (40, 4.6, (0.45, 0.4), 6)]):
            d = D(phi)
            nrm = (UP + d * math.tan(math.radians(tilt))).normalized()
            pl = kit.box("fallenplate%d" % i, (sz[0], sz[1], 0.07), (0, 0, 0), plate, bevel=0.015, origin="centre")
            pl.matrix_world = frame_at(d * r + UP * (0.07 + abs(tilt) * 0.006), D(phi + rr.uniform(20, 160)), nrm)
        for i, (phi, r, sz) in enumerate([(14, 4.2, 0.24), (34, 4.2, 0.17), (50, 3.6, 0.21), (70, 4.25, 0.26), (92, 3.95, 0.16),
                                          (112, 3.9, 0.2), (64, 4.8, 0.14), (26, 4.9, 0.15), (80, 4.75, 0.13)]):
            stone("rubble%d" % i, D(phi) * r, sz)
        return
    yel = glow("leak", (236, 204, 22), 0.4)
    for i, (phi, el, a, b) in enumerate(holes):
        on_tank("leak%d" % i, phi, el - 7, a * 0.6, b * 0.5, yel, lift=0.06, thick=0.07, jag=0.5, seed=5.3 * i + 1)
        # it runs down the shell from the hole
        for j, (dphi, n_, r) in enumerate(((-5, 5, 0.13), (6, 3, 0.1))):
            low = -4 if T > 1 else -30
            pts = [S(phi + dphi + 2.5 * math.sin(k * 1.3 + i), max(low, el - 8 - 9 * k), RT + 0.05) for k in range(n_ + 1)]
            kit.tube("drip%d-%d" % (i, j), pts, r, yel, r_end=r * 0.55, smooth=True)
    # where the pipe came out of its hood, and pools at the feet
    for i, (phi, r, sx, sy) in enumerate([(38, 3.75, 0.75, 0.5), (74, 3.95, 0.6, 0.42), (-70 if T == 1 else 96, 3.5 if T == 1 else 4.3, 0.5, 0.36)]):
        kit.blob("pool%d" % i, tuple(D(phi) * r + UP * 0.02), 1.0, 0.05, yel, stretch=(sx, sy)).rotation_euler = (0, 0, math.radians(45 + phi))
    for i in range(9):
        phi, r = rr.uniform(10, 100), rr.uniform(3.4, 4.7)
        s = rr.uniform(0.07, 0.13)
        kit.blob("lump%d" % i, tuple(D(phi) * r + UP * s * 0.4), s, 0.7, yel)


def build_state():
    build()
    if not STATE:
        return
    kit.MOVING.clear()                      # a state is one still: nothing is held back for a strip
    bpy.context.view_layer.update()         # so every object's matrix_world is its real place before it is knocked
    wreck(False)
    scorch(0.3, 0.52, 0.3)
    wreck(True)
    top = CZ + RT
    # the chain drive knocked askew on the tank's top, its pole with it
    knock(["chain", "shaft", "idler", "pole", "polefoot"], about(UP * (top + 1.3), SF, 21) @ about(UP * (top + 1.3), SR, -12))
    # the intake pipe pulled off its hood: it leans away from the tank on its foot
    cen = build.cen
    knock(["pipe", "collar"] if BIG else ["pipe"], away(cen[-1], UP.cross((cen[0] - cen[-1]).normalized()), 27 if T == 1 else 22, cen[0]))
    hd = (cen[1] - cen[0]).normalized()
    hole = kit.cyl("hoodhole", 0.4 if T == 1 else 0.56, 0.04, (0, 0, 0), mat("hole", (10, 8, 8)), verts=20, bevel=0.0)
    aim(hole, cen[0] + hd * (0.62 if T == 1 else 0.7), hd)
    # the funnel bent over
    fphi = 84 if T == 1 else 112
    fa = S(fphi, 31 if T == 1 else 42, RT - 0.1)
    knock(["fstem", "fcup"], away(fa, D(fphi + 90), 24, fa + UP * 1.5))
    # the window's frame knocked crooked
    wphi, wel = (3.0, 31.0) if T == 1 else (0.0, 41.0)
    wn = (S(wphi, wel) - C).normalized()
    knock(["winframe", "wintrim"], about(S(wphi, wel), wn, -7))


kit.run(build_state, turn)
