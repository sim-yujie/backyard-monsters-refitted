"""Checks that every turret heading the game ships stands on the same spot of its body.

    python -I web/tools/tower-tiers/check_turrets.py

For the Sniper, Laser, Aerial Defense and Cannon, reads each tier's strip as `buildingArtTiers.ts` places it, finds the collar
in every cell (`mount.py`) and fails if any cell's collar is more than 2 px (game size) from the others'. The first
export (5f3fea39) was 2.6 to 6 px out, enough to see the head slide on its mount as it turned. The Railgun's housing
is not round, so it is not measured here; check it by eye (its headings agree to half a pixel).

The 3D towers' strips (rows with `aim: TURRET_AIM`, from `export3d.py`) are cut from renders turned about the pivot,
and many of their cells hide the collar, so they are checked another way: every cell is the heading 360k/cells, so
the middle of each cell's picture must go round an ellipse about the pivot as the cells turn. For each tilt row this
fits x and y as a + b cos + c sin of the heading and fails if any cell is more than 2 px off the fit or the ellipse's
middle is more than 1 px left or right of the pivot. It also checks the sheet is as big as the table says.
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mount import centres  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
ASSETS = ROOT / "server" / "public" / "assets" / "buildings"
TABLE = (ROOT / "web" / "src" / "game" / "yard" / "buildingArtTiers.ts").read_text(encoding="utf-8")
TOWERS = {21: ("sniper", "snipertower"), 23: ("laser", "lasertower"), 115: ("aerial", "flaktower"),
          20: ("cannon", "cannontower")}
LIMIT = 2.0

ROW = re.compile(r'strip: \["(turret\.t(\d)@2x\.webp)", (-?\d+), (-?\d+), (\d+), (\d+), (\d+)\]'
                 r'(?:, columns: (\d+))?, pivot: \[(-?[\d.]+), (-?[\d.]+)\],?\s*(aim: TURRET_AIM)?')
CENTRE_LIMIT = 1.0


def check_3d(tower, tier, strip, sx, sy, w, h, n, cols, pivot_x):
    """The 3D turn check above; True when it passes."""
    rows = n // cols
    if strip.shape != (rows * 2 * h, cols * 2 * w):
        print(f"BAD {tower} tier {tier} (3D): sheet {strip.shape[::-1]}, the table says {cols * 2 * w} x {rows * 2 * h}")
        return False
    turn = np.radians(np.arange(cols) * 360 / cols)
    fit = np.c_[np.ones(cols), np.cos(turn), np.sin(turn)]
    good = True
    for r in range(rows):
        mids = []
        for c in range(cols):
            ys, xs = np.nonzero(strip[r * 2 * h:(r + 1) * 2 * h, c * 2 * w:(c + 1) * 2 * w] >= 128)
            if not len(xs):
                print(f"BAD {tower} tier {tier} (3D) row {r}: cell {c} is empty")
                return False
            mids.append((sx + (xs.mean() + 0.5) / 2, sy + (ys.mean() + 0.5) / 2))
        mids = np.array(mids)
        coef = [np.linalg.lstsq(fit, mids[:, d], rcond=None)[0] for d in (0, 1)]
        off = np.hypot(*(mids - np.c_[fit @ coef[0], fit @ coef[1]]).T)
        drift = coef[0][0] - pivot_x
        ok = off.max() <= LIMIT and abs(drift) <= CENTRE_LIMIT
        good &= ok
        print(f"{'ok ' if ok else 'BAD'} {tower} tier {tier} (3D) row {r}: turns {drift:+.1f} px beside the pivot, "
              f"furthest cell {int(np.argmax(off))} is {off.max():.1f} px off the turn")
    return good


bad = 0
for t, (tower, folder) in TOWERS.items():
    part = TABLE[TABLE.index(f"// {t} "):]
    part = part[:part.index("\n  ],")]
    for m in ROW.finditer(part):
        name, tier, sx, sy, w, h, n = m.group(1), m.group(2), *map(int, m.groups()[2:7])
        strip = np.asarray(Image.open(ASSETS / folder / name).convert("RGBA"))[..., 3]
        if m.group(11):
            bad += not check_3d(tower, tier, strip, sx, sy, w, h, n, int(m.group(8) or n), float(m.group(9)))
            continue
        cells = [strip[:, 2 * w * i:2 * w * (i + 1)] for i in range(n)]
        pts = np.array(centres(tower, cells)) / 2 + (sx, sy)
        off = np.hypot(*(pts - np.median(pts, 0)).T)
        worst = int(np.argmax(off))
        ok = off.max() <= LIMIT
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {tower} tier {tier}: collar at {np.median(pts, 0).round(1).tolist()}, "
              f"furthest cell {worst} is {off.max():.1f} px off")
sys.exit(1 if bad else 0)
