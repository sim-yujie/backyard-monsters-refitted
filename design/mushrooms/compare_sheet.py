"""Comparison sheets for the owner: the three mushroom options of each look on the game's own grass, among
real decorations of the same look, at real in-game size (1x) and enlarged (3x, about closest yard zoom).

    python -I compare_sheet.py          -> sheets/classic-options.png, sheets/modern-options.png

The grass is the game's base ground tile (server/public/assets/yardbg/grass/isograss1), tiled; this is NOT a
browser screenshot (helpers take none), the lead adds in-game shots. Every picture is drawn as the yard draws
it: its shadow multiplied onto the grass, then the picture, placed by its art row's offsets.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PUB = REPO / "server" / "public" / "assets"
DEC = PUB / "buildings" / "decorations"
OUT = HERE / "sheets"

# (label, top file, top x, top y, shadow file, shadow x, shadow y): rows from buildingArtData.ts /
# decorationModernArt.ts.
NEIGHBOURS = {
    "classic": [
        ("Acorn", DEC / "acorn/top.png", -10, -9, DEC / "acorn/shadow.jpg", -9, 8),
        ("Walnut", DEC / "walnut/top.png", -12, -2, DEC / "walnut/shadow.jpg", -23, 3),
        ("Mini-Pumpkin", DEC / "pumpkins/attended-small-top.png", -10, -4, DEC / "pumpkins/attended-small-shadow.jpg", -12, 2),
    ],
    "modern": [
        ("Acorn", DEC / "acorn/acorn.modern@2x.webp", -10, -9, DEC / "acorn/acorn.modern-shadow.jpg", -8, 11),
        ("Walnut", DEC / "walnut/walnut.modern@2x.webp", -12, -2, DEC / "walnut/walnut.modern-shadow.jpg", -10, 14),
        ("Mini-Pumpkin", DEC / "pumpkins/mini-pumpkin.modern@2x.webp", -10, -4, DEC / "pumpkins/mini-pumpkin.modern-shadow.jpg", -8, 9),
    ],
}
TITLES = {
    "classic-a": "A  Flash's own mushrooms (the real 2009 art, recovered from the game file)",
    "classic-b": "B  Flash style, each group its own natural colour (new, Codex)",
    "classic-c": "C  Flash style, red toadstools (new, Codex)",
    "modern-a": "A  Modern redraw of Flash's mushrooms (same orange caps)",
    "modern-b": "B  Modern, each group its own natural colour",
    "modern-c": "C  Modern, red toadstools",
}
PICK = {"classic": "classic-a", "modern": "modern-a"}


def font(size):
    for f in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def grass(w, h):
    tile = Image.open(PUB / "yardbg/grass/2174_isograss1_isograss1.png").convert("RGB")
    g = Image.new("RGB", (w, h))
    for y in range(0, h, tile.height):
        for x in range(0, w, tile.width):
            g.paste(tile, (x, y))
    return g


class Stage:
    """A strip of grass at 1x on which things are placed by their yard spot, later enlarged."""

    def __init__(self, w, h):
        self.base = grass(w, h)
        self.items = []  # (spot x, spot y, callable(z) -> list of (layer, image, x, y))

    def add(self, x, y, layers):
        self.items.append((x, y, layers))


def mushroom_layers(option, i):
    a = json.loads((HERE / "options" / option / "anchors.json").read_text())[str(i)]
    im = Image.open(HERE / "options" / option / a["file"]).convert("RGBA")
    return [("top", im, a["x"], a["y"], "half" if "@2x" in a["file"] else "normal")]


def neighbour_layers(n):
    _, top, tx, ty, shadow, sx, sy = n
    s = Image.open(shadow).convert("RGB")
    t = Image.open(top).convert("RGBA")
    return [("shadow", s, sx, sy, "multiply"), ("top", t, tx, ty, "half" if "@2x" in top.name else "normal")]


def old_glyph():
    """Today's vector stand-in (yardAtlas.ts), drawn at 4x then shrunk: frame (-14,-22) 28x26, anchor y 0.85."""
    z = 4
    im = Image.new("RGBA", (28 * z, 26 * z), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ox, oy = 14 * z, 22 * z
    d.rectangle((ox - 3 * z, oy - 10 * z, ox + 3 * z, oy), fill=(255, 255, 255, 217))
    d.ellipse((ox - 12 * z, oy - 18 * z, ox + 12 * z, oy - 2 * z), fill=(0xD2, 0x69, 0x4A, 255))
    d.ellipse((ox - 7 * z, oy - 15 * z, ox - 1 * z, oy - 11 * z), fill=(255, 255, 255, 230))
    d.ellipse((ox + 2.5 * z, oy - 12.8 * z, ox + 7.5 * z, oy - 9.2 * z), fill=(255, 255, 255, 230))
    im = im.resize((28, 26), Image.LANCZOS)
    # The sprite's anchor is (0.5, 0.85) of its 28 x 26 frame.
    return [("top", im, -14, -0.85 * 26, "normal")]


def halloween_pumpkin():
    t = Image.open(DEC / "pumpkins/top.png").convert("RGBA")
    t = t.resize((round(t.width * 1.3), round(t.height * 1.3)), Image.LANCZOS)
    return [("top", t, -t.width / 2, -0.9 * t.height, "normal")]


def render_stage(stage, z):
    """Stage.render, with "half" layers (2x files) placed at half size."""
    g = stage.base.resize((stage.base.width * z, stage.base.height * z), Image.LANCZOS).convert("RGBA")
    for kind in ("shadow", "top"):
        for x, y, layers in sorted(stage.items, key=lambda it: it[1]):
            for layer_kind, im, ox, oy, mode in layers:
                if layer_kind != kind:
                    continue
                f = z / 2 if mode == "half" else z
                big = im.resize((max(1, round(im.width * f)), max(1, round(im.height * f))), Image.LANCZOS)
                px, py = round((x + ox) * z), round((y + oy) * z)
                if mode == "multiply":
                    region = g.crop((px, py, px + big.width, py + big.height)).convert("RGB")
                    g.paste(ImageChops.multiply(region, big.convert("RGB")), (px, py))
                else:
                    layer = Image.new("RGBA", g.size, (0, 0, 0, 0))
                    layer.paste(big, (px, py))
                    g = Image.alpha_composite(g, layer)
    return g.convert("RGB")


def option_stage(option, look, with_old=False):
    st = Stage(400, 78)
    spots = [(28, 58), (78, 50), (122, 62), (166, 52), (212, 60)]
    for i, (x, y) in enumerate(spots, start=1):
        st.add(x, y, mushroom_layers(option, i))
    x = 258
    for n in NEIGHBOURS[look]:
        st.add(x, 60, neighbour_layers(n))
        x += 30
    st.add(x + 2, 60, halloween_pumpkin())
    if with_old:
        st.add(x + 34, 60, old_glyph())
    return st


def sheet(look):
    options = [o for o in TITLES if o.startswith(look)]
    blocks = []
    head = font(26)
    small = font(18)
    for o in options:
        st = option_stage(o, look, with_old=True)
        z1 = render_stage(st, 1)
        z3 = render_stage(st, 3)
        title = TITLES[o] + ("   <- wired in" if PICK[look] == o else "")
        blocks.append((title, z1, z3))
    w = max(b[2].width for b in blocks) + 40
    h = 80 + sum(50 + b[1].height + 16 + b[2].height + 30 for b in blocks)
    s = Image.new("RGB", (w, h), (30, 30, 34))
    d = ImageDraw.Draw(s)
    d.text((20, 18), f"Yard mushrooms, {look.upper()} look: 3 options. Each row: the 5 mushrooms, then real "
           f"{look} Acorn, Walnut, Mini-Pumpkin, the Halloween pumpkin, today's stand-in.", font=small, fill=(230, 230, 230))
    d.text((20, 44), "Top strip of each: real in-game size (1x). Below it: 3x. Ground: the game's own grass tile.",
           font=small, fill=(170, 170, 170))
    y = 80
    for title, z1, z3 in blocks:
        d.text((20, y), title, font=head, fill=(255, 214, 90) if "wired" in title else (240, 240, 240))
        y += 50
        s.paste(z1, (20, y))
        y += z1.height + 16
        s.paste(z3, (20, y))
        y += z3.height + 30
    OUT.mkdir(exist_ok=True)
    s.save(OUT / f"{look}-options.png")
    print("wrote", OUT / f"{look}-options.png", s.size)


def flash_reference():
    """Flash's own mushrooms 1-5 (and its unused tall 6th) with their shadows, at 1x and 4x on grass."""
    st = Stage(330, 84)
    for i, x in enumerate([30, 85, 135, 182, 232, 290], start=1):
        st.add(x, 70 if i < 6 else 76, mushroom_layers("classic-a", i))
    OUT.mkdir(exist_ok=True)
    s1, s4 = render_stage(st, 1), render_stage(st, 4)
    s = Image.new("RGB", (s4.width + 40, s4.height + s1.height + 110), (30, 30, 34))
    d = ImageDraw.Draw(s)
    d.text((20, 16), "Flash's own yard mushrooms (doodad_mushroom_mc frames 1-5, + an unused 6th), with Flash's shadows: 1x and 4x",
           font=font(20), fill=(230, 230, 230))
    s.paste(s1, (20, 56))
    s.paste(s4, (20, 76 + s1.height))
    s.save(OUT / "flash-reference.png")
    print("wrote", OUT / "flash-reference.png", s.size)


if __name__ == "__main__":
    flash_reference()
    sheet("classic")
    sheet("modern")
