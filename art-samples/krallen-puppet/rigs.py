"""rigs.py : where each painted Krallen cell is cut, and its bones. All points are pixels of the @4x cell.

A rig names its source cell (look, sheet column, row) and its parts, back to front. A part has:
  poly   the cut outline (its own pixels are those of the painting inside it)
  bones  the joint chain (hip, knee, paw ...); the first point is the pivot
  fill   (optional) the area of the layers below to repaint by inpainting, where the part covered them
  hole   (optional) what to take out of the body; defaults to poly for parts drawn over the body, nothing for
         parts drawn behind it (their hidden top stays under the body)
  behind True for parts drawn behind the body (far legs, far arm)
  role   which motion the part follows (anim.py)
The part named "body" takes everything left over.
"""

# Look 3 (levels 5+), column 6: left profile, head on the left. Source: attack row 10, a square standing pose.
L3_SIDE = dict(
    src=(3, 6, 10),
    ground=300,
    parts=[
        dict(name="far_hind", role="far_hind", behind=True, shade=0.92,
             poly=[(296, 212), (338, 212), (348, 252), (338, 292), (300, 293), (303, 280), (322, 270), (310, 246)],
             hole=[(298, 238), (346, 238), (346, 252), (338, 292), (300, 293), (303, 280), (322, 270), (310, 246)],
             bones=[(318, 220), (330, 258), (318, 287)]),
        dict(name="far_front", role="far_front", behind=True, shade=0.92,
             poly=[(166, 214), (214, 214), (216, 262), (192, 270), (168, 262)],
             hole=[(166, 232), (214, 232), (216, 262), (192, 270), (168, 262)],
             bones=[(198, 220), (188, 258)]),
        dict(name="tail", role="tail",
             poly=[(384, 162), (482, 186), (484, 224), (384, 222)],
             fill=[(372, 172), (392, 172), (392, 214), (372, 214)],
             bones=[(386, 194), (426, 200), (476, 208)]),
        dict(name="body", role="body", bones=[(330, 190), (250, 180), (190, 170)]),
        dict(name="arm", role="arm",
             poly=[(116, 42), (186, 36), (194, 84), (150, 86), (116, 78)],
             fill=[(170, 40), (194, 40), (194, 84), (170, 84)],
             bones=[(186, 64), (150, 62), (124, 64)]),
        dict(name="near_hind", role="near_hind",
             poly=[(316, 192), (382, 186), (396, 246), (400, 296), (372, 306), (342, 302), (352, 284), (370, 268),
                   (346, 248), (318, 242)],
             fill=[(316, 192), (382, 186), (390, 230), (318, 236)],
             bones=[(348, 206), (388, 262), (366, 296)]),
        dict(name="near_front", role="near_front",
             poly=[(198, 204), (264, 204), (268, 254), (252, 288), (226, 302), (206, 312), (164, 310), (162, 290),
                   (188, 282), (208, 262), (200, 236)],
             fill=[(198, 204), (264, 204), (264, 232), (200, 232)],
             bones=[(232, 214), (240, 262), (190, 298)]),
        dict(name="head", role="head",
             poly=[(60, 140), (112, 108), (182, 112), (204, 150), (196, 196), (150, 228), (100, 228), (60, 178)],
             fill=[(170, 120), (204, 150), (196, 196), (170, 200)],
             bones=[(196, 170), (110, 160)]),
        dict(name="jaw", role="jaw",
             poly=[(98, 176), (142, 170), (146, 226), (98, 228)],
             fill=[(100, 178), (140, 174), (140, 220), (100, 222)],
             bones=[(138, 176), (104, 214)]),
    ],
)

# Look 3, column 4: three-quarter front, head to the lower left. Source: walk row 0. The far front leg is hidden
# behind the head; the lifted hind leg and the tail sit behind the body.
L3_FRONT = dict(
    src=(3, 4, 0),
    ground=300, fwd=(-0.8, 0.6), swing=0.6,
    parts=[
        dict(name="tail", role="tail", behind=True,
             poly=[(318, 76), (442, 78), (442, 130), (318, 128)],
             hole=[(338, 76), (442, 78), (442, 130), (338, 128)],
             bones=[(330, 110), (380, 100), (432, 100)]),
        dict(name="far_hind", role="far_hind", behind=True, shade=0.95,
             poly=[(328, 150), (388, 156), (390, 216), (334, 216), (322, 188)],
             hole=[(336, 176), (390, 176), (390, 216), (336, 216)],
             bones=[(346, 162), (362, 190), (352, 206)]),
        dict(name="arm", role="arm", behind=True,
             poly=[(36, 100), (116, 50), (178, 80), (180, 124), (140, 140), (100, 166), (36, 164)],
             hole=[(36, 100), (116, 50), (150, 64), (150, 130), (100, 166), (36, 164)],
             bones=[(165, 110), (125, 80), (75, 135)]),
        dict(name="body", role="body", bones=[(260, 170), (200, 170)]),
        dict(name="near_front", role="near_front",
             poly=[(238, 212), (302, 212), (306, 260), (278, 294), (268, 310), (230, 308), (236, 282), (256, 262),
                   (244, 236)],
             fill=[(240, 212), (300, 212), (300, 232), (242, 232)],
             bones=[(270, 218), (276, 262), (250, 298)]),
        dict(name="head", role="head",
             poly=[(108, 184), (160, 172), (212, 188), (222, 240), (202, 278), (150, 278), (108, 252)],
             fill=[(188, 184), (216, 190), (220, 240), (194, 246)],
             bones=[(205, 205), (150, 240)]),
        dict(name="jaw", role="jaw",
             poly=[(134, 236), (202, 234), (202, 272), (140, 274)],
             fill=[(140, 238), (198, 238), (198, 266), (142, 268)],
             bones=[(192, 240), (160, 266)]),
    ],
)

# Look 3, column 8: three-quarter back, head away to the upper left, rump and tail toward the viewer.
L3_BACK = dict(
    src=(3, 8, 0),
    ground=300, fwd=(-0.8, -0.6), swing=0.7,
    parts=[
        dict(name="far_hind", role="far_hind", behind=True, shade=0.92,
             poly=[(336, 204), (402, 210), (398, 282), (342, 282)],
             hole=[(344, 232), (402, 232), (398, 282), (344, 282)],
             bones=[(360, 214), (372, 248), (358, 270)]),
        dict(name="far_front", role="far_front", behind=True, shade=0.95,
             poly=[(178, 192), (244, 192), (244, 242), (178, 242)],
             hole=[(178, 204), (234, 204), (234, 242), (178, 242)],
             bones=[(228, 200), (200, 224)]),
        dict(name="body", role="body", bones=[(280, 160), (220, 140)]),
        dict(name="arm", role="arm",
             poly=[(56, 104), (100, 60), (192, 52), (198, 96), (150, 100), (102, 110), (96, 138), (56, 138)],
             fill=[(160, 58), (196, 58), (196, 94), (160, 94)],
             bones=[(185, 78), (120, 72), (75, 125)]),
        dict(name="arm_r", role="arm_r",
             poly=[(280, 52), (346, 60), (378, 94), (388, 134), (352, 136), (328, 102), (280, 96)],
             fill=[(282, 58), (306, 58), (306, 94), (282, 94)],
             bones=[(288, 72), (330, 82), (360, 125)]),
        dict(name="near_hind", role="near_hind",
             poly=[(260, 198), (332, 192), (344, 240), (336, 282), (324, 308), (284, 308), (290, 284), (300, 262),
                   (274, 240)],
             fill=[(262, 200), (330, 196), (334, 226), (266, 228)],
             bones=[(295, 205), (322, 258), (305, 296)]),
        dict(name="tail", role="tail",
             poly=[(324, 184), (372, 188), (486, 270), (478, 298), (420, 272), (328, 234)],
             fill=[(326, 190), (350, 190), (350, 230), (330, 230)],
             bones=[(335, 198), (400, 238), (470, 282)]),
    ],
)

RIGS = {"l3_side": L3_SIDE, "l3_front": L3_FRONT, "l3_back": L3_BACK}
