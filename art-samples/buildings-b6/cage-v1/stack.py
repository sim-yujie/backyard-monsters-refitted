"""stack.py : the Champion Cage's layout and sizes, shared by cage.py (Blender) and the picture scripts.

Flash has one look for the Champion Cage (buildingArtData.ts row 114: one art level, no animation, no damaged or
destroyed art), so there is one model. It is a square wrought-iron fence round an empty yard: four corner posts, two
more posts along each side except the front-left side (toward the viewer's left), which is a plain run of pickets so
the champion inside stays in view. Two flat rails run between the posts at a low and a high height; spear-topped
pickets stand in the rails, two between each pair of posts (eight along the post-less side). The posts are tall dark iron
shafts with two small pointed silver studs on each face, a cap of narrowing tiers and a finial (a thin pale pink-grey
ring and a short pale spike).

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig camera: orthographic, 30 degrees up).
World +X runs to the screen's front right, +Y to the back right. The corners: (+A, +A) right, (-A, -A) left,
(+A, -A) front (bottom of the screen), (-A, +A) back (top).
"""
ORIGIN = (0.75, 83.5)       # Flash pixel of the world origin (the middle of the yard, on the ground; the best overlap)
GROUND = 0.0
A = 8.55                    # half the side of the square through the posts' middles

# a post: a tall narrow shaft under a cap of narrowing tiers (Flash: the shaft ~14 px across, the cap a thin cornice,
# a pale sloped flare, a short step and a tall dark block with a low roof), a thin pale ring and a short spike
POST_W = 1.02               # the shaft's side
POST_H = 2.22               # the shaft's top (the cornice sits on it)
CORN_W, CORN_H = 1.1, 0.05  # a thin dark lip on the shaft (Flash's pale shoulder overhangs it by ~1 px)
FLARE_W, FLARE_H = (1.08, 0.72), 0.2   # the pale sloped flare: its foot's and top's sides, its height
STEP_W, STEP_H = 0.72, 0.1             # a short step on the flare
BLOCK_W, BLOCK_H = 0.54, 0.6          # the tall dark block
TOP_H = 0.08                # the block's low pyramid roof
NECK_R, NECK_H = 0.12, 0.06
COLLAR_R, COLLAR_H = 0.3, 0.12    # the thin pale pink-grey ring under the spike
SPIKE_R, SPIKE_H = 0.13, 0.7 
STUD_Z = (0.98, 1.72)       # the studs' heights on every face
STUD_R, STUD_D = 0.23, 0.26 # a stud's half-diagonal and how far its point stands out
STUD_OFF = 0.1              # how far the studs sit off each face's middle, toward its outer edge

# the fence
FENCE_SHIFT = 0.4           # every rail and picket stands this far from the posts' middles toward the viewer (Flash
                            # draws the fence through the posts' front corners: ~2 px lower than through the middles)
RAIL_Z = (0.45, 1.78)       # the two rails' middles
RAIL_W, RAIL_H = 0.1, 0.17
PICKET_W, PICKET_H = 0.16, 3.15
TIP_H, TIP_W = 0.4, 0.21  # the spear tip: its height and its widest (just above the shaft)
NUDGE = {3: (-0.07, -0.14), 1: (0.0, 0.07)}   # a side's rails and pickets moved by (X, Y) more, found by the best
                            # outline overlap: Flash draws the front-left side ~1 px lower than the other sides
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
