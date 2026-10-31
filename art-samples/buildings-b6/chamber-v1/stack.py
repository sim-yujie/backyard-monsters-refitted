"""stack.py : the Champion Chamber's one body and its mounting points, shared by chamber.py (Blender) and post.py.

Flash has one look for every level of the Champion Chamber (buildingArtData.ts row 119: one art level, no animation
strip), so there is one model. The body: a big icy blue-grey box (a freezer), its four top edges and its front corner
framed by thick rounded brown-grey bars. In its -Y face (the viewer's left) a wide doorway under a frosted lintel
hung with icicles, a dark grate inside, the door leaf standing open; two dark granite footing blocks stand in front of
that face, one at each end. On its top: an octagonal glass hatch, and above it a thick icy lid with a glowing cyan
grille, held up by two heavy curved arms that reach down onto the front bars. On its +X face (the viewer's right): a
lower compressor block (three white curved fins on top, a brass zig-zag coil on its face) and, in front of it beside
the corner post, two frosted squat tanks stacked on a dark plinth, a thin pipe curling down to them from the top.
Three brass horn pipes with flared mouths rise from the top's left, back and right corners.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
+X faces the viewer's right, -Y the viewer's left. The model is sheared (SHEAR) and may turn by YAW about Z.
"""
import math

ORIGIN = (6.3, 48.7)        # Flash pixel of the world origin (the box's middle on the ground)
GROUND = 0.0
YAW = 0.0
# Flash draws the box's X-running edges (the -Y face's) flatter than the camera's 2:1 and its Y-running edges true (its
# art was a perspective render): the whole model is sheared, y moving by SHEAR per unit of x behind the front corner
# (x = AX stays put). Round parts (horns, tanks, icicles) only move with it, so they stay round.
SHEAR = 0.15

# the box
AX, AY = 3.2, 3.95          # half its length (X) and depth (Y)
H = 6.45                    # its top
BAR = 0.8                   # the frame bars' side
BAR_R = 0.3                 # their rounded edges

# the doorway in the -Y face (X range, Z range), its lintel and jambs
DOOR = (-2.1, 1.45, 0.45, 4.9)
JAMB = 0.42                 # the jambs' width; they and the lintel stand JAMB_OUT out of the face
JAMB_OUT = 0.5
LINTEL_H = 0.95

# the footings: middle X, Y, side X, side Y, height (one at the left corner, one in front of the -Y face's right end)
FOOTS = ((2.74, -4.78, 1.5, 1.77, 0.89), (-3.5, -4.06, 1.4, 1.5, 1.22))

# the top: the glass hatch (centre X, Y; half-width across the view, half-length along it; tilt toward the viewer)
HATCH = (0.27, -0.37, 1.77, 1.9, 8.0)
# the lid: centre X, Y, half side, bottom, thickness
LID = (0.3, 0.075, 2.9, 8.42, 0.55)
LID_CUT = ((-2.26, -2.83), (3.2, 0.13))   # where the cut across its front corner meets the two front edges
CORE = (-2.3, 0.4, 2.6, 2.75)       # the dark block under the lid's back: X from, Y from, X to, Y to
GRILLE = (-0.5, 0.65, 1.35, 1.05)    # centre X, Y; half-length along X; half-length along Y
# the arms holding the lid: Flash pixels and heights along each, from under the lid down onto the bars
ARM_L = ((-12, -27, 9.05), (-21, -23, 8.9), (-26, -12, 7.9), (-24, 4, 6.45))
ARM_R = ((15, -24, 9.05), (25, -20, 8.9), (29, -8, 7.8), (26.5, 6, 6.4))
ARM_W, ARM_T = 1.3, 1.0

# the compressor block on the +X face: X out to, Y from, Y to, height
COMP = (5.12, -1.0, 3.44, 3.58)
COIL = (-0.6, 3.0, 0.45, 3.05, 6)     # Y from, Y to, Z from, Z to, loops
FINS_Y = (0.2, 1.05, 1.9)
# the tanks: centre X, Y, radius, and the Z range of each drum
TANK = (4.3, -2.1, 1.05, ((0.45, 1.75), (1.95, 3.3)))

# the horns: X, Y, base Z, mouth-middle Z, mouth radius
HORNS = ((-3.45, -4.0, H + 0.3, 8.75, 0.68), (-0.86, AY, H + 0.3, 10.49, 0.66), (3.5, 4.15, 5.3, 7.94, 0.68))
HORN_R = 0.33


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (for the dashed lines in post.py)."""
    return {"body": (0.0, 0.0, H), "lid": (LID[0], LID[1], LID[3]), "comp": (AX, (COMP[1] + COMP[2]) / 2, COMP[3])}
