"""stack.py : the Monster Locker's parts and their mounting points per level, shared by locker.py (Blender) and post.py.

Flash redesigns the Locker at every level, so the 3D follows it while keeping one family of parts: a wooden base
disc, the black ribbed bellows, a polished blue-chrome shell, the gold wind-up key on top at the left (it turns about
its shaft once a loop), the gold barrel of blocks inside (it turns about its axle), and steel panels with gold
brackets bolted to the shell.
Level 1: a small chrome ball on short bellows on a wooden disc, a closed shell, one panel box with a window.
Level 2: a big ball with a hole in its top (the gold barrel shows through), four panels (two with portholes), taller
bellows, and the disc lifted on three needle legs.
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

KEY_TURN = {1: 0.5, 2: 0.5, 3: 1.0, 4: 1.0}   # the key's turns a loop (Flash's rings turn half round: they look
                                             # the same after half a turn; the monster bows turn once round)
KEY0 = {1: -1.0, 2: 28.0, 3: 90.0, 4: 90.0}   # the key's bow at frame 0 (degrees about its shaft)
BARREL_TURN = 60.0          # the barrel turns two rows of blocks a loop (12 rows)

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
L1_KEY_RING = (-30.0, -26.5)                     # Flash px of the ring's middle
L1_KEY_RING_R = 0.78
L1_BOX_AT = (16.0, -15.0)                        # Flash px of the panel box's middle on the ball
L1_BOX_SPIN = 20.0
L1_BOX_LEAN = 0.7

# ---- level 2
L2_DISC_R, L2_DISC_Z, L2_DISC_H = 2.75, 1.85, 0.32
L2_BELLOWS_R, L2_BELLOWS_RIBS = 2.15, 7
L2_BALL_C, L2_BALL_R = (-1.0, -18.0), 4.2
L2_HOLE = (245.0, 34.0, 3.55)                   # the top hole: the cut plane's normal tilted toward this bearing by this
                                                 # many degrees, at this distance from the ball's middle
L2_LEGS = (225.0, 45.0, -45.0)                   # the three needle legs' bearings
L2_LEG_D = 4.05
L2_KEY_RING = (-27.0, -75.0)
L2_KEY_RING_R = 1.5
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
L3_EGG_C = (0.0, -7.0)                         # Flash px of the egg's middle (in the upright plane through the axis)
L3_EGG_R = (4.0, 6.0, 5.0)                       # radius across, half length toward the top, toward the bottom
L3_EGG_TAPER, L4_EGG_TAPER = -0.1, -0.1          # the egg's width change toward its top (+ wider)
L3_EGG_AXIS = (250.0, 30.0)                       # the long axis: from straight up toward this bearing, by this much
L3_CUT = (280.0, 48.0, 4.0)                      # the opening's plane: its normal from straight up toward this bearing
                                                 # by this much, its distance from the middle
L3_BARREL = (6.4, 2.0, 1.0)                      # length, core radius, its middle moved up its axle
L3_BARREL_SINK = -1.0                            # the barrel's middle: the opening's middle moved along its normal
L3_BARREL_AXIS = (60.0, 45.0)                    # its axle: toward this bearing, rising by this much
L3_BARREL_ROWS, L3_BARREL_COLS = 14, 6                 # blocks in every other cell
L3_BLOCK_FILL = (0.82, 0.8)                      # how much of its cell each block fills (black gaps between)
L4_BARREL_ROWS, L4_BARREL_COLS, L4_BLOCK_FILL = 12, 5, (0.86, 0.86)   # level 4: fewer, bigger blocks, as Flash
L3_COG_R, L3_COG_PX = 1.5, (0.0, -66.0)          # the cog at the top: radius, Flash px of its middle
L3_COG_SINK, L3_COG_FACE = 0.6, 0.7              # the cog pulled this far down to the barrel's end, its face turned
                                                 # this much toward the camera (0: along the axle)
L3_GCOG_R, L3_GCOG_Z = 2.9, 0.35                 # the gold cog under the bellows: radius, height of its middle
L3_BELLOWS_Z = 1.3                               # the bellows' foot (on the cog's hub)
L3_BELLOWS_R = 3.6
L3_BELLOWS_RIBS = 3                              # flat rings, as Flash
L3_PLATE_R, L3_PLATE_H = 3.95, 0.22               # the grey plate under the bellows
L3_FOOT_D, L3_ARM_Z = 4.9, 2.9                 # the feet: distance out, the arms' height
L3_NUT_R, L3_BOLT_Z = 0.8, 2.1                # level 3: the hex nut each bolt stands on, the arms' height
L3_CHIM_TOP, L3_CHIM_Y, L3_CHIM_W = (42.0, -72.0), 4.5, 2.0
L3_CHIM_LEAN = (225.0, 0.0)                     # the chimney's foot swings toward this bearing by this much
L3_CHIM_BEND = 40.0                              # the duct below the plate slants this far toward the body
L3_KEY_AT = 1.4                                  # the key's foot: this far up the barrel from its low end
L3_KEY_BOW = (-31.0, -70.0)                      # Flash px of the bow's middle
L3_BOW_SCALE = 1.4
L3_BOW_FOOT, L4_BOW_FOOT = (-27.4, -58.0), (-27.5, -59.5)   # Flash px where the stem meets the bow
L3_PANELS = (((-33.0, -22.0), "port"), ((-28.0, 6.0), "port"), ((24.0, 13.0), "port"))
L3_PANEL_SPIN = (0.0, 0.0, 0.0)
L3_PANEL_LEAN = (0.0, 0.2, 0.2)
L4_BASE_C, L4_BASE_R, L4_BASE_H = (-1.0, 56.0), 4.3, 0.45
L4_BASE_W, L4_PAD_R = 1.6, 1.05                   # the ring's width, the pads' radius
L4_EGG_C = (-3.0, -8.0)
L4_EGG_R = (4.2, 5.4, 4.9)                       # level 4: the egg a little shorter
L4_GCOG_R = 2.9
L4_CUT = (280.0, 52.0, 3.6)                      # level 4: the opening bigger and lower
L4_PILLAR_R, L4_PILLAR_TOP = 0.5, 5.3
L4_BOW_R = 1.05


def mounts(lv):
    """Parts fixed at one place on every level (for post.py's dashed lines): none, as Flash redesigns each level."""
    return {}
