"""mapdmg.py : the Map Room's damaged and destroyed looks in 3D, as Flash's top.1.damaged.png and top.1.destroyed.png
(one look for every level). The model (../maproom.py) is built as it is, then broken: the same parts, at the same
camera and light, knocked off, tilted, dropped and holed where Flash's damaged picture has them; the destroyed look is
those parts in one broken heap.

    PB_FRAME=-78,-72,92,90 blender -b --factory-startup -P mapdmg.py -- 1 <prev|still> <damaged|destroyed>
    (run.sh sets the frame: Flash's damaged picture reaches past the whole look's frame on the left)

Flash has no damaged or destroyed animation for the Map Room, so each look is one still.
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

D.load(HERE.parent / "maproom.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
px, scr, YAW_M, SHEAR_M, cam_fwd = G["px"], G["scr"], G["YAW_M"], G["SHEAR_M"], G["cam_fwd"]
sphere = G["sphere"]
A = S.BASE_A
DZ = S.DECK_Z1
R = random.Random(11)


# ------------------------------------------------------------------------------------------------------------ helpers
def named(pat):
    """Unparented objects whose name (without .001) matches the regex pat in full."""
    return [o for o in SC.objects if o.parent is None and re.fullmatch(pat, o.name.split(".")[0])]


def world(v):
    """A point of the model's own frame (before the yaw) in the camera's world."""
    return YAW_M @ Vector(v)


def cabin_world(v):
    """A point of the cabin's frame (before the shear and the yaw)."""
    return YAW_M @ SHEAR_M @ Vector(v)


def turn(obs, pivot, axis, deg, move=(0, 0, 0)):
    """Turn obs deg degrees round the line through pivot along axis (world), then move them."""
    bpy.context.view_layer.update()
    p = Vector(pivot)
    m = Matrix.Translation(p + Vector(move)) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ \
        Matrix.Translation(-p)
    for o in obs:
        o.matrix_world = m @ o.matrix_world


def screen_turn(obs, pivot, deg_ccw, move=(0, 0, 0)):
    """Turn obs in the picture's plane (round the camera's axis) deg degrees anticlockwise as seen, round pivot."""
    f = cam_fwd()
    t = Vector(pivot) + Matrix.Rotation(math.radians(10), 3, f) @ Vector((0, 0, 1))
    s0, s1 = scr(pivot), scr(t)
    sign = 1 if (s1[0] - s0[0]) < 0 else -1          # +10 deg round f moved "up" to the left: that is anticlockwise
    turn(obs, pivot, f, sign * deg_ccw, move)


def ragged_disc(name, r, n=18, jit=0.25, mat=None):
    bm = bmesh.new()
    vs = [bm.verts.new((0, r * (1 + R.uniform(-jit, jit)) * math.cos(2 * math.pi * i / n),
                        r * (1 + R.uniform(-jit, jit)) * math.sin(2 * math.pi * i / n))) for i in range(n)]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    G["COLL"].objects.link(o)
    o.data.materials.append(mat or inside())
    return o


def rock(name, at, r, mat, squash=0.6, seed=0):
    """A broken lump of stone: a jagged icosphere."""
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
    m = target.modifiers.new("hole", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = c
    burn(at, r + 0.6)
    return c


def chip(at, ln, mat, yaw, tilt=0.0, w=0.26, t=0.1):
    return box("chip", (ln, w, t), at, mat, rot=(R.uniform(-5, 5) + tilt, R.uniform(-6, 6), yaw), bevel=0.02,
               origin="center", jitter=0.02)


def paler(mat, col, strength):
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Color"].default_value = G["srgb"](*col)
    b.inputs["Emission Strength"].default_value = strength


def sag_rope(name, a, b, drop, n=14):
    pts = []
    for k in range(n + 1):
        f = k / n
        p = Vector(a).lerp(Vector(b), f)
        p.z -= drop * math.sin(math.pi * f)
        pts.append(p)
    return tube(name, pts, S.ROPE_R, M["rope"], verts=8, smooth=True)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    cx, cy = S.HOUSE_C
    ax, ay = S.HOUSE_AX, S.HOUSE_AY
    # the tower is gone: a scorched stub on the ridge
    kill(named(r"(twall|tgable|troof).*"))
    burn(cabin_world((S.TOWER_C[0], S.TOWER_C[1], S.ROOF_Z)), 1.0)
    # the round window blown in: a black ragged hole in the +X gable
    kill(named(r"window.*"))
    wy, wz = S.WIN_C
    h = ragged_disc("gablehole", S.WIN_R * 1.15, jit=0.22)
    h.data.transform(Matrix.Translation((cx + ax + 0.17, wy, wz)))
    h.data.transform(YAW_M @ SHEAR_M)
    burn(cabin_world((cx + ax, wy, wz)), 1.4)
    # the telescope's arm snapped off its plate: a short gold stub stays on the roof with the plate
    kill(named(r"bracketarm"))
    scope = named(r"scope.*|bracketclamp")
    # the cabin leans over to the left, sinking into the broken deck on that side
    cabin = named(r"(hwall|gable|roof|ridge|corner|bracket).*") + [h]
    piv = cabin_world((cx + ax, cy + ay, DZ))
    turn(cabin, piv, world((1, -1, 0)), 8, move=(0, 0, -0.06))
    # the telescope lies on the deck's left part, its bell up to the left
    e0 = px(S.SCOPE_EYE[0], S.SCOPE_EYE[1], Y=S.SCOPE_EYE[2])
    d0 = Vector(S.SCOPE_DIR).normalized()
    e1 = px(-24.0, 9.0, Z=DZ + 0.47)
    d1 = Vector((-0.85, -0.45, 0.25)).normalized()
    rot = d0.rotation_difference(d1).to_matrix().to_4x4()
    m = Matrix.Translation(e1) @ rot @ Matrix.Translation(-e0)
    bpy.context.view_layer.update()
    for o in scope:
        o.matrix_world = m @ o.matrix_world
    print("PROBE scope eye", tuple(round(c, 2) for c in e1), "screen", scr(e1))
    # the scissors knocked over: the teardrop's half swung out past the deck's left edge, its blade snapped off
    sp = G["SP"]
    kill(named(r"scisblade0"))
    screen_turn(named(r"scisloop0|scisshank0"), sp, 28)
    blade = G["ST"][1]
    # the snapped blade lies on the ground in front, left
    g = px(-52.0, 66.0, Z=0.06)
    along("scisbroken", g, g + Vector((1.9, -0.9, 0.0)), (0, 0.42, 0.08), M["steel"], roll=4)
    # the left post knocked off the deck: lying against the stone with its ball on the ground; its ropes hang
    kill(named(r"post3|ball3|rope2|rope3"))
    b3 = px(-38.0, 58.0, Z=S.BALL_R)
    top = b3 + Vector((0.55, 0.6, 1.25))
    tube("post3f", [b3, top], S.POST_R, M["steel"], verts=12)
    sphere("ball3f", S.BALL_R, b3, M["ball"])
    b0 = Vector((S.DECK_A - S.POST_IN, -(S.DECK_A - S.POST_IN_F), DZ + S.POST_H + S.BALL_R * 0.6))
    sag_rope("rope3f", world(b0) + Vector((0, 0, -0.2)), b3 + Vector((0.1, 0.1, 0.15)), 1.2)
    # the front of the deck broken: the front boards dropped down over the edge, some gone, ends burnt
    D_ = S.DECK_A
    kill(named(r"deckrim3\d"))
    front = named(r"deck0\d") + named(r"deckslot0\d")
    turn(front, world((0, -D_ + 0.9, DZ - 0.2)), world((1, 0, 0)), -24, move=(0, 0, -0.1))
    second = named(r"deck1\d")
    if second:
        kill([second[-1]])
        turn(second[:1], world((0, -D_ + 1.5, DZ - 0.1)), world((1, 0, 0)), -9)
    for x in (-2.2, 0.4, 2.0):
        burn(world((x, -D_ + 0.8, DZ)), 1.1)
    # the stone holed and paler (Flash's damaged stone is a pale lavender grey with black holes)
    base_ = named(r"base")[0]
    # (a boolean cut leaves the bevelled block unchanged here, so the holes are black ragged patches on the face with
    # broken lumps at their rims, as Flash paints them)
    for k, (x, z, r) in enumerate(((1.6, 2.4, 0.55), (2.5, 1.25, 0.42), (0.2, 0.95, 0.5), (-0.6, 2.95, 0.42),
                                   (-1.9, 1.7, 0.36))):
        d = ragged_disc(f"stonehole{k}", r, n=24, jit=0.16)
        d.data.transform(Matrix.Rotation(math.radians(90), 4, "Z"))
        d.data.transform(Matrix.Diagonal((1, 1, 0.8, 1)))
        d.data.transform(YAW_M @ Matrix.Translation((x, -A - 0.012, z)))
        burn(world((x, -A, z)), r + 0.5)
        rock(f"rim{k}", world((x + r * 0.7, -A - 0.05, z - r * 0.75)), 0.16, M["stone"], seed=40 + k)
    paler(M["stone"], (150, 148, 172), 0.5)
    paler(M["foot"], (158, 156, 178), 0.5)
    # debris on the ground: plank ends and stone lumps
    for k, (sx, sy, ln, yaw) in enumerate(((-68, 49, 1.0, 20), (52, 46, 1.1, -30), (-58, 60, 0.7, 70), (40, 64, 0.6, 10))):
        chip(px(sx, sy, Z=0.06), ln, M["deck"], yaw)
    for k, (sx, sy, r) in enumerate(((-12, 68, 0.3), (5, 69, 0.34), (-46, 66, 0.2), (14, 72, 0.18))):
        rock(f"lump{k}", px(sx, sy, Z=0.1), r, M["stone"], seed=20 + k)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    up = Vector((0, 0, 1))
    # the stone block broken down to a low shell: half its height, a black hollow in the middle, a ragged top edge
    base_ = named(r"base")[0]
    base_.data.transform(Matrix.Diagonal((1, 1, 0.48, 1)))
    hz = S.BASE_H * 0.48
    box("hollow", (2 * A - 0.7, 2 * A - 0.7, 0.3), world((0, 0, hz - 0.28)), inside(), bevel=0.05).rotation_euler.z =         math.radians(S.YAW)
    for k in range(26):
        f = k / 26 * 4
        side, t = int(f), f - int(f)
        u = -A + 2 * A * t
        x, y = [(u, -A), (A, u), (-u, A), (-A, -u)][side]
        h = R.uniform(0.15, 0.75) if R.random() < 0.7 else 0.05
        rock(f"rim{k}", world((x * 0.93, y * 0.93, hz + h * 0.4)), R.uniform(0.32, 0.55), M["stone"], squash=0.9,
             seed=60 + k)
    for k, (x, y) in enumerate(((-0.6, -1.2), (0.7, 0.4), (-1.2, 1.0), (1.1, -0.6))):
        rock(f"inlump{k}", world((x, y, hz - 0.1)), R.uniform(0.35, 0.5), M["stone"], squash=0.7, seed=90 + k)
        burn(world((x, y, hz)), 1.2)
    paler(M["stone"], (150, 148, 172), 0.45)
    paler(M["foot"], (158, 156, 178), 0.45)
    # gone: the tower, the cabin's walls and window, the deck, the back roof slope, the posts and their rope, the
    # stairs' top and most of their rail
    kill(named(r"(twall|tgable|troof|hwall|gable|window|ridge|corner|post|ball|rope|deck|stairland|handrail|handpost[12]|door|step[23]|steptread[23L])"
               r".*|roof2\d|roofsheet2|roofeave2|bracketarm|bracketclamp"))
    # the front roof slope (with the gold plate) lying tilted on the rubble
    roof = named(r"roof0\d|roofsheet0|roofeave0|bracket")
    cx, cy = S.HOUSE_C
    mid = cabin_world((cx, cy - S.ROOF_RUN / 2, S.ROOF_Z - S.ROOF_RUN / 2 * G["TAN"]))
    target = px(0.0, 26.0, Z=hz + 0.9)
    turn(roof, mid, world((1, 0, 0)), -28, move=target - mid)
    turn(roof, target, up, 18)
    turn(roof, target, world((0, 1, 0)), 9)
    burn(target, 1.6)
    for k in range(3):
        burn(target + Vector((R.uniform(-1.5, 1.5), R.uniform(-1.5, 1.5), 0)), 0.9)
    # the telescope on the rubble at the left, its bell up to the left
    scope = named(r"scope.*")
    e0 = px(S.SCOPE_EYE[0], S.SCOPE_EYE[1], Y=S.SCOPE_EYE[2])
    d0 = Vector(S.SCOPE_DIR).normalized()
    e1 = px(-22.0, 38.0, Z=hz + 0.5)
    d1 = Vector((-0.75, -0.45, 0.45)).normalized()
    m = Matrix.Translation(e1) @ d0.rotation_difference(d1).to_matrix().to_4x4() @ Matrix.Translation(-e0)
    bpy.context.view_layer.update()
    for o in scope:
        o.matrix_world = m @ o.matrix_world
    burn(e1 + d1 * 1.2, 1.3)
    burn(e1 + d1 * 3.0, 0.9)
    # the scissors lying flat, open, in front: loops to the right, blades to the left
    sc = named(r"scis.*")
    sp = G["SP"]
    n = (G["ST"][0] - sp).cross(G["ST"][1] - sp).normalized()
    turn(named(r"scisloop0|scisshank0|scisblade0"), sp, n, -30)       # opened wide, in their own plane
    turn(sc, sp, n.cross(up), math.degrees(n.angle(up)))
    bpy.context.view_layer.update()
    loops = [o for o in sc if o.name.startswith("scisloop")]
    mid = sum((o.matrix_world @ Vector(o.bound_box[0]).lerp(Vector(o.bound_box[6]), 0.5) for o in loops), Vector()) / 2
    v = (mid - sp)
    v.z = 0
    want = world((1.0, 0.25, 0))
    turn(sc, sp, up, math.degrees(math.atan2(want.y, want.x) - math.atan2(v.y, v.x)))
    goal = px(-27.0, 64.0, Z=0.15)
    turn(sc, sp, up, 0, move=goal - sp)
    sit(sc, 0.0)
    for k in range(4):                      # dirt and soot on the fallen scissors
        burn(goal + world((R.uniform(-2.5, 3.5), R.uniform(-1.0, 1.0), 0)), 0.8)
    # the whole heap charred in patches (Flash's heap is dark brown and black between the pale stone)
    for x in (-2.0, -0.5, 1.0, 2.2):
        for y in (-2.0, -0.4, 1.2, 2.4):
            if R.random() < 0.7:
                burn(world((x, y, hz + 0.6)), R.uniform(0.8, 1.3))
    # a fallen post with its ball, and the rope strewn on the ground
    b3 = px(-38.0, 66.0, Z=S.BALL_R)
    tube("postf", [b3 + Vector((0.2, 0.2, -0.15)), b3 + Vector((1.2, 0.9, -0.2))], S.POST_R, M["steel"], verts=12)
    sphere("ballf", S.BALL_R, b3, M["ball"])
    pts = [px(sx, sy, Z=0.08) for sx, sy in ((-34, 66), (-22, 72), (-4, 68), (14, 62), (30, 60), (48, 57))]
    tube("ropef", pts, S.ROPE_R, M["rope"], verts=8, smooth=True)
    # broken planks sticking up out of the heap, snapped and burnt
    for k, (sx, sy, z, ln, tilt, yaw) in enumerate(((-10, 6, 2.6, 1.6, 15, 30), (20, 18, 2.4, 1.4, 35, -40),
                                                     (44, 30, 1.6, 1.2, 40, 60), (-55, 38, 0.6, 1.3, 10, 10))):
        a = px(sx, sy, Z=z)
        d = Matrix.Rotation(math.radians(yaw), 3, "Z") @ Matrix.Rotation(math.radians(tilt), 3, "X") @ up
        along(f"stick{k}", a - d * ln, a, (0, 0.3, 0.1), M["deck"], roll=yaw)
        burn(a, 0.6)
    # deck boards in the heap, slumped
    for k, (sx, sy, z, yaw, tilt) in enumerate(((-22, 22, 2.3, 30, 20), (8, 36, 2.1, -20, -14), (-34, 46, 1.2, 60, 25),
                                                (30, 42, 1.5, 10, 30), (-6, 50, 1.0, -45, 12))):
        chip(px(sx, sy, Z=z), R.uniform(1.4, 2.2), M["deck"], yaw, tilt=tilt, w=0.8, t=0.14)
    # debris round the heap
    for k, (sx, sy, ln, yaw) in enumerate(((-66, 50, 1.0, 20), (56, 50, 1.1, -30), (-50, 70, 0.7, 70), (36, 70, 0.6, 10))):
        chip(px(sx, sy, Z=0.06), ln, M["deck"], yaw)
    for k, (sx, sy, r) in enumerate(((-16, 72, 0.3), (8, 74, 0.34), (-50, 62, 0.24), (22, 70, 0.2), (-60, 44, 0.3))):
        rock(f"lump{k}", px(sx, sy, Z=0.1), r, M["stone"], seed=20 + k)


D.run(damaged, destroyed)
