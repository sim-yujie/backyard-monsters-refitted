"""
Build a repainted level 2 champion sheet (Gorgo ape_2, Drull dragon_2, Fomor fly_2, Krallen look 1 krallen_1_rev_65) from Codex-painted frames.
Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-champ-l2-sprite.py <sheet: ape_2 | dragon_2 | fly_2 | krallen_1> [<source folder>]

The source folder (default: the sheet's art-trials folder, see web/tools/champ-l2-kit/common.py) holds one painted grid per call,
`A<col>/frames-new.png` (idle + walk frames) and `B<col>/frames-new.png` (idle + attack frames), on a flat key-colour ground
(web/tools/champ-l2-kit/make_batch.py builds the inputs and the prompt of each call and fixes the grid layout). Gorgo's old sheet is
left/right symmetric, so only its columns 2..10 are painted and columns 11..15, 0, 1 are column (4 - c) mod 16 flipped; the other
sheets are painted in every column.

Each painted frame is keyed and scaled so that the idle silhouette covers AREA times the pixels the old idle body does (one factor per
heading, smoothed over the neighbouring headings; walk frames are held to within a few percent of it so the body does not pulse).
Placement is by the FEET, on the old sheet's own cell for that column (mirrored columns too, so they stand exactly where Flash drew
them): the idle sits on the old idle's ground line and body centre; walk frames keep the feet on the same ground pixel; attack frames
follow the old sheet's lift and shift. Output, in the original layout and cell size:

    server/public/assets/monsters/<file>-repaint.png      same size as the old sheet
    server/public/assets/monsters/<file>-repaint@4x.png   the same at 4x (the game draws this one, REPAINTED_SHEETS in monsterSprites.ts)
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "champ-l2-kit"))
from common import *  # noqa: E402,F403

UP = 4
AREA = 1.05                       # new idle silhouette area / old idle body area
WALK_HOLD = 0.04                  # a walk frame may differ from the idle's size by this much

if len(sys.argv) not in (2, 3):
    sys.exit(__doc__)
NAME = sys.argv[1]
S = SHEETS[NAME]
SOURCE = Path(sys.argv[2]) if len(sys.argv) == 3 else S["full"]
CELL = S["cell"]
COLS, ROWS = 16, S["rows"]
ORIGINAL = sheet(NAME)
PAINTED = [c for c in S["painted"] if (SOURCE / f"A{c}" / "frames-new.png").exists()] if os.environ.get("PARTIAL") else S["painted"]
WALK = set(S["walk"]) - {0}
FIRST = 0                         # the row whose silhouette fixes the scale (idle; Krallen: first walk frame)


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


def grid_cells(path, mode):
    rows, gc, gr = grid_rows(NAME, mode)
    im = Image.open(path).convert("RGB")
    w, h = im.size
    cw, ch = w // gc, h // gr
    return rows, [key_cell(np.asarray(im.crop(((i % gc) * cw, (i // gc) * ch, (i % gc + 1) * cw, (i // gc + 1) * ch))), S["key"])
                  for i in range(len(rows))]


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


# frames[col][row] = keyed cutout; "b_idle" = the first cell of the attack call (same pose as row FIRST, fixes its scale)
frames = {}
for col in PAINTED:
    frames[col] = {}
    for mode in ("A", "B"):
        if mode == "B" and not S["attack"]:
            continue
        p = SOURCE / f"{mode}{col}" / "frames-new.png"
        if not p.exists():
            sys.exit(f"missing painting {mode}{col}")
        rows, cells = grid_cells(p, mode)
        for i, (r, cut) in enumerate(zip(rows, cells)):
            if mode == "B" and i == 0:
                frames[col]["b_idle"] = cut
            elif mode == "A" or r not in frames[col]:
                frames[col][r] = cut
for col in range(COLS):          # mirrored columns: the painted mirror heading, flipped
    if col not in frames:
        src = (4 - col) % 16
        if src in frames:
            frames[col] = {r: im.transpose(Image.FLIP_LEFT_RIGHT) for r, im in frames[src].items()}
COLUMNS = sorted(frames)

# one size per heading (sqrt of the idle area, in 1x pixels), smoothed 1-2-1 over the neighbours (round the circle)
want = {c: np.sqrt(AREA * old_body(c, FIRST).sum()) for c in COLUMNS}
k = {}
for c in COLUMNS:
    near = [want[j % 16] for j in (c - 1, c, c, c + 1) if j % 16 in want]
    k[c] = float(np.mean(near)) / np.sqrt(solid(frames[c][FIRST]).sum())

cw, ch = CELL[0] * UP, CELL[1] * UP
placed = {}      # (col, row) -> RGBA cell at 4x
for c in COLUMNS:
    old_idle = old_body(c, FIRST)
    old_fx, old_ground = feet(old_idle)
    old_cx = np.where(old_idle)[1].mean()
    area_a0 = solid(frames[c][FIRST]).sum()
    area_b0 = solid(frames[c]["b_idle"]).sum() if "b_idle" in frames[c] else area_a0
    ka = k[c]
    s0 = solid(frames[c][FIRST])
    fx0, _ = feet(s0)
    idle_ox = old_cx - np.where(s0)[1].mean() * ka       # silhouette centre on the old body centre
    feet_x = fx0 * ka + idle_ox                           # where the idle's feet are in the cell
    for row in range(ROWS):
        cut = frames[c][row]
        s = solid(cut)
        if row == FIRST:
            kk = ka
        elif row in WALK:
            kk = ka * float(np.clip(np.sqrt(area_a0 / s.sum()), 1 - WALK_HOLD, 1 + WALK_HOLD))
        else:
            kk = ka * np.sqrt(area_a0 / area_b0)     # the attack call's own idle fixes its scale
        fx, bottom = feet(s)
        dx = dy = 0.0
        if row != FIRST and row not in WALK:
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

out = Image.new("RGBA", (COLS * cw, ROWS * ch))
for (c, row), cell in placed.items():
    out.paste(cell, (c * cw, row * ch))
stem = S["file"][:-4]
out.save(ASSETS / f"{stem}-repaint@4x.png", optimize=True)
out.resize(ORIGINAL.size, Image.LANCZOS).save(ASSETS / f"{stem}-repaint.png", optimize=True)
print(f"wrote {stem}-repaint@4x.png and {stem}-repaint.png", file=sys.stderr)
