"""bldg3d.py : what the 3D yard buildings share (buildings-3d-b6, 29 Oct 2026, for beta 6), on top of the towers' look
(../tower-3d/look3d.py: camera, light, painted materials, outlines; worn3d.py: the worn, hand-made finish).

    import bldg3d as B
    B.run("twig", build, HERE)        # build(level) -> (root empty, animate(phase) or None)

    blender -b --factory-startup -P <building>3d.py -- LEVEL still        render/L<level>.png        the idle building
    blender -b --factory-startup -P <building>3d.py -- LEVEL anim [N]    render/anim-L<level>/fNN.png  N frames (default
                                                                         24) of one loop of the producing state
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

import bpy
from mathutils import Matrix, Vector

TOWER = Path(__file__).resolve().parents[1] / "tower-3d"
sys.path.insert(0, str(TOWER))
import look3d as L  # noqa: E402
L.EL = 30.0
import square3d as Q  # noqa: E402
import worn3d as W  # noqa: E402

CANVAS = (720, 760, 360, 600)      # 4x canvas: w, h, and the ground middle's pixel
FRONT_FACE, SIDE_FACE = 90.0, 0.0  # outward bearings of the two faces we see: front-left (+X), front-right (+Y)


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "still"]
    return int(a[0]), a[1] if len(a) > 1 else "still", a[2:]


def run(name, build, here, canvas=None):
    level, mode, rest = args()
    out = here / "render"
    out.mkdir(parents=True, exist_ok=True)
    L.OUT = out
    root, animate = build(level)
    samples = int(os.environ.get("B3D_SAMPLES", 64 if mode == "still" else 32))
    cam = L.setup_render(samples=samples)
    w, h, gx, gy = canvas or CANVAS
    Q.frame(cam, w, h, gx, gy, (0, 0, 0))
    obs = L.objs_under(root)
    warm = L.LINE_COLS["warm"]
    if mode == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(here / f"{name}-L{level}.blend"))
    elif mode == "still":
        if animate:
            animate(0.0)
        L.shot(out / f"L{level}.png", obs, outer_col=warm)
    elif mode == "anim":
        n = int(rest[0]) if rest else 24
        d = out / f"anim-L{level}"
        d.mkdir(exist_ok=True)
        for k in range(n):
            animate(k / n)
            bpy.context.view_layer.update()
            L.shot(d / f"f{k:02d}.png", obs, outer_col=warm)
    print("DONE", name, level, mode)


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
