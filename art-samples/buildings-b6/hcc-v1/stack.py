"""stack.py : the Hatchery Control Center's one body and its mounting points, shared by hcc.py (Blender) and post.py.

Flash has one look for every level of the HCC (buildingArtData.ts row 16: one art level, no animation strip), so there
is one model. The body: a squat drum (dark purple band with eight silver portholes, a pink top, silver rims) on a gold
bowl, standing on four gold legs (a strut out of the bowl to a ball knuckle, a teardrop foot hanging to the ground; the
two back legs hide behind the drum). On the top: a chrome pedestal at the back, a gold post, a chrome yoke with a
crosswise axle, and the steel dish with a gold rim, clamps, rivets, a gold hub and a chrome feed rod, tipped up toward
the viewer. Every part is placed from these points.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
Bearings: 0 = world +X (front right on screen), -90 = world -Y (front left), -45 = straight at the viewer.
"""
import math

ORIGIN = (0.0, 60.0)        # Flash pixel of the world origin (the drum's axis on the ground)
GROUND = 0.0
FRONT = -45.0               # the bearing that faces the viewer

# the drum
DRUM_R = 3.75
DRUM_Z0, DRUM_Z1 = 3.79, 6.15     # the band's bottom and the top's edge
TOP_DOME = 0.06                  # the pink top rises this much to the middle
PORT_N, PORT_R, PORT_W = 8, 0.43, 0.13    # portholes: how many, ring radius, ring thickness
PORT_Z = 4.97
NUB_TH = (-135.0, 45.0, 135.0)   # small gold knobs on the top rim (screen left, right, back)
TICK_TH = (-63.0, -57.0, -51.0, -45.0, -39.0, -33.0)  # the faint gold scale marks low on the band's front

# the gold bowl under the drum
BOWL_R, BOWL_DEPTH = 3.5, 3.07  # its radius at the drum's bottom and how far down it reaches

# the legs
LEG_TH = (FRONT - 53.0, FRONT + 53.0, FRONT + 180.0)   # three legs; Flash shows the front two
LEG_D = 4.45                     # the foot's axis from the drum's axis
KNUCKLE_Z, KNUCKLE_R = 3.46, 0.37
FOOT_R, FOOT_TOP = 0.41, 2.97    # the teardrop's fattest radius, where its neck meets the knuckle's collar

# the top: pedestal, post, yoke, dish
PED_X, PED_Y = -0.4, 0.4         # the pedestal's middle (a little to the back)
PED_R, PED_H = 1.6, 0.55
POST_R, POST_H = 0.27, 0.6
AXLE_R, AXLE_L = 0.48, 1.45      # the yoke's crosswise axle (along world Y)
DISH_R, DISH_DEPTH = 3.08, 1.2
DISH_C = (11.0, -31.5)           # Flash pixel of the rim's middle
DISH_BACK = -1.9                 # the rim's middle this far behind the axle along the camera's view (in front: the dish sits on its arm)
DISH_OFF, DISH_SCR = 46.0, (4.85, -8.75)   # the face turned away from the viewer by DISH_OFF degrees, toward this
                                         # screen direction (Flash px: right, down)
DISH_CLAMPS = ((-9, -55), (32, -45), (-9, -16), (31, -9))   # Flash pixels of the four gold clamps on the rim
DISH_HUB = (5, -24)              # Flash pixel of the gold hub on the face
DISH_ROD = (24, -50)             # where the chrome feed rod meets the rim
DISH_STAYS = ((-14, -40), (28, -14))   # where the two thin stays from the rod's middle meet the rim


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (for the dashed lines in post.py)."""
    return {"drum": (0.0, 0.0, DRUM_Z1),
            "pedestal": (PED_X, PED_Y, DRUM_Z1 + PED_H),
            "legL": polar(-90.0, LEG_D, KNUCKLE_Z),
            "legR": polar(0.0, LEG_D, KNUCKLE_Z)}
