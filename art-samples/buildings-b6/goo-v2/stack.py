"""stack.py : the Goo Factory v2's one body and its mounting points, shared by goo2.py (Blender) and post.py.

The body is Flash's copper vat with the funnel on its neck and the pump pipe out of its right side down into the ground.
Level 1 stands the vat on short dark stumps, goo slopping over its rim. Level 3 keeps the vat, stumps and pipe and
builds the six-post pencil frame round it (two wooden rings, a peach side plate), with the goo heaped up into a strapped
dome and four grey vanes on the neck. Level 6 adds clamps and iron feet on the posts, the second pump pipe out of the
front left, the tall return loop at the back right and the side loop at the left. Level 10 adds the tower at the left
with its goo cap and its arc to the ground, two more stepped loops at the back right, the right side loop and the
ground pipe. Every part is placed from these points: nothing is placed per level on screen.
"""
import math

ORIGIN = (-2.5, 41.0)       # Flash pixel of the world origin (the vat's axis on the ground)
GROUND = 0.0
# the vat: an upright copper tub on the axis
VAT_R = 1.7
VAT_Z0, VAT_Z1 = 2.35, 5.55  # its foot and its rim top
TABLE_R, TABLE_T = 1.98, 0.28   # the round wooden table it stands on
STUMP_D, STUMP_R = 1.5, 0.5   # every level: four stumps under the table (bearings -45, 45, 135, -135)
# the neck and the funnel on top
NECK_R = 0.34
COLLAR_Z, COLLAR_R = 6.75, 0.54
FUNNEL_Z0, FUNNEL_TOP, FUNNEL_R = 7.12, 8.08, 1.02
# the goo: at level 1 a low heap in the rim; from level 3 a dome up to the collar
GOO1_TOP = 5.95
DOME_R, DOME_TOP = 2.12, 6.55
# the pencil frame (level 3 up): six posts round the vat, two rings of planks
POST_R, POST_RAD = 2.4, 0.14   # thin pencils, as Flash's
POST_BEARINGS = tuple(-33.0 + 60.0 * k for k in range(6))
POST_TOP = 5.0              # the top of the yellow (the ferrule and the eraser above it)
RING_LO, RING_HI = (1.65, 2.07), (4.34, 4.78)   # the lower ring holds the table
RING_IN = 0.12              # the planks sit this far inside the posts' circle (the posts stand in front)
# the pump pipes: out of the vat at (bearing, height), down to the ground at distance d. The right one is there at every
# level, the front-left one from level 6.
PIPE_R = 0.43
PUMPS = {"pumpR": (-8.0, 3.4, 2.92), "pumpL": (-59.0, 3.0, 3.3)}
# level 6 up: the loops (bearing of the outer leg)
LOOP_R = 0.24


def pumps(level):
    return [k for k in PUMPS if k == "pumpR" or level >= 6]


def polar(bearing, d, z):
    a = math.radians(bearing)
    return (d * math.cos(a), d * math.sin(a), z)


def mounts(level):
    """The points every level shares (red crosses on the sheet): world (x, y, z)."""
    out = {"funnel": (0.0, 0.0, FUNNEL_TOP), "collar": (0.0, 0.0, COLLAR_Z),
           "rim": polar(-45.0, VAT_R, VAT_Z1), "pipe": polar(PUMPS["pumpR"][0], PUMPS["pumpR"][2], 0.0)}
    if level >= 3:
        out["ring"] = polar(POST_BEARINGS[0], POST_R, RING_HI[1])
    return out
