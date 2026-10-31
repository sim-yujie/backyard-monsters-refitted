"""twigdmg.py : the Twig Snapper's damaged and destroyed looks in 3D, as Flash's top.<n>.damaged.png and
top.destroyed.png. The approved model (twig2.py, art/buildings-3d-b6 72791f1eb, copied here unchanged) is built as it
is, then broken: the same parts, at the same camera and light, knocked off, tilted, dropped and holed where Flash's
damaged picture has them so; the destroyed look is those parts in one heap (Flash has one heap for every level).

    blender -b --factory-startup -P twigdmg.py -- <level> <prev|still> <damaged|destroyed>   (see ../dmgcore.py)
    destroyed is the same at every level: give level 3

Flash has no damaged or destroyed animation for this building (buildingArtData.ts: no animdamaged), so each look is
one still: the saw and gears do not turn once it is damaged.
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import dmgcore as D  # noqa: E402

D.load(HERE / "twig2.py", walls=("rwall", "lwall", "bwall2", "bwall", "cabL"))
from dmgcore import *  # noqa: E402,F401,F403
HX, HY, Z0, Z1 = G["HX"], G["HY"], G["Z0"], G["Z1"]


# ------------------------------------------------------------------------------------------------------------ helpers
def roof_holes(patches, N=64, R=12, near=0.2, cuts=4):
    """Tear holes in the pagoda roof. Each patch (s, t, half-width in s, half-height in t) is a spot on pagoda_roof's
    grid (N faces round, R rows from the apex, face j*N + i at s = 4i/N round the eave, t = j/R down the slope): its
    middle and size are read off that grid, then the roof is cut finer (cuts) and the faces inside a ragged round edge
    round that middle go. The shingle strips over a hole go with it; the sticks (the roof's frame) stay."""
    ro = objs("roof")[0]
    mw = ro.matrix_world.copy()
    inner = ro.copy()                                  # the dark inside under the holes: the roof again, whole,
    inner.data = ro.data.copy()                        # a little smaller and lower, in the hole's black
    inner.data.materials[0] = inside()
    G["COLL"].objects.link(inner)
    inner.matrix_world = Matrix.Translation((0, 0, -0.14)) @ mw @ Matrix.Diagonal((0.95, 0.95, 1, 1))
    bm = bmesh.new()
    bm.from_mesh(ro.data)
    bm.faces.ensure_lookup_table()
    spots = []
    for k, (ps, pt, ws, wt) in enumerate(patches):
        cs = []
        for j in range(R):
            for i in range(N):
                s, t = 4 * (i + 0.5) / N, (j + 0.5) / R
                if ((s - ps) / ws) ** 2 + ((t - pt) / wt) ** 2 < 1.0:
                    cs.append(mw @ bm.faces[j * N + i].calc_center_median())
        if cs:
            c = sum(cs, Vector()) / len(cs)
            spots.append((c, max((p - c).length for p in cs) * 0.95 + 0.08, k))
            burn(c, spots[-1][1] + 0.5)                # the hole's edge is burnt
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    dead, gone = [], []
    for f in bm.faces:
        p = mw @ f.calc_center_median()
        for c, rad, k in spots:
            d = p - c
            a = math.atan2(d.z, d.x - d.y)
            if d.length < rad * (0.82 + 0.16 * math.sin(4 * a + k) + 0.09 * math.sin(9 * a + 2 * k)):
                dead.append(f)
                gone.append(p)
                break
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(ro.data)
    bm.free()
    for o in objs("shingle"):
        o = bake(o)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        m2 = o.matrix_world
        cut = [f for f in bm.faces if any((m2 @ f.calc_center_median() - g).length < near * 0.5 for g in gone)]
        bmesh.ops.delete(bm, geom=cut, context="FACES")
        bm.to_mesh(o.data)
        bm.free()
    return gone


# ------------------------------------------------------------------------------------------------------------ damaged
def eave_point(y):
    """The roof's outermost point (+X, the right eave) near world y."""
    bpy.context.view_layer.update()
    o = objs("roof")[0] if objs("roof") else None
    if o is None:
        o = next(x for x in SC.objects if x.name.startswith("roof") and x.type == "MESH")
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    pts = [o.matrix_world @ v.co for v in ev.to_mesh().vertices]
    pts = [p for p in pts if abs(p.y - y) < 0.2]
    return max(pts, key=lambda p: p.x)


def bbox_w(o):
    """The middle of o's bounding box, in the world."""
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return sum((o.matrix_world @ Vector(c) for c in ev.bound_box), Vector()) / 8


def under(planks, roof, gap=0.12):
    """Snap each plank whose top would stand up through the roof boards to just under them."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in roof:
        ev = o.evaluated_get(dg)
        pts += [o.matrix_world @ v.co for v in ev.to_mesh().vertices]
    for o in planks:
        ws = [o.matrix_world @ v.co for v in o.data.vertices]
        lo, hi = min(p.z for p in ws), max(p.z for p in ws)
        c = sum(ws, Vector()) / len(ws)
        near = [p.z for p in pts if (p.xy - c.xy).length < 0.4]
        if near and hi > min(near) - gap:
            snap(o, max(0.05, (min(near) - gap - lo) / (hi - lo)))


def pole(foot, top, r=0.13):
    return tube("pole", [Vector(foot), Vector(top)], r, M["post"]("Z"), r_end=r * 0.8)


def damaged():
    hx, hy = HX, HY
    T = Matrix()                                       # how the body moved: W(model point) is where it went
    # the legs give: the machine sinks onto stumps and leans a little to the front-left
    if L == 1:                                         # the hut slumps: down on its front-left corner (that foot
        z0 = Z0 - G["L1_DROP"]                         # crushed), leaning forward and to the left onto the press
        kill([o for o in objs("foot") if o.location.x < 0 and o.location.y < 0])
        T = Matrix.Translation((0, 0, -0.43)) @ tilt_mat((-hx, -hy, z0), (3, -6, 0))
        shift_all(T)
    elif L < 10:
        legs = objs("leg")
        drop = 0.55
        shift_all(tilt_mat((0, 0, GROUND), (-3, 3, 0)) @ Matrix.Translation((0, 0, -drop)), keep=legs)
        for o in legs:                                 # snapped short: stumps under the corners
            o.scale.z = 0.5                            # its top stays up inside the corner post
        bpy.context.view_layer.update()
        for o in legs:                                 # and a broken end on it, should the top show
            top = o.matrix_world @ Vector((0, 0, max(v.co.z for v in o.data.vertices)))
            cap = cyl("legcap", 0.4, 0.1, top - Vector((0, 0, 0.09)), M["post"]("Z"), verts=20, bevel=0.04)
            cap.rotation_euler = o.rotation_euler
            burn(top, 0.6)
    # the ceiling seen through the holes is the dark inside
    for o in objs("ceiling") if L > 1 else []:
        o.data.materials[0] = inside()
    # roof: torn holes between the sticks over the body (the sticks, its frame, stay), on the slopes the camera sees:
    # s in [0, 1) the right slope, [3, 4) the front one
    if L in (3, 6):                                    # big holes: most of each bay between two sticks gone
        roof_holes([(3.25, 0.5, 0.26, 0.27), (3.75, 0.48, 0.25, 0.26), (0.25, 0.52, 0.17, 0.27),
                    (0.75, 0.5, 0.16, 0.26)] +
                   ([(3.5, 0.78, 0.07, 0.09), (0.5, 0.78, 0.05, 0.09)] if L == 6 else []))
    if L == 10:                                        # the front bark sheet torn away, a ragged strip left along
        fine_holes(objs("roofF")[0], [(0.5, 0.38, 0.62, 0.52)])         # the gate; its sticks and rope gone with it
        kill(objs("roofstick"))
        kill(sorted(objs("rope"), key=lambda o: bbox_w(o).y)[:1])
        fine_holes(objs("roofB")[0], [(0.3, 0.35, 0.2, 0.25)], axes=("x", "z"), seed=3)     # the back roll holed
        for o in objs("ceiling"):                      # the open top: the inside dark, its floor well down, the
            o.data.materials[0] = inside()             # walls' broken tops round it
            o.location.z -= 1.4
        r = random.Random(5)                           # charred boards fallen in, poking up out of it
        for k in range(5):
            c = Vector((r.uniform(-0.6, 0.6), r.uniform(-1.2, 1.0), Z1 - 1.0))
            box("fallenboard", (r.uniform(1.0, 1.6), 0.28, 0.1), c, M["dwood"]("X"),
                rot=(r.uniform(-50, 50), r.uniform(-40, 40), r.uniform(0, 180)), bevel=0.03, origin="center")
        burn((0, -0.2, Z1 - 0.6), 2.0)
        for pt in ((0.5, -1.4, Z1 + 0.6), (-0.3, -0.9, Z1 + 0.9), (0.2, 0.4, Z1 + 1.6)):
            burn(pt, 1.3)
    if L == 1:                                         # the lean-to falls in, into the cabinet
        def W(p):
            return T @ Vector(p)
        z0 = Z0 - G["L1_DROP"]
        kill(objs("roofrake", "roofridge", "ceiling"))  # the ceiling gives way: the roof caves in between the walls
        kill([o for o in objs("beamR", "beamL") if o.matrix_world.translation.z > 3.0])
        for o in objs("gable"):                        # the gable boards over the cabinet snapped short
            snap(o, rng.uniform(0.15, 0.4))
        for o in objs("gableback"):
            snap(o, 0.3)
        rp = sorted(objs("roofplank"), key=lambda o: o.location.y)
        hinge(rp, W((-1.6, -0.25, Z1 + 0.77 - 0.5)), rot=(-4, 12, 0), move=(0, 0, -0.2))
        r = random.Random(3)                           # then each board broken: some gone, the rest snapped short
        for i, o in enumerate(rp):                     # and hanging down into the cabinet from the high edge
            if i in (1, 4, 5, 8):
                kill([o])
                continue
            me = o.data
            xs = [v.co.x for v in me.vertices]
            x0, x1 = min(xs), max(xs)
            cut = x0 + (x1 - x0) * r.uniform(0.45, 0.75)
            for v in me.vertices:
                if v.co.x > cut:
                    v.co.x = cut + r.uniform(-0.15, 0.15)
            bpy.context.view_layer.update()
            hi = o.matrix_world @ Vector((x0, 0, 0))
            hinge([o], hi, rot=(r.uniform(-6, 6), r.uniform(14, 34), 0))
            burn((cut, 0, 0), 0.6, o)
        burn(W((0.3, 0.8, Z1 - 0.8)), 1.6)
        lp = objs("looseplank")
        kill(lp[1:])
        if lp:                                         # one loose plank slid down across the front, to the tray
            a, b = W((-0.6, -2.6, 1.07)), W((0.6, -2.02, 3.87))       # up against the press's crossbar
            o = lp[0]
            o.rotation_euler = (b - a).to_track_quat("X", "Z").to_euler()
            o.location = (a + b) / 2
            o.scale = ((b - a).length / max(o.dimensions.x, 0.1), 0.45, 0.6)
        kill(objs("cap"))                              # the dome blown off: the open horn under it shows
        top = W((G["PIPE_FOOT"].x, G["PIPE_FOOT"].y, 6.6 - 0.5))
        prof = [(0.26, 0.0), (0.28, 0.3), (0.38, 0.6), (0.48, 0.85), (0.55, 0.95), (0.52, 0.99), (0.4, 0.95)]
        hn = lathe("horn", prof, top - Vector((0, 0, 0.1)), M["horn"], verts=36)
        hn.rotation_euler = Vector((-0.25, -0.2, 1)).to_track_quat("Z", "Y").to_euler()
        hn.modifiers.new("solid", "SOLIDIFY").thickness = 0.03
        # the right front frame post knocked down, lying on the ground to the right
        posts = sorted(objs("framepost"), key=lambda o: o.location.x)
        if posts:
            kill(posts[-1:])
        a, b = Vector((HX + 0.4, -0.2, GROUND + 0.22)), Vector((HX + 2.6, 1.9, GROUND + 0.2))
        lg = box("fallenpost", ((b - a).length, 0.44, 0.44), (a + b) / 2, M["pwood"]("X"), bevel=0.1, origin="center",
                 jitter=0.02)
        lg.rotation_euler = (math.radians(4), 0, math.atan2(b.y - a.y, b.x - a.x))
    if L == 6:                                         # a strip of the chute's sheet metal torn off, caught on the strap
        sh = box("sheet", (0.08, 0.9, 0.5), (HX + 0.32, -0.35, 3.25), M["chute"], rot=(28, -8, 12), bevel=0.02,
                 origin="center", bow=0.08)
    if L in (3, 6):                                    # a board torn off, lying across the mouth
        a, b = Vector((-0.95, -HY - 0.45, GROUND + 0.6)), Vector((0.55, -HY - 0.4, 2.4))
        bd = box("brokenboard", ((b - a).length, 0.3, 0.12), (a + b) / 2, M["wood"]("X"), bevel=0.03, origin="center",
                 jitter=0.02)
        bd.rotation_euler = (b - a).to_track_quat("X", "Z").to_euler()
    # the right wall: planks snapped off at the top (and at level 10 two knocked out)
    rw = sorted(objs("rwall"), key=lambda o: o.name)
    for i, o in enumerate(rw):
        if L == 10 and i in (2, 3):
            kill([o])
        elif L == 1:                                   # level 1: a low broken stump, lowest at the front
            snap(o, (0.36, 0.48, 0.62, 0.68, 0.6, 0.55)[i])
        elif L == 6 and i == 2:                        # one plank knocked out: the dark inside shows
            kill([o])
        elif i in {3: (1, 4), 6: (1, 4), 10: (1, 4, 5)}[L]:
            snap(o, 0.72 if i % 2 else 0.8)
    # the front wall broken at the top too, worst at level 10 under the gone roof; soot up the walls from the breaks
    keep = {3: {3: 0.83}, 6: {0: 0.86, 3: 0.8}, 10: {1: 0.7, 2: 0.9, 3: 0.62}}.get(L, {})
    for i, o in enumerate(sorted(objs("lwall"), key=lambda o: o.name)):
        if i in keep:
            snap(o, keep[i])
    if L > 1:
        for p in ((hx + 0.1, -0.6, 2.4), (hx + 0.1, 0.9, 3.4), (0.4, -hy - 0.1, 2.0)):
            burn(T @ Vector(p) + Vector((0, 0, -0.55 if L < 10 else 0)), 1.3)
    if L == 1:                                         # no wall plank stands up through the caved-in roof
        under(objs("rwall", "bwall", "bwall2", "cabL", "gable", "gableback"), objs("roofplank", top=False))
    # the horn: the pipe bent back at its foot (levels 1 and 3, as Flash)
    if L in (1, 3):
        pipe = objs("pipe", "pipeband", "horn", "hornneck", "cap", "pipestay", "pipeplate")
        foot = T @ (G["PIPE_FOOT"] - Vector((0, 0, 0.5))) if L == 1 else G["PIPE_FOOT"] + Vector((0, 0, -0.55))
        hinge(pipe, foot, rot=(14, -16, 0) if L == 3 else (8, -12, 0))
    # roller and tray
    roller = objs("roller", "rollercap", "rollerarm")
    R0 = G["ROLLER"]
    tray = objs("tray") + objs("traymount", "traymountplate", "traymountbolt")
    if L == 1:
        hinge(roller, T @ Vector((R0.x - 1.0, R0.y, R0.z - 0.5)), rot=(0, 14, 0), move=(0, -0.1, -0.35))
        kill(objs("traymount", "traymountplate", "traymountbolt"))
        h = hinge(objs("tray"), T @ Vector((0, -hy, Z0 - 0.5)), rot=(-28, 6, 0), move=(0, -0.1, 0))
        sit([h], 0.0)
    elif L == 3:                                       # the roller hangs from its left arm, the tray is gone
        hinge(roller, (R0.x - 1.05, R0.y, R0.z - 0.55), rot=(0, 72, 0))
        kill(tray)
    elif L == 6:
        hinge(roller, (R0.x, R0.y + 0.4, R0.z - 0.55), rot=(6, 12, 0), move=(0, 0, -0.65))
        kill(objs("traymount", "traymountplate", "traymountbolt"))
        h = hinge(objs("tray"), (0, -hy, Z0 - 0.55), rot=(-26, 8, 0))
        sit([h], 0.0)
    else:
        hinge(roller, (R0.x - 1.0, R0.y, R0.z), rot=(0, -24, 0), move=(0, 0, 0.1))
        kill(objs("traymount", "traymountplate", "traymountbolt"))
        h = hinge(objs("tray"), (0, -hy, Z0 + 0.1), rot=(-24, 10, 0))
        sit([h], 0.0)
    # the turning parts knocked off their axles
    saw_c = G["SAW"]
    if L == 1:
        ax = (0.5, -0.2, 0.85)
        place_wheel("saw", on_ground((saw_c.x + 0.35, saw_c.y - 0.1), ax, 1.06), ax, spin=20)
    elif L == 3:
        ax = (0.55, -0.35, 0.85)
        place_wheel("saw", on_ground((saw_c.x + 0.9, saw_c.y - 0.6), ax, 1.06), ax, spin=40)
        kill(objs("sgear"))
        for k, p in enumerate(((2.2, -1.9), (3.0, -0.9))):
            G["gear"]("lostgear", 0.33, 9, 0.1, (p[0], p[1], GROUND + 0.06), M["copper"], (0, 0, k * 20), tooth=0.22)
    elif L == 6:
        ax = (0.85, -0.55, 0.45)
        place_wheel("saw", on_ground((saw_c.x + 0.55, saw_c.y - 1.1), ax, 1.06), ax, spin=10)
        kill(objs("sgear"))
    else:
        ax = (0.25, -0.35, 1.0)
        c = G["px"](-2, 52, Z=GROUND)              # inside the canvas (Flash cuts its saw at the bottom edge)
        place_wheel("saw", on_ground((c.x, c.y), ax, 1.06), ax)
        kill(objs("sgear"))
    if L >= 6:                                         # the side cog hangs by one tooth, turned away
        c = objs("swheel")[0].matrix_world.translation.copy()       # still on its axle, wrenched round on it
        place_wheel("swheel", c, (0.35, 0.9, -0.25), spin=30)
    # the chute: bent over toward the right
    if L >= 6:
        hinge(objs("chuteroot"), G["CHUTE"] + Vector((0, 0, -0.55 if L == 6 else 0)),
              rot=(-3, 5, 0) if L == 6 else (-14, 34, 0))
    if L == 10:                                        # the guillotine's right post broken, its top dropped
        posts = sorted(objs("gatepost"), key=lambda o: o.location.x)
        snap(posts[-1], 0.55)
        x0, xr = posts[0].location.x, posts[-1].location.x
        ztop = top_z(posts[-1])                        # the beam drops until its right end rests on the stump
        hinge(objs("gatetop", "gateslot", "gatepanel", "gateblade"), (x0, -0.6, 9.2),
              rot=(0, math.degrees(math.atan2(9.2 - ztop, xr - x0)), 0))
    # loose poles leaning on the right-back corner (levels 3 and 6), a broken ladder at level 10
    z = GROUND
    if L in (3, 6):
        for fy, ty, r, over in ((hy - 0.1, hy - 0.5, 0.14, 0.7), (hy + 0.45, hy + 0.05, 0.16, 0.45)):
            e = eave_point(ty) + Vector((0.16, 0, -0.05))      # resting on the eave's edge
            foot = Vector((e.x + 0.9, fy, z))
            pole(foot, e + (e - foot).normalized() * over, r)
    if L == 10:
        a, b = Vector((hx + 1.0, hy - 0.8, z + 0.05)), Vector((hx + 2.4, hy + 0.6, z + 0.05))   # flat on the ground
        for s in (-0.25, 0.25):
            tube("ladder", [a + Vector((s, -s, 0)), b + Vector((s, -s, 0))], 0.05, M["twig"]("X"))
        for k in range(1, 5):
            p = a.lerp(b, k / 5)
            tube("rung", [p + Vector((-0.28, 0.28, 0)), p + Vector((0.28, -0.28, 0))], 0.04, M["twig"]("X"))
    # bits on the ground
    debris((hx + 1.1, -hy + 0.4), n=5, spread=0.8, seed=1)
    debris((-0.4, -hy - 1.0), n=4, spread=0.9, seed=2)


def destroyed():
    """Flash's one heap for every level (top.destroyed.png): the horn and its pipe lying on the left, the black roller
    under them, the roof's peak with its twig knot on top of the middle, a long light post across, another leaning up
    on the right, the tray with its gold trim under the front, broken planks through it all. Placed by Flash pixel
    (px: the world point under a Flash pixel at a height) so each part sits where Flash has it."""
    g = GROUND
    px = G["px"]
    # the core: broken wall planks in a low dark jumble under everything
    r = random.Random(11)
    for k in range(26):                                # packed close round the middle, highest there
        sx, sy = r.uniform(-15, 21), r.uniform(27, 42)
        mid = max(0.0, 1 - abs(sx - 4) / 20) * max(0.0, 1 - abs(sy - 34) / 10)
        h = r.uniform(0.12, 0.3) + 0.7 * mid
        c = px(sx, sy, Z=g + h)
        o = box("rubbleplank", (r.uniform(0.9, 1.8), r.uniform(0.38, 0.6), 0.14), c, (M["wood"] if k % 4 == 0 else M["dwood"])("X"),
                rot=(r.uniform(-35, 35), r.uniform(-30, 30), r.uniform(0, 180)), bevel=0.03, origin="center",
                jitter=0.03)
    # the tray, tipped, under the front
    tr, _, _ = G["tray"](px(-3, 43, Z=g + 0.3), (2.2, 1.0, 0.42), lumps=False, trim="gold", tilt=-25.0, roll=8.0,
                         keel=0.3, hoop_u=0.5)
    tr.rotation_euler.z = math.radians(-10)
    # torn sheets of the roof's bark, dark, slumped in the middle under the post
    for sx, sy, yaw, tl in ((12, 36, 30, 28), (-2, 33, -40, -22), (20, 31, 75, 35)):
        box("rubbleroof", (1.6, 1.2, 0.1), px(sx, sy, Z=g + 0.55), M["roof"], rot=(tl, 12, yaw), bevel=0.03,
            origin="center", jitter=0.05, bow=0.12)
    # the roller, lying on the left, along the screen
    ro = G["roller"](Vector((0, 0, 0)), 1.8, 0.56)
    hinge([ro] + objs("rollercap"), (0, 0, 0), rot=(0, 0, 45), move=px(-17, 37, Z=g + 0.58))
    # the horn and its pipe, lying across the top-left, the bell to the left
    p0, p1 = px(-6, 24, Z=g + 0.85), px(-27, 27, Z=g + 0.75)
    tube("pipe", [p0, p1], 0.27, M["dgreen"])
    for t in (0.3, 0.75):
        bd = cyl("pipeband", 0.32, 0.08, p0.lerp(p1, t), M["iron"], verts=16, bevel=0.015)
        bd.rotation_euler = (p1 - p0).to_track_quat("Z", "Y").to_euler()
    prof = [(0.26, 0.0), (0.28, 0.35), (0.38, 0.7), (0.52, 0.95), (0.6, 1.05), (0.56, 1.1), (0.44, 1.05)]
    hn = lathe("horn", prof, p1, M["horn"], verts=36)
    hn.rotation_euler = (p1 - p0 + Vector((0, 0, 0.3))).to_track_quat("Z", "Y").to_euler()
    hn.modifiers.new("solid", "SOLIDIFY").thickness = 0.03
    # the roof's peak, broken off, sunk in the middle: the pagoda roof's top with its knot and twigs
    c = px(7, 26, Z=g + 1.1)                           # sunk low in the heap, tipped: a dark lump with its twigs
    G["pagoda_roof"](c.x, c.y, 0.62, 0.72, c.z, c.z + 0.95, lift=0.1)
    hinge(objs("roof", "shingle", "roofstick", "knot", "tuft"), c, rot=(16, -14, 0))
    # the middle burnt black: the char deepest under the post and the peak, as Flash's dark hollow
    burn(px(6, 34, Z=g + 0.4), 2.3)
    burn(px(-4, 38, Z=g + 0.3), 1.4)
    burn(px(8, 26, Z=g + 1.3), 1.2)
    # the long light post across the middle, and one leaning up on the right
    along("rubblepost", px(-25, 30, Z=g + 1.05), px(27, 25, Z=g + 1.2), (0, 0.42, 0.42), M["post"]("X"), roll=8)
    along("rubblepost", px(31, 44, Z=g + 0.2), px(20, 9, Z=g + 2.0), (0, 0.4, 0.4), M["post"]("X"), roll=-6)
    # snapped sticks and a gold bracket or two through it
    c = px(0, 44, Z=g)
    debris((c.x, c.y), n=6, spread=1.2, seed=7)


# ------------------------------------------------------------------------------------------------------------ render


D.run(damaged, destroyed)
