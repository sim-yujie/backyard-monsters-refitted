"""finish.py <job> <variant> : cut out sample-new.png (green ground) and fit each picture onto its Flash look.

A job of N looks (a1+a2) is split into N equal columns, left to right. Each cut-out is fitted onto its Flash look:
FIT=band (default for the Academy): the width of the bottom 30% = the same band of the Flash look (same footprint),
centred on it, base on Flash's base line, never more than CAP times Flash's height nor WIDE times its width.
FIT=box (default for the Bunker and the Cavern, whose rings, spikes and cracks have no solid foot): the whole picture
into Flash's box (the smaller of the two scales, times BOX), centred on Flash's box centre, bottom on Flash's bottom.
Writes new-4x-<look>.png (the building's shared canvas at 4x, origin at OX*4, OY*4) and prints the scales.
"""
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, UP, band, canvas, flash_body, flash_rgba, key, resize_pm  # noqa: E402

CAP = 1.12   # never more than this times Flash's height
WIDE = 1.05  # nor wider overall than this times Flash's width

job, variant = sys.argv[1], sys.argv[2]
looks = job.split("+")
out = OUT / "runs" / f"{job}-{variant}"
src = np.asarray(Image.open(out / "sample-new.png").convert("RGB"))
n = len(looks)
# split at the emptiest (greenest) column near each 1/n line, so a part reaching over the line is not chopped
gr = src.astype(int)
green = ((gr[..., 1] > 150) & (gr[..., 1] > gr[..., 0] * 1.45) & (gr[..., 1] > gr[..., 2] * 1.45)).sum(axis=0)
cuts = [0]
for j in range(1, n):
    m = src.shape[1] * j // n
    lo, hi = m - src.shape[1] // (4 * n), m + src.shape[1] // (4 * n)
    cuts.append(lo + int(np.argmax(green[lo:hi])))
cuts.append(src.shape[1])
for i, lk in enumerate(looks):
    b = lk[0]
    CW, CH, OX, OY = canvas(b)
    fit = os.environ.get("FIT", "band" if b == "a" else "box")
    painted = key(src[:, cuts[i]:cuts[i + 1]], keep_small=0.01 if b == "a" else 0.0)
    painted.save(out / f"sample-cut-{lk}.png")
    old = flash_body(lk) if b == "c" else flash_rgba(lk)   # the Cavern: fitted to its rocks, its ground is Flash's
    fb, pb = old.getbbox(), painted.getbbox()
    if fit == "band":
        l0, r0, b0, t0 = band(old, 200)
        l1, r1, b1, t1 = band(painted, 128)
        k_band = (r0 - l0) * UP / (r1 - l1)
        k_h = (b0 - t0) * CAP * UP / (b1 - t1)
        k_wide = (fb[2] - fb[0]) * WIDE * UP / (pb[2] - pb[0])
        k = min(k_band, k_h, k_wide)
        mid_old, mid_new = (l0 + r0) / 2 * UP, ((l1 + r1) / 2 - pb[0]) * k
        bot_old, bot_new = b0 * UP, (b1 - pb[1]) * k
        note = f"band {k_band:.4f} height cap {k_h:.4f} width cap {k_wide:.4f}"
    else:
        boxk = float(os.environ.get("BOX", "1.0"))
        k = min((fb[2] - fb[0]) / (pb[2] - pb[0]), (fb[3] - fb[1]) / (pb[3] - pb[1])) * UP * boxk
        mid_old, mid_new = (fb[0] + fb[2]) / 2 * UP, (pb[2] - pb[0]) / 2 * k
        bot_old, bot_new = fb[3] * UP, (pb[3] - pb[1]) * k
        note = f"box x{boxk}"
    crop = resize_pm(painted.crop(pb), (max(1, round((pb[2] - pb[0]) * k)), max(1, round((pb[3] - pb[1]) * k))))
    c4 = Image.new("RGBA", (CW * UP, CH * UP), (0, 0, 0, 0))
    c4.alpha_composite(crop, (round(mid_old - mid_new), round(bot_old - bot_new)))
    c4.save(out / f"new-4x-{lk}.png")
    nb = c4.getbbox()
    print("done", lk, fit, "scale", round(k, 4), note,
          "w/h vs flash", round((nb[2] - nb[0]) / UP / (fb[2] - fb[0]), 3), round((nb[3] - nb[1]) / UP / (fb[3] - fb[1]), 3))
