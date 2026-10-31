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
SCOPE_EYE = (-1.0, -34.6, 0.0)      # the eyepiece end: Flash px x, y and its world y
SCOPE_DIR = (0.066, -0.914, 0.52)  # toward the mouth (Flash's mouth: a 0.75 ellipse, level with the eyepiece)
SCOPE_LEN = 3.1
SCOPE_PLATE = (-8.0, -23.5)         # the bracket's plate on the front roof slope (Flash px)
SCOPE_ARM = -10.0                   # the arm meets the tube at this Flash x

# the scissors (Flash px; their plane runs through the pivot and the two blade tips)
SCIS_PIVOT = (-32.0, 19.0, -3.36)   # Flash x, y and world y
SCIS_TIPS = ((-34.0, 58.5), (-24.6, 63.5))
SCIS_TEAR = ((-31.5, 13), (-34.5, 9.5), (-38.5, 5), (-42.5, 0), (-45.6, -5), (-47.6, -10), (-48.3, -15), (-47.4, -19.5),
             (-45, -21.8), (-42.4, -21.2), (-40.6, -17.5), (-38.8, -12), (-37, -6), (-35.2, 0), (-33.6, 5.5), (-32.4, 10))
SCIS_D = ((-24, 10), (-22.6, 5), (-21.3, 0.5), (-20, -4.5), (-18.8, -8.6), (-16.8, -9.4), (-12.6, -7), (-10, -2), (-10, 3), (-12, 7.5), (-15, 10),
          (-19.5, 10.5))

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
