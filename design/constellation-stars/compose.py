"""Option sheets: a Wormzer constellation card as the tab draws it (faint monster, lines, stars,
price tag, star-count row), full / partly lit / unlit, for the current dots and each star option.

python compose.py <stars dir> <out dir> [--options a,b,c]
"""
import sys, argparse, math
sys.path.insert(0, "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import artlib

ap = argparse.ArgumentParser()
ap.add_argument("stars"); ap.add_argument("out")
ap.add_argument("--options", default="a,b,c")
ap.add_argument("--lit-size", type=float, default=26)
ap.add_argument("--dim-size", type=float, default=21)
ap.add_argument("--next-size", type=float, default=28)
ap.add_argument("--prefix", default="")
args = ap.parse_args()

WEB = "C:/Coding/BYMR/worktrees/star-art/web/public"
STARS = [(95, 24), (95, 45), (52, 85), (45, 118), (73, 142), (97, 100), (133, 127), (178, 100), (145, 70), (125, 55)]
LINES = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 6), (6, 7), (7, 8), (8, 9), (9, 1), (1, 5)]
FW, FH = 200, 170
SS = 4  # supersample


def sky(w, h):
    im = Image.new("RGB", (w, h))
    px = im.load()
    a, b, c = (0x22, 0x34, 0x6e), (0x12, 0x1b, 0x3d), (0x0a, 0x10, 0x28)
    for y in range(h):
        for x in range(w):
            dd = min(1, math.hypot((x - w / 2) / (w * 0.9), y / (h * 1.6)))
            if dd < 0.55:
                t, p, q = dd / 0.55, a, b
            else:
                t, p, q = (dd - 0.55) / 0.45, b, c
            px[x, y] = tuple(round(p[i] + (q[i] - p[i]) * t) for i in range(3))
    return im.convert("RGBA")


def monster(w, h):
    pic = Image.open(f"{WEB}/portraits/C13.webp").convert("RGBA")
    s = min(w / pic.width, h / pic.height)
    pic = pic.resize((round(pic.width * s), round(pic.height * s)), Image.LANCZOS)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    layer.alpha_composite(pic, ((w - pic.width) // 2, (h - pic.height) // 2))
    mask = Image.new("L", (w, h))
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            dd = math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2))
            mp[x, y] = 255 if dd <= 0.55 else max(0, round(255 * (1 - (dd - 0.55) / 0.45)))
    al = ImageChops.multiply(layer.getchannel("A"), mask).point(lambda p: round(p * 0.28))
    layer.putalpha(al)
    return layer


ART = {}
def art(opt, state, px):
    k = (opt, state, px)
    if k not in ART:
        ART[k] = Image.open(f"{args.stars}/star-{opt}-{state}@2x.png").resize((px, px), Image.LANCZOS)
    return ART[k]


def card(opt, lit, nxt, width):
    """opt None = today's dots. width in output px."""
    k = width / FW
    W, H = round(FW * k), round(FH * k)
    big = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    K = k * SS
    d = ImageDraw.Draw(big)
    glowl = Image.new("RGBA", big.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glowl)
    for a, b in LINES:
        on = a < lit and b < lit
        p1 = (STARS[a][0] * K, STARS[a][1] * K)
        p2 = (STARS[b][0] * K, STARS[b][1] * K)
        if opt is None:
            d.line([p1, p2], fill=(255, 212, 90, 255) if on else (200, 210, 255, 64), width=round((2 if on else 1.5) * K))
        elif on:
            gd.line([p1, p2], fill=(255, 200, 90, 200), width=round(5 * K))
            d.line([p1, p2], fill=(255, 226, 140, 255), width=round(1.8 * K))
        else:
            d.line([p1, p2], fill=(170, 190, 255, 50), width=round(1.2 * K))
    if opt is not None:
        glowl = glowl.filter(ImageFilter.GaussianBlur(2.5 * K))
        glowl.alpha_composite(big)
        big = glowl
        d = ImageDraw.Draw(big)
    for i, (x, y) in enumerate(STARS):
        state = "lit" if i < lit else "next" if i == nxt else "dim"
        if opt is None:
            if state == "next":
                r = 9 * K
                for t in range(0, 360, 30):
                    d.arc([x * K - r, y * K - r, x * K + r, y * K + r], t, t + 15, fill=(255, 212, 90, 255), width=round(1.5 * K))
            r = (5 if state == "lit" else 3.5) * K
            col = {"lit": (255, 212, 90, 255), "next": (255, 244, 200, 255), "dim": (200, 210, 255, 115)}[state]
            d.ellipse([x * K - r, y * K - r, x * K + r, y * K + r], fill=col)
        else:
            size = {"lit": args.lit_size, "dim": args.dim_size, "next": args.next_size}[state]
            px = round(size * K)
            big.alpha_composite(art(opt, state, px), (round(x * K - px / 2), round(y * K - px / 2)))
    if nxt is not None:
        x, y = STARS[nxt]
        ty = (y + 22 if y < 30 else y - 16) if opt is None else (y + 24 if y < 32 else y - 19)
        tx = min(max(x, 23), FW - 23)
        d.rounded_rectangle([(tx - 22) * K, (ty - 11) * K, (tx + 22) * K, (ty + 7) * K], radius=9 * K, fill=(232, 118, 28, 255))
        from PIL import ImageFont
        f = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", round(12 * K))
        fs = ImageFont.truetype("C:/Windows/Fonts/seguisym.ttf", round(12 * K))
        sw, nw = d.textlength("\u2605", font=fs), d.textlength("25", font=f)
        x0 = tx * K - (sw + nw) / 2
        d.text((x0, (ty - 2) * K), "\u2605", font=fs, fill="white", anchor="lm")
        d.text((x0 + sw, (ty - 2) * K), "25", font=f, fill="white", anchor="lm")
    small = big.resize((W, H), Image.LANCZOS)
    out = sky(W, H)
    out.alpha_composite(monster(W, H))
    out.alpha_composite(small)
    return out


def count_row(opt, lit, scale):
    """The 5 x 2 star-count row under a name (top then bottom of each column)."""
    cell = round((10 if opt else 5) * scale)
    gap = round((0 if opt else 2) * scale)
    w, h = 5 * cell + 4 * gap, 2 * cell + gap
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for s in range(10):
        cx, cy = (s // 2) * (cell + gap), (s % 2) * (cell + gap)
        if opt is None:
            d.ellipse([cx, cy, cx + cell - 1, cy + cell - 1], fill=(255, 212, 90, 255) if s < lit else (200, 210, 255, 77))
        else:
            src = Image.open(f"{args.stars}/star-{opt}-{'lit' if s < lit else 'dim'}-small@2x.png")
            im.alpha_composite(src.resize((cell, cell), Image.LANCZOS), (cx, cy))
    return im


def plate(opt, lit, width, scale):
    im = sky(width, round(26 * scale))
    d = ImageDraw.Draw(im)
    f = artlib.font(round(11 * scale))
    row = count_row(opt, lit, scale)
    tw = d.textlength("Wormzer", font=f)
    vw = d.textlength("+8%", font=f)
    total = tw + vw + row.width + 8 * scale
    x = (width - total) / 2
    cy = im.height / 2
    d.text((x, cy), "Wormzer", font=f, fill=(232, 236, 255), anchor="lm")
    im.alpha_composite(row, (round(x + tw + 4 * scale), round(cy - row.height / 2)))
    d.text((x + tw + row.width + 8 * scale, cy), "+8%", font=f, fill=(127, 224, 143), anchor="lm")
    return im


def full(opt, lit, nxt, scale):
    w = round(170 * scale)
    c = card(opt, lit, nxt, w)
    p = plate(opt, lit, w, scale)
    out = Image.new("RGBA", (w, c.height + p.height), (10, 16, 40, 255))
    out.alpha_composite(c, (0, 0))
    out.alpha_composite(p, (0, c.height))
    return out


STATES = [("All 10 lit", 10, None), ("4 lit, next", 4, 4), ("None lit", 0, 0)]
opts = [None] + args.options.split(",")
name = lambda o: "Today (dots)" if o is None else f"Option {o.upper()}"

cols = [[(f"{name(o)}: {t}", full(o, l, n, 1)) for t, l, n in STATES] for o in opts]
items = [cols[c][r] for r in range(len(STATES)) for c in range(len(opts))]
artlib.grid(items, len(opts), bg=artlib.LIGHT, gap=18, fsize=13).save(f"{args.out}/{args.prefix}options-real-size.png")
for o in opts:
    its = [(f"{name(o)}: {t} (3x)", full(o, l, n, 3)) for t, l, n in STATES]
    fn = "today" if o is None else "option-" + o
    artlib.grid(its, 3, bg=artlib.LIGHT, gap=24, fsize=22).save(f"{args.out}/{args.prefix}{fn}-3x.png")
print("ok")
