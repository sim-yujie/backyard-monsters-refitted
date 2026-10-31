"""stack.py : the Champion Cage's layout and sizes, shared by cage.py (Blender) and the picture scripts.

Flash has one look for the Champion Cage (buildingArtData.ts row 114: one art level, no animation, no damaged or
destroyed art), so there is one model. It is a square wrought-iron fence round an empty yard: four corner posts, two
more posts along each side except the front-left side (toward the viewer's left), which is a plain run of pickets so
the champion inside stays in view. Two flat rails run between the posts at a low and a high height; spear-topped
pickets stand in the rails, two between each pair of posts (eight along the post-less side). The posts are dark iron
blocks with two pale pyramid studs on each face, a pale cornice, a low pyramid roof and a finial (a neck, a pink
collar and a pale spike).

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
World +X runs to the screen's front right, +Y to the back right. The corners: (+A, +A) right, (-A, -A) left,
(+A, -A) front (bottom of the screen), (-A, +A) back (top).
"""
ORIGIN = (0.0, 84.0)        # Flash pixel of the world origin (the middle of the yard, on the ground)
GROUND = 0.0
A = 8.55                    # half the side of the square through the posts' middles

# a post
POST_W = 1.1                # the shaft's side
POST_H = 2.2                # the shaft's top (the cornice sits on it)
CORN_W, CORN_H = 1.22, 0.14 # the cornice slab (its lit left face is Flash's pale strip under the dark top)
ROOF_H = 0.42               # the dark pyramid roof on the cornice (its lit left faces paler)
NECK_R, NECK_H = 0.17, 0.2
COLLAR_R, COLLAR_H = 0.42, 0.24   # the squat pink-grey knob under the spike
SPIKE_R, SPIKE_H = 0.2, 1.1
STUD_Z = (0.85, 1.72)       # the studs' heights on every face
STUD_R, STUD_D = 0.3, 0.19 # a stud's half-diagonal and how far it stands out

# the fence
FENCE_SHIFT = 0.4           # every rail and picket stands this far from the posts' middles toward the viewer (Flash
                            # draws the fence through the posts' front corners: ~2 px lower than through the middles)
RAIL_Z = (0.45, 1.78)       # the two rails' middles
RAIL_W, RAIL_H = 0.12, 0.2
PICKET_W, PICKET_H = 0.16, 3.15
TIP_H, TIP_W = 0.4, 0.21  # the spear tip: its height and its widest (just above the shaft)
PER_BAY = 2                 # pickets between two posts


def corners():
    """The four corner posts, going round: left, back, right, front."""
    return [(-A, -A), (-A, A), (A, A), (A, -A)]


def sides():
    """(start corner, end corner, with middle posts?) for the four sides. The front-left side (left corner to front
    corner) has no middle posts."""
    c = corners()
    return [(c[0], c[1], True), (c[1], c[2], True), (c[2], c[3], True), (c[3], c[0], False)]


def posts():
    out = list(corners())
    for p0, p1, mid in sides():
        if mid:
            for t in (1 / 3, 2 / 3):
                out.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))
    return out


def fence(p):
    """A point on a side's line, moved toward the viewer by FENCE_SHIFT (world +X -Y)."""
    k = FENCE_SHIFT / 2 ** 0.5
    return (p[0] + k, p[1] - k)


def pickets():
    """Every picket's ground point: PER_BAY in each third of a side, and in the post-less side also where the middle
    posts would be (a picket every ninth)."""
    out = []
    n = 3 * (PER_BAY + 1)
    for p0, p1, mid in sides():
        for i in range(1, n):
            if mid and i % (PER_BAY + 1) == 0:
                continue
            t = i / n
            out.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))
    return out
