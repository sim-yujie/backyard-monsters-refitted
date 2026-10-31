"""stack.py : the Flinger's one body and its mounting points, shared by flinger.py (Blender) and post.py.

Flash has four looks (buildingArtData.ts row 5: art levels 1-4, level 5 shows look 4; no animation strip). One body
grows through them:
  look 1  an open wooden catapult: four corner posts on ground sills, a wooden drum on a steel axle in the -Y side, a
          tall throwing beam leaning up through a dark rope coil to a steel cap and a gold pulley, the bucket on its arm
          over two springs at the +X side, a golf ball at the left, a little step stool beside it.
  look 2  the posts carry plank walls and a slate roof over the front (-Y) half; a gold block on the gable's peak
          holds one pulley; an open timber A-frame stands over the back half.
  look 3  the roof covers the whole house, with a hatch in its +X slope (a board lies on its sill); a second pulley; a
          steel pipe stands under the springs.
  look 4  a big wheel high at the back; the bucket is a big pot on a thick round arm; a curved spoon in the hatch.

World units: 10 Flash px across, 8.66 Flash px up (the twig/pebble/putty/hatchery/map room camera: orthographic,
30 degrees up). The world origin is the house's middle on the ground. +X faces the viewer's right, -Y the viewer's
left; the front corner is (+X, -Y).
"""
ORIGIN = (-2.06, 48.3)       # Flash pixel of the world origin (looks 1, 2 and 4)
LOOK_DY = {3: -6.0}         # Flash draws look 3 six px higher: its pictures are rendered with the camera moved so
                            # (the model is the same; only where the picture is anchored)
GROUND = 0.0
YAW = 0.0

# the house
HA, HB = 2.55, 2.4          # half its size along X and Y (to the posts' outer faces)
POST = 0.95                 # the corner posts' side (Flash's are chunky)
POST_IN = 0.4               # their middles this far in from the house's sides (they stand out past the walls)
WALL_H = 4.9                # the walls' top (under the roof's eaves)
SILL_H = 0.75               # the ground sills' height (Flash's low base frame: chunky beams on the ground)
SILL_W = 0.8                # their width
PLANK_T = 0.14              # wall planks' thickness

# the roof (ridge along Y, over X = RIDGE_X). Flash's render had some perspective: its roof is wider on the +X side
# and taller than the walls suggest, so the ridge sits toward +X and the two slopes differ
RIDGE_X = 0.64
RIDGE_Z = 8.23
SLOPE = {1: (2.97, 2.77), -1: (3.54, 3.3)}     # +X and -X slopes: how far out and how far down to the eave
ROOF_Y0, ROOF_Y1 = -2.75, 3.19                 # the roof's front (-Y) and back ends
ROOF_T = 0.16

# the -Y gable's opening: the drum's window
OPEN = (-1.75, 1.65, 0.75, 4.3)    # (its bottom is the -Y sill)      # x0, x1, z0, z1 on the -Y wall

# the drum on its axle (axis along X, just inside the -Y wall)
DRUM_C = (-0.6, -1.55, 2.4)
DRUM_R, DRUM_L = 0.62, 1.05
AXLE_R = 0.11

# the ball
BALL_R = 1.08
BALL_SCR = (-35.0, 49.5)            # Flash px of its middle (looks 1, 2, 4)

# the look 1 posts' heights: front (+X -Y), left (-X -Y), right (+X +Y), back (-X +Y)
POST1_H = (5.35, 5.5, 5.6, 5.8)
# look 1's A-frame: two square legs in the upright plane y = A1_Y, from the ground at x = A1_FEET up to the apex (x, z)
# under a steel cap, a little slate roof and the gold pulley; a windlass (a round axle along X) in front of the
# legs carries the rope coil
A1_Y = 0.2
A1_APEX = (-0.62, 7.67)             # Flash's frame is wide and low
A1_FEET = (-5.3, 4.15)
A1_W = 0.8                          # the legs' side
A1_PUL = (-0.13, -0.95, 2.18)        # the pulley's middle from the apex (up and left of the cap, as Flash)
WINDLASS_Z = 6.3                    # the coil: its axis' height, y (in front of the legs' plane), left end and radius
COIL_Y = -1.15                      # (Flash's coil is long and fat: in front of the left leg, on behind the right one;
COIL_X = -1.5                       # it ends where the right leg hides it from the camera)
COIL = 0.66
AXLE1_R = 0.16
STOOL_C = (4.4, 3.7)                # look 1's step stool beside the bucket: its middle on the ground
STOOL_H, STOOL_S = 1.8, 1.25        # its seat's top and side
# look 2's back half: a big open timber triangle over the back posts (a tie beam on the left post and on a plank seat
# that lies on the right post, two rafters meeting at the apex, the ridge beam back to the roof), two rails along the
# open +X side
TRUSS_Y = 2.04
BACK2_H = (5.58, 5.3)               # the back posts' tops: left (-X, under the tie beam), right (+X, under the seat)
SEAT = (2.55, 0.95, 1.1, 3.1, 0.28) # the plank seat on the right back post: middle x, y, size x, y, thickness
TIE_X = (-2.55, 3.25)               # the tie beam's ends (it lies on the left post and on the seat)
TIE_H = 0.42
TRUSS_APEX = (0.9, 8.35)            # the rafters meet here (x, z)
TRUSS_FEET = (-1.2, 3.1)            # the rafters' feet on the tie beam
XRAILS = (3.1, 4.0)                 # the +X side rails' middles (z)
# the tray under the drum: a curved sheet (wood in look 1, bright steel from look 2) from just under the drum down onto
# the -Y sill, its lip rolled over the sill's front: (y, z) points of its profile
TRAY = ((-1.0, 1.78), (-1.45, 1.3), (-1.9, 1.0), (-2.25, 0.93), (-2.42, 0.85), (-2.5, 0.55))

# the slates: length down the slope, width along it, thickness, the step between rows; their lower ends lift
TILE = (0.95, 1.05, 0.16, 0.74)
TILE_TILT = 9.0
ROOF2_Y1 = -0.6                     # look 2's roof covers the front part only, to this y
HATCH = (0.6, 2.8, -0.05, 1.42)      # look 3, 4: the hatch in the +X slope: u0, u1 down the slope, y0, y1 (y1 short of
                                    # the back right post, whose top would show in the hole)

# the gold block on the ridge's front end, the pulleys over it (all in one plane turned toward the camera)
BLOCK_C = (0.85, -2.25, 8.4)
BLOCK_S = (1.1, 1.0, 0.6)
PUL_N = (-30.0, 20.0)               # the pulleys' plane (through the block's top): its normal's bearing and tilt
PUL1_SCR = (-30.0, -22.0)           # Flash px of the pulleys' and the big wheel's middles
PUL2_SCR = (-6.0, -31.0)
WHEEL_SCR = (35.0, -44.0)
PUL_R, WHEEL_R = 0.52, 1.35
BELT_T = 0.1
RIM_W, SPOKE_W = 0.085, 0.06        # the pulleys' gold rims and spokes (the wheel's: 1.3 times)

# the bucket arm: hub on the front post's +X face, arm up and out to the bucket (its rim's middle)
HUB = (2.85, -1.57, 2.53)
HUB_R = 0.42
BUCKET_C = (3.9, 2.19, 4.49)        # looks 1-3
BUCKET_R, BUCKET_H = 1.04, 1.6
ARM_R = 0.13
POT_C = (4.7, 1.96, 4.27)           # look 4 (tipped toward the camera by POT_TIP degrees)
POT_TIP = 16.0
POT_R, POT_H = 1.9, 2.0
POT_ARM_R = 0.26
ARM_DROP = 0.3                      # the arm meets the bucket this far under the rim
SPRING_C = (3.27, -0.01, 1.85)      # the springs' foot (on the pipe's top in looks 3, 4)
SPRINGS = 1                         # looks 3, 4 (looks 1, 2: two, on a block)
SPRING_OFF = (0.0, -0.5, 0.0)
SPRING12_Y = -0.6                   # looks 1, 2: the first spring's y (clear of look 1's A-frame)
SPRING12_X = 3.5                    # looks 1, 2: the springs' x (clear of the hub)
SPRING_BLOCK_H = 1.5                # looks 1, 2: the block the springs stand on
PIPE_FOOT = (3.57, 0.83, 0.0)
