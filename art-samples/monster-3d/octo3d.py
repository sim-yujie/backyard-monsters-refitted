"""octo3d.py : the Octo-Ooze (C2) built, rigged and animated in Blender 5.2, headless (monster-3d-trial, 29 Oct 2026).

Owner, 29 Oct: "Technical feasibility to use Blender to animate a monster? Try Octo-Ooze." This builds the monster from
code (no hand modelling), rigs it with an armature (8 tentacle bone chains, body, neck, two eye stalks, a mouth that
opens), keys the game's 12 rows on scene frames 0-11 and renders every cell of the game's sheet with the towers' painted
look (look3d.py: same light, paint ramps, inside lines and silhouette outline).

    blender -b --factory-startup -P octo3d.py -- test     # a few cells, to check size and look
    blender -b --factory-startup -P octo3d.py -- all      # all 30 headings x 12 rows into render/, plus octo3d.blend

The game's layout (web/src/game/attack/monsterSprites.ts, REPAINT_LAYOUTS "monsters/octoooze.png"): 30 headings
(column 0 = moving right on screen, clockwise, 12 degrees apart), 12 rows (0 idle, 1-6 walk, 8 ticks each; 7-11 attack, 4
ticks each, the hit on attack frame 2), 55x36 cells at 1x with the ground point at (27, 23); drawn from the @4x copy
(220x144 cells), with @2x and 1x copies for the Quality setting.

Model axes: forward = +Y, up = +Z, ground at z = 0, the monster's ground point at the origin.
"""
import json
import math
import random
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import look3d as L  # noqa: E402
from look3d import srgb  # noqa: E402

MODE = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "test"
OUT = HERE / "render"
ZOOM = 2 if MODE == "big" else 1                         # "big": the test cells at twice the size, to look at
CW, CH = 220 * ZOOM, 144 * ZOOM                          # the @4x cell
GROUND_PT = (27 * 4 * ZOOM, 23 * 4 * ZOOM)              # the ground point in the @4x cell
DIRS = 30
EL = 30.0                       # the monster sheets are seen from a little higher than the towers (23)
ORTHO = 6.0                     # camera width in model units: the tentacle span (3.3) covers about 125 of the 220 px, as painted
L.LINE = 0.032                  # inside line, about 1.2 px at 4x
L.OUTER = 0.7
L.GROUND = [(0.0, (0.66, 0.66, 0.70, 1)), (0.5, (0.86, 0.88, 0.9, 1)), (1.0, (1, 1, 1, 1))]
N_TENT = 8
T_BONES = 4
T_PTS = 17                      # points along a tentacle (4 per bone)
MOUTH_Z = 0.70                  # height of the mouth's centre
LINE_COL = (22, 34, 40)         # silhouette outline: a deep teal-black

T0 = time.time()
TIMES = {}


# ------------------------------------------------------------------------------------------------------------- materials
def mat_skin():
    """Teal hide: blotchy darker and lighter teal, small pale speckles, a bumpy blistered surface."""
    p = L.Paint("skin")
    blot = p.noise(3.2, 3.0, 0.55, coord="Generated")
    base = p.ramp(blot, [(0.3, srgb(12, 112, 120)), (0.7, srgb(40, 190, 192))])
    vor = p.N.new("ShaderNodeTexVoronoi")
    vor.feature = 'F1'
    vor.inputs["Scale"].default_value = 24.0
    p.link(p.tc.outputs["Generated"], vor.inputs["Vector"])
    speck = p.ramp(vor.outputs["Distance"], [(0.0, (1, 1, 1, 1)), (0.16, (0.6, 0.6, 0.6, 1)), (0.2, (0, 0, 0, 1))])
    col = p.mix(base, srgb(176, 244, 238), speck)
    bump = p.noise(14.0, 4.0, 0.6, coord="Generated")
    shade = [(0.0, (0.16, 0.22, 0.34, 1)), (0.2, (0.28, 0.36, 0.48, 1)), (0.55, (0.70, 0.76, 0.78, 1)), (1.0, (1.08, 1.02, 0.92, 1))]
    return p.finish(col, spec=0.16, spec_rough=0.32, shade=shade, ao_k=0.7, bump=(bump, 0.3))


def mat_tentacle():
    """Pale tan-pink flesh, a little blotchy, pinker underneath."""
    p = L.Paint("tentacle")
    n = p.noise(5.0, 3.0, 0.5, coord="Generated")
    col = p.ramp(n, [(0.35, srgb(214, 166, 140)), (0.7, srgb(244, 210, 180))])
    shade = [(0.0, (0.36, 0.30, 0.38, 1)), (0.2, (0.50, 0.42, 0.48, 1)), (0.5, (0.80, 0.76, 0.74, 1)), (1.0, (1.04, 1.0, 0.92, 1))]
    return p.finish(col, spec=0.3, spec_rough=0.3, shade=shade, ao_k=0.5)


def mat_simple(name, rgb, spec=0.4, rough=0.25, ao=0.3, shade=None):
    p = L.Paint(name)
    return p.finish(srgb(*rgb), spec=spec, spec_rough=rough, ao_k=ao, shade=shade)


def mat_eye():
    """Orange eyeball, yellower toward its front."""
    p = L.Paint("eye")
    lw = p.N.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.4
    col = p.ramp(lw.outputs["Facing"], [(0.0, srgb(255, 186, 70)), (0.45, srgb(238, 112, 28)), (0.85, srgb(140, 44, 18))])
    return p.finish(col, spec=0.9, spec_rough=0.12, ao_k=0.3)


# ----------------------------------------------------------------------------------------------------------------- model
def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


PROFILE = [(0.0, 0.22), (0.48, 0.27), (0.76, 0.38), (0.86, 0.54), (0.84, 0.70), (0.70, 0.88), (0.48, 1.06), (0.34, 1.24),
           (0.29, 1.42), (0.28, 1.60), (0.27, 1.76), (0.16, 1.88), (0.0, 1.91)]   # (radius, height) of the bell and its neck
CENTRE = Vector((0, 0, 0.8))


def lean(z):
    """How far forward the body's axis is at height z: the neck leans out over the mouth."""
    return 0.46 * smoothstep(0.8, 1.85, z)


def profile_at(t):
    """Catmull-Rom along PROFILE, t in 0..1."""
    n = len(PROFILE) - 1
    x = min(max(t, 0.0), 1.0) * n
    i = min(int(x), n - 1)
    f = x - i
    p = [Vector(PROFILE[max(0, min(n, k))]) for k in (i - 1, i, i + 1, i + 2)]
    return 0.5 * ((2 * p[1]) + (-p[0] + p[2]) * f + (2 * p[0] - 5 * p[1] + 4 * p[2] - p[3]) * f * f +
                  (-p[0] + 3 * p[1] - 3 * p[2] + p[3]) * f ** 3)


def build_body(skin):
    rnd = random.Random(7)
    lumps = []
    while len(lumps) < 52:
        th = rnd.uniform(0, 2 * math.pi)
        z = rnd.uniform(-0.35, 0.9)
        d = Vector((math.sqrt(1 - z * z) * math.cos(th), math.sqrt(1 - z * z) * math.sin(th), z))
        if d.y > 0.35 and -0.35 < d.z < 0.3:   # keep the face (mouth) smooth
            continue
        lumps.append((d, rnd.uniform(0.09, 0.15), rnd.uniform(0.12, 0.18)))
    rings, n = 44, 64
    bm = bmesh.new()
    grid = []
    for i in range(rings + 1):
        r, z = profile_at(i / rings)
        row = []
        for j in range(n):
            a = 2 * math.pi * j / n
            d = Vector((math.cos(a), math.sin(a), 0))
            p = Vector((r * d.x, r * d.y * 0.94 + lean(z), z))
            dd = (p - CENTRE).normalized()
            k = 1.0 + 0.02 * noise.noise(dd * 3.0)
            for ld, amp, w in lumps:
                k += amp * math.exp(-(dd.angle(ld) / w) ** 2)
            p = Vector((p.x * k, (p.y - lean(z)) * k + lean(z), p.z if z < 0.3 else CENTRE.z + (p.z - CENTRE.z) * (0.6 + 0.4 * k)))
            row.append(bm.verts.new(p))
        grid.append(row)
    for i in range(rings):
        for j in range(n):
            a, b = grid[i], grid[i + 1]
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.obj_from_bm("body", bm, [skin])


def ray_hit(ob, origin, direction):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    tree = BVHTree.FromBMesh(bm)
    loc, nrm, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized())
    bm.free()
    return loc, nrm


def tentacle_curve(a_deg, side=1):
    """The rest curve of the tentacle at model angle a (0 = +X, counter-clockwise; 90 = forward): out from under the
    body, along the ground, the tip curling up."""
    a = math.radians(a_deg)
    u = Vector((math.cos(a), math.sin(a), 0))
    prof = L.bezier((0.45, 0.42), (1.0, -0.02), (1.24, 0.02), (1.52, 0.38), n=T_PTS)
    v = Vector((-u.y, u.x, 0)) * side                 # each tentacle snakes a little to one side, as painted
    return [u * p.x + v * 0.16 * math.sin(math.pi * 1.6 * k / (T_PTS - 1)) * (k / (T_PTS - 1)) + Vector((0, 0, p.y))
            for k, p in enumerate(prof)]


TENT_ANGLES = [22.5 + 45 * i for i in range(N_TENT)]


def build_tentacles(flesh):
    bm = bmesh.new()
    rings_all = []
    for i, a in enumerate(TENT_ANGLES):
        pts = tentacle_curve(a, 1 if i % 2 else -1)
        radii = [0.20 * (1 - k / (T_PTS - 1)) ** 0.8 + 0.04 for k in range(T_PTS)]
        rings_all.append(L.tube(bm, pts, radii, sides=12, cap=True))
    bm.verts.index_update()
    idx = [[[v.index for v in ring] for ring in rings] for rings in rings_all]
    return L.obj_from_bm("tentacles", bm, [flesh]), idx


def build_mouth(body, dark, tooth):
    """The mouth on the body's front: a dark curved lens (scaled down to a slit when shut) and a row of teeth above and
    below it. Returns the centre, normal and the three objects."""
    c, n = ray_hit(body, (0, 4, MOUTH_Z), (0, -1, 0))
    n = Vector((0, n.y, n.z)).normalized()
    right = Vector((1, 0, 0))
    up = n.cross(right).normalized()
    if up.z < 0:
        up = -up
    A, B, R = 0.58, 0.30, 0.78          # half width, half height (fully open), body radius for the bend
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    for v in bm.verts:
        x, z, y = v.co.x * A, v.co.z * B, v.co.y
        depth = 0.045 * y if y > 0 else 0.02 * y
        bend = (x * x + 0.4 * z * z) / (2 * R)
        v.co = c + right * x + up * z + n * (depth - bend + 0.005)
    inside = L.obj_from_bm("mouth", bm, [dark])
    teeth = []
    for name, sgn, xs, z0 in (("teeth_up", -1, [-0.40, -0.27, -0.14, 0.0, 0.14, 0.27, 0.40], 0.04),
                               ("teeth_dn", 1, [-0.34, -0.20, -0.07, 0.07, 0.20, 0.34], -0.04)):
        bm = bmesh.new()
        for x in xs:
            ln = 0.16 * (1 - 0.5 * (abs(x) / 0.42) ** 2)
            base = c + right * x + up * z0 + n * (0.03 - (x * x) / (2 * R))
            tip = base + up * (sgn * ln) + n * 0.02
            s = bmesh.new()
            bmesh.ops.create_cone(s, cap_ends=True, segments=8, radius1=0.048, radius2=0.006, depth=1.0)
            for v in s.verts:
                v.co.z += 0.5
            q = Vector((0, 0, 1)).rotation_difference((tip - base).normalized()).to_matrix().to_4x4()
            L.add_mesh(bm, s, Matrix.Translation(base) @ q @ L.diag(1, 0.7, (tip - base).length), 0)
        teeth.append(L.obj_from_bm(name, bm, [tooth]))
    return c, n, up, inside, teeth


EYE_SIDES = (-1, 1)


def eye_geom(side):
    base = Vector((side * 0.09, 0.42, 1.72))
    tip = Vector((side * 0.22, 0.60, 1.96))
    look = Vector((side * 0.28, 1.0, 0.05)).normalized()
    return base, tip, look


def build_eye(side, skin, eye, black, white):
    base, tip, look = eye_geom(side)
    bm = bmesh.new()
    L.tube(bm, L.bezier(base, base + Vector((0, 0.05, 0.18)), tip - Vector((side * 0.05, 0.05, 0.08)), tip, n=8),
           [0.11, 0.10, 0.09, 0.085, 0.08, 0.08, 0.085, 0.09], sides=12)
    stalk = L.obj_from_bm(f"stalk_{side}", bm, [skin])
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.19)
    eb = L.obj_from_bm(f"eye_{side}", bm, [eye])
    eb.location = tip
    # a vertical slit pupil on the eye's front, and a glint up and to the left of it
    q = Vector((0, 1, 0)).rotation_difference(look).to_matrix().to_4x4()
    sub = bmesh.new()
    bmesh.ops.create_uvsphere(sub, u_segments=12, v_segments=8, radius=1.0)
    bm = bmesh.new()
    L.add_mesh(bm, sub, Matrix.Translation(tip + look * 0.175) @ q @ L.diag(0.04, 0.03, 0.10), 0)
    pupil = L.obj_from_bm(f"pupil_{side}", bm, [black])
    bm = bmesh.new()
    sub = bmesh.new()
    bmesh.ops.create_uvsphere(sub, u_segments=8, v_segments=6, radius=0.035)
    gl = (look + Vector((-0.45, 0, 0.55))).normalized()
    L.add_mesh(bm, sub, Matrix.Translation(tip + gl * 0.185), 0)
    glint = L.obj_from_bm(f"glint_{side}", bm, [white])
    return [stalk, eb, pupil, glint]


# ------------------------------------------------------------------------------------------------------------------- rig
def build_rig(mouth_c, mouth_n, mouth_up):
    ad = bpy.data.armatures.new("octo_rig")
    arm = bpy.data.objects.new("octo_rig", ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = ad.edit_bones

    def bone(name, head, tail, parent=None, connect=False, up=(0, 0, 1)):
        b = eb.new(name)
        b.head, b.tail = Vector(head), Vector(tail)
        b.align_roll(Vector(up))
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    bone("root", (0, 0, 0), (0, 0.5, 0))
    bone("body", (0, -0.2, 0.6), (0, 0.4, 0.6), "root")
    bone("neck", (0, 0.05, 1.0), (0, 0.42, 1.75), "body")
    for s in EYE_SIDES:
        base, tip, _ = eye_geom(s)
        bone(f"stalk_{s}", base, tip, "neck")
    for nm in ("mouth", "lip", "jaw"):
        bone(nm, mouth_c, mouth_c + mouth_n * 0.3, "body", up=mouth_up)
    for i, a in enumerate(TENT_ANGLES):
        pts = tentacle_curve(a, 1 if i % 2 else -1)
        for j in range(T_BONES):
            bone(f"t{i}_{j}", pts[4 * j], pts[4 * j + 4], "root" if j == 0 else f"t{i}_{j - 1}", connect=j > 0)
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    return arm


def deform_with(ob, arm):
    ob.parent = arm
    m = ob.modifiers.new("rig", 'ARMATURE')
    m.object = arm
    return ob


def bone_parent(ob, arm, bone):
    b = arm.data.bones[bone]
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    ob.matrix_parent_inverse = (arm.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))).inverted()


def outline(ob, line_mat, w=None):
    """L.add_outline for a rigged part: the shell follows the same bone or armature as its object."""
    sh = bpy.data.objects.new(ob.name + "_line", ob.data)
    bpy.context.scene.collection.objects.link(sh)
    sh.parent, sh.parent_type, sh.parent_bone = ob.parent, ob.parent_type, ob.parent_bone
    sh.matrix_parent_inverse = ob.matrix_parent_inverse.copy()
    sh.matrix_basis = ob.matrix_basis.copy()
    for m in ob.modifiers:
        if m.type == 'ARMATURE':
            a = sh.modifiers.new("rig", 'ARMATURE')
            a.object = m.object
    mod = sh.modifiers.new("outline", 'NODES')
    mod.node_group = L.shell_nodes(w or L.LINE, line_mat)
    return sh


# ------------------------------------------------------------------------------------------------------------- animation
def reset(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def set_mouth(P, o):
    """o: 0 shut (a toothy slit) to 1 wide open."""
    P["mouth"].scale = (1 + 0.15 * o, 1, 0.3 + 0.7 * o)
    P["lip"].location = (0, 0, 0.20 * o)
    P["jaw"].location = (0, 0, -0.20 * o)


def tentacles(P, ph_of, lift_k=0.38, yaw_k=0.32, wave_k=0.16, extra=None):
    """Each tentacle i at phase ph_of(i): lifted and reaching forward for the first half, planted and pushing back
    for the second; a travelling wave runs down every chain."""
    for i, a in enumerate(TENT_ANGLES):
        ar = math.radians(a)
        ph = ph_of(i)
        s, c = math.sin(2 * math.pi * ph), math.cos(2 * math.pi * ph)
        lift = max(0.0, s)
        f = -c                                    # the tip's forward offset: -1 back .. +1 forward
        curl = -0.22 * f * math.sin(ar)          # front tentacles stretch out to reach, back ones bunch up
        ex = extra(i, a) if extra else (0.0, 0.0)
        P[f"t{i}_0"].rotation_euler = (lift_k * lift + curl + ex[0], 0, yaw_k * f * math.cos(ar) + ex[1])
        for j in range(1, T_BONES):
            w = math.sin(2 * math.pi * ph - 0.9 * j)
            P[f"t{i}_{j}"].rotation_euler = (0.10 * lift + wave_k * w + 0.5 * curl * (j == 1) + ex[0] * 0.4,
                                             0, 0.07 * w)


def pose_idle(P):
    tentacles(P, lambda i: 0.25 + 0.13 * i, lift_k=0.0, yaw_k=0.0, wave_k=0.07)
    for i in range(N_TENT):
        P[f"t{i}_0"].rotation_euler = (0, 0, 0)
    set_mouth(P, 0.0)


def pose_walk(P, k):
    p = k / 6
    tentacles(P, lambda i: p + 0.5 * (i % 2) + 0.06 * (i // 2))
    b = P["body"]
    b.location = (0, 0.03 * math.sin(2 * math.pi * p), 0.045 * math.cos(4 * math.pi * p))
    b.rotation_euler = (0.05 * math.sin(4 * math.pi * p), 0.07 * math.sin(2 * math.pi * p), 0)
    b.scale = (1 - 0.02 * math.cos(4 * math.pi * p), 1, 1 + 0.035 * math.cos(4 * math.pi * p))
    P["neck"].rotation_euler = (0.07 * math.sin(4 * math.pi * p - 1.2), 0.12 * math.sin(2 * math.pi * p - 0.9), 0)
    for s in EYE_SIDES:
        P[f"stalk_{s}"].rotation_euler = (0.10 * math.sin(4 * math.pi * p - 2.0), 0, 0.08 * s * math.sin(2 * math.pi * p - 1.5))
    set_mouth(P, 0.0)


ATTACK = [  # (forward, lean (+ = nose up), mouth, front tentacles raised)
    (-0.10, 0.16, 0.35, 0.25),
    (0.12, -0.05, 1.00, 0.55),
    (0.24, -0.10, 1.00, 0.70),
    (0.20, -0.07, 0.05, 0.45),
    (0.04, 0.02, 0.20, 0.15),
]


def pose_attack(P, k):
    fwd, lean, mouth, raise_ = ATTACK[k]

    def extra(i, a):
        front = max(0.0, math.sin(math.radians(a)))
        side = math.cos(math.radians(a))
        return (raise_ * front * 1.2, -0.25 * raise_ * side * front)

    tentacles(P, lambda i: 0.75 + 0.05 * i, lift_k=0.0, yaw_k=0.0, wave_k=0.1, extra=extra)
    P["body"].location = (0, fwd, 0.04 * mouth)
    P["body"].rotation_euler = (lean, 0, 0)
    P["body"].scale = (1 + 0.04 * mouth, 1 + 0.05 * mouth, 1 + 0.05 * mouth)
    P["neck"].rotation_euler = (-0.6 * lean, 0, 0)
    for s in EYE_SIDES:
        P[f"stalk_{s}"].rotation_euler = (-0.5 * lean + 0.1 * mouth, 0, 0.12 * s * mouth)
    set_mouth(P, mouth)


def pose_row(arm, row):
    reset(arm)
    P = arm.pose.bones
    if row == 0:
        pose_idle(P)
    elif row <= 6:
        pose_walk(P, row - 1)
    else:
        pose_attack(P, row - 7)


def key_rows(arm):
    """Keys the 12 rows on scene frames 0-11 (constant), so the .blend plays the game's rows."""
    for row in range(12):
        pose_row(arm, row)
        for pb in arm.pose.bones:
            for path in ("location", "rotation_euler", "scale"):
                pb.keyframe_insert(path, frame=row)
    for fc in _fcurves(arm):
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'


def _fcurves(arm):
    act = arm.animation_data.action
    try:
        return list(act.fcurves)
    except AttributeError:      # Blender 5 layered actions
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out += list(bag.fcurves)
        return out


# ---------------------------------------------------------------------------------------------------------------- camera
def heading_to_yaw(cam):
    """For each sheet column, the model's turn about Z so that its forward (+Y) points along the column's heading on
    screen (12 degrees a column, 0 = right, clockwise), measured through the camera."""
    ox, oy = L.to_px(cam, (0, 0, 0))
    table = []
    for t in range(3600):
        th = math.radians(t / 10)
        g = Vector((math.cos(th), math.sin(th), 0))
        x, y = L.to_px(cam, g)
        table.append((math.degrees(math.atan2(y - oy, x - ox)) % 360, th))
    yaws = []
    for col in range(DIRS):
        h = col * 360 / DIRS
        _, th = min(table, key=lambda e: min(abs(e[0] - h), 360 - abs(e[0] - h)))
        yaws.append(th - math.pi / 2)        # turn +Y onto the ground direction th
    return yaws


def place_camera(cam):
    cam.data.ortho_scale = ORTHO
    bpy.context.view_layer.update()
    for _ in range(3):
        x, y = L.to_px(cam, (0, 0, 0))
        cam.data.shift_x += (x - GROUND_PT[0]) / CW
        cam.data.shift_y -= (y - GROUND_PT[1]) / CW
        bpy.context.view_layer.update()


# ------------------------------------------------------------------------------------------------------------------ main
def main():
    L.clear_scene()
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures):
        for x in list(coll):
            coll.remove(x)
    L.canvas(CW, CH, (0, 0, CW, CH), OUT)
    skin, flesh, eye = mat_skin(), mat_tentacle(), mat_eye()
    dark = mat_simple("mouth", (58, 16, 34), spec=0.25, ao=0.2, shade=[(0.0, (0.55, 0.5, 0.6, 1)), (1.0, (1.1, 1.0, 1.0, 1))])
    tooth = mat_simple("tooth", (246, 238, 208), spec=0.5, ao=0.25)
    black = mat_simple("pupil", (16, 10, 14), spec=1.2, rough=0.1, ao=0.0)
    white = L.mat_flat("glint", (255, 255, 250), spec=0.0, emit=(160, 160, 150))
    line = L.outline_mat("line_octo", srgb(*LINE_COL))

    body = build_body(skin)
    tents, tidx = build_tentacles(flesh)
    mc, mn, mu, inside, teeth = build_mouth(body, dark, tooth)
    eyes = {s: build_eye(s, skin, eye, black, white) for s in EYE_SIDES}
    arm = build_rig(mc, mn, mu)

    # weights: the hide to the body, its neck to the neck bone; each tentacle ring blended between its two nearest bones
    deform_with(body, arm)
    gb, gn = body.vertex_groups.new(name="body"), body.vertex_groups.new(name="neck")
    for v in body.data.vertices:
        w = smoothstep(1.0, 1.4, v.co.z)
        gb.add([v.index], 1 - w, 'REPLACE')
        gn.add([v.index], w, 'REPLACE')
    deform_with(tents, arm)
    for i in range(N_TENT):
        groups = [tents.vertex_groups.new(name=f"t{i}_{j}") for j in range(T_BONES)]
        for k, ring in enumerate(tidx[i]):
            t = k / (T_PTS - 1) * T_BONES
            ws = [max(0.0, 1 - abs(t - (j + 0.5))) for j in range(T_BONES)]
            tot = sum(ws)
            for j, g in enumerate(groups):
                if ws[j] > 0:
                    g.add(ring, ws[j] / tot, 'REPLACE')
    bone_parent(inside, arm, "mouth")
    bone_parent(teeth[0], arm, "lip")
    bone_parent(teeth[1], arm, "jaw")
    for s in EYE_SIDES:
        for ob in eyes[s]:
            bone_parent(ob, arm, f"stalk_{s}")

    parts = [body, tents, inside, *teeth] + [o for s in EYE_SIDES for o in eyes[s][:3]]
    shells = [outline(o, line) for o in parts]
    seen = parts + shells + [eyes[s][3] for s in EYE_SIDES]
    key_rows(arm)
    TIMES["build_s"] = round(time.time() - T0, 1)

    cam = L.setup_render(samples=24, el=EL)
    place_camera(cam)
    yaws = heading_to_yaw(cam)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 0, 11
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "octo3d.blend"))

    if MODE == "big":
        cells = [(c, r) for r in (0, 9) for c in (0, 8, 22)]
    elif MODE == "all":
        cells = [(c, r) for r in range(12) for c in range(DIRS)]
    else:
        cells = [(c, r) for r in (0, 3, 9) for c in (0, 8, 15, 22)]
    t1 = time.time()
    clipped = []
    for c, r in cells:
        bpy.context.scene.frame_set(r)
        arm.rotation_euler = (0, 0, yaws[c])
        bpy.context.view_layer.update()
        img = L.shot(OUT / f"{'big_' if ZOOM > 1 else ''}c{c:02d}_r{r:02d}.png", seen, outer_col=LINE_COL)
        a = img[..., 3]
        if a[0].max() > 0.05 or a[-1].max() > 0.05 or a[:, 0].max() > 0.05 or a[:, -1].max() > 0.05:
            clipped.append((c, r))
    TIMES["render_s"] = round(time.time() - t1, 1)
    TIMES["cells"] = len(cells)
    TIMES["clipped"] = clipped
    TIMES["yaw_deg"] = [round(math.degrees(y), 1) for y in yaws]
    (OUT / f"times-{MODE}.json").write_text(json.dumps(TIMES, indent=1))
    print("DONE", json.dumps({k: v for k, v in TIMES.items() if k != "yaw_deg"}))


main()
