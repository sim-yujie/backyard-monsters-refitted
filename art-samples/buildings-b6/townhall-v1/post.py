"""post.py : the Town Hall 3D sample pictures, from th.py's stills (render/) and the Flash art (fref.py).
Flash has a different picture for each of the 10 levels and no animation, so there are no loops to show.

    python post.py flash       work/flashK-L<n>.png   Flash (its ground shadow multiplied on grass, then the building)
                               at the stills' size, one per level, for levels_sheet.py
    python post.py sheet       townhall-levels.png    Flash above 3D, all 10 levels, one scale (levels_sheet.py)
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image

import fref

HERE = Path(__file__).resolve().parent
R = HERE / "render"
GRASS = (96, 140, 60)
SHEET = Path("D:/Coding/BYMR/worktrees/lead-skills-art/tools/art-check/levels_sheet.py")


def flash(level, size):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top), scaled up."""
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(fref.shadow_rgba(level).resize(size, Image.BICUBIC))
    out.alpha_composite(fref.flash_rgba(level).resize(size, Image.BICUBIC))
    return out


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "flash":
        for lv in range(1, 11):
            size = Image.open(R / f"L{lv}-base.png").size
            flash(lv, size).convert("RGB").save(HERE / "work" / f"flashK-L{lv}.png")
    if what == "sheet":
        subprocess.run([sys.executable, str(SHEET), "--flash", str(HERE / "work" / "flashK-L{lv}.png"),
                        "--model", str(R / "L{lv}-base.png"), "--levels", ",".join(map(str, range(1, 11))),
                        "--name", "Town Hall", "-o", str(HERE / "townhall-levels.png")] + sys.argv[2:], check=True)
