"""bunker3d.py : the Monster Bunker, tiers 1-3, as a 3D model in the game's camera (towers-3d-export, 29 Oct 2026), modelled
on the Flash bunker (server/public/assets/buildings/bunker/anim.1.png) and its painted tiers (top.tN@2x.webp), in the worn,
detailed look of the approved 3D towers (../tower-3d/worn3d.py).

  blender -b --factory-startup -P bunker3d.py -- T body | rise F [F ...] | save

(see ../tower-3d/static3d.py). The bunker: iron legs at the corners (a round hatch on the front one), a rolled steel shutter
bulging out between each pair of legs (tier 2 gold, tier 3 black), a deck, a red and white striped roof (tier 3 black and
yellow) with wire clips, a wooden rolling-pin handle out of each side, and the grater on top, perforated, with slits and a
handle loop. Tier 2 stands on a gold block, tier 3 on two black blocks trimmed with gold.

The shutters hang from the empty `BOTTOM`: when the bunker lets its monsters out they roll up into a band under the deck
(as the Flash bunker's do), showing the dark doorways between the legs. `rise F` renders them F of the way up.
"""
import math
import os
import sys
from pathlib import Path

import bmesh
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tower-3d"))
import look3d as L  # noqa: E402
L.EL = float(os.environ.get("BUNKER_EL", 30.0))
import square3d as Q  # noqa: E402
import static3d as S  # noqa: E402
import worn3d as W  # noqa: E402
from look3d import add_outline, bear, srgb  # noqa: E402

L.METALS.update(pblack=((8, 6, 10), (34, 30, 38), (80, 76, 96), (0.8, 0.86, 1.0, 1)))   # the Railgun's polished black
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["1", "body"]
TIER = int(ARGS[0])
PL = {1: 0.0, 2: 0.36, 3: 0.72}[TIER]       # the plinth's height: the bunker grows taller each tier
SH = 0.54                                   # the shutters' height
LEG = 0.62                                  # the legs' centres, from the middle along x and y
D_IN = 0.5                                  # the shutters' top, from the middle (a face's distance)
BULGE = 0.36                                # how far the shutters' foot stands out of their top


def mat_face_stripes(name, a, b, period=0.26, under=(110, 80, 60), edge=(236, 220, 200)):
    """Painted stripes running down each face of a square roof (faces square to x and y), chipped and grimy."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ax, ay = p.math("ABSOLUTE", sep.outputs[0]), p.math("ABSOLUTE", sep.outputs[1])
    k = p.math("GREATER_THAN", ay, ax)                  # 1 on the faces square to y: x runs along them
    s = p.math("ADD", p.math("MULTIPLY", sep.outputs[0], k), p.math("MULTIPLY", sep.outputs[1], p.math("SUBTRACT", 1.0, k)))
    s = p.math("ADD", s, p.math("MULTIPLY", p.math("SUBTRACT", p.noise(3.0, 3.0), 0.5), 0.04))   # hand-painted edges
    bnd = p.math("GREATER_THAN", p.math("FRACT", p.math("DIVIDE", s, period)), 0.5)
    paint = p.mix(srgb(*a), srgb(*b), bnd)
    chip = p.ramp(p.noise(6.0, 9.0, 0.66), [(0.64, W.BLACK), (0.665, W.WHITE)])
    paint = p.mix(paint, srgb(*under), chip)
    col = W.weather(p, paint, edge=edge, edge_k=0.4, cavity=0.7, dirt=0.2, dirt_top=0.3, soot=0.1, streaks=0.2, vary=0.1)
    return p.finish(col, spec=0.2, spec_rough=0.4, bump=(p.math("MULTIPLY", W._bw(p, chip), -1.0), 0.35),
                    shade=L.WARM_SHADE)


def materials():
    iron = W.mat_iron
    M = dict(
        gold=L.mat_metal("gold", spec=1.0),          # the approved towers' polished gold (owner, 28 Oct)
        pblack=L.mat_metal("pblack", spec=0.9, polish=0.5),
        iron=iron("iron", base=(92, 88, 86), dark=(40, 38, 38), rust=(140, 78, 36), edge=(176, 170, 162), rust_k=0.55),
        tin=iron("tin", base=(176, 180, 186), dark=(96, 100, 108), rust=(150, 96, 56), edge=(240, 242, 246), rust_k=0.25,
                 dents=0.6, spec=0.45, spec_col=(1.0, 1.0, 1.0, 1)),
        shutter_steel=iron("shutter_steel", base=(140, 166, 200), dark=(66, 82, 108), rust=(150, 92, 52),
                           edge=(226, 234, 244), rust_k=0.35, dents=0.5, spec=0.4, spec_col=(0.9, 0.95, 1.0, 1)),
        wood=L.mat_wood("wood", light=(204, 140, 80), dark=(150, 92, 46), crack=(84, 48, 22)),
        hole=L.mat_flat("hole", (18, 14, 12), spec=0.0),
        dark=L.mat_flat("dark", (26, 20, 18), spec=0.05),
        ferrule=iron("ferrule", base=(70, 52, 40), dark=(34, 24, 20), rust=(120, 70, 36), edge=(150, 120, 96)),
        eyes=L.mat_flat("eyes", (255, 230, 90), spec=0.0, emit=(255, 200, 40)),
    )
    if TIER == 3:
        M.update(shutter=M["pblack"], leg=M["pblack"], deck=M["gold"], trim=M["gold"], ferrule=M["gold"],
                 grater=L.mat_metal("grater", "pblack", spec=0.5, polish=0.15),
                 roof=mat_face_stripes("roof", (30, 26, 30), (246, 186, 30), under=(70, 56, 40), edge=(250, 220, 140)),
                 plinth=M["pblack"])
    elif TIER == 2:
        M.update(shutter=M["gold"], leg=W.mat_forged("leg"), deck=M["gold"], trim=M["gold"], ferrule=M["gold"], grater=M["tin"],
                 roof=mat_face_stripes("roof", (204, 30, 26), (240, 232, 220)), plinth=M["gold"])
    else:
        M.update(shutter=M["shutter_steel"], leg=M["iron"], deck=M["iron"], trim=M["iron"], grater=M["tin"],
                 roof=mat_face_stripes("roof", (204, 30, 26), (240, 232, 220)), plinth=M["iron"])
    return M


def box(name, size, at, mat, parent, LN, bevel=0.03, line="warm", lw=None):
    bm = bmesh.new()
    L.rbox(bm, size, Matrix.Translation(at), bevel=bevel, segs=2)
    ob = W.obj(name, S.fill(bm), [mat], parent=parent, sharp=35)
    add_outline(ob, LN[line], lw)
    return ob


def face_m(nb):
    """Bearing nb's face frame: x along the face, y out of it, z up (from the middle)."""
    n, t = bear(nb), bear(nb + 90)
    return Matrix((t, n, Vector((0, 0, 1)))).transposed().to_4x4()


def shutter(bm, nb, z0, half_w):
    """One rolled shutter on the face whose outward bearing is nb: a quarter-round sheet from its foot (BULGE out of its top)
    up under the deck, ribbed across, given thickness."""
    m = face_m(nb)
    nu, nt = 28, 10
    sub = bmesh.new()
    rows = []
    for i in range(nt + 1):
        th = (math.pi / 2) * i / nt
        row = []
        for j in range(nu + 1):
            u = -half_w + 2 * half_w * j / nu
            rib = 0.005 * abs(math.cos(math.pi * u / 0.09))
            d = D_IN + BULGE * math.cos(th) + rib * math.cos(th * 0.6)
            row.append(sub.verts.new(m @ Vector((u, d, z0 + SH * math.sin(th) * 0.97))))
        rows.append(row)
    for i in range(nt):
        for j in range(nu):
            sub.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
    bmesh.ops.recalc_face_normals(sub, faces=sub.faces)
    for f in sub.faces:                     # outward: away from the middle
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y, 0))) < 0:
            f.normal_flip()
    bmesh.ops.solidify(sub, geom=list(sub.faces), thickness=0.03)
    L.add_mesh(bm, sub, Matrix())


def build():
    L.clear_scene()
    M = materials()
    LN = dict(warm=L.line("warm"), cool=L.line("cool"))
    body = L.empty("BODY")
    z0 = PL

    # ---- the plinth (tiers 2 and 3): gold block, or two black blocks with gold bands, bolted
    if TIER >= 2:
        layers = [(0.0, PL)] if TIER == 2 else [(0.0, PL / 2), (PL / 2, PL / 2)]
        for i, (zb, hh) in enumerate(layers):
            s = 1.62 - 0.08 * i
            box(f"plinth{i}", (s, s, hh - 0.01), (0, 0, zb), M["plinth"], body, LN, bevel=0.04)
            if TIER == 3:
                box(f"plinthband{i}", (s + 0.04, s + 0.04, 0.06), (0, 0, zb + hh - 0.08), M["gold"], body, LN, bevel=0.02,
                    line="cool", lw=L.LINE * 0.7)
            bm = bmesh.new()
            pts, nrms = [], []
            for nb in Q.SEEN:
                fm = face_m(nb)
                for u in (-0.55, -0.2, 0.2, 0.55):
                    pts.append(fm @ Vector((u, s / 2 + 0.005, zb + hh * 0.45)))
                    nrms.append(bear(nb))
            W.bolts(bm, pts, nrms, r=0.04)
            add_outline(W.obj(f"plinthbolts{i}", bm, [M["trim"] if TIER == 2 else M["gold"]], parent=body, sharp=35),
                        LN["cool"], L.LINE * 0.5)

    # ---- the dark inside (seen when the shutters rise) and the legs, the front one with a round hatch
    box("inside", (2 * D_IN - 0.04, 2 * D_IN - 0.04, SH), (0, 0, z0), M["dark"], body, LN, bevel=0.01)
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        box(f"leg{k}", (0.28, 0.28, SH + 0.02), (sx * LEG, sy * LEG, z0), M["leg"], body, LN, bevel=0.035, line="cool")
        bm = bmesh.new()
        pts = [Vector((sx * (LEG + 0.142), sy * (LEG + dy), z0 + h)) for dy in (-0.08, 0.08) for h in (0.1, SH - 0.08)] + \
              [Vector((sx * (LEG + dx), sy * (LEG + 0.142), z0 + h)) for dx in (-0.08, 0.08) for h in (0.1, SH - 0.08)]
        nrm = [Vector((sx, 0, 0))] * 4 + [Vector((0, sy, 0))] * 4
        W.rivets(bm, pts, nrm, r=0.026)
        W.obj(f"legrivets{k}", bm, [M["trim"]], parent=body)
    # the round hatch on the front leg's corner: a riveted ring, a dark vent behind a cross
    hm = Matrix.Translation(bear(45, LEG * math.sqrt(2) + 0.2, z0 + SH * 0.48)) @ \
        Vector((0, 0, 1)).rotation_difference(bear(45)).to_matrix().to_4x4()
    bm = bmesh.new()
    Q.cyl(bm, 0.15, 0.06, hm, segs=32)
    add_outline(W.obj("hatch", bm, [M["trim"]], parent=body, sharp=35), LN["cool"])
    bm = bmesh.new()
    Q.cyl(bm, 0.11, 0.02, hm @ Matrix.Translation((0, 0, 0.025)), segs=32)
    W.obj("hatchvent", bm, [M["hole"]], parent=body)
    bm = bmesh.new()
    for a in (45, 135):
        L.rbox(bm, (0.24, 0.035, 0.03), hm @ Matrix.Translation((0, 0, 0.02)) @ Matrix.Rotation(math.radians(a), 4, 'Z'),
               bevel=0.01, segs=1)
    pts = [hm @ Vector((0.13 * math.cos(2 * math.pi * i / 8), 0.13 * math.sin(2 * math.pi * i / 8), 0.03)) for i in range(8)]
    W.rivets(bm, pts, [bear(45)] * 8, r=0.018)
    add_outline(W.obj("hatchcross", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.6)

    # ---- the shutters, hung from BOTTOM so they can rise into the roof
    bottom = L.empty("BOTTOM", parent=body)
    bottom["top"] = z0 + SH          # they roll up into a band under the deck, as the Flash bunker's do
    bottom["squash"] = 0.14
    sh = bmesh.new()
    for nb in (0, 90, 180, 270):
        shutter(sh, nb, z0, LEG - 0.15)
    add_outline(W.obj("shutters", sh, [M["shutter"]], parent=bottom, sharp=30), LN["cool"])
    bm = bmesh.new()            # a riveted bar along each shutter's foot, and a row of rivets under the deck
    pts, nrm = [], []
    for nb in (0, 90, 180, 270):
        fm = face_m(nb)
        hw = LEG - 0.15
        L.tube(bm, [fm @ Vector((u, D_IN + BULGE + 0.015, z0 + 0.03)) for u in (-hw, hw)], [0.03, 0.03], sides=8)
        for u in [-hw + 2 * hw * (i + 0.5) / 7 for i in range(7)]:
            pts.append(fm @ Vector((u, D_IN + 0.06, z0 + SH * 0.86)))
            nrm.append(bear(nb) + Vector((0, 0, 0.6)))
    for nb in (0, 90, 180, 270):    # three riveted straps over each shutter, following its curve
        fm = face_m(nb)
        for u in (-0.27, 0.0, 0.27):
            prof = [(math.pi / 2) * i / 12 for i in range(13)]
            L.tube(bm, [fm @ Vector((u, D_IN + BULGE * math.cos(t) + 0.025, z0 + SH * math.sin(t) * 0.97)) for t in prof],
                   [0.032] * 13, sides=10, flat=0.45)
            for t in (0.25, 0.75, 1.2):
                pts.append(fm @ Vector((u, D_IN + BULGE * math.cos(t) + 0.05, z0 + SH * math.sin(t) * 0.97)))
                nrm.append(fm.to_3x3() @ Vector((0, math.cos(t) * SH, math.sin(t) * BULGE)).normalized())
    W.rivets(bm, pts, nrm, r=0.022)
    add_outline(W.obj("shutterbars", bm, [M["trim"] if TIER > 1 else M["iron"]], parent=bottom, sharp=35), LN["cool"],
                L.LINE * 0.6)

    # ---- the deck and the striped roof, wire clips along its foot
    zd = z0 + SH
    box("deck", (2 * D_IN + 0.3, 2 * D_IN + 0.3, 0.08), (0, 0, zd), M["deck"], body, LN, bevel=0.025, line="cool")
    zr0, zr1 = zd + 0.08, zd + 0.44
    bm = bmesh.new()
    Q.frustum(bm, 1.04, 0.56, zr0, zr1, bevel=0.03)
    roof = W.obj("roof", S.fill(bm), [M["roof"]], parent=body, sharp=35)
    add_outline(roof, LN["warm"])
    bm = bmesh.new()
    Q.frustum(bm, 0.6, 0.6, zr1 - 0.01, zr1 + 0.05, bevel=0.015)
    add_outline(W.obj("roofrim", bm, [M["trim"]], parent=body, sharp=35), LN["cool"], L.LINE * 0.7)
    lean = Q.lean_of(1.04, 0.56, zr0, zr1)
    bm = bmesh.new()
    for nb in (0, 90, 180, 270):
        for u in (-0.3, 0.3):
            fm = Q.face_frame(nb, zr0 + 0.12, 1.04 - (1.04 - 0.56) * 0.12 / 0.36, u=u, out=0.0, lean=lean)
            pts = [fm @ Vector((0.09 * math.cos(a), 0.05 + 0.08 * math.sin(a), 0.11 * math.sin(a) - 0.03))
                   for a in (math.radians(d) for d in range(-200, 30, 15))]
            L.tube(bm, pts, [0.02] * len(pts), sides=6)
    add_outline(W.obj("clips", bm, [M["tin"] if TIER < 3 else M["gold"]], parent=body, sharp=60), LN["cool"], L.LINE * 0.5)

    # ---- a wooden grip at each corner of the roof, pinwheel fashion as on the Flash and painted bunkers: each lies along one
    # side's foot and runs out past the corner (left corner out to the left, front corner out to the front-right, ...),
    # ringed at both ends, an end cap on the outer one, slung in two wire loops from the roof, a curled wire hook above it
    wood, fer, wire = bmesh.new(), bmesh.new(), bmesh.new()

    def rhs(z):
        """The roof's half side at height z."""
        return (1.04 + (0.56 - 1.04) * (z - zr0) / (zr1 - zr0)) * Q.APO

    zh = zr0 + 0.24
    for (sx, sy), ax in (((1, -1), 0), ((1, 1), 1), ((-1, 1), 0), ((-1, -1), 1)):
        along = Vector((sx, 0, 0)) if ax == 0 else Vector((0, sy, 0))         # out past the corner
        across = Vector((0, sy, 0)) if ax == 0 else Vector((sx, 0, 0))        # out of the side it lies along
        hs = rhs(zh)
        base = across * (hs + 0.085) + Vector((0, 0, zh))
        p0, p1 = base + along * (hs - 0.26), base + along * (hs + 0.32)
        n = 12
        pts = [p0 + (p1 - p0) * (t / (n - 1)) for t in range(n)]
        rad = [0.05, 0.064, 0.068, 0.07, 0.071, 0.071, 0.071, 0.071, 0.07, 0.068, 0.064, 0.05]
        L.tube(wood, pts, rad, sides=16)
        for t, r in ((0.08, 0.073), (0.88, 0.073)):
            q = p0 + (p1 - p0) * t
            L.tube(fer, [q - along * 0.014, q + along * 0.014], [r, r], sides=16)
        L.tube(fer, [p1 - along * 0.01, p1 + along * 0.02, p1 + along * 0.03], [0.054, 0.05, 0.026], sides=16)
        for t in (0.22, 0.6):                       # the wire loops: round the grip, back into the roof
            q = p0 + (p1 - p0) * t
            ring = [q + across * (0.082 * math.cos(a_)) + Vector((0, 0, 0.082 * math.sin(a_)))
                    for a_ in (math.radians(d) for d in range(0, 361, 30))]
            L.tube(wire, ring, [0.014] * len(ring), sides=6)
            L.tube(wire, [q - across * 0.07, q - across * 0.14 + Vector((0, 0, 0.04))], [0.016, 0.016], sides=6)
        # the hook: up off the roof's upper slope near the corner, curling over outward
        hz = zr1 - 0.1
        h0 = across * (rhs(hz) - 0.02) + along * (rhs(hz) - 0.08) + Vector((0, 0, hz))
        out = (across + along * 0.4).normalized()
        hook = [h0 + out * (0.06 * (1 - math.cos(a_))) + Vector((0, 0, 0.1 * math.sin(a_) + 0.05 * a_))
                for a_ in (math.radians(d) for d in range(0, 271, 20))]
        L.tube(wire, hook, [0.016] * len(hook), sides=6)
    add_outline(W.obj("handles", wood, [M["wood"]], parent=body, sharp=50), LN["warm"])
    add_outline(W.obj("ferrules", fer, [M["ferrule"]], parent=body, sharp=35), LN["cool"],
                L.LINE * 0.6)
    add_outline(W.obj("wires", wire, [M["iron"]], parent=body, sharp=60), LN["cool"], L.LINE * 0.5)

    # ---- the grater: a box grater on the roof, a tapering tin box longer along y than x, open at the top; big round holes
    # in rows on its left face (+x), two curved slicing slots with raised blades on its right face (+y); riveted strips
    # down its corners, a band round its foot, a rim round the opening and a flat frame handle standing over it
    zg0, zg1 = zr1 + 0.04, zr1 + 0.66
    ax0, ay0, ax1, ay1 = 0.36, 0.38, 0.17, 0.25          # half sides along x and y, foot and top
    gh = zg1 - zg0
    bm = bmesh.new()
    L.rbox(bm, (2 * ax0, 2 * ay0, gh), Matrix.Translation((0, 0, zg0)), bevel=0.02, segs=2, taper=ax1 / ax0,
           taper_y=ay1 / ay0)
    add_outline(W.obj("grater", S.fill(bm), [M["grater"]], parent=body, sharp=35), LN["cool"])

    def gface(axis, f, u=0.0, out=0.0):
        """A frame on the grater's +x (axis 0) or +y (axis 1) face at height fraction f: x along it, y out, z up it."""
        z = zg0 + gh * f
        if axis == 0:
            n = Vector((gh, 0, ax0 - ax1)).normalized()
            t, c = Vector((0, -1, 0)), Vector((ax0 + (ax1 - ax0) * f, 0, z))
        else:
            n = Vector((0, gh, ay0 - ay1)).normalized()
            t, c = Vector((1, 0, 0)), Vector((0, ay0 + (ay1 - ay0) * f, z))
        up = t.cross(n)
        return Matrix.Translation(c + t * u + n * out) @ Matrix((t, n, up)).transposed().to_4x4()

    holes, burrs = bmesh.new(), bmesh.new()
    for i in range(5):
        f = 0.16 + 0.7 * i / 4
        half = ay0 + (ay1 - ay0) * f - 0.075
        cols = 5 if i % 2 == 0 else 4
        for j in range(cols):
            u = -half + 2 * half * (j + (0.0 if cols == 5 else 0.5)) / 4
            Q.cyl(holes, 0.028, 0.01, gface(0, f, u=u) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=14)
            Q.cyl(burrs, 0.04, 0.008, gface(0, f - 0.012, u=u, out=-0.002) @ Matrix.Rotation(-math.pi / 2, 4, 'X'), segs=14)
    W.obj("graterholes", holes, [M["hole"]], parent=body)
    W.obj("graterburrs", burrs, [M["grater"]], parent=body, sharp=35)
    slit, blade = bmesh.new(), bmesh.new()
    for f in (0.36, 0.66):
        half = ax0 + (ax1 - ax0) * f - 0.08
        arc = [gface(1, f, out=0.004) @ Vector((half * math.sin(a_), 0.0, 0.03 * math.cos(a_) - 0.015))
               for a_ in (math.radians(v) for v in range(-80, 81, 16))]
        L.tube(slit, arc, [0.026] * len(arc), sides=8, flat=0.6)
        rot = gface(1, f).to_3x3()
        L.tube(blade, [q + rot @ Vector((0, 0.022, 0.03)) for q in arc], [0.016] * len(arc), sides=8, flat=0.6)
    W.obj("slits", slit, [M["hole"]], parent=body)
    add_outline(W.obj("slitblades", blade, [M["grater"]], parent=body, sharp=60), LN["cool"], L.LINE * 0.5)
    # the corners: a riveted strip down each, a band round the foot, rivets along it
    trims, riv = bmesh.new(), bmesh.new()
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        c0, c1 = Vector((sx * ax0, sy * ay0, zg0 + 0.04)), Vector((sx * ax1, sy * ay1, zg1 - 0.02))
        L.tube(trims, [c0, c1], [0.03, 0.026], sides=8)
        if (sx, sy) != (-1, -1):
            W.rivets(riv, [c0 + (c1 - c0) * t + Vector((sx * 0.018, sy * 0.018, 0)) for t in (0.2, 0.5, 0.8)],
                     [(sx, sy, 0.3)] * 3, r=0.016)
    L.rbox(trims, (2 * ax0 + 0.05, 2 * ay0 + 0.05, 0.07), Matrix.Translation((0, 0, zg0 - 0.01)), bevel=0.015, segs=2)
    W.rivets(riv, [Vector((ax0 + 0.027, y, zg0 + 0.025)) for y in (-0.24, -0.08, 0.08, 0.24)] +
             [Vector((x, ay0 + 0.027, zg0 + 0.025)) for x in (-0.2, 0.0, 0.2)], [(1, 0, 0)] * 4 + [(0, 1, 0)] * 3, r=0.016)
    # the rim round the opening, the dark inside with two pairs of eyes in it, the frame handle over the opening
    for sx in (-1, 1):
        L.rbox(trims, (0.05, 2 * ay1 + 0.05, 0.06), Matrix.Translation((sx * ax1, 0, zg1 - 0.035)), bevel=0.012, segs=2)
    for sy in (-1, 1):
        L.rbox(trims, (2 * ax1 + 0.05, 0.05, 0.06), Matrix.Translation((0, sy * ay1, zg1 - 0.035)), bevel=0.012, segs=2)
    add_outline(W.obj("gratertrims", trims, [M["trim"] if TIER > 1 else M["tin"]], parent=body, sharp=35), LN["cool"],
                L.LINE * 0.6)
    W.obj("graterrivets", riv, [M["trim"] if TIER > 1 else M["tin"]], parent=body)
    bm = bmesh.new()
    L.rbox(bm, (2 * ax1 - 0.03, 2 * ay1 - 0.03, 0.01), Matrix.Translation((0, 0, zg1 - 0.03)), bevel=0.0, segs=1)
    W.obj("graterinside", bm, [M["hole"]], parent=body)
    bm = bmesh.new()
    for x, y in ((0.02, 0.1), (-0.06, -0.08)):
        for dy in (-0.022, 0.022):
            Q.ball(bm, (x, y + dy, zg1 - 0.012), 0.013, segs=10)
    L.obj_from_bm("eyes", bm, [M["eyes"]], parent=body, smooth=True)
    bm = bmesh.new()
    hx, hw, hz, bw = -ax1 * 0.3, ay1 + 0.01, 0.22, 0.055   # the handle: a flat frame standing over the opening, along y
    for sy in (-1, 1):
        L.rbox(bm, (0.045, bw, hz), Matrix.Translation((hx, sy * (hw - bw / 2), zg1 - 0.04)), bevel=0.012, segs=2)
    L.rbox(bm, (0.045, 2 * hw, bw), Matrix.Translation((hx, 0, zg1 - 0.04 + hz - bw)), bevel=0.014, segs=2)
    W.rivets(bm, [Vector((hx + 0.024, sy * (hw - bw / 2), zg1 - 0.04 + hz - bw / 2)) for sy in (-1, 1)] +
             [Vector((hx + 0.024, sy * (hw - bw / 2), zg1 + 0.02)) for sy in (-1, 1)], [(1, 0, 0)] * 4, r=0.014)
    add_outline(W.obj("graterhandle", bm, [M["grater"] if TIER < 3 else M["gold"]], parent=body, sharp=40), LN["cool"])
    return body


S.run("bunker", build, TIER, HERE, ARGS[1:], canvas=(720, 900, 360, 680))
