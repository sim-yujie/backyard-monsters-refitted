"""
Build the repainted Bolt (C3) sprite sheet from Gemini-painted frames.
Art trial, Bolt only. Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-bolt-sprite.py <source folder> [--partial]

The source folder holds Gemini's repaints of the original frames, each a 2x2
grid on a flat #FF00FF ground named after the four sheet columns it covers,
left to right then top to bottom:

    frames-0-1-2-3.png   ...   frames-26-27-28-29.png

Each grid was made by handing Gemini the original frames blown up 8x (every
frame in a 320x256 cell, the 240x224 blow-up at 40,16, on grey) plus the
approved test repaint and the portrait (web/tools/bolt-kit/run-full.sh has
the prompt; docs/art/monster-sprites.md the method). If a column is in two
grids the first one (by file name) is used.

Each painted frame is keyed (the magenta ground and its purple shadow are
flood-filled from the edge), scaled with one factor for all 30 headings (so
the size does not wobble) so the body fills the cell about as much as the
original does, stood on the original's ground point, lifted a little brighter
so it reads at the real size, and given a soft ground shadow redrawn under it,
as the original bakes one in. Output, in the original layout (30 headings in
one row, 0 = east, clockwise, 12 degrees apart; 30x28 cells, anchor 7,20):

    server/public/assets/monsters/bolt-repaint.png      900x28
    server/public/assets/monsters/bolt-repaint@4x.png   3600x112, the same at 4x

The game draws the @4x sheet (REPAINTED_SHEETS in
web/src/game/attack/monsterSprites.ts). With --partial, headings that have no
painting yet keep the original frame, blown up 4x.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi

CELL = (30, 28)
DIRS = 30
UP = 4                     # the repaint's scale
GAMMA = 0.75               # lifts the dark shell so it reads at the real size
MARGIN = 0.5               # keep this many 1x pixels inside the cell
SINK = 2.0                 # the painted body stands this many 1x pixels below the original's body bottom (its shadow sits there)

# per-heading fixes, no repaint needed: size up the narrow back views, keep the cut-off ones well inside the cell,
# and take the blue out of the glossy shell highlights so they match the black shell of the front views
SIZE_UP = {22: 1.1, 23: 1.1}
EXTRA_MARGIN = {28: 1.0, 29: 1.0}   # 1x pixels, on top of MARGIN
DEBLUE = {17: 0.85, 21: 0.85, 25: 0.85, 26: 0.85, 27: 0.85}   # how much of the blue cast is removed

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PARTIAL = "--partial" in sys.argv
if len(args) != 1:
    sys.exit(__doc__)
SOURCE = Path(args[0])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / "sprite.3.v2.png").convert("RGBA")


def original_cell(col):
    return ORIGINAL.crop((col * CELL[0], 0, (col + 1) * CELL[0], CELL[1]))


def bbox(mask):
    ys, xs = np.where(mask)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def key(path):
    """The 4 monsters of a grid as RGBA cutouts, one per quadrant (cut at half the width and height)."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=float)
    h, w = rgb.shape[:2]
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(r, b)
    ground = (g < np.minimum(r, b) * 0.62) & (np.abs(r - b) < 0.4 * mx) & (mx > 60)
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
    keep &= ~((r > 190) & (b > 150) & (g < 90) & (np.abs(r - b) < 70))   # stray ground flecks
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2)))
    cut = Image.fromarray(np.dstack([rgb, alpha]).astype("uint8"), "RGBA")
    return [cut.crop(((q % 2) * w // 2, (q // 2) * h // 2, (q % 2 + 1) * w // 2, (q // 2 + 1) * h // 2)) for q in range(4)]


def body_box(im):
    """Bounding box of the solid body, ignoring thin things (tongue, spike tips) and the soft edge."""
    solid = np.asarray(im)[..., 3] > 200
    opened = ndi.binary_opening(solid, iterations=3)
    return bbox(opened if opened.any() else solid)


def original_box(col):
    """The original's body in 1x pixels: solid pixels only, which leaves out its soft baked shadow."""
    return bbox(np.asarray(original_cell(col))[..., 3] > 235)


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
for path in sorted(SOURCE.glob("frames-*.png"), key=lambda p: [int(c) for c in p.stem.split("-")[1:]]):
    cols = [int(c) for c in path.stem.split("-")[1:]]
    for col, cut in zip(cols, key(path)):
        painted.setdefault(col, cut)

missing = [c for c in range(DIRS) if c not in painted]
if missing and not PARTIAL:
    sys.exit(f"no painting of columns {missing}")

# one scale per heading: what covers the original's body box, smoothed over the 5 nearest headings so the
# size does not wobble, then cut if the monster would leave the cell once stood on the original's ground point
trim, cover = {}, {}
for col, cut in painted.items():
    x0, y0, x1, y1 = trim[col] = body_box(cut)
    ox0, oy0, ox1, oy1 = original_box(col)
    cover[col] = max((ox1 - ox0) / (x1 - x0), (oy1 - oy0) / (y1 - y0))
scale = {}
for col, cut in painted.items():
    near = [cover[(col + d) % DIRS] for d in range(-2, 3) if (col + d) % DIRS in cover]
    k = float(np.median(near)) * SIZE_UP.get(col, 1.0)   # 1x pixels per painted pixel
    x0, y0, x1, y1 = trim[col]
    ox0, oy0, ox1, oy1 = original_box(col)
    cx, bottom = (ox0 + ox1) / 2, oy1 + SINK
    fx0, fy0, fx1, fy1 = bbox(np.asarray(cut)[..., 3] > 40)
    mid = (x0 + x1) / 2
    left, right, up = (mid - fx0) * k, (fx1 - mid) * k, (y1 - fy0) * k
    m = MARGIN + EXTRA_MARGIN.get(col, 0)
    limit = min((cx - m) / left, (CELL[0] - m - cx) / right, (bottom - m) / up)
    scale[col] = k * min(1.0, limit)
    print(f"column {col:2}: scale {scale[col]:.4f}" + (" (cut to fit the cell)" if limit < 1 else ""), file=sys.stderr)

cw, ch = CELL[0] * UP, CELL[1] * UP
sheet = Image.new("RGBA", (DIRS * cw, ch))
for col in range(DIRS):
    if col not in painted:
        sheet.paste(original_cell(col).resize((cw, ch), Image.LANCZOS), (col * cw, 0))
        continue
    cut = painted[col]
    x0, y0, x1, y1 = trim[col]
    ox0, oy0, ox1, oy1 = original_box(col)
    s = scale[col] * UP
    mon = resize_premultiplied(cut, (max(1, round(cut.width * s)), max(1, round(cut.height * s))))
    px = np.asarray(mon).astype(float)
    px[..., :3] = 255 * (px[..., :3] / 255) ** GAMMA
    if col in DEBLUE:
        r, g, b = px[..., 0], px[..., 1], px[..., 2]
        luma = 0.3 * r + 0.59 * g + 0.11 * b
        bluish = np.clip((b - np.maximum(r, g)) / 40, 0, 1)   # 0 for the pink body, 1 for the blue gloss
        for i in range(3):
            px[..., i] += (luma - px[..., i]) * bluish * DEBLUE[col]
    mon = Image.fromarray(px.astype("uint8"), "RGBA")
    bx, by = (ox0 + ox1) / 2 * UP, (oy1 + SINK) * UP        # ground point: bottom centre of the original's body
    ox, oy = round(bx - (x0 + x1) / 2 * s), round(by - y1 * s)
    shadow = Image.new("L", (cw, ch), 0)
    sw = (x1 - x0) * s * 0.55
    ImageDraw.Draw(shadow).ellipse((bx - sw, by - sw * 0.32 - 1.5 * UP, bx + sw, by + sw * 0.32 - 1.5 * UP), fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.3 * UP))
    cell = Image.new("RGBA", (cw, ch))
    cell.paste((20, 25, 15, 255), (0, 0), shadow)
    layer = Image.new("RGBA", (cw, ch))
    layer.paste(mon, (ox, oy))
    cell.alpha_composite(layer)
    sheet.paste(cell, (col * cw, 0))

sheet.save(ASSETS / "bolt-repaint@4x.png", optimize=True)
sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / "bolt-repaint.png", optimize=True)
note = f" (columns {missing} still original)" if missing else ""
print("wrote bolt-repaint@4x.png and bolt-repaint.png" + note, file=sys.stderr)
