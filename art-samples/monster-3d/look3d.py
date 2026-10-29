"""look3d.py (copied from art/buildings-3d art-samples/tower-3d at 400fc3f16 for the monster trial; only change: the
ground-shade ramp is the module value GROUND, so a short monster can set its own) : the shared look of the 3D towers (Cannon, Laser, Sniper; owner, 27 Oct 2026), so all of them share one camera,
one light, one outline and one set of painted-look materials. Import it from a tower script run inside Blender 5.2:

    import sys; from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tower-3d"))
    import look3d as L

    L.canvas(620, 640, (163, 323, 421, 577), out_dir)   # the painted tier's 4x canvas and its body's box on it
    ... build the tower with L.lathe / L.tube / L.rbox / L.studs and the L.mat_* materials, L.add_outline(ob, L.line("warm"))
    cam = L.setup_render()
    box = L.fit(cam, L.objs_under(body))                 # camera scaled and moved so the body covers the painted body's box
    L.shot(path, body_objs)                              # body alone
    L.shot(path, turret_objs, cut=body_objs, avoid=body_alpha)   # turret alone, body parts in front of it cut out

Conventions: units are free (the Cannon uses drum radii); ground bearing b (the game's heading: 0 = down-right on screen,
45 = at the viewer, 135 = left, 225 = away, 315 = right) is the Blender direction (sin b, cos b, 0), see `bear`. The camera
is orthographic, looking down at EL degrees from the viewer's side (bearing 45); the sun comes from the upper left (SUN).

The look ("painted", not realistic): every material reads the sun's light on a white surface (with cast shadows) back as a
number and maps it through a colour ramp (cool shade to warm light, or a metal's own dark-edge-to-highlight ramp), darker
toward the ground, a little ambient occlusion, a sheen and a highlight on metal, all drawn as flat colour. Every part gets a
dark outline (an inverted hull, drawn in a second pass so it casts no shadow), and the whole silhouette a thicker one (OUTER).
"""
import math
import os
from pathlib import Path

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

EL = 23.0                   # camera elevation: the Flash renders' ellipses (ring 0.38 tall for 1 wide) say 22-24
SUN = (112, 46)             # the light comes from bearing 112 (screen left, a little toward the viewer), 46 degrees up
LINE = 0.024                # inside outline width, in model units (the Cannon's drum radius = 1: about 2 px at 4x)
GLINT = tuple(Vector((math.sin(math.radians(75)) * 0.82, math.cos(math.radians(75)) * 0.82, 0.57)).normalized())
                            # the painted window highlight faces this way (toward the viewer's left, up)
OUTER = 1.0                 # the silhouette's extra outline, in 4x pixels, on top of the inside line
GROUND = [(0.0, (0.5, 0.48, 0.52, 1)), (0.35, (0.76, 0.75, 0.76, 1)), (1.0, (1, 1, 1, 1))]   # world height to a shade factor
DEBUG_LIGHT = bool(os.environ.get('LOOK3D_DEBUG_LIGHT'))   # draw only the sun's light, for checks

W, H = 620, 640             # the 4x canvas (set with canvas())
BODY_BOX = (163, 323, 421, 577)
OUT = Path(".")


def canvas(w, h, body_box, out_dir):
    global W, H, BODY_BOX, OUT
    W, H, BODY_BOX, OUT = w, h, tuple(body_box), Path(out_dir)
    OUT.mkdir(parents=True, exist_ok=True)


# ----------------------------------------------------------------------------------------------------------------- helpers
def diag(x, y, z):
    return Matrix(((x, 0, 0, 0), (0, y, 0, 0), (0, 0, z, 0), (0, 0, 0, 1)))


def srgb(r, g, b):
    """0-255 sRGB to linear 0-1."""
    def f(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)


def sgn(x):
    return (x > 0) - (x < 0)


def bear(b, d=1.0, z=0.0):
    """The point d out at ground bearing b, height z."""
    return Vector((d * math.sin(math.radians(b)), d * math.cos(math.radians(b)), z))


def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def obj_from_bm(name, bm, mats, parent=None, smooth=True, sharp=40):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
        try:
            me.set_sharp_from_angle(angle=math.radians(sharp))
        except Exception:
            pass
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def lathe(name, segs, mats, n=96, mat_of_seg=None, parent=None, sharp=40):
    """A turned part round the Z axis. segs: lists of (r, z) profile points, bottom-outside first (each list its own smooth
    strip, so the seams between lists are hard edges). mat_of_seg: the material slot of each list."""
    bm = bmesh.new()
    for si, seg in enumerate(segs):
        rings = []
        for r, z in seg:
            ring = [bm.verts.new((max(r, 1e-4) * math.cos(2 * math.pi * j / n), max(r, 1e-4) * math.sin(2 * math.pi * j / n), z))
                    for j in range(n)]
            rings.append(ring)
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for j in range(n):
                f = bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
                f.material_index = mat_of_seg[si] if mat_of_seg else 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return obj_from_bm(name, bm, mats, parent, sharp=sharp)


def band(r0, r1, z0, z1, bev=0.02):
    """A lathe profile for a raised band: outer radius r1 from z0 to z1 over a body of radius r0, softly bevelled."""
    return [(r0, z0), (r1 - bev * 0.4, z0), (r1, z0 + bev), (r1, z1 - bev), (r1 - bev * 0.4, z1), (r0, z1)]


def tube(bm, pts, radii, sides=14, cap=True, flat=1.0, mat=0):
    """Sweep a circle of the given radii along pts (parallel-transported frames) into bm. flat < 1 squashes the circle
    across the bend plane (a flattened horn)."""
    pts = [Vector(p) for p in pts]
    tans = []
    for i in range(len(pts)):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        tans.append((b - a).normalized())
    up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(up).normalized()
    rings = []
    for i, (p, t) in enumerate(zip(pts, tans)):
        if i:
            nrm = (nrm - t * nrm.dot(t)).normalized()
        bi = t.cross(nrm).normalized()
        r = radii[i]
        rings.append([bm.verts.new(p + r * (math.cos(2 * math.pi * j / sides) * nrm * flat +
                                            math.sin(2 * math.pi * j / sides) * bi)) for j in range(sides)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(sides):
            f = bm.faces.new((a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]))     # wound so normals face out
            f.material_index = mat
    if cap:
        for ring in (list(reversed(rings[0])), rings[-1]):
            f = bm.faces.new(ring)
            f.material_index = mat
    return rings


def bezier(p0, p1, p2, p3, n=16):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    return [((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
            for t in (i / (n - 1) for i in range(n))]


def add_mesh(bm, sub, mat_world, mat=0):
    me = bpy.data.meshes.new("_tmp")
    sub.to_mesh(me)
    sub.free()
    me.transform(mat_world)
    for p in me.polygons:
        p.material_index = mat
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def rbox(bm, size, mat_world, bevel=0.06, segs=3, taper=1.0, mat=0, taper_y=None):
    """A rounded box (size x, y, z; base at z=0) transformed by mat_world; taper scales the top face (taper_y its depth)."""
    sub = bmesh.new()
    bmesh.ops.create_cube(sub, size=1.0)
    ty = taper if taper_y is None else taper_y
    for v in sub.verts:
        v.co.z += 0.5
        if v.co.z > 0.5:
            v.co.x *= taper
            v.co.y *= ty
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(sub, geom=list(sub.edges) + list(sub.verts), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    add_mesh(bm, sub, mat_world, mat)


def studs(bm, centres, normals, r=0.035, mat=0):
    """Rivet heads: little flattened domes at centres, facing normals."""
    for c, n in zip(centres, normals):
        n = Vector(n).normalized()
        q = Vector((0, 0, 1)).rotation_difference(n)
        m = Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4() @ diag(r, r, r * 0.55)
        sub = bmesh.new()
        bmesh.ops.create_uvsphere(sub, u_segments=10, v_segments=6, radius=1.0)
        bmesh.ops.delete(sub, geom=[v for v in sub.verts if v.co.z < -0.2], context='VERTS')
        add_mesh(bm, sub, m, mat)


def ring_of(n, r, z, phase=0.0):
    pts = [Vector((r * math.cos(2 * math.pi * (k + phase) / n), r * math.sin(2 * math.pi * (k + phase) / n), z)) for k in range(n)]
    return pts, [Vector((p.x, p.y, 0)) for p in pts]


# --------------------------------------------------------------------------------------------------------------- materials
class Paint:
    """A painted-look material: the sun's light on a white diffuse surface (with cast shadows) is read back as a number and
    mapped through a soft ramp (`shade`), times the paint colour and a little ambient occlusion, plus a highlight from a
    glossy surface; all of it drawn as flat colour (emission), so the colours come out as picked."""

    def __init__(self, name):
        self.m = bpy.data.materials.new(name)
        self.m.use_nodes = True
        self.nt = self.m.node_tree
        for n in list(self.nt.nodes):
            self.nt.nodes.remove(n)
        self.N = self.nt.nodes
        self.tc = self.N.new("ShaderNodeTexCoord")

    def link(self, a, b):
        self.nt.links.new(a, b)

    def node(self, kind, **inputs):
        n = self.N.new(kind)
        for k, v in inputs.items():
            if hasattr(v, "is_linked") or (hasattr(v, "node") and hasattr(v, "links")):
                self.link(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                self.link(v, n.inputs[i])
        return n.outputs[0]

    def ramp(self, src, stops, interp='LINEAR'):
        r = self.N.new("ShaderNodeValToRGB")
        r.color_ramp.interpolation = interp
        el = r.color_ramp.elements
        el[0].position, el[0].color = stops[0]
        el[1].position, el[1].color = stops[-1]
        for pos, col in stops[1:-1]:
            e = el.new(pos)
            e.color = col
        self.link(src, r.inputs[0])
        return r.outputs[0]

    def mix(self, a, b, fac, blend='MIX'):
        x = self.N.new("ShaderNodeMix")
        x.data_type = 'RGBA'
        x.blend_type = blend
        for sock, v in ((x.inputs["Factor"], fac), (x.inputs[6], a), (x.inputs[7], b)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            elif isinstance(v, tuple):
                sock.default_value = v
            else:
                self.link(v, sock)
        return x.outputs[2]

    def noise(self, scale, detail=4.0, rough=0.55, coord="Object", stretch=None):
        t = self.N.new("ShaderNodeTexNoise")
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        v = self.tc.outputs[coord]
        if stretch:   # grain: scale the coordinates per axis
            vm = self.N.new("ShaderNodeVectorMath")
            vm.operation = 'MULTIPLY'
            vm.inputs[1].default_value = stretch
            self.link(v, vm.inputs[0])
            v = vm.outputs[0]
        self.link(v, t.inputs["Vector"])
        return t.outputs[0]

    def finish(self, albedo, spec=0.3, spec_rough=0.35, spec_col=(1.0, 0.97, 0.9, 1), metal=False, bump=None,
               shade=None, ao_k=0.45, emit=None, edge_dark=0.5, sheen=0.35, glint=0.0):
        """albedo: an RGBA tuple (linear) or a socket. shade: the light ramp's stops (default cool shade to warm light).
        metal: brighter facing up (the sky), darker facing down and at the rims (edge_dark), plus a sky sheen."""
        normal = None
        if bump is not None:
            bn = self.node("ShaderNodeBump", Strength=bump[1], Distance=0.02)
            self.link(bump[0], bn.inputs["Height"])
            normal = bn.outputs[0]
        dif = self.N.new("ShaderNodeBsdfDiffuse")
        dif.inputs["Color"].default_value = (1, 1, 1, 1)
        if normal:
            self.link(normal, dif.inputs["Normal"])
        s2r = self.N.new("ShaderNodeShaderToRGB")
        self.link(dif.outputs[0], s2r.inputs[0])
        lum = self.node("ShaderNodeRGBToBW")
        self.link(s2r.outputs[0], lum.inputs[0])
        stops = shade or [(0.0, (0.27, 0.25, 0.35, 1)), (0.15, (0.36, 0.34, 0.44, 1)), (0.5, (0.72, 0.70, 0.70, 1)),
                          (1.0, (1.0, 0.95, 0.86, 1))]
        sh = self.ramp(lum.outputs[0], stops)
        sh = self.mix(sh, (1.05, 1.05, 1.05, 1), 1.0, 'MULTIPLY')
        # painted ground shade: darker toward the ground (world height; the turning part sits above all of it)
        gp = self.N.new("ShaderNodeNewGeometry")
        gz = self.N.new("ShaderNodeSeparateXYZ")
        self.link(gp.outputs["Position"], gz.inputs[0])
        gnd = self.ramp(gz.outputs[2], GROUND)
        sh = self.mix(sh, gnd, 1.0, 'MULTIPLY')
        ao = self.N.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = 0.35
        aof = self.ramp(ao.outputs["AO"], [(0.0, (1 - ao_k,) * 3 + (1,)), (1.0, (1, 1, 1, 1))])
        sh = self.mix(sh, aof, 1.0, 'MULTIPLY')
        if metal:   # metal: brighter where it faces up (the sky), darker facing down and at grazing angles (dark edges)
            geo = self.N.new("ShaderNodeNewGeometry")
            sep = self.N.new("ShaderNodeSeparateXYZ")
            self.link(geo.outputs["Normal"], sep.inputs[0])
            up = self.math("MULTIPLY_ADD", sep.outputs[2], 0.3, 0.92)
            lw = self.N.new("ShaderNodeLayerWeight")
            lw.inputs["Blend"].default_value = 0.35
            edge = self.math("MULTIPLY_ADD", lw.outputs["Facing"], -edge_dark, 1.0)
            k = self.math("MULTIPLY", up, edge)
            kk = self.N.new("ShaderNodeCombineColor")
            for i in range(3):
                self.link(k, kk.inputs[i])
            sh = self.mix(sh, kk.outputs[0], 1.0, 'MULTIPLY')
            sky = self.ramp(sep.outputs[2], [(0.45, (0, 0, 0, 1)), (0.9, (1, 1, 1, 1))])
            sky = self.mix(sky, tuple(c * sheen for c in spec_col[:3]) + (1,), 1.0, 'MULTIPLY')
        col = self.mix(albedo, sh, 1.0, 'MULTIPLY')
        if metal:   # a soft sky sheen on faces that look up, as painted metal has
            col = self.mix(col, sky, 1.0, 'ADD')
        if metal and glint:   # a painted window highlight: a bright streak where the surface faces GLINT (front left, up)
            dp = self.N.new("ShaderNodeVectorMath")
            dp.operation = 'DOT_PRODUCT'
            self.link(geo.outputs["Normal"], dp.inputs[0])
            dp.inputs[1].default_value = GLINT
            gl_ = self.ramp(dp.outputs["Value"], [(0.88, (0, 0, 0, 1)), (0.95, (1, 1, 1, 1)), (0.985, (0.5, 0.5, 0.5, 1))])
            gl_ = self.mix(gl_, tuple(c * glint for c in spec_col[:3]) + (1,), 1.0, 'MULTIPLY')
            col = self.mix(col, gl_, 1.0, 'ADD')
        if spec > 0:
            gl = self.N.new("ShaderNodeBsdfGlossy")
            gl.inputs["Color"].default_value = (1, 1, 1, 1)
            gl.inputs["Roughness"].default_value = spec_rough
            if normal:
                self.link(normal, gl.inputs["Normal"])
            s2 = self.N.new("ShaderNodeShaderToRGB")
            self.link(gl.outputs[0], s2.inputs[0])
            l2 = self.node("ShaderNodeRGBToBW")
            self.link(s2.outputs[0], l2.inputs[0])
            hi = self.ramp(l2.outputs[0], [(0.4, (0, 0, 0, 1)), (1.0, (1, 1, 1, 1))])
            hi = self.mix(hi, tuple(c * spec for c in spec_col[:3]) + (1,), 1.0, 'MULTIPLY')
            col = self.mix(col, hi, 1.0, 'ADD')
        if emit is not None:
            col = self.mix(col, emit, 1.0, 'ADD')
        em = self.N.new("ShaderNodeEmission")
        self.link(lum.outputs[0] if DEBUG_LIGHT else col, em.inputs["Color"])
        em.inputs["Strength"].default_value = 1.0
        out = self.N.new("ShaderNodeOutputMaterial")
        self.link(em.outputs[0], out.inputs[0])
        return self.m


def metal_ramp(dark, mid, light):
    """A metal's own light ramp (albedo white): dark edge colour in shade, its colour in the light, a pale top."""
    def lerp(t):
        return srgb(*[round(a + (b - a) * t) for a, b in zip(dark, mid)])
    return [(0.0, lerp(0.3)), (0.22, lerp(0.8)), (0.48, srgb(*mid)), (0.9, srgb(*light))]


# Metals: (shade, colour, light), highlight colour. Gold and brass get gold highlights and dark brown edges.
METALS = dict(
    brass=((80, 40, 8), (205, 130, 40), (245, 195, 95), (1.0, 0.86, 0.52, 1)),
    gold=((128, 66, 4), (234, 150, 8), (255, 206, 44), (1.0, 0.92, 0.55, 1)),     # the painted gold, shade a little less brown
    steel=((34, 36, 48), (112, 116, 136), (176, 184, 206), (0.95, 0.97, 1.0, 1)),
    gunmetal=((18, 18, 26), (70, 72, 88), (150, 156, 180), (0.92, 0.95, 1.0, 1)),
    black=((14, 10, 14), (44, 38, 48), (90, 84, 104), (0.82, 0.9, 1.0, 1)),       # purple-grey shine, as painted
)


def mat_metal(name, kind=None, spec=0.9, spec_rough=0.22, wear=0.5, edge_dark=0.62, sheen=0.35, glint=0.16, polish=None,
              top=1.0, env=None, wave=None, whites=None):
    """A painted metal: its own dark-to-light ramp, gold/steel highlights, dark rims, a little wear (pale scratches, dark
    specks) so it does not look factory-clean. Polished (the default since 28 Oct, see mat_polished) unless polish=0."""
    dark, mid, light, hi = METALS[kind or name]
    p = Paint(name)
    tone = p.ramp(p.noise(3.5, 3.0), [(0.3, (0.88, 0.88, 0.88, 1)), (0.7, (1.04, 1.04, 1.04, 1))])
    if wear:
        scratch = p.ramp(p.noise(16.0, 7.0, 0.72), [(0.67, (0, 0, 0, 1)), (0.70, (wear * 0.5,) * 3 + (1,))])
        tone = p.mix(tone, (1.35, 1.3, 1.2, 1), scratch)
        speck = p.ramp(p.noise(9.0, 6.0, 0.65), [(0.30, (1 - wear * 0.5,) * 3 + (1,)), (0.34, (1, 1, 1, 1))])
        tone = p.mix(tone, speck, 1.0, 'MULTIPLY')
    if polish != 0 and not os.environ.get('LOOK3D_OLD_METAL'):   # LOOK3D_OLD_METAL=1: the look before 28 Oct
        return mat_polished(p, tone, kind or name, polish=1.0 if polish is None else polish,
                            spec=spec, spec_rough=spec_rough, edge_dark=edge_dark, top=top, env=env, wave=wave, whites=whites)
    return p.finish(tone, spec=spec, spec_rough=spec_rough, spec_col=hi, metal=True, shade=metal_ramp(dark, mid, light),
                    edge_dark=edge_dark, sheen=sheen, glint=glint)


# ---------------------------------------------------------------------------------------------------- polished metal
# Owner, 28 Oct: "the Cannon's barrel feels like a PVC pipe; tier 2 lacks the polished-gold feel; tier 3 lacks the
# polished black-and-gold feel". Polished metal shows what it reflects more than its own shade: the ground below the
# horizon, a bright band at the horizon, the sky above, and two big bright windows (one on the sun's side, a dimmer one
# behind on the right) that draw the bright streaks down round parts. That reflection's brightness, times the sun's light
# (with cast shadows), the ground shade, ambient occlusion and dark rims, is ONE number per pixel, read through the metal's
# own ramp (deep shadow colour, colour, light, near-white): so shade stays the metal's own deep hue (brown for gold, blue-
# black for steel) instead of going grey, and the brightest reflections go near-white.
ENV = [(0.0, 0.25), (0.3, 0.42), (0.45, 0.6), (0.48, 1.3), (0.53, 1.3), (0.58, 0.86), (0.75, 0.64), (1.0, 0.56)]
                                        # brightness by the reflected ray's height, (z + 1) / 2: the ground, darkest straight
                                        # down; a bright band at the horizon; the sky, darker toward the top (a studio sky)
WINDOWS = [(SUN[0] - 10, 0.86, 0.7), (330, 0.92, 0.45)]   # (bearing, cos of the half width, brightness added)
LIGHT = [(0.0, 0.42), (0.3, 0.72), (0.75, 1.0)]            # the sun's light (0-1) to a brightness factor
WAVE = 0.35                             # how much the reflection's surface waves (see mat_polished)
ENV_TURNED = [(0.0, 0.16), (0.3, 0.3), (0.44, 0.5), (0.47, 1.45), (0.52, 1.45), (0.55, 0.22), (0.62, 0.22), (0.65, 1.05),
              (0.74, 1.05), (0.78, 0.42), (1.0, 0.5)]
                                        # a lathe-turned gun barrel (owner, 28 Oct: "looks like PVC"): the same studio, but a
                                        # dark band between the horizon and a second bright band, so a long round part shows
                                        # crisp bright-dark-bright streaks along its length, as chrome and gun steel do
POLISH = dict(black=(0.2, 0.88), pblack=(0.2, 0.88), lblack=(0.2, 0.88))   # per metal kind: (w1, w2) for metal_stops
                                        # (black lacquer: dark all the way up, then a sharp jump to near-white)


def metal_stops(dark, mid, light, w1=0.3, w2=0.7):
    """A polished metal's ramp, from the brightness 0 (deepest shade) to 1 (the brightest reflection): its shade colour,
    colour and light colour, then toward white (w1 of the way, then w2)."""
    def mixc(a, b, t):
        return srgb(*[min(255, round(x + (y - x) * t)) for x, y in zip(a, b)])
    return [(0.0, mixc((0, 0, 0), dark, 0.5)), (0.12, srgb(*dark)), (0.28, mixc(dark, mid, 0.55)), (0.45, srgb(*mid)),
            (0.62, srgb(*light)), (0.8, mixc(light, (255, 255, 255), w1)), (1.0, mixc(light, (255, 255, 255), w2))]


def _bw(p, col):
    n = p.node("ShaderNodeRGBToBW")
    p.link(col, n.inputs[0])
    return n.outputs[0]


def mat_polished(p, tone, kind, polish=1.0, spec=0.9, spec_rough=0.22, edge_dark=0.62, kind2=None, mask=None, top=1.0,
                 env=None, wave=None, whites=None):
    """kind2, mask: a second metal where mask (a socket, 0-1) is 1 (two-metal stripes, see mat_polished_stripes).
    env, wave: another reflected studio (ENV_TURNED for gun barrels) and surface wave (less for a turned barrel).
    whites: (w1, w2) for metal_stops instead of the kind's POLISH ones.
    top < 1: the brightest reflections are eased down to top (for big flat facets, which otherwise turn near-white
    wherever they catch the horizon band or a window)."""
    dark, mid, light, hi = METALS[kind]
    stops = metal_stops(dark, mid, light, *(whites or POLISH.get(kind, ())))
    geo = p.N.new("ShaderNodeNewGeometry")
    view = p.N.new("ShaderNodeVectorMath")
    view.operation = 'SCALE'
    view.inputs["Scale"].default_value = -1.0
    p.link(geo.outputs["Incoming"], view.inputs[0])
    ref = p.N.new("ShaderNodeVectorMath")
    ref.operation = 'REFLECT'
    p.link(view.outputs[0], ref.inputs[0])
    # the reflection sees a gently waved surface (big soft waves), so a flat panel shows a streak or a gradient, never one
    # flat colour (a whole facet lit white by the horizon band looks like white paint)
    wave = p.node("ShaderNodeBump", Strength=WAVE if wave is None else wave, Distance=0.1)
    p.link(p.noise(1.4, 2.0, 0.5), wave.inputs["Height"])
    p.link(wave.outputs[0], ref.inputs[1])
    rs = p.N.new("ShaderNodeSeparateXYZ")
    p.link(ref.outputs[0], rs.inputs[0])
    t = p.math("MULTIPLY_ADD", rs.outputs[2], 0.5, 0.5)
    env = _bw(p, p.ramp(t, [(pos, (v / 2, v / 2, v / 2, 1)) for pos, v in (env or ENV)]))        # halved: a ramp stores 0-1
    env = p.math("MULTIPLY", env, 2.0)
    # the windows: where the reflected ray points (on the ground plan) at a bright window, low in the sky or just below it
    flat = p.N.new("ShaderNodeCombineXYZ")
    p.link(rs.outputs[0], flat.inputs[0])
    p.link(rs.outputs[1], flat.inputs[1])
    nf = p.N.new("ShaderNodeVectorMath")
    nf.operation = 'NORMALIZE'
    p.link(flat.outputs[0], nf.inputs[0])
    band = _bw(p, p.ramp(t, [(0.2, (0, 0, 0, 1)), (0.28, (1, 1, 1, 1)), (0.78, (1, 1, 1, 1)), (0.86, (0, 0, 0, 1))]))
    for b, cw, k in WINDOWS:
        dp = p.N.new("ShaderNodeVectorMath")
        dp.operation = 'DOT_PRODUCT'
        p.link(nf.outputs[0], dp.inputs[0])
        d = bear(b)
        dp.inputs[1].default_value = (d.x, d.y, 0.0)
        w = _bw(p, p.ramp(dp.outputs["Value"], [(cw - 0.025, (0, 0, 0, 1)), (cw + 0.01, (k, k, k, 1))]))
        env = p.math("ADD", env, p.math("MULTIPLY", w, band))
    # the sun's light on a white surface (with cast shadows), as Paint.finish reads it
    dif = p.N.new("ShaderNodeBsdfDiffuse")
    s2r = p.N.new("ShaderNodeShaderToRGB")
    p.link(dif.outputs[0], s2r.inputs[0])
    lum = _bw(p, s2r.outputs[0])
    v = p.math("MULTIPLY", env, _bw(p, p.ramp(lum, [(a, (b, b, b, 1)) for a, b in LIGHT])))
    v = p.math("MULTIPLY", v, _bw(p, tone))
    gp = p.N.new("ShaderNodeSeparateXYZ")
    p.link(geo.outputs["Position"], gp.inputs[0])
    v = p.math("MULTIPLY", v, _bw(p, p.ramp(gp.outputs[2], [(0.0, (0.7, 0.7, 0.7, 1)), (0.35, (0.88, 0.88, 0.88, 1)),
                                                           (1.0, (1, 1, 1, 1))])))
    ao = p.N.new("ShaderNodeAmbientOcclusion")
    ao.samples = 16
    ao.inputs["Distance"].default_value = 0.35
    v = p.math("MULTIPLY", v, _bw(p, p.ramp(ao.outputs["AO"], [(0.0, (0.55, 0.55, 0.55, 1)), (1.0, (1, 1, 1, 1))])))
    lw = p.N.new("ShaderNodeLayerWeight")       # dark rims where the surface turns away (sides only: from this low
    lw.inputs["Blend"].default_value = 0.35     # camera every top face is at a grazing angle, and tops stay bright)
    nz = p.N.new("ShaderNodeSeparateXYZ")
    p.link(geo.outputs["Normal"], nz.inputs[0])
    side = p.math("SUBTRACT", 1.0, p.math("MAXIMUM", nz.outputs[2], 0.0))
    v = p.math("MULTIPLY", v, p.math("MULTIPLY_ADD", p.math("MULTIPLY", lw.outputs["Facing"], side), -edge_dark * 0.55, 1.0))
    v = p.math("MINIMUM", v, 1.0)
    if top < 1:
        v = _bw(p, p.ramp(v, [(0.0, (0, 0, 0, 1)), (0.5, (0.5, 0.5, 0.5, 1)), (1.0, (top, top, top, 1))]))
    col = p.ramp(v, stops)
    if kind2:
        col = p.mix(col, p.ramp(v, metal_stops(*METALS[kind2][:3], *POLISH.get(kind2, ()))), mask)
    if polish < 1:   # partly the painted shade (the look before 28 Oct)
        col = p.mix(p.ramp(lum, metal_ramp(dark, mid, light)), col, polish)
    if spec > 0:     # the sun's own highlight: small, crisp, near-white
        gl = p.N.new("ShaderNodeBsdfGlossy")
        gl.inputs["Roughness"].default_value = spec_rough * 0.6
        s2 = p.N.new("ShaderNodeShaderToRGB")
        p.link(gl.outputs[0], s2.inputs[0])
        h = p.ramp(_bw(p, s2.outputs[0]), [(0.5, (0, 0, 0, 1)), (0.9, (1, 1, 1, 1))])
        col = p.mix(col, p.mix(h, tuple(min(1.0, c * spec) for c in hi[:3]) + (1,), 1.0, 'MULTIPLY'), 1.0, 'ADD')
    em = p.N.new("ShaderNodeEmission")
    p.link(lum if DEBUG_LIGHT else col, em.inputs["Color"])
    out = p.N.new("ShaderNodeOutputMaterial")
    p.link(em.outputs[0], out.inputs[0])
    return p.m


def mat_polished_stripes(name, kind_a, kind_b, n, phase=0.0, ratio=0.5, wear=0.35):
    """Upright stripes of two polished metals round the Z axis (the tier 3 drum's black and gold): n pairs, kind_a on
    `ratio` of each pair, leaning and wobbling a little as mat_stripes does."""
    p = Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])
    wob = p.math("MULTIPLY", p.math("SUBTRACT", p.noise(2.5, 2.0), 0.5), 0.1)
    u = p.math("ADD", p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), wob), p.math("MULTIPLY", sep.outputs[2], 0.06))
    bnd = p.math("GREATER_THAN", p.math("FRACT", p.math("ADD", u, phase)), ratio)
    tone = p.ramp(p.noise(3.5, 3.0), [(0.3, (0.9, 0.9, 0.9, 1)), (0.7, (1.03, 1.03, 1.03, 1))])
    scratch = p.ramp(p.noise(16.0, 7.0, 0.72), [(0.67, (0, 0, 0, 1)), (0.70, (wear * 0.5,) * 3 + (1,))])
    tone = p.mix(tone, (1.35, 1.3, 1.2, 1), scratch)
    return mat_polished(p, tone, kind_a, spec=1.0, kind2=kind_b, mask=bnd)


def mat_flat(name, col, spec=0.3, spec_rough=0.35, metal=False, emit=None):
    return Paint(name).finish(srgb(*col), spec=spec, spec_rough=spec_rough, metal=metal,
                              emit=srgb(*emit) if emit else None)


def mat_glass_lamp(name, core=(255, 246, 190), mid=(255, 184, 40), rim=(196, 92, 0)):
    """A glowing lamp: glass lit from inside, hot pale core where it faces the viewer, deep orange at the rim, a white
    window highlight from the light; it ignores shade (it gives light)."""
    p = Paint(name)
    lw = p.N.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    col = p.ramp(lw.outputs["Facing"], [(0.0, srgb(*core)), (0.45, srgb(*mid)), (1.0, srgb(*rim))])
    gl = p.N.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.08
    s2 = p.N.new("ShaderNodeShaderToRGB")
    p.link(gl.outputs[0], s2.inputs[0])
    l2 = p.node("ShaderNodeRGBToBW")
    p.link(s2.outputs[0], l2.inputs[0])
    hi = p.ramp(l2.outputs[0], [(0.3, (0, 0, 0, 1)), (0.6, (1, 1, 1, 1))])
    col = p.mix(col, hi, 1.0, 'ADD')
    em = p.N.new("ShaderNodeEmission")
    p.link(col, em.inputs["Color"])
    out = p.N.new("ShaderNodeOutputMaterial")
    p.link(em.outputs[0], out.inputs[0])
    return p.m


def mat_halo(name, col=(255, 190, 60), strength=0.55):
    """A soft glow round a lamp: an emissive shell that fades out toward its rim (blended, casts no shadow)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.6
    fac = nt.nodes.new("ShaderNodeMath")
    fac.operation = 'POWER'
    nt.links.new(lw.outputs["Facing"], fac.inputs[0])
    fac.inputs[1].default_value = 0.6
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = srgb(*col)
    em.inputs["Strength"].default_value = 1.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = 'MULTIPLY_ADD'
    nt.links.new(fac.outputs[0], mul.inputs[0])
    mul.inputs[1].default_value = strength
    mul.inputs[2].default_value = 1 - strength
    nt.links.new(mul.outputs[0], mx.inputs[0])
    nt.links.new(em.outputs[0], mx.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mx.outputs[0], out.inputs[0])
    for k, v in (("surface_render_method", 'BLENDED'), ("use_transparent_shadow", True)):
        try:
            setattr(m, k, v)
        except Exception:
            pass
    return m


# a warmer light ramp than Paint's default, for pale paint and wood (the default's cool shade turns them grey-lilac)
WARM_SHADE = [(0.0, (0.40, 0.31, 0.32, 1)), (0.18, (0.50, 0.42, 0.42, 1)), (0.5, (0.80, 0.75, 0.70, 1)),
              (1.0, (1.0, 0.97, 0.9, 1))]


def mat_stripes(name, a, b, n, phase=0.0, chips=True, ratio=0.5, spec=0.35):
    """Vertical painted stripes round the Z axis: n of colour a, n of colour b (0-255 sRGB), leaning a little, wobbly,
    with chipped paint on colour a. ratio: colour a's share of each pair."""
    p = Paint(name)
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])     # 0 along +X (bearing 90)
    wob = p.math("MULTIPLY", p.math("SUBTRACT", p.noise(2.5, 2.0), 0.5), 0.14)
    twist = p.math("MULTIPLY", sep.outputs[2], 0.06)
    u = p.math("ADD", p.math("ADD", p.math("MULTIPLY", ang, n / (2 * math.pi)), wob), twist)
    bnd = p.math("GREATER_THAN", p.math("FRACT", p.math("ADD", u, phase)), ratio)
    paint = p.mix(srgb(*a), srgb(*b), bnd)
    if chips:
        chip = p.ramp(p.noise(7.0, 8.0, 0.62), [(0.64, (0, 0, 0, 1)), (0.665, (1, 1, 1, 1))])
        chip = p.math("MULTIPLY", p.math("SUBTRACT", 1.0, bnd), chip)    # chips show on colour a only
        paint = p.mix(paint, srgb(*[min(255, c + 60) for c in b]), chip)
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.84, 0.82, 0.82, 1)), (0.7, (1, 1, 1, 1))])
    col = p.mix(paint, grime, 1.0, 'MULTIPLY')
    return p.finish(col, spec=spec, spec_rough=0.3, shade=WARM_SHADE)


def mat_wood(name, light=(242, 204, 118), dark=(210, 152, 70), crack=(120, 78, 34)):
    """Pale painted wood/bone (the Cannon's ring, prongs and feet): long grain, a few dark cracks."""
    p = Paint(name)
    grain = p.noise(4.0, 6.0, 0.6, stretch=(1.0, 1.0, 0.18))
    base = p.ramp(grain, [(0.35, srgb(*dark)), (0.65, srgb(*light))])
    vor = p.N.new("ShaderNodeTexVoronoi")
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs["Scale"].default_value = 3.0
    p.link(p.tc.outputs["Object"], vor.inputs["Vector"])
    cr = p.ramp(vor.outputs["Distance"], [(0.0, (0, 0, 0, 1)), (0.02, (1, 1, 1, 1))])
    mask = p.ramp(p.noise(1.5, 2.0), [(0.58, (1, 1, 1, 1)), (0.62, (0, 0, 0, 1))])
    cm = p.math("MAXIMUM", cr, mask)
    col = p.mix(srgb(*crack), base, cm)
    shade = WARM_SHADE
    return p.finish(col, spec=0.18, spec_rough=0.45, bump=(p.noise(6.0, 6.0), 0.2), shade=shade)


def mat_stone(name="stone"):
    p = Paint(name)
    base = p.ramp(p.noise(3.0, 4.0), [(0.35, srgb(222, 150, 66)), (0.65, srgb(240, 178, 92))])
    vor = p.N.new("ShaderNodeTexVoronoi")
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs["Scale"].default_value = 2.4
    p.link(p.tc.outputs["Object"], vor.inputs["Vector"])
    crack = p.ramp(vor.outputs["Distance"], [(0.0, (0, 0, 0, 1)), (0.022, (1, 1, 1, 1))])
    mask = p.ramp(p.noise(1.3, 2.0), [(0.56, (1, 1, 1, 1)), (0.6, (0, 0, 0, 1))])
    cm = p.math("MAXIMUM", crack, mask)
    col = p.mix(srgb(120, 66, 24), base, cm)
    return p.finish(col, spec=0.12, spec_rough=0.5, bump=(p.noise(6.0, 6.0), 0.25))


# ---------------------------------------------------------------------------------------------------------------- outline
_LINES = {}
LINE_COLS = dict(warm=(58, 32, 14), cool=(24, 22, 30), gold=(70, 38, 6))


def line(kind="warm"):
    """The outline material of that colour (one per colour)."""
    if kind not in _LINES:
        _LINES[kind] = outline_mat("line_" + kind, srgb(*LINE_COLS[kind]))
    return _LINES[kind]


def outline_mat(name, col):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = col
    em.inputs["Strength"].default_value = 1.0
    # the shell must not cast shadows (it wraps its own object, so it would shade all of it): clear to shadow rays
    lp = nt.nodes.new("ShaderNodeLightPath")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Shadow Ray"], mx.inputs[0])
    nt.links.new(em.outputs[0], mx.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    m.use_backface_culling = True
    for k, v in (("use_transparent_shadow", True), ("use_backface_culling_shadow", True)):
        try:
            setattr(m, k, v)
        except Exception:
            pass
    return m


_SHELLS = {}


def shell_nodes(w, line_mat):
    """Geometry nodes: the mesh pushed out along its normals by w, faces flipped, in the line material."""
    key = (round(w, 4), line_mat.name)
    if key in _SHELLS:
        return _SHELLS[key]
    t = bpy.data.node_groups.new(f"shell_{line_mat.name}_{w:.3f}", 'GeometryNodeTree')
    t.interface.new_socket(name="Geometry", in_out='INPUT', socket_type='NodeSocketGeometry')
    t.interface.new_socket(name="Geometry", in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = t.nodes
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    nrm = N.new("GeometryNodeInputNormal")
    sc = N.new("ShaderNodeVectorMath")
    sc.operation = 'SCALE'
    sc.inputs["Scale"].default_value = w
    sp = N.new("GeometryNodeSetPosition")
    ff = N.new("GeometryNodeFlipFaces")
    sm = N.new("GeometryNodeSetMaterial")
    sm.inputs["Material"].default_value = line_mat
    L = t.links.new
    L(nrm.outputs[0], sc.inputs[0])
    L(gi.outputs[0], sp.inputs["Geometry"])
    L(sc.outputs["Vector"], sp.inputs["Offset"])
    L(sp.outputs[0], ff.inputs[0])
    L(ff.outputs[0], sm.inputs[0])
    L(sm.outputs[0], go.inputs[0])
    _SHELLS[key] = t
    return t


def add_outline(ob, line_mat, w=None):
    """Inverted hull: a second object sharing the mesh, pushed out by w with its faces flipped, drawn only from behind in
    a dark line colour. It is its own object so it casts no shadow (wrapped round its object, it would shade all of it)."""
    if os.environ.get('LOOK3D_NO_LINE'):
        return
    sh = bpy.data.objects.new(ob.name + "_line", ob.data)
    bpy.context.scene.collection.objects.link(sh)
    sh.parent = ob.parent
    sh.location, sh.rotation_euler, sh.scale = ob.location.copy(), ob.rotation_euler.copy(), ob.scale.copy()
    mod = sh.modifiers.new("outline", 'NODES')
    mod.node_group = shell_nodes(w or LINE, line_mat)
    return sh


# ------------------------------------------------------------------------------------------------------------ camera/light
def setup_render(samples=64, el=None):
    """el: camera elevation in degrees for this tower (default EL, read at call time, so L.EL = 30 before the call works too)."""
    el = EL if el is None else el
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.filter_size = 1.2
    ee = sc.eevee
    ee.taa_render_samples = samples
    for k, v in (("use_shadows", not os.environ.get("LOOK3D_NO_SHADOW")), ("shadow_ray_count", 3), ("shadow_step_count", 10),
                 ("use_fast_gi", False), ("use_raytracing", False), ("shadow_resolution_scale", 1.0)):
        try:
            setattr(ee, k, v)
        except Exception:
            pass
    world = bpy.data.worlds.new("none")       # no sky light: the materials make their own shade (see Paint)
    sc.world = world
    world.use_nodes = True
    world.node_tree.nodes.get("Background").inputs[1].default_value = 0.0

    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = 8.2
    cam_d.clip_start, cam_d.clip_end = 0.05, 40
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    view = bear(45, math.cos(math.radians(el)), math.sin(math.radians(el)))   # toward the viewer, up
    cam.location = Vector((0, 0, 1.0)) + view * 16
    cam.rotation_euler = (-view).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam

    sun_d = bpy.data.lights.new("sun", 'SUN')
    sun_d.energy = math.pi            # a white surface facing the sun reads 1.0
    sun_d.angle = math.radians(6)
    for k, v in (("shadow_maximum_resolution", 0.002), ("use_shadow_jitter", False), ("shadow_filter_radius", 1.0)):
        try:
            setattr(sun_d, k, v)
        except Exception as e:
            print("no", k, e)
    sun = bpy.data.objects.new("sun", sun_d)
    sc.collection.objects.link(sun)
    frm = bear(SUN[0], math.cos(math.radians(SUN[1])), math.sin(math.radians(SUN[1])))
    sun.rotation_euler = (-frm).to_track_quat('-Z', 'Y').to_euler()
    return cam


def objs_under(root):
    """Every mesh below root (any depth)."""
    def under(o):
        while o.parent:
            if o.parent == root:
                return True
            o = o.parent
        return False
    return [o for o in bpy.data.objects if o.type == 'MESH' and under(o)]


def screen_box(cam, obs):
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in obs:
        if o.name.endswith("_line"):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            p = world_to_camera_view(sc, cam, mw @ v.co)
            xs.append(p.x * W)
            ys.append((1 - p.y) * H)
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


def fit(cam, obs, scale=None):
    """Scale and shift the camera so the objects' box matches BODY_BOX in width (or use the given ortho scale), centre and
    bottom."""
    for _ in range(3):
        bpy.context.view_layer.update()
        if scale:
            cam.data.ortho_scale = scale
        else:
            x0, y0, x1, y1 = screen_box(cam, obs)
            cam.data.ortho_scale *= (x1 - x0) / (BODY_BOX[2] - BODY_BOX[0])
        bpy.context.view_layer.update()
        x0, y0, x1, y1 = screen_box(cam, obs)
        big = max(W, H)
        cam.data.shift_x += ((x0 + x1) / 2 - (BODY_BOX[0] + BODY_BOX[2]) / 2) / big
        cam.data.shift_y -= (y1 - BODY_BOX[3]) / big
    bpy.context.view_layer.update()
    return screen_box(cam, obs)


def to_px(cam, p):
    q = world_to_camera_view(bpy.context.scene, cam, Vector(p))
    return q.x * W, (1 - q.y) * H


def aim(cam, pivot_4x, set_heading, headings, base_tip, up=4):
    """The game's aim data (tower-3d-game-brief, 28 Oct), measured from the model: for each heading, set_heading(h) turns
    the turret, base_tip() gives the barrel's (or the lens') base and tip in world space. Per heading:
      aim_deg   the on-screen direction from base to tip, degrees (0 = right, 90 = down: atan2(dy, dx) in screen px)
      muzzle    [dx, dy] in game px (1x) from the turning point (pivot_4x, on the 4x canvas) to the tip on screen
      ground_deg the on-screen direction of the heading itself on the ground (the way the turret faces, ignoring the
                barrel's raise)
      aim_len   the base-to-tip length on screen, game px (short = the barrel points nearly at or away from the viewer,
                and aim_deg is then a poor guide)"""
    out = dict(aim_deg=[], muzzle=[], ground_deg=[], aim_len=[])
    px, py = pivot_4x
    for h in headings:
        set_heading(h)
        bpy.context.view_layer.update()
        b, t = base_tip()
        bx, by = to_px(cam, b)
        tx, ty = to_px(cam, t)
        gx0, gy0 = to_px(cam, (0, 0, 0))
        gx1, gy1 = to_px(cam, bear(h, 1.0))
        out["aim_deg"].append(round(math.degrees(math.atan2(ty - by, tx - bx)) % 360, 1))
        out["muzzle"].append([round((tx - px) / up, 2), round((ty - py) / up, 2)])
        out["ground_deg"].append(round(math.degrees(math.atan2(gy1 - gy0, gx1 - gx0)) % 360, 1))
        out["aim_len"].append(round(math.hypot(tx - bx, ty - by) / up, 2))
    return out


# ------------------------------------------------------------------------------------------------------------------ render
def _disk_max(a, r):
    """The max of a over a disk of radius r (pixels) round each pixel."""
    out = a.copy()
    R = int(math.ceil(r))
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            if (dx, dy) == (0, 0) or dx * dx + dy * dy > r * r + 0.25:
                continue
            s = np.zeros_like(a)
            ys = slice(max(dy, 0), a.shape[0] + min(dy, 0))
            yd = slice(max(-dy, 0), a.shape[0] + min(-dy, 0))
            xs = slice(max(dx, 0), a.shape[1] + min(dx, 0))
            xd = slice(max(-dx, 0), a.shape[1] + min(-dx, 0))
            s[yd, xd] = a[ys, xs]
            np.maximum(out, s, out=out)
    return out


def outer_line(rgba, col, r=None, avoid=None):
    """A thicker outline round the whole silhouette: the alpha grown by r px, in col, under the picture. Not drawn where
    `avoid` (an alpha picture, e.g. the body under a turret) is already covered. rgba: sRGB 0-1; col: 0-255."""
    r = OUTER if r is None else r
    if r <= 0:
        return rgba
    a = rgba[..., 3]
    lo, hi = _disk_max(a, math.floor(r)), _disk_max(a, math.floor(r) + 1)
    f = r - math.floor(r)
    d = lo * (1 - f) + hi * f
    if avoid is not None:
        d = d * (1 - avoid)
    la = d * (1 - a)
    out_a = a + la
    rgb = (rgba[..., :3] * a[..., None] + np.array(col[:3], np.float32)[None, None] / 255.0 * la[..., None]) / np.maximum(out_a, 1e-6)[..., None]
    return np.concatenate([rgb, out_a[..., None]], -1)


def shot(path, seen, cut=(), avoid=None, outer_col=None, outer=None):
    """Render the objects in seen, with those in cut as holdouts (they hide what is behind them but draw nothing).
    Two passes, laid over each other: the paint without the outline shells (so the shells cast no shadow), then the shells
    alone with every solid part as a holdout. Then the silhouette's thicker outline (see outer_line). Returns the RGBA
    picture (straight alpha, sRGB 0-1, rows top first)."""
    sc = bpy.context.scene
    tmp = [OUT / "_paint.png", OUT / "_lines.png"]
    for i, f in enumerate(tmp):
        for o in list(seen) + list(cut):
            ln = o.name.endswith("_line")
            glow = o.name.endswith("_glow")          # see-through glows: drawn in the paint pass only, never holdouts
            o.hide_render = (ln and i == 0) or (ln and o in cut) or (glow and (i == 1 or o in cut))
            o.is_holdout = not glow and ((o in cut) or (i == 1 and not ln))
        for o in bpy.data.objects:
            if o.type == 'MESH' and o not in seen and o not in cut:
                o.hide_render = True
        sc.render.filepath = str(f)
        bpy.ops.render.render(write_still=True)
    a, b = (bpy.data.images.load(str(f)) for f in tmp)
    n = W * H * 4
    pa, pb = np.empty(n, np.float32), np.empty(n, np.float32)
    a.pixels.foreach_get(pa)
    b.pixels.foreach_get(pb)
    pa, pb = pa.reshape(H, W, 4), pb.reshape(H, W, 4)        # straight alpha, rows bottom first
    ab = pb[..., 3:4]
    aa = ab + pa[..., 3:4] * (1 - ab)
    rgb = (pb[..., :3] * ab + pa[..., :3] * pa[..., 3:4] * (1 - ab)) / np.maximum(aa, 1e-6)
    img = np.concatenate([rgb, aa], -1)
    img = outer_line(img, outer_col or LINE_COLS["warm"], outer,
                     None if avoid is None else np.flipud(avoid))
    out = bpy.data.images.new("out", W, H, alpha=True)
    out.pixels.foreach_set(img.astype(np.float32).ravel())
    out.filepath_raw = str(path)
    out.file_format = 'PNG'
    out.save()
    for im in (a, b, out):
        bpy.data.images.remove(im)
    for f in tmp:
        f.unlink()
    return np.flipud(img)


def load_alpha(path):
    """The alpha of a PNG as a float array, rows top first (for shot's `avoid`)."""
    im = bpy.data.images.load(str(path))
    w, h = im.size
    px = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return np.flipud(px.reshape(h, w, 4)[..., 3])
