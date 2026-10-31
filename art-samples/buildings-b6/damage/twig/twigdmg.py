"""twigdmg.py : the Twig Snapper's damaged and destroyed looks in 3D, as Flash's top.<n>.damaged.png and
top.destroyed.png. The approved model (twig2.py, art/buildings-3d-b6 72791f1eb, copied here unchanged) is built as it
is, then broken: the same parts, at the same camera and light, knocked off, tilted, dropped and holed where Flash's
damaged picture has them so; the destroyed look is those parts in one heap (Flash has one heap for every level).

    blender -b --factory-startup -P twigdmg.py -- <level> <mode> <state>
        mode  prev   render/prev-L<level>-<state>.png    quick look, 4 px a Flash px, with the ground shadow
              still  render/L<level>-<state>-base.png    the look with its ground shadow (shadow catcher), 12 px a Flash px
                     render/L<level>-<state>-alone.png   the look alone, no ground shadow (to take the shadow off)
        state damaged | destroyed  (destroyed is the same at every level: give level 3)

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
ARGS = sys.argv[sys.argv.index("--") + 1:]
STATE = ARGS[2] if len(ARGS) > 2 else "damaged"
SRC = HERE / "twig2.py"
G = {"__file__": str(SRC), "__name__": "twig2"}
_src = SRC.read_text(encoding="utf8")
assert _src.rstrip().endswith("main()")
exec(compile(_src.rstrip()[:-len("main()")], str(SRC), "exec"), G)
L, M, SC = G["L"], G["M"], G["SC"]
box, cyl, tube, lathe = G["box"], G["cyl"], G["tube"], G["lathe"]
GROUND, HX, HY, Z0, Z1 = G["GROUND"], G["HX"], G["HY"], G["Z0"], G["Z1"]
MODE = ARGS[1]
rng = random.Random(77 + L)


# ------------------------------------------------------------------------------------------------------------ helpers
WALLS = ("rwall", "lwall", "bwall2", "bwall", "cabL")


def base(o):
    """o's part name: Blender's .001 off, and a wall plank's number (rwall3 -> rwall)."""
    n = o.name.split(".")[0]
    for w in WALLS:
        if n.startswith(w) and n[len(w):].isdigit():
            return w
    return n


def objs(*names, top=True):
    """Objects whose name (without Blender's .001 and a plank's number) is one of names; top=True: only unparented."""
    out = []
    for o in SC.objects:
        if top and o.parent is not None:
            continue
        if base(o) in names:
            out.append(o)
    return out


def kids(o):
    out = [o]
    for c in o.children:
        out += kids(c)
    return out


def kill(obs):
    for o in obs:
        for k in kids(o):
            if k.name in bpy.data.objects:
                bpy.data.objects.remove(k, do_unlink=True)


def hinge(obs, pivot, rot=(0, 0, 0), move=(0, 0, 0)):
    """Turn obs (degrees XYZ) round world point pivot, then move them: an empty at the pivot takes them as children."""
    bpy.context.view_layer.update()
    e = bpy.data.objects.new("hinge", None)
    G["COLL"].objects.link(e)
    e.location = pivot
    bpy.context.view_layer.update()
    for o in obs:
        mw = o.matrix_world.copy()
        o.parent = e
        o.matrix_world = mw
    e.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    e.location = Vector(pivot) + Vector(move)
    bpy.context.view_layer.update()
    return e


def bake(o):
    """Apply o's modifiers/curve into a plain mesh in place (for cutting holes)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    new = bpy.data.objects.new(o.name + "-baked", me)
    G["COLL"].objects.link(new)
    new.matrix_world = o.matrix_world.copy()
    new.parent = None
    bpy.data.objects.remove(o, do_unlink=True)
    return new


def roof_holes(patches, N=64, R=12, near=0.2, cuts=4):
    """Tear holes in the pagoda roof. Each patch (s, t, half-width in s, half-height in t) is a spot on pagoda_roof's
    grid (N faces round, R rows from the apex, face j*N + i at s = 4i/N round the eave, t = j/R down the slope): its
    middle and size are read off that grid, then the roof is cut finer (cuts) and the faces inside a ragged round edge
    round that middle go. The shingle strips over a hole go with it; the sticks (the roof's frame) stay."""
    ro = objs("roof")[0]
    mw = ro.matrix_world.copy()
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


def grid_holes(o, nu, nv, patches):
    """Tear holes in a sheet built as a grid of nu x nv faces (face i * nv + j); patches (u, v, half u, half v) in
    0..1 across the grid, ragged."""
    r = random.Random(9 + L)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    dead = []
    for i in range(nu):
        for j in range(nv):
            u, v = (i + 0.5) / nu, (j + 0.5) / nv
            if any(((u - pu) / wu) ** 2 + ((v - pv) / wv) ** 2 < 1.0 + r.uniform(-0.45, 0.25) for pu, pv, wu, wv in patches):
                dead.append(bm.faces[i * nv + j])
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def sheet_holes(o, spots):
    """Delete faces of the (baked) sheet o whose middle (world) lies within r of a spot (x, y, z, r), ragged."""
    o = bake(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    mw = o.matrix_world
    dead = []
    for f in bm.faces:
        d0 = mw @ f.calc_center_median()
        for x, y, z, rad in spots:
            d = d0 - Vector((x, y, z))
            a = math.atan2(d.z, d.x) + d.y
            if d.length < rad * (0.8 + 0.25 * math.sin(5 * a + x) + 0.12 * math.sin(11 * a + y)):
                dead.append(f)
                break
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    return o


def snap(o, keep, axis="Z"):
    """Shorten plank o to the fraction keep of its height, with a ragged broken end (its top vertices jagged)."""
    me = o.data
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    cut = z0 + (z1 - z0) * keep
    for v in me.vertices:
        if v.co.z > cut:
            v.co.z = cut + (v.co.z - cut) * 0.04 + rng.uniform(-0.12, 0.12) * (z1 - z0) * 0.25 * \
                (1 if v.co.x > 0 else -1)
    return o


def debris(at, n=6, spread=1.2, kinds=("plank", "stick", "bracket"), seed=0):
    """Broken bits lying on the ground round at: short plank ends, snapped sticks, a loose gold bracket."""
    r = random.Random(seed + 100 * L)
    out = []
    for i in range(n):
        k = kinds[i % len(kinds)]
        p = Vector((at[0] + r.uniform(-spread, spread), at[1] + r.uniform(-spread, spread), GROUND))
        yaw = r.uniform(0, 180)
        if k == "plank":
            ln = r.uniform(0.5, 1.1)
            out.append(box("chip", (ln, 0.24, 0.09), p + Vector((0, 0, 0.045)), M["wood"]("X"),
                           rot=(r.uniform(-6, 6), r.uniform(-8, 8), yaw), bevel=0.02, origin="center", jitter=0.02))
        elif k == "stick":
            a = math.radians(yaw)
            d = Vector((math.cos(a), math.sin(a), 0)) * r.uniform(0.5, 0.9)
            out.append(tube("stick", [p - d / 2 + Vector((0, 0, 0.05)), p + d / 2 + Vector((0, 0, 0.12))], 0.045,
                            M["twig"]("X"), r_end=0.03))
        else:
            out.append(box("chipbracket", (0.3, 0.05, 0.3), p + Vector((0, 0, 0.03)), M["gold"] if L >= 6 else M["olive"],
                           rot=(80 + r.uniform(-10, 10), 0, yaw), bevel=0.02, origin="center"))
    return out


def soot(amount=0.35, scale=2.2):
    """Scorch: every material's colour darkened in soft patches (fixed noise in object space), as a battle left it."""
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        t = m.node_tree
        bs = next((n for n in t.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bs is None:
            continue
        inp = bs.inputs["Base Color"]
        tc = t.nodes.new("ShaderNodeTexCoord")
        nz = t.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = 6.0
        t.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        ramp = t.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = 0.5
        ramp.color_ramp.elements[1].position = 0.68
        t.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mul = t.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = amount
        t.links.new(ramp.outputs["Color"], mul.inputs[0])
        t.links.new(mul.outputs[0], mix.inputs["Factor"])
        mix.inputs["B"].default_value = (0.08, 0.06, 0.05, 1)
        if inp.is_linked:
            t.links.new(inp.links[0].from_socket, mix.inputs["A"])
        else:
            mix.inputs["A"].default_value = inp.default_value
        t.links.new(mix.outputs["Result"], inp)


# ------------------------------------------------------------------------------------------------------------ damaged
def shift_all(mat, keep=()):
    """Move every unparented object (the whole machine, everything fixed to it) by world matrix mat."""
    bpy.context.view_layer.update()
    for o in list(SC.objects):
        if o.parent is None and o.type in ("MESH", "CURVE", "EMPTY") and o not in keep and o.name != "ground":
            o.matrix_world = mat @ o.matrix_world


def tilt_mat(pivot, rot):
    p = Vector(pivot)
    return Matrix.Translation(p) @ Euler([math.radians(a) for a in rot], "XYZ").to_matrix().to_4x4() @ \
        Matrix.Translation(-p)


def place_wheel(name, center, axis, spin=0.0):
    """Set spinner `name` (its empty) to world centre and axle direction axis (its local Z), turned spin degrees."""
    e = objs(name)[0]
    n = Vector(axis).normalized()
    q = n.to_track_quat("Z", "Y")
    e.matrix_world = Matrix.Translation(Vector(center)) @ q.to_matrix().to_4x4() @ \
        Matrix.Rotation(math.radians(spin), 4, "Z")
    return e


def on_ground(center_xy, axis, r):
    """A wheel of radius r lying with axle `axis` touching the ground: its centre's height."""
    n = Vector(axis).normalized()
    s = math.sqrt(max(0.0, 1 - n.z * n.z))             # the disc's lowest point is r * sin(angle from vertical)
    return Vector((center_xy[0], center_xy[1], GROUND + r * s + 0.04))


def lowest(obs):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    z = 1e9
    for o in obs:
        for k in kids(o):
            if k.type in ("MESH", "CURVE"):
                ev = k.evaluated_get(dg)
                for c in ev.bound_box:
                    z = min(z, (k.matrix_world @ Vector(c)).z)
    return z


def sit(obs, extra=0.0):
    """Drop (or lift) obs so their lowest point rests on the ground."""
    dz = GROUND + extra - lowest(obs)
    for o in obs:
        o.location.z += dz


def top_z(o):
    bpy.context.view_layer.update()
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return max((o.matrix_world @ v.co).z for v in ev.to_mesh().vertices)


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


def pole(foot, top, r=0.13):
    return tube("pole", [Vector(foot), Vector(top)], r, M["post"]("Z"), r_end=r * 0.8)


def damaged():
    hx, hy = HX, HY
    # the legs give: the machine sinks onto stumps and leans a little to the front-left
    if L == 1:
        kill(objs("foot"))
        shift_all(tilt_mat((0, 0, GROUND), (-3, 2, 0)) @ Matrix.Translation((0, 0, -0.32)))
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
    # the ceiling seen through the holes is the dark inside
    for o in objs("ceiling") if L > 1 else []:
        o.data.materials[0] = M["hole"]
    # roof: torn holes between the sticks over the body (the sticks, its frame, stay), on the slopes the camera sees:
    # s in [0, 1) the right slope, [3, 4) the front one
    if L in (3, 6):
        w = 1.35 if L == 3 else 1.6
        roof_holes([(3.27, 0.47, 0.13 * w, 0.16 * w), (3.74, 0.42, 0.12 * w, 0.14 * w),
                    (0.26, 0.5, 0.12 * w, 0.17 * w), (0.73, 0.45, 0.11 * w, 0.13 * w)] +
                   ([(3.5, 0.62, 0.1, 0.1), (0.5, 0.6, 0.08, 0.09)] if L == 6 else []))
    if L == 10:                                        # the front bark sheet torn through in the middle
        grid_holes(objs("roofF")[0], 16, 25, [(0.38, 0.45, 0.16, 0.22), (0.66, 0.3, 0.1, 0.14)])
    if L == 1:                                         # the lean-to falls in at the front, into the cabinet
        kill(objs("roofrake", "roofridge", "ceiling"))  # the ceiling gives way: the roof sags in between the walls
        kill([o for o in objs("beamR", "beamL") if o.matrix_world.translation.z > 3.0])
        for o in objs("gable"):                        # the gable boards over the cabinet snapped short
            snap(o, rng.uniform(0.3, 0.6))
        rp = objs("roofplank")
        hinge(rp, (-1.6, -0.25, Z1 + 0.77 - 0.82), rot=(-9, 12, 0), move=(0, 0, -0.22))
        lp = objs("looseplank")
        kill(lp[1:])
        if lp:                                         # one loose plank slid down across the front, to the tray
            a, b = Vector((-0.6, -2.6, 0.75)), Vector((0.6, -2.02, 3.55))   # up against the press's crossbar
            o = lp[0]
            o.rotation_euler = (b - a).to_track_quat("X", "Z").to_euler()
            o.location = (a + b) / 2
            o.scale = ((b - a).length / max(o.dimensions.x, 0.1), 0.45, 0.6)
        kill(objs("cap"))                              # the dome blown off: the open horn under it shows
        top = Vector((G["PIPE_FOOT"].x, G["PIPE_FOOT"].y, 6.6 - 0.82))
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
        elif i in {1: (3, 4, 5), 3: (4,), 6: (1, 4), 10: (5,)}[L]:
            snap(o, {1: {3: 0.86, 4: 0.6, 5: 0.7}}.get(L, {}).get(i, 0.72 if i % 2 else 0.8))
    # the horn: the pipe bent back at its foot (levels 1 and 3, as Flash)
    if L in (1, 3):
        pipe = objs("pipe", "pipeband", "horn", "hornneck", "cap", "pipestay", "pipeplate")
        foot = G["PIPE_FOOT"] + Vector((0, 0, -0.32 if L == 1 else -0.55))
        hinge(pipe, foot, rot=(14, -16, 0) if L == 3 else (8, -12, 0))
    # roller and tray
    roller = objs("roller", "rollercap", "rollerarm")
    R0 = G["ROLLER"]
    tray = objs("tray") + objs("traymount", "traymountplate", "traymountbolt")
    if L == 1:
        hinge(roller, (R0.x - 1.0, R0.y, R0.z - 0.8), rot=(0, 14, 0), move=(0, -0.1, -0.35))
        kill(objs("traymount", "traymountplate", "traymountbolt"))
        h = hinge(objs("tray"), (0, -hy, Z0 - 0.8), rot=(-28, 6, 0), move=(0, -0.1, 0))
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


def along(name, a, b, size, mat, roll=0.0):
    """A box `size` (length, width, height) lying from a to b, turned roll degrees about its length."""
    a, b = Vector(a), Vector(b)
    o = box(name, ((b - a).length, size[1], size[2]), (a + b) / 2, mat, bevel=0.05, origin="center", jitter=0.015)
    o.rotation_euler = ((b - a).to_track_quat("X", "Z") @ Euler((math.radians(roll), 0, 0)).to_quaternion()).to_euler()
    return o


def destroyed():
    """Flash's one heap for every level (top.destroyed.png): the horn and its pipe lying on the left, the black roller
    under them, the roof's peak with its twig knot on top of the middle, a long light post across, another leaning up
    on the right, the tray with its gold trim under the front, broken planks through it all. Placed by Flash pixel
    (px: the world point under a Flash pixel at a height) so each part sits where Flash has it."""
    g = GROUND
    px = G["px"]
    # the core: broken wall planks in a low dark jumble under everything
    r = random.Random(11)
    for k in range(30):
        sx, sy = r.uniform(-20, 26), r.uniform(24, 44)
        mid = max(0.0, 1 - abs(sx - 4) / 26) * max(0.0, 1 - abs(sy - 32) / 14)
        h = r.uniform(0.15, 0.4) + 0.9 * mid
        c = px(sx, sy, Z=g + h)
        o = box("rubbleplank", (r.uniform(0.9, 1.8), r.uniform(0.38, 0.6), 0.14), c, (M["wood"] if k % 3 == 0 else M["dwood"])("X"),
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
    c = px(7, 24, Z=g + 1.45)
    G["pagoda_roof"](c.x, c.y, 0.75, 0.9, c.z, c.z + 1.15, lift=0.15)
    hinge(objs("roof", "shingle", "roofstick", "knot", "tuft"), c, rot=(8, -10, 0))
    # the long light post across the middle, and one leaning up on the right
    along("rubblepost", px(-25, 30, Z=g + 1.05), px(27, 25, Z=g + 1.2), (0, 0.42, 0.42), M["post"]("X"), roll=8)
    along("rubblepost", px(31, 44, Z=g + 0.2), px(20, 9, Z=g + 2.0), (0, 0.4, 0.4), M["post"]("X"), roll=-6)
    # snapped sticks and a gold bracket or two through it
    c = px(0, 44, Z=g)
    debris((c.x, c.y), n=6, spread=1.2, seed=7)


# ------------------------------------------------------------------------------------------------------------ render
def main():
    if STATE == "damaged":
        G["build"]()
        damaged()
    elif STATE == "destroyed":
        destroyed()
    soot(0.3 if STATE == "damaged" else 0.45)
    cam = G["setup"](SC)
    sc = SC
    out = HERE / "render"
    out.mkdir(exist_ok=True)
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    if MODE == "prev":
        sc.render.resolution_x = (G["FRAME"][2] - G["FRAME"][0]) * 4
        sc.render.resolution_y = (G["FRAME"][3] - G["FRAME"][1]) * 4
        sc.cycles.samples = 48
        sc.render.filepath = str(out / f"prev-L{L}-{STATE}.png")
        bpy.ops.render.render(write_still=True)
    else:
        sc.cycles.samples = 384
        sc.render.filepath = str(out / f"L{L}-{STATE}-base.png")
        bpy.ops.render.render(write_still=True)
        bpy.data.objects["ground"].hide_render = True
        sc.cycles.samples = 64
        sc.render.filepath = str(out / f"L{L}-{STATE}-alone.png")
        bpy.ops.render.render(write_still=True)
    print("DONE", L, MODE, STATE)


main()
