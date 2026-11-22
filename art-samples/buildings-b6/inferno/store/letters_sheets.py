"""letters_sheets.py : the pictures of the weathered words (owner, 22 Nov), into shots/istore-letters/.
    ~/.cache/bymr-art-venv/bin/python letters_sheets.py
before/ holds the renders with the words whole (commit 1ef5792d7); e/render the light wear (the game's), e-heavy/render
the heavy wear (STORE_WEAR=heavy)."""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[3] / "shots" / "istore-letters"
BG = (74, 42, 36)
STATES = (("", "standing"), ("-damaged", "damaged"), ("-destroyed", "destroyed"))


def pic(folder, st):
    im = Image.open(folder / f"L1{st}-base.png").convert("RGBA")
    s = Image.new("RGBA", im.size, BG + (255,))
    s.alpha_composite(im)
    return s.convert("RGB")


def label(im, text, size=26):
    ImageDraw.Draw(im).text((14, 10), text, fill=(255, 236, 200), font_size=size)
    return im


def grid(rows, gap=8):
    w = max(sum(i.width for i in r) + gap * (len(r) - 1) for r in rows)
    h = sum(max(i.height for i in r) for r in rows) + gap * (len(rows) - 1)
    s = Image.new("RGB", (w, h), (20, 12, 10))
    y = 0
    for r in rows:
        x = 0
        for i in r:
            s.paste(i, (x, y))
            x += i.width + gap
        y += max(i.height for i in r) + gap
    return s


def scaled(im, k):
    return im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)


SETS = (("before", OUT / "before", "before: words whole"), ("light", HERE / "e" / "render", "LIGHT wear (in the game)"),
        ("heavy", HERE / "e-heavy" / "render", "HEAVY wear (sample)"))
FRONT = (150, 780, 1050, 1440)          # the cover's words and the ground before them, in the 12 px render
# 1. before | after, the front at full size (the render's own pixels) and enlarged 2x
b, a = pic(SETS[0][1], "").crop(FRONT), pic(SETS[1][1], "").crop(FRONT)
grid([[label(b, "before"), label(a, "after (light wear)")]]).save(OUT / "front-before-after-full.png")
W2 = (150, 880, 750, 1330)
b2, a2 = (pic(SETS[k][1], "").crop(W2).resize((1200, 900), Image.LANCZOS) for k in (0, 1))
grid([[label(b2, "before  (2x)"), label(a2, "after, light wear  (2x)")]]).save(OUT / "front-before-after-2x.png")
# 2. the three states side by side: before above, after below (6 px per Flash px)
grid([[label(scaled(pic(f, st), 0.5), f"{n}  {t}") for st, n in STATES] for _, f, t in SETS[:2]]
     ).save(OUT / "states-before-after.png")
grid([[label(scaled(pic(SETS[1][1], st), 0.5), n) for st, n in STATES]]).save(OUT / "states.png")
# 3. light | heavy: every state, and at the game's sizes (2x = a phone or zoomed in, 1x)
grid([[label(scaled(pic(f, st), 0.5), f"{t}  {n}") for _, f, t in SETS[1:]] for st, n in STATES]
     ).save(OUT / "light-vs-heavy.png")
rows = []
for _, f, t in SETS:
    im = pic(f, "")
    g2, g1 = scaled(im, 1 / 6), scaled(im, 1 / 12)
    tile = Image.new("RGB", (g2.width + g1.width + 20, g2.height), BG)
    tile.paste(g2, (0, 0))
    tile.paste(g1, (g2.width + 20, 40))
    rows.append(label(tile.resize((tile.width * 3, tile.height * 3), Image.NEAREST), t + ": game size 2x and 1x, shown 3x"))
grid([[r] for r in rows]).save(OUT / "game-size.png")
# 4. the dropped O in each state, full size
SPOT = {st: (180, 1150, 780, 1480) for st, _ in STATES}
grid([[label(pic(SETS[1][1], st).crop(SPOT[st]), n) for st, n in STATES]]).save(OUT / "fallen-letter-states.png")
print(OUT)
