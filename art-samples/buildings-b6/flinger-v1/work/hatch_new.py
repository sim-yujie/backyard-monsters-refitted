def slope_box(name, s, a0, a1, b0, b1, h0, h1, mat, bevel=0.03):
    """A block on slope s: a0..a1 down the slope, b0..b1 along the ridge, h0..h1 off the roof board's top."""
    bm = bmesh.new()
    lo = [roof_q(s, a0, b0, h0), roof_q(s, a1, b0, h0), roof_q(s, a1, b1, h0), roof_q(s, a0, b1, h0)]
    hi = [roof_q(s, a0, b0, h1), roof_q(s, a1, b0, h1), roof_q(s, a1, b1, h1), roof_q(s, a0, b1, h1)]
    vs = [bm.verts.new(p) for p in hi + lo]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], smooth=False, bevel=bevel, segs=2)


def hatch():
    """The hatch in the +X slope (looks 3 and 4): a neat timber frame standing just above the slates round a long
    hole, the shaft under it, and what lies on its lower sill (a board in look 3, the throwing spoon's curved tip in
    look 4)."""
    u0, u1, y0, y1 = S.HATCH
    d, n, ln = slope_frame(1)
    fw, h1 = 0.2, 0.42
    for k, (a0, a1, b0, b1) in enumerate(((u0 - fw, u0, y0 - fw, y1 + fw), (u1, u1 + fw, y0 - fw, y1 + fw),
                                          (u0, u1, y0 - fw, y0), (u0, u1, y1, y1 + fw))):
        slope_box(f"hframe{k}", 1, a0, a1, b0, b1, -0.3, h1, M["frame"])
    # the shaft: its walls run down from the hole, dark brown wood (Flash shows the far one faintly lit)
    hs = [roof_q(1, u0, y0, -0.3), roof_q(1, u1, y0, -0.3), roof_q(1, u1, y1, -0.3), roof_q(1, u0, y1, -0.3)]
    low = [p - n * 1.4 for p in hs]
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in hs + low]
    for f in ((7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("hshaft", bm, [M["shaft"]], smooth=False)
    if LOOK == 3:
        # the board: a plank lying on the lower sill, its far end out over the slates
        slope_box("hboard", 1, u1 - 0.3, u1 + 0.85, y0 - 0.05, y1 + 0.3, h1, h1 + 0.12, M["arm"], bevel=0.04)
    if LOOK >= 4:
        # the spoon's tip: a curved wooden bar arching over the lower sill, its far end bent down onto the slates
        pts = []
        for i in range(13):
            t = i / 12
            pts.append(roof_q(1, u1 - 0.05 + 0.25 * t, y0 - 0.15 + (y1 - y0 + 0.75) * t,
                              h1 + 0.1 + 0.55 * math.sin(math.pi * min(1.0, t * 1.15))))
        sweep("spoon", pts, n, 0.26, 0.2, M["arm"], bevel=0.05)


