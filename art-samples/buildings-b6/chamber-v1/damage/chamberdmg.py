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


def rock(name, at, r, mat, squash=0.6, seed=0, jag=0.0):
    """A broken lump: a jagged icosphere (jag > 0: finer and more ragged, for the cutters of torn holes)."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2 if jag else 1, radius=r)
    for v in bm.verts:
        v.co *= 1 + rr.uniform(-0.3 - jag, 0.25 + jag * 0.6)
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


CUTS = []


def hole(target, at, r, seed=0, squash=1.0, n=None):
    """Knock a ragged hole into target (a boolean cut by a jagged lump, deep into the box); the hole's inside is
    black, as Flash's. The cuts are applied by cut_all()."""
    c = rock(f"cut{seed}", at, r, inside(), squash=squash, seed=seed, jag=0.25)
    c.scale = (1.0 + R.uniform(-0.2, 0.3), 1.0 + R.uniform(-0.2, 0.3), 1.0 + R.uniform(0.1, 0.5))
    c.display_type = "WIRE"
    m = target.modifiers.new("hole", "BOOLEAN")
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    m.material_mode = "TRANSFER"
    m.object = c
    CUTS.append(c)
    burn(at, r * 2.2 + 0.9)
    if n is not None:                       # torn plates bent outward round the rim
        n = Vector(n).normalized()
        t = n.cross(Vector((0, 0, 1))).normalized()
        z = t.cross(n)
        rr = random.Random(seed + 7)
        for k in range(rr.randint(3, 5)):
            a = rr.uniform(0, 2 * math.pi)
            d = t * math.cos(a) + z * math.sin(a)
            e = n.cross(d)
            ln, w = r * rr.uniform(0.5, 0.9), r * rr.uniform(0.3, 0.55)
            sh = box(f"shard{seed}_{k}", (ln, w, 0.07), (0, 0, 0), M["wall"], bevel=0.02, origin="center", jitter=0.03)
            bend = Matrix.Rotation(math.radians(-rr.uniform(25, 60)), 3, e)
            basis = Matrix((e, d, n)).transposed()
            mw = (bend @ basis).to_4x4()
            mw.translation = Vector(at) + d * (r * 0.8 + w * 0.3) + n * (0.04 + w * 0.3)
            sh.matrix_world = mw
            burn(mw.translation, 0.5)
    return c


def cut_all(*targets):
    """Apply the holes (bake the targets with their booleans), then drop the cutters."""
    for t in targets:
        D.bake(t)
    for c in CUTS:
        bpy.data.objects.remove(c, do_unlink=True)
    CUTS.clear()


def keep_in(obs, lim=5.5):
    """Move loose pieces (horns, lumps) in so they stay inside the building's own square (|x|, |y| <= lim)."""
    bpy.context.view_layer.update()
    vs = [o.matrix_world @ v.co for o in obs if o.type == "MESH" for v in o.data.vertices]
    if not vs:
        return
    dx = min(0.0, lim - max(p.x for p in vs)) or max(0.0, -lim - min(p.x for p in vs))
    dy = min(0.0, lim - max(p.y for p in vs)) or max(0.0, -lim - min(p.y for p in vs))
    for o in obs:
        o.location += Vector((dx, dy, 0))


def soot_more(amount, keep):
    """Battle grime over every material: blotchy dark patches (up to `amount` darker) and the whole colour scaled to
    `keep`; the even glow (lift) halved, so the dark reads. Flash's damaged and destroyed chambers are much darker."""
    for m in bpy.data.materials:
        if m.name == "inside" or not m.node_tree:
            continue
        t = m.node_tree
        bs = next((x for x in t.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if bs is None:
            continue
        inp = bs.inputs["Base Color"]
        geo = t.nodes.new("ShaderNodeNewGeometry")
        nz = t.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.9
        nz.inputs["Detail"].default_value = 6.0
        t.links.new(geo.outputs["Position"], nz.inputs["Vector"])
        mr = t.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.4
        mr.inputs["From Max"].default_value = 0.62
        mr.inputs["To Min"].default_value = keep
        mr.inputs["To Max"].default_value = keep * (1 - amount)
        t.links.new(nz.outputs["Fac"], mr.inputs["Value"])
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        cr = t.nodes.new("ShaderNodeCombineColor")
        for k in range(3):
            t.links.new(mr.outputs["Result"], cr.inputs[k])
        if inp.is_linked:
            t.links.new(inp.links[0].from_socket, mix.inputs[6])
        else:
            mix.inputs[6].default_value = inp.default_value
        t.links.new(cr.outputs[0], mix.inputs[7])
        t.links.new(mix.outputs[2], inp)
        es = bs.inputs["Emission Strength"]
        if es.is_linked:
            mul = t.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            mul.inputs[1].default_value = 0.5
            t.links.new(es.links[0].from_socket, mul.inputs[0])
            t.links.new(mul.outputs[0], es)
        else:
            es.default_value *= 0.5


def float_check(ground_tol=0.06, touch=0.3):
    """Every visible piece rests on the ground or touches another piece (its lowest points within `touch` of one);
    and nothing lies outside the building's square. Prints PROBE FLOAT / PROBE OUT lines (none = all good)."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    vs, trees = {}, {}
    for o in SC.objects:
        if o.type not in ("MESH", "CURVE") or o.hide_render or o.name == "ground":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        if me is None or not me.vertices:
            continue
        v = [ev.matrix_world @ x.co for x in me.vertices]
        vs[o.name] = v
        trees[o.name] = BVHTree.FromPolygons(v, [p.vertices[:] for p in me.polygons])
        ev.to_mesh_clear()
    for n, v in vs.items():
        if max(abs(p.x) for p in v) > 6.2 or max(abs(p.y) for p in v) > 6.2:
            print("PROBE OUT", n, round(max(abs(p.x) for p in v), 2), round(max(abs(p.y) for p in v), 2))
        zmin = min(p.z for p in v)
        if zmin < ground_tol or n.startswith("hornin"):     # (a horn's inside sits in its horn)
            continue
        low = sorted(v, key=lambda p: p.z)[:12]
        ok = False
        for m, t in trees.items():
            if m == n:
                continue
            if any((t.find_nearest(p)[3] or 9) < touch for p in low if t.find_nearest(p)[0] is not None):
                ok = True
                break
        if not ok:
            if n.startswith("shard"):               # a torn plate that missed its wall: drop it
                bpy.data.objects.remove(SC.objects[n], do_unlink=True)
                continue
            print("PROBE FLOAT", n, round(zmin, 2))


def chip(at, ln, mat, yaw, tilt=0.0, w=0.3, t=0.12):
    return box("chip", (ln, w, t), at, mat, rot=(R.uniform(-5, 5) + tilt, R.uniform(-6, 6), yaw), bevel=0.03,
               origin="center", jitter=0.02)


def drop(obs, z):
    """Move obs straight down (or up) so their lowest point sits at height z."""
    bpy.context.view_layer.update()
    low = min((o.matrix_world @ v.co).z for o in obs if o.type == "MESH" for v in o.data.vertices)
    for o in obs:
        o.location.z += z - low


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


def thaw():
    """The drums' ice crust is gone with the rest of the frost: bare dark metal (still dented)."""
    for o in named(r"tank\d"):
        o.data.materials[0] = G["M"]["grate"]


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    # the frost and ice are gone (Flash's damaged chamber has none), and the arms holding the lid
    kill(named(r"icicle.*|icicled.*|tankice.*|tankcap.*|frostc|frostt|frostj.*|frostl.*|lintel.*|arml.*|armr.*"))
    thaw()
    # the lid knocked loose: tipped up at its front and slid a little back, resting on the core's back edge
    lid = named(r"lid|grille.*")
    lx, ly, la, lz, lt = S.LID
    turn(lid, world((lx - la, ly + la, lz)), world((1, 1, 0)) - world((0, 0, 0)), -16)
    burn(world((lx + la * 0.6, ly - la * 0.6, lz + 0.5)), 1.6)
    drop(lid, lz - 0.02)
    # ragged holes of different sizes in the -Y face (left of the door, high) and in the +X face above the compressor
    body = named(r"body")[0]
    for k, (x, z, r) in enumerate(((-2.85, 3.9, 0.62), (2.55, 3.4, 0.75), (-0.4, 5.25, 0.5), (-2.9, 1.3, 0.4),
                                   (2.4, 1.2, 0.36))):
        hole(body, world((x, -AY, z)), r, seed=40 + k, squash=0.9, n=(S.SHEAR, -1, 0))
    for k, (y, z, r) in enumerate(((2.2, 4.75, 1.0), (-0.9, 4.95, 0.55), (-3.1, 4.3, 0.6), (0.6, 4.1, 0.3))):
        hole(body, world((AX, y, z)), r, seed=50 + k, squash=0.9, n=(1, 0, 0))
    comp = named(r"comp")[0]
    hole(comp, world((S.COMP[0], 0.4, 2.9)), 0.55, seed=60, n=(1, 0, 0))
    hole(comp, world((S.COMP[0] - 0.6, S.COMP[1], 1.6)), 0.5, seed=61)
    tx, ty, tr, zs = S.TANK
    tank = named(r"tank1")[0]
    rr = (zs[1][1] - zs[1][0]) / 2                 # (r5: the drums lie on their side; a hole in the upper one's front)
    hole(tank, world((tx + rr * 0.75, ty - rr * 0.75, (zs[1][0] + zs[1][1]) / 2)), 0.42, seed=62, n=(1, -1, 0))
    burn(world((tx, ty, 2.2)), 1.8)
    burn(world((S.COMP[0], 1.2, 1.2)), 1.6)
    cut_all(body, comp, tank)
    soot_more(0.62, 0.72)
    # the corner post cracked at its foot (scorched), the door's grate half torn out, its leaf fallen flat
    burn(world((AX, -AY, 1.2)), 1.0)
    kill(named(r"grate2|grate3|grate5|grater1"))
    kill(named(r"leaf"))
    x0, x1, z0, z1 = S.DOOR
    box("leafdown", (1.15, z1 - z0 - 0.3, 0.1), world((x0 - 0.2, -AY - 2.3, 0.0)), M["grate"], rot=(3, -2, -12),
        bevel=0.03)
    keep_in(named(r"leafdown"))
    burn(world((x0 - 0.2, -AY - 2.3, 0.0)), 1.0)
    # the right horn knocked off onto the grass on the right, the coil bent out at its top, one fin off on the roof
    keep_in(lay_horn(2, px(78, 56, Z=0.0), 25, roll=10))
    coil = named(r"coil")
    turn(coil, world((S.COMP[0], 0, S.COIL[2])), world((0, 1, 0)) - world((0, 0, 0)), 18)
    fin = named(r"fin1")
    turn(fin, world((AX + 1.0, S.FINS_Y[1], S.COMP[3])), world((0, 1, 0)) - world((0, 0, 0)), 62)
    drop(fin, S.COMP[3] - 0.03)
    # rubble: bits of the walls and the bars on the grass in front
    for k, (sx, sy, r) in enumerate(((-34, 64, 0.32), (-6, 82, 0.26), (30, 78, 0.3), (-58, 60, 0.22), (60, 66, 0.24))):
        rock(f"lump{k}", px(sx, sy, Z=0.08), r, M["wall"], seed=20 + k)
    for k, (sx, sy, ln, yaw) in enumerate(((-46, 66, 0.9, 30), (14, 80, 0.7, -40))):
        chip(px(sx, sy, Z=0.07), ln, M["bar"], yaw)
    for o in named(r"lump.*|chip.*"):
        keep_in([o])
    float_check()


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    G["build"]()
    kill(named(r"icicle.*|icicled.*|tankice.*|tankcap.*|frostc|frostt|frostj.*|frostl.*|lintel.*|arml.*|armr.*|fin.*|pipe|grate.*|leaf|door|hatchpane.*|"
               r"jamb.*|sill|hatch.*|core|tank1|tankshaft|bar1|bar3|coilpanel.*|ladder.*"))
    thaw()
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
        c = sum((o.matrix_world @ Vector(b) for b in o.bound_box), Vector()) / 8
        sc = (0.55, 1, 1, 1) if o.name.startswith("bar0") else (1, 0.45, 1, 1)
        o.data.transform(Matrix.Translation(c) @ Matrix.Diagonal(sc) @ Matrix.Translation(-c))
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
    for k, (x, y, r) in enumerate(((-0.8, -0.2, 1.2), (0.9, 0.7, 1.1), (-0.4, 1.4, 1.15), (0.7, -1.5, 1.1), (-1.6, -1.6, 0.9))):
        rock(f"proplump{k}", world((x, y, hz + 0.3)), r, M["wall"], squash=0.85, seed=120 + k)
        burn(world((x, y, hz + 0.4)), 1.3)
    lid = named(r"lid|grille.*")
    lx, ly, la, lz, lt = S.LID
    mid = world((lx, ly, lz))
    target = px(6.0, -6.0, Z=hz + 2.4)
    turn(lid, mid, world((1, 1, 0)) - world((0, 0, 0)), 24, move=target - mid)
    # let it down onto whatever is under it (the lumps, the shell's floor): the least gap below its corners
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    slab = named(r"lid")[0]
    gap = 99.0
    for v in slab.data.vertices:
        q = slab.matrix_world @ v.co
        hit, loc, _, _, ob, _ = SC.ray_cast(dg, q - Vector((0, 0, 0.01)), Vector((0, 0, -1)))
        while hit and (ob in lid):
            hit, loc, _, _, ob, _ = SC.ray_cast(dg, loc - Vector((0, 0, 0.01)), Vector((0, 0, -1)))
        if hit:
            gap = min(gap, q.z - loc.z)
    turn(lid, mid, (0, 0, 1), 0, move=(0, 0, -(gap - 0.02)))
    # broken wall slabs standing under its high edge, holding it up
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    for k, (x, y) in enumerate(((1.4, -1.4), (-1.2, -1.8), (0.2, -2.4))):
        p = world((x, y, hz + 0.05))
        hit, loc, _, _, ob, _ = SC.ray_cast(dg, p, Vector((0, 0, 1)))
        if hit and ob.name.startswith("lid") and loc.z - hz > 0.6:
            box(f"prop{k}", (0.9, 0.45, loc.z - hz + 0.1), world((x, y, hz - 0.1)), M["wall"],
                rot=(R.uniform(-8, 8), R.uniform(-8, 8), R.uniform(0, 90)), bevel=0.05, jitter=0.05, taper=0.85)
            burn(p, 1.0)
    # the horns thrown down: two on the left, one at the right front
    keep_in(lay_horn(0, world((-2.3, -3.2, hz)), -110, roll=0))
    keep_in(lay_horn(1, world((-0.6, -3.4, hz)), 200, roll=20))
    keep_in(lay_horn(2, world((4.6, -4.4, 0.0)), -15, roll=-10))
    # scattered rubble and bar ends
    for k, (sx, sy, r) in enumerate(((-16, 74, 0.34), (10, 78, 0.3), (-52, 56, 0.26), (36, 68, 0.3), (-62, 44, 0.3),
                                     (50, 52, 0.36))):
        rock(f"lump{k}", px(sx, sy, Z=0.1), r, M["wall"], seed=20 + k)
    for k, (sx, sy, ln, yaw) in enumerate(((-44, 64, 1.2, 25), (24, 74, 1.0, -35), (52, 40, 0.9, 80))):
        chip(px(sx, sy, Z=0.12), ln, M["bar"], yaw, w=0.5, t=0.4)
    for o in named(r"lump.*|chip.*"):
        keep_in([o])
    soot_more(0.7, 0.5)
    float_check()


D.run(damaged, destroyed, soot_amount=(0.55, 0.7))
