"""puttydmg.py : the Putty Squisher's damaged and destroyed looks in 3D, as Flash's damaged pictures per level and its
one destroyed heap. The approved model (putty3.py + stack.py, art/buildings-3d-b6 0a42dfcab, copied here unchanged) is
built as it is, then broken where Flash's damaged picture has it broken; the destroyed look is the pot tipped over in
its spilt putty (Flash has one heap for every level).

    blender -b --factory-startup -P puttydmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 3

The camera looks from bearing -45 (toward +X -Y): screen right is bearing 45, screen left bearing -135. Flash has no
damaged or destroyed animation for this building, so the stirrer, putty and cage stand still.
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import dmgcore as D  # noqa: E402

D.load(HERE / "putty3.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
D.CHAR_FLOOR = 0.8                                 # the pot's burns as dark as Flash's
ZP, ZR = G["ZP"], G["ZR"]


# ------------------------------------------------------------------------------------------------------------ helpers
def bbox_w(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def pre(*prefixes):
    """Unparented objects whose part name starts with one of prefixes."""
    return [o for o in SC.objects if o.parent is None and base(o).startswith(prefixes)]


def mid(obs):
    return sum((bbox_w(o) for o in obs), Vector()) / len(obs)


def lay(obs, at, rot, extra=0.0):
    """Move a group to lie on the ground at (x, y): turned rot (degrees XYZ) round its middle, resting on the ground."""
    c = mid(obs)
    e = hinge(obs, c, rot=rot, move=Vector((at[0], at[1], c.z)) - c)
    bpy.context.view_layer.update()
    e.location.z += GROUND + extra - lowest(obs)
    return e


def puddle(x, y, r, stretch=(1.0, 1.0), seed=0, lumps=3):
    """Spilt putty on the ground: a flat purple pool with a few rounder lumps in it."""
    rr = random.Random(seed + 10 * L)
    G["blob"]("puddle", (x, y, GROUND + 0.01), r, squash=0.07, stretch=stretch)
    for k in range(lumps):
        a = rr.uniform(0, 2 * math.pi)
        d = rr.uniform(0.2, 0.7) * r
        G["blob"]("puddle", (x + d * math.cos(a) * stretch[0], y + d * math.sin(a) * stretch[1], GROUND + 0.01),
                  r * rr.uniform(0.3, 0.5), squash=rr.uniform(0.15, 0.3))


def char_pot(spots):
    """Flash's damaged pot is blotched black-brown: scorch spots on its belly (bearing, height above its foot, size)."""
    for th, z, rad in spots:
        a = math.radians(th)
        burn(Vector((S.POT_RMAX * math.cos(a), S.POT_RMAX * math.sin(a), ZP + z)), rad * 1.6)


def knock_stump(k, at, rot):
    """Stump k knocked out from under the frame (with its spring at level 10), lying on the ground; its post's foot
    burnt."""
    obs = objs(f"stump{k}", f"stumptop{k}") + objs(f"spring{k}")
    c = mid(obs)
    burn(Vector((c.x, c.y, S.LIFT)), 0.8)
    lay(obs, at, rot)


def tube_off(at, rot, short=0.0):
    """The test tube broken off its arm, lying on the ground; short: its glass snapped off at the foot by this much
    of its length (the holder stays up)."""
    obs = pre("tubeglass", "tubetop", "tubecap") + ([] if short else pre("holder"))
    if short:
        g = objs("tubeglass")[0]
        zs = [v.co.z for v in g.data.vertices]
        cut = min(zs) + (max(zs) - min(zs)) * short
        for v in g.data.vertices:
            if v.co.z < cut:
                v.co.z = cut - (cut - v.co.z) * 0.03 + random.uniform(-0.12, 0.12)
    lay(obs, at, rot)


CHAR = [(-60, 1.2, 1.1), (-10, 2.3, 1.0), (-120, 0.7, 1.0), (20, 1.0, 0.9), (-90, 2.4, 0.8), (-30, 0.4, 0.9),
        (-150, 2.0, 0.8)]


def frame_drips(n, seed=0):
    """Putty running off the frame's front rails and posts in long drips (Flash's damaged frame drips all over)."""
    rr = random.Random(seed + L)
    rails = [o for o in pre("rail") if bearing_of(mid([o])) < 80 and bearing_of(mid([o])) > -170]
    for k in range(n):
        c = mid([rails[k % len(rails)]])
        t = rr.uniform(-0.8, 0.8)
        d = Vector((-c.y, c.x, 0)).normalized() * t
        ln = rr.uniform(0.3, 0.6)
        G["blob"]("frdrip", (c.x * 1.06 + d.x, c.y * 1.06 + d.y, c.z - ln * 0.7), 0.16, squash=ln / 0.16)
        G["blob"]("frdrop", (c.x * 1.06 + d.x, c.y * 1.06 + d.y, c.z - ln * 1.4), 0.17, squash=1.1)


def bearing_of(p):
    return math.degrees(math.atan2(p.y, p.x))


def sag(k):
    """Stump k is knocked out: everything it held tips toward its corner, putty pouring down there to the ground."""
    c = mid(objs(f"stump{k}"))
    o = Vector((-c.x, -c.y, 0)).normalized()
    pivot = Vector((-c.x, -c.y, GROUND))
    ax = Vector((o.y, -o.x, 0))
    T = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(7), 4, ax) @ Matrix.Translation(-pivot)
    shift_all(T, keep=objs(f"stump{k}", f"stumptop{k}", f"spring{k}"))
    G["blob"]("pour", (c.x * 0.95, c.y * 0.95, S.LIFT * 0.55), 0.42, squash=2.6)
    G["blob"]("pour", (c.x * 0.97, c.y * 0.97, S.LIFT * 0.95), 0.5, squash=1.2)


def charmat():
    """Charred metal seen through a torn hole: dark brown, matt (not pure black)."""
    m = bpy.data.materials.get("charin")
    if m is None:
        m = bpy.data.materials.new("charin")
        m.use_nodes = True
        bs = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Base Color"].default_value = (0.075, 0.038, 0.018, 1)
        bs.inputs["Roughness"].default_value = 1.0
    return m


def round_holes(o, pts, n=8):
    """Smooth the torn edge of each hole along itself (the faces deleted on a grid leave a stepped edge)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw = o.matrix_world
    edge = [v for v in bm.verts if v.is_boundary and
            any((mw @ v.co - Vector(q[:3])).length < q[3] * 1.6 for q in pts)]
    for _ in range(n):
        new = {}
        for v in edge:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
        for v, c in new.items():
            v.co = c
    bm.to_mesh(o.data)
    bm.free()


def pot_holes(spots):
    """Holes torn in the pot's belly (bearing, height above its foot, radius), as Flash's damaged pot has at every
    level: the pot and its bands cut finely (no stepped edge), a charred wall inside showing, the edges burnt.
    Before any sag or hinge (holes are cut where the pot stands)."""
    rp = G["rad_at_pot"]
    H = S.POT_H
    G["lathe"]("potdark", [(rp(0.15) * 0.9, 0.15), (rp(1.4) * 0.93, 1.4), (rp(H - 0.5) * 0.93, H - 0.5),
                           (rp(H - 0.8) * 0.5, H - 0.8)], (0, 0, ZP), charmat(), verts=48)
    pts = []
    for th, z, rad in spots:
        x, y, zz = S.polar(th, rp(z), ZP + z)
        pts.append((x, y, zz, rad))
        burn(Vector((x, y, zz)), rad * 2.4)
        burn(Vector((x, y, zz - rad * 1.0)), rad * 1.9)
    for o in pre("potrivet"):
        p = mid([o])
        if any((p - Vector(q[:3])).length < q[3] * 1.1 for q in pts):
            kill([o])
    for o in pre("pot", "potband", "potrim"):
        if base(o).startswith(("potrivet", "potdark", "potin", "potfoot")):
            continue
        o = bake(o)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=4, use_grid_fill=True)
        bm.to_mesh(o.data)
        bm.free()
        round_holes(sheet_holes(o, pts), pts)


def sheet(th, z0, z1, w, out=0.07, lumps=2, seed=0):
    """A sheet of melted putty hugging the pot's side at bearing th, from height z1 (world) down to z0, w wide,
    with a fat drop at its foot and lumps on it (Flash's damaged frame has melted over the pot in such sheets)."""
    rr = random.Random(seed + 31 * L + int(th))
    rp = G["rad_at_pot"]
    a = math.radians(th)
    zm, h = (z0 + z1) / 2, (z1 - z0) / 2
    r = rp(min(S.POT_H, max(0.0, zm - ZP))) + out
    ob = G["blob"]("sheet", (r * math.cos(a), r * math.sin(a), zm), 1.0, squash=h, stretch=(w, 0.2))
    ob.rotation_euler = (0, 0, a - math.pi / 2)
    rb = rp(min(S.POT_H, max(0.0, z0 + 0.2 - ZP))) + out + 0.05
    G["blob"]("sheetdrop", (rb * math.cos(a), rb * math.sin(a), z0 + 0.22), w * 0.55, squash=1.25)
    for k in range(lumps):
        zz = rr.uniform(z0 + h * 0.4, z1 - h * 0.3)
        da = math.radians(rr.uniform(-1, 1) * w * 18)
        rl = rp(min(S.POT_H, max(0.0, zz - ZP))) + out + 0.05
        G["blob"]("sheetlump", (rl * math.cos(a + da), rl * math.sin(a + da), zz), w * rr.uniform(0.4, 0.6),
                  squash=rr.uniform(1.2, 1.8))


def melt(sheets, rim=()):
    """Level 3 up: the frame melted, as Flash's damaged picture: the post tops slumped into fat sagging lumps, their
    knobs gone, sheets of putty running down the pot from them (sheets: (bearing, top above the rim, bottom height
    above the ground, width)) and putty slopped over the rim at the bearings rim."""
    zr, zt = S.RAIL_Z, S.post_top(L)
    for i in range(4):
        kill(objs(f"postknob{i}"))
        for o in objs(f"post{i}"):
            o.scale.z = 0.82
        c = Vector(S.corner(i))
        top = zr + (zt - zr) * 0.82
        d = c.normalized()
        ob = G["blob"]("melttop", (c.x - d.x * 0.35, c.y - d.y * 0.35, top - 0.2), 0.62, squash=0.55,
                       stretch=(1.0, 1.6))
        ob.rotation_euler = (math.radians(-18), 0, math.atan2(d.y, d.x) - math.pi / 2)
        G["blob"]("meltrun", (c.x + d.x * 0.1, c.y + d.y * 0.1, top - 0.85), 0.42, squash=2.0)
        G["blob"]("meltrun", (c.x - d.x * 0.75, c.y - d.y * 0.75, top - 0.9), 0.3, squash=2.4)
        G["blob"]("meltfoot", (c.x + d.x * 0.1, c.y + d.y * 0.1, zr + 0.25), 0.55, squash=1.0)
    for k, (th, up, down, w) in enumerate(sheets):
        sheet(th, down, ZR + up, w, seed=k)
    for th in rim:
        p = S.polar(th, S.POT_R - 0.05, ZR + 0.02)
        ob = G["blob"]("rimgoo", p, 0.5, squash=0.45, stretch=(0.9, 1.3))
        ob.rotation_euler = (0, 0, math.radians(th) - math.pi / 2)
        sheet(th, ZR - 0.9, ZR + 0.05, 0.42, out=0.1, lumps=0, seed=7)


def char_parts(strength=1.0):
    """Flash's damaged arches and block are charred dark in blotches: scorch spots along each arch and on the block
    (following them if they are moved later)."""
    for i, x in enumerate(S.ARCH_X):
        for o in objs(f"arch{i}"):
            pts = G["arch_pts"](x)
            for j in (2, 6, 10, 14, 18, 22, 26):
                burn(Vector(pts[j]) - o.location, 0.8 * strength, o)
    for o in objs("block"):
        burn(Vector((0.3, -0.3, 0.4)), 1.0 * strength, o)
        burn(Vector((-0.6, 0.2, 0.7)), 0.8 * strength, o)


def dark_back(o):
    """Show o's inner (back-facing) side charred dark brown, as the inside of Flash's crushed pot."""
    for slot in o.material_slots:
        m = slot.material.copy()
        slot.material = m
        t = m.node_tree
        bs = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
        inp = bs.inputs["Base Color"]
        geo = t.nodes.new("ShaderNodeNewGeometry")
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        t.links.new(geo.outputs["Backfacing"], mix.inputs["Factor"])
        mix.inputs["B"].default_value = (0.04, 0.022, 0.012, 1)
        if inp.is_linked:
            t.links.new(inp.links[0].from_socket, mix.inputs["A"])
        else:
            mix.inputs["A"].default_value = inp.default_value
        t.links.new(mix.outputs["Result"], inp)


def to_world(o, T):
    """Bake o into a plain mesh in world space, moved by matrix T."""
    o = bake(o)
    o.data.transform(T @ o.matrix_world)
    o.matrix_world = Matrix.Identity(4)
    return o


def cut(o, co, no, seed, rag=0.25, cuts=2):
    """Cut away the part of mesh o (world space) on the -no side of the plane through co; its torn edge ragged
    (pushed out along no by up to rag)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-4,
                                 plane_co=Vector(co), plane_no=Vector(no), clear_inner=True)
    n = Vector(no).normalized()
    for v in res["geom_cut"]:
        if isinstance(v, bmesh.types.BMVert):
            q = v.co
            v.co = q + n * rag * (0.5 + 0.5 * math.sin(3.1 * q.x + 2.3 * q.y + 1.7 * q.z + seed)) * \
                (0.6 + 0.4 * math.sin(7.7 * q.x - 5.3 * q.y + seed))
    bm.to_mesh(o.data)
    bm.free()


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    px = G["px"]
    r = random.Random(3 + L)
    for o in pre("potrivet"):
        if r.random() < 0.35:
            kill([o])
    if L == 1:
        # Flash: the pot blotched and burnt, the block tipped into it, the stirrer bent; the tube's holder fallen
        # against the pot on the right and the tube broken on the ground in front of it; the hand wheel off on the
        # ground at the left; putty spilt in front
        pot_holes([(-125, 2.85, 0.62), (-142, 2.45, 0.42), (-60, 1.0, 0.42), (-25, 1.9, 0.36), (-95, 0.55, 0.4),
                   (-5, 0.8, 0.34)])
        char_pot(CHAR)
        char_parts(1.3)
        hinge(objs("block", "blocktop") + pre("blockhole"), Vector((0.8, -1.6, ZR)), rot=(-15, -28, 0),
              move=(-0.55, 0.35, -0.12))
        burn(Vector((-0.5, -1.0, ZR + 0.2)), 1.3)
        hinge(objs("stir"), Vector((0, 0, ZR)), rot=(22, -18, 0))
        kill(objs("tubefoot"))
        arm = objs("tubearm", "holder", "holderhorn")
        hinge(arm, Vector((S.POT_R * 0.7, S.POT_R * 0.7, ZR)), rot=(18, -12, 0), move=(0, 0, -0.2))
        tube_off((2.4, -2.0), (88, 0, 75), short=0.55)
        lay(pre("wheelrim", "wheelspoke", "wheelhub", "wheelknob") + objs("wheel"), (-2.6, -1.6), (80, 0, 30))
        kill(objs("wheelaxle", "wheelboss"))
        puddle(*px(6, 52, Z=GROUND).xy, 0.9, stretch=(1.4, 0.8), seed=1)
    elif L == 3:
        # Flash: the left stump knocked out and lying at the front left, the frame sagging over it, the right arch
        # broken; the tube fallen at the front right; putty pouring down the frame into pools
        pot_holes([(-45, 1.5, 0.5), (-45, 0.8, 0.45), (-95, 0.5, 0.32), (5, 1.7, 0.28), (-70, 2.25, 0.25)])
        char_pot(CHAR)
        char_parts(1.2)
        melt([(-150, 0.0, ZP + 0.1, 0.55), (-122, -0.1, ZP + 0.5, 0.45), (-62, 0.0, ZP, 0.5),
              (25, 0.0, ZP + 0.3, 0.5), (52, -0.1, ZP + 0.1, 0.45)], rim=(-160, 62))
        sag(3)
        frame_drips(16, 1)
        knock_stump(3, (-1.4, -3.3), (0, 90, 30))
        hinge(objs("arch1") + pre("archknuckle1", "archseat1"), Vector((0.6, 1.66, ZR)), rot=(45, 0, 10))
        kill(objs("tubefoot"))
        tube_off((2.6, -1.8), (85, 0, 60))
        kill(objs("tubearm"))
        puddle(*px(-14, 52, Z=GROUND).xy, 1.0, stretch=(1.3, 0.9), seed=2)
        puddle(*px(22, 56, Z=GROUND).xy, 0.5, seed=3)
    elif L == 6:
        # Flash: the front stump knocked out and lying in front, the hub tipped, the flask bent off to the left, the
        # tube sticking out at a slant to the right; putty pooled under the frame
        pot_holes([(-70, 1.5, 0.42), (-30, 1.0, 0.42), (-5, 1.9, 0.32), (-110, 0.9, 0.38), (-50, 2.3, 0.28),
                   (-85, 0.6, 0.3)])
        char_pot(CHAR)
        char_parts(1.3)
        burn(Vector((0, 0, S.z_hub(L))), 1.1)
        melt([(-150, 0.0, ZP + 0.1, 0.55), (-120, -0.1, ZP + 0.4, 0.45), (-90, -0.3, ZP + 0.9, 0.35),
              (-58, 0.0, ZP, 0.5), (-15, -0.2, ZP + 0.7, 0.35), (25, 0.0, ZP + 0.2, 0.5), (52, -0.1, ZP, 0.45)],
             rim=(-150, -100, 30))
        sag(0)
        frame_drips(16, 2)
        knock_stump(0, (0.5, -3.6), (90, 0, 70))
        hinge(objs("hub", "hubband0", "hubband1", "hubring", "hubhole", "flaskcollar", "flask", "flaskneck",
                   "valveshaft") + objs("valve"), Vector((0, 0, ZR + S.ARCH_UP)), rot=(-10, -8, 0))
        hinge(objs("flaskcollar", "flask", "flaskneck"), Vector((0, 0, ZR + S.ARCH_UP + 1.2)), rot=(30, -25, 0))
        t = pre("tubeglass", "tubetop", "tubecap", "holder")
        hinge(t, mid(t), rot=(-30, 35, 20), move=(0.3, -0.2, -0.6))
        puddle(*px(4, 60, Z=GROUND).xy, 1.1, stretch=(1.3, 0.9), seed=4)
        puddle(*px(24, 66, Z=GROUND).xy, 0.6, seed=5)
    else:
        # Flash: the cage wheel knocked crooked and bent, the front stump and its spring knocked out, the valve
        # wheel lying at the front left, the tube hanging at the right; putty pooled in front
        pot_holes([(-80, 1.3, 0.4), (-80, 0.6, 0.35), (-80, 2.0, 0.3), (-15, 1.3, 0.4), (-15, 0.6, 0.35),
                   (-15, 2.0, 0.3)])
        char_pot(CHAR)
        char_parts(1.3)
        burn(Vector((0, 0, S.z_hub(L))), 1.1)
        melt([(-150, 0.0, ZP + 0.1, 0.55), (-120, -0.1, ZP + 0.4, 0.45), (-48, 0.1, ZP + 0.3, 0.6),
              (25, 0.0, ZP + 0.2, 0.5), (52, -0.1, ZP, 0.45)], rim=(-130, -80, -48, -15, 20))
        sag(0)
        frame_drips(16, 3)
        knock_stump(0, (0.6, -3.8), (90, 0, 60))
        cg = objs("cage", "cageaxle", "cageaxlecap")
        hinge(cg, Vector((0, 1.0, ZR + S.ARCH_UP + 1.0)), rot=(-28, 26, 14))
        for n in ("cagerung1", "cageputty1", "cagerung3", "cageputty3", "cagerung5", "cageputty5", "cagestring2"):
            kill(objs(n, top=False))
        burn(Vector((0, 2.5, ZR + S.ARCH_UP + 2.0)), 1.0)
        lay(objs("valve"), (-2.8, -2.6), (85, 0, 40))
        kill(objs("valveshaft"))
        t = pre("tubeglass", "tubetop", "tubecap", "holder")
        hinge(t, mid(t), rot=(-20, 30, 10), move=(0.2, -0.2, -0.5))
        puddle(*px(6, 62, Z=GROUND).xy, 1.1, stretch=(1.3, 0.9), seed=6)
        puddle(*px(-16, 60, Z=GROUND).xy, 0.5, seed=7)
    # the hits charred: under the rim and round the frame's knocked corner
    burn(Vector((1.2, -1.2, ZR - 0.3)), 0.8)


# ------------------------------------------------------------------------------------------------------------ destroyed
def destroyed():
    """Flash's one heap for every level: the pot crushed into a half shell lying on its side, its mouth to the screen
    left, its torn lower half gone so it arches over the ground, dark inside, the stirrer lying in its mouth; the
    gold hand wheel on the ground at its right; all in a wide pool of spilt putty; burnt black."""
    G["build"]()
    keep = ("pot", "potrim", "potin", "potfoot", "potband", "potrivet", "putty", "puttysurf", "stir")
    kill([o for o in SC.objects if o.parent is None and o.type in ("MESH", "CURVE", "EMPTY") and
          not base(o).startswith(keep) and base(o) not in ("wheel", "ground")])
    kill(pre("putty", "potin"))                         # its putty all spilt out
    potp = pre("pot", "potrim", "potfoot", "potband", "potrivet")
    # lying on its side, its mouth to bearing MOUTH; the axis HZ above the ground; squashed SQ high
    MOUTH, HZ, SQ, AT = -104.0, 1.0, 1.0, Vector((0.5, 0.6, 0))
    piv = Vector((0, 0, ZP + S.POT_H / 2))
    T = Matrix.Translation(AT + Vector((0, 0, HZ))) @ Matrix.Rotation(math.radians(MOUTH - 180), 4, "Z") @ \
        Matrix.Rotation(math.radians(-90), 4, "Y") @ Matrix.Translation(-piv)
    ax = Vector((math.cos(math.radians(MOUTH)), math.sin(math.radians(MOUTH)), 0))   # foot -> mouth
    shell = []
    for o in potp:
        o = to_world(o, T)
        if base(o).startswith("potrivet"):
            if mid([o]).z < HZ + 0.25:
                kill([o])
                continue
        else:
            cut(o, (0, 0, HZ - 0.65), (0, 0, 1), seed=len(shell), rag=0.45)       # its lower half torn away
            cut(o, AT - ax * (S.POT_H / 2 - 0.35), ax, seed=3, rag=0.5, cuts=0)    # its foot end torn off
        for v in o.data.vertices:                        # crushed down and dented
            v.co.z = GROUND + (v.co.z - GROUND) * SQ
            v.co += noise.noise_vector(v.co * 1.3) * 0.16
        shell.append(o)
        if base(o).startswith(("pot-", "potrim", "potband")):
            dark_back(o)
    bpy.context.view_layer.update()
    lo = lowest(shell)
    for o in pre("pot"):
        o.location.z += GROUND - 0.05 - lo
    # the stirrer lying in its mouth
    st = objs("stir")
    if st:
        m = AT + ax * (S.POT_H / 2 - 0.2)
        lay(st, (m.x, m.y), (78, 0, MOUTH + 60))
    c = AT + Vector((0, 0, 1.0))
    for d, rad in (((0.0, 0.0, 0.6), 1.9), ((1.0, 0.0, 0.5), 1.7), ((-0.8, 0.4, 0.7), 1.7), ((0.2, -0.9, 0.2), 1.6),
                   ((0.6, 0.9, -0.3), 1.6)):
        burn(c + Vector(d), rad)
    # the spilt putty spread wide round and in front of it
    for k, (p, rad, st_) in enumerate((((0.0, -0.4), 2.0, (1.5, 1.1)), ((-1.6, -0.9), 1.3, (1.2, 0.9)),
                                       ((1.4, -0.8), 1.3, (1.2, 0.9)))):
        puddle(AT.x + p[0], AT.y + p[1], rad, stretch=st_, seed=10 + k, lumps=4)
    # the hand wheel on the ground at its right
    w = objs("wheel")
    if w:
        lay(w, (2.4, -0.9), (88, 0, 20))


D.run(damaged, destroyed)
