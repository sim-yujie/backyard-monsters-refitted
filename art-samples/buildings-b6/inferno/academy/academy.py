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
            pillars=[(-0.73, 5.75, 0.4, -2.8), (0.12, 6.96, 0.7, -2.8), (2.82, 7.68, 1.0, -2.8), (4.74, 6.23, 0.8, -2.8)],   # (y, top z, width, x behind the shell)
            cogs=[(2.04, 6.99, 1.0, 10)],                      # (y, z, radius, teeth)
            rock=dict(r0=3.2, h_front=2.5, h_side=4.4, h_right=2.7, top=3.0),
            lobes=[(-111, 5.6), (-74, 5.2), (-33, 5.0), (21, 5.6), (75, 5.0), (130, 5.0), (190, 5.0)],
            spikes=[(-1.8, -4.2, 1.0, 3.6), (4.2, 1.6, 1.0, 3.25)], back_zs=3.3, dome=1.0),
    2: dict(rot=6.0, at=(0.0, 0.0), a=3.18, rise=3.3, zs=5.8, front=1.4, depth=1.9,
            hub=[(2.07, 4.09, 1.1, 1.25), (-0.43, 4.7, 0.9, 0.95)],
            pillars=[(-0.18, 9.88, 1.7, -2.8), (2.85, 9.98, 0.8, -2.8), (5.22, 8.47, 0.8, -2.8)],
            cogs=[(1.80, 8.67, 0.95, 10), (3.92, 7.34, 0.55, 7)],
            rock=dict(r0=3.4, h_front=3.3, h_side=7.2, h_right=5.0, top=3.7),
            lobes=[(-111, 6.3), (-75, 6.4), (-29, 6.1), (27, 6.2), (80, 5.4), (135, 5.4), (190, 5.4)],
            spikes=[(-1.65, -5.25, 1.2, 5.6), (-1.2, -5.0, 1.0, 4.6), (4.5, 2.0, 0.4, 3.8)], back_zs=4.6, dome=1.4),
}[L]
A, RISE, ZS, FRONT, DEPTH = P["a"], P["rise"], P["zs"], P["front"], P["depth"]
M = {}
PART = {}
BODY = None


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
         hi=(255, 246, 232), scratch=0.08, spec=0.5, patch_col=None, soot=0.0, streak=(1.0, 1.0, 0.08), high=2.6):
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
    if soot or DMG:
        s = soot or 0.75
        n3 = t.noise(t.coords(loc=(3.1, 1.7, 0.4)), 1.1, 7.0, 0.7, 0.0)
        c = t.mix(c, kit.srgb(16, 13, 11), t.ramp(n3, [(0.5, (0, 0, 0, 1)), (0.58, (s,) * 3 + (1,))]))
    c = t.grime(c, kit.GROUND, high, dirt, ao_min)
    t.set(**{"Base Color": c, "rough": rough if not DMG else min(0.8, rough + 0.25), "metal": metal, "spec": spec})
    t.bump(t.noise(v, scale * 5, 4.0, 0.6), 0.1, 0.01)
    return t.m


def rock_mat():
    """Flash's lava rock: near-black brown, rust-red blotches, a few dull orange cracks that barely glow."""
    t = kit.NT("rock")
    v = t.coords()
    n1 = t.noise(v, 2.4, 8.0, 0.72, 0.0)
    c = t.ramp(n1, [(0.36, kit.srgb(9, 6, 5)), (0.5, kit.srgb(34, 16, 12)), (0.6, kit.srgb(96, 36, 20)),
                    (0.7, kit.srgb(128, 54, 28))])
    n2 = t.noise(t.coords(loc=(5, 2, 1)), 3.4, 5.0, 0.7, 0.6)
    c = t.mix(c, kit.srgb(150, 58, 22), t.ramp(n2, [(0.62, (0, 0, 0, 1)), (0.7, (0.75,) * 3 + (1,))]))
    n3 = t.noise(t.coords(loc=(1, 4, 2)), 5.5, 6.0, 0.75, 1.0)
    crack = t.ramp(n3, [(0.7, (0, 0, 0, 1)), (0.76, (1, 1, 1, 1))])          # a few small embers
    glow = t.mix((0, 0, 0, 1), kit.srgb(255, 96, 20), crack)
    c = t.mix(c, kit.srgb(206, 84, 24), crack)
    c = t.grime(c, kit.GROUND, 3.5, 0.25, 0.35)
    t.set(**{"Base Color": c, "rough": 0.82, "spec": 0.25})
    t.link(glow, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = 0.35 if not DMG else 0.15
    h = t.mix(n1, t.noise(t.coords(scale=(1.0, 1.0, 0.25)), 6.0, 6.0, 0.75), 0.5)        # upright crags
    t.bump(h, 1.0, 0.25)
    return t.m


def mats():
    m = {}
    m["gold"] = worn("gold", (236, 150, 18), patch_col=(176, 92, 12), blotch=0.45, hi=(255, 232, 130), edge=0.5,
                     scale=0.45, rough=0.26, metal=0.8, dirt=0.5, ao_min=0.4, high=7.5, scratch=0.14, streak=(1.0, 0.08, 1.0))
    m["goldd"] = worn("goldd", (150, 80, 12), patch_col=(190, 110, 20), blotch=0.7, hi=(240, 190, 90), edge=0.4,
                      scale=0.9, rough=0.36, metal=0.7, dirt=0.3, ao_min=0.4, scratch=0.14)
    m["pale"] = worn("pale", (196, 178, 140), blotch=0.25, hi=(250, 240, 214), edge=0.5, scale=2.4, rough=0.38,
                     metal=0.45, dirt=0.25, scratch=0.1)
    m["tooth"] = worn("tooth", (150, 128, 92), blotch=0.3, hi=(255, 244, 214), edge=0.6, scale=4.0, rough=0.42,
                      metal=0.4, dirt=0.1, ao_min=0.35)
    grey = (92, 96, 96) if L == 1 else (128, 122, 104)
    cap = (70, 74, 76) if L == 1 else (136, 130, 112)
    m["pillar"] = worn("pillar", grey, blotch=0.3, hi=(196, 200, 196), edge=0.5, scale=2.6, rough=0.5, metal=0.35,
                       dirt=0.2, scratch=0.16)
    m["cap"] = worn("cap", cap, blotch=0.3, hi=(180, 184, 182), edge=0.5, scale=3.0, rough=0.5, metal=0.35, dirt=0.1)
    m["hub"] = worn("hub", (20, 19, 18), blotch=0.3, hi=(120, 116, 108), edge=0.6, scale=5.0, rough=0.4, metal=0.5,
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
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(len(r0)):
            j = (i + 1) % len(r0)
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sh = kit.mesh_ob("shell", bm, [M["gold"]], parent=BODY)
    add_bevel(sh, 0.03, 2)
    arch_band("shell-inlay", af, rf, ZS, 0.6, 0.0, 0.3, f - 0.3, f - 0.07, M["pale"], bevel=0.03)
    # the pale band round the shell's back edge
    arch_band("band", A + RB * 0.7 + 0.07, RISE + RB * 0.3 + 0.07, ZS, 0.6, 0.0, 0.3, b - 0.42, b, M["pale"], bevel=0.04)
    # the gold back plate, lower
    bz = P["back_zs"]
    for sgn in (-1, 1):          # a gold plate each side of the works (two plates, so nothing crosses over the crown)
        kit.box(f"collar{sgn}", (1.35, 0.2, bz + 1.2), (b - 1.025, sgn * (A + RB * 0.7 + 0.35), 0.6), M["goldd"],
                bevel=0.08, parent=BODY)
    # the dark core between the shell and the back plate, so nothing shows through under the track
    arch_solid("core", A + RB * 0.7 - 0.3, RISE + RB * 0.3 - 0.3, ZS, 0.6, b - 1.25, b - 0.3, M["dark"], bevel=0.02)


def track_path():
    """The teeth's path over the arch as points (y, z, angle of the outward normal) every 0.02 of its length."""
    pts = arch_pts(A + RB * 0.7 + 0.06, RISE + RB * 0.3 + 0.06, ZS, 0.9, n=200)
    out = []
    step = 0.02
    carry = 0.0
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        d = math.hypot(y1 - y0, z1 - z0)
        ang = math.atan2(z1 - z0, y1 - y0) + math.pi / 2
        s = carry
        while s < d:
            t = s / d
            out.append((y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, ang))
            s += step
        carry = s - d
    return out, step


PITCH = 0.42
RB = 0.6              # how far the shell swells out sideways past its face
DOMEX = 1.0           # and over what depth
TILT = 4.0            # the drills point up a little, as Flash's


def track():
    b = FRONT - DEPTH
    x = b - 1.0               # the teeth, b-1.25..b-0.75; the cogs stand behind them, the pillars behind the cogs
    # the belt the teeth sit on
    arch_band("belt", A + RB * 0.7 + 0.06, RISE + RB * 0.3 + 0.06, ZS, 0.6, 0.0, 0.35, x - 0.25, x + 0.25, M["pale"], bevel=0.03)
    path, step = track_path()
    n = int(len(path) * step / PITCH)
    e = bpy.data.objects.new("track", None)
    kit.link(e, BODY)
    kit.MOVING.append(e)
    teeth = []
    for i in range(n):
        t = kit.box(f"tooth{i}", (0.5, 0.2, 0.17), (0, 0, 0), M["tooth"], bevel=0.05, parent=e, origin="centre",
                    taper=1.0)
        teeth.append(t)
    PART["track"] = (teeth, path, step, x, n)


def set_track(phase):
    teeth, path, step, x, n = PART["track"]
    for i, t in enumerate(teeth):
        s = ((i + phase) % n) * PITCH
        y, z, ang = path[min(len(path) - 1, int(s / step))]
        t.location = (x, y + 0.07 * math.cos(ang), z + 0.07 * math.sin(ang))
        t.rotation_euler = (ang - math.pi / 2, 0, 0)


def pillars():
    b = FRONT - DEPTH
    PART["pillars"] = []
    for i, (y, top, w, dx) in enumerate(P["pillars"]):
        e = bpy.data.objects.new(f"pillar{i}", None)
        kit.link(e, BODY)
        e.location = (b + dx + 0.5, y, 0)
        kit.MOVING.append(e)
        z0 = ZS - 1.5 if abs(y) < A - 0.6 else 0.8
        kit.box(f"pillar{i}-post", (0.55, w, top - 0.3 - z0), (0, 0, z0), M["pillar"], bevel=0.05, parent=e)
        kit.box(f"pillar{i}-cap", (0.75, w + 0.22, 0.34), (0, 0, top - 0.34), M["cap"], bevel=0.07, parent=e)
        kit.box(f"pillar{i}-neck", (0.62, w + 0.08, 0.1), (0, 0, top - 0.52), M["cap"], bevel=0.03, parent=e)
        PART["pillars"].append((e, i))


def cogs():
    b = FRONT - DEPTH
    PART["cogs"] = []
    for i, (y, z, r, teeth) in enumerate(P["cogs"]):
        e = bpy.data.objects.new(f"cog{i}", None)
        kit.link(e, BODY)
        e.location = (b - 1.6, y, z)
        e.rotation_euler = (0, math.pi / 2, 0)
        kit.MOVING.append(e)
        sp = bpy.data.objects.new(f"cog{i}-spin", None)
        kit.link(sp, e)
        kit.gear(f"cog{i}-wheel", r, teeth, 0.36, (0, 0, 0), M["tooth"], (0, 0, 0), tooth=0.3, parent=sp)
        kit.cyl(f"cog{i}-boss", r * 0.42, 0.5, (0, 0, -0.25), M["pale"], parent=sp, bevel=0.04)
        PART["cogs"].append((sp, teeth, (-1) ** i))


def hub():
    f = FRONT - 0.12
    PART["drills"] = []
    hs = P["hub"]
    if len(hs) > 1:                                   # the twin hub's plate joins the two
        (y0, z0, r0, _), (y1, z1, r1, _) = hs
        d = Vector((0, y1 - y0, z1 - z0))
        m = kit.box("hub-link", (0.16, r1 * 1.7, d.length), (f, y0, z0), M["hub"], bevel=0.04)
        m.rotation_euler = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    for i, (y, z, r, s) in enumerate(hs):
        kit.cyl(f"hub{i}-disc", r, 0.2, (f, y, z), M["hub"], rot=(0, 90, 0), bevel=0.05, verts=32)
        kit.cyl(f"hub{i}-ring", r * 0.6, 0.34, (f, y, z), M["hub"], rot=(0, 90, 0), bevel=0.04, verts=24)
        for j in range(8):                             # pale studs round it
            a = 2 * math.pi * (j + 0.5) / 8
            kit.cyl(f"hub{i}-stud{j}", 0.07 * s, 0.1, (f + 0.2, y + r * 0.8 * math.cos(a), z + r * 0.8 * math.sin(a)),
                    M["pale"], rot=(0, 90, 0), bevel=0.02, verts=10)
        e = bpy.data.objects.new(f"drill{i}", None)
        kit.link(e, BODY)
        e.location = (f, y, z)
        e.rotation_euler = (0, math.pi / 2 - math.radians(TILT), 0)
        kit.MOVING.append(e)
        if L == 2:
            kit.gear(f"drill{i}-cog", r * 0.62, 10, 0.16, (0, 0, 1.0), M["tooth"], (0, 0, 0), tooth=0.3, parent=e)
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
        px = b - 1.15
        needle("needle", (b - 2.9, 2.55, ZS), (b - 2.9, 2.55, 12.13), 0.21)             # behind the pillars
        needle("sidespike", (b - 2.5, -1.3, 7.19), (b - 5.1, -0.48, 7.35), 0.24)
        kit.cyl("sidespike-collar", 0.34, 0.5, (b - 2.6, -1.3, 7.19), M["pillar"], rot=(0, -88, 0), bevel=0.04)


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
    return h * (0.82 + 0.36 * noise.noise(Vector((math.cos(math.radians(th)) * 2.2, math.sin(math.radians(th)) * 2.2,
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
            d += noise.noise(p * 7.0) * 0.08
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
    th = -55.0
    c, s = math.cos(math.radians(th)), math.sin(math.radians(th))
    r = P["rock"]["r0"] + (0.35 if L == 1 else 0.75)
    e = bpy.data.objects.new("grate", None)
    kit.link(e)
    e.location = (r * c, r * s, 0)
    e.rotation_euler = (0, 0, math.radians(th))
    kit.box("grate-hole", (0.5, 1.0, 0.95), (-0.45, 0, 0), M["dark"], bevel=0.05, parent=e)
    kit.box("grate-sill", (0.45, 1.1, 0.1), (0.05, 0, 0), M["pale"], bevel=0.04, parent=e)
    for j in (-1, 0, 1):
        kit.cyl(f"grate-bar{j + 1}", 0.06, 0.85, (0.05, 0.32 * j, 0.08), M["pale"], parent=e, verts=10, bevel=0.0)


def cards():
    """A bright card that only shiny metal sees (no light on matt surfaces, no shadow, not in the picture): the hard
    highlight of Flash's polished gold, as the Strongbox's."""
    v = -kit.cam_fwd()
    r = Vector((1, 1, 0)).normalized()
    u = r.cross(v) if r.cross(v).z > 0 else v.cross(r)
    cen = Vector((0, 0, 5.0))
    for nm, n, size, col, e in (("card-key", v + u * 0.75 - r * 0.6, 7.0, (1.0, 0.93, 0.76), 40.0),
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
    track()
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
    set_track(4.0 * k / N)
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
