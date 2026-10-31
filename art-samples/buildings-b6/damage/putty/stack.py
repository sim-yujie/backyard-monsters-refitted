"""stack.py : the Putty Squisher v3's one body and its mounting points, shared by putty3.py (Blender) and post.py.

v3 is our own take rather than a trace of Flash's outline: the same parts and colours, in chunkier, simpler shapes that
read at game size. The body is a banded tub of a pot. Level 1 stands it on the ground. Level 3 sets the same pot in a
fat purple goo frame on four log stumps, which lifts it (and every part fixed to it) by LIFT, and bolts two chunky bone
arches over it. Level 6 adds a round drum hub on the arches' crown (flask, valve wheel, the arm that now holds the test
tube). Level 10 adds the cage wheel on the hub's axle, the coil and the springs round the stumps. Every part
is placed from these points: nothing is placed per level on screen.
"""
import math

ORIGIN = (0.5, 40.5)        # Flash pixel of the world origin (the pot's axis on the ground)
GROUND = 0.0
# the pot: an upright tub with two riveted bands and a fat rolled rim
POT_H = 3.0                 # foot to rim top
POT_R = 1.97                # the rolled rim's outer radius
POT_RMAX = 1.88             # the belly
BANDS = (0.3, 2.3)          # the bands' middle heights above the foot: the foot (a dark ring), and the upper band that
                            # carries the hand wheel and the frame's brackets)
LIFT = 1.85                 # level 3 up: the pot's foot stands this high in the frame
PUTTY_DOWN = 0.42           # the putty's edge below the rim top (it domes up in the middle)
# the frame (level 3 up): round goo rails on the stumps, a fat ball at each corner, a post up from each ball
FR_D = 2.5                  # the corners' distance from the axis
FR_ROT = -12.0              # the square turned this much (deg) from the ground grid (as Flash's frame)
RAIL_Z, RAIL_R = 1.56, 0.32  # the rails' middle height and radius
CORNER_R = 0.5             # the goo balls at the corners
STUMP_H, STUMP_R = 1.3, 0.56
POST_R = 0.38
KNOB_R = 0.44               # the post's goo knob, just above the rim
# the press block on the rim (every level) and the arches (level 3 up)
BLOCK = (0.0, -1.58)        # the block's middle (X, Y) on the rim
BLOCK_SIZE = (1.65, 1.0, 1.0)
ARCH_X = (-0.6, 0.6)        # the two arches' planes
ARCH_Y = (-1.52, 1.66)      # their feet (on the block, on the far rim)
ARCH_UP = 1.8              # their crown (centre line) above the rim top
ARCH_W, ARCH_T = 0.46, 0.56  # their cross-section (across, up)
# the hand wheel on the pot's side (every level), on a boss on the upper band
WHEEL_TH, WHEEL_D, WHEEL_R = -112.0, 2.24, 0.56
WHEEL_AX = -98.0            # the way its axle points (it faces the viewer a little more than straight out)
# the test tube: one spot on the ground plan at every level
TUBE_XY = (3.72, 1.08)      # clear of the right post as the camera sees it
TUBE_TOP = (2.6, 4.2)       # the tube's top at level 1 and level 3 (it stands on the ground in a gold foot)
TUBE_R = 0.32
# level 6: the drum hub on the arches' crown, the flask on its top, the valve wheel on a shaft out to the front left and
# the arm out to the right that holds the test tube up
HUB_R, HUB_L = 0.74, 0.98   # the drum's radius and half length (along X, across both arches)
HUB_UP = 0.86               # its axis above the arches' crown line (its belly rests in the arches' tops)
VALVE_Y, VALVE_R, VALVE_UP = -2.45, 0.56, 0.42
TUBE_TOP6 = 6.9             # the tube's top from level 6 (it hangs from the arm)
TUBE_LEN6 = 3.7
TUBE_XY6 = (4.2, 0.6)       # where it hangs from level 6: a little further forward than on the ground, so the arm
                            # drops steeply enough to pass under the level 10 cage on screen (and not along the arch)
# level 10: the cage wheel on a cranked axle out of the hub's back (+Y)
CAGE_Y, CAGE_W, CAGE_R = 2.55, 1.15, 1.34
CAGE_UP = 0.32               # the cranked axle lifts the cage this much above the hub's axis (clear of the arm)
CAGE_RUNGS = 8
CAGE_TURN = 2 * 360.0 / CAGE_RUNGS    # a loop turns the cage two rungs (Flash: about 4 deg a frame)
STIR_TURN = 3 * 360.0                 # a loop turns the stirrer three times (Flash: once every 8.7 frames)
PUTTY_TURN = 360.0                    # and the putty once


def z_pot(lv):
    return LIFT if lv >= 3 else 0.0


def z_rim(lv):
    return z_pot(lv) + POT_H


def post_top(lv):
    return z_rim(lv) - 0.12


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
           "band": polar(WHEEL_TH, POT_RMAX, z_pot(lv) + BANDS[1])}
    if lv >= 3:
        out["crown"] = (0.0, 0.0, z_crown(lv))
    if lv >= 6:
        out["hub"] = (0.0, 0.0, z_hub(lv))
    return out
