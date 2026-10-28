#!/usr/bin/env python3
"""Paint a soft ground shadow under every cell of a repainted champion sheet.

The Flash champion sheets carried a baked drop shadow on the grass; the
repaints were painted without one ("No shadows, no ground"). A stocky champion
still reads as standing, but Krallen, long-legged and seen from the side, looked
as if she floated over the yard (owner, 2026-10-25). This puts back a contact
shadow in the style of the creep repaints (Fang, Bandito): a soft dark ellipse
on the ground under the feet, behind the body.

The ellipse is measured from the body itself, per heading: the spread of the
body's lower half gives its width, the paws its centre, taken as the median
over the heading's run frames, and again over its attack frames, so it stays
put while she runs and follows her when she lunges. Nothing else in the cell
changes, and the anchor stays where it was.

Korath (korath_1..6) gets the same: like her, its Flash sheets had the shadow
baked in and its repaints are painted without one (owner, 2026-10-28).

Run it once, on a sheet that has no shadow yet (it refuses a sheet it has
already shadowed). Both the @4x (Korath 5 and 6: @3x) sheet and its 1x copy are rewritten, quantised
with libimagequant like the other repaints:

  uv run --no-project --with imagequant --with pillow --with numpy --with scipy \
    python web/tools/add-champ-ground-shadow.py krallen_1_rev_65
"""
import os
import sys
from pathlib import Path

import imagequant
import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter

ASSETS = Path(__file__).resolve().parents[2] / "server/public/assets/monsters"
OUT = Path(os.environ.get("SHADOW_OUT", ASSETS))  # write elsewhere to try settings
MARK = "bymr-ground-shadow"

COLUMNS = 16
# Krallen's rows: run 0-9, attack 10-15 (`monsterSpriteData.ts` G5_1-G5_3).
# Each cycle gets its own ellipse, so a lunge keeps the shadow under her.
_KRALLEN = {"run": range(0, 10), "attack": range(10, 16)}
# name: (1x cell width, 1x cell height, cycles, scale of the repaint), as in monsterSpriteData.ts
# (Korath, G4_1-G4_6: walk from row 0, then the attack; levels 5 and 6 also stomp, rows 20-29, and their repaints are 3x).
SHEETS = {
    "krallen_1_rev_65": (130, 80, _KRALLEN, 4),
    "krallen_2_rev_65": (131, 90, _KRALLEN, 4),
    "krallen_3_rev_65": (142, 100, _KRALLEN, 4),
    "korath_1": (72, 49, {"walk": range(0, 8), "attack": range(8, 17)}, 4),
    "korath_2": (119, 81, {"walk": range(0, 8), "attack": range(8, 17)}, 4),
    "korath_3": (128, 102, {"walk": range(0, 9), "attack": range(9, 18)}, 4),
    "korath_4": (153, 123, {"walk": range(0, 10), "attack": range(10, 20)}, 4),
    "korath_5": (199, 162, {"walk": range(0, 10), "attack": range(10, 20), "stomp": range(20, 30)}, 3),
    "korath_6": (202, 167, {"walk": range(0, 10), "attack": range(10, 20), "stomp": range(20, 30)}, 3),
}

# Shadow look, in 1x pixels: a little darker than the creep repaints' shadows,
# as the yard's dark grass swallowed a lighter one.
OPACITY = 0.58
SOFTNESS = 1.25  # gaussian sigma
LOWER = 0.5  # the share of the body's height, from the feet up, whose spread gives the width
TRIM = 8  # percent of those pixels left out at each side, so a thin tail or claw does not stretch it
ASPECT = 0.32  # ellipse height over width, the yard's ground plane
DROP = 1.0  # centre this far below the middle of the column bottoms


def footprint(alpha):
    """(cx, cy, rx, ry) of the ground under one cell's body, 1x units, or None."""
    body = alpha >= 128
    rows = np.where(body.any(1))[0]
    if len(rows) == 0:
        return None
    top, feet = rows.min(), rows.max()
    low = body.copy()
    low[: int(feet - LOWER * max(1, feet - top))] = False
    xs = np.where(low)[1]
    x0, x1 = np.percentile(xs, TRIM), np.percentile(xs, 100 - TRIM)
    # The lowest painted pixel of each column across that width: paws near the
    # viewer at the bottom, far paws and belly higher up, the ground between.
    lowest = np.array([np.where(body[:, c])[0].max() for c in range(int(x0), int(x1) + 1) if body[:, c].any()])
    rx = (x1 - x0) / 2 + 2
    ry = max(rx * ASPECT, (feet - np.percentile(lowest, 10)) / 2 + 1.5)
    return ((x0 + x1) / 2, (feet + np.percentile(lowest, 10)) / 2 + DROP, rx, ry)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in SHEETS:
        sys.exit(f"usage: add-champ-ground-shadow.py <{'|'.join(SHEETS)}>")
    name = sys.argv[1]
    fw, fh, cycles, UP = SHEETS[name]
    ROWS = max(r.stop for r in cycles.values())
    path4 = ASSETS / f"{name}-repaint@{UP}x.png"
    src = Image.open(path4)
    if MARK in getattr(src, "text", {}):
        sys.exit(f"{path4.name} already has its ground shadow")
    big = src.convert("RGBA")
    assert big.size == (fw * COLUMNS * UP, fh * ROWS * UP), big.size
    small = np.asarray(big.resize((fw * COLUMNS, fh * ROWS), Image.LANCZOS))[..., 3]
    out = np.array(big)

    yy, xx = np.mgrid[0 : fh * UP, 0 : fw * UP].astype(np.float32) / UP
    for c in range(COLUMNS):
        for cycle, rows in cycles.items():
            prints = [footprint(small[r * fh : (r + 1) * fh, c * fw : (c + 1) * fw]) for r in rows]
            prints = np.array([p for p in prints if p is not None])
            if len(prints) == 0:
                continue
            cx, cy, rx, ry = np.median(prints, axis=0)
            inside = (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1).astype(np.float32)
            shade = gaussian_filter(inside, SOFTNESS * UP) * OPACITY
            for r in rows:
                ys, xs = slice(r * fh * UP, (r + 1) * fh * UP), slice(c * fw * UP, (c + 1) * fw * UP)
                cell = out[ys, xs].astype(np.float32) / 255
                a, s = cell[..., 3:4], shade[..., None]
                # Body over shadow (the shadow is black, so only alpha mixes in).
                alpha = a + s * (1 - a)
                cell[..., :3] *= a / np.maximum(alpha, 1e-6)
                cell[..., 3:4] = alpha
                out[ys, xs] = (cell * 255 + 0.5).clip(0, 255).astype(np.uint8)
            print(f"heading {c:2d} {cycle:6s}: centre ({cx:5.1f}, {cy:5.1f}) radii ({rx:4.1f}, {ry:4.1f})")

    sheet = Image.fromarray(out, "RGBA")
    info = PngImagePlugin.PngInfo()
    info.add_text(MARK, "1")
    for img, path in ((sheet, OUT / path4.name), (sheet.resize((fw * COLUMNS, fh * ROWS), Image.LANCZOS), OUT / f"{name}-repaint.png")):
        imagequant.quantize_pil_image(img, max_quality=95, min_quality=60).save(path, optimize=True, pnginfo=info)
        print("wrote", path.name, f"{path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
