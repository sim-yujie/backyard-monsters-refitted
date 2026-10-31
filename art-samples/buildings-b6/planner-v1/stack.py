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
BASE_C = (0.2, 0.45)        # its middle
BASE_R = 3.1
BASE_H = 3.5                # its top (under the deck)
DOOR_T = -92.0              # the door's bearing (degrees, 0 = +X), its half width (degrees) and its bottom, top
DOOR_HW = 12.0
DOOR_Z = (0.45, 2.75)
STEP = (-92.0, 0.45)        # the step's bearing and its height

# the decks
DECK_R = 3.25               # the round deck's radius
DECK_Z0, DECK_Z1 = 3.5, 4.15
PLAT = (-2.4, 4.8, 0.6, 4.8)     # the square deck: x0, x1, y0, y1 (its back edge flush with the block, as Flash's)
LEDGE = 0.55               # past the +X parapet's back end the deck runs out this far over the block's face
# the brick block under the square deck
BLOCK = (0.8, 4.8, 0.6, 4.8)     # x0, x1, y0, y1 (its +X and -Y faces show; the rest is inside the tower)
PARA_H = 0.5               # the parapets' height above the deck
PARA_T = 0.32               # their thickness
PARA_X = (3.3, 4.8)        # the -Y parapet's run along X
PARA_Y = (1.5, 4.0)         # the +X parapet's run along Y (a gap at the front corner)
WIN = (3.3, 2.0, 0.5)       # the +X face's round window: y, z, radius

# the brick drum on the round deck and its windows
DRUM_C = (0.75, 0.05)
DRUM_R = 2.2
DRUM_H = 2.15
WIN_T = (-118.0, -78.0, -42.0, -4.0, 34.0)            # window bearings
WIN_HW = 6.5                                           # half width (degrees)
WIN_Z = ((0.2, 0.8), (1.12, 1.72))                     # the lower and upper panes, above the deck

# the lamp shade: its rim (Flash px of its middle, radius), the rim's tilt (how steeply its edge-on line falls to the
# right on screen, and how far it turns past edge-on to show the shade's outside, degrees), the neck (Flash px x, its bottom and top y, radius) and how the cone flares out toward the rim
SHADE_RIM = (-10.5, 12.5, 2.6)
SHADE_TILT = (20.0, 9.0)
SHADE_NECK = (-3.0, -12.0, -22.0, 1.0)
SHADE_FLARE = 1.0
SHADE_STREAK = 0.92        # the highlight streak's place round the shade (0 = facing the camera, 0.25 = right)

# the arm: Flash px of its joints, all in one upright plane: the head bracket (H0 low on the neck's right, H1 above
# it), the elbow (E1 the top rod's end, E0 the lower rod's) and the feet of the lower rods on the square deck
ARM_FOOT = (43.0, 21.5)
ARM = {"H0": (6.0, -15.0), "H1": (15.0, -28.0), "E1": (58.0, -10.5), "E0": (48.0, -4.0), "F1": (46.0, 19.5),
       "F0": (40.0, 20.5)}
SPRING = ((27.0, -10.5), (56.0, -10.5))

RAIL_H = 0.95               # the railing's posts above the deck


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (before the yaw), for the dashed lines in post.py."""
    return {"deck": (0.0, -DECK_R, DECK_Z1), "block": (BLOCK[1], BLOCK[2], DECK_Z1)}
