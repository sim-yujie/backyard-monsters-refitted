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
import os
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
    """Fort Santiago's main gate (refs/fort-santiago/): the pale carved frontispiece set into a LONG, dark, battered
    curtain wall that runs out to both slab edges in the gate's own plane, its top level with the gate's lower
    cornice. Proportions measured on refs/fort-santiago/front.jpg (1 px = 0.0101 units, total height 8.5).
    The gate front faces the lower left (plane y = FY)."""
    st = mat("stone", (0.66, 0.63, 0.57)); wl = mat("wall", (0.27, 0.25, 0.22)); sl = mat("slab", (0.52, 0.42, 0.36))
    dk = mat("dark", DARK)
    slab(sl)
    FY = -2.0                      # the gate's front plane
    K = 0.85                       # the whole gate scaled down a little so the long wall shows either side
    W = 3.25                       # half width of the carved lower tier (before K)
    H1, H2 = 4.25, 2.78            # lower tier to the top of its cornice; upper tier to the top of its cornice
    WF0, WB = FY + 0.75, FY + 3.6  # (before K) the wall's face at its foot, the gate block's back
    WH = 4.1                       # (before K) wall top: level with the lower cornice
    before = set(o.name for o in scene.objects)
    # the gate block: through the wall, front at FY
    g = box(-W, W, FY, WB - 0.3, 0, H1 - 0.3, st, "gate")
    # battered flanks either side of the lower tier: wedges from the wall face out, sloping from the ground up
    for s in (-1, 1):
        prof = [(s * W, 0), (s * 4.25, 0), (s * W, 3.35)]
        if s < 0: prof = list(reversed(prof))
        prism_xz(prof, FY + 0.05, WF0 + 0.2, st, "flank")
    # the arched passage: 1.92 wide, crown at 1.97 (a round arch), dark inside
    arch(g, "y", 0, 0, 1.92, 1.97, WB - FY, FY, fill=None)
    box(-0.96, 0.96, WB - 0.35, WB + 0.4, 0, 0.02, dk, "passage")
    # the moulded arch frame (voussoirs) round the opening
    fr = box(-1.32, 1.32, FY - 0.12, FY + 0.02, 0, 2.33, st, "archframe")
    arch(fr, "y", 0, 0, 1.92, 1.97, 0.3, FY - 0.15, fill=None)
    # plinth and the heavy lower cornice
    box(-W - 0.1, W + 0.1, FY - 0.14, WF0, 0, 0.32, st, "plinth")
    box(-W - 0.2, W + 0.2, FY - 0.3, WF0 + 0.1, H1 - 0.3, H1, st, "cornice1")
    # paired pilasters either side of the arch, and the carved figure strips at the far ends
    for x0, x1 in ((-2.5, -1.99), (-1.99, -1.39), (1.34, 1.95), (1.95, 2.56)):
        box(x0, x1, FY - 0.2, FY + 0.05, 0.32, H1 - 0.3, st, "pil")
    for x0, x1 in ((-3.16, -2.55), (2.56, 3.22)):
        box(x0, x1, FY - 0.12, FY + 0.05, 0.32, H1 - 0.3, st, "figstrip")
        ellip((x0 + x1) / 2, FY - 0.14, 1.5, 0.22, 0.08, 0.55, st, "figure")
        ellip((x0 + x1) / 2, FY - 0.14, 3.3, 0.24, 0.08, 0.3, st, "trophy")
    # the royal coat of arms (crowned shield) over the arch, and a smaller shield on each spandrel
    box(-0.48, 0.48, FY - 0.24, FY + 0.05, 2.63, 3.65, st, "arms")
    ellip(0, FY - 0.2, 3.8, 0.42, 0.1, 0.17, st, "crown")
    for cx in (-1.0, 0.99):
        box(cx - 0.29, cx + 0.29, FY - 0.18, FY + 0.05, 2.12, 2.95, st, "shield")
        ellip(cx, FY - 0.15, 3.02, 0.26, 0.08, 0.1, st, "scrown")
    # upper tier: narrower, the framed relief of Saint James on horseback, pilasters, a frieze, its cornice
    U = 1.72
    up_ = box(-U, U, FY + 0.1, FY + 0.95, H1, H1 + H2 - 0.25, st, "upper")
    cut(up_, box(-0.93, 0.93, FY + 0.0, FY + 0.38, H1 + 0.1, H1 + 1.67, mat("cutter", (1, 0, 1))))
    for x0, x1 in ((-U - 0.08, -1.32), (1.28, U + 0.08)):
        box(x0, x1, FY - 0.12, FY + 0.3, H1, H1 + H2 - 0.25, st, "pil2")
    box(-1.0, 1.0, FY - 0.08, FY + 0.12, H1 + 1.67, H1 + 1.82, st, "panelframe")
    box(-U - 0.15, U + 0.15, FY - 0.2, FY + 1.05, H1 + H2 - 0.25, H1 + H2, st, "cornice2")
    # the rider relief inside the panel (a rough lump for Codex to sculpt): a rearing horse, the rider, his sword
    ellip(0.05, FY + 0.32, H1 + 0.8, 0.6, 0.1, 0.28, st, "horse")
    for hx in (-0.3, 0.42):
        box(hx - 0.07, hx + 0.07, FY + 0.28, FY + 0.4, H1 + 0.2, H1 + 0.7, st, "leg")
    ellip(-0.55, FY + 0.32, H1 + 1.15, 0.14, 0.09, 0.24, st, "hhead")
    ellip(0.12, FY + 0.3, H1 + 1.25, 0.13, 0.09, 0.3, st, "rider")
    box(0.18, 0.75, FY + 0.28, FY + 0.36, H1 + 1.45, H1 + 1.52, st, "sword")
    # big scrolls (volutes) and sloping wings from the upper tier's sides down to the lower cornice ends
    for s in (-1, 1):
        prof = [(s * U, H1)]
        for i in range(0, 9):
            t = i / 8
            prof.append((s * (U + 1.15 * (1 - t) ** 0.7), H1 + 2.0 * t ** 1.5))
        if s > 0: prof = list(reversed(prof))
        prism_xz(prof, FY + 0.1, FY + 0.6, st, "scroll")
        pinnacle(s * 2.9, FY + 0.2, H1, 0.2, 0.86, st)            # tall finials on the lower cornice's ends
        pinnacle(s * 1.5, FY + 0.15, H1 + H2, 0.14, 0.6, st)      # small ones on the upper cornice's corners
    # pediment: a low triangle with slightly curved sides and a carved centre, a pointed finial on top
    prof = [(-U - 0.05, H1 + H2), (U + 0.05, H1 + H2)]
    for i in range(1, 8):
        t = i / 8
        prof.append(((U + 0.05) * (1 - t), H1 + H2 + 0.86 * (1 - (1 - t) ** 1.3)))
    prof.append((0, H1 + H2 + 0.86))
    for i in range(7, 0, -1):
        t = i / 8
        prof.append((-(U + 0.05) * (1 - t), H1 + H2 + 0.86 * (1 - (1 - t) ** 1.3)))
    prism_xz(prof, FY - 0.05, FY + 0.6, st, "pediment")
    ellip(0, FY - 0.08, H1 + H2 + 0.35, 0.3, 0.08, 0.22, st, "cartouche")
    pinnacle(0, FY + 0.25, H1 + H2 + 0.78, 0.13, 0.62, st)
    for o in scene.objects:                      # scale the gate about (0, FY, 0)
        if o.type != "MESH" or o.name in before: continue
        for v in o.data.vertices:
            v.co = Vector((v.co.x * K, FY + (v.co.y - FY) * K, v.co.z * K))
    # the curtain wall, both sides of the gate, out to the slab edges: a battered face, a flat walk on top
    wf0, wf1, wb, wh = FY + 0.75 * K, FY + 1.1 * K, FY + 0.75 * K + 2.1, WH * K
    for s in (-1, 1):
        x0, x1 = sorted((s * (W - 0.2) * K, s * 4.95))
        prism_yz([(wf0, 0), (wb, 0), (wb, wh), (wf1, wh)], x0, x1, wl, "wall")
        box(x0, x1, wf1, wf1 + 0.4, wh, wh + 0.28, wl, "parapet")


def paoay_church():
    """Paoay Church (refs/paoay-church/): a wide, low, near-triangular facade flanked by huge sloping corner
    buttresses; a row of massive scroll-ended buttresses with finials along the nave's (visible) right side; a long
    red roof below the gable; and the stocky square bell tower standing APART on the facade's LEFT (seen from the
    front), level with the facade, 1.4x its height. Proportions from refs/paoay-church/front.jpg and
    front-with-tower.jpg: facade 6.04 wide x 3.65 tall; tower 0.39 x the facade's width, gap 0.14 x."""
    st = mat("coral", (0.78, 0.76, 0.71)); tw = mat("tower", (0.74, 0.72, 0.67)); sl = mat("slab", GREY)
    rf = mat("roof", (0.62, 0.12, 0.16), 0.7); dk = mat("dark", DARK); wd = mat("wood", WOOD, 0.7)
    slab(sl)
    fc = 1.53                                   # facade centre (x)
    fy0 = -3.55                                 # facade front plane
    HB, HC, HT = 1.61, 2.13, 3.12               # main cornice, top of the 2nd tier (gable base), gable apex
    B1, B2, BG = 2.42, 2.05, 1.9                # half widths: lower tier, 2nd tier, gable base
    nx0, nx1, ny1 = fc - B1 + 0.15, fc + B1 - 0.15, 3.9     # the nave (a little shorter than real, to fit)
    eave, ridge = 1.75, 2.25                    # the ridge about level with the gable's base (aerial)
    box(nx0, nx1, fy0 + 0.5, ny1, 0, eave, st, "nave")
    nc = (nx0 + nx1) / 2
    prism_xz([(nx0 - 0.2, eave - 0.05), (nx1 + 0.2, eave - 0.05), (nc, ridge)], fy0 + 0.6, ny1 + 0.15, rf, "roof")
    # the facade: lower tier, 2nd tier, stepped gable, the small square belfry on the apex
    f = box(fc - B1, fc + B1, fy0, fy0 + 0.75, 0, HB, st, "facade")
    box(fc - B1 - 0.06, fc + B1 + 0.06, fy0 - 0.12, fy0 + 0.75, HB - 0.12, HB + 0.02, st, "cornice")
    f2 = box(fc - B2, fc + B2, fy0 + 0.05, fy0 + 0.75, HB, HC, st, "tier2")
    box(fc - B2 - 0.05, fc + B2 + 0.05, fy0 - 0.05, fy0 + 0.75, HC - 0.08, HC + 0.02, st, "band2")
    # the gable: a broad triangle from the 2nd tier up to the apex, small finials stepping up both edges
    prism_xz([(fc - BG, HC), (fc + BG, HC), (fc, HT)], fy0 + 0.1, fy0 + 0.72, st, "gable")
    for t, h in ((0.22, 0.4), (0.45, 0.34), (0.68, 0.28)):
        for s in (-1, 1):
            pinnacle(fc + s * BG * (1 - t), fy0 + 0.35, HC + (HT - HC) * t - 0.08, 0.1, h, st)
    for s in (-1, 1):                            # the bigger finials at the 2nd tier's outer corners
        pinnacle(fc + s * (B2 + 0.05), fy0 + 0.3, HC, 0.16, 0.5, st)
    bel = box(fc - 0.2, fc + 0.2, fy0 + 0.15, fy0 + 0.55, HT - 0.15, HT + 0.37, st, "belfry")
    arch(bel, "y", fc, HT - 0.02, 0.18, 0.3, 0.12, fy0 + 0.15, fill=dk)
    pyramid(fc, fy0 + 0.35, HT + 0.37, 0.24, 0.17, st)
    # door, the three 2nd-tier windows, the gable niche
    arch(f, "y", fc, 0, 0.66, 0.95, 0.25, fy0, fill=wd)
    for wx in (fc - 0.97, fc, fc + 0.99):
        arch(f2, "y", wx, HB + 0.08, 0.22, 0.4, 0.2, fy0 + 0.05, fill=dk)
    # tall pilasters dividing the facade into bays
    for ox in (-2.15, -1.45, -0.75, 0.6, 1.3, 2.0):
        box(fc + ox, fc + ox + 0.15, fy0 - 0.1, fy0 + 0.05, 0, HB - 0.1, st, "pil")
    for ox in (-1.9, -1.2, 1.05, 1.75):
        box(fc + ox, fc + ox + 0.12, fy0 - 0.03, fy0 + 0.1, HB, HC - 0.08, st, "pil2")
    # the huge corner buttresses flanking the facade: concave slopes from the ground up to the main cornice
    def corner(s):
        x1 = fc + s * B1
        prof = [(x1, 0), (fc + s * 3.02, 0), (fc + s * 3.02, 0.22)]
        for i in range(1, 9):
            t = i / 8
            prof.append((fc + s * (3.02 - 0.6 * t ** 0.55), 0.22 + (HB - 0.22) * t))
        prof.append((x1, HB))
        if s < 0: prof = list(reversed(prof))
        prism_xz(prof, fy0 + 0.02, fy0 + 1.3, st, "cbutt")
    corner(-1); corner(1)
    # the massive buttresses along the nave's right side: tall at the wall, sweeping down and out to a rounded
    # scroll foot, a finial on top of each (refs: side-buttresses.jpg, buttress-closeup.jpg)
    def buttress(y0, y1, depth=0.95, top=eave + 0.08):
        prof = [(nx1 - 0.05, 0), (nx1 + depth, 0), (nx1 + depth, 0.35)]
        for i in range(1, 9):
            t = i / 8
            prof.append((nx1 + depth * (1 - 0.82 * t ** 0.8), 0.35 + (top - 0.35) * t))
        prof.append((nx1 - 0.05, top))
        prism_xz(list(reversed(prof)), y0, y1, st, "buttress")
        pinnacle(nx1 + 0.2, (y0 + y1) / 2, top, 0.15, 0.42, st)
    yb = fy0 + 1.45
    while yb + 0.42 < ny1 - 0.1:
        buttress(yb, yb + 0.42)
        yb += 0.82
    # the bell tower, apart on the facade's LEFT, level with the facade: square, stepped storeys, a low dome
    tx0, tx1 = -4.7, -2.34
    ty0 = fy0 - 0.1
    ty1 = ty0 + (tx1 - tx0)
    tcx, tcy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    z = 0
    for k, (hh, inset) in enumerate(((2.09, 0.0), (1.63, 0.16), (1.07, 0.3))):
        t = box(tx0 + inset, tx1 - inset, ty0 + inset, ty1 - inset, z, z + hh, tw, "tower")
        if k == 0:
            arch(t, "y", tcx, 0, 0.45, 0.85, 0.2, ty0, fill=wd)
            arch(t, "y", tcx, 1.25, 0.22, 0.4, 0.12, ty0, fill=dk)
        else:
            w = 0.36 if k == 1 else 0.42
            arch(t, "y", tcx, z + 0.45, w, 0.62, 0.2, ty0 + inset, fill=dk)
            arch(t, "x", tcy, z + 0.45, w, 0.62, 0.2, tx1 - inset, fill=dk)
        box(tx0 + inset - 0.08, tx1 - inset + 0.08, ty0 + inset - 0.08, ty1 - inset + 0.08, z + hh - 0.14, z + hh, tw, "ledge")
        z += hh
    i3 = 0.3
    for (x, y) in ((tx0 + i3 + 0.1, ty0 + i3 + 0.1), (tx1 - i3 - 0.1, ty0 + i3 + 0.1),
                   (tx1 - i3 - 0.1, ty1 - i3 - 0.1), (tx0 + i3 + 0.1, ty1 - i3 - 0.1)):
        pinnacle(x, y, z, 0.09, 0.32, tw)
    cyl(tcx, tcy, z, z + 0.12, 0.72, tw, n=16)
    sphere(tcx, tcy, z + 0.12, 0.72, tw, sz=0.42)
    cyl(tcx, tcy, z + 0.42, z + 0.52, 0.06, tw, n=8)


def magellans_cross():
    """Magellan's Cross kiosk (refs/magellans-cross/): an octagon of coursed pale coral-stone blocks with corner
    pilasters, one big round arch in every face closed by black wrought-iron gates (the front pair open), a low
    bell-cast roof of dark red-brown clay tiles with a small iron cross on top; inside, the tall dark wooden cross on
    a tall stepped octagonal pedestal. Proportions from refs/magellans-cross/front.jpg: width / wall height 1.68,
    roof rise ~0.5 x the wall, arches 0.66 x a face wide and 0.76 x the wall tall."""
    wh = mat("coral", (0.80, 0.77, 0.70)); sl = mat("slab", GREY); rf = mat("roof", (0.40, 0.14, 0.10), 0.7)
    wd = mat("wood", (0.24, 0.15, 0.09), 0.7); ir = mat("iron", (0.05, 0.05, 0.05), 0.5, 0.6)
    stp = mat("step", (0.62, 0.60, 0.56)); ped = mat("pedestal", (0.62, 0.44, 0.36), 0.5)
    slab(sl)
    rot = 22.5 + 45            # a face toward the camera, so its neighbours run along the grid
    R = 4.25                   # corner radius of the octagon's walls
    apo = R * math.cos(math.radians(22.5))
    cyl(0, 0, 0, 0.22, R + 0.3, stp, n=8, rot=rot, name="step")
    z0, HW = 0.22, 4.67
    ring = cyl(0, 0, z0, z0 + HW, R, wh, n=8, rot=rot, name="ring")
    cut(ring, cyl(0, 0, z0 - 0.1, z0 + HW + 0.1, R - 0.45, mat("cutter", (1, 0, 1)), n=8, rot=rot))
    aw, ah = 2.15, 3.55
    for k in range(8):
        a = math.radians(k * 45 - 45)
        nx, ny = math.cos(a), math.sin(a)
        cm = mat("cutter", (1, 0, 1))
        b = box(-aw / 2, aw / 2, -0.7, 0.7, -0.1, ah - aw / 2, cm)
        top = hcyl(0, 0, ah - aw / 2, aw / 2, 1.4, "y", cm)
        mod = b.modifiers.new("u", "BOOLEAN"); mod.operation = "UNION"; mod.object = top; mod.solver = "EXACT"
        bpy.context.view_layer.objects.active = b; bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(top, do_unlink=True)
        b.rotation_euler = (0, 0, a - math.pi / 2)
        b.location = (nx * (apo - 0.22), ny * (apo - 0.22), z0)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT"); b.select_set(True)
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        cut(ring, b)
        tx, ty = -ny, nx            # along the face
        d = apo - 0.3
        spring = ah - aw / 2
        if k == 0:
            # the entrance (toward the camera): gates folded open against the jambs, the black marker plate
            # hung in the arch head (blank: no lettering)
            for s in (-1, 1):
                cx, cy = nx * (d - 0.25) + tx * s * (aw / 2 - 0.08), ny * (d - 0.25) + ty * s * (aw / 2 - 0.08)
                for j in range(4):
                    off = j * 0.14
                    px_, py_ = cx - nx * off, cy - ny * off
                    box(px_ - 0.025, px_ + 0.025, py_ - 0.025, py_ + 0.025, z0, z0 + spring, ir, "obar")
            cx, cy = nx * d, ny * d
            pl = box(-0.42, 0.42, -0.03, 0.03, spring + 0.25, spring + 0.95, ir, "plaque")
            pl.rotation_euler = (0, 0, a - math.pi / 2); pl.location = (cx, cy, z0)
            continue
        # the iron gates: vertical bars, a solid dark lower panel, a rail at the springing and a fan of radial
        # bars in the arch head
        for j in range(-4, 5):
            u = j * aw / 10
            cx, cy = nx * d + tx * u, ny * d + ty * u
            box(cx - 0.025, cx + 0.025, cy - 0.025, cy + 0.025, z0, z0 + spring, ir, "bar")
        cx, cy = nx * d, ny * d
        for zz, hh in ((0.0, 0.85), (spring - 0.04, 0.08)):
            bb = box(-aw / 2, aw / 2, -0.025, 0.025, zz, zz + hh, ir, "panel")
            bb.rotation_euler = (0, 0, a - math.pi / 2); bb.location = (cx, cy, z0)
        for j in range(1, 8):
            th = math.pi * j / 8
            L = aw / 2 - 0.05
            bb = box(-0.022, 0.022, -0.022, 0.022, 0, L, ir, "fan")
            bb.rotation_euler = (0, th - math.pi / 2, a - math.pi / 2)
            bb.rotation_euler = (0, th - math.pi / 2, a - math.pi / 2)
            bb.location = (cx, cy, z0 + spring)
    # corner pilasters, the frieze and cornice under the eaves, a plinth band
    for k in range(8):
        a = math.radians(k * 45 - 45 + 22.5)
        cx, cy = math.cos(a) * (R - 0.02), math.sin(a) * (R - 0.02)
        p = box(-0.2, 0.2, -0.2, 0.2, z0, z0 + HW - 0.5, wh, "pilaster")
        p.rotation_euler = (0, 0, a); p.location = (cx, cy, 0)
    cyl(0, 0, z0 + HW - 0.55, z0 + HW - 0.45, R + 0.1, wh, n=8, rot=rot, name="frieze")
    cyl(0, 0, z0 + HW - 0.18, z0 + HW, R + 0.16, wh, n=8, rot=rot, name="cornice")
    cyl(0, 0, z0, z0 + 0.3, R + 0.08, wh, n=8, rot=rot, name="plinth")
    cyl(0, 0, z0 + HW - 0.1, z0 + HW, R - 0.4, mat("ceil", (0.45, 0.50, 0.55)), n=8, rot=rot)
    # the roof: flared eaves, then a moderate pitch up to a small finial
    zr = z0 + HW
    cyl(0, 0, zr, zr + 0.35, R + 0.62, rf, n=8, r2=R - 0.05, rot=rot, name="eave")
    cyl(0, 0, zr + 0.35, zr + 2.35, R - 0.05, rf, n=8, r2=0.25, rot=rot, name="roof")
    cyl(0, 0, zr + 2.3, zr + 2.5, 0.22, rf, n=8, rot=rot, name="finial")
    box(-0.04, 0.04, -0.04, 0.04, zr + 2.5, zr + 3.3, ir, "topcross")
    box(-0.04, 0.04, -0.26, 0.26, zr + 2.98, zr + 3.05, ir, "topbar")
    # inside: the tall stepped octagonal pedestal and the dark wooden cross reaching toward the ceiling
    cyl(0, 0, z0, z0 + 0.3, 0.85, ped, n=8, rot=rot)
    cyl(0, 0, z0 + 0.3, z0 + 0.45, 0.7, ped, n=8, rot=rot)
    cyl(0, 0, z0 + 0.45, z0 + 1.25, 0.55, ped, n=8, rot=rot)
    cyl(0, 0, z0 + 1.25, z0 + 1.45, 0.68, ped, n=8, rot=rot)
    box(-0.12, 0.12, -0.12, 0.12, z0 + 1.45, z0 + 4.45, wd, "cross")
    box(-0.11, 0.11, -0.85, 0.85, z0 + 3.55, z0 + 3.77, wd, "crossbar")


def rizal_monument():
    """Rizal Monument (refs/rizal-monument/): a slim grey granite obelisk with three gold stars in a triangle near the
    top of its FRONT face, on a tall upper pedestal over a battered (tapering) granite base of big blocks, on a low
    plinth and two wide steps. The bronze group stands on the pedestal: Rizal in front, centred on the front face, in
    an overcoat holding a book; a seated mother with her child at the front's left corner; two seated boys reading a
    book on the obelisk's right face (RIZAL_LAYOUT below; was the front's right corner with leaves and a pot behind). Front = the left-front face (y < 0). Proportions from refs/rizal-monument/front.jpg
    (base 0.35 / obelisk 0.65 of the height; base 0.48 x the height wide; Rizal 0.245 x the height)."""
    gr = mat("granite", (0.55, 0.54, 0.51)); sl = mat("slab", GREY); bz = mat("bronze", BRONZE, 0.45, 0.6)
    gold = mat("gold", (0.85, 0.65, 0.2), 0.35, 0.9)
    slab(sl)
    box(-4.75, 4.75, -4.75, 4.75, 0, 0.25, gr, "step")
    box(-4.35, 4.35, -4.35, 4.35, 0.25, 0.5, gr, "step")
    box(-3.97, 3.97, -3.97, 3.97, 0.5, 0.82, gr, "plinth")
    S2 = math.sqrt(2)
    cyl(0, 0, 0.82, 4.47, 3.76 * S2, gr, n=4, r2=2.9 * S2, rot=45, name="base")
    box(-2.62, 2.62, -2.62, 2.62, 4.47, 4.72, gr, "ledge")
    box(-2.3, 2.3, -2.3, 2.3, 4.72, 6.05, gr, "pedestal")
    box(-2.45, 2.45, -2.45, 2.45, 6.05, 6.2, gr, "pedcap")
    zt = 6.2
    cyl(0, 0, zt, 15.67, 0.86 * S2, gr, n=4, r2=0.64 * S2, rot=45, name="obelisk")
    pyramid(0, 0, 15.67, 0.66, 0.43, gr)
    # the three stars, a triangle on the front face: one above, two below
    def hw(z): return 0.86 - 0.22 * (z - zt) / (15.67 - zt)
    for sx, sz in ((0.0, 15.3), (-0.37, 14.92), (0.37, 14.92)):
        hcyl(sx, -hw(sz) - 0.02, sz, 0.12, 0.06, "y", gold, n=5)
    # the bronze plaque on the base's front (blank)
    box(-0.8, 0.8, -3.42, -3.36, 2.45, 3.05, bz, "plaque")
    S = 1.73

    def fig(ox, oy, oz, s, parts):
        GROUP[0] = f"fig{ox}{oy}"; GROUPS[GROUP[0]] = ((ox, oy, oz), 1.0)
        for kind, a in parts:
            if kind == "c": cyl(ox + a[0] * s, oy + a[1] * s, oz + a[2] * s, oz + a[3] * s, a[4] * s, bz, n=16, r2=a[5] * s)
            elif kind == "e": ellip(ox + a[0] * s, oy + a[1] * s, oz + a[2] * s, a[3] * s, a[4] * s, a[5] * s, bz)
            else: box(ox + a[0] * s, ox + a[1] * s, oy + a[2] * s, oy + a[3] * s, oz + a[4] * s, oz + a[5] * s, bz)
        GROUP[0] = None
    # Rizal standing, facing the front (-y), in an overcoat, a book in his hand
    fig(0, -1.45, zt, S, [("c", (-0.11, 0, 0, 0.9, 0.11, 0.11)), ("c", (0.11, 0, 0, 0.9, 0.11, 0.11)),
                          ("c", (0, 0, 0.5, 1.72, 0.36, 0.26)), ("e", (0, 0, 1.72, 0.36, 0.22, 0.14)),
                          ("c", (0, 0, 1.78, 1.95, 0.08, 0.08)), ("e", (0, 0, 2.07, 0.13, 0.14, 0.17)),
                          ("b", (0.3, 0.42, -0.28, -0.04, 1.0, 1.32))])
    # the mother seated with her child at the front's left corner (-x), turned a little outward
    fig(-1.55, -1.5, zt, 1.5, [("c", (0, 0, 0, 0.55, 0.55, 0.42)), ("c", (0, 0.05, 0.5, 0.95, 0.3, 0.22)),
                               ("e", (0, 0.05, 1.08, 0.12, 0.12, 0.15)), ("e", (0.12, -0.22, 0.72, 0.16, 0.12, 0.13)),
                               ("e", (0.12, -0.25, 0.86, 0.08, 0.08, 0.08))])
    # The right-hand group. Owner 26 Nov 2026 ("The figures are supposed to be one on each side. The current one has
    # 3 on one side"): the two boys plus the leaves and pot behind them read as three figures on the right. Layouts
    # (env RIZAL_LAYOUT; art-samples/rizal-fix/): "old" = as 24 Nov; "A" = ONE seated boy reading on the obelisk's
    # right (+x) face; "B" = the two boys as one tight group at the right corner; "Bface" = the two boys on the obelisk's right
    # (+x) face like the real monument. A, B and Bface drop the leaves and pot (at the back, they read as a figure).
    lay = os.environ.get("RIZAL_LAYOUT", "Bface")   # the layout in the game since 26 Nov
    if lay == "old":
        fig(1.55, -1.5, zt, 1.5, [("c", (-0.18, 0, 0, 0.5, 0.32, 0.28)), ("c", (0.18, 0, 0, 0.5, 0.32, 0.28)),
                                  ("c", (-0.18, 0.03, 0.45, 0.82, 0.18, 0.15)), ("c", (0.18, 0.03, 0.45, 0.82, 0.18, 0.15)),
                                  ("e", (-0.18, 0.0, 0.93, 0.1, 0.1, 0.12)), ("e", (0.18, 0.0, 0.93, 0.1, 0.1, 0.12)),
                                  ("b", (-0.2, 0.2, -0.3, -0.24, 0.58, 0.68))])
        # at the back, leaves and a pot (the country's natural resources)
        fig(0, 1.45, zt, 1.5, [("c", (0, 0, 0, 0.45, 0.32, 0.38)), ("e", (0, 0, 0.95, 0.55, 0.3, 0.5))])
    elif lay == "A":
        # ONE boy seated on the obelisk's right face, facing out (+x), bent over an open book on his lap
        fig(1.6, -0.35, zt, 1.5, [("c", (0, 0, 0, 0.5, 0.42, 0.34)), ("c", (-0.04, 0, 0.45, 0.88, 0.22, 0.17)),
                                  ("e", (0.02, 0, 1.0, 0.11, 0.11, 0.13)),
                                  ("b", (0.26, 0.36, -0.22, 0.22, 0.56, 0.66))])
    elif lay == "B":
        # the two boys shoulder to shoulder over one book: one compact mass, no wider than the mother's group
        fig(1.55, -1.5, zt, 1.5, [("c", (-0.13, 0, 0, 0.5, 0.3, 0.26)), ("c", (0.13, 0, 0, 0.5, 0.3, 0.26)),
                                  ("c", (-0.13, 0.03, 0.45, 0.82, 0.17, 0.14)), ("c", (0.13, 0.03, 0.45, 0.82, 0.17, 0.14)),
                                  ("e", (-0.13, 0.0, 0.93, 0.1, 0.1, 0.12)), ("e", (0.13, 0.0, 0.93, 0.1, 0.1, 0.12)),
                                  ("b", (-0.2, 0.2, -0.3, -0.24, 0.58, 0.68))])
    else:  # Bface: the two boys side by side on the right face, facing out (+x), reading one book
        fig(1.6, -0.35, zt, 1.5, [("c", (0, -0.18, 0, 0.5, 0.32, 0.28)), ("c", (0, 0.18, 0, 0.5, 0.32, 0.28)),
                                  ("c", (-0.03, -0.18, 0.45, 0.82, 0.18, 0.15)), ("c", (-0.03, 0.18, 0.45, 0.82, 0.18, 0.15)),
                                  ("e", (0, -0.18, 0.93, 0.1, 0.1, 0.12)), ("e", (0, 0.18, 0.93, 0.1, 0.1, 0.12)),
                                  ("b", (0.24, 0.3, -0.2, 0.2, 0.58, 0.68))])


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
if os.environ.get("NOSLAB"):   # rizal-fix: the same framing without the slab, to register the block-out to game art
    for o in scene.objects:
        if o.name.startswith("slab"): o.hide_render = True
bpy.ops.render.render(write_still=True)
