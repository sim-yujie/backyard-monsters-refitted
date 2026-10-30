"""stack.py : the Pebble Shiner's one body, as a stack of courses, shared by pebble2.py (Blender) and post.py.

From the ground up: six stone piers (the legs) | a fixed base course | the turning ring | (L6+) a second turning ring
| (L3+) the head with the spout | a fixed collar | the roof | (L10) the spiked drum on the peak.
A level is the level below plus courses: an added course lifts everything above it, and every part stays fixed to
the course it is mounted on (the pipe and the ball's post on the collar, the spout and slot on the head, the drum on
the roof's peak). Nothing is placed per level on screen.
"""
import math

ORIGIN = (-1.5, 36.0)       # Flash pixel of the world origin (the building's middle on the ground)
GROUND = 0.0
R_RING = 2.8                # the turning rings' big blocks, outer face
R_HEAD = 2.28               # the head's widest
R_COLLAR = 2.2 
Z_PIER = 1.62               # the piers' top
Z_BASE = 1.86               # the base course's top: the first ring's floor
RING_H = 0.9
HEAD_H = 1.45
COLLAR_H = 0.35
ROOF_R = 2.3                # the roof's eave
ROOF_H = 2.45
ROOF_R1, ROOF_H1 = 2.15, 2.15 # level 1's smaller roof (Flash's): level 3 puts the big one on
ROOF_P, ROOF_P1 = 1.4, 1.4     # the roof's curve: radius = eave * (1 - s)^P at height s (P > 1: a steep top flaring
                               # out to the eave, as Flash's roofs)
ROOF_SHIFT = (0.0, 0.0)     # the roof (its peak and the L10 drum) sits on the tower's axis (owner: centred)
N_RING = 14                 # blocks per ring: big and small in turn (the pattern repeats every 2 blocks)
RING_TURN = 3 * 2 * 360 / N_RING      # one loop turns a ring 3 patterns (154.3 deg): Flash's ~72 px at the front
PIPE_TH, PIPE_R = 170.0, 2.75         # the pipe: bearing and distance from the middle (outside the eave; at
                                      # 170 the L1 eave hides the socket's foot)
PIPE_DOWN = 0.6                       # the pipe's foot below the arm (behind the eave)
PIPE_UP = 1.1                         # the pipe's top above the eave (the horn sits on it)
SPOUT_TH = -98.0                      # the spout on the head (bearing)
SPOUT_UP = 0.8                        # the spout's middle above the head's floor
SLOT_TH = 29.0
PEAK_CUT = 0.64                       # level 10: the planks stop here and the drum sits on the cut
BALL_TH, BALL_R, BALL_UP = 4.0, 3.1, 1.86   # level 10's spiked ball: bearing, distance, centre above the eave
BALL_AXIS = (0.93, 0.15, 0.32)              # its spin axis (Flash: spikes go round anticlockwise, the front rolls down)


def z_head(lv):
    return Z_BASE + RING_H * (2 if lv >= 6 else 1)


def z_collar(lv):
    return z_head(lv) + (HEAD_H if lv >= 3 else 0.0)


def z_eave(lv):
    return z_collar(lv) + COLLAR_H


def roof_size(lv):
    return (ROOF_R, ROOF_H) if lv >= 3 else (ROOF_R1, ROOF_H1)


def roof_p(lv):
    return ROOF_P if lv >= 3 else ROOF_P1


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)


def mounts(lv):
    """World points of the shared parts at a level (for the dashed lines in post.py)."""
    ze = z_eave(lv)
    out = {"ring": polar(-45, R_RING, Z_BASE + RING_H / 2),
           "horn": polar(PIPE_TH, PIPE_R, ze + PIPE_UP),
           "roof peak": (ROOF_SHIFT[0], ROOF_SHIFT[1], ze + roof_size(lv)[1])}
    if lv >= 3:
        out["spout"] = polar(SPOUT_TH, R_HEAD + 0.3, z_head(lv) + SPOUT_UP)
    return out
