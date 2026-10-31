"""plandmg.py : the Yard Planner's damaged and destroyed looks in 3D, after Flash's top.1.damaged.png and
top.1.destroyed.png (one look for every level). The model (../planner.py) is built as it is, then broken: the same
parts, at the same camera and light. The owner asked for these two looks only loosely like Flash ("doesn't have to be
that close"): each clearly wrecked, Flash's idea, one pass.

    blender -b --factory-startup -P plandmg.py -- 1 <prev|still> <damaged|destroyed>

Damaged (Flash): the shade slumped down over the drum, dented, its top leaning right; the arm bent; the door gone
(a black doorway); ragged black holes in the stone; the block's back corner knocked off and its round window blown
into a dark hole; posts gone from the railing, one hanging off the deck's left edge; chips of brick, stone and cap on
the grass. Destroyed (Flash): a low ring of broken stone with a tall broken wall piece on the left; the shade lying on
its side on the heap, its neck to the right; the arm in a twisted heap beyond it; the block a broken shell with its
dark round hole; deck beams and posts sticking out of the heap in every direction.
"""
import math
import random
import re
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "planner.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
px, scr, cam_fwd, P, crumple_geo = G["px"], G["scr"], G["cam_fwd"], G["P"], G["crumple_geo"]
shiny = G["shiny"]
DZ = S.DECK_Z1
C = Vector(S.BASE_C + (0.0,))
R = random.Random(11)
UP = Vector((0, 0, 1))


# ------------------------------------------------------------------------------------------------------------ helpers
def named(pat):
    """Unparented objects whose name (without .001) matches the regex pat in full."""
    return [o for o in SC.objects if o.parent is None and re.fullmatch(pat, o.name.split(".")[0])]


def turn(obs, pivot, axis, deg, move=(0, 0, 0)):
    """Turn obs deg degrees round the line through pivot along axis (world), then move them."""
    bpy.context.view_layer.update()
    p = Vector(pivot)
    m = Matrix.Translation(p + Vector(move)) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ \
        Matrix.Translation(-p)
    for o in obs:
        o.matrix_world = m @ o.matrix_world
    return m


def rock(name, at, r, mat, squash=0.6, seed=0):
    """A broken lump: a jagged icosphere."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for v in bm.verts:
        v.co *= 1 + rr.uniform(-0.3, 0.25)
        v.co.z *= squash
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    G["COLL"].objects.link(o)
    o.data.materials.append(mat)
    o.location = at
    o.rotation_euler = (0, 0, rr.uniform(0, 6.3))
    return o


def hole(target, at, r, seed=0, squash=1.0):
    """Knock a ragged hole into target (a boolean cut by a jagged lump); the hole's inside is black, as Flash's."""
    c = rock(f"cut{seed}", at, r, inside(), squash=squash, seed=seed)
    c.display_type = "WIRE"
    c.hide_render = True
    if inside().name not in [m.name for m in target.data.materials if m]:
        target.data.materials.append(inside())     # so the cut faces (the cutter's material) render black
    m = target.modifiers.new("hole", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = c
    try:
        m.material_mode = "TRANSFER"
    except (AttributeError, TypeError):
        pass
    burn(at, r + 0.55)
    return c


def chip(at, size, mat, yaw, tilt=0.0):
    return box("chip", size, at, mat, rot=(R.uniform(-6, 6) + tilt, R.uniform(-8, 8), yaw), bevel=0.02,
               origin="center", jitter=0.02)


def blacken(obs):
    for o in obs:
        o.data.materials.clear()
        o.data.materials.append(inside())


def recolour(obs, mat):
    for o in obs:
        o.data.materials.clear()
        o.data.materials.append(mat)


def beam(name, a, b, w=0.22, t=0.14, mat=None):
    """A broken deck board from a to b (world), its ends charred."""
    o = along(name, a, b, (0, w, t), mat or M["deck"], roll=R.uniform(-30, 30))
    burn(b, 0.5)
    return o


def burnt_metals():
    return (shiny("shadeburnt", (40, 40, 44), rough=0.5, metal=0.2, wear=(22, 20, 20), scale=2.0, dirt=0.5, spec=0.4),
            shiny("armburnt", (20, 18, 18), rough=0.6, metal=0.2, wear=(40, 30, 24), scale=3.0, dirt=0.3),
            shiny("springburnt", (96, 104, 120), rough=0.45, metal=0.6, wear=(56, 50, 48), scale=3.0, dirt=0.4),
            shiny("postburnt", (104, 108, 122), rough=0.45, metal=0.6, wear=(56, 50, 48), scale=3.0, dirt=0.4))


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    G["build"]()
    base_ = named(r"base")[0]
    blk = named(r"block")[0]
    shade_burnt, arm_burnt, spring_burnt, post_burnt = burnt_metals()
    # the door blown in: a black doorway, its jambs charred
    blacken(named(r"door"))
    burn(C + P(S.DOOR_T, S.BASE_R, 1.4), 1.3)
    # ragged holes in the stone, different sizes, pale broken stone round the bigger ones
    for k, (th, z, r, sq) in enumerate(((-58, 1.9, 0.62, 0.8), (-22, 0.7, 0.42, 0.9), (-128, 2.7, 0.34, 1.0),
                                        (-80, 0.5, 0.26, 1.0), (-8, 2.6, 0.3, 0.8))):
        p = C + P(th, S.BASE_R + 0.15, z)
        hole(base_, p, r, seed=k, squash=sq)
    # the block: the back end of its +X parapet and the corner under it knocked off, its window blown out
    x1 = S.BLOCK[1]
    hole(named(r"paray")[0], Vector((x1, S.PARA_Y[1] - 0.2, DZ + S.PARA_H)), 0.75, seed=11, squash=1.2)
    hole(named(r"capy")[0], Vector((x1, S.PARA_Y[1] - 0.2, DZ + S.PARA_H)), 0.75, seed=11, squash=1.2)
    hole(blk, Vector((x1, S.BLOCK[3] - 0.25, DZ - 0.3)), 0.7, seed=12, squash=1.0)
    wy, wz, wr = S.WIN
    kill(named(r"winglow|winshade|winrim"))
    blacken(named(r"winhole"))
    hole(blk, Vector((x1, wy, wz)), wr * 1.5, seed=13, squash=1.1)
    hole(blk, Vector((x1, 1.2, 0.9)), 0.36, seed=14)
    hole(named(r"parax")[0], Vector((3.4, S.BLOCK[2], DZ + S.PARA_H)), 0.4, seed=15)
    # the shade slumped down over the drum, dented, its top leaning back to the right
    shade = named(r"shade|knob")
    rim = G["over_drum"](S.SHADE_RIM[0], S.SHADE_RIM[1])
    pivot = rim + Vector((-0.707, -0.707, 0)) * S.SHADE_RIM[2]
    sq = Matrix.Translation(rim) @ Matrix.Diagonal((1.12, 1.12, 0.78, 1)) @ Matrix.Translation(-rim)
    for o in shade:
        o.matrix_world = sq @ o.matrix_world        # slumped: lower and wider
    turn(shade, pivot, Vector((1, -1, 0)), -16, move=(0.1, -0.3, -0.75))
    crumple_geo(named(r"shade")[0], 1.4, 0.45, seed=3)
    # the drum squashed under it: lower, its upper windows gone
    kill(named(r"window\d1|wsash\d"))
    z0 = DZ
    sq = Matrix.Translation((0, 0, z0)) @ Matrix.Diagonal((1, 1, 0.6, 1)) @ Matrix.Translation((0, 0, -z0))
    for o in named(r"drum|window\d0"):
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(sq)
    recolour(named(r"shade"), shade_burnt)
    for k in range(4):
        burn(rim + Vector((R.uniform(-1.6, 1.6), R.uniform(-1.6, 1.6), R.uniform(-0.2, 1.8))), 0.8)
    # the drum's windows mostly dark
    blacken([o for o in named(r"window\d\d") if o.name[6] in "0124"])
    # the arm bent: the upper arm sags with the shade, the lower arm buckles out
    upper = named(r"armb|armt|arml|arme|armstub|spring|springend|jH0|jH1|jE0|jE1")
    lower = named(r"armf|armg")
    foot = px(*S.ARM_FOOT, Z=DZ)
    turn(upper, foot, Vector((1, -1, 0)), -6, move=(0.1, -0.2, -0.55))
    turn(lower, foot, Vector((1, -1, 0)), -6)
    recolour(upper + lower + named(r"afoot"), arm_burnt)
    recolour(named(r"spring|springend"), spring_burnt)
    burn(px(*S.ARM["E1"], Y=foot.y), 0.9)
    # the railing: posts gone at the left and the back, one post and its bit of wire hanging off the left edge
    gone = "|".join(str(k) for k in (3, 7, 8, 13, 17, 18, 23))
    kill(named(f"post({gone})|postcap({gone})"))
    edge = C + P(-165, S.DECK_R + 0.05, DZ - 0.1)
    loose = cyl("postloose", 0.055, S.RAIL_H, edge, post_burnt, verts=10, bevel=0.0)
    loose.rotation_euler = (math.radians(-70), 0, math.radians(-165 - 90))
    tip = edge + Vector((math.cos(math.radians(-165)), math.sin(math.radians(-165)), -0.35)) * S.RAIL_H
    tube("wireloose", [edge + Vector((0.3, 0.6, 0.25)), tip + Vector((0, 0, 0.1))], 0.018, M["wire"], verts=6)
    # chips on the grass: brick, stone, cap
    for k, (sx, sy, kind) in enumerate(((-26, 72, "stone"), (2, 76, "cap"), (14, 73, "brick"), (28, 71, "brick"),
                                        (54, 58, "brick"), (-12, 74, "stone"), (40, 66, "cap"))):
        p = px(sx, sy, Z=0.08)
        if kind == "stone":
            rock(f"lump{k}", p, 0.24, M["stone"], seed=30 + k)
        else:
            chip(p, (0.42, 0.24, 0.16), M["block"] if kind == "brick" else M["cap"], R.uniform(0, 180))
    burn(Vector((x1, 2.4, 2.4)), 1.2)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    shade_burnt, arm_burnt, spring_burnt, post_burnt = burnt_metals()
    base_ = named(r"base")[0]
    blk = named(r"block")[0]
    # the stone tower broken down to a low ring, black inside, a ragged top of broken wall pieces
    hz = S.BASE_H * 0.42
    base_.data.transform(Matrix.Translation(C) @ Matrix.Diagonal((1, 1, 0.42, 1)) @ Matrix.Translation(-C))
    cyl("hollow", S.BASE_R - 0.35, 0.1, C + Vector((0, 0, hz - 0.06)), inside(), verts=48, bevel=0.0)
    for k in range(24):
        th = -180 + 360 * k / 24 + R.uniform(-4, 4)
        if R.random() < 0.3:
            continue
        h = R.uniform(0.35, 1.1)
        box(f"wallbit{k}", (R.uniform(0.7, 1.0), R.uniform(0.32, 0.45), h), C + P(th, S.BASE_R - 0.2, hz - 0.15),
            M["stone"], rot=(R.uniform(-14, 14), R.uniform(-14, 14), th + 90), bevel=0.08, jitter=0.07,
            taper=R.uniform(0.6, 0.9))
    # a tall broken piece of the tower's wall still standing on the left
    box("wallbig", (1.3, 0.45, 2.9), C + P(-150, S.BASE_R - 0.25, hz - 0.2), M["stone"], rot=(4, -6, -150 + 90),
        bevel=0.1, jitter=0.12, taper=0.7)
    burn(C + P(-150, S.BASE_R, hz + 2.2), 0.9)
    for k in range(5):
        burn(C + P(R.uniform(-180, 180), R.uniform(0.5, 2.6), hz), 1.2)
    # gone: the decks, the drum and its windows, the railing, the door, the parapets and their caps
    kill(named(r"deck|deckp|drum|window\d\d|wsash\d|post\d+|postcap\d+|wire\d|door|jamb.*|lintel|parax|capx|paray|capy|"
               r"winglow|winshade|winrim|afoot"))
    # the block a broken shell: lower, its top and back corner broken, its window a dark hole
    x1 = S.BLOCK[1]
    BK = 0.62
    blk.data.transform(Matrix.Diagonal((1, 1, BK, 1)))
    blacken(named(r"winhole"))
    wy, wz, wr = S.WIN
    hole(blk, Vector((x1, wy, wz)), wr * 1.5, seed=21, squash=1.1)
    bt = DZ * BK
    for k, (x, y, r) in enumerate(((x1, 1.0, 1.0), (x1, S.BLOCK[3], 1.1), (2.6, S.BLOCK[2], 0.9), (x1, 2.6, 0.7),
                                   (3.6, S.BLOCK[2], 0.6), (1.4, S.BLOCK[3], 0.9))):
        hole(blk, Vector((x, y, bt + 0.1)), r, seed=22 + k, squash=1.3)
    rock("blockin", Vector((2.6, 2.5, bt - 0.2)), 0.9, inside(), squash=0.3, seed=29)
    # the shade lying on its side on the heap, its neck toward the block, dented and charred
    shade = named(r"shade|knob")
    rim = G["over_drum"](S.SHADE_RIM[0], S.SHADE_RIM[1])
    target = px(-8.0, 46.0, Z=hz + 1.4)
    turn(shade, rim, Vector((1, -1, 0)), -78, move=target - rim)
    turn(shade, target, UP, 30)
    crumple_geo(named(r"shade")[0], 1.0, 0.4, seed=5)
    recolour(shade, shade_burnt)
    for k in range(4):
        burn(target + Vector((R.uniform(-1.6, 1.6), R.uniform(-1.6, 1.6), R.uniform(-0.5, 1.5))), 0.9)
    # the arm in a twisted heap beyond the shade, along the block's top
    kill(named(r"arm.*|spring|springend|jH0|jH1|jE0|jE1"))
    a0 = Vector((2.2, 1.4, bt + 0.12))
    for k, (dx, dy, dz, ln, roll) in enumerate(((0.0, 0.0, 0.0, 4.6, 0), (0.2, 0.35, 0.25, 4.1, 30),
                                                 (-0.1, 0.6, -0.1, 3.4, -20), (0.4, 0.1, 0.45, 2.6, 60))):
        a = a0 + Vector((dx, dy, dz))
        d = Vector((0.55 + 0.1 * k, 0.75 - 0.08 * k, -0.18 + 0.1 * (k % 2))).normalized()
        along(f"armbit{k}", a, a + d * ln, (0, 0.18, 0.3), arm_burnt, roll=roll)
    tube("springbit", [a0 + Vector((0.6, 0.2, 0.55)), a0 + Vector((2.6, 2.2, 0.35))], 0.065, spring_burnt, verts=10)
    burn(a0 + Vector((1.5, 1.5, 0.3)), 1.4)
    # deck beams and posts sticking out of the heap in every direction, one end on the grass
    for k, (gx, gy, hx, hy, hzz) in enumerate(((-58, 58, -38, 44, 2.0), (-46, 74, -26, 58, 1.8), (-6, 84, -4, 60, 1.6),
                                               (-50, 30, -32, 40, 2.6), (-34, 22, -26, 38, 3.0), (34, 20, 26, 36, 3.0),
                                               (58, 52, 42, 52, 1.6), (18, 82, 8, 64, 1.4), (-24, 82, -14, 64, 1.2))):
        beam(f"beam{k}", px(gx, gy, Z=0.08), px(hx, hy, Z=hzz), w=R.uniform(0.18, 0.26))
    for k, (gx, gy, a) in enumerate(((-48, 50, 30), (-30, 76, -20), (56, 62, 60), (36, 74, 10), (-52, 68, 80))):
        p = px(gx, gy, Z=0.06)
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0.0))
        tube(f"postbit{k}", [p, p + d * 0.95], 0.055, post_burnt, verts=10)
    # broken stones and brick round the heap
    for k, (sx, sy, r) in enumerate(((-36, 70, 0.32), (-10, 74, 0.28), (8, 70, 0.3), (-44, 58, 0.26), (26, 76, 0.22),
                                     (48, 70, 0.24))):
        rock(f"lump{k}", px(sx, sy, Z=0.1), r, M["stone"] if k % 2 == 0 else M["block"], seed=40 + k)


D.run(damaged, destroyed, soot_amount=(0.3, 0.5))
