"""imats.py : the Inferno look's materials for the Infernal Monster Lab: basalt with magma cracks, lava and bone (the
Incubator Control Centre look C's own recipes, from art/icc-inferno-looks looks.py, unchanged), plus the lab's glass
and brews. Used by lab.py."""
import math

import bpy
from kit import GROUND, MATS, NT, srgb


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




def brew(name, deep, mid, bright, rim, strength=0.9, scale=1.0):
    """A glass vessel full of glowing brew (the surface Monster Lab's dome recipe in another colour): clouds of the
    brew looked up behind the surface so they read as inside the glass, a bright rim, a clear coat for the glints."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    tc = t.n("ShaderNodeTexCoord")
    geo = t.n("ShaderNodeNewGeometry")
    lay = []
    for depth, sc in ((0.45, 1.7), (1.3, 1.2)):
        back = t.n("ShaderNodeVectorMath", operation="MULTIPLY_ADD")
        t.link(geo.outputs["Incoming"], back.inputs[0])
        back.inputs[1].default_value = (-depth,) * 3
        t.link(tc.outputs["Object"], back.inputs[2])
        mp = t.n("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (sc * scale,) * 3
        t.link(back.outputs[0], mp.inputs["Vector"])
        lay.append(t.noise(mp.outputs[0], 0.9, 1.5, 0.5, 2.0))
    col = t.ramp(lay[1], [(0.36, srgb(*deep)), (0.47, srgb(*mid)), (0.6, srgb(*bright)), (0.72, srgb(*rim))])
    band = t.ramp(lay[0], [(0.36, (0, 0, 0, 1)), (0.47, (0.6, 0.6, 0.6, 1)), (0.52, (0.6, 0.6, 0.6, 1)),
                           (0.63, (0, 0, 0, 1))])
    col = t.mix(col, srgb(*deep), band)
    lw = t.n("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.3
    col = t.mix(col, srgb(*rim), t.ramp(lw.outputs["Facing"], [(0.35, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))]))
    t.set(**{"Base Color": col, "rough": 0.08, "metal": 0.0, "spec": 0.7, "coat": 1.0})
    t.bsdf.inputs["Coat Roughness"].default_value = 0.05
    t.set(**{"Emission Color": col, "Emission Strength": strength})
    MATS[name] = t.m
    return t.m


def liquid(name, col, glow=1.2, clear=0.55):
    """See-through glowing liquid in a glass tube: from the front it lets `clear` of what floats inside it show; its
    far wall (seen from inside) is solid glowing colour, so the vessel is never see-through to the ground."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = srgb(*col)
    em.inputs[1].default_value = glow
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs[0].default_value = srgb(*(min(255, int(c * 0.6 + 100)) for c in col))
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.05
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    # front: transparent in the middle, glowing toward the rim
    rimmix = nt.nodes.new("ShaderNodeMath")
    rimmix.operation = "MULTIPLY_ADD"
    nt.links.new(lw.outputs["Facing"], rimmix.inputs[0])
    rimmix.inputs[1].default_value = 1.2 * clear
    rimmix.inputs[2].default_value = 1.0 - clear
    rimmix.use_clamp = True
    front = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(rimmix.outputs[0], front.inputs[0])
    nt.links.new(tr.outputs[0], front.inputs[1])
    nt.links.new(em.outputs[0], front.inputs[2])
    shine = nt.nodes.new("ShaderNodeMixShader")
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs[0].default_value = 1.45
    nt.links.new(fr.outputs[0], shine.inputs[0])
    nt.links.new(front.outputs[0], shine.inputs[1])
    nt.links.new(gl.outputs[0], shine.inputs[2])
    both = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], both.inputs[0])
    nt.links.new(shine.outputs[0], both.inputs[1])
    nt.links.new(em.outputs[0], both.inputs[2])
    nt.links.new(both.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def glass(name, col=(226, 240, 234), rim=(240, 255, 250)):
    """Thin clear glass (an empty neck or the dry top of a tube): see-through (the ground shows faintly through it in
    the game), a bright rim and a glint."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs[0].default_value = srgb(*col)
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.04
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = srgb(*rim)
    em.inputs[1].default_value = 0.5
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.25
    a = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lw.outputs["Facing"], a.inputs[0])
    nt.links.new(tr.outputs[0], a.inputs[1])
    nt.links.new(em.outputs[0], a.inputs[2])
    b = nt.nodes.new("ShaderNodeMixShader")
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs[0].default_value = 1.5
    nt.links.new(fr.outputs[0], b.inputs[0])
    nt.links.new(a.outputs[0], b.inputs[1])
    nt.links.new(gl.outputs[0], b.inputs[2])
    back = nt.nodes.new("ShaderNodeBsdfDiffuse")
    back.inputs[0].default_value = srgb(*(int(c * 0.8) for c in col))
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    both = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], both.inputs[0])
    nt.links.new(b.outputs[0], both.inputs[1])
    nt.links.new(a.outputs[0], both.inputs[2])       # the far wall: see-through too, with its bright rim
    nt.links.new(both.outputs[0], out.inputs["Surface"])
    MATS[name] = m
    return m


def roughen(o, strength=0.09, size=0.55, levels=3):
    """Carve a smooth lathe into rough stone: simple subdivision, then a world-space colour-cloud displacement."""
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
