"""istore.py : the Inferno General Store, ROUND 2 first looks (21 Nov 2026). The owner: the Inferno Store should be, as
the new Infernal Lab, "similar but thematically different (inferno based)" to the surface building. So these looks are
the SURFACE General Store's own model (art/buildings-3d-store 4697f479c, store-v1/store.py and stack.py: the die on
four thumbtacks, the matchbook cover on its left face with the fold round the front corner, four sticks on top, the
strap with four holes bent over the right face, the wire ring, the crumpled sheet; every part's geometry copied here
unchanged, between the two "copied from store.py" marks) rebuilt in the Inferno's materials, worn and sooty, through
the Inferno kit's camera, light and render modes (../kit.py, untouched; the same camera as the surface Store's).

    STORE_VAR=g|d|e|f blender -b --factory-startup -P istore.py -- 1 <fit|base|check|gap>     (run.sh takes the GPU lock)

  g  the surface Store's shapes in one flat grey: only for the outline check against the surface Store's game picture.
  d  "Burnt Store": the close copy. A scorched dark-red iron die with ember pips, the matchbook burnt (its flame an
     ember, its letters ash), charred plank sticks, a rusted iron strap, a scorched hide, sooty brass tacks.
  e  "Bone and Brimstone": the same shape with more Inferno parts: the die cracked basalt with magma in the cracks and
     lava pips, bone slats on top, two horns on the strap, an iron cover with the letters branded glowing, basalt
     rubble at its foot.
  f  "Copper Works": the die clad in the Inferno Academy's blackened copper with rivets and green brimstone portholes
     for pips, iron slats, a brass strap, a copper cover with brass letters.
The covers' prints are cover-<v>.png and cover-<v>-glow.png (itex.py, from the surface Store's matchbook.png).
Nothing in the model moves (the surface Store has no animation either).

LOOK E FINISHED (22 Nov 2026, the owner's pick; all.sh renders everything, post_e.py makes the loop and the pictures):
  - the two horns lean straight across the screen, one shape mirrored, so they stand equally tall, and their seats sit
    on the strap's middle line, clear of its holes and of the paper;
  - STORE_LETTERS=0 leaves the words MATCH BOOK off the cover (colour and glow), into e-plain/ : the one switch;
  - PB_STATE=damaged / destroyed: the wrecked looks (wreck_damaged, wreck_destroyed), one rough pass each;
  - STORE_PIP / STORE_CRACK scale the pips' and the cracks' light for the glow loop's three renders (post_e.py).
"""
import math
import os
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / "lab"))
sys.path.insert(0, str(HERE.parent.parent / "store-v1"))
import kit  # noqa: E402
import imats  # noqa: E402
import stack as S  # noqa: E402

VAR = os.environ.get("STORE_VAR", "d")
LETTERS = os.environ.get("STORE_LETTERS", "1") != "0"      # 0: E's cover without the words MATCH BOOK (-> e-plain/)
GLOW_PIP = float(os.environ.get("STORE_PIP", 1.0))         # the loop's renders: the pips' / the cracks' light scaled
GLOW_CRACK = float(os.environ.get("STORE_CRACK", 1.0))
STATE = kit.STATE                                          # "damaged", "destroyed", or a loop render's tag
DMG, DEAD = STATE == "damaged", STATE == "destroyed"
DIM = 0.7 if DMG else 0.32 if DEAD else 1.0                # a wrecked store's fires burn low
kit.OUT = HERE / (VAR if LETTERS else VAR + "-plain")
kit.OUT.mkdir(exist_ok=True)
kit.ORIGIN = S.ORIGIN                    # the surface Store's origin (3.0, 33.5)
kit.FRAME = (-56, -60, 90, 76)           # the surface Store's canvas (-50,-44,80,72), wider for the horns and shadow
kit.FRAMES = 1
kit.SUN_COL = (1.0, 0.93, 0.82)          # as the Incubator, Strongbox, Academy and Infernal Lab
from kit import *  # noqa: E402,F401,F403  (SC, COLL, MOVING, MATS, NT, srgb, px, scr, painted, flat, wood ...)
FRAME, GROUND, ORIGIN = kit.FRAME, S.GROUND, kit.ORIGIN
rng = random.Random(1200)

# ===================================================================== copied from store-v1/store.py (lines 322-751)
def link(ob, parent=None):
    COLL.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def crumple(mat, scale, strength):
    """Crumpled paper: the creases of a Voronoi pattern bump the surface (added to the bump already there)."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    vo = nt.nodes.new("ShaderNodeTexVoronoi")
    vo.feature = "DISTANCE_TO_EDGE"
    vo.inputs["Scale"].default_value = scale
    bu = nt.nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = strength
    bu.inputs["Distance"].default_value = 0.03
    nt.links.new(vo.outputs["Distance"], bu.inputs["Height"])
    old = b.inputs["Normal"].links[0].from_socket if b.inputs["Normal"].links else None
    if old is not None:
        nt.links.new(old, bu.inputs["Normal"])
    nt.links.new(bu.outputs[0], b.inputs["Normal"])


def crumple_geo(ob, size, amount, seed=0):
    """Crumple a mesh: a fine subdivision pushed along its normals by a Voronoi texture (sharp creases, flat facets)."""
    sub = ob.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 2
    sub.subdivision_type = "SIMPLE"
    tx = bpy.data.textures.new(f"{ob.name}-crumple", "VORONOI")
    tx.noise_scale = size
    tx.distance_metric = "DISTANCE"
    dm = ob.modifiers.new("crumple", "DISPLACE")
    dm.texture = tx
    dm.texture_coords = "GLOBAL"
    dm.strength = amount
    dm.mid_level = 1.0                    # only inward: no pushing into the parts around it
    ob.modifiers.new("smooth", "SMOOTH").factor = 0.3
    return ob


def mesh_ob(name, bm, mats, smooth=True, bevel=0.0, segs=3, parent=None, subsurf=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me)
    link(ob, parent)
    if bevel:
        mo = ob.modifiers.new("bevel", "BEVEL")
        mo.width = bevel
        mo.segments = segs
        mo.limit_method = "ANGLE"
        mo.harden_normals = smooth
    if subsurf:
        mo = ob.modifiers.new("sub", "SUBSURF")
        mo.levels = mo.render_levels = subsurf
    return ob


def box(name, size, at, mat, rot=(0, 0, 0), bevel=0.05, parent=None, jitter=0.0, taper=1.0, origin="bottom", bow=0.0,
        segs=3):
    """A box `size` (x, y, z) standing on `at` (origin="bottom") or centred on it, turned by rot (degrees, XYZ).
    bow: the middle of its height pushed toward local -Y by that much (a plank that bulges out of a wall)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    if bow:
        bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6],
                                  cuts=8)
    for v in bm.verts:
        if bow:
            v.co.y -= bow / size[1] * math.sin(math.pi * (v.co.z + 0.5))
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
        if origin == "bottom":
            v.co.z += size[2] / 2
        if taper != 1.0 and v.co.z > (size[2] / 2 if origin == "bottom" else 0):
            v.co.x *= taper
            v.co.y *= taper
        if jitter:
            v.co += Vector((rng.uniform(-jitter, jitter) for _ in range(3)))
    ob = mesh_ob(name, bm, [mat], bevel=bevel, segs=segs, parent=parent)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def cyl(name, r, depth, at, mat, rot=(0, 0, 0), verts=24, bevel=0.03, parent=None, r2=None, mats=None, caps=True):
    """A cylinder along its local Z, from at (base) up `depth`; r2 = top radius (a cone)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    for v in bm.verts:
        v.co.z += depth / 2
    ob = mesh_ob(name, bm, mats or [mat], bevel=bevel, parent=parent)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def lathe(name, prof, at, mat, rot=(0, 0, 0), verts=32, parent=None, bevel=0.0):
    """Spin a (r, z) profile round local Z."""
    bm = bmesh.new()
    rows = []
    for r, z in prof:
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * i / verts), r * math.sin(2 * math.pi * i / verts), z))
                     for i in range(verts)])
    for a, b in zip(rows, rows[1:]):
        for i in range(verts):
            j = (i + 1) % verts
            bm.faces.new((a[i], a[j], b[j], b[i]))
    ob = mesh_ob(name, bm, [mat], bevel=bevel, parent=parent)
    ob.location = at
    ob.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    return ob


def tube(name, pts, r, mat, parent=None, verts=12, r_end=None, cyclic=False, smooth=False):
    """A round stick through world points pts (a curve with a round bevel); cyclic closes it into a seamless loop,
    smooth bends it softly through the points (a Bezier curve) instead of at sharp corners."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    if smooth:
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(pts) - 1)
        cps = sp.bezier_points
        for p, q in zip(cps, pts):
            p.co = q
            p.handle_left_type = p.handle_right_type = "AUTO"
    else:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        cps = sp.points
        for p, q in zip(cps, pts):
            p.co = (q[0], q[1], q[2], 1)
    sp.use_cyclic_u = cyclic
    if r_end is not None:
        for i, p in enumerate(cps):
            p.radius = 1 + (r_end / r - 1) * i / max(1, len(pts) - 1)
    ob = bpy.data.objects.new(name, cu)
    cu.materials.append(mat)
    link(ob, parent)
    return ob


def plank_wall(name, p0, p1, z0, z1, mat_fn, n, thick=0.12, gap=0.025, out=None, jit=0.02, bulge=0.0):
    """A wall of n upright planks from ground point p0 to p1 (world XY), heights z0..z1, facing `out` (a unit XY).
    bulge: the wall bellies out by that much in the middle, across and up (the planks run counter-clockwise seen from
    above, so local -Y is outward)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    ang = math.degrees(math.atan2(d.y, d.x))
    w = length / n
    obs = []
    for i in range(n):
        c = p0 + d * ((i + 0.5) / n)
        f = (i + 0.5) / n
        turn = 0.0
        if out is not None:
            c += Vector(out) * (-thick / 2 + rng.uniform(-jit, jit) + 0.5 * bulge * math.sin(math.pi * f))
            turn = -math.degrees(math.atan(0.5 * bulge * math.pi * math.cos(math.pi * f) / length))
        top = z1 + rng.uniform(-0.04, 0.04)
        obs.append(box(f"{name}{i}", (w - gap, thick, top - z0), (c.x, c.y, z0), mat_fn("Z"),
                       rot=(rng.uniform(-1.2, 1.2), rng.uniform(-1.5, 1.5), ang + turn), bevel=0.03,
                       bow=0.5 * bulge))
    return obs


def gear(name, r, teeth, depth, at, mat, rot, tooth=0.18, parent=None, hole=0.0):
    """A flat toothed wheel in its local XY (axis local Z), centred on at."""
    bm = bmesh.new()
    pts = []
    for i in range(teeth * 4):
        a = 2 * math.pi * i / (teeth * 4)
        rr = r if (i % 4) in (0, 1) else r * (1 - tooth)
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    vs = [bm.verts.new((x, y, -depth / 2)) for x, y in pts]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [mat], smooth=False, bevel=min(0.02, depth / 4), segs=2, parent=parent)
    ob.location = at
    ob.rotation_euler = rot
    return ob




def spinner(name, center, normal_bearing, tilt, parts):
    """An empty at center whose local Z is the axle: normal_bearing (deg, ground bearing from +X toward +Y) and tilted up
    by `tilt`. parts(parent) builds the wheel in local coords (XY = the disc's plane)."""
    e = bpy.data.objects.new(name, None)
    link(e)
    e.location = center
    a = math.radians(normal_bearing)
    n = Vector((math.cos(a), math.sin(a), 0))
    n = (n * math.cos(math.radians(tilt)) + Vector((0, 0, math.sin(math.radians(tilt))))).normalized()
    e.rotation_euler = n.to_track_quat("Z", "Y").to_euler()
    hub = bpy.data.objects.new(name + "-spin", None)
    link(hub, e)
    parts(hub)
    return e, hub



# ------------------------------------------------------------------------------------------------------------ the model
def shiny(name, col, rough=0.3, metal=0.85, wear=None, scale=5.0, dirt=0.25, spec=0.5, coat=0.0, ao_min=0.5,
          streak=0.0, side=0.0, glow=()):
    """Flash's Hatchery is a glossy render: polished gold, chrome, red enamel. Soft, broad reflections, a faint
    mottle (`wear` colour in soft patches), darker in the creases and low down, and faint vertical polish streaks."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    out = srgb(*col)
    if wear:
        n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.2)
        out = t.mix(out, srgb(*wear), t.ramp(n1, [(0.42, (0, 0, 0, 1)), (0.78, (0.55, 0.55, 0.55, 1))]))
    rr = rough
    if streak:
        v2 = t.coords(scale=(6.0, 6.0, 0.4))
        n2 = t.noise(v2, 3.0, 4.0, 0.6)
        rr = t.ramp(n2, [(0.3, (rough * (1 - streak),) * 3 + (1,)), (0.7, (min(1.0, rough * (1 + streak)),) * 3 + (1,))])
    if side:                       # painted soft shading: lighter on the left (toward the light), darker on the right
        geo = t.n("ShaderNodeNewGeometry")
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dp.inputs[0])
        dp.inputs[1].default_value = (-0.707, -0.707, 0.0)
        mr = t.n("ShaderNodeMapRange")
        mr.inputs[1].default_value, mr.inputs[2].default_value = -3.4, 3.4
        mr.inputs[3].default_value, mr.inputs[4].default_value = 1.0 - side, 1.0 + side * 0.25
        t.link(dp.outputs["Value"], mr.inputs[0])
        grey = t.n("ShaderNodeCombineColor")
        for i in range(3):
            t.link(mr.outputs[0], grey.inputs[i])
        out = t.mix(out, grey.outputs[0], 1.0, "MULTIPLY")
    for k, g in enumerate(glow):
        fac = screen_spot(t, *g[:5])
        out = t.mix(out, srgb(*g[5]), fac)
        if k == 0:                 # the main sheen also glows a little, so the metal can't swallow it
            t.set(**{"Emission Color": srgb(*g[5]), "Emission Strength": fac})
    out = t.grime(out, GROUND, 4.0, dirt, ao_min)
    t.set(**{"Base Color": out, "rough": rr, "metal": metal, "spec": spec})
    if coat:
        t.set(coat=coat)
        t.bsdf.inputs["Coat Roughness"].default_value = 0.12
    t.bump(t.noise(v, scale * 4, 4.0, 0.6), 0.03, 0.01)
    MATS[name] = t.m
    return t.m



def screen_spot(t, cx, cy, ax, ay, amount):
    """A soft oval at Flash pixel (cx, cy) with half-axes (ax, ay) px, as seen through the camera (which covers FRAME):
    for a painted highlight that must sit where Flash draws it, e.g. the white sheen across the dish."""
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(tc.outputs["Window"], sep.inputs[0])
    w, h = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
    comb = t.n("ShaderNodeCombineXYZ")
    for i, (scale, off) in enumerate(((w / ax, (FRAME[0] - cx) / ax), (-h / ay, (FRAME[3] - cy) / ay))):
        m = t.n("ShaderNodeMath", operation="MULTIPLY_ADD")
        t.link(sep.outputs[i], m.inputs[0])
        m.inputs[1].default_value, m.inputs[2].default_value = scale, off
        t.link(m.outputs[0], comb.inputs[i])
    ln = t.n("ShaderNodeVectorMath", operation="LENGTH")
    t.link(comb.outputs[0], ln.inputs[0])
    mr = t.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    mr.inputs[1].default_value, mr.inputs[2].default_value = 1.0, 0.0
    mr.inputs[3].default_value, mr.inputs[4].default_value = 0.0, amount
    t.link(ln.outputs["Value"], mr.inputs[0])
    return mr.outputs[0]


def printed(name, path, rough=0.62, dirt=0.3):
    """Printed card: the picture `path` on the part's UV map, a fine paper grain, darker low down and in the creases."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    im = t.n("ShaderNodeTexImage")
    im.image = bpy.data.images.load(str(path))
    im.interpolation = "Cubic"
    col = t.grime(im.outputs["Color"], GROUND, 4.0, dirt, 0.6)
    t.set(**{"Base Color": col, "rough": rough, "spec": 0.3})
    t.bump(t.noise(t.coords(), 40, 3.0, 0.6), 0.04, 0.01)
    MATS[name] = t.m
    return t.m


def along(name, stops, axis="X", lo=0.0, hi=1.0, space="Generated", rough=0.55, spec=0.4, dirt=0.2, grain=0.0,
          wear=None, scale=4.0, side=0.0, rim=None, wear_amt=0.5):
    """A colour that changes along one axis (Generated: the part's own box 0..1; Object: world units lo..hi), with a
    faint mottle and, if grain, the soft streaks of pale wood along the same axis; rim (colour, strength) greys the
    faces that turn away from the top (Flash shades its sticks' rounded rims grey)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(t.n("ShaderNodeTexCoord").outputs[space], sep.inputs[0])
    mr = t.n("ShaderNodeMapRange")
    mr.inputs[1].default_value, mr.inputs[2].default_value = lo, hi
    t.link(sep.outputs[axis], mr.inputs[0])
    out = t.ramp(mr.outputs[0], [(p, srgb(*c)) for p, c in stops])
    v = t.coords()
    if grain:
        k = {"X": (0.6, 14, 14), "Y": (14, 0.6, 14), "Z": (14, 14, 0.6)}[axis]
        g = t.noise(t.coords(scale=k), 1.0, 6.0, 0.6, 0.5)
        out = t.mix(out, t.ramp(g, [(0.3, srgb(150, 140, 136)), (0.7, (1, 1, 1, 1))]), grain, "MULTIPLY")
    if wear:
        n1 = t.noise(v, scale * 0.5, 3.0, 0.5, 0.2)
        out = t.mix(out, srgb(*wear), t.ramp(n1, [(0.45, (0, 0, 0, 1)), (0.78, (wear_amt,) * 3 + (1,))]))
    if rim:
        geo = t.n("ShaderNodeNewGeometry")
        sz = t.n("ShaderNodeSeparateXYZ")
        t.link(geo.outputs["Normal"], sz.inputs[0])
        mr3 = t.n("ShaderNodeMapRange")
        mr3.inputs[1].default_value, mr3.inputs[2].default_value = 0.97, 0.3
        mr3.inputs[3].default_value, mr3.inputs[4].default_value = 0.0, rim[1]
        t.link(sz.outputs["Z"], mr3.inputs[0])
        fac = mr3.outputs[0]
        if len(rim) > 2:                          # only above height rim[2] (world z, fading in over 0.1 below it)
            sp = t.n("ShaderNodeSeparateXYZ")
            t.link(geo.outputs["Position"], sp.inputs[0])
            mr4 = t.n("ShaderNodeMapRange")
            mr4.inputs[1].default_value, mr4.inputs[2].default_value = rim[2] - 0.1, rim[2]
            t.link(sp.outputs["Z"], mr4.inputs[0])
            ml = t.n("ShaderNodeMath", operation="MULTIPLY")
            t.link(fac, ml.inputs[0])
            t.link(mr4.outputs[0], ml.inputs[1])
            fac = ml.outputs[0]
        out = t.mix(out, srgb(*rim[0]), fac)
    if side:
        geo = t.n("ShaderNodeNewGeometry")
        dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        t.link(geo.outputs["Position"], dp.inputs[0])
        dp.inputs[1].default_value = (-0.707, -0.707, 0.0)
        mr2 = t.n("ShaderNodeMapRange")
        mr2.inputs[1].default_value, mr2.inputs[2].default_value = -3.4, 3.4
        mr2.inputs[3].default_value, mr2.inputs[4].default_value = 1.0 - side, 1.0 + side * 0.25
        t.link(dp.outputs["Value"], mr2.inputs[0])
        grey = t.n("ShaderNodeCombineColor")
        for i in range(3):
            t.link(mr2.outputs[0], grey.inputs[i])
        out = t.mix(out, grey.outputs[0], 1.0, "MULTIPLY")
    out = t.grime(out, GROUND, 4.0, dirt, 0.6)
    t.set(**{"Base Color": out, "rough": rough, "spec": spec})
    t.bump(t.noise(v, scale * 6, 4.0, 0.6), 0.04, 0.01)
    MATS[name] = t.m
    return t.m


def lift(mat, col, strength):
    """Flash lights its painted buildings evenly: a faint glow of the part's own colour lifts the side away from the sun."""
    b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Emission Color"].default_value = srgb(*col)
    b.inputs["Emission Strength"].default_value = strength


def lift_low(mat, s_low, z0, z1):
    """The lift (above) fades to s_low at height z0 (up to its full strength at z1): Flash's die darkens low down,
    and an even glow would wash the grime out."""
    nt = mat.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    mr = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], mr.inputs[0])
    mr.inputs[1].default_value, mr.inputs[2].default_value = z0, z1
    mr.inputs[3].default_value, mr.inputs[4].default_value = s_low, b.inputs["Emission Strength"].default_value
    nt.links.new(mr.outputs[0], b.inputs["Emission Strength"])


def pip_mat():
    """The pips: grey, shiny round dimples, painted as Flash shades them (dark inside the upper right rim, pale grey low
    on the left, no white), since the sun never reaches the die's right face."""
    t = NT("pip")
    dp = t.n("ShaderNodeVectorMath", operation="DOT_PRODUCT")
    t.link(t.n("ShaderNodeNewGeometry").outputs["Normal"], dp.inputs[0])
    dp.inputs[1].default_value = (0.0, -0.55, -0.835)     # bright low on the left (the cut faces' normals point in)
    mr = t.n("ShaderNodeMapRange")              # -0.9..0.9 -> 0..1
    mr.inputs[1].default_value, mr.inputs[2].default_value = -0.9, 0.9
    t.link(dp.outputs["Value"], mr.inputs[0])
    col = t.ramp(mr.outputs[0], [(0.0, srgb(100, 100, 108)), (0.38, srgb(140, 140, 148)), (0.58, srgb(184, 184, 192)),
                                 (0.7, srgb(226, 226, 232)), (0.8, srgb(198, 198, 206)), (1.0, srgb(176, 176, 184))])
    # Flash's pips are mottled, worn silver, not clean
    mot = t.noise(t.coords(), 14.0, 4.0, 0.6)
    col = t.mix(col, srgb(118, 118, 126), t.ramp(mot, [(0.45, (0, 0, 0, 1)), (0.7, (0.45, 0.45, 0.45, 1))]))
    t.set(**{"Base Color": col, "rough": 0.4, "spec": 0.5, "Emission Color": col, "Emission Strength": 0.45})
    t.bump(t.noise(t.coords(), 30, 3.0, 0.6), 0.08, 0.01)
    MATS["pip"] = t.m
    return t.m


def fold_mat():
    """The cover's fold round the die's front corner (Flash: a strip of the cover's red where the print ends, then a
    near-black maroon band with darker creases running down it, browner at the top)."""
    t = NT("fold")
    uv = t.n("ShaderNodeUVMap")
    sep = t.n("ShaderNodeSeparateXYZ")
    t.link(uv.outputs["UV"], sep.inputs[0])
    mr = t.n("ShaderNodeMapRange")                 # across the band: u from 1 (the crease) to FOLD_U1 (its far edge)
    mr.inputs[1].default_value, mr.inputs[2].default_value = 1.0, FOLD_U1
    t.link(sep.outputs["X"], mr.inputs[0])
    col = t.ramp(mr.outputs[0], [(0.0, srgb(198, 70, 82)), (0.18, srgb(182, 56, 68)), (0.3, srgb(96, 34, 32)),
                                 (0.55, srgb(64, 22, 22)), (0.8, srgb(80, 28, 26)), (1.0, srgb(58, 18, 18))])
    # creases: a few soft dark lines running down the band
    cr = t.noise(t.coords(scale=(4.0, 4.0, 0.25)), 2.0, 2.0, 0.4, 0.2)
    col = t.mix(col, srgb(44, 12, 16), t.ramp(cr, [(0.58, (0, 0, 0, 1)), (0.7, (0.7, 0.7, 0.7, 1))]))
    # browner at the top
    mz = t.n("ShaderNodeMapRange")
    mz.inputs[1].default_value, mz.inputs[2].default_value = 0.7, 1.0
    t.link(sep.outputs["Y"], mz.inputs[0])
    col = t.mix(col, srgb(96, 44, 22), t.ramp(mz.outputs[0], [(0.0, (0, 0, 0, 1)), (1.0, (0.7, 0.7, 0.7, 1))]))
    col = t.grime(col, GROUND, 4.0, 0.2, 0.6)
    t.set(**{"Base Color": col, "rough": 0.85, "spec": 0.25})
    t.bump(cr, 0.1, 0.02)
    MATS["fold"] = t.m
    return t.m


# ===================================================================== end of the first copied part


# ------------------------------------------------------------------------------------------------------------ materials
def printed_glow(name, path, glow_path, strength, rough=0.62, dirt=0.3, metal=0.0):
    """store.py's printed card, with a second picture as its own light (the flame, the branded letters)."""
    m = printed(name, path, rough=rough, dirt=dirt)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Metallic"].default_value = metal
    im = nt.nodes.new("ShaderNodeTexImage")
    im.image = bpy.data.images.load(str(glow_path))
    im.interpolation = "Cubic"
    nt.links.new(im.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = strength
    return m


def materials():
    M = {}
    P_ = kit.painted
    if VAR == "g":
        grey = kit.flat("grey", (128, 128, 128), rough=0.8)
        for k in ("die", "pip", "cover", "striker", "strap", "paper", "blob", "tack", "tackdark", "pin", "wire",
                  "wire2", "hole", "stick0", "stick1", "stick2", "stick3"):
            M[k] = grey
        return M
    M["hole"] = kit.flat("s-hole", (10, 8, 8), rough=1.0)
    M["iron"] = P_("s-iron", (52, 49, 52), rough=0.5, metal=0.8, wear=(86, 80, 76), rust=(92, 50, 32), scale=2.2,
                   dirt=0.4, soot=0.65, rust_at=0.62)
    M["wire"] = P_("s-wire", (70, 66, 66), rough=0.5, metal=0.8, wear=(110, 102, 96), scale=6.0, dirt=0.1)
    M["wire2"] = P_("s-wire2", (38, 35, 36), rough=0.6, metal=0.6, wear=(60, 56, 56), scale=6.0, dirt=0.0)
    M["tack"] = P_("s-tack", (176, 116, 44), rough=0.36, metal=0.85, wear=(112, 70, 28), scale=2.0, dirt=0.5, soot=0.5)
    M["tackdark"] = P_("s-tackdark", (128, 80, 34), rough=0.4, metal=0.85, wear=(84, 50, 24), scale=2.0, dirt=0.5,
                       soot=0.55)
    M["pin"] = P_("s-pin", (104, 82, 50), rough=0.4, metal=0.85, wear=(70, 56, 40), scale=4.0, dirt=0.2, soot=0.3)
    M["blob"] = P_("s-blob", (84, 78, 74), rough=0.45, metal=0.8, wear=(120, 112, 104), scale=6.0, dirt=0.2)
    M["stone"] = imats.rock("s-stone", (34, 30, 30), (66, 60, 56), scale=2.5)
    M["bone"] = imats.bone("s-bone", col=(176, 158, 122), tip=(52, 42, 36), z0=S.ZSTICK, z1=S.ZSTICK + 3.2)
    tag = VAR if LETTERS or VAR != "e" else "e-plain"
    cov, glow = HERE / f"cover-{tag}.png", HERE / f"cover-{tag}-glow.png"
    if VAR == "d":
        # the surface die's red, burnt: scorched dark-red enamel on iron, the iron showing at the worn places
        M["die"] = P_("s-die", (128, 40, 30), rough=0.55, metal=0.45, wear=(62, 56, 56), rust=(120, 62, 30), scale=1.5,
                      dirt=0.5, soot=0.75, rust_at=0.6, grain=0.2)
        M["pip"] = imats.magma("s-pip", strength=1.6, scale=2.0)
        M["cover"] = printed_glow("s-cover", cov, glow, 2.2, rough=0.7, dirt=0.45)
        M["striker"] = P_("s-fold", (30, 22, 22), rough=0.85, wear=(58, 40, 34), scale=5.0, dirt=0.3, soot=0.5)
        cols = (((112, 100, 88), (54, 44, 38)), ((104, 90, 78), (46, 38, 34)), ((96, 80, 68), (40, 32, 30)),
                ((88, 70, 58), (34, 28, 26)))
        for i, (a, b) in enumerate(cols):       # charred planks: ash grey at the back, charcoal toward the front
            M[f"stick{i}"] = kit.wood(f"s-stick{i}", a, b, axis="Y", rings=5.0, rough=0.85, dirt=0.45, knots=False)
        M["strap"] = P_("s-strap", (112, 66, 40), rough=0.6, metal=0.6, wear=(70, 60, 56), rust=(70, 36, 24), scale=3.0,
                        dirt=0.3, soot=0.55, rust_at=0.5)
        M["paper"] = P_("s-hide", (86, 48, 36), rough=0.9, wear=(128, 84, 58), scale=5.0, dirt=0.2, soot=0.6)
    elif VAR == "e":
        M["die"] = imats.rock("s-basalt", (38, 34, 34), (72, 64, 60), crack=(255, 120, 24), crack_scale=1.1,
                              crack_cover=0.45 if DMG or DEAD else 0.38, glow=4.0 * GLOW_CRACK * DIM, scale=2.4)
        M["pip"] = imats.magma("s-pip", hot=(255, 112, 16), core=(255, 200, 80), strength=1.9 * GLOW_PIP * DIM, scale=2.0)
        M["cover"] = printed_glow("s-cover", cov, glow, 2.6 * DIM, rough=0.55, dirt=0.45, metal=0.6)
        M["striker"] = M["iron"]
        for i in range(4):                      # old bone slats, yellowed and sooty
            c = (176 - 8 * i, 156 - 9 * i, 118 - 9 * i)
            M[f"stick{i}"] = P_(f"s-slat{i}", c, rough=0.7, wear=(118, 100, 74), scale=3.0, dirt=0.5,
                                soot=0.85 if DMG or DEAD else 0.6)
        M["strap"] = P_("s-strap", (60, 54, 54), rough=0.5, metal=0.8, wear=(104, 94, 86), rust=(98, 52, 32), scale=3.0,
                        dirt=0.3, soot=0.5, rust_at=0.55)
        M["paper"] = P_("s-hide", (70, 36, 30), rough=0.9, wear=(120, 64, 40), scale=5.0, dirt=0.2, soot=0.6)
        M["tack"] = P_("s-tackiron", (74, 70, 72), rough=0.45, metal=0.85, wear=(120, 112, 104), rust=(96, 54, 34),
                       scale=2.0, dirt=0.4, soot=0.5, rust_at=0.6)
        M["tackdark"] = M["tack"]
        M["pin"] = M["iron"]
        # what shows where a wrecked die is broken open: lava going cold under a dark crust
        M["core"] = imats.magma("s-core", hot=(255, 104, 16), core=(255, 190, 70), strength=2.2 * DIM, crust_at=0.5,
                                scale=1.6)
    else:
        M["die"] = P_("s-copper", (150, 80, 40), rough=0.34, metal=0.95, wear=(104, 52, 28), rust=(64, 110, 88),
                      scale=1.2, dirt=0.45, soot=0.6, rust_at=0.6, streak=1.0, grain=0.2)
        M["pip"] = imats.brew("s-green", (22, 86, 20), (70, 170, 36), (168, 240, 60), (226, 255, 150), strength=1.2,
                              scale=2.4)
        M["cover"] = printed_glow("s-cover", cov, glow, 0.0, rough=0.4, dirt=0.45, metal=0.85)
        M["striker"] = M["iron"]
        for i in range(4):                      # rusted iron slats
            M[f"stick{i}"] = P_(f"s-slat{i}", (64 - 3 * i, 60 - 4 * i, 62 - 4 * i), rough=0.5, metal=0.8,
                                wear=(104, 96, 90), rust=(104, 56, 32), scale=2.0, dirt=0.3, soot=0.6,
                                rust_at=0.56 - 0.02 * i, streak=1.0)
        M["strap"] = P_("s-strap", (160, 106, 44), rough=0.38, metal=0.85, wear=(100, 62, 26), scale=3.0, dirt=0.35,
                        soot=0.55)
        M["paper"] = P_("s-hide", (60, 44, 40), rough=0.9, wear=(104, 76, 60), scale=5.0, dirt=0.2, soot=0.6)
        M["tack"] = M["iron"]
        M["tackdark"] = M["iron"]
        M["pin"] = M["iron"]
        M["rivet"] = P_("s-rivet", (150, 100, 44), rough=0.4, metal=0.85, wear=(96, 60, 26), scale=6.0, dirt=0.2)
    if VAR != "g":
        crumple(M["paper"], 9.0, 0.35)
    return M


# ===================================================================== copied from store-v1/store.py (lines 798-1170 and 1198-1259)
def mb_path():
    """The cover's path seen from above: flat along the left face to where the die's corner starts to round, then a
    fold that wraps the corner standing off it (a dark gap between the fold and the die, as Flash's), ending at the
    corner's middle. Returns the points and the path fraction where the print ends (MB_X1) and the fold begins."""
    rc = S.DIE_R
    o = rc + S.MB_GAP
    cx, cy = A - rc, -A + rc
    path = [(S.MB_X0 + (cx - S.MB_X0) * i / 24, cy - o) for i in range(25)]
    for k in range(1, 17):
        a = math.radians(-90 + 45 * k / 16)
        r = o + 0.1 * k / 16
        path.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    ls = sum(math.dist(p, q) for p, q in zip(path, path[1:]))
    return path, (S.MB_X1 - S.MB_X0) / ls


A = S.DIE_A
# the lean: a shear, not a turn, so the die's upright edges stay upright on screen (as Flash's): z drops with y
_tn = math.tan(math.radians(S.TILT))
TILT_M = Matrix(((1, 0, 0, 0), (0, 1, 0, 0), (0, -_tn, 1, _tn * S.TILT_PIVOT[0]), (0, 0, 0, 1)))
FOLD_U1 = 1.0 / mb_path()[1]          # the fold's far edge in the cover's UV (the print fills u 0..1)
M = materials()
ZT = S.ZTOP


def bake(ob):
    """Apply ob's modifiers (a plain mesh again)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me
    return ob


def die():
    """The red die: a box with rounded edges, six pips sunk in its right (+X) face."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 2 * A
        v.co.y *= 2 * A
        v.co.z = S.DIE_Z0 + (v.co.z + 0.5) * S.DIE_H
    d = mesh_ob("die", bm, [M["die"]], bevel=S.DIE_R, segs=5)
    bake(d)
    # the pips: spheres whose caps cut PIP_R wide and PIP_DEPTH deep (the cut faces take the pip's white)
    rs = (S.PIP_R ** 2 + S.PIP_DEPTH ** 2) / (2 * S.PIP_DEPTH)
    bm = bmesh.new()
    zc = S.PIP_Z
    for y in S.PIP_Y:
        for k in (-1, 0, 1):
            bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=rs,
                                      matrix=Matrix.Translation((A + rs - S.PIP_DEPTH, y, zc + k * S.PIP_DZ)))
    cut = mesh_ob("pipcut", bm, [M["pip"]])
    mo = d.modifiers.new("pips", "BOOLEAN")
    mo.operation = "DIFFERENCE"
    mo.object = cut
    try:
        mo.solver = "EXACT"
    except TypeError:
        pass
    mo.material_mode = "TRANSFER"
    bake(d)
    bpy.data.objects.remove(cut)
    return d


def sheet(name, path, z0, z1, nz, mats, split, thick=0.05, warp=0.0, flare=0.0, crumple=0.0):
    """Thin card standing on the XY path (a list of (x, y)), from z0(s) to z1 (s = 0..1 along the path), UV over the
    whole of it; faces past path fraction `split` take the second material. warp: a gentle wave out of its plane."""
    pts = [Vector((x, y)) for x, y in path]
    ls = [0.0]
    for a, b in zip(pts, pts[1:]):
        ls.append(ls[-1] + (b - a).length)
    tot = ls[-1]
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    rows = []
    for i, p in enumerate(pts):
        s = ls[i] / tot
        a = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        nrm = Vector((a.y, -a.x)).normalized()          # outward (the path runs counter-clockwise seen from above)
        za = z0(s)
        col = []
        for j in range(nz + 1):
            f = j / (nz - 1 + 1)
            z = za + (z1 - za) * f
            w = warp * (math.sin(7.0 * s + 2.0 * f) * 0.5 + math.sin(3.1 * f * math.pi) * 0.6) if warp else 0.0
            w += flare * (1.0 - f) ** 2 * min(1.0, max(0.0, (split + 0.06 - s) / 0.08))   # the bottom hangs away
            if s > split:                     # the fold crumples low down
                u = (s - split) / (1.0 - split)
                w += crumple * math.sin(u * 19.0 + 0.4) * max(0.0, 1.0 - f * 3.0) ** 2
            q = p + nrm * w
            col.append(bm.verts.new((q.x, q.y, z)))
        rows.append((s, col))
    for (s0, c0), (s1, c1) in zip(rows, rows[1:]):
        for j in range(nz):
            f = bm.faces.new((c0[j], c1[j], c1[j + 1], c0[j + 1]))
            f.material_index = 1 if (s0 + s1) / 2 > split else 0
            for lp in f.loops:
                vs = lp.vert
                si = s0 if vs in c0 else s1
                lp[uv].uv = (si * tot / (split * tot) if split else si,
                             (vs.co.z - z0(si)) / (z1 - z0(si)))
    ob = mesh_ob(name, bm, mats)
    mo = ob.modifiers.new("thick", "SOLIDIFY")
    mo.thickness = thick
    mo.offset = 1.0
    return ob


def matchbook():
    """The cover glued to the left (-Y) face: printed front, then the fold round the front corner."""
    path, split = mb_path()

    def z0(s):          # the bottom edge: lowest at the left, rising toward the front, highest under the fold
        z = S.MB_Z0 + S.MB_RISE * min(1.0, s / 0.68) + max(0.0, s - split + 0.04) * 1.5
        u = (s - split) / (1.0 - split)                  # across the fold: its bottom edge is crumpled, not straight
        if u > 0.0:
            z += 0.16 * math.sin(u * 17.0 + 0.6) * math.sin(u * 5.3 + 1.1) - 0.12 * math.sin(u * math.pi)
        return z

    ob = sheet("mbcover", path, z0, S.MB_Z1, 24, [M["cover"], M["striker"]], split, thick=0.05, warp=0.025,
               flare=S.MB_FLARE, crumple=0.05)
    # the print sits on the outside; the solidify's inner skin (toward the die) is the same card
    return ob


def tacks():
    prof = [(0.0, S.TACK_T + 0.05), (S.TACK_R * 0.5, S.TACK_T + 0.035), (S.TACK_R - 0.05, S.TACK_T),
            (S.TACK_R, S.TACK_T - 0.04), (S.TACK_R, 0.02), (S.TACK_R - 0.03, 0.0), (0.0, 0.0)]
    for i, ((gx, gy), top) in enumerate(S.TACKS):
        lathe(f"tack{i}", prof, (gx, gy, GROUND), M["tackdark"] if i == 0 else M["tack"], verts=48)
        lathe(f"tackboss{i}", [(0.0, 0.04), (0.05, 0.035), (0.068, 0.0)], (gx, gy, S.TACK_T + 0.02),
              M["tack"], verts=24)
        a = Vector((gx, gy, S.TACK_T + 0.03))
        b = TILT_M @ Vector(top)                       # the body leans; the pin goes up into it where it now is
        b = b + (b - a).normalized() * 0.12              # a little into the card or the die
        tube(f"tackpin{i}", [a, b], 0.042, M["pin"], verts=10)


def sticks():
    n, w, t = S.STICK_N, S.STICK_W, S.STICK_T
    gap = (S.STICK_X1 - S.STICK_X0 - n * w) / (n - 1)
    jit = ((0.0, 0.0, 0.15), (-0.06, 0.05, -0.15), (0.05, -0.04, 0.2), (0.1, 0.02, -0.3))
    for i in range(n):
        x = S.STICK_X0 + w / 2 + i * (w + gap)
        dy0, dy1, rz = jit[i]
        y0, y1 = S.STICK_Y0 + dy0, S.STICK_Y1 + dy1
        r = w / 2
        pts = []
        for k in range(17):                       # the rounded ends
            a = math.pi + math.pi * k / 16
            pts.append((r * math.cos(a), y0 + r + r * math.sin(a) * 0.9))
        for k in range(17):
            a = math.pi * k / 16
            pts.append((r * math.cos(a), y1 - r + r * math.sin(a) * 0.9))
        bm = bmesh.new()
        vs = [bm.verts.new((px_, py_, 0.0)) for px_, py_ in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
            v.co.z += t
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ob = mesh_ob(f"stick{i}", bm, [M[f"stick{i}"]], smooth=True, bevel=S.STICK_BEVEL, segs=5)
        ob.location = (x, 0.0, ZT + 0.006)
        ob.rotation_euler = (0.0, 0.0, math.radians(rz))


def lift(x):
    """How far the strap (and the paper under it) rides up over the paper bunched beneath its right part (Flash's
    strap and its yellow end sit high over the sticks)."""
    t = min(1.0, max(0.0, (x + 1.5) / 3.6))
    return S.STRAP_RAISE + S.STRAP_LIFT * (0.35 + 0.65 * t * t * (3 - 2 * t))


def strap():
    """Across the sticks near their back, its yellow end bent down over the die's right face, with four holes; a wire
    ring hangs from the last hole round the top-right pip."""
    zs = S.ZSTICK + 0.04 + S.STRAP_T / 2               # on the paper
    y = S.STRAP_Y
    x0 = S.STRAP_X0
    pts = [(-3.0, y - 0.05, zs - 0.07), (-2.82, y - 0.025, zs - 0.02), (-2.6, y - 0.01, zs), (-2.3, y, zs),
           (x0, y, zs)]                         # its long left end: flat, sagging a little past the sticks' back edge
    pts += [(x0 + (A - 0.05 - x0) * i / 20, y, zs) for i in range(1, 21)]
    pts = [(px_, py_, pz + lift(px_)) for px_, py_, pz in pts]       # riding up over the paper bunched under it
    lr = lift(A)
    lr0 = lr - S.STRAP_RAISE                  # its bent-down end, hole and ring stay where they were (round the pip)
    pts += [(A + 0.06, y, zs - 0.06 + lr), (A + 0.1, y, zs - 0.2 + lr), (A + 0.09, y, ZT - 0.2 + lr0),
            (A + 0.08, y, ZT - 0.62 + lr0)]
    sweep("strap", pts, (0, 1, 0), S.STRAP_W, S.STRAP_T, M["strap"], bevel=0.02)
    torn_end(pts[1], pts[0])
    # Flash's white-blue blob on the paper just behind the strap's left end
    bx = -2.55
    bl = bpy.data.meshes.new("paperblob")
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    rb = random.Random(3)
    for v in bm.verts:
        v.co *= 1.0 + rb.uniform(-0.12, 0.12)
    bm.to_mesh(bl)
    bm.free()
    bl.polygons.foreach_set("use_smooth", [True] * len(bl.polygons))
    bl.materials.append(M["blob"])
    ob = bpy.data.objects.new("paperblob", bl)
    link(ob)
    ob.scale = (0.3, 0.2, 0.13)
    ob.location = (bx, y + S.STRAP_W / 2 + 0.24, zs + lift(bx) + 0.04)
    for i, hx in enumerate(S.STRAP_HOLES):
        h = cyl(f"strapholeT{i}", 0.23, 0.01, (hx, y, zs + S.STRAP_T / 2 + 0.012 + lift(hx)), M["hole"], verts=20,
                bevel=0.0)
        h.scale = (1.0, 0.8, 1.0)
    hz = ZT - 0.4 + lr0
    cyl("strapholeS", 0.15, 0.01, (A + 0.09 + S.STRAP_T / 2 - 0.004, y, hz), M["hole"], rot=(0, 90, 0), verts=20,
        bevel=0.0)
    # the ring: through that hole, lying against the face round the top-right pip
    zc = S.PIP_Z + S.PIP_DZ
    r = 0.8
    c = Vector((A + 0.1, S.STRAP_Y + 0.12, hz - r))
    pts = []
    for k in range(64):
        a = 2 * math.pi * k / 64
        lean = 0.07 * (1 - math.cos(a - math.pi / 2)) / 2           # the top lies on the strap, the bottom on the face
        pts.append((c.x + 0.02 - lean, c.y + r * math.cos(a), c.z + r * math.sin(a)))
    tube("ring", pts, 0.032, M["wire"], verts=10, cyclic=True)


def torn_end(p1, p0):
    """The strap's left end torn off: a thin flap past its last point p0 (coming from p1), its edge in uneven points."""
    t = (Vector(p0) - Vector(p1)).normalized()
    side = Vector((0, 1, 0))
    nrm = t.cross(side).normalized()
    sd = nrm.cross(t).normalized()
    w = S.STRAP_W
    teeth = (0.06, 0.22, 0.1, 0.3, 0.12, 0.18, 0.04)          # how far each point of the torn edge reaches
    edge = [(0.0, -w / 2 + 0.02)]
    for k, d in enumerate(teeth):
        edge.append((d, -w / 2 + w * (k + 0.5) / len(teeth)))
    edge.append((0.0, w / 2 - 0.02))
    poly = [(-0.12, w / 2 - 0.02)] + edge[::-1] + [(-0.12, -w / 2 + 0.02)]
    bm = bmesh.new()
    h = S.STRAP_T * 0.7
    vs = [bm.verts.new(Vector(p0) + t * u + sd * v - nrm * h / 2) for u, v in poly]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]:
        v.co += nrm * h
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_ob("strapend", bm, [M["strap"]], smooth=False)


def paper():
    """A crumpled pink paper on the sticks behind the strap, its back edge torn into points and curled up."""
    nx, ny = 40, 8
    x0, x1 = -2.7, A - 0.12
    y1 = S.PAPER_Y1
    yb = S.STRAP_Y + S.STRAP_W / 2 + 0.05             # the strap's back edge
    bm = bmesh.new()
    rows = []
    rr = random.Random(77)
    # an irregular torn edge: a slow wander of broad lobes and dips, and a few narrow torn flaps of differing size
    ph = [rr.uniform(0, 6.3) for _ in range(3)]
    tips = [0.17 * math.sin(0.4 * k + ph[0]) + 0.05 * math.sin(1.1 * k + ph[1]) + 0.025 * math.sin(2.9 * k + ph[2]) +
            rr.uniform(-0.02, 0.02) for k in range(nx + 1)]
    for k, hgt in ((5, 0.06), (17, 0.07), (33, 0.05)):      # a few small torn flaps (Flash's edge is lumpy, not spiky)
        tips[k] += hgt
    for j in range(ny + 1):
        fy = j / ny
        edge = 1.0 if j == ny else (0.4 if j == ny - 1 else 0.0)     # the tear shapes the last two rows
        row = []
        for i in range(nx + 1):
            fx = i / nx
            x = x0 + (x1 - x0) * fx
            yf = S.STRAP_Y - S.STRAP_W / 2 + 0.06        # its front edge under the strap
            yy = yf + (y1 - yf) * fy + tips[i] * 0.6 * edge
            fr = max(0.0, (yy - yb) / (y1 - yb))          # flat under the strap, crumpled and curled up behind it
            fr *= 1.0 - 0.45 * min(1.0, max(0.0, (fx - 0.78) / 0.22)) ** 2     # lower toward its right end (Flash)
            z = (S.ZSTICK + 0.015 + 0.07 * math.sin(9 * fx + 3 * fy) * fr + 0.3 * fr ** 1.5 + tips[i] * 0.45 * edge +
                 rr.uniform(-0.02, 0.02) * fr) + lift(x)
            row.append(bm.verts.new((x, yy, z)))
        rows.append(row)
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    ob = crumple_geo(mesh_ob("paper", bm, [M["paper"]]), 0.3, 0.06)
    mo = ob.modifiers.new("thick", "SOLIDIFY")
    mo.thickness = 0.02
    mo.offset = 1.0
    # the paper bunched up under the strap's right part: a crumpled wad from the sticks up to the sheet
    bm = bmesh.new()
    rr = random.Random(5)
    yw = S.STRAP_Y
    secs = []
    for i in range(33):            # crumpled: its front spreads and bulges unevenly on the sticks
        x = -2.7 + (A - 0.15 + 2.7) * i / 32
        top = S.ZSTICK + 0.015 + lift(x) + 0.005
        hw = 0.36 + rr.uniform(-0.03, 0.03)
        hf = 0.42 + 0.07 * math.sin(2.3 * x + 1.0) + 0.04 * math.sin(5.9 * x + 2.0)   # its front, spread on the sticks
        zb = S.ZSTICK + 0.02              # (clear of the wires under it)
        zm_ = (zb + top) / 2 + 0.03 * math.sin(4.4 * x + 0.5)
        bul = 0.04 + 0.04 * math.sin(3.7 * x + 2.6)                              # a soft uneven bulge
        secs.append([bm.verts.new(v) for v in ((x, yw - hf, zb), (x, yw + hw, zb), (x, yw + hw * 0.9, top),
                                               (x, yw - hw * 0.9, top), (x, yw - hf * 0.85 - bul, zm_))])
    for s0, s1 in zip(secs, secs[1:]):
        for a, b in ((0, 1), (1, 2), (2, 3), (3, 4), (4, 0)):
            bm.faces.new((s0[a], s0[b], s1[b], s1[a]))
    bm.faces.new(secs[0][::-1])
    bm.faces.new(secs[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    crumple_geo(mesh_ob("paperwad", bm, [M["paper"]], smooth=True), 0.35, 0.08)
    return ob



def stick_end(i):
    """Stick i's middle x, the middle of its rounded front end (y) and its turn (as sticks() lays them)."""
    n, w = S.STICK_N, S.STICK_W
    gap = (S.STICK_X1 - S.STICK_X0 - n * w) / (n - 1)
    jit = ((0.0, 0.0, 0.15), (-0.06, 0.05, -0.15), (0.05, -0.04, 0.2), (0.1, 0.02, -0.3))
    return S.STICK_X0 + w / 2 + i * (w + gap), S.STICK_Y0 + jit[i][0] + w / 2, jit[i][2]


def hug(i, a0, a1, z0, z1, n=10, out=0.05):
    """Points round stick i's rounded front end, just off its rim, from angle a0 to a1 (degrees; 180 = its left side,
    270 = its tip), height going from z0 to z1: Flash's wires wrap tight round the stick ends."""
    cx, cy, rz = stick_end(i)
    r = S.STICK_W / 2
    c, s_ = math.cos(math.radians(rz)), math.sin(math.radians(rz))
    pts = []
    for k in range(n + 1):
        t = k / n
        a = math.radians(a0 + (a1 - a0) * t)
        x, y = (r + out) * math.cos(a), cy + (r * 0.9 + out) * math.sin(a)
        pts.append((cx + x * c - y * s_, x * s_ + y * c, z0 + (z1 - z0) * t))   # turned with the stick (about x, 0)
    return pts


def wires():
    """Two thin grey wires lying in the grooves between the sticks (Flash's two dark lines), their back ends under the
    paper. The first ends in its groove short of the stick ends; the second hooks over the third stick's rounded end
    (Flash's one visible hook) and tucks under it."""
    n, w, bv = S.STICK_N, S.STICK_W, S.STICK_BEVEL
    gap = (S.STICK_X1 - S.STICK_X0 - n * w) / (n - 1)
    rw = 0.036
    top = ZT + 0.006 + S.STICK_T                  # the sticks' top
    sh = math.radians(32)                         # lying on one stick's rounded shoulder, at the groove
    lean = gap / 2 + bv - (bv + rw) * math.sin(sh)
    zg = top - bv + (bv + rw) * math.cos(sh) - 0.004
    zm = ZT + 0.006 + S.STICK_T / 2               # half way up a stick's edge
    zu = ZT - rw - 0.004                          # just under the sticks
    xa = S.STICK_X0 + w + gap / 2 + lean          # (on stick 1's rim)
    cy1 = stick_end(1)[1]
    xa0, xb0 = xa - lean, S.STICK_X0 + 2 * w + 1.5 * gap      # the grooves' middles (the wires' back ends sink in
    zd = top - 0.03                                             # them, under the paper)
    pa = [(xa0, 0.75, zd), (xa0, 0.55, zd), (xa, 0.3, zg), (xa, -1.0, zg), (xa, cy1 + 0.25, zg)]
    tube("wireA", pa, rw, M["wire2"], verts=8, smooth=True)
    xb = S.STICK_X0 + 2 * w + 1.5 * gap + lean    # (on stick 2's rim, in the groove before it)
    cx2, cy2, rz2 = stick_end(2)
    c, s_ = math.cos(math.radians(rz2)), math.sin(math.radians(rz2))

    def on2(lx, ly, z):                           # a point over stick 2's end (x from its middle), turned with it
        return (cx2 + lx * c - ly * s_, lx * s_ + ly * c, z)
    r = w / 2
    pb = [(xb0, 0.75, zd), (xb0, 0.55, zd), (xb, 0.3, zg), (xb, -1.5, zg), (xb, cy2 + 0.55, zg)]
    pb += [on2(-r * 0.62, cy2 + 0.22, top + rw + 0.004), on2(-0.05, cy2 - 0.12, top + rw + 0.004),  # across its end,
           on2(r * 0.42, cy2 - 0.36, top + rw)]
    pb += hug(2, 312, 312, top - 0.005, top - 0.005, 1, out=rw * 0.5)[:1]               # over its rounded rim
    pb += hug(2, 313, 314, top - 0.07, ZT + 0.01, 1, out=rw + 0.012)                    # down its side
    pb += hug(2, 316, 316, zu, zu, 1, out=-0.06)[:1]                                    # and tucked under it
    pb += [on2(r * 0.5, cy2 - 0.2, zu - 0.005), on2(r * 0.15, cy2 + 0.05, zu - 0.01)]
    tube("wireB", pb, rw, M["wire2"], verts=8, smooth=True)


def P(th, r, z):
    return Vector(S.polar(th, r, z))


def track(ob, direction, up="Y"):
    ob.rotation_euler = Vector(direction).normalized().to_track_quat("Z", up).to_euler()
    return ob


def ring(name, r, wire, mat, parent=None, z=0.0, n=64):
    return tube(name, [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)],
                wire, mat, parent=parent, verts=12, cyclic=True)


def sweep(name, pts, side, w, h, mat, parent=None, bevel=0.06, closed=False):
    """A bar of w (along `side`) x h cross-section along points pts (local to parent)."""
    bm = bmesh.new()
    side = Vector(side).normalized()
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        p = Vector(p)
        if closed:
            t = (Vector(pts[(i + 1) % n]) - Vector(pts[i - 1])).normalized()
        else:
            t = (Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
        nrm = t.cross(side).normalized()
        sd = nrm.cross(t).normalized()
        a, b = sd * (w / 2), nrm * (h / 2)
        rows.append([bm.verts.new(p + a + b), bm.verts.new(p - a + b), bm.verts.new(p - a - b), bm.verts.new(p + a - b)])
    pairs = list(zip(rows, rows[1:])) + ([(rows[-1], rows[0])] if closed else [])
    for r0, r1 in pairs:
        for j in range(4):
            bm.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
    if not closed:
        bm.faces.new(rows[0][::-1])
        bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, [mat], bevel=bevel, segs=3, parent=parent)


def rounded_poly(corners, rad, n=8):
    """A closed path round the polygon `corners` (2D), each corner rounded with radius rad."""
    out = []
    k = len(corners)
    for i in range(k):
        a, b, c = Vector(corners[i - 1]), Vector(corners[i]), Vector(corners[(i + 1) % k])
        d1, d2 = (a - b).normalized(), (c - b).normalized()
        half = d1.angle(d2) / 2
        dist = rad / math.tan(half)
        p1, p2 = b + d1 * dist, b + d2 * dist
        bis = (d1 + d2).normalized()
        cen = b + bis * (rad / math.sin(half))
        a1 = math.atan2(*(p1 - cen).yx)
        a2 = math.atan2(*(p2 - cen).yx)
        da = (a2 - a1 + math.pi) % (2 * math.pi) - math.pi
        for j in range(n + 1):
            ang = a1 + da * j / n
            out.append((cen.x + rad * math.cos(ang), cen.y + rad * math.sin(ang)))
    return out


# ===================================================================== end of the second copied part


# ------------------------------------------------------------------------------------------------------------ Inferno parts
HORN_SIDE = Vector((1.0, 1.0, 0.0)).normalized()      # straight across the screen (the camera looks from +X -Y)


def horn(name, base, lean):
    """A horn standing on the strap's middle line: an iron seat, then bone curving out and up. It leans straight
    across the screen (lean = +1 to the viewer's right, -1 left), so the two are one shape mirrored as the player
    sees them and stand equally tall (round 2's leaned along the strap, which runs down the screen to the right: the
    left one drew taller than the right)."""
    x, y, z = base
    kit.cyl(name + "seat", 0.28, 0.2, (x, y, z), M["iron"], verts=20, bevel=0.03)     # clear of the holes beside it
    pts = []
    for i in range(13):
        t = i / 12
        a = math.radians(100 * t)
        out = lean * 1.15 * (1 - math.cos(a))
        pts.append((x + HORN_SIDE.x * out, y + HORN_SIDE.y * out, z + 0.1 + 2.3 * math.sin(a) * (0.55 + 0.45 * t)))
    kit.tube(name, pts, 0.245, M["bone"], verts=14, r_end=0.03, smooth=True)


def rivets():
    """F: brass rivet heads round the die's right (pip) face and along its top front edge."""
    pts = []
    z0, z1 = S.DIE_Z0 + 0.42, S.ZTOP - 0.42
    for k in range(6):
        z = z0 + (z1 - z0) * k / 5
        for y in (-A + 0.42, A - 0.42):
            pts.append(((A, y, z), (1, 0, 0)))
    for k in range(1, 5):
        y = -A + 0.42 + (2 * A - 0.84) * k / 5
        for z in (z0, z1):
            pts.append(((A, y, z), (1, 0, 0)))
    ringc = (S.PIP_Y[1], S.PIP_Z + S.PIP_DZ)         # clear of the wire ring round the top-right pip
    pts = [q for q in pts if math.dist(q[0][1:], ringc) > 1.05]
    bm = bmesh.new()
    for p, n in pts:
        m = Matrix.Translation(Vector(p)) @ Vector(n).to_track_quat("Z", "Y").to_matrix().to_4x4() @ \
            Matrix.Diagonal((0.11, 0.11, 0.07, 1))
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=1.0, matrix=m)
    mesh_ob("rivets", bm, [M["rivet"]], smooth=True)


def lump(name, at, size, mat, seed):
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
    for v in bm.verts:
        v.co *= 0.75 + 0.5 * r.random()
        v.co.z *= 0.6
    ob = mesh_ob(name, bm, [mat], smooth=False, bevel=0.02, segs=1)
    ob.location = at
    ob.rotation_euler = (0, 0, r.uniform(0, 6.28))
    return ob


def rubble():
    """E: basalt lumps on the ground round the feet (clear of the tack discs and the cover's foot)."""
    for i, (x, y, r) in enumerate(((3.6, -1.2, 0.42), (3.9, 0.6, 0.3), (0.2, -4.1, 0.36), (-1.2, -4.3, 0.26),
                                   (3.3, -3.6, 0.28), (-3.9, -1.6, 0.34))):
        lump(f"rubble{i}", (x, y, r * 0.3), r, M["stone"], 500 + i)


def build():
    die()
    wires()
    matchbook()
    sticks()
    paper()
    strap()
    if VAR == "e":
        horn("hornL", (-1.05, S.STRAP_Y, S.ZSTICK + 0.04 + S.STRAP_T + lift(-1.05)), -1)
        horn("hornR", (1.4, S.STRAP_Y, S.ZSTICK + 0.04 + S.STRAP_T + lift(1.4)), 1)
    if VAR == "f":
        rivets()
    bpy.context.view_layer.update()
    for ob in list(COLL.objects):           # the body leans (stack.TILT); the tacks, made after, stay on the ground
        if ob.parent is None:               # (an object can't hold a shear, so it goes into the mesh or curve itself)
            ob.data.transform(TILT_M @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)
    tacks()
    if VAR == "e":
        rubble()
        if DMG:
            wreck_damaged()
        if DEAD:
            wreck_destroyed()


# ------------------------------------------------------------------------------------------------- damaged, destroyed
# One rough pass each (owner: damage looks loose), roughly after Flash's: damaged, the roof sticks knocked apart and one
# on the ground, the strap torn up at its left end, the cover torn, bits lying about; destroyed, the die broken open
# and toppled among its parts. Every part is the standing store's own, moved; nothing is rebuilt.
def named(*names):
    """The objects called so; a name ending in * takes every object that starts with it."""
    out = []
    for o in COLL.objects:
        if any(o.name == n or (n.endswith("*") and o.name.startswith(n[:-1])) for n in names):
            out.append(o)
    return out


def world_pts(obs):
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in obs:
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        pts += [e.matrix_world @ v.co for v in me.vertices]
        e.to_mesh_clear()
    return pts


def about(pivot, rot, move=(0, 0, 0)):
    """A turn (degrees round X, Y, Z) about the point pivot, then a shift."""
    P_ = Matrix.Translation(Vector(pivot))
    R = Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
    return Matrix.Translation(Vector(move)) @ P_ @ R @ P_.inverted()


def put(names, T):
    for o in named(*names):
        o.matrix_world = T @ o.matrix_world


def rest(names, z=0.012):
    """Let the parts down (or up) together until the lowest of them lies on the ground."""
    obs = named(*names)
    low = min(p.z for p in world_pts(obs))
    for o in obs:
        o.matrix_world = Matrix.Translation((0, 0, z - low)) @ o.matrix_world


def lay(names, to, rot):
    """Turn the parts about their middle, carry the middle over the ground point `to`, and let them down onto it."""
    obs = named(*names)
    pts = world_pts(obs)
    c = sum(pts, Vector()) / len(pts)
    put(names, about(c, rot, (to[0] - c.x, to[1] - c.y, 0.0)))
    rest(names)


def lay_horn(name, to, spin):
    """A broken-off horn flat on the ground (its curve lies in the upright plane across the screen), turned by spin."""
    o = named(name)[0]
    pts = world_pts([o])
    c = sum(pts, Vector()) / len(pts)
    R = (Matrix.Rotation(math.radians(spin), 4, "Z") @ Matrix.Rotation(math.radians(90), 4, "X")
         @ Matrix.Rotation(math.radians(-45), 4, "Z"))
    o.matrix_world = Matrix.Translation((to[0], to[1], 0.0)) @ R @ Matrix.Translation(-c) @ o.matrix_world
    rest((name,))


def gone(*names):
    for o in named(*names):
        bpy.data.objects.remove(o)


def bite(ob, cuts, mat):
    """Break rough pieces out of a mesh part: cuts are (place, size, seed, (sx, sy, sz)); the broken faces take mat."""
    for k, (at, size, seed, sc) in enumerate(cuts):
        c = lump("bite", at, size, mat, seed)
        c.scale = sc
        bake(c)
        mo = ob.modifiers.new(f"bite{k}", "BOOLEAN")
        mo.operation = "DIFFERENCE"
        mo.object = c
        try:
            mo.solver = "EXACT"
        except TypeError:
            pass
        mo.material_mode = "TRANSFER"
        bake(ob)
        bpy.data.objects.remove(c)


def half(ob, name, keep_above, z, tilt):
    """A copy of ob cut along a slanted line: the part above (or below) it."""
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    link(c)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 30
        v.co.y *= 30
        v.co.z = (v.co.z + 0.5) * 30 * (1 if keep_above else -1)
    k = mesh_ob("halfcut", bm, [ob.data.materials[0]], smooth=False)
    k.matrix_world = about((0, 0, 0), (0, tilt, 0), (0, 0, z))
    mo = c.modifiers.new("half", "BOOLEAN")
    mo.operation = "INTERSECT"
    mo.object = k
    try:
        mo.solver = "EXACT"
    except TypeError:
        pass
    bake(c)
    bpy.data.objects.remove(k)
    return c


def more_rubble(spots, seed0, mat="stone"):
    for i, (x, y, r) in enumerate(spots):
        lump(f"rubbleX{seed0}_{i}", (x, y, r * 0.3), r, M[mat], seed0 + i)


STRAP_SET = ("strap", "strapend", "strapholeT*", "strapholeS", "paperblob")


def wreck_damaged():
    zt = S.ZTOP
    gone("wireA", "wireB", "rubble4", "paperwad")                  # the roof's binding has burnt through
    # the strap torn loose at its left: swung up about the foot of its bent end, the right horn still on it; the left
    # horn has snapped off its seat and lies at the store's foot
    T = about((A + 0.1, S.STRAP_Y, zt - 0.6), (0, 10, 0))
    put(STRAP_SET + ("hornR", "hornRseat", "hornLseat"), T)
    lay_horn("hornL", (5.3, 2.9), 60)
    lay(("ring",), (5.6, -0.4), (0, 90, 0))                       # the ring has dropped off its hole
    # the roof: the left stick has slid off and lies before the cover, the third is cocked up, the fourth pushed forward
    lay(("stick0",), (2.5, -5.1), (0, 0, -49))
    put(("stick2",), about((0.7, 2.85, zt), (0, 0, 9), (0, 0, 0.03)))
    put(("stick3",), about((1.8, 0.0, zt), (0, 0, 6), (0.0, -0.8, 0.07)))       # (the top leans: forward is up)
    put(("stick1",), about((-0.8, 0.0, zt), (0, 0, 5), (-0.25, 0.3, 0.0)))
    # the cover torn at its left edge, top and bottom; the die bitten open low on its right face
    bite(named("mbcover")[0], (((-3.1, -2.5, 1.0), 1.25, 31, (1.0, 1.0, 1.4)), ((-3.2, -2.5, 5.5), 0.9, 32, (1.3, 1.0, 1.0)),
                              ((-0.6, -2.5, 0.3), 0.7, 33, (1.6, 1.0, 1.0))), M["iron"])
    bite(named("die")[0], (((A + 0.1, 0.3, S.DIE_Z0 + 0.1), 0.95, 34, (1.0, 1.3, 1.5)),
                           ((A + 0.2, -2.0, zt - 0.3), 0.6, 35, (1.0, 1.2, 1.2))), M["core"])
    more_rubble(((3.4, 0.4, 0.34), (3.9, -0.4, 0.22), (3.1, 1.3, 0.2), (-4.6, -2.4, 0.2),
                 (-1.4, -4.6, 0.2)), 700)
    more_rubble(((3.7, 1.0, 0.25), (4.3, 0.1, 0.16)), 760, "die")


def wreck_destroyed():
    zt = S.ZTOP
    gone("wireA", "wireB", "tackpin2", "tackpin3", "tackboss2", "tackboss3", "tack2", "tack3", "hornLseat", "rubble0",
         "rubble4")
    d = named("die")[0]
    cov = named("mbcover")[0]
    # the cover torn across: its top half stays glued to the die and falls with it, its bottom half lies in front
    half(cov, "mbtop", True, 3.1, 9)
    half(cov, "mblow", False, 3.1, 9)
    bpy.data.objects.remove(cov)
    # the die broken open (a big piece off its top front corner, one off its right face, one off its back) and toppled
    # onto its side edge; the strap still hooked over it with the paper, one stick and the right horn
    bite(d, (((A - 0.2, -A + 0.3, zt), 2.3, 41, (1.1, 1.0, 1.3)), ((A + 0.2, 1.6, S.DIE_Z0 + 2.0), 1.3, 42, (1.0, 1.2, 1.4)),
             ((-1.2, 1.9, zt + 0.2), 1.5, 43, (1.3, 1.2, 1.0))), M["core"])
    body = ("die", "mbtop", "stick3", "hornR", "hornRseat", "paper", "paperwad") + STRAP_SET
    put(body, about((0.0, 0.0, S.DIE_Z0), (-13, 21, 8)))
    rest(body)
    lay(("mblow",), (2.3, -5.5), (-84, 0, 45))
    # the rest of the roof, the left horn and the ring thrown down round it
    lay(("stick0",), (-4.3, -2.8), (0, 0, 45))
    lay(("stick1",), (5.8, -2.0), (0, 0, 64))
    lay(("stick2",), (5.3, 1.6), (0, 4, -28))
    lay_horn("hornL", (7.6, 2.6), 152)
    lay(("ring",), (7.2, 0.3), (0, 90, 0))
    for i, lean in ((0, (22, 14, 0)), (1, (-18, 20, 0))):        # the two front tacks stand, their pins bent
        gx, gy = S.TACKS[i][0]
        put((f"tackpin{i}",), about((gx, gy, S.TACK_T), lean))
    more_rubble(((6.0, 0.6, 0.28), (3.4, 2.9, 0.36), (2.2, 5.6, 0.3), (-0.6, -4.4, 0.36), (6.6, -4.4, 0.26),
                 (-2.6, -1.9, 0.3)), 800)
    more_rubble(((4.0, -2.9, 0.42), (-3.3, -3.7, 0.4), (0.4, -3.6, 0.4), (3.4, 0.9, 0.55)), 860, "die")


FAMILY = (("die", "die"), ("wire", "wire"), ("mbcover", "cover"), ("tackpin", "pin"), ("tackboss", "tack"),
          ("tack", "tack"), ("stick", "stick"), ("straphole", "strap"), ("strap", "strap"), ("ring", "ring"),
          ("paper", "paper"), ("horn", "horn"), ("mbtop", "cover"), ("mblow", "cover"), ("rivets", "die"), ("rubble", "rubble"))


def family(o):
    n = o.name.split(".")[0]
    for k, f in FAMILY:
        if n.startswith(k):
            return f
    return "other:" + n


kit.run(build, lambda k: None, family=family)
