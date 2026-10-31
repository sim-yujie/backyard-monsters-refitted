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


def lava_rock(name, glow=1.0, cracks=4.0, foot=True):
    """The Inferno's dark volcanic rock with orange lava glowing in its cracks, brighter low down."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    vo = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
    vo.inputs["Scale"].default_value = cracks
    t.link(v, vo.inputs["Vector"])
    crack = t.ramp(vo.outputs["Distance"], [(0.01, (1, 1, 1, 1)), (0.05, (0, 0, 0, 1))])
    geo = t.n("ShaderNodeNewGeometry")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(geo.outputs["Position"], sep.inputs[0])
    low = t.ramp(sep.outputs["Z"], [(0.05, (1, 1, 1, 1)), (0.3, (0, 0, 0, 1))])
    amt = t.mix(crack, low, 1.0, "MULTIPLY")
    band = t.ramp(sep.outputs["Z"], [(0.03, (1, 1, 1, 1)), (0.22, (0, 0, 0, 1))])     # the foot glows all round
    if foot:
        amt = t.mix(amt, band, 1.0, "LIGHTEN")
    rock = t.mix(srgb(30, 24, 24), srgb(84, 52, 40), t.ramp(t.noise(v, 6, 4.0, 0.6), [(0.4, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))]))
    rock = t.mix(rock, srgb(170, 62, 26), t.ramp(t.noise(v, 11, 3.0, 0.6), [(0.62, (0, 0, 0, 1)), (0.72, (1, 1, 1, 1))]))
    col = t.mix(rock, srgb(255, 110, 20), amt)
    t.set(**{"Base Color": col, "rough": 0.8, "spec": 0.3, "Emission Color": srgb(255, 96, 16)})
    em = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(amt, em.inputs[0])
    em.inputs[1].default_value = 6.0 * glow
    t.link(em.outputs[0], t.bsdf.inputs["Emission Strength"])
    t.bump(vo.outputs["Distance"], 0.6, 0.04)
    MATS[name] = t.m
    return t.m


def obsidian(name):
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    cell = t.n("ShaderNodeTexVoronoi")
    cell.inputs["Scale"].default_value = 1.3
    t.link(v, cell.inputs["Vector"])
    col = t.ramp(cell.outputs["Color"], [(0.0, srgb(8, 8, 10)), (0.7, srgb(14, 14, 18)), (0.86, srgb(60, 62, 72)),
                                         (1.0, srgb(150, 152, 164))])
    t.set(**{"Base Color": col, "rough": 0.2, "spec": 0.45})
    MATS[name] = t.m
    return t.m


def mats():
    return {
        "wood_side": wood("crate-side", (150, 104, 62), (92, 60, 36), "X", rings=7, dirt=0.3),
        "wood_side_y": wood("crate-side", (150, 104, 62), (92, 60, 36), "Y", rings=7, dirt=0.3),
        "wood_frame": wood("crate-frame", (128, 86, 50), (78, 50, 30), "Z", rings=7, dirt=0.3),
        "wood_frame_x": wood("crate-frame", (128, 86, 50), (78, 50, 30), "X", rings=7, dirt=0.3),
        "wood_frame_y": wood("crate-frame", (128, 86, 50), (78, 50, 30), "Y", rings=7, dirt=0.3),
        "wood_top": wood("crate-top", (222, 186, 136), (176, 136, 92), "X", rings=7, dirt=0.15),
        "wood_top_y": wood("crate-top", (222, 186, 136), (176, 136, 92), "Y", rings=7, dirt=0.15),
        "wood_raw": flat("wood-raw", (186, 146, 100), rough=0.9),
        "wood_dark": flat("crate-inside", (52, 34, 22), rough=0.95),
        "granite": painted("granite", (96, 100, 116), rough=0.85, wear=(146, 148, 160), rust=(56, 58, 68), rust_at=0.55,
                           top=(150, 150, 158), scale=11.0, dirt=0.4, spec=0.3, ao_min=0.6),
        "granite_in": stone("granite-in", (160, 160, 168), (186, 186, 194), scale=14.0, dirt=0.05),
        "cobble": cobble("cobble"),
        "lattice": lattice("lattice"),
        "gold": shiny("gold", (255, 200, 50), rough=0.3, metal=0.25, dirt=0.04, side=0.15, scale=1.0, coat=0.6),
        "gold_in": shiny("gold-in", (214, 150, 40), rough=0.45, metal=0.6, dirt=0.05),
        "gold_top": shiny("gold-top", (255, 204, 52), rough=0.25, metal=0.25, dirt=0.0, scale=1.0, coat=0.6),
        "obsidian": obsidian("obsidian"),
        "obsidian_in": shiny("obsidian-in", (96, 96, 108), rough=0.35, metal=0.0, dirt=0.1),
        "smooth": stone("smoothstone", (146, 148, 160), (160, 162, 172), top=(196, 196, 204), scale=4.0, dirt=0.3, rough=0.6),
        "smooth_in": stone("smoothstone-in", (176, 176, 184), (196, 196, 204), scale=12.0, dirt=0.05),
        "stud_hole": flat("stud-hole", (90, 92, 100), rough=0.8),
        "lava": lava_rock("lava"),
        "lava_dim": lava_rock("lava-dim", glow=0.25, foot=False),
        "lava_glow": flat("lava-glow", (255, 100, 16), rough=0.6, emit=1.6),
        "ibase": painted("ibase", (48, 42, 38), rough=0.7, wear=(98, 86, 74), scale=6.0, dirt=0.35, soot=0.5),
        "icap": painted("icap", (104, 94, 80), rough=0.75, wear=(134, 122, 104), scale=6.0, dirt=0.15),
        "icap_in": painted("icap-in", (160, 150, 134), rough=0.85, scale=10.0, dirt=0.0),
        "bronze": shiny("bronze", (176, 120, 50), rough=0.35, metal=0.9, dirt=0.1),
        "rivet": shiny("rivet", (210, 206, 196), rough=0.3, metal=0.9, dirt=0.0),
        "iron": shiny("iron", (132, 124, 120), rough=0.26, metal=0.85, wear=(130, 122, 118), dirt=0.3, side=0.3),
        "iron_dark": shiny("iron-dark", (50, 46, 46), rough=0.4, metal=0.85, dirt=0.2),
        "iron_in": shiny("iron-in", (100, 94, 90), rough=0.5, metal=0.8, dirt=0.05),
        "bone": painted("bone", (236, 226, 214), rough=0.45, wear=(250, 244, 236), dirt=0.05, spec=0.5),
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
    Ld = (s - 2 * b) / math.cos(math.radians(22)) - 0.1
    lbrace = box("lidbrace", (Ld, b * 0.85, 0.12), (0, 0, h - b + 0.06 + t), M["wood_top"], rot=(0, 0, 22), bevel=0.02)
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
        r = random.Random(5)
        out = []
        for i, (x, y, sx, sy, sz) in enumerate(((-0.2, 0.1, 1.9, 1.4, 0.45), (0.8, -0.5, 1.3, 1.0, 0.35),
                                                 (-0.85, -0.6, 1.2, 0.9, 0.3), (0.6, 0.85, 1.2, 1.0, 0.32),
                                                 (-0.75, 0.8, 1.0, 0.8, 0.25), (1.0, 0.3, 0.8, 0.7, 0.22),
                                                 (0.15, -0.95, 1.0, 0.7, 0.22))):
            out.append(lump(f"rock{i}", (sx, sy, sz), (x, y, 0), M["granite"], seed=i + 1, rot=r.uniform(0, 90), sub=1,
                            flat_shade=True))
        top = lump("rocktop", (0.7, 0.6, 0.25), (-0.1, 0.0, 0.0), M["granite"], seed=11, sub=1, flat_shade=True)
        settle(top, out)
        return out + [top]
    o = rough_box("granite", (s, s, h), M["granite"], amp=0.12, freq=1.6, seed=2, bevel=0.1)
    if state == "damaged":
        cs = [crack("crack0", (-0.5, -s / 2, h + 0.05), (-0.2, -s / 2, 0.5), 0.6, 0.4, M["granite_in"], 1, (0, -1, 0)),
              crack("crack1", (s / 2, 0.45, h + 0.05), (s / 2, 0.8, 0.7), 0.6, 0.36, M["granite_in"], 2, (1, 0, 0)),
              cutter("chip", (1.1, 1.1, 0.9), (-s / 2 + 0.15, -s / 2 + 0.15, h), M["granite_in"], seed=4)]
        return [bite(o, cs)]
    return [o]


def cobbled(M, state):
    """Block level 3: cobbled sides under a white lattice-patterned slab."""
    s, h, t = 2.8, 2.18, 0.24
    if state == "destroyed":
        # the slab dropped flat to the ground, a few cobbles beside it
        slab = box("slab", (s - 0.05, s - 0.05, t), (0, 0, 0), M["lattice"], bevel=0.04)
        slab = bite(slab, [crack("split", (-1.6, 0.3, t + 0.1), (1.6, -0.2, t + 0.1), t + 0.2, 0.12, M["cobble"], 5, (0, 0, 1))])
        out = [slab]
        for i, (x, y) in enumerate(((0.9, -0.7), (-0.6, 0.8), (0.75, 0.75))):
            o = lump(f"cob{i}", (0.42, 0.38, 0.26), (x, y, 0), M["cobble"], seed=i + 3, sub=1, flat_shade=True)
            settle(o, [slab])
            out.append(o)
        return out
    body = rough_box("body", (s - 0.04, s - 0.04, h), M["cobble"], amp=0.04, freq=2.5, seed=3, bevel=0.04)
    slab = box("slab", (s, s, t), (0, 0, h - 0.01), M["lattice"], bevel=0.04)
    if state == "damaged":
        # the right corner smashed off, top and side (as Flash), the broken stone pale; its pieces at the foot
        at = (s / 2 - 0.15, s / 2 - 0.35, h - 0.15)
        body = bite(body, [cutter("smash", (2.4, 2.3, 2.0), at, M["cobble"], seed=8, rough=0.3)])
        slab = bite(slab, [cutter("smash2", (2.4, 2.3, 2.0), at, M["cobble"], seed=8, rough=0.3)])
        return [body, slab]
    return [body, slab]


def gold(M, state):
    """Block level 4: a polished gold block, a raised rim round its top and nine pyramids inside it."""
    s, h = 2.78, 1.95
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
        rim.append(box(f"rim{i}", (sx, sy, rim_h), (x, y, h - 0.02), M["gold"], bevel=0.03))
    pyrs = []
    step = (s - 2 * rim_w) / 3
    for i in range(3):
        for j in range(3):
            x, y = -s / 2 + rim_w + (i + 0.5) * step, -s / 2 + rim_w + (j + 0.5) * step
            pyrs.append(pyramid(f"pyr{i}{j}", step * 0.98, 0.78, (x, y, h - 0.02), M["gold_top"]))
    if state == "damaged":
        # two pyramids knocked off (one lies at the foot), the front corner dented
        for k in ("pyr20", "pyr11"):
            o = next(p for p in pyrs if p.name == k)
            bpy.data.objects.remove(o, do_unlink=True)
        stub = pyramid("pyrstub", step * 0.98, 0.25, (-s / 2 + rim_w + 2.5 * step, -s / 2 + rim_w + 0.5 * step, h - 0.02), M["gold_in"])
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
        r = random.Random(9)
        out = []
        for i in range(12):
            x = -1.0 + (i % 4) * 0.67 + r.uniform(-0.15, 0.15)
            y = -0.85 + (i // 4) * 0.85 + r.uniform(-0.15, 0.15)
            o = lump(f"shard{i}", (r.uniform(0.7, 1.0), r.uniform(0.4, 0.6), r.uniform(0.2, 0.42)),
                     (x, y, 0), M["obsidian"], seed=i + 20, rough=0.35, sub=1, flat_shade=True, rot=r.uniform(0, 180))
            out.append(o)
        return out
    o = rough_box("obsidian", (s, s, h), M["obsidian"], amp=0.22, freq=0.9, seed=5, cuts=2, bevel=0.03, flat_shade=True)
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
        out = []
        for i, (x, y, sx, sy, sz) in enumerate(((-0.35, 0.15, 1.2, 1.0, 0.55), (0.5, -0.4, 1.0, 0.9, 0.45),
                                                 (0.45, 0.65, 1.0, 0.85, 0.42), (-0.6, -0.75, 0.8, 0.7, 0.38),
                                                 (1.0, 0.1, 0.7, 0.6, 0.32))):
            out.append(lump(f"rock{i}", (sx, sy, sz), (x, y, 0), M["smooth"], seed=i + 40, rot=i * 37, sub=1,
                            flat_shade=True))
        top = lump("rocktop", (0.6, 0.5, 0.35), (0.05, 0.0, 0), M["smooth_in"], seed=46, sub=1, flat_shade=True)
        settle(top, out)
        return out + [top]
    body = box("body", (s, s, h), (0, 0, 0), M["smooth"], bevel=0.16, segs=4)
    studs = []
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            if i == 0 and j == 0:
                continue
            p = (i * 0.72, j * 0.72, h - 0.01)
            studs.append(cyl(f"stud{i}{j}", 0.24, 0.16, p, M["smooth"], bevel=0.03, verts=20))
            studs.append(cyl(f"studhole{i}{j}", 0.12, 0.02, (p[0], p[1], h + 0.14), M["stud_hole"], bevel=0.0, verts=16))
    if state == "damaged":
        cs = [crack("crack0", (-0.3, -s / 2, h + 0.05), (0.1, -s / 2, 0.4), 0.5, 0.3, M["smooth_in"], 4, (0, -1, 0)),
              cutter("chip0", (1.3, 1.2, 1.1), (s / 2, -s / 2, h), M["smooth_in"], seed=41),
              cutter("chip1", (1.0, 1.3, 1.2), (s / 2, 0.5, 0.95), M["smooth_in"], seed=42),
              cutter("chip2", (1.1, 1.1, 1.1), (-s / 2, -s / 2, 1.1), M["smooth_in"], seed=45)]
        body = bite(body, cs)
        for k in ("stud1-1", "studhole1-1", "stud10", "studhole10"):
            o = bpy.data.objects.get(k)
            if o:
                bpy.data.objects.remove(o, do_unlink=True)
        return alive([body] + studs)
    return [body] + studs


def magma(M, state):
    """Inferno Block level 1: a low dome of dark volcanic rock, lava glowing in its cracks and round its foot."""
    s, H = 3.0, 1.25

    def dome(name, H, seed):
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=30, y_segments=30, size=1.0)
        for v in bm.verts:
            x, y = v.co.x * s / 2, v.co.y * s / 2
            rr = (abs(x / (s / 2)) ** 4 + abs(y / (s / 2)) ** 4) ** 0.25
            z = H * max(0.0, 1.0 - rr ** 2.2) ** 0.6
            z += 0.08 * noise.noise(Vector((x, y, seed)) * 2.2) * (z > 0)
            v.co = Vector((x, y, max(0.0, z)))
        ob = mesh_ob(name, bm, [M["lava"]], bevel=0.0)
        mo = ob.modifiers.new("solid", "SOLIDIFY")
        mo.thickness = 0.02
        return ob

    glow = box("glow", (s + 0.06, s + 0.06, 0.03), (0, 0, 0), M["lava_glow"], bevel=0.0)
    if state == "destroyed":
        r = random.Random(13)
        glow.scale = (0.6, 0.6, 1.0)
        out = [glow]
        for i in range(3):
            for j in range(3):
                x, y = (i - 1) * 0.92 + r.uniform(-0.08, 0.08), (j - 1) * 0.92 + r.uniform(-0.08, 0.08)
                out.append(lump(f"plate{i}{j}", (1.05, 1.0, r.uniform(0.2, 0.34)), (x, y, 0.0), M["lava_dim"],
                                seed=i * 3 + j + 50, rough=0.18, rot=r.uniform(0, 60), sub=1, flat_shade=True))
        return out
    if state == "damaged":
        # the dome caved in lower, broken rocks heaped on it
        d = dome("dome", H * 0.7, 2.0)
        out = [glow, d, lump("rock0", (0.7, 0.6, 0.45), (-0.3, -0.45, 0.03), M["lava"], seed=53),
               lump("rock1", (0.55, 0.5, 0.4), (0.7, 0.55, 0.03), M["lava"], seed=54),
               lump("rock2", (0.5, 0.45, 0.35), (-1.0, 0.7, 0.03), M["lava"], seed=55)]
        for o in out[2:]:
            settle(o, [d])
        bpy.data.objects.remove(glow, do_unlink=True)
        return out[1:]
    bpy.data.objects.remove(glow, do_unlink=True)
    return [dome("dome", H, 1.0)]


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
    """Inferno Block level 2: a low cross-shaped slab (arms toward the footprint's corners), dark sooty sides under a
    pale stone cap, a bronze spike and four rivets in the middle."""
    L, W, hb, hc = 3.6, 1.85, 1.0, 0.28

    def plus(name, L, W, z0, h, mat, bevel):
        a = box(name + "a", (L, W, h), (0, 0, z0), mat, rot=(0, 0, 45), bevel=0.0)
        b = box(name + "b", (L, W, h), (0, 0, z0), mat, rot=(0, 0, -45), bevel=0.0)
        mo = a.modifiers.new("u", "BOOLEAN")
        mo.operation, mo.solver, mo.object = "UNION", "EXACT", b
        a = bake(a)
        bpy.data.objects.remove(b, do_unlink=True)
        mo = a.modifiers.new("bevel", "BEVEL")
        mo.width, mo.segments, mo.limit_method = bevel, 2, "ANGLE"
        a.name = name
        return a

    if state == "destroyed":
        base = plus("base", L, W, 0.0, 0.36, M["ibase"], 0.05)
        base = bake(base)
        c = cutter("b0", (1.4, 1.2, 1.0), (0.9, -0.9, 0.4), M["icap_in"], seed=61, rough=0.3)
        base = bite(base, [c])
        out = [base]
        r = random.Random(4)
        for i, (x, y) in enumerate(((-0.35, 0.2), (0.4, 0.35), (-0.2, -0.45), (0.95, -0.95), (1.5, -0.3))):
            o = lump(f"cap{i}", (0.8, 0.6, 0.18), (x, y, 0), M["icap"], seed=62 + i, rough=0.15, rot=r.uniform(0, 90), sub=1,
                     flat_shade=True)
            settle(o, [base])
            out.append(o)
        return out
    base = plus("base", L, W, 0.0, hb, M["ibase"], 0.06)
    cap = plus("cap", L - 0.1, W - 0.12, hb - 0.02, hc, M["icap"], 0.08)
    spike = cyl("spike", 0.13, 0.75, (0, 0, hb + hc - 0.04), M["bronze"], r2=0.0, verts=12, bevel=0.0)
    collar = cyl("collar", 0.2, 0.08, (0, 0, hb + hc - 0.04), M["bronze"], verts=16, bevel=0.02)
    rivets = [cyl(f"rivet{i}", 0.07, 0.05, (0.55 * math.cos(math.radians(a)), 0.55 * math.sin(math.radians(a)), hb + hc - 0.04),
                  M["rivet"], verts=10, bevel=0.015) for i, a in enumerate((45, 135, 225, 315))]
    grooves = [box(f"groove{i}", (1.1, 0.07, 0.04), (1.05 * math.cos(math.radians(a)), 1.05 * math.sin(math.radians(a)), hb + hc - 0.05),
                   M["ibase"], rot=(0, 0, a), bevel=0.0) for i, a in enumerate((45, 135, 225, 315))]
    parts = [base, cap, spike, collar] + rivets + grooves
    if state == "damaged":
        # the front arm's tip broken off (pale broken stone), the spike snapped, a piece of cap at the foot
        cap = bake(cap)
        c1 = cutter("b1", (1.1, 1.0, 1.4), (1.35, -1.35, 0.6), M["icap_in"], seed=63, rough=0.3)
        c2 = cutter("b2", (1.1, 1.0, 1.4), (1.35, -1.35, 0.6), M["icap_in"], seed=63, rough=0.3)
        base = bite(bake(base), [c1])
        cap = bite(cap, [c2])
        c3 = cutter("b3", (0.9, 0.8, 0.5), (-1.2, -1.15, hb + hc), M["icap_in"], seed=64, rough=0.3)
        cap = bite(cap, [c3])
        g = bpy.data.objects.get("groove3")
        if g:
            bpy.data.objects.remove(g, do_unlink=True)
        bpy.data.objects.remove(spike, do_unlink=True)
        stub = cyl("spikestub", 0.13, 0.3, (0, 0, hb + hc - 0.04), M["bronze"], r2=0.07, verts=12, bevel=0.0)
        loose = lump("capbit", (0.6, 0.5, 0.2), (0.95, -0.85, 0), M["icap"], seed=65, sub=1, flat_shade=True, rot=20)
        settle(loose, [base, cap])
        return alive([base, cap, collar, stub, loose] + rivets + grooves)
    return parts


def spiked(M, state):
    """Inferno Block level 3: a dark iron block with a lip round its top and nine pyramid spikes, the middle two bone
    white."""
    s, h = 2.85, 2.4
    lip_w, lip_h = 0.2, 0.22
    if state == "destroyed":
        stub = box("stub", (s - 0.1, s - 0.1, 0.4), (0, 0, 0), M["iron"], bevel=0.06)
        stub = bake(stub)
        stub = bite(stub, [cutter("b0", (1.6, 1.4, 0.9), (0.9, -0.9, 0.55), M["iron_in"], seed=71, rough=0.3)])
        out = [stub]
        r = random.Random(7)
        spots = ((-0.5, 0.4, 0.4), (0.4, 0.5, 0.4), (-0.6, -0.5, 0.4), (0.3, -0.3, 0.4), (0.9, 0.2, 0.4), (0.2, -0.8, 0.4))
        for i, (x, y, z) in enumerate(spots):
            m = M["bone"] if i in (1, 3) else M["iron_dark"]
            p = pyramid(f"spike{i}", 0.62, 0.7, (x, y, 0), m, rot=r.uniform(0, 90))
            if i >= 4:
                p.rotation_euler = (math.radians(90), 0, math.radians(r.uniform(0, 180)))
            drop(p, z)
            settle(p, out)
            out.append(p)
        plate = box("plate", (1.2, 0.5, 0.1), (-0.5, 0.1, 0), M["iron"], rot=(0, 0, 70), bevel=0.02)
        settle(plate, out)
        return out + [plate]
    body = box("body", (s, s, h), (0, 0, 0), M["iron"], bevel=0.14, segs=4)
    lip = []
    for i, (x, y, sx, sy) in enumerate(((0, -s / 2 + lip_w / 2, s, lip_w), (0, s / 2 - lip_w / 2, s, lip_w),
                                         (-s / 2 + lip_w / 2, 0, lip_w, s - 2 * lip_w), (s / 2 - lip_w / 2, 0, lip_w, s - 2 * lip_w))):
        lip.append(box(f"lip{i}", (sx, sy, lip_h), (x, y, h - 0.03), M["iron"], bevel=0.05))
    spikes = []
    step = (s - 2 * lip_w) / 3
    for i in range(3):
        for j in range(3):
            x, y = -s / 2 + lip_w + (i + 0.5) * step, -s / 2 + lip_w + (j + 0.5) * step
            m = M["bone"] if (i, j) in ((1, 1), (2, 0)) else M["iron_dark"]
            spikes.append(pyramid(f"spike{i}{j}", step * 0.95, 0.85, (x, y, h - 0.03), m))
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
