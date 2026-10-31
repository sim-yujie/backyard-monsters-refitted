s = open('stack.py', encoding='utf8').read()
for a, b in (("POT_R, POT_H = 1.9, 1.55", "POT_R, POT_H = 1.9, 2.0"),
             ("OPEN = (-1.75, 1.65, 0.6, 3.9)", "OPEN = (-1.75, 1.65, 0.6, 4.3)"),
             ("PUL1_SCR = (-28.0, -22.0)", "PUL1_SCR = (-30.0, -22.0)")):
    assert a in s, a
    s = s.replace(a, b)
open('stack.py', 'w', encoding='utf8').write(s)
s = open('flinger.py', encoding='utf8').read()
for a, b in (('''        pts += arc(w, S.WHEEL_R + 0.03, 200, -40, 14)
        pts.append(w + e1 * 1.2 - e2 * 2.6)
        pts.append(w + e1 * 1.0 - e2 * 4.2)''', '''        pts += arc(w, S.WHEEL_R + 0.22, 205, -25, 16)
        pts.append(w + e1 * 1.05 - e2 * 2.4)
        pts.append(w + e1 * 0.45 - e2 * 4.2)'''),
             ('''        cyl("pipeflange", 0.7, 0.16, f, M["pipe"], verts=32, bevel=0.04)
        tube("pipe", [f + Vector((0, 0, 0.1)), f + Vector((0, 0, 0.6)), s0 + Vector((0, 0, -0.5)), s0],
             0.42, M["pipe"], verts=24, smooth=True)
        cyl("pipecap", 0.48, 0.12, s0 - Vector((0, 0, 0.1)), M["pipe"], verts=24, bevel=0.03)''',
              '''        cyl("pipeflange", 1.0, 0.2, f, M["pipe"], verts=40, bevel=0.05)
        tube("pipe", [f + Vector((0, 0, 0.1)), f + Vector((0, 0, 0.6)), s0 + Vector((0, 0, -0.5)), s0],
             0.6, M["pipe"], verts=32, smooth=True)
        cyl("pipecap", 0.66, 0.14, s0 - Vector((0, 0, 0.1)), M["pipe"], verts=32, bevel=0.04)'''),):
    assert a in s, a
    s = s.replace(a, b)
open('flinger.py', 'w', encoding='utf8').write(s)
