"""baiterdmg.py : the Wild Monster Baiter's damaged and destroyed looks in 3D, as Flash's top.1.damaged.png and
top.1.destroyed.png (one look for every level). The model (../baiter.py) is built as it is, at its first pose, then
broken where Flash's damaged picture breaks it: the domed top crushed and dented with the valve torn open, the cap
crushed into the hole, the plates bent out, the bail snapped and hanging over the front, green goo running down the
right, the cog fallen off its axle at the foot, ragged holes in the can. The destroyed look is a torn can stump with a
zigzag rim inside a ring of dark boulders, steel shards round it.

    blender -b --factory-startup -P baiterdmg.py -- 1 <prev|still|float> <damaged|destroyed>
    float: no render; lists every part that neither rests on the ground nor (through other parts) on something that does

Flash has no damaged or destroyed animation for the Baiter, so each look is one still (no spray).
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dmgcore as D  # noqa: E402

D.load(HERE.parent / "baiter.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
P, lump, shiny, ring, MOVING = G["P"], G["lump"], G["shiny"], G["ring"], G["MOVING"]
R = random.Random(19)
O = bpy.data.objects


# ------------------------------------------------------------------------------------------------------------ helpers
def free(*names):
    """Unparent the named objects, keeping where they are."""
    bpy.context.view_layer.update()
    out = []
    for n in names:
        o = O[n]
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        out.append(o)
    return out


def turn(obs, pivot, axis, deg, move=(0, 0, 0)):
    """Turn obs deg degrees round the line through pivot along axis (world), then move them."""
    bpy.context.view_layer.update()
    p = Vector(pivot)
    m = Matrix.Translation(p + Vector(move)) @ Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ \
        Matrix.Translation(-p)
    for o in obs:
        o.matrix_world = m @ o.matrix_world


def squash(obs, pivot, k):
    """Squash obs vertically by k about the height of pivot."""
    bpy.context.view_layer.update()
    p = Vector(pivot)
    m = Matrix.Translation(p) @ Matrix.Diagonal((1, 1, k, 1)) @ Matrix.Translation(-p)
    for o in obs:
        o.matrix_world = m @ o.matrix_world


def dense(prof, step=0.08):
    """The (r, z) profile with points added every `step` along it (so holes and dents have faces to work on)."""
    out = [prof[0]]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        n = max(1, int(math.hypot(r1 - r0, z1 - z0) / step))
        out += [(r0 + (r1 - r0) * i / n, z0 + (z1 - z0) * i / n) for i in range(1, n + 1)]
    return out


def lowv(obs):
    """The lowest vertex of obs (not their bounding box: a tilted part's box reaches below it)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    z = 1e9
    for o in obs:
        for k in kids(o):
            if k.type == "MESH":
                ev = k.evaluated_get(dg)
                me = ev.to_mesh()
                z = min([z] + [(ev.matrix_world @ v.co).z for v in me.vertices])
                ev.to_mesh_clear()
    return z


def sitv(obs):
    """Drop obs so their lowest vertex is on the ground."""
    z = lowv(obs)
    for o in obs:
        o.location.z += GROUND + 0.01 - z


def bearing_of(p):
    return math.degrees(math.atan2(p[1], p[0]))


def dent(o, spots):
    """Push o's vertices (world) in toward the can's axis round spots (bearing, z, radius, depth): crumpled metal."""
    mw, mi = o.matrix_world, o.matrix_world.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        for th, z, rad, depth in spots:
            c = P(th, math.hypot(w.x, w.y), z)
            d = (w - c).length
            if d < rad:
                k = (1 - (d / rad) ** 2) ** 2
                rad_dir = Vector((w.x, w.y, 0)).normalized()
                w = w - rad_dir * depth * k * (0.8 + 0.4 * math.sin(7 * w.z + 3 * w.x))
        v.co = mi @ w


def tear(o, spots, seed=0):
    """Ragged holes in the can-like sheet o round spots (bearing, z, radius): the rim jagged (two waves round the
    hole, and each face's own jitter), the metal round it charred."""
    r = random.Random(seed)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw = o.matrix_world
    dead = []
    for f in bm.faces:
        w = mw @ f.calc_center_median()
        for k, (th, z, rad) in enumerate(spots):
            c = P(th, math.hypot(w.x, w.y), z)
            a = math.radians(th)
            t = Vector((-math.sin(a), math.cos(a), 0))
            d = w - c
            ang = math.atan2(d.z, d.dot(t))
            edge = rad * (0.82 + 0.22 * math.sin(5 * ang + k + seed) + 0.12 * math.sin(11 * ang + 2 * k) +
                          r.uniform(-0.12, 0.12))
            if d.length < edge:
                dead.append(f)
                break
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    for th, z, rad in spots:
        burn(P(th, S.CAN_R, z), rad + 0.55)


def flake(name, at, size, mat, seed):
    """A torn flat piece of the can's sheet steel: an uneven polygon, thin, lying at `at` (its middle)."""
    rr = random.Random(seed)
    k = 7
    pts = []
    for i in range(k):
        a = 2 * math.pi * (i + rr.uniform(-0.25, 0.25)) / k
        r = size * rr.uniform(0.45, 1.0)
        pts.append((r * math.cos(a) * 1.5, r * math.sin(a) * 0.7))
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, 0.0)) for x, y in pts]
    hi = [bm.verts.new((x, y, 0.05)) for x, y in pts]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = G["mesh_ob"](name, bm, [mat], smooth=False)
    ob.location = at
    ob.rotation_euler = (math.radians(rr.uniform(-6, 6)), math.radians(rr.uniform(-6, 6)), rr.uniform(0, 6.3))
    return ob


def chip(at, ln, mat, yaw):
    """A flat broken bit of sheet metal lying at `at`."""
    return box("chip", (ln, R.uniform(0.2, 0.3), 0.06), at, mat, rot=(R.uniform(-6, 6), R.uniform(-8, 8), yaw),
               bevel=0.015, origin="center", jitter=0.03)


def disc(name, r, z, mat):
    return lathe(name, [(0.0, z), (r, z)], (0, 0, 0), mat, verts=48)


def goo_mat():
    return shiny("goo", (150, 232, 92), rough=0.15, metal=0.0, wear=(196, 246, 150), scale=3.0, dirt=0.0, spec=0.6)


def steel():
    """The bare torn can metal: dark blue-grey steel, as Flash's stump."""
    return shiny("torn", (70, 80, 92), rough=0.38, metal=0.6, wear=(108, 120, 134), scale=3.0, dirt=0.35, spec=0.45)


# ------------------------------------------------------------------------------------------------------------ damaged
DOME_PROF = None


def dome_profile():
    R_, Z1 = S.CAN_R, S.CAN_Z1
    return [(R_ - 0.06, Z1 - 0.04), (R_ - 0.03, Z1 + 0.05), (S.FLANGE_R - 0.04, S.LIP_Z - 0.02),
            (S.LIP_R - 0.02, S.LIP_Z - 0.01), (S.LIP_R + 0.02, S.LIP_Z + 0.03), (S.LIP_R - 0.01, S.LIP_Z + 0.08),
            (S.LIP_R - 0.04, S.LIP_Z + 0.105)] + G["bell"]()


def damaged():
    G["turn"](0)                                      # the first pose (bail toward the back left), no spray
    for o in list(SC.objects):
        if o.name.startswith(("spray", "speck")):
            bpy.data.objects.remove(o, do_unlink=True)
    rig = [o for o in SC.objects if o.parent is not None and o.parent.name == "rig-spin"]
    free(*[o.name for o in rig])
    MOVING.clear()

    # the can again with rows every 0.08 (same shape and label), dented low on the left and torn in two places
    kill([O["can"]])
    R_, Z1 = S.CAN_R, S.CAN_Z1
    can = lathe("can", dense([(R_ - 0.1, 0.0), (R_ - 0.02, 0.03), (R_, 0.1), (R_, Z1 - 0.02), (R_ - 0.02, Z1)], 0.07),
                (0, 0, 0), M["label"], verts=160)
    lathe("caninside", [(0.0, 0.06), (R_ - 0.16, 0.06), (R_ - 0.16, Z1 - 0.1), (0.0, Z1 - 0.1)], (0, 0, 0), inside(),
          verts=48)
    dents = [(-112, 1.5, 1.3, 0.22), (-62, 3.0, 0.9, 0.16), (-20, 1.0, 0.8, 0.12), (24, 3.5, 0.7, 0.1)]
    tears = [(-100, 1.25, 0.62), (-58, 3.05, 0.34), (-12, 0.7, 0.24)]
    dent(can, dents)
    tear(can, tears, seed=3)
    dent(O["dripsheet"], dents)                      # the slime on the label follows the crumpled, torn wall
    tear(O["dripsheet"], tears, seed=3)

    # the domed top rebuilt fine, crushed lower, dented, torn open round the valve (the rim curling up)
    kill([O["dome"], O["toprim"], O["valvecup"]])
    dome = lathe("dome", dense(dome_profile(), 0.06), (0, 0, 0), M["dome"], verts=128)
    me = dome.data
    for v in me.vertices:
        if v.co.z > S.LIP_Z:
            v.co.z = S.LIP_Z + (v.co.z - S.LIP_Z) * 0.74
        if v.co.z > S.CAN_Z1:                        # crushed down, the metal bulges out over the crown
            k = 1 + 0.045 * min(1.0, (v.co.z - S.CAN_Z1) / 0.25)
            v.co.x *= k
            v.co.y *= k
    for th, rr, z, rad, depth in ((-150, 2.1, 4.85, 1.0, 0.42), (-80, 2.3, 4.75, 0.9, 0.36), (-40, 2.5, 4.62, 0.6, 0.22),
                                  (10, 2.2, 4.8, 0.8, 0.3), (60, 1.8, 4.9, 0.7, 0.24), (-115, 1.6, 4.98, 0.5, 0.18)):
        c = P(th, rr, z)
        for v in me.vertices:
            d = (v.co - c).length
            if d < rad:
                k = (1 - (d / rad) ** 2) ** 2
                v.co -= (v.co - Vector((0, 0, S.LIP_Z - 0.6))).normalized() * depth * k * \
                    (0.8 + 0.4 * math.sin(9 * v.co.x + 5 * v.co.y))
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        a = math.atan2(c.y, c.x)
        edge = 1.12 + 0.2 * math.sin(4 * a + 1) + 0.12 * math.sin(9 * a) + R.uniform(-0.1, 0.1)
        if math.hypot(c.x, c.y) < edge:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    for v in bm.verts:                               # the torn edge bent up and out a little, unevenly
        rr = math.hypot(v.co.x, v.co.y)
        if rr < 1.6:
            k = (1.6 - rr) / 0.5
            a = math.atan2(v.co.y, v.co.x)
            v.co.z += k * 0.22 * (0.5 + 0.5 * math.sin(5 * a + 2))
    bm.to_mesh(me)
    bm.free()
    burn((0, 0, 4.95), 2.0)

    # the cap: crushed to half its height, knocked over toward the right and sunk into the torn hole
    capset = [O[n] for n in ("cap", "captop", "lever", "leverfoot", "spout", "spoutmouth")]
    squash(capset, (0, 0, S.CAP_Z0), 0.55)
    turn(capset, (0, 0, S.CAP_Z0), P(-45, 1, 0), -22, move=(0.12, 0.22, -0.32))
    burn((0.3, 0.4, 4.9), 1.0)
    z = lowv(capset) - 0.01                       # the dark inside under the hole (the cap rests on it), its edge
    lathe("domeinside", [(0.0, z), (1.85, z), (2.5, S.LIP_Z - 0.1)], (0, 0, 0), inside(), verts=64)   # on the flange

    # the plates bent outward (the front-left one far), the bail snapped off the back plate and hanging over the front
    kill([O["bail"]])
    plB = [O[n] for n in ("plateB", "plateBrivet0", "plateBrivet1", "plateBbolt")]
    plA = [O[n] for n in ("plateA", "plateArivet0", "plateArivet1", "plateAbolt")]
    turn(plB, (0, -S.PLATE_R, S.PLATE_Z0 + 0.1), (1, 0, 0), 34)
    turn(plA, (0, S.PLATE_R, S.PLATE_Z0 + 0.1), (1, 0, 0), -14)
    turn(plA, (0, S.PLATE_R, S.PLATE_Z0 + 0.1), (0, 1, 0), 10)
    bpy.context.view_layer.update()
    b0 = O["plateBbolt"].matrix_world @ Vector((0, 0, 0.36))
    pts = [b0, P(-84, 2.92, 4.42), P(-72, 2.86, 4.12), P(-58, 2.8, 3.86), P(-42, 2.79, 3.73), P(-26, 2.79, 3.71),
           P(-10, 2.79, 3.74), P(4, 2.78, 3.62), P(13, 2.64, 3.22), P(17, 2.52, 2.86)]
    tube("bail", pts, 0.055, M["wire"], verts=10, smooth=True)
    a0 = O["plateAbolt"].matrix_world @ Vector((0, 0, 0.36))
    tube("bailstub", [a0, a0 + Vector((-0.25, 0.12, 0.55)), a0 + Vector((-0.6, 0.1, 0.78))], 0.055, M["wire"],
         verts=10, smooth=True)
    burn(P(-90, 2.8, 4.9), 0.7)

    # the crown knocked askew on its seat
    turn([O["crown"], O["crownteeth"]], P(135, S.CROWN_R, S.CROWN_Z1), P(45, 1, 0), 3)

    # green goo out of the top, running down the can's right side, each run ending in a drop
    gm = goo_mat()
    tube("goorim", [P(b, R_ + 0.07, 4.22 + 0.04 * math.sin(b / 9)) for b in range(-14, 66, 4)], 0.13, gm, verts=12,
         smooth=True)
    for i, (b, z1, w) in enumerate(((-6, 3.2, 0.11), (8, 1.4, 0.15), (22, 2.3, 0.2), (34, 0.9, 0.17), (47, 2.9, 0.14),
                                    (58, 1.9, 0.12))):
        pts = [P(b + 1.5 * math.sin(z * 2.0 + i), R_ + 0.03, z) for z in [4.2 - (4.2 - z1) * k / 8 for k in range(9)]]
        tube("goo%d" % i, pts, w, gm, verts=12, r_end=w * 0.75, smooth=True)
        lump("goodrop%d" % i, P(b + 1.5 * math.sin(z1 * 2.0 + i), R_ + 0.08, z1 - w * 1.4),
             (w * 1.3, w * 1.2, w * 1.5), gm, 900 + i, subdiv=2)
    lump("goopool", P(30, R_ + 0.35, 0.0), (0.42, 0.75, 0.05), gm, 950, subdiv=2, rot_z=30)
    burn(P(25, R_, 4.2), 0.9)

    # the whole top knocked over a little to the left (its right edge lifts off the can, the goo rim fills the gap)
    top = [O[n] for n in ("dome", "domeinside", "crown", "crownteeth", "bail", "bailstub", "goorim")] + plA + plB + capset
    turn(top, (0, 0, S.CAN_Z1), P(-45, 1, 0), 5)

    # the cog off its axle, fallen at the foot, leaning back on the can's foot; the tag bent further
    th = 5.0
    out = Vector((math.cos(math.radians(th)), math.sin(math.radians(th)), 0))
    axis = (Vector((0, 0, 1)) * math.cos(math.radians(40)) + out * math.sin(math.radians(40))).normalized()
    c = P(th, 3.5, S.COG_R * math.sin(math.radians(40)) + 0.04)
    place_wheel("cogspin", c, axis, spin=11)
    sitv([O["cogspin"]])
    burn(c, 1.0)
    turn([O["tag"]], O["tagring"].location, P(90, 1, 0), 18)
    kill([O["axlenut"]])
    box("axlenut", (0.3, 0.3, 0.12), P(-62, 3.35, 0.0), M["axle"], rot=(0, 0, 20), bevel=0.02)

    # broken bits at the foot: crushed rim pieces off the dome, a bolt
    for i, (b, d) in enumerate(((-70, 3.0), (-40, 3.4), (-150, 3.2))):
        chip(P(b, d, 0.05), R.uniform(0.35, 0.6), M["dome"], b + R.uniform(-40, 40))
    sit([o for o in SC.objects if o.name.startswith(("chip", "axlenut"))])


# ------------------------------------------------------------------------------------------------------------ destroyed
def stump(teeth=7, z0=1.05, amp=1.15):
    """The torn can: a ring of steel with a zigzag rim (big triangular teeth, uneven), thin wall, dark inside."""
    R_ = S.CAN_R
    n = teeth * 24
    bm = bmesh.new()
    rr = random.Random(5)
    tops = []
    for i in range(n):
        f = (i / 24.0) % 1.0
        tooth = i // 24
        h = 1 - abs(f - 0.5) * 2                     # 0 at the notch, 1 at the point
        big = (0.55, 1.0, 0.75, 1.1, 0.6, 0.95, 0.8)[tooth % 7]
        tops.append(z0 + amp * big * h ** 0.9 + rr.uniform(-0.05, 0.05))
    rows = 16
    walls = []
    for k, r in enumerate((R_, R_ - 0.07)):
        cols = []
        for i in range(n):
            a = 2 * math.pi * i / n
            ro = r + (rr.uniform(-0.03, 0.03) if k == 0 else 0.0)
            zb = 0.03 if k == 0 else 0.06
            col = []
            for q in range(rows + 1):
                f = q / rows
                z = zb + (tops[i] - zb) * f
                wob = (0.06 * math.sin(3 * a + 1) + 0.1 * (tops[i] - z0) / amp) * f ** 2   # the points bend outward
                col.append(bm.verts.new(((ro + wob) * math.cos(a), (ro + wob) * math.sin(a), z)))
            cols.append(col)
        walls.append(cols)
    o, w = walls
    for i in range(n):
        j = (i + 1) % n
        for q in range(rows):
            bm.faces.new((o[i][q], o[j][q], o[j][q + 1], o[i][q + 1]))
            bm.faces.new((w[j][q], w[i][q], w[i][q + 1], w[j][q + 1]))
        bm.faces.new((o[i][rows], o[j][rows], w[j][rows], w[i][rows]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = G["mesh_ob"]("stump", bm, [steel()], smooth=True, bevel=0.0)
    return ob, tops


def mound():
    """A crater rim: a lathed ring (inner foot against the can, crest, outer foot) lumpy with noise, its crest high
    at the back and low in front so the stump shows over it."""
    rr = random.Random(23)
    n, prof = 144, [(2.45, 0.0), (2.5, 0.45), (2.68, 0.92), (3.05, 1.08), (3.45, 0.82), (3.78, 0.32), (3.98, 0.0)]
    bm = bmesh.new()
    cols = []
    ph = [rr.uniform(0, 6.3) for _ in range(4)]
    for i in range(n):
        a = 2 * math.pi * i / n
        back = 0.5 + 0.5 * math.cos(a - math.radians(135))           # 1 at the back, 0 in front
        h = (0.5 + 0.62 * back) * (1 + 0.18 * math.sin(5 * a + ph[0]) + 0.1 * math.sin(11 * a + ph[1]))
        w = 1 + 0.05 * math.sin(3 * a + ph[2])
        col = []
        for r, z in prof:
            r2 = r * w + (0.06 * math.sin(7 * a + 3 * z + ph[3]) if 0 < z else 0.0)
            col.append(bm.verts.new((r2 * math.cos(a), r2 * math.sin(a), z * h)))
        cols.append(col)
    for i in range(n):
        j = (i + 1) % n
        for q in range(len(prof) - 1):
            bm.faces.new((cols[i][q], cols[j][q], cols[j][q + 1], cols[i][q + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mat = G["painted"]("mound", (40, 43, 40), rough=0.85, metal=0.0, wear=(64, 74, 54), scale=3.0, dirt=0.3, spec=0.25,
                         top=(78, 82, 76))                 # Flash's crater rim: dark grey, mossy, paler on top
    ob = G["mesh_ob"]("mound", bm, [mat], smooth=True, subsurf=2)
    d = ob.modifiers.new("lumps", "DISPLACE")
    tx = bpy.data.textures.new("lumps", "VORONOI")
    tx.noise_scale = 0.75
    d.texture = tx
    d.texture_coords = "OBJECT"
    d.strength = 0.36
    d.mid_level = 0.5
    for k in range(10):
        a = 360 * k / 10 + rr.uniform(-10, 10)
        burn(P(a, 3.0, 0.8), 1.0)
    return ob


def destroyed():
    G["build"]()
    keep = [o for o in SC.objects if o.name.startswith("stone")]
    kill([o for o in SC.objects if o.parent is None and o not in keep and o.type in ("MESH", "CURVE", "EMPTY")])
    MOVING.clear()
    st, tops = stump()
    dent(st, [(-60, 0.9, 0.9, 0.18), (20, 1.4, 0.7, 0.12)])
    tear(st, [(-30, 0.75, 0.42), (-118, 1.5, 0.3)], seed=8)
    ring("canfoot", S.CAN_R + 0.01, 0.06, M["foot"], z=0.11, n=128)
    disc("stumpinside", S.CAN_R - 0.08, 0.08, inside())
    for i in range(0, len(tops), 24):
        burn(P(360 * (i + 12) / len(tops), S.CAN_R, tops[i + 12]), 1.0)
    burn((0, 0, 0.5), 2.4)
    # a low ring mound of dark rock and earth round the stump (the two boulders crushed into it), lower in front
    mound()
    for j, th in enumerate((-60, -20, -95, 5, 35)):
        lump("stonex%d" % j, P(th, 4.05 + 0.15 * (j % 2), 0.0), (0.2, 0.15, 0.1), M["stone"], 80 + j, rot_z=th,
             subdiv=2)
    # steel shards of the can thrown round it: pale, flat, bent
    sh = shiny("shard", (150, 166, 184), rough=0.3, metal=0.3, wear=(120, 134, 150), scale=3.0, dirt=0.1, spec=0.5)
    for i, (th, d) in enumerate(((-150, 4.4), (-120, 4.25), (110, 4.4), (150, 4.6), (175, 4.3), (60, 4.25), (-40, 4.2),
                                 (-5, 4.2))):
        o = flake("shard", P(th, d, 0.05), R.uniform(0.38, 0.6), sh, 700 + i)
        sit([o])
    sit([o for o in SC.objects if o.name.startswith("stonex")])


# ------------------------------------------------------------------------------------------------------------ checks
def floating():
    """Parts that do not rest on the ground nor, through touching parts, on anything that does."""
    tr = G["trees"]()
    obs = [(o, t, vs) for o, t, vs in tr.values() if not o.hide_render and vs]
    touch = {o.name: set() for o, _, _ in obs}
    for i, (a, ta, va) in enumerate(obs):
        for b, tb, vb in obs[i + 1:]:
            hit = bool(ta.overlap(tb))
            if not hit:
                for v in va[::2]:
                    h = tb.find_nearest(v, 0.06)
                    if h[0] is not None:
                        hit = True
                        break
            if hit:
                touch[a.name].add(b.name)
                touch[b.name].add(a.name)
    todo = [o.name for o, _, vs in obs if min(v.z for v in vs) <= GROUND + 0.06]
    ok = set(todo)
    while todo:
        n = todo.pop()
        for m in touch[n]:
            if m not in ok:
                ok.add(m)
                todo.append(m)
    bad = [o.name for o, _, _ in obs if o.name not in ok]
    for n in bad:
        print("FLOAT", n)
    print("DONE float", STATE, len(obs), "parts,", len(bad), "floating")


if MODE == "float":
    if STATE == "damaged":
        G["build"]()
        damaged()
    else:
        destroyed()
    floating()
else:
    D.run(damaged, destroyed)
