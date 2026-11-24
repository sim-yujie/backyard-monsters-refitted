"""Exact block-out renders of the wonders at the yard's camera (Blender, Cycles on one GPU).

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


# ---------------------------------------------------------------------------------------------------- wonders
STONE = (0.55, 0.47, 0.36)
GREY = (0.50, 0.47, 0.42)
WOOD = (0.30, 0.17, 0.08)
DARK = (0.05, 0.04, 0.035)
TERRA = (0.55, 0.20, 0.10)
MARBLE = (0.85, 0.80, 0.70)
SAND = (0.78, 0.62, 0.40)
BRONZE = (0.22, 0.17, 0.10)


def fort_santiago():
    st = mat("stone", STONE); sl = mat("slab", GREY); wd = mat("wood", WOOD, 0.7); dk = mat("dark", DARK)
    slab(sl)
    # gatehouse on the left-front face (y = -5 side), most of the way toward the front corner
    gx0, gx1, gy0, gy1, gh = -2.3, 2.9, -4.6, -2.1, 4.1
    g = box(gx0, gx1, gy0, gy1, 0, gh, st, "gate")
    gc = (gx0 + gx1) / 2
    arch(g, "y", gc, 0, 2.0, 3.0, 0.5, gy0, fill=wd)
    # pilasters either side of the arch, a plinth and a cornice band round the gatehouse
    for px in (gx0 + 0.15, gc - 1.45, gc + 1.05, gx1 - 0.55):
        box(px, px + 0.4, gy0 - 0.18, gy0 + 0.2, 0, gh - 0.3, st, "pil")
    box(gx0 - 0.12, gx1 + 0.12, gy0 - 0.25, gy1 + 0.12, gh - 0.45, gh - 0.15, st, "cornice")
    box(gx0 - 0.1, gx1 + 0.1, gy0 - 0.22, gy1 + 0.1, 0, 0.35, st, "plinth")
    box(gc - 1.1, gc + 1.1, gy0 - 0.12, gy0 + 0.1, 3.15, 3.25 + 0.6, st, "relief")   # panel for the rider
    # curved pediment (half disc) over the middle, stone balls on it and on the corners
    ped = hcyl(gc, gy0 + 0.45, gh + 0.1, 1.45, 0.9, "y", st, name="ped")
    cut(ped, box(gc - 2, gc + 2, gy0 - 1, gy0 + 2, gh - 3, gh + 0.1, mat("cutter", (1, 0, 1))))
    box(gc - 1.55, gc + 1.55, gy0 + 0.02, gy0 + 0.88, gh - 0.2, gh + 0.14, st, "pedbase")
    sphere(gc, gy0 + 0.45, gh + 1.82, 0.32, st)
    for sx in (gx0 + 0.35, gx1 - 0.35):
        box(sx - 0.35, sx + 0.35, gy0 + 0.1, gy0 + 0.8, gh - 0.15, gh + 0.35, st, "ballbase")
        sphere(sx, gy0 + 0.45, gh + 0.68, 0.3, st)
    # left wall stub to the left corner, right wall along the right-front face to the right corner
    wl = box(-4.7, gx0, -4.4, -3.0, 0, 2.9, st, "wallL")
    wr = box(3.3, 4.7, gy1 - 0.6, 4.7, 0, 2.9, st, "wallR")
    for (x, y) in ((-4.0, -3.7), (4.0, gy1 + 0.2), (4.0, 4.0)):
        box(x - 0.35, x + 0.35, y - 0.35, y + 0.35, 2.9, 3.3, st, "fbase")
        pyramid(x, y, 3.3, 0.3, 0.9, st)


def paoay_church():
    st = mat("stone", (0.58, 0.45, 0.30)); br = mat("brick", (0.50, 0.30, 0.20)); sl = mat("slab", GREY)
    rf = mat("roof", TERRA, 0.7); dk = mat("dark", DARK); wd = mat("wood", WOOD, 0.7)
    slab(sl)
    # nave: long axis along +y (back), its gable facade on the left-front face (y = -4.6)
    nx0, nx1, ny0, ny1, nh = -4.5, 0.4, -4.3, 3.0, 3.0
    nave = box(nx0, nx1, ny0, ny1, 0, nh, br, "nave")
    # pitched roof along y
    bm = bmesh.new()
    pts = [(nx0 - 0.15, nh), ((nx0 + nx1) / 2, nh + 2.0), (nx1 + 0.15, nh)]
    for yv in (ny0 + 0.2, ny1 + 0.15):
        pass
    vs = [[bm.verts.new((x, yv, z)) for x, z in pts] for yv in (ny0 + 0.25, ny1 + 0.15)]
    bm.faces.new((vs[0][0], vs[1][0], vs[1][1], vs[0][1])); bm.faces.new((vs[0][1], vs[1][1], vs[1][2], vs[0][2]))
    bm.faces.new((vs[0][2], vs[0][1], vs[0][0])); bm.faces.new((vs[1][0], vs[1][1], vs[1][2]))
    obj_from_bm(bm, "roof", rf)
    # the big stepped facade, a bit wider than the nave, with pilasters, finials and an arched door
    fy0, fy1 = -4.75, -4.15
    f = box(nx0 - 0.3, nx1 + 0.3, fy0, fy1, 0, 3.6, st, "facade")
    box(nx0 + 0.4, nx1 - 0.4, fy0, fy1, 3.6, 4.7, st, "facade2")
    box(nx0 + 1.3, nx1 - 1.3, fy0, fy1, 4.7, 5.6, st, "facade3")
    fc = (nx0 + nx1) / 2
    arch(f, "y", fc, 0, 1.2, 2.1, 0.35, fy0, fill=dk)
    arch(f, "y", fc, 2.6, 0.55, 0.95, 0.2, fy0, fill=dk)
    for px in (nx0 - 0.3, nx0 + 0.7, nx1 - 1.1, nx1 - 0.1):
        box(px, px + 0.4, fy0 - 0.15, fy1, 0, 3.75, st, "pil")
        pyramid(px + 0.2, fy0 + 0.15, 3.75, 0.2, 0.8, st)
    for px in (nx0 + 0.45, nx1 - 0.85):
        pyramid(px + 0.2, fy0 + 0.3, 4.7, 0.2, 0.8, st)
    pyramid(fc, fy0 + 0.3, 5.6, 0.25, 0.9, st)
    box(nx0 - 0.4, nx1 + 0.4, fy0 - 0.2, fy1 + 0.05, 2.25, 2.45, st, "band")
    # the huge stepped buttresses along the nave's right side (toward the right-front face)
    for yb in (-3.3, -1.5, 0.3, 2.1):
        for k, (dx, hz) in enumerate(((1.5, 0.9), (1.05, 1.8), (0.6, 2.7))):
            box(nx1, nx1 + dx, yb, yb + 0.95, 0, hz, st, "buttress")
    # the separate bell tower near the right corner: three storeys, arched openings, a small dome
    tx0, tx1, ty0, ty1 = 1.9, 4.5, 0.9, 3.5
    tc = ((tx0 + tx1) / 2, (ty0 + ty1) / 2)
    z = 0
    for k, hh in enumerate((2.6, 2.2, 2.0)):
        s = 0.12 * k
        t = box(tx0 + s, tx1 - s, ty0 + s, ty1 - s, z, z + hh, st, "tower")
        if k > 0:
            arch(t, "y", tc[0], z + 0.35, 0.9, 1.5, 0.5, ty0 + s, fill=dk)
            arch(t, "x", tc[1], z + 0.35, 0.9, 1.5, 0.5, tx1 - s, fill=dk)
        box(tx0 + s - 0.15, tx1 - s + 0.15, ty0 + s - 0.15, ty1 - s + 0.15, z + hh - 0.25, z + hh, st, "ledge")
        z += hh
    for (x, y) in ((tx0 + 0.45, ty0 + 0.45), (tx1 - 0.45, ty0 + 0.45), (tx1 - 0.45, ty1 - 0.45)):
        pyramid(x, y, z, 0.15, 0.55, st)
    cyl(tc[0], tc[1], z, z + 0.5, 1.0, st, n=16)
    sphere(tc[0], tc[1], z + 0.5, 1.0, mat("dome", (0.55, 0.28, 0.16)), sz=0.9)
    sphere(tc[0], tc[1], z + 1.55, 0.18, st)


def magellans_cross():
    st = mat("stone", (0.80, 0.74, 0.62)); sl = mat("slab", GREY); rf = mat("roof", TERRA, 0.7)
    wd = mat("wood", (0.28, 0.14, 0.07), 0.7)
    slab(sl)
    box(-4.3, 4.3, -4.3, 4.3, 0, 0.4, mat("step", (0.55, 0.52, 0.46)), "step1")
    box(-3.6, 3.6, -3.6, 3.6, 0.4, 0.8, mat("step", (0.55, 0.52, 0.46)), "step2")
    z0, R = 0.8, 3.4
    # octagonal arcade: a face toward the camera (as before), so its neighbours run along the grid
    ring = cyl(0, 0, z0, z0 + 3.6, R, st, n=8, rot=22.5 + 45, name="ring")
    cut(ring, cyl(0, 0, z0 - 0.1, z0 + 3.7, R - 0.45, mat("cutter", (1, 0, 1)), n=8, rot=22.5 + 45))
    for k in range(8):
        a = math.radians(k * 45 - 45)   # face normal directions, one at -45 deg = toward the camera (+x, -y)
        nx, ny = math.cos(a), math.sin(a)
        apo = R * math.cos(math.radians(22.5))
        # cutter: a box + half cylinder, rotated to the face
        cm = mat("cutter", (1, 0, 1))
        b = box(-0.95, 0.95, -0.6, 0.6, -0.1, 2.0, cm)
        top = hcyl(0, 0, 2.0, 0.95, 1.2, "y", cm)
        mod = b.modifiers.new("u", "BOOLEAN"); mod.operation = "UNION"; mod.object = top; mod.solver = "EXACT"
        bpy.context.view_layer.objects.active = b; bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(top, do_unlink=True)
        b.rotation_euler = (0, 0, a - math.pi / 2)
        b.location = (nx * apo, ny * apo, z0)
        bpy.context.view_layer.update()
        bpy.context.view_layer.objects.active = b
        bpy.ops.object.select_all(action="DESELECT"); b.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        cut(ring, b)
    # capitals/plinths on the pillars: a cornice ring
    cyl(0, 0, z0 + 3.3, z0 + 3.6, R + 0.15, st, n=8, rot=22.5 + 45)
    cyl(0, 0, z0, z0 + 0.3, R + 0.12, st, n=8, rot=22.5 + 45)
    # eight-sided tiled roof with a little cupola and ball
    zr = z0 + 3.6
    cyl(0, 0, zr, zr + 2.0, R + 1.0, rf, n=8, r2=0.7, rot=22.5 + 45)
    cyl(0, 0, zr + 2.0, zr + 2.75, 0.7, st, n=8, rot=22.5 + 45)
    cyl(0, 0, zr + 2.75, zr + 3.35, 0.95, rf, n=8, r2=0.05, rot=22.5 + 45)
    sphere(0, 0, zr + 3.45, 0.18, rf)
    # the cross on a round pedestal in the middle
    cyl(0, 0, z0, z0 + 0.8, 0.55, st, n=16)
    box(-0.12, 0.12, -0.12, 0.12, z0 + 0.8, z0 + 3.3, wd, "cross")
    box(-0.12, 0.12, -0.75, 0.75, z0 + 2.4, z0 + 2.62, wd, "crossbar")


def pyramids():
    sd = mat("sand", SAND); sl = mat("slab", (0.70, 0.58, 0.40)); sp = mat("sphinx", (0.72, 0.57, 0.38))
    slab(sl)
    # the Great Pyramid: stepped courses, base edges along the grid, centred toward the back
    cx, cy, half, H, n = 0.6, 0.9, 3.6, 4.6, 16
    for k in range(n):
        hk = half * (1 - k / n)
        box(cx - hk, cx + hk, cy - hk, cy + hk, H * k / n, H * (k + 1) / n, sd, "course")
    pyramid(cx, cy, H * (n - 1) / n, half / n * 1.0, H / n * 1.2, sd)
    # the Sphinx near the left corner, lying along the y axis, facing -y (the lower left on screen, like the
    # Fort's gate), big beside the pyramid as in the old design
    k = 1.55; sx, sy0 = -3.25, -4.6
    GROUP[0] = "sphinx"; GROUPS["sphinx"] = ((sx, sy0 + 2.0 * k, 0.0), 1.3)
    E = lambda dx, dy, z, rx, ry, rz, nm: ellip(sx + dx * k, sy0 + dy * k, z * k, rx * k, ry * k, rz * k, sp, nm)
    E(0, 2.1, 0.5, 0.55, 1.35, 0.52, "body")
    E(0, 3.1, 0.45, 0.6, 0.55, 0.45, "haunch")
    for d in (-0.33, 0.33):
        E(d, 0.6, 0.17, 0.17, 0.75, 0.17, "paw")
    E(0, 1.15, 0.75, 0.5, 0.5, 0.72, "chest")
    E(0, 1.05, 1.72, 0.3, 0.33, 0.4, "head")
    cyl(sx, sy0 + 1.15 * k, 1.05 * k, 2.05 * k, 0.55 * k, sp, n=4, r2=0.36 * k, rot=45, name="nemes")
    cut(bpy.data.objects["nemes"], box(sx - 2, sx + 2, sy0 - 1, sy0 + 1.0 * k, 0.9 * k, 2.2 * k, mat("cutter", (1, 0, 1))))
    GROUP[0] = None


def taj_mahal():
    mb = mat("marble", MARBLE, 0.6); sl = mat("slab", (0.80, 0.74, 0.64)); dk = mat("dark", (0.30, 0.26, 0.22))
    slab(sl)
    box(-4.8, 4.8, -4.8, 4.8, 0, 0.9, mb, "plinth")
    # main hall: square with chamfered corners, an iwan (big pointed arch) on each front face
    B, c = 3.5, 1.05
    hall2 = box(-B, B, -B, B, 0.9, 4.0, mb, "hall")
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):   # chamfered corners
        cut(hall2, cyl(B * sx, B * sy, 0.8, 4.1, c, mat("cutter", (1, 0, 1)), n=4, rot=0))
    for face, at in (("y", -B), ("x", B)):
        arch(hall2, face, 0, 1.2, 2.1, 2.7, 0.5, at, fill=dk)
        for s in (-2.05, 2.05):
            arch(hall2, face, s, 1.25, 0.7, 1.0, 0.2, at, fill=dk)
            arch(hall2, face, s, 2.6, 0.7, 1.0, 0.2, at, fill=dk)
    box(-B - 0.08, B + 0.08, -B - 0.08, B + 0.08, 3.85, 4.15, mb, "parapet")
    # drum, onion dome, finial
    cyl(0, 0, 4.15, 5.0, 1.95, mb, n=32)
    GROUP[0] = "dome"; GROUPS["dome"] = ((0, 0, 5.0), 1.0)   # dome + finial move up together, unstretched
    onion(0, 0, 5.0, 2.4, 4.3, mb)
    cyl(0, 0, 9.2, 9.9, 0.07, mat("gold", (0.6, 0.45, 0.15), 0.4, 0.8))
    GROUP[0] = None
    # four small domed kiosks on the roof corners
    for (x, y) in ((-2.55, -2.55), (2.55, -2.55), (2.55, 2.55), (-2.55, 2.55)):
        cyl(x, y, 4.15, 4.95, 0.6, mb, n=8)
        onion(x, y, 4.95, 0.68, 1.0, mb)
    # four minarets on the plinth corners
    for (x, y) in ((-4.2, -4.2), (4.2, -4.2), (4.2, 4.2), (-4.2, 4.2)):
        cyl(x, y, 0.9, 5.6, 0.36, mb, n=20, r2=0.3)
        for zb in (2.4, 3.9, 5.4):
            cyl(x, y, zb, zb + 0.18, 0.5, mb, n=20)
        cyl(x, y, 5.6, 6.1, 0.33, mb, n=8)
        onion(x, y, 6.1, 0.42, 0.75, mb)


def rizal_monument():
    gr = mat("granite", (0.55, 0.53, 0.50)); sl = mat("slab", GREY); bz = mat("bronze", BRONZE, 0.45, 0.6)
    slab(sl)
    for k, (h, z) in enumerate(((4.4, 0), (3.6, 0.45), (2.8, 0.9))):
        box(-h, h, -h, h, z, z + 0.45, gr, "step")
    box(-2.0, 2.0, -2.0, 2.0, 1.35, 2.6, gr, "pedestal")
    box(-2.15, 2.15, -2.15, 2.15, 2.45, 2.7, gr, "pedcap")
    # the tall obelisk (tapered square shaft) with a small pyramid tip
    cyl(0, 0, 2.7, 10.6, 1.45 * math.sqrt(2), gr, n=4, r2=0.85 * math.sqrt(2), rot=45, name="obelisk")
    pyramid(0, 0, 10.6, 0.85, 0.9, gr)
    # Rizal standing on the pedestal in front of the obelisk (left-front face); seated figures on the top step
    S = 1.75
    def fig(ox, oy, oz, parts):
        GROUP[0] = f"fig{ox}"; GROUPS[GROUP[0]] = ((ox, oy, oz), FIG_SCALE)
        for kind, a in parts:
            if kind == "c": cyl(ox + a[0] * S, oy + a[1] * S, oz + a[2] * S, oz + a[3] * S, a[4] * S, bz, n=16, r2=a[5] * S)
            elif kind == "e": ellip(ox + a[0] * S, oy + a[1] * S, oz + a[2] * S, a[3] * S, a[4] * S, a[5] * S, bz)
            else: box(ox + a[0] * S, ox + a[1] * S, oy + a[2] * S, oy + a[3] * S, oz + a[4] * S, oz + a[5] * S, bz)
        GROUP[0] = None
    fig(1.35, -1.35, 2.7, [("c", (-0.09, -0.09, 0, 0.9, 0.11, 0.11)), ("c", (0.09, 0.09, 0, 0.9, 0.11, 0.11)),
                           ("c", (0, 0, 0.6, 1.75, 0.36, 0.27)), ("e", (0, 0, 1.75, 0.22, 0.34, 0.14)),
                           ("c", (0, 0, 1.8, 1.95, 0.08, 0.08)), ("e", (0, 0, 2.07, 0.14, 0.13, 0.17)),
                           ("b", (0.05, 0.3, -0.42, -0.3, 1.0, 1.35))])
    fig(-1.2, -2.55, 1.35, [("c", (0, 0, 0, 0.85, 0.5, 0.24)), ("e", (0, 0, 0.95, 0.2, 0.26, 0.16)),
                            ("e", (0, 0, 1.17, 0.13, 0.12, 0.15)), ("e", (0.2, -0.15, 0.65, 0.18, 0.12, 0.2))])
    fig(2.55, 1.2, 1.35, [("c", (0, 0, 0, 0.6, 0.38, 0.2)), ("e", (0, 0, 0.72, 0.15, 0.2, 0.13)),
                           ("e", (0, 0, 0.9, 0.11, 0.1, 0.12)), ("b", (-0.1, 0.15, -0.4, -0.22, 0.35, 0.6))])


BUILD = {"fort-santiago": fort_santiago, "paoay-church": paoay_church, "magellans-cross": magellans_cross,
         "pyramids": pyramids, "taj-mahal": taj_mahal, "rizal-monument": rizal_monument}
# Heights: the approved designs stand taller over their bases than these block-outs; every structure is
# stretched upward by ZS (the slab is not), round parts (balls, domes, heads) keep their shape and only move up,
# and figure groups (statues, the Sphinx) are scaled as a whole by their own factor about their foot.
# (stretch, from height): the steps / plinth below 'from' keep their height
HEIGHTS = {"fort-santiago": (1.6, 0), "paoay-church": (1.26, 0), "magellans-cross": (1.67, 0.8), "pyramids": (1.73, 0),
           "taj-mahal": (1.75, 0.9), "rizal-monument": (2.22, 1.35)}
FIG_SCALE = 2.0
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
print("CORNERS " + json.dumps(corners))
bpy.ops.render.render(write_still=True)
