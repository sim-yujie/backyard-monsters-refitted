"""Cut the Codex star sheet into the game's star pictures (2x, transparent).

python make_stars.py <sheet> <outdir> [--dim-gamma 1.35]
Sheet: 3 cols (lit, dim, next) x 3 rows (options a, b, c) on magenta.
Writes per option: star-<o>-<state>@2x.png (80x80, body 40 px, glow baked in) and
star-<o>-<state>-small@2x.png (24x24 tight, no glow) for lit and dim.
"""
import sys, argparse
sys.path.insert(0, "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from PIL import Image, ImageFilter, ImageChops
import artlib

ap = argparse.ArgumentParser()
ap.add_argument("sheet"); ap.add_argument("out")
ap.add_argument("--dim-gamma", type=float, default=1.35)
ap.add_argument("--dim-sat", type=float, default=0.85)
ap.add_argument("--options", default="a,b,c")
args = ap.parse_args()

STATES = ["lit", "dim", "next"]
HI = 4            # work at 4x the final 2x size
SIZE = 80         # final 2x canvas
BODY = 40         # body height in the final canvas
SMALL = 24


def glow(alpha, radius, colour, strength):
    g = alpha.filter(ImageFilter.GaussianBlur(radius)).point(lambda p: min(255, int(p * strength)))
    layer = Image.new("RGBA", alpha.size, colour + (0,))
    layer.putalpha(g)
    return layer


def place(star, canvas, body):
    s = artlib.at_height(star, body) if star.height >= star.width else star.resize((body, max(1, round(star.height * body / star.width))), Image.LANCZOS)
    c = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    c.alpha_composite(s, ((canvas - s.width) // 2, (canvas - s.height) // 2))
    return c


def window(n):
    w = Image.new("L", (n, n)); px = w.load()
    for y in range(n):
        for x in range(n):
            d = ((x - n / 2 + .5) ** 2 + (y - n / 2 + .5) ** 2) ** .5 / (n / 2)
            px[x, y] = 255 if d < 0.8 else max(0, round(255 * (1 - (d - 0.8) / 0.2)))
    return w
WINDOW = window(SIZE * HI)

sheet = Image.open(args.sheet)
keyed = artlib.key(sheet)
cells = artlib.cells(keyed, 3, 3)
for r, opt in enumerate(args.options.split(",")):
    for c, state in enumerate(STATES):
        im = artlib.clean(cells[r * 3 + c])
        im = artlib.largest_blob_only(im)
        im = im.crop(im.getbbox())
        if state in ("dim", "next"):
            im = artlib.saturate(artlib.gamma(im, args.dim_gamma), args.dim_sat)
        big = place(im, SIZE * HI, BODY * HI)
        a = big.getchannel("A")
        base = Image.new("RGBA", big.size, (0, 0, 0, 0))
        if state == "lit":
            base.alpha_composite(glow(a, 6 * HI, (255, 200, 90), 1.1))
            base.alpha_composite(glow(a, 2.5 * HI, (255, 236, 170), 1.2))
        elif state == "next":
            base.alpha_composite(glow(a, 6 * HI, (255, 190, 60), 1.9))
            base.alpha_composite(glow(a, 2.5 * HI, (255, 225, 140), 1.4))
        else:
            base.alpha_composite(glow(a, 2.5 * HI, (150, 175, 255), 0.35))
        base.putalpha(ImageChops.multiply(base.getchannel('A'), WINDOW))
        base.alpha_composite(big)
        base.resize((SIZE, SIZE), Image.LANCZOS).save(f"{args.out}/star-{opt}-{state}@2x.png")
        if state != "next":
            place(im, SMALL * HI, SMALL * HI - 2 * HI).resize((SMALL, SMALL), Image.LANCZOS).save(f"{args.out}/star-{opt}-{state}-small@2x.png")
print("ok")
