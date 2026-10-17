"""Half-size copies of the big monster sheets (memory trial).

Each `name@4x.png` repaint gets a `name@2x.png` beside it at half the width and
height, cut cell by cell so no cell's edge picks up its neighbour, with a
Lanczos filter on premultiplied alpha (Pillow does that for RGBA) so the
transparent edges keep no dark fringe. The oversized Korath 5 and 6 sheets
(original 1x art) get a whole-sheet `@0.5x` copy; their cells are an odd
number of pixels wide, so they cannot be halved cell by cell.

The originals are left as they are. Usage, from `web/`:

  npx vite-node tools/halfsize-sheets/grids.ts > grids.json
  python tools/halfsize-sheets/make_halfsize.py grids.json
  python tools/shrink-sheet.py ../server/public/assets/monsters/*@2x.png ../server/public/assets/monsters/*@0.5x.png

The last step brings the copies down to 256 colours like the full sheets.
"""

import json
import sys
from pathlib import Path

from PIL import Image

ASSETS = Path(__file__).resolve().parents[3] / "server" / "public" / "assets"
WHOLE_SHEET = ["monsters/korath_5.png", "monsters/korath_6.png"]


def halve_by_cell(path: Path, cell_w: int, cell_h: int) -> Image.Image:
    sheet = Image.open(path).convert("RGBA")
    # A sheet can stop short of its last row or column of cells (Project X is
    # 34 px tall for 35 px cells); the cut-off cell is padded and clipped back.
    columns, rows = -(-sheet.width // cell_w), -(-sheet.height // cell_h)
    half_w, half_h = cell_w // 2, cell_h // 2
    out = Image.new("RGBA", (sheet.width // 2, sheet.height // 2), (0, 0, 0, 0))
    for row in range(rows):
        for column in range(columns):
            box = (column * cell_w, row * cell_h, (column + 1) * cell_w, (row + 1) * cell_h)
            cell = sheet.crop(box)
            if cell.getbbox() is None:
                continue
            out.paste(cell.resize((half_w, half_h), Image.LANCZOS), (column * half_w, row * half_h))
    return out


def main() -> None:
    grids = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for grid in grids:
        source = ASSETS / grid["file"]
        if not grid["file"].endswith("@4x.png"):
            raise SystemExit(f"{grid['file']}: not a @4x sheet")
        target = source.with_name(source.name.replace("@4x.png", "@2x.png"))
        half = halve_by_cell(source, grid["frameWidth"] * 4, grid["frameHeight"] * 4)
        half.save(target, optimize=True)
        print(f"{target.name}: {half.width}x{half.height}")
    for file in WHOLE_SHEET:
        source = ASSETS / file
        sheet = Image.open(source).convert("RGBA")
        half = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
        target = source.with_name(source.stem + "@0.5x.png")
        half.save(target, optimize=True)
        print(f"{target.name}: {half.width}x{half.height}")


if __name__ == "__main__":
    main()
