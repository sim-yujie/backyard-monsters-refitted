s = open('stack.py', encoding='utf8').read()
for a, b in (("HATCH = (0.35, 2.6, 0.45, 1.65)", "HATCH = (0.6, 2.8, 0.55, 2.3)"),
             ("DRUM_C = (-1.2, -1.55, 2.4)", "DRUM_C = (-0.6, -1.55, 2.4)"),
             ("POT_TIP = 12.0", "POT_TIP = 16.0"),
             ("SPRING_C = (3.27, -0.01, 2.3) ", "SPRING_C = (3.27, -0.01, 1.85)")):
    assert a in s, a
    s = s.replace(a, b)
open('stack.py', 'w', encoding='utf8').write(s)
s = open('flinger.py', encoding='utf8').read()
rep = (
    ('''    box("header", (2 * ax + 0.1, 0.36, 0.34), (0, -B + 0.2, z1), M["postx"], bevel=0.05)
''', '''    box("header", (2 * ax + 0.1, 0.2, 0.22), (0, -B + 0.16, z1), M["postx"], bevel=0.04)
'''),
    ('''        tube("wcrank", [w + n * 0.2, w + n * 0.35 - e1 * 0.3 - e2 * 0.35, w + n * 0.35 + e1 * 0.25 - e2 * 0.6],
             0.06, M["gold"], smooth=True)''',
     '''        tube("wcrank", [w + n * 0.15, w + n * 0.3 - e1 * 0.35 - e2 * 0.15, w + n * 0.35 - e1 * 0.3 - e2 * 0.7,
                        w + n * 0.35 + e1 * 0.05 - e2 * 0.85, w + n * 0.35 + e1 * 0.3 - e2 * 0.5],
             0.085, M["gold"], smooth=True)'''),
    ('''    M["spring"] = shiny("spring", (96, 112, 128), rough=0.35, metal=0.8, wear=(60, 70, 80), scale=3.0, dirt=0.1)''',
     '''    M["spring"] = shiny("spring", (60, 66, 74), rough=0.38, metal=0.8, wear=(36, 40, 46), scale=3.0, dirt=0.1)'''),
    ('''        pts = [b0 + Vector((0.22 * math.cos(i * 0.4), 0.22 * math.sin(i * 0.4), h * i / 90)) for i in range(91)]
        tube(f"spring{k}", pts, 0.045, M["spring"], verts=8)''',
     '''        rs = 0.3 if LOOK >= 3 else 0.22
        pts = [b0 + Vector((rs * math.cos(i * 0.4), rs * math.sin(i * 0.4), h * i / 110)) for i in range(111)]
        tube(f"spring{k}", pts, 0.06, M["spring"], verts=8)'''),
)
for a, b in rep:
    assert a in s, a[:70]
    s = s.replace(a, b)
open('flinger.py', 'w', encoding='utf8').write(s)
