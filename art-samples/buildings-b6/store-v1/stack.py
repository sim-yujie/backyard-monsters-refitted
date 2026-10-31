"""stack.py : the General Store's one body and its mounting points, shared by store.py (Blender) and post.py.

Flash has one look for every level of the General Store (buildingArtData.ts row 12: one art level, no animation strip),
so there is one model. The body: a red die (six white pips on the right face) standing on four gold thumbtacks (a flat
disc on the ground, a pin up into the body). A red matchbook cover ("MATCH BOOK", a yellow flame and a match) is glued
to the die's left face; it is taller than the die and reaches almost to the ground, and its brown striker strip wraps
the front corner. On top: four popsicle sticks laid side by side (white, going pink toward the front), sticking out over
the left face; across their back a strap with four holes (tan, white, yellow) whose yellow end bends down over the right
face, with a wire ring hanging from it round the top-right pip; behind the strap a crumpled pink paper with a torn edge.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
+X faces the viewer's right (the die's pip face), -Y the viewer's left (the matchbook face).
"""
import math

ORIGIN = (3.0, 33.5)        # Flash pixel of the world origin (the die's middle on the ground)
GROUND = 0.0

# the die
DIE_A = 2.42                # half its width
DIE_Z0, DIE_H = 1.25, 4.55  # its bottom (on the tack pins) and height
DIE_R = 0.42                # the rounded edges (Flash's die is soft, well rounded)
PIP_R, PIP_DEPTH = 0.43, 0.16
PIP_Y = (-0.82, 1.1)        # the two columns on the right face (Flash's sit right of the middle, close together)
PIP_DZ = 1.16               # the three rows: middle, and this much above and below

# the matchbook on the left face
MB_X0, MB_X1 = -3.02, 1.6   # the printed cover (the dark fold runs from MB_X1 round the front corner)
MB_Z0, MB_Z1 = 0.33, 5.72
MB_RISE = 0.27             # its bottom edge rises this much toward the front
MB_GAP = 0.05               # off the die's face (glue)
MB_FLARE = 0.09            # how far its bottom edge hangs away from the die

# the four thumbtacks: the disc's middle on the ground, and where the pin goes in
# (front and left: the disc a little toward the viewer, so the pin up into the cover looks long, as Flash's)
TACKS = (((2.11, -2.93), (1.68, -2.51, 0.7)),     # front: up into the cover's bottom edge (it flares out there)
         ((-2.04, -2.93), (-2.42, -2.57, 0.4)),  # left: the same
         ((2.12, 2.12), (2.12, 2.12, 1.25)),      # right: up under the die
         ((-2.12, 2.12), (-2.12, 2.12, 1.25)))    # back (hidden)
TACK_R, TACK_T = 0.72, 0.1

# the popsicle sticks on top
STICK_N, STICK_W, STICK_T = 4, 1.25, 0.09
STICK_X0, STICK_X1 = -2.78, 2.42   # side by side across this span: over the left face they reach the cover's edge
STICK_Y0, STICK_Y1 = -4.0, 2.85

# the strap across the back of the sticks, and the paper behind it
STRAP_Y, STRAP_W, STRAP_T = 1.05, 1.2, 0.07
STRAP_X0 = -1.9            # where its left end starts to turn toward the viewer's left (drooping off the back edge)
STRAP_HOLES = (-1.7, -0.4, 0.85, 1.95)
STRAP_LIFT = 0.3           # its right part rides this much higher, over paper bunched under it (see store.lift)
PAPER_Y1 = 2.35            # the paper's back edge (its front edge runs under the strap)

# Flash draws the die a little turned down at the back right: its right face's edges climb less steeply than the
# camera's 2:1 (the pips' right column and the die's back corner sit lower). The die and everything on it lean this much
# down toward +Y (a shear: z drops by tan(TILT) per unit of y past the front-left edge, upright edges stay upright; the
# matchbook side stays put); the tacks stay on the ground.
TILT = 4.7
TILT_PIVOT = (-DIE_A, DIE_Z0)    # (y, z) of the axis

ZTOP = DIE_Z0 + DIE_H       # the die's top
ZSTICK = ZTOP + STICK_T     # the sticks' top


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (for the dashed lines in post.py)."""
    return {"die": (DIE_A, 0.0, DIE_Z0), "strap": (DIE_A, STRAP_Y, ZSTICK)}
