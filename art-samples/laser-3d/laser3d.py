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
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
from look3d import Paint, bear, bezier, diag, lathe, obj_from_bm, rbox, ring_of, srgb, studs, tube  # noqa: E402

W, H = 400, 640                       # 4x canvas
AX, AY = 200, 400                     # the building's anchor on it
L.EL = 30.0                           # the painted Laser is drawn from about 30 degrees up (lead, 27 Oct: each tower
if os.environ.get("LASER_EL"):        # keeps its own painting's camera height; the Cannon's 23 is too flat for it)
    L.EL = float(os.environ["LASER_EL"])
# the painted tiers (buildingArtTiers.ts, 23 Laser Tower): body picture [x, y, w, h] and pivot, game px from the anchor
# and the opaque box inside the body picture, 2x px (x0, y0, x1, y1)
PAINTED = {1: dict(body=(-33, -29, 68, 81), pivot=(2, -20), opaque=(1, 1, 134, 160)),
           2: dict(body=(-33, -54, 68, 106), pivot=(2, -44), opaque=(2, 1, 134, 210)),
           3: dict(body=(-33, -71, 68, 123), pivot=(2, -60), opaque=(2, 2, 134, 245))}
TILT = 8.0                            # the head's raise, degrees
HEAD_SCALE = 0.94

# ------------------------------------------------------------------------------------------------------------- tiers
# the parts every tier shares keep their size (base, tyres, head); the box grows by sections
BASE_H = 0.95                         # striped base (tier 1; the painted tiers 2 and 3 have a lower one), a plate 0.08 on it
RING_UP, TOP_UP = 0.48, 0.62          # the cage ring above the box, the head's seat above the ring (the painted strip's
                                      # heads sit this high: their boxes match the 3D ones within a pixel at 4x)
BOX_A = 0.76                          # the box's half side (its corners point at bearings 45, 135, 225, 315)
TIERS = {
    1: dict(secs=[1.0], band=0.0, line="cool"),
    2: dict(secs=[1.26, 1.26], band=0.12, line="gold", base=0.70),
    3: dict(secs=[1.41, 1.06, 1.1], band=0.17, line="cool", base=0.55),
}


# --------------------------------------------------------------------------------------------------------- materials
def m_paint(name, lo, hi, wear=None, spec=0.7, rough=0.3, spec_col=(1, 0.97, 0.9, 1), scratch=None, nscale=3.0,
            metal=True, shade=None, upk=None, edge_dark=0.5):
    """A painted surface with its own colour noise (lo..hi), pale scratches, darker wear patches; upk lightens faces
    that tip up to the sky and darkens those tipping down (the black armour's facets)."""
    p = Paint(name)
    base = p.ramp(p.noise(nscale, 4.0), [(0.3, srgb(*lo)), (0.7, srgb(*hi))])
    if scratch:
        sc_ = p.ramp(p.noise(14.0, 6.0, 0.7), [(0.66, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))])
        base = p.mix(base, srgb(*scratch), sc_)
    if wear:
        w = p.ramp(p.noise(2.2, 4.0, 0.6), [(0.32, srgb(*wear)), (0.62, (1, 1, 1, 1))])
        base = p.mix(base, w, 1.0, 'MULTIPLY')
    if upk:
        geo = p.N.new("ShaderNodeNewGeometry")
        sep = p.N.new("ShaderNodeSeparateXYZ")
        p.link(geo.outputs["Normal"], sep.inputs[0])
        k = p.ramp(sep.outputs[2], [(0.3, (upk[0],) * 3 + (1,)), (0.7, (upk[1],) * 3 + (1,))])
        base = p.mix(base, k, 1.0, 'MULTIPLY')
    return p.finish(base, spec=spec, spec_rough=rough, spec_col=spec_col, metal=metal, shade=shade, edge_dark=edge_dark)


def m_stripes(c0, c1, n=8):
    """The base's hazard stripes: diagonal, as painted (look3d's stripes stand nearly upright)."""
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


def m_lens(name, cx, cz, rad, stops):
    """The laser's lens, lit from inside: flat emission, a radial ramp from a hot middle to a deep rim (object x, z round
    cx, cz), a small pale glint up and to the left."""
    p = Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])

    def dist(ox, oz, r):
        dx = p.math("SUBTRACT", sep.outputs[0], ox)
        dz = p.math("SUBTRACT", sep.outputs[2], oz)
        return p.math("DIVIDE", p.math("SQRT", p.math("ADD", p.math("MULTIPLY", dx, dx), p.math("MULTIPLY", dz, dz))), r)
    col = p.ramp(dist(cx, cz, rad), [(pos, srgb(*c)) for pos, c in stops])
    glint = p.ramp(dist(cx - rad * 0.42, cz + rad * 0.45, rad * 0.16), [(0.0, (0.5, 0.55, 0.6, 1)), (1.0, (0, 0, 0, 1))])
    col = p.mix(col, glint, 1.0, 'ADD')
    em = p.N.new("ShaderNodeEmission")
    p.link(col, em.inputs["Color"])
    out = p.N.new("ShaderNodeOutputMaterial")
    p.link(em.outputs[0], out.inputs[0])
    return p.m


# the Laser's own metals (look3d's ramps): a darker, cooler steel than the shared one (the painted Laser's steel is dark
# with bright edges), and a deeper gold for tier 2's big flat box faces (the shared gold's pale top washes them out)
L.METALS["lsteel"] = ((28, 32, 38), (92, 98, 102), (168, 174, 178), (0.92, 0.96, 1.0, 1))
L.METALS["lblack"] = ((12, 12, 18), (40, 40, 50), (92, 94, 112), (0.85, 0.9, 1.0, 1))
L.METALS["lgold"] = ((100, 56, 0), (216, 146, 12), (252, 206, 80), (1.0, 0.9, 0.55, 1))


def materials(tier):
    M = {}
    M["tyre"] = m_paint("tyre", (54, 54, 62), (74, 74, 84), spec=0.2, rough=0.45, spec_col=(0.85, 0.88, 1, 1), nscale=5,
                        metal=False)
    M["hose_b"] = L.mat_flat("hose_b", (40, 110, 230), spec=0.8, spec_rough=0.2)
    M["hose_r"] = L.mat_flat("hose_r", (210, 40, 36), spec=0.7, spec_rough=0.2)
    M["sign"] = L.mat_flat("sign", (246, 206, 30), spec=0.2)
    M["ink"] = L.mat_flat("ink", (24, 22, 20), spec=0.1)
    M["amber"] = L.mat_glass_lamp("amber")
    M["amber_glow"] = L.mat_halo("amber_glow")
    M["lens_glow"] = L.mat_halo("lens_glow", col=(80, 180, 255), strength=0.5)
    gold = L.mat_metal("gold", spec=1.0)
    brass = L.mat_metal("brass")
    steel = L.mat_metal("lsteel")
    plate_dark = L.mat_flat("plate_top", (50, 48, 52), spec=0.25)
    gunmetal = L.mat_metal("gunmetal")
    if tier == 1:
        M["stripes"] = m_stripes((214, 30, 30), (236, 232, 228))
        M["box"] = m_paint("box", (104, 108, 92), (130, 134, 116), metal=False, spec=0.35, rough=0.32,
                           spec_col=(0.95, 0.97, 1, 1), scratch=(140, 142, 134), wear=(84, 74, 60))
        M["plate"] = gunmetal
        M["plate_top"] = plate_dark
        M["lid"] = gunmetal
        M["bar"] = L.mat_metal("steel")
        M["column"] = brass
        M["ring"] = M["bar"]
        M["trim"] = gunmetal
        M["rivet"] = L.mat_metal("rivet", "brass", spec=1.0, spec_rough=0.2, wear=0)
        M["head"] = L.mat_metal("head", "lsteel", wear=1.0)
        M["rim"] = brass
        M["yoke"] = steel
        M["thread"] = brass
    elif tier == 2:
        M["stripes"] = m_stripes((214, 30, 30), (236, 232, 228))
        for k in ("plate", "bar", "column", "ring", "trim", "rim", "yoke", "thread"):
            M[k] = gold
        M["box"] = M["head"] = L.mat_metal("lgold", spec=1.0)
        M["plate_top"] = L.mat_flat("plate_top", (92, 58, 18), spec=0.3)
        M["lid"] = M["box"]
        M["rivet"] = L.mat_metal("rivet", "brass", spec=1.0, spec_rough=0.2, wear=0)
    else:
        M["stripes"] = m_stripes((30, 30, 34), (236, 178, 40))
        dark, mid, light, hi = L.METALS["black"]
        M["box"] = m_paint("armour", (255, 255, 255), (235, 235, 240), spec=1.0, rough=0.22, spec_col=hi,
                           scratch=(255, 255, 255), upk=(0.7, 1.3), shade=L.metal_ramp(dark, mid, light))
        M["plate"] = gold
        M["plate_top"] = plate_dark
        M["lid"] = L.mat_metal("lblack")
        M["bar"] = gunmetal
        M["column"] = L.mat_metal("black")
        M["ring"] = gold
        M["trim"] = gold
        M["head"] = L.mat_metal("lblack", wear=1.0)
        M["rim"] = gold
        M["yoke"] = gold
        M["thread"] = gold
        M["rivet"] = L.mat_metal("rivet", "gold", spec=1.0, spec_rough=0.2, wear=0)
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


def shield(w, h, n=40, bottom=0.5, top=0.22):
    """The head's section: a square with its top corners cut off flat and its bottom corners rounded, as painted; (x, z)
    points round it, centred on 0."""
    pts = []
    hw, hh = w / 2, h / 2
    corners = [(hw, -hh, bottom), (hw, hh, top), (-hw, hh, top), (-hw, -hh, bottom)]
    # walk round: each corner a quarter arc of its own radius
    for ci, (cx, cz, r) in enumerate(corners):
        r = r * min(hw, hh) * 2
        ox = cx - math.copysign(r, cx)
        oz = cz - math.copysign(r, cz)
        a0 = [-90, 0, 90, 180][ci]
        for s in (range(n // 4 + 1) if ci in (0, 3) else (0, n // 4)):
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
    line_box = L.line(T["line"])

    body = bpy.data.objects.new("BODY", None)
    sc.collection.objects.link(body)

    # ---- striped base with its plate
    base_h = T.get("base", BASE_H)
    z0, z1 = base_h, base_h + 0.08
    base = lathe("base", [
        [(0.97, 0.0), (1.0, 0.03), (1.0, base_h - 0.03), (0.98, base_h)],
        [(0.98, base_h), (1.02, z0 + 0.01), (1.03, z0 + 0.03), (1.03, z1 - 0.02), (1.01, z1), (0.97, z1)],
        [(0.97, z1), (0.0, z1)],
    ], [M["stripes"], M["plate"], M["plate_top"]], mat_of_seg=[0, 1, 2], parent=body)
    L.add_outline(base, L.line("warm"))
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
    L.add_outline(ty, L.line("cool"))

    # ---- the box, in sections with bands between
    a = BOX_A
    zb = z1
    bm = bmesh.new()
    trim = bmesh.new()
    fac = bmesh.new()
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
                facet_panel(fac, nrm * a + Vector((0, 0, zb + h / 2)), u, Vector((0, 0, 1)), a * 0.78, h / 2 - 0.1,
                            nrm, 0.22)
        zb += h
        if si < len(T["secs"]) - 1 or tier > 1:
            bh = T["band"] or 0.05
            if si < len(T["secs"]) - 1:
                rbox(trim, (2 * a + 0.1, 2 * a + 0.1, bh), Matrix.Translation((0, 0, zb - bh / 2)), bevel=0.02, segs=2)
                for nrm, u in faces:
                    for t in np.linspace(-0.85, 0.85, 6):
                        studs(riv, [nrm * (a + 0.03) + u * (a * t) + Vector((0, 0, zb))], [nrm], r=0.022)
    box_top = zb
    # the lid: a thin plate on the box
    lid = bmesh.new()
    rbox(lid, (2 * a + 0.02, 2 * a + 0.02, 0.05), Matrix.Translation((0, 0, box_top - 0.02)), bevel=0.02, segs=2)
    L.add_outline(obj_from_bm("lid", lid, [M["lid"]], parent=body, sharp=30), line_box, L.LINE * 0.8)
    if tier > 1:   # a trim round the bottom
        rbox(trim, (2 * a + 0.05, 2 * a + 0.05, 0.06), Matrix.Translation((0, 0, z1)), bevel=0.02, segs=2)
    bx = obj_from_bm("box", bm, [M["box"]], parent=body, sharp=30)
    if tier == 3:
        fc = obj_from_bm("facets", fac, [M["box"]], parent=body, smooth=False)
        L.add_outline(fc, line_box, L.LINE * 0.6)
    L.add_outline(bx, line_box)
    tr = obj_from_bm("box_trim", trim, [M["trim"]], parent=body, sharp=30)
    L.add_outline(tr, L.line("warm"), L.LINE * 0.8)
    obj_from_bm("rivets_box", riv, [M["rivet"]], parent=body)

    # the warning sign on the front-left face (+X), on the top section
    zs0, zs1 = sec_z[-1]
    bm = bmesh.new()
    cpos = Vector((a + (0.235 if tier == 3 else 0.005), -0.05, zs0 + (zs1 - zs0) * (0.42 if tier == 1 else 0.5)))
    plate_tri(bm, cpos, Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)), 0.72, 0.02)
    sg = obj_from_bm("sign", bm, [M["sign"]], parent=body, smooth=False)
    L.add_outline(sg, L.line("cool"), L.LINE * 0.9)
    bm = bmesh.new()
    plate_tri(bm, cpos + Vector((0.02, 0, -0.02)), Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)), 0.24, 0.012)
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
    L.add_outline(col, L.line("warm"))
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
        tube(bm, pts, [0.085 if tier == 1 else 0.095] * len(pts), sides=14)
    cage = obj_from_bm("cage", bm, [M["bar"]], parent=body)
    L.add_outline(cage, line_box)
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
    L.add_outline(lb, L.line("warm"), L.LINE * 0.7)
    lg = obj_from_bm("lamps", glow, [M["amber"]], parent=body)
    L.add_outline(lg, L.line("warm"), L.LINE * 0.7)
    bm = bmesh.new()
    for b in (135, 315):
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.19,
                                  matrix=Matrix.Translation(bear(b, rr, rz + 0.14)) @ diag(1, 1, 1.1))
    obj_from_bm("lamps_glow", bm, [M["amber_glow"]], parent=body)
    # the hoses at the back right: a red pipe up and a blue loop back down
    bm = bmesh.new()
    pr0, pr1 = bear(285, 0.66, rz - 0.04), bear(285, 0.66, top + 0.38)
    tube(bm, [pr0 + (pr1 - pr0) * t for t in np.linspace(0, 1, 6)], [0.05] * 6, sides=12)
    hr = obj_from_bm("hose_red", bm, [M["hose_r"]], parent=body)
    L.add_outline(hr, L.line("cool"), L.LINE * 0.8)
    bm = bmesh.new()
    pb = bezier(pr1 - Vector((0, 0, 0.06)), pr1 + Vector((0, 0, 0.28)), bear(318, 0.86, top + 0.4), bear(318, 0.86, top + 0.05), n=14)
    pb += [bear(318, 0.86, top - 0.1 - 0.12 * i) for i in range(1, 4)]
    tube(bm, pb, [0.055] * len(pb), sides=12)
    hb = obj_from_bm("hose_blue", bm, [M["hose_b"]], parent=body)
    L.add_outline(hb, L.line("cool"), L.LINE * 0.8)

    # ---- the head: threaded post, yoke, lamp housing with its lens. Built facing +Y, turned about Z by -heading.
    tur = bpy.data.objects.new("TURRET", None)
    sc.collection.objects.link(tur)
    tur.location = (0, 0, top)
    tur.scale = (HEAD_SCALE,) * 3
    post = lathe("post", [
        [(0.27, 0.0), (0.28, 0.02), (0.28, 0.06), (0.24, 0.07), (0.25, 0.09), (0.25, 0.12), (0.23, 0.13), (0.24, 0.15),
         (0.24, 0.18), (0.22, 0.19), (0.23, 0.21), (0.23, 0.24), (0.26, 0.25), (0.27, 0.27), (0.27, 0.30), (0.2, 0.31),
         (0.0, 0.31)],
    ], [M["thread"]], parent=tur, sharp=30)
    L.add_outline(post, L.line("warm"))
    AXZ = 0.66                                   # the tilt axis' height
    bm = bmesh.new()
    rbox(bm, (0.92, 0.2, 0.08), Matrix.Translation((0, -0.02, 0.28)), bevel=0.02)       # the cross bar
    for sx in (-1, 1):
        rbox(bm, (0.08, 0.4, AXZ - 0.24), Matrix.Translation((sx * 0.44, -0.02, 0.28)), bevel=0.025)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=0.13, radius2=0.13, depth=0.08,
                              matrix=Matrix.Translation((sx * 0.44, -0.02, AXZ)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.08, radius2=0.065, depth=0.07,
                              matrix=Matrix.Translation((sx * 0.505, -0.02, AXZ)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    yk = obj_from_bm("yoke", bm, [M["yoke"]], parent=tur, sharp=35)
    L.add_outline(yk, L.line("warm"))
    lamp = bpy.data.objects.new("LAMP", None)
    sc.collection.objects.link(lamp)
    lamp.parent = tur
    lamp.location = (0, -0.02, AXZ)
    lamp.rotation_euler = (math.radians(TILT), 0, 0)
    hw, hh, zc = 0.88, 0.82, 0.08                 # housing width, height, its centre above the axis
    y0, y1 = -0.58, 0.44
    sec = shield(hw, hh)
    bm = bmesh.new()
    prism(bm, [(x, z + zc) for x, z in sec], y0, y1, Matrix())
    hs = obj_from_bm("housing", bm, [M["head"]], parent=lamp, sharp=35)
    L.add_outline(hs, line_box)
    bm = bmesh.new()   # the front rim, a frame round the lens
    outer = [(x * 1.03, z * 1.03 + zc) for x, z in sec]
    prism(bm, outer, y1 - 0.02, y1 + 0.06, Matrix(), bevel=0.02)
    rim = obj_from_bm("rim", bm, [M["rim"]], parent=lamp, sharp=35)
    L.add_outline(rim, L.line("warm"), L.LINE * 0.8)
    bm = bmesh.new()   # the lens, a low dome inside the rim
    inner = [(x * 0.95, z * 0.95 + zc) for x, z in sec]
    prism(bm, inner, y1, y1 + 0.075, Matrix(), bevel=0.05)
    lens_m = m_lens("lens", 0.0, zc, hh * 0.46, [(0.0, (225, 250, 255)), (0.3, (110, 215, 255)), (0.62, (30, 130, 252)),
                                              (0.85, (14, 70, 220)), (1.0, (8, 36, 150))])
    obj_from_bm("lens", bm, [lens_m], parent=lamp)
    bm = bmesh.new()   # rivets along the housing's side and top edges
    for yy in np.linspace(y0 + 0.08, y1 - 0.08, 6):
        for sx in (-1, 1):
            for zz in (zc + 0.1, zc - 0.0):
                studs(bm, [(sx * hw / 2, yy, zz)], [(sx, 0, 0)], r=0.022)
    obj_from_bm("rivets_head", bm, [M["rivet"]], parent=lamp)
    return body, tur, dict(top=top, box_top=box_top, ring_z=ring_z)


# 54 facings of the game's laser strip (towerFx.ts laserCell): cell i shows the beam's screen angle 25 + 6.66 i degrees
# (0 = right, 90 = down). The ground bearing that looks that way on screen, for a camera at EL:
def cell54_bearing(i):
    th = math.radians(25 + 6.66 * i)
    r, t = math.cos(th), math.sin(th) / math.sin(math.radians(L.EL))
    return (315 + math.degrees(math.atan2(t, r))) % 360


# --------------------------------------------------------------------------------------------------------------- main
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
    tier, what = int(argv[0]), argv[1]
    out = HERE / "render" / f"t{tier}"
    # the painted body's opaque box (its picture has a 1-2 px clear margin at 2x), less the 3D outline (about 3 px at
    # 4x, drawn outside the mesh box that L.fit measures)
    bx, by, bw, bh = PAINTED[tier]["body"]
    ox0, oy0, ox1, oy1 = PAINTED[tier]["opaque"]
    want = (AX + 4 * bx + 2 * ox0 + 3, AY + 4 * by + 2 * oy0 + 3, AX + 4 * bx + 2 * ox1 - 3, AY + 4 * by + 2 * oy1 - 3)
    L.canvas(W, H, want, out)
    body, tur, dims = build(tier)
    cam = L.setup_render()
    body_obs, tur_obs = L.objs_under(body), L.objs_under(tur)
    box = L.fit(cam, body_obs)
    # the turning point: on the turning axis, at the height where the painted pivot is drawn (the head turns about a
    # vertical axis, so any point on it will do; this one lines the strip's cells up with the painted strip's)
    gp = PAINTED[tier]["pivot"]
    px, seat_y = L.to_px(cam, (0, 0, dims["top"]))
    py = AY + 4 * gp[1]
    (out / "camera.json").write_text(json.dumps(dict(
        tier=tier, elevation=L.EL, tilt=TILT, ortho_scale=cam.data.ortho_scale, shift=[cam.data.shift_x, cam.data.shift_y],
        body_box=[round(v, 1) for v in box], painted_body_box=want, pivot_4x=[round(px, 2), round(py, 2)],
        head_seat_4x=[round(px, 2), round(seat_y, 2)],
        painted_pivot_4x=[AX + 4 * gp[0], AY + 4 * gp[1]], canvas=[W, H], anchor_4x=[AX, AY], dims=dims), indent=1))
    if what == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / f"laser-t{tier}.blend"))
        return
    line_col = L.LINE_COLS[TIERS[tier]["line"]]

    def turn(bearing):
        tur.rotation_euler = (0, 0, -math.radians(bearing))

    def heads(folder, bearings):
        (out / folder).mkdir(exist_ok=True)
        avoid = L.load_alpha(out / "body-4x.png")
        for name, b in bearings:
            turn(b)
            L.shot(out / folder / name, tur_obs, cut=body_obs, avoid=avoid, outer_col=line_col)

    if what in ("body", "all"):
        L.shot(out / "body-4x.png", body_obs, outer_col=line_col)
    if what == "full":
        for h in argv[2:]:
            turn(11.25 * int(h))
            L.shot(out / f"full-h{int(h):02d}.png", body_obs + tur_obs, outer_col=line_col)
    if what in ("head", "all"):
        ks = [int(x) for x in argv[2:]] if what == "head" and argv[2:] else range(32)
        heads("head-4x", [(f"h{k:02d}.png", 11.25 * k) for k in ks])
    if what == "cells54":
        heads("cell54-4x", [(f"c{i:02d}.png", cell54_bearing(i)) for i in ([int(x) for x in argv[2:]] or range(54))])
    print("DONE", tier, what, "box", [round(v, 1) for v in box], "want", want, "pivot", round(px, 1), round(py, 1),
          "seat", round(seat_y, 1), "painted pivot", AX + 4 * gp[0], AY + 4 * gp[1])


main()
