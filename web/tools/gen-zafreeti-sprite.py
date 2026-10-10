"""
Build the repainted Zafreeti (C15) sprite sheet from Codex-painted frames.
Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-zafreeti-sprite.py <source folder>

The source folder holds the 2x2 grids that Codex painted on a flat #FF00FF ground (web/tools/zafreeti-kit/make_batch.py
builds the inputs and the prompt of each call), named after the four sheet columns they cover, left to right then
top to bottom: frames-0-1-2-3.png ... A quadrant that is not to be used (a column painted better in another grid)
is written `x`, e.g. frames-x-x-28-29.png.

Each painted frame is keyed (the magenta ground is flood-filled from the edge) and scaled so its whole silhouette covers
about as many pixels as the old sprite does (AREA), with one factor smoothed over the 5 nearest headings so the size does not wobble. The monster stands
on the old sprite's centre (it flies; its shadow is a separate sprite), so no ground shadow is drawn. Output, in the original layout (32 headings in one row, 0 = east, clockwise, 11.25 degrees apart;
56x70 cells, 1 row):

    server/public/assets/monsters/zafreeti-repaint.png      1792x70
    server/public/assets/monsters/zafreeti-repaint@4x.png   7168x280, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in web/src/game/attack/monsterSprites.ts).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi

CELL = (56, 70)
ROWS = 1
DIRS = 32                  # headings the game uses
COLS = 32                  # columns of the sheet
UP = 4                     # the repaint's scale
GAMMA = 1.0               # lifts the painting a little so it reads at the real size
OVER = 1.0                # the horns may run this much past the cell (they are cut at the cell edge), so the body can stay near the old size
MARGIN = 0.5               # keep this many 1x pixels inside the cell
AREA = 1.2               # new silhouette area / old silhouette area (1 = the same size as the old sprite)

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / "zafreeti.v2.png").convert("RGBA")


def original_cell(col):
    return np.asarray(ORIGINAL.crop((col * CELL[0], 0, (col + 1) * CELL[0], CELL[1]))).astype(int)


def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def old_body(col):
    c = original_cell(col)
    solid = c[..., 3] > 235
    return solid, solid


def teal(im):
    """The whole painted monster (solid pixels of the cutout)."""
    return np.asarray(im)[..., 3] > 200


def key(path):
    """The 4 monsters of a grid as RGBA cutouts, one per quadrant (cut at half the width and height)."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=float)
    h, w = rgb.shape[:2]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(r, b)
    ground = (r > 185) & (b > 185) & (g < 110) & (np.abs(r - b) < 55)   # true magenta only, so the purple spikes survive
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ndi.binary_opening(~np.isin(lab, list(edge)), iterations=2)
    lab2, _ = ndi.label(fg)
    keep = np.zeros_like(fg)
    for q in range(4):
        x0, y0 = (q % 2) * w // 2, (q // 2) * h // 2
        sub = lab2[y0:y0 + h // 2, x0:x0 + w // 2]
        ids, cnt = np.unique(sub[sub > 0], return_counts=True)
        for i, c in zip(ids, cnt):
            if c > cnt.max() * 0.02:
                keep[y0:y0 + h // 2, x0:x0 + w // 2] |= sub == i
    keep = ndi.binary_fill_holes(keep)
    keep &= ~((r > 215) & (b > 190) & (g < 90) & (np.abs(r - b) < 40))   # stray ground flecks
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2)))
    cut = Image.fromarray(np.dstack([rgb, alpha]).astype("uint8"), "RGBA")
    return [cut.crop(((q % 2) * w // 2, (q // 2) * h // 2, (q % 2 + 1) * w // 2, (q // 2 + 1) * h // 2)) for q in range(4)]


def resize_premultiplied(im, size):
    """LANCZOS resize with the colour weighted by alpha, so the magenta ground leaves no fringe."""
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    chans = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(chans)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


painted = {}
for path in sorted(SOURCE.glob("frames-*.png"), key=lambda p: [int(c) for c in p.stem.split("-")[1:] if c != "x"]):
    names = path.stem.split("-")[1:]
    for name, cut in zip(names, key(path)):
        if name != "x":
            painted.setdefault(int(name), cut)
missing = [c for c in range(DIRS) if c not in painted]
if missing:
    sys.exit(f"no painting of columns {missing}")

# one scale per heading: the old silhouette area over the new one, smoothed over 5 headings
cover = {}
for col, cut in painted.items():
    cover[col] = np.sqrt(AREA * old_body(col)[1].sum() / teal(cut).sum())   # 1x pixels per painted pixel
scale, fit, cap = {}, {}, {}
for col, cut in painted.items():
    # the painted grids differ in resolution, so smooth the size in 1x pixels (scale x sqrt of the painted area), not the scale
    near = [cover[(col + d) % DIRS] * np.sqrt(teal(painted[(col + d) % DIRS]).sum()) for d in range(-2, 3)]
    k = float(np.median(near)) / np.sqrt(teal(cut).sum())
    solid, green = old_body(col)
    gx0, gy0, gx1, gy1 = bbox(green)
    tx0, ty0, tx1, ty1 = bbox(teal(cut))
    cx = (gx0 + gx1) / 2
    bottom = min((gy0 + gy1) / 2 + (ty1 - ty0) * k / 2, CELL[1] - 0.5)   # a flier: the painting is centred on the old sprite's centre (its shadow is a separate sprite)
    fx0, fy0, fx1, fy1 = bbox(np.asarray(cut)[..., 3] > 40)
    mid = (tx0 + tx1) / 2
    left, right = (mid - fx0) * k, (fx1 - mid) * k
    # the whole painting (horns included) has to stay in the cell
    limit = OVER * min((cx - MARGIN) / left, (CELL[0] - MARGIN - cx) / right, (bottom - MARGIN) / ((fy1 - fy0) * k))
    scale[col] = k * min(1.0, limit)
    cap[col] = k * limit
    fit[col] = (cx, bottom, mid, fy1)
    print(f"column {col:2}: want {k:.4f} limit {limit:.3f} scale {scale[col]:.4f}" + (" (cut to fit the cell)" if limit < 1 else ""), file=sys.stderr)

# smooth the cut sizes too (a heading cut harder than its neighbours would pulse), but never past the cell
size = {c: scale[c] * np.sqrt(teal(painted[c]).sum()) for c in scale}
scale = {c: min(cap[c], float(np.mean([size[(c + d) % DIRS] for d in range(-2, 3)])) / np.sqrt(teal(painted[c]).sum())) for c in scale}

cw, ch = CELL[0] * UP, CELL[1] * UP
sheet = Image.new("RGBA", (COLS * cw, ch * ROWS))
for col in range(DIRS):
    cut = painted[col]
    cx, bottom, mid, fy1 = fit[col]
    s = scale[col] * UP
    mon = resize_premultiplied(cut, (max(1, round(cut.width * s)), max(1, round(cut.height * s))))
    px = np.asarray(mon).astype(float)
    px[..., :3] = 255 * (px[..., :3] / 255) ** GAMMA
    mon = Image.fromarray(px.astype("uint8"), "RGBA")
    bx, by = cx * UP, bottom * UP
    ox, oy = round(bx - mid * s), round(by - fy1 * s)
    cell = Image.new("RGBA", (cw, ch))
    layer = Image.new("RGBA", (cw, ch))
    layer.paste(mon, (ox, oy))
    cell.alpha_composite(layer)
    sheet.paste(cell, (col * cw, 0))

sheet.save(ASSETS / "zafreeti-repaint@4x.png", optimize=True)
sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / "zafreeti-repaint.png", optimize=True)
print("wrote zafreeti-repaint@4x.png and zafreeti-repaint.png", file=sys.stderr)
