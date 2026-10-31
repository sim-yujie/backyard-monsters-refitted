"""stack.py : the Wild Monster Baiter's one body and its mounting points, shared by baiter.py (Blender), label.py and
post.py.

Flash has one look for every level of the Baiter (buildingArtData.ts row 19: one art level) with a 41-frame strip drawn
over it, so there is one model. The body: a big spray can (the "MONSTER SPRAY" label, a steel-blue domed top with a
rolled rim round the valve) standing between two dark boulders. On the can's shoulder a toothed crown ring turns; on
its flange stand two plates with a leaning wire bail between them, and the nozzle cap in the middle turns with them,
spraying purple mist. A small brown cog on a stub axle out of the can's front-right meshes with the crown's teeth; a
pink tag hangs from the axle.

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
Bearings: 0 = world +X (front right on screen), -90 = world -Y (front left), -45 = straight at the viewer.
"""
import math

ORIGIN = (0.0, 46.0)        # Flash pixel of the world origin (the can's axis on the ground)
GROUND = 0.0
FRONT = -45.0               # the bearing that faces the viewer

# the can
CAN_R = 2.42
CAN_Z1 = 4.3                # the shoulder: where the label ends and the domed top starts
TOP_Z, TOP_R = 5.32, 1.06   # the rolled rim round the valve (its middle) and its radius
RIM_W = 0.13                # that rim's tube radius

# the crown ring on the shoulder (turns)
CROWN_R = 2.70
CROWN_Z1 = 4.5              # its top edge, just under the dome's lip (its flange rests on the can's top seam)
CROWN_H = 0.36              # the band's height
TOOTH_H, TEETH = 0.5, 24
FLANGE_R = 2.44             # the flange's inner edge
LIP_R, LIP_Z = 2.68, 4.53   # the dome's lip, over the crown
SEAM_Z = 4.36               # the rolled seam on the can's top edge (the crown's flange rides on it)

# the bail: two plates bolted to the crown's outside, standing up past the dome's lip, a leaning wire half-hoop
# between their pivots
PLATE_W, PLATE_Z0, PLATE_Z1 = 0.66, 4.18, 5.26
PLATE_R = CROWN_R + 0.06    # the plate's middle plane
PIVOT_Z = 4.98
BAIL_LEAN = 42.0            # degrees from upright, toward the rig's local -X

# the nozzle cap (turns)
CAP_R, CAP_Z0, CAP_Z1 = 0.68, 5.22, 6.85

# the cog on the front-right, its axle radial
COG_TH = 0.0
COG_D = 2.66                # its middle plane's distance from the can's axis
COG_R, COG_Z = 1.38, 2.46
COG_TEETH = 12

# the boulders either side
ROCKS = ((-136.0, 3.0, 0.75, 1.35, 1.16), (54.0, 3.0, 0.72, 1.3, 1.14))   # bearing, distance, radial r, tangent r, height r

FRAMES = 41
TURNS = 1.0                 # the rig goes round once a loop, clockwise from above (bearing falling)


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts():
    """World points of the main parts (for the dashed lines in post.py)."""
    return {"crown": (0.0, 0.0, CROWN_Z1), "cap": (0.0, 0.0, CAP_Z1), "cog": polar(COG_TH, COG_D, COG_Z)}
