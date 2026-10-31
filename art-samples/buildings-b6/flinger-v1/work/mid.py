# ------------------------------------------------------------------------------------------------------------ the model
def slate(name, cols, rough=0.42):
    """Flash's slate tiles: each tile its own pale blue or lavender (Object Info random picks from cols), lighter
    toward its lower edge where Flash paints a pale rim, with a faint mottle."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    oi = t.n("ShaderNodeObjectInfo")
    stops = []
    for i, c in enumerate(cols):
        stops.append((i / len(cols) + 0.001, srgb(*c)))
    r = t.n("ShaderNodeValToRGB")
    r.color_ramp.interpolation = "CONSTANT"
    el = r.color_ramp.elements
    el[0].position, el[0].color = 0.0, srgb(*cols[0])
    el[1].position, el[1].color = stops[-1]
    for pos, col in stops[1:-1]:
        el.new(pos).color = col
    t.link(oi.outputs["Random"], r.inputs[0])
    col = r.outputs[0]
    # the pale rim: the tile's own box (Generated), lighter toward its lower (local -X) end and its top face
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs["Generated"], sep.inputs[0])
    rim = t.ramp(sep.outputs["X"], [(0.0, (1, 1, 1, 1)), (0.22, (0.35, 0.35, 0.35, 1)), (0.5, (0, 0, 0, 1))])
    col = t.mix(col, srgb(226, 232, 250), t.mix(rim, (0, 0, 0, 1), 0.35), "MIX")
    n1 = t.noise(v, 9.0, 3.0, 0.5)
    col = t.mix(col, t.ramp(n1, [(0.3, srgb(120, 124, 170)), (0.7, srgb(210, 214, 240))]), 0.22, "MIX")
    col = t.grime(col, GROUND, 3.0, 0.15, 0.5)
    t.set(**{"Base Color": col, "rough": rough, "spec": 0.55})
    t.bump(t.noise(v, 14, 4.0, 0.6), 0.06, 0.01)
    MATS[name] = t.m
    return t.m


def dimpled(name, col, dim):
    """The golf ball: glossy white with soft round dimples (a Voronoi cell pattern pressed in and a touch darker)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    vo = t.n("ShaderNodeTexVoronoi")
    vo.feature = "F1"
    vo.inputs["Scale"].default_value = 5.5
    t.link(v, vo.inputs["Vector"])
    pit = t.ramp(vo.outputs["Distance"], [(0.0, (1, 1, 1, 1)), (0.34, (0, 0, 0, 1))])
    col = t.mix(srgb(*col), srgb(*dim), pit, "MIX")
    col = t.grime(col, GROUND, 1.6, 0.12, 0.55)
    t.set(**{"Base Color": col, "rough": 0.38, "spec": 0.5})
    b = t.n("ShaderNodeBump")
    b.inputs["Strength"].default_value = 0.55
    b.inputs["Distance"].default_value = 0.04
    b.invert = True
    t.link(pit, b.inputs["Height"])
    t.link(b.outputs[0], t.bsdf.inputs["Normal"])
    MATS[name] = t.m
    return t.m


def materials():
    M = {}
    # Flash's weathered timber: grey-brown posts, darker wall planks, paler beams and the drum
    M["post"] = wood("post", (130, 110, 78), (84, 72, 46), axis="Z", dirt=0.3, rings=4.0)
    M["postx"] = wood("post", (130, 110, 78), (84, 72, 46), axis="X", dirt=0.3, rings=4.0)
    M["posty"] = wood("post", (130, 110, 78), (84, 72, 46), axis="Y", dirt=0.3, rings=4.0)
    M["plank"] = wood("plank", (112, 94, 64), (70, 58, 36), axis="Z", dirt=0.35, rings=4.0)
    M["gplank"] = wood("gplank", (104, 88, 62), (66, 54, 34), axis="Z", dirt=0.2, rings=4.0)
    M["drum"] = wood("drum", (176, 150, 104), (112, 92, 60), axis="X", dirt=0.15, rings=3.0)
    M["arm"] = wood("arm", (172, 142, 96), (110, 90, 58), axis="Y", dirt=0.15, rings=3.0)
    M["hub"] = wood("hub", (150, 128, 92), (100, 84, 56), axis="X", dirt=0.15, rings=3.0)
    M["inside"] = flat("inside", (16, 12, 9), rough=1.0)
    M["slate"] = slate("slate", [(168, 176, 226), (150, 166, 214), (186, 180, 228), (140, 156, 206), (176, 190, 232),
                                 (160, 160, 214)])
    for k, (sc, amt) in {"post": (1.0, 0.25), "postx": (1.0, 0.25), "posty": (1.0, 0.25), "plank": (1.1, 0.22),
                         "gplank": (1.1, 0.2), "drum": (1.3, 0.12), "arm": (1.3, 0.12), "hub": (1.3, 0.12)}.items():
        stain(M[k], sc, amt, 2.0 + len(k), fine=0.12)
    # metals: Flash's old gold pulleys, the blue-grey steel pipe and axle, dark springs
    M["gold"] = shiny("gold", (238, 176, 42), rough=0.28, metal=0.88, wear=(128, 76, 12), scale=2.0, dirt=0.25, side=0.3)
    M["dgold"] = shiny("dgold", (176, 118, 24), rough=0.34, metal=0.85, wear=(104, 56, 10), scale=2.0, dirt=0.3, side=0.3)
    M["groove"] = painted("groove", (46, 30, 26), rough=0.6, dirt=0.0, spec=0.3)
    M["steel"] = shiny("steel", (150, 160, 178), rough=0.35, metal=0.75, wear=(110, 118, 134), scale=3.0, dirt=0.15)
    M["pipe"] = painted("pipe", (88, 104, 118), rough=0.45, metal=0.5, wear=(70, 84, 96), scale=3.0, dirt=0.3, spec=0.5)
    M["spring"] = shiny("spring", (96, 112, 128), rough=0.35, metal=0.8, wear=(60, 70, 80), scale=3.0, dirt=0.1)
    M["belt"] = painted("belt", (66, 44, 50), rough=0.55, dirt=0.0, spec=0.35)
    M["ball"] = dimpled("ball", (226, 224, 234), (176, 174, 190))
    M["pot"] = painted("pot", (66, 44, 42), rough=0.4, wear=(54, 36, 34), scale=3.0, dirt=0.2, spec=0.5)
    M["potin"] = flat("potin", (12, 5, 5), rough=0.8)
    M["rope"] = painted("rope", (66, 46, 50), rough=0.8, dirt=0.0, spec=0.25)
    return M


M = materials()
A, B = S.HA, S.HB
YAW_M = Matrix.Rotation(math.radians(S.YAW), 4, "Z")
LOOK = min(L, 4)                      # level 5 shows look 4


def roof_z(x):
    """The roof's top at x (its two slopes from the ridge to the eaves)."""
    return S.RIDGE_Z - (S.RIDGE_Z - S.EAVE_Z) * abs(x - S.RIDGE_X) / S.ROOF_A


def corner_posts():
    c = (A - S.POST / 2, B - S.POST / 2)
    hs = {1: S.POST1_H}.get(LOOK, None)
    for i, (sx, sy) in enumerate(((1, -1), (-1, -1), (1, 1), (-1, 1))):
        h = hs[i] if hs else roof_z(sx * c[0]) - 0.1
        box(f"post{i}", (S.POST, S.POST, h), (sx * c[0], sy * c[1], 0), M["post"], bevel=0.06,
            rot=(0, 0, rng.uniform(-1, 1)))


def sills():
    """The ground frame: a beam along each side, between the posts."""
    w, h = 0.5, S.SILL_H
    ax, by = A - S.POST, B - S.POST
    box("sill0", (2 * ax, w, h), (0, -B + w / 2 + 0.06, 0), M["postx"], bevel=0.05)
    box("sill1", (2 * ax, w, h), (0, B - w / 2 - 0.06, 0), M["postx"], bevel=0.05)
    box("sill2", (w, 2 * by, h), (A - w / 2 - 0.06, 0, 0), M["posty"], bevel=0.05)
    box("sill3", (w, 2 * by, h), (-A + w / 2 + 0.06, 0, 0), M["posty"], bevel=0.05)


def walls():
    """Plank walls between the posts: the -Y gable round the drum's opening, the +X side, and the hidden two."""
    ax, by = A - S.POST, B - S.POST
    t = S.PLANK_T
    x0, x1, z0, z1 = S.OPEN
    # -Y: under the opening, the header over it, the gable above (its planks reach the roof's underside)
    planks("ywall", (-ax, -B + 0.06), (ax, -B + 0.06), lambda u: S.SILL_H, lambda u: z0, M["plank"], 6, thick=t,
           out=(0, -1))
    box("header", (2 * ax + 0.1, 0.36, 0.34), (0, -B + 0.2, z1), M["postx"], bevel=0.05)
    gz = lambda u: roof_z(-ax + u) - S.ROOF_T - 0.02
    planks("gable", (-ax, -B + 0.1), (ax, -B + 0.1), lambda u: z1 + 0.3, gz, M["gplank"], 7, thick=t, out=(0, -1))
    # +X
    planks("xwall", (A - 0.06, -by), (A - 0.06, by), lambda u: S.SILL_H, lambda u: S.WALL_H, M["plank"], 7, thick=t,
           out=(1, 0))
    # +Y (with its gable) and -X: hidden from the camera, but they keep the inside dark
    planks("bwall", (ax, B - 0.06), (-ax, B - 0.06), lambda u: S.SILL_H, lambda u: roof_z(ax - u) - S.ROOF_T - 0.02,
           M["plank"], 6, thick=t, out=(0, 1))
    planks("lwall", (-A + 0.06, by), (-A + 0.06, -by), lambda u: S.SILL_H, lambda u: S.WALL_H, M["plank"], 6, thick=t,
           out=(-1, 0))
    # the inside: a dark floor, so the opening shows Flash's deep shadow
    box("inside", (2 * ax, 2 * by, 0.05), (0, 0, S.SILL_H - 0.04), M["inside"], bevel=0.0)


def slope_frame(s):
    """The +X (s = 1) or -X (s = -1) roof slope: ridge point maker, down-slope unit d, outward normal n, length."""
    a, b = S.ROOF_A, S.RIDGE_Z - S.EAVE_Z
    ln = math.hypot(a, b)
    d = Vector((s * a, 0, -b)) / ln
    n = Vector((s * b, 0, a)) / ln
    return d, n, ln


def roof_q(s, u, y, h=0.0):
    d, n, _ = slope_frame(s)
    return Vector((S.RIDGE_X, y, S.RIDGE_Z)) + d * u + n * h


def tile(name, s, u, y, tl, tw, tt, mat, tilt):
    """One slate on slope s, its middle at u down the slope and y along it, its lower end lifted by tilt (deg)."""
    d, n, _ = slope_frame(s)
    yv = Vector((0, 1, 0))
    a = math.radians(tilt)
    d2 = d * math.cos(a) + n * math.sin(a)
    n2 = n * math.cos(a) - d * math.sin(a)
    c = roof_q(s, u, y, tt * 0.5 + tl * 0.5 * math.sin(a))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        lx, ly, lz = v.co.x * tl, v.co.y * tw, v.co.z * tt
        v.co = c - d2 * lx + yv * ly + n2 * lz        # local +X up the slope (the Generated X: 0 at the lower end)
    return mesh_ob(name, bm, [mat], bevel=0.045, segs=2)


def hatch_box():
    """The hatch in the +X slope: u0..u1 down the slope, y0..y1 along it."""
    return S.HATCH


def roof(y0, y1):
    """Both slopes from y0 to y1: a board under rows of slates, and a row of ridge slates."""
    for s in (1, -1):
        d, n, ln = slope_frame(s)
        hole = S.HATCH if (s == 1 and LOOK >= 3) else None
        # the board (split round the hatch)
        pieces = [(0.0, ln, y0, y1)]
        if hole:
            u0, u1, hy0, hy1 = hole
            pieces = [(0.0, u0, y0, y1), (u1, ln, y0, y1), (u0, u1, y0, hy0), (u0, u1, hy1, y1)]
        for k, (a0, a1, b0, b1) in enumerate(pieces):
            bm = bmesh.new()
            top = [roof_q(s, a0, b0), roof_q(s, a1, b0), roof_q(s, a1, b1), roof_q(s, a0, b1)]
            vs = [bm.verts.new(p) for p in top] + [bm.verts.new(p - n * S.ROOF_T) for p in top]
            for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
                bm.faces.new([vs[i] for i in f])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            mesh_ob(f"roofb{s}{k}", bm, [M["slate"]], smooth=False, bevel=0.03, segs=2)
        # the slates, from the eave up (each row lies over the top of the one below)
        tl, tw, tt, step = S.TILE
        rows = int(math.ceil((ln - 0.1) / step))
        for i in range(rows):
            uc = ln - tl / 2 - i * step + 0.12
            if uc < tl / 2 - 0.1:
                uc = tl / 2 - 0.05
            off = (i % 2) * tw / 2
            yy = y0 - off + tw / 2
            j = 0
            while yy - tw / 2 < y1 - 0.02:
                w = min(tw, y1 + 0.04 - (yy - tw / 2))
                yc = yy - tw / 2 + w / 2
                if yy - tw / 2 < y0:
                    w = yy + tw / 2 - y0
                    yc = y0 + w / 2
                if hole and hole[0] - 0.3 < uc < hole[1] + 0.25 and hole[2] - 0.2 < yc < hole[3] + 0.2:
                    yy += tw
                    continue
                tile(f"slate{s}-{i}-{j}", s, uc + rng.uniform(-0.03, 0.03), yc + rng.uniform(-0.02, 0.02),
                     tl + rng.uniform(-0.04, 0.04), w - 0.04, tt, M["slate"], S.TILE_TILT + rng.uniform(-2, 2))
                yy += tw
                j += 1
    # the ridge: a row of small slates bent over it
    tl, tw, tt, step = S.TILE
    yy, j = y0, 0
    while yy < y1 - 0.05:
        w = min(tw, y1 - yy)
        c = Vector((S.RIDGE_X, yy + w / 2, S.RIDGE_Z + 0.08))
        box(f"rslate{j}", (0.7, w - 0.04, 0.16), c, M["slate"], rot=(0, 0, 0), bevel=0.05, origin="center")
        yy += w
        j += 1


def hatch():
    """The hatch in the +X slope (looks 3 and 4): a timber frame round the hole, the dark shaft under it, and what
    lies on its lower sill (a board in look 3, the throwing spoon's curved tip in look 4)."""
    u0, u1, y0, y1 = S.HATCH
    d, n, ln = slope_frame(1)
    fw = 0.16
    for k, (a0, a1, b0, b1) in enumerate(((u0 - fw, u0, y0 - fw, y1 + fw), (u1, u1 + fw, y0 - fw, y1 + fw),
                                          (u0, u1, y0 - fw, y0), (u0, u1, y1, y1 + fw))):
        bm = bmesh.new()
        top = [roof_q(1, a0, b0, 0.2), roof_q(1, a1, b0, 0.2), roof_q(1, a1, b1, 0.2), roof_q(1, a0, b1, 0.2)]
        vs = [bm.verts.new(p) for p in top] + [bm.verts.new(p - n * 0.5) for p in top]
        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([vs[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh_ob(f"hframe{k}", bm, [M["plank"]], smooth=False, bevel=0.03, segs=2)
    # the shaft: a dark box under the hole
    c = (roof_q(1, (u0 + u1) / 2, (y0 + y1) / 2, -0.9))
    bm = bmesh.new()
    top = [roof_q(1, u0, y0, -0.05), roof_q(1, u1, y0, -0.05), roof_q(1, u1, y1, -0.05), roof_q(1, u0, y1, -0.05)]
    vs = [bm.verts.new(p) for p in top] + [bm.verts.new(Vector((p.x, p.y, S.WALL_H - 0.6))) for p in top]
    for f in ((7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("hshaft", bm, [M["inside"]], smooth=False)
    if LOOK == 3:
        # the board: a plank lying on the lower sill, its far end out over the slates
        um = u1 + 0.05
        p = roof_q(1, um, (y0 + y1) / 2 + 0.1, 0.32)
        box("hboard", (0.9, y1 - y0 - 0.1, 0.12), p, M["arm"], rot=(0, -math.degrees(math.atan2(-d.z, d.x)) + 8, 0),
            bevel=0.04, origin="center")
    if LOOK >= 4:
        # the spoon's tip: a curved wooden bar rising out of the shaft and over the lower sill
        pts = []
        for i in range(9):
            a = math.radians(-30 + 150 * i / 8)
            pts.append(roof_q(1, (u0 + u1) / 2 + 0.45 * math.sin(a) + 0.2, (y0 + y1) / 2 + 0.75 * math.cos(a),
                              0.25 + 0.55 * math.sin(a)))
        sweep("spoon", pts, Vector((0, 0, 1)), 0.3, 0.2, M["arm"], bevel=0.05)


def drum():
    """The wooden drum on its steel axle (axis along X) behind the -Y opening, its crank stick, the bed below."""
    c = Vector(S.DRUM_C)
    cyl("drum", S.DRUM_R, S.DRUM_L, c - Vector((S.DRUM_L / 2, 0, 0)), M["drum"], rot=(0, 90, 0), verts=32, bevel=0.06)
    cyl("axle", S.AXLE_R, 2 * A - 0.2, Vector((-A + 0.1, c.y, c.z)), M["steel"], rot=(0, 90, 0), verts=16, bevel=0.02)
    # the crank stick out of the drum's side, down and toward the viewer's left
    a = c + Vector((-S.DRUM_L / 2 + 0.25, -S.DRUM_R + 0.05, -0.1))
    tube("crank", [a, a + Vector((-0.3, -0.75, -0.7))], 0.07, M["arm"])
    # the bed: two dark slats and a steel strap across the bottom of the opening
    box("bed0", (2 * (A - S.POST), 0.3, 0.16), (0, -B + 0.55, S.OPEN[2] + 0.15), M["postx"], bevel=0.03)
    box("bed1", (2 * (A - S.POST), 0.3, 0.16), (0, -B + 1.1, S.OPEN[2] + 0.45), M["postx"], bevel=0.03)
    box("strap", (2 * (A - S.POST), 0.42, 0.06), (0, -B + 0.45, S.OPEN[2] + 0.32), M["steel"], bevel=0.02)


def ball():
    c = px(*S.BALL_SCR, Z=S.BALL_R)
    sphere("ball", S.BALL_R, c - Vector((0, 0, S.BALL_R)), M["ball"], n=32)
    return c


def pulley(name, c, r, mat_rim, spokes=5, wide=0.32, knobs=True):
    """A gold pulley in the YZ plane (axle along X): a grooved rim the belt runs in, spokes, a hub and the axle's
    two gold knobs."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = c
    e.rotation_euler = (0, math.radians(90), 0)          # local Z = world X: the axle
    for side in (-1, 1):
        ring(f"{name}rim{side}", r, 0.06, mat_rim, parent=e, z=side * wide / 2)
    lathe(f"{name}groove", [(r - 0.02, -wide / 2), (r - 0.09, -wide / 4), (r - 0.1, wide / 4), (r - 0.02, wide / 2)],
          (0, 0, 0), M["groove"], parent=e)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes + 0.3
        p = (math.cos(a) * (r - 0.06), math.sin(a) * (r - 0.06), 0)
        tube(f"{name}spoke{k}", [(0, 0, 0), p], 0.045, M["gold"], parent=e)
    cyl(f"{name}hub", 0.13, wide + 0.06, (0, 0, -wide / 2 - 0.03), M["gold"], parent=e, verts=16)
    if knobs:
        for side in (-1, 1):
            sphere(f"{name}knob{side}", 0.1, (0, 0, side * (wide / 2 + 0.12) - 0.1), M["gold"], n=12).parent = e
    return e


def gold_parts():
    """The gold block on the gable's peak, its stems, the pulleys and (look 4) the big wheel on its stand."""
    blk = Vector(S.BLOCK_C)
    box("gblock", S.BLOCK_S, blk, M["gold"], bevel=0.06, origin="center")
    p2 = px(*S.PUL2_SCR, X=S.PUL_X)
    pulley("pul2", p2, S.PUL_R, M["dgold"])
    top = blk + Vector((0, 0, S.BLOCK_S[2] / 2))
    tube("gstem2", [top + Vector((0, 0.1, -0.05)), p2 + Vector((0, 0, -0.12))], 0.07, M["gold"])
    p1 = px(*S.PUL1_SCR, X=S.PUL_X)
    if LOOK >= 3:
        pulley("pul1", p1, S.PUL_R, M["dgold"])
        tube("gstem1", [top + Vector((0, -0.2, -0.05)), p1 + Vector((0, 0, -0.12))], 0.07, M["gold"])
    else:
        # look 2: a gold rod out toward the viewer's left with a knob, where look 3's pulley will sit
        tube("grod", [top + Vector((0, -0.2, -0.05)), p1], 0.07, M["gold"])
        sphere("grodknob", 0.14, p1 - Vector((0, 0, 0.14)), M["gold"], n=12)
    if LOOK >= 4:
        w = px(*S.WHEEL_SCR, X=S.PUL_X)
        pulley("wheel", w, S.WHEEL_R, M["dgold"], spokes=8, wide=0.22)
        # its crank: a bent gold handle on the hub
        tube("wcrank", [w + Vector((0.2, 0, 0)), w + Vector((0.35, -0.3, -0.35)), w + Vector((0.35, 0.25, -0.6))],
             0.06, M["gold"], smooth=True)
        # its stand: a short gold post up from the ridge's back end to the hub's back
        rb = Vector((S.RIDGE_X, S.ROOF_B - 0.2, S.RIDGE_Z + 0.1))
        tube("wstand", [rb, rb + Vector((0, 0.4, 0.6)), w + Vector((-0.2, 0, 0))], 0.07, M["gold"])
    return p1, p2


def belt(p1, p2, b):
    """The dark belt: down to the ball, up over the pulleys (and look 4's wheel), and away behind the roof."""
    r, t = S.PUL_R, S.BELT_T
    pts = []
    x = S.PUL_X

    def arc(c, rr, a0, a1, n=10):
        return [c + Vector((0, rr * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
                            rr * math.sin(math.radians(a0 + (a1 - a0) * i / n)))) for i in range(n + 1)]
    bt = b + Vector((0, 0, S.BALL_R - 0.15))
    pts.append(Vector((x, bt.y - 0.05, bt.z)))
    pts.append(Vector((x, p1.y - r - 0.04, (bt.z + p1.z) / 2)))
    pts += arc(p1, r + 0.03, 180, 80, 8)
    mid = (p1 + p2) / 2 - Vector((0, 0, 0.55))
    pts.append(mid)
    pts += arc(p2, r + 0.03, 110, -10, 8)
    if LOOK >= 4:
        w = px(*S.WHEEL_SCR, X=S.PUL_X)
        pts.append(p2 + Vector((0, 0.9, -0.55)))
        pts += arc(w, S.WHEEL_R + 0.03, 200, -40, 14)
        pts.append(w + Vector((0, 1.2, -2.6)))
        pts.append(w + Vector((0, 1.0, -4.2)))
    else:
        pts.append(p2 + Vector((0, r + 0.3, -1.2)))
        pts.append(Vector((x, p2.y + r + 0.35, S.RIDGE_Z - 0.6)))
    pts = [Vector((x, p.y, p.z)) for p in pts]
    sweep("belt", smooth_open(pts), Vector((1, 0, 0)), 0.3, t, M["belt"], bevel=0.02)


def smooth_open(pts, k=3):
    """An open path through pts, Catmull-Rom smoothed (k points per span)."""
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0, p1, p2, p3 = (Vector(pts[max(0, min(n - 1, i + j))]) for j in (-1, 0, 1, 2))
        for j in range(k):
            t = j / k
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(Vector(pts[-1]))
    return out


def bucket_arm():
    """The bucket on its arm: a wooden hub on the front post's +X face, the arm up to the bucket (look 4: a thick
    round arm and a big pot), the springs under the arm, and (looks 3, 4) the steel pipe they stand on."""
    hub = Vector(S.HUB)
    cyl("hub", S.HUB_R, 0.5, hub - Vector((0.1, 0, 0)), M["hub"], rot=(0, 90, 0), verts=24, bevel=0.06)
    cyl("hubpin", 0.07, 0.15, hub + Vector((0.4, 0, 0)), M["steel"], rot=(0, 90, 0), verts=12)
    big = LOOK >= 4
    bc = Vector(S.POT_C if big else S.BUCKET_C)
    br = S.POT_R if big else S.BUCKET_R
    bh = S.POT_H if big else S.BUCKET_H
    # the bucket: a tapered dark pot with a gold rim and a black inside
    lathe("bucket", [(br * 0.86, -bh), (br * 0.98, -bh * 0.5), (br, -0.02), (br * 0.94, -0.02),
                     (br * 0.92, -bh + 0.1)], bc, M["pot"], verts=40)
    ring("bucketrim", br, 0.07, M["gold"], z=0.0).location = bc
    cyl("bucketin", br * 0.92, 0.02, bc - Vector((0, 0, bh * 0.6)), M["potin"], verts=40, bevel=0.0)
    # the arm from the hub's rim to the bucket's side
    a0 = hub + Vector((0.15, 0, S.HUB_R * 0.4))
    a1 = bc + (Vector((hub.x, hub.y, bc.z)) - bc).normalized() * (br + 0.02) - Vector((0, 0, bh * 0.35))
    tube("barm", [a0, a1], S.POT_ARM_R if big else S.ARM_R, M["arm"], verts=16)
    # the springs: coils from a base up to the arm
    s0 = Vector(S.SPRING_C)
    top = a0 + (a1 - a0) * S.SPRING_T
    for k in range(S.SPRINGS):
        off = Vector(S.SPRING_OFF) * k
        b0 = s0 + off
        h = top.z - 0.1 - b0.z
        pts = [b0 + Vector((0.22 * math.cos(t * 0.5), 0.22 * math.sin(t * 0.5), h * t / (12 * math.pi)))
               for t in [i * 0.4 for i in range(int(12 * math.pi / 0.4) + 1)]]
        pts = [b0 + Vector((0.22 * math.cos(i * 0.4), 0.22 * math.sin(i * 0.4), h * i / 90)) for i in range(91)]
        tube(f"spring{k}", pts, 0.045, M["spring"], verts=8)
    if LOOK >= 3:
        # the steel pipe: from a flanged foot on the ground, leaning up to under the springs
        f = Vector(S.PIPE_FOOT)
        cyl("pipeflange", 0.7, 0.16, f, M["pipe"], verts=32, bevel=0.04)
        tube("pipe", [f + Vector((0, 0, 0.1)), f + Vector((0, 0, 0.6)), s0 + Vector((0, 0, -0.5)), s0],
             0.42, M["pipe"], verts=24, smooth=True)
        cyl("pipecap", 0.48, 0.12, s0 - Vector((0, 0, 0.1)), M["pipe"], verts=24, bevel=0.03)


def build():
    corner_posts()
    sills()
    if LOOK >= 2:
        walls()
        roof(-S.ROOF_B, S.ROOF_B if LOOK >= 3 else S.ROOF2_Y1)
    if LOOK >= 3:
        hatch()
    drum()
    b = ball()
    bucket_arm()
    if LOOK >= 2:
        p1, p2 = gold_parts()
        belt(p1, p2, b)
    bpy.context.view_layer.update()
    for ob in list(COLL.objects):           # the whole building turns by stack.YAW (into the mesh or curve itself)
        if ob.type in ("MESH", "CURVE") and ob.parent is None:
            ob.data.transform(YAW_M @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)


FAMILY = (("post", "post"), ("sill", "post"), ("ywall", "wall"), ("gable", "wall"), ("xwall", "wall"),
          ("bwall", "wall"), ("lwall", "wall"), ("header", "wall"), ("inside", "wall"), ("roof", "roof"),
          ("slate", "roof"), ("rslate", "roof"), ("hframe", "hatch"), ("hshaft", "hatch"), ("hboard", "board"),
          ("spoon", "spoon"), ("drum", "drum"), ("axle", "axle"), ("crank", "drum"), ("bed", "bed"), ("strap", "bed"),
          ("ball", "ball"), ("gblock", "gold"), ("gstem", "gold"), ("grod", "gold"), ("pul", "pulley"),
          ("wheel", "wheel"), ("wcrank", "wheel"), ("wstand", "gold"), ("belt", "belt"), ("hub", "hub"),
          ("bucket", "bucket"), ("barm", "arm"), ("spring", "spring"), ("pipe", "pipe"))


def family(o):
    n = o.name.split(".")[0]
    p = o.parent
    while p is not None:                    # a pulley's parts belong to their pulley
        n = p.name.split(".")[0]
        p = p.parent
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


