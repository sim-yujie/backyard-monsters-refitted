"""cannon3d.py : the Cannon Tower tier 1 as a real 3D model, rendered in the game's camera (owner, 27 Oct 2026: a sample).

Run with Blender 5.2 in the background (it builds the whole scene from nothing, so the model can be changed here and rebuilt):

  blender -b --factory-startup -P cannon3d.py -- body                 render/body-4x.png   (the tower without its barrel)
  blender -b --factory-startup -P cannon3d.py -- barrel [h0 h1 ...]   render/barrel-4x/hNN.png (the barrel alone at heading h,
                                                                      every body part in front of it cut out; default all 32)
  blender -b --factory-startup -P cannon3d.py -- full H               render/full-hH.png (everything in one picture, for checks)
  blender -b --factory-startup -P cannon3d.py -- save                 cannon-t1.blend (the scene, to open and change by hand)

Units: the striped drum's radius is 1. Ground bearing b (the game's heading, 0 = down-right on screen, 45 = at the viewer,
135 = left, 225 = away, 315 = right) is the Blender direction (sin b, cos b, 0). The camera is orthographic, looking down at
EL degrees from the viewer's side (bearing 45), and is fitted so the body covers the same pixels as the approved picture's body
on its 620 x 640 4x canvas (box BODY_BOX). The light comes from the upper left as in the game.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
DEBUG_LIGHT = bool(__import__('os').environ.get('CANNON_DEBUG_LIGHT'))   # draw only the sun's light, for checks
OUT = HERE / "render"
W, H = 620, 640                       # the approved picture's 4x canvas
BODY_BOX = (163, 323, 421, 577)       # the approved body's box on it (turret/T1/body/body-4x.png): left, top, right, bottom
EL = 23.0                             # camera elevation: the Flash renders' ellipses (ring 0.38 tall for 1 wide) say 22-24
TILT = 12.0                            # the barrel's raise, degrees
LINE = 0.024                          # outline width in drum radii (about 2 px at 4x)


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


def rbox(bm, size, mat_world, bevel=0.06, segs=3, taper=1.0, mat=0):
    """A rounded box (size x, y, z; base at z=0) transformed by mat_world; taper scales the top face."""
    sub = bmesh.new()
    bmesh.ops.create_cube(sub, size=1.0)
    for v in sub.verts:
        v.co.z += 0.5
        if v.co.z > 0.5:
            v.co.x *= taper
            v.co.y *= taper
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(sub, geom=list(sub.edges) + list(sub.verts), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    me = bpy.data.meshes.new("_tmp")
    sub.to_mesh(me)
    sub.free()
    me.transform(mat_world)
    for p in me.polygons:
        p.material_index = mat
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def studs(bm, centres, normals, r=0.035, mat=0):
    """Rivet heads: little flattened domes at centres, facing normals."""
    for c, n in zip(centres, normals):
        n = Vector(n).normalized()
        q = Vector((0, 0, 1)).rotation_difference(n)
        m = Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4() @ diag(r, r, r * 0.55)
        sub = bmesh.new()
        bmesh.ops.create_uvsphere(sub, u_segments=10, v_segments=6, radius=1.0)
        bmesh.ops.delete(sub, geom=[v for v in sub.verts if v.co.z < -0.2], context='VERTS')
        me = bpy.data.meshes.new("_tmp")
        sub.to_mesh(me)
        sub.free()
        me.transform(m)
        for p in me.polygons:
            p.material_index = mat
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)


def ring_of(n, r, z, phase=0.0):
    pts = [Vector((r * math.cos(2 * math.pi * (k + phase) / n), r * math.sin(2 * math.pi * (k + phase) / n), z)) for k in range(n)]
    return pts, [Vector((p.x, p.y, 0)) for p in pts]


# --------------------------------------------------------------------------------------------------------------- materials

# --------------------------------------------------------------------------------------------------------------- materials
class Paint:
    """A painted-look material: the sun's light on a white diffuse surface (with cast shadows) is read back as a number and
    mapped through a soft ramp from a cool shade to a warm light, times the paint colour and a little ambient occlusion,
    plus a highlight from a glossy surface; all of it drawn as flat colour (emission), so the colours come out as picked."""

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

    def noise(self, scale, detail=4.0, rough=0.55, coord="Object"):
        t = self.N.new("ShaderNodeTexNoise")
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        self.link(self.tc.outputs[coord], t.inputs["Vector"])
        return t.outputs[0]

    def finish(self, albedo, spec=0.3, spec_rough=0.35, spec_col=(1.0, 0.97, 0.9, 1), metal=False, bump=None,
               shade=None, ao_k=0.45, emit=None):
        """albedo: an RGBA tuple (linear) or a socket."""
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
        gnd = self.ramp(gz.outputs[2], [(0.0, (0.5, 0.48, 0.52, 1)), (0.35, (0.76, 0.75, 0.76, 1)), (1.0, (1, 1, 1, 1))])
        sh = self.mix(sh, gnd, 1.0, 'MULTIPLY')
        ao = self.N.new("ShaderNodeAmbientOcclusion")
        ao.samples = 16
        ao.inputs["Distance"].default_value = 0.35
        aof = self.ramp(ao.outputs["AO"], [(0.0, (1 - ao_k,) * 3 + (1,)), (1.0, (1, 1, 1, 1))])
        sh = self.mix(sh, aof, 1.0, 'MULTIPLY')
        if metal:   # metal: brighter where it faces up (the sky), darker facing down and at grazing angles
            geo = self.N.new("ShaderNodeNewGeometry")
            sep = self.N.new("ShaderNodeSeparateXYZ")
            self.link(geo.outputs["Normal"], sep.inputs[0])
            up = self.math("MULTIPLY_ADD", sep.outputs[2], 0.45, 0.8)
            lw = self.N.new("ShaderNodeLayerWeight")
            lw.inputs["Blend"].default_value = 0.35
            edge = self.math("MULTIPLY_ADD", lw.outputs["Facing"], -0.5, 1.0)
            k = self.math("MULTIPLY", up, edge)
            kk = self.N.new("ShaderNodeCombineColor")
            for i in range(3):
                self.link(k, kk.inputs[i])
            sh = self.mix(sh, kk.outputs[0], 1.0, 'MULTIPLY')
        col = self.mix(albedo if not isinstance(albedo, tuple) else albedo, sh, 1.0, 'MULTIPLY') \
            if not isinstance(albedo, tuple) else self.mix(albedo, sh, 1.0, 'MULTIPLY')
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
            hi = self.ramp(l2.outputs[0], [(0.25, (0, 0, 0, 1)), (0.9, (1, 1, 1, 1))])
            hi = self.mix(hi, tuple(c * spec for c in spec_col[:3]) + (1,), 1.0, 'MULTIPLY')
            col = self.mix(col, hi, 1.0, 'ADD')
        if emit:
            col = self.mix(col, emit, 1.0, 'ADD')
        em = self.N.new("ShaderNodeEmission")
        self.link(lum.outputs[0] if DEBUG_LIGHT else col, em.inputs["Color"])
        em.inputs["Strength"].default_value = 1.0
        out = self.N.new("ShaderNodeOutputMaterial")
        self.link(em.outputs[0], out.inputs[0])
        return self.m


def mat_stripes():
    p = Paint("stripes")
    sep = p.N.new("ShaderNodeSeparateXYZ")
    p.link(p.tc.outputs["Object"], sep.inputs[0])
    ang = p.math("ARCTAN2", sep.outputs[1], sep.outputs[0])     # 0 along +X (bearing 90)
    wob = p.math("MULTIPLY", p.math("SUBTRACT", p.noise(2.5, 2.0), 0.5), 0.18)
    twist = p.math("MULTIPLY", sep.outputs[2], 0.10)             # the stripes lean a little, as painted
    u = p.math("ADD", p.math("ADD", p.math("MULTIPLY", ang, STRIPES / (2 * math.pi)), wob), twist)
    band = p.math("GREATER_THAN", p.math("FRACT", p.math("ADD", u, STRIPE_PHASE)), 0.5)
    paint = p.mix(srgb(226, 6, 8), srgb(232, 229, 235), band)
    chip = p.ramp(p.noise(7.0, 8.0, 0.62), [(0.64, (0, 0, 0, 1)), (0.665, (1, 1, 1, 1))])
    chip = p.math("MULTIPLY", p.math("SUBTRACT", 1.0, band), chip)    # chips show on the red only
    col = p.mix(paint, srgb(214, 206, 210), chip)
    grime = p.ramp(p.noise(2.0, 3.0), [(0.3, (0.82, 0.8, 0.8, 1)), (0.7, (1, 1, 1, 1))])
    col = p.mix(col, grime, 1.0, 'MULTIPLY')
    return p.finish(col, spec=0.35, spec_rough=0.3)


def mat_stone():
    p = Paint("stone")
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


def mat_brass():
    p = Paint("brass")
    base = p.ramp(p.noise(4.0, 3.0), [(0.3, srgb(200, 128, 38)), (0.7, srgb(226, 160, 60))])
    return p.finish(base, spec=0.95, spec_rough=0.22, spec_col=(1.0, 0.9, 0.62, 1), metal=True)


def mat_steel():
    p = Paint("steel")
    base = p.ramp(p.noise(3.0, 4.0), [(0.3, srgb(96, 96, 108)), (0.7, srgb(128, 128, 140))])
    scratch = p.ramp(p.noise(14.0, 6.0, 0.7), [(0.66, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))])
    base = p.mix(base, srgb(150, 150, 162), scratch)
    return p.finish(base, spec=0.6, spec_rough=0.3, spec_col=(0.95, 0.97, 1.0, 1), metal=True)


def mat_flat(name, col, spec=0.3, spec_rough=0.35, metal=False, emit=None):
    return Paint(name).finish(srgb(*col), spec=spec, spec_rough=spec_rough, metal=metal,
                              emit=srgb(*emit) if emit else None)


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
    if __import__('os').environ.get('CANNON_NO_LINE'):
        return
    sh = bpy.data.objects.new(ob.name + "_line", ob.data)
    bpy.context.scene.collection.objects.link(sh)
    sh.parent = ob.parent
    sh.location, sh.rotation_euler, sh.scale = ob.location.copy(), ob.rotation_euler.copy(), ob.scale.copy()
    mod = sh.modifiers.new("outline", 'NODES')
    mod.node_group = shell_nodes(w or LINE, line_mat)
    return sh


# ------------------------------------------------------------------------------------------------------------------ model
# all sizes in drum radii; heights from the ground
TOP = 1.36          # the turntable's top, where the turning part stands (its pivot)
RING_R, RING_Z = 1.11, 1.45
FOOT_D = 1.22
FEET = {45: 45, 155: 108, 295: 342}   # three feet (as the Flash tower): bearing -> the way its lamp faces
STRIPES, STRIPE_PHASE = 3, 0.375     # three red and three white, a white one facing the viewer
TURRET_SCALE = 1.25


def horn(bm, base, top_z, out_d, bearing, r0, flat=0.72, n=14, tip=0.025, lean=0.0):
    """A curved prong: from base (d, z) up and bending outward to (out_d, top_z), tapering to a blunt tip."""
    d0, z0 = base
    p = [bear(bearing, d0, z0), bear(bearing, d0 + 0.02, z0 + 0.45 * (top_z - z0)),
         bear(bearing + lean * 0.5, d0 + 0.45 * (out_d - d0), z0 + 0.85 * (top_z - z0)),
         bear(bearing + lean, out_d, top_z)]
    tube(bm, bezier(*p, n=n), [(r0 - tip) * (1 - i / (n - 1)) ** 0.8 + tip for i in range(n)], sides=14, flat=flat)


def build():
    sc = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    M = dict(stripes=mat_stripes(), stone=mat_stone(), brass=mat_brass(), steel=mat_steel(),
             bore=mat_flat("bore", (38, 34, 38), spec=0.1),
             plate=mat_flat("plate", (84, 84, 96), spec=0.4, metal=True),
             rivet=mat_flat("rivet", (196, 196, 206), spec=0.9, spec_rough=0.25, metal=True),
             lens=mat_flat("lens", (255, 200, 30), spec=1.0, spec_rough=0.15, emit=(170, 110, 0)))
    LN = dict(warm=outline_mat("line_warm", srgb(58, 32, 14)), cool=outline_mat("line_cool", srgb(26, 24, 30)))

    # ---- body
    body = bpy.data.objects.new("BODY", None)
    sc.collection.objects.link(body)
    drum = lathe("drum", [
        [(1.0, 0.0), (1.05, 0.03), (1.05, 0.19), (1.01, 0.22)],                   # bottom brass band
        [(1.02, 0.21), (1.025, 0.34), (0.99, 0.6), (0.93, 0.82), (0.88, 0.97)],    # the striped drum
        [(0.90, 0.95), (0.94, 0.98), (0.94, 1.13), (0.90, 1.16)],                 # top brass band
        [(0.90, 1.16), (0.80, 1.19), (0.71, 1.21)],                               # shoulder
        [(0.71, 1.21), (0.73, 1.23), (0.73, 1.33), (0.69, 1.36)],                 # turntable rim
        [(0.69, 1.36), (0.0, 1.36)],                                              # turntable plate
    ], [M["brass"], M["stripes"], M["plate"]], mat_of_seg=[0, 1, 0, 0, 0, 2], parent=body)
    add_outline(drum, LN["warm"])

    bm = bmesh.new()
    for z, r, n in ((0.11, 1.05, 26), (1.055, 0.94, 22), (1.28, 0.73, 18)):
        c, nn = ring_of(n, r, z, 0.5)
        studs(bm, c, nn, r=0.042)
    c, nn = ring_of(8, 0.45, TOP + 0.005)
    studs(bm, c, [Vector((0, 0, 1))] * 8, r=0.032)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.1, radius2=0.09, depth=0.06,
                          matrix=Matrix.Translation((0, 0, TOP + 0.03)))
    obj_from_bm("rivets_body", bm, [M["rivet"]], parent=body)

    # four feet at the diagonals, each with a strut up into the ring; lamps on the three we see
    stone = bmesh.new()
    lamps = bmesh.new()
    glow = bmesh.new()
    view = bear(45, 1.0)
    for fb in FEET:
        fc = FEET[fb]                                   # the bearing the foot's lamp face looks along
        rot = Matrix.Rotation(-math.radians(fc), 4, 'Z')
        base = bear(fb, FOOT_D)
        rbox(stone, (0.64, 0.62, 0.80), Matrix.Translation(base) @ rot, bevel=0.05, segs=2, taper=0.92)
        rbox(stone, (0.44, 0.42, 0.2), Matrix.Translation(bear(fb, FOOT_D - 0.05, 0.76)) @ rot, bevel=0.04, segs=2, taper=0.85)
        p = [bear(fb, FOOT_D - 0.06, 0.88), bear(fb, FOOT_D + 0.02, 1.08), bear(fb, FOOT_D - 0.04, 1.30), bear(fb, RING_R, RING_Z)]
        tube(stone, bezier(*p, n=12), [0.15 - 0.035 * i / 11 for i in range(12)], sides=16, flat=0.85)
        if fb == 45:   # the front post goes on up through the ring as the tall front prong
            horn(stone, (RING_R, RING_Z - 0.05), RING_Z + 0.78, RING_R + 0.1, fb, 0.12, flat=0.85)
        face = bear(fc, 1.0)                            # a lamp on that face, near its top
        c = base + face * 0.30 + Vector((0, 0, 0.58))
        q = Vector((0, 0, 1)).rotation_difference(face)
        mm = Matrix.Translation(c) @ q.to_matrix().to_4x4()
        bmesh.ops.create_cone(lamps, cap_ends=True, segments=24, radius1=0.15, radius2=0.13, depth=0.08, matrix=mm)
        bmesh.ops.create_uvsphere(glow, u_segments=20, v_segments=10, radius=0.105,
                                  matrix=mm @ Matrix.Translation((0, 0, 0.03)) @ diag(1, 1, 0.9))
    # the ring
    n, k = 128, 20
    rings = []
    tor = bmesh.new()
    for i in range(n):
        a = 2 * math.pi * i / n
        sq = [(sgn(math.cos(2 * math.pi * j / k)) * abs(math.cos(2 * math.pi * j / k)) ** 0.6,    # a squarish band
               sgn(math.sin(2 * math.pi * j / k)) * abs(math.sin(2 * math.pi * j / k)) ** 0.6) for j in range(k)]
        rings.append([tor.verts.new(((RING_R + 0.12 * c) * math.cos(a), (RING_R + 0.12 * c) * math.sin(a), RING_Z + 0.10 * z))
                      for c, z in sq])
    for i in range(n):
        a, b2 = rings[i], rings[(i + 1) % n]
        for j in range(k):
            tor.faces.new((a[j], b2[j], b2[(j + 1) % k], a[(j + 1) % k]))
    me = bpy.data.meshes.new("_t")
    tor.to_mesh(me)
    tor.free()
    stone.from_mesh(me)
    bpy.data.meshes.remove(me)
    # two clusters of horns at the back left and back right, curving outward
    for pb, s in ((140, 0.8), (165, 1.0), (192, 0.88), (258, 0.88), (285, 1.0), (310, 0.8)):
        horn(stone, (RING_R, RING_Z + 0.03), RING_Z + 0.82 * s, RING_R + 0.28 * s, pb, 0.16, flat=0.65,
             lean=(-10 if pb < 225 else 10))
    feet = obj_from_bm("stone", stone, [M["stone"]], parent=body, sharp=50)
    add_outline(feet, LN["warm"])
    lampo = obj_from_bm("foot_lamp_rims", lamps, [M["brass"]], parent=body)
    add_outline(lampo, LN["warm"], LINE * 0.7)
    obj_from_bm("foot_lamps", glow, [M["lens"]], parent=body)

    # ---- the turning part: collar, yoke, barrel, lamp. Built pointing at +Y (bearing 0), turned about Z by -heading.
    tur = bpy.data.objects.new("TURRET", None)
    sc.collection.objects.link(tur)
    tur.location = (0, 0, TOP)
    tur.scale = (TURRET_SCALE,) * 3
    collar = lathe("collar", [
        [(0.54, 0.0), (0.56, 0.02), (0.56, 0.13), (0.52, 0.16)],
        [(0.52, 0.16), (0.36, 0.18), (0.0, 0.18)],
    ], [M["brass"]], parent=tur)
    add_outline(collar, LN["warm"])
    bm = bmesh.new()
    for sx in (-1, 1):   # the two brackets with their round tops and trunnion caps
        rbox(bm, (0.1, 0.46, 0.32), Matrix.Translation((sx * 0.44, 0.0, 0.14)), bevel=0.03, taper=1.0)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=0.23, radius2=0.23, depth=0.1,
                              matrix=Matrix.Translation((sx * 0.44, 0, 0.5)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.13, radius2=0.11, depth=0.1,
                              matrix=Matrix.Translation((sx * 0.53, 0, 0.5)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
    yoke = obj_from_bm("yoke", bm, [M["brass"]], parent=tur, sharp=35)
    add_outline(yoke, LN["warm"])
    bm = bmesh.new()
    c, nn = ring_of(14, 0.56, 0.075)
    studs(bm, c, nn, r=0.03)
    for sx in (-1, 1):
        studs(bm, [(sx * 0.585, 0, 0.5)], [(sx, 0, 0)], r=0.045)
        studs(bm, [(sx * 0.495, y, z) for y, z in ((-0.17, 0.22), (0.17, 0.22), (-0.17, 0.34), (0.17, 0.34))], [(sx, 0, 0)] * 4, r=0.026)
    obj_from_bm("rivets_yoke", bm, [M["rivet"]], parent=tur)

    gun = bpy.data.objects.new("GUN", None)
    sc.collection.objects.link(gun)
    gun.parent = tur
    gun.location = (0, 0, 0.5)
    gun.rotation_euler = (math.radians(TILT), 0, 0)
    # barrel along its local +Z (turned to +Y): rear knob, rear band, tube, middle band, tube, muzzle ring, bore
    barrel = lathe("barrel", [
        [(0.0, -0.80), (0.16, -0.78), (0.28, -0.72), (0.34, -0.64)],             # rear knob
        [(0.395, -0.64), (0.41, -0.62), (0.41, -0.52), (0.395, -0.50)],          # rear brass band
        [(0.38, -0.51), (0.385, 0.12)],                                           # steel tube
        [(0.40, 0.11), (0.415, 0.13), (0.415, 0.23), (0.40, 0.25)],              # middle brass band
        [(0.38, 0.24), (0.375, 0.82)],                                            # steel tube
        [(0.45, 0.81), (0.49, 0.84), (0.49, 0.97), (0.46, 1.0)],                 # muzzle ring, outside
        [(0.45, 1.0), (0.34, 1.02), (0.29, 1.0)],                                 # muzzle face
        [(0.29, 1.0), (0.28, 0.35), (0.0, 0.35)],                                 # bore
    ], [M["steel"], M["brass"], M["bore"]], mat_of_seg=[1, 1, 0, 1, 0, 1, 1, 2], parent=gun, sharp=35)
    barrel.rotation_euler = (-math.pi / 2, 0, 0)
    add_outline(barrel, LN["cool"])
    bm = bmesh.new()
    for z, r, n in ((-0.57, 0.41, 12), (0.18, 0.415, 12), (0.905, 0.49, 14)):
        c, nn = ring_of(n, r, z, 0.5)
        studs(bm, c, nn, r=0.032)
    c, nn = ring_of(10, 0.39, 1.015)
    studs(bm, c, [Vector((0, 0, 1))] * 10, r=0.028)
    riv = obj_from_bm("rivets_gun", bm, [M["rivet"]], parent=gun)
    riv.rotation_euler = (-math.pi / 2, 0, 0)
    # the little lamp on top at the back, on a post, its lens facing forward
    bm = bmesh.new()
    rbox(bm, (0.07, 0.12, 0.18), Matrix.Translation((0, -0.32, 0.33)), bevel=0.02)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.12, radius2=0.12, depth=0.16,
                          matrix=Matrix.Translation((0, -0.30, 0.6)) @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
    lp = obj_from_bm("gun_lamp", bm, [M["brass"]], parent=gun, sharp=35)
    add_outline(lp, LN["warm"], LINE * 0.8)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.095,
                              matrix=Matrix.Translation((0, -0.21, 0.6)) @ diag(1, 0.55, 1))
    obj_from_bm("gun_lens", bm, [M["lens"]], parent=gun)
    return body, tur


# ------------------------------------------------------------------------------------------------------------ camera/light
def setup_render():
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
    ee.taa_render_samples = 64
    for k, v in (("use_shadows", not __import__("os").environ.get("CANNON_NO_SHADOW")), ("shadow_ray_count", 3), ("shadow_step_count", 10), ("use_fast_gi", False),
                 ("use_raytracing", False), ("shadow_resolution_scale", 1.0)):
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
    cam_d.clip_start, cam_d.clip_end = 0.05, 20
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    view = bear(45, math.cos(math.radians(EL)), math.sin(math.radians(EL)))   # toward the viewer, up
    cam.location = Vector((0, 0, 1.0)) + view * 8
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


SUN = (150, 42)      # the light comes from bearing 150 (screen left, a little behind), 42 degrees up

def objs_under(root):
    return [o for o in bpy.data.objects if o.type == 'MESH' and (o.parent == root or (o.parent and o.parent.parent == root)
                                                                 or (o.parent and o.parent.parent and o.parent.parent.parent == root))]


def screen_box(cam, obs):
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in obs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            p = world_to_camera_view(sc, cam, mw @ v.co)
            xs.append(p.x * W)
            ys.append((1 - p.y) * H)
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


def fit(cam, body):
    """Scale and shift the camera so the body's box matches BODY_BOX in width, centre and bottom."""
    obs = objs_under(body)
    for _ in range(3):
        bpy.context.view_layer.update()
        x0, y0, x1, y1 = screen_box(cam, obs)
        cam.data.ortho_scale *= (x1 - x0) / (BODY_BOX[2] - BODY_BOX[0])
        bpy.context.view_layer.update()
        x0, y0, x1, y1 = screen_box(cam, obs)
        big = max(W, H)
        cam.data.shift_x += ((x0 + x1) / 2 - (BODY_BOX[0] + BODY_BOX[2]) / 2) / big
        cam.data.shift_y -= (y1 - BODY_BOX[3]) / big
    bpy.context.view_layer.update()
    return screen_box(cam, obs)


def pivot_px(cam):
    p = world_to_camera_view(bpy.context.scene, cam, Vector((0, 0, TOP)))
    return p.x * W, (1 - p.y) * H


# ------------------------------------------------------------------------------------------------------------------- main
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["body"]
    what = argv[0]
    body, tur = build()
    cam = setup_render()
    box = fit(cam, body)
    px, py = pivot_px(cam)
    OUT.mkdir(exist_ok=True)
    (OUT / "camera.json").write_text(json.dumps(dict(
        elevation=EL, tilt=TILT, ortho_scale=cam.data.ortho_scale, shift=[cam.data.shift_x, cam.data.shift_y],
        body_box=[round(v, 1) for v in box], pivot_4x=[round(px, 2), round(py, 2)], canvas=[W, H]), indent=1))
    sc = bpy.context.scene
    body_obs, tur_obs = objs_under(body), objs_under(tur)
    if what == "save":
        bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "cannon-t1.blend"))
        return

    def shot(path, seen, cut=()):
        """Render the objects in seen, with those in cut as holdouts (they hide what is behind them but draw nothing).
        Two passes, laid over each other: the paint without the outline shells (so the shells cast no shadow), then
        the shells alone with every solid part as a holdout."""
        tmp = [OUT / "_paint.png", OUT / "_lines.png"]
        for i, f in enumerate(tmp):
            for o in seen + list(cut):
                line = o.name.endswith("_line")
                o.hide_render = (line and i == 0)
                o.is_holdout = (o in cut) or (i == 1 and not line)
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
        pa, pb = pa.reshape(-1, 4), pb.reshape(-1, 4)        # straight alpha
        ab = pb[:, 3:4]
        aa = ab + pa[:, 3:4] * (1 - ab)
        rgb = (pb[:, :3] * ab + pa[:, :3] * pa[:, 3:4] * (1 - ab)) / np.maximum(aa, 1e-6)
        out = bpy.data.images.new("out", W, H, alpha=True)
        out.pixels.foreach_set(np.concatenate([rgb, aa], 1).ravel())
        out.filepath_raw = str(path)
        out.file_format = 'PNG'
        out.save()
        for im in (a, b, out):
            bpy.data.images.remove(im)
        for f in tmp:
            f.unlink()

    if what == "body":
        shot(OUT / "body-4x.png", body_obs)
    elif what == "full":
        tur.rotation_euler = (0, 0, -math.radians(11.25 * int(argv[1])))
        shot(OUT / f"full-h{int(argv[1]):02d}.png", body_obs + tur_obs)
    elif what == "barrel":
        heads = [int(a) for a in argv[1:]] or list(range(32))
        (OUT / "barrel-4x").mkdir(exist_ok=True)
        for k in heads:
            tur.rotation_euler = (0, 0, -math.radians(11.25 * k))
            shot(OUT / "barrel-4x" / f"h{k:02d}.png", tur_obs, cut=body_obs)
    print("DONE", what, "box", [round(v, 1) for v in box], "pivot", round(px, 1), round(py, 1))


main()
