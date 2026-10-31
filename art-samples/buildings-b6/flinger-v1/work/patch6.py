"""patch6: look 1 (A-frame, coil, cap, pulley, rope, stool) and look 2 (open back half: truss, seat, +X rail and
brace), two springs on a block in looks 1-2, axle bearings."""
p = 'flinger.py'
s = open(p, encoding='utf-8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)


# posts: look 2's back posts stop under the truss's tie beam
rep("""        h = hs[i] if hs else roof_z(sx * c[0]) - 0.1
""", """        h = hs[i] if hs else roof_z(sx * c[0]) - 0.1
        if LOOK == 2 and sy > 0:
            h = S.TRUSS_Z - 0.4
""")

# walls: look 2 has only the -Y gable and the front half of the hidden -X wall
rep("""    # +X
    planks("xwall", """, """    if LOOK == 2:
        planks("lwall", (-A + 0.06, S.ROOF2_Y1), (-A + 0.06, -by), lambda u: S.SILL_H,
               lambda u: roof_z(-A) - S.ROOF_T - 0.04, M["plank"], 4, thick=t, out=(-1, 0))
        box("inside", (2 * ax, 2 * by, 0.05), (0, 0, S.SILL_H - 0.04), M["inside"], bevel=0.0)
        return
    # +X
    planks("xwall", """)

# axle bearings on the two front posts' inner faces
rep("""    # the crank stick out of the drum's side""", """    for i, sx in enumerate((-1, 1)):
        box(f"bearing{i}", (0.5, 0.4, 0.5), (sx * (A - S.POST / 2), c.y - 0.04, c.z), M["steel"], bevel=0.05,
            origin="center")
    # the crank stick out of the drum's side""")

# springs: looks 1, 2 have two on a wooden block; each reaches the arm right above it
rep("""    s0 = Vector(S.SPRING_C)
    dxy = Vector((a1.x - a0.x, a1.y - a0.y, 0))
    k = max(0.0, min(1.0, Vector((s0.x - a0.x, s0.y - a0.y, 0)).dot(dxy) / dxy.length_squared))
    top = a0 + (a1 - a0) * k          # the arm right above the springs' foot
    for k in range(S.SPRINGS):
        off = Vector(S.SPRING_OFF) * k
        b0 = s0 + off
        h = top.z - 0.1 - b0.z""", """    s0 = Vector(S.SPRING_C)
    nspr = S.SPRINGS
    if LOOK <= 2:
        s0.z = S.SPRING_BLOCK_H
        nspr = 2
        off = Vector(S.SPRING_OFF)
        box("sblock", (0.9, 0.9 + abs(off.y), S.SPRING_BLOCK_H), (s0.x, s0.y + off.y / 2, 0), M["posty"], bevel=0.06)
    dxy = Vector((a1.x - a0.x, a1.y - a0.y, 0))
    for k in range(nspr):
        off = Vector(S.SPRING_OFF) * k
        b0 = s0 + off
        f = max(0.0, min(1.0, Vector((b0.x - a0.x, b0.y - a0.y, 0)).dot(dxy) / dxy.length_squared))
        top = a0 + (a1 - a0) * f          # the arm right above this spring's foot
        h = top.z - S.ARM_R - b0.z""")

# new parts before build()
rep("""def build():
    corner_posts()""", '''def beam(name, p0, p1, w, h, mat, bevel=0.04):
    """A squared timber from p0 to p1 (w x h across)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = box(name, (w, h, d.length), p0, mat, bevel=bevel)
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def px_d(sx, sy, d):
    """The world point on Flash pixel (sx, sy) in the upright plane x - y = d."""
    a = (sx - ORIGIN[0]) / SX
    return px(sx, sy, X=(a + d) / 2)


def aframe():
    """Look 1: the A-frame over the open frame: two legs to an apex with a steel cap, a little slate roof and the gold
    pulley on top, a rope coil on the left leg, the rope from the ball over the pulley onto the coil."""
    apex = px_d(*S.A1_APEX_SCR, S.A1_D)
    rf = px(*S.A1_RFOOT_SCR, Z=0.0)
    lf = Vector((*S.A1_LFOOT, S.SILL_H))
    w = S.A1_W
    beam("aleg0", lf, apex + (apex - lf).normalized() * 0.2, w, w, M["post"])
    beam("aleg1", rf, apex + (apex - rf).normalized() * 0.2, w, w, M["post"])
    box("acap", (0.95, 0.95, 0.5), apex + Vector((0, 0, -0.05)), M["steel"], bevel=0.06)
    # the slate roof over the cap: two slates each side of a ridge along Y
    for sd in (-1, 1):
        for j, yy in enumerate((-0.4, 0.4)):
            ob = box(f"aslate{sd}{j}", (0.85, 0.82, 0.12), apex + Vector((sd * 0.36, yy, 0.38)), M["slate"],
                     bevel=0.03, origin="center")
            ob.rotation_euler = (0, math.radians(sd * 32 + rng.uniform(-3, 3)), math.radians(rng.uniform(-4, 4)))
    # the pulley in a gold fork on the ridge
    _, n, e1, e2 = pul_plane()
    pc = apex + Vector((0, 0, 1.15))
    pulley("pul1", pc, S.PUL_R, M["dgold"])
    for sd in (-1, 1):
        tube(f"afork{sd}", [apex + Vector((0, 0, 0.5)) + n * sd * 0.22, pc + n * sd * 0.22], 0.06, M["gold"])
    # the rope coil: turns of rope round the left leg
    c0, c1, cr = S.COIL
    ax = (apex - lf).normalized()
    u = ax.cross(Vector((0, 0, 1))).normalized()
    v = ax.cross(u)
    a = lf + (apex - lf) * c0
    b = lf + (apex - lf) * c1
    turns, m = 8, 8 * 24
    pts = [a + (b - a) * (i / m) + u * (cr * math.cos(i * 2 * math.pi / 24)) + v * (cr * math.sin(i * 2 * math.pi / 24))
           for i in range(m + 1)]
    tube("coil", pts, 0.13, M["rope"], verts=10)
    for k, rr in enumerate((cr - 0.22, cr - 0.4)):          # the inner turns, so the coil reads thick
        pts = [a + (b - a) * (i / m) + u * (rr * math.cos(i * 2 * math.pi / 24 + 1)) +
               v * (rr * math.sin(i * 2 * math.pi / 24 + 1)) for i in range(m + 1)]
        tube(f"coilin{k}", pts, 0.12, M["rope"], verts=8)
    return pc, (a + b) / 2, cr, ax


def belt1(pc, cc, cr, ax, b):
    """Look 1's rope: from the ball up over the pulley and down onto the coil's front."""
    r = S.PUL_R
    _, n, e1, e2 = pul_plane()

    def arc(c, rr, a0, a1, k=10):
        return [c + e1 * (rr * math.cos(math.radians(a0 + (a1 - a0) * i / k)))
                + e2 * (rr * math.sin(math.radians(a0 + (a1 - a0) * i / k))) for i in range(k + 1)]
    bt = b + Vector((0, 0, S.BALL_R - 0.15))
    pts = [bt, pc - e1 * (r + 0.04) - e2 * 2.5]
    pts += arc(pc, r + 0.03, 180, -30, 10)
    face = (Vector((1, -1, 0)) - ax * Vector((1, -1, 0)).dot(ax)).normalized()
    end = cc + ax * 0.6 + face * (cr + 0.12)
    pts.append((pts[-1] + end) / 2 + e1 * 0.15)
    pts.append(end)
    sweep("belt", smooth_open(pts), n, 0.3, S.BELT_T, M["belt"], bevel=0.02)


def stool():
    """Look 1: a little wooden step stool beside the bucket."""
    c = Vector((*S.STOOL_C, 0.0))
    h, sz = S.STOOL_H, S.STOOL_S
    box("stoolseat", (sz, sz, 0.16), c + Vector((0, 0, h - 0.16)), M["arm"], bevel=0.04)
    t, bt = sz / 2 - 0.14, sz / 2 + 0.12
    for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        beam(f"stoolleg{i}", c + Vector((sx * bt, sy * bt, 0)), c + Vector((sx * t, sy * t, h - 0.16)), 0.17, 0.17,
             M["post"], bevel=0.03)
    k = 0.42                                            # the rails at this fraction of the height, the step in front
    q = bt + (t - bt) * k
    box("stoolstep", (2 * q + 0.1, 0.4, 0.1), c + Vector((0, -q + 0.08, h * k)), M["arm"], bevel=0.03)
    box("stoolrail0", (0.1, 2 * q, 0.14), c + Vector((q, 0, h * k)), M["post"], bevel=0.02)
    box("stoolrail1", (0.1, 2 * q, 0.14), c + Vector((-q, 0, h * k)), M["post"], bevel=0.02)
    box("stoolrail2", (2 * q, 0.1, 0.14), c + Vector((0, q, h * k)), M["post"], bevel=0.02)


def back_frame():
    """Look 2: the open back half: a tie beam on the back posts, two rafters up to the ridge beam, a seat block on the
    right back post, a rail and a diagonal brace along the open +X side."""
    y, z = S.TRUSS_Y, S.TRUSS_Z
    box("tie", (2 * A, 0.42, 0.4), (0, y, z - 0.4), M["postx"], bevel=0.05)
    sx, sy, wx, wy, st = S.SEAT
    box("seat", (wx, wy, st), (sx, sy, z), M["drum"], bevel=0.06)
    top = Vector((S.RIDGE_X, y, S.RIDGE_Z - 0.3))
    beam("rafter0", (-A + 0.35, y, z), top + Vector((0, 0, 0.1)), 0.34, 0.34, M["post"])
    beam("rafter1", (sx - 0.2, y, z + st), top + Vector((0, 0, 0.1)), 0.34, 0.34, M["post"])
    beam("ridge", (S.RIDGE_X, S.ROOF2_Y1 - 0.6, S.RIDGE_Z - 0.42), (S.RIDGE_X, y + 0.3, S.RIDGE_Z - 0.42), 0.34, 0.34,
         M["posty"])
    xr = A - S.POST / 2
    box("xrail", (0.36, 2 * (B - S.POST) + 0.1, 0.4), (xr, 0, 3.4), M["posty"], bevel=0.05)
    beam("xbrace", (xr, -B + S.POST + 0.1, S.SILL_H), (xr, B - S.POST - 0.2, 3.45), 0.3, 0.3, M["post"])


def build():
    corner_posts()''')

rep("""    if LOOK >= 2:
        p1, p2 = gold_parts()
        belt(p1, p2, b)
""", """    if LOOK >= 2:
        p1, p2 = gold_parts()
        belt(p1, p2, b)
    if LOOK == 2:
        back_frame()
    if LOOK == 1:
        belt1(*aframe(), b)
        stool()
""")

rep("""("spring", "spring"), ("pipe", "pipe"))""", """("spring", "spring"), ("pipe", "pipe"),
          ("bearing", "axle"), ("sblock", "post"), ("aleg", "post"), ("acap", "gold"), ("aslate", "roof"),
          ("afork", "gold"), ("coil", "coil"), ("stool", "stool"), ("tie", "post"), ("seat", "post"),
          ("rafter", "post"), ("ridge", "post"), ("xrail", "post"), ("xbrace", "post"))""")
open(p, 'w', encoding='utf-8').write(s)
print("ok")
