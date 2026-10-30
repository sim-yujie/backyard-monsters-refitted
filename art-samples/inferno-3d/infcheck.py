"""infcheck.py : Flash | 3D full render | overlay for the Inferno towers, at the same game place (a working check).

  python infcheck.py T H FRAME     -> render/tT/check.png   (3D heading H of 32 beside Flash frame FRAME)
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = Path("D:/Coding/BYMR/backyard-monsters-refitted/server/public/assets/buildings")   # read only
# buildingArtInfernoData.ts: the top (file, x, y) and the anim layers (file, x, y, w, h), 1x game px
FLASH = {1: ("icannontower", ("top.1.v2.png", -38, 11), [("anim.1.v2.png", -38, -53, 74, 64)]),
         2: ("isnipertower", ("top.1.v2.png", -35, -5), [("anim.1.v2.png", -56, -86, 85, 81)]),
         3: ("imagmatower", ("top.1.v2.png", -34, -9), [("anim.1.v2.png", -26, -50, 54, 42), ("anim.2.v2.png", -17, 26, 38, 19)])}
GROUND_GAME = {1: (0.0, 36.0), 2: (-2.0, 33.0), 3: (2.0, 30.0)}   # the 3D ground middle, game px (fitted on the Flash)
BODY_G = (320, 590)


def flash(t, frame, ox=80, oy=120):
    """The Flash tower at 1x, its origin at (ox, oy) on a 160 x 180 canvas."""
    folder, top, anims = FLASH[t]
    f = Image.new("RGBA", (160, 180))
    f.alpha_composite(Image.open(ASSETS / folder / top[0]).convert("RGBA"), (ox + top[1], oy + top[2]))
    for name, x, y, w, h in anims:
        s = Image.open(ASSETS / folder / name).convert("RGBA")
        f.alpha_composite(s.crop((frame * w, 0, (frame + 1) * w, h)), (ox + x, oy + y))
    return f


def main():
    t, h, fr = (int(a) for a in sys.argv[1:4])
    gx, gy = GROUND_GAME[t]
    im = Image.open(HERE / "render" / f"t{t}" / f"full-h{h:02d}.png").convert("RGBA")
    canvas = Image.new("RGBA", im.size)
    p = flash(t, fr)
    p = p.resize((p.width * 4, p.height * 4), Image.LANCZOS)
    canvas.alpha_composite(p, (round(BODY_G[0] - 4 * gx - 320), round(BODY_G[1] - 4 * gy - 480)))
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
    s = min(1.0, 1200 / g.width)
    g.convert("RGB").resize((int(g.width * s), int(g.height * s))).save(HERE / "render" / f"t{t}" / "check.png")


if __name__ == "__main__":
    main()
