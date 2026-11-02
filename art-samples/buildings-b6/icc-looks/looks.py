# looks.py : the three Inferno looks (materials and extra parts), run inside icc.py (exec) just before build().
# ---------------------------------------------------------------------------------------------- the Inferno looks
def fmath(t, op, a, b=None):
    m = t.n("ShaderNodeMath", operation=op)
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            m.inputs[i].default_value = x
        else:
            t.link(x, m.inputs[i])
    return m.outputs[0]


def rock(name, col, var, crack=None, crack_scale=1.6, crack_w=0.05, glow=7.0, scale=1.6, rough=0.88, metal=0.0,
         bump=0.45, crack_cover=0.45, half=None):
    """Basalt: dark charred stone, blotchy, with a lumpy bump; crack: glowing magma lines (wiggly voronoi edges) over
    part of it. half: (steel colour, steel wear): steel on the screen-left half, stone on the right, a ragged seam."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    n1 = t.noise(v, scale, 6.0, 0.62, 0.3)
    out = t.mix(srgb(*col), srgb(*var), t.ramp(n1, [(0.38, (0, 0, 0, 1)), (0.72, (1, 1, 1, 1))]))
    hfine = t.noise(v, scale * 5, 8.0, 0.7)
    mask = None
    if crack:
        nz = t.n("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 2.5
        t.link(v, nz.inputs["Vector"])
        warp = t.n("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        t.link(nz.outputs["Color"], warp.inputs[0])
        warp.inputs[1].default_value = (0.5, 0.5, 0.5)
        t.link(v, warp.inputs[2])
        vor = t.n("ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE")
        vor.inputs["Scale"].default_value = crack_scale
        t.link(warp.outputs[0], vor.inputs["Vector"])
        edge = t.n("ShaderNodeMapRange")
        edge.inputs[1].default_value, edge.inputs[2].default_value = crack_w, 0.0
        t.link(vor.outputs["Distance"], edge.inputs[0])
        cover = t.ramp(t.noise(v, 0.9, 2.0, 0.5), [(1 - crack_cover - 0.08, (0, 0, 0, 1)),
                                                     (1 - crack_cover + 0.08, (1, 1, 1, 1))])
        mask = fmath(t, "MULTIPLY", edge.outputs[0], cover)
    if half:
        geo = t.n("ShaderNodeNewGeometry")
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dp.inputs[0])
        dp.inputs[1].default_value = (0.707, 0.707, 0.0)
        jag = fmath(t, "MULTIPLY_ADD", t.noise(v, 1.3, 4.0, 0.6), 2.4)
        jag.node.inputs[2].default_value = -1.2
        s = fmath(t, "ADD", dp.outputs["Value"], jag)
        sr = t.n("ShaderNodeMapRange")
        sr.inputs[1].default_value, sr.inputs[2].default_value = -0.08, 0.08
        t.link(s, sr.inputs[0])
        fac = sr.outputs[0]                    # 1 = stone, 0 = steel
        steel = t.mix(srgb(*half[0]), srgb(*half[1]), t.ramp(t.noise(v, 2.5, 3.0, 0.5),
                                                              [(0.45, (0, 0, 0, 1)), (0.75, (0.6, 0.6, 0.6, 1))]))
        out = t.mix(steel, out, fac)
        mr = t.n("ShaderNodeMapRange")
        mr.inputs[3].default_value, mr.inputs[4].default_value = 0.85, metal
        t.link(fac, mr.inputs[0])
        t.set(metal=mr.outputs[0])
        rr = t.n("ShaderNodeMapRange")
        rr.inputs[3].default_value, rr.inputs[4].default_value = 0.38, rough
        t.link(fac, rr.inputs[0])
        t.set(rough=rr.outputs[0])
        if mask is not None:
            mask = fmath(t, "MULTIPLY", mask, fac)
        hfine = fmath(t, "MULTIPLY", hfine, fac)
    else:
        t.set(rough=rough, metal=metal)
    if mask is not None:
        out = t.mix(out, srgb(*crack), mask)
        t.set(**{"Emission Color": srgb(*crack), "Emission Strength": fmath(t, "MULTIPLY", mask, glow)})
        hfine = fmath(t, "SUBTRACT", hfine, fmath(t, "MULTIPLY", mask, 0.8))
    out = t.grime(out, GROUND, 3.0, 0.3, 0.45)
    t.set(**{"Base Color": out, "spec": 0.35})
    t.bump(hfine, bump, 0.05)
    MATS[name] = t.m
    return t.m


def magma(name, hot=(255, 104, 16), core=(255, 196, 70), crust=(34, 22, 18), strength=9.0, crust_at=None, scale=1.2):
    """Glowing lava: orange with yellow-hot streaks; crust_at: dark cooled crust islands over part of it."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    n2 = t.noise(v, scale * 2.5, 4.0, 0.55, 1.5)
    heat = t.mix(srgb(*hot), srgb(*core), t.ramp(n2, [(0.45, (0, 0, 0, 1)), (0.72, (1, 1, 1, 1))]))
    em = fmath(t, "ADD", fmath(t, "MULTIPLY", n2, strength * 0.8), strength * 0.6)
    col = heat
    if crust_at is not None:
        n1 = t.noise(v, scale, 6.0, 0.62, 0.4)
        cm = t.ramp(n1, [(crust_at - 0.04, (0, 0, 0, 1)), (crust_at + 0.04, (1, 1, 1, 1))])
        col = t.mix(heat, srgb(*crust), cm)
        em = fmath(t, "MULTIPLY", em, fmath(t, "SUBTRACT", 1.0, cm))
        t.bump(cm, 0.6, 0.06)
        t.set(rough=t.ramp(n1, [(crust_at - 0.04, (0.25, 0.25, 0.25, 1)), (crust_at + 0.04, (0.9, 0.9, 0.9, 1))]))
    else:
        t.set(rough=0.3)
    t.set(**{"Base Color": col, "Emission Color": heat, "Emission Strength": em})
    MATS[name] = t.m
    return t.m


def bone(name, col=(230, 214, 176), tip=(74, 60, 50), z0=None, z1=None):
    """Ivory bone and horn: faint ridges and mottle, charred toward the tip (world height z0..z1)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    out = t.mix(srgb(*col), srgb(184, 160, 120), t.ramp(t.noise(v, 3.0, 4.0, 0.55), [(0.4, (0, 0, 0, 1)),
                                                                                      (0.75, (0.7, 0.7, 0.7, 1))]))
    if z0 is not None:
        geo = t.n("ShaderNodeNewGeometry")
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Position"], sep.inputs[0])
        mr = t.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = z0, z1
        t.link(sep.outputs["Z"], mr.inputs[0])
        out = t.mix(out, srgb(*tip), t.ramp(mr.outputs[0], [(0.55, (0, 0, 0, 1)), (1.0, (1, 1, 1, 1))]))
    out = t.grime(out, GROUND, 3.0, 0.2, 0.5)
    t.set(**{"Base Color": out, "rough": 0.45, "spec": 0.45, "coat": 0.25})
    wave = t.n("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 6.0
    wave.inputs["Distortion"].default_value = 2.0
    t.link(v, wave.inputs["Vector"])
    t.bump(wave.outputs["Fac"], 0.12, 0.02)
    MATS[name] = t.m
    return t.m


def hot(name, col=(255, 112, 24), strength=7.0):
    return flat(name, col, rough=0.4, emit=strength)


# the crystal's glow: every emitter of the crystal (shell, core, light) is scaled together by one number (1 = peak);
# icc.py's anim mode renders the crystal's share of the light alone and scales it per frame
CRYSTAL_E = dict(shell=0.78, core=3.5, light=140.0)


def crystal_mat(name):
    """A cut magma crystal that glows from within. Each facet's glow depends on how it faces a key direction (from the
    upper left front, between the sun and the viewer), so the cut reads as clean facets even at game size: facets
    toward the key hot orange, the others red to deep red, the faces turned away from the viewer darkest. The fine
    chamfers on the edges catch the key as bright lines. Partly clear red glass (the hot heart shows through, darker
    red the thicker it is), with a glossy coat that catches the sun."""
    t = NT(name)
    geo = t.n("ShaderNodeNewGeometry")
    dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(geo.outputs["Normal"], dp.inputs[0])
    dp.inputs[1].default_value = Vector((-0.25, -1.0, 1.25)).normalized()
    key = t.n("ShaderNodeMapRange")
    key.inputs[1].default_value, key.inputs[2].default_value = -0.3, 1.0
    t.link(dp.outputs["Value"], key.inputs[0])
    lw = t.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    face = t.sock(lw, "Facing", out=True)
    # the heart: faces toward the viewer hottest; plus the key, so neighbouring facets differ
    v = fmath(t, "ADD", fmath(t, "MULTIPLY", fmath(t, "SUBTRACT", 1.0, face), 0.6),
              fmath(t, "MULTIPLY", key.outputs[0], 0.4))
    vr = t.n("ShaderNodeMapRange")
    vr.inputs[1].default_value, vr.inputs[2].default_value = 0.35, 0.95
    t.link(v, vr.inputs[0])
    glow = t.ramp(vr.outputs[0], [(0.0, srgb(70, 6, 3)), (0.3, srgb(140, 14, 5)), (0.55, srgb(196, 30, 8)),
                                  (0.75, srgb(232, 62, 14)), (0.9, srgb(250, 110, 28)), (1.0, srgb(255, 160, 64))])
    # the hot heart, seen through the stone: brightest down the middle of the crystal (as the viewer sees it) and
    # in its lower middle, fading to the edges and toward the point and the foot
    tc = t.n("ShaderNodeTexCoord")
    lat = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(tc.outputs["Object"], lat.inputs[0])
    lat.inputs[1].default_value = (0.7071, 0.7071, 0.0)          # the screen's left-right, in the crystal's frame
    mid = t.n("ShaderNodeMapRange")
    mid.inputs[1].default_value, mid.inputs[2].default_value = 0.04, 0.56
    mid.inputs[3].default_value, mid.inputs[4].default_value = 1.0, 0.0
    t.link(fmath(t, "ABSOLUTE", lat.outputs["Value"]), mid.inputs[0])
    sz = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Object"], sz.inputs[0])
    hz = t.ramp(fmath(t, "DIVIDE", sz.outputs["Z"], 4.9), [(0.1, (0.25, 0.25, 0.25, 1)), (0.3, (1, 1, 1, 1)),
                                                           (0.62, (1, 1, 1, 1)), (0.95, (0.3, 0.3, 0.3, 1))])
    heart = fmath(t, "MULTIPLY", fmath(t, "MULTIPLY", mid.outputs[0], mid.outputs[0]), fmath(t, "MULTIPLY", hz, 0.8))
    hot = t.n("ShaderNodeMix", data_type="RGBA", blend_type="ADD")
    t.link(heart, hot.inputs[0])
    t.link(glow, t.sock(hot, "A", "RGBA"))
    t.sock(hot, "B", "RGBA").default_value = srgb(255, 150, 54)
    glow = t.sock(hot, "Result", "RGBA", out=True)
    t.set(**{"Base Color": srgb(110, 8, 4), "rough": 0.12, "coat": 0.4, "IOR": 1.62, "spec": 0.2,
             "Transmission Weight": 0.25, "Emission Color": glow, "Emission Strength": CRYSTAL_E["shell"]})
    t.bsdf.inputs["Coat Roughness"].default_value = 0.08
    t.bsdf.inputs["Coat Tint"].default_value = srgb(255, 200, 180)
    ab = t.n("ShaderNodeVolumeAbsorption")
    ab.inputs["Color"].default_value = srgb(255, 54, 34)
    ab.inputs["Density"].default_value = 2.2
    t.link(ab.outputs[0], t.out.inputs["Volume"])
    MATS[name] = t.m
    return t.m


def core_mat(name):
    """The crystal's hot heart: seen through the red glass, yellow-orange like the Magma Tower's molten core."""
    t = NT(name)
    t.set(**{"Base Color": srgb(0, 0, 0), "rough": 0.5, "Emission Color": srgb(255, 150, 52),
             "Emission Strength": CRYSTAL_E["core"]})
    MATS[name] = t.m
    return t.m


GLOW = (255, 92, 14)
if VAR == "a":       # Forged Steel: dark riveted iron, sooty, dark brass trim, magma-orange screens and vents
    M["gold"] = shiny("i-brass", (150, 94, 42), rough=0.36, metal=0.85, wear=(116, 70, 30), scale=1.5, dirt=0.4,
                      side=0.3, streak=0.3)
    M["golddark"] = shiny("i-brassd", (100, 60, 26), rough=0.4, metal=0.8, wear=(80, 46, 20), scale=1.5, dirt=0.4)
    M["drum"] = painted("i-steel", (56, 54, 58), rough=0.45, metal=0.85, wear=(84, 80, 80), scale=3.0, dirt=0.35,
                        soot=0.7, rust=(84, 46, 30), rust_at=0.66)
    M["drumtop"] = painted("i-steeltop", (72, 68, 68), rough=0.5, metal=0.75, wear=(98, 92, 88), scale=2.0, dirt=0.3,
                           soot=0.6)
    M["chrome"] = shiny("i-chrome", (128, 130, 136), rough=0.3, metal=1.0, wear=(100, 102, 108), scale=4, dirt=0.2)
    M["pedestal"] = painted("i-ped", (84, 80, 82), rough=0.45, metal=0.8, wear=(110, 104, 100), scale=3, soot=0.5)
    M["pedside"] = painted("i-pedside", (62, 58, 62), rough=0.45, metal=0.8, wear=(86, 80, 80), scale=3, soot=0.5)
    M["rod"] = shiny("i-rod", (72, 74, 80), rough=0.35, metal=0.9, wear=(60, 62, 66), scale=4, dirt=0.1)
    M["rim"] = shiny("i-rim", (100, 100, 106), rough=0.3, metal=0.95, wear=(76, 76, 80), scale=4, dirt=0.2)
    M["port"] = M["gold"]
    M["dish"] = shiny("i-dish", (88, 88, 96), rough=0.42, metal=0.85, wear=(64, 64, 70), scale=1.2, dirt=0.1,
                      side=0.25, streak=0.3, glow=((26.0, -25.0, 15.0, 5.5, 0.3, (170, 172, 180)),))
    M["dishback"] = shiny("i-dishback", (60, 60, 66), rough=0.4, metal=0.85, wear=(46, 46, 50), scale=2, dirt=0.2)
    M["bowl"] = painted("i-bowl", (50, 46, 46), rough=0.45, metal=0.85, wear=(76, 68, 64), scale=2.0, dirt=0.4,
                        soot=0.6, rust=(80, 44, 28), rust_at=0.62)
    M["leg"] = painted("i-leg", (60, 56, 58), rough=0.42, metal=0.85, wear=(88, 82, 80), scale=2.0, dirt=0.3,
                       soot=0.5)
    M["rivet"] = shiny("i-rivet", (118, 116, 118), rough=0.3, metal=0.95, wear=(90, 88, 90), scale=6, dirt=0.1)
    M["tick"] = hot("i-tick", GLOW, 3.5)
    M["hole"] = hot("i-screen", (255, 100, 20), 3.5)
    M["vent"] = hot("i-vent", (255, 92, 14), 4.5)
elif VAR == "b":     # carved in rock: black basalt with magma cracks, brimstone-yellow trim, lava channels, bone spire
    for k in ("drum", "bowl", "pedestal", "pedside", "leg"):
        M[k] = rock("i-basalt", (30, 27, 28), (62, 56, 54), crack=GLOW, crack_scale=1.3, crack_cover=0.3, crack_w=0.035,
                    glow=4.0)
    M["drumtop"] = rock("i-basalttop", (40, 36, 36), (70, 64, 60), crack=GLOW, crack_scale=1.0, crack_cover=0.2,
                        crack_w=0.035, glow=4.0)
    M["gold"] = painted("i-brim", (226, 182, 42), rough=0.6, metal=0.2, wear=(176, 124, 22), scale=3.0, dirt=0.45,
                        soot=0.4)
    M["golddark"] = painted("i-brimd", (164, 112, 20), rough=0.6, metal=0.2, wear=(130, 84, 14), scale=3.0)
    M["rim"] = M["port"] = M["rivet"] = M["gold"]
    M["hole"] = magma("i-lavahole", strength=3.0)
    M["tick"] = hot("i-tick", GLOW, 3.5)
    M["lava"] = magma("i-lava", crust_at=0.55, strength=3.5)
    M["bone"] = bone("i-spire", z0=7.0, z1=14.0)
    M["horn"] = bone("i-horn", col=(214, 196, 160), tip=(60, 48, 40), z0=5.4, z1=7.6)
else:                # on a magma pool: half steel, half rock, chained egg pods, a glowing crystal on top
    M["drum"] = rock("i-half", (32, 28, 28), (62, 56, 54), crack=GLOW, crack_scale=1.3, crack_cover=0.6,
                     half=((58, 56, 60), (88, 84, 84)))
    M["drumtop"] = rock("i-halftop", (40, 36, 36), (70, 64, 60), crack=GLOW, crack_scale=1.0, crack_cover=0.4,
                        half=((74, 70, 70), (100, 94, 90)))
    M["bowl"] = rock("i-halfbowl", (30, 27, 28), (58, 52, 50), crack=GLOW, crack_scale=1.3, crack_cover=0.6,
                     half=((52, 48, 48), (80, 72, 68)))
    M["gold"] = shiny("i-brass", (150, 94, 42), rough=0.36, metal=0.85, wear=(116, 70, 30), scale=1.5, dirt=0.4,
                      side=0.3, streak=0.3)
    M["golddark"] = shiny("i-brassd", (100, 60, 26), rough=0.4, metal=0.8, wear=(80, 46, 20), scale=1.5, dirt=0.4)
    M["pedestal"] = painted("i-ped", (84, 80, 82), rough=0.45, metal=0.8, wear=(110, 104, 100), scale=3, soot=0.5)
    M["pedside"] = painted("i-pedside", (62, 58, 62), rough=0.45, metal=0.8, wear=(86, 80, 80), scale=3, soot=0.5)
    M["rim"] = shiny("i-rim", (100, 100, 106), rough=0.3, metal=0.95, wear=(76, 76, 80), scale=4, dirt=0.2)
    M["port"] = M["gold"]
    M["leg"] = painted("i-leg", (60, 56, 58), rough=0.42, metal=0.85, wear=(88, 82, 80), scale=2.0, dirt=0.3,
                       soot=0.5)
    M["tick"] = hot("i-tick", GLOW, 3.5)
    M["hole"] = hot("i-screen", (255, 100, 20), 3.5)
    M["pool"] = magma("i-pool", crust_at=0.47, strength=3.0, scale=0.9)
    M["stone"] = rock("i-stone", (34, 30, 30), (66, 60, 56), scale=2.5)
    M["pod"] = rock("i-pod", (40, 40, 46), (78, 78, 86), crack=GLOW, crack_scale=2.2, crack_cover=0.7, rough=0.35,
                    metal=0.6, bump=0.2, glow=6.0)
    M["chain"] = shiny("i-chain", (74, 72, 74), rough=0.4, metal=0.95, wear=(54, 52, 54), scale=6, dirt=0.1)
    M["crystal"] = crystal_mat("i-crystal")
    M["crystalcore"] = core_mat("i-crystal-core")
    # the crystal's setting: worn brass, darker and duller in the recesses
    M["cupbrass"] = shiny("i-cupbrass", (156, 100, 46), rough=0.32, metal=0.9, wear=(104, 64, 28), scale=3.0, dirt=0.45,
                          ao_min=0.25, side=0.3, streak=0.35)


def stud(name, at, th, mat, r=0.08):
    """A small dome rivet on the drum at bearing th."""
    e = bpy.data.objects.new(name + "-at", None)
    link(e)
    e.location = at
    track(e, P(th, 1.0, 0.0), "Y")
    lathe(name, [(0.0, -0.03), (r, -0.03), (r * 0.95, r * 0.4), (r * 0.55, r * 0.85), (0.0, r)], (0, 0, 0), mat,
          parent=e, verts=12)


def bowl_r(z):
    s = (ZB - z) / S.BOWL_DEPTH
    return S.BOWL_R * math.sqrt(max(0.0, 1 - s * s))


def lumpy(name, at, size, mat, seed, squash=0.6):
    """A rough stone lump (a jittered, squashed icosphere) sitting at `at`."""
    rr = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1 + rr.uniform(-0.18, 0.18)
        v.co.x *= size * k
        v.co.y *= size * k * rr.uniform(0.85, 1.15)
        v.co.z *= size * k * squash
    ob = mesh_ob(name, bm, [mat])
    ob.location = at
    ob.rotation_euler = (0, 0, rr.uniform(0, 6.28))
    return ob


def roughen(o, strength=0.09, size=0.55, levels=3):
    """Carve a smooth lathe into rough stone: simple subdivision, then a world-space colour-cloud displacement (the same
    at shared edges, so neighbouring parts stay joined)."""
    sub = o.modifiers.new("sub", "SUBSURF")
    sub.subdivision_type = "SIMPLE"
    sub.levels = sub.render_levels = levels
    tex = bpy.data.textures.get("i-clouds") or bpy.data.textures.new("i-clouds", "CLOUDS")
    tex.cloud_type = "COLOR"
    tex.noise_scale = size
    tex.noise_depth = 3
    d = o.modifiers.new("disp", "DISPLACE")
    d.texture = tex
    d.texture_coords = "GLOBAL"
    d.direction = "RGB_TO_XYZ"
    d.strength = strength
    d.mid_level = 0.5


def look_a():
    R = S.DRUM_R
    for z in (ZB + 0.26, ZT - 0.32):                             # rivet rows round the band
        for i in range(48):
            th = S.FRONT + 3.75 + i * 7.5
            stud("drumrivet", P(th, R - 0.01, z), th, M["rivet"])
    for i in range(10):                                          # glowing vent slits round the bowl, between the legs
        th = S.FRONT + 18 + i * 36
        if min(abs((th - lt + 180) % 360 - 180) for lt in S.LEG_TH) < 14:
            continue
        zc = ZB - 0.9
        rc = bowl_r(zc)
        box("bowlventframe", (0.16, 0.42, 0.95), P(th, rc - 0.02, zc), M["rim"], rot=(0, 18, th), bevel=0.04,
            origin="centre")
        box("bowlvent", (0.12, 0.24, 0.75), P(th, rc + 0.04, zc), M["vent"], rot=(0, 18, th), bevel=0.02,
            origin="centre")
    zt = ZT + S.TOP_DOME
    e = bpy.data.objects.new("pedglow-at", None)
    link(e)
    e.location = (S.PED_X, S.PED_Y, zt - 0.08 + 0.4)
    ring("pedglow", S.PED_R + 0.01, 0.06, M["vent"], parent=e, n=96)
    # the dish's hub: a glowing magma eye
    for o in list(SC.objects):
        if o.name.startswith("dishhub"):
            o.data.materials[0] = M["vent"]


def channel(i, th, r0, r1, wig):
    """A lava channel cut into the ground: a glowing flow between two rows of basalt lips."""
    pts = []
    n = 14
    for k in range(n + 1):
        u = k / n
        r = r0 + (r1 - r0) * u
        t2 = th + wig * math.sin(u * 5.0 + i) * (0.3 + u)
        pts.append(P(t2, r, -0.06))
    tube("lavachan%d" % i, pts, 0.26, M["lava"], verts=12, smooth=True, r_end=0.16)
    for k in range(1, n + 1):
        d = (pts[k] - pts[k - 1]).normalized()
        side = Vector((-d.y, d.x, 0.0))
        w = 0.4 - 0.12 * k / n
        for sgn in (-1, 1):
            lumpy("lavalip", pts[k] + side * sgn * w, 0.22 - 0.06 * k / n, M["leg"], seed=i * 100 + k * 2 + (sgn > 0),
                  squash=0.55)


def look_b():
    for name in ("drumband", "drumtop", "bowl"):
        roughen(bpy.data.objects[name], 0.08)
    for name in ("pedestalside", "pedestal"):
        roughen(bpy.data.objects[name], 0.05, levels=2)
    # the leg struts and brackets are the HCC's pipes: here they run with lava
    for o in SC.objects:
        if o.name.startswith(("legstrut", "leggusset")):
            o.data.materials[0] = M["lava"]
    # lava channels out of each foot toward the Incubators (and one out of the front)
    for i, th in enumerate(S.LEG_TH):
        channel(i, th, S.LEG_D + 0.35, 7.8 if th < -60 else 8.8, 6.0)
    channel(5, S.FRONT, 1.0, 8.4, 5.0)
    lathe("lavapuddle", [(0.0, 0.02), (1.3, 0.02), (1.45, -0.05)], (0, 0, 0), M["lava"], verts=48)
    tube("lavadrip", [(0.0, 0.0, ZB - S.BOWL_DEPTH + 0.05), (0.0, 0.0, 0.0)], 0.12, M["lava"], r_end=0.2)
    # bone horns on the top rim (where the HCC has its gold knobs)
    R = S.DRUM_R
    for th in S.NUB_TH:
        tube("rimhorn", [P(th, R - 0.25, ZT - 0.1), P(th, R + 0.35, ZT + 0.35), P(th, R + 0.6, ZT + 1.1),
                         P(th + 8, R + 0.45, ZT + 1.7)], 0.22, M["horn"], smooth=True, r_end=0.02, verts=12)
    # the spire: a twisted bone-and-horn spike out of the post, ringed with brimstone collars, two side horns at its foot
    zt = ZT + S.TOP_DOME
    zp = zt - 0.08 + S.PED_H
    A = Vector((S.PED_X, S.PED_Y, zp + S.POST_H + S.AXLE_R * 0.6 - 0.12))
    pts = []
    n = 12
    for k in range(n + 1):
        u = k / n
        sw = 0.35 * math.sin(u * math.pi * 1.6)
        pts.append(A + Vector((sw * 0.6 - 0.6 * u * u, sw * 0.4 + 0.5 * u * u, 6.4 * u)))
    tube("spire", pts, 0.62, M["bone"], smooth=True, r_end=0.03, verts=20)
    for k in (2, 5, 8):
        u = k / n
        e = bpy.data.objects.new("spirering-at", None)
        link(e)
        e.location = pts[k]
        track(e, pts[k + 1] - pts[k - 1], "Y")
        r = 0.62 + (0.03 - 0.62) * u
        ring("spirering", r + 0.03, 0.08, M["gold"], parent=e, n=32)
    for sgn in (-1, 1):
        side = Vector((0.707, 0.707, 0.0)) * sgn
        tube("spirehorn", [A + side * 0.3 + Vector((0, 0, 0.3)), A + side * 1.0 + Vector((0, 0, 0.9)),
                           A + side * 1.25 + Vector((0, 0, 1.9)), A + side * 1.0 + Vector((0, 0, 2.6))],
             0.24, M["horn"], smooth=True, r_end=0.02, verts=12)


def oval(name, a, b, wire, mat, parent):
    n = 20
    return tube(name, [(a * math.cos(2 * math.pi * i / n), 0.0, b * math.sin(2 * math.pi * i / n)) for i in range(n)],
                wire, mat, parent=parent, verts=8, cyclic=True)


def chain(name, p0, p1, sag=0.35, step=0.2):
    p0, p1 = Vector(p0), Vector(p1)
    mid = (p0 + p1) / 2 - Vector((0, 0, sag))
    n = max(3, int((p1 - p0).length / step))
    prev = p0
    for k in range(1, n + 1):
        u = k / n
        q = p0 * (1 - u) ** 2 + mid * 2 * u * (1 - u) + p1 * u * u
        e = bpy.data.objects.new(name + "-at", None)
        link(e)
        e.location = (prev + q) / 2
        track(e, q - prev, "Y")
        e.rotation_euler.rotate_axis("Z", math.radians(90 * (k % 2)))
        oval(name, 0.08, 0.15, 0.035, M["chain"], e)
        prev = q


def look_c():
    # the magma pool under the building, edged with basalt lumps
    PR = 5.6
    lathe("pool", [(0.0, 0.035), (PR, 0.035), (PR + 0.15, -0.02)], (0, 0, 0), M["pool"], verts=96)
    for k in range(34):
        th = k * 360 / 34 + rng.uniform(-3, 3)
        lumpy("poolrim", P(th, PR + 0.25 + rng.uniform(-0.1, 0.12), 0.05), rng.uniform(0.32, 0.5), M["stone"],
              seed=500 + k)
    # chained egg pods round the base
    H, RM = 2.5, 0.9
    prof = []
    for i in range(17):
        a = math.pi * i / 16
        z = H / 2 * (1 - math.cos(a))
        prof.append((max(0.0, RM * math.sin(a) * (1.05 - 0.22 * z / H)), z))

    def egg_r(z):
        a = math.acos(max(-1.0, min(1.0, 1 - 2 * z / H)))
        return RM * math.sin(a) * (1.05 - 0.22 * z / H)
    BZ0, BZ1 = 1.5, 1.74                       # the brass band: a strap hugging the egg just above its widest point
    band = [(egg_r(BZ0) - 0.02, BZ0), (egg_r(BZ0) + 0.05, BZ0), (egg_r(BZ0) + 0.075, BZ0 + 0.03),
            (egg_r(BZ1) + 0.075, BZ1 - 0.03), (egg_r(BZ1) + 0.05, BZ1), (egg_r(BZ1) - 0.02, BZ1)]
    EZ = (BZ0 + BZ1) / 2
    to_cam = -cam_fwd()
    for j, th in enumerate((-160.0, -64.0, -22.0, 62.0)):
        r = 4.75 if th in (-64.0, -22.0) else 5.0
        e = bpy.data.objects.new("pod%d-at" % j, None)
        link(e)
        e.location = P(th, r, -0.2)
        e.rotation_euler = (math.radians(rng.uniform(-6, 6)), math.radians(rng.uniform(-6, 6)), math.radians(th))
        lathe("podshell%d" % j, prof, (0, 0, 0), M["pod"], parent=e, verts=40)
        lathe("podband%d" % j, band, (0, 0, 0), M["gold"], parent=e, verts=48)
        lathe("podcap%d" % j, [(0.0, H - 0.12), (0.22, H - 0.12), (0.2, H + 0.02), (0.0, H + 0.06)], (0, 0, 0),
              M["gold"], parent=e, verts=16)
        bpy.context.view_layer.update()
        # the eye: a small brass ring standing out of the band, on the side toward the bowl that the viewer sees
        best = None
        for sgn in (-1, 1):
            b = 180.0 + sgn * 62.0                       # bearing on the pod (local: 180 = toward the building)
            w = e.matrix_world @ Vector(S.polar(b, egg_r(EZ) + 0.075, EZ))
            if best is None or w.dot(to_cam) > best[0]:
                best = (w.dot(to_cam), b)
        b = best[1]
        lug = bpy.data.objects.new("podlug%d-at" % j, None)
        link(lug, e)
        lug.location = S.polar(b, egg_r(EZ) + 0.07, EZ)
        lug.rotation_euler = (0, 0, math.radians(b))
        box("podlugplate%d" % j, (0.1, 0.2, 0.26), (0.0, 0.0, -0.13), M["gold"], parent=lug, bevel=0.03)
        el = bpy.data.objects.new("podeye%d-at" % j, None)
        link(el, lug)
        el.location = (0.17, 0.0, 0.0)
        el.rotation_euler = (math.radians(90), 0, 0)
        ring("podeye%d" % j, 0.11, 0.035, M["gold"], parent=el, n=20)
        bpy.context.view_layer.update()
        eye = el.matrix_world @ Vector((0.1, 0.0, 0.0))
        # the chain from that eye, slack, up to an eye low on the bowl
        anchor_z = ZB - 1.55
        anchor = P(th, bowl_r(anchor_z) + 0.1, anchor_z)
        lathe("bowleye%d" % j, [(0.0, -0.1), (0.2, -0.1), (0.2, 0.06), (0.0, 0.1)], anchor - P(th, 0.08, 0.0),
              M["gold"], rot=(0, 90, th), verts=12)
        chain("podchain%d" % j, eye, anchor, sag=0.3)
    crystal()


def gem(name, rings, mat, rot0, tip, parent=None, jit=None):
    """A cut crystal round local Z: six-sided rings (vertex radius, z) closed by a flat foot and a point at tip.
    jit[k][i]: radius factor of ring k's vertex i (an uneven, natural cut); flat facets with fine chamfered edges."""
    bm = bmesh.new()
    rows = []
    for k, (r, z) in enumerate(rings):
        row = []
        for i in range(6):
            a = math.radians(rot0 + 60 * i)
            f = jit[k][i] if jit else 1.0
            row.append(bm.verts.new((r * f * math.cos(a), r * f * math.sin(a), z)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for i in range(6):
            j = (i + 1) % 6
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rows[0])))
    t = bm.verts.new(tip)
    for i in range(6):
        bm.faces.new((rows[-1][i], rows[-1][(i + 1) % 6], t))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [mat], smooth=False, parent=parent)
    mo = ob.modifiers.new("bevel", "BEVEL")
    mo.width = 0.03
    mo.segments = 1
    mo.limit_method = "ANGLE"
    mo.angle_limit = math.radians(20)
    return ob


def crystal():
    """The crystal on the post, where the HCC has its dish: a long cut magma crystal with two small side shards, set
    in a hexagonal brass bezel on a round brass cup, held by three claws pressed onto its faces."""
    zt = ZT + S.TOP_DOME
    zp = zt - 0.08 + S.PED_H
    A = Vector((S.PED_X, S.PED_Y, zp + S.POST_H + S.AXLE_R * 0.6 - 0.06))     # the post's top
    ROT = -35.0                       # a vertex edge just right of the viewer: two lit faces and a bright ridge
    root = bpy.data.objects.new("crystal-at", None)
    link(root)
    root.location = A
    # the cup: a foot on the post, a short stem, a round bowl, a rolled lip
    lathe("crystalcup", [(0.0, 0.0), (0.6, 0.0), (0.62, 0.08), (0.42, 0.2), (0.4, 0.3), (0.66, 0.44), (0.84, 0.66),
                         (0.92, 0.94), (0.86, 0.98), (0.82, 0.9), (0.0, 0.9)], (0, 0, 0), M["cupbrass"], parent=root,
          verts=40)
    ring("crystalcuplip", 0.91, 0.055, M["cupbrass"], parent=root, z=0.95, n=40)
    ring("crystalcupfoot", 0.6, 0.045, M["golddark"], parent=root, z=0.05, n=40)
    ring("crystalcupbelt", 0.8, 0.04, M["golddark"], parent=root, z=0.6, n=40)
    # the bezel: a six-sided brass collar hugging the crystal's foot, its faces flush with the crystal's
    RB, Z0, Z1 = 0.62, 0.86, 1.22
    bz = lathe("crystalbezel", [(RB + 0.005, Z0), (RB + 0.15, Z0), (RB + 0.15, Z1 - 0.04), (RB + 0.11, Z1),
                                (RB + 0.005, Z1)], (0, 0, 0), M["cupbrass"], parent=root, verts=6, rot=(0, 0, ROT))
    bz.data.polygons.foreach_set("use_smooth", [False] * len(bz.data.polygons))
    # the crystal: a straight foot in the bezel, widening, two-stage point; an emissive heart inside
    rr = random.Random(77)
    rings = [(RB, 0.5), (RB, Z1), (0.78, 2.1), (0.78, 3.15), (0.6, 3.9)]
    jit = [[1.0] * 6] * 3 + [[rr.uniform(0.93, 1.07) for _ in range(6)] for _ in range(2)]
    tip = (0.06, -0.04, 4.9)
    cr = gem("crystal", rings, M["crystal"], ROT, tip, parent=root, jit=jit)
    core = gem("crystalcore", [(0.26, 0.9), (0.4, 1.9), (0.4, 3.0), (0.26, 3.6)], M["crystalcore"], ROT,
               (0.04, -0.03, 4.2), parent=root)
    shards = [cr, core]
    # two small side shards growing out of the crystal's lower half, leaning out
    for k, (b, lean, ln, rad) in enumerate(((-112.0, 30.0, 1.6, 0.26), (52.0, 28.0, 1.35, 0.21))):
        se = bpy.data.objects.new("crystalshard%d-at" % k, None)
        link(se, root)
        se.location = S.polar(b, 0.32, 1.45)
        se.rotation_euler = Euler((0.0, math.radians(lean), math.radians(b)), "XYZ")
        sj = [[rr.uniform(0.9, 1.1) for _ in range(6)] for _ in range(3)]
        shards.append(gem("crystalshard%d" % k, [(rad * 0.8, 0.0), (rad, ln * 0.35), (rad * 0.85, ln * 0.72)],
                          M["crystal"], ROT + 17 * k, (0.02, 0.0, ln), parent=se, jit=sj))
        shards.append(gem("crystalshardcore%d" % k, [(rad * 0.35, 0.1), (rad * 0.4, ln * 0.55)], M["crystalcore"],
                          ROT + 17 * k, (0.0, 0.0, ln * 0.8), parent=se))
    # three claws up the cup's side, over the bezel, their points pressed onto the crystal's faces
    for k in range(3):
        b = ROT + 30 + 120 * k               # the middle of a face (faces at ROT+30+60i); not the front one
        a0 = RB * math.cos(math.radians(30))
        ap2 = 0.78 * math.cos(math.radians(30))
        apz = lambda z: a0 + (ap2 - a0) * min(1.0, (z - Z1) / (2.1 - Z1))
        pts = [S.polar(b, 0.5, 0.36), S.polar(b, 0.86, 0.7), S.polar(b, 1.01, 1.05), S.polar(b, apz(1.5) + 0.2, 1.5),
               S.polar(b, apz(1.95) + 0.08, 1.95), S.polar(b, apz(2.25) + 0.03, 2.25),
               S.polar(b, apz(2.4) - 0.015, 2.4)]          # the point bites into the face
        tube("crystalclaw%d" % k, [Vector(q) for q in pts], 0.1, M["cupbrass"], parent=root, smooth=True,
             r_end=0.012, verts=10)
        lathe("crystalclawknob%d" % k, [(0.0, -0.06), (0.11, -0.04), (0.11, 0.04), (0.0, 0.07)],
              S.polar(b, 0.98, 0.95), M["cupbrass"], parent=root, rot=(0, 90, b), verts=12)
    for o in shards:                     # the crystal lets its light out (its glass doesn't block the light's rays)
        o.visible_shadow = False
    lt = bpy.data.lights.new("crystal-light", "POINT")
    lt.energy = CRYSTAL_E["light"]
    lt.color = (1.0, 0.42, 0.14)
    lt.shadow_soft_size = 0.35
    lo = bpy.data.objects.new("crystal-light", lt)
    link(lo, root)
    lo.location = (0.0, 0.0, 2.4)
    lo.visible_glossy = False            # light the building round it, but don't show as a blob inside the glass
    lo.visible_transmission = False
