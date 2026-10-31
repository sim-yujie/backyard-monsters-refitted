"""dmgcore.py : what every building's damaged/destroyed script shares. A building's approved model script (copied
unchanged next to its rules) is run without its main(), so its build(), parts, materials, camera and light are there to
use; the rules then break the built model (damaged) or heap its parts (destroyed), and run() renders.

    import dmgcore as D
    D.load(HERE / "twig2.py", walls=("rwall", ...))   # the model script; plank-wall names that end in a number
    from dmgcore import *                             # G (the model script's globals), L, M, SC, box, cyl, ... helpers
    ...
    D.run(damaged, destroyed)

Command line (the model script reads level and mode from it too): -- <level> <mode> <state>
    mode  prev   render/prev-L<level>-<state>.png    quick look, 4 px a Flash px, with the ground shadow
          still  render/L<level>-<state>-base.png    the look with its ground shadow (shadow catcher), 12 px a Flash px
                 render/L<level>-<state>-alone.png   the look alone, no ground shadow (to take the shadow off)
    state damaged | destroyed
"""
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "prev", "damaged"]
MODE = ARGS[1] if len(ARGS) > 1 else "prev"
STATE = ARGS[2] if len(ARGS) > 2 else "damaged"
G = {}
BURN = []                                          # scorch spots: (object or None, point (its local / world), radius)
WALLS = ()
HERE = None
L = M = SC = box = cyl = tube = lathe = GROUND = rng = None


def load(src, walls=(), name=None):
    """Run the model script src (all but its last line, main()) and take its names: G, L, M, SC, box, cyl, tube,
    lathe, GROUND."""
    global HERE, WALLS, L, M, SC, box, cyl, tube, lathe, GROUND, rng
    src = Path(src)
    HERE, WALLS = src.parent, tuple(walls)
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    G.update({"__file__": str(src), "__name__": name or src.stem})
    text = src.read_text(encoding="utf8").rstrip()
    assert text.endswith("main()"), src
    exec(compile(text[:-len("main()")], str(src), "exec"), G)
    L, M, SC = G["L"], G["M"], G["SC"]
    box, cyl, tube, lathe = G["box"], G["cyl"], G["tube"], G["lathe"]
    GROUND = G["GROUND"]
    rng = random.Random(77 + L)


# ------------------------------------------------------------------------------------------------------------ helpers
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


def inside():
    """The dark inside of a broken building, seen through holes: near black, no shine (Flash's holes are black)."""
    m = bpy.data.materials.get("inside")
    if m is None:
        m = bpy.data.materials.new("inside")
        m.use_nodes = True
        bs = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Base Color"].default_value = (0.0, 0.0, 0.0, 1)
        bs.inputs["Roughness"].default_value = 1.0
        for k in ("Specular IOR Level", "Specular"):
            if k in bs.inputs:
                bs.inputs[k].default_value = 0.0
    return m


def fine_holes(o, patches, axes=("x", "y"), cuts=5, seed=0):
    """Tear ragged holes in sheet o (baked first, cut finer so the edge is not stepped): patches (u, v, half u,
    half v) in 0..1 across o's world bounding box along axes. Returns the baked object."""
    o = bake(o)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    mw = o.matrix_world
    ws = [mw @ v.co for v in bm.verts]
    lo = [min(getattr(p, a) for p in ws) for a in axes]
    hi = [max(getattr(p, a) for p in ws) for a in axes]
    dead, by = [], {}
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        u, v = ((getattr(c, a) - l) / max(1e-6, h - l) for a, l, h in zip(axes, lo, hi))
        for k, (pu, pv, wu, wv) in enumerate(patches):
            du, dv = (u - pu) / wu, (v - pv) / wv
            a = math.atan2(dv, du)
            if du * du + dv * dv < (1 + 0.2 * math.sin(5 * a + k + seed) + 0.1 * math.sin(13 * a + 2 * k)) ** 2:
                dead.append(f)
                by.setdefault(k, []).append(c)
                break
    for cs in by.values():                             # the edge round each hole burnt
        m = sum(cs, Vector()) / len(cs)
        burn(m, max((c - m).length for c in cs) + 0.4)
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
    xs, ys = [v.co.x for v in me.vertices], [v.co.y for v in me.vertices]
    burn((sum(xs) / len(xs), sum(ys) / len(ys), cut), 0.7, o)       # the broken end is scorched
    return o


def debris(at, n=6, spread=1.2, kinds=("plank", "stick", "bracket"), seed=0, mats=None):
    """Broken bits lying on the ground round at: short plank ends, snapped sticks, a loose metal bracket. mats: the
    material for each kind (default the Twig Snapper's: wood, twig, gold from level 6 / olive)."""
    r = random.Random(seed + 100 * L)
    mats = mats or {"plank": M["wood"]("X"), "stick": M["twig"]("X"), "bracket": M["gold"] if L >= 6 else M["olive"]}
    out = []
    for i in range(n):
        k = kinds[i % len(kinds)]
        p = Vector((at[0] + r.uniform(-spread, spread), at[1] + r.uniform(-spread, spread), GROUND))
        yaw = r.uniform(0, 180)
        if k == "plank":
            ln = r.uniform(0.5, 1.1)
            out.append(box("chip", (ln, 0.24, 0.09), p + Vector((0, 0, 0.045)), mats["plank"],
                           rot=(r.uniform(-6, 6), r.uniform(-8, 8), yaw), bevel=0.02, origin="center", jitter=0.02))
        elif k == "stick":
            a = math.radians(yaw)
            d = Vector((math.cos(a), math.sin(a), 0)) * r.uniform(0.5, 0.9)
            out.append(tube("stick", [p - d / 2 + Vector((0, 0, 0.05)), p + d / 2 + Vector((0, 0, 0.12))], 0.045,
                            mats["stick"], r_end=0.03))
        else:
            out.append(box("chipbracket", (0.3, 0.05, 0.3), p + Vector((0, 0, 0.03)), mats["bracket"],
                           rot=(80 + r.uniform(-10, 10), 0, yaw), bevel=0.02, origin="center"))
    return out


def soot(amount=0.35, scale=2.2):
    """Scorch: every material's colour darkened in soft patches (fixed noise in object space), as a battle left it."""
    for m in bpy.data.materials:
        if not m.use_nodes or m.name == "inside":
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


def burn(p, r=1.0, o=None):
    """A scorch spot round point p, radius r: world, or o's local point (it then follows o wherever o goes)."""
    BURN.append((o, Vector(p), r))


def scorch(strength=0.92):
    """Char round the breaks, as Flash's damaged pictures: every material's colour goes toward black-brown near the
    BURN spots (soft, blotchy edge), so the wood by a snapped plank or a torn hole is burnt and the rest is not."""
    bpy.context.view_layer.update()
    spots = []
    for o, p, r in BURN:
        try:
            spots.append((o.matrix_world @ p if o is not None else p, r))
        except ReferenceError:                      # its object went (killed or baked)
            continue
    if not spots:
        return
    gr = bpy.data.node_groups.new("scorch", "ShaderNodeTree")
    gr.interface.new_socket("Fac", in_out="OUTPUT", socket_type="NodeSocketFloat")
    nd, ln = gr.nodes, gr.links
    geo = nd.new("ShaderNodeNewGeometry")
    acc = None
    for p, r in spots:
        d = nd.new("ShaderNodeVectorMath")
        d.operation = "DISTANCE"
        d.inputs[1].default_value = p
        ln.new(geo.outputs["Position"], d.inputs[0])
        mr = nd.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = r * 0.4
        mr.inputs["From Max"].default_value = r
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.0
        ln.new(d.outputs["Value"], mr.inputs["Value"])
        if acc is None:
            acc = mr.outputs["Result"]
        else:
            mx = nd.new("ShaderNodeMath")
            mx.operation = "MAXIMUM"
            ln.new(acc, mx.inputs[0])
            ln.new(mr.outputs["Result"], mx.inputs[1])
            acc = mx.outputs[0]
    nz = nd.new("ShaderNodeTexNoise")                  # blotchy, not a clean ring
    nz.inputs["Scale"].default_value = 1.6
    nz.inputs["Detail"].default_value = 8.0
    ln.new(geo.outputs["Position"], nz.inputs["Vector"])
    ramp = nd.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.3
    ramp.inputs["From Max"].default_value = 0.62
    ramp.inputs["To Min"].default_value = 0.35
    ln.new(nz.outputs["Fac"], ramp.inputs["Value"])
    mul = nd.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.use_clamp = True
    ln.new(acc, mul.inputs[0])
    ln.new(ramp.outputs["Result"], mul.inputs[1])
    out = nd.new("NodeGroupOutput")
    ln.new(mul.outputs[0], out.inputs["Fac"])
    for m in bpy.data.materials:
        if not m.use_nodes or m.name == "inside":
            continue
        t = m.node_tree
        bs = next((n for n in t.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bs is None:
            continue
        inp = bs.inputs["Base Color"]
        gn = t.nodes.new("ShaderNodeGroup")
        gn.node_tree = gr
        f = t.nodes.new("ShaderNodeMath")
        f.operation = "MULTIPLY"
        f.inputs[1].default_value = strength
        t.links.new(gn.outputs["Fac"], f.inputs[0])
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        t.links.new(f.outputs[0], mix.inputs["Factor"])
        mix.inputs["B"].default_value = (0.035, 0.024, 0.018, 1)
        if inp.is_linked:
            t.links.new(inp.links[0].from_socket, mix.inputs["A"])
        else:
            mix.inputs["A"].default_value = inp.default_value
        t.links.new(mix.outputs["Result"], inp)


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


def along(name, a, b, size, mat, roll=0.0):
    """A box `size` (length, width, height) lying from a to b, turned roll degrees about its length."""
    a, b = Vector(a), Vector(b)
    o = box(name, ((b - a).length, size[1], size[2]), (a + b) / 2, mat, bevel=0.05, origin="center", jitter=0.015)
    o.rotation_euler = ((b - a).to_track_quat("X", "Z") @ Euler((math.radians(roll), 0, 0)).to_quaternion()).to_euler()
    return o


# ------------------------------------------------------------------------------------------------------------ render
def run(damaged, destroyed, soot_amount=(0.3, 0.45)):
    """Build and break (damaged) or heap (destroyed), then render as MODE says."""
    if STATE == "damaged":
        G["build"]()
        damaged()
    elif STATE == "destroyed":
        destroyed()
    soot(soot_amount[0] if STATE == "damaged" else soot_amount[1])
    scorch()
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
