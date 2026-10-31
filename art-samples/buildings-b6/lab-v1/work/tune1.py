import sys
from pathlib import Path
D = Path(sys.argv[1])
s = (D / "lab.py").read_text(encoding="utf8")
rep = [
("PL_C, PL_H, PL_Z = (-0.7, 0.7), 1.3, 10.05  # the plinth under the big bell: middle, half side, top",
 "PL_C, PL_H, PL_Z = (-0.7, 0.7), 1.3, 9.84   # the plinth board under the big bell: middle, half side, top"),
("PIPE_A, PIPE_B, PIPE_Z = (-4.3, 1.9), (-6.75, 1.0), 7.55   # the glass pipe: out of the flank, its bend, height",
 "PIPE_F, PIPE_Z, PIPE_OUT = 0.55, 7.7, 1.25   # the glass pipe: how far along the upper left face, height, reach"),
('''    M["plinth"] = wood("plinth", (188, 140, 84), (140, 98, 58), dirt=0.2)''',
 '''    M["plinth"] = wood("plinth", (178, 130, 78), (160, 114, 66), rings=3.0, dirt=0.3, knots=False)'''),
('''    M["gold"] = shiny("gold", (204, 128, 36),''', '''    M["gold"] = shiny("gold", (232, 162, 46),'''),
('''    M["chrome"] = shiny("chrome", (184, 196, 190), rough=0.24, metal=0.9, wear=(140, 152, 148), scale=3, dirt=0.2,
                        side=0.45)''', '''    # Flash's chrome is mottled: blue-grey with darker patches and white glints, not a clean mirror
    M["chrome"] = shiny("chrome", (176, 190, 196), rough=0.26, metal=0.85, wear=(104, 118, 132), scale=7, dirt=0.2,
                        side=0.5, streak=0.4)'''),
('''    M["glass"] = shiny("glass", (96, 222, 214), rough=0.12, metal=0.05, wear=(150, 250, 240), scale=1.5, dirt=0.0,
                       coat=0.7, side=0.45)''', '''    M["glass"] = glass_mat()'''),
('''DOME_MAP = []''', '''def glass_mat():
    """The pipes' clear cyan glass: the wall shows dark through the middle, the edges glow bright cyan (Flash)."""
    t = NT("glass")
    rim = t.n("ShaderNodeLayerWeight")
    rim.inputs["Blend"].default_value = 0.4
    edge = t.ramp(rim.outputs["Facing"], [(0.25, (0, 0, 0, 1)), (0.85, (1, 1, 1, 1))])
    col = t.mix(srgb(70, 190, 186), srgb(150, 250, 240), edge)
    t.set(**{"Base Color": col, "rough": 0.12, "metal": 0.0, "spec": 0.6, "Transmission Weight": 0.65, "IOR": 1.15})
    t.set(**{"Emission Color": srgb(110, 236, 226)})
    em = t.n("ShaderNodeMath", operation="MULTIPLY")
    t.link(edge, em.inputs[0])
    em.inputs[1].default_value = 0.6
    t.set(**{"Emission Strength": em.outputs[0]})
    return t.m


DOME_MAP = []'''),
('''        prof = [(0.0, 0.0), (0.46, 0.0), (0.46, 0.14)]
        for j in range(12):
            z0 = 0.16 + j * 0.34
            prof += [(0.32, z0), (0.52, z0 + 0.12), (0.5, z0 + 0.2), (0.32, z0 + 0.34)]''',
 '''        prof = [(0.0, 0.0), (0.42, 0.0), (0.42, 0.12)]
        for j in range(7):                          # Flash's columns: a stack of sharp double cones
            z0 = 0.14 + j * 0.58
            prof += [(0.26, z0), (0.6, z0 + 0.27), (0.6, z0 + 0.31), (0.26, z0 + 0.58)]'''),
('''    box("ldoor", (1.5, 0.12, 2.4), (mid.x + n.x * 0.05, mid.y + n.y * 0.05, 0.9), M["grate"],''',
 '''    box("ldoor", (1.2, 0.12, 3.3), (mid.x + n.x * 0.05, mid.y + n.y * 0.05, 0.4), M["grate"],'''),
('''        z = 1.2 + j * 0.42''', '''        z = 0.8 + j * 0.6'''),
('''        s = 0.3 if j % 2 else -0.3
        p = mid + t * s + n * 0.12
        box(f"ldoorrib{j}", (0.72, 0.08, 0.12)''', '''        s = 0.22 if j % 2 else -0.22
        p = mid + t * s + n * 0.12
        box(f"ldoorrib{j}", (0.6, 0.08, 0.12)'''),
('''    # the glass pipes: out of the flank, a bend, down to a blue flange on the lower deck
    for k, mirrored in enumerate((False, True)):
        f = mir if mirrored else (lambda p: p)
        a = Vector(f(uv(*PIPE_A)) + (PIPE_Z,))
        b = Vector(f(uv(*PIPE_B)) + (PIPE_Z,))
        c = Vector(f(uv(*PIPE_B)) + (LD_Z1,))
        r = 0.62
        d = (b - a).normalized()
        pts = [a, b - d * 0.9, b - d * 0.26 + Vector((0, 0, -0.26)), b + Vector((0, 0, -0.9)), c]
        tube(f"pipe{k}", [tuple(p) for p in pts], r, M["glass"], verts=16, smooth=True)
        cyl(f"pipeflange{k}", 0.86, 0.18, tuple(c), M["flange"], verts=28)
        ob = cyl(f"pipecollar{k}", 0.72, 0.24, tuple(a - d * 0.12), M["flange"], verts=24)
        ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()''',
 '''    # the glass pipes: straight out of the upper side faces, a quarter bend down to a blue flange on the lower deck
    for k, (i, j) in enumerate(((0, 1), (6, 7))):
        a2, b2, t, n, _ = face(out[i], out[j])
        w = a2.lerp(b2, PIPE_F if k == 0 else 1 - PIPE_F)
        a = Vector((w.x, w.y, PIPE_Z))
        n3 = Vector((n.x, n.y, 0.0))
        r = 0.48
        drop = PIPE_Z - LD_Z1
        pts = [a, a + n3 * 0.35, a + n3 * (PIPE_OUT * 0.75) + Vector((0, 0, -0.15)),
               a + n3 * PIPE_OUT + Vector((0, 0, -drop * 0.45)), a + n3 * PIPE_OUT + Vector((0, 0, -drop + 0.12))]
        tube(f"pipe{k}", [tuple(p) for p in pts], r, M["glass"], verts=16, smooth=True)
        c = a + n3 * PIPE_OUT
        cyl(f"pipeflange{k}", 0.7, 0.16, (c.x, c.y, LD_Z1), M["flange"], verts=28)
        ob = cyl(f"pipecollar{k}", 0.6, 0.1, tuple(a + n3 * 0.02), M["flange"], verts=24)
        ob.rotation_euler = n3.to_track_quat("Z", "Y").to_euler()'''),
('''BIG_BELL = [(0.0, 0.0), (1.25, 0.0), (1.28, 0.16), (1.18, 0.32), (0.92, 0.4), (0.84, 0.55), (0.86, 1.4), (0.84, 2.5),
            (0.78, 2.78), (0.56, 3.0), (0.48, 3.15), (0.5, 3.35), (0.0, 3.4)]
SMALL_BELL = [(0.0, 0.0), (1.05, 0.0), (1.08, 0.14), (0.98, 0.26), (0.84, 0.32), (0.86, 0.8), (0.84, 1.25),
              (0.72, 1.6), (0.5, 1.82), (0.3, 1.92), (0.32, 2.02), (0.0, 2.06)]''',
 '''BIG_BELL = [(0.0, 0.0), (1.25, 0.0), (1.28, 0.14), (1.2, 0.3), (0.98, 0.36), (0.9, 0.42), (0.84, 0.5), (0.82, 2.0),
            (0.87, 2.08), (0.84, 2.18), (0.7, 2.4), (0.5, 2.6), (0.42, 2.75), (0.44, 2.9), (0.0, 2.92)]
SMALL_BELL = [(0.0, 0.0), (1.0, 0.0), (1.04, 0.12), (0.96, 0.26), (0.8, 0.32), (0.78, 0.5), (0.8, 1.25), (0.74, 1.5),
              (0.58, 1.72), (0.36, 1.84), (0.24, 1.9), (0.26, 2.0), (0.0, 2.02)]
BIG_COIL, SMALL_COIL = 1.85, 0.6            # the coils' heights on top of the bells'''),
('''    big = bell("bellC", (PL_C[0], PL_C[1], PL_Z), BIG_BELL, 0.42, 5, 1.75)''',
 '''    big = bell("bellC", (PL_C[0], PL_C[1], PL_Z), BIG_BELL, 0.42, 4.5, BIG_COIL)'''),
("SMALL_BELL, 0.24, 2.5, 0.6)", "SMALL_BELL, 0.24, 2.5, SMALL_COIL)"),
('''    # the recess between the columns: dark panels, brass strips, the grey door in the middle''',
 '''    # a gold beam under the deck's front edge from column to column
    ca, cb = Vector(uv(*COIL_UV)), Vector(uv(-COIL_UV[0], COIL_UV[1]))
    _, _, tb, nb, angb = face(ca, cb)
    p = (ca + cb) / 2
    box("lbeam", ((cb - ca).length, 0.34, 0.42), (p.x, p.y, LW_Z - 0.42), M["gold"], rot=(0, 0, angb), bevel=0.04)
    # the recess between the columns: dark panels, brass strips, the grey door in the middle'''),
('("lband", "lwall"),', '("lband", "lwall"), ("lbeam", "coil"),'),
]
for a, b in rep:
    assert a in s, a[:70]
    s = s.replace(a, b)
(D / "lab.py").write_text(s, encoding="utf8")
d = (D / "damage/labdmg.py").read_text(encoding="utf8")
a = '''    top = {"bellC": 3.4 + 1.75 + 0.05, "bellL": 2.06 + 0.6 + 0.05, "bellR": 2.06 + 0.6 + 0.05}'''
assert a in d
d = d.replace(a, '''    big, small = G["BIG_BELL"][-1][1] + G["BIG_COIL"] + 0.05, G["SMALL_BELL"][-1][1] + G["SMALL_COIL"] + 0.05
    top = {"bellC": big, "bellL": small, "bellR": small}''')
d = d.replace('LOWER = ("lwall", "lpost", "lskirt", "lband",', 'LOWER = ("lwall", "lpost", "lskirt", "lband", "lbeam",')
(D / "damage/labdmg.py").write_text(d, encoding="utf8")
print("ok")
