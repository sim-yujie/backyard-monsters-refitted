"""pebbledmg.py : the Pebble Shiner's damaged and destroyed looks in 3D, as Flash's top.<n>.damaged.png and
top.destroyed.png. The approved model (pebble2.py + stack.py, art/buildings-3d-b6 7a9f41361, copied here unchanged)
is built as it is, then broken where Flash's damaged picture has it broken; the destroyed look is its parts in one heap
(Flash has one heap for every level).

    blender -b --factory-startup -P pebbledmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 3

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135. Flash has no
damaged or destroyed animation for this building, so the rings, drum and ball stand still.
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import dmgcore as D  # noqa: E402

D.load(HERE / "pebble2.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
MATS = {"plank": M["roof"]("Y"), "stick": M["roofb"]("Z"), "bracket": M["iron"]}


# ------------------------------------------------------------------------------------------------------------ helpers
def bearing(o):
    """A block's bearing round the tower (degrees, -180..180), from its world middle."""
    c = bbox_w(o)
    return math.degrees(math.atan2(c.y, c.x))


def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def blocks(*names):
    """Every stone block of these courses, rings' blocks too (they hang under the ring's hub)."""
    return [o for o in SC.objects if o.type == "MESH" and base(o) in names]


def facing(obs, lo, hi):
    return [o for o in obs if lo <= bearing(o) <= hi]


def knock_out(obs, picks, push=0.0, drop=False, r=None):
    """Blocks by index in obs: knocked out of their course (gone, the dark core behind shows), or with push pushed
    out of the wall and tipped (hanging half out). Each break is scorched."""
    r = r or random.Random(L)
    for i in picks:
        if i >= len(obs):
            continue
        o = obs[i]
        c = bbox_w(o)
        burn(c, 0.9)
        if push <= 0:
            kill([o])
            continue
        out = Vector((c.x, c.y, 0)).normalized()
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = Matrix.Translation(out * push + Vector((0, 0, -0.1 if drop else 0))) @ \
            Matrix.Translation(c) @ Matrix.Rotation(math.radians(r.uniform(14, 28)), 4, Vector((-out.y, out.x, 0))) @ \
            Matrix.Translation(-c) @ mw


def stones(spots, seed=0, mat=None):
    """Fallen stone blocks on the ground: spots (x, y, size)."""
    r = random.Random(seed + 10 * L)
    for x, y, s in spots:
        size = (1.1 * s * r.uniform(0.85, 1.15), 0.75 * s * r.uniform(0.85, 1.15), 0.55 * s)
        box("rubblestone", size, (x, y, GROUND - 0.03), mat or M["stone"],
            rot=(r.uniform(-8, 8), r.uniform(-8, 8), r.uniform(0, 180)), bevel=0.12 * s, jitter=0.04)


def boards(spots, seed=0):
    """Roof planks knocked off, lying on the ground: spots (x, y, yaw)."""
    r = random.Random(seed + 10 * L)
    for x, y, yaw in spots:
        ob = G["shingle_mesh"]("fallenplank", 0.5, 0.36, r.uniform(0.9, 1.3), 0.08, M["roof"]("Y"), tip=0.18)
        ob.matrix_world = Matrix.Translation((x, y, GROUND + 0.06)) @ \
            Matrix.Rotation(math.radians(yaw), 4, "Z") @ Matrix.Rotation(math.radians(r.uniform(-8, 8)), 4, "Y")


ROOF = ("roofdeck", "roofplank", "roofpeak", "roofcap", "roofinside")
PIPE = ("pipearm", "pipeplate", "pipesocket", "pipe", "pipeband", "hornneck", "horn")
CORES = ("headcore", "collarcore", "shaft", "legcore", "ring1band", "ring2band")


def polar(th, r, z):
    return Vector(S.polar(th, r, z))


def gapdark():
    """Behind a knocked-out block Flash shows a dark gap: the cores and ring bands go near black."""
    m = bpy.data.materials.get("gapdark")
    if m is None:
        m = bpy.data.materials.new("gapdark")
        m.use_nodes = True
        bs = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Base Color"].default_value = (0.07, 0.07, 0.08, 1)
        bs.inputs["Roughness"].default_value = 1.0
    for o in SC.objects:
        if o.type == "MESH" and base(o) in CORES:
            for s in o.material_slots:
                s.material = m


def wreck_roof(holes, gone=0.25, short=0.35, wrench=0.1, seed=0, peak=True):
    """Flash's damaged roofs are ragged: planks torn off (the deck and black holes under them), plank feet broken off
    short with burnt ends, a few wrenched loose, scorched. holes: (bearing, s up the roof, size). Before any hinge."""
    r = random.Random(seed + 7 * L)
    ze, RR, RH, rr = S.z_eave(L), G["RR"], G["RH"], G["roof_r"]
    deck = objs("roofdeck")[0]
    zt = max(v.co.z for v in deck.data.vertices) + deck.location.z
    top = (zt - ze) / RH
    prof = [(0.0, ze + 0.03)] + [(max(0.0, rr(top * i / 12) - 0.32), ze + 0.03 + (zt - ze - 0.3) * i / 12)
                                 for i in range(13)] + [(0.0, zt - 0.27)]
    lathe("roofinside", prof, (0, 0, 0), D.inside(), verts=48)
    span = 2 * (RR - 0.1)
    pts = []
    patches = []
    for th, s, size in holes:
        p = polar(th, rr(s), ze + RH * s)
        pts.append((p, size))
        patches.append((0.5 + p.x / span, 0.5 + p.y / span, 0.55 * size / span, 0.45 * size / span))
    d = fine_holes(deck, patches, axes=("x", "y"), cuts=4, seed=seed)
    d.name = "roofdeck"
    pl = objs("roofplank")
    for o in pl:
        c = bbox_w(o)
        hit = any((Vector((c.x, c.y)) - Vector((p.x, p.y))).length < size * 0.5 for p, size in pts)
        k = r.random()
        if hit or k < gone:
            if r.random() < 0.3:
                burn(c, 0.5)
            kill([o])
        elif k < gone + short:
            rag(o, r.uniform(0.7, 0.92), r)
        elif k < gone + short + wrench:
            mw = o.matrix_world.copy()
            ys = [v.co.y for v in o.data.vertices]
            q = mw @ Vector((0, max(ys), 0))
            ax = mw.col[0].xyz.normalized()
            o.matrix_world = Matrix.Translation(q) @ Matrix.Rotation(math.radians(-r.uniform(10, 18)),
                                                                     4, ax) @ Matrix.Translation(-q) @ mw
    if not peak:
        kill(objs("roofpeak"))
    for i in range(3):                                 # soot streaks over what is left
        burn(polar(r.uniform(-150, 60), rr(0.3), ze + RH * r.uniform(0.15, 0.6)), r.uniform(0.4, 0.6))


def rag(o, keep, r):
    """Break plank o's foot off: it keeps the fraction keep of its length (from the top), its foot end jagged, burnt."""
    me = o.data
    ys = [v.co.y for v in me.vertices]
    y0, y1 = min(ys), max(ys)
    cut = y1 - (y1 - y0) * keep
    for v in me.vertices:
        if v.co.y < cut:
            v.co.y = cut - (cut - v.co.y) * 0.05 + r.uniform(-0.1, 0.1) * (1 if v.co.x > 0 else -1)
    if r.random() < 0.5:
        burn((0, cut, 0.04), 0.3, o)


def alive(obs):
    """obs without the ones already killed."""
    out = []
    for o in obs:
        try:
            o.name
        except ReferenceError:
            continue
        out.append(o)
    return out


def stump(obs, r, lo=0.3, hi=0.65):
    """Blocks broken down to stumps: squashed toward their foot (the top knocked off), tipped a little, burnt."""
    for o in alive(obs):
        b = lowest([o])
        c = bbox_w(o)
        f = Vector((c.x, c.y, b))
        o.matrix_world = Matrix.Translation(f) @ Matrix.Rotation(math.radians(r.uniform(-10, 10)), 4, "X") @             Matrix.Diagonal((1, 1, r.uniform(lo, hi), 1)) @ Matrix.Translation(-f) @ o.matrix_world
        burn(Vector((c.x, c.y, b + 0.4)), 0.6)


def wreck_wall(obs, gone, pushed, r, lo=-150, hi=60):
    """Knock blocks out across the face the camera sees: gone fraction knocked out (the dark gap behind), pushed of
    them shoved half out and tipped."""
    front = sorted(facing(alive(obs), lo, hi), key=bearing)
    idx = list(range(len(front)))
    r.shuffle(idx)
    ng, npush = int(round(gone * len(front))), int(round(pushed * len(front)))
    knock_out(front, idx[:ng], r=r)
    knock_out(front, idx[ng:ng + npush], push=r.uniform(0.3, 0.5), r=r)


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    ze = S.z_eave(L)
    r = random.Random(5 + L)
    gapdark()
    head = blocks("headA", "headB")
    collar = blocks("collar")
    rings = blocks("ring1big", "ring1small", "ring2big", "ring2small")
    basec = blocks("basecourse")
    if L == 1:
        # Flash: the roof sank deep into the body and slipped right, its peak tipped left; the top of the wall crumbled
        # down round it; the pipe bent out to the left
        wreck_roof([(-60, 0.35, 0.9), (10, 0.2, 0.7), (-130, 0.15, 0.6), (40, 0.55, 0.5)], gone=0.2, short=0.45, seed=1)
        kill(objs("collarcore"))
        wreck_wall(collar, 0.85, 0.15, r, lo=-180, hi=180)
        stump(facing(rings, -140, 50), r)
        wreck_wall(rings, 0.2, 0.15, r)
        wreck_wall(basec, 0.15, 0.1, r)
        hinge(objs(*ROOF), Vector((0, 0, ze)), rot=(9, -7, 0), move=(0.2, 0.15, -0.5))
        hinge(objs(*PIPE), polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(10, -26, 0), move=(0, 0, -0.3))
    elif L == 3:
        # Flash: the whole tower leans hard to the left; the roof slid down off it to the right, tipped toward us so
        # it stands up like a slab; the horn snapped; blocks pushed out of the left side
        wreck_roof([(-45, 0.3, 1.0), (60, 0.25, 0.8), (-120, 0.45, 0.7)], gone=0.2, short=0.45, wrench=0.05,
                   seed=3)
        wreck_wall(head, 0.3, 0.2, r)
        wreck_wall(head, 0.0, 0.5, r, lo=-170, hi=-100)              # the left side bulges out
        wreck_wall(collar, 0.4, 0.2, r)
        wreck_wall(rings, 0.2, 0.15, r)
        keep = objs("pebble")
        T = tilt_mat((-1.5, -1.5, GROUND), (18, -18, 0))                   # top toward bearing -135: screen left
        shift_all(T, keep=keep)
        hinge(objs(*ROOF), T @ polar(45, S.ROOF_R, ze), rot=(-27, 27, 0), move=(0.55, 0.55, -0.75))
        hinge(objs(*PIPE), T @ polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(18, -10, 30))
    elif L == 6:
        # Flash: the pipe bent far out to the left, the roof tipped a little right with ragged planks and a plank
        # sticking out, gaps all over the head and a broken top course
        wreck_roof([(-70, 0.25, 0.8), (20, 0.4, 0.7), (-140, 0.3, 0.6), (70, 0.15, 0.6)], gone=0.2, short=0.4, seed=6)
        wreck_wall(head, 0.3, 0.15, r)
        wreck_wall(collar, 0.45, 0.2, r)
        wreck_wall(rings, 0.2, 0.15, r)
        wreck_wall(basec, 0.1, 0.1, r)
        hinge(objs(*ROOF), polar(45, S.ROOF_R, ze), rot=(-3, 6, 0), move=(0.05, 0.05, -0.12))
        hinge(objs(*PIPE), polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(22, -40, 0))
    else:
        # Flash: the roof and its drum tipped, the planks ragged, the spiked ball fallen off its post onto the head's
        # top on the right, gaps all over the head
        wreck_roof([(-60, 0.2, 0.8), (30, 0.3, 0.7), (-130, 0.25, 0.6), (80, 0.15, 0.6)], gone=0.2, short=0.4, seed=10)
        wreck_wall(head, 0.3, 0.15, r)
        wreck_wall(collar, 0.45, 0.2, r)
        wreck_wall(rings, 0.2, 0.15, r)
        wreck_wall(basec, 0.1, 0.1, r)
        hinge(objs(*ROOF) + objs("drum", "drumaxle", "drumknob"), polar(45, S.ROOF_R, ze), rot=(-5, 8, 0),
              move=(0.08, 0.08, -0.12))
        kill(objs("ballpost", "ballaxle", "ballpostplate"))
        b = objs("ball")[0]
        b.matrix_world = Matrix.Translation(polar(25, 2.6, S.z_collar(L) - 0.45)) @ b.matrix_world.to_3x3().to_4x4()
        burn(polar(25, 2.2, S.z_collar(L)), 1.2)
        hinge(objs(*PIPE), polar(S.PIPE_TH, S.PIPE_R, ze - 0.2), rot=(4, -12, 0))
    # stones and roof planks on the ground round the foot, where Flash has them
    px = G["px"]
    sp = {1: [(-16, 50, 0.7), (-10, 56, 0.6), (-6, 62, 0.75), (20, 44, 0.8), (2, 58, 0.5)],
          3: [(-22, 44, 0.7), (8, 58, 0.7), (20, 46, 0.75), (-4, 60, 0.5)],
          6: [(-26, 42, 0.6), (16, 46, 0.6), (20, 54, 0.5), (-6, 62, 0.75), (24, 60, 0.4)],
          10: [(-26, 42, 0.6), (18, 46, 0.6), (22, 52, 0.5), (-10, 58, 0.5), (-2, 62, 0.8), (26, 58, 0.4)]}[L]
    stones([(px(x, y, Z=GROUND).x, px(x, y, Z=GROUND).y, s) for x, y, s in sp], seed=3)
    bd = {1: [(-12, 48, 30)], 3: [(-14, 54, 20), (-6, 58, -30), (6, 56, 60)], 6: [(-16, 50, 40), (8, 58, -20)],
          10: [(-16, 50, 20), (6, 58, 70), (14, 50, -30)]}[L]
    boards([(px(x, y, Z=GROUND).x, px(x, y, Z=GROUND).y, yaw) for x, y, yaw in bd], seed=4)


# ------------------------------------------------------------------------------------------------------------ destroyed
def slab(arc, h, at, nt, spin, r, rad=2.3, sink=0.0):
    """A big curved piece of the tower's wall (Flash's heap has a few, not many small blocks): a shell arc degrees
    round and h high with broken, jagged edges, its outer face turned to face nt, turned spin degrees about it, its
    middle over at, resting on the ground (sink: pressed in). Its edges are burnt."""
    bm = bmesh.new()
    nu, nv = 12, 7
    out, inn = [], []
    for j in range(nv + 1):
        ro, ri = [], []
        for i in range(nu + 1):
            u, v = i / nu, j / nv
            edge = i in (0, nu) or j in (0, nv)
            a = math.radians(arc * (u - 0.5))
            if i == 0:
                a += math.radians(r.uniform(0, arc * 0.12))
            elif i == nu:
                a -= math.radians(r.uniform(0, arc * 0.12))
            z = h * v
            if j == nv:
                z -= r.uniform(0, h * 0.3)
            elif j == 0:
                z += r.uniform(0, h * 0.12)
            rr = rad + r.uniform(-0.04, 0.04) * (0 if edge else 1)
            ro.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
            ri.append(bm.verts.new(((rr - 0.55) * math.cos(a), (rr - 0.55) * math.sin(a), z)))
        out.append(ro)
        inn.append(ri)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((out[j][i], out[j][i + 1], out[j + 1][i + 1], out[j + 1][i]))
            bm.faces.new((inn[j][i], inn[j + 1][i], inn[j + 1][i + 1], inn[j][i + 1]))
    ring = [(0, i) for i in range(nu)] + [(j, nu) for j in range(nv)] + [(nv, i) for i in range(nu, 0, -1)] +         [(j, 0) for j in range(nv, 0, -1)]
    for k, (j, i) in enumerate(ring):
        j2, i2 = ring[(k + 1) % len(ring)]
        bm.faces.new((out[j][i], inn[j][i], inn[j2][i2], out[j2][i2]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    o = G["mesh_ob"]("slab", bm, [M["stoneh"]], smooth=True, bevel=0.06, segs=2)
    mid = Vector((rad, 0, h / 2))
    nt = Vector(nt).normalized()
    q = Quaternion(nt, math.radians(spin)) @ Vector((1, 0, 0)).rotation_difference(nt)
    o.matrix_world = Matrix.Translation(Vector((at.x, at.y, h))) @ q.to_matrix().to_4x4() @ Matrix.Translation(-mid)
    o.location.z += GROUND - sink - lowest([o])
    for k in (-0.5, 0.5):                              # the broken ends charred
        burn(o.matrix_world @ Vector((rad * math.cos(math.radians(arc * k)), rad * math.sin(math.radians(arc * k)), h / 2)),
             0.6)
    return o


def destroyed():
    """Flash's one heap for every level (top.destroyed.png): low and wide; a few big curved slabs of wall (the biggest
    on the right, face up), the roof smashed flat and broken across the top, the horn at the back left, the spout's
    dark mouth at the front left, a charred black hollow in the middle."""
    G["build"]()
    px = G["px"]
    g = GROUND
    r = random.Random(21)
    head = blocks("headA", "headB")
    rest = blocks("ring1big", "ring1small", "collar", "basecourse", "pier")
    kill(objs("ring1band", top=False) + objs("shaft", "legcore", "headcore", "collarcore", "pebble", "slot"))
    # the black hollow in the middle, where the tower stood
    hol = cyl("hollow", 1.2, 0.12, px(4, 36, Z=g), D.inside(), verts=32, bevel=0.0)
    hol.scale = (1.3, 0.9, 1.0)
    burn(px(4, 36, Z=g + 0.3), 2.6)
    # a few big curved slabs of the wall: the biggest on the right lying back, face up; one on edge on the left; one
    # behind, under the roof
    slab(90, 1.5, px(4, 26, Z=g), (0.2, -0.5, 0.85), 10, r, sink=0.35)
    slab(120, 1.8, px(18, 40, Z=g), (0.45, -0.5, 0.75), -10, r, sink=0.2)
    slab(80, 1.4, px(-24, 38, Z=g), (-0.6, -0.6, 0.5), 80, r, sink=0.1)
    # big head blocks tumbled at the left and front, the rest of the stones mostly gone
    for k, o in enumerate(head + rest):
        big = k < len(head)
        if (big and k % 2) or (not big and k % 4):
            kill([o])
            continue
        mw, b0 = o.matrix_world.copy(), bbox_w(o)
        sx, sy = r.uniform(-30, 30), r.uniform(28, 50)
        mid = max(0.0, 1 - abs(sx) / 32) * max(0.0, 1 - abs(sy - 36) / 16)
        c = px(sx, sy, Z=g + 0.25 + 0.8 * mid * r.uniform(0.5, 1.0))
        o.parent = None
        o.matrix_world = Matrix.Translation(c) @ Matrix.Rotation(math.radians(r.uniform(0, 360)), 4, "Z") @             Matrix.Rotation(math.radians(r.uniform(-35, 35)), 4, "X") @ Matrix.Translation(-b0) @ mw
        burn(c, 0.5)
    # the roof smashed flat, broken, lying across the top
    wreck_roof([(-45, 0.3, 1.1), (60, 0.3, 0.9), (170, 0.3, 0.9), (-120, 0.45, 0.7)], gone=0.3, short=0.4,
               wrench=0.15, seed=21, peak=False)
    ze = S.z_eave(3)
    e = hinge(objs(*ROOF), Vector((0, 0, ze)), rot=(-22, 14, 20), move=px(0, 30, Z=g + 0.9) - Vector((0, 0, ze)))
    e.scale = (1.05, 1.0, 0.4)
    # the pipe broken, the horn lying at the back left
    kill(objs("pipearm", "pipeplate", "pipesocket"))
    foot = polar(S.PIPE_TH, S.PIPE_R, S.z_eave(3) - 0.2)
    hinge(objs(*PIPE), foot, rot=(0, -78, 40), move=px(-18, 24, Z=g + 0.45) - foot)
    burn(px(-14, 26, Z=g + 0.5), 1.0)
    # the spout's dark mouth at the front-left, tipped up
    sp = objs("spout") + objs("spouthole")
    a = math.radians(S.SPOUT_TH)
    d0 = Vector((math.cos(a), math.sin(a), -0.12)).normalized()           # its mouth turned up toward the camera
    q = d0.rotation_difference(Vector((0.55, -0.6, 0.6)).normalized())
    e = hinge(sp, bbox_w(sp[0]), move=px(-14, 46, Z=g + 0.75) - bbox_w(sp[0]))
    e.rotation_euler = q.to_euler()
    burn(px(-14, 46, Z=g + 0.9), 0.9)
    boards([(px(x, y, Z=g).x, px(x, y, Z=g).y, yaw) for x, y, yaw in ((22, 50, 30), (-4, 54, 70), (30, 44, 10),
                                                                       (-26, 48, 40))], seed=8)
    burn(px(2, 36, Z=g + 0.8), 2.0)


D.run(damaged, destroyed)
