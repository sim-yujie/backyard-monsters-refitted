"""tesla3d.py : the Tesla Tower, tiers 1-3, as a 3D model in the game's camera (towers-3d-export, 29 Oct 2026), modelled on
the Flash tower (server/public/assets/buildings/lightningtower/top.3.png) and its painted tiers (top.tN@2x.webp), in the
worn, detailed look of the approved 3D towers (../tower-3d/worn3d.py).

  blender -b --factory-startup -P tesla3d.py -- T body | film [N] | film-game | film-at A [B ...] | save

(see ../tower-3d/static3d.py: the Tesla does not turn, so it is one picture). The tower: a stone foot with a radiator of
fins on its right, a square block (tier 1 worn tan brass, tier 2 gold, tier 3 black diamond with gold trim), a red and
white striped post at each corner (tier 3 black and gold) held by clamps bolted to the block, a film strip up the left
face (sprocket holes, lit frames) over a roller on the cap, riveted angle strips down the corners, one
battery per tier on the right face with brass terminals and a blue and a red wire, a copper coil out of the top and the
big steel mushroom dome (tier 3 black) with blue sparks round its rim. Each tier stands taller than the last.

`film N` renders N pictures (render/tN/film-00.png ...) of the film rolling up the face through one frame; played in a
loop they are the busy tower's film, as the Flash tower's anim.3.png (owner, 29 Oct: "it rolls around like film").
"""
import math
import os
import sys
from pathlib import Path

import bmesh
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
L.EL = float(os.environ.get("TESLA_EL", 30.0))
import square3d as Q  # noqa: E402
import static3d as S  # noqa: E402
import worn3d as W  # noqa: E402
from look3d import add_outline, srgb  # noqa: E402

L.METALS.update(pblack=((8, 6, 10), (34, 30, 38), (80, 76, 96), (0.8, 0.86, 1.0, 1)))   # the Railgun's polished black
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
H = {1: 1.6, 2: 2.25, 3: 2.85}[TIER]       # the block's top
COIL = {1: 0.6, 2: 0.66, 3: 0.72}[TIER]    # the coil's height above the block
DOME_R = 0.56
P = 0.5                                    # the corner posts' centres, from the middle along x and y
PR = 0.085                                 # their radius
HALF = 0.4                                # the block's half side
BASE = 0.2                                 # the foot's height
BAT_Z = [BASE + (H - BASE) * (k + 0.5) / TIER - 0.22 for k in range(TIER)]   # each battery's foot, one per storey
BANDS = [BASE + (H - BASE) * k / TIER for k in range(1, TIER)]               # the bands between storeys


SPROCKET = 0.045                           # the film's sprocket holes' pitch, along the strip
FRAME = 4 * SPROCKET                       # its frames' pitch: the picture repeats when the film has moved this far


def mat_film(name, film, edge, window, lit, bolt, wear=0.5):
    """The film strip, read off its UV (u across, v along it in model units): a sprocket hole every SPROCKET down each
    edge, a lit frame every FRAME between them with a lightning bolt in it, scratched and grimy. The value node FILM
    slides the picture along the strip: raise it and the film rolls up the tower and over the top."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["UV"], sep.inputs[0])
    off = p.N.new("ShaderNodeValue")
    off.name = "FILM"
    off.outputs[0].default_value = 0.0
    u = sep.outputs[0]
    v = p.math("SUBTRACT", sep.outputs[1], off.outputs[0])
    du = p.math("ABSOLUTE", p.math("SUBTRACT", u, 0.5))                       # 0 down the middle, 0.5 at the edges
    sv = p.math("ABSOLUTE", p.math("SUBTRACT", p.math("FRACT", p.math("DIVIDE", v, SPROCKET)), 0.5))
    hole = p.math("MULTIPLY", p.math("LESS_THAN", sv, 0.22),
                  p.math("LESS_THAN", p.math("ABSOLUTE", p.math("SUBTRACT", du, 0.41)), 0.045))
    fv = p.math("SUBTRACT", p.math("FRACT", p.math("DIVIDE", v, FRAME)), 0.5)  # -0.5..0.5 through each frame
    afv = p.math("ABSOLUTE", fv)
    win = p.math("MULTIPLY", p.math("LESS_THAN", du, 0.3), p.math("LESS_THAN", afv, 0.41))
    # the bolt: a zigzag down the frame's middle, dark on the lit frame
    zig = p.math("SUBTRACT", p.math("MULTIPLY", p.math("ABSOLUTE", p.math("SUBTRACT", p.math("FRACT",
              p.math("MULTIPLY", fv, 2.6)), 0.5)), 0.3), 0.075)
    bolt_k = p.math("MULTIPLY", p.math("LESS_THAN", p.math("ABSOLUTE", p.math("SUBTRACT", p.math("SUBTRACT", u, 0.5), zig)),
                                       0.035), p.math("LESS_THAN", afv, 0.33))
    glow = p.math("SUBTRACT", 1.0, p.math("MULTIPLY", afv, 1.4))               # each frame brightest in its middle
    wcol = p.mix(srgb(*window), srgb(*lit), glow)
    wcol = p.mix(wcol, srgb(*bolt), p.math("MULTIPLY", bolt_k, win))
    col = p.mix(srgb(*film), wcol, win)
    col = p.mix(col, srgb(*edge), p.math("GREATER_THAN", du, 0.47))           # the strip's raised rims
    col = p.mix(col, srgb(14, 10, 8), hole)
    scratch = p.ramp(p.noise(40.0, 2.0, 0.5, stretch=(1.0, 1.0, 0.08)), [(0.6, W.BLACK), (0.66, W.WHITE)])
    col = p.mix(col, srgb(*edge), p.math("MULTIPLY", W._bw(p, scratch), 0.35 * wear))
    col = W.weather(p, col, edge=edge, edge_k=0.3, cavity=0.5, dirt=0.25 * wear, dirt_top=0.2, streaks=0.15 * wear,
                    vary=0.08)
    emit = p.mix(srgb(0, 0, 0), srgb(*lit), p.math("MULTIPLY", p.math("MULTIPLY", win, glow), 0.3))
    return p.finish(col, spec=0.5, spec_rough=0.25, emit=emit, shade=L.WARM_SHADE)


def materials():
    gold, black = TIER == 2, TIER == 3
    iron = W.mat_iron
    steel = dict(base=(170, 168, 166), dark=(92, 90, 92), rust=(140, 88, 50), edge=(232, 230, 226), rust_k=0.3, spec=0.35)
    M = dict(
        brass=iron("brass", base=(206, 156, 64), dark=(124, 82, 26), rust=(110, 92, 44), edge=(250, 222, 150), rust_k=0.35,
                   spec=0.35),
        copper=iron("copper", base=(214, 130, 74), dark=(132, 66, 30), rust=(84, 110, 90), edge=(252, 204, 160),
                    rust_k=0.35, dents=0.5, spec=0.35),
        steel=iron("steel", **steel),
        wire_b=L.mat_flat("wire_b", (40, 96, 220), spec=0.6),
        wire_r=L.mat_flat("wire_r", (210, 34, 30), spec=0.6),
        hole=L.mat_flat("hole", (20, 16, 14), spec=0.0),
        spark=L.mat_glass_lamp("spark", core=(236, 250, 255), mid=(90, 190, 255), rim=(30, 90, 230)),
        spark_halo=L.mat_halo("spark_halo", (70, 170, 255), strength=0.7),
        gold=L.mat_metal("gold", spec=1.0),          # the approved towers' polished gold (owner, 28 Oct)
    )
    if black:
        M.update(body=L.mat_metal("body", "pblack", spec=0.9, polish=0.5), foot=L.mat_metal("foot", "pblack", spec=0.9, polish=0.5),
                 trim=M["gold"], strap=L.mat_metal("strap", "pblack", spec=0.9, polish=0.5),
                 posts=W.mat_worn_diag("posts", (34, 30, 34), (252, 198, 40), n=1, lean=7.0, under=(60, 50, 40),
                                       edge=(250, 220, 140), soot=0.2, dirt=0.4, chips=0.7),
                 cap=M["gold"], battery=W.mat_forged("battery"),
                 dome=L.mat_metal("dome", "pblack", spec=1.0, polish=0.6))
    else:
        M.update(body=M["gold"] if gold else iron("body", base=(196, 160, 104), dark=(124, 94, 56), rust=(132, 86, 42),
                                                  edge=(238, 214, 168), rust_k=0.35, dents=0.6, spec=0.2),
                 foot=iron("foot", base=(132, 128, 122), dark=(72, 70, 68), rust=(120, 96, 70), edge=(204, 200, 192),
                           rust_k=0.25, dents=0.3) if not gold else W.mat_forged("foot"),
                 trim=M["gold"] if gold else M["brass"], strap=M["gold"] if gold else M["copper"],
                 posts=W.mat_worn_diag("posts", (198, 28, 24), (236, 228, 214), n=1, lean=7.0, soot=0.2, dirt=0.4,
                                       chips=0.66),
                 cap=iron("cap", base=(226, 40, 30), dark=(150, 22, 16), rust=(110, 50, 32), edge=(252, 150, 130),
                          rust_k=0.2, spec=0.3),
                 battery=M["steel"],
                 dome=L.mat_metal("dome", "steel", spec=1.0))     # the approved towers' polished steel
    M["film"] = mat_film("film", *{
        1: ((96, 58, 26), (196, 150, 84), (214, 150, 64), (255, 226, 150), (110, 62, 24), 1.0),
        2: ((122, 78, 14), (250, 214, 110), (236, 178, 50), (255, 240, 170), (130, 82, 10), 0.4),
        3: ((24, 20, 24), (232, 180, 60), (64, 48, 34), (210, 150, 50), (20, 16, 14), 0.3)}[TIER])
    return M


def box(name, size, at, mat, parent, LN, bevel=0.03, line="warm", lw=None, rot=None):
    bm = bmesh.new()
    m = Matrix.Translation(at) @ (rot or Matrix())
    L.rbox(bm, size, m, bevel=bevel, segs=2)
    ob = W.obj(name, S.fill(bm), [mat], parent=parent, sharp=35)
    add_outline(ob, LN[line], lw)
    return ob


def bolts_on(bm, pts, n, r=0.03):
    W.bolts(bm, pts, [n] * len(pts), r=r, washer=False)


def build():
    L.clear_scene()
    M = materials()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = L.empty("BODY")

    # ---- the foot: two stone steps, a radiator of fins on the right face (+Y), like the Flash tower's grey fins
    box("foot", (1.22, 1.22, 0.11), (0, 0, 0), M["foot"], body, LN, bevel=0.03)
    box("foot2", (1.08, 1.08, 0.1), (0, 0, 0.1), M["foot"], body, LN, bevel=0.03)
    bm = bmesh.new()
    for i in range(6):
        x = -0.32 + 0.12 * i
        L.rbox(bm, (0.045, 0.16, 0.3 - 0.02 * (i % 2)), Matrix.Translation((x, HALF + 0.06, BASE - 0.02)), bevel=0.012, segs=2)
    add_outline(W.obj("fins", bm, [M["steel"] if TIER < 3 else M["battery"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.7)

    # ---- the block, with a band round it between battery levels (tiers 2 and 3) and a cap slab on top
    box("block", (2 * HALF, 2 * HALF, H - BASE), (0, 0, BASE), M["body"], body, LN, bevel=0.05)
    for k, z in enumerate(BANDS):
        box(f"band{k}", (2 * HALF + 0.05, 2 * HALF + 0.05, 0.07), (0, 0, z), M["trim"], body, LN, bevel=0.02, line="cool",
            lw=L.LINE * 0.7)
    box("cap", (2 * HALF + 0.08, 2 * HALF + 0.08, 0.07), (0, 0, H - 0.01), M["trim"], body, LN, bevel=0.025, line="cool")
    top = H + 0.06
    bm = bmesh.new()
    pts =[Vector((sx * (HALF - 0.02), sy * 0.2, top + 0.002)) for sx in (-1, 1) for sy in (-1, 1)] + \
          [Vector((sy * 0.2, sx * (HALF - 0.02), top + 0.002)) for sx in (-1, 1) for sy in (-1, 1)]
    bolts_on(bm, pts, (0, 0, 1), r=0.028)
    add_outline(W.obj("capbolts", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)

    # ---- the film strip up the left face (+X): out of a bolted housing on the foot, between riveted guide rails, over a
    # sprocket roller on the cap and down into the tower; its picture rolls upward when the tower is busy (the Flash
    # tower's anim.3.png: the strip's clips climb the face and go over the top), see `film` below
    sw, yc = 0.34, -0.06
    fx = HALF + 0.075                     # the strip's face
    rr = 0.1                              # the roller's radius, to the strip
    zt = top - 0.03                       # the roller's axle
    zb = BASE + 0.1                       # the strip's foot, in the housing
    path = [(fx, zb + (zt - zb) * i / 12) for i in range(13)]
    path += [(fx - rr + rr * math.cos(a), zt + rr * math.sin(a)) for a in (math.pi * i / 10 for i in range(1, 11))]
    path += [(fx - 2 * rr, zt - 0.08)]
    film = bmesh.new()
    uv = film.loops.layers.uv.new("UVMap")
    ys = [yc - sw / 2 + sw * j / 4 for j in range(5)]
    vs = [0.0]
    for (x0, z0), (x1, z1) in zip(path, path[1:]):
        vs.append(vs[-1] + math.hypot(x1 - x0, z1 - z0))
    rows = [[film.verts.new((x, y, z)) for y in ys] for x, z in path]
    for i in range(len(path) - 1):
        for j in range(4):
            f = film.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            for lp, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                lp[uv].uv = (jj / 4, vs[ii])
    bmesh.ops.solidify(film, geom=list(film.faces), thickness=-0.014)
    add_outline(W.obj("film", film, [M["film"]], parent=body, sharp=30), LN["warm"], L.LINE * 0.7)
    # the roller: a drum under the strip, a toothed sprocket wheel at each end, an axle in a bolted bearing plate each side
    bm = bmesh.new()
    roll = Matrix.Translation((fx - rr, yc, zt)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    Q.cyl(bm, rr - 0.012, sw - 0.02, roll, segs=32)
    for s_ in (-1, 1):
        m = Matrix.Translation((fx - rr, yc + s_ * (sw / 2 + 0.025), zt)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
        Q.cyl(bm, rr + 0.012, 0.04, m, segs=32)
        for k in range(12):
            a = 2 * math.pi * k / 12
            c = Vector((fx - rr + (rr + 0.022) * math.cos(a), yc + s_ * (sw / 2 + 0.025), zt + (rr + 0.022) * math.sin(a)))
            L.rbox(bm, (0.03, 0.036, 0.026), Matrix.Translation(c) @ Matrix.Rotation(math.pi / 2 - a, 4, "Y") @
                   Matrix.Translation((0, 0, -0.013)), bevel=0.006, segs=1)
    add_outline(W.obj("roller", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    for s_ in (-1, 1):
        y = yc + s_ * (sw / 2 + 0.07)
        box(f"bearing{s_}", (0.3, 0.04, 0.2), (fx - rr - 0.02, y, zt - 0.12), M["strap"], body, LN, bevel=0.015, lw=L.LINE * 0.7)
        bm = bmesh.new()
        Q.cyl(bm, 0.045, 0.03, Matrix.Translation((fx - rr, y + s_ * 0.03, zt)) @ Matrix.Rotation(math.pi / 2, 4, 'X'), segs=6)
        bolts_on(bm, [Vector((fx - rr - 0.11, y + s_ * 0.022, zt - 0.06)), Vector((fx - rr + 0.07, y + s_ * 0.022, zt - 0.06))],
                 (0, s_, 0), r=0.022)
        add_outline(W.obj(f"axle{s_}", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)
    # the guide rails either side of the strip, riveted, clipped to each band; the housing it comes out of at the foot
    bm = bmesh.new()
    rails = []
    for s_ in (-1, 1):
        y = yc + s_ * (sw / 2 + 0.022)
        rails.append(y)
        L.rbox(bm, (0.06, 0.036, zt - zb - 0.06), Matrix.Translation((fx - 0.03, y, zb)), bevel=0.01, segs=2)
        for z in BANDS + [0.5 * (zb + zt)] * (TIER == 1):
            L.rbox(bm, (0.1, 0.06, 0.07), Matrix.Translation((fx - 0.04, y + s_ * 0.008, z)), bevel=0.012, segs=2)
    add_outline(W.obj("rails", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    n = int((zt - zb - 0.1) / 0.13)
    W.rivets(bm, [Vector((fx + 0.002, y, zb + 0.08 + (zt - zb - 0.16) * i / max(n - 1, 1))) for y in rails for i in range(n)],
             [(1, 0, 0)] * (2 * n), r=0.016)
    W.obj("railrivets", bm, [M["trim"]], parent=body)
    box("housing", (0.16, sw + 0.16, 0.2), (fx - 0.04, yc, BASE - 0.06), M["strap"], body, LN, bevel=0.025)
    box("housinglip", (0.19, sw + 0.2, 0.045), (fx - 0.035, yc, BASE + 0.12), M["trim"], body, LN, bevel=0.015, line="cool",
        lw=L.LINE * 0.7)
    bm = bmesh.new()
    bolts_on(bm, [Vector((fx + 0.042, yc + s_ * (sw / 2 + 0.04), BASE + 0.03)) for s_ in (-1, 1)], (1, 0, 0), r=0.026)
    add_outline(W.obj("housingbolts", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)

    # ---- riveted angle strips down the block's corners, rivets round the cap and each band (the painted tower's trims)
    bm, riv = bmesh.new(), bmesh.new()
    for sx, sy in ((1, 1), (-1, 1), (1, -1)):
        L.rbox(bm, (0.1, 0.1, H - BASE - 0.04), Matrix.Translation((sx * (HALF - 0.035), sy * (HALF - 0.035), BASE + 0.02)),
               bevel=0.014, segs=2)
        n = max(3, round((H - BASE) / 0.16))
        for i in range(n):
            z = BASE + 0.1 + (H - BASE - 0.22) * i / (n - 1)
            W.rivets(riv, [Vector((sx * (HALF + 0.016), sy * (HALF - 0.035), z)), Vector((sx * (HALF - 0.035), sy * (HALF + 0.016), z))],
                     [(sx, 0, 0), (0, sy, 0)], r=0.014)
    add_outline(W.obj("corners", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    for z in [H + 0.025] + [b + 0.035 for b in BANDS]:
        out = HALF + (0.04 if z > H else 0.025) + 0.002
        pts = [Vector((t, out, z)) for t in (-0.3, -0.15, 0.0, 0.15, 0.3)] + [Vector((out, t, z)) for t in (0.24, 0.3)]
        W.rivets(riv, pts, [(0, 1, 0)] * 5 + [(1, 0, 0)] * 2, r=0.013)
    W.obj("rivets", riv, [M["trim"]], parent=body)

    # ---- the batteries on the right face (+Y): a steel box, two brass terminals stacked, wires looping off them
    wires_b, wires_r, terms = bmesh.new(), bmesh.new(), bmesh.new()
    for k, z0 in enumerate(BAT_Z):
        box(f"battery{k}", (0.48, 0.17, 0.44), (-0.1, HALF + 0.065, z0), M["battery"], body, LN, bevel=0.03, line="cool")
        bm = bmesh.new()
        for x in (-0.29, -0.25, 0.09, 0.13):
            L.rbox(bm, (0.022, 0.03, 0.36), Matrix.Translation((x, HALF + 0.15, z0 + 0.04)), bevel=0.008, segs=1)
        W.obj(f"batribs{k}", bm, [M["battery"]], parent=body, sharp=35)
        box(f"batlid{k}", (0.52, 0.2, 0.05), (-0.1, HALF + 0.075, z0 + 0.44), M["trim"], body, LN, bevel=0.015, line="cool",
            lw=L.LINE * 0.7)
        for j, z in enumerate((z0 + 0.31, z0 + 0.13)):
            c = Vector((-0.04, HALF + 0.15, z))
            Q.cyl(terms, 0.055, 0.04, Matrix.Translation(c + Vector((0, 0.02, 0))) @ Matrix.Rotation(-math.pi / 2, 4, 'X'),
                  segs=16)
            Q.cyl(terms, 0.035, 0.05, Matrix.Translation(c + Vector((0, 0.06, 0))) @ Matrix.Rotation(-math.pi / 2, 4, 'X'),
                  segs=6)
            # a wire from the terminal, looping out and back into the block near the right post
            a = c + Vector((0, 0.09, 0))
            end = Vector((-(P - 0.12), HALF + 0.01, z + (0.12 if j == 0 else -0.06)))
            pts = L.bezier(a, a + Vector((-0.05, 0.18, 0.02)), end + Vector((0.0, 0.2, 0.04 if j == 0 else -0.04)), end, 14)
            L.tube(wires_b if j == 0 else wires_r, pts, [0.026] * len(pts), sides=8)
        bm = bmesh.new()
        bolts_on(bm, [Vector((x, HALF + 0.152, z0 + 0.06)) for x in (-0.3, 0.1)], (0, 1, 0), r=0.024)
        W.obj(f"batbolts{k}", bm, [M["trim"]], parent=body, sharp=35)
    add_outline(W.obj("terminals", terms, [M["brass"] if TIER < 3 else M["gold"]], parent=body, sharp=35), LN["warm"],
                L.LINE * 0.6)
    add_outline(L.obj_from_bm("wire_blue", wires_b, [M["wire_b"]], parent=body), LN["cool"], L.LINE * 0.6)
    add_outline(L.obj_from_bm("wire_red", wires_r, [M["wire_r"]], parent=body), LN["cool"], L.LINE * 0.6)

    # ---- the corner posts: striped, a cap on each, clamps holding them to the block
    ptop = H + 0.14
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        post = W.lathe(f"post{k}", [[(PR, 0.0), (PR, ptop)], [(PR, ptop), (0.0, ptop)]], [M["posts"]], bev=0.012, n=32,
                       parent=body, sharp=35)
        post.location = (sx * P, sy * P, 0.02)
        add_outline(post, LN["warm"])
        cap = W.lathe(f"postcap{k}", [[(PR + 0.02, 0.0), (PR + 0.025, 0.07), (PR + 0.01, 0.1), (0.06, 0.13), (0.0, 0.14)]],
                      [M["cap"]], bev=0.01, n=32, parent=body, sharp=35)
        cap.location = (sx * P, sy * P, ptop - 0.005)
        add_outline(cap, LN["warm"])
        clamps = [0.42, H - 0.12] + [z + 0.035 for z in BANDS]
        cl = W.lathe(f"clamps{k}", [L.band(PR - 0.01, PR + 0.03, z - 0.035, z + 0.035, bev=0.01) for z in clamps],
                     [M["trim"]], bev=0, n=32, parent=body, sharp=35)
        cl.location = post.location
        add_outline(cl, LN["cool"], L.LINE * 0.6)
        # a bolted arm from each clamp to the block's corner, as the painted tower's post brackets
        bm = bmesh.new()
        rot = Matrix.Rotation(math.atan2(sy, sx), 4, 'Z')
        for z in clamps:
            L.rbox(bm, (0.2, 0.07, 0.05), Matrix.Translation((sx * (P + HALF) / 2, sy * (P + HALF) / 2, z - 0.025)) @ rot,
                   bevel=0.012, segs=2)
            W.bolts(bm, [Vector((sx * (HALF + 0.035), sy * (HALF + 0.035), z + 0.026))], [(0, 0, 1)], r=0.022, washer=False)
        add_outline(W.obj(f"arms{k}", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
        # a flared boot under each post, as the Flash tower's tan corner feet
        boot = W.lathe(f"boot{k}", [[(0.17, 0.0), (0.165, 0.06), (0.125, 0.16), (0.11, 0.3), (0.105, 0.32)],
                                    [(0.105, 0.32), (0.0, 0.32)]], [M["body"]], bev=0.012, n=40, parent=body, sharp=35)
        boot.location = post.location
        add_outline(boot, LN["warm"])

    # ---- the coil out of a collar in the cap, a plate under the dome
    col = W.lathe("collar", [[(0.3, top - 0.01), (0.3, top + 0.06), (0.27, top + 0.08)], [(0.27, top + 0.08), (0.21, top + 0.08),
                                                                                         (0.2, top + 0.04)]],
                  [M["trim"]], parent=body, sharp=35)
    add_outline(col, LN["cool"])
    L.lathe("hole", [[(0.205, top + 0.045), (0.0, top + 0.045)]], [M["hole"]], parent=body)
    z, prof = top + 0.04, [(0.12, top + 0.04)]
    zc = top + 0.05 + COIL
    while z < zc - 0.05:
        prof += [(0.14, z + 0.006), (0.165, z + 0.016), (0.165, z + 0.03), (0.14, z + 0.04)]
        z += 0.042
    prof += [(0.12, z), (0.12, zc)]
    coil = W.lathe("coil", [prof, [(0.12, zc), (0.0, zc)]], [M["copper"]], bev=0.006, n=48, parent=body, sharp=50)
    add_outline(coil, LN["warm"], L.LINE * 0.7)
    plate = W.lathe("domeplate", [L.band(0.0, 0.2, zc - 0.01, zc + 0.05, bev=0.012)], [M["trim"]], bev=0, n=48, parent=body,
                    sharp=35)
    add_outline(plate, LN["cool"], L.LINE * 0.7)
    # a blue wire from the top battery's terminal up over the cap into the dome plate, a red one round the coil
    bm = bmesh.new()
    pts = L.bezier(Vector((0.02, HALF + 0.13, BAT_Z[-1] + 0.42)), Vector((0.06, HALF + 0.35, top + 0.3)),
                   Vector((0.32, 0.22, zc + 0.05)), Vector((0.16, 0.06, zc + 0.02)), 18)
    L.tube(bm, pts, [0.024] * len(pts), sides=8)
    add_outline(L.obj_from_bm("wire_up", bm, [M["wire_b"]], parent=body), LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts = L.bezier(Vector((-0.2, -0.3, top + 0.06)), Vector((-0.3, -0.05, top + 0.25)), Vector((-0.24, 0.12, zc - 0.25)),
                   Vector((-0.13, 0.06, zc - 0.08)), 16)
    L.tube(bm, pts, [0.022] * len(pts), sides=8)
    add_outline(L.obj_from_bm("wire_coil", bm, [M["wire_r"]], parent=body), LN["cool"], L.LINE * 0.6)

    # ---- the dome: a broad steel mushroom with a rolled rim and a knob, blue sparks crawling round its rim
    z0 = zc + 0.04
    R = DOME_R
    dome = W.lathe("dome", [[(0.16, z0), (R - 0.06, z0 + 0.02), (R, z0 + 0.06), (R + 0.01, z0 + 0.1), (R - 0.02, z0 + 0.2),
                             (R - 0.1, z0 + 0.31), (R - 0.24, z0 + 0.39), (R - 0.4, z0 + 0.43), (0.0, z0 + 0.445)]],
                   [M["dome"]], bev=0.0, n=96, parent=body, sharp=60)
    W.wobble(dome, 0.006, 5.0, 2.0, radial=False)
    add_outline(dome, LN["cool"])
    rim = W.lathe("domerim", [L.band(R - 0.03, R + 0.025, z0 + 0.045, z0 + 0.1, bev=0.015)], [M["trim"]], bev=0, n=96,
                  parent=body, sharp=35)
    add_outline(rim, LN["cool"], L.LINE * 0.7)
    bm = bmesh.new()
    pts, nrm = L.ring_of(20, R + 0.025, z0 + 0.072, 0.5)
    W.rivets(bm, pts, nrm, r=0.022)
    W.obj("domerivets", bm, [M["trim"]], parent=body)
    bm = bmesh.new()
    Q.ball(bm, (0, 0, z0 + 0.46), 0.05, segs=16)
    add_outline(W.obj("knob", bm, [M["trim"]], parent=body), LN["cool"], L.LINE * 0.6)
    core, halo = bmesh.new(), bmesh.new()
    for a0, span, seed in ((70, 60, 1), (190, 50, 2), (300, 45, 3), (20, 30, 4)):
        pts = []
        n = 9
        for i in range(n):
            a = math.radians(a0 + span * i / (n - 1))
            j = ((i * 7 + seed * 3) % 5 - 2) / 2.0
            r = R + 0.05 + 0.03 * abs(j)
            pts.append(Vector((r * math.cos(a), r * math.sin(a), z0 + 0.08 + 0.05 * j)))
        L.tube(core, pts, [0.016] * n, sides=6)
        L.tube(halo, pts, [0.06] * n, sides=8)
    L.obj_from_bm("sparks", core, [M["spark"]], parent=body, smooth=False)
    L.obj_from_bm("sparks_glow", halo, [M["spark_halo"]], parent=body)
    return body


if ARGS[1:2] == ["film"]:
    # film N: N pictures of the film rolling up through one frame (they loop), render/tN/film-00.png ...
    import bpy
    S.run("tesla", build, TIER, HERE, ["none"], canvas=(720, 1160, 360, 960))
    n = int(ARGS[2]) if len(ARGS) > 2 else 8
    node = bpy.data.materials["film"].node_tree.nodes["FILM"]
    for i in range(n):
        node.outputs[0].default_value = FRAME * i / n
        L.shot(L.OUT / f"film-{i:02d}.png", L.objs_under(bpy.data.objects["BODY"]), outer_col=L.LINE_COLS["warm"])
elif ARGS[1:2] in (["film-at"], ["film-game"]):
    # film-at A B ...: one picture per position, the film moved A, B ... frames (FRAME) up, render/tN/cell-00.png ...
    # film-game: the 55 cells of the game's Tesla strip (`towerFx.ts` teslaTick, after BUILDING25.as:98-200): cells
    # 0-31 charge, the film speeding up from rest; 32-40 loop, a ninth of a frame a cell, so cell 40 runs on into 32;
    # 41-54 wind down, slowing, and after 54 the film stands where cell 0 has it, three frames on.
    import bpy
    if ARGS[1] == "film-game":
        v = 1 / 9
        p = 2.049169                    # the charge's curve: its 32 steps add up to 3 - 1 - 7v frames
        steps = [v * (i / 32) ** p for i in range(1, 33)] + [v] * 9 + [v * (15 - j) / 15 for j in range(1, 14)]
        at = [0.0]
        for s in steps:
            at.append(at[-1] + s)
    else:
        at = [float(a) for a in ARGS[2:]]
    S.run("tesla", build, TIER, HERE, ["none"], canvas=(720, 1160, 360, 960))
    node = bpy.data.materials["film"].node_tree.nodes["FILM"]
    for i, a in enumerate(at):
        node.outputs[0].default_value = FRAME * a
        L.shot(L.OUT / f"cell-{i:02d}.png", L.objs_under(bpy.data.objects["BODY"]), outer_col=L.LINE_COLS["warm"])
else:
    S.run("tesla", build, TIER, HERE, ARGS[1:], canvas=(720, 1160, 360, 960))
