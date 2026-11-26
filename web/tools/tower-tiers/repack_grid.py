"""Repack one-row animation strips wider than 4096 px into grids of 8 cells a row.

Many phones' graphics cards hold 4096 px a side at most (`MAX_TEXTURE_SIZE`); a
wider picture is refused by WebGL and drawn black, or copied cell by cell through
a canvas (`web/src/game/textureLimit.ts`). These strips are rewritten as grids,
cell `i` at column `i % 8`, row `i // 8`, under a new name (`.g8` before the copy
suffix) so Cloudflare and browsers holding the old one-row file for a week never
mix the two. The old files stay for open tabs on the old code.

Every cell the file holds is packed, even past the frame count the game draws, so
nothing is lost. Each new grid is decoded and compared with the old strip cell by
cell. The Flash PNG strips become lossless WebP grids (`anim.1.g8.webp`), pixel for
pixel the same and smaller than the PNGs; the 3D turret WebPs, which were lossy
already, are re-encoded at quality 90 (alpha lossless) and the largest difference
is printed.

Run from the repo root: `python3 web/tools/tower-tiers/repack_grid.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[3] / "server" / "public" / "assets"
COLUMNS = 8
LIMIT = 4096

# (old file under assets/, cell width in the file's pixels)
SHEETS: list[tuple[str, int]] = [
    # 3D turret strips, @2x: 32 headings each (buildingArtTiers.ts).
    *[(f"buildings/flaktower/turret.t{t}@2x.webp", 132) for t in (1, 2, 3)],
    *[(f"buildings/railguntower/turret.t{t}@2x.webp", 192) for t in (1, 2, 3)],
    *[(f"buildings/icannontower/turret.t{t}@2x.webp", 132) for t in (1, 2, 3)],
    *[(f"buildings/imagmatower/turret.t{t}@2x.webp", 132) for t in (1, 2, 3)],
    *[(f"buildings/isnipertower/turret.t{t}@2x.webp", 136) for t in (1, 2, 3)],
    # Flash strips, 1x (buildingArtData.ts, buildingArtInfernoData.ts).
    ("buildings/outpostdefender/anim.1.png", 178),
    ("buildings/imonsterlab/anim.1.v2.png", 86),
    ("buildings/iboneharvester/anim.2.png", 90),
    ("buildings/siegefactory/anim.1.v2.png", 129),
]


def grid_name(path: Path) -> Path:
    """`turret.t1@2x.webp` -> `turret.t1.g8@2x.webp`; `anim.1.v2.png` -> `anim.1.v2.g8.webp`."""
    name = path.name
    copy = name.rfind("@")
    stem, tail = (name[:copy], name[copy:]) if copy > 0 else (name[: -len(path.suffix)], path.suffix)
    return path.with_name(f"{stem}.g{COLUMNS}{tail}").with_suffix(".webp")


def premultiplied(image: Image.Image) -> Image.Image:
    r, g, b, a = image.split()
    return Image.merge("RGBA", [ImageChops.multiply(c, a) for c in (r, g, b)] + [a])


def largest_difference(a: Image.Image, b: Image.Image) -> int:
    """The largest channel difference, colour weighted by alpha (unseen colour under clear pixels ignored)."""
    return max(high for _, high in ImageChops.difference(premultiplied(a), premultiplied(b)).getextrema())


def repack(rel: str, cell_width: int) -> None:
    old = ROOT / rel
    strip = Image.open(old).convert("RGBA")
    width, height = strip.size
    cells = width // cell_width
    if cells * cell_width != width:
        sys.exit(f"{rel}: {width} px is not a whole number of {cell_width} px cells")
    rows = -(-cells // COLUMNS)
    grid = Image.new("RGBA", (cell_width * COLUMNS, height * rows), (0, 0, 0, 0))
    for i in range(cells):
        cell = strip.crop((i * cell_width, 0, (i + 1) * cell_width, height))
        grid.paste(cell, ((i % COLUMNS) * cell_width, (i // COLUMNS) * height))
    assert grid.width <= LIMIT and grid.height <= LIMIT, rel

    new = grid_name(old)
    if old.suffix == ".webp":
        grid.save(new, "WEBP", quality=90, alpha_quality=100, method=6)
    else:
        grid.save(new, "WEBP", lossless=True, quality=100, method=6, exact=True)

    back = Image.open(new).convert("RGBA")
    worst = 0
    for i in range(cells):
        x, y = (i % COLUMNS) * cell_width, (i // COLUMNS) * height
        a = back.crop((x, y, x + cell_width, y + height))
        b = strip.crop((i * cell_width, 0, (i + 1) * cell_width, height))
        worst = max(worst, largest_difference(a, b))
    if old.suffix == ".png" and worst != 0:
        sys.exit(f"{rel}: lossless grid differs from the strip ({worst})")
    print(
        f"{rel} {width}x{height} -> {new.relative_to(ROOT)} {grid.width}x{grid.height}"
        f" ({cells} cells, {old.stat().st_size} -> {new.stat().st_size} bytes, largest difference {worst})"
    )


if __name__ == "__main__":
    for rel, cell_width in SHEETS:
        repack(rel, cell_width)
