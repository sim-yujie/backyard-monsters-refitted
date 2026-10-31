s = open('flinger.py', encoding='utf8').read()
old = s[s.index('def hatch_box():'):s.index('def roof(y0, y1):')]
s = s.replace(old, '')
old = s[s.index('def hatch():'):s.index('def drum():')]
s = s.replace(old, open('work/hatch_new.py', encoding='utf8').read())
rep = (
    # slates: saturated blue-lavender, glossy, a softer painted rim (the bevels catch the light)
    ('''    col = t.mix(col, srgb(226, 232, 250), t.mix(rim, (0, 0, 0, 1), 0.35), "MIX")''',
     '''    col = t.mix(col, srgb(206, 214, 246), t.mix(rim, (0, 0, 0, 1), 0.6), "MIX")'''),
    ('''    M["slate"] = slate("slate", [(168, 176, 226), (150, 166, 214), (186, 180, 228), (140, 156, 206), (176, 190, 232),
                                 (160, 160, 214)])''',
     '''    M["slate"] = slate("slate", [(146, 158, 214), (128, 146, 204), (162, 160, 216), (150, 168, 222), (172, 176, 228),
                                 (136, 150, 210)], rough=0.34)
    M["frame"] = wood("frame", (124, 100, 66), (82, 66, 42), axis="Y", dirt=0.2, rings=3.0)
    M["shaft"] = wood("shaft", (58, 50, 42), (30, 26, 22), axis="Z", dirt=0.0, rings=3.0)'''),
    ('''    return mesh_ob(name, bm, [mat], bevel=0.045, segs=2)''', '''    return mesh_ob(name, bm, [mat], bevel=0.075, segs=3)'''),
    ('''    M["ball"] = dimpled("ball", (226, 224, 234), (176, 174, 190))''',
     '''    M["ball"] = dimpled("ball", (206, 204, 216), (150, 148, 166))'''),
    # pulleys and the wheel: thicker gold rims and spokes
    ('''        ring(f"{name}rim{side}", r, 0.06, mat_rim, parent=e, z=side * wide / 2)''',
     '''        ring(f"{name}rim{side}", r, S.RIM_W * (1.3 if r > 1 else 1.0), mat_rim, parent=e, z=side * wide / 2)'''),
    ('''        tube(f"{name}spoke{k}", [(0, 0, 0), p], 0.045, M["gold"], parent=e)''',
     '''        tube(f"{name}spoke{k}", [(0, 0, 0), p], S.SPOKE_W * (1.3 if r > 1 else 1.0), M["gold"], parent=e)'''),
    ('''    cyl(f"{name}hub", 0.13, wide + 0.06''', '''    cyl(f"{name}hub", 0.17 if r < 1 else 0.24, wide + 0.06'''),
    # the pot: black inside, the arm meets it under the rim
    ('''    lathe("bucket", [(br * 0.86, -bh), (br * 0.98, -bh * 0.5), (br, -0.02), (br * 0.94, -0.02),
                     (br * 0.92, -bh + 0.1)], bc, M["pot"], verts=40)''',
     '''    lathe("bucket", [(br * 0.8, -bh), (br * 0.94, -bh * 0.75), (br * 0.99, -bh * 0.4), (br, -0.02)], bc, M["pot"],
          verts=48)
    lathe("bucketwall", [(br * 0.95, -0.02), (br * 0.93, -bh * 0.6)], bc, M["potin"], verts=48)'''),
    ('''        for nm in ("bucket", "bucketrim", "bucketin"):''', '''        for nm in ("bucket", "bucketwall", "bucketrim", "bucketin"):'''),
    ('''    a1 = bc + (Vector((hub.x, hub.y, bc.z)) - bc).normalized() * (br + 0.02) - Vector((0, 0, bh * 0.35))''',
     '''    a1 = bc + (Vector((hub.x, hub.y, bc.z)) - bc).normalized() * (br * 0.97) - Vector((0, 0, S.ARM_DROP))'''),
    ('''    s0 = Vector(S.SPRING_C)
    top = a0 + (a1 - a0) * S.SPRING_T''', '''    s0 = Vector(S.SPRING_C)
    dxy = Vector((a1.x - a0.x, a1.y - a0.y, 0))
    k = max(0.0, min(1.0, Vector((s0.x - a0.x, s0.y - a0.y, 0)).dot(dxy) / dxy.length_squared))
    top = a0 + (a1 - a0) * k          # the arm right above the springs' foot'''),
    ('''        tube("pipe", [f + Vector((0, 0, 0.1)), f + Vector((0, 0, 0.6)), s0 + Vector((0, 0, -0.5)), s0],
             0.6, M["pipe"], verts=32, smooth=True)''',
     '''        tube("pipe", [f + Vector((0, 0, 0.1)), s0 - Vector((0, 0, 0.1))], 0.6, M["pipe"], verts=32)'''),
)
for a, b in rep:
    assert a in s, a[:70]
    s = s.replace(a, b)
open('flinger.py', 'w', encoding='utf8').write(s)
s = open('stack.py', encoding='utf8').read()
for a, b in (("HATCH = (0.6, 2.3, 0.2, 2.1)", "HATCH = (0.35, 2.6, 0.45, 1.65)"),
             ("SPRING_C = (3.25, -0.84, 1.82)      # the springs' foot (on the pipe's top in looks 3, 4)",
              "SPRING_C = (3.27, -0.01, 2.3)       # the springs' foot (on the pipe's top in looks 3, 4)"),
             ("SPRING_T = 0.25                     # where they meet the arm (0 the hub, 1 the bucket)\n", ""),
             ("POT_ARM_R = 0.3", "POT_ARM_R = 0.26\nARM_DROP = 0.3                      # the arm meets the bucket this far under the rim"),
             ("BELT_T = 0.1", "BELT_T = 0.1\nRIM_W, SPOKE_W = 0.085, 0.06        # the pulleys' gold rims and spokes (the wheel's: 1.3 times)"),
             ("PIPE_FOOT = (3.53, 0.79, 0.0)", "PIPE_FOOT = (3.57, 0.83, 0.0)")):
    assert a in s, a
    s = s.replace(a, b)
open('stack.py', 'w', encoding='utf8').write(s)
