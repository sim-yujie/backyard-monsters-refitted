"""academy.py : the Inferno Academy (building 26 in an Inferno yard, Flash folder iacademy) in 3D, Flash's two looks
(level 1; levels 2-4), built from the Flash pictures put into measurements (17 Nov 2026). Only the generic Inferno
kit is used (../kit.py: camera, light, helpers), as the Strongbox and the Incubator.

    blender -b --factory-startup -P academy.py -- <1|2> <fit|check|still|anim> [frame]
    PB_STATE=damaged ... -- <1|2> still        the look's damaged still (render/L<n>-damaged-base.png)

The building: a gold shell shaped like an arched doorway laid on its back edge, its arched face toward the viewer's
right. The face has a thick gold rim, a pale inlaid band and a flat gold panel; on the panel a black studded hub
with a pale drill sticking out. Behind the shell's rim: a pale band, then a track of pale teeth running over the arch
(a small cog wheel stands on top of it), then grey capped pillars standing up past the arch, then a lower gold back
plate. All of it sits in a mound of dark lava rock with a jagged skirt of lobes, a thin spike at the lobes' tips and
a small barred grate in the front notch.

Look 2 is Flash's bigger redesign of the same body: the shell larger and higher in a taller mound, a second cog,
taller pillars, a tall needle on top, a spike out of the left pillar, a twin hub with two drills.

World: Z up. The camera looks from +X -Y. The body's own frame (the empty `body`): x = out of the arched face,
y = across the face (to the viewer's right, away), z = up; it is turned ROT degrees about Z.

The loop (training; Flash's own strips are commented out in INFERNOYARDPROPS.as, 44 cells for look 1 and 47 for look
2, and only the drill strip of look 2 survives): the drill pulls in and pushes out once (cells 7-18, as Flash's
anim1.2.png; look 2's small drill after it, cells 20-31), the teeth run over the arch, the cog turns with them and
the pillars pump. Idle is frame 0.
"""
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import kit  # noqa: E402

kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (1.0, 33.0)
kit.FRAME = (-80, -110, 90, 80)
L = kit.LEVEL
N = {1: 44, 2: 47}[L]
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))     # PB_EXTRA=1 also renders frame N (= frame 0), the loop check
kit.SUN_COL = (1.0, 0.92, 0.80)
kit.SKY_E = 0.55
DMG = kit.STATE == "damaged"

# ------------------------------------------------------------------------------------------------- the two looks
P = {
    1: dict(rot=6.0, at=(0.0, 0.0), a=2.78, rise=2.4, zs=5.7, front=1.3, depth=1.8,
            hub=[(0.88, 3.97, 0.8, 1.0)],                      # (y, z, radius, drill size)
            # pillars and cogs by the Flash pixel they stand on: (px x, px y of the top, width)
            pillars=[(-20.5, -28, 0.5, -0.85), (-17.5, -40, 0.8), (-3, -54, 1.0), (11, -48, 0.8)],     # (.., further back)
            # (px x, px y of the axle, radius, teeth, plane: 0 = in front, 1 = behind it)
            cogs=[(-1, -43, 1.0, 10, 0), (-10, -35, 0.65, 8, 1), (-15.5, -26.5, 0.5, 7, 0)],
            rungs=(-22.5, 1, 17),
            rock=dict(r0=3.2, h_front=2.4, h_side=3.9, h_right=2.0, top=3.4),
            lobes=[(-111, 5.6), (-74, 5.2), (-33, 5.0), (21, 5.7), (75, 5.0), (130, 5.0), (190, 5.0)],
            spikes=[(-1.8, -4.2, 1.0, 3.6), (4.2, 1.6, 1.0, 3.25)], back_zs=3.3, dome=1.0,
            gate=(1.1, 1.15, 0.5)),                            # the grate: width, height, how far out of the notch
    2: dict(rot=6.0, at=(0.0, 0.0), a=3.18, rise=3.3, zs=5.8, front=1.4, depth=1.9,
            hub=[(2.07, 4.09, 1.3, 1.35), (-0.43, 4.7, 1.05, 1.05)],
            pillars=[(-22.5, -61, 1.7), (-3.5, -73.5, 0.8), (11.5, -70, 0.8)],
            cogs=[(-4.6, -56, 0.95, 10, 0), (-12.5, -47, 0.6, 8, 1), (5, -50.5, 0.55, 7, 1), (-18, -38, 0.5, 7, 0),
                  (18.7, -52.6, 0.5, 7, 0)],
            rungs=(-24.5, -5, 14),
            rock=dict(r0=3.4, h_front=3.1, h_side=6.5, h_right=4.6, top=3.9),
            lobes=[(-111, 6.2), (-75, 6.3), (-29, 6.0), (27, 6.2), (80, 5.4), (135, 5.4), (190, 5.4)],
            spikes=[(-1.65, -5.25, 1.2, 5.6), (-1.2, -5.0, 1.0, 4.6), (4.5, 2.0, 0.4, 3.8)], back_zs=4.6, dome=1.4,
            gate=(1.4, 1.5, 0.7)),
}[L]
A, RISE, ZS, FRONT, DEPTH = P["a"], P["rise"], P["zs"], P["front"], P["depth"]
M = {}
PART = {}
BODY = None
ROT = P["rot"]


def S(sx, sy, x):
    """(y, z) in the body's frame of the point at depth x that lands on Flash pixel (sx, sy)."""
    c, sn = math.cos(math.radians(ROT)), math.sin(math.radians(ROT))
    y = ((sx - kit.ORIGIN[0]) / kit.SX - x * (c + sn)) / (c - sn)
    z = (kit.ORIGIN[1] + kit.SY * (x * (c - sn) - y * (c + sn)) - sy) / kit.SZ
    return y, z


def arch_pts(a, rise, zs, z0, n=40):
    """The arched outline in (y, z): up the left side, over the top (half an ellipse), down the right side."""
    pts = [(-a, z0)]
    for i in range(n + 1):
        t = math.pi * (1 - i / n)
        pts.append((a * math.cos(t), zs + rise * math.sin(t)))
    pts.append((a, z0))
    return pts


def add_bevel(ob, w, segs=3):
    mo = ob.modifiers.new("bevel", "BEVEL")
    mo.width, mo.segments, mo.limit_method = w, segs, "ANGLE"
    mo.harden_normals = True
    return ob


def arch_solid(name, a, rise, zs, z0, x0, x1, mat, bevel=0.06, parent=None):
    bm = bmesh.new()
    vs = [bm.verts.new((x1, y, z)) for y, z in arch_pts(a, rise, zs, z0)]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.x = x0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat], parent=parent or BODY)
    return add_bevel(ob, bevel)


def arch_band(name, a, rise, zs, z0, o1, o2, x0, x1, mat, bevel=0.03, parent=None):
    """An arched strip between the outline shrunk by o1 and by o2, from x0 (back) to x1 (front)."""
    out = arch_pts(a - o1, rise - o1, zs, z0)
    inn = arch_pts(a - o2, rise - o2, zs, z0)
    bm = bmesh.new()
    rows = []
    for x in (x0, x1):
        rows.append(([bm.verts.new((x, y, z)) for y, z in out], [bm.verts.new((x, y, z)) for y, z in inn]))
    (bo, bi), (fo, fi) = rows
    n = len(out)
    for i in range(n - 1):
        bm.faces.new((fo[i], fo[i + 1], fi[i + 1], fi[i]))
        bm.faces.new((bo[i], bi[i], bi[i + 1], bo[i + 1]))
        bm.faces.new((fo[i], bo[i], bo[i + 1], fo[i + 1]))
        bm.faces.new((fi[i], fi[i + 1], bi[i + 1], bi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob(name, bm, [mat], parent=parent or BODY)
    return add_bevel(ob, bevel, 2)


# ------------------------------------------------------------------------------------------------------- materials
def worn(name, col, rough=0.34, metal=0.7, scale=3.0, blotch=0.4, edge=0.5, dirt=0.25, ao_min=0.5,
         hi=(255, 246, 232), scratch=0.08, spec=0.5, patch_col=None, soot=0.0, streak=(1.0, 1.0, 0.08), high=2.6,
         scorch=True, grad=None):
    """Hard worn metal (the Strongbox's recipe): hard-edged darker patches (or patches of patch_col), scratches,
    bright worn edges, dirt toward the ground and in the creases; soot = dark smears (the damaged look)."""
    t = kit.NT(name)
    v = t.coords()
    c = kit.srgb(*col)
    n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.4)
    if patch_col:
        c = t.mix(c, kit.srgb(*patch_col), t.ramp(n1, [(0.46, (0, 0, 0, 1)), (0.58, (blotch,) * 3 + (1,))]))
        n0 = t.noise(v, scale * 0.6, 4.0, 0.6, 0.8)
        c = t.mix(c, t.ramp(n0, [(0.42, (1, 1, 1, 1)), (0.62, (0.6, 0.44, 0.26, 1))]), 1.0, "MULTIPLY")
    else:
        k = 1.0 - blotch
        c = t.mix(c, t.ramp(n1, [(0.45, (k, k, k, 1)), (0.55, (1, 1, 1, 1))]), 1.0, "MULTIPLY")
    if scratch:
        n2 = t.noise(t.coords(scale=streak), scale * 6, 3.0, 0.6)
        lo, up = 1.0 - scratch, 1.0 + scratch * 0.6
        c = t.mix(c, t.ramp(n2, [(0.4, (lo, lo, lo, 1)), (0.6, (up, up, up, 1))]), 1.0, "MULTIPLY")
    if edge:
        ao = t.n("ShaderNodeAmbientOcclusion", samples=8, inside=True, only_local=True)
        ao.inputs["Distance"].default_value = 0.07
        c = t.mix(c, kit.srgb(*hi), t.ramp(ao.outputs["AO"], [(0.5, (edge,) * 3 + (1,)), (0.9, (0, 0, 0, 1))]))
    if grad:                       # darker toward one side: (world direction, from, to, darkest, lightest)
        geo = t.n("ShaderNodeNewGeometry")
        dot = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dot.inputs[0])
        dot.inputs[1].default_value = grad[0]
        mr = t.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = grad[1], grad[2]
        mr.inputs[3].default_value, mr.inputs[4].default_value = grad[4], grad[3]
        t.link(dot.outputs["Value"], mr.inputs[0])
        g3 = t.n("ShaderNodeCombineColor")
        for i in range(3):
            t.link(mr.outputs[0], g3.inputs[i])
        c = t.mix(c, g3.outputs[0], 1.0, "MULTIPLY")
    if soot or (DMG and scorch):
        s = soot or 0.75
        n3 = t.noise(t.coords(loc=(3.1, 1.7, 0.4)), 1.1, 7.0, 0.7, 0.0)
        c = t.mix(c, kit.srgb(16, 13, 11), t.ramp(n3, [(0.5, (0, 0, 0, 1)), (0.58, (s,) * 3 + (1,))]))
    c = t.grime(c, kit.GROUND, high, dirt, ao_min)
    t.set(**{"Base Color": c, "rough": rough if not (DMG and scorch) else min(0.8, rough + 0.25), "metal": metal, "spec": spec})
    t.bump(t.noise(v, scale * 5, 4.0, 0.6), 0.1, 0.01)
    return t.m


def rock_mat():
    """Flash's lava rock: near-black brown, rust-red blotches, a few dull orange cracks that barely glow."""
    t = kit.NT("rock")
    v = t.coords()
    n1 = t.noise(v, 2.4, 8.0, 0.72, 0.0)
    c = t.ramp(n1, [(0.36, kit.srgb(6, 4, 3)), (0.5, kit.srgb(24, 10, 7)), (0.6, kit.srgb(78, 26, 13)),
                    (0.7, kit.srgb(108, 40, 18))])
    n2 = t.noise(t.coords(loc=(5, 2, 1)), 3.4, 5.0, 0.7, 0.6)
    c = t.mix(c, kit.srgb(150, 58, 22), t.ramp(n2, [(0.62, (0, 0, 0, 1)), (0.7, (0.75,) * 3 + (1,))]))
    n3 = t.noise(t.coords(loc=(1, 4, 2)), 5.5, 6.0, 0.75, 1.0)
    crack = t.ramp(n3, [(0.7, (0, 0, 0, 1)), (0.76, (1, 1, 1, 1))])          # a few small embers
    glow = t.mix((0, 0, 0, 1), kit.srgb(255, 96, 20), crack)
    c = t.mix(c, kit.srgb(206, 84, 24), crack)
    c = t.grime(c, kit.GROUND, 3.5, 0.25, 0.35)
    t.set(**{"Base Color": c, "rough": 0.9, "spec": 0.08})
    t.link(glow, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = 0.35 if not DMG else 0.15
    h = t.mix(n1, t.noise(t.coords(scale=(1.0, 1.0, 0.25)), 6.0, 6.0, 0.75), 0.5)        # upright crags
    t.bump(h, 1.0, 0.25)
    return t.m


def mats():
    m = {}
    m["gold"] = worn("gold", (176, 108, 18), patch_col=(120, 66, 10), blotch=0.45, hi=(255, 232, 130), edge=0.5,
                     scale=0.45, rough=0.26, metal=0.8, dirt=0.5, ao_min=0.4, high=7.5, scratch=0.14, streak=(1.0, 0.08, 1.0),
                     scorch=False)
    # the flat face: the same gold, darker toward its lower right as Flash shades it
    m["goldface"] = worn("goldface", (236, 150, 18), patch_col=(176, 92, 12), blotch=0.45, hi=(255, 232, 130), edge=0.5,
                         scale=0.45, rough=0.3, metal=0.8, dirt=0.15, ao_min=0.4, high=7.5, scratch=0.14,
                         streak=(1.0, 0.08, 1.0), scorch=False, grad=((-0.07, 0.7, -0.71), -4.2, 0.3, 0.42, 0.56))
    m["goldd"] = worn("goldd", (150, 80, 12), patch_col=(190, 110, 20), blotch=0.7, hi=(240, 190, 90), edge=0.4,
                      scale=0.9, rough=0.36, metal=0.7, dirt=0.3, ao_min=0.4, scratch=0.14, scorch=False)
    m["pale"] = worn("pale", (160, 142, 108), blotch=0.25, hi=(250, 240, 214), edge=0.5, scale=2.4, rough=0.38,
                     metal=0.45, dirt=0.25, scratch=0.1)
    m["tooth"] = worn("tooth", (150, 128, 92), blotch=0.3, hi=(255, 244, 214), edge=0.6, scale=4.0, rough=0.42,
                      metal=0.4, dirt=0.1, ao_min=0.35)
    grey = (92, 96, 96) if L == 1 else (128, 122, 104)
    cap = (70, 74, 76) if L == 1 else (136, 130, 112)
    m["pillar"] = worn("pillar", grey, blotch=0.3, hi=(196, 200, 196), edge=0.5, scale=2.6, rough=0.5, metal=0.35,
                       dirt=0.2, scratch=0.16)
    m["cap"] = worn("cap", cap, blotch=0.3, hi=(180, 184, 182), edge=0.5, scale=3.0, rough=0.5, metal=0.35, dirt=0.1)
    m["hub"] = worn("hub", (30, 28, 26), blotch=0.3, hi=(150, 144, 132), edge=0.7, scale=5.0, rough=0.4, metal=0.5,
                    dirt=0.0, scratch=0.0)
    m["drill"] = worn("drill", (190, 176, 132), blotch=0.3, hi=(250, 240, 210), edge=0.4, scale=4.0, rough=0.4,
                      metal=0.45, dirt=0.0, streak=(0.08, 1.0, 1.0))
    m["spike"] = worn("spike", (104, 90, 74), blotch=0.35, hi=(214, 200, 176), edge=0.4, scale=4.0, rough=0.45,
                      metal=0.45, dirt=0.3)
    m["dark"] = kit.painted("dark", (8, 6, 5), rough=0.9, dirt=0.0)
    m["rock"] = rock_mat()
    return m


# ------------------------------------------------------------------------------------------------------- the parts
def shell():
    f, b = FRONT, FRONT - DEPTH
    # the shell is domed: from the flat face its skin swells out (by RB at the sides, DOME over the top) before it
    # runs straight back, so the face is smaller than the outline and sits well under the crown
    dr = P["dome"]
    af, rf = A - RB * 0.3, RISE + RB * 0.3 - dr
    bm = bmesh.new()
    rings = []
    nb = 12
    secs = [(f - 0.12 - DOMEX * (1 - math.cos(math.radians(90 * j / nb))), math.sin(math.radians(90 * j / nb)))
            for j in range(nb + 1)] + [(b, 1.0)]
    for x, k in secs:
        rings.append([bm.verts.new((x, y, z)) for y, z in arch_pts(af + RB * k, rf + dr * k, ZS, 0.6, n=48)])
    bm.faces.new(rings[0]).material_index = 1
    bm.faces.new(list(reversed(rings[-1])))
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(len(r0)):
            j = (i + 1) % len(r0)
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sh = kit.mesh_ob("shell", bm, [M["gold"], M["goldface"]], parent=BODY)
    add_bevel(sh, 0.03, 2)
    arch_band("shell-inlay", af, rf, ZS, 0.6, 0.0, 0.3, f - 0.3, f - 0.07, M["pale"], bevel=0.03)
    # the pale band round the shell's back edge
    arch_band("band", A + RB * 0.7 + 0.07, RISE + RB * 0.3 + 0.07, ZS, 0.6, 0.0, 0.3, b - 0.42, b, M["pale"], bevel=0.04)
    # the gold collar on the viewer's left: a curved plate hugging the works, up the side and a little over the
    # shoulder (it stops well short of the crown, so nothing behind the shell crosses it)
    bz = P["back_zs"]
    ca, cr = A + RB * 0.7 + 0.32, RISE * 0.7
    out, n = [(-ca, 0.3)], 14
    for i in range(n + 1):
        t = math.radians(38.0 * i / n)
        out.append((-ca * math.cos(t), bz + 0.5 + cr * math.sin(t)))
    bm = bmesh.new()
    rows = [[bm.verts.new((x, y, z)) for y, z in out] for x in (b - 1.5, b - 0.38)]
    for i in range(len(out) - 1):
        bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
    col = kit.mesh_ob("collar", bm, [M["goldd"]], parent=BODY)
    so = col.modifiers.new("solid", "SOLIDIFY")
    so.thickness, so.offset = 0.26, 0.0
    add_bevel(col, 0.07, 3)
    # a dark core behind the band, so no light comes through between the shell and the works
    arch_solid("core", A - 1.9, RISE - 1.9, ZS, 0.6, b - 1.4, b - 0.3, M["dark"], bevel=0.02)

RB = 0.6              # how far the shell swells out sideways past its face
DOMEX = 1.0           # and over what depth
TILT = 4.0            # the drills point up a little, as Flash's
PLANE = (-0.72, -1.17)        # the two planes the cogs turn in, behind the shell's back edge (so none touches another)
PILLAR_X = -1.95               # the pillars stand behind both


def pillars():
    """Flash's dark capped pillars, standing clear behind the cogs; they pump while it trains."""
    b = FRONT - DEPTH
    PART["pillars"] = []
    for i, (sx, sy, w, *dx) in enumerate(P["pillars"]):
        px = b + PILLAR_X + (dx[0] if dx else 0.0)
        y, top = S(sx, sy, px)
        e = bpy.data.objects.new(f"pillar{i}", None)
        kit.link(e, BODY)
        e.location = (px, y, 0)
        kit.MOVING.append(e)
        z0 = ZS - 1.5 if abs(y) < A - 0.6 else 0.8
        kit.box(f"pillar{i}-post", (0.55, w, top - 0.3 - z0), (0, 0, z0), M["pillar"], bevel=0.05, parent=e)
        kit.box(f"pillar{i}-cap", (0.75, w + 0.22, 0.34), (0, 0, top - 0.34), M["cap"], bevel=0.07, parent=e)
        kit.box(f"pillar{i}-neck", (0.62, w + 0.08, 0.1), (0, 0, top - 0.52), M["cap"], bevel=0.03, parent=e)
        PART["pillars"].append((e, i))


def cogs():
    """Flash's cluster of pale cogs between the pillars, each on its own axle, in two planes; they turn while it
    trains. Below them on the left, the rungs Flash shows down the side (still)."""
    b = FRONT - DEPTH
    PART["cogs"] = []
    for i, (sx, sy, r, teeth, plane) in enumerate(P["cogs"]):
        x = b + PLANE[plane]
        y, z = S(sx, sy, x)
        e = bpy.data.objects.new(f"cog{i}", None)
        kit.link(e, BODY)
        e.location = (x, y, z)
        e.rotation_euler = (0, math.pi / 2, 0)
        kit.MOVING.append(e)
        sp = bpy.data.objects.new(f"cog{i}-spin", None)
        kit.link(sp, e)
        kit.gear(f"cog{i}-wheel", r, teeth, 0.3, (0, 0, 0), M["tooth"], (0, 0, 0), tooth=0.3, parent=sp)
        kit.cyl(f"cog{i}-boss", r * 0.4, 0.4, (0, 0, -0.2), M["pale"], parent=sp, bevel=0.04)
        for j in range(4):                              # holes round the boss, so the turning shows
            a = 2 * math.pi * j / 4
            kit.cyl(f"cog{i}-hole{j}", r * 0.11, 0.32, (r * 0.58 * math.cos(a), r * 0.58 * math.sin(a), -0.16),
                    M["dark"], parent=sp, bevel=0.0, verts=10)
        PART["cogs"].append((sp, teeth, 1 if plane == 0 else -1))
    sx, sy0, sy1 = P["rungs"]
    for j in range(4):
        y, z = S(sx, sy0 + (sy1 - sy0) * j / 3, b - 0.6)
        kit.box(f"rung{j}", (0.36, 0.5, 0.2), (b - 0.6, y, z), M["tooth"], bevel=0.05, parent=BODY, origin="centre")


def hub():
    f = FRONT - 0.12
    PART["drills"] = []
    hs = P["hub"]
    big = len(hs) > 1                                 # look 2: Flash's big studded twin hub
    for i, (y, z, r, s) in enumerate(hs):
        # a thick dark disc with a raised rim, a ring of pale studs on it and a collar round the drill
        kit.lathe(f"hub{i}-disc", [(0.0, 0.0), (r, 0.0), (r, 0.22), (r * 0.9, 0.3), (r * 0.8, 0.3), (r * 0.76, 0.2),
                                   (r * 0.5, 0.2), (r * 0.46, 0.4), (r * 0.3, 0.4), (0.0, 0.4)],
                  (f, y, z), M["hub"], rot=(0, 90, 0), verts=36, bevel=0.02)
        n = 12 if big else 8
        for j in range(n):
            a = 2 * math.pi * (j + 0.5) / n
            kit.cyl(f"hub{i}-stud{j}", (0.085 if big else 0.07) * s, 0.12,
                    (f + 0.18, y + r * 0.63 * math.cos(a), z + r * 0.63 * math.sin(a)),
                    M["pale"], rot=(0, 90, 0), bevel=0.025, verts=10)
        e = bpy.data.objects.new(f"drill{i}", None)
        kit.link(e, BODY)
        e.location = (f, y, z)
        e.rotation_euler = (0, math.pi / 2 - math.radians(TILT), 0)
        kit.MOVING.append(e)
        if big:
            kit.gear(f"drill{i}-cog", r * 0.44, 10, 0.16, (0, 0, 1.1), M["tooth"], (0, 0, 0), tooth=0.3, parent=e)
        kit.lathe(f"drill{i}-shaft", [(0.0, -0.9), (0.26 * s, -0.9), (0.26 * s, 1.15 * s), (0.2 * s, 1.2 * s),
                                      (0.2 * s, 1.6 * s), (0.11 * s, 1.68 * s), (0.02, 2.8 * s), (0.0, 2.82 * s)],
                  (0, 0, 0), M["drill"], verts=20, parent=e, bevel=0.02)
        PART["drills"].append((e, f))


def needle(name, base, tip, r, mat=None, parent=None):
    d = Vector(tip) - Vector(base)
    ob = kit.lathe(name, [(0.0, 0.0), (r, 0.0), (r, d.length * 0.62), (r * 0.5, d.length * 0.86), (0.0, d.length)],
                   base, mat or M["spike"], verts=12, parent=None if parent == "world" else (parent or BODY))
    ob.rotation_euler = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    return ob


def extras():
    b = FRONT - DEPTH
    if L == 2:
        y, z = S(-12, -94, b - 2.7)                              # the tall needle, behind the pillars
        needle("needle", (b - 2.7, y, ZS), (b - 2.7, y, z), 0.21)
        y0, z0 = S(-30, -35, b - 2.45)                           # the spike out of the back of the left pillar
        y1, z1 = S(-46, -42, b - 4.8)
        needle("sidespike", (b - 2.45, y0, z0), (b - 4.8, y1, z1), 0.24)
        kit.cyl("sidespike-collar", 0.34, 0.5, (b - 2.5, y0, z0), M["pillar"], rot=(0, -88, 0), bevel=0.04)


def lobe(th):
    """(how far into a lobe 0..1, that lobe's tip radius) at bearing th."""
    best = (0.0, P["rock"]["r0"])
    for c, rt in P["lobes"]:
        d = abs((th - c + 180) % 360 - 180)
        best = max(best, (1.0 - d / 19.0, rt))
    return best


def rock_r(th):
    k, rt = lobe(th)
    return P["rock"]["r0"] + (rt - P["rock"]["r0"]) * (k ** 0.8)


def rock_h(th):
    r = P["rock"]
    back = 0.5 - 0.5 * math.cos(math.radians(th + 20))          # 0 in front of the arched face, 1 behind it
    k = max(0.0, min(1.0, (back - 0.2) / 0.25))
    w = max(0.0, min(1.0, ((th + 180) % 360 - 180 - 10) / 40)) if -30 < (th + 180) % 360 - 180 < 150 else         (1.0 if 150 <= (th + 180) % 360 - 180 else 0.0)
    w = w * max(0.0, min(1.0, (215 - (th % 360)) / 40)) if th % 360 > 175 else w        # back to the left wall behind
    side = r["h_side"] + (r["h_right"] - r["h_side"]) * w
    h = r["h_front"] + (side - r["h_front"]) * k * k * (3 - 2 * k)
    jag = abs(math.sin(math.radians(th) * 8.5 + 1.3)) ** 3 * 0.14 + abs(math.sin(math.radians(th) * 19.0)) ** 4 * 0.12
    return h * (1.0 + jag) * (0.82 + 0.36 * noise.noise(Vector((math.cos(math.radians(th)) * 2.2, math.sin(math.radians(th)) * 2.2,
                                                    3.7 + L))) + 0.1 * lobe(th)[0])


def rock():
    """The mound: a ring wall from the lobed foot up to a jagged crest round the shell, rough all over."""
    bm = bmesh.new()
    nth, nt = 400, 40
    rt = P["rock"]["top"]
    rows = []
    for i in range(nth):
        th = 360.0 * i / nth - 180
        rg, h = rock_r(th), rock_h(th)
        c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
        row = []
        for j in range(nt + 1):
            t = j / nt
            lk = lobe(th)[0]
            r = rg + (rt - rg) * (t ** (1.5 - 0.3 * lk))
            z = h * (1.0 - 0.3 * lk) * (t ** 0.5)
            p = Vector((r * c, r * s, z))
            k = 0.5 * math.sin(math.pi * min(1.0, t * 1.15)) + 0.12
            d = noise.noise(p * 1.1 + Vector((0, 0, 9.0))) * 0.6 + noise.noise(p * 2.9) * 0.3
            d += noise.noise(Vector((p.x * 3.2, p.y * 3.2, p.z * 0.5 + 5.0))) * 0.4          # upright ridges
            d += (0.5 - abs(noise.noise(Vector((p.x * 2.3, p.y * 2.3, p.z * 1.1 + 2.0))))) * 0.55   # sharp crags
            d += (0.4 - abs(noise.noise(Vector((p.x * 5.1, p.y * 5.1, p.z * 2.0 + 7.0))))) * 0.28   # and chips
            d += noise.noise(p * 9.0) * 0.1
            p += Vector((c, s, 0.25)) * d * k
            p.z = max(0.0, p.z)
            row.append(bm.verts.new(p))
        # the inner lip, down into the middle
        row.append(bm.verts.new((rt * 0.8 * c, rt * 0.8 * s, h * 0.7)))
        rows.append(row)
    for i in range(nth):
        a, b2 = rows[i], rows[(i + 1) % nth]
        for j in range(len(a) - 1):
            bm.faces.new((a[j], b2[j], b2[j + 1], a[j + 1]))
    top = bm.faces.new([rows[i][-1] for i in range(nth)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = kit.mesh_ob("rock", bm, [M["rock"]])
    return ob


def spikes():
    for i, (x, y, z0, z1) in enumerate(P["spikes"]):
        needle(f"spike{i}", (x, y, z0 - 0.6), (x * 1.02, y * 1.02, z1), 0.15, parent="world")


def grate():
    """Flash's gate in the front notch: a pale frame with three bars, set into the rock (a dark hole behind it)."""
    th = -55.0 if L == 1 else -52.0
    c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
    w, h, out = P["gate"]
    r = P["rock"]["r0"] + out
    e = bpy.data.objects.new("grate", None)
    kit.link(e)
    e.location = (r * c, r * s, 0)
    e.rotation_euler = (0, 0, math.radians(th))
    kit.box("grate-hole", (0.9, w + 0.1, h + 0.05), (-0.5, 0, 0), M["dark"], bevel=0.03, parent=e)
    kit.box("grate-sill", (0.4, w + 0.3, 0.1), (0.05, 0, 0), M["pale"], bevel=0.04, parent=e)
    kit.box("grate-top", (0.22, w + 0.16, 0.12), (0.0, 0, h - 0.06), M["pale"], bevel=0.04, parent=e)
    for j in (-1, 1):
        kit.box(f"grate-post{j}", (0.2, 0.12, h), (0.0, j * (w / 2 + 0.02), 0.05), M["pale"], bevel=0.03, parent=e)
    for j in (-1, 0, 1):
        kit.cyl(f"grate-bar{j + 1}", 0.065, h - 0.1, (0.0, w * 0.27 * j, 0.08), M["pale"], parent=e, verts=10, bevel=0.0)


def cards():
    """A bright card that only shiny metal sees (no light on matt surfaces, no shadow, not in the picture): the hard
    highlight of Flash's polished gold, as the Strongbox's."""
    v = -kit.cam_fwd()
    r = Vector((1, 1, 0)).normalized()
    u = r.cross(v) if r.cross(v).z > 0 else v.cross(r)
    cen = Vector((0, 0, 5.0))
    for nm, n, size, col, e in (("card-key", v + u * 0.75 - r * 0.6, 7.0, (1.0, 0.95, 0.7), 90.0),
                                ("card-sky", v + u * 1.3 + r * 0.2, 16.0, (0.8, 0.8, 0.9), 1.6)):
        n = n.normalized()
        l = (2 * n.dot(v) * n - v).normalized()
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
        ob = kit.mesh_ob(nm, bm, [kit.flat(nm, tuple(int(255 * c) for c in col), emit=e)], smooth=False)
        z = -l
        x = Vector((0, 0, 1)) - z * z.z
        x.normalize()
        m = Matrix((x, z.cross(x), z)).transposed().to_4x4()
        m.translation = cen + l * 24
        ob.matrix_world = m
        ob.visible_camera = ob.visible_diffuse = ob.visible_shadow = ob.visible_transmission = False
        ob.visible_volume_scatter = False


def build():
    global BODY
    M.update(mats())
    BODY = bpy.data.objects.new("body", None)
    kit.link(BODY)
    BODY.location = (P["at"][0], P["at"][1], 0)
    BODY.rotation_euler = (0, 0, math.radians(P["rot"]))
    cards()
    shell()
    pillars()
    cogs()
    hub()
    extras()
    rock()
    spikes()
    grate()
    if DMG:
        import damage
        damage.wreck(sys.modules[__name__])
        kit.MOVING.clear()


def ease(t):
    return (1 - math.cos(math.pi * max(0.0, min(1.0, t)))) / 2


def pulse(k, k0, k1):
    """0 -> 1 -> 0 between cells k0 and k1."""
    if k <= k0 or k >= k1:
        return 0.0
    return math.sin(math.pi * (k - k0) / (k1 - k0)) ** 1.5


def turn(k):
    k = k % N
    if DMG:
        return
    for e, teeth, sign in PART["cogs"]:
        e.rotation_euler = (0, 0, 2 * math.pi * 3 * k / (N * teeth) * sign)
    for e, i in PART["pillars"]:
        e.location.z = 0.2 * (math.cos(2 * math.pi * (2 * k / N + i * 0.27)) - math.cos(2 * math.pi * i * 0.27))
    for i, (e, f) in enumerate(PART["drills"]):
        p = pulse(k, 7, 19) if i == 0 else pulse(k, 20, 32)
        e.location.x = f - 0.6 * p * math.cos(math.radians(TILT))
        e.location.z = P['hub'][i][1] - 0.6 * p * math.sin(math.radians(TILT))


def family(o):
    """A part's family for the check mode: the moving part it hangs under, else "base"."""
    p = o
    while p is not None:
        if p in kit.MOVING:
            return p.name
        p = p.parent
    return "base"


kit.run(build, turn, family=family)
