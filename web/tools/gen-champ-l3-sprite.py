"""
Build the repainted level 3 batch champion sheets (Gorgo ape_3, Drull dragon_3, Fomor fly_3, Krallen looks 2 and 3 krallen_2_rev_65,
krallen_3_rev_65) and the level 4-6 sheets (ape_4..6, dragon_4..6, fly_4..6, columns 2..10 painted, the rest mirrored) from Codex-painted
frames, and the six Korath sheets (korath_1..6, web/tools/korath-kit, columns 2..10 painted, the rest mirrored). Usage (from the repo root):

    pip install pillow numpy scipy
    python web/tools/gen-champ-l3-sprite.py <sheet> <source folder>      e.g.  ape_3 art-trials/champions/gorgo/L3/full

The source folder holds one painted grid per call, `<mode><col>/frames-new.png` on a flat #FF00FF ground (web/tools/champ-l3-kit/make_batch.py
builds the inputs and the prompt of each call; SHEETS below says which rows each call paints, cell 1 of every call being row 0). Gorgo and
both Krallen looks have the columns 2..10 (front, through left, to back) painted; the other columns (11..15, 0, 1) are the painted column (4 - c) mod 16
flipped left/right, placed against column c's own old frames. Fomor has every column painted (as its level 1 repaint), Drull every column but
12, 14 and 15: their paintings gave Drull a second tail (a tall spike as well as the real one), so they are 8, 6 and 5 flipped (the Flash
sheet is mirrored the same way).

Each painted frame is keyed (the ground is flood-filled from the cell edge) and scaled so that the row-0 silhouette covers AREA times the
pixels the old row-0 body does (one factor per heading, smoothed over the neighbouring headings). Placement: row 0 sits on the old row 0's
ground line and centre. Gorgo and Drull walk frames keep the feet on exactly the same ground pixel (as level 1) and are held to within a few
percent of the row-0 size; every other frame (attacks, Fomor's flight, Krallen's gallop) follows the old sheet's own lift and shift of the
feet, and keeps its call's scale. Output, in the original layout at 1x and 4x:

    server/public/assets/monsters/<sheet>-repaint.png, <sheet>-repaint@4x.png

The game draws the @4x sheet (REPAINTED_SHEETS in web/src/game/attack/monsterSprites.ts).
"""
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

SHEETS = {
    "ape_3": dict(cell=(103, 88), rows=15, painted=range(2, 11), calls={"A": [0, *range(1, 8)], "B": [0, *range(8, 15)]}, hold_walk=True),
    "dragon_3": dict(cell=(114, 85), rows=15, painted=[c for c in range(16) if c not in (12, 14, 15)], calls={"A": [0, *range(1, 8)], "B": [0, *range(8, 15)]}, hold_walk=True),
    "fly_3": dict(cell=(98, 81), rows=7, painted=range(16), calls={"A": list(range(7))}, hold_walk=False),
    "krallen_2_rev_65": dict(cell=(131, 90), rows=16, painted=range(2, 11), calls={"A": list(range(10)), "B": [0, *range(10, 16)]}, hold_walk=False),
    "krallen_3_rev_65": dict(cell=(142, 100), rows=16, painted=range(2, 11), calls={"A": list(range(10)), "B": [0, *range(10, 16)]}, hold_walk=False,
                             cut_magenta=True),
}
# levels 4-6 (web/tools/champ-l456-kit): columns 2..10 painted, the rest mirrored (the Flash bodies are mirror images); 8 attack frames
for _name, _cell in {"ape_4": (148, 127), "ape_5": (160, 137), "ape_6": (140, 120),
                     "dragon_4": (131, 93), "dragon_5": (156, 117), "dragon_6": (171, 125)}.items():
    SHEETS[_name] = dict(cell=_cell, rows=16, painted=range(2, 11), calls={"A": [0, *range(1, 8)], "B": [0, *range(8, 16)]}, hold_walk=True,
                         nudge_in=True)
for _name, _cell in {"fly_4": (120, 92), "fly_5": (133, 105), "fly_6": (124, 105)}.items():
    SHEETS[_name] = dict(cell=_cell, rows=7, painted=range(2, 11), calls={"A": list(range(7))}, hold_walk=False, nudge_in=True)
# Korath levels 1-6 (web/tools/korath-kit): walk from row 0 (its first frame is the idle), the attack right after it, columns 2..10
# painted and the rest mirrored. Levels 5 and 6 also have the 10-row stomp (rows 20-29, call C), the quake Korath plays after three
# swings, and are drawn at 3x, as their big cells at 4x would make a sheet over 12,000 px wide.
for _lv, (_cell, _walk, _atk) in {1: ((72, 49), 8, 9), 2: ((119, 81), 8, 9), 3: ((128, 102), 9, 9),
                                  4: ((153, 123), 10, 10), 5: ((199, 162), 10, 10), 6: ((202, 167), 10, 10)}.items():
    _calls = {"A": list(range(_walk)), "B": [0, *range(_walk, _walk + _atk)]}
    if _lv >= 5:
        _calls["C"] = [0, *range(20, 30)]
    SHEETS[f"korath_{_lv}"] = dict(cell=_cell, rows=30 if _lv >= 5 else _walk + _atk, painted=range(2, 11), calls=_calls,
                                   hold_walk=True, nudge_in=True, cut_hue=True, up=3 if _lv >= 5 else 4)
AREA = 1.05                       # new row-0 silhouette area / old row-0 body area
WALK_HOLD = 0.04                  # a held walk frame may differ from row 0's size by this much
FIT_SHRINK = 0.15                 # a frame that would be cut by the cell edge may be shrunk by up to this much to fit

if len(sys.argv) != 3 or sys.argv[1] not in SHEETS:
    sys.exit(__doc__)
NAME, SOURCE = sys.argv[1], Path(sys.argv[2])
SPEC = SHEETS[NAME]
UP = SPEC.get("up", 4)
CELL, ROWS, COLS = SPEC["cell"], SPEC["rows"], 16
PAINTED = list(SPEC["painted"])
if os.environ.get("PARTIAL"):     # a test run before every heading is painted: only those with every call painted
    PAINTED = [c for c in PAINTED if all((SOURCE / f"{m}{c}" / "frames-new.png").exists() for m in SPEC["calls"])]
REPO = Path(__file__).resolve().parents[2]
ASSETS = REPO / "server" / "public" / "assets" / "monsters"
ORIGINAL = Image.open(ASSETS / f"{NAME}.png").convert("RGBA")


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


def upper_x(mask):
    """x centroid of the upper half of the silhouette (head and body: steadier than the feet when the arms and legs swing)."""
    x0, y0, x1, y1 = bbox(mask)
    ys, xs = np.where(mask)
    return xs[ys < (y0 + y1) / 2].mean()


def xref(mask):
    """The horizontal reference a frame is placed by: Fomor's trunk in flight (its raised wings swing the upper half, its painted legs hang
    differently from Flash's), else the upper body."""
    return trunk_x(mask) if NAME.startswith("fly_") else upper_x(mask)


def trunk_x(mask):
    """x centroid of the thick part of the silhouette (thin tails, reaching arms and spread wings eroded away): where the body stands."""
    x0, y0, x1, y1 = bbox(mask)
    core = ndi.binary_erosion(mask, iterations=max(1, round(0.12 * (y1 - y0))))
    return np.where(core if core.sum() > 20 else mask)[1].mean()


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
    touch = set(lab2[0, :]) | set(lab2[-1, :]) | set(lab2[:, 0]) | set(lab2[:, -1])
    for i, c in zip(ids, cnt):
        # a small piece on the cell edge is a wing tip or claw of the neighbouring cell reaching over the line: drop it
        if c > cnt.max() * (0.15 if i in touch else 0.02):
            keep |= lab2 == i
    keep = ndi.binary_fill_holes(keep)
    # ground trapped inside the body (between the legs, under an arm) is not edge-connected: cut out the clearly magenta pockets
    pocket, _ = ndi.label(ground & ~np.isin(lab, list(edge)))
    near = np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 80
    for i, c in zip(*np.unique(pocket[pocket > 0], return_counts=True)):
        hole = pocket == i
        if c > 40 and near[hole].mean() > 0.6:
            keep &= ~ndi.binary_dilation(hole, iterations=1)
    if SPEC.get("cut_magenta"):
        # a yellow creature has no magenta of its own: ground painted between the legs blended into shading (not pure enough for a
        # pocket above) is cut too. Pink pads and mouth have more green or far less blue; the purple spines are darker.
        keep &= ~ndi.binary_dilation((b > 0.75 * r) & (r > 140) & (g < b - 60), iterations=1)
    if SPEC.get("cut_hue"):
        # Korath (rock, lava and steel) has no pink or purple at all: any magenta-hued pocket is ground seen through a gap
        keep &= ~ndi.binary_dilation(((r - g) > 40) & ((b - g) > 40), iterations=1)
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    # despill the magenta fringe on the rim only: a pixel close to #FF00FF next to the ground is spill (Fomor's purple body is far darker)
    rim = ndi.binary_dilation(keep & ~ndi.binary_erosion(keep, iterations=5), iterations=2) & (alpha > 0)
    spill = rim & (np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 150)
    out = rgb.copy()
    out[..., 0] = np.where(spill & (b > r), np.minimum(r, g + 0.35 * (b - g)), r)
    out[..., 2] = np.where(spill & (r >= b), np.minimum(b, g + 0.35 * (r - g)), b)
    return Image.fromarray(np.dstack([out, alpha]).astype("uint8"), "RGBA")


def grid_cells(path, n):
    im = Image.open(path).convert("RGB")
    gc = 4 if n <= 8 else 5 if n <= 10 else 6
    w, h = im.size
    cw, ch = w // gc, h // 2
    return [key_cell(np.asarray(im.crop(((i % gc) * cw, (i // gc) * ch, (i % gc + 1) * cw, (i // gc + 1) * ch)))) for i in range(n)]


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


def flip(im):
    return im.transpose(Image.FLIP_LEFT_RIGHT)


# frames[col][row] = (keyed cutout, call, the call's own row-0 cutout)
frames = {}
for col in PAINTED:
    frames[col] = {}
    for mode, rows in SPEC["calls"].items():
        path = SOURCE / f"{mode}{col}" / "frames-new.png"
        if not path.exists():
            sys.exit(f"missing painting {mode}{col}")
        cells = grid_cells(path, len(rows))
        for cut, row in zip(cells, rows):
            if row not in frames[col]:
                frames[col][row] = (cut, mode, cells[0])
MIRRORED = {c: (4 - c) % 16 for c in range(COLS) if c not in PAINTED and (4 - c) % 16 in PAINTED}
for c, src in MIRRORED.items():
    frames[c] = {r: (flip(cut), m, flip(c0)) for r, (cut, m, c0) in frames[src].items()}
COLUMNS = sorted(frames)

# one size per painted heading (sqrt of the row-0 area, in 1x pixels), smoothed 1-2-1 over the neighbouring painted headings
want = {c: np.sqrt(AREA * old_body(c, 0).sum()) for c in PAINTED}
k = {}
cyclic = NAME in ("dragon_3", "fly_3")       # every heading round the circle is painted or mirrored
for i, c in enumerate(PAINTED):
    idx = [(j % len(PAINTED)) if cyclic else j for j in (i - 1, i, i, i + 1)]
    near = [want[PAINTED[j]] for j in idx if 0 <= j < len(PAINTED)]
    k[c] = float(np.mean(near)) / np.sqrt(solid(frames[c][0][0]).sum())
for c, src in MIRRORED.items():
    k[c] = k[src]

cw, ch = CELL[0] * UP, CELL[1] * UP
placed = {}      # (col, row) -> RGBA cell at 4x
for c in COLUMNS:
    old_idle = old_body(c, 0)
    old_ground = feet(old_idle)[1]
    old_x0 = xref(old_idle)
    old_cx = trunk_x(old_idle)
    area_0 = solid(frames[c][0][0]).sum()
    ka = k[c]
    for row in range(ROWS):
        cut, mode, call0 = frames[c][row]
        s = solid(cut)
        kk = ka * np.sqrt(area_0 / solid(call0).sum())       # each call's own row 0 fixes its scale
        hold = SPEC["hold_walk"] and mode == "A" and row > 0
        if hold:
            kk = ka * float(np.clip(np.sqrt(area_0 / s.sum()), 1 - WALK_HOLD, 1 + WALK_HOLD))
        bottom = feet(s)[1]
        dx = dy = 0.0
        if row == 0:
            idle_ox = old_cx - trunk_x(s) * kk                  # body (trunk) centre on the old body centre
            x0 = xref(s) * kk + idle_ox                          # where row 0's reference point is in the cell
        else:
            ob = old_body(c, row)
            dx = xref(ob) - old_x0
            dy = 0.0 if hold else feet(ob)[1] - old_ground
            if mode in ("B", "C"):       # an attack (or Korath's stomp) keeps still unless the old frame clearly moves
                dy = 0.0 if abs(dy) < 2 else dy
                dx = 0.0 if abs(dx) < 1.5 else dx
        X, Y, xr = x0 + dx, old_ground + dy, xref(s)
        if row > 0:      # a reach or lunge wider than the old frame: shrink that frame (up to FIT_SHRINK) rather than cut it at the cell edge
            bx0, by0, bx1, _ = bbox(np.asarray(cut)[..., 3] > 40)
            fit = min(X / max(xr - bx0, 1), (CELL[0] - X) / max(bx1 - xr, 1), Y / max(bottom - by0, 1))
            kk = max(min(kk, fit), kk * (1 - FIT_SHRINK))
        ox = X - xr * kk
        oy = Y - bottom * kk
        if row > 0 and SPEC.get("nudge_in"):     # still over the side edge (a lunge placed by a taller old pose): slide it in rather than cut it
            left, right = ox + bx0 * kk, ox + bx1 * kk
            if left < 0:
                ox += min(-left, max(0.0, CELL[0] - right))
            elif right > CELL[0]:
                ox -= min(right - CELL[0], max(0.0, left))
        big = resize_premultiplied(cut, (max(1, round(cut.width * kk * UP)), max(1, round(cut.height * kk * UP))))
        left, top = round(ox * UP), round(oy * UP)
        layer = Image.new("RGBA", (cw, ch))
        layer.alpha_composite(big, (max(0, left), max(0, top)), (max(0, -left), max(0, -top)))
        lost = np.asarray(big)[..., 3] > 40
        kept = np.asarray(layer)[..., 3] > 40
        if lost.sum() > kept.sum() * 1.002:
            print(f"column {c} row {row}: {int(lost.sum() - kept.sum())} opaque 4x pixels cut by the cell edge", file=sys.stderr)
        placed[(c, row)] = layer
    print(f"column {c:2}: scale {ka:.4f}{' (mirrored from %d)' % MIRRORED[c] if c in MIRRORED else ''}", file=sys.stderr)

# Codex paints the run hotter than the approved sample (Fomor and Drull redder, Gorgo and Krallen a touch brighter). Each heading's skin/fur
# pixels (SKIN: how much a pixel is body colour, 0-1; not the eyes, claws, crests, gems or spots) get one per-channel affine grade onto the
# mean and spread of the skin of the approved sample (art-trials/champions/<champ>/L<level>/sample-new.png), blended in by SKIN. The same grade
# for every cell of a heading, so its frames never differ from each other.
def _c(x):
    return np.clip(x, 0, 1)


SKIN = {
    "ape_3": lambda r, g, b: _c((b - r - 10) / 40) * _c((b - g) / 20),
    "dragon_3": lambda r, g, b: _c((r - g - 30) / 40) * _c((0.65 * r - g) / 20),
    "fly_3": lambda r, g, b: _c((np.minimum(r, b) - g) / 40),
    "krallen_2_rev_65": lambda r, g, b: _c((r - 120) / 40) * _c((g - 0.5 * r) / 20) * _c((0.65 * g - b) / 20),
    "krallen_3_rev_65": lambda r, g, b: _c((r - 120) / 40) * _c((g - 0.5 * r) / 20) * _c((0.65 * g - b) / 20),
}
for _lv in (4, 5, 6):
    SKIN[f"ape_{_lv}"], SKIN[f"dragon_{_lv}"], SKIN[f"fly_{_lv}"] = SKIN["ape_3"], SKIN["dragon_3"], SKIN["fly_3"]
SAMPLE = {      # skin mean, spread of the approved sample (both frames)
    "ape_3": ([33.9, 105.4, 182.9], [28.7, 52.4, 59.2]),
    "dragon_3": ([153.9, 52.0, 39.0], [58.3, 35.6, 28.1]),
    "fly_3": ([104.6, 33.6, 77.3], [41.7, 24.3, 29.0]),
    "krallen_2_rev_65": ([212.9, 150.4, 42.7], [35.5, 40.2, 26.1]),
    "krallen_3_rev_65": ([212.9, 150.4, 42.7], [35.5, 40.2, 26.1]),     # look 2's fur, so the looks do not jump in colour (its sample is yellower)
    "ape_4": ([34.8, 100.3, 165.9], [26.9, 54.0, 63.8]),
    "ape_5": ([34.0, 97.6, 160.3], [45.5, 55.1, 64.5]),
    "ape_6": ([48.7, 106.2, 176.5], [51.3, 54.8, 61.3]),
    "dragon_4": ([146.5, 49.7, 36.5], [57.1, 35.8, 28.0]),
    "dragon_5": ([168.1, 57.4, 37.0], [61.7, 38.5, 33.6]),
    "dragon_6": ([154.3, 44.9, 30.2], [60.0, 40.4, 30.8]),
    "fly_4": ([124.3, 42.5, 89.5], [55.1, 36.6, 42.5]),
    "fly_5": ([105.5, 36.5, 77.4], [46.0, 25.3, 35.2]),
    "fly_6": ([130.3, 47.7, 92.0], [52.4, 34.2, 41.4]),
}


def grade_column(c):
    keys = [key for key in placed if key[0] == c]
    px = np.concatenate([np.asarray(placed[key])[np.asarray(placed[key])[..., 3] > 200][:, :3].astype(float) for key in keys])
    body = px[SKIN[NAME](px[:, 0], px[:, 1], px[:, 2]) > 0.5]
    mean, std = body.mean(0), body.std(0)
    s_mean, s_std = np.array(SAMPLE[NAME][0]), np.array(SAMPLE[NAME][1])
    ratio = np.clip(s_std / std, 0.8, 1.25)
    for key in keys:
        a = np.asarray(placed[key]).astype(float)
        rgb = a[..., :3]
        g = np.clip((rgb - mean) * ratio + s_mean, 0, 255)
        w = SKIN[NAME](rgb[..., 0], rgb[..., 1], rgb[..., 2])[..., None]
        a[..., :3] = rgb + w * (g - rgb)
        placed[key] = Image.fromarray(a.round().astype("uint8"), "RGBA")


if not os.environ.get("NO_GRADE") and NAME in SKIN:
    for c in COLUMNS:
        grade_column(c)

sheet = Image.new("RGBA", (COLS * cw, ROWS * ch))
for (c, row), cell in placed.items():
    sheet.paste(cell, (c * cw, row * ch))
sheet.save(ASSETS / f"{NAME}-repaint@{UP}x.png", optimize=True)
sheet.resize((COLS * CELL[0], ROWS * CELL[1]), Image.LANCZOS).save(ASSETS / f"{NAME}-repaint.png", optimize=True)
print(f"wrote {NAME}-repaint@{UP}x.png and {NAME}-repaint.png", file=sys.stderr)
