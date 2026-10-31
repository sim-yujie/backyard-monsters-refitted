"""stack.py : the Catapult's one body and its mounting points, shared by catapult.py (Blender) and post.py.

Flash has three looks (buildingArtData.ts row 51: art levels 1-3, level 4 shows look 3; no animation strip). One body
grows through them:
  look 1  an open wooden frame: three dark square posts and, at the back right (+X, +Y), a raked leg down to the ground
          behind (Flash shows grass under the gear), beams along the two sides and two pale cross bars; a long steel
          axle lies across the side beams on bracket blocks and runs out past the +X side to a toothed gear; a pale lever lies along the frame (on the cross bars)
          and holds the bucket out in front (-Y).
  look 2  the frame grows into a low, open box (Flash): the front and left corner posts rise above it and carry two
          steel bracket blocks; side rails along Y on the posts; planks low on the -Y front and -X back, up to the
          rail on the +X side, whose back slopes down to a steel foot far behind; no lid, so the steel works sit
          down inside it: steel stands rise from the box's floor to the axle (a gear at each end), a second rod lies
          across the rails, a lower rod joins the bracket blocks, and from each block a curved steel bow rises back
          over its gear to a knob; two short dark posts lean back on the rails behind; the bucket hangs from the
          lever in front, as in look 1.
  look 3  look 2 with the back posts grown into tall round leaning poles, a small rope spool on a rod between them
          behind the axle; the box's wood paler and yellower.

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
TOP2 = 3.55                 # its front and left corner posts' tops (the bracket blocks sit on them)
RAIL = TOP1                 # the side rails' tops (as look 1's side beams)
WALL_F = 2.3                # the -Y front planks' top: low, so the box is open above them (Flash)
WALL_B = 2.05               # the -X back planks' top: a slit under the rail (Flash shows grass through it)
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

# the back posts (looks 2, 3). Look 2: on each side a dark beam slopes up and back from the cross beam to a short post
# on the sloping leg. Look 3 adds a tall forked post: a stem on a back cross beam, hidden behind the +X gear, and two
# round arms leaning apart (from the front they make a V, as Flash's two leaning posts), a small rope spool on a rod
# between them, behind the axle.
XBEAM_Y = -0.2              # the cross beam between the side rails the sloping beams stand on
AF_FRONT = (1.45, XBEAM_Y, RAIL)    # (|x|, y, z) a sloping beam's foot
APEX2 = (1.6, 1.94, 3.95)   # its top, on the short post
BXBEAM_Y = 2.98             # the back cross beam between the sloping legs, carrying the fork's stem
FORK_BASE = (0.25, BXBEAM_Y, 3.62)  # (|x|, y, z) where the arms leave the stem
APEX3 = (1.98, 2.32, 7.39)  # the arms' tops
POST3_R = 0.32
DRUM_X, DRUM_Y, DRUM_Z = -0.3, 2.57, 5.95
DRUM_R, DRUM_L = 0.92, 1.36 # a small, rounded rope spool (Flash), not a big drum
