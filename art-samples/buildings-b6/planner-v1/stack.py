"""stack.py : the Yard Planner's one body and its mounting points, shared by planner.py (Blender) and post.py.

Flash has one look for every level of the Yard Planner (buildingArtData.ts row 10: one art level, no animation strip),
so there is one model. The body: a round tower of grey field stones with a dark wooden door on its left and a pale
stone step in front of it. On the tower a round wooden deck that overhangs it, and joined to it on the right a square
deck on a tall brick block (a pale-capped parapet on the block's two front edges, a round window with a yellow light
in its +X face). A railing of steel posts and wires runs round the decks' open edges. On the round deck a brick
drum with yellow-lit windows, under a big black glossy lamp shade (tilted, its mouth toward the viewer's left), and
from the shade's top a black desk-lamp arm (two pairs of parallel rods and a blue-grey spring) runs back and down to
a foot on the square deck: the whole building is a drafting lamp.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
+X faces the viewer's right, -Y the viewer's left. The whole building is turned YAW degrees about Z.
"""
import math

ORIGIN = (-15.5, 57.3)      # Flash pixel of the world origin (the stone tower's middle on the ground)
GROUND = 0.0
YAW = 0.0

# the stone tower
BASE_C = (0.1, 0.35)        # its middle
BASE_R = 3.1
BASE_H = 3.5                # its top (under the deck)
DOOR_T = -92.0              # the door's bearing (degrees, 0 = +X), its half width (degrees) and its bottom, top
DOOR_HW = 12.0
DOOR_Z = (0.45, 2.75)
STEP = (-92.0, 0.45)        # the step's bearing and its height

# the decks
DECK_R = 3.25               # the round deck's radius
DECK_Z0, DECK_Z1 = 3.5, 4.15
PLAT = (-2.4, 4.45, 0.4, 6.0)     # the square deck: x0, x1, y0, y1
# the brick block under the square deck
BLOCK = (0.6, 4.45, 0.4, 4.6)     # x0, x1, y0, y1 (its +X and -Y faces show; the rest is inside the tower)
PARA_H = 1.05               # the parapets' height above the deck
PARA_T = 0.32               # their thickness
PARA_X = (3.0, 4.45)        # the -Y parapet's run along X
PARA_Y = (1.3, 3.8)         # the +X parapet's run along Y (a gap at the front corner)
WIN = (3.85, 1.4, 0.5)      # the +X face's round window: y, z, radius

# the brick drum on the round deck and its windows
DRUM_C = (0.75, 0.05)
DRUM_R = 2.2
DRUM_H = 1.65
WIN_T = (-135.0, -79.0, -40.0, -4.5, 32.0)            # window bearings
WIN_HW = 7.0                                           # half width (degrees)
WIN_Z = ((0.2, 0.75), (0.95, 1.55))                     # the lower and upper panes, above the deck

# the lamp shade: its rim (Flash px of its middle, radius), the rim's tilt (degrees) and the bearing the tilt leans
# toward, the neck (Flash px x, its bottom and top y, radius) and how the cone flares out toward the rim
SHADE_RIM = (-11.0, 13.0, 2.45)
SHADE_TILT = (15.0, 90.0)
SHADE_NECK = (-6.0, -8.0, -21.0, 0.85)
SHADE_FLARE = 0.85

# the arm: Flash px of its joints, all in one upright plane: the head bracket (H0 low on the neck's right, H1 above
# it), the elbow (E1 the top rod's end, E0 the lower rod's) and the feet of the lower rods on the square deck
ARM_FOOT = (43.0, 11.0)
ARM = {"H0": (6.0, -15.0), "H1": (15.0, -28.0), "E1": (58.0, -10.5), "E0": (48.0, -4.0), "F1": (46.0, 9.0),
       "F0": (40.0, 10.0)}
SPRING = ((27.0, -10.5), (56.0, -10.5))

RAIL_H = 0.95               # the railing's posts above the deck


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (before the yaw), for the dashed lines in post.py."""
    return {"deck": (0.0, -DECK_R, DECK_Z1), "block": (BLOCK[1], BLOCK[2], DECK_Z1)}
