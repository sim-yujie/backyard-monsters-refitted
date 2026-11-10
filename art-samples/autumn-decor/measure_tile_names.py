"""Measures every word of every decoration name against the build menu's tile name box.

Run from web/: python -I ../art-samples/autumn-decor/measure_tile_names.py

The tile name is Titan One, 15 px at 1600 wide and 13 px at 390 (`build-menu.css`
`.build-tile__name`). Widths are scaled to the tester's on-screen measure (10 Nov 2026:
"Wheelbarrow" 112 px in a 98 px box at 1600, 97 px in 90 at 390), so the numbers compare
straight with those boxes. A word wider than its box breaks mid-word. A hyphenated word
breaks at its hyphen, so each part is measured on its own. Also measured in the "Extra
readable" font (Atkinson Hyperlegible bold), a player setting.
"""
import re
from PIL import ImageFont

TITAN = "public/fonts/titan-one/titan-one-latin.woff2"
READABLE = "public/fonts/atkinson-hyperlegible/atkinson-hyperlegible-700-latin.woff2"
BOXES = {1600: (15, 98, 112), 390: (13, 90, 97)}  # font px, box px, tester's "Wheelbarrow" px

art = open("src/game/yard/buildingArtData.ts", encoding="utf8").read()
names = {int(t): n for t, n in re.findall(r'^\s*\[(\d+), "([^"]+)", "buildings/', art, re.M)}
own = open("src/game/yard/revampDecorations.ts", encoding="utf8").read()
names.update({int(t): n for t, n in re.findall(r'^\s*\[(\d+), "([^"]+)", "buildings/', own, re.M)})
shop = open("src/game/yard/decorShop.ts", encoding="utf8").read()
kinds = re.search(r"DECOR_KINDS[^=]*=\s*\[([\s\S]*?)\n\];", shop).group(1)
types = [int(x) for block in re.findall(r"types: \[([^\]]*)\]", kinds) for x in re.findall(r"\d+", block)]

over = []
for width, (px, box, wheelbarrow) in BOXES.items():
    titan = ImageFont.truetype(TITAN, px)
    readable = ImageFont.truetype(READABLE, px)
    scale = wheelbarrow / titan.getlength("Wheelbarrow")
    for type_id in types:
        name = names[type_id]
        for word in re.findall(r"[^\s-]+-?", name):
            for font, label in ((titan, "Titan One"), (readable, "readable")):
                size = font.getlength(word) * scale
                if size > box:
                    over.append(f"{width}: {word!r} {size:.0f} px > {box} ({type_id} {name}, {label})")

print(f"{len(types)} decorations measured")
print("\n".join(over) if over else "no word is wider than its box")
