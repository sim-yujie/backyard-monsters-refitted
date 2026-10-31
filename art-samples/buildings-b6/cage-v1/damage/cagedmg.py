"""cagedmg.py : the Champion Cage's damaged and destroyed looks in 3D. Flash has no damaged or destroyed art for the Cage
(buildingArtData.ts row 114: both null; the game keeps the whole picture), so these follow Flash's idea for its other
broken buildings and the Cage's own alternative picture (top.1.v2.png: the front-left fence lying flat on the ground):

    damaged    the fence still stands, but battered: a post's top knocked off and lying in the yard, a corner post's
               spike snapped, ragged black holes torn in two posts, studs knocked off, pickets snapped (one lying in the
               yard), the front-left upper rail broken and sagging, scorch and soot.
    destroyed  every post snapped to a ragged, holed stump; the fence's bays torn off the posts and lying flat in the
               yard (one bay per corner left as snapped stubs), post tops and studs scattered, heavy soot and char.
    Rubble stays inside the square of posts.

    PB_FRAME=... blender -b --factory-startup -P cagedmg.py -- 1 <prev|still|check> <damaged|destroyed>
    check: FLOAT lines (a piece neither on the ground nor touching another piece) and OUTSIDE lines (rubble outside
    the square)
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

D.load(HERE.parent / "cage.py")
from dmgcore import *  # noqa: E402,F401,F403
S = G["S"]
painted, shiny, rail_fn, picket_fn, lathe_fn = G["painted"], G["shiny"], G["rail"], G["picket"], G["lathe"]
A = S.A
R = random.Random(114)
CAP = ("cornice", "roof", "neck", "collar", "spike")


# ------------------------------------------------------------------------------------------------------------ helpers
def part(o):
    """('post3', 'shaft') for post3-shaft, ('picket3_4', '') for picket3_4, ('picket3_4', 'tip') for its tip."""
    n = o.name.split(".")[0]
    a, _, b = n.partition("-")
    return a, b


def of(prefix, *kinds):
    return [o for o in SC.objects if part(o)[0] == prefix and (not kinds or any(part(o)[1].startswith(k) for k in kinds))]


def post_at(i):
    return Vector((*S.posts()[i], 0.0))


def inward(k):
    """The unit ground vector from side k into the yard."""
    p0, p1, _ = S.sides()[k]
    d = Vector((p1[0] - p0[0], p1[1] - p0[1], 0)).normalized()
    return Vector((-d.y, d.x, 0)) if Vector((-d.y, d.x, 0)).dot(-Vector((p0[0], p0[1], 0))) > 0 else Vector((d.y, -d.x, 0))


def turn(obs, pivot, axis, deg, move=(0, 0, 0)):
    """Turn obs round the world line through pivot along axis, then move them."""
    bpy.context.view_layer.update()
    m = Matrix.Translation(Vector(move)) @ Matrix.Translation(Vector(pivot)) @ \
        Matrix.Rotation(math.radians(deg), 4, Vector(axis).normalized()) @ Matrix.Translation(-Vector(pivot))
    for o in obs:
        o.matrix_world = m @ o.matrix_world
    bpy.context.view_layer.update()


def ragged_top(o, keep, jag=0.18, seed=0):
    """Snap a standing bar or block o (origin at its foot, local Z up) to keep of its height: its top vertices jagged
    (a torn end, not a flat cut), the break scorched."""
    r = random.Random(seed)
    me = o.data
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    cut = z0 + (z1 - z0) * keep
    bm = bmesh.new()
    bm.from_mesh(me)
    if len(bm.verts) < 40:                         # cut it finer so the break can be ragged
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=3, use_grid_fill=True)
    for v in bm.verts:
        if v.co.z > cut:
            v.co.z = cut + r.uniform(-jag, jag * 0.6) + 0.5 * jag * math.sin(9 * v.co.x + 7 * v.co.y + seed)
    bm.to_mesh(me)
    bm.free()
    burn((0, 0, cut), max(0.5, jag * 3), o)
    return cut


def holes(o, patches, axes, seed=0):
    """Ragged black holes torn through block o (patches (u, v, half u, half v) over its world box along axes), with a
    dark core inside so the holes read black, as Flash's."""
    w = o.dimensions.copy()
    loc = o.matrix_world.translation.copy()
    core = box(o.name + "-core", (w.x - 0.16, w.y - 0.16, w.z * 0.72), loc, D.inside(),
               bevel=0.0, rot=tuple(math.degrees(a) for a in o.rotation_euler))
    o = D.fine_holes(o, patches, axes=axes, cuts=14, seed=seed)
    # the rim torn, not stepped: every vertex on a hole's edge jolted along the face and bent a little inward
    r = random.Random(seed + 7)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    rim = {v for e in bm.edges if e.is_boundary for v in e.verts}
    for v in rim:
        n = v.normal.copy()
        j = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))) * 0.045
        j -= n * j.dot(n)
        v.co += j - n * r.uniform(0.0, 0.05)
    bm.to_mesh(o.data)
    bm.free()
    return o, core


def ash_mat():
    """Ash and soot: dark brown-black with paler grey blotches, fading out to the grass at its edge (the mesh's "fade"
    attribute: 1 inside, 0 at the rim), so a patch has no hard sheet edge."""
    m = bpy.data.materials.get("ashmat")
    if m:
        return m
    m = painted("ashmat", (28, 22, 20), rough=1.0, metal=0.0, wear=(62, 56, 50), scale=2.5, dirt=0.0, spec=0.05)
    t = m.node_tree
    out = next(n for n in t.nodes if n.type == "OUTPUT_MATERIAL")
    bs = next(n for n in t.nodes if n.type == "BSDF_PRINCIPLED")
    at = t.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "fade"
    nz = t.nodes.new("ShaderNodeTexNoise")                  # the fade broken up, so the rim is blotchy, not a ring
    nz.inputs["Scale"].default_value = 1.6
    nz.inputs["Detail"].default_value = 3.0
    t.links.new(t.nodes.new("ShaderNodeTexCoord").outputs["Object"], nz.inputs["Vector"])
    mul = t.nodes.new("ShaderNodeMath")
    mul.operation, mul.use_clamp = "MULTIPLY", True
    t.links.new(at.outputs["Fac"], mul.inputs[0])
    sc = t.nodes.new("ShaderNodeMapRange")
    sc.inputs[1].default_value, sc.inputs[2].default_value = 0.3, 0.6
    sc.inputs[3].default_value, sc.inputs[4].default_value = 0.6, 1.6
    t.links.new(nz.outputs["Fac"], sc.inputs[0])
    t.links.new(sc.outputs[0], mul.inputs[1])
    soft = t.nodes.new("ShaderNodeMapRange")                # a smooth roll-off, no visible step
    soft.interpolation_type = "SMOOTHERSTEP"
    soft.inputs[1].default_value, soft.inputs[2].default_value = 0.1, 0.95
    t.links.new(mul.outputs[0], soft.inputs[0])
    tr = t.nodes.new("ShaderNodeBsdfTransparent")
    mx = t.nodes.new("ShaderNodeMixShader")
    t.links.new(soft.outputs[0], mx.inputs[0])
    t.links.new(tr.outputs[0], mx.inputs[1])
    t.links.new(bs.outputs[0], mx.inputs[2])
    t.links.new(mx.outputs[0], out.inputs["Surface"])
    return m


def ash(name, at, r, seed=0):
    """A ragged patch of ash and soot on the ground (Flash's broken buildings sit in a dark burnt patch): a thin flat
    sheet, solid in the middle and fading out over its torn outer band."""
    q = random.Random(seed)
    bm = bmesh.new()
    n = 32
    ph = [q.uniform(0, 6.3) for _ in range(3)]
    sq = q.uniform(0.8, 1.0)
    rings, fades = [], []
    for k, (f, fade) in enumerate(((0.45, 1.0), (0.75, 0.55), (1.1, 0.0))):
        ring = []
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r * f * (1 + 0.24 * math.sin(3 * a + ph[0]) + 0.14 * math.sin(7 * a + ph[1])
                          + 0.04 * math.sin(11 * a + ph[2]) + q.uniform(-0.04, 0.04))
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a) * sq, 0.0)))
            fades.append(fade)
        rings.append(ring)
    c = bm.verts.new((0, 0, 0))
    fades.append(1.0)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((c, rings[0][i], rings[0][j]))
        for r0, r1 in zip(rings, rings[1:]):
            bm.faces.new((r0[i], r1[i], r1[j], r0[j]))
    bm.verts.index_update()
    order = [v.index for v in bm.verts]
    o = G["mesh_ob"](name, bm, [ash_mat()], smooth=True)
    att = o.data.attributes.new("fade", "FLOAT", "POINT")
    for idx, f in zip(order, fades):
        att.data[idx].value = f
    o.location = (at[0], at[1], GROUND + 0.004 + 0.001 * (seed % 5))
    return o


def chip(name, at, size, mat, yaw, roll=0.0):
    """A small iron piece lying on the ground (a box resting on its face)."""
    return box(name, size, Vector((at[0], at[1], GROUND)), mat, rot=(roll, 0, yaw), bevel=0.02, jitter=0.01)


def lie(obs, axis_deg, deg, at):
    """Tip obs over (deg round a level axis at bearing axis_deg), move their middle over ground point at and rest
    their lowest point on the ground."""
    bpy.context.view_layer.update()
    c = sum((o.matrix_world.translation for o in obs), Vector()) / len(obs)
    a = math.radians(axis_deg)
    turn(obs, c, (math.cos(a), math.sin(a), 0), deg, move=(at[0] - c.x, at[1] - c.y, 0))
    sit(obs)


def sit(obs):
    """Rest obs' lowest vertex on the ground (D.sit uses the turned bounding boxes, which leaves a turned cone
    floating)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    z = 1e9
    for o in obs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        z = min([z] + [(ev.matrix_world @ v.co).z for v in me.vertices])
        ev.to_mesh_clear()
    for o in obs:
        o.location.z += GROUND - z


def charred():
    """Burnt iron for the destroyed heap: darker, duller, sooty."""
    return painted("ironburnt", (34, 26, 26), rough=0.8, metal=0.15, wear=(58, 44, 40), rust=(70, 40, 30), scale=5,
                   dirt=0.5, spec=0.2, soot=0.8, rust_at=0.55)


def charred_stud():
    return shiny("studburnt", (70, 70, 74), rough=0.6, metal=0.5, wear=(40, 36, 36), scale=4, dirt=0.3)


def recolour(obs, mat):
    for o in obs:
        if o.type in ("MESH", "CURVE") and o.data.materials and o.data.materials[0].name not in ("inside",):
            o.data.materials[0] = mat


# ------------------------------------------------------------------------------------------------------------ damaged
def damaged():
    bpy.context.view_layer.update()                         # the parts' world matrices, before reading them
    # post 4 (back-left side, near the left corner): its top knocked off, lying in the yard on its side
    top4 = of("post4", *CAP)
    cut = ragged_top(of("post4", "shaft")[0], 0.8, jag=0.22, seed=4)
    for o in of("post4", "stud"):                          # the studs by the break went with it
        if o.matrix_world.translation.z > cut - 0.3:
            kill([o])
    p = post_at(4) + inward(0) * 2.1 + Vector((0.9, 0, 0))
    lie(top4, 45, 90, p)
    # post 2 (the right corner): the spike snapped off at its root and lying behind the post's foot in the yard
    sp = of("post2", "spike")
    lie(sp, 0, 90, post_at(2) + inward(1) * 1.2 + Vector((-0.6, 0, 0)))
    burn(post_at(2) + Vector((0, 0, S.POST_H + 0.9)), 0.5)
    # post 3 (the front corner, nearest the viewer): torn open on both faces we see, one big hole, one small
    sh3 = of("post3", "shaft")[0]
    for o in of("post3", "stud"):
        if o.name.split("-")[1] == "stud30":                 # the stud where the big hole is
            kill([o])
    sh3, _ = holes(sh3, [(0.32, 0.36, 0.3, 0.17), (0.8, 0.55, 0.14, 0.09)], ("x", "z"), seed=3)
    # post 8 (front-right side, near the right corner): a ragged hole high on its left face, a lean
    sh8 = of("post8", "shaft")[0]
    for o in of("post8", "stud31"):
        kill([o])
    holes(sh8, [(0.55, 0.72, 0.22, 0.13)], ("x", "z"), seed=8)
    turn(of("post8"), post_at(8), (0, 1, 0), 5)
    # studs knocked off here and there, lying at the posts' feet inside
    for k, (i, s) in enumerate(((6, "stud20"), (9, "stud31"), (5, "stud00"), (7, "stud10"))):
        for o in of(f"post{i}", s):
            burn(o.matrix_world.translation, 0.35)
            kill([o])
        q = post_at(i) + Vector((R.uniform(-0.3, 0.3), R.uniform(-0.3, 0.3), 0))
        q = q + (Vector((0, 0, 0)) - q).normalized() * 1.0
        st = G["stud"](f"chipstud{k}", (q.x, q.y, GROUND), (0, 0, 1), M["stud"])
        st.rotation_euler.z += R.uniform(0, 1.5)
    # the front-left side: the upper rail broken at the sixth ninth (that picket is gone, lying in the yard), its two
    # halves sagging; two pickets snapped above the lower rail; a back picket snapped
    f, l = S.corners()[3], S.corners()[0]
    z = S.RAIL_Z[1]
    kill(of("rail31"))
    t1, t2 = 0.58, 0.69
    pa = (f[0] + (l[0] - f[0]) * t1, f[1] + (l[1] - f[1]) * t1)
    pb = (f[0] + (l[0] - f[0]) * t2, f[1] + (l[1] - f[1]) * t2)
    ra = rail_fn("railbrokenA", f, pa, z)
    rb = rail_fn("railbrokenB", pb, l, z)
    d = Vector((l[0] - f[0], l[1] - f[1], 0)).normalized()
    nrm = Vector((-d.y, d.x, 0))
    fa = Vector((*S.fence(f), z))
    la = Vector((*S.fence(l), z))
    turn([ra], fa, nrm, 3.2)                                # its loose end drops ~0.35
    turn([rb], la, nrm, -4.0)
    for o in (ra, rb):
        burn(o.matrix_world.translation + (d * (o.dimensions.x / 2) * (1 if o is ra else -1)), 0.4)
    kill(of("picket3_6"))                                   # the picket in the gap: lying in the yard
    picket_fn("lost3_6", 0.0, 0.0, (d.x, d.y))
    lost = [o for o in SC.objects if o.name.startswith("picketlost3_6")]
    lie(lost, math.degrees(math.atan2(d.y, d.x)), 90, Vector((*S.fence(pa), 0)) + inward(3) * 1.6 + d * 0.6)
    for j, keep in ((3, 0.36), (7, 0.62)):
        kill(of(f"picket3_{j}", "tip"))
        ragged_top(of(f"picket3_{j}")[0], keep, jag=0.12, seed=j)
    kill(of("picket1_4", "tip"))
    ragged_top(of("picket1_4")[0], 0.7, jag=0.1, seed=14)
    kill(of("picket2_7", "tip"))
    ragged_top(of("picket2_7")[0], 0.5, jag=0.12, seed=27)
    # more ragged holes, each its own size: the back corner post, a back post, the right corner
    for i, pat, ax in ((1, [(0.6, 0.5, 0.2, 0.14)], ("y", "z")), (6, [(0.35, 0.3, 0.12, 0.08), (0.7, 0.62, 0.22, 0.12)],
                                                                        ("y", "z")), (2, [(0.4, 0.42, 0.25, 0.2)], ("x", "z"))):
        for o in of(f"post{i}", "stud"):
            if o.name.split("-")[1] in ("stud00", "stud30", "stud21"):
                kill([o])
        holes(of(f"post{i}", "shaft")[0], pat, ax, seed=60 + i)
    # more pickets snapped, one bent outward at the lower rail
    for k, j, keep in ((0, 2, 0.55), (1, 7, 0.42), (2, 1, 0.66), (2, 4, 0.3), (3, 1, 0.48)):
        kill(of(f"picket{k}_{j}", "tip"))
        ragged_top(of(f"picket{k}_{j}")[0], keep, jag=0.1, seed=10 * k + j)
    bent = of("picket2_5")
    p0, p1, _ = S.sides()[2]
    q = Vector((*S.fence((p0[0] + (p1[0] - p0[0]) * 5 / 9, p0[1] + (p1[1] - p0[1]) * 5 / 9)), S.RAIL_Z[1] + 0.1))
    top = [o for o in bent if "tip" in o.name]
    kill([o for o in bent if "tip" not in o.name])
    G["box"]("picketbent2_5", (S.PICKET_W, S.PICKET_W, S.RAIL_Z[1] + 0.1), (q.x, q.y, GROUND), M["picket"], bevel=0.02)
    up = G["box"]("picketbent2_5u", (S.PICKET_W, S.PICKET_W, S.PICKET_H - S.TIP_H - S.RAIL_Z[1] - 0.1), q, M["picket"],
                  bevel=0.02)
    turn([up] + top, q, (0, 1, 0), 28)                        # the upper part bent out toward the viewer
    # ash and soot on the ground at the worst breaks
    for k, (i, r) in enumerate(((3, 1.3), (4, 1.0), (2, 0.9), (6, 0.8))):
        c = post_at(i)
        ash(f"ash{k}", c * 0.9, r, seed=k)
    ash("ash9", Vector((*S.fence(pa), 0)) + inward(3) * 1.0, 1.1, seed=9)
    # scorch round the breaks and on the posts' faces
    for i, h in ((0, 1.2), (6, 0.8), (9, 1.4), (1, 0.6), (5, 1.6)):
        burn(post_at(i) + Vector((0, 0, h)), 0.7)


# ------------------------------------------------------------------------------------------------------------ destroyed
def bay(k, b, name, broken=False):
    """Side k's bay b (0..2 from the side's start): its two rails (from post face to post face; broken: each snapped in
    two with a gap) and its pickets, built standing. Returns the objects and the bay's ground line ends (fence line)."""
    p0, p1, mid = S.sides()[k]
    d = Vector((p1[0] - p0[0], p1[1] - p0[1], 0))
    ln = d.length
    u = d / ln
    t0, t1 = b / 3, (b + 1) / 3
    gap = S.POST_W / 2 + 0.02
    a = Vector((p0[0], p0[1], 0)) + d * t0 + (u * gap if mid or b == 0 else Vector())
    e = Vector((p0[0], p0[1], 0)) + d * t1 - (u * gap if mid or b == 2 else Vector())
    obs = []
    for j, z in enumerate(S.RAIL_Z):
        if not broken:
            obs.append(rail_fn(f"{name}rail{j}", (a.x, a.y), (e.x, e.y), z))
            continue
        t, g = R.uniform(0.3, 0.7), R.uniform(0.06, 0.16)    # snapped: a gap torn out of it somewhere along
        m1, m2 = a + (e - a) * (t - g), a + (e - a) * (t + g)
        obs.append(rail_fn(f"{name}rail{j}a", (a.x, a.y), (m1.x, m1.y), z))
        obs.append(rail_fn(f"{name}rail{j}b", (m2.x, m2.y), (e.x, e.y), z))
    n = 3 * (S.PER_BAY + 1)
    for j in range(1, n):
        if mid and j % (S.PER_BAY + 1) == 0:
            continue
        t = j / n
        if not t0 < t < t1 + 1e-6:
            continue
        q = Vector((p0[0], p0[1], 0)) + d * t
        picket_fn(f"{name}p{j}", *S.fence((q.x, q.y)), (u.x, u.y))
    obs += [o for o in SC.objects if o.name.startswith(f"picket{name}p")]
    return obs, a, e


def destroyed():
    G["build"]()
    bpy.context.view_layer.update()
    kill([o for o in SC.objects if part(o)[0].startswith(("rail", "picket"))])
    burnt = charred()
    # every post snapped to a ragged stump, holed; most tops lying in the yard
    for i in range(len(S.posts())):
        sh = of(f"post{i}", "shaft")[0]
        keep = R.uniform(0.28, 0.55)
        cut = ragged_top(sh, keep, jag=0.2, seed=40 + i)
        for o in of(f"post{i}", "stud"):
            if o.matrix_world.translation.z > cut - 0.25:
                kill([o])
        cap = of(f"post{i}", *CAP)
        c = post_at(i)
        if i % 3 == 1:
            kill(cap)                                       # this one's top is gone altogether
        else:                                               # in the middle of the yard, clear of the fallen bays
            spot = c * R.uniform(0.22, 0.42) + Vector((R.uniform(-0.5, 0.5), R.uniform(-0.5, 0.5), 0))
            head = [o for o in cap if part(o)[1] != "spike"]
            spike = [o for o in cap if part(o)[1] == "spike"]
            lie(head, R.uniform(0, 180), R.uniform(70, 100), spot)       # dropped, lying on its side in the rubble
            turn(head, spot, (0, 0, 1), R.uniform(0, 90))
            for o in head:
                o.location.z -= 0.05
            a = R.uniform(0, 360)
            lie(spike, a, 90, spot + Vector((math.cos(math.radians(a + 90)), math.sin(math.radians(a + 90)), 0)) * 1.0)
            recolour(cap, burnt)
        recolour([o for o in SC.objects if part(o)[0] == f"post{i}" and part(o)[1].startswith(("shaft", "stud"))],
                 burnt if i % 2 else charred_stud())
        if i in (3, 8, 0, 6):
            holes(sh, [(0.45, 0.4, 0.28, 0.3)], ("x", "z") if i % 2 else ("y", "z"), seed=50 + i)
        burn(c + Vector((0, 0, cut * 0.6)), 0.8)
    # the bays: torn off and lying flat in the yard; at each corner the bay that would land on another is stubs
    for k in range(4):
        into = inward(k)
        for b in range(3):
            name = f"b{k}{b}"
            obs, a, e = bay(k, b, name, broken=b != 2)
            if b == 2:                                     # stubs: pickets snapped low, rails gone
                kill([o for o in obs if "rail" in o.name or o.name.endswith("-tip")])
                for o in [o for o in SC.objects if o.name.startswith(f"picket{name}p") and "-tip" not in o.name]:
                    ragged_top(o, R.uniform(0.18, 0.4), jag=0.08, seed=hash(o.name) % 97)
                    recolour([o], burnt)
                continue
            line = Vector((*S.fence(((a.x + e.x) / 2, (a.y + e.y) / 2)), 0))
            axis = (e - a).normalized()
            sgn = 1 if axis.cross(Vector((0, 0, 1))).dot(into) > 0 else -1
            turn(obs, line, axis, 90 * sgn)
            # slid a little further in and turned a little, each bay its own way
            turn(obs, line, (0, 0, 1), R.uniform(-7, 7), move=tuple(into * R.uniform(0.3, 0.7)))
            # torn and bent, not a tidy ladder: kinked where the rails broke, every picket knocked askew, a few bent
            c = sum((o.matrix_world.translation for o in obs), Vector()) / len(obs)
            far = [o for o in obs if (o.matrix_world.translation - c).dot(axis) > 0]
            turn(far, c, (0, 0, 1), R.choice((-1, 1)) * R.uniform(12, 24), move=tuple(axis * R.uniform(0.1, 0.3)))
            groups = {}
            for o in obs:
                groups.setdefault(o.name.split("-")[0], []).append(o)
            for nm, grp in groups.items():
                g = sum((o.matrix_world.translation for o in grp), Vector()) / len(grp)
                if nm.startswith("picket"):
                    turn(grp, g, (0, 0, 1), R.uniform(-16, 16), move=tuple(axis * R.uniform(-0.12, 0.12)))
                    tip = [o for o in grp if o.name.endswith("-tip")]
                    if tip and R.random() < 0.4:                # the spear tip bent sideways at its foot
                        turn(tip, tip[0].matrix_world.translation, (0, 0, 1), R.choice((-1, 1)) * R.uniform(25, 50))
                else:
                    turn(grp, g, (0, 0, 1), R.uniform(-6, 6), move=tuple(into * R.uniform(-0.1, 0.1)))
            for grp in groups.values():
                sit(grp)
            if (k + b) % 2 == 0:
                recolour(obs, burnt)
            # torn: some pickets gone from the bay, one or two thrown loose beside it
            pk = sorted({o.name.split("-")[0] for o in obs if o.name.startswith("picket")})
            for j, nm in enumerate(pk):
                if R.random() < 0.35:
                    loose = [o for o in SC.objects if o.name.split("-")[0] == nm]
                    if R.random() < 0.5:
                        kill(loose)
                    else:
                        c = sum((o.matrix_world.translation for o in loose), Vector()) / len(loose)
                        turn(loose, c, (0, 0, 1), R.uniform(25, 70), move=tuple(into * R.uniform(0.6, 1.2)))
                        sit(loose)
            for o in obs[:2]:
                burn(o.matrix_world.translation, 0.9)
    # loose studs and iron chips in the yard
    for k in range(10):
        c = Vector((R.uniform(-3.6, 3.6), R.uniform(-3.6, 3.6), GROUND))
        if k % 2:
            st = G["stud"](f"chipstud{k}", c, (0, 0, 1), charred_stud())
            st.rotation_euler.z += R.uniform(0, 1.5)
        else:
            chip(f"chip{k}", c, (R.uniform(0.3, 0.6), 0.12, 0.16), burnt, R.uniform(0, 180))
    for k in range(8):
        burn(Vector((R.uniform(-A, A), R.uniform(-A, A), 0.0)), R.uniform(1.0, 1.8))
    # ash and soot: round every stump and a big burnt patch in the middle under the rubble
    for i, (x, y) in enumerate(S.posts()):
        ash(f"ash{i}", Vector((x, y, 0)) * 0.86, R.uniform(0.8, 1.0), seed=i)
    for k, (x, y, r) in enumerate(((0.6, -0.8, 2.2), (-1.6, 1.6, 1.7), (1.8, 1.9, 1.3), (-2.2, -1.9, 1.2))):
        ash(f"ashmid{k}", (x, y), r, seed=21 + k)


# ------------------------------------------------------------------------------------------------------------ check
def check():
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    items = []
    for o in SC.objects:
        if o.type not in ("MESH", "CURVE") or o.name == "ground":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        vs = [ev.matrix_world @ v.co for v in me.vertices]
        items.append((o, BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs))
        ev.to_mesh_clear()
    k = S.FENCE_SHIFT / math.sqrt(2)
    lim = A + max(S.CORN_W / 2, S.POST_W / 2 + S.STUD_D) + 0.05
    nf = no = 0
    for o, t, vs in items:
        zmin = min(v.z for v in vs)
        if max(abs(v.x - k * 0) for v in vs) > lim + k or max(abs(v.y) for v in vs) > lim + k:
            print("OUTSIDE", o.name)
            no += 1
        if zmin < GROUND + 0.03:
            continue
        near = min((t2.find_nearest(v)[3] or 9) for o2, t2, _ in items if o2 is not o for v in vs[::max(1, len(vs) // 40)])
        if near > 0.03:
            print("FLOAT %s lowest %.3f nearest other %.3f" % (o.name, zmin, near))
            nf += 1
    print("CHECKED %d pieces: %d floating, %d outside" % (len(items), nf, no))


if D.MODE == "check":
    G["build"]() if D.STATE == "damaged" else None
    (damaged if D.STATE == "damaged" else destroyed)()
    check()
else:
    D.run(damaged, destroyed, soot_amount=(0.5, 0.7))
