"""traps.py : the Booby Trap (Flash building 24) and the Heavy Trap (117) as 3D models, whole and fired (Flash's
"destroyed" picture: what an attacker sees once the trap has gone off). The camera, light, world and render settings
are the approved HCC's (base/hcc.py is run without its main() and its scene set-up reused unchanged, as the 3D wall
blocks do); only the frame is the trap's: FRAME round the trap's anchor, the world origin on the middle of its 20-unit
footprint (Flash pixel (0, 10)). Units: 1 = 10 Flash px across the screen (a circle of radius r is 20 r px wide).

    blender -b --factory-startup -P traps.py -- <look> prev  [states]   work/prev-<look>-<state>.png  (4 px a Flash px)
    blender -b --factory-startup -P traps.py -- <look> still [states]   render/<look>-<whole|destroyed>-base.png (with its ground
                                                                         shadow) and -alone.png (no shadow), 12 px a
                                                                         Flash px
    blender -b --factory-startup -P traps.py -- <look> check [states]   CONTACT lines: every part's gap to the ground or
                                                                         another part (FLOAT if over 0.03)
    blender -b --factory-startup -P traps.py -- <look> save  [states]   work/<look>-<state>.blend
looks: booby, heavy; states: whole,fired (comma list, default both)

Flash (buildings/boobytrap, buildings/heavytrap; one level and one look each, plus the fired picture):
- Booby Trap: a low steel-blue dome (a mine) with a white sheen on its upper left, on a darker band round its foot,
  eight white spikes sticking straight out of the band, one every 45 degrees (one at the viewer, one each at screen
  left and right). Fired: the dome is gone; the eight spikes lie where they were, with dark broken bits of the band.
- Heavy Trap: an open bear trap on a dark round plate: a ring of two red jaws with a zig-zag of teeth along their top,
  black inside, eight white spikes leaning out and up from the jaws' outside. Fired: the jaws have snapped shut into a
  red arch standing across the plate (hinged at its left and right), black underneath; the spikes are gone.
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
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["booby", "prev"]
LOOK = ARGS[0]
MODE = ARGS[1] if len(ARGS) > 1 else "prev"
STATES = ARGS[2].split(",") if len(ARGS) > 2 else ["whole", "fired"]
FILE_STATE = {"fired": "destroyed"}    # the stills' names as export3d_buildings.py reads them (<look>-destroyed-...)

# the approved HCC script without its main(): its helpers, materials, camera and light
G = {}
_argv = sys.argv
sys.argv = [_argv[0], "--", "1", "still"]
_src = HERE / "base" / "hcc.py"
G.update({"__file__": str(_src), "__name__": "hcc"})
_text = _src.read_text(encoding="utf8").rstrip()
assert _text.endswith("main()")
exec(compile(_text[:-len("main()")], str(_src), "exec"), G)
sys.argv = _argv

K = int(os.environ.get("PB_K", 4 if MODE == "prev" else 12))
FRAME = (-24, -14, 24, 30)             # x0, y0, x1, y1 in Flash px round the anchor (flashtraps.FRAME)
G["FRAME"] = FRAME
G["ORIGIN"] = (0.0, 10.0)              # the footprint's middle: the anchor is its top corner, 20 units = 10 px down
G["K"] = K
SC, NT, srgb, MATS = G["SC"], G["NT"], G["srgb"], G["MATS"]
cyl, mesh_ob, link = G["cyl"], G["mesh_ob"], G["link"]
painted, shiny, flat = G["painted"], G["shiny"], G["flat"]
rng = random.Random(24)
K0, K1 = (0, 0, 0, 1), (1, 1, 1, 1)


# ------------------------------------------------------------------------------------------------------------ materials
def m(t, op, a, b=None, c=None):
    n = t.n("ShaderNodeMath", operation=op)
    for i, x in enumerate((a, b, c)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            t.link(x, n.inputs[i])
    return n.outputs[0]


def axes(t, kind="Object", node="ShaderNodeTexCoord"):
    sep = t.n("ShaderNodeSeparateXYZ")
    src = t.n(node)
    t.link(src.outputs[kind], sep.inputs[0])
    return sep.outputs


SHEEN = (250, 252, 255)
STREAK = float(os.environ.get("PB_STREAK", -60.0))   # the sheen strip's compass bearing (world degrees)
STREAK_W = float(os.environ.get("PB_STREAK_W", 0.13))   # its half width (world units)
STREAK_O = (float(os.environ.get("PB_SOX", -0.2)), float(os.environ.get("PB_SOY", -0.34)))   # a point on its line


def mine_steel(name, col, sheen, dark, rough=0.32):
    """The Booby Trap's dome: Flash's flat steel blue, a long white sheen on the upper left (toward the light) and a
    duller blue toward the lower right; a soft metal, never a mirror (a mirror shows the dark world in its lower half,
    which Flash's dome does not have)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    nx, ny, nz = axes(t, "Normal", "ShaderNodeNewGeometry")
    # toward the light: the sun sits at world (-0.85, -0.62, 1.55); the sheen is where the normal leans up and left
    lit = m(t, "ADD", m(t, "MULTIPLY", m(t, "ADD", m(t, "MULTIPLY", nx, -0.62), m(t, "MULTIPLY", ny, -0.45)), 1.0),
            m(t, "MULTIPLY", nz, 0.62))
    out = t.mix(srgb(*dark), srgb(*col), t.ramp(lit, [(0.1, K0), (0.65, K1)]))
    out = t.mix(out, srgb(*sheen), t.ramp(lit, [(0.93, K0), (0.99, (0.25, 0.25, 0.25, 1))]))
    # Flash's sheen is one long white streak down the dome's upper-left flank, from near the top to the foot: the
    # normals that face the light's way across the ground (a narrow band of compass bearings), at any slope but flat
    # (a strip of even width along the dome's surface, in the object's own ground plane: the meridian at bearing
    # STREAK, from just short of the top down to near the foot; a meridian band of bearings would pinch to nothing at
    # the top, where Flash's streak starts)
    px, py, pz = axes(t, "Object")
    c, s_ = math.cos(math.radians(STREAK)), math.sin(math.radians(STREAK))
    qx, qy = m(t, "SUBTRACT", px, STREAK_O[0]), m(t, "SUBTRACT", py, STREAK_O[1])
    side = m(t, "ABSOLUTE", m(t, "SUBTRACT", m(t, "MULTIPLY", qx, s_), m(t, "MULTIPLY", qy, c)))
    ahead = m(t, "ADD", m(t, "MULTIPLY", qx, c), m(t, "MULTIPLY", qy, s_))
    across = t.ramp(side, [(STREAK_W * 0.45, K1), (STREAK_W, K0)])
    # (a colour ramp only reads 0..1: squeeze -1.25..1.25 into it)
    along = t.ramp(m(t, "MULTIPLY_ADD", ahead, 0.4, 0.5), [(0.4 * p + 0.5, k) for p, k in
                                                            ((-1.05, K0), (-0.75, K1), (0.22, K1), (0.45, K0))])
    out = t.mix(out, srgb(*sheen), t.mix(across, along, 1.0, "MULTIPLY"))
    # Flash's dome is darker and greyer just right of the streak, round the top
    dc = m(t, "SQRT", m(t, "ADD", m(t, "POWER", m(t, "SUBTRACT", px, 0.12), 2.0), m(t, "POWER", m(t, "ADD", py, 0.05), 2.0)))
    out = t.mix(out, srgb(86, 112, 116), t.ramp(dc, [(0.15, (0.9, 0.9, 0.9, 1)), (0.5, K0)]))
    v = t.coords()
    n1 = t.noise(v, 6.0, 3.0, 0.5)
    out = t.mix(out, srgb(*dark), t.ramp(n1, [(0.55, K0), (0.8, (0.25, 0.25, 0.25, 1))]))     # faint worn mottle
    t.set(**{"Base Color": out, "rough": rough, "metal": 0.15, "spec": 0.12})
    t.bump(t.noise(v, 22, 3.0, 0.6), 0.04, 0.01)
    MATS[name] = t.m
    return t.m


def spike_mat(name, col=(226, 228, 232), shade=(120, 122, 128)):
    """Flash's spikes: near-white polished steel, grey on the side away from the light."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    nx, ny, nz = axes(t, "Normal", "ShaderNodeNewGeometry")
    lit = m(t, "ADD", m(t, "MULTIPLY", nx, -0.6), m(t, "ADD", m(t, "MULTIPLY", ny, -0.45), m(t, "MULTIPLY", nz, 0.6)))
    out = t.mix(srgb(*shade), srgb(*col), t.ramp(lit, [(-0.4, K0), (0.4, K1)]))
    t.set(**{"Base Color": out, "rough": 0.3, "metal": 0.45, "spec": 0.6})
    MATS[name] = t.m
    return t.m


def flat_spike_mat(name, col=(238, 238, 240), shade=(196, 198, 204)):
    """Flash's small trap spikes: flat white, only a little greyer on the side away from the light (no metal shine)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    nx, ny, nz = axes(t, "Normal", "ShaderNodeNewGeometry")
    lit = m(t, "ADD", m(t, "MULTIPLY", nx, -0.6), m(t, "ADD", m(t, "MULTIPLY", ny, -0.45), m(t, "MULTIPLY", nz, 0.6)))
    out = t.mix(srgb(*shade), srgb(*col), t.ramp(lit, [(-0.3, K0), (0.3, K1)]))
    t.set(**{"Base Color": out, "rough": 0.7, "metal": 0.0, "spec": 0.2})
    MATS[name] = t.m
    return t.m


def scorch_mat(name="scorch", col=(16, 26, 10)):
    """The burnt ground where the Booby Trap's dome was (Flash's fired look shows it dark there): a dark disc that
    fades out to its edge."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    px, py, pz = axes(t, "Object")
    d = m(t, "SQRT", m(t, "ADD", m(t, "MULTIPLY", px, px), m(t, "MULTIPLY", py, py)))
    a = t.ramp(d, [(0.0, (0.97, 0.97, 0.97, 1)), (0.5, (0.88, 0.88, 0.88, 1)), (0.98, K0)])
    n1 = t.noise(t.coords(), 5.0, 3.0, 0.5)
    t.set(**{"Base Color": t.mix(srgb(*col), srgb(30, 40, 20), t.ramp(n1, [(0.4, K0), (0.7, K1)])), "rough": 0.95,
             "spec": 0.05, "Alpha": a})
    MATS[name] = t.m
    return t.m


def speck_plate(name, col, speck):
    """The Heavy Trap's plate: dark brown, grimy, with small pale specks (Flash's plate)."""
    if name in MATS:
        return MATS[name]
    t = NT(name)
    v = t.coords()
    n1 = t.noise(v, 4.0, 3.0, 0.5, 0.2)
    out = t.mix(srgb(*col), srgb(30, 22, 18), t.ramp(n1, [(0.4, K0), (0.7, (0.7, 0.7, 0.7, 1))]))
    n2 = t.noise(v, 38.0, 1.0, 0.5)
    out = t.mix(out, srgb(*speck), t.ramp(n2, [(0.70, K0), (0.74, K1)]))
    t.set(**{"Base Color": out, "rough": 0.8, "metal": 0.1, "spec": 0.25})
    t.bump(t.noise(v, 20, 4.0, 0.6), 0.05, 0.01)
    MATS[name] = t.m
    return t.m


def mats():
    return {
        "dome": mine_steel("mine-steel", (104, 130, 156), SHEEN, (70, 90, 114), rough=0.55),
        "band": painted("mine-band", (76, 96, 118), rough=0.5, metal=0.4, wear=(110, 128, 146), dirt=0.12, ao_min=0.7),
        "scorch": scorch_mat(),
        "char": painted("char", (40, 34, 32), rough=0.85, wear=(72, 62, 56), dirt=0.1, ao_min=0.7),
        "spike": spike_mat("spike"),
        "flatspike": flat_spike_mat("flat-spike"),
        "plate": speck_plate("bear-plate", (54, 40, 32), (150, 140, 132)),
        "red": painted("bear-red", (192, 32, 30), rough=0.3, metal=0.05, wear=(110, 22, 20), rust=(70, 26, 20),
                       dirt=0.35, soot=0.45, ao_min=0.45, scale=7.0, spec=0.6),
        "inside": painted("bear-inside", (26, 10, 9), rough=0.7, metal=0.1, wear=(44, 18, 16), dirt=0.1, ao_min=0.5),
        "hinge": painted("bear-hinge", (66, 58, 58), rough=0.45, metal=0.5, wear=(104, 94, 94), dirt=0.1, ao_min=0.7),
    }


# ------------------------------------------------------------------------------------------------------------ shapes
def revolve(name, prof, mat, verts=48, at=(0, 0, 0), smooth=True):
    """A solid of revolution round Z from a (r, z) profile running from the axis at the top round to the axis at the
    bottom (both ends with r = 0 become poles)."""
    bm = bmesh.new()
    rows = []
    for r, z in prof:
        if r < 1e-6:
            rows.append([bm.verts.new((0, 0, z))])
        else:
            rows.append([bm.verts.new((r * math.cos(2 * math.pi * i / verts), r * math.sin(2 * math.pi * i / verts), z))
                         for i in range(verts)])
    for a, b in zip(rows, rows[1:]):
        for i in range(verts):
            j = (i + 1) % verts
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [mat], smooth=smooth)
    ob.location = at
    return ob


def spike(name, at_r, bearing, length, r0, mat, up=0.0, z=0.1, sides=6):
    """A spike from radius at_r out along `bearing` (degrees, world), `up` degrees above level, its foot at height z;
    a sharp point with `sides` flat facets (Flash's spikes read as cut steel: a lit facet and a dark one)."""
    b = math.radians(bearing)
    ob = cyl(name, r0, length, (at_r * math.cos(b), at_r * math.sin(b), z), mat, rot=(0, 90 - up, bearing),
             verts=sides, r2=0.0, bevel=0.0)
    ob.data.polygons.foreach_set("use_smooth", [False] * len(ob.data.polygons))
    ob.rotation_euler.rotate_axis("Z", math.radians(30))     # a facet edge, not a face, toward the camera
    return ob


def flat_spike(name, at_r, bearing, length, half_w, thick, mat, z=0.0, tilt=0.0):
    """Flash's small Booby Trap spike: a flat white triangle lying out from the dome's edge, a low ridge on top (four
    faces), its foot at radius at_r, its point `length` further out along `bearing`; `tilt` degrees turns it on its
    ridge (for the fired look's spikes lying a little askew)."""
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in ((0, -half_w, 0), (0, half_w, 0), (0, 0, thick), (length, 0, 0))]
    for f in ((vs[0], vs[1], vs[2]), (vs[0], vs[2], vs[3]), (vs[1], vs[3], vs[2]), (vs[0], vs[3], vs[1])):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_ob(name, bm, [mat], smooth=False)
    b = math.radians(bearing)
    ob.location = (at_r * math.cos(b), at_r * math.sin(b), z)
    ob.rotation_euler = Euler((math.radians(tilt), 0, b), "XYZ")
    return ob


def jaw_band(name, th0, th1, r, h, thick, teeth, tooth_h, mats_, z0=0.0, n=60, lean=0.35):
    """One jaw of the bear trap: a band of the ring from angle th0 to th1 (degrees), `h` tall from z0, `thick` deep,
    its top cut into `teeth` sharp teeth `tooth_h` high that lean in toward the middle. Materials: outside and top
    red (mats_[0]), inside and bottom dark (mats_[1])."""
    bm = bmesh.new()
    cols = []
    for i in range(n + 1):
        f = i / n
        th = math.radians(th0 + (th1 - th0) * f)
        tri = 1.0 - abs(((f * teeth) % 1.0) * 2.0 - 1.0)        # 0 at the gaps, 1 at a tooth's tip
        top = z0 + h + tooth_h * tri
        pull = lean * tooth_h * tri                            # the tips lean in
        c, s = math.cos(th), math.sin(th)
        ri, ro = r - thick / 2, r + thick / 2
        cols.append([bm.verts.new((ri * c, ri * s, z0)), bm.verts.new((ro * c, ro * s, z0)),
                     bm.verts.new(((ro - pull) * c, (ro - pull) * s, top)),
                     bm.verts.new(((ri - pull) * c, (ri - pull) * s, top))])
    faces = []
    for a, b in zip(cols, cols[1:]):
        faces.append((bm.faces.new((a[0], b[0], b[1], a[1])), 1))   # bottom
        faces.append((bm.faces.new((a[1], b[1], b[2], a[2])), 0))   # outside
        faces.append((bm.faces.new((a[2], b[2], b[3], a[3])), 0))   # top
        faces.append((bm.faces.new((a[3], b[3], b[0], a[0])), 1))   # inside
    faces.append((bm.faces.new(cols[0][::-1]), 1))
    faces.append((bm.faces.new(cols[-1]), 1))
    for f, mi in faces:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_ob(name, bm, mats_, smooth=True, bevel=0.012, segs=2)     # smooth: flat strips read as streaks


def drop(o, z=0.0):
    bpy.context.view_layer.update()
    zmin = min((o.matrix_world @ v.co).z for v in o.data.vertices)
    o.location.z += z - zmin
    return o


# ------------------------------------------------------------------------------------------------------------ looks
BOOBY_R = float(os.environ.get("PB_BR", 1.02))       # the dome's foot
BOOBY_H = float(os.environ.get("PB_BH", 0.5))         # the dome's top (Flash's is a wide flat oval)
BOOBY_P = float(os.environ.get("PB_BP", 0.7))         # the profile's power: below 1 the top is flatter, the sides steeper
SPIKE_OUT = float(os.environ.get("PB_SO", 0.3))     # how far a spike's point reaches past the dome's foot
SPIKE_W = float(os.environ.get("PB_SW", 0.13))        # a spike's foot (half width)
SPIKE_T = float(os.environ.get("PB_ST", 0.09))       # its ridge's height


def booby(M, state):
    """Booby Trap: a wide, flat steel-blue dome, eight small flat white spikes at its foot (Flash has no band)."""
    obs = []
    spike_at = BOOBY_R - 0.04
    spike_len = SPIKE_OUT + 0.04
    if state == "whole":
        prof = [(0.0, BOOBY_H)]
        for k in range(1, 17):                       # a squashed lens: flat on top, rounding down to the foot
            a = k / 16 * math.pi / 2
            prof.append((BOOBY_R * math.sin(a), BOOBY_H * math.cos(a) ** BOOBY_P))
        prof += [(BOOBY_R, 0.0), (0.0, 0.0)]
        obs.append(revolve("dome", prof, M["dome"], verts=64))
        for k in range(8):
            obs.append(flat_spike(f"spike{k}", spike_at, -45 + 45 * k, spike_len, SPIKE_W, SPIKE_T, M["flatspike"]))
    else:
        # the dome blown away: a dark scorched patch where it stood, the small spikes lying where they were
        obs.append(revolve("scorch", [(0.0, 0.004), (BOOBY_R, 0.004), (BOOBY_R, 0.0), (0.0, 0.0)], M["scorch"],
                           verts=64))
        for k in range(8):
            b = -45 + 45 * k + rng.uniform(-5, 5)
            obs.append(flat_spike(f"spike{k}", spike_at + rng.uniform(-0.05, 0.03), b, spike_len, SPIKE_W, SPIKE_T,
                                  M["flatspike"], tilt=rng.uniform(-12, 12)))
    return obs


HEAVY_R = float(os.environ.get("PB_HR", 0.95))       # the jaws' ring
PLATE_R = float(os.environ.get("PB_PR", 1.27))       # the round plate under it
JAW_H = float(os.environ.get("PB_JH", 0.4))
TOOTH_H = float(os.environ.get("PB_TH", 0.24))
HSPIKE_L = float(os.environ.get("PB_HSL", 0.5))     # the Heavy Trap's spikes: short and stubby, as Flash's
HSPIKE_W = float(os.environ.get("PB_HSW", 0.14))
ARCH_Z = float(os.environ.get("PB_AZ", 0.5))         # the shut jaws' height, squashed
PLATE_T = 0.12


def heavy(M, state):
    """Heavy Trap: an open bear trap (two red jaws with zig-zag teeth, black inside) on a dark round plate, eight white
    spikes leaning out and up from the jaws; fired, the jaws stand shut as an arch across the plate."""
    obs = []
    obs.append(revolve("plate", [(0.0, PLATE_T), (PLATE_R - 0.08, PLATE_T), (PLATE_R - 0.02, PLATE_T - 0.03),
                                 (PLATE_R, PLATE_T - 0.07), (PLATE_R - 0.01, 0.0), (0.0, 0.0)], M["plate"], verts=64))
    obs.append(revolve("pan", [(0.0, PLATE_T + 0.02), (0.84, PLATE_T + 0.02), (0.88, PLATE_T), (0.0, PLATE_T)],
                       M["inside"], verts=40))
    for side in (-1, 1):                          # the hinge blocks the jaws turn on, at the ring's left and right ends
        obs.append(G["box"](f"hinge{side}", (0.14, 0.24, 0.2), (side * (HEAVY_R + 0.13), 0.0, PLATE_T), M["hinge"], bevel=0.03))
    jm = [M["red"], M["inside"]]
    if state == "whole":
        # the two jaws open into a ring, their ends meeting at the hinges (world +-X)
        obs.append(jaw_band("jawF", 180, 360, HEAVY_R, JAW_H, 0.1, 7, TOOTH_H, jm, z0=PLATE_T))
        obs.append(jaw_band("jawB", 0, 180, HEAVY_R, JAW_H, 0.1, 7, TOOTH_H, jm, z0=PLATE_T))
        for k in range(8):
            b = -45 + 45 * k + 22.5
            obs.append(spike(f"spike{k}", HEAVY_R + 0.02, b, HSPIKE_L, HSPIKE_W, M["flatspike"], up=40,
                             z=PLATE_T + JAW_H * 0.5))
    else:
        # shut: each jaw turned 90 degrees up about the hinge line (world X), the two meeting overhead in an arch
        # Flash's shut trap is a LOW flat arch lying almost on the plate: the shut jaws squashed down (ARCH_Z)
        for nm, th0, th1, ang in (("jawF", 180, 360, -90), ("jawB", 0, 180, 90)):
            j = jaw_band(nm, th0, th1, HEAVY_R, JAW_H, 0.1, 7, TOOTH_H, jm, z0=0.0)
            j.data.transform(Matrix.Rotation(math.radians(ang), 4, "X"))
            j.data.transform(Matrix.Diagonal((1.0, 1.0, ARCH_Z, 1.0)))
            j.location = (0, 0, PLATE_T + 0.02)
            obs.append(j)
        for k, (r, a) in enumerate(((0.75, 200), (0.9, 290))):      # two spikes snapped off, lying on the plate
            obs.append(spike(f"spikebit{k}", r, a, 0.26, 0.1, M["flatspike"], up=-3, z=PLATE_T + 0.07))
    return obs


LOOKS = {"booby": booby, "heavy": heavy}


# ------------------------------------------------------------------------------------------------------------ checks
def contact():
    """Every part's least distance to the ground or to any other part (evaluated meshes)."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    obs = []
    for o in SC.objects:
        if o.type != "MESH" or o.name == "ground" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        vs = [ev.matrix_world @ v.co for v in me.vertices]
        obs.append((o.name, BVHTree.FromPolygons(vs, [p.vertices[:] for p in me.polygons]), vs))
        ev.to_mesh_clear()
    touch = {name: set() for name, _, _ in obs}
    worst = 0.0
    for name, t, vs in obs:
        best = abs(min(v.z for v in vs))
        for n2, t2, _ in obs:
            if n2 == name:
                continue
            d = 0.0 if t.overlap(t2) else min((h[3] for h in (t2.find_nearest(v, 0.5) for v in vs[::2])
                                               if h[0] is not None), default=9.0)
            if d <= 0.03:
                touch[name].add(n2)
                touch[n2].add(name)
            best = min(best, d)
        worst = max(worst, best)
        print("CONTACT %-12s gap %.3f %s" % (name, best, "FLOAT" if best > 0.03 else "ok"))
    held = {name for name, _, vs in obs if min(v.z for v in vs) <= 0.03}
    todo = list(held)
    while todo:
        for n2 in touch[todo.pop()]:
            if n2 not in held:
                held.add(n2)
                todo.append(n2)
    for name, _, _ in obs:
        if name not in held:
            print("CONTACT %-12s NOT CONNECTED TO THE GROUND" % name)
    print("CONTACT worst gap %.3f, parts not reaching the ground: %d" % (worst, len(obs) - len(held)))
    far = max((math.hypot(v.x, v.y), name) for name, _, vs in obs for v in vs)
    print("CONTACT furthest part %s reaches %.3f (footprint half side 1.415)" % (far[1], far[0]))


def clear(keep):
    for o in list(SC.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


def main():
    G["setup"](SC)
    keep = set(SC.objects)
    M = mats()
    out = HERE / ("work" if MODE in ("prev", "save") else "render")
    out.mkdir(exist_ok=True)
    sc = SC
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    for st in STATES:
        clear(keep)
        LOOKS[LOOK](M, st)
        bpy.data.objects["ground"].hide_render = False
        if MODE == "check":
            print("STATE", LOOK, st)
            contact()
            continue
        if MODE == "save":
            bpy.ops.wm.save_as_mainfile(filepath=str(out / f"{LOOK}-{st}.blend"))
            print("DONE", LOOK, st, MODE)
            continue
        if MODE == "prev":
            sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 32))
            sc.render.filepath = str(out / f"prev-{LOOK}-{st}.png")
            bpy.ops.render.render(write_still=True)
        else:
            sc.cycles.samples = int(os.environ.get("PB_SAMPLES", 256))
            sc.render.filepath = str(out / f"{LOOK}-{FILE_STATE.get(st, st)}-base.png")
            bpy.ops.render.render(write_still=True)
            bpy.data.objects["ground"].hide_render = True
            sc.cycles.samples = 64
            sc.render.filepath = str(out / f"{LOOK}-{FILE_STATE.get(st, st)}-alone.png")
            bpy.ops.render.render(write_still=True)
        print("DONE", LOOK, st, MODE)


main()
