"""stack.py : the Monster Locker's parts and their mounting points per level, shared by locker.py (Blender) and post.py.

Flash redesigns the Locker at every level, so the 3D follows it while keeping one family of parts: a wooden base
disc, the black ribbed bellows, a polished blue-chrome shell, the gold wind-up key on top at the left (it turns about
its shaft once a loop), the gold barrel of blocks inside (it turns about its axle), and steel panels with gold
brackets bolted to the shell. Levels 2-4 (reviewer + owner, 7 Nov): separate round gold gear wheels on ONE axle seen
nearly edge-on (only the front half of each rim shows as a tall arc of flat tooth tops, dark gaps between), the key's
stem down between the first two.
Level 1: a small chrome ball on short bellows on a wooden disc, a closed shell, one panel box with a window.
Level 2: a big ball with an opening at its upper front left showing three gold cogs inside (the key's shaft comes down
through the opening and turns the middle one), four panels (two with portholes), taller bellows, and the disc lifted
on three needle legs.
Level 3: the shell becomes an egg lying along world X with its top-front half cut away over the long barrel of gold
blocks, a flat end plate on the right, a square chimney at the back right, a gold cog under a wide flat bellows, four
bolt feet; the key's bow becomes a gold wire monster face.
Level 4: level 3 lifted on four steel pillars round the bellows, on a wide wooden base; barred vents replace the
portholes, the key's bow is a solid gold monster head and the chimney gets a gold cage.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
Bearings: 0 = world +X (front right on screen), -90 = world -Y (front left), -45 = straight at the viewer.
Positions are given as Flash pixels (game frame, origin = the building's anchor) where Flash shows them.
"""
import math

ORIGIN = (0.0, 55.0)        # Flash pixel of the world origin (on the ground)
GROUND = 0.0
FRAMES = {1: 21, 2: 20, 3: 20, 4: 20}     # Flash's loops (level 4's data says 21, but its strip has 20 cells)

KEY_TURN = {1: 0.5, 2: 0.5, 3: -0.5, 4: 0.5}  # the key's turns a loop (level 3 the other way round) (Flash's rings turn half round: they look
                                             # the same after half a turn; the monster bows too: Flash shows one edge-on a loop)
KEY0 = {1: -1.0, 2: 252.0, 3: 90.0, 4: 90.0}   # the key's bow at frame 0 (degrees about its shaft)

# the ground middle under each level's axis (Flash px)
GC = {1: (-2.0, 53.0), 2: (0.0, 57.0), 3: (1.0, 50.0), 4: (-3.0, 52.0)}

SHEEN = {2: tuple((-30 + 1.5 * i, -22 - 1.0 * i) for i in range(8)), 1: tuple((-13 + 1.1 * i, -8 - 1.45 * i) for i in range(12)), 3: (), 4: ()}   # Flash's white streak on the
                                                                                   # shell (Flash px along it)
# ---- level 1
L1_DISC_R, L1_DISC_H = 2.1, 0.4
L1_DISC_C = (-4.0, 52.0)                         # Flash px of the disc's middle on the ground
L1_BELLOWS_R, L1_BELLOWS_RIBS = 1.15, 6
L1_BALL_C, L1_BALL_R = (-2.0, 1.0), 2.8          # Flash px of the ball's middle, radius (world)
L1_KEY_AT = (-15.5, -13.5)                       # Flash px where the key's shaft leaves the ball
L1_KEY_RING = (-27.0, -29.5)                     # Flash px of the ring's middle (Flash: oval 22x16 px at -38..-16, -37..-21)
L1_KEY_RING_R = 1.0
L1_BOX_AT = (16.0, -15.0)                        # Flash px of the panel box's middle on the ball
L1_BOX_SPIN = 20.0
L1_BOX_LEAN = 0.7

# ---- level 2
L2_DISC_R, L2_DISC_Z, L2_DISC_H = 2.75, 1.85, 0.32
L2_BELLOWS_R, L2_BELLOWS_RIBS = 2.15, 7
L2_BALL_C, L2_BALL_R = (-1.0, -18.0), 4.2
L2_HOLE = (290.0, 28.0, 3.8)                    # the top hole: the cut plane's normal tilted toward this bearing by this
                                                 # many degrees, at this distance from the ball's middle
L2_LEGS = (225.0, 45.0, -45.0)                   # the three needle legs' bearings
L2_LEG_D = 4.05
L2_KEY_RING = (-27.0, -75.0)
L2_KEY_RING_R = 1.5
L2_KEY_LEAN = 46.0                               # the shaft leans this far out of the screen toward the camera
L2_WALL = 0.28                                   # the shell's wall at the opening (Flash shows a thick lip)
L2_KEY_FOOT = (-20.0, -45.0)                     # Flash px where the key's stem goes down into the hole between the two
                                                 # gear wheels
# level 2's two gear wheels (as L3_GEARS, smaller): seen through the hole as two leaning bands of big flat gold tooth
# tops; 10 teeth and 36 degrees a loop = one tooth a loop
L2_GEARS = dict(psi=35.0, q=0.30, c1=(-12.0, -41.0), depth=0.0, pitch=1.0, radii=(2.0, 1.9), thick=0.6,
                teeth=(10, 10), tooth=0.22, turn=36.0)
L2_PANELS = (                                    # Flash px of each panel's middle, kind
    ((-42.0, -24.0), "port"),
    ((-28.0, -6.0), "port"),
    ((17.0, 3.0), "port"),
    ((24.0, -47.0), "box"),
)
L2_PANEL_SPIN = (0.0, 0.0, 0.0, 30.0)
L2_PANEL_LEAN = (0.0, 0.2, 0.2, 0.5)


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


# ---- levels 3 and 4 (level 4 = level 3 on pillars and a wooden base, vents for portholes, a solid bow, a caged chimney)
L3_BODY_C, L3_BODY_R = (2.0, -14.0), 4.4         # (kept for the panels' stand-off: the body's rough radius)
# the body: Flash's tall egg, its top leaning toward the back right, its upper left side cut away by a plane along its
# length (the opening faces up and toward the front left); the gold barrel lies in it along the egg's axis, half of it
# above the rim
L3_EGG_C = (0.0, -14.0)                         # Flash px of the egg's middle (in the upright plane through the axis)
L3_EGG_R = (4.5, 4.6, 3.9)                       # radius across, half length toward the top, toward the bottom
L3_EGG_TAPER, L4_EGG_TAPER = 0.0, 0.0          # the egg's width change toward its top (+ wider)
L3_EGG_AXIS = (70.0, 12.0)                       # the long axis: from straight up toward this bearing, by this much
L3_CUT = (30.0, 12.0, 1.2)                      # the opening's plane: its normal from straight up toward this bearing
                                                 # by this much, its distance from the middle
L3_CUT2 = (200.0, 100.0, -2.4)                          # the dome's cut face (as L3_CUT); None: one plane cut only
L3_CUT_R, L4_CUT_R = 2.5, 2.5                    # the corner between the two cuts rounded to this radius
# the gears (Flash, owner 7 Nov): four separate round gold gear wheels on ONE axle, seen nearly edge-on from the
# game camera (only the front half of each rim shows: a tall "(" arc of flat tooth tops, a dark gap (the next
# wheel's face) between neighbours). Fitted to Flash's moving-pixel map (review/flash-L3-moving-grid10.png) as
# coaxial ellipses: the axle's screen direction leans `psi` degrees below horizontal to the right and points `q`
# (cosine) toward the camera, so the wheels to the right stand nearer the camera and hide their neighbours' right
# halves. c1 = Flash px of the first (biggest, back-left) wheel's middle, depth = how far behind the egg's middle
# along the view; pitch = the wheels' spacing along the axle (world units); radii front to back; teeth per wheel
# (all multiples of 10, so the 36-degree turn a loop is seamless: 2 teeth of 20 travel down the front rim, ~1 px a frame)
L3_GEARS = dict(psi=37.0, q=0.27, c1=(-13.0, -44.0), depth=0.0, pitch=1.0, radii=(3.0, 3.0, 2.9, 2.2),
                thick=0.6, teeth=(20, 20, 20, 20), tooth=0.18, turn=36.0)
L4_GEARS = dict(psi=31.0, q=0.20, c1=(-19.0, -43.5), depth=0.0, pitch=1.5, radii=(3.3, 3.3, 3.2, 2.7),
                thick=0.85, teeth=(16, 16, 16, 16), tooth=0.26, turn=45.0)   # level 4: chunkier teeth (16, 45 deg a loop)
L3_BOSS, L4_BOSS = (5.0, -65.0, 1.1, 1.0), (10.0, -68.0, 1.25, 1.0)   # the static rounded gold boss at the back top
#                                            (the axle's back bearing cap): Flash px of its middle, radius, depth behind
#                                            the egg's middle along the view
L3_GCOG_R, L3_GCOG_Z = 2.0, 0.2                  # the gold cog under the bellows: radius, height of its middle (Flash:
#                                                 small, dark, shallow teeth, tucked under the plate)
L3_BELLOWS_Z = 2.3                               # the bellows' foot (on the cog's hub)
L3_BELLOWS_R = 3.3
L3_BELLOWS_IN = 0.6                              # the bellows reach up into the egg to where its underside is this wide
L3_BELLOWS_RIBS = 3                              # flat rings, as Flash
L3_PLATE_R, L3_PLATE_H = 3.45, 0.3               # the grey plate under the bellows
L3_FOOT_D, L3_ARM_Z = 4.9, 2.9                 # the feet: distance out, the arms' height
L3_NUT_R, L3_BOLT_Z = 0.8, 2.1                # level 3: the hex nut each bolt stands on, the arms' height
L3_CHIM_TOP, L3_CHIM_Y, L3_CHIM_W = (35.0, -65.0), 4.5, 2.0
L3_CHIM_LEAN = (45.0, 10.0)                     # the chimney's foot swings toward this bearing by this much
L3_CHIM_BEND = 40.0                              # the duct below the plate slants this far toward the body
L3_KEY_FOOT, L4_KEY_FOOT = (-27.0, -50.0), (-23.0, -52.0)   # Flash px where the key's stem goes down between the first
#                                                 and second gear wheels (no bearing block: the stem disappears between
#                                                 the rims)
L3_KEY_AXIS = (-39.0, -85.0)                     # level 3: Flash px of the bow's far end when edge-on (frame 13): the key turns about
                                                 # the line from the stem's foot to here
L3_AXIS_LEAN, L4_AXIS_LEAN = 55.0, 25.0          # that line leans this far out of the screen's plane toward the camera
                                                 # (level 3: steep, so the bow swings round in the picture as Flash's)
L3_KEY_BOW = (-31.0, -70.0)                      # Flash px of the bow's middle
L3_BOW_SCALE = 1.4
L3_BOW_FOOT, L4_BOW_FOOT = (-27.4, -58.0), (-30.0, -62.0)   # Flash px where the stem meets the bow
L3_PANELS = (((-42.5, -25.0), "strip"), ((-26.0, 2.0), "port"), ((22.0, 10.0), "port"))
L4_PANELS = (((-41.0, -20.0), "port"), ((-30.0, 6.0), "port"), ((26.0, 10.0), "port"))   # level 4: vents there
L3_PANEL_SPIN = (0.0, 0.0, 0.0)
L3_PANEL_LEAN = (0.0, 0.2, 0.2)
L4_BASE_C, L4_BASE_R, L4_BASE_H = (-1.0, 56.0), 4.3, 0.45
L4_BASE_W, L4_PAD_R = 1.6, 1.05                   # the ring's width, the pads' radius
L4_BASE_LUMPS = (26, 0.55, 0.35)                  # Flash: a tan LUMPY ring of bone/sandbag lumps: count, lump radius, height jitter
L4_EGG_C = (3.0, -8.0)
L4_EGG_R = (4.8, 4.7, 4.0)                # level 4: level 3's egg a little bigger (as Flash)
L4_GCOG_R = 2.1
L4_CUT, L4_CUT2 = L3_CUT, L3_CUT2                      # level 4: the opening bigger and lower
L4_PILLAR_R, L4_PILLAR_TOP = 0.5, 5.3
L4_BOW_R = 1.05
# level 4's skull bow (key-local units, up the shaft from the stem's end): head radius, its middle and the jaw's middle
# up the shaft, plate thickness, rim wire, jaw (width, height), eyes (across, up, radius across, radius up), nose up,
# horns (degrees off the top, length). Flash's head turns half round a loop, square to the camera at frame 3 (its
# widest), edge-on at 13
L4_KEY_AXIS = (-45.0, -86.0)                     # level 4: Flash px of the head's top when edge-on (frame 13)
L4_SKULL = dict(r=1.0, head_v=1.7, jaw_v=0.5, th=0.42, rim=0.2, jaw=(1.3, 0.72), eye=(0.42, 0.08, 0.3, 0.36),
                nose=-0.42, horn=(32.0, 0.32))
KEY_FACE = {3: 4, 4: 3}   # the frame the bow is built facing the camera (L3 traced from Flash frame 5; both timed by bow area per frame, keywidth.py)


def mounts(lv):
    """Parts fixed at one place on every level (for post.py's dashed lines): none, as Flash redesigns each level."""
    return {}


# trial values without editing this file: S_OVR='{"L3_CUT": [280, 40, 3.0]}'
import json as _json  # noqa: E402
import os as _os  # noqa: E402
for _k, _v in _json.loads(_os.environ.get("S_OVR", "{}")).items():
    globals()[_k] = tuple(_v) if isinstance(_v, list) else _v
