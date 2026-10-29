"""worn3d.py : the worn, hand-made look of the 3D defence buildings (buildings-3d-3, 29 Oct 2026), on top of look3d.py.

Owner, 29 Oct, on the first Inferno, Spurtz and Railgun models: "Too unrefined and lacks detail compared to the original."
The Flash art is worn, dirty, rusty and scratched: wood grain and planks, hammered metal with dents, bolts, rivets, straps,
rope and nails, soot, uneven hand-made shapes, colour changing within each part, dark grime in the crevices. This adds that
to the painted look (same Paint light ramps, flat colour and outlines, so the camera, light and pieces stay as they were).

Meshes:
  crisp(profile)      a lathe profile's corners get a small bevel (a flat that catches the light) and a support point each
                      side, so the edge wear and crevice grime below stay thin lines
  finish(ob)          after building: stores each vertex's convexity as the colour attribute `wear` (R = ridge, G = crevice),
                      which every material here reads to wear ridges pale and fill crevices with grime
  wobble(ob)          a lathe part made a little uneven (its radius waves with a noise), as a hand-made thing is
  lathe(...)          L.lathe with crisp profiles, wobble and finish
Details: bolts, rivets (L.studs, bolder), rope_ring, strap, stake (a faceted wooden stake with a grain UV), clods.
Materials: mat_planks (staves round Z), mat_raw_wood, mat_worn_diag (the Inferno's painted stripes), mat_iron (rusty,
hammered), mat_rope, mat_dirt. `weather(p, col, ...)` is the shared wear on any colour.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import look3d as L
from look3d import srgb

WHITE, BLACK = (1, 1, 1, 1), (0, 0, 0, 1)
GRIME = (46, 30, 20)          # what collects in crevices and at the foot
DIRT = (92, 62, 40)           # the ground's dust on the lower parts
SOOT = (24, 18, 16)


# ---------------------------------------------------------------------------------------------------------------- meshes
def crisp(prof, b=0.022, ang=28):
    """A lathe profile with each corner (turning more than ang degrees) cut by a bevel of size b, plus a support point
    3b along each side where that side is long enough."""
    out = [prof[0]]
    for i in range(1, len(prof) - 1):
        a, p, c = Vector(prof[i - 1]), Vector(prof[i]), Vector(prof[i + 1])
        d0, d1 = p - a, c - p
        if d0.length < 1e-6 or d1.length < 1e-6 or math.degrees(d0.angle(d1)) < ang:
            out.append(prof[i])
            continue
        bb = min(b, d0.length / 3.5, d1.length / 3.5)
        u0, u1 = d0.normalized(), d1.normalized()
        if d0.length > 7 * bb:
            out.append(tuple(p - u0 * 3 * bb))
        out += [tuple(p - u0 * bb), tuple(p + u1 * bb)]
        if d1.length > 7 * bb:
            out.append(tuple(p + u1 * 3 * bb))
    out.append(prof[-1])
    return out


def finish(ob, k=1 / 40, passes=1):
    """Store each vertex's sharpest bend: over its edges, -2 n . (neighbour - v) / |neighbour - v|^2 is 1 / the bend's
    radius in model units (a ball of radius 0.3 reads 3.3, a bevel of 0.02 about 25-50); its largest value times k is R
    (bending out: a ridge or edge), its most negative times -k is G (bending in: a crevice)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    vals = []
    for v in bm.verts:
        ds = [2 * v.normal.dot(e.other_vert(v).co - v.co) / (e.other_vert(v).co - v.co).length_squared
              for e in v.link_edges if (e.other_vert(v).co - v.co).length > 1e-7]
        vals.append((max(0.0, -min(ds)), max(0.0, max(ds))) if ds else (0.0, 0.0))
    for _ in range(passes):       # a light blur, so a ridge reads as a line two vertices wide
        nv = []
        for v in bm.verts:
            nb = [vals[e.other_vert(v).index] for e in v.link_edges] or [vals[v.index]]
            nv.append(tuple(0.6 * vals[v.index][i] + 0.4 * sum(x[i] for x in nb) / len(nb) for i in (0, 1)))
        vals = nv
    bm.free()
    at = me.color_attributes.get("wear") or me.color_attributes.new("wear", 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(vals):
        at.data[i].color = (min(1.0, c[0] * k), min(1.0, c[1] * k), 0.0, 1.0)
    return ob


def wobble(ob, amp=0.012, scale=2.2, seed=0.0, radial=True, zamp=0.0):
    """Push each vertex out (radially about Z, or along its normal) by a smooth noise: uneven, hand-made outlines."""
    off = Vector((seed * 7.31, seed * 3.17, seed * 1.93))
    for v in ob.data.vertices:
        co = v.co.copy()
        d = noise.noise(co * scale + off)
        if radial:
            n = Vector((co.x, co.y, 0.0))
            n = n.normalized() if n.length > 1e-5 else Vector()
        else:
            n = v.normal.copy()
        new = co + n * d * amp + Vector((0, 0, noise.noise(co * scale * 1.7 + off + Vector((5, 5, 5))) * zamp))
        if co.z >= 0.0 > new.z:      # nothing sinks below the ground
            new.z = 0.0
        v.co = new
    ob.data.update()
    return ob


def lathe(name, segs, mats, bev=0.022, wob=0.0, wob_scale=2.2, seed=0.0, n=96, **kw):
    """L.lathe with crisp corners, an optional wobble, and the wear attribute."""
    ob = L.lathe(name, [crisp(s, bev) if bev else s for s in segs], mats, n=n, **kw)
    if wob:
        wobble(ob, wob, wob_scale, seed)
    return finish(ob)


def obj(name, bm, mats, parent=None, sharp=40, smooth=True):
    """L.obj_from_bm plus the wear attribute."""
    return finish(L.obj_from_bm(name, bm, mats, parent=parent, sharp=sharp, smooth=smooth))


def bolts(bm, centres, normals, r=0.045, mat=0, washer=True):
    """Hex bolt heads (with a washer under each) at centres, facing normals: bold enough to read at game size."""
    for c, n in zip(centres, normals):
        q = Vector((0, 0, 1)).rotation_difference(Vector(n).normalized()).to_matrix().to_4x4()
        base = Matrix.Translation(Vector(c)) @ q
        if washer:
            s = bmesh.new()
            bmesh.ops.create_cone(s, cap_ends=True, segments=12, radius1=r * 1.45, radius2=r * 1.35, depth=r * 0.3)
            L.add_mesh(bm, s, base @ Matrix.Translation((0, 0, r * 0.15)), mat)
        s = bmesh.new()
        bmesh.ops.create_cone(s, cap_ends=True, segments=6, radius1=r, radius2=r * 0.92, depth=r * 0.6)
        L.add_mesh(bm, s, base @ Matrix.Translation((0, 0, r * (0.6 if washer else 0.3))), mat)


def rivets(bm, centres, normals, r=0.04, mat=0):
    L.studs(bm, centres, normals, r=r, mat=mat)


def ring_pts(n, r, z, phase=0.0):
    return L.ring_of(n, r, z, phase)


def rope_ring(bm, R, z, r=0.045, strands=3, pitch=0.11, sides=6, mat=0):
    """A rope laid round a ring of radius R at height z: strands twisted round each other (a whole number of turns)."""
    turns = max(3, round(2 * math.pi * R / pitch))
    N = turns * 10
    for s in range(strands):
        pts = []
        for i in range(N + 1):
            t = i / N
            a = 2 * math.pi * t
            ph = 2 * math.pi * (turns * t + s / strands)
            rad = Vector((math.cos(a), math.sin(a), 0.0))
            pts.append(Vector((R * rad.x, R * rad.y, z)) + (rad * math.cos(ph) + Vector((0, 0, 1)) * math.sin(ph)) * r * 0.5)
        L.tube(bm, pts, [r * 0.56] * len(pts), sides=sides, cap=False, mat=mat)


def stake(bm, uv, base, tip, r, sides=7, twist=0.0, mat=0, bulge=0.15, tip_mat=None):
    """A rough wooden stake from base to tip: a faceted, slightly bulging cone, with a UV whose v runs along it (grain)."""
    d = tip - base
    q = Vector((0, 0, 1)).rotation_difference(d)
    m = Matrix.Translation(base) @ q.to_matrix().to_4x4() @ Matrix.Rotation(twist, 4, 'Z')
    rows = [(0.0, 1.0), (0.25, 0.8 + bulge), (0.55, 0.52), (0.8, 0.24), (1.0, 0.03)]
    rings = []
    for f, k in rows:
        rings.append([bm.verts.new(m @ Vector((r * k * math.cos(2 * math.pi * j / sides) * (1.0 + 0.12 * ((j * 7) % 3 - 1)),
                                               r * k * math.sin(2 * math.pi * j / sides), d.length * f)))
                      for j in range(sides)])
    for i in range(len(rings) - 1):
        for j in range(sides):
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % sides], rings[i + 1][(j + 1) % sides], rings[i + 1][j]))
            f.material_index = tip_mat if (tip_mat is not None and i >= len(rings) - 3) else mat
            for lp, (jj, ii) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                lp[uv].uv = (jj / sides, rows[ii][0] * d.length)
    f = bm.faces.new(list(reversed(rings[0])))
    f.material_index = mat


def clods(bm, centres, r=0.06, seed=0.0, mat=0):
    """Lumps of earth and burnt rubble: squashed, noisy little balls."""
    for i, c in enumerate(centres):
        s = bmesh.new()
        bmesh.ops.create_icosphere(s, subdivisions=2, radius=1.0)
        k = r * (0.7 + 0.6 * ((i * 0.618 + seed) % 1.0))
        for v in s.verts:
            v.co *= 1.0 + 0.35 * noise.noise(v.co * 1.6 + Vector((i * 3.1 + seed, i * 1.7, 0)))
            v.co.z *= 0.6
        L.add_mesh(bm, s, Matrix.Translation(Vector(c)) @ Matrix.Diagonal((k, k, k, 1)), mat)


# ------------------------------------------------------------------------------------------------------------- materials
def _attr(p):
    a = p.N.new("ShaderNodeAttribute")
    a.attribute_type = 'GEOMETRY'
    a.attribute_name = "wear"
    sep = p.N.new("ShaderNodeSeparateColor")
    p.link(a.outputs["Color"], sep.inputs[0])
    return sep.outputs[0], sep.outputs[1]


def _grey(v):
    return (v, v, v, 1)


def weather(p, col, edge=None, edge_k=0.9, cavity=0.6, dirt=0.55, streaks=0.22, soot=0.0, vary=0.18, scale=1.0,
            dirt_top=0.5, grime=GRIME, dirt_col=DIRT):
    """Wear on a colour socket: big soft patches (colour changing within a part), pale worn ridges (edge: the colour that
    shows through), grime in crevices and close corners, dust toward the ground, rain streaks down, soot blotches."""
    convex, concave = _attr(p)
    var = p.ramp(p.noise(1.6 * scale, 3.0, 0.5), [(0.28, _grey(1 - vary)), (0.5, WHITE), (0.72, (1 + vary * 0.6, 1 + vary * 0.4,
                                                                                                    1 + vary * 0.1, 1))])
    col = p.mix(col, var, 1.0, 'MULTIPLY')
    hue = p.ramp(p.noise(2.3 * scale, 2.0, 0.5, coord="Generated"), [(0.35, (1.0, 0.92, 0.84, 1)), (0.65, (0.92, 0.96, 1.0, 1))])
    col = p.mix(col, hue, 0.5, 'MULTIPLY')
    if edge is not None:
        brk = p.noise(7.0 * scale, 5.0, 0.6)
        e = p.math("MULTIPLY", convex, p.math("MULTIPLY_ADD", brk, 1.6, 0.0))
        col = p.mix(col, srgb(*edge), p.ramp(e, [(0.3, BLACK), (0.55, _grey(edge_k))]))
    cg = p.ramp(concave, [(0.25, WHITE), (0.5, _grey(1 - cavity))])
    col = p.mix(col, cg, 1.0, 'MULTIPLY')
    ao = p.N.new("ShaderNodeAmbientOcclusion")
    ao.samples = 16
    ao.inputs["Distance"].default_value = 0.12
    gr = p.mix(srgb(*grime), WHITE, p.ramp(ao.outputs["AO"], [(0.25, BLACK), (0.95, WHITE)]))
    col = p.mix(col, gr, cavity, 'MULTIPLY')
    if dirt:
        geo = p.N.new("ShaderNodeNewGeometry")
        gz = p.N.new("ShaderNodeSeparateXYZ")
        p.link(geo.outputs["Position"], gz.inputs[0])
        low = p.ramp(gz.outputs[2], [(0.0, _grey(1.0)), (dirt_top, BLACK)])
        brk = p.ramp(p.noise(3.5 * scale, 6.0, 0.65), [(0.3, BLACK), (0.62, WHITE)])
        dm = p.math("MULTIPLY", p.math("MULTIPLY", _bw(p, low), _bw(p, brk)), dirt)
        col = p.mix(col, srgb(*dirt_col), dm)
    if streaks:
        st = p.ramp(p.noise(4.0 * scale, 4.0, 0.6, stretch=(1.0, 1.0, 0.1)), [(0.42, WHITE), (0.72, _grey(1 - streaks))])
        col = p.mix(col, st, 1.0, 'MULTIPLY')
    if soot:
        sm = p.ramp(p.noise(2.2 * scale, 5.0, 0.62), [(0.48, BLACK), (0.7, _grey(soot))])
        col = p.mix(col, srgb(*SOOT), sm)
    return col


def _bw(p, col):
    n = p.node("ShaderNodeRGBToBW")
    p.link(col, n.inputs[0])
    return n.outputs[0]


def _voronoi(p, scale, feature='SMOOTH_F1', coord="Object", out="Distance"):
    v = p.N.new("ShaderNodeTexVoronoi")
    v.feature = feature
    v.inputs["Scale"].default_value = scale
    p.link(p.tc.outputs[coord], v.inputs["Vector"])
    return v.outputs[out]


def _white(p, val):
    w = p.N.new("ShaderNodeTexWhiteNoise")
    w.noise_dimensions = '1D'
    p.link(val, w.inputs["W"])
    return w.outputs["Value"]


def _stave(p, n, wob=0.08):
    """The stave coordinate round Z: (its index socket, the position across it 0-1)."""
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    u = p.math("MULTIPLY", ang, n / (2 * math.pi))
    u = p.math("ADD", u, p.math("MULTIPLY", p.math("SUBTRACT", p.noise(1.5, 2.0), 0.5), wob))
    return p.math("FLOOR", u), p.math("FRACT", u), sep


def mat_planks(name, n=14, light=(176, 116, 70), dark=(120, 74, 42), gap=(44, 26, 14), edge=(214, 170, 120), gapw=0.07,
               cavity=0.6, dirt=0.55, soot=0.0, scale=1.0):
    """Wooden staves standing round the Z axis (a tub or barrel): each its own shade, long grain, dark gaps between."""
    p = L.Paint(name)
    idx, f, sep = _stave(p, n)
    rnd = _white(p, idx)
    base = p.ramp(rnd, [(0.0, srgb(*dark)), (1.0, srgb(*light))])
    grain = p.noise(9.0 * scale, 6.0, 0.7, stretch=(1.0, 1.0, 0.07))
    gr = p.ramp(grain, [(0.38, _grey(0.78)), (0.52, WHITE), (0.62, _grey(1.08)), (0.7, _grey(0.86))])
    col = p.mix(base, gr, 1.0, 'MULTIPLY')
    d = p.math("MINIMUM", f, p.math("SUBTRACT", 1.0, f))         # distance to the stave's side, 0-0.5
    g = p.ramp(d, [(gapw * 0.5, WHITE), (gapw, BLACK)])
    col = p.mix(col, srgb(*gap), g)
    col = weather(p, col, edge=edge, edge_k=0.75, cavity=cavity, dirt=dirt, soot=soot, scale=scale)
    h = p.math("ADD", p.math("MULTIPLY", _bw(p, g), -1.0), p.math("MULTIPLY", grain, 0.35))
    return p.finish(col, spec=0.12, spec_rough=0.5, bump=(h, 0.5), shade=L.WARM_SHADE)


def mat_raw_wood(name, light=(210, 146, 90), dark=(140, 84, 46), crack=(56, 30, 16), coord="UV", stretch=(6.0, 0.25, 1.0),
                 edge=(232, 186, 130), dirt=0.5, soot=0.0):
    """Rough split wood (stakes, beams): long grain along the UV's v (coord="UV") or along Z, dark splits."""
    p = L.Paint(name)
    grain = p.noise(5.0, 7.0, 0.68, coord=coord, stretch=stretch)
    col = p.ramp(grain, [(0.3, srgb(*dark)), (0.5, srgb(*light)), (0.62, srgb(*[min(255, c + 18) for c in light])),
                         (0.72, srgb(*dark))])
    sp = p.noise(9.0, 3.0, 0.5, coord=coord, stretch=(stretch[0] * 1.3, stretch[1] * 0.6, stretch[2]))
    split = p.ramp(sp, [(0.47, BLACK), (0.5, WHITE), (0.53, BLACK)])
    col = p.mix(col, srgb(*crack), p.math("MULTIPLY", _bw(p, split), 0.85))
    col = weather(p, col, edge=edge, edge_k=0.7, cavity=0.55, dirt=dirt, soot=soot)
    h = p.math("ADD", p.math("MULTIPLY", _bw(p, split), -1.0), p.math("MULTIPLY", grain, 0.5))
    return p.finish(col, spec=0.1, spec_rough=0.5, bump=(h, 0.45), shade=L.WARM_SHADE)


def mat_worn_diag(name, a, b, n=6, lean=1.6, under=(104, 66, 40), edge=(232, 210, 172), soot=0.5, dirt=0.75, dirt_top=0.55,
                  trim=None, trim_w=0.045, chips=0.6, streaks=0.3):
    """Diagonal painted stripes wound round Z (the Inferno's red and cream), badly worn: chipped to the wood beneath,
    paler where the folds stand out, scorched and dusty toward the ground. trim: a colour painted along each stripe's
    edge (the upper tiers' gold), trim_w wide (in stripe pairs); chips: the chip threshold (higher, fewer chips)."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    u = p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), p.math("MULTIPLY", sep.outputs[2], lean))
    u = p.math("ADD", u, p.math("MULTIPLY", p.math("SUBTRACT", p.noise(3.0, 3.0), 0.5), 0.12))   # hand-painted edges
    bnd = p.math("GREATER_THAN", p.math("FRACT", u), 0.5)
    paint = p.mix(srgb(*a), srgb(*b), bnd)
    if trim:
        f = p.math("FRACT", p.math("MULTIPLY", u, 2.0))                # 0 at every stripe edge
        d = p.math("MINIMUM", f, p.math("SUBTRACT", 1.0, f))
        tm = p.ramp(d, [(trim_w, WHITE), (trim_w * 1.3, BLACK)])
        gl = p.ramp(d, [(0.0, srgb(*[min(255, c + 30) for c in trim])), (trim_w, srgb(*[int(c * 0.7) for c in trim]))])
        paint = p.mix(paint, gl, tm)
    chip = p.ramp(p.noise(6.0, 9.0, 0.66), [(chips, BLACK), (chips + 0.025, WHITE)])
    paint = p.mix(paint, srgb(*under), chip)
    scr = p.ramp(p.noise(14.0, 4.0, 0.5, stretch=(1.0, 1.0, 0.15)), [(chips + 0.06, BLACK), (chips + 0.1, _grey(0.5))])
    paint = p.mix(paint, srgb(*under), scr)
    col = weather(p, paint, edge=edge, edge_k=0.6, cavity=0.7, dirt=dirt, dirt_top=dirt_top, soot=soot, streaks=streaks)
    return p.finish(col, spec=0.18, spec_rough=0.45, bump=(p.math("MULTIPLY", _bw(p, chip), -1.0), 0.35),
                    shade=L.WARM_SHADE)


def mat_iron(name, base=(86, 70, 60), dark=(42, 33, 29), rust=(160, 82, 34), edge=(184, 164, 144), rust_k=0.8,
             soot=0.0, dents=1.0, dirt=0.3, spec=0.12, spec_col=(1.0, 0.86, 0.7, 1), edge_k=0.8, seams=0):
    """Old iron: dark brown-grey, hammered (soft dents), rust patches (more in crevices), bright worn edges. seams: that
    many plates round Z, each its own shade, dark joins between (plating on a drum)."""
    p = L.Paint(name)
    col = p.ramp(p.noise(2.5, 4.0, 0.6), [(0.3, srgb(*dark)), (0.7, srgb(*base))])
    if seams:
        idx, f, _ = _stave(p, seams, wob=0.0)
        col = p.mix(col, p.ramp(_white(p, idx), [(0.0, _grey(0.8)), (1.0, _grey(1.12))]), 1.0, 'MULTIPLY')
        d = p.math("MINIMUM", f, p.math("SUBTRACT", 1.0, f))
        col = p.mix(col, srgb(*[int(c * 0.35) for c in dark]), p.ramp(d, [(0.02, WHITE), (0.045, BLACK)]))
    convex, concave = _attr(p)
    rn = p.math("ADD", p.noise(4.0, 8.0, 0.66), p.math("MULTIPLY", concave, 0.3))
    rm = p.ramp(rn, [(0.54, BLACK), (0.6, _grey(rust_k))])
    rcol = p.ramp(p.noise(11.0, 4.0), [(0.35, srgb(*[int(c * 0.6) for c in rust])), (0.65, srgb(*rust))])
    col = p.mix(col, rcol, rm)
    pit = p.ramp(p.noise(18.0, 3.0), [(0.66, BLACK), (0.7, WHITE)])
    col = p.mix(col, srgb(*[int(c * 0.45) for c in dark]), p.math("MULTIPLY", _bw(p, pit), 0.7))
    dent = _voronoi(p, 9.0)
    col = p.mix(col, p.ramp(dent, [(0.05, _grey(0.8)), (0.4, _grey(1.08))]), 1.0, 'MULTIPLY')   # hammered: each dent its shade
    col = weather(p, col, edge=edge, edge_k=edge_k, cavity=0.6, dirt=dirt, soot=soot, streaks=0.18)
    h = p.math("MULTIPLY", p.math("ADD", p.math("MULTIPLY", dent, dents), p.math("MULTIPLY", _bw(p, pit), -0.15)), 2.5)
    shade = [(0.0, (0.34, 0.30, 0.32, 1)), (0.18, (0.46, 0.42, 0.42, 1)), (0.5, (0.82, 0.78, 0.74, 1)), (1.0, (1.0, 0.97, 0.9, 1))]
    return p.finish(col, spec=spec, spec_rough=0.45, spec_col=spec_col, metal=True, bump=(h, 0.8), shade=shade,
                    edge_dark=0.45, sheen=0.06)


def mat_rope(name, light=(204, 166, 108), dark=(132, 98, 56)):
    p = L.Paint(name)
    fib = p.noise(30.0, 4.0, 0.6)
    col = p.ramp(fib, [(0.35, srgb(*dark)), (0.65, srgb(*light))])
    col = weather(p, col, edge=None, cavity=0.75, dirt=0.4, streaks=0.0)
    return p.finish(col, spec=0.08, spec_rough=0.6, bump=(fib, 0.3), shade=L.WARM_SHADE, ao_k=0.6)


def mat_dirt(name, a=(70, 42, 28), b=(118, 72, 44), burnt=(30, 20, 16)):
    """Scorched earth and rubble round a foot: brown, reddish clumps, black burnt patches."""
    p = L.Paint(name)
    col = p.ramp(p.noise(6.0, 6.0, 0.65), [(0.3, srgb(*a)), (0.7, srgb(*b))])
    col = p.mix(col, srgb(*burnt), p.ramp(p.noise(2.5, 4.0), [(0.5, BLACK), (0.62, _grey(0.85))]))
    col = p.mix(col, srgb(150, 60, 34), p.ramp(p.noise(12.0, 3.0), [(0.66, BLACK), (0.72, _grey(0.6))]))
    col = weather(p, col, edge=(150, 110, 80), edge_k=0.5, cavity=0.6, dirt=0.0, streaks=0.0)
    return p.finish(col, spec=0.05, spec_rough=0.6, bump=(p.noise(14.0, 5.0), 0.6), shade=L.WARM_SHADE, ao_k=0.6)


def mat_lava(name, hot=(255, 236, 150), mid=(255, 128, 20), deep=(178, 34, 0), crust=(60, 24, 12), strength=1.0):
    """Glowing molten glass behind a window (the Magma's lava): mottled, hot where it faces the viewer, dark crusts."""
    p = L.Paint(name)
    lw = p.N.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    n = p.noise(7.0, 6.0, 0.62)
    v = p.math("ADD", p.math("MULTIPLY", n, 0.8), p.math("MULTIPLY", lw.outputs["Facing"], -0.5))
    col = p.ramp(v, [(0.05, srgb(*deep)), (0.3, srgb(*mid)), (0.5, srgb(*hot))])
    col = p.mix(col, srgb(*crust), p.ramp(p.noise(12.0, 4.0), [(0.64, BLACK), (0.7, _grey(0.8))]))
    em = p.N.new("ShaderNodeEmission")
    p.link(col, em.inputs["Color"])
    em.inputs["Strength"].default_value = strength
    out = p.N.new("ShaderNodeOutputMaterial")
    p.link(em.outputs[0], out.inputs[0])
    return p.m


def mat_worn_panels(name, n=8, ratio=0.32, cream=(226, 206, 168), red=(116, 20, 22), scrawl=(92, 70, 56), edge=(240, 226, 196)):
    """Upright panels round Z (the Sharpshooter's drum): cream parchment with dark scrawl, between mottled dark red ones;
    stained, torn at the edges, dusty toward the ground."""
    p = L.Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    u = p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), p.math("MULTIPLY", p.math("SUBTRACT", p.noise(6.0, 4.0), 0.5), 0.05))
    panel = p.math("GREATER_THAN", p.math("FRACT", u), ratio)
    sc = p.ramp(p.noise(16.0, 7.0, 0.72, stretch=(1.0, 1.0, 2.6)), [(0.6, WHITE), (0.66, srgb(*scrawl))])
    cr = p.mix(srgb(*cream), sc, 1.0, 'MULTIPLY')
    stain = p.ramp(p.noise(3.0, 5.0, 0.6), [(0.4, WHITE), (0.7, (0.8, 0.66, 0.52, 1))])
    cr = p.mix(cr, stain, 1.0, 'MULTIPLY')
    rd = p.mix(srgb(*red), p.ramp(p.noise(8.0, 6.0, 0.65), [(0.3, _grey(0.6)), (0.7, _grey(1.25))]), 1.0, 'MULTIPLY')
    col = p.mix(rd, cr, panel)
    col = weather(p, col, edge=edge, edge_k=0.6, cavity=0.6, dirt=0.7, dirt_top=0.45, streaks=0.3)
    return p.finish(col, spec=0.12, spec_rough=0.5, bump=(p.noise(16.0, 7.0, 0.72), 0.25), shade=L.WARM_SHADE)


# ------------------------------------------------------------------------------------------------------------ tiers
# The owner's tier rule (from the wall blocks): tier 2 "more gold", like the Gold Blocks; tier 3 "black diamond with gold
# trim", like the Black Diamond Blocks. Colours from walls/top.4.v2.png (gold: shade 150,86,10, face 232,162,40, light
# 255,214,90) and walls/top.5.png (black diamond: 16-90 grey, faceted, white glints).
GOLD = dict(base=(218, 138, 22), dark=(140, 76, 8), rust=(96, 56, 12), edge=(255, 206, 80), spec_col=(1.0, 0.74, 0.32, 1),
            edge_k=0.55)


def mat_gold(name, rust_k=0.18, dirt=0.12, spec=0.6, dents=0.45):
    """Worn gold: the Gold Blocks' warm yellow-orange, cleaner than iron, a little tarnish in its crevices."""
    return mat_iron(name, rust_k=rust_k, dirt=dirt, spec=spec, dents=dents, **GOLD)


def mat_black_crystal(name, scale=6.0, glow=(255, 92, 20), glow_k=0.3, sparkle=1.0, dark=(10, 10, 14),
                      light=(66, 66, 80)):
    """Black diamond plating: cut facets (each its own shade, edged by sharp ridges), white glints like the Black
    Diamond Blocks, and a faint fire glowing in the seams between facets (the Inferno's)."""
    p = L.Paint(name)
    v = p.N.new("ShaderNodeTexVoronoi")
    v.feature = 'F1'
    v.inputs["Scale"].default_value = scale
    p.link(p.tc.outputs["Object"], v.inputs["Vector"])
    e = p.N.new("ShaderNodeTexVoronoi")
    e.feature = 'DISTANCE_TO_EDGE'
    e.inputs["Scale"].default_value = scale
    p.link(p.tc.outputs["Object"], e.inputs["Vector"])
    col = p.ramp(_bw(p, v.outputs["Color"]), [(0.0, srgb(*dark)), (0.55, srgb(*[(a + b) // 2 for a, b in zip(dark, light)])),
                                              (1.0, srgb(*light))])
    gl = p.ramp(p.noise(38.0, 2.0, 0.5), [(0.74, BLACK), (0.78, _grey(sparkle))])
    col = p.mix(col, srgb(235, 238, 255), gl)
    col = weather(p, col, edge=(150, 150, 172), edge_k=0.35, cavity=0.45, dirt=0.25, streaks=0.0, vary=0.08)
    seam = p.ramp(e.outputs["Distance"], [(0.0, WHITE), (0.05, BLACK)])
    emit = p.mix(srgb(*glow), BLACK, p.math("SUBTRACT", 1.0, p.math("MULTIPLY", _bw(p, seam), glow_k)))
    col = p.mix(col, srgb(10, 6, 6), p.math("MULTIPLY", _bw(p, seam), 0.7))
    h = p.math("MULTIPLY", v.outputs["Distance"], 3.0)
    shade = [(0.0, (0.36, 0.36, 0.42, 1)), (0.2, (0.5, 0.5, 0.58, 1)), (0.5, (0.78, 0.78, 0.84, 1)), (1.0, (0.95, 0.95, 1.0, 1))]
    return p.finish(col, spec=0.7, spec_rough=0.12, spec_col=(0.92, 0.95, 1.0, 1), metal=True, bump=(h, 0.9), shade=shade,
                    emit=emit, edge_dark=0.4, sheen=0.12, glint=0.3)


# The Inferno's blocks go Brimstone -> Granite -> Forged Steel (english.json infernoblock_desc); their colours are from
# buildings/iwalls/top.1-3.v2.png: brimstone a black-brown crust (18-70) cracked over orange fire (247,130,63); granite a
# warm grey-tan (81,74,61 to 158,146,128); forged steel a warm dark gunmetal (59,50,49 to 125,110,108), white glints.
FORGED = dict(base=(92, 84, 84), dark=(44, 40, 42), rust=(96, 70, 54), edge=(214, 206, 202), spec_col=(0.95, 0.95, 1.0, 1),
              rust_k=0.08, dirt=0.1, spec=0.55, dents=0.5, edge_k=0.75)


def mat_forged(name, seams=0, **kw):
    """Forged steel: dark warm gunmetal, hammered, bright-edged, a cool shine."""
    return mat_iron(name, seams=seams, **{**FORGED, **kw})


def mat_brimstone(name, scale=5.0, crust=((18, 15, 14), (74, 46, 32)), fire=(255, 118, 30), hot=(255, 196, 120),
                  glow_k=1.0, low=0.4):
    """Brimstone: a charred black-brown crust in lumps, cracked open over glowing fire (hotter toward the ground,
    like the Inferno's first block)."""
    p = L.Paint(name)
    v = p.N.new("ShaderNodeTexVoronoi")
    v.inputs["Scale"].default_value = scale
    p.link(p.tc.outputs["Object"], v.inputs["Vector"])
    e = p.N.new("ShaderNodeTexVoronoi")
    e.feature = 'DISTANCE_TO_EDGE'
    e.inputs["Scale"].default_value = scale
    p.link(p.tc.outputs["Object"], e.inputs["Vector"])
    col = p.ramp(_bw(p, v.outputs["Color"]), [(0.0, srgb(*crust[0])), (1.0, srgb(*crust[1]))])
    col = p.mix(col, p.ramp(p.noise(14.0, 5.0, 0.6), [(0.35, _grey(0.6)), (0.65, _grey(1.15))]), 1.0, 'MULTIPLY')
    col = weather(p, col, edge=(120, 84, 62), edge_k=0.45, cavity=0.5, dirt=0.0, streaks=0.0, vary=0.1)
    crack = p.math("ADD", e.outputs["Distance"], p.math("MULTIPLY", p.noise(9.0, 3.0), 0.04))
    seam = _bw(p, p.ramp(crack, [(0.018, WHITE), (0.06, BLACK)]))
    seam = p.math("MULTIPLY", seam, _bw(p, p.ramp(p.noise(3.0, 3.0, 0.6), [(0.32, BLACK), (0.48, WHITE)])))
    geo = p.N.new("ShaderNodeNewGeometry")
    gz = p.N.new("ShaderNodeSeparateXYZ")
    p.link(geo.outputs["Position"], gz.inputs[0])
    lowk = p.math("ADD", 0.35, p.math("MULTIPLY", _bw(p, p.ramp(gz.outputs[2], [(0.0, WHITE), (low, BLACK)])), 0.75))
    fc = p.ramp(crack, [(0.0, srgb(*hot)), (0.05, srgb(*fire))])
    emit = p.mix(BLACK, fc, p.math("MULTIPLY", p.math("MULTIPLY", seam, lowk), glow_k))
    col = p.mix(col, srgb(*fire), p.math("MULTIPLY", seam, 0.75))
    h = p.math("ADD", p.math("MULTIPLY", v.outputs["Distance"], 1.5), p.math("MULTIPLY", seam, -1.0))
    return p.finish(col, spec=0.15, spec_rough=0.5, bump=(h, 0.8), shade=L.WARM_SHADE, emit=emit, edge_dark=0.3, sheen=0.0)


def mat_granite(name, seams=0, light=(166, 154, 134), dark=(104, 96, 82), fleck_d=(40, 36, 34), fleck_l=(232, 226, 214),
                edge=(214, 204, 186), dirt=0.35, soot=0.25):
    """Granite: warm grey-tan stone with dark and pale flecks, chunky chisel shading, chipped pale edges, sooty
    crevices. seams: that many cut blocks round Z with mortar joins between (a drum built of stone)."""
    p = L.Paint(name)
    col = p.ramp(p.noise(2.0, 4.0, 0.55), [(0.3, srgb(*dark)), (0.7, srgb(*light))])
    if seams:
        idx, f, sep = _stave(p, seams, wob=0.0)
        col = p.mix(col, p.ramp(_white(p, idx), [(0.0, _grey(0.85)), (1.0, _grey(1.1))]), 1.0, 'MULTIPLY')
        d = p.math("MINIMUM", f, p.math("SUBTRACT", 1.0, f))
        joint = p.ramp(d, [(0.03, WHITE), (0.06, BLACK)])
        col = p.mix(col, srgb(*[int(c * 0.4) for c in dark]), joint)
    col = p.mix(col, srgb(*fleck_d), p.ramp(p.noise(40.0, 2.0, 0.5), [(0.66, BLACK), (0.7, _grey(0.85))]))
    col = p.mix(col, srgb(*fleck_l), p.ramp(p.noise(34.0, 2.0, 0.5, coord="Generated"), [(0.7, BLACK), (0.74, _grey(0.7))]))
    chisel = _voronoi(p, 7.0)
    col = p.mix(col, p.ramp(chisel, [(0.05, _grey(0.86)), (0.5, _grey(1.06))]), 1.0, 'MULTIPLY')
    col = weather(p, col, edge=edge, edge_k=0.7, cavity=0.65, dirt=dirt, soot=soot, streaks=0.2)
    h = p.math("MULTIPLY", chisel, 1.4)
    if seams:
        h = p.math("ADD", h, p.math("MULTIPLY", _bw(p, joint), -1.5))
    return p.finish(col, spec=0.1, spec_rough=0.6, bump=(h, 0.7), shade=L.WARM_SHADE)
