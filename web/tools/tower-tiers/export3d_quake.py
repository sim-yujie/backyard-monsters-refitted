"""Exports the 3D Quake Tower (building 129, Flash INFERNOQUAKETOWER.as) into the game: one look for all its levels,
as Flash's (new art, branch art/quake-3d, for the owner's review).

    python -I web/tools/tower-tiers/export3d_quake.py <3D art worktree>

Reads the renders from `art-samples/quake-3d/render/t1/` (`quake3d.py -- 1 cells`, `QUAKE_STATE=damaged quake3d.py --
1 cell 0`, `quake3d.py -- 1 destroyed`), 4x the game's size with the footprint's middle on the ground at
`camera.json`'s `ground_4x`, and writes into `server/public/assets/buildings/iquaketower/`:

- `top.t1@2x.webp`: the tower at rest (cell 0), for the icons.
- `anim.t1@2x.webp`: the strike, Flash's 33 cells (`anim.1.png`), each the whole tower (the weight rises out of the
  pit and the claw comes down past the bar), so it stands in for `top`; a battle steps it with the tower's
  `towerCell` events as it stepped Flash's.
- `top.t1.damaged@2x.webp`: the damaged tower, a still (Flash's damaged strip animates; the 3D buildings' damaged
  looks stand still).
- `top.t1.destroyed@2x.webp`: the wreck.

It prints the JSON rows `buildingArtTiers.ts` holds, in 1x px from the building's origin. The footprint (70) puts the
footprint's middle at (0, 35) from the origin. Flash's shadow (`shadow.1.v2.jpg`) is kept: the 3D was modelled on it.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path(sys.argv[1]).resolve() / "art-samples" / "quake-3d" / "render" / "t1"
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "server" / "public" / "assets" / "buildings" / "iquaketower"
FOOTPRINT = 70
CELLS = 33
FLASH_TOP_Y = -75          # Flash's anim.1.png stands at (-37, -75)
MAX_W = 4096               # the widest a strip's file may be, px: wider, it wraps into rows (`columns`)


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


def save(im, path):
    im.save(path, "WEBP", quality=90, alpha_quality=100, method=6)


def main():
    cam = json.loads((SRC / "camera.json").read_text())
    gx, gy = cam["ground_4x"]
    gy -= 4 * FOOTPRINT / 2                 # the canvas pixel of the building's origin

    def game(px, py):
        return round((px - gx) / 4), round((py - gy) / 4)

    def still(name, out_name):
        im = Image.open(SRC / name).convert("RGBA")
        box = even(im.getbbox())
        save(resize_pm(im.crop(box), ((box[2] - box[0]) // 2, (box[3] - box[1]) // 2)), OUT / out_name)
        return [out_name, *game(box[0], box[1])]

    names = [SRC / f"cell-{i:02d}.png" for i in range(CELLS)]
    assert all(n.exists() for n in names), "render all 33 cells first"
    cells = [Image.open(n).convert("RGBA") for n in names]
    top = still("cell-00.png", "top.t1@2x.webp")
    u = [c.getbbox() for c in cells]
    box = even((min(b[0] for b in u), min(b[1] for b in u), max(b[2] for b in u), max(b[3] for b in u)))
    w, h = (box[2] - box[0]) // 2, (box[3] - box[1]) // 2
    cols = min(CELLS, MAX_W // w)
    rows = -(-CELLS // cols)
    sheet = Image.new("RGBA", (w * cols, h * rows), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        sheet.paste(resize_pm(c.crop(box), (w, h)), ((i % cols) * w, (i // cols) * h))
    save(sheet, OUT / "anim.t1@2x.webp")
    x, y = game(box[0], box[1])
    damaged = still("dmg-00.png", "top.t1.damaged@2x.webp")
    destroyed = still("destroyed.png", "top.t1.destroyed@2x.webp")
    files = ["top.t1@2x.webp", "anim.t1@2x.webp", "top.t1.damaged@2x.webp", "top.t1.destroyed@2x.webp"]
    print(json.dumps(dict(top=top, anim=["anim.t1@2x.webp", x, y, w // 2, h // 2, CELLS],
                          **({"columns": cols} if rows > 1 else {}), lift=FLASH_TOP_Y - y,
                          damaged=damaged, destroyed=destroyed,
                          bytes=sum((OUT / f).stat().st_size for f in files))))


if __name__ == "__main__":
    main()
