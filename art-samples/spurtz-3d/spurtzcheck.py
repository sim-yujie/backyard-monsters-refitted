"""spurtzcheck.py : Flash | 3D full render | overlay, at the same game place (a working check).

  python spurtzcheck.py T H FRAME     -> render/tT/check.png   (3D heading H of 32 beside Flash frame FRAME)

The Flash picture is normal_base.png plus a cell of top-normal-anim.v2.png at their rows in buildingArtData.ts; the 3D
render's ground middle (GROUND_GAME below, game px from the building's origin) is on pixel (320, 430) of its 4x canvas.
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = Path("D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/buildings")   # read only
FOLDER = {1: "spurtztower", 2: "blackspurtztower"}
BASE_AT, TOP_AT, CELL = (-39, -35), (-27, -57), (54, 42)   # buildingArtData.ts 136/137 (cells are 54 wide in the files)
GROUND_GAME = {1: (-1.5, 33.0), 2: (-1.5, 33.0)}            # where the 3D ground middle sits (fitted to the Flash base)


def flash(t, frame):
    """The Flash tower at 1x, its origin at (60, 80) on a 120 x 140 canvas."""
    f = Image.new("RGBA", (120, 140))
    folder = ASSETS / FOLDER[t]
    f.alpha_composite(Image.open(folder / "normal_base.png").convert("RGBA"), (60 + BASE_AT[0], 80 + BASE_AT[1]))
    s = Image.open(folder / "top-normal-anim.v2.png").convert("RGBA")
    f.alpha_composite(s.crop((frame * CELL[0], 0, (frame + 1) * CELL[0], s.height)), (60 + TOP_AT[0], 80 + TOP_AT[1]))
    return f


def main():
    t, h, fr = (int(a) for a in sys.argv[1:4])
    gx, gy = GROUND_GAME[t]
    im = Image.open(HERE / "render" / f"t{t}" / f"full-h{h:02d}.png").convert("RGBA")
    canvas = Image.new("RGBA", im.size)
    p = flash(t, fr)
    p = p.resize((p.width * 4, p.height * 4), Image.LANCZOS)
    canvas.alpha_composite(p, (round(320 - 4 * gx - 240), round(430 - 4 * gy - 320)))
    over = im.copy()
    pa = canvas.copy()
    pa.putalpha(pa.getchannel("A").point(lambda v: v * 0.55))
    over.alpha_composite(pa)
    row = [canvas, im, over]
    bb = None
    for x in row:
        b = x.getbbox()
        bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
    bb = (bb[0] - 8, bb[1] - 8, bb[2] + 8, bb[3] + 8)
    w, hh = bb[2] - bb[0], bb[3] - bb[1]
    g = Image.new("RGBA", (w * 3, hh), (96, 140, 70, 255))
    for i, x in enumerate(row):
        g.alpha_composite(x.crop(bb), (i * w, 0))
    g.convert("RGB").save(HERE / "render" / f"t{t}" / "check.png")


if __name__ == "__main__":
    main()
