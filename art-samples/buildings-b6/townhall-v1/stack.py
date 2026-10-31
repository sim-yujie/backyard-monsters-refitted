"""stack.py : the Town Hall's body and its mounting points per level, shared by th.py (Blender) and post.py.

Flash (buildingArtData.ts row 14) has ten pictures, one per level, and no animation strip. They are one machine growing:
  1  a ribbed tin can on four bolt legs, a leather sheet thrown over its top, the funnel tied on with string and clips,
     a magnifying glass leant on the front
  2  the sheet becomes a brown metal roof with a porthole; the can is bigger, bracket legs on gear feet, magnifier and a
     horseshoe magnet on the front
  3  a brown hood with two portholes over a ribbed core, two magnets, a round base plate, a gold rail, five gear legs
  4  a riveted dome (four panels, two portholes) on a big ribbed drum with gold straps; red loop pipes, gold lattice,
     six gear legs
  5  a full dome with nine portholes and dotted rivet lines; red rails; double gears under the feet
  6  level 5 standing on two perforated steel tiers with gold rims; bigger gear feet
  7  level 6 plus four gold elbow pipes from the dome down to the tiers, a gold collar under the funnel, red knobs,
     spiky gold feet
  8  level 7 with more portholes, a big front porthole, the drum opened at the front, red drips
  9  gold frames with spikes round the dome, gold claw feet, a gold collar and tendrils on the funnel
  10 gold arms with blue studs on four gold columns, gold horns over the funnel, red coils round the core, claw feet,
     a perforated base with black holes

World units: 10 Flash px across, 8.66 Flash px up (the hatchery/putty/pebble/twig/HCC camera: orthographic, 30 up).
Bearings: 0 = world +X (front right on screen), -90 = world -Y (front left), -45 = straight at the viewer.
"""
import math

ORIGIN = (0.0, 65.0)        # Flash pixel of the world origin (the building's axis on the ground; footprint 130 x 130)
GROUND = 0.0
FRONT = -45.0

# the funnel: the same polished funnel at every level (spout radius, rim radius, cone height, spout length)
FUN_SPOUT_R, FUN_RIM_R, FUN_CONE_H, FUN_SPOUT_H = 0.32, 2.2, 1.7, 1.0

# per level: the drum (ribbed tin: radius, bottom, top), the dome (radius, equator height), the funnel's foot height
# level 1: the tin can (radius, bottom, top), the legs (bearings, clamp distance and height, foot distance), the tie
# round the funnel's spout, the funnel's size, the magnifying glass (bearing, height, lens radius)
LV1 = dict(can=(2.25, 0.45, 6.9), legs=(-108.0, -60.0, -3.0, 50.0), leg_r=4.1, leg_z=3.0, foot_d=4.1, bundle_z=10.2,
           cloth_half=(4.6, 3.6), fun_k=0.72, fun_extra=1.2, mag_th=-86.0, mag_z=3.8, mag_r=1.3, mag_lean=0.45)

# level 2: a bigger can, the sheet turned into a brown metal roof (top and eave heights, half sizes), bracket legs
LV2 = dict(can=(2.9, 1.3, 6.4), legs=(-90.0, 0.0, 90.0, 180.0), leg_d=4.9, roof_z=(11.0, 6.5), roof_half=(4.8, 3.8),
           fun_k=0.85, fun_extra=0.6, mag_th=-82.0, magnet_z=5.5, glass_th=-12.0, glass_d=3.6, glass_z=8.1)

# level 3: the roof bent into a hood (radius, rim height) over a ribbed core on a steel pan, an octagonal gold rail
LV3 = dict(hood=(3.7, 7.8), hood_flat=1.02, hood_drop=0.7, cut=(19.0, 36.0), pan=(3.6, 1.3, 3.9), core_r=1.0,
           holes=((-90.0, 36.0, 1.05), (-2.0, 28.0, 0.9)),
           hood_rivets=((-140.0, 3.0), (-72.0, 3.0), (-18.0, 3.0), (52.0, 3.0), (-45.0, 72.0), (-100.0, 62.0)),
           fun_k=1.0, fun_extra=0.0, magnets=(-84.0, -6.0), magnet_z=6.8, rail=(6.0, 3.0, 3.8), leg_d=5.0,
           frames=(-135.0, 45.0), frame_z=6.0)

# level 4: the hood grown into a dome of four panels (seams at the quarters) on a tall drum with gold straps
LV4 = dict(drum=(3.75, 2.5, 8.3), dome=(4.0, 8.3), dome_flat=0.8, seams=(-45.0, 45.0, 135.0, -135.0),
           holes=((-90.0, 36.0, 0.95), (0.0, 36.0, 0.95)), fun_k=0.88, fun_extra=0.6, straps=(-75.0, -15.0, -133.0, 43.0),
           foot_d=5.4, loops=((6.8, 1.2, 14.0), (4.6, 2.4, 22.0), (2.6, 1.8, 30.0)))

FEET8 = tuple(FRONT + 45.0 * k for k in range(8))
_BODY5 = dict(drum=(3.7, 4.6, 7.4), dome=(4.2, 7.4), fun_z=11.75, straps=(-70.0, -20.0, -140.0, 50.0),
              holes=tuple((FRONT + 45.0 * k, 40.0, 0.8) for k in range(8)), brass_spout=True,
              meridians=tuple(FRONT + 22.5 + 45.0 * k for k in range(8)), feet=FEET8, foot_d=5.9)


def _lift(d, dz, **kw):
    out = dict(d)
    out["drum"] = (d["drum"][0], d["drum"][1] + dz, d["drum"][2] + dz)
    out["dome"] = (d["dome"][0], d["dome"][1] + dz)
    out["fun_z"] = d["fun_z"] + dz
    out.update(kw)
    return out


# per level: the drum (ribbed tin: radius, bottom, top), the dome (radius, equator height), the funnel's foot height,
# the portholes (bearing, elevation, radius), rivet meridians, drum straps (bearings), feet (bearings, distance)
LV = {
    1: LV1,
    2: LV2,
    3: LV3,
    4: LV4,
    5: _BODY5,
    6: _lift(_BODY5, 1.0, tiers=((4.8, 3.9, 5.6), (6.0, 2.2, 3.9))),
}
# levels 7 and 8: level 6 with one big front porthole and two at the sides, gold pipes at the four quarters, a crown
LV[7] = dict(LV[6], holes=((FRONT, 30.0, 1.0), (FRONT - 90, 32.0, 0.8), (FRONT + 90, 32.0, 0.8)),
             pipes=(FRONT - 45, FRONT + 45, FRONT - 135, FRONT + 135), fun_z=LV[6]["fun_z"] + 1.2, meridians=(),
             scatter=True, straps=(-75.0, -15.0, -140.0, 50.0))
LV[8] = dict(LV[7], holes=LV[7]["holes"] + tuple((FRONT - 60 + 30 * k, 62.0, 0.42) for k in range(5)))


def polar(th, r, z):
    a = math.radians(th)
    return (r * math.cos(a), r * math.sin(a), z)
