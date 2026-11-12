"""Option sheets for the realistic stars: Wormzer's card as the tab draws it, all lit /
partly lit / none lit, for the first painted try (A) and the real-sky options r1-r3.

python compose_real.py <out dir>
"""
import sys, math
sys.path.insert(0, "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont
import artlib

OUT = sys.argv[1]
HERE = "C:/Coding/BYMR/worktrees/star-art/design/constellation-stars"
WEB = "C:/Coding/BYMR/worktrees/star-art/web/public"
STARS = [(95, 24), (95, 45), (52, 85), (45, 118), (73, 142), (97, 100), (133, 127), (178, 100), (145, 70), (125, 55)]
LINES = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 6), (6, 7), (7, 8), (8, 9), (9, 1), (1, 5)]
FW, FH = 200, 170
SS = 4
# Each star's colour, by its number (blue-white, white, pale gold), as the game does.
TINT = ["white", "blue", "white", "gold", "blue", "white", "gold", "blue", "white", "gold"]
# Box units per picture (the card is 200 units across ~170 css px): 128 px pictures = 47 units.
REAL = {"lit": 47, "next": 47, "dim": 23.5}
PAINTED = {"lit": 32, "next": 34, "dim": 26}
TRIM = 6  # real lines stop short of each star, like a star map


def sky(w, h):
    im = Image.new("RGB", (w, h))
    px = im.load()
    a, b, c = (0x22, 0x34, 0x6e), (0x12, 0x1b, 0x3d), (0x0a, 0x10, 0x28)
    for y in range(h):
        for x in range(w):
            dd = min(1, math.hypot((x - w / 2) / (w * 0.9), y / (h * 1.6)))
            t, p, q = (dd / 0.55, a, b) if dd < 0.55 else ((dd - 0.55) / 0.45, b, c)
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
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask).point(lambda p: round(p * 0.28)))
    return layer


CACHE = {}
def pic(path, px):
    k = (path, px)
    if k not in CACHE:
        CACHE[k] = Image.open(path).convert("RGBA").resize((px, px), Image.LANCZOS)
    return CACHE[k]


def star_file(opt, state, i):
    opt = "r1" if opt == "r1d" else opt
    if opt == "a":
        return f"{HERE}/out1/star-a-{state}@2x.png"
    if state == "lit":
        return f"{HERE}/real/out/star-{opt}-lit-{TINT[i]}@2x.png"
    return f"{HERE}/real/out/star-{opt}-{state}@2x.png"


def small_file(opt, on):
    opt = "r1" if opt == "r1d" else opt
    if opt == "a":
        return f"{HERE}/out1/star-a-{'lit' if on else 'dim'}-small@2x.png"
    return f"{HERE}/real/out/star-{opt}-{'lit' if on else 'dim'}-small@2x.png"


def card(opt, lit, nxt, width):
    k = width / FW
    W, H = round(FW * k), round(FH * k)
    K = k * SS
    big = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    glow = Image.new("RGBA", big.size, (0, 0, 0, 0))
    d, gd = ImageDraw.Draw(big), ImageDraw.Draw(glow)
    for a, b in LINES:
        on = a < lit and b < lit
        (x1, y1), (x2, y2) = STARS[a], STARS[b]
        if opt != "a":
            ln = math.hypot(x2 - x1, y2 - y1)
            t = min(TRIM / ln, 0.4)
            x1, y1, x2, y2 = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, x2 - (x2 - x1) * t, y2 - (y2 - y1) * t
        p = [(x1 * K, y1 * K), (x2 * K, y2 * K)]
        if opt == "a":
            if on:
                gd.line(p, fill=(255, 200, 90, 200), width=round(5 * K))
                d.line(p, fill=(255, 226, 140, 255), width=round(1.8 * K))
            else:
                d.line(p, fill=(170, 190, 255, 50), width=round(1.2 * K))
        elif on:
            gd.line(p, fill=(255, 225, 170, 170), width=round(3.5 * K))
            d.line(p, fill=(255, 244, 222, 205), width=round(0.9 * K))
        else:
            d.line(p, fill=(170, 190, 255, 38), width=round(0.8 * K))
    glow = glow.filter(ImageFilter.GaussianBlur(2.2 * K))
    glow.alpha_composite(big)
    big = glow
    d = ImageDraw.Draw(big)
    sizes = PAINTED if opt == "a" else REAL
    for i, (x, y) in enumerate(STARS):
        state = "lit" if i < lit else "next" if i == nxt else "dim"
        px = round(sizes[state] * K)
        big.alpha_composite(pic(star_file(opt, state, i), px), (round(x * K - px / 2), round(y * K - px / 2)))
    if nxt is not None:
        x, y = STARS[nxt]
        ty = y + 24 if y < 32 else y - 19
        tx = min(max(x, 23), FW - 23)
        d.rounded_rectangle([(tx - 22) * K, (ty - 11) * K, (tx + 22) * K, (ty + 7) * K], radius=9 * K, fill=(232, 118, 28, 255))
        f = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", round(12 * K))
        fs = ImageFont.truetype("C:/Windows/Fonts/seguisym.ttf", round(12 * K))
        sw, nw = d.textlength("\u2605", font=fs), d.textlength("25", font=f)
        x0 = tx * K - (sw + nw) / 2
        d.text((x0, (ty - 2) * K), "\u2605", font=fs, fill="white", anchor="lm")
        d.text((x0 + sw, (ty - 2) * K), "25", font=f, fill="white", anchor="lm")
    out = sky(W, H)
    if opt in ("r3", "r1d"):
        out.alpha_composite(Image.open(f"{HERE}/real/out/dust@2x.png").resize((W, H), Image.LANCZOS))
    out.alpha_composite(monster(W, H))
    out.alpha_composite(big.resize((W, H), Image.LANCZOS))
    return out


def count_row(opt, lit, scale, cell_css=10):
    cell = round(cell_css * scale)
    im = Image.new("RGBA", (5 * cell, 2 * cell), (0, 0, 0, 0))
    for s in range(10):
        im.alpha_composite(pic(small_file(opt, s < lit), cell), ((s // 2) * cell, (s % 2) * cell))
    return im


def plate(opt, lit, width, scale):
    im = sky(width, round(26 * scale))
    d = ImageDraw.Draw(im)
    f = artlib.font(round(11 * scale))
    row = count_row(opt, lit, scale)
    tw, vw = d.textlength("Wormzer", font=f), d.textlength("+8%", font=f)
    x = (width - (tw + vw + row.width + 8 * scale)) / 2
    cy = im.height / 2
    d.text((x, cy), "Wormzer", font=f, fill=(232, 236, 255), anchor="lm")
    im.alpha_composite(row, (round(x + tw + 4 * scale), round(cy - row.height / 2)))
    d.text((x + tw + row.width + 8 * scale, cy), "+8%", font=f, fill=(127, 224, 143), anchor="lm")
    return im


def full(opt, lit, nxt, scale):
    w = round(170 * scale)
    c, p = card(opt, lit, nxt, w), plate(opt, lit, w, scale)
    out = Image.new("RGBA", (w, c.height + p.height), (10, 16, 40, 255))
    out.alpha_composite(c, (0, 0))
    out.alpha_composite(p, (0, c.height))
    return out


def top_bar(opt, scale):
    """The top bar's rows of 8 px stars, 4 constellations: 10, 3, 0, 6 lit."""
    rows = [count_row(opt, n, scale, 8) for n in (10, 3, 0, 6)]
    gap = round(8 * scale)
    w = sum(r.width for r in rows) + gap * 5
    im = sky(w, rows[0].height + 2 * gap)
    x = gap
    for r in rows:
        im.alpha_composite(r, (x, gap))
        x += r.width + gap
    return im


STATES = [("all 10 lit", 10, None), ("4 lit, next", 4, 4), ("none lit", 0, 0)]
OPTS = ["a", "r1", "r2", "r3", "r1d"]
NAME = {"a": "First try A (painted)", "r1": "R1: 4 rays", "r2": "R2: 6 rays (Webb)", "r3": "R3: soft bloom + star dust", "r1d": "R1 + star dust (chosen)"}

items = [(f"{NAME[o]}: {t}", full(o, l, n, 1)) for t, l, n in STATES for o in OPTS]
artlib.grid(items, len(OPTS), bg=artlib.LIGHT, gap=18, fsize=13).save(f"{OUT}/real-options-real-size.png")
for o in OPTS[1:]:
    its = [(f"{NAME[o]}: {t} (3x)", full(o, l, n, 3)) for t, l, n in STATES]
    artlib.grid(its, 3, bg=artlib.LIGHT, gap=24, fsize=22).save(f"{OUT}/real-{o}-3x.png")
# The count rows alone at real size and 4x: they must read at 8-10 px.
rows = []
for o in OPTS:
    rows.append((f"{NAME[o]}: top bar at 8 px, real size", top_bar(o, 1)))
    rows.append((f"{NAME[o]}: same at 4x", top_bar(o, 4)))
artlib.grid(rows, 2, bg=artlib.LIGHT, gap=18, fsize=13).save(f"{OUT}/real-count-rows.png")
print("ok")
