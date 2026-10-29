"""pebble3d.py : the Pebble Shiner (type 2) in 3D (buildings-3d-b6, 29 Oct 2026, for beta 6), after the Flash art in
server/public/assets/buildings/pebbleshiner.v2/ (looks at levels 1, 3, 6 and 10).

    blender -b --factory-startup -P pebble3d.py -- LEVEL still | anim [N] | save        (see bldg3d.run)

The Flash building: a round tumbler built of rings of pale stone blocks, bulging like a barrel, standing on block legs
with dark arches between; a cone roof of pale wooden shingles; a steel horn on a pipe behind on the left; pebbles
scattered round its foot.
  L1   small, three rings, the roof low
  L3   wider, four rings, a stone spout (the pebbles' way out) on the left
  L6   taller, five rings, more pebbles
  L10  + a spiked crusher drum on the roof's peak and a spiked iron ball on a post at the right
Producing: as Flash, only the middle ring(s) of blocks grind round (two the other way from each other); the L10 drum
and ball spin. The legs, the other rings and the roof stay still.
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
        stone=W.mat_granite("stone", light=(238, 238, 242), dark=(186, 186, 196), fleck_d=(96, 96, 104),
                            fleck_l=(250, 250, 252), edge=(250, 250, 252), dirt=0.3, soot=0.1),
        core=L.mat_flat("core", (34, 32, 36), spec=0.05),
        roof=B.mat_shingles("roof", rows=6.0, cols=11, light=(234, 196, 156), dark=(196, 150, 112), gap=(120, 86, 60),
                            edge=(250, 228, 200), dirt=0.1),
        pipe=L.mat_metal("pipe", "gunmetal", polish=0.3),
        hornm=L.mat_metal("hornm", "steel", polish=0, spec=1.0),
        iron=W.mat_iron("iron"),
        spike=L.mat_metal("spike", "steel", spec=1.0, polish=0.5),
        drum=W.mat_iron("drum", base=(92, 60, 44), dark=(44, 28, 22), rust_k=0.5),
        ball=W.mat_iron("ball", base=(58, 56, 60), dark=(22, 22, 26), rust_k=0.3, edge=(150, 150, 160)),
    )


def block_ring(bm, n, r, z, h, depth, seed, phase=0.0, legs=False, tilt=0.0):
    """n stone blocks round Z at radius r (their outer face), from z to z+h; legs: every other one only, taller."""
    rnd = random.Random(seed)
    for k in range(n):
        if legs and k % 2:
            continue
        a = 2 * math.pi * (k + phase) / n
        big = not legs and k % 2 == 0                 # every other block stands out, chunkier: the Flash checker
        w = 2 * math.pi * r / n * (0.84 + 0.06 * rnd.random()) * (1.08 if big else 1.0)
        hh = h * (0.9 + 0.1 * rnd.random()) * (1.06 if big else 1.0)
        d = depth * (0.9 + 0.2 * rnd.random())
        ro = r + (0.05 if big else 0.0)
        m = (Matrix.Translation((math.cos(a) * (ro - d / 2 + 0.008 * rnd.random()), math.sin(a) * (ro - d / 2),
                                 z - (hh - h) / 2))
             @ Matrix.Rotation(a + math.radians(90 + (rnd.random() - 0.5) * 6), 4, 'Z')
             @ Matrix.Rotation(math.radians(tilt + (rnd.random() - 0.5) * 4), 4, 'X'))
        L.rbox(bm, (w, d, hh), m, bevel=0.04, segs=2, taper=0.96)


def spikes(bm, centres, normals, r=0.03, length=0.1, mat=0):
    for c, n in zip(centres, normals):
        B.disc(bm, r, length, Matrix.Translation(Vector(c) + Vector(n).normalized() * length / 2) @ B.along(n), segs=8,
               mat=mat, r2=0.002)


def build(level):
    lk = look_of(level)
    L.clear_scene()
    M = materials()
    root = L.empty("ROOT")
    nr = {1: 3, 3: 4, 6: 5, 10: 5}[lk]               # rings, the legs' ring included
    R = {1: 0.45, 3: 0.56, 6: 0.58, 10: 0.6}[lk]       # the widest ring's radius
    nb = 8 if lk == 1 else 10                          # blocks per ring
    bh = 0.25 if lk == 1 else 0.26                     # a ring's height
    leg_h = 0.3 if lk == 1 else 0.32
    movers = []
    turning = {1: (1,), 3: (1,), 6: (1, 2), 10: (1, 2)}[lk]   # the rings Flash turns: the top of two, else the middle

    # ---- the core behind the blocks (dark: it shows between them), from the legs' top to the roof
    zs = [0.0, leg_h] + [leg_h + bh * (i + 1) for i in range(nr - 1)]
    ztop = zs[-1]

    def rad(z):                                        # the barrel: widest a little below the middle
        t = (z - leg_h) / max(ztop - leg_h, 1e-3)
        return R * (0.84 + 0.16 * math.sin(math.pi * min(1.0, max(0.0, t * 0.9 + 0.1))))
    core = W.lathe("core", [[(R * 0.7, leg_h - 0.02), (rad(leg_h) - 0.08, leg_h), (rad((leg_h + ztop) / 2) - 0.08,
                                                                                    (leg_h + ztop) / 2),
                             (rad(ztop) - 0.08, ztop), (0.0, ztop)]], [M["core"]], parent=root, n=48, bev=0)
    L.add_outline(core, L.line("warm"))
    bm = bmesh.new()
    B.disc(bm, R * 0.72, 0.04, Matrix.Translation((0, 0, leg_h - 0.02)), segs=40)
    B.part("floor", bm, M["core"], root, line=None)

    # ---- the legs (still), then each ring of blocks on its own pivot
    bm = bmesh.new()
    block_ring(bm, nb, rad(leg_h) - 0.02, 0.0, leg_h + 0.01, 0.2, seed=1, legs=True)
    B.part("legs", bm, M["stone"], root)
    for i in range(nr - 1):
        z0 = zs[i + 1]
        piv = B.mover(f"ring{i}_pivot", root, (0, 0, 0))
        bm = bmesh.new()
        rz = rad(z0 + bh / 2)
        tilt = math.degrees(math.atan2(rad(z0 + bh) - rad(z0), bh)) * -1
        block_ring(bm, nb, rz, z0 + 0.005, bh - 0.012, 0.17, seed=10 + i, phase=0.5 * (i % 2), tilt=tilt)
        B.part(f"ring{i}", bm, M["stone"], piv)
        if i in turning:                               # only Flash's turning rings (the middle ones) go round
            movers.append((piv, (1 if i % 2 == 0 else -1) * 2 / nb))   # two blocks a loop

    # ---- the roof: a cone of pale wooden shingles, its eave a little ragged
    re = rad(ztop) + 0.12
    rh = 0.54 if lk == 1 else 0.6
    roof = W.lathe("roof", [[(re, ztop - 0.04), (re + 0.01, ztop + 0.0), (re * 0.74, ztop + rh * 0.17),
                             (re * 0.46, ztop + rh * 0.42), (re * 0.2, ztop + rh * 0.74), (0.05, ztop + rh), (0.0, ztop + rh + 0.01)],
                            [(re, ztop - 0.04), (rad(ztop) - 0.05, ztop - 0.02)]],
                   [M["roof"]], parent=root, n=64, wob=0.02, wob_scale=3.0, seed=lk)
    L.add_outline(roof, L.line("warm"))

    # ---- the horn on its pipe, behind on the left
    hb = 150
    p0 = L.bear(hb, rad(ztop - 0.2) - 0.05, ztop - 0.25)
    p1 = L.bear(hb, re + 0.02, ztop + 0.05)
    p2 = L.bear(hb, re + 0.02, ztop + 0.45)
    bm = bmesh.new()
    L.tube(bm, L.bezier(p0, p0 + (p1 - p0) * 0.7, p1 - Vector((0, 0, 0.1)), p2, 14), [0.05] * 14, sides=12)
    B.disc(bm, 0.066, 0.06, Matrix.Translation(p1 + Vector((0, 0, 0.12))), segs=16)
    B.part("horn_pipe", bm, M["pipe"], root, line="cool")
    bell = W.lathe("horn", [[(0.05, 0.0), (0.06, 0.07), (0.09, 0.14), (0.17, 0.2), (0.18, 0.22)],
                            [(0.18, 0.22), (0.15, 0.215), (0.08, 0.17), (0.0, 0.11)]],
                   [M["hornm"], M["iron"]], mat_of_seg=[0, 1], parent=root, n=40)
    bell.matrix_basis = Matrix.Translation(p2 - Vector((0, 0, 0.02))) @ B.along(L.bear(hb, 0.8) + Vector((0, 0, 0.7)))
    L.add_outline(bell, L.line("cool"))

    # ---- the spout (L3 up): a stone collar out of the left side, dark inside
    if lk >= 3:
        sb, sz = 112, ztop - bh * 0.9
        out = L.bear(sb)
        c = L.bear(sb, rad(sz) + 0.02, sz)
        sp = W.lathe("spout", [[(0.13, -0.12), (0.15, 0.0), (0.16, 0.1), (0.15, 0.13), (0.1, 0.135), (0.085, 0.1),
                                (0.08, 0.0)]], [M["stone"]], parent=root, n=32)
        sp.matrix_basis = Matrix.Translation(c) @ B.along(out + Vector((0, 0, 0.12)))
        L.add_outline(sp, L.line("warm"))
        bm = bmesh.new()
        B.disc(bm, 0.085, 0.02, Matrix.Translation(c + out * 0.06) @ B.along(out), segs=24)
        B.part("spout_hole", bm, M["core"], root, line=None)

    # ---- the pebbles round the foot
    rnd = random.Random(lk)
    spots = [(118, 1.02, 0.09), (32, 1.0, 0.1), (300, 0.98, 0.08), (70, 1.12, 0.07)]
    if lk >= 6:
        spots += [(10, 1.2, 0.04), (25, 1.28, 0.03), (130, 1.24, 0.035), (345, 1.15, 0.03)]
    bm = bmesh.new()
    for b, d, r in spots:
        s = bmesh.new()
        bmesh.ops.create_icosphere(s, subdivisions=2, radius=1.0)
        for v in s.verts:
            v.co.z *= 0.55
            v.co *= 1.0 + 0.12 * math.sin(v.co.x * 5 + b)
        L.add_mesh(bm, s, Matrix.Translation(L.bear(b, d * R / 0.62 * 0.95, r * 0.4))
                   @ Matrix.Rotation(rnd.random() * 3, 4, 'Z') @ Matrix.Diagonal((r * 1.5, r, r, 1)))
    B.part("pebbles", bm, M["stone"], root, k=0.5)

    # ---- L10: the spiked drum on the peak, the spiked ball on its post at the right
    if lk == 10:
        top = ztop + rh
        piv = B.mover("drum_pivot", root, (0, 0, top - 0.06))
        dr = W.lathe("drum", [[(0.15, 0.0), (0.18, 0.03), (0.18, 0.27), (0.15, 0.3), (0.0, 0.3)]], [M["drum"]],
                     parent=piv, n=32)
        L.add_outline(dr, L.line("warm"))
        bm = bmesh.new()
        cs, ns = [], []
        for row, z in enumerate((0.07, 0.15, 0.23)):
            c, n = L.ring_of(8, 0.18, z, 0.5 * row)
            cs += c
            ns += n
        spikes(bm, cs, ns, r=0.03, length=0.1)
        spikes(bm, [Vector((0, 0, 0.3))], [Vector((0, 0, 1))], r=0.035, length=0.12)
        B.part("drum_spikes", bm, M["spike"], piv, line="cool", k=0.6)
        movers.append((piv, 2 / 8))
        pb = 300
        post0 = L.bear(pb, rad(ztop) - 0.1, ztop - 0.3)
        bc = L.bear(pb, re + 0.05, ztop + 0.38)
        bm = bmesh.new()
        L.tube(bm, [post0, post0 + Vector((0, 0, 0.2)), bc - Vector((0, 0, 0.12))], [0.035] * 3, sides=10)
        B.part("ball_post", bm, M["iron"], root, line="cool")
        piv = B.mover("ball_pivot", root, bc, axis=(0.3, 0.2, 1))
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.15)
        B.part("ball", bm, M["ball"], piv, line="cool")
        bm = bmesh.new()
        ico = bmesh.new()
        bmesh.ops.create_icosphere(ico, subdivisions=1, radius=1.0)
        dirs = [v.co.copy() for v in ico.verts]
        ico.free()
        spikes(bm, [d * 0.14 for d in dirs], dirs, r=0.026, length=0.09)
        B.part("ball_spikes", bm, M["spike"], piv, line="cool", k=0.6)
        movers.append((piv, -1.0))

    def animate(phase):
        # turns per loop: the rings two blocks (seamless: a ring repeats every block), each the other way from the one
        # under it; the drum two spikes; the ball a whole turn
        for piv, turns in movers:
            B.spin(piv, 'Z', turns * phase)
    return root, animate


if __name__ == "__main__":
    B.run("pebble", build, HERE)
