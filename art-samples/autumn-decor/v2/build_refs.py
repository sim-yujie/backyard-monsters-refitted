"""Flash decoration reference sheets for the autumn decorations, round 2.

All pictures are the game's own Flash decoration art (server/public/assets/
buildings/decorations/*/top*.png), nothing made up.

Output (art-samples/autumn-decor/v2/refs/):
  flash-decor-1x-2x.png    owner sheet: 34 Flash decorations at real size, then at 2x, labelled
  ref-flash-all-3x.png     for Codex: the same 34 at 3x on yard green, no labels
  ref-flash-close-4x.png   for Codex: the nearest relatives (plants, wood, stump, harvest) at 4x
  ref-flash-large.png      for Codex: the largest Flash renders (Giant Pumpkin, Tea Garden, Zen Garden) at 1.5x
Usage: python build_refs.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
DECOR = os.path.join(ROOT, "server", "public", "assets", "buildings", "decorations")
OUT = os.path.join(HERE, "refs")
GRASS = (98, 140, 62)
LIGHT = (236, 232, 222)
INK = (30, 26, 20)

ALL = [
    ("Scarecrow", "scarecrow/top.png"), ("D.A.V.E. Pumpkin", "pumpkins/attended-large-top.png"),
    ("Mini-Pumpkin", "pumpkins/attended-small-top.png"), ("Pumpkin", "pumpkins/top.png"),
    ("Acorn", "acorn/top.png"), ("Pinecone", "pinecone/top.png"), ("Walnut", "walnut/top.png"),
    ("Blackberry Bush", "blackberrybush/top.png"), ("Bonsai Tree", "bonsaitree/top.png"),
    ("Thorns", "thorns/top.png"), ("Flytrap", "flytrap/top.png"), ("Cactus", "cactus/top.png"),
    ("Flowers red", "flowers/top-red.png"), ("Flowers yellow", "flowers/top-yellow.png"),
    ("Flowers purple", "flowers/top-purple.png"), ("Beehive", "beehive/top.png"),
    ("Birdhouse", "birdhouse/top.png"), ("Outhouse", "outhouse/top.png"), ("Sign", "signs/top.png"),
    ("Tiki Torch", "tikitorch/top.png"), ("Lawn Chair", "lawnchair/top.png"), ("Hammock", "hammock/top.png"),
    ("Camping Tent", "campingtent/top.png"), ("Sundial", "sundial/top.png"),
    ("Tombstone", "graveyardtombstone/top.png"), ("Gnome", "gnomes/top-red.png"), ("Rock", "rock/top.png"),
    ("Head on Stick", "headsonsticks/top-skull.png"), ("Jax Ball", "childrensjaxball/top.png"),
    ("Rubik's Cube", "rubikscube/top-unsolved.png"), ("Soccer Statue", "statue-soccer/top.v2.png"),
    ("Totem", "wmitotem/top1.png"), ("Pond", "pond/top.png"), ("Zen Garden", "zengarden/top.png"),
]
CLOSE = ["bonsaitree/top.png", "blackberrybush/top.png", "thorns/top.png", "flowers/top-red.png",
         "scarecrow/top.png", "beehive/top.png", "birdhouse/top.png", "outhouse/top.png", "signs/top.png",
         "pumpkins/attended-large-top.png", "pumpkins/top.png", "acorn/top.png", "pinecone/top.png",
         "walnut/top.png", "lawnchair/top.png", "graveyardtombstone/top.png"]
LARGE = ["pumpkins/large-top-1.png", "japaneseteagarden/top.png", "zengarden/top.png"]


def font(size):
    for f in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def load(p):
    im = Image.open(os.path.join(DECOR, p)).convert("RGBA")
    return im.crop(im.getbbox())


def scale(im, z, nearest=False):
    return im.resize((round(im.width * z), round(im.height * z)), Image.NEAREST if nearest else Image.LANCZOS)


def grid(items, width, bg, gap, labels=None, f=None):
    """Shelf layout: items left to right until the row is `width` wide, rows share a baseline."""
    labels = labels or [""] * len(items)
    lh = 22 if f else 0
    cw = [max(im.width, int(f.getlength(t)) + 6 if f else 0) for im, t in zip(items, labels)]
    rows, cur, x = [], [], gap
    for i, w in enumerate(cw):
        if cur and x + w + gap > width:
            rows.append(cur); cur, x = [], gap
        cur.append(i); x += w + gap
    rows.append(cur)
    W = max(gap + sum(cw[i] + gap for i in r) for r in rows)
    heights = [max(items[i].height for i in r) for r in rows]
    out = Image.new("RGBA", (W, sum(heights) + len(rows) * (gap + lh) + gap), bg + (255,))
    d = ImageDraw.Draw(out)
    y = gap
    for r, h in zip(rows, heights):
        x = gap + (W - (gap + sum(cw[i] + gap for i in r))) // 2
        for i in r:
            im = items[i]
            out.alpha_composite(im, (x + (cw[i] - im.width) // 2, y + h - im.height))
            if f:
                d.text((x + cw[i] // 2, y + h + 3), labels[i], fill=INK, font=f, anchor="ma")
            x += cw[i] + gap
        y += h + gap + lh
    return out


def titled(title, body, bg=LIGHT):
    f = font(26)
    out = Image.new("RGBA", (max(body.width, int(f.getlength(title)) + 32), body.height + 44), bg + (255,))
    ImageDraw.Draw(out).text((16, 8), title, fill=INK, font=f)
    out.alpha_composite(body, (0, 44))
    return out


def stack(parts, gap=12):
    out = Image.new("RGBA", (max(p.width for p in parts), sum(p.height for p in parts) + gap * (len(parts) - 1)), LIGHT + (255,))
    y = 0
    for p in parts:
        out.alpha_composite(p, (0, y))
        y += p.height + gap
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    ims = [load(p) for _, p in ALL]
    names = [n for n, _ in ALL]
    f = font(13)
    one = grid(ims, 1400, GRASS, 12, names, f)
    two = grid([scale(i, 2, True) for i in ims], 1800, GRASS, 16, names, font(16))
    stack([titled(f"Flash decorations at real in-game size (1x), {len(ims)} of them", one),
           titled("The same at 2x (pixels doubled, nothing smoothed)", two)]).convert("RGB").save(
        os.path.join(OUT, "flash-decor-1x-2x.png"))
    grid([scale(i, 3) for i in ims], 1800, GRASS, 24).convert("RGB").save(os.path.join(OUT, "ref-flash-all-3x.png"))
    grid([scale(load(p), 4) for p in CLOSE], 1600, GRASS, 28).convert("RGB").save(os.path.join(OUT, "ref-flash-close-4x.png"))
    grid([scale(load(p), 1.5) for p in LARGE], 2000, GRASS, 24).convert("RGB").save(os.path.join(OUT, "ref-flash-large.png"))
    for n in os.listdir(OUT):
        print(n, Image.open(os.path.join(OUT, n)).size)


if __name__ == "__main__":
    main()
