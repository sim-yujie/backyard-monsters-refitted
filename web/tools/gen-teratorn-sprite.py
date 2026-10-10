"""
Build the repainted Teratorn (C14) sprite sheet from Codex-painted frames. Art trial, Teratorn only.
Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-teratorn-sprite.py <source folder>

The source folder holds the grids that Codex painted on a flat #FF00FF ground (web/tools/teratorn-kit/make_batch.py
builds the inputs and the prompt of each call), named after the sheet columns they cover, top to bottom:
frames-8-9-10.png ... Each grid has one row per heading and 3 columns, the three wing-flap frames (wings raised, half way,
swept low), the body identical in the three and only the wings moving.

The original sheet is a mirror image of itself: column c flipped left to right is column 16 - c, one pixel over. So only
columns 8 to 24 (facing down round to facing up through left) are painted; the rest are flipped.

Each painted cell is keyed (every magenta pixel becomes clear) and scaled so its silhouette covers about as many pixels as
the old sprite's does (AREA), the factor smoothed over the 5 nearest headings and blended towards the median so the small
old front view does not make the new one small. One scale and offset serves a heading's three frames (so the body does not
wobble from frame to frame): the union of the three frames is centred on the old sprite and its feet stand on the old
sprite's bottom, and is kept inside the cell. Output, in the original layout (32 headings x 3 flap frames, 28x28 cells):

    server/public/assets/monsters/14-repaint.png      896x84
    server/public/assets/monsters/14-repaint@4x.png   3584x336, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in web/src/game/attack/monsterSprites.ts).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage as ndi

CELL = 28
COLS, ROWS = 32, 3
UP = 4                     # the repaint's scale
GAMMA = 0.9                # lifts the painting a little so it reads at the real size
MARGIN = 1.0               # keep this many 1x pixels inside the cell
AREA = 1.2                 # new silhouette area / old silhouette area (1 = the same size as the old sprite)
BLEND = 0.5                # how far each heading's size is pulled to the median (the old front view is small)

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / "14.v1.png").convert("RGBA")


def original_cell(col, frame):
    return np.asarray(ORIGINAL.crop((col * CELL, frame * CELL, (col + 1) * CELL, (frame + 1) * CELL))).astype(int)


def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def key(path, rows):
    """The grid's cells as RGBA cutouts: cells[row][frame]."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=float)
    h, w = rgb.shape[:2]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(r, b)
    ground = (g < np.minimum(r, b) * 0.62) & (np.abs(r - b) < 0.4 * mx) & (mx > 60)
    fg = ndi.binary_opening(~ground, iterations=1)
    cw, ch = w // 3, h // rows
    keep = np.zeros_like(fg)
    lab, _ = ndi.label(fg)
    for ry in range(rows):
        for cx in range(3):
            y0, x0 = ry * ch, cx * cw
            sub = lab[y0:y0 + ch, x0:x0 + cw]
            ids, cnt = np.unique(sub[sub > 0], return_counts=True)
            for i, c in zip(ids, cnt):
                if c > cnt.max() * 0.02:
                    keep[y0:y0 + ch, x0:x0 + cw] |= sub == i
    keep &= ~((r > 190) & (b > 150) & (g < 90) & (np.abs(r - b) < 70))   # stray ground flecks
    keep = ndi.binary_erosion(keep, iterations=1)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.0)))
    cut = Image.fromarray(np.dstack([rgb, alpha]).astype("uint8"), "RGBA")
    return [[cut.crop((cx * cw, ry * ch, (cx + 1) * cw, (ry + 1) * ch)) for cx in range(3)] for ry in range(rows)]


def resize_premultiplied(im, size):
    """LANCZOS resize with the colour weighted by alpha, so the magenta ground leaves no fringe."""
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    chans = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(chans)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def area(im):
    return float((np.asarray(im)[..., 3] > 200).sum())


painted = {}
for path in sorted(SOURCE.glob("frames-*.png"), key=lambda p: [int(c) for c in p.stem.split("-")[1:]]):
    cols = [int(c) for c in path.stem.split("-")[1:]]
    for col, cells in zip(cols, key(path, len(cols))):
        painted[col] = cells          # a heading in two grids: the later grid wins
if sorted(painted) != list(range(8, 25)):
    sys.exit(f"painted columns {sorted(painted)}, need 8 to 24")

# old silhouette (any visible pixel, faint wings included) of the middle frame, per heading
old = {c: float((original_cell(c, 1)[..., 3] > 40).sum()) for c in range(COLS)}
med = float(np.median([old[c] for c in painted]))
target = {c: AREA * ((1 - BLEND) * old[c] + BLEND * med) for c in painted}
size = {c: np.sqrt(target[c]) for c in painted}           # wanted size in 1x pixels (square root of the area)
fit, scale, cap = {}, {}, {}
for c, cells in painted.items():
    near = [size[min(24, max(8, c + d))] for d in range(-2, 3)]
    k = float(np.mean(near)) / np.sqrt(area(cells[1]))     # 1x pixels per painted pixel
    boxes = [bbox(np.asarray(f)[..., 3] > 40) for f in cells]
    ux0, uy0, ux1, uy1 = min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)
    om = original_cell(c, 1)[..., 3] > 235
    ox0, oy0, ox1, oy1 = bbox(om if om.any() else original_cell(c, 1)[..., 3] > 40)
    cx, bottom = (ox0 + ox1) / 2, min(oy1 + 0.5, CELL - MARGIN)
    mid = (ux0 + ux1) / 2
    left, right = (mid - ux0) * k, (ux1 - mid) * k
    limit = min((cx - MARGIN) / left, (CELL - MARGIN - cx) / right, (bottom - MARGIN) / ((uy1 - uy0) * k))
    scale[c] = k * min(1.0, limit)
    cap[c] = k * limit
    fit[c] = (cx, bottom, mid, uy1)
    print(f"column {c:2}: want {k:.4f} limit {limit:.3f} scale {scale[c]:.4f}" + (" (cut to fit the cell)" if limit < 1 else ""), file=sys.stderr)

# smooth the cut sizes too (a heading cut harder than its neighbours would pulse), but never past the cell
cut = {c: scale[c] * np.sqrt(area(painted[c][1])) for c in scale}
scale = {c: min(cap[c], float(np.mean([cut[min(24, max(8, c + d))] for d in range(-2, 3)])) / np.sqrt(area(painted[c][1]))) for c in scale}

cw = CELL * UP
cells_out = {}
for c, cells in painted.items():
    cx, bottom, mid, fy1 = fit[c]
    s = scale[c] * UP
    frames = []
    for f in cells:
        mon = resize_premultiplied(f, (max(1, round(f.width * s)), max(1, round(f.height * s))))
        px = np.asarray(mon).astype(float)
        px[..., :3] = 255 * (px[..., :3] / 255) ** GAMMA
        mon = Image.fromarray(px.astype("uint8"), "RGBA")
        ox, oy = round(cx * UP - mid * s), round(bottom * UP - fy1 * s)
        layer = Image.new("RGBA", (cw + 2 * mon.width, cw + 2 * mon.height))
        layer.alpha_composite(mon, (mon.width + ox, mon.height + oy))
        frames.append(layer.crop((mon.width, mon.height, mon.width + cw, mon.height + cw)))
    cells_out[c] = frames

for col in range(COLS):
    if col in cells_out:
        continue
    # flipped, then one 1x pixel left, as the original's own mirror pairs sit
    cells_out[col] = []
    for m in cells_out[(16 - col) % COLS]:
        shifted = Image.new("RGBA", m.size)
        shifted.paste(ImageOps.mirror(m), (-UP, 0))
        cells_out[col].append(shifted)

sheet = Image.new("RGBA", (COLS * cw, ROWS * cw))
for col, frames in cells_out.items():
    for f, im in enumerate(frames):
        sheet.paste(im, (col * cw, f * cw))
sheet.save(ASSETS / "14-repaint@4x.png", optimize=True)
sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / "14-repaint.png", optimize=True)
print("wrote 14-repaint@4x.png and 14-repaint.png", file=sys.stderr)
