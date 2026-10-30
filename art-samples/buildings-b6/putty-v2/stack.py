"""stack.py : the Putty Squisher's one body and its mounting points, shared by putty2.py (Blender) and post.py.

The body is the pot. Level 1 stands it on the ground. Level 3 sets the same pot in a purple frame on four log stumps,
which lifts it (and every part fixed to it) by LIFT, and bolts two pale arches over it. Level 6 adds the hub on the
arches (flask, valve wheel, the arm that now holds the test tube). Level 10 adds the cage wheel on the hub's axle, the
coil, the basin and the springs round the stumps. Every part is placed from these points: nothing is placed per level
on screen.
"""
import math

ORIGIN = (0.5, 40.5)        # Flash pixel of the world origin (the pot's axis on the ground)
GROUND = 0.0
# the pot
POT_H = 3.1                 # foot to rim top
POT_R = 1.74                # the rim lip's outer radius
POT_RMAX = 1.9              # the belly
LIFT = 1.7                  # level 3 up: the pot's foot stands this high in the frame
PUTTY_DOWN = 0.75           # the putty's surface below the rim top
# the frame (level 3 up): a square of rails on the stumps, a post at each corner
FR_D = 2.6                  # the corners' distance from the axis
FR_ROT = -12.0              # the square turned this much (deg) from the ground grid (as Flash's frame)
RAIL_Z, RAIL_T = 1.85, 0.44 # the rails' middle height and thickness
STRAP_Z = 1.42              # the straps' foot under the pot (their top is the pot's foot)
STUMP_H = 1.61              # the stumps' top: the rails' corners rest on them
POST_R = 0.36
STUMP_D, STUMP_R = 2.2, 0.48
# the press block on the rim (every level) and the arches (level 3 up)
BLOCK = (0.12, -1.62)        # the block's middle (X, Y) on the rim
BLOCK_SIZE = (1.5, 0.9, 1.0)
ARCH_X = (-0.62, 0.62)      # the two arches' planes
ARCH_Y = (-1.55, 1.45)      # their feet (on the block, on the rim)
ARCH_UP = 1.65              # their crown above the rim top
# the hand wheel on the pot's side (every level)
WHEEL_TH, WHEEL_D, WHEEL_UP, WHEEL_R = -112.0, 2.55, 1.35, 0.72
WHEEL_AX = -97.0             # the way its axle points (it faces the viewer more than a spoke from the axis would)
# the test tube: one spot on the ground plan at every level
TUBE_XY = (2.95, 0.95)
TUBE_TOP = (2.85, 4.3)        # the tube's top at level 1 and level 3 (it stands on the ground)
TUBE_R = 0.34
# level 6: the hub on the arches' crown (a short drum across both arches), its flask, the valve wheel on a shaft out
# to the left, and the arm out to the right that holds the test tube up
HUB_R, HUB_UP = 0.62, 0.3   # the hub's radius; its axis above the arches' crown line
FLASK = (-0.2, -0.25)       # the flask on the hub's top
VALVE_Y, VALVE_R, VALVE_UP = -2.63, 0.55, 0.45     # the valve wheel on its shaft (out along -Y from the hub, rising)
TUBE_TOP6 = 7.0             # the tube's top from level 6 (it hangs from the arm)
TUBE_LEN6 = 4.0
# level 10: the cage wheel on the hub's axle out to the back right, the basin under its far end
CAGE_Y, CAGE_W, CAGE_R = 2.38, 1.3, 1.44
BASIN = (0.5, 2.68, 4.75)   # the basin's middle on the ground plan and its rim height
CAGE_RUNGS = 8
CAGE_TURN = 2 * 360.0 / CAGE_RUNGS    # a loop turns the cage two rungs (Flash: about 4 deg a frame)
STIR_TURN = 3 * 360.0                 # a loop turns the stirrer three times (Flash: once every 8.7 frames)
PUTTY_TURN = 360.0                    # and the putty once


def z_pot(lv):
    return LIFT if lv >= 3 else 0.0


def z_rim(lv):
    return z_pot(lv) + POT_H


def post_top(lv):
    return z_rim(lv) - 0.05


def z_crown(lv):
    return z_rim(lv) + ARCH_UP


def z_hub(lv):
    return z_crown(lv) + HUB_UP


def corner(i):
    """Corner i of the frame (0 front, 1 right, 2 back, 3 left) on the ground plan."""
    a = math.radians(-45.0 + 90.0 * i + FR_ROT)
    return (FR_D * math.cos(a), FR_D * math.sin(a))


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts(lv):
    """World points of the shared parts at a level (for the dashed lines in post.py)."""
    zr = z_rim(lv)
    out = {"rim": (0.0, -POT_R, zr),
           "block": (BLOCK[0], BLOCK[1], zr + BLOCK_SIZE[2]),
           "wheel": polar(WHEEL_TH, WHEEL_D, z_pot(lv) + WHEEL_UP)}
    if lv >= 3:
        out["crown"] = (0.0, 0.0, z_crown(lv))
    if lv >= 6:
        out["hub"] = (0.0, 0.0, z_hub(lv))
    return out
