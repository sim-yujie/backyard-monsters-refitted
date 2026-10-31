"""stack.py : the Map Room's one body and its mounting points, shared by maproom.py (Blender) and post.py.

Flash has one look for every level of the Map Room (buildingArtData.ts row 11: one art level, no animation strip), so
there is one model. The body: a blue-grey stone block with a rounded footing block at each corner. On it a square
wooden deck that overhangs the stone on every side, with a silver-topped post at each corner and a dark rope between
the posts. On the deck, toward the back, a plank cabin with a steep gable roof (ridge along X; a round cross-paned
window in the +X gable), and on its ridge a small plank tower with its own gable roof (ridge along Y). A brass
telescope with a big flared mouth sits on a gold bracket on the cabin's front (-Y) roof slope and looks out to the
viewer's left. A giant pair of steel scissors stands through a slot in the deck's front-left (-Y) overhang, its
blades reaching down to the ground in front of the stone and its two handle loops (a long teardrop, a D) high above
the deck. Wooden stairs run up the stone's +X face toward the back to a landing in front of a dark doorway.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
+X faces the viewer's right, -Y the viewer's left. The whole building is turned YAW degrees about Z (Flash draws its
left edges a little flatter and its right edges a little steeper than the camera's 2:1).
"""
import math

ORIGIN = (-5.5, 46.5)       # Flash pixel of the world origin (the stone block's middle on the ground)
GROUND = 0.0
YAW = 2.5

# the stone block
BASE_A = 2.93               # half its width
BASE_H = 4.04               # its top (under the deck)
BASE_R = 0.32               # its rounded upright edges
FOOT_S, FOOT_H, FOOT_OUT = 1.34, 1.5, 0.26    # the corner footings: side, height, how far they stand out of the walls

# the deck
DECK_A = 3.64               # half its width
DECK_T = 0.42               # its thickness
DECK_Z1 = BASE_H + DECK_T   # its top
DECK_N = 9                  # boards (running along X)
SLOT_W, SLOT_D = 1.9, 1.25  # the scissors' slot round their pivot (along X, along Y)

# the posts at the deck's corners, and the rope between their balls
POST_IN = 0.36              # in from the deck's corners
POST_IN_F = 0.8             # the front (-Y) posts: a little further in, so their rope runs behind the scissors
POST_H, POST_R, BALL_R = 1.4, 0.1, 0.3
ROPE_R, ROPE_SAG = 0.1, 0.22

# the cabin (the roof: a ridge along X, boards down both sides at ROOF_PITCH to ROOF_RUN from the ridge)
HOUSE_C = (0.02, 1.3)      # its middle (before the shear)
HOUSE_AX, HOUSE_AY = 1.22, 1.3   # half its length (X) and width (Y)
ROOF_Z, ROOF_RUN, ROOF_PITCH = 9.22, 2.05, 43.0
ROOF_END = 0.3              # the roof's overhang past the gables
# Flash draws the cabin's long walls flatter than the deck's edges (its art was a perspective render): the cabin and
# its tower are sheared, y moving by HOUSE_SHEAR per unit of x behind the +X gable (which stays put)
HOUSE_SHEAR = 0.3
WIN_C = (1.11, 6.69)        # the round window in the +X gable: y, z
WIN_R = 0.88

# the tower on the cabin's ridge (its roof: a ridge along Y)
TOWER_C = (0.4, 1.3)
TOWER_A = 0.56              # half its side
TROOF_Z, TROOF_RUN, TROOF_DROP, TROOF_END = 12.3, 0.83, 1.27, 0.22

# the telescope, placed where Flash draws it (Flash px; built after the yaw, in the camera's world)
SCOPE_EYE = (-1.8, -35.5, 0.0)      # the eyepiece end: Flash px x, y and its world y
SCOPE_DIR = (-0.05, -0.9, 0.40)    # toward the mouth: Flash's bell faces up-left, its middle ~2 px above the bulb's
SCOPE_LEN = 2.75
SCOPE_PLATE = (-9.5, -22.5)         # the bracket's plate on the front roof slope (Flash px)
SCOPE_ARM = -10.0                   # the arm meets the tube at this Flash x

# the scissors (Flash px; their plane runs through the pivot and the two blade tips)
SCIS_PIVOT = (-32.0, 12.6, -3.12)   # Flash x, y and world y: the pivot screw just above the deck's slot
SCIS_LOOP_Y = -3.36                 # the handles bend (along the camera's ray: unseen) into the plane through the pivot
                                    # at this world y, clear of the rope and posts
SCIS_TIPS = ((-34.0, 58.5), (-24.6, 63.5))
# Flash's own handle traces (kept for reference; the model is the matched pair of scis_design())
SCIS_TEAR = ((-31.5, 13), (-34.5, 9.5), (-38.5, 5), (-42.5, 0), (-45.6, -5), (-47.6, -10), (-48.3, -15), (-47.4, -19.5),
             (-45, -21.8), (-42.4, -21.2), (-40.6, -17.5), (-38.8, -12), (-37, -6), (-35.2, 0), (-33.6, 5.5), (-32.4, 10))
SCIS_D = ((-24, 10), (-22.6, 5), (-21.3, 0.5), (-20, -4.5), (-18.8, -8.6), (-16.8, -9.4), (-12.6, -7), (-10, -2), (-10, 3), (-12, 7.5), (-15, 10),
          (-19.5, 10.5))
# the matched pair, in the scissors' own plane (a: right, b: up, world units, the pivot at 0, 0)
SCIS_SHANK = (0.9, 40.0)            # each shank's length and its angle out from the centre line (the same both sides)
SCIS_TEAR_LR = (2.6, 0.72, 28.0)    # the teardrop (left): length from its point, round end's radius, axis angle
SCIS_D_LW = (2.6, 1.65, 20.0)        # the D (right): straight inner side's length, bulge, axis angle
SCIS_ROD = 0.15                     # the handles' and shanks' tube radius
SCIS_HUB = 0.34                     # each half's round boss at the pivot
SCIS_BLADE_W = 0.30                 # a blade's width just below the boss (back edge to cutting edge)


def _chaikin(pts, k=3, closed=True):
    for _ in range(k):
        out = []
        m = len(pts) if closed else len(pts) - 1
        for i in range(m):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            out += [(0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]),
                    (0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1])]
        pts = out if closed else [pts[0]] + out + [pts[-1]]
    return pts


def _dir(deg_right):
    """Unit vector deg degrees to the right of straight up (negative: to the left)."""
    t = math.radians(deg_right)
    return (math.sin(t), math.cos(t))


def scis_design(ST):
    """The scissors in their own plane: ST = the two blade tips (a, b), left then right. Returns
    {"halves": [{"loop", "shank", "blade", "edge", "z"}, ...] (0: teardrop handle with the right blade, in front;
    1: D handle with the left blade, behind), "lines": [(kind, pts, closed)] for previews}."""
    ls, ang = SCIS_SHANK
    halves = []
    # 0: the teardrop, up-left; its blade crosses to the right tip
    d = _dir(-ang)
    apex = (d[0] * ls, d[1] * ls)
    L, R, ax = SCIS_TEAR_LR
    u = _dir(-ax)
    c = (apex[0] + u[0] * (L - R), apex[1] + u[1] * (L - R))
    al = math.asin(R / (L - R))
    th0 = math.atan2(-u[1], -u[0])                  # from the circle's centre back toward the apex
    tear = [apex]
    for i in range(25):                             # round the far side, tangent to tangent
        t = th0 + (math.pi / 2 - al) + i / 24 * (2 * math.pi - 2 * (math.pi / 2 - al))
        tear.append((c[0] + R * math.cos(t), c[1] + R * math.sin(t)))
    tear = _chaikin([apex] + [((apex[0] * (1 - f) + tear[1][0] * f), (apex[1] * (1 - f) + tear[1][1] * f)) for f in (0.5,)]
                    + tear[1:] + [((apex[0] * (1 - f) + tear[-1][0] * f), (apex[1] * (1 - f) + tear[-1][1] * f)) for f in (0.5,)], 3)
    # 1: the D, up-right (mirror of the teardrop's shank); straight side inward, round side outward
    p0 = (-apex[0], apex[1])
    L2, W2, ax2 = SCIS_D_LW
    u2 = _dir(ax2)
    o2 = (u2[1], -u2[0])                            # outward (to the right)
    mid = (p0[0] + u2[0] * L2 / 2, p0[1] + u2[1] * L2 / 2)
    dl = [p0, (p0[0] + u2[0] * L2 * 0.5, p0[1] + u2[1] * L2 * 0.5)]
    for i in range(21):
        t = i / 20 * math.pi
        e = math.sin(math.pi * (t / math.pi) ** 0.75) ** 0.7   # fullest toward the top, like Flash's D
        dl.append((mid[0] + u2[0] * L2 / 2 * math.cos(t) + o2[0] * W2 * e,
                   mid[1] + u2[1] * L2 / 2 * math.cos(t) + o2[1] * W2 * e))
    dl = _chaikin(dl[:1] + dl[1:2] + [(mid[0] + u2[0] * L2 / 2, mid[1] + u2[1] * L2 / 2)] + dl[3:], 3)
    for k, (loop, start, tip) in enumerate(((tear, apex, ST[1]), (dl, p0, ST[0]))):
        # the blade: from round the boss down to its tip; back edge outward, a straight cutting edge inward
        bl = math.hypot(*tip)
        db = (tip[0] / bl, tip[1] / bl)
        ob = (-db[1], db[0]) if tip[0] > 0 else (db[1], -db[0])      # outward from the centre line
        hub = SCIS_HUB
        back, cut = [], []
        for i in range(13):
            s = i / 12
            w = SCIS_BLADE_W * (1 - s) ** 0.9 * (1 + 0.35 * s)
            p = (db[0] * (hub * 0.55 + (bl - hub * 0.55) * s), db[1] * (hub * 0.55 + (bl - hub * 0.55) * s))
            back.append((p[0] + ob[0] * w * 0.75, p[1] + ob[1] * w * 0.75))
            cut.append((p[0] - ob[0] * w * 0.25, p[1] - ob[1] * w * 0.25))
        # the boss: round the pivot over the top, from the cutting edge's root to the back edge's root
        tc, tb = math.atan2(cut[0][1], cut[0][0]), math.atan2(back[0][1], back[0][0])
        tu = math.atan2(-db[1], -db[0])
        ccw = (tb - tc) % (2 * math.pi)
        if abs(((tc + ccw / 2 - tu + math.pi) % (2 * math.pi)) - math.pi) > math.pi / 2:
            ccw -= 2 * math.pi                      # the other way round passes over the top
        cap = [(hub * math.cos(tc + ccw * i / 16), hub * math.sin(tc + ccw * i / 16)) for i in range(1, 16)]
        blade = back + cut[::-1] + cap
        halves.append({"loop": loop, "shank": [(0.0, 0.0), start], "blade": blade, "edge": cut, "tip": tip,
                       "z": 1 if k == 0 else -1})
    lines = []
    for hv in halves:
        lines += [("blade", hv["blade"], True), ("loop", hv["loop"], True), ("shank", hv["shank"], False)]
    lines.append(("edge", halves[0]["edge"], False))
    return {"halves": halves, "lines": lines}


# the stairs on the stone's +X face
STAIR_X1 = 4.7              # their outer side
STAIR_Y0, LAND_Y0, LAND_Y1 = -0.95, 1.45, 3.3  # the bottom step's front, the landing's front and back
LAND_Z = 2.3
STEP_N = 4
DOOR = (1.9, 2.75, LAND_Z, 3.62)   # the doorway in the stone's +X face: y0, y1, z0, z1


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (before the yaw), for the dashed lines in post.py."""
    return {"deck": (DECK_A, -DECK_A, DECK_Z1), "house": (HOUSE_C[0] + HOUSE_AX, HOUSE_C[1] - HOUSE_AY, DECK_Z1)}
