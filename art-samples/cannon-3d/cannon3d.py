"""cannon3d.py : the Cannon Tower, tiers 1-3, as a real 3D model, rendered in the game's camera (owner, 27 Oct 2026: a sample).

Run with Blender 5.2 in the background (it builds the whole scene from nothing, so the model can be changed here and rebuilt):

  blender -b --factory-startup -P cannon3d.py -- TIER body                 render/TIER/body-4x.png (the tower without its barrel)
  blender -b --factory-startup -P cannon3d.py -- TIER barrel [h0 h1 ...]   render/TIER/barrel-4x/hNN.png (the barrel alone at
                                                                           heading h, every body part in front of it cut out;
                                                                           default all 32)
  blender -b --factory-startup -P cannon3d.py -- TIER full H               render/TIER/full-hH.png (everything, for checks)
  blender -b --factory-startup -P cannon3d.py -- TIER all                  body, then all 32 headings
  blender -b --factory-startup -P cannon3d.py -- TIER save                 cannon-TIER.blend (the scene, to open by hand)

TIER: t1 (steel bands, no lamps: the game's still picture), t1b (the same tower with brass bands and lamps: the game's
turning picture), t2 (gold, one more striped section), t3 (black armour and gold, two more sections).

Units: the striped drum's radius is 1. Ground bearing b (the game's heading, 0 = down-right on screen, 45 = at the viewer,
135 = left, 225 = away, 315 = right) is the Blender direction (sin b, cos b, 0). The camera, light, outline and materials are
the shared look in ../tower-3d/look3d.py. The camera is fitted so the body covers the same pixels as the painted tier's body
on its 4x canvas (CANVAS), and the turning point is reported on the turning axis at the painted pivot's height.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
from look3d import bear, bezier, diag, rbox, ring_of, studs, tube  # noqa: E402

# The painted tiers (codex-art Part 16 kits, turret/T<n>/body): canvas, body box, turning point, all at 4x
CANVAS = {
    1: dict(size=(620, 640), box=(163, 323, 421, 577), pivot=(293, 422)),
    2: dict(size=(620, 960), box=(163, 576, 421, 897), pivot=(295, 680)),
    3: dict(size=(620, 960), box=(163, 515, 421, 897), pivot=(291, 621)),
}
TILT = 22.0                       # the barrel's raise, degrees
TURRET_SCALE = 1.5              # the turning part, against the drum
SECTION = 0.84                    # one more striped section (stripes + band) per tier

# per tier: the extra sections and what each part is made of
TIERS = {
    "t1": dict(tier=1, extra=0, band="steel", turn="steel", wood="wood", strut="wood", gun="steel", gunband="gunmetal",
               lamps=False, stripes=((222, 18, 20), (236, 232, 238)), line="warm", plate="gunmetal"),
    "t1b": dict(tier=1, extra=0, band="brass", turn="brass", wood="wood", strut="wood", gun="gunmetal", gunband="brass",
                lamps=True, stripes=((222, 18, 20), (236, 232, 238)), line="warm", plate="gunmetal"),
    "t2": dict(tier=2, extra=1, band="gold", turn="gold", wood="gold", strut="gold", gun="gunmetal", gunband="gold",
               lamps=False, stripes=((222, 18, 20), (236, 232, 238)), line="gold", plate="steel"),
    "t3": dict(tier=3, extra=2, band="gold", turn="gold", wood="black", strut="black", gun="black", gunband="gold",
               lamps=False, stripes=((40, 38, 50), (236, 176, 40)), line="cool", plate="black", n_stripes=7, ratio=0.5),
}

# all sizes in drum radii; heights from the ground (tier 1; taller tiers add SECTION per extra section)
LIFT = 0.3                        # the drum stands this high on its feet (the painting draws it so)
FOOT_DEPTH = 0.6         # a foot's width, depth, height
FEET = {45: (45, 1.6, 0.8, 0.76), 152: (62, 1.36, 0.7, 0.74), 298: (28, 1.36, 0.7, 0.74)}
# three feet: bearing -> (the way its lamp faces, distance, width, height)
RING_R, RING_W = 1.12, 0.16       # the ring's middle radius and half width
STRIPES, STRIPE_PHASE = 4, 0.375


def build(cfg):
    sc = bpy.context.scene
    L.clear_scene()
    up = SECTION * cfg["extra"]
    M = dict(stripes=L.mat_stripes("stripes", *cfg["stripes"], cfg.get("n_stripes", STRIPES), STRIPE_PHASE,
                                   chips=cfg["tier"] < 3, ratio=cfg.get("ratio", 0.5)),
             steel=L.mat_metal("steel"), gunmetal=L.mat_metal("gunmetal"), brass=L.mat_metal("brass"),
             gold=L.mat_metal("gold", spec=1.0), black=L.mat_metal("black", wear=0.35, sheen=0.18),
             wood=L.mat_wood("wood"),
             bore=L.mat_flat("bore", (30, 28, 32), spec=0.1),
             lens=L.mat_glass_lamp("lens"), glow=L.mat_halo("glow"))
    rivet_kind = {"steel": "steel", "brass": "brass", "gold": "gold"}[cfg["band"]]
    M["rivet"] = L.mat_metal("rivet", rivet_kind, spec=1.0, spec_rough=0.2, wear=0)
    band, turn, wood, strut = (M[cfg[k]] for k in ("band", "turn", "wood", "strut"))
    LN = L.line(cfg["line"])
    LNC = L.line("cool")

    # ---- body: the drum, sections of stripes between bands
    body = L.empty("BODY")
    n_sec = 1 + cfg["extra"]
    stripe_h = SECTION - 0.14
    z = 0.0
    segs, mats = [], []

    def r_at(zz):          # the drum leans in a little as it goes up
        top = 1.12 + up
        return 1.0 - 0.09 * min(max(zz - LIFT, 0) / top, 1.0)

    bands = []
    segs.append([(0.0, 0.0), (0.8, 0.0), (0.84, 0.04), (0.84, LIFT - 0.02), (r_at(0) - 0.01, LIFT)])   # plinth
    mats.append(2)
    segs.append(L.band(r_at(0) - 0.01, r_at(0) + 0.055, LIFT, LIFT + 0.24))
    mats.append(0)
    bands.append((LIFT + 0.12, r_at(0.1) + 0.055))
    z = LIFT + 0.24
    for i in range(n_sec):
        z1 = z + stripe_h + (0.0 if i == n_sec - 1 else 0)
        segs.append([(r_at(z), z), (r_at(z) + 0.012, z + stripe_h * 0.3), (r_at(z1) + 0.008, z + stripe_h * 0.75), (r_at(z1), z1)])
        mats.append(1)
        z = z1
        bh = 0.16 if i < n_sec - 1 else 0.2
        segs.append(L.band(r_at(z) - 0.01, r_at(z) + 0.05, z, z + bh))
        mats.append(0)
        bands.append((z + bh / 2, r_at(z) + 0.05))
        z += bh
    drum_top = z                                         # 1.12 on tier 1
    rim_r, plate_r = 0.70, 0.57
    top = drum_top + 0.25                                # the turntable plate, where the turret stands
    segs.append([(r_at(drum_top) - 0.01, drum_top), (0.86, drum_top + 0.06), (rim_r + 0.04, drum_top + 0.1)])   # shoulder
    mats.append(2)
    segs.append([(rim_r - 0.02, top + 0.02), (plate_r, top + 0.02), (plate_r, top - 0.01), (0.0, top - 0.01)])   # plate
    mats.append(3)
    drum = L.lathe("drum", segs, [band, M["stripes"], M[cfg["plate"]], M[cfg["plate"]]], mat_of_seg=mats, parent=body)
    L.add_outline(drum, LN)
    # the turntable's rim is its own part, so it can be the turret's metal
    rim = L.lathe("rim", [L.band(rim_r - 0.02, rim_r + 0.02, drum_top + 0.1, top + 0.03, bev=0.03)], [turn], parent=body)
    L.add_outline(rim, LN)

    bm = bmesh.new()
    for zz, r in bands:
        c, nn = ring_of(24, r, zz, 0.5)
        studs(bm, c, nn, r=0.045)
    c, nn = ring_of(16, rim_r + 0.02, (drum_top + 0.1 + top) / 2 + 0.02, 0.5)
    studs(bm, c, nn, r=0.04)
    c, nn = ring_of(10, 0.42, top + 0.02)
    studs(bm, c, [Vector((0, 0, 1))] * 10, r=0.03)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.09, radius2=0.08, depth=0.06,
                          matrix=Matrix.Translation((0, 0, top + 0.03)))
    L.obj_from_bm("rivets_body", bm, [M["rivet"]], parent=body)

    # ---- feet, struts, the ring and its prongs
    feet = bmesh.new()
    caps = bmesh.new()
    struts = bmesh.new()
    lamps, glass, glow = bmesh.new(), bmesh.new(), bmesh.new()
    ring_z = drum_top + 0.16
    fd = FOOT_DEPTH
    for fb, (fc, fdist, fw, fh) in FEET.items():
        rot = Matrix.Rotation(-math.radians(fb), 4, 'Z')
        base = bear(fb, fdist)
        rbox(feet, (fw, fd, fh), Matrix.Translation(base) @ rot, bevel=0.1, segs=3, taper=0.88)
        # the metal cap on the foot's top, where the strut stands
        rbox(caps, (fw * 0.66, fd * 0.62, 0.16), Matrix.Translation(bear(fb, fdist - 0.04, fh - 0.06)) @ rot, bevel=0.04,
             segs=2, taper=0.9)
        if cfg["tier"] == 3:   # black armour feet get gold edges at the bottom too
            rbox(caps, (fw + 0.05, fd + 0.05, 0.1), Matrix.Translation(base) @ rot, bevel=0.03, segs=2)
        # the strut: from the cap up into the ring (tier 1 bends out and back in; the tall tiers stand straight)
        z0 = fh + 0.06
        if cfg["tier"] == 1:
            p = [bear(fb, fdist - 0.08, z0), bear(fb, fdist + 0.02, z0 + 0.3), bear(fb, RING_R + 0.04, ring_z - 0.3),
                 bear(fb, RING_R, ring_z)]
        else:
            p = [bear(fb, fdist - 0.08, z0), bear(fb, fdist - 0.1, z0 + (ring_z - z0) * 0.4),
                 bear(fb, RING_R + 0.02, ring_z - (ring_z - z0) * 0.3), bear(fb, RING_R, ring_z)]
        rr = 0.12 if cfg["tier"] == 1 else 0.135
        tube(struts, bezier(*p, n=14), [rr + 0.02 * (1 - i / 13) for i in range(14)], sides=16, flat=0.8)
        if cfg["tier"] >= 2:   # a metal collar half way up the post
            zc = (z0 + ring_z) / 2
            L.add_mesh(caps, _cyl(0.15, 0.12), Matrix.Translation(bear(fb, (fdist - 0.1 + RING_R) / 2, zc - 0.06)))
        # the lamp sits on the foot's face that looks the lamp's way (its outer face, or a side face), near its top
        half = (fd if fc == fb else fw) / 2 * (0.95 if fc == fb else 0.92)
        c = bear(fb, fdist) + bear(fc, half) + Vector((0, 0, fh * 0.6))
        if cfg["lamps"]:
            face = bear(fc, 1.0)
            q = Vector((0, 0, 1)).rotation_difference(face)
            mm = Matrix.Translation(c) @ q.to_matrix().to_4x4()
            bmesh.ops.create_cone(lamps, cap_ends=True, segments=24, radius1=0.17, radius2=0.15, depth=0.08, matrix=mm)
            bmesh.ops.create_uvsphere(glass, u_segments=20, v_segments=10, radius=0.125,
                                      matrix=mm @ Matrix.Translation((0, 0, 0.04)) @ diag(1, 1, 1.05))
            bmesh.ops.create_uvsphere(glow, u_segments=20, v_segments=10, radius=0.24,
                                      matrix=mm @ Matrix.Translation((0, 0, 0.06)) @ diag(1, 1, 0.8))
        else:   # no lamp: a big rivet on the cap instead
            studs(caps, [bear(fb, fdist - 0.04 + fd * 0.31 * 0.62, fh + 0.03) + Vector((0, 0, 0))], [bear(fb, 1.0)], r=0.05)
    # the ring (tier 3: a solid lid with a raised edge)
    rmat = 0
    rings = bmesh.new()
    _torus(rings, RING_R, RING_W, 0.07, ring_z)
    if cfg["tier"] == 3:
        lid = L.lathe("lid", [[(RING_R + RING_W * 0.6, ring_z - 0.06), (RING_R + RING_W, ring_z - 0.04),
                               (RING_R + RING_W, ring_z + 0.04), (RING_R, ring_z + 0.05), (rim_r + 0.05, ring_z + 0.05),
                               (rim_r + 0.05, ring_z - 0.06)]], [wood], parent=body)
        L.add_outline(lid, LN)
    # the prongs: a tall one in front, short tabs to the sides, and two clusters of curved horns at the back
    prongs = bmesh.new()
    horn_z = ring_z + 0.05
    for pb, h, out, r0, lean in ((158, 0.72, 0.32, 0.17, -14), (180, 0.95, 0.4, 0.19, -8), (202, 0.8, 0.34, 0.17, -2),
                                 (250, 0.8, 0.34, 0.17, 2), (272, 0.97, 0.4, 0.19, 8), (294, 0.74, 0.32, 0.17, 14)):
        _horn(prongs, (RING_R, horn_z - 0.05), horn_z + h, RING_R + out, pb, r0, flat=0.55, lean=lean)
    _horn(prongs, (RING_R + 0.02, ring_z - 0.25), horn_z + 0.5, RING_R + 0.04, 45, 0.13, flat=0.8, tip=0.02)   # front
    for pb in (95, 355):   # short rounded tabs either side of the front
        _horn(prongs, (RING_R - 0.03, horn_z - 0.05), horn_z + 0.34, RING_R - 0.02, pb, 0.11, flat=0.55, tip=0.07)
    for name, b, mat, w in (("feet", feet, wood, None), ("struts", struts, strut, None), ("ring", rings, wood, None),
                            ("prongs", prongs, wood, None), ("caps", caps, band, L.LINE * 0.8)):
        ob = L.obj_from_bm(name, b, [mat], parent=body, sharp=50)
        L.add_outline(ob, LN, w)
    if cfg["lamps"]:
        lo = L.obj_from_bm("lamp_rims", lamps, [band], parent=body)
        L.add_outline(lo, LN, L.LINE * 0.7)
        L.obj_from_bm("lamp_glass", glass, [M["lens"]], parent=body)
        L.obj_from_bm("lamp_glow", glow, [M["glow"]], parent=body)
    else:
        for b in (lamps, glass, glow):
            b.free()

    # ---- the turning part: collar, yoke, barrel (and the lamp on the brass tier 1). Built pointing at +Y (bearing 0),
    # turned about Z by -heading.
    gun_m, gb_m = M[cfg["gun"]], M[cfg["gunband"]]
    tur = L.empty("TURRET", loc=(0, 0, top + 0.02))
    tur.scale = (TURRET_SCALE,) * 3
    collar = L.lathe("collar", [L.band(0.0, 0.5, 0.0, 0.1, bev=0.03), [(0.45, 0.1), (0.32, 0.13), (0.0, 0.13)]],
                     [gb_m], parent=tur)
    L.add_outline(collar, LN)
    bm = bmesh.new()
    for sx in (-1, 1):   # the two brackets with their round tops and trunnion caps
        rbox(bm, (0.1, 0.42, 0.28), Matrix.Translation((sx * 0.38, 0.0, 0.1)), bevel=0.03)
        L.add_mesh(bm, _cyl(0.2, 0.1, 28), Matrix.Translation((sx * 0.43, 0, 0.4)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        L.add_mesh(bm, _cyl(0.12, 0.08, 24, 0.1), Matrix.Translation((sx * 0.51, 0, 0.4)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    yoke = L.obj_from_bm("yoke", bm, [gb_m], parent=tur, sharp=35)
    L.add_outline(yoke, LN)
    bm = bmesh.new()
    c, nn = ring_of(14, 0.5, 0.05)
    studs(bm, c, nn, r=0.03)
    for sx in (-1, 1):
        studs(bm, [(sx * 0.595, 0, 0.4)], [(sx, 0, 0)], r=0.04)
        studs(bm, [(sx * 0.435, y, z) for y, z in ((-0.15, 0.2), (0.15, 0.2))], [(sx, 0, 0)] * 2, r=0.025)
    L.obj_from_bm("rivets_yoke", bm, [M["rivet"]], parent=tur)

    gun = L.empty("GUN", parent=tur, loc=(0, 0, 0.4))
    gun.rotation_euler = (math.radians(TILT), 0, 0)
    # barrel along its local +Z (turned to +Y): rear knob, rear band, tube, middle band, tube, muzzle ring, bore
    br = 0.31
    barrel = L.lathe("barrel", [
        [(0.0, -0.66), (0.13, -0.65), (0.24, -0.6), (0.30, -0.52)],              # rear knob
        L.band(br - 0.01, br + 0.045, -0.54, -0.38),                               # rear band
        [(br, -0.39), (br - 0.005, 0.2)],                                          # tube
        L.band(br - 0.01, br + 0.04, 0.18, 0.34),                                  # middle band
        [(br - 0.005, 0.33), (br - 0.02, 0.92)],                                   # tube, a little narrower to the muzzle
        L.band(br - 0.02, br + 0.11, 0.88, 1.08, bev=0.035),                       # muzzle ring, outside
        [(br + 0.11, 1.08), (br + 0.04, 1.095), (0.24, 1.08)],                     # muzzle face
        [(0.24, 1.08), (0.235, 0.4), (0.0, 0.4)],                                  # bore
    ], [gun_m, gb_m, M["bore"]], mat_of_seg=[1, 1, 0, 1, 0, 1, 1, 2], parent=gun, sharp=35)
    barrel.rotation_euler = (-math.pi / 2, 0, 0)
    L.add_outline(barrel, LNC if cfg["gun"] in ("steel", "gunmetal", "black") else LN)
    bm = bmesh.new()
    for z, r, n in ((-0.46, br + 0.045, 12), (0.26, br + 0.04, 12), (0.98, br + 0.11, 14)):
        c, nn = ring_of(n, r, z, 0.5)
        studs(bm, c, nn, r=0.028)
    riv = L.obj_from_bm("rivets_gun", bm, [M["rivet"]], parent=gun)
    riv.rotation_euler = (-math.pi / 2, 0, 0)
    if cfg["lamps"]:   # the little lamp on top at the back, on a post, its lens facing forward
        bm = bmesh.new()
        rbox(bm, (0.07, 0.1, 0.16), Matrix.Translation((0, -0.32, 0.27)), bevel=0.02)
        L.add_mesh(bm, _cyl(0.1, 0.13, 20), Matrix.Translation((0, -0.30, 0.5)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
        lp = L.obj_from_bm("gun_lamp", bm, [gb_m], parent=gun, sharp=35)
        L.add_outline(lp, LN, L.LINE * 0.8)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.08,
                                  matrix=Matrix.Translation((0, -0.22, 0.5)) @ diag(1, 0.55, 1))
        L.obj_from_bm("gun_lens", bm, [M["lens"]], parent=gun)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.15,
                                  matrix=Matrix.Translation((0, -0.2, 0.5)) @ diag(1, 0.6, 1))
        L.obj_from_bm("gun_lamp_glow", bm, [M["glow"]], parent=gun)
    return body, tur, top + 0.02


def _cyl(r, depth, segs=24, r2=None):
    """A capped cylinder along Z centred on the origin, as a bmesh (for add_mesh)."""
    b = bmesh.new()
    bmesh.ops.create_cone(b, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    return b


def _torus(bm, R, hw, hh, z, n=128, k=20):
    """A squarish band round the Z axis: middle radius R, half width hw, half height hh, at height z."""
    rings = []
    sgn = L.sgn
    sq = [(sgn(math.cos(2 * math.pi * j / k)) * abs(math.cos(2 * math.pi * j / k)) ** 0.35,
           sgn(math.sin(2 * math.pi * j / k)) * abs(math.sin(2 * math.pi * j / k)) ** 0.35) for j in range(k)]
    for i in range(n):
        a = 2 * math.pi * i / n
        rings.append([bm.verts.new(((R + hw * c) * math.cos(a), (R + hw * c) * math.sin(a), z + hh * s)) for c, s in sq])
    for i in range(n):
        a, b2 = rings[i], rings[(i + 1) % n]
        for j in range(k):
            bm.faces.new((a[j], b2[j], b2[(j + 1) % k], a[(j + 1) % k]))


def _horn(bm, base, top_z, out_d, bearing, r0, flat=0.72, n=14, tip=0.025, lean=0.0):
    """A curved prong: from base (d, z) up and bending outward to (out_d, top_z), tapering to a blunt tip; thick at the
    root (a claw, not a spike)."""
    d0, z0 = base
    p = [bear(bearing, d0, z0), bear(bearing, d0 + 0.02, z0 + 0.5 * (top_z - z0)),
         bear(bearing + lean * 0.5, d0 + 0.45 * (out_d - d0), z0 + 0.88 * (top_z - z0)),
         bear(bearing + lean, out_d, top_z)]
    tube(bm, bezier(*p, n=n), [(r0 - tip) * (1 - i / (n - 1)) ** 0.7 + tip for i in range(n)], sides=14, flat=flat)


# ------------------------------------------------------------------------------------------------------------------- main
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["t1", "body"]
    name, what = argv[0], argv[1]
    cfg = TIERS[name]
    cv = CANVAS[cfg["tier"]]
    out = HERE / "render" / name
    L.canvas(*cv["size"], cv["box"], out)
    body, tur, top = build(cfg)
    cam = L.setup_render()
    body_obs, tur_obs = L.objs_under(body), L.objs_under(tur)
    box = L.fit(cam, body_obs)
    # the turning point: on the turning axis, at the height where the painted pivot is drawn
    ax, ay_top = L.to_px(cam, (0, 0, top))
    _, ay_up = L.to_px(cam, (0, 0, top + 1))
    zp = top + (cv["pivot"][1] - ay_top) / (ay_up - ay_top)
    px, py = L.to_px(cam, (0, 0, zp))
    (out / "camera.json").write_text(json.dumps(dict(
        tier=name, elevation=L.EL, tilt=TILT, ortho_scale=cam.data.ortho_scale, shift=[cam.data.shift_x, cam.data.shift_y],
        body_box=[round(v, 1) for v in box], pivot_4x=[round(px, 2), round(py, 2)], painted_pivot_4x=cv["pivot"],
        turntable_4x=[round(ax, 2), round(ay_top, 2)], pivot_height=round(zp, 3), canvas=list(cv["size"])), indent=1))
    if what == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / f"cannon-{name}.blend"))
        return
    line_col = L.LINE_COLS[cfg["line"]]

    def body_shot():
        L.shot(out / "body-4x.png", body_obs, outer_col=line_col)

    def barrels(heads):
        (out / "barrel-4x").mkdir(exist_ok=True)
        avoid = L.load_alpha(out / "body-4x.png")
        for k in heads:
            tur.rotation_euler = (0, 0, -math.radians(11.25 * k))
            L.shot(out / "barrel-4x" / f"h{k:02d}.png", tur_obs, cut=body_obs, avoid=avoid, outer_col=line_col)

    if what == "body":
        body_shot()
    elif what == "all":
        body_shot()
        barrels(range(32))
    elif what == "full":
        for h in argv[2:]:
            tur.rotation_euler = (0, 0, -math.radians(11.25 * int(h)))
            L.shot(out / f"full-h{int(h):02d}.png", body_obs + tur_obs, outer_col=line_col)
    elif what == "barrel":
        barrels([int(a) for a in argv[2:]] or range(32))
    print("DONE", name, what, "box", [round(v, 1) for v in box], "pivot", round(px, 1), round(py, 1),
          "turntable", round(ax, 1), round(ay_top, 1))


main()
