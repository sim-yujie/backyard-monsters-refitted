"""finish.py <look> <variant> : cut out sample-new.png (green ground) and fit it onto the Flash look's footprint.

Fit: the width of the bottom 30% of the painting = the same band of the Flash look (same footprint), centred on it, base
on the Flash base line, never more than CAP times Flash's height nor WIDE times its overall width. Writes new-4x.png on the shared canvas (common.CANVAS)
at 4x, the building's origin at (OX*4, OY*4), and prints the scale. FIT=box fits the whole picture into Flash's box
instead (look 1: its brass disc is wider than Flash's, so the band fit shrank the ball).
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import CH, CW, OUT, UP, band, flash_rgba, key, resize_pm  # noqa: E402

CAP = 1.12   # never more than this times Flash's height
WIDE = 1.05  # nor wider overall than this times Flash's width

look, variant = sys.argv[1], sys.argv[2]
state = "destroyed" if look == "x" else "damaged" if look.endswith("d") else ""
level = 2 if look == "x" else int(look[0])
out = OUT / "runs" / f"L{look}-{variant}"
painted = key(np.asarray(Image.open(out / "sample-new.png").convert("RGB")))
painted.save(out / "sample-cut.png")
old = flash_rgba(level, state)
l0, r0, b0, t0 = band(old, 200)
l1, r1, b1, t1 = band(painted, 128)
k_band = (r0 - l0) * UP / (r1 - l1)
k_h = (b0 - t0) * CAP * UP / (b1 - t1)
fb, pb = old.getbbox(), painted.getbbox()
k_wide = (fb[2] - fb[0]) * WIDE * UP / (pb[2] - pb[0])
k = min(k_band, k_h, k_wide)
if os.environ.get("FIT") == "box":   # fit the whole picture (key included) into Flash's box instead of by the footprint band
    k = min((fb[2] - fb[0]) * UP / (pb[2] - pb[0]), (fb[3] - fb[1]) * UP / (pb[3] - pb[1]))
bx0, by0, bx1, by1 = painted.getbbox()
crop = resize_pm(painted.crop((bx0, by0, bx1, by1)), (max(1, round((bx1 - bx0) * k)), max(1, round((by1 - by0) * k))))
c4 = Image.new("RGBA", (CW * UP, CH * UP), (0, 0, 0, 0))
mid_old = (l0 + r0) / 2 * UP
mid_new = ((l1 + r1) / 2 - bx0) * k
c4.alpha_composite(crop, (round(mid_old - mid_new), round(b0 * UP - (b1 - by0) * k)))
c4.save(out / "new-4x.png")
print("done", out.as_posix(), "scale", round(k, 4), "band", round(k_band, 4), "height cap", round(k_h, 4), "width cap", round(k_wide, 4),
      "height vs flash", round((b1 - t1) * k / UP / (b0 - t0), 3))
