"""finish_ruin.py <variant> : cut out runs/ruin-<variant>/sample-new.png (green ground) and fit its two halves
(damaged on the left, destroyed on the right) onto the wired shop (runs/shop3-C/new-4x.png, round 3's FIT=guide).

Codex painted both bigger than its guide's diamonds asked, so they are fitted to the shop itself: the damaged one,
which keeps the whole shop's outline (sign at the left, chimney at the back), at the scale that makes its picture as
wide as the shop's, its bottom on the shop's bottom and its middle on the shop's middle; the destroyed one at that
same scale (both were painted at one scale in one picture), its bottom on the shop's bottom, its middle on the base's
front corner (x 0). Writes new-4x-damaged.png and new-4x-destroyed.png and prints the scales.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import CANVAS, OUT, UP, key, resize_pm  # noqa: E402

variant = sys.argv[1]
out = OUT / "runs" / f"ruin-{variant}"
src = np.asarray(Image.open(out / "sample-new.png").convert("RGB"))
mid = src.shape[1] // 2
CW, CH, OX, OY = CANVAS
whole = Image.open(OUT / "runs" / "shop3-C" / "new-4x.png").convert("RGBA")
wb = whole.getbbox()
damaged = key(src[:, :mid], keep_small=0.0)
destroyed = key(src[:, mid:], keep_small=0.0)
db, xb = damaged.getbbox(), destroyed.getbbox()
k = (wb[2] - wb[0]) / (db[2] - db[0])
for name, painted, box, centre in (("damaged", damaged, db, (wb[0] + wb[2]) / 2), ("destroyed", destroyed, xb, OX * UP)):
    crop = resize_pm(painted.crop(box), (round((box[2] - box[0]) * k), round((box[3] - box[1]) * k)))
    c4 = Image.new("RGBA", (CW * UP, CH * UP), (0, 0, 0, 0))
    c4.alpha_composite(crop, (round(centre - crop.width / 2), wb[3] - crop.height))
    c4.save(out / f"new-4x-{name}.png")
    print("done", name, "scale", round(k, 4), "box", c4.getbbox(), "whole", wb)
