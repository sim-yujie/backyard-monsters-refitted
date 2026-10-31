"""walls.py : the wall blocks (Flash building 17 "Block" levels 1-5, 18 "Stone Block", Inferno 17 "Block" levels 1-3)
as 3D models, whole, damaged and destroyed. The camera, light, world and render settings are the approved HCC's
(hcc-v1/hcc.py is run without its main() and its scene set-up reused unchanged); only the frame is the wall's:
flashwalls.FRAME round the block's anchor, world origin = the middle of the 20-unit footprint (Flash pixel (0, 10)).

    blender -b --factory-startup -P walls.py -- <look> prev  [states]   work/prev-<look>-<state>.png  (4 px a Flash px)
    blender -b --factory-startup -P walls.py -- <look> still [states]   render/<look>-<state>-base.png (with its ground
                                                                         shadow) and -alone.png (no shadow), 8 px a Flash px
    blender -b --factory-startup -P walls.py -- <look> check [states]   CONTACT lines: every part's gap to the ground or
                                                                         another part (FLOAT if over 0.03)
looks: block1..block5, stone, inferno1..inferno3; states: whole,damaged,destroyed (comma list, default all three)
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["block1", "prev"]
LOOK = ARGS[0]
MODE = ARGS[1] if len(ARGS) > 1 else "prev"
STATES = ARGS[2].split(",") if len(ARGS) > 2 else ["whole", "damaged", "destroyed"]

# the approved HCC script without its main(): its helpers, materials, camera and light
G = {}
_argv = sys.argv
sys.argv = [_argv[0], "--", "1", "still"]
_src = HERE.parent / "hcc-v1" / "hcc.py"
G.update({"__file__": str(_src), "__name__": "hcc"})
_text = _src.read_text(encoding="utf8").rstrip()
assert _text.endswith("main()")
exec(compile(_text[:-len("main()")], str(_src), "exec"), G)
sys.argv = _argv

K = int(os.environ.get("PB_K", 4 if MODE == "prev" else 8))
G["FRAME"] = (-30, -30, 38, 38)        # as flashwalls.FRAME
G["ORIGIN"] = (0.0, 10.0)              # the footprint's middle: the anchor is its top corner, 20 units = 10 px down
G["K"] = K
SC, NT, srgb, MATS = G["SC"], G["NT"], G["srgb"], G["MATS"]
box, cyl, mesh_ob, link = G["box"], G["cyl"], G["mesh_ob"], G["link"]
wood, painted, shiny, flat = G["wood"], G["painted"], G["shiny"], G["flat"]
S = 2.83                               # the footprint's side in world units (20 yard units)
rng = random.Random(17)


# ------------------------------------------------------------------------------------------------------------ materials
def stone(name, col, wear, top=None, scale=7.0, dirt=0.3, rough=0.85):
    return painted(name, col, rough=rough, wear=wear, top=top, scale=scale, dirt=dirt, spec=0.3, ao_min=0.6)


def cobble(name):
    """Level 3's sides: grey speckled cobbles (Voronoi cells) in darker mortar."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords(scale=(1, 1, 1.4))
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vo.inputs["Scale"].default_value = 2.8
    t.link(v, vo.inputs["Vector"])
    edge = vo.outputs["Distance"]
    cell = t.n("ShaderNodeTexVoronoi")
    cell.inputs["Scale"].default_value = 2.8
    t.link(v, cell.inputs["Vector"])
    cc = t.ramp(cell.outputs["Color"],
                [(0.0, srgb(84, 82, 80)), (1.0, srgb(150, 148, 144))])
    speck = t.ramp(t.noise(v, 40, 2.0, 0.5), [(0.4, srgb(80, 78, 76)), (0.6, srgb(235, 235, 232))])
    col = t.mix(cc, speck, 0.45)
    mortar = t.ramp(edge, [(0.02, (0, 0, 0, 1)), (0.07, (1, 1, 1, 1))])
    col = t.mix(srgb(60, 58, 56), col, mortar)
    col = t.grime(col, 0.0, 2.6, 0.25, 0.6)
    t.set(**{"Base Color": col, "rough": 0.9, "spec": 0.3})
    t.bump(edge, 0.5, 0.03)
    MATS[name] = t.m
    return t.m


def lattice(name):
    """Level 3's top: near-white tile with a diamond lattice in pale grey relief."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs["Object"], sep.inputs[0])
    lines = None
    for sign in (1.0, -1.0):
        f = t.n("ShaderNodeMath", operation="MULTIPLY")          # lines along the block's edges, x and y
        t.link(sep.outputs["X" if sign > 0 else "Y"], f.inputs[0])
        f.inputs[1].default_value = 1.7
        fr = t.n("ShaderNodeMath", operation="FRACT")
        t.link(f.outputs[0], fr.inputs[0])
        d = t.n("ShaderNodeMath", operation="SUBTRACT")
        t.link(fr.outputs[0], d.inputs[0])
        d.inputs[1].default_value = 0.5
        a = t.n("ShaderNodeMath", operation="ABSOLUTE")
        t.link(d.outputs[0], a.inputs[0])
        if lines is None:
            lines = a.outputs[0]
        else:
            mx = t.n("ShaderNodeMath", operation="MAXIMUM")
            t.link(lines, mx.inputs[0])
            t.link(a.outputs[0], mx.inputs[1])
            lines = mx.outputs[0]
    v = t.coords()
    ln = t.ramp(lines, [(0.3, (0, 0, 0, 1)), (0.42, (1, 1, 1, 1))])
    col = t.mix(srgb(226, 226, 230), srgb(170, 168, 176), ln)
    col = t.mix(col, srgb(206, 206, 212), t.ramp(t.noise(v, 9, 3.0, 0.5), [(0.45, (0, 0, 0, 1)), (0.75, (0.5, 0.5, 0.5, 1))]))
    t.set(**{"Base Color": col, "rough": 0.6, "spec": 0.4})
    b = t.n("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.5
    b.inputs["Distance"].default_value = 0.03
    b.invert = True
    t.link(ln, b.inputs["Height"])
    t.link(b.outputs[0], t.bsdf.inputs["Normal"])
    MATS[name] = t.m
    return t.m


K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)


def m(t, op, a, b=None, c=None):
    """A Math node on sockets or numbers."""
    n = t.n("ShaderNodeMath", operation=op)
    for i, x in enumerate((a, b, c)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            t.link(x, n.inputs[i])
    return n.outputs[0]


def axes(t, kind="Object", node="ShaderNodeTexCoord"):
    sep = t.n("ShaderNodeSeparateXYZ")
    src = t.n(node)
    t.link(src.outputs[kind], sep.inputs[0])
    return sep.outputs


def facing_up(t):
    """1 on faces turned up (or down), 0 on the sides."""
    nz = axes(t, "Normal", "ShaderNodeNewGeometry")[2]
    return t.ramp(m(t, "ABSOLUTE", nz), [(0.5, K0), (0.7, K1)])


def lift_right(t, col, k=0.4):
    """Flash paints the face turned from the light (screen right, world +X) lighter than the 3D light leaves it."""
    nx = axes(t, "Normal", "ShaderNodeNewGeometry")[0]
    mr = t.n("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = 0.3, 0.9
    mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0, 1.0 + k
    t.link(nx, mr.inputs[0])
    grey = t.n("ShaderNodeCombineColor")
    for i in range(3):
        t.link(mr.outputs[0], grey.inputs[i])
    return t.mix(col, grey.outputs[0], 1.0, "MULTIPLY")


def see_through(t, col, alpha, strength):
    """Glowing and partly transparent (flames, the glow on the ground): emission mixed with transparency."""
    em = t.n("ShaderNodeEmission")
    t.link(col, em.inputs["Color"])
    em.inputs["Strength"].default_value = strength
    tr = t.n("ShaderNodeBsdfTransparent")
    mx = t.n("ShaderNodeMixShader")
    t.link(alpha, mx.inputs[0])
    t.link(tr.outputs[0], mx.inputs[1])
    t.link(em.outputs[0], mx.inputs[2])
    t.link(mx.outputs[0], t.out.inputs["Surface"])


def ground_glow(name, a, inner=0.95, outer=1.32, strength=3.0):
    """Lava light on the ground round a rounded-square foot of half-side a: bright at the foot, fading out."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    x, y, _ = axes(t)
    rr = m(t, "POWER", m(t, "ADD", m(t, "POWER", m(t, "ABSOLUTE", m(t, "DIVIDE", x, a)), 4.0),
                         m(t, "POWER", m(t, "ABSOLUTE", m(t, "DIVIDE", y, a)), 4.0)), 0.25)
    rr = m(t, "MULTIPLY", rr, 0.5)                    # a colour ramp only takes 0..1
    col = t.ramp(rr, [(inner / 2, srgb(255, 176, 50)), ((inner + 0.1) / 2, srgb(255, 120, 22)), (outer / 2, srgb(230, 70, 10))])
    alpha = t.ramp(rr, [(inner / 2, K1), ((inner + 0.08) / 2, (0.6, 0.6, 0.6, 1)), (outer / 2, K0)])
    see_through(t, col, alpha, strength)
    MATS[name] = t.m
    return t.m


def flame(name):
    """A small licking flame: yellow at its foot, orange, red and fading at the tip (Generated Z along the cone)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    z = axes(t, "Generated")[2]
    col = t.ramp(z, [(0.0, srgb(255, 236, 120)), (0.35, srgb(255, 150, 30)), (1.0, srgb(225, 50, 10))])
    alpha = t.ramp(z, [(0.0, K1), (0.55, (0.85, 0.85, 0.85, 1)), (1.0, K0)])
    see_through(t, col, alpha, 3.5)
    MATS[name] = t.m
    return t.m


def lava_rock(name, glow=1.0, cracks=4.0, ash=True):
    """The Inferno's near-black volcanic rock: orange lava glowing in its cracks (more low down) and in small spots all
    over, the top lit pale like hot ash (Flash's level 1 mound)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vo.inputs["Scale"].default_value = cracks
    t.link(v, vo.inputs["Vector"])
    crack = t.ramp(vo.outputs["Distance"], [(0.012, K1), (0.045, K0)])
    z = axes(t, "Position", "ShaderNodeNewGeometry")[2]
    low = t.ramp(z, [(0.03, K1), (0.2, (0.7, 0.7, 0.7, 1)), (0.42, K0)])
    amt = t.mix(crack, low, 1.0, "MULTIPLY")
    spots = t.ramp(t.noise(v, 5.5, 3.0, 0.6), [(0.68, K0), (0.74, (0.8, 0.8, 0.8, 1))])
    amt = t.mix(amt, spots, 1.0, "LIGHTEN")
    # Flash's broad smears of glowing orange over the dark rock, broken up by a finer noise
    patch = t.mix(t.ramp(t.noise(v, 2.2, 3.0, 0.5, 0.6), [(0.56, K0), (0.68, (0.75, 0.75, 0.75, 1))]),
                  t.ramp(t.noise(v, 14.0, 2.0, 0.5), [(0.35, (0.2, 0.2, 0.2, 1)), (0.6, K1)]), 1.0, "MULTIPLY")
    amt = t.mix(amt, patch, 1.0, "LIGHTEN")
    rock = t.mix(srgb(8, 7, 7), srgb(30, 24, 22), t.ramp(t.noise(v, 6, 4.0, 0.6), [(0.4, K0), (0.7, K1)]))
    if ash:
        top = t.mix(t.ramp(m(t, "MULTIPLY", z, 0.5), [(0.45, K0), (0.62, (0.55, 0.55, 0.55, 1))]),
                    t.ramp(t.noise(v, 4, 3.0, 0.5), [(0.3, (0.3, 0.3, 0.3, 1)), (0.6, K1)]), 1.0, "MULTIPLY")
        rock = t.mix(rock, srgb(128, 100, 90), top)
    col = t.mix(rock, srgb(255, 110, 20), amt)
    t.set(**{"Base Color": col, "rough": 0.75, "spec": 0.12, "Emission Color": srgb(255, 96, 16)})
    t.link(m(t, "MULTIPLY", amt, 3.5 * glow), t.bsdf.inputs["Emission Strength"])
    t.bump(t.noise(v, 7.0, 4.0, 0.6), 0.3, 0.03)
    MATS[name] = t.m
    return t.m


def obsidian(name):
    """Level 5: glossy black-grey obsidian. Flat facets (each Voronoi cell turns the surface its own way, so each
    catches the sky differently), a few lighter facets, thin white glints along some facet edges."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    cell = t.n("ShaderNodeTexVoronoi")
    cell.inputs["Scale"].default_value = 1.05
    t.link(v, cell.inputs["Vector"])
    edge = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    edge.inputs["Scale"].default_value = 1.05
    t.link(v, edge.inputs["Vector"])
    col = t.ramp(cell.outputs["Color"], [(0.0, srgb(16, 16, 18)), (0.45, srgb(28, 28, 30)), (0.7, srgb(46, 46, 50)),
                                         (0.85, srgb(80, 80, 84)), (1.0, srgb(128, 128, 134))])
    glint = t.mix(t.ramp(edge.outputs["Distance"], [(0.0, K1), (0.055, K0)]),
                  t.ramp(t.noise(v, 2.4, 2.0, 0.5), [(0.64, K0), (0.68, K1)]), 1.0, "MULTIPLY")
    col = t.mix(col, srgb(240, 240, 246), glint)
    col = t.mix(col, srgb(14, 14, 16), t.mix(facing_up(t), (0.65, 0.65, 0.65, 1), 1.0, "MULTIPLY"))   # darker top (Flash)
    col = lift_right(t, col, 0.9)
    col = t.grime(col, 0.0, 2.6, 0.15, 0.7)
    t.set(**{"Base Color": col, "rough": 0.16, "spec": 0.4})
    geo = t.n("ShaderNodeNewGeometry")
    tilt = t.n("ShaderNodeVectorMath", operation="SUBTRACT")
    t.link(cell.outputs["Color"], tilt.inputs[0])
    tilt.inputs[1].default_value = (0.5, 0.5, 0.5)
    sc = t.n("ShaderNodeVectorMath", operation="SCALE")
    t.link(tilt.outputs[0], sc.inputs[0])
    sc.inputs["Scale"].default_value = 0.55
    add = t.n("ShaderNodeVectorMath", operation="ADD")
    t.link(geo.outputs["Normal"], add.inputs[0])
    t.link(sc.outputs[0], add.inputs[1])
    nrm = t.n("ShaderNodeVectorMath", operation="NORMALIZE")
    t.link(add.outputs[0], nrm.inputs[0])
    t.link(nrm.outputs[0], t.bsdf.inputs["Normal"])
    MATS[name] = t.m
    return t.m


def granite_mat(name, top_lo=(112, 112, 118), top_hi=(190, 190, 194), side_lo=(60, 60, 64), side_hi=(128, 126, 130)):
    """Level 2: Flash's mottled granite, salt-and-pepper specks over grey clouds, the top near white."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    mott = t.noise(v, 1.6, 5.0, 0.62)
    col = t.mix(t.ramp(mott, [(0.35, srgb(*side_lo)), (0.65, srgb(*side_hi))]),
                t.ramp(mott, [(0.3, srgb(*top_lo)), (0.7, srgb(*top_hi))]), facing_up(t))
    col = t.mix(col, srgb(150, 134, 144), t.ramp(t.noise(v, 4.0, 2.0, 0.5), [(0.55, K0), (0.75, (0.3, 0.3, 0.3, 1))]))
    sp = t.noise(v, 11.0, 2.0, 0.5)
    col = t.mix(col, srgb(70, 68, 72), t.ramp(sp, [(0.32, (0.5, 0.5, 0.5, 1)), (0.42, K0)]))
    col = t.mix(col, srgb(230, 230, 234), t.ramp(sp, [(0.62, K0), (0.72, (0.45, 0.45, 0.45, 1))]))
    col = lift_right(t, col, 0.4)
    col = t.grime(col, 0.0, 2.6, 0.2, 0.6)
    t.set(**{"Base Color": col, "rough": 0.8, "spec": 0.3})
    t.bump(sp, 0.12, 0.01)
    MATS[name] = t.m
    return t.m


def weave(name):
    """Level 3: Flash's woven stone, pairs of rounded strands laid on the diagonal, each square of the weave turned
    across its neighbours (a basket weave), raised and shaded; near white on the top, grey on the sides. Laid out
    on the top in x, y and on the sides in (x + y), z, so one material covers every face."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    x, y, z = axes(t)
    up = facing_up(t)
    u = m(t, "MULTIPLY_ADD", y, m(t, "SUBTRACT", 1.0, up), x)          # top: x, sides: x + y
    w = m(t, "MULTIPLY_ADD", up, m(t, "SUBTRACT", y, z), z)            # top: y, sides: z
    k = 1.4
    a = m(t, "MULTIPLY", m(t, "ADD", u, w), k)
    b = m(t, "MULTIPLY", m(t, "SUBTRACT", u, w), k)
    fa = m(t, "SUBTRACT", m(t, "FRACT", a), 0.5)
    fb = m(t, "SUBTRACT", m(t, "FRACT", b), 0.5)
    c = m(t, "FLOORED_MODULO", m(t, "ADD", m(t, "FLOOR", a), m(t, "FLOOR", b)), 2.0)
    p = m(t, "MULTIPLY_ADD", c, m(t, "SUBTRACT", fb, fa), fa)          # along the strand
    qa = m(t, "SUBTRACT", m(t, "ABSOLUTE", fb), 0.25)
    qb = m(t, "SUBTRACT", m(t, "ABSOLUTE", fa), 0.25)
    q = m(t, "MULTIPLY_ADD", c, m(t, "SUBTRACT", qb, qa), qa)          # across: two strands a cell
    d = m(t, "ADD", m(t, "POWER", m(t, "ABSOLUTE", m(t, "MULTIPLY", p, 1.8)), 2.0),
          m(t, "POWER", m(t, "ABSOLUTE", m(t, "MULTIPLY", q, 3.6)), 2.0))
    top = t.ramp(d, [(0.0, srgb(242, 242, 244)), (0.7, srgb(232, 232, 236)), (0.9, srgb(176, 174, 182)), (1.0, srgb(150, 148, 158))])
    side = t.ramp(d, [(0.0, srgb(176, 174, 176)), (0.55, srgb(146, 144, 146)), (0.85, srgb(96, 94, 96)), (1.0, srgb(58, 56, 58))])
    col = t.mix(side, top, up)
    col = t.mix(col, srgb(120, 112, 122), t.ramp(t.noise(t.coords(), 30.0, 2.0, 0.5), [(0.6, K0), (0.7, (0.35, 0.35, 0.35, 1))]))
    col = lift_right(t, col, 0.45)
    col = t.grime(col, 0.0, 2.6, 0.15, 0.6)
    t.set(**{"Base Color": col, "rough": 0.7, "spec": 0.35})
    t.bump(t.ramp(d, [(0.0, K1), (1.0, K0)]), 0.6, 0.05)
    MATS[name] = t.m
    return t.m


def gold_mat(name, col=(200, 126, 22), tip=None, lift=0.35, metal=0.2):
    """Level 4: Flash's painted gold: warm orange, mostly flat colour with a soft sheen, the face away from the light
    still well lit. tip: the pyramids' upper part lit orange-yellow (Generated Z, so it follows each pyramid)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    out = srgb(*col)
    if tip:
        out = t.mix(out, srgb(*tip), t.ramp(axes(t, "Generated")[2], [(0.7, K0), (0.95, K1)]))
    if lift:
        out = lift_right(t, out, lift)
    out = t.grime(out, 0.0, 2.2, 0.3, 1.0)      # no AO darkening: its noise came out as vertical streaks
    t.set(**{"Base Color": out, "rough": 0.38, "metal": metal, "spec": 0.6})
    MATS[name] = t.m
    return t.m


def steel(name, col=(96, 84, 82), tip=None, sheen=True):
    """Inferno level 3: glossy dark steel, warm grey, a broad sheen toward the light. tip: a small white tip."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    out = srgb(*col)
    if tip:
        out = t.mix(out, srgb(*tip), t.ramp(axes(t, "Generated")[2], [(0.55, K0), (0.64, K1)]))
    if sheen:                   # Flash: a soft pale sheen high on the face toward the light (world -Y, the left face)
        ny = axes(t, "Normal", "ShaderNodeNewGeometry")[1]
        z = axes(t, "Position", "ShaderNodeNewGeometry")[2]
        fac = t.mix(t.ramp(m(t, "MULTIPLY", ny, -1.0), [(0.5, K0), (0.9, K1)]), t.ramp(m(t, "MULTIPLY", z, 0.33), [(0.25, K0), (0.65, (0.5, 0.5, 0.5, 1))]),
                    1.0, "MULTIPLY")
        out = t.mix(out, srgb(196, 184, 180), fac)
    out = t.grime(out, 0.0, 2.4, 0.2, 1.0)
    t.set(**{"Base Color": out, "rough": 0.2, "metal": 0.55, "spec": 0.6})
    t.bump(t.noise(t.coords(), 6.0, 3.0, 0.5), 0.04, 0.01)
    MATS[name] = t.m
    return t.m


def mats():
    MATS.clear()        # hcc.py made its own materials at import ("gold" with vertical polish streaks): never reuse them
    return {
        "wood_side": wood("crate-side", (150, 104, 62), (92, 60, 36), "X", rings=7, dirt=0.3),
        "wood_side_y": wood("crate-side", (150, 104, 62), (92, 60, 36), "Y", rings=7, dirt=0.3),
        "wood_frame": wood("crate-frame", (128, 86, 50), (78, 50, 30), "Z", rings=7, dirt=0.3),
        "wood_frame_x": wood("crate-frame", (128, 86, 50), (78, 50, 30), "X", rings=7, dirt=0.3),
        "wood_frame_y": wood("crate-frame", (128, 86, 50), (78, 50, 30), "Y", rings=7, dirt=0.3),
        "wood_top": wood("crate-top", (206, 168, 116), (162, 124, 82), "X", rings=7, dirt=0.15),
        "wood_top_y": wood("crate-top", (206, 168, 116), (162, 124, 82), "Y", rings=7, dirt=0.15),
        "wood_brace": wood("crate-brace", (176, 132, 84), (124, 88, 54), "X", rings=7, dirt=0.15),
        "wood_raw": flat("wood-raw", (186, 146, 100), rough=0.9),
        "wood_dark": flat("crate-inside", (52, 34, 22), rough=0.95),
        "granite": granite_mat("granite"),
        "granite_rubble": granite_mat("granite-rubble", side_lo=(120, 118, 120), side_hi=(196, 196, 198)),
        "granite_in": granite_mat("granite-in", top_lo=(150, 150, 154), top_hi=(196, 196, 200), side_lo=(140, 140, 144),
                                  side_hi=(190, 190, 194)),
        "crack": flat("crack-dark", (40, 38, 40), rough=0.95),
        "cobble": weave("weave"),
        "lattice": weave("weave"),
        "weave_in": stone("weave-in", (176, 174, 176), (206, 204, 206), scale=12.0, dirt=0.05),
        "gold": gold_mat("gold"),
        "gold_in": gold_mat("gold-in", (232, 160, 44)),
        "gold_rim": gold_mat("gold-rim", (240, 176, 56)),
        "gold_top": gold_mat("gold-top", (178, 96, 10), tip=(255, 190, 40), lift=0.0, metal=0.45),
        "obsidian": obsidian("obsidian"),
        "obsidian_in": shiny("obsidian-in", (96, 96, 108), rough=0.35, metal=0.0, dirt=0.1),
        "smooth": stone("smoothstone", (146, 148, 160), (160, 162, 172), top=(196, 196, 204), scale=4.0, dirt=0.3, rough=0.6),
        "smooth_in": stone("smoothstone-in", (176, 176, 184), (196, 196, 204), scale=12.0, dirt=0.05),
        "stud": stone("stud", (150, 150, 158), (170, 170, 178), top=(214, 214, 222), scale=6.0, dirt=0.1, rough=0.55),
        "lava": lava_rock("lava"),
        "lava_dim": lava_rock("lava-dim", glow=0.6, ash=False),
        "glow": ground_glow("lava-ground", 1.5),
        "glow_small": ground_glow("lava-ground-small", 1.1, 0.7, 1.5, 1.6),
        "flame": flame("flame"),
        "ibase": painted("ibase", (40, 36, 32), rough=0.7, wear=(66, 58, 50), scale=6.0, dirt=0.3, soot=0.5,
                         top=(88, 70, 50)),
        "icap": painted("icap", (106, 96, 82), rough=0.75, wear=(138, 126, 106), scale=7.0, dirt=0.3, soot=0.35,
                        top=(124, 110, 88)),
        "icap_in": painted("icap-in", (160, 150, 134), rough=0.85, scale=10.0, dirt=0.0),
        "bronze": shiny("bronze", (124, 78, 32), rough=0.35, metal=0.7, dirt=0.2),
        "rivet": painted("rivet", (232, 230, 224), rough=0.35, dirt=0.0, spec=0.6),
        "iron": steel("steel"),
        "iron_dark": steel("steel-spike", (54, 48, 48), sheen=False),
        "iron_tip": steel("steel-tip", (54, 48, 48), tip=(236, 232, 230), sheen=False),
        "iron_in": shiny("iron-in", (100, 94, 90), rough=0.5, metal=0.8, dirt=0.05),
        "bone": steel("steel-tip", (54, 48, 48), tip=(236, 232, 230), sheen=False),
    }


# ------------------------------------------------------------------------------------------------------------ meshes
def bake(o):
    """o with its modifiers applied, as a plain mesh object (same name)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    name, mw = o.name, o.matrix_world.copy()
    bpy.data.objects.remove(o, do_unlink=True)
    new = bpy.data.objects.new(name, me)
    link(new)
    new.matrix_world = mw
    return new


def bite(o, cutters, keep=False):
    """Cut the cutters out of o (exact boolean; the new faces take the cutter's material: the lighter broken inside)."""
    for c in cutters:
        if c.data.materials and c.data.materials[0].name not in [m.name for m in o.data.materials if m]:
            o.data.materials.append(c.data.materials[0])
        mo = o.modifiers.new("cut", "BOOLEAN")
        mo.operation = "DIFFERENCE"
        mo.solver = "EXACT"
        mo.object = c
        try:
            mo.material_mode = "TRANSFER"
        except (AttributeError, TypeError):
            pass
        c.hide_render = True
    o = bake(o)
    if not keep:
        for c in cutters:
            bpy.data.objects.remove(c, do_unlink=True)
    return o


def lump(name, size, at, mat, seed, rough=0.28, sub=2, flat_shade=False, rot=0.0):
    """An irregular stone/chunk: a squashed icosphere `size` (x, y, z) with jagged noise; its lowest point on at.z."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=0.5)
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for v in bm.verts:
        n = noise.noise(v.co * 2.6 + off)
        v.co *= 1.0 + rough * n * 2.0
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    ob = mesh_ob(name, bm, [mat], smooth=not flat_shade)
    ob.rotation_euler = (0, 0, math.radians(rot))
    ob.location = (at[0], at[1], 0)
    bpy.context.view_layer.update()
    zmin = min((ob.matrix_world @ v.co).z for v in ob.data.vertices)
    ob.location.z = at[2] - zmin
    return ob


def cutter(name, size, at, mat, seed, rough=0.3, rot=(0, 0, 0)):
    """A ragged lump centred on at (for bites out of a part)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.5)
    off = Vector((seed * 2.9, seed * 1.3, seed * 3.7))
    for v in bm.verts:
        v.co *= 1.0 + rough * noise.noise(v.co * 3.0 + off) * 2.0
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    ob = mesh_ob(name, bm, [mat], smooth=False)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def crack(name, a, b, depth, width, mat, seed, normal):
    """A jagged wedge from surface point a to b, `depth` into the part along -normal, `width` open at the surface."""
    a, b, nrm = Vector(a), Vector(b), Vector(normal).normalized()
    r = random.Random(seed)
    n = 7
    d = (b - a)
    side = d.cross(nrm).normalized()
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        t = i / n
        p = a + d * t + side * (r.uniform(-0.09, 0.09) if 0 < i < n else 0.0)
        w = width * (0.35 + 0.65 * math.sin(math.pi * min(1.0, 0.15 + t * 0.85)))
        rows.append([bm.verts.new(p + side * w / 2 + nrm * 0.1), bm.verts.new(p - side * w / 2 + nrm * 0.1),
                     bm.verts.new(p - nrm * depth)])
    for r0, r1 in zip(rows, rows[1:]):
        for i, j in ((0, 1), (1, 2), (2, 0)):
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False)


def rough_box(name, size, mat, amp=0.06, freq=1.6, seed=0, cuts=6, bevel=0.08, flat_shade=False):
    """A box standing on the ground at the origin, its faces wobbled by noise (hewn stone)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    off = Vector((seed * 1.1, seed * 2.2, seed * 0.7))
    for v in bm.verts:
        p = Vector((v.co.x * size[0], v.co.y * size[1], (v.co.z + 0.5) * size[2]))
        if p.z > 0.01:
            p += v.co.normalized() * amp * noise.noise(p * freq + off)
        v.co = p
    return mesh_ob(name, bm, [mat], smooth=not flat_shade, bevel=bevel, segs=2)


def pyramid(name, base, h, at, mat, rot=0.0):
    return cyl(name, base / math.sqrt(2), h, at, mat, rot=(0, 0, 45 + rot), verts=4, r2=0.0, bevel=0.015)


def drop(o, z=0.0):
    """Move o down/up so its lowest point sits at z."""
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ v.co).z for v in o.data.vertices)
    o.location.z += z - zmin
    return o


# ------------------------------------------------------------------------------------------------------------ looks
def crate(M, state):
    """Block level 1: a wooden crate. Frame battens on every edge, planked sides with one diagonal brace each, a pale
    planked lid with its own frame and brace."""
    s, h, b = 2.8, 2.4, 0.24          # side, height, batten
    hs = s / 2
    parts = []
    if state == "destroyed":
        # the bottom frame and floor on the ground, corner stubs, broken planks and a brace lying in it and beside it
        for i, (x, y, sx, sy) in enumerate(((0, -hs + b / 2, s, b), (0, hs - b / 2, s, b), (-hs + b / 2, 0, b, s - 2 * b),
                                            (hs - b / 2, 0, b, s - 2 * b))):
            parts.append(box(f"frame{i}", (sx, sy, b), (x, y, 0), M["wood_frame_x" if sx > sy else "wood_frame_y"],
                             bevel=0.03))
        for i in range(5):
            parts.append(box(f"floor{i}", (s - 2 * b, (s - 2 * b) / 5 - 0.03, 0.08),
                             (0, -hs + b + (i + 0.5) * (s - 2 * b) / 5, 0), M["wood_top"], bevel=0.01))
        for i, (x, y, hh) in enumerate(((-1, -1, 0.55), (1, -1, 0.42), (1, 1, 0.5), (-1, 1, 0.62))):
            parts.append(box(f"post{i}", (b, b, hh), (x * (hs - b / 2), y * (hs - b / 2), 0), M["wood_frame"],
                             bevel=0.03))
        for nm, size, at, mat, rz in (("plank0", (1.7, 0.42, 0.09), (0.1, -0.2), "wood_side", 18),
                                      ("plank1", (1.2, 0.42, 0.09), (-0.3, 0.55), "wood_top", -30),
                                      ("brace0", (1.6, 0.2, 0.18), (0.55, 0.2), "wood_frame_x", 70),
                                      ("plank2", (1.1, 0.38, 0.09), (-0.6, -0.75), "wood_side", 40)):
            o = box(nm, size, (at[0], at[1], 0), M[mat], rot=(0, 0, rz), bevel=0.01)
            settle(o, parts)
            parts.append(o)
        return parts
    # 12 edge battens
    for i, (x, y) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        parts.append(box(f"post{i}", (b, b, h), (x * (hs - b / 2), y * (hs - b / 2), 0), M["wood_frame"], bevel=0.03))
    for z, tag in ((0.0, "lo"), (h - b, "hi")):
        parts.append(box(f"rail{tag}0", (s - 2 * b, b, b), (0, -hs + b / 2, z), M["wood_frame_x"], bevel=0.03))
        parts.append(box(f"rail{tag}1", (s - 2 * b, b, b), (0, hs - b / 2, z), M["wood_frame_x"], bevel=0.03))
        parts.append(box(f"rail{tag}2", (b, s - 2 * b, b), (-hs + b / 2, 0, z), M["wood_frame_y"], bevel=0.03))
        parts.append(box(f"rail{tag}3", (b, s - 2 * b, b), (hs - b / 2, 0, z), M["wood_frame_y"], bevel=0.03))
    # side planks: three horizontal boards per side, set in from the frame
    t = 0.08
    ph = (h - 2 * b) / 3
    for f, (nx, ny) in enumerate(((0, -1), (1, 0), (0, 1), (-1, 0))):
        for k in range(3):
            z = b + k * ph + 0.012
            if nx == 0:
                o = box(f"side{f}-{k}", (s - 2 * b + 0.02, t, ph - 0.024), (0, ny * (hs - b / 2), z), M["wood_side"], bevel=0.01)
            else:
                o = box(f"side{f}-{k}", (t, s - 2 * b + 0.02, ph - 0.024), (nx * (hs - b / 2), 0, z), M["wood_side_y"], bevel=0.01)
            parts.append(o)
        # the brace: top-left to bottom-right as the viewer sees the face, flush with the frame
        L = math.hypot(s - 2 * b, h - 2 * b) - 0.1
        ang = math.degrees(math.atan2(h - 2 * b, s - 2 * b))
        if nx == 0:
            parts.append(box(f"brace{f}", (L, b * 0.85, b * 0.9), (0, ny * (hs - b * 0.45), h / 2), M["wood_frame_x"],
                             rot=(0, ang * (1 if ny < 0 else -1), 0), bevel=0.02, origin="centre"))
        else:
            parts.append(box(f"brace{f}", (b * 0.85, L, b * 0.9), (nx * (hs - b * 0.45), 0, h / 2), M["wood_frame_y"],
                             rot=(-ang * (1 if nx > 0 else -1), 0, 0), bevel=0.02, origin="centre"))
    # the lid: five boards inside the top frame, pale, and a brace corner to corner
    n = 5
    w = (s - 2 * b) / n
    lid = []
    for k in range(n):
        lid.append(box(f"lid{k}", (s - 2 * b + 0.02, w - 0.025, t), (0, -hs + b + (k + 0.5) * w, h - b + 0.06), M["wood_top"],
                       bevel=0.01))
    # Flash's lid brace runs corner to corner, left to right as the viewer sees it, a darker board set into the lid
    Ld = (s - 2 * b) * math.sqrt(2) - 0.12
    lbrace = box("lidbrace", (Ld, b * 0.9, 0.08), (0, 0, h - b + 0.06 + t), M["wood_brace"], rot=(0, 0, 45), bevel=0.02)
    parts += lid + [lbrace]
    floor = box("floor", (s - 2 * b, s - 2 * b, 0.1), (0, 0, 0), M["wood_dark"], bevel=0.0)
    parts.append(floor)
    if state == "damaged":
        # a hole broken through the lid round its middle: two boards snapped short, the brace snapped, a board
        # knocked out of the front-left side; the loose boards lie at the foot
        for k, (cut0, cut1) in ((1, (-0.15, 0.85)), (2, (-0.55, 0.6)), (3, (-0.25, 0.3))):
            o = lid[k]
            c = cutter(f"lidcut{k}", (cut1 - cut0, w * 1.4, 0.6), ((cut0 + cut1) / 2, o.location.y, o.location.z), M["wood_raw"],
                       seed=k, rough=0.15)
            lid[k] = bite(o, [c])
        c = cutter("bracecut", (0.9, 0.9, 0.6), (0.2, 0.0, h), M["wood_raw"], seed=7, rough=0.2)
        bite(lbrace, [c])
        side = next(o for o in parts if o.name == "side0-2")
        c = cutter("sidecut", (1.1, 0.5, 0.5), (0.45, -hs + b / 2, side.location.z + ph / 2), M["wood_raw"], seed=3, rough=0.2)
        bite(side, [c])
    return parts


def granite(M, state):
    """Block level 2: a hewn block of grey granite, its top weathered pale."""
    s, h = 2.78, 2.3
    if state == "destroyed":
        # Flash: pale broken stone and dust spread low over the whole square, more toward the left
        r = random.Random(5)
        out = []
        spots = ((-0.3, 0.1, 1.5, 1.2, 0.3), (0.7, -0.55, 1.1, 0.9, 0.24), (-0.95, -0.7, 1.0, 0.9, 0.2),
                 (0.55, 0.8, 1.0, 0.9, 0.22), (-0.9, 0.85, 0.9, 0.8, 0.18), (1.05, 0.25, 0.7, 0.6, 0.16),
                 (0.1, -1.0, 0.9, 0.6, 0.16), (-1.1, -0.05, 0.7, 0.9, 0.18), (-0.25, 1.05, 0.8, 0.5, 0.15),
                 (1.0, -1.0, 0.6, 0.5, 0.14))
        for i, (x, y, sx, sy, sz) in enumerate(spots):
            out.append(lump(f"rock{i}", (sx, sy, sz), (x, y, 0), M["granite_rubble"], seed=i + 1, rot=r.uniform(0, 90), sub=1,
                            flat_shade=True, rough=0.22))
        for i, (x, y, sz) in enumerate(((-0.2, 0.0, 0.35), (0.5, -0.4, 0.28), (-0.7, 0.5, 0.26), (-0.75, -0.55, 0.24))):
            o = lump(f"chunk{i}", (0.55, 0.45, sz), (x, y, 0.0), M["granite_rubble"], seed=11 + i, sub=1, flat_shade=True,
                     rot=r.uniform(0, 90))
            settle(o, out)
            out.append(o)
        return out
    o = rough_box("granite", (s, s, h), M["granite"], amp=0.035, freq=1.6, seed=2, bevel=0.08)
    if state == "damaged":
        # deep dark cracks down the two faces in view, a corner broken off the top (pale inside)
        cs = [crack("crack0", (-0.5, -s / 2, h + 0.05), (-0.2, -s / 2, 0.4), 1.0, 0.42, M["crack"], 1, (0, -1, 0)),
              crack("crack0b", (-0.3, -s / 2, 1.3), (0.5, -s / 2, 0.9), 0.7, 0.26, M["crack"], 6, (0, -1, 0)),
              crack("crack1", (s / 2, 0.45, h + 0.05), (s / 2, 0.8, 0.5), 1.0, 0.4, M["crack"], 2, (1, 0, 0)),
              cutter("chip", (1.1, 1.1, 0.9), (-s / 2 + 0.15, -s / 2 + 0.15, h), M["granite_in"], seed=4)]
        return [bite(o, cs)]
    return [o]


def cobbled(M, state):
    """Block level 3: grey woven stone, a near-white slab on top with the same weave."""
    s, h, t = 2.8, 2.18, 0.24
    if state == "destroyed":
        # the slab dropped flat to the ground, a few cobbles beside it
        slab = box("slab", (s - 0.05, s - 0.05, t), (0, 0, 0), M["lattice"], bevel=0.04)
        slab = bite(slab, [crack("split", (-1.6, 0.3, t + 0.1), (1.6, -0.2, t + 0.1), t + 0.2, 0.12, M["weave_in"], 5, (0, 0, 1))])
        out = [slab]
        for i, (x, y) in enumerate(((0.9, -0.7), (-0.6, 0.8), (0.75, 0.75))):
            o = lump(f"cob{i}", (0.42, 0.38, 0.26), (x, y, 0), M["cobble"], seed=i + 3, sub=1, flat_shade=True)
            settle(o, [slab])
            out.append(o)
        return out
    body = rough_box("body", (s - 0.04, s - 0.04, h), M["cobble"], amp=0.015, freq=2.5, seed=3, bevel=0.04)
    slab = box("slab", (s, s, t), (0, 0, h - 0.01), M["lattice"], bevel=0.04)
    if state == "damaged":
        # the right corner smashed off, top and side (as Flash), the broken stone pale; its pieces at the foot
        at = (s / 2 - 0.15, s / 2 - 0.35, h - 0.15)
        body = bite(body, [cutter("smash", (2.4, 2.3, 2.0), at, M["weave_in"], seed=8, rough=0.3)])
        slab = bite(slab, [cutter("smash2", (2.4, 2.3, 2.0), at, M["weave_in"], seed=8, rough=0.3)])
        return [body, slab]
    return [body, slab]


def gold(M, state):
    """Block level 4: a polished gold block, a raised rim round its top and nine pyramids inside it."""
    s, h = 2.78, 2.25
    rim_w, rim_h = 0.12, 0.07
    if state == "destroyed":
        # melted to a low gold puddle, two pyramids sunk in it
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=28, y_segments=28, size=1.0)
        for v in bm.verts:
            x, y = v.co.x * 1.75, v.co.y * 1.75
            rr = (abs(x / 1.45) ** 2.5 + abs(y / 1.35) ** 2.5) ** (1 / 2.5) + 0.25 * noise.noise(Vector((x, y, 0.3)) * 1.3)
            z = max(0.0, 1.0 - rr ** 3) ** 0.5 * 0.36 * (1 + 0.45 * noise.noise(Vector((x * 2, y * 2, 1.0))))
            v.co = Vector((x, y, z))
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z < 0.004 for v in f.verts)], context="FACES")
        ob = mesh_ob("puddle", bm, [M["gold"]], bevel=0.0)
        mo = ob.modifiers.new("solid", "SOLIDIFY")
        mo.thickness = 0.03
        out = [ob, pyramid("pyr0", 0.55, 0.38, (0.35, -0.2, 0.12), M["gold"], rot=17),
               pyramid("pyr1", 0.5, 0.32, (-0.5, 0.4, 0.12), M["gold"], rot=-25)]
        return out
    body = box("body", (s, s, h), (0, 0, 0), M["gold"], bevel=0.05)
    rim = []
    for i, (x, y, sx, sy) in enumerate(((0, -s / 2 + rim_w / 2, s, rim_w), (0, s / 2 - rim_w / 2, s, rim_w),
                                         (-s / 2 + rim_w / 2, 0, rim_w, s - 2 * rim_w), (s / 2 - rim_w / 2, 0, rim_w, s - 2 * rim_w))):
        rim.append(box(f"rim{i}", (sx, sy, rim_h), (x, y, h - 0.02), M["gold_rim"], bevel=0.03))
    pyrs = []
    step = (s - 2 * rim_w) / 3
    for i in range(3):
        for j in range(3):
            x, y = -s / 2 + rim_w + (i + 0.5) * step, -s / 2 + rim_w + (j + 0.5) * step
            pyrs.append(pyramid(f"pyr{i}{j}", step * 0.86, 0.66, (x, y, h - 0.02), M["gold_top"]))
    if state == "damaged":
        # two pyramids knocked off (one lies at the foot), the front corner dented
        for k in ("pyr20", "pyr11"):
            o = next(p for p in pyrs if p.name == k)
            bpy.data.objects.remove(o, do_unlink=True)
        stub = pyramid("pyrstub", step * 0.74, 0.18, (-s / 2 + rim_w + 2.5 * step, -s / 2 + rim_w + 0.5 * step, h - 0.02), M["gold_in"])
        dent = cutter("dent", (0.9, 0.9, 1.0), (s / 2, -s / 2, 1.0), M["gold_in"], seed=12, rough=0.2)
        body = bite(body, [dent])
        cut2 = cutter("dent2", (0.9, 0.9, 1.0), (s / 2, -s / 2, 1.0), M["gold_in"], seed=12, rough=0.2)
        r0 = next(r for r in rim if r.name == "rim0")
        bite(r0, [cut2])
        return alive([body, stub] + rim + pyrs)
    return [body] + rim + pyrs


def obsid(M, state):
    """Block level 5: a block of glossy black obsidian with chipped facets."""
    s, h = 2.78, 2.35
    if state == "destroyed":
        # Flash: a heap of black shards over most of the square, higher in the middle, a few lying round it
        r = random.Random(9)
        out = []
        for i in range(14):
            x = -1.0 + (i % 4) * 0.66 + r.uniform(-0.12, 0.12)
            y = -0.95 + (i // 4) * 0.62 + r.uniform(-0.12, 0.12)
            o = lump(f"shard{i}", (r.uniform(0.75, 1.0), r.uniform(0.5, 0.7), r.uniform(0.22, 0.4)),
                     (x, y, 0), M["obsidian"], seed=i + 20, rough=0.35, sub=1, flat_shade=True, rot=r.uniform(0, 180))
            out.append(o)
        for i, (x, y, sz) in enumerate(((-0.25, 0.1, 0.55), (0.35, -0.2, 0.45), (-0.1, -0.55, 0.4), (0.2, 0.55, 0.42),
                                        (-0.6, 0.45, 0.35))):
            o = lump(f"heap{i}", (0.8, 0.6, sz), (x, y, 0), M["obsidian"], seed=i + 40, rough=0.35, sub=1, flat_shade=True,
                     rot=r.uniform(0, 180))
            settle(o, out)
            out.append(o)
        return out
    o = rough_box("obsidian", (s, s, h), M["obsidian"], amp=0.05, freq=0.9, seed=5, cuts=2, bevel=0.03, flat_shade=True)
    if state == "damaged":
        # the top broken into jagged shards: big ragged bites out of the top and corners, chips at the foot
        cs = [cutter("b0", (1.4, 1.2, 1.0), (-0.5, -s / 2 + 0.1, h), M["obsidian_in"], seed=31, rough=0.35),
              cutter("b1", (1.2, 1.4, 1.1), (s / 2 - 0.1, 0.4, h + 0.1), M["obsidian_in"], seed=32, rough=0.35),
              cutter("b2", (0.9, 0.9, 1.6), (s / 2, -s / 2, 1.2), M["obsidian_in"], seed=33, rough=0.35),
              cutter("b3", (0.8, 1.0, 0.9), (-s / 2, 0.6, h), M["obsidian_in"], seed=34, rough=0.35)]
        o = bite(o, cs)
        # crystal shards left standing out of the broken top, their feet in the block
        out = [o]
        for i, (x, y, hh, tilt, rz) in enumerate(((-0.45, 0.45, 1.25, 14, 30), (0.45, -0.35, 1.0, -18, 70),
                                                  (0.1, 0.85, 0.95, 20, -40), (-0.7, -0.3, 0.8, -12, 10))):
            out.append(cyl(f"crystal{i}", 0.42, hh, (x, y, h - 0.75), M["obsidian"], rot=(tilt, tilt * 0.5, rz), verts=5,
                           r2=0.0, bevel=0.0))
        return out
    return [o]


def stone_block(M, state):
    """Stone Block: a smooth pale stone block, narrower than the footprint, eight round studs round its top."""
    s, h = 2.3, 2.42
    if state == "destroyed":
        # Flash: a rounded heap of pale rubble in the middle of the square, a few stones round its foot
        out = [lump("heap", (2.1, 1.9, 0.55), (0.0, 0.05, 0), M["smooth"], seed=39, rough=0.18, sub=2, flat_shade=True)]
        for i, (x, y, sx, sy, sz) in enumerate(((-0.35, 0.15, 0.9, 0.8, 0.45), (0.45, -0.35, 0.8, 0.7, 0.4),
                                                 (0.4, 0.55, 0.8, 0.7, 0.36), (-0.55, -0.6, 0.7, 0.6, 0.34),
                                                 (0.95, 0.1, 0.6, 0.5, 0.3), (-0.95, 0.5, 0.55, 0.5, 0.28),
                                                 (0.0, -0.95, 0.6, 0.5, 0.26), (0.05, 0.05, 0.7, 0.6, 0.4))):
            o = lump(f"rock{i}", (sx, sy, sz), (x, y, 0), M["smooth" if i % 3 else "smooth_in"], seed=i + 40, rot=i * 37,
                     sub=1, flat_shade=True)
            settle(o, out)
            out.append(o)
        return out
    body = box("body", (s, s, h), (0, 0, 0), M["smooth"], bevel=0.16, segs=4)
    studs = []
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            if i == 0 and j == 0:
                continue
            p = (i * 0.72, j * 0.72, h - 0.01)
            studs.append(cyl(f"stud{i}{j}", 0.25, 0.17, p, M["stud"], bevel=0.09, verts=24))     # Flash: round knobs
    if state == "damaged":
        cs = [crack("crack0", (-0.3, -s / 2, h + 0.05), (0.1, -s / 2, 0.4), 0.5, 0.3, M["smooth_in"], 4, (0, -1, 0)),
              cutter("chip0", (1.3, 1.2, 1.1), (s / 2, -s / 2, h), M["smooth_in"], seed=41),
              cutter("chip1", (1.0, 1.3, 1.2), (s / 2, 0.5, 0.95), M["smooth_in"], seed=42),
              cutter("chip2", (1.1, 1.1, 1.1), (-s / 2, -s / 2, 1.1), M["smooth_in"], seed=45)]
        body = bite(body, cs)
        for k in ("stud1-1", "stud10"):
            o = bpy.data.objects.get(k)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)
        return alive([body] + studs)
    return [body] + studs


def magma(M, state):
    """Inferno Block level 1: a low dome of near-black volcanic rock, lava glowing in its cracks and spots, a soft
    orange glow on the ground round its foot and small flames licking up round it (Flash)."""
    s, H = 3.0, 1.25

    def dome(name, H, seed, a=s / 2):
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=34, y_segments=34, size=1.0)
        for v in bm.verts:
            x, y = v.co.x * a * 1.04, v.co.y * a * 1.04
            rr = (abs(x / a) ** 4 + abs(y / a) ** 4) ** 0.25
            z = H * max(0.0, 1.0 - rr ** 2.2) ** 0.6
            z += 0.08 * noise.noise(Vector((x, y, seed)) * 2.2) * (z > 0)
            v.co = Vector((x, y, max(0.0, z)))
        # no flat skirt beyond the foot (it was the hard glowing square)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z < 0.004 for v in f.verts)], context="FACES")
        ob = mesh_ob(name, bm, [M["lava"]], bevel=0.0)
        mo = ob.modifiers.new("solid", "SOLIDIFY")
        mo.thickness = 0.02
        return ob

    def glow(a, mat):
        g = box("glow", (2 * a + 1.8, 2 * a + 1.8, 0.004), (0, 0, 0.001), mat, bevel=0.0)
        g.visible_shadow = False
        return g

    def flames(a, n, hmin, hmax, seed, every=1.0):
        r = random.Random(seed)
        out = []
        for k in range(n):
            th = 2 * math.pi * (k + r.uniform(-0.3, 0.3)) / n
            c, sn = math.cos(th), math.sin(th)
            x = a * math.copysign(abs(c) ** 0.5, c) * r.uniform(0.97, 1.04)
            y = a * math.copysign(abs(sn) ** 0.5, sn) * r.uniform(0.97, 1.04)
            if r.random() > every:
                continue
            out_dir = math.degrees(math.atan2(y, x))
            f = cyl(f"flame{k}", r.uniform(0.06, 0.1), r.uniform(hmin, hmax), (x, y, 0.0), M["flame"],
                    rot=(0, r.uniform(8, 22), out_dir), verts=8, r2=0.0, bevel=0.0)
            f.visible_shadow = False
            out.append(f)
        return out

    if state == "destroyed":
        r = random.Random(13)
        out = [glow(1.1, M["glow_small"])]
        for i in range(3):
            for j in range(3):
                x, y = (i - 1) * 0.86 + r.uniform(-0.08, 0.08), (j - 1) * 0.86 + r.uniform(-0.08, 0.08)
                out.append(lump(f"plate{i}{j}", (0.95, 0.9, r.uniform(0.22, 0.36)), (x, y, 0.0), M["lava_dim"],
                                seed=i * 3 + j + 50, rough=0.18, rot=r.uniform(0, 60), sub=1, flat_shade=True))
        return out + flames(1.15, 22, 0.12, 0.26, 3, every=0.6)
    if state == "damaged":
        # the dome caved in lower, broken rocks heaped on it
        d = dome("dome", H * 0.7, 2.0)
        out = [d, lump("rock0", (0.7, 0.6, 0.45), (-0.3, -0.45, 0.03), M["lava"], seed=53),
               lump("rock1", (0.55, 0.5, 0.4), (0.7, 0.55, 0.03), M["lava"], seed=54),
               lump("rock2", (0.5, 0.45, 0.35), (-1.0, 0.7, 0.03), M["lava"], seed=55)]
        for o in out[1:]:
            settle(o, [d])
        return out + [glow(s / 2, M["glow"])] + flames(s / 2, 40, 0.14, 0.34, 2, every=0.8)
    return [dome("dome", H, 1.0), glow(s / 2, M["glow"])] + flames(s / 2, 52, 0.18, 0.48, 1)


def settle(o, under):
    """Lower or lift o so it rests on the `under` parts (or the ground) below its lowest points, sunk 0.02 in."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    trees = []
    for u in under:
        ev = u.evaluated_get(dg)
        me = ev.to_mesh()
        trees.append(BVHTree.FromPolygons([ev.matrix_world @ v.co for v in me.vertices], [p.vertices[:] for p in me.polygons]))
        ev.to_mesh_clear()
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    zmin = min(v.z for v in vs)
    dz = -zmin
    for v in vs:
        if v.z > zmin + 0.3:
            continue
        for t in trees:
            loc = t.ray_cast(v + Vector((0, 0, 5)), Vector((0, 0, -1)))[0]
            if loc is not None:
                dz = max(dz, loc.z - v.z)
    o.location.z += dz - (0.02 if dz > -zmin + 1e-4 else 0.0)
    return o


def alive(obs):
    out = []
    for o in obs:
        try:
            if o.name in bpy.data.objects:
                out.append(o)
        except ReferenceError:
            pass
    return out


def cross_slab(M, state):
    """Inferno Block level 2 (Flash): a chunky block in a 3 x 3 grid. A raised cross of brown-grey stone, its arms
    along the footprint's edges, strongly lit on top and dark down its far sides; dark sooty stone cubes, a little
    lower, in the four corners; a thin bronze spike in the middle and four white bolt studs on the arms."""
    s = 2.8
    c = s / 3
    hx, hc = 1.22, 1.12

    def plus(name, h, mat, bevel, L=s, W=c):
        a = box(name + "a", (L, W, h), (0, 0, 0), mat, bevel=0.0)
        b = box(name + "b", (W, L, h), (0, 0, 0), mat, bevel=0.0)
        mo = a.modifiers.new("u", "BOOLEAN")
        mo.operation, mo.solver, mo.object = "UNION", "EXACT", b
        a = bake(a)
        bpy.data.objects.remove(b, do_unlink=True)
        mo = a.modifiers.new("bevel", "BEVEL")
        mo.width, mo.segments, mo.limit_method = bevel, 2, "ANGLE"
        a.name = name
        return bake(a)

    def corners(h):
        return [box(f"corner{i}", (c + 0.03, c + 0.03, h), (x * c, y * c, 0), M["ibase"], bevel=0.05)
                for i, (x, y) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1)))]

    if state == "destroyed":
        cross = plus("cross", 0.34, M["icap"], 0.05)
        cross = bite(cross, [cutter("b0", (1.2, 1.0, 0.8), (1.1, 0.0, 0.35), M["icap_in"], seed=61, rough=0.3)])
        cs = corners(0.26)
        cs[1] = bite(cs[1], [cutter("b1", (0.8, 0.8, 0.5), (c + 0.2, -c - 0.2, 0.3), M["icap_in"], seed=66, rough=0.3)])
        out = [cross] + cs
        r = random.Random(4)
        for i, (x, y) in enumerate(((-0.35, 0.2), (0.4, 0.35), (-0.2, -0.45), (0.9, -0.85), (-0.95, 0.9), (0.95, 0.95))):
            o = lump(f"cap{i}", (0.7, 0.55, 0.2), (x, y, 0), M["icap" if i % 2 else "ibase"], seed=62 + i, rough=0.15,
                     rot=r.uniform(0, 90), sub=1, flat_shade=True)
            settle(o, out)
            out.append(o)
        return out
    cross = plus("cross", hx, M["icap"], 0.06)
    cs = corners(hc)
    spike = cyl("spike", 0.12, 1.0, (0, 0, hx - 0.02), M["bronze"], r2=0.0, verts=12, bevel=0.0)
    collar = cyl("collar", 0.19, 0.08, (0, 0, hx - 0.02), M["bronze"], verts=16, bevel=0.02)
    studs = [cyl(f"stud{i}", 0.09, 0.07, (0.62 * x, 0.62 * y, hx - 0.02), M["rivet"], verts=12, bevel=0.03)
             for i, (x, y) in enumerate(((1, 0), (0, 1), (-1, 0), (0, -1)))]
    # the arms are slabs laid against the middle square: dark seams where they meet it (Flash)
    for i, (x, y, sx, sy) in enumerate(((c / 2, 0, 0.05, c - 0.12), (-c / 2, 0, 0.05, c - 0.12), (0, c / 2, c - 0.12, 0.05),
                                        (0, -c / 2, c - 0.12, 0.05))):
        studs.append(box(f"seam{i}", (sx, sy, 0.03), (x, y, hx - 0.02), M["ibase"], bevel=0.0))
    if state == "damaged":
        # the front corner cube smashed, the right arm's end broken (pale broken stone), the spike snapped, a piece
        # of the arm at the foot
        cs[1] = bite(cs[1], [cutter("b1", (1.0, 1.0, 1.3), (c + 0.25, -c - 0.25, 0.8), M["icap_in"], seed=63, rough=0.3)])
        cross = bite(cross, [cutter("b2", (0.9, 1.0, 0.9), (s / 2, 0.0, hx), M["icap_in"], seed=64, rough=0.3),
                             cutter("b3", (0.7, 0.6, 0.5), (-0.2, -s / 2, hx), M["icap_in"], seed=67, rough=0.3)])
        bpy.data.objects.remove(spike, do_unlink=True)
        stub = cyl("spikestub", 0.12, 0.28, (0, 0, hx - 0.02), M["bronze"], r2=0.07, verts=12, bevel=0.0)
        bpy.data.objects.remove(studs[0], do_unlink=True)
        loose = lump("capbit", (0.55, 0.45, 0.22), (1.05, -0.45, 0), M["icap"], seed=65, sub=1, flat_shade=True, rot=20)
        settle(loose, [cross] + cs)
        return alive([cross, collar, stub, loose] + cs + studs)
    return [cross, spike, collar] + cs + studs


def spiked(M, state):
    """Inferno Block level 3: a glossy dark steel block, a thick lip round its top standing out a little, nine small
    dark steel pyramid spikes inside it, two of them with small white tips (Flash)."""
    s, h = 2.85, 2.4
    lip_w, lip_h, over = 0.22, 0.36, 0.04
    if state == "destroyed":
        stub = box("stub", (s - 0.1, s - 0.1, 0.4), (0, 0, 0), M["iron"], bevel=0.06)
        stub = bake(stub)
        stub = bite(stub, [cutter("b0", (1.6, 1.4, 0.9), (0.9, -0.9, 0.55), M["iron_in"], seed=71, rough=0.3)])
        out = [stub]
        r = random.Random(7)
        spots = ((-0.5, 0.4, 0.4), (0.4, 0.5, 0.4), (-0.6, -0.5, 0.4), (0.3, -0.3, 0.4), (0.9, 0.2, 0.4), (0.2, -0.8, 0.4))
        for i, (x, y, z) in enumerate(spots):
            mt = M["iron_tip"] if i in (1, 3) else M["iron_dark"]
            p = pyramid(f"spike{i}", 0.56, 0.58, (x, y, 0), mt, rot=r.uniform(0, 90))
            if i >= 4:
                p.rotation_euler = (math.radians(90), 0, math.radians(r.uniform(0, 180)))
            drop(p, z)
            settle(p, out)
            out.append(p)
        plate = box("plate", (1.2, 0.5, 0.1), (-0.5, 0.1, 0), M["iron"], rot=(0, 0, 70), bevel=0.02)
        settle(plate, out)
        return out + [plate]
    body = box("body", (s - 2 * over, s - 2 * over, h - lip_h + 0.02), (0, 0, 0), M["iron"], bevel=0.12, segs=4)
    L, z0 = s, h - lip_h
    lip = []
    for i, (x, y, sx, sy) in enumerate(((0, -L / 2 + lip_w / 2, L, lip_w), (0, L / 2 - lip_w / 2, L, lip_w),
                                         (-L / 2 + lip_w / 2, 0, lip_w, L - 2 * lip_w + 0.02),
                                         (L / 2 - lip_w / 2, 0, lip_w, L - 2 * lip_w + 0.02))):
        lip.append(box(f"lip{i}", (sx, sy, lip_h), (x, y, z0), M["iron"], bevel=0.06))
    floor = box("floor", (L - 2 * lip_w + 0.04, L - 2 * lip_w + 0.04, 0.08), (0, 0, z0 + 0.14), M["iron_dark"], bevel=0.0)
    spikes = []
    step = (s - 2 * lip_w) / 3
    for i in range(3):
        for j in range(3):
            x, y = -s / 2 + lip_w + (i + 0.5) * step, -s / 2 + lip_w + (j + 0.5) * step
            mt = M["iron_tip"] if (i, j) in ((1, 1), (2, 0)) else M["iron_dark"]
            spikes.append(pyramid(f"spike{i}{j}", step * 0.88, 0.95, (x, y, z0 + 0.2), mt))
    lip.append(floor)
    if state == "damaged":
        # the sides battered in (two dents, the bent iron bright where it tore) and two spikes snapped off
        body = bite(body, [cutter("d0", (1.3, 0.8, 1.2), (0.3, -s / 2 - 0.1, 0.9), M["iron_in"], seed=72, rough=0.3),
                           cutter("d1", (0.8, 1.2, 1.1), (s / 2 + 0.1, 0.5, 1.4), M["iron_in"], seed=73, rough=0.3)])
        for k in ("spike20", "spike12"):
            o = bpy.data.objects.get(k)
            bpy.data.objects.remove(o, do_unlink=True)
        return alive([body] + lip + spikes)
    return [body] + lip + spikes


LOOKS = {"block1": crate, "block2": granite, "block3": cobbled, "block4": gold, "block5": obsid, "stone": stone_block,
         "inferno1": magma, "inferno2": cross_slab, "inferno3": spiked}


# ------------------------------------------------------------------------------------------------------------ checks
def contact():
    """Every part's least distance to the ground or to any other part (evaluated meshes)."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    obs = []
    for o in SC.objects:
        if o.type != "MESH" or o.name == "ground" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        vs = [ev.matrix_world @ v.co for v in me.vertices]
        obs.append((o.name, BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs))
        ev.to_mesh_clear()
    worst = 0.0
    touch = {name: set() for name, _, _ in obs}
    for name, t, vs in obs:
        best = abs(min(v.z for v in vs))
        for n2, t2, _ in obs:
            if n2 == name:
                continue
            d = 0.0 if t.overlap(t2) else min((h[3] for h in (t2.find_nearest(v, 0.5) for v in vs[::2])
                                               if h[0] is not None), default=9.0)
            if d <= 0.03:
                touch[name].add(n2)
                touch[n2].add(name)
            best = min(best, d)
        worst = max(worst, best)
        c = sum(vs, Vector()) / len(vs)
        print("CONTACT %-14s gap %.3f %s  at %.2f %.2f %.2f" % (name, best, "FLOAT" if best > 0.03 else "ok", *c))
    # every part must reach the ground through parts that touch: nothing held up by a part that itself floats
    held = {name for name, _, vs in obs if min(v.z for v in vs) <= 0.03}
    todo = list(held)
    while todo:
        for n2 in touch[todo.pop()]:
            if n2 not in held:
                held.add(n2)
                todo.append(n2)
    for name, _, _ in obs:
        if name not in held:
            print("CONTACT %-14s NOT CONNECTED TO THE GROUND" % name)
    print("CONTACT worst gap %.3f, parts not reaching the ground: %d" % (worst, len(obs) - len(held)))
    # how far the parts reach out from the middle (the footprint's half side is 1.415; glow and flames may pass it)
    far = max((max(abs(v.x), abs(v.y)), name) for name, _, vs in obs if not name.startswith(("glow", "flame")) for v in vs)
    print("CONTACT furthest part %s reaches %.3f (footprint 1.415)" % (far[1], far[0]))


def clear(keep):
    for o in list(SC.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


def main():
    G["setup"](SC)
    keep = set(SC.objects)
    M = mats()
    out = HERE / ("work" if MODE == "prev" else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    for st in STATES:
        clear(keep)
        LOOKS[LOOK](M, st)
        bpy.data.objects["ground"].hide_render = False
        if MODE == "check":
            print("STATE", LOOK, st)
            contact()
            continue
        if MODE == "prev":
            sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 24))
            sc.render.filepath = str(out / f"prev-{LOOK}-{st}.png")
            bpy.ops.render.render(write_still=True)
        else:
            sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 128))
            sc.render.filepath = str(out / f"{LOOK}-{st}-base.png")
            bpy.ops.render.render(write_still=True)
            bpy.data.objects["ground"].hide_render = True
            sc.cycles.samples = 24
            sc.render.filepath = str(out / f"{LOOK}-{st}-alone.png")
            bpy.ops.render.render(write_still=True)
        print("DONE", LOOK, st, MODE)


main()
