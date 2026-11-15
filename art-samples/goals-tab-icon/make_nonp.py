"""The Alliance window's Goals tab icon (owner, 15 Nov 2026), Modern and Classic.

Made with Codex (game-art skill, one image call, prompt.txt beside this file
while the worktree lives; the sheet, prompt and refs are not kept in git, as
art-samples/.gitignore keeps only scripts): a 3x2 magenta sheet, row 1 three
ideas in the Modern icon look (from web/public/ui/icons/*-64.webp), row 2 the
same three in the Classic look (from the Flash pop-up art
server/public/assets/popups/{completequest,military,loot,firstblood.v2}.png).
Column 1, the archery target with a gold arrow, was wired: `goals` (Modern)
and `goalsclassic` (Classic). Cut with the skill's cut_sheet.py
(`--cols 3 --rows 2 --names goals,goalsscroll,goalstrophy,goalsclassic,...`),
the `.full.png` cuts copied to large/<name>.png.

This runs web/tools/game-icons/make.py without numpy (not installed on the
WSL PC): Pillow's own premultiplied-alpha (RGBa) Lanczos resize stands in for
make.py's numpy one; fit, margin and sharpening are make.py's.

usage: python3 -I make_nonp.py <worktree>/web/tools/game-icons <folder holding large/> goals,goalsclassic
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
make.main(sys.argv[2], sys.argv[3].split(","))
