#!/usr/bin/env python3
"""Build the Map Room 2 land feature pop-up pictures from the Codex sheet in `source/`.

The sheet was painted by Codex (codex exec, image tool; prompt `source/prompt-c4.txt`) on flat
magenta, each picture in its own grid cell. This keys the magenta out (glows and soft edges
un-mixed from it, not cut), trims each picture and writes:

  web/public/maproom/land/<key>-icon@4x.webp   the pop-up pictures, 112 px (28 points)
  web/public/maproom/land/<key>-icon@2x.webp   (Quality High / Medium / Low, `game/quality.ts`)
  web/public/maproom/land/<key>-icon.webp

(The map props once built here were dropped by the owner: the land features get painted into the
map's landscape later.)

  python web/tools/land-art/build.py
"""
from pathlib import Path

import numpy as np
from scipy.ndimage import binary_closing, binary_fill_holes
from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "source"
OUT = HERE.parents[1] / "public" / "maproom" / "land"

ICON = 112
KEY = np.array([255.0, 0.0, 255.0])


def key_out(cell: Image.Image, violet: bool = False, glow: bool = False) -> Image.Image:
    """Magenta to transparent; part-magenta pixels (glow, anti-aliased edges) un-mixed."""
    rgb = np.asarray(cell.convert("RGB")).astype(np.float64)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Each pixel is alpha * colour + (1 - alpha) * magenta. Take the smallest alpha that leaves
    # a real colour (no channel below 0 or above 255): that un-mixes glows, soft shadows and
    # anti-aliased edges into their own colour at part opacity, with no pink fringe.
    alpha = np.max(np.stack([1.0 - r / 255.0, 1.0 - b / 255.0, g / 255.0]), axis=0)
    # Only a pixel with less green than red and blue can hold magenta at all; a grey or a
    # green would otherwise "un-mix" into a see-through green. Fade the rule in by that gap.
    gap = np.clip((np.minimum(r, b) - g - 10.0) / 30.0, 0.0, 1.0)
    alpha = 1.0 - gap * (1.0 - alpha)
    inside = np.zeros(alpha.shape, dtype=bool)
    if violet:
        # Putty's violet is bluer than any magenta mix (b well above r): keep it solid.
        # Only in putty's own pictures; elsewhere a blue glow over magenta looks the same.
        alpha = np.where((b > r + 25) & (g < r) & (r < 190), 1.0, alpha)
    alpha = np.where(alpha < 0.08, 0.0, np.clip((alpha - 0.08) / 0.92, 0.0, 1.0) ** 0.9)
    keep = alpha > 0
    a = np.where(keep, alpha, 1.0)[..., None]
    colour = np.clip((rgb - (1.0 - a) * KEY) / a, 0, 255)
    # Glows and soft edges keep a pink cast where Codex mixed its glow with the magenta
    # (twigs, pebbles, putty): turn any part-clear pinkish pixel into a faint pale gold glow,
    # and drop the few near-magenta specks left beside the putty.
    cr, cg, cb = colour[..., 0], colour[..., 1], colour[..., 2]
    pink = (alpha < 0.98) & (np.minimum(cr, cb) > cg + 8)
    colour[pink] = np.array([255.0, 236.0, 150.0])
    alpha = np.where(pink, alpha * 0.4, alpha)
    if violet:
        # Putty's pinkish highlights look like a magenta mix and would go see-through (the grass
        # showing through as green). Inside the solid outline nothing is see-through: fill it.
        inside = binary_fill_holes(binary_closing(alpha > 0.9, iterations=8))
        colour[inside] = rgb[inside]
        alpha = np.where(inside, 1.0, alpha)
    if glow:
        # A glowing pile's halo: Codex painted it over the magenta solid, so it came out salmon
        # (bright red, some blue, less green). No wood or stone is that bright a red: fade it.
        salmon = (r > 225) & (r - g > 50) & (b > 90)
        if violet:
            salmon &= r >= b  # putty itself is bluer than red; only its pink halo is not
        colour[salmon] = np.array([255.0, 236.0, 150.0])
        alpha = np.where(salmon, np.minimum(alpha, 0.3), alpha)
    speck = ((r > 200) & (b > 180) & (g < 110) & ~inside) | ((r > 235) & (b > 220) & (g < 60))
    alpha = np.where(speck, 0.0, alpha)
    keep = alpha > 0
    out = np.dstack([colour, alpha * 255.0]).round().astype(np.uint8)
    out[~keep] = 0
    return Image.fromarray(out, "RGBA")


def trim(picture: Image.Image, top_sliver: bool = False) -> Image.Image:
    alpha = np.asarray(picture)[..., 3]
    if top_sliver:
        # The row above's shadow can reach into this cell's top: drop a small piece there too.
        rows = np.nonzero((alpha > 10).sum(axis=1))[0]
        gaps = np.nonzero(np.diff(rows) > 3)[0]
        if len(gaps) and (alpha[: rows[gaps[0]] + 1] > 10).sum() < 0.1 * (alpha > 10).sum():
            alpha = alpha.copy()
            alpha[: rows[gaps[0]] + 1] = 0
            picture = Image.fromarray(np.dstack([np.asarray(picture)[..., :3], alpha]), "RGBA")
    # A stray sliver below the picture (a shadow painted apart from it) would lift the foot: drop it.
    rows = np.nonzero((alpha > 10).sum(axis=1))[0]
    gaps = np.nonzero(np.diff(rows) > 3)[0]
    if len(gaps) and (alpha[rows[gaps[-1] + 1] :] > 10).sum() < 0.1 * (alpha > 10).sum():
        alpha = alpha.copy()
        alpha[rows[gaps[-1] + 1] :] = 0
        picture = Image.fromarray(np.dstack([np.asarray(picture)[..., :3], alpha]), "RGBA")
    ys, xs = np.nonzero(alpha > 10)
    return picture.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def cells(
    name: str, columns: int, rows: int, violet: tuple[int, ...] = (), top_sliver: bool = False, glow: tuple[int, ...] = ()
) -> list[Image.Image]:
    """The sheet's pictures, row by row; `violet` lists the cells that show putty."""
    sheet = Image.open(SOURCE / f"{name}.webp").convert("RGB")
    w, h = sheet.width / columns, sheet.height / rows
    boxes = [
        (round(c * w), round(r * h), round((c + 1) * w), round((r + 1) * h)) for r in range(rows) for c in range(columns)
    ]
    return [trim(key_out(sheet.crop(box), index in violet, index in glow), top_sliver) for index, box in enumerate(boxes)]


def scaled(picture: Image.Image, factor: float) -> Image.Image:
    size = (max(1, round(picture.width * factor)), max(1, round(picture.height * factor)))
    return picture.resize(size, Image.LANCZOS)


def build_icons() -> None:
    icons = cells("icons", 4, 2, violet=(6,), glow=(4, 5, 6, 7))
    keys = ["forest", "rocks", "marsh", "open", "node-twigs", "node-pebbles", "node-putty", "node-goo"]
    for key, icon in zip(keys, icons):
        if key == "open":
            continue  # open ground has no pop-up row
        fitted = scaled(icon, min(ICON / icon.width, ICON / icon.height))
        square = Image.new("RGBA", (ICON, ICON), (0, 0, 0, 0))
        square.alpha_composite(fitted, ((ICON - fitted.width) // 2, (ICON - fitted.height) // 2))
        write_copies(square, f"{key}-icon")


def write_copies(picture: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for suffix, factor in (("@4x", 1), ("@2x", 2), ("", 4)):
        copy = picture if factor == 1 else picture.resize((picture.width // factor, picture.height // factor), Image.LANCZOS)
        copy.save(OUT / f"{name}{suffix}.webp", quality=90, alpha_quality=95, method=6)


if __name__ == "__main__":
    build_icons()
    for path in sorted(OUT.glob("*.webp")):
        print(f"{path.name:28} {path.stat().st_size // 1024:5} KB")
