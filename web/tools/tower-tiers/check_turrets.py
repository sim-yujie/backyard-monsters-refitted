"""Checks that every turret heading the game ships stands on the same spot of its body.

    python -I web/tools/tower-tiers/check_turrets.py

For the Sniper, Laser, Aerial Defense and Cannon, reads each tier's strip as `buildingArtTiers.ts` places it, finds the collar
in every cell (`mount.py`) and fails if any cell's collar is more than 2 px (game size) from the others'. The first
export (5f3fea39) was 2.6 to 6 px out, enough to see the head slide on its mount as it turned. The Railgun's housing
is not round, so it is not measured here; check it by eye (its headings agree to half a pixel).
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

ROW = re.compile(r'strip: \["(turret\.t(\d)@2x\.webp)", (-?\d+), (-?\d+), (\d+), (\d+), (\d+)\]')

bad = 0
for t, (tower, folder) in TOWERS.items():
    part = TABLE[TABLE.index(f"// {t} "):]
    part = part[:part.index("\n  ],")]
    for m in ROW.finditer(part):
        name, tier, sx, sy, w, h, n = m.group(1), m.group(2), *map(int, m.groups()[2:])
        strip = np.asarray(Image.open(ASSETS / folder / name).convert("RGBA"))[..., 3]
        cells = [strip[:, 2 * w * i:2 * w * (i + 1)] for i in range(n)]
        pts = np.array(centres(tower, cells)) / 2 + (sx, sy)
        off = np.hypot(*(pts - np.median(pts, 0)).T)
        worst = int(np.argmax(off))
        ok = off.max() <= LIMIT
        bad += not ok
        print(f"{'ok ' if ok else 'BAD'} {tower} tier {tier}: collar at {np.median(pts, 0).round(1).tolist()}, "
              f"furthest cell {worst} is {off.max():.1f} px off")
sys.exit(1 if bad else 0)
