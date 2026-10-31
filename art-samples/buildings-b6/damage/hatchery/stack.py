"""stack.py : the Hatchery's one body and its mounting points, shared by hatch.py (Blender) and post.py.

The body is the same at every level: a gold base (a darker foot ring under a wider drum-shaped body with the pressure
gauge on its front and the gold U-pipe on its right), the wide purple incubator drum on top (ribbed sides, pink top,
silver rims), the grey feed sleeve standing in the drum's top and the funnel on its post at the drum's back left.
Level 1 stands the base on the ground and puts a spinning lid with a crank on a spindle out of the sleeve. Level 2
lifts the whole body (and every part on it) on three gold legs with cross feet, makes the funnel steel, and replaces the
lid with an egg-beater drive (a frame with a triangle handle, a crown wheel and crank, a pinion on the spindle). Level 3
lifts it again on the red mixer stand (a plinth under the base, a column at the back right and the head over the drum),
with the crank wheel on the head, the bowl-lift arm round the drum and a cone hood with beaters in the drum top in place
of the sleeve. Every part is placed from these points: nothing is placed per level on screen.

World units: 10 Flash px across, 8.66 Flash px up (the putty/pebble/twig camera: orthographic, 30 degrees up).
"""
import math

ORIGIN = (-0.5, 52.3)       # Flash pixel of the world origin (the base's axis on the ground, level 1)
GROUND = 0.0
FRAMES = 31                 # Flash's loop at every level

# the base (gold): a foot ring, then the wider body
FOOT_R, FOOT_H = 2.36, 1.5
BODY_R, BODY_Z1 = 2.86, 4.75     # the body from the foot's top up to the drum's bottom
GAUGE_TH, GAUGE_Z, GAUGE_R = -45.0, 3.2, 1.06   # the gauge on the body's front (bearing, height, dial radius)
# the drum
DRUM_R, DRUM_Z0, DRUM_Z1 = 3.7, 4.75, 7.37
# the gold U-pipe on the drum's right: out of the drum's side, down outside the base, into the body
PIPE_TH, PIPE_R = 2.0, 0.5
PIPE_ZTOP, PIPE_ZBOT = 6.0, 2.5
PIPE_OUT = 4.2                   # the pipe's down run, from the axis
# the sleeve in the drum's top (levels 1 and 2)
SLEEVE_R, SLEEVE_H = 1.45, 1.85
# the funnel on its post at the drum's back left
FUN_TH, FUN_D = 225.0, 3.25
FUN_Z0, FUN_Z1, FUN_R = 8.9, 11.0, 1.6    # the cone from its neck (on the post) to its rim, the rim's radius

# level 1: the lid on a spindle out of the sleeve, the crank arm on it
LID_Z, LID_R, LID_T = 11.25, 2.15, 0.55
CRANK1_R = 4.1                   # the handle's distance from the axis
HANDLE_L, HANDLE_R = 2.9, 0.42   # the wooden handle (length, thickest radius)
HANDLE1_SIZE = 1.15              # Flash draws the level 1 handle bigger
CRANK1_START = 262.0             # bearing of the arm at frame 0 (Flash: the handle at the left)

# level 2: three legs with cross feet
LIFT2 = 1.15
LEG_TH = (-42.0, 41.0, 226.0)   # front, right, left (as Flash draws them: not evenly spaced)
LEG_Z = 2.4                      # where a leg leaves the body (above the base's foot, level 1 height)
FOOT_D = (4.2, 4.05, 3.8)        # each foot's middle from the axis, on the ground
CROSS_L, CROSS_W = 1.3, 0.17     # a foot's arms (half length, bar radius), along world X and Y; ball ends

# level 2: the egg-beater drive on the sleeve
PINION_Z, PINION_R = 1.3, 1.15  # above the sleeve's top (Flash's dark gear sits clear above the rim)
WHEEL2_U, WHEEL2_Z, WHEEL2_R = 1.85, 4.3, 2.45   # the crown wheel: out along bearing 45 from the axis, height above
                                                 # the sleeve's top, radius
WHEEL2_TH = 60.0                 # the axle's bearing
CRANK2_R = 3.85
TRI = ((-2.6, 4.45), (0.4, 4.45), (-0.35, 9.4))  # the triangle handle's corners (u along bearing 45, z above the sleeve)

# level 3: the red mixer stand
LIFT3 = 0.78                     # on top of LIFT2
PLINTH_R = 2.58
COLUMN = (0.8, 4.9)            # the column's middle (X, Y)
COLUMN_R = 0.52
HEAD_X, HEAD_Y = (-1.14, 3.36), (-3.6, 3.7)
HEAD_Z0, HEAD_Z1 = 13.15, 17.7  # absolute (level 3)
WHEEL3 = (3.75, 1.35, 14.25)     # the crank wheel's middle (on the head's +X face)
WHEEL3_TH, WHEEL3_TILT = 0.0, 0.0   # the axle's bearing (about +X) and its tilt up
WHEEL3_R = 2.3
CRANK3_R = 4.0
CONE_RISE, CONE_HOLE = 0.85, 1.3    # the hood's rise above the drum top, the hole's radius
ARM3_Z = 8.6                     # the bowl-lift arm's height (absolute, level 3)


def lift(lv):
    return (LIFT2 if lv >= 2 else 0.0) + (LIFT3 if lv >= 3 else 0.0)


def z_drum_top(lv):
    return lift(lv) + DRUM_Z1


def z_sleeve_top(lv):
    return z_drum_top(lv) + SLEEVE_H


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts(lv):
    """World points of the shared parts at a level (for the dashed lines in post.py)."""
    z = lift(lv)
    return {"gauge": polar(GAUGE_TH, BODY_R, z + GAUGE_Z),
            "drum": (0.0, 0.0, z + DRUM_Z1),
            "pipe": polar(PIPE_TH, PIPE_OUT, z + PIPE_ZTOP),
            "funnel": polar(FUN_TH, FUN_D, z + FUN_Z1)}
