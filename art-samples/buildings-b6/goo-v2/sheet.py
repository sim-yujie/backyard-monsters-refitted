"""sheet.py : the art-check sheet and crops of the Goo Factory 3D v2 (work/tools/levels_sheet.py).

    python sheet.py            work/sheet/goo-v2-sheet.png (Flash above 3D, L1/3/6/10, one scale, red marks on the
                               mounts every level shares) and work/sheet/<area>-crop.png for each risky area below
Flash and 3D are frame 0 with their ground shadows (laid on grass by the tool), at the render's scale (K=12).
"""
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image

import post
import stack as S

HERE = Path(__file__).resolve().parent
OUT = HERE / "work/sheet"
LEVELS = (1, 3, 6, 10)
FRAME0 = (-44, -64)             # goo2.FRAME's top left, Flash px
K = 12
SX, SY, SZ = 10 * math.cos(math.radians(45)), 10 * math.sin(math.radians(45)) * math.sin(math.radians(30)), \
    10 * math.cos(math.radians(30))
# risky areas, x,y,w,h in Flash px (converted to render px)
CROPS = {
    "funnel-vanes": (-28, -32, 52, 22),       # funnel, collar, vanes, straps at the collar
    "post-tops": (-30, -12, 60, 24),          # straps onto the post tops, dome edge, top ring
    "pump-joint": (-2, 8, 24, 36),            # the right pump into the vat with its flange, the table
    "left-side": (-40, -14, 26, 66),          # level 6 loop through the plate, level 10 arc and short pipe
    "back-loops": (2, -64, 34, 54),           # level 6 loop, level 10 staircase loops into the dome
    "tower-cap": (-38, -54, 24, 30),          # level 10 tower, its goo cap, its branch into the dome
    "feet": (-36, 26, 82, 32),                # stumps, post feet, pipe feet, level 10 low front pipe
}


def scr(v):
    return (S.ORIGIN[0] + SX * (v[0] + v[1]), S.ORIGIN[1] + SY * (v[0] - v[1]) - SZ * v[2])


def rpx(x, y):
    return round((x - FRAME0[0]) * K), round((y - FRAME0[1]) * K)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for lv in LEVELS:
        m = post.frame3d(lv, 0)
        m.save(OUT / f"model-L{lv}.png")                    # see-through round the building: the sheet crops to it
        f = Image.new("RGBA", m.size)
        f.alpha_composite(post.fref.shadow_rgba(lv).resize(m.size, Image.BICUBIC))
        f.alpha_composite(post.fref.flash_rgba(lv, 0).resize(m.size, Image.BICUBIC))
        f.save(OUT / f"flash-L{lv}.png")
    marks = []
    for name, v in S.mounts(1).items():
        x, y = rpx(*scr(v))
        marks += ["--mark", f"{x},{y},{name}"]
    tool = HERE / "work/tools/levels_sheet.py"
    base = [sys.executable, str(tool), "--flash", str(OUT / "flash-L{lv}.png"), "--model", str(OUT / "model-L{lv}.png"),
            "--levels", ",".join(map(str, LEVELS)), "--name", "Goo Factory 3D v2"] + marks
    subprocess.run(base + ["-o", str(OUT / "goo-v2-sheet.png")], check=True)
    for name, (x, y, w, h) in CROPS.items():
        if len(sys.argv) > 1 and name not in sys.argv[1:]:
            continue
        cx, cy = rpx(x, y)
        subprocess.run(base + ["-o", str(OUT / f"{name}.png"), "--crop", f"{cx},{cy},{w * K},{h * K}", "--zoom", "1"],
                       check=True)
        (OUT / f"{name}.png").unlink()       # the same sheet again; only its -crop is wanted


if __name__ == "__main__":
    main()
