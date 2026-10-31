p = 'stack.py'
s = open(p, encoding='utf8').read()
s = s.replace('''# the roof (ridge along Y, over X = RIDGE_X)
RIDGE_X = 0.0
RIDGE_Z = 7.7
EAVE_Z = 5.25               # the roof's lower edges (at X = +-ROOF_A)
ROOF_A = 2.75               # the eaves' X (half)
ROOF_B = 2.75               # the roof's Y (half: past the gables)
ROOF_T = 0.16''', '''# the roof (ridge along Y, over X = RIDGE_X). Flash's render had some perspective: its roof is wider on the +X side
# and taller than the walls suggest, so the ridge sits toward +X and the two slopes differ
RIDGE_X = 0.64
RIDGE_Z = 8.23
SLOPE = {1: (2.97, 2.77), -1: (3.54, 3.3)}     # +X and -X slopes: how far out and how far down to the eave
ROOF_Y0, ROOF_Y1 = -2.75, 3.19                 # the roof's front (-Y) and back ends
ROOF_T = 0.16''')
s = s.replace('''# the gold block on the ridge's front end, the pulleys over it (axles along X, in the plane X = PUL_X)
BLOCK_C = (0.0, -2.25, 7.95)
BLOCK_S = (0.9, 1.0, 0.65)
PUL_X = 0.0
''', '''# the gold block on the ridge's front end, the pulleys over it (all in one plane turned toward the camera)
BLOCK_C = (0.85, -2.25, 8.4)
BLOCK_S = (1.1, 1.0, 0.6)
PUL_N = (-30.0, 20.0)               # the pulleys' plane (through the block's top): its normal's bearing and tilt
''')
s = s.replace("POT_C = (4.7, 1.96, 4.27)           # look 4",
              "POT_C = (4.7, 1.96, 4.27)           # look 4 (tipped toward the camera by POT_TIP degrees)\nPOT_TIP = 12.0")
open(p, 'w', encoding='utf8').write(s)

p = 'flinger.py'
s = open(p, encoding='utf8').read()
old = s[s.index('def roof_z(x):'):s.index('def corner_posts():')]
s = s.replace(old, '''def roof_z(x):
    """The roof's top at x (its two slopes from the ridge to the eaves)."""
    a, b = S.SLOPE[1 if x >= S.RIDGE_X else -1]
    return S.RIDGE_Z - b * abs(x - S.RIDGE_X) / a


''')
s = s.replace('''    a, b = S.ROOF_A, S.RIDGE_Z - S.EAVE_Z
    ln = math.hypot(a, b)''', '''    a, b = S.SLOPE[s]
    ln = math.hypot(a, b)''')
s = s.replace('''        roof(-S.ROOF_B, S.ROOF_B if LOOK >= 3 else S.ROOF2_Y1)''',
              '''        roof(S.ROOF_Y0, S.ROOF_Y1 if LOOK >= 3 else S.ROOF2_Y1)''')
old = s[s.index('def pulley(name'):s.index('def smooth_open(')]
s = s.replace(old, open('work/pul.py', encoding='utf8').read())
open(p, 'w', encoding='utf8').write(s)
