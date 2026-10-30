#!/usr/bin/env python3
"""Pack a tall painted champion sheet into a square-ish one the graphics card can hold.

Many graphics cards (phones, older PCs, any browser drawing without the card) cannot load a picture
wider or taller than 8192 px, and Pixi then draws nothing for it. Korath 5 and 6 have 30 frames of 16
headings in big cells: in the Flash layout, one heading to a column, their sheets are 4860 and 5010 px
tall at 1x, so even the 2x painting passes 8192 px. This lays the same 480 cells out 20 to a row,
heading after heading, frame after frame (cell `(heading c, frame r)` is the `(r x 16 + c)`th), the
layout `REPAINT_LAYOUTS` in web/src/game/attack/monsterSprites.ts gives the game, and writes the sheet
at the scale the game draws, followed by its Quality copies (`sheet_copies.py`).

Each cell gets one transparent pixel column (Korath 5) or row (Korath 6) on its right or bottom edge,
so that every cell edge falls on a whole pixel in the @1.5x Medium copy; the anchor stays put.

Run it last, on the Flash-layout painting the sheet builder wrote and `add-champ-ground-shadow.py`
shadowed (`korath_5-repaint@3x.png`); that painting is then deleted, as the game no longer draws it:

  uv run --no-project --with imagequant --with pillow python web/tools/pack-sheet.py korath_5
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sheet_copies  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

ASSETS = sheet_copies.ASSETS / "monsters"
HEADINGS = 16
# name: (Flash 1x cell, packed 1x cell, cells to a row, scale painted at, scale the game draws), as in monsterSprites.ts
PACKS = {
    "korath_5": ((199, 162), (200, 162), 20, 3, 2),
    "korath_6": ((202, 167), (202, 168), 20, 3, 2),
}


def pack(name):
    (fw, fh), (pw, ph), columns, up, down = PACKS[name]
    source = ASSETS / f"{name}-repaint@{up}x.png"
    out = ASSETS / f"{name}-repaint@{down}x.png"
    notes = {k: v for k, v in sheet_copies.texts(source).items() if k != sheet_copies.MARK}
    painted = Image.open(source).convert("RGBA")
    cw, ch = fw * up, fh * up
    assert painted.width == HEADINGS * cw and painted.height % ch == 0, f"{source.name}: {painted.size} is not {HEADINGS} x {cw} x {ch} cells"
    cells = painted.height // ch * HEADINGS
    rows = -(-cells // columns)
    packed = Image.new("RGBA", (columns * pw * up, rows * ph * up))
    for i in range(cells):
        frame, heading = divmod(i, HEADINGS)
        cell = painted.crop((heading * cw, frame * ch, heading * cw + cw, frame * ch + ch))
        packed.paste(cell, ((i % columns) * pw * up, (i // columns) * ph * up))
    # Pillow resizes RGBA with the alpha premultiplied, so no dark fringes.
    small = packed.resize((columns * pw * down, rows * ph * down), Image.LANCZOS)
    sheet_copies.quantise(small, out)
    sheet_copies.set_texts(out, notes)
    print(f"wrote {out.name} {small.size} ({out.stat().st_size / 1e6:.2f} MB) from {source.name} {painted.size}")
    source.unlink()
    sheet_copies.make_copies(out)


if __name__ == "__main__":
    if len(sys.argv) < 2 or any(name not in PACKS for name in sys.argv[1:]):
        sys.exit(__doc__)
    for name in sys.argv[1:]:
        pack(name)
