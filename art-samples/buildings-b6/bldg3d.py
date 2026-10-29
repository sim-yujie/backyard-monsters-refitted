"""bldg3d.py : what the 3D yard buildings share (buildings-3d-b6, 29 Oct 2026, for beta 6), on top of the towers' look
(../tower-3d/look3d.py: camera, light, painted materials, outlines; worn3d.py: the worn, hand-made finish).

    import bldg3d as B
    B.run("twig", build, HERE)        # build(level) -> (root empty, animate(phase) or None)

    blender -b --factory-startup -P <building>3d.py -- LEVEL still        render/L<level>.png        the idle building
    blender -b --factory-startup -P <building>3d.py -- LEVEL anim [N]    render/anim-L<level>/fNN.png  N frames (default
                                                                         36) of one loop of the producing state
    (pictures go in render/<name>/; with B3D_SCALE=2 in render/<name>/x2/ at twice the size, for the sample sheets)
    blender -b --factory-startup -P <building>3d.py -- LEVEL save        <name>-L<level>.blend

Same camera as the 3D towers: orthographic, 30 degrees up, from bearing 45, the towers' sun. Same scale: 75 px per unit
at @2x (render 4x = 150 px per unit). The footprint is the square with corners at bearings 45/135/225/315, half diagonal 1;
its sides are square to Blender's X and Y, so the face looking +X (bearing 90) is the front-left one on screen and the face
looking +Y (bearing 0) the front-right one. Heights are true (nothing is stretched toward the viewer).
"""
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

TOWER = Path(__file__).resolve().parents[1] / "tower-3d"
sys.path.insert(0, str(TOWER))
import look3d as L  # noqa: E402
L.EL = 30.0
import square3d as Q  # noqa: E402
import worn3d as W  # noqa: E402

CANVAS = (900, 760, 360, 600)      # 4x canvas: w, h, and the ground middle's pixel
FRONT_FACE, SIDE_FACE = 90.0, 0.0  # outward bearings of the two faces we see: front-left (+X), front-right (+Y)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "still"]
    return int(a[0]), a[1] if len(a) > 1 else "still", a[2:]


def run(name, build, here, canvas=None):
    level, mode, rest = args()
    out = here / "render" / name
    out.mkdir(parents=True, exist_ok=True)
    L.OUT = out
    root, animate = build(level)
    samples = int(os.environ.get("B3D_SAMPLES", 64 if mode == "still" else 32))
    cam = L.setup_render(samples=samples)
    k = float(os.environ.get("B3D_SCALE", 1))       # B3D_SCALE=2: the sample sheets' 8x pictures (the game's are 4x)
    if k != 1:
        out = out / f"x{k:g}"
        out.mkdir(exist_ok=True)
        L.OUT = out
        Q.PPU *= k
        L.OUTER *= k
    w, h, gx, gy = (round(v * k) for v in (canvas or CANVAS))
    Q.frame(cam, w, h, gx, gy, (0, 0, 0))
    obs = L.objs_under(root)
    warm = L.LINE_COLS["warm"]
    plane = ground_catcher()

    def both(path):
        """The building (path), then its shadow on the ground alone (path-shadow.png: black, the shade as alpha)."""
        L.shot(path, obs, outer_col=warm)
        L.shot(path.with_name(path.stem + "-shadow.png"), [plane], cut=obs, outer=0)

    if mode == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(here / f"{name}-L{level}.blend"))
    elif mode == "still":
        if animate:
            animate(0.0)
        both(out / f"L{level}.png")
    elif mode == "anim":
        n = int(rest[0]) if rest else 36
        d = out / f"anim-L{level}"
        d.mkdir(exist_ok=True)
        for k in range(n):
            animate(k / n)
            bpy.context.view_layer.update()
            both(d / f"f{k:02d}.png")
    print("DONE", name, level, mode)


def ground_catcher(size=8.0, dark=0.38):
    """A ground plane that draws only the building's cast shadow: black, its alpha `dark` where fully shaded."""
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    N, lk = m.node_tree.nodes, m.node_tree.links.new
    for n in list(N):
        N.remove(n)
    dif = N.new("ShaderNodeBsdfDiffuse")
    s2r = N.new("ShaderNodeShaderToRGB")
    bw = N.new("ShaderNodeRGBToBW")
    lit = math.sin(math.radians(L.SUN[1]))            # what the open ground reads in the sun
    mp = N.new("ShaderNodeMapRange")
    mp.inputs["From Min"].default_value, mp.inputs["From Max"].default_value = 0.0, lit * 0.78
    mp.inputs["To Min"].default_value, mp.inputs["To Max"].default_value = dark, 0.0
    em = N.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0, 0, 0, 1)
    tr = N.new("ShaderNodeBsdfTransparent")
    mix = N.new("ShaderNodeMixShader")
    out = N.new("ShaderNodeOutputMaterial")
    lk(dif.outputs[0], s2r.inputs[0])
    lk(s2r.outputs[0], bw.inputs[0])
    lk(bw.outputs[0], mp.inputs["Value"])
    lk(mp.outputs[0], mix.inputs[0])
    lk(tr.outputs[0], mix.inputs[1])
    lk(em.outputs[0], mix.inputs[2])
    lk(mix.outputs[0], out.inputs[0])
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        m.blend_method = 'BLEND'
    me.materials.append(m)
    return ob


# ------------------------------------------------------------------------------------------------------------ helpers
def spin(ob, axis, turns):
    """Set ob's rotation about its local axis ('X', 'Y' or 'Z') to `turns` whole turns, keeping its rest rotation."""
    if "rest" not in ob:
        ob["rest"] = list(ob.matrix_basis.col[0][:3]) + list(ob.matrix_basis.col[1][:3]) + list(ob.matrix_basis.col[2][:3])
        ob["rest_loc"] = list(ob.location)
        ob["rest_rot"] = list(ob.rotation_euler)
    r = ob["rest_rot"]
    rot = Matrix.Rotation(2 * math.pi * turns, 4, axis)
    base = Vector(ob["rest_loc"])
    from mathutils import Euler
    m = Matrix.Translation(base) @ Euler(r).to_matrix().to_4x4() @ rot
    ob.matrix_basis = m @ Matrix.Diagonal(tuple(ob.scale) + (1.0,))


def pivot(name, parent, loc, rot=(0, 0, 0)):
    """An empty to hang moving parts on."""
    e = L.empty(name, parent=parent, loc=loc)
    e.rotation_euler = rot
    return e


def mat_boards(name, n=7.0, light=(196, 136, 78), dark=(150, 96, 52), gap=(52, 30, 16), edge=(232, 186, 130), vertical=True,
               dirt=0.6, soot=0.0, gapw=0.06):
    """Planks on a box's walls (square to X and Y): upright boards (vertical) or courses (not), each its own shade,
    long grain, dark gaps."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    u = p.math("ADD", sep.outputs[0], sep.outputs[1]) if vertical else sep.outputs[2]
    u = p.math("MULTIPLY", u, n)
    u = p.math("ADD", u, p.math("MULTIPLY", p.math("SUBTRACT", p.noise(1.5, 2.0), 0.5), 0.12))
    idx, f = p.math("FLOOR", u), p.math("FRACT", u)
    base = p.ramp(W._white(p, idx), [(0.0, L.srgb(*dark)), (1.0, L.srgb(*light))])
    st = (0.08, 0.08, 1.0) if vertical else (1.0, 1.0, 0.08)
    grain = p.noise(9.0, 6.0, 0.7, stretch=(1 / st[0] * 0.08, 1 / st[1] * 0.08, st[2]) if vertical else (0.07, 0.07, 1.0))
    gr = p.ramp(grain, [(0.38, W._grey(0.8)), (0.52, W.WHITE), (0.62, W._grey(1.08)), (0.7, W._grey(0.86))])
    col = p.mix(base, gr, 1.0, 'MULTIPLY')
    d = p.math("MINIMUM", f, p.math("SUBTRACT", 1.0, f))
    g = p.ramp(d, [(gapw * 0.5, W.WHITE), (gapw, W.BLACK)])
    col = p.mix(col, L.srgb(*gap), g)
    knots = p.ramp(W._voronoi(p, 4.0), [(0.0, L.srgb(*[int(c * 0.55) for c in dark])), (0.05, W.WHITE)])
    col = p.mix(col, knots, 1.0, 'MULTIPLY')
    col = W.weather(p, col, edge=edge, edge_k=0.75, cavity=0.6, dirt=dirt, soot=soot)
    hgt = p.math("ADD", p.math("MULTIPLY", W._bw(p, g), -1.0), p.math("MULTIPLY", grain, 0.35))
    return p.finish(col, spec=0.12, spec_rough=0.5, bump=(hgt, 0.5), shade=L.WARM_SHADE)


def mat_shingles(name, rows=9.0, cols=12, light=(120, 84, 80), dark=(76, 50, 50), gap=(34, 20, 18), edge=(170, 130, 110),
                 dirt=0.15, moss=None):
    """Roof tiles round Z: courses up the roof, every other course offset by half a tile, each tile its own shade, dark
    joins, the lower edge of each course darker (it overhangs the next)."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    v = p.math("MULTIPLY", sep.outputs[2], rows)
    row = p.math("FLOOR", v)
    fv = p.math("FRACT", v)
    u = p.math("ADD", p.math("MULTIPLY", ang, cols / (2 * math.pi)), p.math("MULTIPLY", row, 0.5))
    u = p.math("ADD", u, p.math("MULTIPLY", p.math("SUBTRACT", p.noise(2.0, 2.0), 0.5), 0.1))
    col_i = p.math("FLOOR", u)
    fu = p.math("FRACT", u)
    rnd = W._white(p, p.math("ADD", col_i, p.math("MULTIPLY", row, 37.0)))
    base = p.ramp(rnd, [(0.0, L.srgb(*dark)), (1.0, L.srgb(*light))])
    du = p.math("MINIMUM", fu, p.math("SUBTRACT", 1.0, fu))
    joint = p.ramp(du, [(0.03, W.WHITE), (0.07, W.BLACK)])
    lip = p.ramp(fv, [(0.0, W._grey(0.55)), (0.22, W.WHITE)])
    col = p.mix(base, lip, 1.0, 'MULTIPLY')
    col = p.mix(col, L.srgb(*gap), joint)
    col = p.mix(col, p.ramp(p.noise(12.0, 5.0, 0.6), [(0.3, W._grey(0.85)), (0.7, W._grey(1.1))]), 1.0, 'MULTIPLY')
    if moss:
        col = p.mix(col, L.srgb(*moss), p.ramp(p.noise(3.0, 5.0, 0.62), [(0.55, W.BLACK), (0.66, W._grey(0.8))]))
    col = W.weather(p, col, edge=edge, edge_k=0.6, cavity=0.55, dirt=dirt, streaks=0.25)
    hgt = p.math("ADD", p.math("MULTIPLY", W._bw(p, joint), -0.6), p.math("MULTIPLY", fv, 0.8))
    return p.finish(col, spec=0.15, spec_rough=0.45, bump=(hgt, 0.6), shade=L.WARM_SHADE)


def mat_paint(name, col, edge=None, under=(110, 80, 60), chips=0.62, spec=0.35, spec_rough=0.3, dirt=0.4, streaks=0.2,
              cavity=0.6, soot=0.0, shade=None):
    """Old painted metal or wood: one colour, chipped to `under`, worn pale on ridges (edge), grime, dust."""
    p = L.Paint(name)
    c = p.mix(L.srgb(*col), p.ramp(p.noise(5.0, 4.0, 0.6), [(0.3, W._grey(0.86)), (0.7, W._grey(1.08))]), 1.0, 'MULTIPLY')
    chip = p.ramp(p.noise(6.0, 9.0, 0.66), [(chips, W.BLACK), (chips + 0.025, W.WHITE)])
    c = p.mix(c, L.srgb(*under), chip)
    c = W.weather(p, c, edge=edge or tuple(min(255, int(x * 1.35) + 20) for x in col), edge_k=0.7, cavity=cavity, dirt=dirt,
                  streaks=streaks, soot=soot)
    return p.finish(c, spec=spec, spec_rough=spec_rough, bump=(p.math("MULTIPLY", W._bw(p, chip), -1.0), 0.3),
                    shade=shade or L.WARM_SHADE)


def mat_goo(name, col=(84, 196, 40), deep=(24, 96, 16), hi=(200, 255, 140), spec=1.0):
    """Wet glossy goo/putty: deep colour in shade and in its folds, bright where it faces up, sharp wet highlights."""
    p = L.Paint(name)
    lw = p.N.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.4
    c = p.ramp(p.math("ADD", lw.outputs["Facing"], p.math("MULTIPLY", p.noise(4.0, 4.0), 0.4)),
               [(0.2, L.srgb(*col)), (0.85, L.srgb(*deep))])
    shade = [(0.0, (0.45, 0.5, 0.48, 1)), (0.2, (0.6, 0.66, 0.62, 1)), (0.5, (0.9, 0.95, 0.9, 1)), (1.0, (1.1, 1.12, 1.05, 1))]
    return p.finish(c, spec=spec, spec_rough=0.08, spec_col=L.srgb(*hi), shade=shade, ao_k=0.5)


def outline(ob, kind="warm", k=1.0):
    W.finish(ob) if "wear" not in ob.data.color_attributes else None
    L.add_outline(ob, L.line(kind), L.LINE * k)
    return ob


def part(name, bm, mat, parent, line="warm", k=1.0, sharp=40):
    """A finished mesh (the wear attribute) with its outline shell. mat: one material or a list."""
    ob = W.obj(name, bm, mat if isinstance(mat, list) else [mat], parent=parent, sharp=sharp)
    if line:
        L.add_outline(ob, L.line(line), L.LINE * k)
    return ob


# ------------------------------------------------------------------------------------------------------------- shapes
def box(bm, x0, x1, y0, y1, z0, z1, bevel=0.03, mat=0, taper=1.0):
    """A rounded box between the given bounds (square to X and Y)."""
    L.rbox(bm, (x1 - x0, y1 - y0, z1 - z0), Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, z0)), bevel=bevel, segs=2,
           taper=taper, mat=mat)


def face_m(axis, s, u, z, out=0.0):
    """A frame on a box side: axis 'X' (the +X face, front-left on screen) or 'Y' (the +Y face, front-right) at distance s
    from the middle; local x along the face toward the screen's LEFT (so the frame stays right-handed), y out of it, z up."""
    if axis == 'X':
        t, n = Vector((0, -1, 0)), Vector((1, 0, 0))
    else:
        t, n = Vector((1, 0, 0)), Vector((0, 1, 0))
    c = n * (s + out) + t * u + Vector((0, 0, z))
    return Matrix.Translation(c) @ Matrix((t, n, Vector((0, 0, 1)))).transposed().to_4x4()


def prism(bm, pts2d, depth, m, mat=0):
    """A flat shape (points in its local x/z plane) given a depth along local y (0 to depth), transformed by m."""
    sub = bmesh.new()
    lo = [sub.verts.new((x, 0.0, z)) for x, z in pts2d]
    hi = [sub.verts.new((x, depth, z)) for x, z in pts2d]
    sub.faces.new(lo)
    sub.faces.new(list(reversed(hi)))
    n = len(pts2d)
    for i in range(n):
        sub.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    L.add_mesh(bm, sub, m, mat)


def arch_pts(w, h, n=12):
    """An arched doorway's outline, counter-clockwise: w wide, h tall to the top of its round head, base on z=0."""
    r = w / 2
    pts = [(-r, 0.0), (r, 0.0)]
    for i in range(n + 1):
        a = math.pi * i / n
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    return pts


def toothed(bm, r_in, r_out, teeth, depth, m, mat=0, saw=True):
    """A toothed ring's outline (saw teeth leaning one way, or square gear teeth) with a depth along local z, by m."""
    pts = []
    da = 2 * math.pi / teeth
    for k in range(teeth):
        a0 = da * k
        if saw:
            pts += [(r_in, a0), (r_out, a0 + da * 0.85)]
        else:
            pts += [(r_in, a0 + da * 0.15), (r_out, a0 + da * 0.3), (r_out, a0 + da * 0.7), (r_in, a0 + da * 0.85)]
    sub = bmesh.new()
    lo = [sub.verts.new((r * math.cos(a), r * math.sin(a), -depth / 2)) for r, a in pts]
    hi = [sub.verts.new((r * math.cos(a), r * math.sin(a), depth / 2)) for r, a in pts]
    sub.faces.new(list(reversed(lo)))
    sub.faces.new(hi)
    n = len(pts)
    for i in range(n):
        sub.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    L.add_mesh(bm, sub, m, mat)


def disc(bm, r, depth, m, segs=40, mat=0, r2=None):
    """A cylinder along local z, centred, by m."""
    sub = bmesh.new()
    bmesh.ops.create_cone(sub, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    L.add_mesh(bm, sub, m, mat)


def along(axis_vec):
    """A rotation taking local z to axis_vec."""
    return Vector((0, 0, 1)).rotation_difference(Vector(axis_vec).normalized()).to_matrix().to_4x4()


def pagoda(bm, h0, h1, z0, z1, n=10, side=8, sag=0.35, lift=0.12, mat=0, thick=0.04):
    """A square roof (square to X and Y) from half side h0 at the eaves (z0) to h1 at the top (z1): its sides sag
    (concave), its corners turn up at the eaves by `lift`. A thin underside closes it. Returns the rows of points."""
    cs = Vector((1, 1, 0)), Vector((-1, 1, 0)), Vector((-1, -1, 0)), Vector((1, -1, 0))
    rows = []
    for i in range(n + 1):
        t = i / n
        h = h0 + (h1 - h0) * (1 - (1 - t) ** (1 + sag * 2))      # wide low, pulled in fast: concave, flared
        z = z0 + (z1 - z0) * t
        ring = []
        for k in range(4):
            a, b = cs[k], cs[(k + 1) % 4]
            for j in range(side):
                f = j / side
                p = a.lerp(b, f)
                corner = max(0.0, 1 - 2 * min(f, 1 - f)) ** 3        # 1 at a corner, 0 mid side
                ring.append(Vector((p.x * h, p.y * h, z + lift * corner * (1 - t) ** 2)))
        rows.append(ring)
    m = len(rows[0])
    sub = bmesh.new()
    vs = [[sub.verts.new(p) for p in r] for r in rows]
    under = [sub.verts.new(p - Vector((0, 0, thick))) for p in rows[0]]
    for i in range(n):
        for j in range(m):
            sub.faces.new((vs[i][j], vs[i][(j + 1) % m], vs[i + 1][(j + 1) % m], vs[i + 1][j]))
    for j in range(m):
        sub.faces.new((under[j], under[(j + 1) % m], vs[0][(j + 1) % m], vs[0][j]))
    sub.faces.new(list(reversed(under)))
    top = sub.verts.new((0, 0, z1 + 0.01))
    for j in range(m):
        sub.faces.new((vs[n][j], vs[n][(j + 1) % m], top))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    L.add_mesh(bm, sub, Matrix(), mat)
    return rows


def claw(bm, base, heading, r=0.07, toes=3, spread=50, length=0.26, mat=0):
    """A bird's foot: toes curling down onto the ground from base, fanned round the outward bearing `heading`."""
    for k in range(toes):
        b = heading + spread * (k - (toes - 1) / 2)
        d = L.bear(b)
        p0 = Vector(base)
        p3 = Vector((p0.x + d.x * length, p0.y + d.y * length, 0.02))
        pts = L.bezier(p0, p0 + d * length * 0.35 + Vector((0, 0, 0.03)), p3 + Vector((0, 0, 0.06)) - d * 0.06, p3, 10)
        L.tube(bm, pts, [r * (1.0 - 0.55 * i / 9) for i in range(10)], sides=8, mat=mat)
        tip = L.bezier(p3 - d * 0.02, p3 + d * 0.03, p3 + d * 0.06, p3 + d * 0.08 - Vector((0, 0, 0.015)), 5)
        L.tube(bm, tip, [r * 0.42, r * 0.34, r * 0.24, r * 0.14, r * 0.03], sides=6, mat=mat)


def twigs(bm, uv, centre, n, r, length, spread=0.5, seed=0.0, mat=0, rise=1.0):
    """A bundle of twigs: n stakes from round `centre`, leaning out, about `length` long."""
    import random
    rnd = random.Random(seed)
    c = Vector(centre)
    for k in range(n):
        a = 2 * math.pi * (k + rnd.random() * 0.6) / n
        out = Vector((math.cos(a), math.sin(a), 0))
        d = (out * spread * (0.5 + rnd.random() * 0.6) + Vector((0, 0, rise))).normalized()
        base = c + out * r * 1.2
        W.stake(bm, uv, base, base + d * length * (0.7 + 0.5 * rnd.random()), r * (0.8 + 0.5 * rnd.random()),
                sides=6, twist=rnd.random(), mat=mat, bulge=0.05)


def mover(name, parent, loc, axis=(0, 0, 1)):
    """A pivot for a moving part: its local z is `axis` (in the parent's space). Build the part's meshes in the pivot's
    own space with parent=pivot (their outline shells follow); animate with spin(pivot, 'Z', turns) or slide()."""
    e = L.empty(name, parent=parent, loc=loc)
    e.rotation_euler = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_euler()
    return e


def slide(ob, d):
    """Move ob by d (a vector, in its parent's space) from where it was built."""
    if "rest_loc" not in ob:
        ob["rest_loc"] = list(ob.location)
    ob.location = Vector(ob["rest_loc"]) + Vector(d)
