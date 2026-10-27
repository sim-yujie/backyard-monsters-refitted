"""look_local.py : the Cannon 3D sample's look (helpers, painted-look materials, outline, render setup), copied from
cannon-3d/cannon3d.py (801a343c) until the shared tower-3d/look3d.py lands. Imported by sniper3d.py."""
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
EL = 23.0                             # camera elevation: the Flash renders' ellipses (ring 0.38 tall for 1 wide) say 22-24
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
            sky = self.ramp(sep.outputs[2], [(0.45, (0, 0, 0, 1)), (0.9, (1, 1, 1, 1))])
            sky = self.mix(sky, tuple(c * 0.35 for c in spec_col[:3]) + (1,), 1.0, 'MULTIPLY')
        col = self.mix(albedo, sh, 1.0, 'MULTIPLY')
        if metal:   # a soft sky sheen on faces that look up, as painted metal has
            col = self.mix(col, sky, 1.0, 'ADD')
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


def mat_brass():
    p = Paint("brass")
    base = p.ramp(p.noise(4.0, 3.0), [(0.3, srgb(200, 128, 38)), (0.7, srgb(226, 160, 60))])
    wear = p.ramp(p.noise(2.2, 4.0, 0.6), [(0.32, srgb(150, 92, 34)), (0.62, (1, 1, 1, 1))])   # painted wear
    base = p.mix(base, wear, 1.0, 'MULTIPLY')
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

