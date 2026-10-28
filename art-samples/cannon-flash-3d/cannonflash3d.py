"""cannonflash3d.py : the ORIGINAL Flash Cannon Tower as a 3D model (owner, 28 Oct 2026: "generate the original Flash cannon,
but using Blender, then using the calculation to determine where the projectile lands. The original cannon should be
significantly easier to generate").

The Flash game drew the Cannon Tower with ONE picture for all ten levels (YARD_PROPS.as: buildings/cannontower/top.3.png,
66 x 79 at (-33, -25)): a red and white striped drum, a pale steel top, a tall fluted steel mortar tube standing up out of
it, four stubby bone feet whose posts carry a bone ring round the tube, and thin bone spikes rising from the ring. This
model copies that picture. The tube is the only moving part: it leans TILT degrees off upright, always the same, and only
turns (32 headings). The game starts the shot at the tube's mouth (strip.json `muzzle`) and works out the lob from there.

Run with Blender 5.2 in the background (it builds the scene from nothing):

  blender -b --factory-startup -P cannonflash3d.py -- body            render/body-4x.png (the tower without its tube)
  blender -b --factory-startup -P cannonflash3d.py -- tube [h ...]    render/tube-4x/hNN.png (the tube alone at heading h,
                                                                       body parts in front of it cut out; default all 32)
  blender -b --factory-startup -P cannonflash3d.py -- aim             render/aim.json (per heading: where the tube points
                                                                       on screen and where its mouth is; no pictures)
  blender -b --factory-startup -P cannonflash3d.py -- full H [H ...]  render/full-hHH.png (everything, for checks)
  blender -b --factory-startup -P cannonflash3d.py -- upright         render/upright.png (the tube standing straight up,
                                                                       as the Flash picture draws it)
  blender -b --factory-startup -P cannonflash3d.py -- clash [tilt]    prints the headings where the tube passes through
                                                                       the ring or the spikes
  blender -b --factory-startup -P cannonflash3d.py -- all             body, 32 headings, aim, upright, full stills
  blender -b --factory-startup -P cannonflash3d.py -- save            cannon-flash.blend (the scene, to open by hand)

Units: the drum's radius is 1. Ground bearing b (the game's heading: 0 = down-right on screen, 45 = at the viewer,
135 = left, 225 = away, 315 = right) is the Blender direction (sin b, cos b, 0). Camera, light, outline and materials are
the shared look in ../tower-3d/look3d.py (the 3D Sniper's and Laser's). The camera is fitted so the body covers the same
pixels as the Flash picture (and the painted tier 1 body) on the tier 1 4x canvas, so the shadows and lifts still fit.
"""
import json
import math
import os
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
from look3d import bear, bezier, rbox, ring_of, studs, tube  # noqa: E402
L.EL = float(os.environ.get("CANNON_EL", 30.0))   # the game's ground angle, as the 3D Sniper and Laser

# The tier 1 canvas (export3d.py's Cannon layout: the origin 73 px from the left, 69 px above the bottom, at 1x). The Flash
# picture's box, (-33, -25) to (33, 54) from the origin, is the painted tier 1 body's box within a pixel: (163..421, ..577).
CANVAS = dict(size=(620, 640), box=(163, 323, 421, 577))
TILT = float(os.environ.get("CANNON_TILT", 20.0))   # the tube's lean off upright, degrees (it never changes)

# Pale Flash steel: the tube, the drum's top and its rim are a light blue-grey in the Flash picture
L.METALS["pale"] = ((70, 82, 104), (178, 190, 208), (240, 244, 250), (0.95, 0.97, 1.0, 1))
L.METALS["silver"] = ((100, 112, 136), (184, 195, 212), (228, 234, 244), (0.95, 0.97, 1.0, 1))   # the tube: Flash draws it near white
L.METALS["paleblue"] = ((44, 66, 94), (138, 176, 206), (214, 234, 248), (0.92, 0.97, 1.0, 1))   # the top and the lip

# sizes in drum radii, read off the Flash picture (it is drawn from 23 degrees: heights divided by cos 23)
DRUM_H = 0.9              # the striped drum
TOP_Z = 1.04              # the steel top's face, where the tube stands
FOOT_D, FOOT_W, FOOT_H = 1.44, 0.7, 1.06    # the four feet: distance out, width (and depth), height
RING_R, RING_TUBE, RING_Z = 1.3, 0.13, 1.74  # the bone ring round the tube
TUBE_LEN = 1.98           # pivot to the mouth's face (upright: the mouth at 3.06, the Flash picture's 3.0)
TUBE_R0, TUBE_R1, MOUTH_R, BORE_R = 0.37, 0.53, 0.63, 0.46   # it flares toward the mouth
FLUTES = 12
PIVOT_Z = TOP_Z + 0.04    # the tube turns and leans about this point on the axis (inside its collar)
FEET = (45, 135, 225, 315)


def fluted(name, z0, z1, r0, r1, mats, parent, n=120, rows=24, depth=0.04):
    """The tube's fluted wall: radius r0 at z0 to r1 at z1, FLUTES rounded grooves along it."""
    bm = bmesh.new()
    rings = []
    for i in range(rows + 1):
        t = i / rows
        z = z0 + (z1 - z0) * t
        r = r0 + (r1 - r0) * t
        ring = []
        for j in range(n):
            a = 2 * math.pi * j / n
            rr = r - depth * (0.5 - 0.5 * math.cos(FLUTES * a)) ** 1.5
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)
    for i in range(rows):
        a, b = rings[i], rings[i + 1]
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    return L.obj_from_bm(name, bm, mats, parent, sharp=60)


def _torus(bm, R, r, z, n=128, k=16):
    rings = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rings.append([bm.verts.new(((R + r * math.cos(2 * math.pi * j / k)) * math.cos(a),
                                    (R + r * math.cos(2 * math.pi * j / k)) * math.sin(a),
                                    z + r * 1.1 * math.sin(2 * math.pi * j / k))) for j in range(k)])
    for i in range(n):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(k):
            bm.faces.new((a[j], b[j], b[(j + 1) % k], a[(j + 1) % k]))


def _spike(bm, b0, d0, z0, b1, d1, z1, r0, n=16, bow=0.12):
    """A thin bone spike from (bearing b0, out d0, height z0) to its tip, bowing outward a little, tapering to a point."""
    p0, p3 = bear(b0, d0, z0), bear(b1, d1, z1)
    p1 = bear(b0, d0 + 0.02, z0 + (z1 - z0) * 0.35)
    p2 = bear((b0 + b1) / 2, d1 + bow * 0.4, z0 + (z1 - z0) * 0.7)
    tube(bm, bezier(p0, p1, p2, p3, n=n), [max(r0 * (1 - i / (n - 1)) ** 0.8, 0.012) for i in range(n)], sides=12)


def build():
    L.clear_scene()
    M = dict(stripes=L.mat_stripes("stripes", (214, 22, 26), (240, 238, 242), 5, 0.1, chips=False, twist=0.16),
             pale=L.mat_metal("pale", "paleblue", spec=1.0, spec_rough=0.18, wear=0.25),
             bone=L.mat_wood("bone", light=(226, 208, 168), dark=(176, 150, 108), crack=(104, 84, 58)),
             foot=L.mat_wood("foot", light=(204, 180, 138), dark=(150, 122, 84), crack=(92, 72, 50)),   # darker, as Flash
             bore=L.mat_flat("bore", (44, 46, 54), spec=0.1))
    tube_m = L.mat_metal("tube", "silver", spec=1.0, spec_rough=0.16, wear=0.2, top=0.96, polish=0)    # painted, not polished: polished,
                           # the tube leaning away mirrors the bright sky and burns out
    LN, LNC = L.line("warm"), L.line("cool")

    # ---- body: drum, steel top, collar
    body = L.empty("BODY")
    drum = L.lathe("drum", [
        [(0.0, 0.0), (0.97, 0.0), (1.0, 0.03)],                                         # bottom
        [(1.0, 0.03), (1.01, DRUM_H * 0.5), (1.0, DRUM_H)],                             # stripes
        [(1.0, DRUM_H), (1.03, DRUM_H + 0.02), (1.03, TOP_Z - 0.03), (1.0, TOP_Z),     # the steel rim round the top
         (0.92, TOP_Z + 0.005), (0.0, TOP_Z + 0.005)],                                 # the top's face
    ], [M["stripes"], M["pale"]], mat_of_seg=[0, 0, 1], parent=body)
    L.add_outline(drum, LN)
    collar = L.lathe("collar", [[(0.6, TOP_Z), (0.6, TOP_Z + 0.06), (0.56, TOP_Z + 0.1), (0.0, TOP_Z + 0.1)]],
                     [M["pale"]], parent=body)
    L.add_outline(collar, LNC)

    # ---- feet, posts, ring, spikes (bone)
    feet, posts, spikes, rings = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    for fb in FEET:
        rot = Matrix.Rotation(-math.radians(fb), 4, 'Z')
        rbox(feet, (FOOT_W, FOOT_W, FOOT_H * 0.7), Matrix.Translation(bear(fb, FOOT_D)) @ rot, bevel=0.16, segs=4,
             taper=0.86)
        rbox(feet, (FOOT_W * 0.78, FOOT_W * 0.78, FOOT_H * 0.32), Matrix.Translation(bear(fb, FOOT_D - 0.02, FOOT_H * 0.66))
             @ rot, bevel=0.12, segs=3, taper=0.8)          # the step on top, as the Flash feet have
        p = [bear(fb, FOOT_D - 0.04, FOOT_H - 0.05), bear(fb, FOOT_D + 0.02, FOOT_H + 0.3),
             bear(fb, RING_R + 0.08, RING_Z - 0.35), bear(fb, RING_R, RING_Z)]
        tube(posts, bezier(*p, n=12), [0.14 - 0.03 * i / 11 for i in range(12)], sides=14)
        # the post goes on up past the ring as the middle spike; two thinner ones either side (shorter at the front)
        front = fb == 45
        _spike(spikes, fb, RING_R, RING_Z, fb, RING_R + 0.22, 2.62 if front else 2.95, 0.095)
        for side in (-1, 1):
            b1 = fb + side * (16 if front else 20)
            _spike(spikes, b1, RING_R, RING_Z + 0.05, b1 + side * 4, RING_R + 0.26, 2.3 if front else 2.8, 0.06)
    _torus(rings, RING_R, RING_TUBE, RING_Z)
    for name, b, w in (("feet", feet, None), ("posts", posts, None), ("ring", rings, None), ("spikes", spikes, L.LINE * 0.7)):
        ob = L.obj_from_bm(name, b, [M["foot" if name == "feet" else "bone"]], parent=body, sharp=50)
        L.add_outline(ob, LN, w)

    # ---- the tube: turns about Z (heading) and leans TILT toward its heading, about the pivot in its collar
    tur = L.empty("TURRET", loc=(0, 0, PIVOT_Z))
    gun = L.empty("GUN", parent=tur)
    gun.rotation_euler = (-math.radians(TILT), 0, 0)      # leans toward +Y (bearing 0); the turret turns it
    wall = fluted("tube", -0.25, TUBE_LEN - 0.22, TUBE_R0, TUBE_R1, [tube_m], gun)
    L.add_outline(wall, LNC)
    mouth = L.lathe("mouth", [
        L.band(TUBE_R1 - 0.03, MOUTH_R, TUBE_LEN - 0.24, TUBE_LEN, bev=0.06),          # the thick lip
        [(MOUTH_R - 0.024, TUBE_LEN), (BORE_R + 0.03, TUBE_LEN + 0.005), (BORE_R, TUBE_LEN - 0.02)],   # its face
    ], [M["pale"]], parent=gun, sharp=35)
    L.add_outline(mouth, LNC)
    bore = L.lathe("bore", [[(BORE_R, TUBE_LEN - 0.02), (BORE_R - 0.01, TUBE_LEN - 0.7), (0.0, TUBE_LEN - 0.7)]],
                   [M["bore"]], parent=gun)
    bm = bmesh.new()
    c, nn = ring_of(12, MOUTH_R, TUBE_LEN - 0.12, 0.5)
    studs(bm, c, nn, r=0.03)
    L.obj_from_bm("rivets_mouth", bm, [M["pale"]], parent=gun)
    return body, tur, gun, bore


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["body"]
    what = argv[0]
    out = HERE / "render"
    L.canvas(*CANVAS["size"], CANVAS["box"], out)
    body, tur, gun, bore = build()
    cam = L.setup_render()
    body_obs, tur_obs = L.objs_under(body), L.objs_under(tur)
    box = L.fit(cam, body_obs)
    px, py = L.to_px(cam, (0, 0, PIVOT_Z))
    (out / "camera.json").write_text(json.dumps(dict(
        elevation=L.EL, tilt=TILT, ortho_scale=cam.data.ortho_scale, shift=[cam.data.shift_x, cam.data.shift_y],
        body_box=[round(v, 1) for v in box], pivot_4x=[round(px, 2), round(py, 2)], pivot_height=PIVOT_Z,
        canvas=list(CANVAS["size"])), indent=1))
    if what == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "cannon-flash.blend"))
        return

    def turn(h):
        tur.rotation_euler = (0, 0, -math.radians(h))

    def muzzle_line():        # the tube's axis: the pivot, and the middle of its mouth
        return gun.matrix_world @ Vector((0, 0, 0)), gun.matrix_world @ Vector((0, 0, TUBE_LEN))

    def aim():
        data = L.aim(cam, (px, py), turn, [11.25 * k for k in range(32)], muzzle_line)
        turn(0)
        bpy.context.view_layer.update()
        mz = muzzle_line()[1].z                                                 # the mouth above the ground, model units
        ppu = abs(L.to_px(cam, bear(135, 1.0))[0] - L.to_px(cam, (0, 0, 0))[0]) / 4      # game px per model unit
        gy = L.to_px(cam, (0, 0, 0))[1]
        data.update(barrel_tilt_deg=TILT, barrel_elevation_deg=90 - TILT, muzzle_height_px=round(mz * ppu, 1),
                    muzzle_height_screen_px=round(mz * ppu * math.cos(math.radians(L.EL)), 1),
                    ground_below_pivot_px=round((gy - py) / 4, 2), elevation_deg=L.EL)
        (out / "aim.json").write_text(json.dumps(data))

    line_col = L.LINE_COLS["warm"]

    def tubes(heads):
        (out / "tube-4x").mkdir(exist_ok=True)
        avoid = L.load_alpha(out / "body-4x.png")
        for k in heads:
            turn(11.25 * k)
            L.shot(out / "tube-4x" / f"h{k:02d}.png", tur_obs, cut=body_obs, avoid=avoid, outer_col=line_col)

    def full(heads):
        for h in heads:
            turn(11.25 * h)
            L.shot(out / f"full-h{h:02d}.png", body_obs + tur_obs, outer_col=line_col)

    def upright():
        gun.rotation_euler = (0, 0, 0)
        L.shot(out / "upright.png", body_obs + tur_obs, outer_col=line_col)
        gun.rotation_euler = (-math.radians(TILT), 0, 0)

    if what == "clash":
        if len(argv) > 1:
            gun.rotation_euler = (-math.radians(float(argv[1])), 0, 0)
        bpy.context.view_layer.update()

        def tree(o):
            m = o.matrix_world
            return BVHTree.FromPolygons([m @ v.co for v in o.data.vertices], [p.vertices[:] for p in o.data.polygons])
        solid = [(o, tree(o)) for o in body_obs if o.name in ("ring", "spikes", "posts")]
        moving = [o for o in L.objs_under(gun) if not o.name.endswith("_line")]
        hits = {}
        for k in range(32):
            turn(11.25 * k)
            bpy.context.view_layer.update()
            for mo in moving:
                t = tree(mo)
                for o, st in solid:
                    if t.overlap(st):
                        hits.setdefault(k, []).append(f"{mo.name}/{o.name}")
        print("CLASH", json.dumps(hits))
        return
    if what == "aim":
        aim()
    elif what == "body":
        L.shot(out / "body-4x.png", body_obs, outer_col=line_col)
    elif what == "tube":
        tubes([int(a) for a in argv[1:]] or range(32))
    elif what == "full":
        full([int(a) for a in argv[1:]])
    elif what == "upright":
        upright()
    elif what == "all":
        L.shot(out / "body-4x.png", body_obs, outer_col=line_col)
        tubes(range(32))
        aim()
        upright()
        full([0, 4, 8, 11, 16, 20, 24, 28])
    print("DONE", what, "box", [round(v, 1) for v in box], "pivot", round(px, 1), round(py, 1))


main()
