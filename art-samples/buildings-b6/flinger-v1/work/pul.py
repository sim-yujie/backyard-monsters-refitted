def pul_plane():
    """The pulleys' plane: a point on it (the block's top), its normal, and two unit directions in it (e1 level,
    toward the back; e2 up)."""
    a, t = math.radians(S.PUL_N[0]), math.radians(S.PUL_N[1])
    n = Vector((math.cos(a) * math.cos(t), math.sin(a) * math.cos(t), math.sin(t)))
    e1 = Vector((0, 0, 1)).cross(n).normalized()
    e2 = n.cross(e1).normalized()
    p0 = Vector(S.BLOCK_C) + Vector((0, 0, S.BLOCK_S[2] / 2))
    return p0, n, e1, e2


def hit_plane(sx, sy, p0, n):
    """Where the camera ray through Flash pixel (sx, sy) meets the plane through p0 with normal n."""
    a, b = px(sx, sy, Z=0.0), px(sx, sy, Z=10.0)
    d = b - a
    t = (Vector(p0) - a).dot(n) / d.dot(n)
    return a + d * t


def on_plane(sx, sy):
    p0, n, _, _ = pul_plane()
    return hit_plane(sx, sy, p0, n)


def pulley(name, c, r, mat_rim, spokes=5, wide=0.32, knobs=True):
    """A gold pulley in the pulleys' plane: a grooved rim the belt runs in, spokes, a hub and the axle's two gold
    knobs."""
    _, n, _, _ = pul_plane()
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = c
    e.rotation_euler = n.to_track_quat("Z", "Y").to_euler()          # local Z = the axle
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
    _, n, e1, e2 = pul_plane()
    p2 = on_plane(*S.PUL2_SCR)
    pulley("pul2", p2, S.PUL_R, M["dgold"])
    top = blk + Vector((0, 0, S.BLOCK_S[2] / 2))
    tube("gstem2", [top + Vector((0, 0.1, -0.05)), p2 - e2 * 0.12], 0.07, M["gold"])
    p1 = on_plane(*S.PUL1_SCR)
    if LOOK >= 3:
        pulley("pul1", p1, S.PUL_R, M["dgold"])
        tube("gstem1", [top + Vector((0, -0.2, -0.05)), p1 - e2 * 0.12], 0.07, M["gold"])
    else:
        # look 2: a gold rod out toward the viewer's left with a knob, where look 3's pulley will sit
        tube("grod", [top + Vector((0, -0.2, -0.05)), p1], 0.07, M["gold"])
        sphere("grodknob", 0.14, p1 - Vector((0, 0, 0.14)), M["gold"], n=12)
    if LOOK >= 4:
        w = on_plane(*S.WHEEL_SCR)
        pulley("wheel", w, S.WHEEL_R, M["dgold"], spokes=8, wide=0.22)
        # its crank: a bent gold handle on the hub
        tube("wcrank", [w + n * 0.2, w + n * 0.35 - e1 * 0.3 - e2 * 0.35, w + n * 0.35 + e1 * 0.25 - e2 * 0.6],
             0.06, M["gold"], smooth=True)
        # its stand: a gold post up from the ridge's back end to the hub's back
        rb = Vector((S.RIDGE_X, S.ROOF_Y1 - 0.2, S.RIDGE_Z + 0.1))
        tube("wstand", [rb, rb + Vector((0, 0.2, 0.5)), w - n * 0.25], 0.07, M["gold"], smooth=True)
        print("PROBE wheel", tuple(round(v, 2) for v in w), "block", tuple(round(v, 2) for v in blk))
    return p1, p2


def belt(p1, p2, b):
    """The dark belt: down to the ball, up over the pulleys (and look 4's wheel), and away behind the roof."""
    r, t = S.PUL_R, S.BELT_T
    _, n, e1, e2 = pul_plane()

    def arc(c, rr, a0, a1, k=10):
        return [c + e1 * (rr * math.cos(math.radians(a0 + (a1 - a0) * i / k)))
                + e2 * (rr * math.sin(math.radians(a0 + (a1 - a0) * i / k))) for i in range(k + 1)]
    bt = b + Vector((0, 0, S.BALL_R - 0.15))
    pts = [bt, p1 - e1 * (r + 0.04) - e2 * 1.5]
    pts += arc(p1, r + 0.03, 180, 80, 8)
    pts.append((p1 + p2) / 2 - e2 * 0.55)
    pts += arc(p2, r + 0.03, 110, -10, 8)
    if LOOK >= 4:
        w = on_plane(*S.WHEEL_SCR)
        pts.append(p2 + e1 * 0.9 - e2 * 0.55)
        pts += arc(w, S.WHEEL_R + 0.03, 200, -40, 14)
        pts.append(w + e1 * 1.2 - e2 * 2.6)
        pts.append(w + e1 * 1.0 - e2 * 4.2)
    else:
        pts.append(p2 + e1 * (r + 0.3) - e2 * 1.2)
        pts.append(p2 + e1 * (r + 0.35) - e2 * 2.2)
    sweep("belt", smooth_open(pts), n, 0.3, t, M["belt"], bevel=0.02)


