"""Exports the 3D Cannon, Sniper and Laser tiers (owner, 28 Oct 2026: "I much prefer the 3D variant") into the game.

    python -I web/tools/tower-tiers/export3d.py <towers-3d worktree>

Reads `art-samples/<tower>-3d/t1|t2|t3/` from the 3D worktree (branch art/towers-3d; the Cannon's tier 1 is `t1/`, the
steel bands) and writes, per tower and tier, into `server/public/assets/buildings/<folder>/`:

- `body.t<N>@2x.webp`: the tower with its turret taken off. The Cannon's `body/body-4x.png` sits on the painted
  canvas (the kit's `canvas("cannon")`: origin 73 px from the left, 69 px above the bottom), so it is cut and halved
  here; the Sniper's and Laser's `body@2x.png` already stand where the painted `body.t<N>@2x.webp` did.
- `turret.t<N>@2x.webp`: the turret strip, every cell cut to what any cell covers and set on whole 1x pixels: one row
  of headings at one fixed tilt (owner, 28 Oct 2026: "Rather than overcomplicating the cannon barrel, can't we do
  calculation and modify the projectile direction rather than turning the head up and down"). The Cannon's art is
  rendered at its one tilt; the Laser's is rendered at several, and the row at `FIXED_TILT` is kept.
- `top.t<N>@2x.webp`: the whole tower in one picture (body and turret at its resting heading), for the icons.

It prints one line of JSON per tier with the rows `buildingArtTiers.ts` holds (`body`, `strip` as `[file, x, y, width,
height, cells]`, `pivot`, `top`), in 1x px from the building's origin, and writes `turretAimData.ts`: for every cell
the screen angle its barrel points (`aim_deg`; until the art measures it, its ground bearing as the camera sees it)
and, when the art's `strip.json` has them, the muzzle's place from the pivot (`muzzle`) and the tilt (`tilt`, degrees
down, from `pitch_deg`). The game picks the cell that faces the target on the ground, starts the shot at its muzzle
(`turretAim.ts`) and works out the shot's path from there (a Cannon shell's arc from its raised barrel). The Cannon has no front layer:
the parts of its body in front of the barrel are cut out of each cell.

The painted shadows (`shadow.t<N>.jpg`) and lifts are kept: each 3D tier was fitted to its painted one.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ART = Path(sys.argv[1]).resolve() / "art-samples"
ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "server" / "public" / "assets" / "buildings"
AIM_TS = ROOT / "web" / "src" / "game" / "yard" / "turretAimData.ts"
TOWERS = {"cannon": (20, "cannontower"), "sniper": (21, "snipertower"), "laser": (23, "lasertower")}
# The painted bodies the Sniper's and Laser's `body@2x.png` stand on, 1x from the origin (`buildingArtTiers.ts`).
PAINTED_BODY = {"sniper": {1: (-40, -37), 2: (-40, -70), 3: (-40, -86)},
                "laser": {1: (-33, -29), 2: (-33, -54), 3: (-33, -71)}}
# The Cannon's painted canvas (`finish.canvas("cannon")`): the origin's x, and its height above the canvas's bottom.
CANNON_X, CANNON_UP = 73, 69
# The heading a tower rests on in its still picture: the barrel down and to the left, as most painted stills.
REST_AIM = 120.0
# The one tilt kept from art rendered at several (degrees down): the Laser's head at a middle tilt, which looks at the
# middle of its range.
FIXED_TILT = {"laser": 36}
# Each tower's camera height in the 3D renders, degrees, for a `strip.json` that does not say.
ELEVATION = {"cannon": 23.0, "sniper": 23.0, "laser": 30.0}


def bearing_aim(cells, elevation):
    """Until the art measures `aim_deg`: the screen angle of cell k's ground bearing, 11.25k (0 down-right, 45 at the
    viewer), seen from a camera `elevation` degrees up at bearing 45, as if the barrel were level."""
    out = []
    for k in range(cells):
        b = np.radians(360 * k / cells)
        u, v = (np.cos(b) - np.sin(b)) / np.sqrt(2), (np.cos(b) + np.sin(b)) / np.sqrt(2)
        out.append(float(np.degrees(np.arctan2(v * np.sin(np.radians(elevation)), u)) % 360))
    return out


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes), as the sample kit's."""
    a = np.asarray(im.convert("RGBA")).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def cells_of(sheet, cw, ch, rows, cols):
    return [[sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)) for c in range(cols)] for r in range(rows)]


def by_tilt(value, depth):
    """`aim_deg` (`depth` 1) or `muzzle` (2) as [tilt][heading], whether the json has tilt rows or not."""
    if value is None:
        return None
    probe = value
    for _ in range(depth):
        probe = probe[0]
    return value if isinstance(probe, list) else [value]


def read(tower, tier):
    """The tier's pieces: body (2x picture, 1x top-left), cells [row][heading] (2x), the pivot in a cell (2x) and from
    the origin (1x), and what `strip.json` says of where each cell points."""
    src = ART / f"{tower}-3d" / f"t{tier}"
    if tower == "cannon":
        info = json.loads((src / "strip.json").read_text())
        sheet = Image.open(src / "strip@2x.png").convert("RGBA")
        body4 = Image.open(src / "body" / "body-4x.png").convert("RGBA")
        cy0 = body4.height / 4 - CANNON_UP
        x0, y0, x1, y1 = body4.getbbox()
        x0, y0, x1, y1 = x0 // 4 * 4, y0 // 4 * 4, -(-x1 // 4) * 4, -(-y1 // 4) * 4
        body = resize_pm(body4.crop((x0, y0, x1, y1)), ((x1 - x0) // 2, (y1 - y0) // 2))
        body_at = (round(x0 / 4 - CANNON_X), round(y0 / 4 - cy0))
        cw, ch = info["cell_w"], info["cell_h"]
        in_cell = info.get("pivot_in_cell_2x", (cw / 2, ch / 2))
        px, py = info["pivot_in_body_4x"]
        pivot = (px / 4 - CANNON_X, py / 4 - cy0)
    elif tower == "sniper":
        info = json.loads((src / "strip.json").read_text())
        sheet = Image.open(src / ("strip@2x.png" if (src / "strip@2x.png").exists() else "turret@2x.png")).convert("RGBA")
        body, body_at = Image.open(src / "body@2x.png").convert("RGBA"), PAINTED_BODY[tower][tier]
        cw, ch = info["cell_w_2x"], info["cell_h_2x"]
        in_cell = info["pivot_in_cell_2x"]
        pivot = tuple(info["pivot"])
    else:
        name = "strip" if (src / "strip.json").exists() else "strip32"
        info = json.loads((src / f"{name}.json").read_text())
        sheet = Image.open(src / f"{name}@2x.png").convert("RGBA")
        body, body_at = Image.open(src / "body@2x.png").convert("RGBA"), PAINTED_BODY[tower][tier]
        cw, ch = info["cell_w"], info["cell_h"]
        in_cell = info.get("pivot_in_cell_2x", (cw / 2, ch / 2))
        (px, py), (ax, ay) = info["pivot_4x"], info["anchor_4x"]
        pivot = ((px - ax) / 4, (py - ay) / 4)
    pitch = info.get("pitch_deg") or [None]
    rows, cols = len(pitch), info["cells"]
    assert sheet.width >= cols * cw and sheet.height >= rows * ch, (tower, tier, sheet.size, rows, cols, cw, ch)
    # The one row kept: the only one, or the one at the tower's fixed tilt.
    keep = pitch.index(FIXED_TILT[tower]) if rows > 1 else 0

    def row(value, depth):
        return None if value is None else [by_tilt(value, depth)[keep]]

    return dict(body=body, body_at=body_at, cells=[cells_of(sheet, cw, ch, rows, cols)[keep]], in_cell=in_cell,
                pivot=pivot, aim=row(info.get("aim_deg"), 1), muzzle=row(info.get("muzzle"), 2), tilt=pitch[keep],
                ground_deg=row(info.get("ground_deg"), 1),
                elevation=info.get("camera_elevation_deg") or info.get("elevation_deg"))


def export(tower, tier):
    type_, folder = TOWERS[tower]
    out = ASSETS / folder
    p = read(tower, tier)
    cells = p["cells"]
    cols = len(cells[0])
    cw, ch = cells[0][0].size
    # Each cell's top-left at 2x from the origin, on a whole 2x pixel: the pivot less its place in the cell.
    tx = round(2 * p["pivot"][0] - p["in_cell"][0])
    ty = round(2 * p["pivot"][1] - p["in_cell"][1])
    boxes = [c.getbbox() for row in cells for c in row]
    boxes = [b for b in boxes if b]
    bx0, by0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    bx1, by1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    # Whole 1x pixels: the cut starts on an even 2x pixel from the origin and is an even number of pixels across.
    bx0 -= (tx + bx0) % 2
    by0 -= (ty + by0) % 2
    w, h = bx1 - bx0 + (bx1 - bx0) % 2, by1 - by0 + (by1 - by0) % 2
    strip = Image.new("RGBA", (w * cols, h), (0, 0, 0, 0))
    for c, cell in enumerate(cells[0]):
        strip.alpha_composite(cell.crop((bx0, by0, bx0 + w, by0 + h)), (c * w, 0))
    turret_name = f"turret.t{tier}@2x.webp"
    strip.save(out / turret_name, "WEBP", quality=85, alpha_quality=100, method=6)
    sx, sy = (tx + bx0) // 2, (ty + by0) // 2

    body_name = f"body.t{tier}@2x.webp"
    p["body"].save(out / body_name, "WEBP", quality=90, alpha_quality=100, method=6)
    bx, by = p["body_at"]

    # The still: the body with the turret at the resting heading over it.
    aim0 = p["aim"][0] if p["aim"] else None
    rest = min(range(cols), key=lambda i: abs((aim0[i] - REST_AIM + 180) % 360 - 180)) if aim0 else cols * 6 // 32
    x0, y0 = min(2 * bx, 2 * sx), min(2 * by, 2 * sy)
    x1 = max(2 * bx + p["body"].width, 2 * sx + w)
    y1 = max(2 * by + p["body"].height, 2 * sy + h)
    still = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    still.alpha_composite(p["body"], (2 * bx - x0, 2 * by - y0))
    still.alpha_composite(strip.crop((rest * w, 0, (rest + 1) * w, h)), (2 * sx - x0, 2 * sy - y0))
    cx0, cy0, cx1, cy1 = still.getbbox()
    cx0, cy0 = cx0 - cx0 % 2, cy0 - cy0 % 2
    cx1, cy1 = cx1 + cx1 % 2, cy1 + cy1 % 2
    top_name = f"top.t{tier}@2x.webp"
    still.crop((cx0, cy0, cx1, cy1)).save(out / top_name, "WEBP", quality=90, alpha_quality=100, method=6)

    pivot = [round(v, 2) for v in p["pivot"]]
    row = dict(tower=tower, type=type_, tier=tier, folder=folder,
               top=[top_name, (x0 + cx0) // 2, (y0 + cy0) // 2],
               body=[body_name, bx, by],
               strip=[turret_name, sx, sy, w // 2, h // 2, cols],
               pivot=pivot,
               bytes=sum((out / n).stat().st_size for n in (top_name, body_name, turret_name)))
    elevation = p["elevation"] or ELEVATION[tower]
    # The game shows cell k of a row for ground bearing 360k / cols (`turretAim.bearingCell`): the art's measured
    # ground directions must be those bearings seen from its camera.
    for r in p["ground_deg"] or []:
        want = bearing_aim(cols, elevation)
        gap = max(abs((g - w + 180) % 360 - 180) for g, w in zip(r, want))
        assert len(r) == cols and gap < 1, (tower, tier, "ground_deg is not cell k = bearing 360k/cells", gap)
    if p["aim"]:
        assert len(p["aim"][0]) == cols, (tower, tier)
        aim = dict(headings=cols, aim=[round(a % 360, 1) for a in p["aim"][0]])
    else:
        assert cols == 32, (tower, tier, cols)
        aim = dict(headings=cols, aim=[round(a, 1) for a in bearing_aim(cols, elevation)])
    if p["muzzle"]:
        assert len(p["muzzle"][0]) == cols, (tower, tier)
        aim["muzzle"] = [round(v, 1) for m in p["muzzle"][0] for v in m]
    if p["tilt"] is not None:
        aim["tilt"] = round(p["tilt"], 1)
    aim["elevation"] = elevation
    return row, aim


AIM_HEAD = '''/**
 * Where each cell of the 3D towers' turret strips points, and where its muzzle
 * is: written by `web/tools/tower-tiers/export3d.py` from the 3D art's
 * `strip.json` (branch art/towers-3d), keyed by `<type>.t<tier>`. Do not edit
 * by hand. `turretAim.ts` reads it.
 */

import type { TurretAim } from "./turretAim";

export const TURRET_AIM = {
'''

if __name__ == "__main__":
    lines = []
    for name in TOWERS:
        for tier in (1, 2, 3):
            row, aim = export(name, tier)
            print(json.dumps(row))
            lines.append(f'  "{TOWERS[name][0]}.t{tier}": {json.dumps(aim, separators=(", ", ": "))},')
    AIM_TS.write_text(AIM_HEAD + "\n".join(lines) + "\n} satisfies Readonly<Record<string, TurretAim>>;\n",
                      encoding="utf-8")
    print(f"# wrote {AIM_TS.name}; run prettier on it", file=sys.stderr)
