"""lockerdmg.py : the Monster Locker's damaged and destroyed looks in 3D, as Flash's top.<lv>.damaged.png (one per
level) and top.2.destroyed.png (one look for every level). The model (../locker.py) is built as it is, then broken:
the shell dented and torn open with ragged holes, the key, panels, chimney and feet knocked loose, gold spilled on
the ground. The destroyed look is a crumpled chrome pot lying open, the key standing out of it, the cogs half buried.

    blender -b --factory-startup -P lockerdmg.py -- <level> <prev|still|float> <damaged|destroyed>
    (run.sh: sh run.sh <level> <mode> <state>)

    float: no render; prints every part that rests neither on the ground nor on a part that does (FLOAT ...), and any
    part outside the building's square (OUTSIDE ...).

Flash has no damaged or destroyed animation for the Locker, so each look is one still.
"""
import math
import random
import re
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "locker.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
px, scr, cam_fwd, on_surface = G["px"], G["scr"], G["cam_fwd"], G["on_surface"]
sphere, gear, key, wood = G["sphere"], G["gear"], G["key"], G["wood"]
A = G["A"]
R = random.Random(11 + L)
HALF = 6.2                         # the building's square: |x|, |y| from its axis (3x3 tiles, a little margin)


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


def screen_turn(obs, pivot, deg_ccw, move=(0, 0, 0)):
    """Turn obs in the picture's plane deg degrees anticlockwise as seen, round pivot."""
    f = cam_fwd()
    t = Vector(pivot) + Matrix.Rotation(math.radians(10), 3, f) @ Vector((0, 0, 1))
    s0, s1 = scr(pivot), scr(t)
    sign = 1 if (s1[0] - s0[0]) < 0 else -1
    turn(obs, pivot, f, sign * deg_ccw, move)


def place(obs, a0, d0, a1, d1):
    """Move obs rigidly so point a0 goes to a1 and direction d0 turns to d1."""
    bpy.context.view_layer.update()
    rot = Vector(d0).normalized().rotation_difference(Vector(d1).normalized()).to_matrix().to_4x4()
    m = Matrix.Translation(Vector(a1)) @ rot @ Matrix.Translation(-Vector(a0))
    for o in obs:
        o.matrix_world = m @ o.matrix_world


def rock(name, at, r, mat, squash=0.6, seed=0, subdiv=1):
    """A broken lump: a jagged icosphere."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
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
    o.rotation_euler = (rr.uniform(0, 6.3), rr.uniform(0, 6.3), rr.uniform(0, 6.3))
    return o


def hole(target, at, r, seed=0, squash=1.0):
    """Knock a ragged hole into target (a boolean cut by a jagged lump); the torn edge and inside are black."""
    c = rock(f"cut{seed}", at, r, inside(), squash=squash, seed=seed)
    c.display_type = "WIRE"
    c.hide_render = True
    m = target.modifiers.new("hole", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.object = c
    burn(at, r * 1.6 + 0.4)
    return c


def own_mesh(o):
    if o.data.users > 1:
        o.data = o.data.copy()
    return o.data


def dent(o, at, r, depth, seed=0):
    """Push o's surface in round world point at (radius r): a crumpled dent, deepest in the middle, wrinkled."""
    me = own_mesh(o)
    rr = random.Random(seed)
    mw = o.matrix_world
    mi = mw.inverted()
    c = mw.translation
    ph = [rr.uniform(0, 6.3) for _ in range(3)]
    for v in me.vertices:
        w = mw @ v.co
        d = (w - at).length
        if d >= r:
            continue
        f = (1 - (d / r) ** 2) ** 2
        wr = 1 + 0.35 * math.sin(w.x * 3.1 + ph[0]) * math.sin(w.y * 2.7 + ph[1]) * math.sin(w.z * 3.3 + ph[2])
        v.co = mi @ (w - (w - c).normalized() * depth * f * wr)
    burn(at, r * 0.8)


def crumple(o, amount, seed=0):
    """Small lumpy dents all over o (radial noise round its middle)."""
    me = own_mesh(o)
    rr = random.Random(seed)
    k = [rr.uniform(1.2, 2.2) for _ in range(3)]
    ph = [rr.uniform(0, 6.3) for _ in range(3)]
    for v in me.vertices:
        p = v.co
        n = math.sin(p.x * k[0] + ph[0]) + math.sin(p.y * k[1] + ph[1]) + math.sin(p.z * k[2] + ph[2])
        v.co = p * (1 + amount * n / 3)


def chip(name, at, size, mat, yaw, tilt=(0, 0)):
    return box(name, size, at, mat, rot=(tilt[0], tilt[1], yaw), bevel=0.03, origin="center", jitter=0.02)


def nugget(name, at, s, yaw):
    """A loose gold block on the ground."""
    return chip(name, Vector(at) + Vector((0, 0, s * 0.35)), (s, s * 0.8, s * 0.7), M["block"], yaw,
                (R.uniform(-8, 8), R.uniform(-8, 8)))


def ground_pt(sx, sy, keep=1.0):
    """The ground under Flash pixel (sx, sy), pulled inside the building's square (keep: margin)."""
    p = px(sx, sy, Z=GROUND)
    lim = HALF - keep
    p.x = A.x + max(-lim, min(lim, p.x - A.x))
    p.y = A.y + max(-lim, min(lim, p.y - A.y))
    return p


def shell():
    return (named(r"ball") or named(r"ballshell"))[0]


def surf(sx, sy):
    q, n = on_surface(sx, sy)
    return q, n


def holes_and_dents(spots, dents, seed0=0):
    """spots: (sx, sy, r) ragged holes; dents: (sx, sy, r, depth) on whatever shell part the camera sees there."""
    sh = shell()
    for k, (sx, sy, r, d) in enumerate(dents):
        q, n = surf(sx, sy)
        dent(sh, q, r, d, seed=seed0 + k)
    for k, (sx, sy, r) in enumerate(spots):
        q, n = surf(sx, sy)
        hole(sh, q - n * 0.1, r, seed=seed0 + 40 + k, squash=0.8)


def centre(obs):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
    return sum(pts, Vector()) / len(pts)


def key_parts():
    return named(r"key") + named(r"keyblock")


def slot_of(e):
    return e.matrix_world.translation.copy()


def axis_of(e):
    return (e.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    G["turn"](0)
    k = named(r"key")[0]
    sp, ax = slot_of(k), axis_of(k)
    if L == 1:
        sh = shell()
        crumple(sh, 0.05, seed=3)
        holes_and_dents([(-4.0, 6.0, 0.75), (16.0, 12.0, 0.5), (-22.0, -12.0, 0.4)],
                        [(-14.0, -6.0, 1.9, 1.0), (2.0, -22.0, 1.5, 0.75), (12.0, 20.0, 1.4, 0.5), (-18.0, 18.0, 1.2, 0.45)])
        # the key bent down to the left, out of a torn slot; the panel box knocked askew
        screen_turn([k], sp, 48)
        burn(sp, 0.7)
        bx = named(r"box")[0]
        bp = slot_of(bx)
        screen_turn([bx], bp, -22, move=tuple(axis_of(bx) * 0.12))
        burn(bp, 0.9)
        # the body tipped over to the right on its squashed bellows
        top = named(r"ball|key|box")
        piv = A + Vector((0, 0, S.L1_DISC_H + 1.0))
        screen_turn(top, piv, -7)
        bl = named(r"bellows")[0]
        bl.scale.z = 0.92
        bl.location.z = S.L1_DISC_H * 0.08
        for o in top:
            o.location.z -= 0.25
        # bits on the ground: a rubber scrap and a rivet at the front right
        chip("scrap", ground_pt(36.0, 66.0) + Vector((0, 0, 0.08)), (0.5, 0.26, 0.16), M["rubber"], 30)
        sphere("loose_rivet", 0.12, ground_pt(26.0, 70.0) + Vector((0, 0, 0.1)), M["gold"])
    elif L == 2:
        sh = shell()
        crumple(sh, 0.03, seed=5)
        holes_and_dents([(-26.0, -14.0, 0.75), (20.0, 4.0, 0.55), (-6.0, 12.0, 0.4)],
                        [(-30.0, -30.0, 2.0, 0.6), (8.0, -2.0, 1.8, 0.5), (28.0, -22.0, 1.4, 0.4)])
        # the key knocked out of its slot and hanging over the shell's front, its ring in front of the ball low down
        # (as Flash's; turning it about the slot dropped the ring into the hole)
        bpy.context.view_layer.update()
        mw = k.matrix_world.copy()
        kz = (mw.to_3x3() @ Vector((0, 0, 1))).normalized()
        f = -cam_fwd()
        fh = Vector((f.x, f.y, 0.0)).normalized()
        # tipped over the hole's front rim like a lever: a short end up inside the hole, the ring end hanging down
        # in front of the ball (Flash's damaged ring hangs in front of the shell)
        c = G["_plane_pt"](S.L2_BALL_C)
        hb, ht, hd = S.L2_HOLE
        hn = Vector((math.sin(math.radians(ht)) * math.cos(math.radians(hb)),
                     math.sin(math.radians(ht)) * math.sin(math.radians(hb)), math.cos(math.radians(ht))))
        fp = (fh - hn * fh.dot(hn)).normalized()
        rim = c + hn * hd + fp * math.sqrt(S.L2_BALL_R ** 2 - hd ** 2) + hn * 0.1
        dt = (fh * math.cos(math.radians(30)) + Vector((0, 0, -math.sin(math.radians(30))))).normalized()
        root = rim - dt * 3.4
        r1 = kz.rotation_difference(dt).to_matrix() @ mw.to_3x3()
        y1 = r1 @ Vector((0, 1, 0))
        want = (f - dt * f.dot(dt)).normalized()          # the ring's face toward the camera
        r2 = y1.rotation_difference(want).to_matrix() @ r1
        k.matrix_world = Matrix.Translation(root) @ r2.to_4x4()
        for h in G["MOVING"]:
            if h.name in G["KEYS"]:
                h.rotation_euler = (0, 0, 0)
        kill([o for o in SC.objects if o.name.startswith("keyslot")])
        burn(sp, 0.8)
        # panels: one knocked off onto the ground, two hanging askew
        pans = sorted(named(r"panel\d"), key=lambda o: o.name)
        for i, o in enumerate(pans):
            p = slot_of(o)
            if i == 1:
                g = ground_pt(22.0, 72.0) + Vector((0, 0, 0.16))
                place([o], p, axis_of(o), g, Vector((0.15, -0.1, 1.0)))
                burn(p, 1.0)
            else:
                screen_turn([o], p, (-28, 0, 22, -15)[i], move=tuple(axis_of(o) * 0.15))
                burn(p, 0.8)
        # two needles snapped to stubs, their knobs on the ground
        for i in (0, 2):
            nd = named(rf"legneedle{i}")[0]
            top = nd.location.z + nd.dimensions.z
            z0 = S.L2_DISC_Z - 0.5                       # snapped just below the arm
            nd.scale.z = (top - z0) / nd.dimensions.z
            nd.location.z = z0
            kill(named(rf"legtip{i}"))
            bll = named(rf"legball{i}")[0]
            g = ground_pt(*((-46.0, 70.0) if i == 0 else (8.0, 92.0)))
            bll.location = g + Vector((0, 0, 0.22))
            burn(Vector((nd.location.x, nd.location.y, z0)), 0.5)
        nugget("nug0", ground_pt(-28.0, 74.0), 0.42, 20)
        nugget("nug1", ground_pt(-14.0, 82.0), 0.36, 70)
    else:
        lv4 = L == 4
        sh = shell()
        crumple(sh, 0.025, seed=7)
        holes_and_dents([(-22.0, 24.0, 1.0), (22.0, -6.0, 0.7), (4.0, 16.0, 0.45)],
                        [(-26.0, -6.0, 2.2, 0.6), (14.0, 10.0, 1.8, 0.5), (30.0, -30.0, 1.6, 0.45)])
        # the chimney knocked over to the right at its foot, its flange hanging off
        ch = named(r"chimlean")[0]
        foot = slot_of(ch)
        screen_turn([ch], foot, -28)
        burn(foot, 1.2)
        # the key knocked over to the left (level 4: further, its bow still in the frame)
        screen_turn(key_parts() if lv4 else [k], sp, 38 if lv4 else 22)
        burn(sp, 0.9)
        # panels askew, one torn off on the ground
        pans = sorted(named(r"panel\d"), key=lambda o: o.name)
        for i, o in enumerate(pans):
            p = slot_of(o)
            if i == 1:
                g = ground_pt(-30.0, 86.0, keep=2.1) + Vector((0, 0, 0.16))
                place([o], p, axis_of(o), g, Vector((-0.2, -0.15, 1.0)))
            else:
                screen_turn([o], p, (25, 0, -20)[i], move=tuple(axis_of(o) * 0.15))
            burn(p, 1.0)
        # the front foot broken
        a = Vector(S.polar(-45.0, 1.0, 0.0))
        p = A + a * S.L3_FOOT_D
        if lv4:
            # the front pillar snapped low: a stub on the base, its top half lying on the ground in front
            pl = named(r"legpillar2")[0]
            zb = S.L4_BASE_H
            hgt = S.L4_PILLAR_TOP - zb
            kill(named(r"legpillar2|legcap2|legcollar2"))
            stub = cyl("pillarstub", S.L4_PILLAR_R, 1.5, (p.x, p.y, zb), M["steel"], verts=28, bevel=0.04)
            snap(stub, 0.95)
            g = A + a * (S.L3_FOOT_D + 1.4) + Vector((0, 0, S.L4_PILLAR_R))
            top = cyl("pillarfall", S.L4_PILLAR_R, hgt - 1.8, (0, 0, 0), M["steel"], verts=28, bevel=0.04)
            cyl("pillarfallcap", S.L4_PILLAR_R + 0.05, 0.12, (0, 0, hgt - 1.8), M["steel"], verts=28, bevel=0.04,
                parent=top)
            top.location = g + Vector(S.polar(45.0, 1.0, 0.0)) * (hgt - 1.8) * 0.5
            top.rotation_euler = (0, math.radians(90), math.radians(-135))
            burn(p + Vector((0, 0, zb + 1.5)), 0.8)
            # the arm that held it droops to the stub
            arm = named(r"legarm2")[0]
            turn([arm], A + a * (S.L3_BELLOWS_R - 0.2) + Vector((0, 0, zb + S.L3_ARM_Z)), a.cross(Vector((0, 0, 1))),
                 -14)
        else:
            # the front post snapped: its nut and rod lie on the ground, the arm hangs down
            kill(named(r"legrod2|legthread2-\d+|legnut2|legring2"))
            arm = named(r"legarm2")[0]
            turn([arm], A + a * (S.L3_BELLOWS_R - 0.2) + Vector((0, 0, S.L3_ARM_Z)), a.cross(Vector((0, 0, 1))), -28)
            G["hexnut"]("nutfall", ground_pt(40.0, 88.0), 0.72, 0.65, M["nut"]).rotation_euler.z = 0.4
            r = cyl("rodfall", 0.26, 2.2, (0, 0, 0), M["needle"], verts=12, bevel=0.0)
            r.location = ground_pt(-44.0, 86.0) + Vector((0, 0, 0.26))
            r.rotation_euler = (0, math.radians(90), math.radians(20))
            burn(p + Vector((0, 0, 0.6)), 0.8)
        # gold blocks spilled out of the barrel onto the ground
        for i, (sx, sy, s) in enumerate(((-52, 70, 0.5), (-40, 78, 0.42), (-30, 90, 0.38), (-20, 96, 0.44),
                                         (30, 96, 0.4), (46, 80, 0.36))):
            nugget(f"nug{i}", ground_pt(sx, sy), s, R.uniform(0, 90))


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    """One look for every level (Flash's top.2.destroyed): a crumpled chrome pot lying open toward the front left,
    gold blocks inside, the key standing out of it, a pipe stub with its flange at the top right, two gold cogs half
    buried (left, and leaning on the front), a wooden plank, a steel plate and bolts on the ground."""
    c = ground_pt(6.0, 40.0) + Vector((0, 0, 2.25))
    r = 4.0
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=r)
    side = Vector((1, 1, 0)).normalized()                    # the picture's left-right
    for v in bm.verts:
        v.co.z *= 0.84
        v.co += side * v.co.dot(side) * 0.05
    pot = G["mesh_ob"]("pot", bm, [M["chrome"], M["inner"]])
    pot.location = c
    pot.rotation_euler = (math.radians(-8), math.radians(6), 0)
    crumple(pot, 0.1, seed=31)
    sk = pot.modifiers.new("wall", "SOLIDIFY")
    sk.thickness, sk.offset, sk.material_offset, sk.use_rim = 0.16, -1.0, 1, True
    bpy.context.view_layer.update()
    # the big tear toward the front left, and smaller ones
    q, n = surf2(pot, -20.0, 30.0)
    hole(pot, q + n * 0.6, 3.6, seed=301, squash=1.2)
    q, n = surf2(pot, 30.0, 48.0)
    hole(pot, q, 0.5, seed=302)
    q, n = surf2(pot, 14.0, 12.0)
    dent(pot, q, 1.6, 0.55, seed=303)
    q, n = surf2(pot, 36.0, 26.0)
    dent(pot, q, 1.4, 0.4, seed=304)
    # dark inside, gold blocks heaped in it
    # a heap of gold inside, toward the tear (resting on the pot's floor), loose blocks on it
    hc = c + Vector((-0.5, -1.1, -2.0))
    rock("potheap", hc, 2.3, M["block"], squash=0.6, seed=305)
    for i in range(16):
        a = R.uniform(0, 6.3)
        d = R.uniform(0.0, 1.9)
        h = 2.3 * 0.6 * math.sqrt(max(0.0, 1 - (d / 2.4) ** 2)) * 0.8
        p = hc + Vector((math.cos(a) * d, math.sin(a) * d, h))
        s_ = R.uniform(0.4, 0.62)
        chip(f"potgold{i}", p, (s_, s_ * 0.85, s_ * 0.8), M["block"], R.uniform(0, 90),
             (R.uniform(-30, 30), R.uniform(-30, 30)))
    # the key out of the heap: shaft up to the ring at Flash's (2, -27)
    foot = c + Vector((-0.8, -1.6, -0.6))
    ring = px(4.0, -26.0, Y=foot.y - 0.3)
    e, hub = key("key", foot, ring - foot, ring, 1.55, 0.14, 0.0)
    hub.rotation_euler = (0, 0, math.radians(68))
    sphere("keyknob", 0.42, foot + (ring - foot).normalized() * 3.4, M["gold"])
    # the pipe stub and its square flange at the top right
    q, n = surf2(pot, 34.0, 10.0)
    p1 = q + Vector((0.4, 0.5, 1.5))
    p2 = p1 + Vector((1.0, 1.0, 0.35))
    tube("pipe", [q - n * 0.3, q + n * 0.6, p1, p2], 0.55, M["chrome"], smooth=True)
    fl = box("pipeflange", (1.9, 0.26, 1.5), p2, M["steel"], rot=(0, 0, 45), bevel=0.05, origin="center")
    fl.rotation_euler = (math.radians(15), math.radians(-12), math.radians(45))
    # the cogs: one leaning on the front of the tear, one half buried on the left
    q, n = surf2(pot, 10.0, 46.0)
    cg = bpy.data.objects.new("cogfront", None)
    G["COLL"].objects.link(cg)
    gear("cogfrontw", 1.25, 12, 0.32, (0, 0, 0), M["gold"], (0, 0, 0), tooth=0.24, parent=cg)
    cg.matrix_world = Matrix.Translation(q + n * 0.25) @ Vector((0, 0, 1)).rotation_difference(
        (n - cam_fwd() * 0.8).normalized()).to_matrix().to_4x4()
    gl = Vector((c.x, c.y, GROUND)) - side * 5.0
    cg2 = bpy.data.objects.new("cogleft", None)
    G["COLL"].objects.link(cg2)
    gear("cogleftw", 1.5, 14, 0.32, (0, 0, 0), M["gold"], (0, 0, 0), tooth=0.24, parent=cg2)
    cg2.location = gl + Vector((0, 0, 0.55))
    cg2.rotation_euler = (math.radians(70), 0, math.radians(-40))
    # on the ground: a wooden plank, a steel plate, bolts
    wd = wood("wood", (204, 160, 108), (132, 90, 52), axis="X")
    pl = chip("plank", ground_pt(-30.0, 60.0) + Vector((0, 0, 0.35)), (3.2, 0.55, 0.16), wd, -8, (0, -10))
    chip("plate", ground_pt(-14.0, 70.0) + Vector((0, 0, 0.06)), (1.8, 0.9, 0.1), M["steel"], 20, (0, 0))
    for i, (sx, sy) in enumerate(((-38.0, 44.0), (54.0, 52.0))):
        g = ground_pt(sx, sy)
        sphere(f"bolthead{i}", 0.26, g + Vector((0, 0, 0.22)), M["steel"])
        b = cyl(f"boltrod{i}", 0.1, 0.8, (0, 0, 0), M["needle"], verts=10, bevel=0.0)
        b.location = g + Vector((0.1, 0.1, 0.12))
        b.rotation_euler = (0, math.radians(90), math.radians(R.uniform(0, 180)))
    for p in (c + Vector((-1.5, -2.5, 0.5)), c + Vector((1.0, -2.0, 1.2)), c + Vector((-2.0, 1.0, 1.4))):
        burn(p, 1.8)


def settle(obs):
    """Drop each of obs straight down onto whatever lies under it (the heap, the pot, the ground)."""
    for o in obs:
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        lo = lowest([o])
        best = lo - GROUND
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            st = Vector((w.x, w.y, lo - 0.01))
            for _ in range(6):
                ok, loc, _, _, ob, _ = SC.ray_cast(dg, st, Vector((0, 0, -1)))
                if ok and (ob.hide_render or ob.name == "ground"):
                    st = loc - Vector((0, 0, 1e-3))
                    continue
                break
            if ok and ob is not o and not ob.hide_render:
                best = min(best, lo - loc.z)
        o.location.z -= max(0.0, best - 0.01)


def surf2(o, sx, sy):
    """The point of object o the camera sees at Flash pixel (sx, sy), and its normal."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    p, f = G["cam_ray"](sx, sy)
    o0 = p - f * 40
    ev = o.evaluated_get(dg)
    mi = o.matrix_world.inverted()
    ok, loc, nrm, _ = ev.ray_cast(mi @ o0, (mi.to_3x3() @ f).normalized())
    if not ok:
        raise ValueError(f"({sx}, {sy}) misses {o.name}")
    return o.matrix_world @ loc, (o.matrix_world.to_3x3() @ nrm).normalized()


# ------------------------------------------------------------------------------------------------------------ checks
def float_check():
    """Every part must rest on the ground or on a part that does; nothing outside the building's square."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    items = []
    for o in SC.objects:
        if o.type not in ("MESH", "CURVE") or o.name == "ground" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        if me is None or not me.polygons:
            continue
        mw = ev.matrix_world
        vs = [mw @ v.co for v in me.vertices]
        items.append((o, BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs))
        ev.to_mesh_clear()
    on = set()
    for i, (o, t, vs) in enumerate(items):
        if min(v.z for v in vs) < GROUND + 0.04:
            on.add(i)
        out = max(max(abs(v.x - A.x), abs(v.y - A.y)) for v in vs)
        if out > HALF and max(v.z for v in vs) < 1.5:          # rubble on the ground stays in the square
            print("OUTSIDE %s %.2f" % (o.name, out))
    touch = {i: set() for i in range(len(items))}
    for i, (o, t, vs) in enumerate(items):
        for j in range(i + 1, len(items)):
            t2, vs2 = items[j][1], items[j][2]
            hit = bool(t.overlap(t2))
            if not hit:                                         # both ways: a long part may have no vertex near
                step, step2 = max(1, len(vs) // 400), max(1, len(vs2) // 400)
                hit = (any(t2.find_nearest(v, 0.1)[0] is not None for v in vs[::step])
                       or any(t.find_nearest(v, 0.1)[0] is not None for v in vs2[::step2]))
            if hit:
                touch[i].add(j)
                touch[j].add(i)
    seen, todo = set(on), list(on)
    while todo:
        i = todo.pop()
        for j in touch[i]:
            if j not in seen:
                seen.add(j)
                todo.append(j)
    for i, (o, t, vs) in enumerate(items):
        if i not in seen:
            print("FLOAT %s (lowest %.2f)" % (o.name, min(v.z for v in vs)))
    print("DONE float", L, STATE, len(items), "parts")


if D.MODE == "float":
    if D.STATE == "damaged":
        G["build"]()
        damaged()
    else:
        destroyed()
    float_check()
else:
    D.run(damaged, destroyed)
