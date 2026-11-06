"""Exports the 3D Tesla Tower and Monster Bunker tiers (owner, 29 Oct 2026: approved for beta 5) into the game.

    python -I web/tools/tower-tiers/export3d_static.py <3D art worktree> [tesla|bunker ...]

Reads each tier's renders from `art-samples/<tower>-3d/render/t<N>/` in the 3D worktree (branch art/tesla-bunker-3d;
`tesla3d.py -- N film-game` and `bunker3d.py -- N rise F ...`, see `LEVELS` below), 4x the game's size with the
footprint's middle on the ground at `camera.json`'s `ground_4x`, and writes per tier into
`server/public/assets/buildings/<folder>/`:

- `top.t<N>@2x.webp`: the tier at rest (the film still, the shutters down), for the yard and the icons.
- `anim.t<N>@2x.webp`: the tier's strip, as Flash's `anim` layer.
  - Tesla: the 55 cells of the game's Tesla timeline (`towerFx.ts` teslaTick), the film rolling up the face. Only what
    the film changes is in a cell (a box round it, cut to the pixels that ever change), drawn over `top`; cell 0 is
    the film at rest, as in `top`.
  - Bunker: 15 cells of the shutters rolling up into the deck, cell 0 shut and cell 14 open, each the whole bunker
    (the shutters bulge past the legs, so an open cell has holes where `top` has shutter): it stands in for `top`.

It prints one line of JSON per tier with the rows `buildingArtTiers.ts` holds (`top`, `anim` as `[file, x, y, width,
height, cells]`, `columns` when the strip wraps), in 1x px from the building's origin. The footprint's middle stands at
(0, size / 2) from the origin (`YardGrid.ts`: the Tesla's footprint is 70, the Bunker's 90). The painted shadows
(`shadow.t<N>.jpg`) are kept: the 3D tiers were modelled on the painted ones.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ART = Path(sys.argv[1]).resolve() / "art-samples"
ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "server" / "public" / "assets" / "buildings"
# Each tower: its folder, its footprint (yard units, `YardGrid.ts`), its cells and whether a cell is the whole tower.
TOWERS = {"tesla": dict(folder="lightningtower", footprint=70, cells=55, whole=False),
          "bunker": dict(folder="bunker", footprint=90, cells=15, whole=True)}
# The widest a strip's file may be, px: wider, it wraps into rows (`columns`), which every GPU can hold.
MAX_W = 4096


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes), as export3d.py's."""
    a = np.asarray(im.convert("RGBA")).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def even(box):
    """A 4x box grown to whole 1x px (multiples of 4)."""
    x0, y0, x1, y1 = box
    return x0 // 4 * 4, y0 // 4 * 4, -(-x1 // 4) * 4, -(-y1 // 4) * 4


def cells_of(tower, tier):
    src = ART / f"{tower}-3d" / "render" / f"t{tier}"
    names = sorted(src.glob("cell-*.png")) if tower == "tesla" else sorted(src.glob("rise-*.png"))
    assert len(names) == TOWERS[tower]["cells"], (tower, tier, len(names))
    cam = json.loads((src / "camera.json").read_text())
    return [Image.open(n).convert("RGBA") for n in names], cam["ground_4x"]


def save(im, path):
    im.save(path, "WEBP", quality=90, alpha_quality=100, method=6)


def export(tower, tier):
    cfg = TOWERS[tower]
    out = ASSETS / cfg["folder"]
    cells, (gx, gy) = cells_of(tower, tier)
    gy -= 4 * cfg["footprint"] / 2          # the canvas pixel of the building's origin

    def game(px, py):
        return round((px - gx) / 4), round((py - gy) / 4)

    still = cells[0]
    box = even(still.getbbox())
    top_name = f"top.t{tier}@2x.webp"
    save(resize_pm(still.crop(box), ((box[2] - box[0]) // 2, (box[3] - box[1]) // 2)), out / top_name)
    top = [top_name, *game(box[0], box[1])]

    arrays = [np.asarray(c).astype("int16") for c in cells]
    if cfg["whole"]:
        u = [c.getbbox() for c in cells]
        box = even((min(b[0] for b in u), min(b[1] for b in u), max(b[2] for b in u), max(b[3] for b in u)))
        keep = None
    else:
        # What the film changes: every pixel that differs from cell 0 in any cell, grown by a 4x px.
        moved = np.zeros(arrays[0].shape[:2], bool)
        for a in arrays[1:]:
            moved |= np.abs(a - arrays[0]).max(axis=2) > 2
        alpha_moves = max(int(np.abs(a[..., 3] - arrays[0][..., 3]).max()) for a in arrays[1:])
        assert alpha_moves <= 8, (tower, tier, "the film changes the outline", alpha_moves)
        grown = moved.copy()
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                grown |= np.roll(np.roll(moved, dy, 0), dx, 1)
        # Kept only where the tower is solid, so drawn over `top` it does not thicken the outline.
        keep = grown & (arrays[0][..., 3] >= 250)
        ys, xs = np.nonzero(keep)
        box = even((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    w, h = (box[2] - box[0]) // 2, (box[3] - box[1]) // 2
    n = len(cells)
    cols = min(n, MAX_W // w)
    rows = -(-n // cols)
    sheet = Image.new("RGBA", (w * cols, h * rows), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        a = np.asarray(c).copy()
        if keep is not None:
            a[~keep] = 0
        cell = resize_pm(Image.fromarray(a, "RGBA").crop(box), (w, h))
        sheet.paste(cell, ((i % cols) * w, (i // cols) * h))
    anim_name = f"anim.t{tier}@2x.webp"
    save(sheet, out / anim_name)
    x, y = game(box[0], box[1])
    row = dict(tower=tower, tier=tier, top=top, anim=[anim_name, x, y, w // 2, h // 2, n],
               **({"columns": cols} if rows > 1 else {}),
               bytes=sum((out / f).stat().st_size for f in (top_name, anim_name)))
    return row


if __name__ == "__main__":
    chosen = sys.argv[2:] or list(TOWERS)
    assert all(name in TOWERS for name in chosen), chosen
    for name in chosen:
        for tier in (1, 2, 3):
            print(json.dumps(export(name, tier)))
