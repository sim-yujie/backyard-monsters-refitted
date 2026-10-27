"""laser3d.py : the Laser Tower, tiers 1-3, as a real 3D model rendered in the game's camera (owner, 27 Oct 2026: a sample).

Run with Blender 5.2 in the background (it builds the whole scene from nothing, so the model can be changed here and rebuilt):

  blender -b --factory-startup -P laser3d.py -- T body                render/tT/body-4x.png (the tower without its head)
  blender -b --factory-startup -P laser3d.py -- T head [h0 h1 ...]    render/tT/head-4x/hNN.png (the head alone at heading h,
                                                                     the body's parts in front of it cut out; default all 32)
  blender -b --factory-startup -P laser3d.py -- T cells54             render/tT/cell54-4x/cNN.png (the head at the 54 facings
                                                                     of the game's laser strip, see CELL54 below)
  blender -b --factory-startup -P laser3d.py -- T full H              render/tT/full-hH.png (everything, for checks)
  blender -b --factory-startup -P laser3d.py -- T save                laser-tT.blend
  T is the tier, 1, 2 or 3.

Units: the striped base's radius is 1. Ground bearing b (0 = down-right on screen, 45 = at the viewer, 135 = left,
225 = away, 315 = right) is the Blender direction (sin b, cos b, 0), as in cannon3d.py. The canvas is 400 x 640 at 4x game
size with the building's anchor (game 0,0) at (200, 400); the camera is fitted so the body covers the painted tier's body
picture (width, middle, bottom).
"""
import json
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tower-3d"))
from look_fallback import (LINE, Paint, add_outline, bear, bezier, diag, lathe, obj_from_bm, outline_mat, rbox,  # noqa: E402
                           ring_of, setup_render, srgb, studs, tube)

W, H = 400, 640                       # 4x canvas
AX, AY = 200, 400                     # the building's anchor on it
EL = float(os.environ.get("LASER_EL", "30"))   # camera elevation (cannon3d.py: 23)
SUN = (150, 42)
# the painted tiers (buildingArtTiers.ts, 23 Laser Tower): body picture [x, y, w, h] and pivot, game px from the anchor
PAINTED = {1: dict(body=(-33, -29, 68, 81), pivot=(2, -20)),
           2: dict(body=(-33, -54, 68, 106), pivot=(2, -44)),
           3: dict(body=(-33, -71, 68, 123), pivot=(2, -60))}
TILT = 20.0                           # the head's raise, degrees
HEAD_SCALE = 1.15

# ------------------------------------------------------------------------------------------------------------- tiers
# the parts every tier shares keep their size (base, tyres, head); the box grows by sections
BASE_H = 0.95                         # striped base
PLATE = (0.95, 1.03)
RING_UP, TOP_UP = 0.48, 0.40          # the cage ring above the box, the turning point above the ring                  # the plate on it
BOX_A = 0.70                          # the box's half side (its corners point at bearings 45, 135, 225, 315)
TIERS = {
    1: dict(secs=[1.0], band=0.0),
    2: dict(secs=[0.86, 0.86], band=0.07),
    3: dict(secs=[0.74, 0.74, 0.74], band=0.07),
}


# --------------------------------------------------------------------------------------------------------- materials
def m_metal(name, lo, hi, wear=None, spec=0.7, rough=0.3, spec_col=(1, 0.97, 0.9, 1), scratch=None, nscale=3.0, metal=True):
    p = Paint(name)
    base = p.ramp(p.noise(nscale, 4.0), [(0.3, srgb(*lo)), (0.7, srgb(*hi))])
    if scratch:
        s = p.ramp(p.noise(14.0, 6.0, 0.7), [(0.66, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))])
        base = p.mix(base, srgb(*scratch), s)
    if wear:
        w = p.ramp(p.noise(2.2, 4.0, 0.6), [(0.32, srgb(*wear)), (0.62, (1, 1, 1, 1))])
        base = p.mix(base, w, 1.0, 'MULTIPLY')
    return p.finish(base, spec=spec, spec_rough=rough, spec_col=spec_col, metal=metal)


def m_stripes(c0, c1, n=11):
    p = Paint("stripes")
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    u = p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), p.math("MULTIPLY", sep.outputs[2], 2.2))   # leaning
    wob = p.math("MULTIPLY", p.math("SUBTRACT", p.noise(3.0, 2.0), 0.5), 0.12)
    band = p.math("GREATER_THAN", p.math("FRACT", p.math("ADD", u, wob)), 0.5)
    col = p.mix(srgb(*c0), srgb(*c1), band)
    chip = p.ramp(p.noise(7.0, 8.0, 0.62), [(0.64, (0, 0, 0, 1)), (0.665, (1, 1, 1, 1))])
    col = p.mix(col, srgb(200, 196, 190), p.math("MULTIPLY", chip, 0.7))
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.8, 0.78, 0.78, 1)), (0.7, (1, 1, 1, 1))])
    col = p.mix(col, grime, 1.0, 'MULTIPLY')
    return p.finish(col, spec=0.35, spec_rough=0.3)


def m_flat(name, col, spec=0.3, rough=0.35, metal=False, emit=None):
    return Paint(name).finish(srgb(*col), spec=spec, spec_rough=rough, metal=metal, emit=srgb(*emit) if emit else None)


def m_lens(name, cx, cz, rad, stops):
    """A lit lens: flat emission, a radial ramp from a hot middle to a deep rim (object x, z round cx, cz), plus a
    small white glint up and to the left."""
    p = Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])

    def dist(ox, oz, r):
        dx = p.math("SUBTRACT", sep.outputs[0], ox)
        dz = p.math("SUBTRACT", sep.outputs[2], oz)
        return p.math("DIVIDE", p.math("SQRT", p.math("ADD", p.math("MULTIPLY", dx, dx), p.math("MULTIPLY", dz, dz))), r)
    col = p.ramp(dist(cx, cz, rad), [(pos, srgb(*c)) for pos, c in stops])
    glint = p.ramp(dist(cx - rad * 0.38, cz + rad * 0.42, rad * 0.22), [(0.0, (0.9, 0.95, 1, 1)), (1.0, (0, 0, 0, 1))])
    col = p.mix(col, glint, 1.0, 'ADD')
    em = p.N.new("ShaderNodeEmission")
    p.link(col, em.inputs["Color"])
    out = p.N.new("ShaderNodeOutputMaterial")
    p.link(em.outputs[0], out.inputs[0])
    return p.m


def m_glow(name, edge, mid, core, power=1.6):
    """A lit lens: flat emission, deep at the rim, bright where it faces the camera, a white hot spot."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    inv = nt.nodes.new("ShaderNodeMath")
    inv.operation = 'POWER'
    one = nt.nodes.new("ShaderNodeMath")
    one.operation = 'SUBTRACT'
    one.inputs[0].default_value = 1.0
    nt.links.new(lw.outputs["Facing"], one.inputs[1])
    nt.links.new(one.outputs[0], inv.inputs[0])
    inv.inputs[1].default_value = power
    r = nt.nodes.new("ShaderNodeValToRGB")
    el = r.color_ramp.elements
    el[0].position, el[0].color = 0.0, srgb(*edge)
    el[1].position, el[1].color = 1.0, srgb(*core)
    e = el.new(0.55)
    e.color = srgb(*mid)
    nt.links.new(inv.outputs[0], r.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(r.outputs[0], em.inputs[0])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def materials(tier):
    M = {}
    M["tyre"] = m_metal("tyre", (46, 46, 52), (64, 64, 72), spec=0.16, rough=0.5, spec_col=(0.85, 0.88, 1, 1), nscale=5)
    M["hose_b"] = m_flat("hose_b", (40, 110, 230), spec=0.8, rough=0.2)
    M["hose_r"] = m_flat("hose_r", (210, 40, 36), spec=0.7, rough=0.2)
    M["sign"] = m_flat("sign", (246, 206, 30), spec=0.2)
    M["ink"] = m_flat("ink", (24, 22, 20), spec=0.1)
    M["amber"] = m_glow("amber", (200, 70, 0), (255, 150, 30), (255, 240, 170))
    gold = m_metal("gold", (206, 148, 34), (238, 186, 64), wear=(150, 96, 22), spec=0.95, rough=0.22,
                   spec_col=(1.0, 0.92, 0.6, 1))
    brass = m_metal("brass", (176, 118, 40), (204, 148, 58), wear=(130, 84, 30), spec=0.9, rough=0.25,
                    spec_col=(1.0, 0.9, 0.62, 1))
    steel = m_metal("steel", (100, 110, 120), (128, 138, 148), spec=0.7, rough=0.25, spec_col=(0.95, 0.97, 1, 1),
                    scratch=(186, 192, 198))
    if tier == 1:
        M["stripes"] = m_stripes((214, 30, 30), (236, 232, 228))
        M["box"] = m_metal("box", (112, 116, 102), (140, 144, 128), metal=False, spec=0.35, rough=0.32, spec_col=(0.95, 0.97, 1, 1),
                           scratch=(140, 142, 134), wear=(84, 74, 60))
        M["plate"] = steel
        M["bar"] = steel
        M["column"] = brass
        M["ring"] = steel
        M["trim"] = steel
        M["rivet"] = m_flat("rivet", (200, 146, 70), spec=0.9, rough=0.25, metal=True)
        M["head"] = m_metal("head", (104, 110, 116), (130, 136, 142), spec=0.7, rough=0.25, spec_col=(0.95, 0.97, 1, 1),
                            scratch=(182, 186, 190))
        M["rim"] = gold
        M["yoke"] = m_metal("yoke", (110, 112, 104), (136, 138, 130), spec=0.6, rough=0.3)
        M["thread"] = brass
    elif tier == 2:
        M["stripes"] = m_stripes((214, 30, 30), (236, 232, 228))
        M["box"] = gold
        for k in ("plate", "bar", "column", "ring", "trim", "head", "rim", "yoke", "thread"):
            M[k] = gold
        M["rivet"] = m_flat("rivet", (176, 112, 26), spec=0.9, rough=0.25, metal=True)
    else:
        M["stripes"] = m_stripes((30, 30, 34), (236, 178, 40))
        black = m_metal("black", (34, 34, 40), (52, 52, 60), spec=0.75, rough=0.25, spec_col=(0.8, 0.85, 1, 1),
                        scratch=(80, 80, 90))
        M["box"] = black
        M["plate"] = gold
        M["bar"] = m_metal("darksteel", (60, 62, 70), (84, 86, 96), spec=0.85, rough=0.25, spec_col=(0.9, 0.93, 1, 1),
                           scratch=(130, 132, 140))
        M["column"] = black
        M["ring"] = gold
        M["trim"] = gold
        M["head"] = black
        M["rim"] = gold
        M["yoke"] = gold
        M["thread"] = gold
        M["rivet"] = m_flat("rivet", (232, 178, 56), spec=0.9, rough=0.25, metal=True)
    return M


# ------------------------------------------------------------------------------------------------------------- shapes
def tyre(bm, c, R=0.15, rw=0.17, rh=0.15, n=40, k=16, mat=0):
    """A fat rubber tyre round a vertical axis at centre c: a superellipse section swept round."""
    rings = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ring = []
        for j in range(k):
            t = 2 * math.pi * j / k
            ct, st = math.cos(t), math.sin(t)
            x = math.copysign(abs(ct) ** 0.9, ct) * rw
            z = math.copysign(abs(st) ** 0.9, st) * rh
            ring.append(bm.verts.new((c[0] + (R + x) * math.cos(a), c[1] + (R + x) * math.sin(a), c[2] + z)))
        rings.append(ring)
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(k):
            f = bm.faces.new((a[j], b[j], b[(j + 1) % k], a[(j + 1) % k]))
            f.material_index = mat


def shield(w, h, n=40, bottom=0.42, top=0.18):
    """The head's section: a rounded square, more rounded at the bottom; (x, z) points round it, centred on 0."""
    pts = []
    hw, hh = w / 2, h / 2
    corners = [(hw, -hh, bottom), (hw, hh, top), (-hw, hh, top), (-hw, -hh, bottom)]
    # walk round: each corner a quarter arc of its own radius
    for ci, (cx, cz, r) in enumerate(corners):
        r = r * min(hw, hh) * 2
        ox = cx - math.copysign(r, cx)
        oz = cz - math.copysign(r, cz)
        a0 = [-90, 0, 90, 180][ci]
        for s in range(n // 4 + 1):
            a = math.radians(a0 + 90 * s / (n // 4))
            pts.append((ox + r * math.cos(a), oz + r * math.sin(a)))
    return pts


def prism(bm, pts, y0, y1, xform, mat=0, bevel=0.035):
    """Extrude a closed (x, z) outline from y0 to y1 (along local +Y), capped, bevelled at both rims."""
    sub = bmesh.new()
    a = [sub.verts.new((x, y0, z)) for x, z in pts]
    b = [sub.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    for i in range(n):
        sub.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    sub.faces.new(list(reversed(b)))
    sub.faces.new(a)
    bmesh.ops.remove_doubles(sub, verts=sub.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    rim = [e for e in sub.edges if len(e.link_faces) == 2 and
           abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
    if bevel:
        bmesh.ops.bevel(sub, geom=rim, offset=bevel, segments=3, affect='EDGES', profile=0.5)
    me = bpy.data.meshes.new("_tmp")
    sub.to_mesh(me)
    sub.free()
    me.transform(xform)
    for p in me.polygons:
        p.material_index = mat
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def facet_panel(bm, c, u, v, hu, hv, out, depth, mat=0):
    """A shallow four-sided pyramid on a face: centre c, half sizes hu, hv along u, v, apex depth out along out."""
    p = [c - u * hu - v * hv, c + u * hu - v * hv, c + u * hu + v * hv, c - u * hu + v * hv]
    vs = [bm.verts.new(q) for q in p]
    apex = bm.verts.new(c + out * depth)
    for i in range(4):
        f = bm.faces.new((vs[i], vs[(i + 1) % 4], apex))
        f.material_index = mat


def plate_tri(bm, c, u, v, out, size, thick, mat=0):
    """A flat equilateral triangle, point up, on a face: centre c, side size, standing out thick."""
    r = size / math.sqrt(3)
    p2 = [(0, r), (-size / 2, -r / 2), (size / 2, -r / 2)]
    a = [bm.verts.new(c + u * x + v * y) for x, y in p2]
    b = [bm.verts.new(c + u * x + v * y + out * thick) for x, y in p2]
    for i in range(3):
        f = bm.faces.new((a[i], a[(i + 1) % 3], b[(i + 1) % 3], b[i]))
        f.material_index = mat
    f = bm.faces.new(b)
    f.material_index = mat
    f = bm.faces.new(list(reversed(a)))
    f.material_index = mat
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


# ---------------------------------------------------------------------------------------------------------- the model
def build(tier):
    T = TIERS[tier]
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    M = materials(tier)
    LN = dict(warm=outline_mat("line_warm", srgb(52, 32, 16)), cool=outline_mat("line_cool", srgb(22, 22, 28)))
    line_box = LN["cool"] if tier != 2 else LN["warm"]

    body = bpy.data.objects.new("BODY", None)
    sc.collection.objects.link(body)

    # ---- striped base with its plate
    z0, z1 = PLATE
    base = lathe("base", [
        [(0.97, 0.0), (1.0, 0.03), (1.0, BASE_H - 0.03), (0.98, BASE_H)],
        [(0.98, BASE_H), (1.02, z0 + 0.01), (1.03, z0 + 0.03), (1.03, z1 - 0.02), (1.0, z1), (0.9, z1)],
        [(0.9, z1), (0.0, z1)],
    ], [M["stripes"], M["plate"]], mat_of_seg=[0, 1, 1], parent=body)
    add_outline(base, LN["warm"])
    bm = bmesh.new()
    c, nn = ring_of(30, 1.03, (z0 + z1) / 2, 0.5)
    studs(bm, c, nn, r=0.03)
    obj_from_bm("rivets_base", bm, [M["rivet"]], parent=body)

    # ---- tyre stacks at the four corners
    bm = bmesh.new()
    for b in (45, 128, 225, 322):
        p = bear(b, 1.1 if b == 45 else 1.18)
        for i in range(3):
            tyre(bm, (p.x, p.y, 0.15 + 0.29 * i))
    ty = obj_from_bm("tyres", bm, [M["tyre"]], parent=body)
    add_outline(ty, LN["cool"])

    # ---- the box, in sections with bands between
    a = BOX_A
    zb = z1
    bm = bmesh.new()
    trim = bmesh.new()
    riv = bmesh.new()
    faces = [(Vector((1, 0, 0)), Vector((0, 1, 0))), (Vector((0, 1, 0)), Vector((-1, 0, 0))),
             (Vector((-1, 0, 0)), Vector((0, -1, 0))), (Vector((0, -1, 0)), Vector((1, 0, 0)))]   # (normal, along)
    sec_z = []
    for si, h in enumerate(T["secs"]):
        rbox(bm, (2 * a, 2 * a, h), Matrix.Translation((0, 0, zb)), bevel=0.03, segs=2)
        sec_z.append((zb, zb + h))
        for nrm, u in faces:
            # rivets round the face's edge
            for t in np.linspace(-0.8, 0.8, 3):
                for zz in (zb + 0.07, zb + h - 0.07):
                    riv_pt = nrm * a + u * (a * t) + Vector((0, 0, zz))
                    studs(riv, [riv_pt], [nrm], r=0.036)
            for zz in np.linspace(zb + 0.2, zb + h - 0.2, max(2, int(h / 0.4))):
                for s in (-1, 1):
                    studs(riv, [nrm * a + u * (a * 0.88 * s) + Vector((0, 0, zz))], [nrm], r=0.036)
            if tier == 3:
                facet_panel(bm, nrm * a + Vector((0, 0, zb + h / 2)), u, Vector((0, 0, 1)), a * 0.78, h / 2 - 0.1,
                            nrm, 0.06)
        zb += h
        if si < len(T["secs"]) - 1 or tier > 1:
            bh = T["band"] or 0.05
            if si < len(T["secs"]) - 1:
                rbox(trim, (2 * a + 0.06, 2 * a + 0.06, bh), Matrix.Translation((0, 0, zb - bh / 2)), bevel=0.02, segs=2)
                for nrm, u in faces:
                    for t in np.linspace(-0.85, 0.85, 6):
                        studs(riv, [nrm * (a + 0.03) + u * (a * t) + Vector((0, 0, zb))], [nrm], r=0.022)
    box_top = zb
    # the lid: a thin plate on the box
    rbox(trim, (2 * a + 0.02, 2 * a + 0.02, 0.05), Matrix.Translation((0, 0, box_top - 0.02)), bevel=0.02, segs=2)
    if tier > 1:   # a trim round the bottom
        rbox(trim, (2 * a + 0.05, 2 * a + 0.05, 0.06), Matrix.Translation((0, 0, z1)), bevel=0.02, segs=2)
    bx = obj_from_bm("box", bm, [M["box"]], parent=body, sharp=30)
    add_outline(bx, line_box)
    tr = obj_from_bm("box_trim", trim, [M["trim"]], parent=body, sharp=30)
    add_outline(tr, LN["warm"], LINE * 0.8)
    obj_from_bm("rivets_box", riv, [M["rivet"]], parent=body)

    # the warning sign on the front-left face (+X), on the top section
    zs0, zs1 = sec_z[-1]
    bm = bmesh.new()
    cpos = Vector((a + 0.005, -0.05, zs0 + (zs1 - zs0) * (0.42 if tier == 1 else 0.5)))
    plate_tri(bm, cpos, Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)), 0.62, 0.02)
    sg = obj_from_bm("sign", bm, [M["sign"]], parent=body, smooth=False)
    add_outline(sg, LN["cool"], LINE * 0.9)
    bm = bmesh.new()
    plate_tri(bm, cpos + Vector((0.02, 0, -0.02)), Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)), 0.2, 0.012)
    obj_from_bm("sign_ink", bm, [M["ink"]], parent=body, smooth=False)

    # ---- the column, its collar and the cage ring
    ring_z = box_top + RING_UP
    top = ring_z + TOP_UP
    rz1 = ring_z + 0.16
    col = lathe("column", [
        [(0.45, box_top - 0.02), (0.48, box_top + 0.01), (0.48, box_top + 0.09), (0.44, box_top + 0.12), (0.40, box_top + 0.12)],
        [(0.37, box_top + 0.12), (0.37, ring_z - 0.04)],
        [(0.40, ring_z - 0.04), (0.42, ring_z - 0.02), (0.42, rz1 - 0.02), (0.40, rz1), (0.34, rz1)],
        [(0.32, rz1), (0.32, rz1 + 0.03), (0.29, rz1 + 0.04), (0.30, rz1 + 0.06), (0.30, rz1 + 0.09), (0.28, rz1 + 0.10),
         (0.29, rz1 + 0.12), (0.29, top - 0.04), (0.27, top), (0.22, top)],
        [(0.22, top), (0.0, top)],
    ], [M["ring"], M["column"], M["thread"]], mat_of_seg=[0, 1, 0, 2, 0], parent=body)
    add_outline(col, LN["warm"])
    # the cage: four bars up the box's corners, bending in to a ring round the column
    bm = bmesh.new()
    rr, rz = 0.60, ring_z
    n, k = 96, 12
    rings = []
    for i in range(n):
        an = 2 * math.pi * i / n
        rings.append([bm.verts.new(((rr + 0.065 * math.cos(2 * math.pi * j / k)) * math.cos(an),
                                    (rr + 0.065 * math.cos(2 * math.pi * j / k)) * math.sin(an),
                                    rz + 0.05 * math.sin(2 * math.pi * j / k))) for j in range(k)])
    for i in range(n):
        p_, q_ = rings[i], rings[(i + 1) % n]
        for j in range(k):
            bm.faces.new((p_[j], q_[j], q_[(j + 1) % k], p_[(j + 1) % k]))
    dc = a * math.sqrt(2) + 0.035
    for b in (45, 135, 225, 315):
        pts = [bear(b, dc, z1 - 0.02), bear(b, dc, box_top - 0.05)]
        pts = [pts[0] + (pts[1] - pts[0]) * t for t in np.linspace(0, 1, 8)][:-1]
        pts += bezier(bear(b, dc, box_top - 0.05), bear(b, dc, box_top + 0.22), bear(b, rr + 0.25, rz + 0.04),
                      bear(b, rr + 0.02, rz), n=12)
        tube(bm, pts, [0.085] * len(pts), sides=14)
    cage = obj_from_bm("cage", bm, [M["bar"]], parent=body)
    add_outline(cage, LN["cool"] if tier != 2 else LN["warm"])
    # amber lamps on the ring where the left and right bars meet it
    bm = bmesh.new()
    glow = bmesh.new()
    for b in (135, 315):
        p = bear(b, rr, rz + 0.06)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.09, radius2=0.08, depth=0.07,
                              matrix=Matrix.Translation(p))
        bmesh.ops.create_uvsphere(glow, u_segments=16, v_segments=8, radius=0.105,
                                  matrix=Matrix.Translation(p + Vector((0, 0, 0.08))) @ diag(1, 1, 1.15))
    lb = obj_from_bm("lamp_caps", bm, [M["trim"]], parent=body)
    add_outline(lb, LN["warm"], LINE * 0.7)
    lg = obj_from_bm("lamps", glow, [M["amber"]], parent=body)
    add_outline(lg, LN["warm"], LINE * 0.7)
    # the hoses at the back right: a red pipe up and a blue loop back down
    bm = bmesh.new()
    pr0, pr1 = bear(285, 0.66, rz - 0.04), bear(285, 0.66, top + 0.38)
    tube(bm, [pr0 + (pr1 - pr0) * t for t in np.linspace(0, 1, 6)], [0.05] * 6, sides=12)
    hr = obj_from_bm("hose_red", bm, [M["hose_r"]], parent=body)
    add_outline(hr, LN["cool"], LINE * 0.8)
    bm = bmesh.new()
    pb = bezier(pr1 - Vector((0, 0, 0.06)), pr1 + Vector((0, 0, 0.28)), bear(318, 0.86, top + 0.4), bear(318, 0.86, top + 0.05), n=14)
    pb += [bear(318, 0.86, top - 0.1 - 0.12 * i) for i in range(1, 4)]
    tube(bm, pb, [0.055] * len(pb), sides=12)
    hb = obj_from_bm("hose_blue", bm, [M["hose_b"]], parent=body)
    add_outline(hb, LN["cool"], LINE * 0.8)

    # ---- the head: threaded post, yoke, lamp housing with its lens. Built facing +Y, turned about Z by -heading.
    tur = bpy.data.objects.new("TURRET", None)
    sc.collection.objects.link(tur)
    tur.location = (0, 0, top)
    tur.scale = (HEAD_SCALE,) * 3
    post = lathe("post", [
        [(0.24, 0.0), (0.25, 0.02), (0.25, 0.04), (0.23, 0.05), (0.24, 0.06), (0.24, 0.08), (0.2, 0.09), (0.0, 0.09)],
    ], [M["thread"]], parent=tur, sharp=30)
    add_outline(post, LN["warm"])
    AXZ = 0.40                                   # the tilt axis' height
    bm = bmesh.new()
    rbox(bm, (0.98, 0.2, 0.08), Matrix.Translation((0, -0.02, 0.07)), bevel=0.02)       # the cross bar
    for sx in (-1, 1):
        rbox(bm, (0.08, 0.3, AXZ - 0.02), Matrix.Translation((sx * 0.47, -0.02, 0.07)), bevel=0.025)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=0.15, radius2=0.15, depth=0.08,
                              matrix=Matrix.Translation((sx * 0.47, -0.02, AXZ)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.09, radius2=0.075, depth=0.07,
                              matrix=Matrix.Translation((sx * 0.535, -0.02, AXZ)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    yk = obj_from_bm("yoke", bm, [M["yoke"]], parent=tur, sharp=35)
    add_outline(yk, LN["warm"])
    lamp = bpy.data.objects.new("LAMP", None)
    sc.collection.objects.link(lamp)
    lamp.parent = tur
    lamp.location = (0, -0.02, AXZ)
    lamp.rotation_euler = (math.radians(TILT), 0, 0)
    hw, hh, zc = 0.86, 0.80, 0.16                 # housing width, height, its centre above the axis
    y0, y1 = -0.50, 0.62
    sec = shield(hw, hh)
    bm = bmesh.new()
    prism(bm, [(x, z + zc) for x, z in sec], y0, y1, Matrix())
    hs = obj_from_bm("housing", bm, [M["head"]], parent=lamp, sharp=35)
    add_outline(hs, LN["cool"] if tier != 2 else LN["warm"])
    bm = bmesh.new()   # the front rim, a frame round the lens
    outer = [(x * 1.03, z * 1.03 + zc) for x, z in sec]
    prism(bm, outer, y1 - 0.02, y1 + 0.06, Matrix(), bevel=0.02)
    rim = obj_from_bm("rim", bm, [M["rim"]], parent=lamp, sharp=35)
    add_outline(rim, LN["warm"], LINE * 0.8)
    bm = bmesh.new()   # the lens, a low dome inside the rim
    inner = [(x * 0.86, z * 0.86 + zc) for x, z in sec]
    prism(bm, inner, y1, y1 + 0.075, Matrix(), bevel=0.05)
    lens_m = m_lens("lens", 0.0, zc, hh * 0.42, [(0.0, (210, 245, 255)), (0.3, (60, 170, 255)), (0.75, (16, 80, 230)),
                                              (1.0, (6, 26, 130))])
    obj_from_bm("lens", bm, [lens_m], parent=lamp)
    bm = bmesh.new()   # rivets along the housing's side and top edges
    for yy in np.linspace(y0 + 0.08, y1 - 0.08, 6):
        for sx in (-1, 1):
            for zz in (zc + hh * 0.36, zc - hh * 0.3):
                studs(bm, [(sx * hw / 2, yy, zz)], [(sx, 0, 0)], r=0.022)
    obj_from_bm("rivets_head", bm, [M["rivet"]], parent=lamp)
    return body, tur, dict(top=top, box_top=box_top, ring_z=ring_z)


# ------------------------------------------------------------------------------------------------------------- camera
def objs_under(root):
    out = []
    for o in bpy.data.objects:
        p = o.parent
        while p is not None and p != root:
            p = p.parent
        if o.type == 'MESH' and p == root:
            out.append(o)
    return out


def screen_box(cam, obs):
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in obs:
        if o.name.endswith("_line"):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            p = world_to_camera_view(sc, cam, mw @ v.co)
            xs.append(p.x * W)
            ys.append((1 - p.y) * H)
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


def fit(cam, body, tier):
    """Scale and shift the camera so the body's box matches the painted body's box in width, middle and bottom."""
    bx, by, bw, bh = PAINTED[tier]["body"]
    want = (AX + 4 * bx, AY + 4 * by, AX + 4 * (bx + bw), AY + 4 * (by + bh))
    obs = objs_under(body)
    for _ in range(3):
        bpy.context.view_layer.update()
        x0, y0, x1, y1 = screen_box(cam, obs)
        cam.data.ortho_scale *= (x1 - x0) / (want[2] - want[0])
        bpy.context.view_layer.update()
        x0, y0, x1, y1 = screen_box(cam, obs)
        big = max(W, H)
        cam.data.shift_x += ((x0 + x1) / 2 - (want[0] + want[2]) / 2) / big
        cam.data.shift_y -= (y1 - want[3]) / big
    bpy.context.view_layer.update()
    return screen_box(cam, obs), want


def to_px(cam, p):
    q = world_to_camera_view(bpy.context.scene, cam, Vector(p))
    return q.x * W, (1 - q.y) * H


# 54 facings of the game's laser strip (towerFx.ts laserCell): cell i shows the beam's screen angle 25 + 6.66 i degrees
# (0 = right, 90 = down). The ground bearing that looks that way on screen, for a camera at EL:
def cell54_bearing(i):
    th = math.radians(25 + 6.66 * i)
    r, t = math.cos(th), math.sin(th) / math.sin(math.radians(EL))
    return (315 + math.degrees(math.atan2(t, r))) % 360


# --------------------------------------------------------------------------------------------------------------- main
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
    tier, what = int(argv[0]), argv[1]
    body, tur, dims = build(tier)
    cam = setup_render(W, H, EL, SUN, look_at_z=1.5)
    box, want = fit(cam, body, tier)
    px, py = to_px(cam, (0, 0, dims["top"]))
    out = HERE / "render" / f"t{tier}"
    out.mkdir(parents=True, exist_ok=True)
    gp = PAINTED[tier]["pivot"]
    (out / "camera.json").write_text(json.dumps(dict(
        tier=tier, elevation=EL, tilt=TILT, ortho_scale=cam.data.ortho_scale, shift=[cam.data.shift_x, cam.data.shift_y],
        body_box=[round(v, 1) for v in box], painted_body_box=want, pivot_4x=[round(px, 2), round(py, 2)],
        painted_pivot_4x=[AX + 4 * gp[0], AY + 4 * gp[1]], canvas=[W, H], anchor_4x=[AX, AY], dims=dims), indent=1))
    sc = bpy.context.scene
    body_obs, tur_obs = objs_under(body), objs_under(tur)
    if what == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / f"laser-t{tier}.blend"))
        return

    def shot(path, seen, cut=()):
        """Two passes laid over each other: the paint without outline shells, then the shells alone with every solid
        part as a holdout (as cannon3d.py). Parts in cut are holdouts in both."""
        tmp = [out / "_paint.png", out / "_lines.png"]
        for i, f in enumerate(tmp):
            for o in seen + list(cut):
                line = o.name.endswith("_line")
                o.hide_render = (line and i == 0)
                o.is_holdout = (o in cut) or (i == 1 and not line)
            for o in bpy.data.objects:
                if o.type == 'MESH' and o not in seen and o not in cut:
                    o.hide_render = True
            sc.render.filepath = str(f)
            bpy.ops.render.render(write_still=True)
        a, b = (bpy.data.images.load(str(f)) for f in tmp)
        n = W * H * 4
        pa, pb = np.empty(n, np.float32), np.empty(n, np.float32)
        a.pixels.foreach_get(pa)
        b.pixels.foreach_get(pb)
        pa, pb = pa.reshape(-1, 4), pb.reshape(-1, 4)
        ab = pb[:, 3:4]
        aa = ab + pa[:, 3:4] * (1 - ab)
        rgb = (pb[:, :3] * ab + pa[:, :3] * pa[:, 3:4] * (1 - ab)) / np.maximum(aa, 1e-6)
        im = bpy.data.images.new("out", W, H, alpha=True)
        im.pixels.foreach_set(np.concatenate([rgb, aa], 1).ravel())
        im.filepath_raw = str(path)
        im.file_format = 'PNG'
        im.save()
        for x in (a, b, im):
            bpy.data.images.remove(x)
        for f in tmp:
            f.unlink()

    def turn(bearing):
        tur.rotation_euler = (0, 0, -math.radians(bearing))

    if what == "body":
        shot(out / "body-4x.png", body_obs)
    elif what == "full":
        turn(11.25 * int(argv[2]))
        shot(out / f"full-h{int(argv[2]):02d}.png", body_obs + tur_obs)
    elif what == "head":
        heads = [int(x) for x in argv[2:]] or list(range(32))
        (out / "head-4x").mkdir(exist_ok=True)
        for k in heads:
            turn(11.25 * k)
            shot(out / "head-4x" / f"h{k:02d}.png", tur_obs, cut=body_obs)
    elif what == "cells54":
        (out / "cell54-4x").mkdir(exist_ok=True)
        for i in range(54):
            turn(cell54_bearing(i))
            shot(out / "cell54-4x" / f"c{i:02d}.png", tur_obs, cut=body_obs)
    print("DONE", tier, what, "box", [round(v, 1) for v in box], "want", want, "pivot", round(px, 1), round(py, 1),
          "painted pivot", AX + 4 * gp[0], AY + 4 * gp[1])


main()
