"""square3d.py : what the 3D towers on a square foot share (Aerial Defense, Railgun; buildings-3d, 28 Oct 2026), on top
of look3d.py: the stepped square body, its striped and perforated sections, the camera fit and the render modes.

    import square3d as Q
    Q.run(build, tier, out_dir, turret_canvas=(480, 440, 240, 300), aim_parts=("muzzle_base", "muzzle_tip"))

Units: the footprint is a square with its corners at bearings 45 (at the viewer), 135, 225 and 315, half a diagonal = 1
(75 px in the @2x art: the painted bodies are 150 px across). The world's origin is the footprint's middle on the ground,
which stands at game px GROUND from the building's origin (measured on the painted Aerial and Railgun bodies: their left
and right corners are 150 px apart at @2x and their middle is 37.5 game px below the origin).

Render modes (`blender -b --factory-startup -P <tower>3d.py -- T MODE`):
  body               render/tT/body-4x.png        the body (no turret), the ground middle at BODY_G on the canvas
  turret [h ...]     render/tT/turret-4x/hNN.png  the turret at heading 11.25 k (default all 32), the body cut out of it
  full H             render/tT/full-hHH.png       everything, heading H (for checks)
  aim                render/tT/aim.json           where the barrel points and its muzzle, per heading
  clash              render/tT/clash.json         turret parts passing through the body, per heading
  save               <tower>-tT.blend
render/tT/camera.json records the pivot and ground middle on each canvas.
"""
import json
import math
import os
from pathlib import Path

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import look3d as L
from look3d import Paint, bear, srgb

FRONT = 45.0                 # the corner at the viewer
SEEN = (90.0, 0.0)           # the outward bearings of the two faces we see: front-left (down-left on screen), front-right
S2 = 75.0                    # px per unit at @2x
PPU = 2 * S2                 # px per unit in the 4x renders
GROUND = (0.0, 37.5)         # the ground middle, game px from the building's origin
BODY_CANVAS = (640, 600, 320, 430)   # 4x body canvas: w, h and the ground middle's pixel
APO = math.cos(math.radians(45))     # a face's distance from the middle, per unit of half diagonal


def corners(d, z):
    """The square's corners at half diagonal d, height z: front, left, back, right."""
    return [bear(FRONT + 90 * k, d, z) for k in range(4)]


def frustum(bm, d0, d1, z0, z1, bevel=0.0, segs=2, mat=0):
    """A square section from half diagonal d0 at z0 to d1 at z1 (straight if equal), its edges bevelled."""
    sub = bmesh.new()
    lo = [sub.verts.new(p) for p in corners(d0, z0)]
    hi = [sub.verts.new(p) for p in corners(d1, z1)]
    sub.faces.new(lo)
    sub.faces.new(hi)
    for i in range(4):
        sub.faces.new((lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    if bevel > 0:
        bmesh.ops.bevel(sub, geom=list(sub.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5,
                        clamp_overlap=True)
    L.add_mesh(bm, sub, Matrix(), mat)


def face_frame(nb, z, d, u=0.0, out=0.0, lean=0.0):
    """A frame on the face whose outward bearing is nb, of a section whose half diagonal is d at height z: x along the face
    (toward the corner at nb + 45), y out of it, z up; moved u along and out off it; lean tips y up by lean degrees (a
    sloping face's normal)."""
    n, t = bear(nb), bear(nb + 90)
    c = n * (d * APO + out) + t * u + Vector((0, 0, z))
    m = Matrix((t, n, Vector((0, 0, 1)))).transposed().to_4x4()
    return Matrix.Translation(c) @ m @ Matrix.Rotation(math.radians(lean), 4, 'X')


def lean_of(d0, d1, z0, z1):
    """How far a section's faces lean back from upright, degrees."""
    return math.degrees(math.atan2((d0 - d1) * APO, z1 - z0))


def holes(bm, d0, d1, z0, z1, rows, cols, r, margin=0.16, faces=SEEN):
    """The perforations: dark round holes in rows on the faces we see of a section (d0 at z0 to d1 at z1)."""
    lean = lean_of(d0, d1, z0, z1)
    for nb in faces:
        for i in range(rows):
            f = (i + 0.5) / rows
            z = z0 + (z1 - z0) * f
            d = d0 + (d1 - d0) * f
            half = d * APO - margin
            for j in range(cols):
                u = -half + 2 * half * (j + 0.5 * (i % 2) + 0.25) / cols
                if abs(u) > half:
                    continue
                m = face_frame(nb, z, d, u=u, out=0.003, lean=lean) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
                sub = bmesh.new()
                bmesh.ops.create_circle(sub, cap_ends=True, segments=12, radius=r)
                L.add_mesh(bm, sub, m)


def mat_chevrons(name, a, b, period=0.17, k=1.0, ground_shade=True):
    """Painted stripes down the sides, meeting in a V (point down) at every corner: colours a and b (0-255 sRGB)."""
    p = Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    # distance from the nearest corner, along the faces: | |x| - |y| | (the faces are square to x and y)
    lat = p.math("ABSOLUTE", p.math("SUBTRACT", p.math("ABSOLUTE", sep.outputs[0]), p.math("ABSOLUTE", sep.outputs[1])))
    u = p.math("SUBTRACT", sep.outputs[2], p.math("MULTIPLY", lat, k))
    band = p.math("GREATER_THAN", p.math("FRACT", p.math("DIVIDE", u, period)), 0.5)
    paint = p.mix(srgb(*a), srgb(*b), band)
    chip = p.ramp(p.noise(7.0, 8.0, 0.62), [(0.66, (0, 0, 0, 1)), (0.685, (1, 1, 1, 1))])
    paint = p.mix(paint, srgb(*[min(255, c + 50) for c in a]), p.math("MULTIPLY", band, chip))
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.84, 0.82, 0.82, 1)), (0.7, (1, 1, 1, 1))])
    return p.finish(p.mix(paint, grime, 1.0, 'MULTIPLY'), spec=0.35, spec_rough=0.3, shade=L.WARM_SHADE)


def cyl(bm, r, depth, mat_world, segs=24, r2=None, mat=0):
    """A cylinder along local z, centred, transformed by mat_world."""
    sub = bmesh.new()
    bmesh.ops.create_cone(sub, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth,
                          matrix=Matrix())
    L.add_mesh(bm, sub, mat_world, mat)


def ball(bm, c, r, segs=16):
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=r, matrix=Matrix.Translation(Vector(c)))


# ------------------------------------------------------------------------------------------------------------- rendering
def frame(cam, w, h, px, py, at):
    """Canvas w x h at our scale, the world point `at` on pixel (px, py)."""
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    L.W, L.H = w, h
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.ortho_scale = w / PPU
    cam.data.shift_x = cam.data.shift_y = 0.0
    for _ in range(3):
        bpy.context.view_layer.update()
        p = world_to_camera_view(sc, cam, Vector(at))
        cam.data.shift_x += (p.x * w - px) / w
        cam.data.shift_y -= ((1 - p.y) * h - py) / w
    bpy.context.view_layer.update()
    p = world_to_camera_view(sc, cam, Vector(at))
    return [round(p.x * w, 3), round((1 - p.y) * h, 3)]


def run(name, build, tier, here, turret_canvas, args, solid=None):
    """The render modes (see the top). build() -> (body root, turret root, top height); the turret root turns about z and
    carries the empties `muzzle_base` and `muzzle_tip` (the middle of the barrels' roots and of their tips). solid: the body
    part names the clash check tests the turret against (default: all of them)."""
    out = here / "render" / f"t{tier}"
    out.mkdir(parents=True, exist_ok=True)
    L.OUT = out
    body, tur, top = build()
    cam = L.setup_render()
    body_obs, tur_obs = L.objs_under(body), L.objs_under(tur)
    what = args[0]
    warm = L.LINE_COLS["warm"]
    info = dict(tier=tier, elevation=L.EL, px_per_unit_4x=PPU, top=top, ground_game=list(GROUND))

    def turn(h):
        tur.rotation_euler = (0, 0, -math.radians(h))

    bw, bh, gx, gy = BODY_CANVAS
    if what == "save":
        frame(cam, bw, bh, gx, gy, (0, 0, 0))
        bpy.ops.wm.save_as_mainfile(filepath=str(here / f"{name}-t{tier}.blend"))
        return
    if what == "body":
        info["body_ground_4x"] = frame(cam, bw, bh, gx, gy, (0, 0, 0))
        info["body_pivot_4x"] = [round(v, 3) for v in L.to_px(cam, (0, 0, top))]
        L.shot(out / "body-4x.png", body_obs, outer_col=warm)
    elif what == "full":
        frame(cam, bw, bh, gx, gy, (0, 0, 0))
        turn(11.25 * int(args[1]))
        L.shot(out / f"full-h{int(args[1]):02d}.png", body_obs + tur_obs, outer_col=warm)
    elif what == "turret":
        tw, th, tx, ty = turret_canvas
        info["turret_pivot_4x"] = frame(cam, tw, th, tx, ty, (0, 0, top))
        (out / "turret-4x").mkdir(exist_ok=True)
        for k in [int(a) for a in args[1:]] or list(range(32)):
            turn(11.25 * k)
            L.shot(out / "turret-4x" / f"h{k:02d}.png", tur_obs, cut=body_obs, outer_col=warm)
    elif what == "aim":
        tw, th, tx, ty = turret_canvas
        piv = frame(cam, tw, th, tx, ty, (0, 0, top))
        mb, mt = bpy.data.objects["muzzle_base"], bpy.data.objects["muzzle_tip"]
        data = L.aim(cam, piv, turn, [11.25 * k for k in range(32)],
                     lambda: (mb.matrix_world.translation.copy(), mt.matrix_world.translation.copy()))
        (out / "aim.json").write_text(json.dumps(data))
    elif what == "clash":
        def tree(o):
            m = o.matrix_world
            return BVHTree.FromPolygons([m @ v.co for v in o.data.vertices], [p.vertices[:] for p in o.data.polygons])
        bpy.context.view_layer.update()
        still = [(o, tree(o)) for o in body_obs if not o.name.endswith(("_line", "_glow"))
                 and (solid is None or o.name in solid)]
        moving = [o for o in tur_obs if not o.name.endswith(("_line", "_glow"))]
        hits = []
        for k in range(32):
            turn(11.25 * k)
            bpy.context.view_layer.update()
            for mo in moving:
                t = tree(mo)
                for o, st in still:
                    if t.overlap(st):
                        hits.append(dict(heading=k, moving=mo.name, body=o.name))
        (out / "clash.json").write_text(json.dumps(hits, indent=0))
        print("CLASH", tier, len(hits), "cells", sorted({h["heading"] for h in hits}))
    old = json.loads((out / "camera.json").read_text()) if (out / "camera.json").exists() else {}
    old.update(info)
    (out / "camera.json").write_text(json.dumps(old, indent=1))
    print("DONE", what, info)
