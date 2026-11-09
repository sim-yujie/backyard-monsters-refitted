"""Autumn decorations round 2 (Flash style): cuts the Codex sheets up and builds the review sheets.

Inputs: Codex sheets on flat magenta in r*/ (made by ../run-codex.sh from each folder's prompt.txt,
with refs/ref-flash-*.png as the reference pictures). PICKS says which cell of which sheet is used.
Output:
  out/<name>.png            the decoration at real in-game size (1x, like Flash's top.png)
  out/<name>@2x.png         the same at 2x
  ../../../shots/autumn-v2/<name>-compare.png   new one between Flash decorations of similar size,
                            at in-game size and at 3x
  ../../../shots/autumn-v2/autumn-v2-compare.png all six of those in one sheet
  ../../../shots/autumn-v2/autumn-v1-vs-v2.png   rejected version beside the new one, 3x
Usage: python build_v2.py
"""
import importlib.util
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(HERE, "out")
SHOTS = os.path.join(ROOT, "shots", "autumn-v2")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tg = _load("tg_build", os.path.join(HERE, "..", "..", "thanksgiving", "build_art.py"))
refs = _load("build_refs", os.path.join(HERE, "build_refs.py"))
GRASS, LIGHT, INK, font = refs.GRASS, refs.LIGHT, refs.INK, refs.font

# name, label, (sheet, cols, rows, cell), in-game height (px), Flash neighbours of similar size,
# rejected v1 cut-out (2x art) or None
PICKS = [
    ("turkey-topiary", "Turkey Topiary", ("r2/autumn-v2-r2.png", 2, 2, 2), 54,
     ["flowers/top-red.png", "blackberrybush/top.png", "bonsaitree/top.png"], "turkey-topiary@2x.png"),
    ("harvest-wheelbarrow", "Harvest Wheelbarrow", ("r1/autumn-v2-r1.png", 3, 2, 1), 46,
     ["lawnchair/top.png", "pumpkins/attended-large-top.png", "hammock/top.png"], "harvest-wheelbarrow@2x.png"),
    ("autumn-maple", "Autumn Maple Tree", ("r2/autumn-v2-r2.png", 2, 2, 0), 80,
     ["bonsaitree/top.png", "scarecrow/top.png", "birdhouse/top.png"], "autumn-maple@2x.png"),
    ("leaf-pile-rake", "Leaf Pile and Rake", ("r2/autumn-v2-r2.png", 2, 2, 1), 40,
     ["thorns/top.png", "walnut/top.png", "sundial/top.png"], "leaf-pile-rake@2x.png"),
    ("apple-barrel", "Apple Barrel", ("r1/autumn-v2-r1.png", 3, 2, 4), 44,
     ["beehive/top.png", "outhouse/top.png", "flowers/top-yellow.png"], None),
    ("pie-stump", "Pie on a Tree Stump", ("r2/autumn-v2-r2.png", 2, 2, 3), 36,
     ["beehive/top.png", "acorn/top.png", "pumpkins/top.png"], None),
]
NAMES = {p: n for n, p in refs.ALL}  # Flash path -> name


# Tone tweak after cutting: gamma > 1 deepens the shadows (only the maple's crown needed it,
# to sit as dark as the Flash bonsai's foliage).
GAMMA = {"autumn-maple": 1.25}


def gamma(im, g):
    lut = [round(255 * (i / 255) ** g) for i in range(256)]
    r, gr, b, a = im.split()
    return Image.merge("RGBA", (r.point(lut), gr.point(lut), b.point(lut), a))


def cut(src):
    sheet, cols, rows, idx = src
    im = tg.key(Image.open(os.path.join(HERE, sheet)))
    c = tg.clean(tg.cells(im, cols, rows)[idx], 40)
    return c.crop(c.getbbox())


def at_h(im, h):
    out = im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)
    px = out.load()
    for y in range(out.height):  # drop faint specks and any magenta left in the soft edge
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a < 24:
                px[x, y] = (0, 0, 0, 0)
            elif min(r, b) - g > 40:
                px[x, y] = (r, g, min(b, g + 20), a)
    return out


def z(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def row(items, bg=GRASS, gap=36, fsize=22):
    f = font(fsize)
    h = max(im.height for _, im in items)
    ws = [max(im.width, int(f.getlength(t)) + 8) for t, im in items]
    out = Image.new("RGBA", (sum(ws) + gap * (len(items) + 1), h + gap + fsize + 16), bg + (255,))
    d = ImageDraw.Draw(out)
    x = gap
    for (t, im), w in zip(items, ws):
        out.alpha_composite(im, (x + (w - im.width) // 2, gap // 2 + h - im.height))
        d.text((x + w // 2, gap // 2 + h + 6), t, fill=INK, font=f, anchor="ma")
        x += w + gap
    return out


def titled(title, body):
    f = font(28)
    out = Image.new("RGBA", (max(body.width, int(f.getlength(title)) + 32), body.height + 50), LIGHT + (255,))
    ImageDraw.Draw(out).text((16, 10), title, fill=INK, font=f)
    out.alpha_composite(body, (0, 50))
    return out


def stack(parts, gap=14):
    out = Image.new("RGBA", (max(p.width for p in parts), sum(p.height for p in parts) + gap * (len(parts) - 1)), LIGHT + (255,))
    y = 0
    for p in parts:
        out.alpha_composite(p, (0, y))
        y += p.height + gap
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    whole, before_after = [], []
    for name, label, src, h, nbrs, old in PICKS:
        if not os.path.exists(os.path.join(HERE, src[0])):
            print("missing", src[0]); continue
        full = cut(src)
        if name in GAMMA:
            full = gamma(full, GAMMA[name])
        one, two = at_h(full, h), at_h(full, h * 2)
        one.save(os.path.join(OUT, f"{name}.png"))
        two.save(os.path.join(OUT, f"{name}@2x.png"))
        fl = [(NAMES.get(p, p), refs.load(p)) for p in nbrs]
        items = [fl[0], (f"{label} (NEW)", one)] + fl[1:]
        body = stack([row(items, gap=24, fsize=12), row([(t, z(i, 3)) for t, i in items])], gap=0)
        sheet = titled(f"{label}: between Flash decorations, in-game size (top) and 3x (bottom)", body)
        sheet.convert("RGB").save(os.path.join(SHOTS, f"{name}-compare.png"))
        whole.append(sheet)
        new3 = z(one, 3)
        if old:
            o = Image.open(os.path.join(ROOT, "shots", "cutouts", old)).convert("RGBA")
            o1 = o.resize((o.width // 2, o.height // 2), Image.LANCZOS)  # 2x art drawn at 1x
            pair = [("Rejected (9 Nov)", z(o1, 3)), ("New (Flash style)", new3)]
        else:
            pair = [("(no earlier version)", Image.new("RGBA", (10, 10))), ("New (Flash style)", new3)]
        before_after.append(titled(f"{label}, 3x", row(pair + [("Flash: " + fl[0][0], z(fl[0][1], 3))])))
        print(name, one.size)
    stack(whole).convert("RGB").save(os.path.join(SHOTS, "autumn-v2-compare.png"))
    stack(before_after).convert("RGB").save(os.path.join(SHOTS, "autumn-v1-vs-v2.png"))


if __name__ == "__main__":
    main()
