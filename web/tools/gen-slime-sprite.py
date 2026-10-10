"""
Build the repainted Slimeattikus (C17) and mini slime (C18) sprite sheets from Codex-painted frames.
Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-slime-sprite.py <source folder>

The source folder holds the 2x2 grids that Codex painted on a flat #FF00FF ground (web/tools/slime-kit/make_batch.py
builds the inputs and the prompt of each call), named after the four sheet columns they cover: frames-0-1-2-3.png ...
The game only ever draws row 0 of both sheets (a single-pose creep), so only row 0 is painted; rows 1-5 are the old rows
scaled up 4x so the sheet keeps its layout. The mini slime uses the same painted frames, scaled to its own old size.
Each painted frame is keyed, scaled so its silhouette covers about AREA times the old sprite's pixels (one factor
smoothed over 5 headings), stood on the old sprite's lowest solid row and given a soft shadow. Output per sheet (32 columns,
6 rows, 0 = east, clockwise, 11.25 degrees apart): <name>-repaint.png (1x) and <name>-repaint@4x.png.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi

SHEETS = [("slimeattikus_anim", "slimeattikus", (48, 31)), ("slimeattikusmini_anim", "slimeattikusmini", (30, 20))]
ROWS = 6
DIRS = 32                  # headings the game uses
COLS = 32                  # columns of the sheet
UP = 4                     # the repaint's scale
GAMMA = 1.0               # lifts the painting a little so it reads at the real size
OVER = 1.0                # the horns may run this much past the cell (they are cut at the cell edge), so the body can stay near the old size
MARGIN = 0.5               # keep this many 1x pixels inside the cell
AREA = 1.1               # new silhouette area / old silhouette area (1 = the same size as the old sprite)

if len(sys.argv) != 2:
    sys.exit(__doc__)
SOURCE = Path(sys.argv[1])
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
CELL = ORIGINAL = None   # set per sheet below


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

for SRC, OUT, CELL in SHEETS:
    ORIGINAL = Image.open(ASSETS / f"{SRC}.png").convert("RGBA")
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
        bottom = min(gy1, CELL[1] - 0.5)   # stands on the old sprite's lowest solid row
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
    # rows 1-5 are never drawn: keep the old ones, scaled up
    sheet.paste(ORIGINAL.crop((0, CELL[1], ORIGINAL.width, ORIGINAL.height)).resize((COLS * cw, ch * (ROWS - 1)), Image.NEAREST), (0, ch))
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
        layer = Image.new("RGBA", (cw, ch))
        layer.paste(mon, (ox, oy))
        # soft shadow: the silhouette, blurred, dropped a little to the lower right
        sh = np.asarray(layer)[..., 3].astype(float) * 0.35
        shadow = Image.fromarray(sh.astype("uint8"), "L").filter(ImageFilter.GaussianBlur(1.5 * UP))
        shadow = Image.fromarray(np.roll(np.roll(np.asarray(shadow), int(1.2 * UP), axis=0), int(1.5 * UP), axis=1))
        cell = Image.new("RGBA", (cw, ch), (10, 25, 5, 0))
        cell.putalpha(shadow)
        cell.alpha_composite(layer)
        sheet.paste(cell, (col * cw, 0))

    sheet.save(ASSETS / f"{OUT}-repaint@4x.png", optimize=True)
    sheet.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / f"{OUT}-repaint.png", optimize=True)
    print(f"wrote {OUT}-repaint@4x.png and {OUT}-repaint.png", file=sys.stderr)
