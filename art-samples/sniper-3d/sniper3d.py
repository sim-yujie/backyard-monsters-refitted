"""sniper3d.py : the Sniper Tower, tiers 1-3, as a real 3D model rendered in the game's camera (owner, 27 Oct 2026: a sample).

Run with Blender 5.2 in the background (it builds the whole scene from nothing):

  blender -b --factory-startup -P sniper3d.py -- T body                render/tT/body-4x.png    (the tower without its turret)
  blender -b --factory-startup -P sniper3d.py -- T turret [h0 h1 ...]  render/tT/turret-4x/hNN.png (the turret alone at
                                                                       heading h, every body part in front cut out; default 32)
  blender -b --factory-startup -P sniper3d.py -- T full H              render/tT/full-hH.png    (everything, for checks)
  blender -b --factory-startup -P sniper3d.py -- T save                sniper-tT.blend

T is the tier, 1-3. Units: the body's hexagon has corner radius 1 (57 px in the @2x art). Ground bearing b (the game's
heading: 0 = down-right on screen, 45 = at the viewer, 135 = left, 225 = away, 315 = right) is the Blender direction
(sin b, cos b, 0). The hexagon has a corner at the viewer, as painted, so we see two faces: front-left (door) and
front-right (cable plugs). The camera is the Cannon sample's (orthographic, EL degrees down, from bearing 45, light from the
upper left), scaled to the painted art and shifted so the turret's turning point lands on the painted one.

The look (painted-look materials, outline, light, camera) is the shared one in ../tower-3d/look3d.py.
"""
import json
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
L.EL = float(os.environ.get("SNIPER_EL", 23.0))   # the Sniper's own camera elevation (set before setup_render; see the report for why 23)
from look3d import (LINE, Paint, add_outline, bear, bezier, diag, lathe, mat_flat, obj_from_bm, rbox, ring_of, srgb,  # noqa
                    studs, tube)
EL = L.EL
# the Sniper's own metals, on top of the shared ones: (shade, colour, light), highlight
L.METALS.update(
    bronze=((70, 32, 10), (178, 94, 34), (232, 156, 84), (1.0, 0.82, 0.52, 1)),      # tier 1's copper-bronze skin
    dbronze=((52, 24, 8), (146, 76, 30), (212, 140, 76), (1.0, 0.8, 0.5, 1)),        # its darker bands
    sgold=((120, 64, 6), (232, 160, 24), (255, 214, 92), (1.0, 0.9, 0.55, 1)),       # a deeper gold than the shared one
    bluesteel=((22, 36, 76), (86, 124, 188), (206, 228, 255), (0.9, 0.95, 1.0, 1)),
    pblack=((8, 8, 12), (30, 30, 38), (78, 80, 96), (0.8, 0.86, 1.0, 1)),           # tier 3's skin: blacker than "black"
    panel=((72, 76, 90), (178, 182, 196), (238, 240, 248), (0.95, 0.97, 1.0, 1)),
)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
OUT = HERE / "render" / f"t{TIER}"

# ---------------------------------------------------------------------------------------------------- fit to the painted art
S2 = 57.0                      # px per unit in the @2x art (the body's faces: 99 px wide = 2 x 0.866)
PPU = 2 * S2                   # px per unit in our 4x renders
# the painted pieces (buildingArtTiers.ts, Sniper): body canvas @2x and the pivot on it, and the pivot's game y
PAINTED = {1: dict(body=(160, 182), pivot=(80, 34), top=(160, 198), top_pivot=(80, 50), game_y=-20),
           2: dict(body=(160, 248), pivot=(80, 40), top=(160, 258), top_pivot=(80, 50), game_y=-50),
           3: dict(body=(160, 280), pivot=(80, 38), top=(160, 292), top_pivot=(80, 50), game_y=-67)}
P = PAINTED[TIER]

# ---------------------------------------------------------------------------------------------------------------- the shape
R = 0.9                        # body hexagon corner radius (fitted to the painted outline, see measure.py)
FRONT = 45.0                   # the corner at the viewer
Z0 = {1: 0.86, 2: 0.82, 3: 0.74}[TIER]   # the body's bottom (it stands on three ball feet), fitted per tier
PLATE_T = 0.19                 # the top plate's thickness
PLATE_R = 1.06                 # the top plate's corner radius (it overhangs the body)
DISC_R = 0.70                  # the turntable
TOP1 = 2.31                    # tier 1's turning point height (painted: 91 px above the ground's middle at @2x)
# each tier's turning point stands as much higher as the painted one does (game px x2, seen at EL)
TOP = TOP1 + (PAINTED[1]["game_y"] - P["game_y"]) * 2 / (S2 * math.cos(math.radians(EL)))
SECTIONS = TIER                # 1, 2 or 3 stacked sections
FEET = (45.0, 45.0 + 112, 45.0 - 112)
FOOT_D, FOOT_R = 1.14, 0.26
FRONT_FOOT_D = 1.42            # the front foot stands out in front of the (drawn-out) front corner, as painted
TURRET_SCALE = 1.12
DISC_STRETCH = 1.2             # the turntable too (the turret on it stays round: it turns)
STRETCH = 1.6                  # the body's hexagon is drawn out toward the viewer, so its front corner reads as sharp as
PLATE_STRETCH = 1.4            # the painted one (the body is only ever seen from this one side)
if os.environ.get("SNIPER_SHAPE"):       # for fit tests: body radius, plate radius, feet distance and radius, front foot, bottom
    R, PLATE_R, FOOT_D, FOOT_R, FRONT_FOOT_D, Z0 = (float(v) for v in os.environ["SNIPER_SHAPE"].split(","))
if os.environ.get("SNIPER_STRETCH"):     # for camera-angle tests: body, plate, turntable
    STRETCH, PLATE_STRETCH, DISC_STRETCH = (float(v) for v in os.environ["SNIPER_STRETCH"].split(","))


def drawn(p, k):
    """Point p drawn out toward the viewer by k."""
    v = bear(FRONT)
    return p + v * ((k - 1) * p.dot(v))


def hexpts(r, z=0.0, k=None):
    """The body's hexagon (corner at the viewer), drawn out toward the viewer by k."""
    v = bear(FRONT)
    k = STRETCH if k is None else k
    pts = [bear(FRONT + 60 * i, r, z) for i in range(6)]
    return [p + v * ((k - 1) * p.dot(v)) for p in pts]


def notched(pts, n):
    """A polygon with a small V cut into each corner."""
    out = []
    m = len(pts)
    for i, p in enumerate(pts):
        a, b = pts[i - 1], pts[(i + 1) % m]
        out += [p + (a - p).normalized() * n, p * (1 - 0.9 * n / p.length), p + (b - p).normalized() * n]
    return out


def prism(bm, poly, z0, z1, mat=0, bevel=0.0, segs=2):
    """A straight prism over a ground polygon (list of Vectors, z ignored), from z0 to z1, edges bevelled."""
    sub = bmesh.new()
    lo = [sub.verts.new((p.x, p.y, z0)) for p in poly]
    hi = [sub.verts.new((p.x, p.y, z1)) for p in poly]
    sub.faces.new(lo)
    sub.faces.new(hi)
    m = len(poly)
    for i in range(m):
        sub.faces.new((lo[i], lo[(i + 1) % m], hi[(i + 1) % m], hi[i]))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    if bevel > 0:
        bmesh.ops.bevel(sub, geom=list(sub.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    me = bpy.data.meshes.new("_tmp")
    sub.to_mesh(me)
    sub.free()
    for p in me.polygons:
        p.material_index = mat
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def face_axes(side):
    """The face we see on side 'L' (door) or 'R' (plugs): its middle, the way along it (L: toward its outer corner, R:
    toward the front corner) and its outward normal, all on the ground."""
    h = hexpts(R)
    c0, c1 = h[0], (h[1] if side == "L" else h[5])
    t = (c1 - c0).normalized() if side == "L" else (c0 - c1).normalized()
    mid = (c0 + c1) / 2
    n = Vector((t.y, -t.x, 0))
    if n.dot(mid) < 0:
        n = -n
    return mid, t, n


def face_frame(side, z, u=0.0, out=0.0):
    """A frame on face side: x along it, y out of it, z up; origin at its middle at height z, moved u along and out off it."""
    mid, t, n = face_axes(side)
    c = mid + Vector((0, 0, z)) + t * u + n * out
    m = Matrix((t, n, Vector((0, 0, 1)))).transposed().to_4x4()
    return Matrix.Translation(c) @ m


def cyl(bm, r, depth, mat_world, segs=24, r2=None, mat=0):
    """A cylinder along local z, centred, transformed by mat_world."""
    sub = bmesh.new()
    bmesh.ops.create_cone(sub, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth,
                          matrix=Matrix())
    me = bpy.data.meshes.new("_tmp")
    sub.to_mesh(me)
    sub.free()
    me.transform(mat_world)
    for p in me.polygons:
        p.material_index = mat
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


# -------------------------------------------------------------------------------------------------------------- materials
def mat_stripes(kind):
    """The painted band down the front corner: red-and-white chevrons (V, point down), or black-and-gold slants."""
    p = Paint("stripes")
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    t = bear(FRONT + 90)                                            # across the corner
    lat = p.N.new("ShaderNodeVectorMath")
    lat.operation = 'DOT_PRODUCT'
    p.link(p.tc.outputs["Object"], lat.inputs[0])
    lat.inputs[1].default_value = (t.x, t.y, 0)
    if kind == "chevron":
        u = p.math("SUBTRACT", sep.outputs[2], p.math("MULTIPLY", p.math("ABSOLUTE", lat.outputs["Value"]), 0.9))
        a, b = srgb(222, 18, 20), srgb(238, 236, 240)
        period = 0.23
    else:
        u = p.math("ADD", sep.outputs[2], p.math("MULTIPLY", lat.outputs["Value"], 1.0))
        a, b = srgb(28, 26, 30), srgb(240, 186, 30)
        period = 0.24
    band = p.math("GREATER_THAN", p.math("FRACT", p.math("DIVIDE", u, period)), 0.5)
    paint = p.mix(a, b, band)
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.84, 0.82, 0.82, 1)), (0.7, (1, 1, 1, 1))])
    col = p.mix(paint, grime, 1.0, 'MULTIPLY')
    return p.finish(col, spec=0.35, spec_rough=0.3)


def materials():
    met = L.mat_metal
    skin = met("skin", {1: "bronze", 2: "sgold", 3: "pblack"}[TIER], spec=0.6 if TIER == 3 else 0.9,
               wear=0.35 if TIER == 3 else 0.5, sheen=0.06 if TIER == 3 else 0.15)   # little sky sheen: dark tops
    trim = met("trim", "dbronze" if TIER == 1 else "sgold", spec=1.0, sheen=0.2)
    steel = met("steel", "steel", spec=0.6, spec_rough=0.3)
    p = Paint("disc")                          # the turntable: dark worn steel, no sky sheen (it faces straight up)
    base = p.ramp(p.noise(3.0, 4.0), [(0.3, srgb(*((54, 54, 62) if TIER < 3 else (30, 30, 36)))),
                                      (0.7, srgb(*((80, 80, 90) if TIER < 3 else (46, 46, 54))))])
    sc_ = p.ramp(p.noise(14.0, 6.0, 0.7), [(0.66, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))])
    disc = p.finish(p.mix(base, srgb(110, 110, 122), sc_), spec=0.5, spec_rough=0.3, spec_col=(0.9, 0.93, 1.0, 1))
    return dict(disc=disc, skin=skin, trim=trim, steel=steel,
                brass=met("brass", "brass" if TIER == 1 else "sgold"),
                panel=met("panel", "panel", spec=0.6, spec_rough=0.3),
                dark=met("dark", "gunmetal", spec=0.35, spec_rough=0.3),
                dome=met("dome", "bluesteel", spec=1.0, spec_rough=0.18, sheen=0.2) if TIER < 3 else met("dome", "black", wear=0.35, sheen=0.15),
                ring=steel if TIER < 3 else trim,
                stripes=mat_stripes("chevron" if TIER < 3 else "hazard"),
                ball=met("ball", "gunmetal" if TIER < 3 else "black", spec=0.8, spec_rough=0.22),
                bore=mat_flat("bore", (30, 28, 32), spec=0.1),
                rivet=met("rivet", "steel" if TIER == 1 else "sgold", spec=1.0, spec_rough=0.2, wear=0),
                blue=mat_flat("blue", (40, 96, 236), spec=0.6, spec_rough=0.25),
                red=mat_flat("red", (226, 30, 30), spec=0.6, spec_rough=0.25),
                light=met("light", "panel", spec=0.9, spec_rough=0.22),
                lens_red=L.mat_glass_lamp("lens_red", core=(255, 150, 140), mid=(226, 16, 26), rim=(120, 0, 10)),
                lens_amber=L.mat_glass_lamp("lens_amber", core=(255, 214, 110), mid=(255, 128, 16), rim=(196, 56, 0)),
                halo_red=L.mat_halo("halo_red", (255, 40, 30), strength=0.4),
                halo_amber=L.mat_halo("halo_amber"))


# ------------------------------------------------------------------------------------------------------------------ model
def build():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    M = materials()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = bpy.data.objects.new("BODY", None)
    sc.collection.objects.link(body)

    top_body = TOP - 0.03 - PLATE_T            # where the stacked sections end and the plate begins
    hs = (top_body - Z0) / SECTIONS
    NL, NR = face_axes("L")[2], face_axes("R")[2]   # the outward normals of the two faces we see

    # ---- the hexagonal sections, a trim band at each joint, corner strips, the striped front corner
    skin, trim, stripe, panel, brass, slots = (bmesh.new() for _ in range(6))
    rivets = bmesh.new()
    for s in range(SECTIONS):
        za, zb = Z0 + s * hs, Z0 + (s + 1) * hs
        prism(skin, hexpts(R * 0.985), za + 0.02, zb - 0.02, bevel=0.03)
        for zz in ((za, za + 0.07),) + (((zb - 0.07, zb),) if s < SECTIONS - 1 else ()):
            prism(trim, hexpts(R * 1.025), zz[0], zz[1], bevel=0.02)
        for k, cp in enumerate(hexpts(R * 0.975)):   # corner strips (the front one is under the stripe band)
            if k == 0:
                continue
            rot = Matrix.Rotation(-math.atan2(cp.x, cp.y), 4, 'Z')
            rbox(trim, (0.1, 0.1, hs - 0.1), Matrix.Translation(cp + Vector((0, 0, za + 0.05))) @ rot, bevel=0.025)
        # the striped band down the front corner, a little proud of the two faces
        w, d = 0.22, 0.012
        hh = hexpts(R * 0.985)
        v, vl, vr = hh[0], hh[1], hh[5]
        pl, pr = v + (vl - v).normalized() * w + NL * d, v + (vr - v).normalized() * w + NR * d
        pv = v + bear(FRONT) * d * 2
        vs = [[stripe.verts.new((p.x, p.y, z)) for p in (pl, pv, pr)] for z in (za + 0.07, zb - (0.07 if s < SECTIONS - 1 else 0.03))]
        stripe.faces.new((vs[0][0], vs[0][1], vs[1][1], vs[1][0]))
        stripe.faces.new((vs[0][1], vs[0][2], vs[1][2], vs[1][1]))
        # door on the front-left face: a steel hatch with a hinge rod along its foot and a lip on top
        dh = min(0.8, hs - 0.36)
        h0 = za + (hs - dh) / 2 + 0.01
        rbox(panel, (0.6, 0.08, dh), face_frame("L", h0, u=0.04), bevel=0.035)
        rbox(panel, (0.5, 0.06, dh - 0.2), face_frame("L", h0 + 0.1, u=0.04, out=0.03), bevel=0.02)
        for i in range(3):                     # the hatch's vent slots, as painted
            rbox(slots, (0.34, 0.03, 0.04), face_frame("L", h0 + dh * (0.42 + 0.13 * i), u=0.04, out=0.062), bevel=0.01)
        rbox(panel, (0.58, 0.2, 0.06), face_frame("L", h0 + dh - 0.05, u=0.04, out=0.05) @ Matrix.Rotation(math.radians(-25), 4, 'X'),
             bevel=0.02)
        for uu in (-0.16, 0.24):
            cyl(panel, 0.05, 0.16, face_frame("L", h0 + 0.02, u=uu, out=0.08) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), segs=16)
        cyl(panel, 0.035, 0.6, face_frame("L", h0 + 0.02, u=0.04, out=0.08) @ Matrix.Rotation(math.pi / 2, 4, 'Y'), segs=12)
        studs(rivets, [face_frame("L", h0 + zz, u=uu, out=0.075).translation for uu in (-0.2, 0.28) for zz in (0.14, dh - 0.12)],
              [NL] * 4, r=0.026)
        # the plug panel on the front-right face: two brass sockets, a blue and a red cable looping out to the right
        ph = min(0.84, hs - 0.34)
        p0 = za + (hs - ph) / 2 + 0.01
        rbox(panel, (0.54, 0.07, ph), face_frame("R", p0, u=-0.1), bevel=0.035)
        sock = []
        for zz in (0.7, 0.3):
            f = face_frame("R", p0 + ph * zz, u=-0.14, out=0.06)
            cyl(brass, 0.11, 0.07, f @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=6)
            cyl(brass, 0.075, 0.18, f @ Matrix.Translation((0, 0.1, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=16)
            cyl(brass, 0.085, 0.04, f @ Matrix.Translation((0, 0.17, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=16)
            sock.append(f @ Vector((0, 0.19, 0)))
        studs(rivets, [face_frame("R", p0 + zz, u=uu, out=0.07).translation for uu in (-0.33, 0.13) for zz in (0.08, ph - 0.08)],
              [NR] * 4, r=0.024)
        tn, nn = -face_axes("R")[1], NR        # along the face toward the right corner, and out
        up = Vector((0, 0, 1))
        ends = [face_frame("R", zb - 0.1, u=-0.42, out=0.0).translation,
                face_frame("R", p0 + ph * 0.6, u=-0.44, out=0.0).translation]
        for (a, e, m) in ((sock[0], ends[0], "blue"), (sock[1], ends[1], "red")):
            pts = bezier(a, a + tn * 0.42 + nn * 0.06 - up * 0.04, e + tn * 0.5 + nn * 0.14 + up * 0.02, e, n=20)
            cab = bmesh.new()
            tube(cab, pts, [0.038] * len(pts), sides=12)
            ob = obj_from_bm(f"cable_{m}_{s}", cab, [M[m]], parent=body)
            add_outline(ob, LN["cool"], LINE * 0.8)
        # rivets along the joints on the faces we see
        for nb, nv in (("L", NL), ("R", NR)):
            for zz in (za + 0.035,) + ((zb - 0.035,) if s < SECTIONS - 1 else ()):
                studs(rivets, [face_frame(nb, zz, u=uu, out=0.04).translation for uu in (-0.32, 0.0, 0.32)], [nv] * 3,
                      r=0.024)
    if TIER == 1:   # the amber lamp at the top left of the door face
        lamp, glow = bmesh.new(), bmesh.new()
        f = face_frame("L", top_body - 0.16, u=0.3, out=0.0)
        cyl(lamp, 0.12, 0.08, f @ Matrix.Translation((0, 0.04, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=20)
        bmesh.ops.create_uvsphere(glow, u_segments=20, v_segments=10, radius=0.1,
                                  matrix=f @ Matrix.Translation((0, 0.09, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'X') @ diag(1, 1, 0.8))
        add_outline(obj_from_bm("lamp_rim", lamp, [M["brass"]], parent=body), LN["warm"], LINE * 0.7)
        obj_from_bm("lens_lamp", glow, [M["lens_amber"]], parent=body)
        halo = bmesh.new()
        bmesh.ops.create_uvsphere(halo, u_segments=20, v_segments=10, radius=0.2, matrix=f @ Matrix.Translation((0, 0.09, 0)))
        obj_from_bm("lamp_glow", halo, [M["halo_amber"]], parent=body)

    for name, bm_, mat, line in (("skin", skin, "skin", "warm"), ("trim", trim, "trim", "warm"), ("stripe", stripe, "stripes", "warm"),
                                 ("panels", panel, "panel", "cool"), ("sockets", brass, "brass", "warm"),
                                 ("slots", slots, "dark", "cool")):
        ob = obj_from_bm(name, bm_, [M[mat]], parent=body, sharp=35)
        if name != "stripe":
            add_outline(ob, LN[line])

    # ---- the top plate: a notched hexagon (trim colour rim, skin colour top), the turntable in it
    plate, ptop = bmesh.new(), bmesh.new()
    PS = PLATE_STRETCH
    prism(plate, notched(hexpts(PLATE_R, k=PS), 0.14), top_body, top_body + PLATE_T - 0.02, bevel=0.03)
    prism(ptop, notched(hexpts(PLATE_R * 0.9, k=PS), 0.12), top_body + PLATE_T - 0.03, top_body + PLATE_T, bevel=0.01, segs=1)
    c = [Vector((p.x * 0.97, p.y * 0.97, top_body + PLATE_T - 0.01)) for i, p in enumerate(hexpts(PLATE_R * 0.9, k=PS))]
    c += [(a + b) / 2 for a, b in zip(c, c[1:] + c[:1])]
    studs(rivets, c, [Vector((0, 0, 1))] * len(c), r=0.03)
    for k in range(6):                         # rivets round the plate's side
        hp = hexpts(PLATE_R, k=PS)
        mid = (hp[k] + hp[(k + 1) % 6]) / 2
        studs(rivets, [mid + Vector((0, 0, top_body + PLATE_T * 0.45))], [mid.normalized()], r=0.026)
    add_outline(obj_from_bm("plate", plate, [M["trim"]], parent=body, sharp=35), LN["warm"])
    add_outline(obj_from_bm("plate_top", ptop, [M["trim"] if TIER == 1 else M["skin"]], parent=body, sharp=35), LN["warm"], LINE * 0.6)
    disc = lathe("turntable", [
        [(DISC_R + 0.04, TOP - 0.035), (DISC_R + 0.04, TOP + 0.005), (DISC_R, TOP + 0.025), (DISC_R - 0.05, TOP + 0.005)],
        [(DISC_R - 0.05, TOP), (0.0, TOP)],
    ], [M["trim"] if TIER > 1 else M["dark"], M["disc"]], mat_of_seg=[0, 1], parent=body)
    disc.rotation_euler = (0, 0, -math.radians(FRONT))     # its local +Y toward the viewer, then drawn out along it
    disc.scale = (1, DISC_STRETCH, 1)
    add_outline(disc, LN["cool"])
    hub = bmesh.new()
    cyl(hub, 0.14, 0.05, Matrix.Translation((0, 0, TOP + 0.02)), segs=24)
    cyl(hub, 0.06, 0.05, Matrix.Translation((0, 0, TOP + 0.06)), segs=6)
    add_outline(obj_from_bm("hub", hub, [M["steel"]], parent=body, sharp=35), LN["cool"], LINE * 0.7)
    cc, nn = ring_of(8, 0.26, TOP + 0.005, 0.5)
    studs(rivets, [drawn(p, DISC_STRETCH) for p in cc], [Vector((0, 0, 1))] * 8, r=0.028)
    cc, nn = ring_of(20, DISC_R + 0.0, TOP + 0.02, 0.5)
    cc = [drawn(p, DISC_STRETCH) for p in cc]
    studs(rivets, cc, [Vector((0, 0, 1))] * 20, r=0.022)

    # ---- three steel ball feet with a brass belt, on short brass struts from the body's foot
    balls, belts, struts = bmesh.new(), bmesh.new(), bmesh.new()
    for fb in FEET:
        cpos = bear(fb, FRONT_FOOT_D if fb == FRONT else FOOT_D, FOOT_R)
        bmesh.ops.create_uvsphere(balls, u_segments=32, v_segments=16, radius=FOOT_R, matrix=Matrix.Translation(cpos))
        cyl(belts, FOOT_R * 1.035, 0.07, Matrix.Translation(cpos), segs=32)
        cyl(belts, FOOT_R * 0.98, 0.03, Matrix.Translation(cpos + Vector((0, 0, -0.06))), segs=32)
        corner = min((FRONT + 60 * k for k in range(6)), key=lambda b: abs(((b - fb + 180) % 360) - 180))
        a = drawn(bear(corner, R * 0.8, Z0 + 0.04), STRETCH)
        e = cpos + Vector((0, 0, FOOT_R * 0.7)) + (bear(fb) * -0.08)
        tube(struts, bezier(a, a + Vector((0, 0, -0.12)), e + (a - e) * 0.3, e, n=10), [0.065] * 10, sides=14)
        cyl(struts, 0.09, 0.06, Matrix.Translation(e + Vector((0, 0, 0.0))), segs=16)
    hole = bmesh.new()
    for fb in FEET:
        cyl(hole, 0.045, 0.01, Matrix.Translation(bear(fb, FRONT_FOOT_D if fb == FRONT else FOOT_D, 2 * FOOT_R - 0.002)), segs=16)
    add_outline(obj_from_bm("balls", balls, [M["ball"]], parent=body), LN["cool"])
    add_outline(obj_from_bm("belts", belts, [M["brass"]], parent=body), LN["warm"], LINE * 0.7)
    add_outline(obj_from_bm("struts", struts, [M["brass"]], parent=body), LN["warm"], LINE * 0.8)
    obj_from_bm("holes", hole, [M["bore"]], parent=body)
    obj_from_bm("rivets_body", rivets, [M["rivet"]], parent=body)

    # ---- the turning part, built pointing at +Y (bearing 0), turned about Z by -heading
    tur = bpy.data.objects.new("TURRET", None)
    sc.collection.objects.link(tur)
    tur.location = (0, 0, TOP)
    tur.scale = (TURRET_SCALE,) * 3
    DR = 0.37                                   # dome radius
    GUN_Z = 0.3                                 # the gun comes out of the dome's middle, as painted
    skirt = lathe("skirt", [[(0.43, 0.0), (0.44, 0.015), (0.44, 0.07), (0.42, 0.09)], [(0.42, 0.09), (DR, 0.095)]],
                  [M["ring"]], parent=tur)
    add_outline(skirt, LN["warm"] if TIER == 3 else LN["cool"])
    prof = [(DR, 0.09)] + [(DR * math.cos(a) ** 0.85, 0.1 + DR * 1.36 * math.sin(a) ** 1.15) for a in
                           (math.radians(d) for d in (5, 18, 32, 46, 58, 68, 76, 83, 88))]
    prof += [(0.0, prof[-1][1] + 0.1)]          # the point on top (painted: an onion tip)
    dome = lathe("dome", [prof], [M["dome"]], parent=tur, sharp=60)
    add_outline(dome, LN["cool"])
    bm = bmesh.new()
    for sx in (-1, 1):                          # the two side clamps
        f = Matrix.Translation((sx * (DR + 0.02), 0, 0.02)) @ Matrix.Rotation(-sx * math.pi / 2, 4, 'Z')
        rbox(bm, (0.36, 0.11, 0.2), f, bevel=0.03)                       # an arched bracket: a block with a round top
        cyl(bm, 0.18, 0.11, f @ Matrix.Translation((0, 0.0, 0.2)) @ Matrix.Rotation(math.pi / 2, 4, 'X'), segs=28)
        rbox(bm, (0.44, 0.13, 0.07), f, bevel=0.025)                      # its foot
    add_outline(obj_from_bm("clamps", bm, [M["light"] if TIER < 3 else M["dark"]], parent=tur, sharp=35), LN["cool"])
    bm = bmesh.new()
    for sx in (-1, 1):
        studs(bm, [(sx * (DR + 0.08), 0, 0.22)], [(sx, 0, 0)], r=0.06)
        studs(bm, [(sx * (DR + 0.08), y, 0.07) for y in (-0.15, 0.15)], [(sx, 0, 0)] * 2, r=0.025)
    cc, nn = ring_of(16, 0.465, 0.04, 0.5)
    studs(bm, cc, nn, r=0.02)
    obj_from_bm("rivets_turret", bm, [M["brass"] if TIER > 1 else M["rivet"]], parent=tur)
    # the gun: a short tube out of the dome's front with a brass collar, a muzzle ring and a dark bore
    gun = lathe("gun", [
        [(0.0, 0.0), (0.105, 0.0)],
        [(0.105, 0.0), (0.105, 0.84)],
        [(0.125, 0.83), (0.13, 0.85), (0.13, 0.95), (0.12, 0.965)],
        [(0.12, 0.965), (0.08, 0.97), (0.075, 0.96)],
        [(0.075, 0.96), (0.07, 0.6), (0.0, 0.6)],
    ], [M["light"] if TIER < 3 else M["steel"], M["brass"], M["bore"]], mat_of_seg=[0, 0, 1 if TIER > 1 else 0, 1 if TIER > 1 else 0, 2], parent=tur, sharp=35)
    gun.rotation_euler = (-math.pi / 2, 0, 0)
    gun.location = (0, 0, GUN_Z)
    gun.scale = (1, 1, 0.82)                    # shorter, as painted
    add_outline(gun, LN["cool"])
    collar = lathe("collar", [[(0.14, 0.27), (0.155, 0.29), (0.155, 0.4), (0.14, 0.42)], [(0.14, 0.42), (0.105, 0.43)]],
                   [M["brass"]], parent=tur, sharp=35)
    collar.rotation_euler = (-math.pi / 2, 0, 0)
    collar.location = (0, 0, GUN_Z)
    add_outline(collar, LN["warm"])
    # the scope: a ribbed tube on top along the gun, its red lens to the front
    zt = 0.72
    scope = lathe("scope", [
        [(0.0, -0.22), (0.075, -0.22), (0.085, -0.2)],
        [(0.085, -0.2), (0.085, 0.2)],
        [(0.1, 0.18), (0.105, 0.2), (0.105, 0.27), (0.095, 0.28)],
        [(0.095, 0.28), (0.0, 0.28)],
    ], [M["light"] if TIER < 3 else M["dark"], M["brass"]], mat_of_seg=[0, 0, 1, 1], parent=tur, sharp=35)
    scope.rotation_euler = (-math.pi / 2, 0, 0)
    scope.location = (0, 0.12, zt)
    add_outline(scope, LN["cool"])
    bm = bmesh.new()
    for y in (-0.13, -0.03, 0.07):
        cyl(bm, 0.098, 0.045, Matrix.Translation((0, y, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'X'), segs=20)
    rbox(bm, (0.08, 0.2, 0.12), Matrix.Translation((0, -0.02, -0.15)), bevel=0.02)
    bands = obj_from_bm("scope_bands", bm, [M["brass"]], parent=tur, sharp=35)
    bands.location = (0, 0.12, zt)
    add_outline(bands, LN["warm"], LINE * 0.8)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=0.075,
                              matrix=Matrix.Translation((0, 0.28, 0)) @ diag(1, 0.5, 1))
    lens = obj_from_bm("lens_scope", bm, [M["lens_red"]], parent=tur)
    lens.location = (0, 0.12, zt)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=10, radius=0.12, matrix=Matrix.Translation((0, 0.29, 0)))
    halo = obj_from_bm("lens_scope_glow", bm, [M["halo_red"]], parent=tur)
    halo.location = (0, 0.12, zt)
    return body, tur


# ------------------------------------------------------------------------------------------------------------ camera/light
def setup_render():
    """The shared camera and light (look3d), our canvas fit: the width decides the scale (see frame)."""
    cam = L.setup_render()
    cam.data.sensor_fit = 'HORIZONTAL'
    return cam


def frame(cam, w, h, px, py):
    """Canvas w x h at our scale, the turning point at pixel (px, py)."""
    sc = bpy.context.scene
    L.canvas(w, h, (0, 0, w, h), OUT)
    sc.render.resolution_x, sc.render.resolution_y = w, h
    cam.data.ortho_scale = w / PPU
    cam.data.shift_x = cam.data.shift_y = 0.0
    for _ in range(3):
        bpy.context.view_layer.update()
        p = world_to_camera_view(sc, cam, Vector((0, 0, TOP)))
        cam.data.shift_x += (p.x * w - px) / w
        cam.data.shift_y -= ((1 - p.y) * h - py) / w
    bpy.context.view_layer.update()
    p = world_to_camera_view(sc, cam, Vector((0, 0, TOP)))
    return p.x * w, (1 - p.y) * h


def main():
    what = ARGS[1]
    body, tur = build()
    cam = setup_render()
    sc = bpy.context.scene
    body_obs, tur_obs = L.objs_under(body), L.objs_under(tur)
    OUT.mkdir(parents=True, exist_ok=True)
    if what == "save":
        tw, th = P["top"]
        frame(cam, tw * 2, th * 2, P["top_pivot"][0] * 2, P["top_pivot"][1] * 2)
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / f"sniper-t{TIER}.blend"))
        return

    warm, cool = L.LINE_COLS["warm"], L.LINE_COLS["cool"]

    def shot(path, seen, cut=(), col=warm):
        L.shot(path, seen, cut=cut, outer_col=col)

    info = dict(tier=TIER, elevation=EL, px_per_unit_4x=PPU, top=TOP)
    if what == "body":
        bw, bh = P["body"]
        info["body_pivot_4x"] = frame(cam, bw * 2, bh * 2, P["pivot"][0] * 2, P["pivot"][1] * 2)
        shot(OUT / "body-4x.png", body_obs)
    elif what == "full":
        tw, th = P["top"]
        frame(cam, tw * 2, th * 2, P["top_pivot"][0] * 2, P["top_pivot"][1] * 2)
        tur.rotation_euler = (0, 0, -math.radians(11.25 * int(ARGS[2])))
        shot(OUT / f"full-h{int(ARGS[2]):02d}.png", body_obs + tur_obs)
    elif what == "turret":
        info["turret_pivot_4x"] = frame(cam, 320, 300, 160, 210)
        heads = [int(a) for a in ARGS[2:]] or list(range(32))
        (OUT / "turret-4x").mkdir(exist_ok=True)
        for k in heads:
            tur.rotation_euler = (0, 0, -math.radians(11.25 * k))
            shot(OUT / "turret-4x" / f"h{k:02d}.png", tur_obs, cut=body_obs, col=warm if TIER == 3 else cool)
    elif what == "aim":      # render/tN/aim.json: the gun's on-screen direction and muzzle per heading (no pictures)
        piv = frame(cam, 320, 300, 160, 210)
        gun = bpy.data.objects["gun"]

        def turn(h):
            tur.rotation_euler = (0, 0, -math.radians(h))
        data = L.aim(cam, piv, turn, [11.25 * k for k in range(32)],
                     lambda: (gun.matrix_world @ Vector((0, 0, 0)), gun.matrix_world @ Vector((0, 0, 0.97))))
        (OUT / "aim.json").write_text(json.dumps(data))
    old =json.loads((OUT / "camera.json").read_text()) if (OUT / "camera.json").exists() else {}
    old.update(info)
    (OUT / "camera.json").write_text(json.dumps(old, indent=1))
    print("DONE", what, info)


main()
