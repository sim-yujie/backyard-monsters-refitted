"""stack.py : the Catapult's one body and its mounting points, shared by catapult.py (Blender) and post.py.

Flash has three looks (buildingArtData.ts row 51: art levels 1-3, level 4 shows look 3; no animation strip). One body
grows through them:
  look 1  an open wooden frame: three dark square posts and, at the back right (+X, +Y), a raked leg down to the ground
          behind (Flash shows grass under the gear), beams along the two sides and two pale cross bars; a long steel
          axle lies across the side beams on bracket blocks and runs out past the +X side to a toothed gear; a pale lever lies along the frame (on the cross bars)
          and holds the bucket out in front (-Y).
  look 2  the frame is boarded in: a dark plank box on steel feet, its back sloping down to a foot far behind; the
          axle sits higher on steel stands with a gear at each end; a lower steel rod on two bracket blocks along
          the front top; from each block a curved steel bow rises back over its gear to a knob; the bucket hangs from
          the lever in front, as in look 1.
  look 3  look 2 plus two round wooden posts rising from the box's back to just behind the bows' knobs, a pale
          rope drum on a rod between them; the box's wood paler.

World units: 10 Flash px across, 8.66 Flash px up (the twig/pebble/putty/hatchery/map room/flinger camera:
orthographic, 30 degrees up). The world origin is the look 1 frame's middle on the ground. +X faces the viewer's
right, -Y the viewer's left; the front corner is (+X, -Y).
"""
ORIGIN = (-4.4, 53.2)       # Flash pixel of the world origin
LOOK_DY = {}                # every look is anchored the same
GROUND = 0.0
YAW = 0.0

# the frame (look 1) / the box's corner posts (looks 2, 3)
FA, FB = 2.2, 1.9           # half its size along X and Y (to the posts' outer faces)
POST = 0.72                 # the square posts' side
TOP1 = 3.0                  # look 1: the posts' tops (the side beams lie on them)
BEAM = 0.42                 # the side beams' height and width
BAR_Z = 2.45                # look 1: the pale cross bars (along X, front and back)

# looks 2, 3: the box
FOOT_H = 0.35               # its steel feet
TOP2 = 3.55                 # its top
BACK_Y = 4.9                # how far back its sloping back reaches on the ground (at the feet)

# the lever and the bucket (all looks)
ARM_X = -0.1
ARM_P0 = (-2.25, 2.3)       # (y, z): its front end, in the bucket's back
ARM_P1 = (2.15, 2.62)       # its back end
BUCKET_C = (0.05, -3.45)     # the bucket's middle (x, y)
BUCKET_R = 1.36             # its rim radius
BUCKET1 = (0.58, 2.35)      # bottom and rim height: it hangs from the lever, at one height in every look (Flash)
BUCKET2 = BUCKET1

# look 1's axle: along X on brackets on the side beams, out past +X to the gear; a strut props its end
AX1_Y, AX1_Z = -0.63, 3.55
AX1_X = (-2.4, 4.1)
GEAR1_X = 3.9
GEAR_R = 1.2
STRUT_FOOT = (2.5, 3.9)     # (x, y) on the ground: the raked leg at the (+X, +Y) corner

# looks 2, 3: the axle higher with a gear at each end; the lower rod; the bows
AX2_Y, AX2_Z = 0.42, 5.1
GEAR2_X = 2.3
ROD_Y, ROD_Z = -1.45, 4.0
BOW_X = 1.85
BOW = [(-1.45, 4.0), (-1.32, 4.9), (-0.95, 5.55), (-0.2, 6.15), (0.8, 6.6), (1.9, 6.8)]   # (y, z)

# look 3: the back posts and the drum
POST3_FOOT = (1.35, TOP2)   # (y, z) where they stand on the box's top
POST3_TOP = (2.4, 7.4)
POST3_R = 0.4
DRUM_Y, DRUM_Z = 2.0, 6.05
DRUM_R, DRUM_L = 1.38, 1.5
