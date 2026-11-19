"""The outpost icon (beta 8 outpost race, owner 17 Nov 2026: "astra fixes the look + painted icon"), Modern and Classic.

Shown beside the outpost count on a leaderboard row. Concept from Codex astra's design advice (direction A): a
painted flag, because the dock's "Main yard" (outposts) button already uses a flag; amber so it is never read as
the white "retreat" flag, and no dome so it is never read as the Town Hall.

Painted by Codex (game-art skill; prompts, sheets and refs are kept in the worktree's pics-empire-astra/icon/ only,
as art-samples/.gitignore keeps only scripts):
- m1: 3x2 magenta sheet of six flag ideas in the Modern icon look (refs: the approved levelup, empire, alliance,
  goals, friendprev, speedup, shield icons; and "not these": retreat and townhall). Column 1 row 1 was wired:
  a broad fork-tailed amber-gold flag with a dark red underside on a wooden stake with a riveted steel foot,
  checked at 18 px on the Modern slate row, the lit row and both Classic parchment rows.
- c1: the same flag redrawn in the Classic look the way `goals` became `goalsclassic` (softer, no white rim, thin
  brown outline); the warmer (right) one of two, as it stands out more on parchment.
Cut with the skill's cut_sheet.py; the `.full.png` cuts copied to large/outpost.png and large/outpostclassic.png.

This runs web/tools/game-icons/make.py without numpy (as goals-tab-icon/make_nonp.py).

usage: python3 -I make.py <worktree>/web/tools/game-icons <this folder>
"""
import sys
import types

sys.modules["numpy"] = types.ModuleType("numpy")
sys.path.insert(0, sys.argv[1])
import make  # noqa: E402
from PIL import Image  # noqa: E402


def resize_pm(im, size):
    return im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


make.resize_pm = resize_pm
make.main(sys.argv[2], ["outpost", "outpostclassic"])
