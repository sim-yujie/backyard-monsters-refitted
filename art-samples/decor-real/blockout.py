"""(decor-real, 24 Nov 2026: four wonders remodelled closer to the real places, at real proportions, and the
windpump squared to the grid; copied from decor-angle/blockout.py.)
Exact block-out renders of the wonders at the yard's camera (Blender, Cycles on one GPU).

The yard is a parallel corner view of a 2:1 grid: orthographic camera turned 45 deg, 30 deg above the ground, so
every ground-parallel edge along the grid shows at slope 0.5 and verticals stay vertical. Each wonder stands on a
10 x 10 slab (the approved base). Light from the upper left like the Flash art.

    CUDA_VISIBLE_DEVICES=N blender -b --python blockout.py -- <wonder> <out.png> [size]

World axes: the camera looks from (+x, -y) toward (-x, +y). The slab's FRONT corner is (5, -5), LEFT corner
(-5, -5), RIGHT corner (5, 5). So the left-front face is the plane y = -5 and the right-front face x = +5.
Prints the slab corners' pixel positions (to check the 2:1 seat) as JSON on a line starting with CORNERS.
"""
import json
import math
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
NAME, OUT = argv[0], argv[1]
SIZE = int(argv[2]) if len(argv) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
MATS = {}


def mat(name, rgb, rough=0.85, metal=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*[c ** 2.2 for c in rgb], 1)   # sRGB -> linear
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


GROUP = [None]          # current figure group (scaled as a whole, see HEIGHTS)
GROUPS = {}


def obj_from_bm(bm, name, m):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    if GROUP[0]: o["grp"] = GROUP[0]
    o.data.materials.append(m)
    return o


def box(x0, x1, y0, y1, z0, z1, m, name="box"):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0), (y0 + y1) / 2 + v.co.y * (y1 - y0), (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    return obj_from_bm(bm, name, m)


def cyl(cx, cy, z0, z1, r, m, n=32, r2=None, rot=0.0, name="cyl"):
    """vertical cylinder / cone frustum (r2 = top radius); rot turns the polygon (deg)"""
    bm = bmesh.new()
    r2 = r if r2 is None else r2
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r, radius2=r2, depth=z1 - z0)
    R = Matrix.Rotation(math.radians(rot), 4, "Z")
    for v in bm.verts:
        v.co = R @ v.co
        v.co += Vector((cx, cy, (z0 + z1) / 2))
    return obj_from_bm(bm, name, m)


def hcyl(cx, cy, cz, r, length, axis, m, n=32, name="hcyl"):
    """horizontal cylinder along 'x' or 'y' centred at (cx, cy, cz)"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r, radius2=r, depth=length)
    R = Matrix.Rotation(math.radians(90), 4, "Y" if axis == "x" else "X")
    for v in bm.verts:
        v.co = R @ v.co + Vector((cx, cy, cz))
    return obj_from_bm(bm, name, m)


def sphere(cx, cy, cz, r, m, sz=1.0, name="sph"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x + cx, v.co.y + cy, v.co.z * sz + cz))
    o = obj_from_bm(bm, name, m); o["round"] = 1
    return o


def onion(cx, cy, z0, r, h, m, name="onion"):
    """onion dome: profile revolved; base at z0, max radius r, height h (with a point)"""
    prof = []
    for i in range(0, 21):
        t = i / 20
        z = z0 + t * h
        # bulb: widest at 35%, pinched to a point at the top
        rr = r * (math.sin(math.pi * min(1, t / 0.9) ** 0.85) ** 0.8) * (1.0 if t < 0.35 else (1 - (t - 0.35) / 0.65) ** 0.6 / 1.0)
        if t == 0: rr = r * 0.82
        prof.append((max(0.0, rr), z))
    bm = bmesh.new(); n = 32; rings = []
    for rr, z in prof:
        ring = [bm.verts.new((cx + rr * math.cos(2 * math.pi * k / n), cy + rr * math.sin(2 * math.pi * k / n), z)) for k in range(n)]
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(list(reversed(rings[0])))
    o = obj_from_bm(bm, name, m); o["round"] = 1
    return o


def ellip(cx, cy, cz, rx, ry, rz, m, name="ell"):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    for v in bm.verts:
        v.co = Vector((cx + v.co.x * rx, cy + v.co.y * ry, cz + v.co.z * rz))
    o = obj_from_bm(bm, name, m); o["round"] = 1
    return o


def pyramid(cx, cy, z0, half, h, m, name="pyr"):
    """square pyramid with its base edges along the grid axes"""
    return cyl(cx, cy, z0, z0 + h, half * math.sqrt(2), m, n=4, r2=0.0, rot=45, name=name)


def cut(o, cutter):
    cutter.data.materials.clear(); cutter.data.materials.append(o.data.materials[0])   # cut faces keep o's material
    mod = o.modifiers.new("cut", "BOOLEAN"); mod.operation = "DIFFERENCE"; mod.object = cutter; mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def arch_cutter(face, c, z0, w, h, depth, at, pointed=False):
    """cutter for a round (or pointed) arch opening in a wall facing -y ('y') or +x ('x');
    c = centre along the wall, at = the wall plane's coordinate, depth into the wall"""
    m = mat("cutter", (1, 0, 1))
    r = w / 2
    if face == "y":
        b = box(c - r, c + r, at - 0.05, at + depth, z0, z0 + h - r, m)
        top = hcyl(c, at + depth / 2 - 0.025, z0 + h - r, r, depth + 0.1, "y", m)
    else:
        b = box(at - depth, at + 0.05, c - r, c + r, z0, z0 + h - r, m)
        top = hcyl(at - depth / 2 + 0.025, c, z0 + h - r, r, depth + 0.1, "x", m)
    if pointed:
        top.scale = (1, 1, 1)
        for v in top.data.vertices:
            pass
    mod = b.modifiers.new("u", "BOOLEAN"); mod.operation = "UNION"; mod.object = top; mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = b; bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(top, do_unlink=True)
    return b


def arch(o, face, c, z0, w, h, depth, at, fill=None):
    cut(o, arch_cutter(face, c, z0, w, h, depth, at))
    if fill is not None:   # a dark door/void set back inside the opening
        r = w / 2
        if face == "y": box(c - r, c + r, at + depth - 0.04, at + depth, z0, z0 + h - r * 0.3, fill, "door")
        else: box(at - depth, at - depth + 0.04, c - r, c + r, z0, z0 + h - r * 0.3, fill, "door")


SLAB_T = 0.45


def slab(m):
    return box(-5, 5, -5, 5, -SLAB_T, 0, m, "slab")


# ---------------------------------------------------------------------------------------------------- shapes
def prism_xz(prof, y0, y1, m, name="prism"):
    """a 2D outline in the x-z plane (list of (x, z), counter-clockwise seen from -y) pushed from y0 to y1"""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in prof]
    b = [bm.verts.new((x, y1, z)) for x, z in prof]
    n = len(prof)
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for k in range(n):
        bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m)


def prism_yz(prof, x0, x1, m, name="prism"):
    """a 2D outline in the y-z plane (list of (y, z)) pushed from x0 to x1"""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in prof]
    b = [bm.verts.new((x1, y, z)) for y, z in prof]
    n = len(prof)
    bm.faces.new(a); bm.faces.new(list(reversed(b)))
    for k in range(n):
        bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, name, m)


def pinnacle(x, y, z, r, h, m):
    """a small square base with a pointed top (the finials on Spanish colonial churches and gates)"""
    box(x - r, x + r, y - r, y + r, z, z + h * 0.3, m, "pinbase")
    pyramid(x, y, z + h * 0.3, r * 0.8, h * 0.7, m)


# ---------------------------------------------------------------------------------------------------- wonders
GREY = (0.50, 0.47, 0.42)
WOOD = (0.30, 0.17, 0.08)
DARK = (0.05, 0.04, 0.035)
BRONZE = (0.22, 0.17, 0.10)
CORAL = (0.80, 0.79, 0.75)      # Paoay: weathered grey-white coral stone
GATE = (0.60, 0.59, 0.55)       # Fort Santiago: grey weathered adobe/stone


def fort_santiago():
    """Fort Santiago's main gate: a tall carved frontispiece is the hero; the fort walls are only short stubs.
    The gate front faces the lower left (the left-front face, plane y = FY)."""
    st = mat("stone", GATE); wl = mat("wall", (0.46, 0.45, 0.42)); sl = mat("slab", GREY)
    wd = mat("wood", WOOD, 0.7); dk = mat("dark", DARK)
    slab(sl)
    FY, BY = -2.6, -0.6           # front and back planes of the gatehouse
    W = 3.3                        # half width of the lower tier
    H1, H2, H3 = 4.0, 2.7, 1.05    # lower tier, upper tier, pediment heights
    # wall stubs either side, set back a little, lower than the lower tier's cornice
    for s in (-1, 1):
        x0, x1 = sorted((s * (W - 0.05), s * 4.85))
        box(x0, x1, FY + 0.45, BY + 1.3, 0, 2.7, wl, "wall")
        box(x0, x1, FY + 0.35, FY + 0.75, 2.7, 3.15, wl, "parapet")
    for x in (-4.7, 4.7 - 0.0):
        pass
    # lower tier with the arched passage straight through
    g = box(-W, W, FY, BY, 0, H1, st, "gate")
    arch(g, "y", 0, 0, 2.0, 3.0, BY - FY + 0.2, FY, fill=None)
    box(-1.0, 1.0, BY - 0.1, BY + 0.6, 0, 0.02, dk, "passage")       # dark floor glimpse through the passage
    # base plinth and the lower cornice
    box(-W - 0.12, W + 0.12, FY - 0.15, BY, 0, 0.45, st, "plinth")
    box(-W - 0.2, W + 0.2, FY - 0.3, BY + 0.05, H1 - 0.35, H1, st, "cornice1")
    # paired pilasters either side of the arch, and the outer niche bays
    for px in (-2.85, -2.05, 1.25, 2.05):
        box(px, px + 0.6, FY - 0.22, FY + 0.1, 0.45, H1 - 0.35, st, "pil")
    for px in (-3.15, 2.55):                 # niches with carved figures at the far ends
        pass
    # arch moulding and the coat of arms above the arch
    box(-0.75, 0.75, FY - 0.25, FY + 0.05, 3.0, 3.6, st, "arms")
    # upper tier: narrower, a shallow carved front framing the relief panel of Saint James on horseback
    U, D = 1.75, 0.8                      # half width, depth of the upper tier
    up_ = box(-U, U, FY + 0.1, FY + 0.1 + D, H1, H1 + H2, st, "upper")
    cut(up_, box(-1.15, 1.15, FY + 0.0, FY + 0.4, H1 + 0.3, H1 + H2 - 0.35, mat("cutter", (1, 0, 1))))
    for px in (-U - 0.05, U - 0.45):
        box(px, px + 0.5, FY - 0.12, FY + 0.3, H1, H1 + H2 - 0.2, st, "pil2")
    box(-U - 0.15, U + 0.15, FY - 0.2, FY + 0.1 + D + 0.1, H1 + H2 - 0.25, H1 + H2, st, "cornice2")
    # the rider relief inside the panel (a rough lump for Codex to sculpt): a rearing horse, rider with sword
    ellip(0.0, FY + 0.32, H1 + 1.1, 0.62, 0.1, 0.3, st, "horse")
    for hx in (-0.35, 0.4):
        box(hx - 0.07, hx + 0.07, FY + 0.28, FY + 0.4, H1 + 0.35, H1 + 0.95, st, "leg")
    ellip(-0.62, FY + 0.32, H1 + 1.5, 0.15, 0.09, 0.26, st, "hhead")
    ellip(0.1, FY + 0.3, H1 + 1.65, 0.14, 0.09, 0.32, st, "rider")
    box(0.15, 0.8, FY + 0.28, FY + 0.36, H1 + 1.85, H1 + 1.93, st, "sword")
    # big scrolls (volutes) flanking the upper tier, from its top edge down to the lower cornice
    for s in (-1, 1):
        x0 = s * U
        prof = [(x0, H1)]
        for i in range(0, 9):
            t = i / 8
            prof.append((x0 + s * 1.15 * (1 - t) ** 0.6, H1 + 2.1 * t ** 1.4))
        if s > 0: prof = list(reversed(prof))
        prism_xz(prof, FY + 0.15, FY + 0.55, st, "scroll")
        # pinnacles on the ends of the lower cornice
        pinnacle(s * (W - 0.15), FY + 0.1, H1, 0.22, 1.1, st)
    # pediment: a thin triangle with a pointed finial and two small ones
    prism_xz([(-U - 0.1, H1 + H2), (U + 0.1, H1 + H2), (0, H1 + H2 + H3)], FY - 0.05, FY + 0.55, st, "pediment")
    pinnacle(0, FY + 0.25, H1 + H2 + H3 - 0.1, 0.16, 0.75, st)
    for s in (-1, 1):
        pinnacle(s * (U - 0.05), FY + 0.1, H1 + H2, 0.15, 0.6, st)


def paoay_church():
    """Paoay Church: grey-white coral stone, a huge wall of curved buttresses along the nave, a long red roof,
    a pediment facade full of pinnacles, and the white bell tower standing APART on the church's left."""
    st = mat("coral", CORAL); tw = mat("tower", (0.86, 0.85, 0.82)); sl = mat("slab", GREY)
    rf = mat("roof", (0.70, 0.17, 0.20), 0.7); dk = mat("dark", DARK); wd = mat("wood", WOOD, 0.7)
    slab(sl)
    # nave: long axis along +y, the facade on the left-front face
    nx0, nx1, ny0, ny1, nh = -0.6, 3.0, -2.9, 4.8, 3.1
    box(nx0, nx1, ny0, ny1, 0, nh, st, "nave")
    nc = (nx0 + nx1) / 2
    prism_xz([(nx0 - 0.25, nh - 0.05), (nx1 + 0.25, nh - 0.05), (nc, nh + 1.55)], ny0 + 0.35, ny1 + 0.15, rf, "roof")
    # facade, wider than the nave, with a stepped pediment, pilasters, a band and many pinnacles
    fy0, fy1 = -3.45, -2.85
    fx0, fx1 = nx0 - 0.45, nx1 + 0.45
    fc = (fx0 + fx1) / 2
    f = box(fx0, fx1, fy0, fy1, 0, 3.5, st, "facade")
    prism_xz([(fx0 + 0.2, 3.5), (fx1 - 0.2, 3.5), (fc + 0.55, 5.25), (fc - 0.55, 5.25)], fy0 + 0.1, fy1, st, "gable")
    # the steps along the gable's edges, each with a pinnacle
    for k in range(1, 4):
        t = k / 4
        for s in (-1, 1):
            x = fc + s * ((fx1 - fx0) / 2 - 0.2 - t * ((fx1 - fx0) / 2 - 0.75))
            z = 3.5 + t * 1.75
            pinnacle(x, fy0 + 0.35, z - 0.1, 0.14, 0.6, st)
    # little belfry niche on the apex
    bel = box(fc - 0.4, fc + 0.4, fy0 + 0.15, fy0 + 0.75, 5.2, 6.0, st, "apex")
    arch(bel, "y", fc, 5.35, 0.36, 0.55, 0.25, fy0 + 0.15, fill=dk)
    pinnacle(fc, fy0 + 0.45, 6.0, 0.22, 0.6, st)
    arch(f, "y", fc, 0, 1.1, 1.9, 0.3, fy0, fill=wd)
    for wx in (fc - 1.2, fc + 1.2):
        arch(f, "y", wx, 2.45, 0.38, 0.7, 0.2, fy0, fill=dk)
    arch(f, "y", fc, 2.5, 0.4, 0.75, 0.2, fy0, fill=dk)
    for px in (fx0, fx0 + 0.9, fc - 0.75, fc + 0.45, fx1 - 1.2, fx1 - 0.3):
        box(px, px + 0.3, fy0 - 0.15, fy0 + 0.05, 0, 3.55, st, "pil")
    box(fx0 - 0.08, fx1 + 0.08, fy0 - 0.2, fy0 + 0.1, 2.2, 2.38, st, "band")
    box(fx0 - 0.08, fx1 + 0.08, fy0 - 0.2, fy0 + 0.1, 3.42, 3.6, st, "cornice")
    for s in (fx0 + 0.15, fx1 - 0.15):
        pinnacle(s, fy0 + 0.2, 3.6, 0.2, 0.9, st)
    # the huge buttresses along the nave's right side: curved wedges, tall at the wall, each with a pinnacle
    def buttress(y0, y1, depth=1.85, top=nh + 0.25):
        prof = [(nx1 - 0.05, 0), (nx1 + depth, 0), (nx1 + depth, 0.45)]
        for i in range(1, 9):
            t = i / 9
            prof.append((nx1 + depth * (1 - t), 0.45 + (top - 0.45) * (t ** 1.7)))
        prof.append((nx1 - 0.05, top))
        prism_xz(list(reversed(prof)), y0, y1, st, "buttress")
        pinnacle(nx1 + 0.12, (y0 + y1) / 2, top, 0.2, 0.75, st)
    for k in range(7):
        y0 = fy0 + 0.05 + k * 1.2
        buttress(y0, y0 + 0.5)
    # the bell tower, apart on the church's left (toward the left corner): three tiers, a small dome
    tx0, tx1, ty0, ty1 = -4.75, -2.95, -4.75, -2.95
    tc = ((tx0 + tx1) / 2, (ty0 + ty1) / 2)
    z = 0
    for k, hh in enumerate((3.6, 2.4, 1.8)):
        s = 0.17 * k
        t = box(tx0 + s, tx1 - s, ty0 + s, ty1 - s, z, z + hh, tw, "tower")
        if k == 0:
            arch(t, "y", tc[0], 0, 0.55, 1.0, 0.25, ty0, fill=wd)
            arch(t, "y", tc[0], 2.2, 0.32, 0.6, 0.15, ty0, fill=dk)
        else:
            arch(t, "y", tc[0], z + 0.35, 0.55, 1.0, 0.25, ty0 + s, fill=dk)
            arch(t, "x", tc[1], z + 0.35, 0.55, 1.0, 0.25, tx1 - s, fill=dk)
        box(tx0 + s - 0.1, tx1 - s + 0.1, ty0 + s - 0.1, ty1 - s + 0.1, z + hh - 0.18, z + hh, tw, "ledge")
        z += hh
        if k in (0, 2):
            for (x, y) in ((tx0 + s + 0.15, ty0 + s + 0.15), (tx1 - s - 0.15, ty0 + s + 0.15),
                           (tx1 - s - 0.15, ty1 - s - 0.15), (tx0 + s + 0.15, ty1 - s - 0.15)):
                pinnacle(x, y, z, 0.1, 0.45, tw)
    cyl(tc[0], tc[1], z, z + 0.25, 0.62, tw, n=16)
    sphere(tc[0], tc[1], z + 0.25, 0.62, tw, sz=0.95)
    cyl(tc[0], tc[1], z + 0.8, z + 1.05, 0.08, tw, n=8)


def magellans_cross():
    """Magellan's Cross kiosk: a squat white octagon with SOLID walls, one big round arch with an iron grille in
    each face, a dark maroon tiled roof with wide eaves and a small cross on top; the tall wooden cross inside."""
    wh = mat("white", (0.88, 0.87, 0.83)); sl = mat("slab", GREY); rf = mat("roof", (0.38, 0.13, 0.10), 0.7)
    wd = mat("wood", (0.45, 0.28, 0.15), 0.7); ir = mat("iron", (0.06, 0.06, 0.06), 0.5, 0.6)
    stp = mat("step", (0.62, 0.60, 0.56))
    slab(sl)
    rot = 22.5 + 45            # a face toward the camera, so its neighbours run along the grid
    R = 4.25                   # corner radius of the octagon's walls
    apo = R * math.cos(math.radians(22.5))
    cyl(0, 0, 0, 0.3, R + 0.35, stp, n=8, rot=rot, name="step")
    z0, HW = 0.3, 4.2
    ring = cyl(0, 0, z0, z0 + HW, R, wh, n=8, rot=rot, name="ring")
    cut(ring, cyl(0, 0, z0 - 0.1, z0 + HW + 0.1, R - 0.4, mat("cutter", (1, 0, 1)), n=8, rot=rot))
    aw, ah = 1.95, 3.1         # each face is 2 R sin 22.5 = 3.25 wide: the arch leaves solid wall either side
    for k in range(8):
        a = math.radians(k * 45 - 45)
        nx, ny = math.cos(a), math.sin(a)
        cm = mat("cutter", (1, 0, 1))
        b = box(-aw / 2, aw / 2, -0.6, 0.6, -0.1, ah - aw / 2, cm)
        top = hcyl(0, 0, ah - aw / 2, aw / 2, 1.2, "y", cm)
        mod = b.modifiers.new("u", "BOOLEAN"); mod.operation = "UNION"; mod.object = top; mod.solver = "EXACT"
        bpy.context.view_layer.objects.active = b; bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(top, do_unlink=True)
        b.rotation_euler = (0, 0, a - math.pi / 2)
        b.location = (nx * (apo - 0.2), ny * (apo - 0.2), z0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT"); b.select_set(True)
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        cut(ring, b)
        # the iron grille: thin bars in the opening, a little inside the wall's outer face
        tx, ty = -ny, nx            # along the face
        d = apo - 0.3
        for j in range(-3, 4):
            u = j * aw / 8
            hgt = ah - aw / 2 + math.sqrt(max(0.0, (aw / 2) ** 2 - u * u)) - 0.05
            cx, cy = nx * d + tx * u, ny * d + ty * u
            box(cx - 0.03, cx + 0.03, cy - 0.03, cy + 0.03, z0, z0 + hgt, ir, "bar")
        for zz in (1.0, 2.2):
            cx, cy = nx * d, ny * d
            bb = box(-aw / 2, aw / 2, -0.03, 0.03, zz - 0.03, zz + 0.03, ir, "rail")
            bb.rotation_euler = (0, 0, a - math.pi / 2); bb.location = (cx, cy, z0)
    # cornice round the wall top and a plinth band
    cyl(0, 0, z0 + HW - 0.3, z0 + HW, R + 0.12, wh, n=8, rot=rot, name="cornice")
    cyl(0, 0, z0, z0 + 0.35, R + 0.08, wh, n=8, rot=rot, name="plinth")
    # ceiling (dark inside) and the roof: wide eaves, slightly bell-cast, up to a point
    cyl(0, 0, z0 + HW - 0.1, z0 + HW, R - 0.3, mat("ceil", (0.35, 0.25, 0.18)), n=8, rot=rot)
    zr = z0 + HW
    cyl(0, 0, zr, zr + 0.55, R + 0.6, rf, n=8, r2=R - 0.2, rot=rot, name="eave")
    cyl(0, 0, zr + 0.55, zr + 3.6, R - 0.15, rf, n=8, r2=0.25, rot=rot, name="roof")
    cyl(0, 0, zr + 3.6, zr + 3.8, 0.25, wh, n=8, rot=rot)
    # the small iron cross on the apex
    box(-0.05, 0.05, -0.05, 0.05, zr + 3.8, zr + 4.7, ir, "topcross")
    box(-0.05, 0.05, -0.3, 0.3, zr + 4.35, zr + 4.43, ir, "topbar")
    # the tall wooden cross inside on a low pedestal
    cyl(0, 0, z0, z0 + 0.5, 0.6, wh, n=16)
    box(-0.17, 0.17, -0.17, 0.17, z0 + 0.5, z0 + 3.9, wd, "cross")
    box(-0.15, 0.15, -1.0, 1.0, z0 + 2.75, z0 + 3.05, wd, "crossbar")


def rizal_monument():
    """Rizal Monument: a tall slim granite obelisk with three stars near its top, standing on a tapering stepped
    granite base on a wide stepped platform; the bronze Rizal in front with bronze figure groups either side."""
    gr = mat("granite", (0.56, 0.55, 0.52)); sl = mat("slab", GREY); bz = mat("bronze", BRONZE, 0.45, 0.6)
    slab(sl)
    z = 0
    for h, t in ((4.5, 0.3), (4.0, 0.3), (3.5, 0.3)):        # the wide platform steps
        box(-h, h, -h, h, z, z + t, gr, "step"); z += t
    for k in range(6):                                         # the tapering stepped base
        h = 2.8 - k * 0.15
        box(-h, h, -h, h, z, z + 0.48, gr, "tier"); z += 0.48
    box(-1.95, 1.95, -1.95, 1.95, z, z + 1.0, gr, "pedestal"); z += 1.0
    box(-2.12, 2.12, -2.12, 2.12, z, z + 0.18, gr, "pedcap"); z += 0.18
    zt = z                                                     # the top the bronze group stands on
    box(-1.05, 1.05, -1.05, 1.05, zt, zt + 0.9, gr, "plinth")
    cyl(0, 0, zt + 0.9, zt + 13.2, 0.82 * math.sqrt(2), gr, n=4, r2=0.55 * math.sqrt(2), rot=45, name="obelisk")
    pyramid(0, 0, zt + 13.2, 0.55, 0.75, gr)
    S = 1.5

    def fig(ox, oy, oz, parts):
        GROUP[0] = f"fig{ox}"; GROUPS[GROUP[0]] = ((ox, oy, oz), 1.0)
        for kind, a in parts:
            if kind == "c": cyl(ox + a[0] * S, oy + a[1] * S, oz + a[2] * S, oz + a[3] * S, a[4] * S, bz, n=16, r2=a[5] * S)
            elif kind == "e": ellip(ox + a[0] * S, oy + a[1] * S, oz + a[2] * S, a[3] * S, a[4] * S, a[5] * S, bz)
            else: box(ox + a[0] * S, ox + a[1] * S, oy + a[2] * S, oy + a[3] * S, oz + a[4] * S, oz + a[5] * S, bz)
        GROUP[0] = None
    # Rizal standing in an overcoat, holding a book, on the front diagonal (toward the camera)
    fig(1.3, -1.3, zt, [("c", (-0.09, -0.09, 0, 0.9, 0.11, 0.11)), ("c", (0.09, 0.09, 0, 0.9, 0.11, 0.11)),
                        ("c", (0, 0, 0.55, 1.75, 0.38, 0.27)), ("e", (0, 0, 1.75, 0.22, 0.34, 0.14)),
                        ("c", (0, 0, 1.8, 1.95, 0.08, 0.08)), ("e", (0, 0, 2.07, 0.14, 0.13, 0.17)),
                        ("b", (0.05, 0.3, -0.42, -0.3, 1.0, 1.35))])
    # the figure groups either side: a mother with a child (left), a father with boys reading (right)
    fig(-0.15, -1.6, zt, [("c", (0, 0, 0, 0.85, 0.5, 0.26)), ("e", (0, 0, 0.95, 0.2, 0.26, 0.16)),
                          ("e", (0, 0, 1.17, 0.13, 0.12, 0.15)), ("e", (0.25, -0.1, 0.6, 0.17, 0.12, 0.22)),
                          ("e", (0.25, -0.1, 0.88, 0.09, 0.09, 0.1))])
    fig(1.6, 0.15, zt, [("c", (0, 0, 0, 0.85, 0.5, 0.26)), ("e", (0, 0, 0.95, 0.2, 0.26, 0.16)),
                        ("e", (0, 0, 1.17, 0.13, 0.12, 0.15)), ("e", (-0.1, -0.3, 0.45, 0.16, 0.16, 0.25)),
                        ("e", (-0.1, -0.3, 0.78, 0.09, 0.09, 0.1))])
    # a bronze plaque on the base's front faces
    box(-0.6, 0.6, -1.97, -1.93, zt - 0.85, zt - 0.3, bz, "plaque")
    box(1.93, 1.97, -0.6, 0.6, zt - 0.85, zt - 0.3, bz, "plaque2")


HUB = [None]


def windpump():
    """Garden windpump (213): a splayed four-leg timber tower square to the grid, a platform, an iron gearbox,
    the wheel shaft out toward the lower left (-y; the wheel is added later as a moving strip, in the plane
    y = const), and the tail vane back toward the upper right (+y)."""
    wd = mat("wood", (0.55, 0.38, 0.22), 0.8); ir = mat("iron", (0.30, 0.29, 0.28), 0.5, 0.6)
    vn = mat("vane", (0.60, 0.12, 0.10), 0.6)
    H, B, T, L = 3.8, 1.2, 0.58, 0.13      # tower height, half spread at foot / at top, leg half thickness
    for sx in (-1, 1):
        for sy in (-1, 1):
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            for v in bm.verts:
                zf = v.co.z + 0.5                          # 0 at the foot, 1 at the top
                c = B + (T - B) * zf
                v.co = Vector((sx * c + v.co.x * 2 * L, sy * c + v.co.y * 2 * L, zf * H))
            obj_from_bm(bm, "leg", wd)
            box(sx * B - 0.17, sx * B + 0.17, sy * B - 0.17, sy * B + 0.17, 0, 0.3, ir, "shoe")
    # braces on each face: two rings of horizontal rails and an X between them
    def half(z): return B + (T - B) * z / H
    for z in (1.2, 2.7):
        h = half(z)
        box(-h, h, -h - 0.07, -h + 0.07, z - 0.08, z + 0.08, wd, "rail"); box(-h, h, h - 0.07, h + 0.07, z - 0.08, z + 0.08, wd, "rail")
        box(-h - 0.07, -h + 0.07, -h, h, z - 0.08, z + 0.08, wd, "rail"); box(h - 0.07, h + 0.07, -h, h, z - 0.08, z + 0.08, wd, "rail")
    def brace(p, q, r=0.055):
        p, q = Vector(p), Vector(q); d = q - p
        o = cyl(0, 0, 0, d.length, r, wd, n=6, name="brace")
        o.rotation_euler = d.to_track_quat("Z", "Y").to_euler(); o.location = p
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for za, zb in ((0.15, 1.2), (1.2, 2.7)):
        a, b = half(za), half(zb)
        for s in (-1, 1):
            brace((-a, s * a, za), (b, s * b, zb)); brace((a, s * a, za), (-b, s * b, zb))
            brace((s * a, -a, za), (s * b, b, zb)); brace((s * a, a, za), (s * b, -b, zb))
    # platform and gearbox
    P = T + 0.22
    box(-P, P, -P, P, H, H + 0.2, wd, "platform")
    g = 0.38
    box(-g, g, -g, g, H + 0.2, H + 0.2 + 2 * g, ir, "gearbox")
    box(-g - 0.04, g + 0.04, -g - 0.04, g + 0.04, H + 0.2 + 2 * g, H + 0.28 + 2 * g, ir, "lid")
    hz = H + 0.2 + g
    hcyl(0, -g - 0.25, hz, 0.13, 0.55, "y", wd, n=16, name="shaft")       # the wooden hub shaft to the wheel
    HUB[0] = (0, -g - 0.55, hz)
    # tail: a rod back toward +y, rising a little, with the flat red vane in the y-z plane
    o = hcyl(0, g + 0.8, hz + 0.1, 0.045, 1.6, "y", ir, n=8, name="tailrod")
    box(-0.03, 0.03, g + 1.3, g + 2.4, hz - 0.3, hz + 0.65, vn, "vane")


BUILD = {"fort-santiago": fort_santiago, "paoay-church": paoay_church, "magellans-cross": magellans_cross,
         "rizal-monument": rizal_monument, "windpump": windpump}
# Real proportions now (owner 24 Nov: "closer to the real place"): no stretch; size comes from the base widths.
HEIGHTS = {}
FIG_SCALE = 1.0
if NAME != "windpump":
    pass
BUILD[NAME]()
ZS, Z0 = HEIGHTS.get(NAME, (1.0, 0))
up = lambda z: z if z <= Z0 else Z0 + (z - Z0) * ZS
for o in list(scene.objects):
    if o.type != "MESH" or o.name.startswith("slab"): continue
    vs = o.data.vertices
    if o.get("grp"):
        (ax, ay, az), f = GROUPS[o["grp"]]
        for v in vs:
            v.co = Vector((ax + (v.co.x - ax) * f, ay + (v.co.y - ay) * f, up(az) + (v.co.z - az) * f))
    elif o.get("round"):
        zb = min(v.co.z for v in vs); dz = up(zb) - zb
        for v in vs: v.co.z += dz
    else:
        for v in vs:
            v.co.z = up(v.co.z)

# remove any leftover cutter objects
for o in list(scene.objects):
    if o.data and o.data.materials and o.data.materials[0].name.startswith("cutter"):
        bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------------------------------------------- camera
cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_d); scene.collection.objects.link(cam); scene.camera = cam
cam.rotation_euler = (math.radians(60), 0, math.radians(45))
bpy.context.view_layer.update()
Rm = cam.rotation_euler.to_matrix()
right, up, fwd = Rm @ Vector((1, 0, 0)), Rm @ Vector((0, 1, 0)), Rm @ Vector((0, 0, -1))
pts = []
for o in scene.objects:
    if o.type != "MESH": continue
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        pts.append((p.dot(right), p.dot(up)))
u0, u1 = min(p[0] for p in pts), max(p[0] for p in pts)
v0, v1 = min(p[1] for p in pts), max(p[1] for p in pts)
span = max(u1 - u0, v1 - v0) * 1.10
cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
cam.location = right * cu + up * cv - fwd * 60
cam_d.ortho_scale = span
cam_d.clip_end = 200

r = scene.render
r.engine = "CYCLES"; r.resolution_x = r.resolution_y = SIZE; r.film_transparent = True
r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGBA"; r.filepath = OUT
scene.cycles.samples = 96
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "CUDA"; prefs.get_devices()
    for d in prefs.devices: d.use = d.type == "CUDA"
    scene.cycles.device = "GPU"
except Exception as e:
    print("GPU setup failed", e)
scene.view_settings.view_transform = "Standard"

# light: key sun from the upper left (viewer's), soft sky fill
sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 5.0; sun_d.angle = math.radians(8)
sun = bpy.data.objects.new("sun", sun_d); scene.collection.objects.link(sun)
L = Vector((-0.45, -0.75, 0.8)).normalized()   # toward the light: upper left on screen
sun.rotation_euler = L.to_track_quat("Z", "Y").to_euler()
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.58, 0.65, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35

# slab corners in pixels (image y down)
def px(p):
    q = Vector(p) - cam.location
    return ((q.dot(right) / span + 0.5) * SIZE, (0.5 - q.dot(up) / span) * SIZE)
corners = {k: px(p) for k, p in (("front", (5, -5, -SLAB_T)), ("left", (-5, -5, -SLAB_T)), ("right", (5, 5, -SLAB_T)),
                                 ("front_top", (5, -5, 0)), ("left_top", (-5, -5, 0)), ("right_top", (5, 5, 0)))}
corners["zs"] = ZS; corners["z0"] = Z0
corners["centre"] = px((0, 0, 0))
if HUB[0]: corners["hub"] = px(HUB[0]); corners["hub3"] = list(HUB[0])
corners["span"] = span
print("CORNERS " + json.dumps(corners))
bpy.ops.render.render(write_still=True)
