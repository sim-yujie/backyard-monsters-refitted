"""patch7: look 1's A-frame in the plane y = A1_Y with a windlass carrying the coil; lighter posts; springs moved."""
p = 'flinger.py'
s = open(p, encoding='utf-8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)


a = s.index("def px_d(")
b = s.index("def belt1(")
s = s[:a] + '''def aframe():
    """Look 1: the A-frame over the open frame: two legs to an apex with a steel cap, a little slate roof and the gold
    pulley on top; between the legs a windlass with the rope coil; the rope from the ball over the pulley onto it."""
    y = S.A1_Y
    apex = Vector((S.A1_APEX[0], y, S.A1_APEX[1]))
    w = S.A1_W
    legs = []
    for i, fx in enumerate(S.A1_FEET):
        f = Vector((fx, y, 0.0))
        beam(f"aleg{i}", f, apex + (apex - f).normalized() * 0.2, w, w, M["post"])
        legs.append((f, apex - f))
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
    # the windlass: a round wooden axle along X through both legs, a knob past the left leg, the coil on it
    z = S.WINDLASS_Z
    xl = [f.x + d.x * (z / d.z) for f, d in legs]
    cyl("waxle", S.AXLE1_R, xl[1] - xl[0] + 0.9, Vector((xl[0] - 0.6, y, z)), M["drum"], rot=(0, 90, 0), verts=16)
    sphere("wknob", 0.26, Vector((xl[0] - 0.65, y, z)), M["drum"], n=16)
    c0, c1, cr = S.COIL
    m = 9 * 24
    for k, rr in enumerate((cr, cr - 0.2, cr - 0.37)):
        pts = [Vector((c0 + (c1 - c0) * i / m, y + rr * math.cos(i * 2 * math.pi / 24 + k),
                       z + rr * math.sin(i * 2 * math.pi / 24 + k))) for i in range(m + 1)]
        tube(f"coil{k}", pts, 0.13 if k == 0 else 0.12, M["rope"], verts=10)
    return pc, Vector(((c0 + c1) / 2, y, z)), cr


''' + s[b:]

rep('''def belt1(pc, cc, cr, ax, b):''', '''def belt1(pc, cc, cr, b):''')
rep('''    face = (Vector((1, -1, 0)) - ax * Vector((1, -1, 0)).dot(ax)).normalized()
    end = cc + ax * 0.6 + face * (cr + 0.12)''', '''    end = cc + Vector((0.3, -cr - 0.12, 0.1))         # onto the coil's front, toward the camera''')
rep('''        s0.z = S.SPRING_BLOCK_H''', '''        s0.z = S.SPRING_BLOCK_H
        s0.y = S.SPRING12_Y''')
rep('''    M["post"] = wood("post", (130, 110, 78), (84, 72, 46), axis="Z", dirt=0.3, rings=4.0)''',
    '''    M["post"] = wood("post", (150, 126, 88), (96, 82, 54), axis="Z", dirt=0.3, rings=4.0)''')
rep('''("afork", "gold"), ("coil", "coil"),''', '''("afork", "gold"), ("coil", "coil"), ("waxle", "coil"), ("wknob", "coil"),''')
open(p, 'w', encoding='utf-8').write(s)

p = 'stack.py'
s = open(p, encoding='utf-8').read()
rep("SPRING_BLOCK_H = 1.0 ", "SPRING12_Y = -0.35                  # looks 1, 2: the first spring's y (clear of look 1's A-frame)\nSPRING_BLOCK_H = 1.0 ")
open(p, 'w', encoding='utf-8').write(s)
print("ok")
