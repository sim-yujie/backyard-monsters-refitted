"""sqcheck.py : painted tier | 3D full render(s), side by side on flat green, at the same game place (a working check).

  python sqcheck.py <tower folder> <assets folder> TIER H [H ...]    -> <tower folder>/render/tT/check.png

The painted whole picture is top.tT@2x.webp at its row in buildingArtTiers.ts (TOPS below); the 3D render's ground middle
is square3d.GROUND, on pixel BODY_CANVAS[2:] of its 4x canvas.
"""
import sys
from pathlib import Path

from PIL import Image

ASSETS = Path("D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/buildings")   # read only
TOPS = {"flaktower": {1: (-39, -15), 2: (-39, -20), 3: (-39, -31)},
        "railguntower": {1: (-36, -1), 2: (-36, -12), 3: (-36, -23)}}
GX, GY, GAME_GY = 320, 430, 37.5


def main():
    here, folder, t = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
    x, y = TOPS[folder][t]
    p = Image.open(ASSETS / folder / f"top.t{t}@2x.webp").convert("RGBA")
    p = p.resize((p.width * 2, p.height * 2), Image.LANCZOS)
    ims = [Image.open(here / "render" / f"t{t}" / f"full-h{int(h):02d}.png").convert("RGBA") for h in sys.argv[4:]]
    canvas = Image.new("RGBA", ims[0].size)
    canvas.alpha_composite(p, (round(GX + 4 * x), round(GY + 4 * (y - GAME_GY))))
    over = ims[0].copy()
    pa = canvas.copy()
    pa.putalpha(pa.getchannel("A").point(lambda v: v * 0.55))
    over.alpha_composite(pa)
    row = [canvas] + ims + [over]
    bb = None
    for im in row:
        b = im.getbbox()
        bb = b if bb is None else (min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3]))
    bb = (bb[0] - 8, bb[1] - 8, bb[2] + 8, bb[3] + 8)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    g = Image.new("RGBA", (w * len(row), h), (96, 140, 70, 255))
    for i, im in enumerate(row):
        g.alpha_composite(im.crop(bb), (i * w, 0))
    s = min(1.0, 1600 / g.width)
    g.convert("RGB").resize((int(g.width * s), int(g.height * s)), Image.LANCZOS).save(here / "render" / f"t{t}" / "check.png")


main()
