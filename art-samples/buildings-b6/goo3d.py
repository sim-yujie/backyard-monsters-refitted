"""goo3d.py : the Goo Factory (type 4) in 3D (buildings-3d-b6, 29 Oct 2026, for beta 6), after the Flash art in
server/public/assets/buildings/goofactory.v2/ (looks at levels 1, 3, 6 and 10).

    blender -b --factory-startup -P goo3d.py -- LEVEL still | anim [N] | save        (see bldg3d.run)

The Flash building: an orange vat of green goo under a dark steel funnel cap, a brass elbow pipe out of its front-right.
  L1   the vat on a dark log stool, goo spilling over its rim and running down its sides
  L3   a lumpy goo dome on the vat under steel straps from the funnel, small steel fins at the top; two wooden ring frames
       (round the rim and round the foot) held up by yellow pencils with pink erasers, standing on their points
  L6   + two big brass elbows at the front, brass pipes up both sides (a loop at the left, a tall one at the right),
       steel bands on the pencils
  L10  + a tall brass column at the left with goo on top, a stack of brass pipes at the right, a brass pipe ring on the
       ground round the foot
Producing: lumps of goo travel up the front pipes (the pipes swell round them), as Flash's animation; the goo bubbles.
"""
import math
import random
import sys
from pathlib import Path

import bmesh
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bldg3d as B  # noqa: E402
from bldg3d import L, W  # noqa: E402


def look_of(level):
    return 10 if level >= 10 else 6 if level >= 6 else 3 if level >= 3 else 1


def materials():
    return dict(
        vat=B.mat_paint("vat", (232, 138, 26), under=(120, 66, 24), edge=(255, 204, 120), chips=0.7, spec=0.55,
                        spec_rough=0.25, dirt=0.3),
        goo=B.mat_goo("goo", col=(64, 158, 34), deep=(16, 70, 12), hi=(190, 250, 130)),
        brass=L.mat_metal("brass", "brass"),
        cap=L.mat_metal("cap", "gunmetal", polish=0.4),
        steel=L.mat_metal("steel", "steel", polish=0.4),
        log=W.mat_raw_wood("log", light=(122, 76, 50), dark=(74, 44, 30), coord="Object", stretch=(5.0, 5.0, 0.3)),
        board=W.mat_raw_wood("board", light=(150, 98, 62), dark=(96, 60, 38), coord="Object", stretch=(1.6, 1.6, 1.6)),
        pencil=B.mat_paint("pencil", (246, 206, 40), under=(196, 150, 90), edge=(255, 240, 150), chips=0.74, spec=0.4),
        eraser=L.mat_flat("eraser", (236, 128, 178), spec=0.15),
        wood=L.mat_flat("wood", (236, 196, 146), spec=0.1),
        lead=L.mat_flat("lead", (52, 50, 56), spec=0.4),
        dark=L.mat_flat("dark", (30, 22, 18), spec=0.05),
    )


# ------------------------------------------------------------------------------------------------------------ helpers
def rounded(corners, rad, step=0.03):
    """A pipe's centre line through `corners`, each inner corner rounded off (radius about rad), points `step` apart."""
    cs = [Vector(c) for c in corners]
    pts = [cs[0]]
    for i in range(1, len(cs) - 1):
        a, p, c = cs[i - 1], cs[i], cs[i + 1]
        r = min(rad, (p - a).length * 0.5, (c - p).length * 0.5)
        s, e = p + (a - p).normalized() * r, p + (c - p).normalized() * r
        pts.append(s)
        pts += [(1 - t) ** 2 * s + 2 * (1 - t) * t * p + t * t * e for t in (k / 8 for k in range(1, 8))]
        pts.append(e)
    pts.append(cs[-1])
    out = [pts[0]]
    for q in pts[1:]:                                  # even spacing, so a swelling keeps its size along the pipe
        d = q - out[-1]
        n = max(1, round(d.length / step))
        out += [out[-1] + d * (k / n) for k in range(1, n + 1)]
    return out


def flange(bm, p, t, r, depth=0.05):
    B.disc(bm, r, depth, Matrix.Translation(p) @ B.along(t), segs=20)


def pipe(name, pts, r, M, parent, flanges=(True, True), sides=16, k=0.7):
    """A brass pipe along pts with flanges at its ends; returns (object, pts, sides) for swell()."""
    bm = bmesh.new()
    L.tube(bm, pts, [r] * len(pts), sides=sides)
    ob = B.part(name, bm, M["brass"], parent, line="cool", k=k)
    bm = bmesh.new()
    if flanges[0]:
        flange(bm, pts[0] + (pts[1] - pts[0]).normalized() * 0.02, pts[1] - pts[0], r * 1.35)
    if flanges[1]:
        flange(bm, pts[-1] - (pts[-1] - pts[-2]).normalized() * 0.02, pts[-1] - pts[-2], r * 1.35)
    if len(bm.verts):
        B.part(name + "_flanges", bm, M["brass"], parent, line="cool", k=k)
    else:
        bm.free()
    return ob, pts, sides


def swell(p, c, amp=0.5, w=0.08):
    """Make pipe p (from pipe()) swell round a lump of goo at c (0 = its first end, 1 = its last; outside, no lump)."""
    ob, pts, sides = p
    me = ob.data
    if "rest_co" not in ob:
        ob["rest_co"] = [x for v in me.vertices for x in v.co]
    rest = ob["rest_co"]
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + (b - a).length)
    co = list(rest)
    for i, ctr in enumerate(pts):
        u = lens[i] / lens[-1]
        s = 1 + amp * math.exp(-((u - c) / w) ** 2)
        for j in range(sides):
            n = 3 * (i * sides + j)
            for a in range(3):
                co[n + a] = ctr[a] + (rest[n + a] - ctr[a]) * s
    me.vertices.foreach_set("co", co)
    me.update()


def lump(bm, c, r, seed, squash=1.0):
    s = bmesh.new()
    bmesh.ops.create_icosphere(s, subdivisions=2, radius=1.0)
    for v in s.verts:
        v.co *= 1 + 0.16 * math.sin(v.co.x * 4 + seed) * math.cos(v.co.y * 3 + seed * 2) * math.sin(v.co.z * 3 + seed)
    L.add_mesh(bm, s, Matrix.Translation(c) @ Matrix.Diagonal((r, r, r * squash, 1)))


def drip(bm, b, z, ln, w, R, rows=16, cols=11):
    """A run of goo down a round wall (radius R) from height z at bearing b: a flat tongue `w` wide, thick in its
    middle, narrowing, then a round drop at its foot."""
    sub = bmesh.new()
    vs = []
    for i in range(rows + 1):
        t = i / rows
        half = w * (0.5 - 0.18 * t) if t < 0.78 else w * 0.42 * math.sqrt(max(0.0, 1 - ((t - 0.78) / 0.22) ** 2))
        half = max(half, 0.004)
        row = []
        for j in range(cols + 1):
            s = 2 * j / cols - 1
            th = (0.04 + 0.025 * max(0.0, (t - 0.7) / 0.3)) * math.sqrt(max(0.0, 1 - s * s))
            a = math.radians(b) + s * half / R
            r = R + th
            zz = z - ln * t - (0.04 * (1 - s * s) if t > 0.9 else 0.0)
            row.append(sub.verts.new((r * math.sin(a), r * math.cos(a), zz)))
        vs.append(row)
    for i in range(rows):
        for j in range(cols):
            sub.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    for f in sub.faces:                                # outward, away from the wall
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y, 0))) < 0:
            f.normal_flip()
    L.add_mesh(bm, sub, Matrix())


def elbow(b, r0, z0, r1, rad):
    """A pipe from the ground at bearing b, distance r1, up and round into the vat's wall (distance r0) at height z0."""
    return rounded([L.bear(b, r1, 0.04), L.bear(b, r1, z0), L.bear(b, r0, z0)], rad)


# ------------------------------------------------------------------------------------------------------------- build
def build(level):
    lk = look_of(level)
    L.clear_scene()
    M = materials()
    root = L.empty("ROOT")
    rnd = random.Random(lk)
    VR = 0.44                                          # the vat's radius
    Z0 = 0.36 if lk == 1 else 0.3                      # its foot
    ZR = Z0 + (0.74 if lk == 1 else 0.6)               # its rim
    lumps, bubbles, pipes = [], [], []

    # ---- the vat
    prof = [(0.0, Z0), (VR * 0.9, Z0), (VR, Z0 + 0.03), (VR, ZR - 0.05), (VR * 1.05, ZR - 0.04), (VR * 1.05, ZR),
            (VR * 0.95, ZR), (VR * 0.95, ZR - 0.1)]
    vat = W.lathe("vat", [prof], [M["vat"]], parent=root, n=64, wob=0.008, seed=lk)
    L.add_outline(vat, L.line("warm"))

    if lk == 1:
        # ---- the log stool: a round board on four dark logs
        bm = bmesh.new()
        B.disc(bm, VR * 0.95, 0.08, Matrix.Translation((0, 0, Z0 - 0.04)), segs=32)
        B.part("stool", bm, M["board"], root)
        bm = bmesh.new()
        for b in (45, 135, 225, 315):
            c = L.bear(b + rnd.uniform(-8, 8), VR * 0.7)
            B.disc(bm, 0.085, Z0 - 0.08, Matrix.Translation(c + Vector((0, 0, (Z0 - 0.08) / 2))), segs=12, r2=0.075)
        B.part("logs", bm, M["log"], root)

        # ---- the goo: brimming over, a lumpy lip, runs down the sides ending in drops
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=24, y_segments=24, size=VR)
        for v in list(bm.verts):
            d = v.co.length
            if d > VR:
                v.co *= VR / d
                d = VR
            v.co.z = ZR + 0.02 + 0.03 * math.sin(v.co.x * 15) * math.cos(v.co.y * 12) + 0.12 * (1 - (d / VR) ** 2) ** 0.7
        B.part("goo_top", bm, M["goo"], root, line=None)
        bm = bmesh.new()
        ring = [L.bear(360 * i / 40, VR * 1.0, ZR + 0.01) for i in range(41)]
        L.tube(bm, ring, [0.05 + 0.02 * math.sin(i * 1.7) for i in range(41)], sides=10, cap=False)
        for b, ln, w in ((20, 0.36, 0.2), (62, 0.56, 0.24), (104, 0.3, 0.16), (142, 0.46, 0.22), (180, 0.24, 0.16),
                         (336, 0.32, 0.2), (294, 0.5, 0.22), (250, 0.26, 0.16)):
            drip(bm, b, ZR + 0.01, ln * (1.0 + rnd.uniform(-0.1, 0.1)), w, VR + 0.004)
        for b, r in ((80, 0.11), (30, 0.08), (150, 0.12)):     # puddles run off onto the stool
            lump(bm, L.bear(b, VR * 0.98, Z0 + 0.01), r, b, squash=0.45)
        B.part("goo_spill", bm, M["goo"], root, line="cool", k=0.5)
        # bubbles on the top, growing and bursting while producing
        for k, (b, d) in enumerate(((60, 0.18), (250, 0.25), (150, 0.1))):
            piv = B.mover(f"bubble{k}", root, L.bear(b, d, ZR + 0.03 + 0.12 * (1 - (d / VR) ** 2) ** 0.7))
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.07)
            B.part(f"bubble{k}_ball", bm, M["goo"], piv, line="cool", k=0.4)
            bubbles.append(piv)
        NZ0, DZ, DR = ZR + 0.1, ZR + 0.6, 0.24                   # the funnel: neck foot, cap's underside, cap's radius
    else:
        # ---- the dome of goo: a lumpy round heap over the rim, its lumps swelling and sinking while producing
        DT = ZR + 0.5                                  # its top
        prof = [(VR * 1.02, ZR - 0.04)] + [(VR * 1.1 * math.cos(a), ZR + (DT - ZR) * math.sin(a))
                                          for a in (k * math.pi / 2 / 10 for k in range(11))]
        dome = W.lathe("dome", [prof], [M["goo"]], parent=root, n=48, bev=0, wob=0.03, wob_scale=5.0, seed=lk)
        L.add_outline(dome, L.line("cool"), L.LINE * 0.6)
        for k in range(26):
            a = math.pi / 2 * ((0.12 + 0.3 * rnd.random()) if k % 2 else (0.5 + 0.35 * rnd.random()))
            b = 360 * k / 26 + rnd.uniform(-8, 8)
            c = L.bear(b, VR * 1.1 * math.cos(a) * 0.92, ZR + (DT - ZR) * math.sin(a) * 0.92)
            piv = B.mover(f"lump{k}", root, c)
            bm = bmesh.new()
            lump(bm, Vector(), 0.1 + 0.05 * rnd.random(), k)
            B.part(f"lump{k}_ball", bm, M["goo"], piv, line="cool", k=0.5)
            lumps.append(piv)
        NZ0, DZ, DR = DT - 0.06, DT + 0.22, 0.28

        # ---- the ring frames (octagons of planks round the rim and round the foot) and the pencils holding them up
        RO, RI = 0.62, VR - 0.02
        for nm, z in (("ring_lo", Z0 - 0.06), ("ring_hi", ZR - 0.1)):
            ob = W.lathe(nm, [[(RI, z), (RO, z), (RO, z + 0.07), (RI, z + 0.07)]], [M["board"]], parent=root, n=8,
                         bev=0.012)
            L.add_outline(ob, L.line("warm"))
        bm = bmesh.new()
        B.disc(bm, RI + 0.01, 0.05, Matrix.Translation((0, 0, Z0 - 0.025)), segs=32)
        B.part("floor", bm, M["board"], root)
        PB = [0, 45, 90, 135, 180, 225, 270, 315]       # the octagon's corners
        PRAD = RO - 0.05
        top = ZR + 0.12
        body, ers, fer, cone, lead = (bmesh.new() for _ in range(5))
        for b in PB:
            c = L.bear(b, PRAD)
            rot = Matrix.Rotation(math.radians(-b), 4, 'Z')
            B.disc(body, 0.036, top - 0.2, Matrix.Translation(c + Vector((0, 0, 0.2 + (top - 0.2) / 2))) @ rot,
                   segs=6)
            B.disc(cone, 0.036, 0.16, Matrix.Translation(c + Vector((0, 0, 0.12))) @ rot, segs=6, r2=0.01)
            B.disc(lead, 0.013, 0.06, Matrix.Translation(c + Vector((0, 0, 0.03))), segs=8, r2=0.001)
            B.disc(fer, 0.039, 0.05, Matrix.Translation(c + Vector((0, 0, top + 0.025))), segs=16)
            B.disc(ers, 0.035, 0.06, Matrix.Translation(c + Vector((0, 0, top + 0.08))), segs=16)
            if lk >= 6:                                # steel bands where the rings cross them
                for z in (Z0 - 0.02, ZR - 0.06):
                    B.disc(fer, 0.041, 0.1, Matrix.Translation(c + Vector((0, 0, z))), segs=16)
        B.part("pencils", body, M["pencil"], root, sharp=20)
        B.part("pencil_wood", cone, M["wood"], root, k=0.7)
        B.part("pencil_lead", lead, M["lead"], root, line=None)
        B.part("pencil_bands", fer, M["steel"], root, line="cool", k=0.6)
        bmesh.ops.create_icosphere(ers, subdivisions=1, radius=0.001)       # (keeps the bm non-empty)
        for b in PB:                                   # the erasers' rounded tops
            bmesh.ops.create_uvsphere(ers, u_segments=12, v_segments=6, radius=0.035,
                                      matrix=Matrix.Translation(L.bear(b, PRAD, top + 0.11)) @ L.diag(1, 1, 0.4))
        B.part("erasers", ers, M["eraser"], root, k=0.7)

        # ---- steel straps from the funnel's neck down over the dome to the top ring; small fins at the top
        bm = bmesh.new()
        for k in range(6):
            b = 360 * k / 6 + 15
            pts = []
            for i in range(13):
                a = math.pi / 2 * (1 - i / 12) * 0.92 + 0.08
                pts.append(L.bear(b, VR * 1.1 * math.cos(a) + 0.03,
                                  ZR + (DT - ZR) * math.sin(a) + 0.04))
            pts = [L.bear(b, 0.08, NZ0 + 0.12)] + pts + [L.bear(b, RO - 0.12, ZR - 0.03)]
            L.tube(bm, pts, [0.024] * len(pts), sides=8, flat=0.5)
        B.part("straps", bm, M["steel"], root, line="cool", k=0.5)
        bm = bmesh.new()
        for b in (135, 315, 45, 225):
            m = Matrix.Translation(L.bear(b, 0.3, NZ0 + 0.16)) @ Matrix.Rotation(math.radians(-b), 4, 'Z')
            L.rbox(bm, (0.04, 0.34, 0.06), m @ Matrix.Rotation(math.radians(-12), 4, 'X'), bevel=0.012, segs=2)
        B.part("fins", bm, M["steel"], root, line="cool", k=0.6)

    # ---- the funnel cap: a narrow neck down into the goo, a wide flat dish on top
    cap = W.lathe("cap", [[(0.12, NZ0 - 0.04), (0.09, NZ0 + 0.06), (0.065, NZ0 + 0.14), (0.065, DZ - 0.16),
                           (0.09, DZ - 0.1), (DR * 0.8, DZ + 0.02), (DR, DZ + 0.05), (DR, DZ + 0.08),
                           (DR * 0.8, DZ + 0.12), (DR * 0.4, DZ + 0.145), (0.0, DZ + 0.15)]], [M["cap"]], parent=root, n=48)
    L.add_outline(cap, L.line("cool"))
    bm = bmesh.new()
    B.disc(bm, 0.09, 0.04, Matrix.Translation((0, 0, NZ0 + 0.2)), segs=24)
    B.disc(bm, 0.09, 0.04, Matrix.Translation((0, 0, DZ - 0.1)), segs=24)
    B.part("cap_bands", bm, M["brass"], root, line="cool", k=0.5)

    # ---- the brass elbows at the front, out of the vat and down to the ground: lumps of goo go up them
    if lk < 6:
        pipes.append(pipe("elbow", elbow(12, VR - 0.05, Z0 + 0.24, VR + 0.3, 0.14), 0.075 if lk == 1 else 0.085, M,
                          root, flanges=(True, False)))
    else:
        pipes.append(pipe("elbow_r", elbow(8, VR - 0.05, Z0 + 0.26, VR + 0.34, 0.16), 0.11, M, root,
                          flanges=(True, False)))
        pipes.append(pipe("elbow_l", elbow(84, VR - 0.05, Z0 + 0.3, VR + 0.32, 0.16), 0.11, M, root,
                          flanges=(True, False)))
        # ---- side pipes: a loop out at the left; a tall one at the right, up from the dome, over and down
        pipe("side_l", rounded([L.bear(150, RI, ZR - 0.25), L.bear(150, RO + 0.12, ZR - 0.25),
                                L.bear(150, RO + 0.12, ZR + 0.15), L.bear(150, 0.42, ZR + 0.32)], 0.12), 0.055, M,
             root)
        pipe("side_r", rounded([L.bear(318, 0.3, DT - 0.08), L.bear(318, 0.3, ZR + 0.95), L.bear(318, RO + 0.02, ZR + 0.95),
                                L.bear(318, RO + 0.02, ZR - 0.02)], 0.12), 0.055, M, root)

    if lk == 10:
        # ---- the tall column at the left, goo brimming on top, a pipe from it into the dome and one down to the ground
        cc = L.bear(178, RO + 0.22)
        CH = 1.95
        col = W.lathe("column", [[(0.0, 0.0), (0.17, 0.0), (0.17, 0.06), (0.13, 0.08), (0.13, CH - 0.1),
                                  (0.16, CH - 0.08), (0.16, CH), (0.12, CH), (0.12, CH - 0.04)]], [M["brass"]],
                      parent=root, n=40)
        col.matrix_basis = Matrix.Translation(cc)
        L.add_outline(col, L.line("cool"), L.LINE * 0.8)
        bm = bmesh.new()
        lump(bm, cc + Vector((0, 0, CH - 0.02)), 0.13, 3, squash=0.6)
        B.part("column_goo", bm, M["goo"], root, line="cool", k=0.5)
        bm = bmesh.new()
        for z in (0.5, 1.1, 1.6):
            B.disc(bm, 0.15, 0.05, Matrix.Translation(cc + Vector((0, 0, z))), segs=24)
        B.part("column_bands", bm, M["brass"], root, line="cool", k=0.5)
        pipe("column_in", rounded([cc + Vector((0, 0, 1.35)), L.bear(158, 0.5, 1.35), L.bear(158, 0.32, DT - 0.1)],
                                  0.12), 0.05, M, root)
        pipe("column_out", rounded([cc + L.bear(225, 0.0, CH - 0.25) + L.bear(165, 0.12),
                                    cc + L.bear(165, 0.36, CH - 0.25), cc + L.bear(165, 0.36, 0.04)], 0.14), 0.055,
             M, root, flanges=(False, True))
        # ---- the stack of pipes at the right: three nested arches from the dome over to the right
        for k, (h, d) in enumerate(((ZR + 1.15, 0.0), (ZR + 1.0, 0.12), (ZR + 0.85, 0.24))):
            pipe(f"stack{k}", rounded([L.bear(290 - 12 * k, 0.32 + d * 0.5, DT - 0.12 - d * 0.4),
                                       L.bear(290 - 12 * k, 0.32 + d * 0.5, h),
                                       L.bear(290 - 12 * k, RO + 0.06 + d, h),
                                       L.bear(290 - 12 * k, RO + 0.06 + d, ZR - 0.02)], 0.1), 0.045, M, root, k=0.6)
        # ---- the pipe ring round the foot, on the ground
        bm = bmesh.new()
        ring = [L.bear(360 * i / 8 + 22.5, RO + 0.14, 0.07) for i in range(9)]
        L.tube(bm, rounded(ring, 0.1), [0.05] * len(rounded(ring, 0.1)), sides=12, cap=False)
        B.part("ground_ring", bm, M["brass"], root, line="cool", k=0.6)
        bm = bmesh.new()
        for b in range(0, 360, 45):
            B.disc(bm, 0.06, 0.08, Matrix.Translation(L.bear(b, PRAD, 0.04)), segs=16)
        B.part("pencil_sockets", bm, M["dark"], root, k=0.6)

    def animate(phase):
        for k, p in enumerate(pipes):                  # a lump goes up each front pipe once a loop
            swell(p, -0.15 + 1.3 * ((phase + 0.5 * k) % 1.0), amp=0.45 if lk < 6 else 0.5)
        for k, piv in enumerate(lumps):                # the dome's lumps swell and sink, each in its own time
            s = 1 + 0.12 * math.sin(2 * math.pi * (phase * (1 + k % 2) + k * 0.37))
            piv.scale = (s, s, s)
        for k, piv in enumerate(bubbles):              # the bubbles grow, then burst
            t = (phase + k / 3) % 1.0
            s = 0.01 if t > 0.85 else 0.2 + 0.8 * t / 0.85
            piv.scale = (s, s, s * 0.8)
    return root, animate


if __name__ == "__main__":
    B.run("goo", build, HERE)
