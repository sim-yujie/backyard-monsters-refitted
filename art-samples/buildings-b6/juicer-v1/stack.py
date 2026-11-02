"""stack.py : the Monster Juicer's one body, its crusher and the animation timing, shared by juicer.py (Blender) and
post.py.

Flash has one look for every level of the Juicer (buildingArtData.ts row 9: one art level, levels 1-3), so there is
one model. The body: a pale stone tower with a square pit in its top, and a stepped wing (a staircase of four steps)
against each of its four faces, as wide as the tower, so the plan is a cross and the tower's front corner runs down
between the two front wings as an inside corner. On the top: the crusher, two copper rollers with square steel studs
and white, purple-rimmed end wheels, side by side along world X over the pit, held at their +X ends by a gold T
bracket whose post runs down into the pit (a piston).

The animation (51 Flash frames, the strip drawn over the top): the rollers turn; frames 15-19 the crusher sinks into
the pit, a burst of red juice leaps out and falls back (17-31), red drops lie on the rim, the empty pit shows, the
crusher rises again (36-39) and turns on while the drops fade.

World units: 10 Flash px across, 8.66 Flash px up (the shared camera: orthographic, 30 degrees up).
Bearings: 0 = world +X (front right on screen), -90 = world -Y (front left), -45 = straight at the viewer.
"""
import math

ORIGIN = (0.0, 40.8)        # Flash pixel of the world origin (the tower's axis on the ground)
GROUND = 0.0

# the tower and its wings
TOWER_A = 2.0               # half its width
TOWER_H = 3.9               # its top (the rim)
STEP_N = 4                  # steps in each wing below the rim
STEP_D = 0.53               # each step's tread depth
STEP_DZ = 0.78              # each step's rise
PIT_B = 1.46                # the pit's half width at the rim
PIT_FLOOR = -1.3            # (below the ground: straight walls, deep enough to hide the crusher)

# the crusher (its rest pose)
AXLE_Z = 4.85               # the rollers' axles
ROLL_Y = 0.725              # each roller's axle this far either side of X = 0
ROLL_R = 0.6               # the copper drum's radius
ROLL_X = 0.98               # the drum runs X -ROLL_X..ROLL_X
FLANGE_R = 0.71            # the end wheels
FLANGE_T = 0.2
BRACKET_X = 1.33            # the gold bracket's plane
STUD_ROWS, STUD_AROUND = 3, 7

# the animation
FRAMES = 51
SPIN = 360.0                # each roller turns this far over the loop (one turn: loops whatever the studs)
SUNK = -4.6


def drop(f):
    """How far the crusher has sunk at Flash frame f (0 at rest)."""
    table = {15: -0.3, 16: -0.75, 17: -1.15, 18: -1.6, 19: -2.6, 20: -3.8, 36: -2.0, 37: -1.3, 38: -0.7, 39: -0.25}
    if f in table:
        return table[f]
    return SUNK if 20 <= f <= 35 else 0.0


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)
