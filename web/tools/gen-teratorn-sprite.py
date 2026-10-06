"""
Build the repainted Teratorn (C14) sprite sheet from Gemini-restyled frames.
Art trial, Teratorn only. Usage (from the repo root):

    pip install pillow numpy
    python web/tools/gen-teratorn-sprite.py <source folder>

The source folder holds Gemini's restyles of the original frames, each a grid
on a flat #00FF00 ground named after the sheet columns it covers, one row per
column and the three wing-flap frames left to right:

    frames-8-0-4-24.png     4 rows: columns 8, 0, 4 and 24
    frames-9-10-11-12.png   ...

Each grid was made by handing Gemini the original frames blown up 8x, every
frame in a 256 px cell with the 224 px blow-up 16 px in, and asking it to
redraw them in place in the revamp's cel style (prompt in
docs/art/monster-sprites.md). The original pins the pose, so the body stays
put from frame to frame and only the wings move.

The original sheet is a mirror image of itself: column c flipped left to
right is column 16 - c, one pixel over. So only columns 8 to 24 (facing down
round to facing up through left) need painting; the rest are flipped, unless
the folder has a painting of them too.

Each painted row is fitted to the original row with one scale and offset for
all three frames (so fitting adds no wobble), keyed, and placed in the
original layout (32 headings x 3 flap frames, 28x28 cells, anchor 15,14; see
docs/art/monster-sprites.md):

    server/public/assets/monsters/14-repaint.png      896x84
    server/public/assets/monsters/14-repaint@4x.png   3584x336, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in
web/src/game/attack/monsterSprites.ts).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps

CELL = 28
COLS, ROWS = 32, 3
UP = 4                       # the repaint's scale
REF_CELL, REF_INSET, REF_SCALE = 256, 16, 8

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / "14.v1.png").convert("RGBA")


def key(im):
    """
    Chroma-key the green ground. The Teratorn's legs are green too, so only
    a strong green excess (G - max(R, B)) counts as ground: opaque at 105 or
    less, clear at 235. Part-clear pixels are unmixed from the green.
    """
    rgb = np.asarray(im.convert("RGB"), dtype=float)
    excess = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
    a = np.clip((235 - excess) / 130, 0, 1)
    ground = np.array([0, 255, 0], dtype=float)
    safe = np.maximum(a, 1e-3)[..., None]
    fg = np.clip((rgb - (1 - a[..., None]) * ground) / safe, 0, 255)
    fg = np.where((a < 1)[..., None], fg, rgb)
    return Image.fromarray(np.dstack([fg, a * 255]).astype(np.uint8), "RGBA")


def original_cell(col, frame):
    return ORIGINAL.crop((col * CELL, frame * CELL, (col + 1) * CELL, (frame + 1) * CELL))


def place(im, scale, dx, dy, size):
    """`im` scaled by `scale` about its centre and moved by (dx, dy), on a `size` canvas."""
    w = max(1, round(im.width * scale))
    scaled = im.resize((w, w), Image.LANCZOS)
    pad = w + size
    out = Image.new("RGBA", (size + 2 * pad, size + 2 * pad))
    out.alpha_composite(scaled, (pad + round((size - w) / 2 + dx), pad + round((size - w) / 2 + dy)))
    return out.crop((pad, pad, pad + size, pad + size))


def fit_row(painted, col):
    """
    One scale and offset for a row's three frames that best lays Gemini's
    silhouettes over the original's, compared at 2x. The original's wings
    are a faint blur, so only its solid pixels and Gemini's are compared.
    """
    n = CELL * 2
    targets = [np.asarray(original_cell(col, f).resize((n, n), Image.LANCZOS))[..., 3] > 160 for f in range(ROWS)]
    small = [p.resize((n, n), Image.LANCZOS) for p in painted]
    best = None
    for scale in np.arange(0.86, 1.10, 0.02):
        masks = [np.asarray(place(s, scale, 0, 0, n))[..., 3] > 160 for s in small]
        for dy in range(-6, 7):
            for dx in range(-6, 7):
                err = 0
                for m, t in zip(masks, targets):
                    err += np.count_nonzero(np.roll(np.roll(m, dy, 0), dx, 1) ^ t)
                if best is None or err < best[0]:
                    best = (err, scale, dx, dy)
    _, scale, dx, dy = best
    return scale, dx / 2, dy / 2   # offsets in 1x pixels


painted = {}
for path in sorted(SOURCE.glob("frames-*.png")):
    cols = [int(c) for c in path.stem.split("-")[1:]]
    grid = key(Image.open(path))
    s = grid.width / (3 * REF_CELL)
    for r, col in enumerate(cols):
        cells = []
        for f in range(ROWS):
            x0 = (f * REF_CELL + REF_INSET) * s
            y0 = (r * REF_CELL + REF_INSET) * s
            span = CELL * REF_SCALE * s
            cells.append(grid.crop((round(x0), round(y0), round(x0 + span), round(y0 + span))).resize((CELL * UP, CELL * UP), Image.LANCZOS))
        scale, dx, dy = fit_row(cells, col)
        print(f"column {col:2}: scale {scale:.2f}, offset {dx:+.1f},{dy:+.1f} px", file=sys.stderr)
        painted[col] = [place(c, scale, dx * UP, dy * UP, CELL * UP) for c in cells]

missing = []
for col in range(COLS):
    if col in painted:
        continue
    mirror = (16 - col) % COLS
    if mirror not in painted:
        missing.append(col)
        continue
    # flipped, then one 1x pixel left, as the original's own mirror pairs sit
    painted[col] = [place(ImageOps.mirror(c), 1.0, -UP, 0, CELL * UP) for c in painted[mirror]]
if missing:
    sys.exit(f"no painting of columns {missing} or their mirror images")

sheet = Image.new("RGBA", (COLS * CELL * UP, ROWS * CELL * UP))
for col, cells in painted.items():
    for f, c in enumerate(cells):
        sheet.paste(c, (col * CELL * UP, f * CELL * UP))
sheet.save(ASSETS / "14-repaint@4x.png", optimize=True)
sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / "14-repaint.png", optimize=True)
print("wrote 14-repaint@4x.png and 14-repaint.png", file=sys.stderr)
