"""finish.py <variant> : cut out sample-new.png (green ground) and fit it onto the surface Modern store.

FIT=box (default): the whole picture goes into the surface picture's box (the smaller of the two scales, times BOX,
default 1.0), centred on the box's centre, bottom on its bottom, so the copy stands on the same spot.
FIT=band (the original shops of round 2, whose signs stick out at the side): the width of the bottom 30% = the same
band of the surface store (the same footprint), centred on it, base on its base line, never more than CAP times its
height nor WIDE times its width.
FIT=guide (round 3, painted on make_shop3.py's guide.png): the guide's base diamond (front corner at 512, 900 of the
1024 image, 300 px half-width) becomes the Store's base diamond in the yard, BASE_HW (default 40, as wide as Flash's store) world px half-width,
its front corner at (0, BASE_Y) (default 56: Flash's store stands there) below the building's origin, the top corner
of its 70 footprint.
Writes new-4x.png (the shared canvas at 4x) and prints the scale.
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import CANVAS, OUT, UP, band, key, resize_pm, surface_rgba  # noqa: E402

variant = sys.argv[1]
out = OUT / "runs" / variant
src = np.asarray(Image.open(out / "sample-new.png").convert("RGB"))
painted = key(src, keep_small=0.0)
painted.save(out / "sample-cut.png")
old = surface_rgba()
fb, pb = old.getbbox(), painted.getbbox()
CW, CH, _, _ = CANVAS
c4 = Image.new("RGBA", (CW * UP, CH * UP), (0, 0, 0, 0))
fit = os.environ.get("FIT", "box")
if fit == "guide":
    base_hw, base_y = float(os.environ.get("BASE_HW", "40")), float(os.environ.get("BASE_Y", "56"))
    g = painted.width / 1024   # Codex may answer at another size than the guide's 1024 (1254 is common)
    k = base_hw * UP / (300 * g)
    full = resize_pm(painted, (round(painted.width * k), round(painted.height * k)))
    _, _, OX, OY = CANVAS
    c4.alpha_composite(full, (round(OX * UP - 512 * g * k), round((OY + base_y) * UP - 900 * g * k)))
elif fit == "band":
    CAP, WIDE = float(os.environ.get("CAP", "1.12")), float(os.environ.get("WIDE", "1.25"))
    l0, r0, b0, t0 = band(old, 128)
    l1, r1, b1, t1 = band(painted, 128)
    k = min((r0 - l0) / (r1 - l1), (b0 - t0) * CAP / (b1 - t1), (fb[2] - fb[0]) * WIDE / (pb[2] - pb[0]))
    crop = resize_pm(painted.crop(pb), (max(1, round((pb[2] - pb[0]) * k)), max(1, round((pb[3] - pb[1]) * k))))
    c4.alpha_composite(crop, (round((l0 + r0) / 2 - ((l1 + r1) / 2 - pb[0]) * k), round(b0 - (b1 - pb[1]) * k)))
else:
    boxk = float(os.environ.get("BOX", "1.0"))
    k = min((fb[2] - fb[0]) / (pb[2] - pb[0]), (fb[3] - fb[1]) / (pb[3] - pb[1])) * boxk
    crop = resize_pm(painted.crop(pb), (max(1, round((pb[2] - pb[0]) * k)), max(1, round((pb[3] - pb[1]) * k))))
    c4.alpha_composite(crop, (round((fb[0] + fb[2]) / 2 - crop.width / 2), fb[3] - crop.height))
c4.save(out / "new-4x.png")
nb = c4.getbbox()
print("done", variant, "scale", round(k, 4), "w/h vs surface",
      round((nb[2] - nb[0]) / (fb[2] - fb[0]), 3), round((nb[3] - nb[1]) / (fb[3] - fb[1]), 3))
