"""magma.py : the Inferno Magma Pump in 3D, three tiers, built clean-room from the Flash pictures only
(server/public/assets/buildings/imagmaproducer). Only the generic Inferno kit is used (kit.py: camera, light, render
modes), the same kit as the 3D Bone Cruncher and Coal Extractor.

    blender -b --factory-startup -P magma.py -- <tier 1|2|3> <fit|check|still|anim|probe|gap> [frame]

Tier 1 = levels 1-2: Flash's one look in play (top.1.v2): a navy box with a pale steel lid, brass corner posts, a
glowing vent on the left face, a flanged yellow elbow pipe from a well in the ground on the right face, a flared
smoke pot on the lid. Flash has no higher look in play, so tiers 2 (levels 3-6) and 3 (levels 7-10) are upgrades on
the same machine, led by Flash's unused top.2 (wide brass frame, steel grille over the vent, stubby dark feet):
  tier 2 = tier 1 + iron feet, full brass frame (wider posts, a post on the left corner, base rails), a taller vent
           behind a steel grille, a magma sight tank on the right face piped to the lid, a brass crown on the pot.
  tier 3 = tier 2 + iron horns on the posts, a spiked crown and brimming magma in the pot, a riveted iron belt with
           glowing slots under the lid, a taller domed tank, an iron curb and magma ring round the well.
One body, the same mounting points at every tier (tiers 2 and 3 stand LIFT higher on their feet).

World: Z up, the body's centre on the origin, its faces square to X and Y, 10 Flash px a unit. The camera looks from
+X -Y, so the left face seen is Y = -HY and the right face seen is X = +HX.

What moves, as Flash's three strips (49 frames, every motion periodic so the last frame runs into the first):
  anim.3  the pot: the ribs light up yellow, a brown-orange smoke puff rises out of the mouth and thins away, then the
          mouth glows orange and dies down.
  anim.1  the elbow pipe: a swelling travels up the pipe from the well to the flange.
  anim.2  the vent: its glow swells and sinks (orange to yellow and back).
Tiers 2 and 3 add only the tank's glow (and tier 3's belt slots and well ring) breathing with the vent.
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import kit  # noqa: E402

T = kit.L
N = 49
kit.OUT = HERE / os.environ.get("PB_SUB", ".")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = (-1.0, 29.0)
kit.SKY_E = 0.38
kit.SUN = 5.4
kit.FRAME = (-60, -80, 60, 60)
kit.FRAMES = N + int(os.environ.get("PB_EXTRA", 0))      # PB_EXTRA=1 also renders frame N (= frame 0), the loop check
rnd = random.Random(41)
K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
MATS = kit.MATS

HX, HY, BH = 1.85, 2.4, 4.0               # the body: half sizes and height
LIFT = 0.0 if T == 1 else 0.45            # tiers 2 and 3 stand on feet
Z0, TOP = LIFT, LIFT + BH
POT_H = 2.1                               # the pot: one squat stone piece seated on the lid, the same at every tier
POT = Vector((-0.66, 0.62, 0.0))          # toward the back of the lid, as Flash's: the rays fan out in front of it
TILT = 0.0                                # degrees the pot leans away from the camera (0: it stands square on the lid)
FL = Vector((HX, 0.0, Z0 + 1.68))        # the flange's centre on the right face
WELL = Vector((HX + 2.05, -0.12, 0.0))     # the well in the ground


def grey(x):
    return (x, x, x, 1)


def mat(name, col, rough=0.6, metal=0.0, wear=None, wear_amt=0.6, rust=None, rust_at=0.6, dirt=0.3, scale=5.0,
        speck=0.12, bump=0.06, ao_min=0.5, streak=None, mottle=0.35, top=None):
    """Paint or metal: worn patches, rust blotches, a fine speckle, darker toward the ground and in creases."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    v = t.coords()
    out = kit.srgb(*col)
    if wear:
        out = t.mix(out, kit.srgb(*wear), t.ramp(t.noise(v, scale * 0.5, 3.0, 0.55, 0.2), [(0.45, K0), (0.72, grey(wear_amt))]))
    if rust:
        out = t.mix(out, kit.srgb(*rust), t.ramp(t.noise(v, scale * 0.8, 5.0, 0.65, 1.0), [(rust_at, K0), (rust_at + 0.14, grey(0.8))]))
    if top:
        geo = t.n("ShaderNodeNewGeometry")
        sep = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sep.inputs[0])
        out = t.mix(out, kit.srgb(*top), t.ramp(sep.outputs["Z"], [(0.5, K0), (0.8, K1)]))
    if mottle:
        out = t.mix(out, t.ramp(t.noise(v, scale * 0.3, 3.0, 0.6, 0.6), [(0.3, grey(1 - mottle)), (0.66, K1)]), 1.0, "MULTIPLY")
    if streak:
        v2 = t.coords(scale=(1.0, 1.0, 0.18))
        out = t.mix(out, kit.srgb(*streak), t.ramp(t.noise(v2, scale * 0.9, 5.0, 0.6, 0.3), [(0.5, K0), (0.72, grey(0.55))]))
    if speck:
        out = t.mix(out, t.ramp(t.noise(v, scale * 12, 2.0, 0.5), [(0.3, grey(1 - speck)), (0.62, K1)]), 1.0, "MULTIPLY")
    out = t.grime(out, 0.0, 2.6, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rough, "metal": metal, "spec": 0.4})
    if bump:
        t.bump(t.noise(v, scale * 4, 4.0, 0.6), bump, 0.01)
    MATS[name] = t.m
    return t.m


GLOW = {}        # name -> (bsdf, rest strength): lights whose strength turn() sets


def glow(name, lo, mid, hi, strength, scale=3.0, cut=0.45):
    """Molten light: dark crust to hot yellow by a noise."""
    if name in MATS:
        return MATS[name]
    t = kit.NT(name)
    n = t.noise(t.coords(), scale, 4.0, 0.6, 0.5)
    c = t.ramp(n, [(cut - 0.2, kit.srgb(*lo)), (cut, kit.srgb(*mid)), (cut + 0.22, kit.srgb(*hi))])
    t.set(**{"Base Color": c, "rough": 0.7})
    t.link(c, t.bsdf.inputs["Emission Color"])
    t.bsdf.inputs["Emission Strength"].default_value = strength
    GLOW[name] = (t.bsdf, strength)
    MATS[name] = t.m
    return t.m


VOL = {}         # the smoke column's animated nodes


def smoke_mat():
    """The smoke: one soft column of brown-orange haze (a volume that glows its own colour and hides what is behind
    it, so it looks the same in any light). turn() sets how high its head and tail have risen and how thick it is."""
    m = bpy.data.materials.new("smoke")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N_, L_ = nt.nodes.new, nt.links.new

    def math_(op, a=None, b=None):
        n = N_("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L_(v, n.inputs[i])
        return n

    def smooth(v, lo, hi, a, b):
        n = N_("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        L_(v, n.inputs["Value"])
        n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = lo, hi
        n.inputs["To Min"].default_value, n.inputs["To Max"].default_value = a, b
        return n

    out = N_("ShaderNodeOutputMaterial")
    tc = N_("ShaderNodeTexCoord")
    sep = N_("ShaderNodeSeparateXYZ")
    L_(tc.outputs["Object"], sep.inputs[0])
    z = sep.outputs["Z"]
    flat = N_("ShaderNodeVectorMath")
    flat.operation = "MULTIPLY"
    L_(tc.outputs["Object"], flat.inputs[0])
    flat.inputs[1].default_value = (1, 1, 0)
    ln = N_("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    L_(flat.outputs[0], ln.inputs[0])
    rise = N_("ShaderNodeVectorMath")          # the haze's grain rises with the column
    rise.operation = "SUBTRACT"
    L_(tc.outputs["Object"], rise.inputs[0])
    noise = N_("ShaderNodeTexNoise")
    L_(rise.outputs[0], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 0.9
    noise.inputs["Detail"].default_value = 2.5
    noise.inputs["Roughness"].default_value = 0.5
    nz = noise.outputs[0]
    # the column's radius: narrow in the mouth, wider higher up, its outline ragged by the grain
    rad = math_("MULTIPLY_ADD", z, 0.36)
    rad.inputs[2].default_value = 1.12
    q = math_("DIVIDE", ln.outputs["Value"], rad.outputs[0])
    q2 = math_("MULTIPLY_ADD", math_("SUBTRACT", nz, 0.5).outputs[0], 1.1)
    L_(q.outputs[0], q2.inputs[2])
    radial = smooth(q2.outputs[0], 0.15, 1.0, 1.0, 0.0)
    head = smooth(z, 0.0, 1.0, 1.0, 0.0)
    tail = smooth(z, 0.0, 1.0, 0.0, 1.0)
    d = math_("MULTIPLY", math_("MULTIPLY", radial.outputs[0], head.outputs[0]).outputs[0], tail.outputs[0])
    dens = math_("MULTIPLY", d.outputs[0], 0.0)
    ramp = N_("ShaderNodeMapRange")
    L_(nz, ramp.inputs["Value"])
    ramp.inputs["From Min"].default_value, ramp.inputs["From Max"].default_value = 0.35, 0.7
    mix = N_("ShaderNodeMix")
    mix.data_type = "RGBA"
    L_(ramp.outputs[0], mix.inputs["Factor"])
    mix.inputs["A"].default_value = kit.srgb(176, 98, 52)
    mix.inputs["B"].default_value = kit.srgb(220, 134, 70)
    em = N_("ShaderNodeEmission")
    L_(mix.outputs["Result"], em.inputs["Color"])
    L_(dens.outputs[0], em.inputs["Strength"])
    ab = N_("ShaderNodeVolumeAbsorption")
    ab.inputs["Color"].default_value = (0, 0, 0, 1)
    L_(dens.outputs[0], ab.inputs["Density"])
    add = N_("ShaderNodeAddShader")
    L_(em.outputs[0], add.inputs[0])
    L_(ab.outputs[0], add.inputs[1])
    L_(add.outputs[0], out.inputs["Volume"])
    VOL.update(head=head, tail=tail, dens=dens, rise=rise)
    return m


def m_body():
    return mat("body", (60, 68, 90), rough=0.5, metal=0.35, wear=(100, 110, 138), rust=(30, 32, 44), scale=3.5, dirt=0.45,
               streak=(26, 26, 34))


def m_lid():
    return mat("lid", (172, 168, 164), rough=0.45, metal=0.5, wear=(190, 184, 176), rust=(86, 80, 82), scale=3.0, dirt=0.2,
               top=(210, 204, 196), streak=(120, 112, 110))


def m_brass():
    """Flash's brass: deep gold, brown in the shade, with bright worn edges."""
    if "brass" in MATS:
        return MATS["brass"]
    m = mat("brass", (108, 57, 2), rough=0.34, metal=0.95, wear=(204, 130, 14), rust=(60, 28, 2), rust_at=0.6, mottle=0.2, wear_amt=0.6,
            scale=3.2, dirt=0.6, streak=(66, 32, 2), top=(240, 176, 30), ao_min=0.35)
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    src = bsdf.inputs["Base Color"].links[0].from_socket
    bev = nt.nodes.new("ShaderNodeBevel")
    bev.samples = 6
    bev.inputs["Radius"].default_value = 0.08
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(bev.outputs[0], dot.inputs[0])
    nt.links.new(geo.outputs["Normal"], dot.inputs[1])
    edge = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(dot.outputs["Value"], edge.inputs["Value"])
    edge.inputs["From Min"].default_value, edge.inputs["From Max"].default_value = 0.995, 0.9
    edge.inputs["To Min"].default_value, edge.inputs["To Max"].default_value = 0.0, 0.85
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(edge.outputs[0], mix.inputs["Factor"])
    nt.links.new(src, mix.inputs["A"])
    mix.inputs["B"].default_value = kit.srgb(255, 200, 44)
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return m


def m_yellow():
    return mat("yellow", (246, 164, 18), rough=0.32, metal=0.15, wear=(255, 206, 60), rust=(226, 120, 12), rust_at=0.62,
               scale=2.6, dirt=0.05, mottle=0.15, ao_min=0.7)


def m_gold():
    return mat("gold", (226, 170, 60), rough=0.3, metal=0.5, wear=(255, 232, 130), scale=4.0, dirt=0.0, mottle=0.1, ao_min=0.8)


def m_bronze():
    return mat("bronze", (146, 128, 110), rough=0.6, metal=0.25, wear=(204, 184, 152), rust=(84, 66, 54), scale=4.0, dirt=0.25)


def m_rim():
    return mat("rim", (140, 148, 176), rough=0.4, metal=0.6, wear=(196, 202, 222), rust=(36, 40, 56), scale=5.0, dirt=0.0)


def m_iron():
    return mat("iron", (40, 38, 44), rough=0.55, metal=0.6, wear=(86, 84, 94), rust=(20, 18, 20), scale=5.0, dirt=0.2)


def m_steel():
    return mat("steel", (120, 120, 128), rough=0.35, metal=0.7, wear=(200, 200, 210), rust=(50, 48, 52), scale=5.0, dirt=0.1)


def m_brown():
    return mat("brown", (132, 86, 50), rough=0.5, metal=0.3, wear=(180, 126, 76), rust=(48, 30, 20), scale=5.0)


def m_well():
    return mat("well", (122, 66, 52), rough=0.9, wear=(166, 118, 100), rust=(62, 32, 26), scale=6.0, dirt=0.2, bump=0.2)


def m_vent():
    return glow("vent", (244, 96, 8), (255, 128, 14), (255, 168, 34), 1.5, scale=0.9, cut=0.5)


def m_ray():
    return glow("ray", (120, 30, 8), (214, 70, 12), (240, 110, 20), 0.55, scale=3.0, cut=0.4)


def m_rib():
    return glow("rib", (170, 50, 8), (240, 110, 14), (255, 200, 50), 0.22, scale=2.0, cut=0.4)


def m_mouth():
    return glow("mouth", (40, 10, 4), (200, 70, 12), (255, 170, 40), 0.06, scale=2.4, cut=0.45)


def m_tank():
    return glow("tank", (200, 60, 10), (255, 130, 20), (255, 226, 90), 3.0, scale=3.4, cut=0.4)


# ------------------------------------------------------------------------------------------------------------ helpers
def mover(name):
    e = bpy.data.objects.new(name, None)
    kit.link(e)
    kit.MOVING.append(e)
    return e


def plate(name, pts, o, u, v, n, t, m, bevel=0.03, parent=None, sink=0.03):
    """A flat plate: the outline pts (a, b) in the plane through o spanned by u and v, t thick toward n."""
    bm = bmesh.new()
    o, u, v, n = Vector(o), Vector(u), Vector(v), Vector(n)
    fr = [bm.verts.new(o + u * a + v * b + n * t) for a, b in pts]
    bk = [bm.verts.new(o + u * a + v * b - n * sink) for a, b in pts]
    bm.faces.new(fr)
    bm.faces.new(bk[::-1])
    k = len(pts)
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((fr[i], bk[i], bk[j], fr[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return kit.mesh_ob(name, bm, [m], smooth=False, bevel=bevel, segs=2, parent=parent)


def rod(name, a, b, r, m, parent=None, res=5):
    ob = kit.tube(name, [Vector(a), Vector(b)], r, m, parent=parent)
    ob.data.bevel_resolution = res
    return ob


def ball(name, at, r, m, parent=None, squash=1.0):
    return kit.blob(name, Vector(at), r, squash=squash, mat=m, parent=parent)


def LF(x, z, out=0.0):
    """A point on the left face seen (Y = -HY)."""
    return Vector((x, -HY - out, z))


def RF(y, z, out=0.0):
    """A point on the right face seen (X = +HX)."""
    return Vector((HX + out, y, z))


def spline(pts, n=40):
    """A smooth path through pts (Catmull-Rom), n points."""
    pts = [Vector(p) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    segs = len(pts) - 1
    for i in range(n):
        s = i / (n - 1) * segs
        j = min(int(s), segs - 1)
        u = s - j
        p0, p1, p2, p3 = ext[j:j + 4]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


# ------------------------------------------------------------------------------------------------------------ animation
LUMP = []        # (object, path)


def sstep(a, b, x):
    u = min(1.0, max(0.0, (x - a) / (b - a)))
    return u * u * (3 - 2 * u)


def win(f, a, b, soft):
    return sstep(a, a + soft, f) * (1.0 - sstep(b - soft, b, f))


def turn(k):
    f = (k % N) / N
    w = 2 * math.pi * f
    breathe = 1.0 + 0.32 * math.sin(w - 0.6) + 0.08 * math.sin(3 * w)
    lv = {"vent": breathe, "tank": 1.0 + 0.3 * math.sin(w + 1.0), "slot": breathe, "pool": 1.0 + 0.3 * math.sin(w + 2.4),
          "rib": 1.0 + 22.0 * win(f, 0.03, 0.62, 0.09),
          "mouth": (1.0 + 40.0 * win(f, 0.5, 0.99, 0.13)) if T < 3 else (1.0 + 0.5 * win(f, 0.5, 0.99, 0.13))}
    for name, (bsdf, rest) in GLOW.items():
        bsdf.inputs["Emission Strength"].default_value = rest * lv.get(name, 1.0)
    if VOL:          # the smoke: rises out of the mouth, lets go of it, thins away; nothing left well before the loop ends
        on = 0.035 < f < 0.84
        zh = 0.5 + 3.3 * min(1.0, max(0.0, f - 0.03) / 0.5) ** 0.8
        zt = -0.9 + 3.7 * sstep(0.42, 0.82, f)          # the tail lets go of the mouth by about frame 28, as Flash's
        VOL["head"].inputs["From Min"].default_value, VOL["head"].inputs["From Max"].default_value = zh - 1.2, zh
        VOL["tail"].inputs["From Min"].default_value, VOL["tail"].inputs["From Max"].default_value = zt, zt + 0.9
        VOL["dens"].inputs[1].default_value = 3.6 * sstep(0.035, 0.12, f) * (1.0 - sstep(0.52, 0.82, f)) if on else 0.0
        VOL["rise"].inputs[1].default_value = (0.0, 0.0, 3.6 * f)
        VOL["ob"].scale = (1, 1, 1) if on else (0.001, 0.001, 0.001)
    for ob, path in LUMP:
        s = (0.04 + 0.92 * f) * (len(path) - 1)
        j = min(int(s), len(path) - 2)
        ob.location = path[j].lerp(path[j + 1], s - j)          # the path runs from the well up to the flange
        g = math.sin(math.pi * f) ** 0.5
        ob.scale = (g, g, g)


# ============================================================================================================ the parts
def body():
    kit.box("body", (2 * HX, 2 * HY, BH - 0.4), (0, 0, Z0), m_body(), bevel=0.06)
    kit.box("lid", (2 * HX + 0.14, 2 * HY + 0.14, 0.85), (0, 0, TOP - 0.85), m_lid(), bevel=0.3)
    if T >= 2:
        for i, (sx, sy) in enumerate(((1, -1), (1, 1), (-1, -1), (-1, 1))):
            kit.lathe("foot-%d" % i, [(0.0, 0.0), (0.52, 0.0), (0.56, 0.1), (0.5, 0.2), (0.44, 0.24), (0.5, 0.3), (0.46, LIFT + 0.05), (0.0, LIFT + 0.05)],
                      (sx * (HX - 0.5), sy * (HY - 0.5), 0), m_iron(), verts=20)
        # base rails on the two faces seen
        plate("rail-l", [(-HX, 0), (HX, 0), (HX, 0.42), (-HX, 0.42)], LF(0, Z0), X, Z, -Y, 0.1, m_brass())
        plate("rail-r", [(-HY, 0), (HY, 0), (HY, 0.42), (-HY, 0.42)], RF(0, Z0), Y, Z, X, 0.1, m_brass())


def posts():
    """Brass angle posts on the corners seen; the front one flares into a chevron under the lid."""
    w = 0.6 if T == 1 else 0.74
    W = 1.2 if T == 1 else 1.32
    t = 0.24
    h = BH + 0.06
    chev = [(-t, 0), (W, 0), (W, -0.35), (w, -0.35 - (W - w) * 1.5), (w, -h + 0.62), (-t, -h)]      # a pointed bottom
    plate("post-f-l", chev, LF(HX, Z0 + h), -X, Z, -Y, t, m_brass())
    plate("post-f-r", [(0.031, 0)] + chev[1:5] + [(0.031, -h)], RF(-HY, Z0 + h), Y, Z, X, t, m_brass())
    bar = [(-t, 0), (w, 0), (w, -h), (-t, -h)]
    plate("post-r-r", bar, RF(HY, Z0 + h), -Y, Z, X, t, m_brass())
    plate("post-r-b", [(0.031, 0)] + bar[1:3] + [(0.031, -h)], Vector((HX, HY, Z0 + h)), -X, Z, Y, t, m_brass())
    if T == 1:           # a short brass bracket on the left corner
        kit.box("post-l", (1.0, 1.0, 1.15), (-HX + 0.2, -HY + 0.16, Z0 + 2.2), m_brass(), bevel=0.07)
    else:
        plate("post-l-l", bar, LF(-HX, Z0 + h), X, Z, -Y, t, m_brass())
        plate("post-l-b", [(0.031, 0)] + bar[1:3] + [(0.031, -h)], Vector((-HX, -HY, Z0 + h)), Y, Z, -X, t, m_brass())
    if T == 3:           # iron horns on the posts
        for i, (x, y) in enumerate(((HX, -HY), (HX, HY), (-HX, -HY))):
            kit.cyl("horn-sock-%d" % i, 0.26, 0.16, (x * 0.93, y * 0.945, Z0 + h - 0.02), m_brass(), verts=14, bevel=0.02)
            kit.cyl("horn-%d" % i, 0.2, 0.85, (x * 0.93, y * 0.945, Z0 + h + 0.1), m_iron(), verts=14, r2=0.015, bevel=0.0)


def vent():
    """The glowing vent on the left face, fed by a thin yellow pipe from the lid."""
    x0, x1 = -1.3, 0.8
    z0, z1 = Z0 + 0.7, Z0 + (2.3 if T == 1 else 2.6)
    plate("vent-frame", [(x0 - 0.1, z0 - 0.1), (x1 + 0.1, z0 - 0.1), (x1 + 0.1, z1 + 0.1), (x0 - 0.1, z1 + 0.1)], LF(0, 0), X, Z, -Y, 0.2, mat("ventframe", (120, 40, 20), rough=0.6, metal=0.3, wear=(190, 80, 30), rust=(60, 20, 12)), bevel=0.04)
    mv = mover("vent-glow")
    plate("vent-lava", [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], LF(0, 0, 0.2), X, Z, -Y, 0.04, m_vent(), bevel=0.0, parent=mv, sink=0.0)
    # a perforated plate: a regular grid of darker slots over the glow
    dark = mat("ventbar", (150, 44, 6), rough=0.7, metal=0.0, mottle=0.0, dirt=0.0, speck=0.0, bump=0.0)
    nc, nr = 7, round((z1 - z0) / 0.4)
    for i in range(nc):
        x = x0 + (x1 - x0) * (i + 0.5) / nc
        for j in range(nr):
            z = z0 + (z1 - z0) * (j + 0.5) / nr
            plate("vent-slot-%d%d" % (i, j), [(x - 0.04, z - 0.15), (x + 0.04, z - 0.15), (x + 0.04, z + 0.15), (x - 0.04, z + 0.15)], LF(0, 0, 0.24), X, Z, -Y, 0.02, dark, bevel=0.0, sink=0.0)
    # the thin yellow pipe: up the left face from the vent, over the lid's edge, a loop on the lid, back down to the left corner
    r = 0.11
    yo, zt = -HY - 0.07 - r, TOP + r - 0.01
    pts = [(-0.35, yo, z1 + 0.1), (-0.35, yo, TOP - 0.22), (-0.35, -HY + 0.12, zt), (-0.35, -1.62, zt), (-1.35, -1.62, zt), (-1.35, -HY + 0.12, zt), (-1.35, yo, TOP - 0.22),
           (-1.35, yo, Z0 + (3.25 if T == 1 else 3.0))]
    kit.tube("feed", [Vector(p) for p in pts], r, m_yellow())
    if T >= 2:           # a steel grille over the vent
        g0, g1 = z0 - 0.22, z1 + 0.22
        out = 0.42
        for i in range(5):
            x = x0 - 0.12 + (x1 - x0 + 0.24) * i / 4
            rod("grille-bar-%d" % i, LF(x, g0, out), LF(x, g1, out), 0.07, m_steel())
        for i, z in enumerate((g0, g1)):
            rod("grille-rail-%d" % i, LF(x0 - 0.3, z, out), LF(x1 + 0.3, z, out), 0.09, m_steel())
            for j, x in enumerate((x0 - 0.3, x1 + 0.3)):
                rod("grille-stay-%d%d" % (i, j), LF(x, z, out), LF(x, z, -0.02), 0.09, m_steel())


def pipe():
    """The flange on the right face, the yellow elbow pipe down to the well in the ground, and the swelling in it."""
    c = FL
    hub = mat("hub", (120, 72, 38), rough=0.5, metal=0.35, wear=(176, 116, 62), rust=(52, 30, 18), scale=5.0)
    rod("flange", c - X * 0.02, c + X * 0.16, 0.8, hub, res=8)
    rod("flange-boss", c + X * 0.1, c + X * 0.34, 0.7, m_brown(), res=8)
    for i in range(6):
        a = math.radians(30 + 60 * i)
        d = Y * math.cos(a) + Z * math.sin(a)
        p = c + d * 1.2
        kit.tube("flange-arm-%d" % i, [c + d * 0.5 + X * 0.2, p + X * 0.2], 0.24, hub, r_end=0.15)
        rod("flange-stud-%d" % i, p - X * 0.02, p + X * 0.3, 0.13, m_gold())
        ball("flange-nut-%d" % i, p + X * 0.32, 0.22, m_gold())
    rod("stub", c + X * 0.1, c + X * 0.78, 0.56, m_brown(), res=8)
    rod("collar", c + X * 0.72, c + X * 1.0, 0.6, mat("collar", (150, 120, 100), rough=0.45, metal=0.5, wear=(200, 176, 150), rust=(80, 60, 50)), res=8)
    dx = WELL.x - c.x
    dy = WELL.y - c.y
    path = spline([c + X * 0.9, c + X * (dx - 0.5) + Y * dy * 0.5 + Z * -0.2, c + X * (dx - 0.12) + Y * dy + Z * -0.75, Vector((WELL.x, WELL.y, 0.3))], 48)
    ob = kit.tube("elbow", path, 0.5, m_yellow())
    ob.data.bevel_resolution = 6
    mv = mover("lump")
    lump = ball("lump-ball", path[0], 0.66, m_yellow(), parent=mv)
    LUMP.append((lump, path[::-1]))
    # the well
    w = WELL
    kit.lathe("well", [(0.0, 0.0), (1.0, 0.0), (1.05, 0.1), (0.98, 0.3), (0.8, 0.4), (0.56, 0.4), (0.56, 0.2), (0.0, 0.2)], w, m_well(), verts=28)
    kit.cyl("well-neck", 0.62, 0.5, w, mat("neck", (128, 122, 122), rough=0.5, metal=0.5, wear=(180, 176, 176), rust=(70, 60, 60)), verts=24, bevel=0.03)
    for i in range(10):
        a = math.radians(18 + 36 * i)
        ball("well-rivet-%d" % i, w + Vector((1.02 * math.cos(a), 1.02 * math.sin(a), 0.17)), 0.1, mat("rivet", (70, 30, 24), rough=0.6, metal=0.3, wear=(120, 60, 44)))
    if T == 3:           # an iron curb and a ring of magma round the well
        mp = mover("pool")
        kit.lathe("pool-ring", [(1.05, 0.0), (1.27, 0.0), (1.27, 0.07), (1.05, 0.07)], w, glow("pool", (150, 36, 8), (240, 100, 16), (255, 200, 60), 2.2, scale=4.0), verts=28, parent=mp)
        kit.lathe("well-curb", [(1.25, 0.0), (1.41, 0.0), (1.39, 0.14), (1.27, 0.16), (1.25, 0.0)], w, m_iron(), verts=28)


def pot():
    """The smoke pot on the lid: a squat stone bowl (a riveted band, a short flare with glowing ribs, a thick ring of
    steel blocks round a wide dark mouth) whose short stone collar stands directly on the lid; orange rays fan out from
    its base across the lid, with a small patch of glow on the lid at the front of the base; the smoke."""
    base = POT + Z * TOP
    c = base                          # the pot's base is on the lid: no neck, no gap
    H = POT_H
    r0, r1, ri = 1.32, 1.6, 1.1     # the band, the rim's outside, the mouth
    rc, zc = 1.14, 0.34               # the collar the pot stands on: its radius and top
    zb = zc + 0.72                    # the band's top
    zr = H - 0.17                     # the rim's underside
    before = set(bpy.data.objects)
    neck = glow("potneck", (176, 40, 6), (236, 84, 10), (255, 136, 22), 0.8, scale=3.0, cut=0.4)
    cam = Vector((1, -1, 0)).normalized()
    kit.cyl("pot-glow", 0.56, 0.02, base + cam * (rc - 0.12) + Z * 0.012, neck, verts=24, bevel=0.0)      # the glow at the base's front
    prof = [(0.6, -0.02), (rc + 0.05, -0.02), (rc + 0.05, 0.07), (rc, 0.13), (rc - 0.02, zc - 0.05), (r0 - 0.06, zc), (r0, zc + 0.07),
            (r0 + 0.02, zb - 0.05), (r0 - 0.01, zb), (r1 - 0.06, zr), (r1 - 0.06, H - 0.08), (ri, H - 0.08)]
    ob = kit.lathe("pot", prof, c, m_bronze(), verts=10)          # ten flat sides, as Flash's faceted pot
    ob.data.polygons.foreach_set("use_smooth", [False] * len(ob.data.polygons))
    dark = mat("potdark", (30, 20, 16), rough=0.9, mottle=0.0, speck=0.0, dirt=0.0, bump=0.0)
    kit.lathe("pot-well", [(ri + 0.01, H - 0.07), (ri - 0.06, 0.3), (0.0, 0.3)], c, dark, verts=28)
    # the rim: thick steel blocks with gaps (Flash's segmented ring)
    nb = 10
    for i in range(nb):
        a0, a1 = 2 * math.pi * (i + 0.07) / nb, 2 * math.pi * (i + 0.93) / nb
        pts = []
        for rr in (r1 + 0.02, ri - 0.02):
            seq = [a0, a1]
            if rr < r1:
                seq = seq[::-1]
            pts += [(rr * math.cos(a), rr * math.sin(a)) for a in seq]
        plate("rim-%d" % i, pts, c + Z * zr, X, Y, Z, 0.17, m_rim(), bevel=0.04, sink=0.0)
    for i in range(10):
        a = 2 * math.pi * (i + 0.5) / 10
        d = Vector((math.cos(a), math.sin(a), 0))
        ball("pot-rivet-%d" % i, c + d * (r0 + 0.03) + Z * (zc + 0.4), 0.1, m_gold())
    mr = mover("ribs")
    for i in range(10):
        a = 2 * math.pi * i / 10
        d = Vector((math.cos(a), math.sin(a), 0))
        rod("rib-%d" % i, c + d * (r0 + 0.02) + Z * (zb + 0.02), c + d * (r1 - 0.05) + Z * (zr - 0.02), 0.05, m_rib(), parent=mr)
    mm = mover("mouth")
    if T < 3:            # dark at rest: only its glow shows
        bs = GLOW.get("mouth") or (m_mouth() and GLOW["mouth"])
        for l in list(bs[0].inputs["Base Color"].links):
            bs[0].id_data.links.remove(l)
        bs[0].inputs["Base Color"].default_value = kit.srgb(34, 18, 12)
    kit.cyl("mouth-lava", ri - 0.08, 0.05, c + Z * (H - 0.55 if T < 3 else H - 0.3), m_mouth() if T < 3 else glow("mouth", (190, 50, 8), (250, 120, 18), (255, 210, 70), 1.6, scale=2.4, cut=0.45),
            verts=28, bevel=0.0, parent=mm)
    # the sunburst: glowing rays flat on the lid, fanning out from under the pot (kept clear of the pipes on the lid)
    nr = 14
    for i in range(nr):
        a = 2 * math.pi * (i + 0.5) / nr
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        lim = [((1.56 if d.x > 0 else -1.56) - POT.x) / d.x if abs(d.x) > 1e-3 else 9.0,
               ((1.14 if d.y > 0 else -1.36) - POT.y) / d.y if abs(d.y) > 1e-3 else 9.0]
        reach = min(2.6, *lim)
        r_in = rc - 0.04              # the rays start under the collar's edge
        ln = reach - r_in
        if ln < 0.35:
            continue
        plate("ray-%d" % i, [(0.0, -0.085), (ln, -0.02), (ln, 0.02), (0.0, 0.085)], base + d * r_in, d, side, Z, 0.012, m_ray(), bevel=0.0, sink=0.02)
    if T >= 2:           # brass rings under the rim and round the band's foot
        kit.ring("pot-crown", r1 - 0.02, 0.08, m_brass(), z=0.0).location = c + Z * (zr - 0.06)
        kit.ring("pot-belt", r0 + 0.03, 0.07, m_brass(), z=0.0).location = c + Z * (zc + 0.06)
    if T == 3:           # iron spikes on the rim
        for i in range(nb):
            a = 2 * math.pi * (i + 0.5) / nb
            d = Vector((math.cos(a), math.sin(a), 0))
            kit.cyl("pot-spike-%d" % i, 0.12, 0.6, c + d * ((r1 + ri) / 2 + 0.06) + Z * (H - 0.03), m_iron(), verts=10, r2=0.01, bevel=0.0,
                    rot=(math.degrees(-0.35 * d.y), math.degrees(0.35 * d.x), 0))
    # lean the pot (everything made above but the glow and the rays on the lid) about its base
    lean = Vector((-1, 1, 0)).normalized()
    M = Matrix.Translation(c) @ Matrix.Rotation(math.radians(TILT), 4, Z.cross(lean)) @ Matrix.Translation(-c)
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o not in before and o.parent is None and not o.name.startswith(("pot-glow", "ray-")):
            o.matrix_world = M @ o.matrix_world
    # the smoke
    ms = mover("smoke")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=2.0, radius2=3.7, depth=4.6)
    for v in bm.verts:
        v.co.z += 2.3 - 0.4
    ob = kit.mesh_ob("smoke-column", bm, [smoke_mat()], bevel=0.0, parent=ms)
    ob.location = M @ (c + Z * (H - 0.35))          # out of the leaning mouth, straight up
    VOL["ob"] = ob


def tank():
    """Tier 2 on: a magma sight tank on the right face's far post, piped up to the lid."""
    y = 2.1
    h = 1.35 if T == 2 else 1.9
    z = Z0 + 1.0
    o = RF(y, z, 0.56)
    rod("tank-arm-a", RF(y, z + 0.1, 0.1), o + Z * 0.1, 0.1, m_brass())
    rod("tank-arm-b", RF(y, z + h - 0.1, 0.1), o + Z * (h - 0.1), 0.1, m_brass())
    kit.cyl("tank-base", 0.44, 0.2, o, m_brass(), verts=20, bevel=0.03)
    mt = mover("tank-glow")
    kit.cyl("tank-glass", 0.36, h - 0.3, o + Z * 0.18, m_tank(), verts=20, bevel=0.0, parent=mt)
    kit.cyl("tank-cap", 0.44, 0.2, o + Z * (h - 0.16), m_brass(), verts=20, bevel=0.03)
    for i in range(3):
        a = math.radians(-100 + 100 * i)
        d = Vector((math.cos(a), math.sin(a), 0))
        rod("tank-stay-%d" % i, o + d * 0.4 + Z * 0.15, o + d * 0.4 + Z * (h - 0.1), 0.04, m_brass())
    top = o + Z * (h + 0.04)
    if T == 3:
        ball("tank-dome", top - Z * 0.02, 0.36, m_iron(), squash=0.7)
        kit.cyl("tank-spike", 0.09, 0.4, top + Z * 0.18, m_iron(), verts=10, r2=0.01, bevel=0.0)
    r = 0.075
    zt = TOP + r - 0.01
    side = Vector((HX + 0.06 + r, y - 0.62, 0))
    pts = [top - Z * 0.05 - Y * 0.3, Vector((top.x, side.y, top.z + 0.12)), Vector((side.x, side.y, top.z + 0.12)), Vector((side.x, side.y, TOP - 0.22)),
           Vector((HX - 0.12, side.y, zt)), Vector((1.2, side.y, zt)), Vector((1.2, side.y, TOP - 0.1))]
    kit.tube("tank-feed", pts, r, m_yellow())
    kit.cyl("tank-feed-sock", 0.15, 0.07, (1.2, side.y, TOP - 0.01), m_brass(), verts=14, bevel=0.02)


def belt():
    """Tier 3: a riveted iron belt round the lid's side on both faces seen, with glowing slots. On the left face it is
    two short plates that sit between the feed pipes and the front post, so no pipe crosses it."""
    z0, z1 = TOP - 0.66, TOP - 0.2
    ms = mover("slots")
    slot = glow("slot", (200, 54, 8), (255, 126, 18), (255, 224, 80), 3.0, scale=3.0, cut=0.4)
    o = 0.07                                   # the lid stands this far out from the body
    spans = [("l0", LF, X, -Y, -1.06, -0.56, 2), ("l1", LF, X, -Y, -0.13, HX - 1.44, 2), ("r", RF, Y, X, -HY + 1.44, 1.14, 6)]
    for name, F, u, n, a0, a1, k in spans:
        plate("belt-" + name, [(a0, z0), (a1, z0), (a1, z1), (a0, z1)], F(0, 0, o), u, Z, n, 0.09, m_iron(), bevel=0.03)
        for i in range(k):
            x = a0 + (a1 - a0) * (i + 0.5) / k
            plate("slot-%s-%d" % (name, i), [(x - 0.065, z0 + 0.1), (x + 0.065, z0 + 0.1), (x + 0.065, z1 - 0.1), (x - 0.065, z1 - 0.1)], F(0, 0, o + 0.09), u, Z, n, 0.012, slot, bevel=0.0, parent=ms, sink=0.0)
        for i, x in enumerate((a0 + 0.07, a1 - 0.07)):
            for j, z in enumerate((z0 + 0.07, z1 - 0.07)):
                ball("belt-rivet-%s%d%d" % (name, i, j), F(x, z, o + 0.09), 0.045, m_brass())


def build():
    body()
    posts()
    vent()
    pipe()
    pot()
    if T >= 2:
        tank()
    if T == 3:
        belt()


_border = kit.border_of


def border_all(objs, pad=10):
    """The moving parts' render region over the whole loop."""
    bs = []
    for k in range(0, N, 2):
        turn(k)
        bpy.context.view_layer.update()
        bs.append(_border(objs, pad))
    turn(0)
    bpy.context.view_layer.update()
    return min(b[0] for b in bs), max(b[1] for b in bs), min(b[2] for b in bs), max(b[3] for b in bs)


kit.border_of = border_all


# ------------------------------------------------------------------------------------------------------------- damaged
# One rough pass (owner: this only roughly follows Flash's top.1.damaged.v2): PB_STATE=damaged with mode `base`.
#   PB_STATE=damaged PB_K=6 sh run.sh <tier> base   ->  render/L<tier>-damaged-base.png, -alone.png
# Destroyed is Flash's rubble, as for every other 3D building: there is no 3D destroyed look.
# Nothing here runs without PB_STATE: the whole model and its renders are as they were.
STATE = kit.STATE


def scorch(amount, cut=0.5):
    """Soot over every paint: patches of near black, `amount` of the colour left under them."""
    for m in list(bpy.data.materials):
        nt = m.node_tree
        if nt is None:
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        inp = bsdf.inputs["Base Color"]
        if inp.is_linked:
            src = inp.links[0].from_socket
        else:
            rgb = nt.nodes.new("ShaderNodeRGB")
            rgb.outputs[0].default_value = inp.default_value
            src = rgb.outputs[0]
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.6
        nz.inputs["Detail"].default_value = 5.0
        nz.inputs["Roughness"].default_value = 0.65
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = cut - 0.1, grey(amount)
        ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = cut + 0.12, grey(0.85)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        nt.links.new(nz.outputs[0], ramp.inputs[0])
        nt.links.new(src, mix.inputs[6])
        nt.links.new(ramp.outputs[0], mix.inputs[7])
        nt.links.new(mix.outputs[2], inp)


def about(pivot, axis, deg):
    return Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-Vector(pivot))


def lean(pivot, d, deg):
    """Tip what stands on `pivot` over toward the level direction d."""
    d = Vector(d).normalized()
    return about(Vector(pivot), Z.cross(d), deg)


def knock(tag, M, names=(), prefixes=(), skip=()):
    """Move the named objects (and what hangs on them) by M: they are hung on a new empty."""
    e = bpy.data.objects.new("knock-" + tag, None)
    kit.link(e)
    for o in list(bpy.data.objects):
        if o is e or o.parent is not None or o.name.startswith("knock-") or o.name.startswith(tuple(skip) or ("\0",)):
            continue
        if o.name in names or (prefixes and o.name.startswith(tuple(prefixes))):
            o.parent = e
    e.matrix_world = M


def patch(name, at, size, m, jag=0.35, seed=0.0):
    """A ragged lump or (one size small) a ragged flat patch."""
    from mathutils import noise
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        k = 1.0 + jag * noise.noise(Vector((v.co.x * 1.7 + seed, v.co.y * 1.7, v.co.z * 1.7 + seed * 0.37)))
        v.co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2] * k))
    ob = kit.mesh_ob(name, bm, [m], smooth=False)
    ob.location = Vector(at)
    return ob


def crack(name, pts, m, r=0.055):
    kit.tube(name, [Vector(p) for p in pts], r, m, r_end=r * 0.3)


def wreck_dark():
    """Before the soot: holes, dents and cracks in the box, lid and pot, stones and plates at the feet."""
    rr = random.Random(7)
    soot = mat("hole", (9, 7, 7), rough=0.95, dirt=0.0, mottle=0.0, speck=0.0, bump=0.0)
    # the left face: a hole torn low at its near end, a dent beside the vent, cracks up to the lid
    patch("hole-l0", LF(1.25, Z0 + 0.75, 0.0), (0.5, 0.1, 0.62), soot, seed=1.0)
    patch("hole-l1", LF(-1.5, Z0 + 3.0, 0.0), (0.34, 0.1, 0.3), soot, seed=2.0)
    crack("crack-l0", [LF(1.0, Z0 + 1.2, 0.05), LF(0.75, Z0 + 1.9, 0.05), LF(1.02, Z0 + 2.45, 0.05), LF(0.8, Z0 + 3.1, 0.05)], soot)
    crack("crack-l1", [LF(0.75, Z0 + 1.9, 0.05), LF(0.3, Z0 + 2.6, 0.05), LF(0.42, Z0 + 3.0, 0.05)], soot, 0.04)
    # the right face: a blast hole above the flange, cracks from it
    patch("hole-r0", RF(0.5, Z0 + 3.05, 0.0), (0.1, 0.75, 0.5), soot, seed=3.0)
    patch("hole-r1", RF(-1.3, Z0 + 0.7, 0.0), (0.1, 0.4, 0.46), soot, seed=4.0)
    crack("crack-r0", [RF(0.2, Z0 + 2.7, 0.05), RF(-0.5, Z0 + 2.9, 0.05), RF(-0.75, Z0 + 2.35, 0.05), RF(-1.3, Z0 + 2.2, 0.05)], soot)
    crack("crack-r1", [RF(1.0, Z0 + 2.8, 0.05), RF(1.3, Z0 + 2.2, 0.05), RF(1.1, Z0 + 1.7, 0.05), RF(1.45, Z0 + 1.0, 0.05)], soot)
    # the lid: a corner broken in, cracks across it from the pot
    zl = TOP + 0.02
    patch("hole-lid", (HX - 0.55, -HY + 0.85, TOP), (0.6, 0.5, 0.09), soot, seed=5.0)
    crack("crack-lid0", [(0.5, 0.1, zl), (0.9, -0.5, zl), (0.7, -1.0, zl), (1.25, -1.5, zl)], soot, 0.06)
    crack("crack-lid1", [(0.7, 0.9, zl), (1.2, 0.7, zl), (1.4, 1.2, zl), (1.75, 1.1, zl)], soot, 0.05)
    crack("crack-lid2", [(-1.0, -0.6, zl), (-0.8, -1.2, zl), (-1.1, -1.6, zl)], soot, 0.045)
    # at the feet: stones off the pot and plates off the box
    stone = mat("rubble", (96, 84, 80), rough=0.9, wear=(140, 128, 120), dirt=0.3, scale=6.0)
    navy = m_body()
    for i, (x, y, s) in enumerate([(-1.2, -3.3, 0.3), (-0.2, -3.9, 0.22), (1.3, -3.5, 0.34), (2.5, -3.2, 0.26), (3.0, -2.2, 0.3), (3.4, -3.0, 0.18),
                                   (2.9, 1.1, 0.3), (3.9, 1.5, 0.22), (1.9, -4.2, 0.2), (0.4, -4.6, 0.16), (-2.3, -3.2, 0.2), (4.6, -1.4, 0.17)]):
        patch("rubble%d" % i, (x, y, s * 0.45), (s, s * rr.uniform(0.7, 1.0), s * 0.7), stone, jag=0.5, seed=i * 1.9)
    for i, (x, y, sz, rz) in enumerate([(2.2, -3.9, (0.9, 0.6), 30), (-0.6, -4.3, (0.7, 0.5), -20), (3.6, 0.3, (0.6, 0.7), 55)]):
        kit.box("fallenplate%d" % i, (sz[0], sz[1], 0.08), (x, y, 0.05), navy, rot=(rr.uniform(-9, 9), rr.uniform(-9, 9), rz), bevel=0.015)
    # a block off the pot's rim, on the lid's edge and on the ground
    kit.box("fallenrim0", (0.62, 0.42, 0.2), (2.9, -3.9, 0.02), m_rim(), rot=(8, -6, 25), bevel=0.04)
    # where the elbow came off: the stub's open end
    kit.cyl("stubhole", 0.44, 0.03, FL + X * 1.0, soot, rot=(0, 90, 0), verts=20, bevel=0.0)


def wreck_magma(lip, pd):
    """After the soot: magma down the pot and across the lid from the tilted mouth, down the left face over the dead
    vent, out of the open stub, and pooled at the feet."""
    spill = glow("spill", (196, 44, 6), (252, 116, 16), (255, 216, 76), 2.6, scale=2.6, cut=0.42)
    crust = glow("crust", (44, 14, 10), (170, 34, 10), (250, 110, 22), 1.5, scale=3.2, cut=0.56)
    c = POT + Z * TOP
    edge = c + pd * ((-HY - 0.02 - c.y) / pd.y)             # where the run meets the lid's left edge
    side = Vector((-pd.y, pd.x, 0))
    for j, (off, r, low) in enumerate(((0.0, 0.2, Z0 + 0.25), (0.42, 0.13, Z0 + 1.7), (-0.4, 0.12, Z0 + 2.6))):
        o = side * off
        pts = [lip + o * 0.6 + Z * 0.05, lip + o * 0.7 + pd * 0.2 - Z * 0.5, c + o + pd * 1.62 + Z * 0.5, c + o + pd * 1.9 + Z * 0.1,
               edge + o + Z * 0.1, edge + o - Y * 0.2 - Z * 0.25, Vector((edge.x + o.x, -HY - 0.3, (TOP + low) / 2)), Vector((edge.x + o.x * 1.3, -HY - 0.3, low))]
        kit.tube("spill%d" % j, pts, r, spill, r_end=r * 0.6, smooth=True)
    kit.blob("spill-lid", tuple(c + pd * 1.95 + Z * 0.03), 1.0, 0.07, spill, stretch=(0.95, 0.6)).rotation_euler = (0, 0, math.atan2(pd.y, pd.x) + math.pi / 2)
    kit.blob("spill-mouth", tuple(lip - pd * 0.5 - Z * 0.18), 0.55, 0.3, spill)
    # out of the open stub
    s = FL + X * 0.95
    kit.tube("stubdrip", [s - Z * 0.2, s + X * 0.22 - Z * 0.75, Vector((s.x + 0.2, s.y - 0.1, 0.1))], 0.2, spill, r_end=0.13, smooth=True)
    # pools and crusted lumps at the feet
    ex = edge.x
    for i, (x, y, sx, sy, rz) in enumerate([(ex + 0.1, -HY - 0.95, 1.05, 0.62, 35), (HX + 0.75, -0.55, 0.8, 0.55, -30), (HX + 0.6, -HY - 0.5, 0.6, 0.4, 10)]):
        kit.blob("pool%d" % i, (x, y, 0.02), 1.0, 0.06, spill, stretch=(sx, sy)).rotation_euler = (0, 0, math.radians(rz))
    rr = random.Random(19)
    for i, (x, y, sz) in enumerate([(ex - 0.9, -3.7, 0.3), (ex + 1.0, -4.1, 0.36), (2.6, -2.9, 0.3), (3.3, -1.3, 0.34), (2.3, -1.6, 0.24), (ex + 0.2, -4.5, 0.22),
                                   (3.9, -2.2, 0.2), (-1.6, -4.0, 0.18)]):
        patch("lump%d" % i, (x, y, sz * 0.4), (sz, sz * rr.uniform(0.75, 1.0), sz * 0.62), crust, jag=0.55, seed=4.4 * i + 2)


def build_state():
    build()
    if not STATE:
        return
    kit.MOVING.clear()                      # a state is one still: nothing is held back for a strip
    bpy.context.view_layer.update()         # so every object's matrix_world is its real place before it is knocked
    wreck_dark()
    for name in ("vent", "ventbar"):        # the vent is dead: black behind its plate
        bs = next(n for n in MATS[name].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        for l in list(bs.inputs["Base Color"].links):
            MATS[name].node_tree.links.remove(l)
        bs.inputs["Base Color"].default_value = kit.srgb(26, 13, 10) if name == "vent" else kit.srgb(12, 8, 8)
    scorch(0.3, 0.5)
    # the fires gutter: the vent is dead, the rest dim (turn() sets every glow from its rest strength)
    dim = {"vent": 0.04, "slot": 0.12, "tank": 0.3, "pool": 0.6, "rib": 0.5, "ray": 0.5, "potneck": 0.8, "mouth": 1.0}
    for name, (bsdf, rest) in list(GLOW.items()):
        GLOW[name] = (bsdf, rest * dim.get(name, 0.4))
    if T < 3:                               # the pot's mouth, dark at rest, stands full of magma
        bs = GLOW["mouth"][0]
        bs.inputs["Base Color"].default_value = kit.srgb(236, 100, 14)
        GLOW["mouth"] = (bs, 1.6)
    c = POT + Z * TOP
    pd = Vector((0.36, -0.93, 0)).normalized()               # the way the pot tips: toward the lid's left edge
    Mp = lean(c + pd * 1.1, pd, 17) @ about(c, Z, 12)
    lip = Mp @ (c + (Matrix.Rotation(math.radians(-12), 4, Z) @ pd) * 1.5 + Z * (POT_H - 0.02))
    wreck_magma(lip, pd)
    # a block gone from the pot's rim (it lies at the feet), then the pot cracked off its seat and tilted
    for n in ("rim-7", "pot-spike-7"):
        o = bpy.data.objects.get(n)
        if o is not None:
            bpy.data.objects.remove(o)
    knock("pot", Mp, names=("ribs", "mouth", "smoke"), prefixes=("pot", "rim-"), skip=("pot-glow",))
    soot = MATS["hole"]
    for i, a in enumerate((250, 320, 20)):                   # cracks down the pot
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        pts = [c + d * 1.56 + Z * 1.85, c + d * 1.5 + Vector((-d.y, d.x, 0)) * 0.16 + Z * 1.45, c + d * 1.36 + Z * 1.0, c + d * 1.37 + Vector((-d.y, d.x, 0)) * -0.14 + Z * 0.55]
        crack("crack-pot%d" % i, [Mp @ p for p in pts], soot, 0.06)
    # a corner post torn off: it lies on the ground in front of the left face (tier 1: its bracket; the far post leans out)
    P = Vector((-HX, -HY, Z0))
    fall = Matrix.Translation(Vector((-0.2, -1.5, 0.16 - Z0))) @ about(P, Z, 78) @ about(P, X, 84)
    if T == 1:
        knock("post-l", Matrix.Translation(Vector((0.1, -1.5, -(Z0 + 2.2) + 0.05))) @ about(Vector((-HX + 0.2, -HY + 0.16, Z0 + 2.2)), Z, 28) @ about(Vector((-HX + 0.2, -HY + 0.16, Z0 + 2.2)), X, 14), names=("post-l",))
        knock("post-r", lean(Vector((HX, HY, Z0)), (0.75, 0.66, 0), 27), names=("post-r-r", "post-r-b"))
    else:
        knock("post-l", fall, names=("post-l-l", "post-l-b", "horn-2", "horn-sock-2"))
        knock("rail-l", about(LF(HX, Z0), Y, -9) @ Matrix.Translation(Vector((0, -0.12, -0.2))), names=("rail-l",))
    # the elbow pipe knocked loose from its stub: it leans out on the well
    wp = Vector((WELL.x, WELL.y, 0.3))
    knock("elbow", lean(wp, (1, 0, 0), 27) @ lean(wp, (0, -1, 0), 13), names=("elbow", "lump"))
    if T >= 2:
        g1 = Z0 + 2.6 + 0.22                # the grille hangs by one corner, pulled out from the face
        gp = LF(-1.6, g1, 0.42)
        knock("grille", about(gp, Y, -15) @ about(gp, Z, -13), prefixes=("grille",))
        to = RF(2.1, Z0 + 1.0, 0.56)        # the sight tank bent on its arms
        knock("tank", lean(to, (0.6, -0.8, 0), 19), names=("tank-glow",), prefixes=("tank-arm", "tank-base", "tank-cap", "tank-stay", "tank-dome", "tank-spike"))


kit.run(build_state, turn)
