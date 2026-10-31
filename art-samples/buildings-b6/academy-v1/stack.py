"""stack.py : the Monster Academy's body and its mounting points, shared by academy.py (Blender) and post.py.

Flash (buildingArtData.ts row 26) has four art levels, each with a 21-frame loop (the gold blocks turning in the dome's
top opening); game levels above 4 use level 4's art.
  Level 1: a steel-blue dome (a ball cut at its middle, an opening on top with the gold blocks inside) on a gold band
           and a black foot ring; one square porthole plate on its front left (gold frame on two edges, gold rivets).
  Level 2: level 1 plus the mirrored porthole plate on the front right and two steel fins with gold edges on the back
           shoulders.
  Level 3: Flash redraws the dome: the portholes and fins go, four steel ribs come up from the ground at the four
           sides, lie over the dome's shoulders in gold-edged channels and end near the opening; the dome stands on a
           short glowing glass ring over a smaller gold band and black foot. Flash draws this level smaller and 7 px
           lower (its anchor differs), so levels 3 and 4 have their own ORIGIN and dome size.
  Level 4: level 3 with the glass ring grown into a tall glass tank: the dome lifted by TANK_RISE and the ribs'
           uprights that much longer. Everything else sits where it is at level 3.

World units: 10 Flash px across, 8.66 Flash px up (the approved buildings' camera: orthographic, 30 degrees up).
Bearings: 0 = world +X (front right on screen), -90 = world -Y (front left), -45 = straight at the viewer.
"""
import math

FRONT = -45.0
GROUND = 0.0
FRAMES = 21                   # Flash's loop at every level


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


class Lv:
    """The numbers of one level."""

    def __init__(self, level):
        self.level = level
        self.ribbed = level >= 3
        if not self.ribbed:
            self.ORIGIN = (2.0, 44.5)        # Flash pixel of the world origin (the dome's axis on the ground)
            self.DOME_R = 4.15               # the ball
            self.DOME_C = 1.62               # its centre's height (its middle sits on the gold band)
            self.FOOT_R, self.FOOT_Z = 3.6, 1.62     # the black foot ring: radius, top
            self.BAND_R, self.BAND_Z0, self.BAND_Z1 = 4.32, 0.9, 1.6   # the gold band round the dome's middle
            self.TANK_Z0 = self.TANK_Z1 = None
        else:
            self.ORIGIN = (0.0, 51.5)
            self.DOME_R = 4.0
            rise = TANK_RISE if level >= 4 else 0.0
            self.TANK_Z0 = 1.33                       # the glass ring / tank: bottom (on the gold band)
            self.GLASS_Z1 = 2.17 + rise               # the glass's top; above it a dark collar up to the dome
            self.DOME_C = 3.3 + rise
            self.DOME_Z0 = 2.95 + rise                # the dome's lower edge (Flash: a straight wall below a seam)
            self.WALL_E = 33.0                        # the seam where the ball turns into the straight wall
            self.TANK_Z1 = self.DOME_Z0
            self.FOOT_R, self.FOOT_Z = 3.3, 0.22          # a low black base disc
            self.BAND_R, self.BAND_Z0, self.BAND_Z1 = 2.8, 0.2, 1.36   # a gold bowl: top radius, bottom, top
            self.BAND_R0 = 2.65                       # its bottom radius
            self.TANK_R = 2.85
        self.OPEN_R = 2.0                   # the opening in the dome's top
        self.OPEN_Z = self.DOME_C + math.sqrt(self.DOME_R ** 2 - self.OPEN_R ** 2)
        # porthole plates: (face bearing, face tilt up, outer side, Flash pixel of the middle)
        self.PORTS = []
        self.FINS = []
        if not self.ribbed:
            self.PORTS.append((-94.0, 28.0, "left", (-28.5, 32.0)))
            if level >= 2:
                self.PORTS.append((4.0, 28.0, "right", (32.5, 32.0)))
                self.FINS = [(-138.0, 48.0, (-36.0, -3.0)), (48.0, 48.0, (38.0, -4.0))]   # face bearing, tilt, Flash px
        self.RIBS = (-90.0, 0.0, 90.0, 180.0) if self.ribbed else ()


TANK_RISE = 2.2                 # level 4: how much the glass tank lifts the dome (Flash: 19 px)
PORT_HALF = (1.45, 1.3)               # the porthole plate's half size
PORT_HOLE = 0.8                # the dark hole's radius
RIB_W = 2.7                     # the ribs' width (across)
RIB_T = 0.85                    # the strap's thickness at its top end (on the dome)
RIB_TU = 0.7                    # ... and down the upright
RIB_OUT = 5.6                   # the uprights' outer faces from the axis
RIB_RC, RIB_B = 1.8, 3.5        # the outer line's quarter ellipse: its top's distance from the axis, its height
RIB_ZV = 2.8                    # level 3: where the outer line turns upright (+ TANK_RISE at level 4)
RIB_ENDS = {-90.0: 32.0, 0.0: 32.0, 90.0: 48.0, 180.0: 48.0}   # each rib's top end: elevation on the ball (Flash
                                # ends the front ribs lower, in a gold frame on the shoulder; the back ones reach higher)
PLINTH = (2.9, 1.1, 0.5)        # the rib's foot block: across, outward, high
PLINTH_D = 5.2
SLEEVE_Z = 1.75                # the top of the wider sleeve round the upright's foot (Flash: a step)
FIN = (0.8, 1.55, 0.4)            # the wing plate: half across, half up, thickness


def mounts(lv):
    """World points of the parts every level shares (for the dashed lines in post.py)."""
    v = Lv(lv)
    return {"opening": (0.0, 0.0, v.OPEN_Z), "foot": (0.0, 0.0, 0.0)}
