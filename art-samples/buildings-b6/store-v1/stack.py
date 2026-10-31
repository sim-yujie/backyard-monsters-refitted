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
DIE_R = 0.28                # the rounded edges
PIP_R, PIP_DEPTH = 0.47, 0.2
PIP_Y = (-1.12, 1.12)       # the two columns on the right face
PIP_DZ = 1.16               # the three rows: middle, and this much above and below

# the matchbook on the left face
MB_X0, MB_X1 = -3.0, 1.88   # the printed cover (the striker strip runs from MB_X1 round the front corner)
MB_Z0, MB_Z1 = 0.33, 5.72
MB_RISE = 0.27             # its bottom edge rises this much toward the front
MB_GAP = 0.05               # off the die's face (glue)
MB_FLARE = 0.15            # how far its bottom edge hangs away from the die

# the four thumbtacks: the disc's middle on the ground, and where the pin goes in
TACKS = (((1.9, -2.72), (1.9, -2.69, 0.66)),       # front: up into the cover's bottom edge (it flares out there)
         ((-2.25, -2.72), (-2.25, -2.69, 0.4)),  # left: the same
         ((2.12, 2.12), (2.12, 2.12, 1.25)),      # right: up under the die
         ((-2.12, 2.12), (-2.12, 2.12, 1.25)))    # back (hidden)
TACK_R, TACK_T = 0.72, 0.1

# the popsicle sticks on top
STICK_N, STICK_W, STICK_T = 4, 1.15, 0.17
STICK_Y0, STICK_Y1 = -3.85, 2.85

# the strap across the back of the sticks, and the paper behind it
STRAP_Y, STRAP_W, STRAP_T = 1.05, 1.05, 0.07
STRAP_X0 = -1.9            # where its left end starts to turn toward the viewer's left (drooping off the back edge)
STRAP_HOLES = (-1.7, -0.4, 0.85, 1.95)
PAPER_Y1 = 2.35            # the paper's back edge (its front edge runs under the strap)

ZTOP = DIE_Z0 + DIE_H       # the die's top
ZSTICK = ZTOP + STICK_T     # the sticks' top


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (for the dashed lines in post.py)."""
    return {"die": (DIE_A, 0.0, DIE_Z0), "strap": (DIE_A, STRAP_Y, ZSTICK)}
