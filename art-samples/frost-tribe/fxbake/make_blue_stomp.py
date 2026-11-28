"""Blizzard Stomp's mist, bluer (owner, Krampus card, 28 Nov 2026: the stomp mist reads slightly mint on grass).

python3 -I make_blue_stomp.py   ->  neon/round-1/motion-blue.json (from neon's motion-hold.json; nothing else changes)

Additive pale cyan over green grass lights the green channel most, so it reads mint; neon's aura ramp alone, still
added, stays mint (hue ~135 deg on the game's grass). Drawn normally (painted over the grass, not added to it) in an
ice-blue ramp with no near-white start, the mist reads blue (hue ~180-200 deg) in both looks. The mist and swirl pieces
change (the frost wisp puffs, thrown and held on towers, the blizzard swirl and the gathering vortex) and the two big
ground flashes (impact starburst, shock arc), whose added cyan edges left a mint rim on the grass: they start white
and fade into the same blue, drawn normally. The small flashes (snap burst on towers, horn flare) stay added.
"""
import json
import os

H = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(H, "neon", "round-1", "motion-hold.json")
OUT = os.path.join(H, "neon", "round-1", "motion-blue.json")

BLUE = ["#a4c2ff", "#7aa4ff", "#5c8ae8"]
BLUE_CLASSIC = ["#9ab0dc", "#7f98cc", "#6a84bc"]
CHANGES = {
    # cell (or the flipbook's first frame): new fields
    "frost_wisp_puff": {"blend": "normal", "tint": BLUE, "tint_classic": BLUE_CLASSIC},
    "blizzard_swirl_1": {"blend": "normal", "tint": ["#b4ceff", "#86acff", "#5c8ae8"],
                         "tint_classic": ["#a8bce0", "#8aa2d2", "#6a84bc"], "peak": 0.62},
    "impact_starburst": {"blend": "normal", "tint": ["#f2f6ff", "#94b6ff", "#5c8ae8"],
                         "tint_classic": ["#e2eaf6", "#8aa2d2", "#6a84bc"]},
    "frost_shock_arc": {"blend": "normal", "tint": ["#f2f6ff", "#94b6ff", "#5c8ae8"],
                        "tint_classic": ["#e2eaf6", "#8aa2d2", "#6a84bc"]},
    "gathering_frost_vortex": {"blend": "normal", "tint": ["#6f96f0", "#94b6ff", "#b4ceff"],
                               "tint_classic": ["#6a84bc", "#8aa2d2", "#a8bce0"], "peak": 0.55},
}

plan = json.load(open(SRC))
plan["_note_blue"] = __doc__.strip().splitlines()[0] + " See make_blue_stomp.py."
changed = 0
for key in ("pieces", "held", "on_each"):
    for piece in plan["blizzardStomp"].get(key, []):
        name = piece.get("cell") or (piece.get("flipbook") or [None])[0]
        if name in CHANGES:
            piece.update(CHANGES[name])
            changed += 1
json.dump(plan, open(OUT, "w"), indent=1)
print(OUT, changed, "pieces changed")
