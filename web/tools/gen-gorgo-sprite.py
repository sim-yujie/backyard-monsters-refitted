"""
Build the repainted Gorgo (G1_1, ape_1.png) sprite sheet from Codex-painted frames.
Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-gorgo-sprite.py <source folder>

The source folder holds one painted 4x2 grid per call, `A<col>/frames-new.png` (cell 1 = idle, cells 2-8 = walk rows 1-7) and
`B<col>/frames-new.png` (cell 1 = idle again, cells 2-8 = attack rows 8-14), on a flat #FF00FF ground (web/tools/gorgo-kit/make_batch.py
builds the inputs and the prompt of each call). Only the columns 2..10 (front, through left, to back) are painted; the other columns of the
sheet (11..15, 0, 1: the right-hand half of the turn) are the painted ones mirrored about the anchor (column c = column (4 - c) mod 16 flipped):
a monster is left/right symmetric.

Each painted frame is keyed (the ground is flood-filled from the cell edge) and scaled so that the idle silhouette covers AREA times the pixels the
old idle body does (one factor per heading, smoothed over the neighbouring headings; walk frames are held to within a few percent of it so the
body does not pulse). Placement is by the FEET: the idle sits on the old idle's ground line and centre; walk frames keep the feet on exactly the
same ground pixel; attack frames follow the old sheet's lift and shift (old rows 12-13 leap). Output, in the original layout (16 headings,
15 rows, 96x69 cells):

    server/public/assets/monsters/ape_1-repaint.png      1536x1035
    server/public/assets/monsters/ape_1-repaint@4x.png   6144x4140, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in web/src/game/attack/monsterSprites.ts).
"""
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

CELL = (96, 69)
COLS = 16
ROWS = 15
UP = 4
PAINTED = list(range(2, 11))      # columns that are painted; the rest are mirrored
if os.environ.get("GORGO_PARTIAL"):   # a test run before every heading is painted: only those with a source folder
    PAINTED = [c for c in PAINTED if os.path.exists(os.path.join(sys.argv[1], f"B{c}", "frames-new.png"))]
AREA = 1.05                       # new idle silhouette area / old idle body area
WALK_HOLD = 0.04                  # a walk frame may differ from the idle's size by this much

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / "ape_1.png").convert("RGBA")


def old_body(col, row):
    cell = ORIGINAL.crop((col * CELL[0], row * CELL[1], (col + 1) * CELL[0], (row + 1) * CELL[1]))
    return np.asarray(cell)[..., 3] >= 200     # the baked drop shadow is translucent


def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def feet(mask, frac=0.25):
    """x centroid of the lowest `frac` of the silhouette height (the feet) and the lowest row."""
    x0, y0, x1, y1 = bbox(mask)
    ys, xs = np.where(mask)
    sel = ys >= y1 - max(2, int((y1 - y0) * frac))
    return xs[sel].mean(), y1


def key_cell(rgb):
    """RGBA cutout of one painted cell: the magenta ground is flood-filled from the cell edge."""
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ground = (r > 175) & (b > 175) & (g < 120) & (np.abs(r - b) < 70)
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ndi.binary_opening(~np.isin(lab, list(edge)), iterations=1)
    lab2, _ = ndi.label(fg)
    ids, cnt = np.unique(lab2[lab2 > 0], return_counts=True)
    keep = np.zeros_like(fg)
    for i, c in zip(ids, cnt):
        if c > cnt.max() * 0.02:
            keep |= lab2 == i
    keep = ndi.binary_fill_holes(keep)
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    # despill the magenta fringe on the rim only (the creature is blue, so red and blue both above green next to the ground is spill)
    rim = ndi.binary_dilation(keep & ~ndi.binary_erosion(keep, iterations=5), iterations=2) & (alpha > 0)
    spill = rim & (r > g + 25) & (b > g + 25)
    out = rgb.copy()
    out[..., 0] = np.where(spill, np.minimum(r, g + 0.35 * (b - g)), r)
    return Image.fromarray(np.dstack([out, alpha]).astype("uint8"), "RGBA")


def grid_cells(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    cw, ch = w // 4, h // 2
    return [key_cell(np.asarray(im.crop(((i % 4) * cw, (i // 4) * ch, (i % 4 + 1) * cw, (i // 4 + 1) * ch)))) for i in range(8)]


def solid(im):
    return np.asarray(im)[..., 3] > 200


def resize_premultiplied(im, size):
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    chans = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(chans)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


# frames[col][row] = keyed cutout; "b_idle" = the idle cell of the attack call
frames = {}
for col in PAINTED:
    a, b = SOURCE / f"A{col}" / "frames-new.png", SOURCE / f"B{col}" / "frames-new.png"
    if not a.exists() or not b.exists():
        sys.exit(f"missing painting of column {col}")
    ca, cb = grid_cells(a), grid_cells(b)
    frames[col] = {r: ca[r] for r in range(8)}
    frames[col].update({r: cb[r - 7] for r in range(8, 15)})
    frames[col]["b_idle"] = cb[0]

# one size per heading (sqrt of the idle area, in 1x pixels), smoothed 1-2-1 over the neighbours
want = {c: np.sqrt(AREA * old_body(c, 0).sum()) for c in PAINTED}
k = {}
for i, c in enumerate(PAINTED):
    near = [want[PAINTED[j]] for j in (i - 1, i, i, i + 1) if 0 <= j < len(PAINTED)]
    k[c] = float(np.mean(near)) / np.sqrt(solid(frames[c][0]).sum())

cw, ch = CELL[0] * UP, CELL[1] * UP
placed = {}      # (col, row) -> RGBA cell at 4x
for c in PAINTED:
    old_idle = old_body(c, 0)
    old_fx, old_ground = feet(old_idle)
    old_cx = np.where(old_idle)[1].mean()
    idle_s = solid(frames[c][0])
    area_a0 = idle_s.sum()
    area_b0 = solid(frames[c]["b_idle"]).sum()
    ka = k[c]
    for row in range(ROWS):
        cut = frames[c][row]
        s = solid(cut)
        if row == 0:
            kk = ka
        elif row < 8:
            kk = ka * float(np.clip(np.sqrt(area_a0 / s.sum()), 1 - WALK_HOLD, 1 + WALK_HOLD))
        else:
            kk = ka * np.sqrt(area_a0 / area_b0)     # the attack call's own idle fixes its scale
        fx, bottom = feet(s)
        if row == 0:
            idle_ox = old_cx - np.where(s)[1].mean() * kk       # silhouette centre on the old body centre
            feet_x = fx * kk + idle_ox                           # where the idle's feet are in the cell
            dx = dy = 0.0
        else:
            dx = dy = 0.0
            if row >= 8:
                nx, ny = feet(old_body(c, row))
                dx, dy = nx - old_fx, ny - old_ground
                dy = 0.0 if abs(dy) < 2 else dy
                dx = 0.0 if abs(dx) < 1.5 else dx
        ox = feet_x + dx - fx * kk
        oy = old_ground + dy - bottom * kk
        big = resize_premultiplied(cut, (max(1, round(cut.width * kk * UP)), max(1, round(cut.height * kk * UP))))
        left, top = round(ox * UP), round(oy * UP)
        layer = Image.new("RGBA", (cw, ch))
        layer.alpha_composite(big, (max(0, left), max(0, top)), (max(0, -left), max(0, -top)))
        lost = np.asarray(big)[..., 3] > 40
        kept = np.asarray(layer)[..., 3] > 40
        if lost.sum() > kept.sum() * 1.002:
            print(f"column {c} row {row}: {int(lost.sum() - kept.sum())} opaque 4x pixels cut by the cell edge", file=sys.stderr)
        placed[(c, row)] = layer
    print(f"column {c:2}: scale {ka:.4f}", file=sys.stderr)

sheet = Image.new("RGBA", (COLS * cw, ROWS * ch))
for col in range(COLS):
    src = col if col in PAINTED else (4 - col) % 16
    if src not in PAINTED:
        continue
    for row in range(ROWS):
        cell = placed[(src, row)]
        if col not in PAINTED:
            cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
        sheet.paste(cell, (col * cw, row * ch))
sheet.save(ASSETS / "ape_1-repaint@4x.png", optimize=True)
sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / "ape_1-repaint.png", optimize=True)
print("wrote ape_1-repaint@4x.png and ape_1-repaint.png", file=sys.stderr)
