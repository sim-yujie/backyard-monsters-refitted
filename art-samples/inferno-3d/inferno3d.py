"""inferno3d.py : the three Inferno towers as 3D models in the game's camera (buildings-3d-2, 28 Oct 2026), modelled on
the Flash art (no painted repaint exists): T=1 the Inferno Blast Tower (icannontower), T=2 the Sharpshooter (isnipertower),
T=3 the Magma Tower (imagmatower). Each is round, so only its head turns; the rest (the striped skirt and wooden drum,
the coil post, the striped column with its chain legs) is the body.

  blender -b --factory-startup -P inferno3d.py -- T body | turret [h ...] | full H | aim | clash | save

(see ../tower-3d/square3d.py for the modes; the same scale, 75 px per unit at @2x, and the same camera; the body canvas is
taller, BODY_CANVAS below, as the Sharpshooter stands about 3.3 units high.)
"""
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
L.EL = float(os.environ.get("INFERNO_EL", 30.0))
import square3d as Q  # noqa: E402
import worn3d as W  # noqa: E402
from look3d import add_outline, bear, lathe, mat_flat, obj_from_bm, rbox, srgb, studs, tube  # noqa: E402

Q.BODY_CANVAS = (640, 760, 320, 590)       # w, h, the ground middle's pixel (4x)
L.METALS.update(
    bronze=((60, 34, 16), (150, 98, 56), (226, 182, 128), (1.0, 0.9, 0.75, 1)),    # the Inferno's dull bronze
    copper=((70, 28, 12), (190, 100, 56), (250, 186, 136), (1.0, 0.88, 0.78, 1)),
    iron=((22, 18, 18), (70, 62, 60), (150, 140, 136), (0.95, 0.92, 0.9, 1)),
)
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])


def mat_diag(name, a, b, n=6, lean=1.6, period=1.0):
    """Diagonal painted stripes wound round the Z axis (the Inferno's red and cream), a little chipped and grimy."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    u = p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), p.math("MULTIPLY", sep.outputs[2], lean / period))
    bnd = p.math("GREATER_THAN", p.math("FRACT", u), 0.5)
    paint = p.mix(srgb(*a), srgb(*b), bnd)
    chip = p.ramp(p.noise(7.0, 8.0, 0.62), [(0.62, (0, 0, 0, 1)), (0.645, (1, 1, 1, 1))])
    paint = p.mix(paint, srgb(120, 70, 40), chip)
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.78, 0.74, 0.72, 1)), (0.7, (1, 1, 1, 1))])
    return p.finish(p.mix(paint, grime, 1.0, 'MULTIPLY'), spec=0.3, spec_rough=0.35, shade=L.WARM_SHADE)


def mat_parchment(name):
    """The Sharpshooter's drum: cream parchment panels with dark scrawl, between dark red ones."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    panel = p.math("GREATER_THAN", p.math("FRACT", p.math("MULTIPLY", ang, 8 / (2 * math.pi))), 0.32)
    scrawl = p.ramp(p.noise(14.0, 6.0, 0.7, stretch=(1.0, 1.0, 3.0)), [(0.6, (1, 1, 1, 1)), (0.66, (0.45, 0.36, 0.3, 1))])
    cream = p.mix(srgb(238, 222, 190), scrawl, 1.0, 'MULTIPLY')
    paint = p.mix(srgb(120, 22, 24), cream, panel)
    grime = p.ramp(p.noise(2.5, 3.0), [(0.3, (0.8, 0.76, 0.72, 1)), (0.7, (1, 1, 1, 1))])
    return p.finish(p.mix(paint, grime, 1.0, 'MULTIPLY'), spec=0.25, spec_rough=0.4, shade=L.WARM_SHADE)


def common():
    met = L.mat_metal
    return dict(
        bronze=met("bronze", spec=1.0, wear=0.5),
        copper=met("copper", spec=1.0, wear=0.3),
        iron=met("iron", spec=0.8, wear=0.6, polish=0.3),
        wood=L.mat_wood("wood", light=(170, 104, 62), dark=(118, 66, 36), crack=(60, 30, 16)),
        stripes=mat_diag("stripes", (196, 30, 26), (236, 214, 178)),
        leather=L.mat_wood("leather", light=(176, 120, 76), dark=(120, 76, 44), crack=(70, 40, 20)),
        glow=L.mat_glass_lamp("glow", core=(255, 240, 170), mid=(255, 140, 30), rim=(200, 50, 0)),
        halo=L.mat_halo("halo", (255, 140, 40), strength=0.5),
        bore=mat_flat("bore", (20, 14, 12), spec=0.1),
        lens=L.mat_glass_lamp("lens", core=(220, 250, 255), mid=(80, 190, 230), rim=(20, 80, 140)),
        parch=mat_parchment("parch"),
        wire=mat_flat("wire", (230, 190, 40), spec=0.6),
        # the worn look (owner, 29 Oct: "too unrefined and lacks detail compared to the original"; see worn3d.py)
        dirt=W.mat_dirt("dirt"),
        stripes_w=W.mat_worn_diag("stripes_w", (192, 24, 18), (222, 190, 142)),
        stake=W.mat_raw_wood("stake"),
        staves=W.mat_planks("staves", n=16, light=(196, 140, 92), dark=(150, 98, 60)),
        staves_dark=W.mat_planks("staves_dark", n=14, light=(150, 96, 58), dark=(104, 62, 36), soot=0.35),
        rope=W.mat_rope("rope"),
        iron_w=W.mat_iron("iron_w"),
        iron_dirty=W.mat_iron("iron_dirty", base=(76, 60, 50), dark=(36, 28, 24), rust_k=0.8, soot=0.5, dirt=0.0),
        iron_head=W.mat_iron("iron_head"),
        iron_hoop=W.mat_iron("iron_hoop", base=(74, 58, 48), dark=(38, 29, 25), edge=(150, 128, 108), rust_k=0.85),
        iron_sooty=W.mat_iron("iron_sooty", rust_k=0.6, soot=0.6),
    )


def ridged_barrel(name, tur, M, y0, y1, r, z, rings, mat="bronze", mouth=1.25):
    """A barrel along +Y at height z from y0 to y1, raised rings at the fractions in rings, a flared mouth."""
    prof = [(r, 0.0)]
    for f in rings:
        yc = (y1 - y0) * f
        prof += [(r, yc - 0.04), (r * 1.25, yc - 0.025), (r * 1.25, yc + 0.025), (r, yc + 0.04)]
    L_ = y1 - y0
    prof += [(r, L_ - 0.08), (r * mouth, L_ - 0.03), (r * mouth, L_)]
    inner = [(r * mouth, L_), (r * 0.75, L_), (r * 0.7, L_ - 0.1), (0.0, L_ - 0.12)]
    b = lathe(name, [prof, inner], [M[mat], M["bore"]], mat_of_seg=[0, 1], parent=tur, sharp=35, n=40)
    b.matrix_basis = Matrix.Translation((0, y0, z)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    return b


# ------------------------------------------------------------------------------------------------ 1: Inferno Blast Tower
def pleat(ob, n, amp, z0, z1, phase):
    """Folds in a lathe part (the skirt's canvas): n ridges round it, deepest at z0, gone by z1."""
    for v in ob.data.vertices:
        x, y, z = v.co
        r = math.hypot(x, y)
        if r < 1e-4:
            continue
        t = 1.0 - min(1.0, max(0.0, (z - z0) / (z1 - z0)))
        k = (r + amp * t * (1.0 - abs(math.sin(n / 2 * (math.atan2(y, x) - phase)))) ** 1.6) / r
        v.co.x, v.co.y = x * k, y * k
    ob.data.update()


def strap(name, M, LN, parent, r, z0, z1, n_rivets, rivet_r=0.034, phase=0.0, mat="iron_hoop"):
    """An iron hoop round a round part, riveted on."""
    hoop = W.lathe(name, [L.band(r - 0.02, r + 0.03, z0, z1, bev=0.012)], [M[mat]], bev=0, parent=parent, sharp=35)
    add_outline(hoop, LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts, nrm = L.ring_of(n_rivets, r + 0.03, (z0 + z1) / 2, phase)
    W.rivets(bm, pts, nrm, r=rivet_r)
    W.obj(name + "_rivets", bm, [M[mat]], parent=parent)
    return hoop


def build_blast(M, LN, body):
    # the scorched rubble round the foot
    mound = W.lathe("mound", [[(1.14, 0.0), (1.04, 0.05), (0.92, 0.1), (0.8, 0.1), (0.66, 0.06)]], [M["dirt"]], bev=0,
                    parent=body, n=128)
    W.wobble(mound, 0.07, 3.5, 1.0, zamp=0.035)
    W.finish(mound)
    add_outline(mound, LN["warm"], L.LINE * 0.7)
    cl = bmesh.new()
    W.clods(cl, [bear(360 * i / 22 + 9 * (i % 3), 0.86 + 0.2 * ((i * 0.37) % 1.0), 0.05) for i in range(22)], r=0.075)
    add_outline(W.obj("clods", cl, [M["dirt"]], parent=body, sharp=60), LN["warm"], L.LINE * 0.6)
    # the skirt: a striped canvas cone in folds, worn and scorched toward the ground
    sk = W.lathe("skirt", [[(0.88, 0.0), (0.87, 0.05), (0.58, 0.8), (0.54, 0.84)]], [M["stripes_w"]], bev=0, parent=body,
                 sharp=50, n=160)
    pleat(sk, 10, 0.06, 0.0, 0.84, math.radians(90 - 18) + math.pi / 10)
    W.wobble(sk, 0.02, 2.0, 2.0)
    W.finish(sk)
    add_outline(sk, LN["warm"])
    # the stakes round the foot: rough wooden planks standing in the rubble, leaning out like petals
    st = bmesh.new()
    uv = st.loops.layers.uv.new("UVMap")
    for i in range(10):
        b = 360 * i / 10 + 18 + (7 if i % 2 else -5)
        lean = 0.34 + 0.14 * ((i * 0.53) % 1.0)
        h = 0.66 + 0.2 * ((i * 0.71) % 1.0)
        W.stake(st, uv, bear(b, 0.8, 0.0), bear(b + (6 if i % 3 else -6), 0.8 + lean, h), 0.15, sides=8, twist=i * 0.7)
    add_outline(W.obj("stakes", st, [M["stake"]], parent=body, sharp=55), LN["warm"])
    # the stave neck above the skirt, an iron strap round its foot
    z1 = 1.58
    neck = W.lathe("neck", [[(0.5, 0.78), (0.53, 0.98), (0.51, 1.17)]], [M["staves_dark"]], bev=0, wob=0.012,
                   parent=body, sharp=35)
    add_outline(neck, LN["warm"])
    strap("neckstrap", M, LN, body, 0.51, 0.84, 0.92, 12, phase=0.25)
    # the tub: light staves, an iron hoop, a rope laid round its rim, a recessed iron plate with bolts in it
    tub = W.lathe("drum", [[(0.5, 1.12), (0.6, 1.16), (0.63, 1.36), (0.62, z1 - 0.04), (0.585, z1)],
                           [(0.585, z1), (0.53, z1), (0.52, z1 - 0.06)]],
                  [M["staves"], M["staves_dark"]], mat_of_seg=[0, 1], wob=0.012, seed=3.0, parent=body, sharp=35)
    add_outline(tub, LN["warm"])
    strap("tubhoop", M, LN, body, 0.605, 1.19, 1.27, 14, rivet_r=0.036)
    W.lathe("plate", [[(0.53, z1 - 0.06), (0.0, z1 - 0.06)]], [M["iron_dirty"]], bev=0, parent=body)
    rp = bmesh.new()
    W.rope_ring(rp, 0.6, z1 + 0.01, r=0.07, pitch=0.13)
    add_outline(W.obj("rope", rp, [M["rope"]], parent=body, sharp=70), LN["warm"], L.LINE * 0.6)
    bm = bmesh.new()
    pts, nrm = L.ring_of(8, 0.45, z1 - 0.06, 0.5)
    W.bolts(bm, pts, [(0, 0, 1)] * 8, r=0.04)
    add_outline(W.obj("platebolts", bm, [M["iron_w"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)
    # the iron collar the head sits on, a glowing slit under its bolted cap
    col = W.lathe("collar", [[(0.3, z1 - 0.07), (0.31, z1 + 0.03), (0.27, z1 + 0.06)]], [M["iron_w"]], parent=body, sharp=35)
    add_outline(col, LN["cool"])
    lathe("glowring", [[(0.3, z1 + 0.04), (0.3, z1 + 0.11), (0.27, z1 + 0.12)]], [M["glow"]], parent=body)
    rim = W.lathe("glowcap", [L.band(0.0, 0.37, z1 + 0.11, z1 + 0.17)], [M["iron_w"]], bev=0, parent=body, sharp=35)
    add_outline(rim, LN["cool"])
    bm = bmesh.new()
    pts, nrm = L.ring_of(8, 0.345, z1 + 0.14, 0.5)
    W.bolts(bm, pts, nrm, r=0.032, washer=False)
    add_outline(W.obj("capbolts", bm, [M["iron_w"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.5)
    top = z1 + 0.17
    # the head: a hammered iron ball with a riveted seam, a ridged barrel out of its side, level
    tur = L.empty("TURRET", loc=(0, 0, top + 0.004))
    RB, HZ = 0.3, 0.3
    bm = bmesh.new()
    Q.ball(bm, (0, 0, HZ), RB, segs=32)
    ball = W.obj("ball", bm, [M["iron_head"]], parent=tur)
    W.wobble(ball, 0.008, 6.0, 4.0, radial=False)
    W.finish(ball)
    add_outline(ball, LN["cool"])
    seam = W.lathe("seam", [L.band(RB - 0.02, RB + 0.02, HZ - 0.03, HZ + 0.03, bev=0.01)], [M["iron_head"]], bev=0,
                   parent=tur, sharp=35)
    add_outline(seam, LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts, nrm = L.ring_of(14, RB + 0.02, HZ, 0.5)
    W.rivets(bm, pts, nrm, r=0.032)
    W.obj("seamrivets", bm, [M["iron_head"]], parent=tur)
    bm = bmesh.new()
    Q.cyl(bm, 0.23, 0.07, Matrix.Translation((0, 0, 0.035)), segs=32)
    add_outline(W.obj("neck_h", bm, [M["iron_w"]], parent=tur, sharp=35), LN["cool"])
    bm = bmesh.new()
    pts, nrm = L.ring_of(6, 0.2, 0.07, 0.5)
    W.bolts(bm, pts, [(0, 0, 1)] * 6, r=0.03, washer=False)
    W.obj("neckbolts", bm, [M["iron_w"]], parent=tur, sharp=35)
    bar = ridged_barrel("barrel", tur, M, RB * 0.5, RB + 0.5, 0.14, HZ, (0.35, 0.65), mat="iron_sooty")
    W.finish(bar)
    add_outline(bar, LN["cool"])
    bm = bmesh.new()      # the flange where the barrel leaves the ball, bolted
    m = Matrix.Translation((0, RB * 0.86, HZ)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    Q.cyl(bm, 0.21, 0.05, m, segs=32)
    add_outline(W.obj("flange", bm, [M["iron_head"]], parent=tur, sharp=35), LN["cool"], L.LINE * 0.6)
    bm = bmesh.new()
    pts = [Vector((0.175 * math.cos(2 * math.pi * (k + 0.5) / 6), RB * 0.86 + 0.026,
                   HZ + 0.175 * math.sin(2 * math.pi * (k + 0.5) / 6))) for k in range(6)]
    W.bolts(bm, pts, [(0, 1, 0)] * 6, r=0.026, washer=False)
    W.obj("flangebolts", bm, [M["iron_w"]], parent=tur, sharp=35)
    L.empty("muzzle_base", parent=tur, loc=(0, 0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, RB + 0.5, HZ))
    return tur, top, ("skirt", "drum", "glowcap")


# ---------------------------------------------------------------------------------------------------- 2: Sharpshooter
def build_sharp(M, LN, body):
    z1 = 0.8
    drum = lathe("drum", [[(0.86, 0.0), (0.88, 0.04), (0.74, z1 - 0.04), (0.7, z1)], [(0.7, z1), (0.0, z1)]],
                 [M["parch"], M["iron"]], mat_of_seg=[0, 1], parent=body, sharp=35)
    add_outline(drum, LN["warm"])
    trim = lathe("trim", [L.band(0.86, 0.9, 0.0, 0.06), L.band(0.7, 0.74, z1 - 0.05, z1 + 0.01)], [M["iron"]], parent=body,
                 sharp=35)
    add_outline(trim, LN["cool"], L.LINE * 0.6)
    # the dark socket on top, posts round it with a wire between
    sock = lathe("socket", [[(0.56, z1), (0.58, z1 + 0.02), (0.58, z1 + 0.2), (0.5, z1 + 0.24), (0.36, z1 + 0.24),
                             (0.34, z1 + 0.1), (0.0, z1 + 0.1)]], [M["iron"]], parent=body, sharp=35)
    add_outline(sock, LN["cool"])
    posts, knobs = bmesh.new(), bmesh.new()
    tops = []
    for b in (100, 200, 330):
        c = bear(b, 0.62, z1)
        Q.cyl(posts, 0.03, 0.62, Matrix.Translation(c + Vector((0, 0, 0.31))), segs=10)
        Q.ball(knobs, c + Vector((0, 0, 0.64)), 0.05, segs=10)
        tops.append(c + Vector((0, 0, 0.56)))
    add_outline(obj_from_bm("posts", posts, [M["iron"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)
    obj_from_bm("knobs", knobs, [M["copper"]], parent=body)
    w = bmesh.new()
    for a, b in zip(tops, tops[1:] + tops[:1]):
        mid = (a + b) / 2 - Vector((0, 0, 0.08))
        tube(w, L.bezier(a, mid, mid, b, n=10), [0.012] * 10, sides=6)
    obj_from_bm("wire", w, [M["wire"]], parent=body)
    # the coil post: a tapered wooden post, a copper ribbon wound round it
    zc0, top = z1 + 0.1, 2.6
    post = lathe("post", [[(0.2, zc0), (0.16, top - 0.1), (0.2, top - 0.05), (0.2, top)], [(0.2, top), (0.0, top)]],
                 [M["wood"], M["iron"]], mat_of_seg=[0, 1], parent=body, sharp=35)
    add_outline(post, LN["warm"])
    pts, radii = [], []
    n = 260
    for i in range(n + 1):
        t = i / n
        a = 2 * math.pi * 3.5 * t
        r = 0.44 - 0.1 * t
        pts.append((r * math.sin(a), r * math.cos(a), zc0 + 0.1 + (top - zc0 - 0.25) * t))
        radii.append(0.1)
    coil = bmesh.new()
    tube(coil, pts, radii, sides=12, flat=0.28)
    add_outline(obj_from_bm("coil", coil, [M["copper"]], parent=body, sharp=60), LN["warm"])
    # the head: a black box gun, a tube barrel out of its front, a lens at its back
    tur = L.empty("TURRET", loc=(0, 0, top + 0.004))
    bm = bmesh.new()
    rbox(bm, (0.54, 0.7, 0.42), Matrix.Translation((0, -0.06, 0.05)), bevel=0.05)
    add_outline(obj_from_bm("head", bm, [M["iron"]], parent=tur, sharp=35), LN["cool"])
    bm = bmesh.new()
    Q.cyl(bm, 0.12, 0.08, Matrix.Translation((0, 0, 0.045)), segs=24)
    add_outline(obj_from_bm("neck", bm, [M["iron"]], parent=tur, sharp=35), LN["cool"])
    HZ = 0.27
    bar = ridged_barrel("barrel", tur, M, 0.2, 0.84, 0.1, HZ, (0.2, 0.8), mat="bronze", mouth=1.3)
    add_outline(bar, LN["warm"])
    bm = bmesh.new()
    m = Matrix.Translation((0, -0.42, HZ)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
    Q.cyl(bm, 0.1, 0.04, m, segs=20)
    obj_from_bm("lens_back", bm, [M["lens"]], parent=tur)
    L.empty("muzzle_base", parent=tur, loc=(0, 0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, 0.84, HZ))
    return tur, top, ("post", "coil", "posts", "socket")


# ----------------------------------------------------------------------------------------------------- 3: Magma Tower
def build_magma(M, LN, body):
    # the foot: a dark iron ring with glowing windows, the striped column, a glowing collar, three chain legs
    foot = lathe("foot", [[(0.58, 0.0), (0.6, 0.03), (0.6, 0.3), (0.52, 0.34)], [(0.52, 0.34), (0.0, 0.34)]],
                 [M["iron"], M["iron"]], mat_of_seg=[0, 1], parent=body, sharp=35)
    add_outline(foot, LN["cool"])
    win = bmesh.new()
    for i in range(10):
        b = 360 * i / 10
        n_, t_ = bear(b), bear(b + 90)
        m = Matrix.Translation(bear(b, 0.6, 0.165)) @ Matrix((t_, Vector((0, 0, 1)), n_)).transposed().to_4x4()
        rbox(win, (0.27, 0.2, 0.02), m, bevel=0.01)
    obj_from_bm("windows_foot", win, [M["glow"]], parent=body)
    zc0, zc1 = 0.34, 1.25
    col = lathe("column", [[(0.44, zc0), (0.44, zc1)]], [M["stripes"]], parent=body, sharp=35)
    add_outline(col, LN["warm"])
    bands = lathe("bands", [L.band(0.44, 0.48, zc0, zc0 + 0.06), L.band(0.44, 0.48, zc1 - 0.06, zc1)], [M["iron"]],
                  parent=body, sharp=35)
    add_outline(bands, LN["cool"], L.LINE * 0.6)
    cz0, cz1 = zc1, zc1 + 0.36
    cage = lathe("collar", [[(0.44, cz0), (0.5, cz0 + 0.02), (0.5, cz1 - 0.02), (0.44, cz1)], [(0.44, cz1), (0.0, cz1)]],
                 [M["glow"], M["iron"]], mat_of_seg=[0, 1], parent=body)
    bars = bmesh.new()
    for i in range(10):
        Q.cyl(bars, 0.03, cz1 - cz0, Matrix.Translation(bear(36 * i, 0.51, (cz0 + cz1) / 2)), segs=8)
    for z in (cz0, cz1):
        Q.cyl(bars, 0.54, 0.05, Matrix.Translation((0, 0, z)), segs=40)
    add_outline(obj_from_bm("cagebars", bars, [M["iron"]], parent=body, sharp=35), LN["cool"])
    # the chain legs: links from the column's middle out and down to round iron feet
    links, feet = bmesh.new(), bmesh.new()
    for b in (125, 245, 5):
        a, d = bear(b, 0.5, cz0 + 0.1), bear(b, 0.95, 0.0)
        path = L.bezier(a, bear(b, 0.9, cz0), bear(b, 1.0, 0.5), d + Vector((0, 0, 0.14)), n=12)
        for i, p in enumerate(path[:-1]):
            q = path[i + 1]
            dv = q - p
            m = Matrix.Translation((p + q) / 2) @ Vector((0, 0, 1)).rotation_difference(dv).to_matrix().to_4x4() @ \
                Matrix.Rotation(math.pi / 2 * (i % 2), 4, 'Z')
            sub = bmesh.new()
            bmesh.ops.create_circle(sub, segments=12, radius=1.0)
            ring = [v.co.copy() for v in sub.verts]
            tube(links, [m @ Vector((0.045 * c.x, 0, dv.length * 0.62 * c.y)) for c in ring + ring[:1]],
                 [0.022] * (len(ring) + 1), sides=6, cap=False)
        Q.cyl(feet, 0.16, 0.12, Matrix.Translation(d + Vector((0, 0, 0.06))), segs=24, r2=0.13)
        Q.cyl(feet, 0.05, 0.08, Matrix.Translation(d + Vector((0, 0, 0.14))), segs=12)
    add_outline(obj_from_bm("chains", links, [M["bronze"]], parent=body, sharp=60), LN["cool"], L.LINE * 0.7)
    add_outline(obj_from_bm("feet", feet, [M["bronze"]], parent=body, sharp=35), LN["warm"])
    top = cz1 + 0.05
    # the head: a squat bronze nozzle on a short neck, its mouth forward
    tur = L.empty("TURRET", loc=(0, 0, top + 0.004))
    bm = bmesh.new()
    Q.cyl(bm, 0.14, 0.14, Matrix.Translation((0, 0, 0.07)), segs=24)
    add_outline(obj_from_bm("neck", bm, [M["iron"]], parent=tur, sharp=35), LN["cool"])
    bm = bmesh.new()
    rbox(bm, (0.36, 0.42, 0.26), Matrix.Translation((0, -0.06, 0.12)), bevel=0.1)
    add_outline(obj_from_bm("head", bm, [M["bronze"]], parent=tur, sharp=35), LN["warm"])
    HZ = 0.25
    bar = ridged_barrel("barrel", tur, M, 0.1, 0.56, 0.1, HZ, (0.5,), mouth=1.35)
    add_outline(bar, LN["warm"])
    L.empty("muzzle_base", parent=tur, loc=(0, 0, HZ))
    L.empty("muzzle_tip", parent=tur, loc=(0, 0.56, HZ))
    return tur, top, ("column", "collar", "cagebars")


def build():
    L.clear_scene()
    M = common()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = L.empty("BODY")
    tur, top, _ = {1: build_blast, 2: build_sharp, 3: build_magma}[TIER](M, LN, body)
    return body, tur, top


SOLID = {1: ("skirt", "drum", "glowcap", "collar", "rope", "capbolts"), 2: ("post", "coil", "posts", "socket"), 3: ("column", "collar", "cagebars")}
Q.run("inferno", build, TIER, HERE, turret_canvas=(400, 360, 200, 200), args=ARGS[1:], solid=SOLID[TIER])
