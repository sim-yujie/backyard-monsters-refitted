"""
Build the repainted Fomor (G3_1, fly_1.png) sprite sheet from Codex-painted frames.
Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-fomor-sprite.py <source folder>

The source folder holds one painted 4x2 grid per heading, `H<col>/frames-new.png` (cell 1 = idle, cells 2-8 = walk rows 1-7) on a flat #FF00FF
ground (web/tools/fomor-kit/make_batch.py builds the inputs and the prompt of each call). All 16 columns are painted: the old sheet is not
left/right symmetric.

Each painted frame is keyed (the ground is flood-filled from the cell edge) and scaled so that the idle silhouette covers AREA times the pixels the
old idle body does (one factor per heading, smoothed over the neighbouring headings; walk frames are held to within a few percent of it so the
body does not pulse). Placement is by the FEET: the idle sits on the old idle's ground line and centre; walk frames keep the feet on exactly the
same ground pixel. Output, in the original layout (16 headings, 8 rows, 53x40 cells):

    server/public/assets/monsters/fly_1-repaint.png      848x320
    server/public/assets/monsters/fly_1-repaint@4x.png   3392x1280, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in web/src/game/attack/monsterSprites.ts).
"""
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

CELL = (53, 40)
COLS = 16
ROWS = 8
UP = 4
PAINTED = list(range(16))         # every column is painted: the old sheet is not left/right symmetric
if os.environ.get("FOMOR_PARTIAL"):   # a test run before every heading is painted: only those with a source folder
    PAINTED = [c for c in PAINTED if os.path.exists(os.path.join(sys.argv[1], f"H{c}", "frames-new.png"))]
AREA = 1.05                       # new idle silhouette area / old idle body area
WALK_HOLD = 0.04                  # a walk frame may differ from the idle's size by this much

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / "fly_1.png").convert("RGBA")


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
    # despill the magenta fringe on the rim only (the creature is purple, so only a strongly pink fringe counts as spill)
    rim = ndi.binary_dilation(keep & ~ndi.binary_erosion(keep, iterations=5), iterations=2) & (alpha > 0)
    spill = rim & (np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 130)
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
    a = SOURCE / f"H{col}" / "frames-new.png"
    if not a.exists():
        sys.exit(f"missing painting of column {col}")
    frames[col] = dict(enumerate(grid_cells(a)))

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
    ka = k[c]
    for row in range(ROWS):
        cut = frames[c][row]
        s = solid(cut)
        if row == 0:
            kk = ka
        else:
            kk = ka * float(np.clip(np.sqrt(area_a0 / s.sum()), 1 - WALK_HOLD, 1 + WALK_HOLD))
        fx, bottom = feet(s)
        if row == 0:
            idle_ox = old_cx - np.where(s)[1].mean() * kk       # silhouette centre on the old body centre
            feet_x = fx * kk + idle_ox                           # where the idle's feet are in the cell
            dx = dy = 0.0
        else:
            dx = dy = 0.0
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

def clean_magenta(cell):
    """Last despill on the finished cell: any pixel still close to the #FF00FF ground (the purple body is darker) loses its blue."""
    a = np.asarray(cell).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bad = (a[..., 3] > 0) & (np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 75)
    a[..., 2] = np.where(bad, np.minimum(b, g + 0.15 * (r - g)), b)
    return Image.fromarray(a.astype("uint8"), "RGBA")


# Codex paints the run hotter and more magenta than the approved sample (and some headings redder than others). Each heading's purple body
# pixels (green well below red and blue: not the yellow eyes, cream spikes or blue bumps) get one per-channel affine grade onto the mean and spread
# of the body pixels of the 4 approved headings (art-trials/champions/fomor/new-heading0-3), blended in by how purple the pixel is. The same grade
# for every cell of a heading, so its frames never differ from each other.
SAMPLE_MEAN = np.array([82.1, 32.8, 66.7])
SAMPLE_STD = np.array([29.8, 21.2, 24.6])


def purple(a):
    """How purple (0-1) each pixel of an RGB array is."""
    return np.clip((np.minimum(a[..., 0], a[..., 2]) - a[..., 1]) / 40, 0, 1)


def grade_all(cells):
    out = {}
    for c in range(COLS):
        keys = [k for k in cells if k[0] == c]
        if not keys:
            continue
        px = np.concatenate([np.asarray(cells[k])[np.asarray(cells[k])[..., 3] > 200][:, :3].astype(float) for k in keys])
        body = px[purple(px) > 0.5]
        mean, std = body.mean(0), body.std(0)
        for k in keys:
            a = np.asarray(cells[k]).astype(float)
            g = np.clip((a[..., :3] - mean) * (SAMPLE_STD / std) + SAMPLE_MEAN, 0, 255)
            w = purple(a[..., :3])[..., None]
            a[..., :3] = a[..., :3] * (1 - w) + g * w
            out[k] = Image.fromarray(a.astype("uint8"), "RGBA")
    return out


cleaned = grade_all({k: clean_magenta(v) for k, v in placed.items()})
sheet = Image.new("RGBA", (COLS * cw, ROWS * ch))
for col in range(COLS):
    src = col if col in PAINTED else (4 - col) % 16
    if src not in PAINTED:
        continue
    for row in range(ROWS):
        cell = cleaned[(src, row)]
        if col not in PAINTED:
            cell = cell.transpose(Image.FLIP_LEFT_RIGHT)
        sheet.paste(cell, (col * cw, row * ch))
sheet.save(ASSETS / "fly_1-repaint@4x.png", optimize=True)
sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / "fly_1-repaint.png", optimize=True)
print("wrote fly_1-repaint@4x.png and fly_1-repaint.png", file=sys.stderr)
