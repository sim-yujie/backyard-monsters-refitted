"""chamberdmg.py : the Champion Chamber's damaged and destroyed looks in 3D, after Flash's top.3.damaged.png and
top.3.destroyed.png (one look for every level). The model (../chamber.py) is built as it is, then broken: the same
parts, at the same camera and light. The owner asked for these only roughly like Flash, clearly wrecked.

    blender -b --factory-startup -P chamberdmg.py -- 1 <prev|still> <damaged|destroyed>      (or: sh run.sh ...)

Damaged (Flash: the frost gone, the lid knocked loose and tipped up, the arms gone, the right horn knocked off onto the
ground, the coil bent out, the walls cracked): the ice and arms are gone, the lid sits crooked on the hatch, ragged
holes of different sizes are torn in both walls, the right horn lies on the grass, the coil hangs out, one fin is off.
Destroyed (Flash: a low dark heap, the lid lying tipped up in the middle, horns and the coil thrown on the ground round
it): the box broken down to a low shell with broken wall slabs round its rim, the lid on the rubble, the rest scattered.
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

D.load(HERE.parent / "chamber.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
px, scr, YAW_M, SHEAR_M, cam_fwd = G["px"], G["scr"], G["YAW_M"], G["SHEAR_M"], G["cam_fwd"]
AX, AY, H = S.AX, S.AY, S.H
R = random.Random(19)


# ------------------------------------------------------------------------------------------------------------ helpers
def named(pat):
    """Unparented objects whose name (without .001) matches the regex pat in full."""
    return [o for o in SC.objects if o.parent is None and re.fullmatch(pat, o.name.split(".")[0])]


def world(v):
    """A point of the model's own frame (before the shear and the yaw) in the camera's world."""
    return YAW_M @ SHEAR_M @ Vector(v)


def turn(obs, pivot, axis, deg, move=(0, 0, 0)):
    """Turn obs deg degrees round the line through pivot along axis (world), then move them."""
    bpy.context.view_layer.update()
    p = Vector(pivot)
    m = Matrix.Translation(p + Vector(move)) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ \
        Matrix.Translation(-p)
    for o in obs:
        o.matrix_world = m @ o.matrix_world


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
    c.scale = (1.0, 1.0, 1.0 + R.uniform(0.1, 0.5))
    c.display_type = "WIRE"
    c.hide_render = True
    m = target.modifiers.new("hole", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = c
    burn(at, r + 0.7)
    return c


def chip(at, ln, mat, yaw, tilt=0.0, w=0.3, t=0.12):
    return box("chip", (ln, w, t), at, mat, rot=(R.uniform(-5, 5) + tilt, R.uniform(-6, 6), yaw), bevel=0.03,
               origin="center", jitter=0.02)


def lay_horn(i, at, yaw, roll=0.0):
    """Horn i (its pipe and mouth) knocked off: lying on the ground at `at`, its mouth toward bearing yaw."""
    obs = named(rf"horn{i}|hornin{i}")
    x, y, z0, zc, mr = S.HORNS[i]
    base = world((x, y, z0))
    tilt = math.degrees(math.asin(max(0.0, mr * 0.95 - S.HORN_R * 1.25) / (zc - z0)))   # the pipe's end on the grass
    bpy.context.view_layer.update()
    m = (Matrix.Translation(Vector(at) + Vector((0, 0, mr * 0.95))) @ Matrix.Rotation(math.radians(yaw), 4, "Z") @
         Matrix.Rotation(math.radians(roll), 4, "X") @ Matrix.Rotation(math.radians(90 - tilt), 4, "Y") @
         Matrix.Translation(-Vector((base.x, base.y, zc))))
    for o in obs:
        o.matrix_world = m @ o.matrix_world
    burn(at, 0.8)
    return obs


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    # the frost and ice are gone (Flash's damaged chamber has none), and the arms holding the lid
    kill(named(r"icicle.*|icicled.*|tankice.*|frostc|frostt|lintel|arml.*|armr.*"))
    # the lid knocked loose: tipped up at its front and slid a little back, resting on the core's back edge
    lid = named(r"lid|grille.*")
    lx, ly, la, lz, lt = S.LID
    turn(lid, world((lx - la, ly + la, lz)), world((1, 1, 0)) - world((0, 0, 0)), -11, move=(0, 0, 0.12))
    # ragged holes of different sizes in the -Y face (left of the door, high) and in the +X face above the compressor
    body = named(r"body")[0]
    for k, (x, z, r) in enumerate(((-2.75, 4.6, 0.7), (1.85, 5.2, 0.45), (-2.6, 1.5, 0.38))):
        hole(body, world((x, -AY, z)), r, seed=40 + k, squash=0.9)
    for k, (y, z, r) in enumerate(((2.3, 5.0, 0.85), (-1.9, 5.6, 0.42))):
        hole(body, world((AX, y, z)), r, seed=50 + k, squash=0.9)
    hole(named(r"comp")[0], world((S.COMP[0], 0.4, 2.9)), 0.5, seed=60)
    # the corner post cracked at its foot (scorched), the door's grate half torn out, its leaf fallen flat
    burn(world((AX, -AY, 1.2)), 1.0)
    kill(named(r"grate2|grate3|grate5|grater1"))
    leaf = named(r"leaf")[0]
    x0, x1, z0, z1 = S.DOOR
    leaf.rotation_euler = (math.radians(-90), 0, math.radians(-12))
    leaf.location = world((x0 + 0.3, -AY - 1.0, 0.06))
    leaf.location.z = 0.06
    # the right horn knocked off onto the grass on the right, the coil bent out at its top, one fin off on the roof
    lay_horn(2, px(78, 56, Z=0.0), 25, roll=10)
    coil = named(r"coil")
    turn(coil, world((S.COMP[0], 0, S.COIL[2])), world((0, 1, 0)) - world((0, 0, 0)), 18)
    fin = named(r"fin1")
    turn(fin, world((AX + 1.0, S.FINS_Y[1], S.COMP[3])), world((0, 1, 0)) - world((0, 0, 0)), 62,
         move=(0.2, 0, -0.05))
    # rubble: bits of the walls and the bars on the grass in front
    for k, (sx, sy, r) in enumerate(((-34, 64, 0.32), (-6, 82, 0.26), (30, 78, 0.3), (-58, 60, 0.22), (60, 66, 0.24))):
        rock(f"lump{k}", px(sx, sy, Z=0.08), r, M["wall"], seed=20 + k)
    for k, (sx, sy, ln, yaw) in enumerate(((-46, 66, 0.9, 30), (14, 80, 0.7, -40))):
        chip(px(sx, sy, Z=0.07), ln, M["bar"], yaw)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    kill(named(r"icicle.*|icicled.*|tankice.*|frostc|frostt|lintel|arml.*|armr.*|fin.*|pipe|grate.*|leaf|door|"
               r"jamb.*|sill|hatch.*|core|tank1|tankshaft|bar1|bar3|coilpanel"))
    # the box broken down to a low shell: a ragged top, a black hollow, broken wall slabs round its rim
    hz = H * 0.36
    body = named(r"body")[0]
    body.data.transform(Matrix.Diagonal((1, 1, 0.36, 1)))
    hol = box("hollow", (2 * AX - 0.8, 2 * AY - 0.8, 0.3), (0, 0, hz - 0.28), inside(), bevel=0.05)
    hol.data.transform(YAW_M @ SHEAR_M @ hol.matrix_world)
    hol.matrix_world = Matrix.Identity(4)
    for k in range(28):
        f = k / 28 * 4
        side, t = int(f), f - int(f)
        ux, uy = -AX + 2 * AX * t, -AY + 2 * AY * t
        x, y = [(ux, -AY), (AX, uy), (-ux, AY), (-AX, -uy)][side]
        if R.random() < 0.2:
            continue                        # gaps where the wall is broken right down
        h = R.uniform(0.6, 2.0) * (0.6 if side in (0, 1) else 1.0)
        yaw = (0 if side % 2 == 0 else 90) + R.uniform(-14, 14)
        box(f"wallbit{k}", (R.uniform(0.7, 1.3), R.uniform(0.3, 0.45), h), world((x * 0.96, y * 0.96, hz - 0.25)),
            M["wall"], rot=(R.uniform(-18, 18), R.uniform(-18, 18), yaw), bevel=0.06, jitter=0.07,
            taper=R.uniform(0.6, 0.9))
        if k % 4 == 0:
            burn(world((x, y, hz)), 1.1)
    # the bars: the front and left ones dropped onto the shell, broken, the corner post snapped short
    for o in named(r"bar0|bar2"):
        turn([o], world((0, 0, H)), world((1, 0, 0)) - world((0, 0, 0)), R.uniform(-6, 6), move=(0, 0, hz - H + 0.55))
    post = named(r"barpost")[0]
    post.data.transform(Matrix.Diagonal((1, 1, 0.42, 1)))
    burn(world((AX, -AY, H * 0.42)), 0.9)
    # the compressor crushed lower, the coil thrown onto the grass at the left front
    comp = named(r"comp")[0]
    comp.data.transform(Matrix.Diagonal((1, 1, 0.62, 1)))
    coil = named(r"coil")
    c0 = world((S.COMP[0], (S.COIL[0] + S.COIL[1]) / 2, (S.COIL[2] + S.COIL[3]) / 2))
    turn(coil, c0, (0, 0, 1), 70)
    turn(coil, c0, world((1, 0, 0)) - world((0, 0, 0)), -78, move=px(-30, 50, Z=0.25) - c0)
    tank = named(r"tank0|plinth")
    turn(tank, world((S.TANK[0], S.TANK[1], 0)), world((1, -1, 0)) - world((0, 0, 0)), 14, move=(0.3, -0.2, -0.2))
    # the lid lying tipped up toward the viewer on the rubble in the middle, propped on lumps of the walls
    lid = named(r"lid|grille.*")
    lx, ly, la, lz, lt = S.LID
    mid = world((lx, ly, lz))
    target = px(6.0, -6.0, Z=hz + 2.4)
    turn(lid, mid, world((1, 1, 0)) - world((0, 0, 0)), 32, move=target - mid)
    for k, (x, y, r) in enumerate(((-0.8, -0.2, 0.9), (0.9, 0.7, 0.8), (-0.4, 1.2, 0.85), (0.6, -1.4, 0.7))):
        rock(f"proplump{k}", world((x, y, hz + 0.3)), r, M["wall"], squash=0.85, seed=120 + k)
        burn(world((x, y, hz + 0.4)), 1.3)
    # the horns thrown down: two on the left, one at the right front
    lay_horn(0, px(-58, 30, Z=0.0), -110, roll=0)
    lay_horn(1, px(-34, 40, Z=0.0), 200, roll=20)
    lay_horn(2, px(62, 72, Z=0.0), -15, roll=-10)
    # scattered rubble and bar ends
    for k, (sx, sy, r) in enumerate(((-16, 74, 0.34), (10, 78, 0.3), (-52, 56, 0.26), (36, 68, 0.3), (-62, 44, 0.3),
                                     (50, 52, 0.36))):
        rock(f"lump{k}", px(sx, sy, Z=0.1), r, M["wall"], seed=20 + k)
    for k, (sx, sy, ln, yaw) in enumerate(((-44, 64, 1.2, 25), (24, 74, 1.0, -35), (52, 40, 0.9, 80))):
        chip(px(sx, sy, Z=0.12), ln, M["bar"], yaw, w=0.5, t=0.4)


D.run(damaged, destroyed)
