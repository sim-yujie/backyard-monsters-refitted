"""Prev / Next friend arrows (beta 8, owner 18 Nov 2026: "astra + painted arrows"), Modern and Classic.

Painted by Codex (game-art skill; prompts in m1/ and c1/ while the worktree lives; art-samples/.gitignore
keeps only scripts and notes):
- m1: 3x2 magenta sheet, Prev (top) and Next (bottom) in green, gold and blue in the Modern icon look
  (refs: the approved icons levelup, undo, redo, lastarmy, speedup, event, goals, retreat at 128 px, and a
  crop of the dock discs). Gold was picked: it reads on both the slate Modern disc and the brown Classic one,
  where blue sank into the slate and green read as "level up" (preview_discs.py).
- c1: the gold pair redrawn in the Classic look the way `goals` became `goalsclassic` (softer, no white rim,
  thin brown outline), cut with `--sat 0.88`.
Cut with the skill's cut_sheet.py; the `.full.png` cuts copied to large/<name>.png:
friendprev, friendnext (Modern), friendprevclassic, friendnextclassic (Classic).

This runs web/tools/game-icons/make.py without numpy (as goals-tab-icon/make_nonp.py) and adds 96 and
128 px files: the discs show the arrow at 40 px, which wants 120 px on a 3x phone, more than the usual
64 px top size (FriendHopButtons.ts adds them to the srcset).

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
make.SIDES = (16, 24, 32, 48, 64, 96, 128)
make.main(sys.argv[2], ["friendprev", "friendnext", "friendprevclassic", "friendnextclassic"])
