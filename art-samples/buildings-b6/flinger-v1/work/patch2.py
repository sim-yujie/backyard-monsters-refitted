s = open('stack.py', encoding='utf8').read()
for a, b in (("HUB = (2.85, -1.85, 2.76)", "HUB = (2.85, -1.57, 2.53)"),
             ("DRUM_C = (-0.35, -1.55, 2.55)", "DRUM_C = (-1.2, -1.55, 2.4)"),
             ("WHEEL_SCR = (35.0, -47.0)", "WHEEL_SCR = (35.0, -44.0)"),
             ("TILE = (0.8, 0.9, 0.1, 0.62)", "TILE = (0.95, 1.05, 0.16, 0.74)"),
             ("TILE_TILT = 6.0", "TILE_TILT = 9.0")):
    assert a in s, a
    s = s.replace(a, b)
open('stack.py', 'w', encoding='utf8').write(s)
s = open('flinger.py', encoding='utf8').read()
for a, b in (('''    sphere("ball", S.BALL_R, c - Vector((0, 0, S.BALL_R)), M["ball"], n=32)''',
              '''    sphere("ball", S.BALL_R, c, M["ball"], n=32)'''),
             ('''    cyl("bucketin", br * 0.92, 0.02, bc - Vector((0, 0, bh * 0.6)), M["potin"], verts=40, bevel=0.0)
''', '''    cyl("bucketin", br * 0.92, 0.02, bc - Vector((0, 0, bh * 0.6)), M["potin"], verts=40, bevel=0.0)
    if big:                 # Flash's pot is tipped toward the viewer (its mouth shows rounder than the bucket's)
        bpy.context.view_layer.update()
        rot = Matrix.Translation(bc) @ Matrix.Rotation(math.radians(S.POT_TIP), 4, Vector((1, 1, 0)).normalized()) \
            @ Matrix.Translation(-bc)
        for nm in ("bucket", "bucketrim", "bucketin"):
            ob = bpy.data.objects[nm]
            ob.matrix_world = rot @ ob.matrix_world
'''),):
    assert a in s, a
    s = s.replace(a, b)
open('flinger.py', 'w', encoding='utf8').write(s)
